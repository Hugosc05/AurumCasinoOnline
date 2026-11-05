import { Router, type Request } from 'express';
import { z } from 'zod';
import type { AppContext } from '../context';
import { nowIso } from '../db/database';
import { getSetting, setSetting } from '../db/seed';
import { AppError } from '../lib/errors';
import { clientIp, parse, requireAdmin } from '../lib/http';
import { verifyPassword } from '../auth/password';
import { destroyUserSessions } from '../auth/sessions';
import { SECURITY_LABEL, type SecurityKind } from '../admin/security';
import { runChecks } from '../admin/checks';
import { activityReport } from '../admin/insights';

const audit = (ctx: AppContext, req: Request, action: string, target: string | null, details: unknown): void => {
  ctx.db.run(
    'INSERT INTO audit_log (actor_id, action, target, details_json, ip, created_at) VALUES (?, ?, ?, ?, ?, ?)',
    req.user!.id, action, target, JSON.stringify(details ?? null), clientIp(req), nowIso(),
  );
};

/* ---------------------------------------------------------------------------
 * Verificación en dos pasos. Estas rutas quedan FUERA de la puerta 2FA (hacen
 * falta para configurarla o superarla), pero exigen sesión de administrador.
 * ------------------------------------------------------------------------- */
export function adminMfaRoutes(ctx: AppContext): Router {
  const r = Router();
  const { mfa } = ctx;
  r.use('/mfa', requireAdmin);

  r.get('/mfa', (req, res) => {
    res.json(mfa.status(req.user!.id, req.sessionToken));
  });

  const passwordBody = z.object({ password: z.string().min(1).max(128) }).strict();
  const codeBody = z.object({ code: z.string().trim().min(6).max(20) }).strict();

  /** Pide la contraseña otra vez: una sesión robada no basta para activar o quitar la 2FA. */
  const recheck = async (req: Request, password: string): Promise<void> => {
    if (!(await verifyPassword(password, req.user!.password_hash))) {
      ctx.security.record('login_failed', { ip: clientIp(req), userId: req.user!.id, detail: 'contraseña al gestionar 2FA' });
      throw new AppError(400, 'INVALID_PASSWORD', 'Contraseña incorrecta');
    }
  };

  r.post('/mfa/setup', async (req, res) => {
    const body = parse(passwordBody, req.body);
    await recheck(req, body.password);
    res.json(await mfa.begin(req.user!.id, req.user!.username));
  });

  r.post('/mfa/enable', (req, res) => {
    const body = parse(codeBody, req.body);
    const recoveryCodes = mfa.enable(req.user!.id, body.code, req.sessionToken, clientIp(req));
    audit(ctx, req, 'mfa.enable', req.user!.id, null);
    res.json({ ok: true, recoveryCodes });
  });

  r.post('/mfa/verify', (req, res) => {
    const body = parse(codeBody, req.body);
    const out = mfa.verify(req.user!.id, req.user!.username, body.code, req.sessionToken, clientIp(req));
    res.json({ ok: true, ...out, recoveryLeft: mfa.status(req.user!.id, req.sessionToken).recoveryLeft });
  });

  r.post('/mfa/disable', async (req, res) => {
    const body = parse(z.object({ password: z.string().min(1).max(128), code: z.string().trim().min(6).max(20) }).strict(), req.body);
    await recheck(req, body.password);
    mfa.verify(req.user!.id, req.user!.username, body.code, req.sessionToken, clientIp(req));
    mfa.disable(req.user!.id, req.user!.username, clientIp(req));
    audit(ctx, req, 'mfa.disable', req.user!.id, null);
    res.json({ ok: true });
  });

  return r;
}

/* ---------------------------------------------------------------------------
 * Panel ampliado (ya detrás de requireAdmin + puerta 2FA, que monta app.ts).
 * ------------------------------------------------------------------------- */
