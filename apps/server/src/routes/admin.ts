import { statSync } from 'node:fs';
import { Router, type Request } from 'express';
import { z } from 'zod';
import { isValidTimezone } from '../economy/period';
import type { AppContext } from '../context';
import { nowIso } from '../db/database';
import { DEFAULT_SETTINGS, getSetting, setSetting } from '../db/seed';
import { AppError, notFound } from '../lib/errors';
import { clientIp, parse, requireAdmin } from '../lib/http';
import { applyWalletMove, getBalance, verifyLedger } from '../wallet/wallet';
import { destroyUserSessions } from '../auth/sessions';

const pageQuery = z.object({
  page: z.coerce.number().int().min(1).max(100_000).default(1),
  pageSize: z.coerce.number().int().min(1).max(200).default(25),
  q: z.string().trim().max(100).optional(),
  game: z.enum(['blackjack', 'roulette', 'slots', 'poker', 'bingo', 'crash', 'plinko']).optional(),
  userId: z.string().uuid().optional(),
});

export function adminRoutes(ctx: AppContext): Router {
  const r = Router();
  const { db } = ctx;
  r.use(requireAdmin);

  const audit = (req: Request, action: string, target: string | null, details: unknown): void => {
    db.run(
      'INSERT INTO audit_log (actor_id, action, target, details_json, ip, created_at) VALUES (?, ?, ?, ?, ?, ?)',
      req.user!.id, action, target, JSON.stringify(details ?? null), clientIp(req), nowIso(),
    );
  };

  /* ------------------------------- Resumen -------------------------------- */
  r.get('/overview', (_req, res) => {
    const since = new Date(Date.now() - 24 * 3600_000).toISOString();
    const users = db.get<Record<string, number>>(
      `SELECT COUNT(*) AS total,
              SUM(CASE WHEN role = 'admin' THEN 1 ELSE 0 END) AS admins,
              SUM(CASE WHEN status = 'banned' THEN 1 ELSE 0 END) AS banned,
              SUM(CASE WHEN created_at >= ? THEN 1 ELSE 0 END) AS new24h,
              SUM(CASE WHEN last_login_at >= ? THEN 1 ELSE 0 END) AS active24h
       FROM users`,
      since, since,
    );
    const games = db.all<Record<string, number | string>>(
      `SELECT game, COUNT(*) AS rounds, SUM(bet_total) AS totalBet, SUM(payout) AS totalPayout,
              SUM(CASE WHEN created_at >= ? THEN 1 ELSE 0 END) AS rounds24h
       FROM game_rounds WHERE status = 'settled' GROUP BY game`,
      since,
    );
    const openRounds = db.get<{ n: number }>(`SELECT COUNT(*) AS n FROM game_rounds WHERE status = 'open'`)!.n;
    const errors24h = db.get<{ n: number }>('SELECT COUNT(*) AS n FROM error_logs WHERE created_at >= ?', since)!.n;
    const circulating = db.get<{ s: number }>(`SELECT COALESCE(SUM(balance), 0) AS s FROM users WHERE role = 'player'`)!.s;
    const daily = db.all<{ day: string; rounds: number; bet: number; payout: number }>(
      `SELECT substr(created_at, 1, 10) AS day, COUNT(*) AS rounds, SUM(bet_total) AS bet, SUM(payout) AS payout
       FROM game_rounds WHERE status = 'settled' AND created_at >= ? GROUP BY day ORDER BY day`,
      new Date(Date.now() - 14 * 24 * 3600_000).toISOString(),
    );
    res.json({
      users,
      games,
      daily,
      openRounds,
      errors24h,
      circulating,
      online: ctx.realtime.onlineCount(),
      connections: ctx.realtime.connectionCount(),
      tables: ctx.poker.lobby(),
    });
  });

  /* ------------------------------- Usuarios ------------------------------- */
  r.get('/users', (req, res) => {
    const q = parse(pageQuery, req.query);
    const like = q.q ? `%${q.q.replace(/[%_]/g, '')}%` : '%';
    const total = db.get<{ n: number }>('SELECT COUNT(*) AS n FROM users WHERE username LIKE ? OR email LIKE ?', like, like)!.n;
    const items = db.all(
      `SELECT u.id, u.username, u.email, u.role, u.status, u.balance, u.created_at AS createdAt, u.last_login_at AS lastLoginAt,
              COALESCE(s.rounds, 0) AS rounds, COALESCE(s.total_payout - s.total_bet, 0) AS net
       FROM users u LEFT JOIN user_stats s ON s.user_id = u.id
       WHERE u.username LIKE ? OR u.email LIKE ?
       ORDER BY u.created_at DESC LIMIT ? OFFSET ?`,
      like, like, q.pageSize, (q.page - 1) * q.pageSize,
    );
    res.json({ items, total, page: q.page, pageSize: q.pageSize });
  });

  r.get('/users/:id', (req, res) => {
    const id = z.string().uuid().parse(req.params.id);
    const user = db.get<Record<string, unknown>>(
      `SELECT id, username, email, role, status, balance, created_at AS createdAt, last_login_at AS lastLoginAt FROM users WHERE id = ?`,
      id,
    );
    if (!user) throw notFound('Usuario no encontrado');
    const stats = db.get('SELECT * FROM user_stats WHERE user_id = ?', id) ?? null;
    const transactions = db.all(
      `SELECT id, amount, balance_before AS balanceBefore, balance_after AS balanceAfter, reason, round_id AS roundId, unlimited, meta_json AS meta, created_at AS createdAt
       FROM wallet_transactions WHERE user_id = ? ORDER BY id DESC LIMIT 50`,
      id,
    );
    const rounds = db.all(
      `SELECT id, game, status, bet_total AS bet, payout, created_at AS createdAt FROM game_rounds WHERE user_id = ? ORDER BY created_at DESC LIMIT 30`,
      id,
    );
    res.json({ user, stats, transactions, rounds, ledger: verifyLedger(db, id) });
  });

  const statusSchema = z.object({ status: z.enum(['active', 'banned']) });
  r.patch('/users/:id', (req, res) => {
    const id = z.string().uuid().parse(req.params.id);
    const body = parse(statusSchema, req.body);
    const target = db.get<{ role: string }>('SELECT role FROM users WHERE id = ?', id);
    if (!target) throw notFound('Usuario no encontrado');
    // Los roles no se modifican por API: solo con la CLI protegida.
    if (target.role === 'admin') throw new AppError(403, 'FORBIDDEN', 'No se puede suspender a un administrador desde el panel');
    db.run('UPDATE users SET status = ? WHERE id = ?', body.status, id);
    if (body.status === 'banned') {
      destroyUserSessions(db, id);
      ctx.realtime.disconnectUser(id);
    }
    audit(req, 'user.status', id, body);
    res.json({ ok: true });
  });

  const adjustSchema = z.object({
    amount: z.number().int().refine((v) => v !== 0, 'No puede ser 0').refine((v) => Math.abs(v) <= 10_000_000, 'Demasiado grande'),
    reason: z.string().trim().min(3, 'Indica un motivo').max(200),
  });
  r.post('/users/:id/adjust', (req, res) => {
    const id = z.string().uuid().parse(req.params.id);
    const body = parse(adjustSchema, req.body);
    const move = applyWalletMove(db, id, body.amount, 'admin_adjustment', { meta: { by: req.user!.id, reason: body.reason } });
    audit(req, 'wallet.adjust', id, { amount: body.amount, reason: body.reason, before: move.balanceBefore, after: move.balanceAfter });
    ctx.realtime.sendToUser(id, { t: 'balance', ...getBalance(db, id) });
    res.json({ move });
  });

  /* ------------------------------- Partidas ------------------------------- */
  r.get('/rounds', (req, res) => {
    const q = parse(pageQuery, req.query);
    const cond: string[] = [];
    const params: string[] = [];
    if (q.game) {
      cond.push('r.game = ?');
      params.push(q.game);
    }
    if (q.userId) {
      cond.push('r.user_id = ?');
      params.push(q.userId);
    }
    const where = cond.length ? `WHERE ${cond.join(' AND ')}` : '';
    const total = db.get<{ n: number }>(`SELECT COUNT(*) AS n FROM game_rounds r ${where}`, ...params)!.n;
    const items = db.all(
      `SELECT r.id, r.game, r.status, r.bet_total AS bet, r.payout, r.created_at AS createdAt, r.settled_at AS settledAt,
              u.username, u.id AS userId, r.result_json AS result
       FROM game_rounds r JOIN users u ON u.id = r.user_id ${where}
       ORDER BY r.created_at DESC LIMIT ? OFFSET ?`,
      ...params, q.pageSize, (q.page - 1) * q.pageSize,
    );
    res.json({ items, total, page: q.page, pageSize: q.pageSize });
  });

  r.get('/poker-hands', (req, res) => {
    const q = parse(pageQuery, req.query);
    const items = db.all(
      `SELECT id, table_id AS tableId, started_at AS startedAt, ended_at AS endedAt, board_json AS board, pot, players_json AS players, winners_json AS winners
       FROM poker_hands ORDER BY ended_at DESC LIMIT ? OFFSET ?`,
      q.pageSize, (q.page - 1) * q.pageSize,
    );
    res.json({ items, page: q.page });
  });

  /* --------------------------------- Bots --------------------------------- */
  r.get('/bots', (_req, res) => {
    const items = db.all<Record<string, unknown> & { id: string }>(
      `SELECT id, name, profile, difficulty, enabled, bankroll, hands_played AS handsPlayed, net_result AS netResult,
              bj_strategy AS bjStrategy, bet_style AS betStyle, experience, bj_rounds AS bjRounds, bj_net AS bjNet FROM bots ORDER BY name`,
    ).map((b) => ({ ...b, seatedAt: ctx.bots.seatedAt(b.id) }));
    res.json({ items });
  });

  const botSchema = z.object({
    enabled: z.boolean().optional(),
    profile: z.enum(['conservative', 'aggressive', 'balanced', 'analytical']).optional(),
    difficulty: z.enum(['easy', 'normal', 'hard']).optional(),
  }).strict();
  r.patch('/bots/:id', (req, res) => {
    const id = z.string().uuid().parse(req.params.id);
    const body = parse(botSchema, req.body);
    const bot = db.get('SELECT id FROM bots WHERE id = ?', id);
    if (!bot) throw notFound('Bot no encontrado');
    if (body.enabled !== undefined) db.run('UPDATE bots SET enabled = ? WHERE id = ?', body.enabled ? 1 : 0, id);
    if (body.profile) db.run('UPDATE bots SET profile = ? WHERE id = ?', body.profile, id);
    if (body.difficulty) db.run('UPDATE bots SET difficulty = ? WHERE id = ?', body.difficulty, id);
    audit(req, 'bot.update', id, body);
    res.json({ ok: true, note: 'Los cambios se aplican cuando el bot vuelva a sentarse en una mesa.' });
  });

  /* -------------------------- Mesas de blackjack --------------------------- */
  r.get('/blackjack-tables', (_req, res) => {
    res.json({ items: db.all('SELECT * FROM blackjack_tables ORDER BY sort_order, name'), live: ctx.blackjack.diagnostics() });
  });

  const bjTableSchema = z.object({
    name: z.string().trim().min(3).max(40).optional(),
    minBet: z.number().int().min(1).max(100_000).optional(),
    maxBet: z.number().int().min(1).max(1_000_000).optional(),
    maxSeats: z.number().int().min(1).max(7).optional(),
    maxBots: z.number().int().min(0).max(6).optional(),
    targetPlayers: z.number().int().min(0).max(7).optional(),
    enabled: z.boolean().optional(),
  }).strict();
  r.patch('/blackjack-tables/:id', (req, res) => {
    const id = z.string().min(1).max(64).parse(req.params.id);
    const body = parse(bjTableSchema, req.body);
    const cur = db.get<Record<string, number | string>>('SELECT * FROM blackjack_tables WHERE id = ?', id);
    if (!cur) throw notFound('Mesa no encontrada');
    const next = {
      name: body.name ?? (cur.name as string),
      min: body.minBet ?? (cur.min_bet as number),
      max: body.maxBet ?? (cur.max_bet as number),
      seats: body.maxSeats ?? (cur.max_seats as number),
      bots: body.maxBots ?? (cur.max_bots as number),
      target: body.targetPlayers ?? (cur.target_players as number),
      enabled: body.enabled ?? cur.enabled === 1,
    };
    if (next.max < next.min) throw new AppError(400, 'INVALID_LIMITS', 'La apuesta máxima debe ser mayor o igual que la mínima');
    if (next.bots >= next.seats) throw new AppError(400, 'INVALID_BOTS', 'Debe quedar al menos un asiento libre para personas');
    const live = ctx.blackjack.get(id);
    // Las reglas no cambian a mitad de ronda: los límites nuevos se aplican en la siguiente apuesta.
    if (body.maxSeats !== undefined && body.maxSeats !== cur.max_seats && !live.isIdle()) {
      throw new AppError(409, 'ROUND_IN_PROGRESS', 'Cambia el número de asientos cuando la mesa esté en reposo');
    }
    db.run(
      'UPDATE blackjack_tables SET name = ?, min_bet = ?, max_bet = ?, max_seats = ?, max_bots = ?, target_players = ?, enabled = ? WHERE id = ?',
      next.name, next.min, next.max, next.seats, next.bots, next.target, next.enabled ? 1 : 0, id,
    );
    ctx.blackjack.reloadTables();
    audit(req, 'blackjack_table.update', id, body);
    res.json({ ok: true, note: 'Los límites se aplican desde la siguiente ronda de apuestas.' });
  });

  /* -------------------------------- Mesas --------------------------------- */
  r.get('/tables', (_req, res) => {
    res.json({ items: db.all('SELECT * FROM poker_tables ORDER BY sort_order, name'), live: ctx.poker.diagnostics() });
  });

  const tableSchema = z.object({
    name: z.string().trim().min(3).max(40).optional(),
    smallBlind: z.number().int().min(1).max(100_000).optional(),
    bigBlind: z.number().int().min(2).max(200_000).optional(),
    minBuyIn: z.number().int().min(1).optional(),
    maxBuyIn: z.number().int().min(1).optional(),
    maxSeats: z.number().int().min(2).max(9).optional(),
    maxBots: z.number().int().min(0).max(8).optional(),
    targetPlayers: z.number().int().min(2).max(9).optional(),
    enabled: z.boolean().optional(),
  }).strict();
  r.patch('/tables/:id', (req, res) => {
    const id = z.string().min(1).max(64).parse(req.params.id);
    const body = parse(tableSchema, req.body);
    const cur = db.get<Record<string, number | string>>('SELECT * FROM poker_tables WHERE id = ?', id);
    if (!cur) throw notFound('Mesa no encontrada');
    const next = {
      name: body.name ?? (cur.name as string),
      sb: body.smallBlind ?? (cur.small_blind as number),
      bb: body.bigBlind ?? (cur.big_blind as number),
      min: body.minBuyIn ?? (cur.min_buy_in as number),
      max: body.maxBuyIn ?? (cur.max_buy_in as number),
      seats: body.maxSeats ?? (cur.max_seats as number),
      bots: body.maxBots ?? (cur.max_bots as number),
      target: body.targetPlayers ?? (cur.target_players as number),
      enabled: body.enabled ?? cur.enabled === 1,
    };
    if (next.bb < next.sb) throw new AppError(400, 'INVALID_BLINDS', 'La ciega grande debe ser mayor o igual que la pequeña');
    if (next.min < next.bb * 10 || next.max < next.min) throw new AppError(400, 'INVALID_BUYIN', 'Entrada mínima ≥ 10 ciegas grandes y máxima ≥ mínima');
    if (next.bots >= next.seats) throw new AppError(400, 'INVALID_BOTS', 'Debe quedar al menos un asiento libre para humanos');
    const live = ctx.poker.get(id);
    if (body.maxSeats !== undefined && live.hand && !live.hand.result) {
      throw new AppError(409, 'HAND_IN_PROGRESS', 'Cambia el número de asientos cuando la mesa esté en reposo');
    }
    db.run(
      `UPDATE poker_tables SET name = ?, small_blind = ?, big_blind = ?, min_buy_in = ?, max_buy_in = ?, max_seats = ?, max_bots = ?, target_players = ?, enabled = ? WHERE id = ?`,
      next.name, next.sb, next.bb, next.min, next.max, next.seats, next.bots, next.target, next.enabled ? 1 : 0, id,
    );
    ctx.poker.reloadTables();
    audit(req, 'table.update', id, body);
    res.json({ ok: true, note: 'Ciegas y límites se aplican desde la siguiente mano.' });
  });

  /* ------------------------------- Ajustes -------------------------------- */
  r.get('/settings', (_req, res) => {
    const out: Record<string, unknown> = {};
    for (const key of Object.keys(DEFAULT_SETTINGS) as (keyof typeof DEFAULT_SETTINGS)[]) out[key] = getSetting(db, key);
    res.json({ settings: out });
  });

  const settingsSchema = z.object({
    gamesEnabled: z.object({ blackjack: z.boolean(), roulette: z.boolean(), slots: z.boolean(), poker: z.boolean(), bingo: z.boolean(), crash: z.boolean(), plinko: z.boolean() }).partial().optional(),
    dailyBonus: z.number().int().min(0).max(1_000_000).optional(),
    demoRefillAmount: z.number().int().min(0).max(1_000_000).optional(),
    demoRefillThreshold: z.number().int().min(0).max(1_000_000).optional(),
    startingBalance: z.number().int().min(0).max(10_000_000).nullable().optional(),
    dailyTimezone: z.string().max(64).refine(isValidTimezone, 'Zona horaria no válida').optional(),
    dailyStreakEnabled: z.boolean().optional(),
    dailyStreakStep: z.number().int().min(0).max(100_000).optional(),
    dailyStreakMaxSteps: z.number().int().min(0).max(30).optional(),
    adsRewardAmount: z.number().int().min(0).max(100_000).optional(),
    adsDailyLimit: z.number().int().min(0).max(100).optional(),
    adsMinWatchSeconds: z.number().int().min(5).max(120).optional(),
    maintenanceMessage: z.string().max(300).optional(),
  }).strict();
  r.patch('/settings', (req, res) => {
    const body = parse(settingsSchema, req.body);
    for (const [k, v] of Object.entries(body)) {
      // gamesEnabled se fusiona: se pueden activar o desactivar juegos sueltos.
      const value = k === 'gamesEnabled' ? { ...getSetting(db, 'gamesEnabled'), ...(v as object) } : v;
      setSetting(db, k as keyof typeof DEFAULT_SETTINGS, value as never);
    }
    audit(req, 'settings.update', null, body);
    res.json({ ok: true });
  });

  /* ---------------------------- Diagnóstico ------------------------------- */
  r.get('/errors', (req, res) => {
    const q = parse(pageQuery, req.query);
    res.json({
      items: db.all(
        'SELECT id, level, message, stack, context_json AS context, created_at AS createdAt FROM error_logs ORDER BY id DESC LIMIT ? OFFSET ?',
        q.pageSize, (q.page - 1) * q.pageSize,
      ),
    });
  });

  r.get('/audit', (req, res) => {
    const q = parse(pageQuery, req.query);
    res.json({
      items: db.all(
        `SELECT a.id, a.action, a.target, a.details_json AS details, a.ip, a.created_at AS createdAt, u.username AS actor
         FROM audit_log a LEFT JOIN users u ON u.id = a.actor_id ORDER BY a.id DESC LIMIT ? OFFSET ?`,
        q.pageSize, (q.page - 1) * q.pageSize,
      ),
    });
  });

  r.get('/diagnostics', (_req, res) => {
    let dbSize: number | null = null;
    try {
      if (db.dialect === 'postgres') dbSize = db.get<{ n: number }>('SELECT pg_database_size(current_database()) AS n')?.n ?? null;
      else dbSize = ctx.config.dbFile === ':memory:' ? null : statSync(ctx.config.dbFile).size;
    } catch {
      dbSize = null;
    }
    const mem = process.memoryUsage();
    res.json({
      node: process.version,
      platform: `${process.platform} ${process.arch}`,
      uptimeSec: Math.round((Date.now() - ctx.startedAt) / 1000),
      memoryMb: { rss: Math.round(mem.rss / 1e6), heapUsed: Math.round(mem.heapUsed / 1e6) },
      database: {
        engine: db.dialect === 'postgres' ? 'PostgreSQL' : 'SQLite',
        file: db.dialect === 'postgres' ? null : ctx.config.dbFile,
        sizeBytes: dbSize,
        migrations: db.all('SELECT version, name, applied_at AS appliedAt FROM schema_migrations ORDER BY version'),
        integrity: db.dialect === 'postgres' ? 'ok' : (db.get<{ quick_check: string }>('PRAGMA quick_check')?.quick_check ?? 'desconocido'),
      },
      realtime: { online: ctx.realtime.onlineCount(), connections: ctx.realtime.connectionCount() },
      poker: ctx.poker.diagnostics(),
      blackjack: ctx.blackjack.diagnostics(),
    });
  });

  /** Verifica que el saldo de cada jugador coincide con su libro mayor. */
  r.post('/diagnostics/ledger-check', (req, res) => {
    const users = db.all<{ id: string; username: string }>(`SELECT id, username FROM users WHERE role = 'player'`);
    const problems = users
      .map((u) => ({ ...u, ...verifyLedger(db, u.id) }))
      .filter((u) => !u.ok && !(u.balance === 0 && u.ledgerBalance === null));
    audit(req, 'diagnostics.ledger', null, { checked: users.length, problems: problems.length });
    res.json({ checked: users.length, problems });
  });

  return r;
}
