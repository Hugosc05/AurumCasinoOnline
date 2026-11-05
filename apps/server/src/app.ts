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
import { clientIp, csrfGuard, cors, errorHandler, requireAdmin } from './lib/http';
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
import { RoomService } from './rooms/rooms';
import { CrashGame } from './crash/crash';
import { BingoManager } from './bingo/bingo';
import { LookService } from './profile/profile';
import { ChatService } from './chat/chat';
import { avatarRoutes, profileRoutes } from './routes/profile';
import { roomRoutes } from './routes/rooms';
import { AdsService, createAdProvider } from './ads/ads';
import { SecretStore } from './admin/secrets';
import { Alerter } from './admin/alerts';
import { SecurityLog } from './admin/security';
import { ActivityTracker } from './admin/activity';
import { HealthMonitor } from './admin/health';
import { MfaService } from './admin/mfa';
import { AdsenseClient } from './admin/adsense';
import { DependencyAudit, LedgerWatch } from './admin/checks';
import { adminMfaRoutes, adminPanelRoutes, adsenseCallbackRoute } from './routes/adminPanel';
import { getSetting } from './db/seed';
import { onOutcome } from './stats/stats';

/** Dominios que necesita AdSense (solo se permiten en la CSP si los anuncios están activados). */
const ADSENSE_SCRIPT = ['https://pagead2.googlesyndication.com', 'https://partner.googleadservices.com', 'https://tpc.googlesyndication.com', 'https://www.googletagservices.com', 'https://adservice.google.com', 'https://*.adtrafficquality.google', 'https://fundingchoicesmessages.google.com', 'https://www.google.com'];
const ADSENSE_FRAME = ['https://googleads.g.doubleclick.net', 'https://tpc.googlesyndication.com', 'https://www.google.com', 'https://*.adtrafficquality.google', 'https://fundingchoicesmessages.google.com'];
const ADSENSE_CONNECT = ['https://pagead2.googlesyndication.com', 'https://*.adtrafficquality.google', 'https://csi.gstatic.com', 'https://fundingchoicesmessages.google.com', 'https://*.google.com'];

export interface RunningApp {
  ctx: AppContext;
  app: Express;
  server: Server;
  close(): Promise<void>;
}

