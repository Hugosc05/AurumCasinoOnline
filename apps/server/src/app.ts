import { existsSync } from 'node:fs';
import { createServer, type Server } from 'node:http';
import path from 'node:path';
import cookieParser from 'cookie-parser';
import express, { type Express } from 'express';
import helmet from 'helmet';
import { type AppConfig, REPO_ROOT } from './config';
import type { AppContext } from './context';
import { Database, migrate } from './db/database';
import { seed } from './db/seed';
import { SESSION_COOKIE, getSessionUser, purgeExpiredSessions } from './auth/sessions';
import { csrfGuard, cors, errorHandler } from './lib/http';
import { logger } from './lib/logger';
import { notFound } from './lib/errors';
import { PokerManager } from './poker/manager';
import { BlackjackManager } from './blackjack/manager';
import { BotPool } from './bots/pool';
import { RealtimeHub } from './realtime/hub';
import { adminRoutes } from './routes/admin';
import { authRoutes } from './routes/auth';
import { gameRoutes } from './routes/games';
import { meRoutes } from './routes/me';
import { publicRoutes } from './routes/public';
import { adsCallbackRoute, adsRoutes } from './routes/ads';
import { formationRoutes } from './routes/formations';
import { socialRoutes } from './routes/social';
import { SocialService } from './social/social';
import { AdsService, createAdProvider } from './ads/ads';

export interface RunningApp {
  ctx: AppContext;
  app: Express;
  server: Server;
  close(): Promise<void>;
}

export function buildApp(config: AppConfig, db?: Database): RunningApp {
  const database = db ?? new Database(config.dbFile);
  logger.attach(database, config.LOG_LEVEL);
  migrate(database);
  seed(database);
  purgeExpiredSessions(database);

  const realtime = new RealtimeHub(database, config);
  const bots = new BotPool(database);
  const fast = config.POKER_FAST_MODE;
  const poker = new PokerManager(database, realtime, {
    fast,
    humanTimeoutMs: fast ? 2000 : 25_000,
    disconnectedTimeoutMs: fast ? 500 : 6_000,
    betweenHandsMs: fast ? 0 : 3_200,
  }, bots);
  const blackjack = new BlackjackManager(database, realtime, {
    fast,
    betWindowMs: fast ? 1500 : 15_000,
    demoBetWindowMs: fast ? 0 : 4_000,
    humanTurnMs: fast ? 2000 : 20_000,
    disconnectedTurnMs: fast ? 300 : 5_000,
    betweenRoundsMs: fast ? 0 : 2_500,
  }, bots);
  const ads = new AdsService(database, config, createAdProvider(config));
  const social = new SocialService(database, realtime);
  social.setSeatLookup((userId) => {
    for (const t of poker.tables.values()) if (t.hasUser(userId)) return 'poker';
    return blackjack.seatedTable(userId) ? 'blackjack' : null;
  });
  const ctx: AppContext = { config, db: database, realtime, poker, blackjack, bots, ads, social, startedAt: Date.now() };
  poker.init();
  blackjack.init();

  const app = express();
  app.disable('x-powered-by');
  if (config.TRUST_PROXY) app.set('trust proxy', 1);
  app.use(
    helmet({
      contentSecurityPolicy: {
        useDefaults: true,
        directives: {
          'default-src': ["'self'"],
          'script-src': ["'self'"],
          'style-src': ["'self'", "'unsafe-inline'", 'https://fonts.googleapis.com'],
          'font-src': ["'self'", 'https://fonts.gstatic.com', 'data:'],
          'img-src': ["'self'", 'data:', 'blob:'],
          'connect-src': ["'self'", 'ws:', 'wss:'],
          'media-src': ["'self'", 'blob:', 'data:'],
          'upgrade-insecure-requests': config.cookieSecure ? [] : null,
        },
      },
      crossOriginEmbedderPolicy: false,
      hsts: config.cookieSecure,
    }),
  );
  app.use(cors(config.allowedOrigins));
  app.use(express.json({ limit: '32kb' }));
  app.use(cookieParser());
  app.use((req, _res, next) => {
    req.sessionToken = req.cookies?.[SESSION_COOKIE];
    req.user = getSessionUser(database, req.sessionToken, config.SESSION_TTL_HOURS);
    next();
  });
  // Confirmaciones firmadas del proveedor de anuncios (servidor a servidor, sin cookie).
  app.use('/api/ads/callback', adsCallbackRoute(ctx));
  app.use('/api', csrfGuard(config.allowedOrigins));
  app.use('/api', (_req, res, next) => {
    res.setHeader('Cache-Control', 'no-store');
    next();
  });

  app.use('/api', publicRoutes(ctx));
  app.use('/api/auth', authRoutes(ctx));
  app.use('/api/me/formations', formationRoutes(ctx));
  app.use('/api/me', meRoutes(ctx));
  app.use('/api/games', gameRoutes(ctx));
  app.use('/api/admin', adminRoutes(ctx));
  app.use('/api/ads', adsRoutes(ctx));
  app.use('/api/social', socialRoutes(ctx));
  app.use('/api', (_req, _res, next) => next(notFound('Ruta de API no encontrada')));

  // Producción: el servidor entrega también el frontend compilado (un único proceso, un único puerto).
  const webDist = path.join(REPO_ROOT, 'apps', 'web', 'dist');
  if (existsSync(webDist)) {
    app.use(express.static(webDist, { index: false, maxAge: '1h', setHeaders: (res, file) => {
      if (file.includes(`${path.sep}assets${path.sep}`)) res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
    } }));
    app.use((req, res, next) => {
      if (req.method !== 'GET' || req.path.startsWith('/api') || req.path === '/ws') return next();
      res.sendFile(path.join(webDist, 'index.html'));
    });
  }
  app.use(errorHandler);

  const server = createServer(app);
  realtime.attach(server);
  const sessionSweep = setInterval(() => purgeExpiredSessions(database), 3600_000);
  sessionSweep.unref();

  return {
    ctx,
    app,
    server,
    async close() {
      clearInterval(sessionSweep);
      poker.shutdown();
      blackjack.shutdown();
      realtime.close();
      await new Promise<void>((resolve) => server.close(() => resolve()));
      database.close();
    },
  };
}
