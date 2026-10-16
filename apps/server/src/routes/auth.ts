import { randomUUID } from 'node:crypto';
import { Router, type CookieOptions, type Response } from 'express';
import { z } from 'zod';
import type { AppContext } from '../context';
import { nowIso } from '../db/database';
import { AppError, conflict } from '../lib/errors';
import { clientIp, parse, requireAuth } from '../lib/http';
import { logger } from '../lib/logger';
import { RateLimiter, rateLimit } from '../lib/rateLimit';
import { credit } from '../wallet/wallet';
import { getDummyHash, hashPassword, verifyPassword } from '../auth/password';
import { SESSION_COOKIE, createSession, destroySession, type UserRow } from '../auth/sessions';
import { RESERVED_BOT_NAMES } from '../bots/catalog';
import { getSetting } from '../db/seed';
import { emailSchema, passwordSchema, toPublicUser, usernameSchema } from '../auth/users';

const registerSchema = z.object({
  username: usernameSchema,
  email: emailSchema,
  password: passwordSchema,
});

const loginSchema = z.object({
  identifier: z.string().trim().min(1, 'Obligatorio').max(254),
  password: z.string().min(1, 'Obligatorio').max(128),
});

export function authRoutes(ctx: AppContext): Router {
  const r = Router();
  const { db, config } = ctx;

  const ipLoginLimiter = new RateLimiter(config.LOGIN_LIMIT_PER_15MIN, 15 * 60_000);
  const failedByIdentifier = new RateLimiter(5, 15 * 60_000);
  const registerLimiter = new RateLimiter(config.REGISTER_LIMIT_PER_HOUR, 60 * 60_000);

  const cookieOpts: CookieOptions = {
    httpOnly: true,
    sameSite: 'strict',
    secure: config.cookieSecure,
    path: '/',
    maxAge: config.SESSION_TTL_HOURS * 3600_000,
  };
  const setSessionCookie = (res: Response, token: string): void => {
    res.cookie(SESSION_COOKIE, token, cookieOpts);
  };

  r.post(
    '/register',
    rateLimit(registerLimiter, (req) => clientIp(req), 'Demasiados registros desde esta conexión. Inténtalo más tarde.'),
    async (req, res) => {
      const body = parse(registerSchema, req.body);
      const taken = db.get<{ username: string; email: string }>(
        'SELECT username, email FROM users WHERE username = ? OR email = ?',
        body.username, body.email,
      );
      const isBotName = RESERVED_BOT_NAMES.has(body.username.toLowerCase())
        || !!db.get('SELECT 1 AS x FROM bots WHERE lower(name) = lower(?)', body.username);
      if (isBotName) {
        throw new AppError(409, 'ALREADY_EXISTS', 'Nombre reservado', { fields: { username: 'Este nombre pertenece a un bot de demostración' } });
      }
      if (taken) {
        const fields: Record<string, string> = {};
        if (taken.username.toLowerCase() === body.username.toLowerCase()) fields.username = 'Este nombre de usuario ya existe';
        if (taken.email.toLowerCase() === body.email.toLowerCase()) fields.email = 'Este correo ya está registrado';
        throw new AppError(409, 'ALREADY_EXISTS', 'La cuenta ya existe', { fields });
      }
      const hash = await hashPassword(body.password);
      const id = randomUUID();
      // Saldo inicial configurable por el administrador; se concede una única vez, al crear la cuenta.
      const startBalance = getSetting(db, 'startingBalance') ?? config.STARTING_BALANCE;
      try {
        db.tx(() => {
          db.run(
            `INSERT INTO users (id, username, email, password_hash, role, balance, created_at) VALUES (?, ?, ?, ?, 'player', 0, ?)`,
            id, body.username, body.email, hash, nowIso(),
          );
          if (startBalance > 0) credit(db, id, startBalance, 'signup_bonus');
        });
      } catch (err) {
        if (String(err).includes('UNIQUE')) throw conflict('ALREADY_EXISTS', 'La cuenta ya existe');
        throw err;
      }
      const token = createSession(db, id, config.SESSION_TTL_HOURS, clientIp(req), req.get('user-agent') ?? null);
      setSessionCookie(res, token);
      const user = db.get<UserRow>('SELECT * FROM users WHERE id = ?', id)!;
      logger.info('Usuario registrado', { userId: id });
      res.status(201).json({ user: toPublicUser(user) });
    },
  );

  r.post('/login', async (req, res) => {
    const ip = clientIp(req);
    const ipWait = ipLoginLimiter.hit(ip);
    if (ipWait > 0) throw new AppError(429, 'RATE_LIMITED', 'Demasiados intentos. Espera unos minutos.', { retryAfterSec: ipWait });
    const body = parse(loginSchema, req.body);
    const key = body.identifier.toLowerCase();
    const lockWait = failedByIdentifier.blocked(key);
    if (lockWait > 0) {
      throw new AppError(429, 'ACCOUNT_LOCKED', 'Cuenta bloqueada temporalmente por intentos fallidos.', { retryAfterSec: lockWait });
    }
    const user = db.get<UserRow>('SELECT * FROM users WHERE username = ? OR email = ?', body.identifier, body.identifier.toLowerCase());
    const ok = user ? await verifyPassword(body.password, user.password_hash) : (await verifyPassword(body.password, await getDummyHash()), false);
    if (!user || !ok) {
      failedByIdentifier.hit(key);
      throw new AppError(401, 'INVALID_CREDENTIALS', 'Usuario o contraseña incorrectos');
    }
    if (user.status !== 'active') throw new AppError(403, 'ACCOUNT_DISABLED', 'Esta cuenta está suspendida');
    failedByIdentifier.reset(key);
    db.run('UPDATE users SET last_login_at = ? WHERE id = ?', nowIso(), user.id);
    // Rotación: cada inicio de sesión genera un token nuevo.
    destroySession(db, req.cookies?.[SESSION_COOKIE]);
    const token = createSession(db, user.id, config.SESSION_TTL_HOURS, ip, req.get('user-agent') ?? null);
    setSessionCookie(res, token);
    res.json({ user: toPublicUser(user) });
  });

  r.post('/logout', (req, res) => {
    destroySession(db, req.cookies?.[SESSION_COOKIE]);
    res.clearCookie(SESSION_COOKIE, { ...cookieOpts, maxAge: undefined });
    res.json({ ok: true });
  });

  r.get('/me', (req, res) => {
    res.json({ user: req.user ? toPublicUser(req.user) : null });
  });

  r.get('/session', requireAuth, (req, res) => {
    res.json({ user: toPublicUser(req.user!) });
  });

  return r;
}