export function adminPanelRoutes(ctx: AppContext): Router {
  const r = Router();
  const { db } = ctx;

  /* ------------------------------ En directo ------------------------------ */
  r.get('/live', (_req, res) => {
    const now = Date.now();
    const clients = ctx.realtime.liveClients();
    const byUser = new Map<string, typeof clients[number][]>();
    const guests: typeof clients[number][] = [];
    for (const c of clients) {
      if (c.userId) byUser.set(c.userId, [...(byUser.get(c.userId) ?? []), c]);
      else guests.push(c);
    }
    const ids = [...byUser.keys()];
    const info = ids.length
      ? db.all<{ id: string; balance: number; role: string; created_at: string; status: string }>(
          `SELECT id, balance, role, created_at, status FROM users WHERE id IN (${ids.map(() => '?').join(',')})`, ...ids)
      : [];
    const infoById = new Map(info.map((u) => [u.id, u]));
    const seat = (userId: string): string | null => {
      for (const t of ctx.poker.tables.values()) if (t.hasUser(userId)) return `Póker · ${t.cfg.name}`;
      const bj = ctx.blackjack.seatedTable(userId);
      return bj ? `Blackjack · ${bj}` : null;
    };
    const users = [...byUser.entries()].map(([id, conns]) => {
      const latest = [...conns].sort((a, b) => b.pathSince - a.pathSince)[0]!;
      const u = infoById.get(id);
      return {
        userId: id,
        username: latest.username,
        role: latest.role,
        balance: u?.role === 'admin' ? null : Number(u?.balance ?? 0),
        newAccount: u ? now - Date.parse(u.created_at) < 24 * 3600_000 : false,
        path: latest.path,
        pathSinceSec: Math.round((now - latest.pathSince) / 1000),
        connectedSec: Math.round((now - Math.min(...conns.map((c) => c.connectedAt))) / 1000),
        tabs: conns.length,
        seat: seat(id),
        ip: latest.ip,
        device: describeUa(latest.ua),
      };
    }).sort((a, b) => b.connectedSec - a.connectedSec);
    // IP compartidas por varias cuentas conectadas a la vez (posibles multicuentas).
    const ipCount = new Map<string, Set<string>>();
    for (const u of users) if (u.ip) ipCount.set(u.ip, new Set([...(ipCount.get(u.ip) ?? []), u.username ?? '?']));
    const sharedIps = [...ipCount.entries()].filter(([, names]) => names.size > 1).map(([ip, names]) => ({ ip, users: [...names] }));
    const sections = new Map<string, number>();
    for (const c of clients) {
      const p = c.path ?? '(cargando)';
      sections.set(p, (sections.get(p) ?? 0) + 1);
    }
    res.json({
      online: users.length,
      guests: guests.length,
      connections: clients.length,
      users,
      guestsList: guests.slice(0, 50).map((g) => ({ path: g.path, connectedSec: Math.round((now - g.connectedAt) / 1000), ip: g.ip, device: describeUa(g.ua) })),
      sections: [...sections.entries()].map(([path, n]) => ({ path, n })).sort((a, b) => b.n - a.n),
      sharedIps,
    });
  });

  /** Echa a alguien ahora: cierra sus sesiones y sus conexiones (puede volver a entrar). */
  r.post('/live/:userId/kick', (req, res) => {
    const id = z.string().uuid().parse(req.params.userId);
    const u = db.get<{ username: string; role: string }>('SELECT username, role FROM users WHERE id = ?', id);
    if (!u) throw new AppError(404, 'NOT_FOUND', 'Usuario no encontrado');
    if (id === req.user!.id) throw new AppError(400, 'SELF', 'No puedes expulsarte a ti mismo');
    destroyUserSessions(db, id);
    ctx.realtime.disconnectUser(id);
    ctx.security.record('user_kicked', { ip: clientIp(req), userId: id, detail: `${u.username} por ${req.user!.username}` });
    audit(ctx, req, 'user.kick', id, { username: u.username });
    res.json({ ok: true });
  });

  /* ------------------------------- Seguridad ------------------------------ */
  const checks = () => runChecks({ config: ctx.config, db, health: ctx.health, audit: ctx.depAudit, ledger: ctx.ledgerWatch, alerts: ctx.alerts, mfaRequired: ctx.mfa.required });

  r.get('/security', (_req, res) => {
    const since = new Date(Date.now() - 24 * 3600_000).toISOString();
    const since7 = new Date(Date.now() - 7 * 24 * 3600_000).toISOString();
    const counts = db.all<{ kind: SecurityKind; n: number }>('SELECT kind, COUNT(*) AS n FROM security_events WHERE created_at >= ? GROUP BY kind', since)
      .map((c) => ({ kind: c.kind, label: SECURITY_LABEL[c.kind] ?? c.kind, n: Number(c.n) }));
    const topIps = db.all<{ ip: string; n: number; kinds: string }>(
      `SELECT ip, COUNT(*) AS n, MIN(kind) AS kinds FROM security_events WHERE ip IS NOT NULL AND severity <> 'info' AND created_at >= ?
       GROUP BY ip ORDER BY COUNT(*) DESC LIMIT 10`, since7,
    ).map((x) => ({ ip: x.ip, n: Number(x.n), kind: SECURITY_LABEL[x.kinds as SecurityKind] ?? x.kinds }));
    const multi = db.all<{ ip: string; n: number; names: string }>(
      db.dialect === 'postgres'
        ? `SELECT s.ip, COUNT(DISTINCT s.user_id) AS n, string_agg(DISTINCT u.username, ', ') AS names FROM sessions s JOIN users u ON u.id = s.user_id
           WHERE s.ip IS NOT NULL AND s.last_seen_at >= ? GROUP BY s.ip HAVING COUNT(DISTINCT s.user_id) >= 3 ORDER BY COUNT(DISTINCT s.user_id) DESC LIMIT 10`
        : `SELECT s.ip, COUNT(DISTINCT s.user_id) AS n, group_concat(DISTINCT u.username) AS names FROM sessions s JOIN users u ON u.id = s.user_id
           WHERE s.ip IS NOT NULL AND s.last_seen_at >= ? GROUP BY s.ip HAVING COUNT(DISTINCT s.user_id) >= 3 ORDER BY COUNT(DISTINCT s.user_id) DESC LIMIT 10`,
      since7,
    ).map((m) => ({ ip: m.ip, accounts: Number(m.n), names: String(m.names ?? '').split(',').map((x) => x.trim()).filter(Boolean) }));
    res.json({
      checks: checks(),
      counts,
      topIps,
      multiAccounts: multi,
      audit: ctx.depAudit.result,
      auditRunning: ctx.depAudit.running,
      auditError: ctx.depAudit.lastError,
      ledger: ctx.ledgerWatch.last,
      suppressed: ctx.security.stats().suppressed,
    });
  });

  r.get('/security/events', (req, res) => {
    const q = parse(z.object({
      page: z.coerce.number().int().min(1).max(10_000).default(1),
      severity: z.enum(['info', 'warn', 'high']).optional(),
      ip: z.string().max(64).optional(),
    }), req.query);
    const where: string[] = [];
    const params: string[] = [];
    if (q.severity) {
      where.push('e.severity = ?');
      params.push(q.severity);
    }
    if (q.ip) {
      where.push('e.ip = ?');
      params.push(q.ip);
    }
    const items = db.all<{ id: number; kind: SecurityKind; severity: string; ip: string | null; detail: string | null; createdAt: string; username: string | null }>(
      `SELECT e.id, e.kind, e.severity, e.ip, e.detail, e.created_at AS createdAt, u.username FROM security_events e LEFT JOIN users u ON u.id = e.user_id
       ${where.length ? `WHERE ${where.join(' AND ')}` : ''} ORDER BY e.id DESC LIMIT 50 OFFSET ?`,
      ...params, (q.page - 1) * 50,
    ).map((e) => ({ ...e, label: SECURITY_LABEL[e.kind] ?? e.kind }));
    res.json({ items });
  });

  r.post('/security/audit', async (req, res) => {
    audit(ctx, req, 'security.audit', null, null);
    await ctx.depAudit.run();
    res.json({ audit: ctx.depAudit.result, error: ctx.depAudit.lastError });
  });

  r.post('/security/ledger', (req, res) => {
    const out = ctx.ledgerWatch.run();
    audit(ctx, req, 'diagnostics.ledger', null, { checked: out.checked, problems: out.problems.length });
    res.json(out);
  });

  /* -------------------------------- Avisos -------------------------------- */
  r.get('/alerts', (_req, res) => {
    res.json({ ...ctx.alerts.status(), bigWin: getSetting(db, 'alertBigWin') });
  });

  r.put('/alerts/telegram', (req, res) => {
    const body = parse(z.object({ botToken: z.string().trim().regex(/^\d{5,15}:[A-Za-z0-9_-]{30,60}$/, 'Token de bot no válido (formato 123456:ABC…)'), chatId: z.string().trim().regex(/^-?\d{3,20}$/, 'Chat no válido') }).strict(), req.body);
    ctx.secrets.set('telegram', body);
    ctx.security.record('secret_changed', { ip: clientIp(req), userId: req.user!.id, detail: 'Telegram' });
    audit(ctx, req, 'alerts.telegram', null, { chatId: body.chatId });
    res.json({ ok: true });
  });

  r.delete('/alerts/telegram', (req, res) => {
    ctx.secrets.delete('telegram');
    audit(ctx, req, 'alerts.telegram.delete', null, null);
    res.json({ ok: true });
  });

  /** Lee el último mensaje que ha recibido el bot para saber a qué chat escribir. */
  r.post('/alerts/telegram/detect', async (req, res) => {
    const body = parse(z.object({ botToken: z.string().trim().min(20).max(80) }).strict(), req.body);
    try {
      const chat = await ctx.alerts.detectChat(body.botToken);
      if (!chat) throw new AppError(404, 'NO_CHAT', 'El bot aún no ha recibido mensajes. Abre tu bot en Telegram, pulsa «Iniciar» y vuelve a probar.');
      res.json(chat);
    } catch (err) {
      if (err instanceof AppError) throw err;
      throw new AppError(400, 'TELEGRAM', `Telegram: ${(err as Error).message}`);
    }
  });

  r.post('/alerts/test', async (req, res) => {
    const tg = ctx.alerts.telegram();
    if (!tg) throw new AppError(400, 'NOT_CONFIGURED', 'Primero configura Telegram');
    const ok = await ctx.alerts.sendTelegram(tg, `✅ <b>Aurum</b>\nPrueba de avisos enviada por ${escapeHtml(req.user!.username)}. Si lees esto, funciona.`);
    if (!ok) throw new AppError(502, 'TELEGRAM', ctx.alerts.status().lastError ?? 'No se pudo enviar');
    res.json({ ok: true });
  });

  r.put('/alerts/heartbeat', (req, res) => {
    const body = parse(z.object({ url: z.string().trim().url().max(300).refine((u) => u.startsWith('https://'), 'Debe empezar por https://').or(z.literal('')) }).strict(), req.body);
    if (body.url) ctx.secrets.set('heartbeat', { url: body.url });
    else ctx.secrets.delete('heartbeat');
    audit(ctx, req, 'alerts.heartbeat', null, { set: !!body.url });
    res.json({ ok: true });
  });

  r.put('/alerts/big-win', (req, res) => {
    const body = parse(z.object({ amount: z.number().int().min(0).max(1_000_000_000) }).strict(), req.body);
    setSetting(db, 'alertBigWin', body.amount);
    audit(ctx, req, 'alerts.bigwin', null, body);
    res.json({ ok: true });
  });

  /* -------------------------------- Servidor ------------------------------ */
  r.get('/server', (_req, res) => {
    res.json(ctx.health.snapshot());
  });

  /* ------------------------------- Actividad ------------------------------ */
  r.get('/activity', (req, res) => {
    const q = parse(z.object({ days: z.coerce.number().int().min(7).max(180).default(30) }), req.query);
    ctx.activity.flush();
    res.json(activityReport(db, getSetting(db, 'dailyTimezone'), q.days));
  });

  /* ------------------------------- Ingresos ------------------------------- */
  r.get('/revenue', async (req, res) => {
    const force = req.query.refresh === '1';
    const status = ctx.adsense.status();
    const display = getSetting(db, 'adsDisplay');
    let report = null;
    let error: string | null = null;
    if (status.connected) {
      try {
        report = await ctx.adsense.report(force);
      } catch (err) {
        error = (err as Error).message;
      }
    }
    res.json({ adsense: { ...ctx.adsense.status(), redirectUri: redirectUri(req) }, display, report, error });
  });

  r.put('/revenue/client', (req, res) => {
    const body = parse(z.object({
      clientId: z.string().trim().regex(/^[\w.-]+\.apps\.googleusercontent\.com$/, 'El ID termina en .apps.googleusercontent.com'),
      clientSecret: z.string().trim().max(200),
    }).strict(), req.body);
    if (!body.clientSecret && !ctx.adsense.status().configured) throw new AppError(400, 'VALIDATION_ERROR', 'Falta el secreto del cliente');
    ctx.adsense.saveClient(body.clientId, body.clientSecret);
    ctx.security.record('secret_changed', { ip: clientIp(req), userId: req.user!.id, detail: 'AdSense' });
    audit(ctx, req, 'adsense.client', null, { clientId: body.clientId });
    res.json({ ok: true });
  });

  r.post('/revenue/connect', (req, res) => {
    res.json({ url: ctx.adsense.authUrl(redirectUri(req)) });
  });

  r.delete('/revenue/connection', (req, res) => {
    ctx.adsense.disconnect();
    audit(ctx, req, 'adsense.disconnect', null, null);
    res.json({ ok: true });
  });

  r.put('/revenue/display', (req, res) => {
    const body = parse(z.object({
      enabled: z.boolean(),
      publisherId: z.string().trim().regex(/^(ca-pub-\d{10,20})?$/, 'Formato: ca-pub-1234567890123456'),
      slots: z.object({ home: slotId, lobby: slotId, rewards: slotId }).strict(),
    }).strict(), req.body);
    if (body.enabled && !body.publisherId) throw new AppError(400, 'VALIDATION_ERROR', 'Para activar los anuncios hace falta el ID de editor (ca-pub-…)');
    setSetting(db, 'adsDisplay', body);
    audit(ctx, req, 'ads.display', null, body);
    res.json({ ok: true });
  });

  return r;
}