export function buildApp(config: AppConfig, db?: Database): RunningApp {
  const database = db ?? new Database(config.dbTarget);
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
  const bingo = new BingoManager(database, realtime, fast ? { countdownMs: 600, drawMs: 25, finishedMs: 150 } : { countdownMs: 25_000, drawMs: 2800, finishedMs: 9000 }, fast);
  const rooms = new RoomService(database, realtime, poker, blackjack, social, bingo);
  const crash = new CrashGame(database, realtime, fast ? { bettingMs: 1500, crashedMs: 300, tickMs: 20 } : { bettingMs: 7000, crashedMs: 3500, tickMs: 50 });
  // Chat de mesa: canales de mesas existentes; las salas privadas, solo para sus miembros.
  const chat = new ChatService(realtime, (channel, userId) => {
    if (channel === 'crash') return true;
    const [kind, id] = channel.split(':') as [string, string];
    if (id.startsWith('room-')) return !!userId && rooms.isMember(id.slice(5), userId);
    if (kind === 'poker') return poker.tables.has(id);
    if (kind === 'bj') return blackjack.tables.has(id);
    if (kind === 'bingo') return bingo.rooms.has(id);
    return false;
  });
  // Panel de administración: seguridad, avisos, actividad, salud del equipo e ingresos.
  const secrets = new SecretStore(database, config);
  const alerts = new Alerter(secrets);
  const security = new SecurityLog(database, alerts);
  const activity = new ActivityTracker(database);
  const health = new HealthMonitor(
    config.dbFile === ':memory:' || config.DATABASE_URL ? REPO_ROOT : path.dirname(config.dbFile),
    () => ({ connections: realtime.connectionCount(), online: realtime.onlineCount() }),
    alerts,
  );
  const mfa = new MfaService(database, security, config.adminMfaRequired);
  const adsense = new AdsenseClient(secrets);
  const depAudit = new DependencyAudit(alerts);
  const ledgerWatch = new LedgerWatch(database, alerts);
  realtime.onBlockedOrigin = (ip, origin) => security.record('ws_origin_blocked', { ip, detail: origin.slice(0, 200) });
  realtime.onPresenceChange = (online) => activity.online(online);
  realtime.onConnect((c) => {
    if (c.userId) activity.touchUser(c.userId);
  });
  realtime.on('nav', (c, msg) => {
    const raw = typeof msg.path === 'string' ? msg.path : '';
    if (!/^\/[\w\-/]{0,120}$/.test(raw)) return;
    if (c.path === raw) return;
    c.path = raw;
    c.pathSince = Date.now();
    activity.pageView(raw, { userId: c.userId, ip: c.ip, ua: c.ua });
  });
  // Premios grandes y errores graves: aviso al móvil.
  const offOutcome = onOutcome((o) => {
    const threshold = getSetting(database, 'alertBigWin');
    const net = o.payout - o.bet;
    if (threshold > 0 && net >= threshold) {
      const name = database.get<{ username: string; role: string }>('SELECT username, role FROM users WHERE id = ?', o.userId);
      if (name && name.role !== 'admin') void alerts.notify(`win|${o.roundId}`, 'info', `Premio grande: ${name.username} ha ganado ${net.toLocaleString('es-ES')} créditos netos en ${o.game} (apuesta ${o.bet.toLocaleString('es-ES')}).`, 0);
    }
  });
  const offErrors = logger.onError((message) => {
    void alerts.notify(`error|${message.slice(0, 80)}`, 'warn', `Error en el servidor: ${message.slice(0, 300)}. Detalles en Diagnóstico.`, 3600_000);
  });

  const ctx: AppContext = {
    config, db: database, realtime, poker, blackjack, bots, ads, social, rooms, crash, bingo, looks: new LookService(database),
    secrets, alerts, security, activity, health, mfa, adsense, depAudit, ledgerWatch, startedAt: Date.now(),
  };
  poker.init();
  blackjack.init();
  bingo.init();
  rooms.init();
  crash.init();
  chat.init();

  const app = express();
  app.disable('x-powered-by');
  if (config.TRUST_PROXY) app.set('trust proxy', 1);
  app.use(health.middleware());
  // Escáneres de vulnerabilidades (/.env, /wp-admin, /.git…): 404 y al registro de seguridad.
  app.use(security.probeTrap());
  // La CSP solo abre los dominios de AdSense si los anuncios están activados en el panel.
  let adsCache = { on: false, at: 0 };
  const adsOn = (): boolean => {
    if (Date.now() - adsCache.at > 10_000) adsCache = { on: getSetting(database, 'adsDisplay').enabled, at: Date.now() };
    return adsCache.on;
  };
  const withAds = (base: string[], extra: string[]) => (): string => [...base, ...(adsOn() ? extra : [])].join(' ');
  app.use(
    helmet({
      contentSecurityPolicy: {
        useDefaults: true,
        directives: {
          'default-src': ["'self'"],
          'script-src': [withAds(["'self'"], ADSENSE_SCRIPT)],
          'style-src': ["'self'", "'unsafe-inline'", 'https://fonts.googleapis.com'],
          'font-src': ["'self'", 'https://fonts.gstatic.com', 'data:'],
          'img-src': [withAds(["'self'", 'data:', 'blob:'], ['https:'])],
          'connect-src': [withAds(["'self'", 'ws:', 'wss:'], ADSENSE_CONNECT)],
          'frame-src': [withAds(["'self'"], ADSENSE_FRAME)],
          'media-src': ["'self'", 'blob:', 'data:'],
          'upgrade-insecure-requests': config.cookieSecure ? [] : null,
        },
      },
      crossOriginEmbedderPolicy: false,
      hsts: config.cookieSecure,
    }),
  );
  app.use(cors(config.allowedOrigins));
  // JSON pequeño en general; la subida de la foto de perfil admite un poco más.
  const smallJson = express.json({ limit: '32kb' });
  const avatarJson = express.json({ limit: '160kb' });
  app.use((req, res, next) => (req.path === '/api/profile/avatar' ? avatarJson : smallJson)(req, res, next));
  app.use(cookieParser());
  app.use((req, _res, next) => {
    req.sessionToken = req.cookies?.[SESSION_COOKIE];
    req.user = getSessionUser(database, req.sessionToken, config.SESSION_TTL_HOURS);
    if (req.user) activity.touchUser(req.user.id);
    next();
  });
  // Vuelta de Google al conectar AdSense (GET sin cookie: la protege un `state` de un solo uso).
  app.use('/api/adsense/callback', adsenseCallbackRoute(ctx));
  // ads.txt: obligatorio para que AdSense pague; se genera con el ID de editor del panel.
  app.get('/ads.txt', (_req, res) => {
    const pub = getSetting(database, 'adsDisplay').publisherId.replace(/^ca-/, '');
    if (!pub) return res.status(404).type('text/plain').send('');
    res.type('text/plain').send(`google.com, ${pub}, DIRECT, f08c47fec0942fa0\n`);
  });
  // Confirmaciones firmadas del proveedor de anuncios (servidor a servidor, sin cookie).
  app.use('/api/ads/callback', adsCallbackRoute(ctx));
  app.use('/api', csrfGuard(config.allowedOrigins, (req, why) => security.record('csrf_blocked', { ip: clientIp(req), userId: req.user?.id ?? null, detail: why })));
  app.use('/api', (_req, res, next) => {
    res.setHeader('Cache-Control', 'no-store');
    next();
  });

  app.use('/api', publicRoutes(ctx));
  app.use('/api/auth', authRoutes(ctx));
  app.use('/api/me/formations', formationRoutes(ctx));
  app.use('/api/me', meRoutes(ctx));
  app.use('/api/games', gameRoutes(ctx));
  // Panel: las rutas de 2FA van antes de la puerta 2FA; todo lo demás, detrás.
  app.use('/api/admin', adminMfaRoutes(ctx));
  app.use('/api/admin', requireAdmin, mfa.gate());
  app.use('/api/admin', adminPanelRoutes(ctx));
  app.use('/api/admin', adminRoutes(ctx));
  app.use('/api/ads', adsRoutes(ctx));
  app.use('/api/social', socialRoutes(ctx));
  app.use('/api/rooms', roomRoutes(ctx));
  app.use('/api/avatars', avatarRoutes(ctx));
  app.use('/api', profileRoutes(ctx));
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
  activity.start();
  const dailyPurge = setInterval(() => {
    security.purgeOld();
    activity.purgeOld();
  }, 24 * 3600_000);
  dailyPurge.unref();
  if (config.monitoring) {
    health.start();
    depAudit.schedule();
    ledgerWatch.schedule();
    alerts.startHeartbeat();
    void alerts.notify('start', 'info', `Servidor arrancado (${config.NODE_ENV}). Si no lo has reiniciado tú, ha habido un corte o un fallo y se ha recuperado solo.`, 0);
  }

  return {
    ctx,
    app,
    server,
    async close() {
      clearInterval(sessionSweep);
      clearInterval(dailyPurge);
      offOutcome();
      offErrors();
      health.stop();
      depAudit.stop();
      ledgerWatch.stop();
      alerts.stop();
      activity.stop();
      rooms.shutdown();
      crash.shutdown();
      bingo.shutdown();
      poker.shutdown();
      blackjack.shutdown();
      realtime.close();
      await new Promise<void>((resolve) => server.close(() => resolve()));
      database.close();
    },
  };
}