const slotId = z.string().trim().regex(/^(\d{6,20})?$/, 'El id de bloque son solo números');

/** Dirección de vuelta de Google: la misma que ve el navegador (https://… a través del túnel). */
function redirectUri(req: Request): string {
  return `${req.protocol}://${req.get('host')}/api/adsense/callback`;
}

/** Ruta pública de vuelta de Google (sin cookie: la protege el `state`). */
export function adsenseCallbackRoute(ctx: AppContext): Router {
  const r = Router();
  r.get('/', async (req, res) => {
    const q = z.object({ state: z.string().max(200).optional(), code: z.string().max(2000).optional(), error: z.string().max(200).optional() }).safeParse(req.query);
    const go = (status: string): void => res.redirect(302, `/admin/ingresos?adsense=${status}`);
    if (!q.success || q.data.error || !q.data.state || !q.data.code) return go(q.success && q.data.error === 'access_denied' ? 'denied' : 'error');
    try {
      await ctx.adsense.callback(q.data.state, q.data.code);
      go('ok');
    } catch {
      go('error');
    }
  });
  return r;
}

const escapeHtml = (s: string): string => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/** Resumen legible del navegador y dispositivo (sin librerías). */
export function describeUa(ua: string | null): string {
  if (!ua) return 'Desconocido';
  const os = /iPhone|iPad/.test(ua) ? 'iOS' : /Android/.test(ua) ? 'Android' : /Windows/.test(ua) ? 'Windows' : /Mac OS X/.test(ua) ? 'macOS' : /Linux/.test(ua) ? 'Linux' : 'Otro';
  const browser = /Edg\//.test(ua) ? 'Edge' : /OPR\//.test(ua) ? 'Opera' : /SamsungBrowser/.test(ua) ? 'Samsung' : /Firefox\//.test(ua) ? 'Firefox' : /Chrome\//.test(ua) ? 'Chrome' : /Safari\//.test(ua) ? 'Safari' : /bot|crawl|spider/i.test(ua) ? 'Bot' : 'Otro';
  const mobile = /Mobile|iPhone|Android/.test(ua);
  return `${browser} · ${os}${mobile ? ' · móvil' : ''}`;
}
