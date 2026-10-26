import { ACHIEVEMENTS } from '@aurum/engine';
import { Router } from 'express';
import { z } from 'zod';
import type { AppContext } from '../context';
import { nowIso } from '../db/database';
import { getSetting } from '../db/seed';
import { AppError, conflict } from '../lib/errors';
import { parse, requireAuth } from '../lib/http';
import { credit, getBalance } from '../wallet/wallet';
import { claimDaily, dailyStatus, economyTimezone } from '../economy/daily';
import { periodInfo } from '../economy/period';
import { preferencesSchema, readPrefs, toPublicUser } from '../auth/users';

const pageSchema = z.object({
  page: z.coerce.number().int().min(1).max(10_000).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
  game: z.enum(['blackjack', 'roulette', 'slots', 'poker', 'bingo', 'crash', 'plinko']).optional(),
});


export function meRoutes(ctx: AppContext): Router {
  const r = Router();
  const { db } = ctx;
  r.use(requireAuth);

  r.patch('/preferences', (req, res) => {
    const patch = parse(preferencesSchema, req.body);
    const user = req.user!;
    const prefs = { ...readPrefs(user.prefs_json), ...patch };
    db.run('UPDATE users SET prefs_json = ? WHERE id = ?', JSON.stringify(prefs), user.id);
    if (patch.invisible !== undefined) ctx.social.presenceChanged(user.id);
    res.json({ preferences: prefs });
  });

  r.get('/stats', (req, res) => {
    const id = req.user!.id;
    const stats = db.get<Record<string, number>>(
      `SELECT rounds, wins, losses, pushes, total_bet AS totalBet, total_payout AS totalPayout,
              current_streak AS currentStreak, best_streak AS bestStreak, biggest_win AS biggestWin
       FROM user_stats WHERE user_id = ?`,
      id,
    ) ?? { rounds: 0, wins: 0, losses: 0, pushes: 0, totalBet: 0, totalPayout: 0, currentStreak: 0, bestStreak: 0, biggestWin: 0 };
    const byGame = db.all<Record<string, unknown>>(
      `SELECT game, rounds, wins, losses, total_bet AS totalBet, total_payout AS totalPayout FROM user_game_stats WHERE user_id = ?`,
      id,
    );
    // Línea temporal de los últimos resultados reales (para el indicador de racha).
    const recent = db.all<{ game: string; bet: number; payout: number; at: string }>(
      `SELECT game, bet_total AS bet, payout, settled_at AS at FROM game_rounds
       WHERE user_id = ? AND status = 'settled' ORDER BY settled_at DESC LIMIT 20`,
      id,
    ).map((x) => ({ ...x, outcome: x.payout > x.bet ? 'win' : x.payout < x.bet ? 'loss' : 'push' }));
    res.json({ stats: { ...stats, net: (stats.totalPayout ?? 0) - (stats.totalBet ?? 0) }, byGame, recent });
  });

  r.get('/history', (req, res) => {
    const q = parse(pageSchema, req.query);
    const id = req.user!.id;
    const where = q.game ? `user_id = ? AND game = ? AND status != 'open'` : `user_id = ? AND status != 'open'`;
    const params = q.game ? [id, q.game] : [id];
    const total = db.get<{ n: number }>(`SELECT COUNT(*) AS n FROM game_rounds WHERE ${where}`, ...params)!.n;
    const items = db.all<{ id: string; game: string; status: string; bet: number; payout: number; createdAt: string; settledAt: string | null; result_json: string | null }>(
      `SELECT id, game, status, bet_total AS bet, payout, created_at AS createdAt, settled_at AS settledAt, result_json
       FROM game_rounds WHERE ${where} ORDER BY created_at DESC LIMIT ? OFFSET ?`,
      ...params, q.pageSize, (q.page - 1) * q.pageSize,
    ).map(({ result_json, ...row }) => ({ ...row, summary: summarize(row.game, result_json) }));
    res.json({ items, total, page: q.page, pageSize: q.pageSize });
  });

  r.get('/transactions', (req, res) => {
    const q = parse(pageSchema, req.query);
    const id = req.user!.id;
    const total = db.get<{ n: number }>('SELECT COUNT(*) AS n FROM wallet_transactions WHERE user_id = ?', id)!.n;
    const items = db.all(
      `SELECT id, amount, balance_before AS balanceBefore, balance_after AS balanceAfter, reason, round_id AS roundId,
              unlimited, created_at AS createdAt
       FROM wallet_transactions WHERE user_id = ? ORDER BY id DESC LIMIT ? OFFSET ?`,
      id, q.pageSize, (q.page - 1) * q.pageSize,
    );
    res.json({ items, total, page: q.page, pageSize: q.pageSize });
  });

  r.get('/achievements', (req, res) => {
    const rows = db.all<{ achievement_id: string; unlocked_at: string }>(
      'SELECT achievement_id, unlocked_at FROM user_achievements WHERE user_id = ?',
      req.user!.id,
    );
    const map = new Map(rows.map((x) => [x.achievement_id, x.unlocked_at]));
    res.json({ achievements: ACHIEVEMENTS.filter((a) => a.id !== 'mission_done').map((a) => ({ ...a, unlockedAt: map.get(a.id) ?? null })) });
  });

  /* ------------------------- Promociones virtuales ------------------------- */
  const currentDay = (): string => periodInfo(new Date(), economyTimezone(db)).day;

  r.get('/promotions', (req, res) => {
    const user = req.user!;
    const day = currentDay();
    const refillClaimed = !!db.get(`SELECT 1 AS x FROM daily_claims WHERE user_id = ? AND kind = 'demo_refill' AND day = ?`, user.id, day);
    const balance = getBalance(db, user.id);
    const threshold = getSetting(db, 'demoRefillThreshold');
    res.json({
      day,
      daily: dailyStatus(db, user.id),
      demoRefill: {
        amount: getSetting(db, 'demoRefillAmount'),
        threshold,
        claimed: refillClaimed,
        eligible: !balance.unlimited && (balance.balance ?? 0) < threshold,
      },
      ads: ctx.ads.status(user.id, user.role),
      serverTime: new Date().toISOString(),
    });
  });

  r.post('/promotions/daily-bonus', (req, res) => {
    const user = req.user!;
    const out = claimDaily(db, user.id, user.role);
    res.json({ balance: out.balance, amount: out.amount, daily: out.status });
  });

  /** Recarga de demostración: solo con saldo bajo, una vez por periodo, registrada en el libro mayor. */
  r.post('/promotions/demo-refill', (req, res) => {
    const user = req.user!;
    if (user.role === 'admin') throw new AppError(400, 'NOT_APPLICABLE', 'Las cuentas administradoras tienen saldo ilimitado');
    const threshold = getSetting(db, 'demoRefillThreshold');
    const amount = getSetting(db, 'demoRefillAmount');
    const balance = db.tx(() => {
      const fresh = db.get<{ balance: number }>('SELECT balance FROM users WHERE id = ?', user.id)!;
      if (fresh.balance >= threshold) throw new AppError(400, 'NOT_ELIGIBLE', `Disponible cuando tu saldo sea inferior a ${threshold}`);
      try {
        db.run('INSERT INTO daily_claims (user_id, kind, day, amount, created_at) VALUES (?, ?, ?, ?, ?)', user.id, 'demo_refill', currentDay(), amount, nowIso());
      } catch (err) {
        if (String(err).includes('UNIQUE') || String(err).includes('PRIMARY')) throw conflict('ALREADY_CLAIMED', 'Ya has usado la recarga de hoy');
        throw err;
      }
      credit(db, user.id, amount, 'demo_refill');
      return getBalance(db, user.id);
    });
    res.json({ balance });
  });

  r.get('/', (req, res) => {
    res.json({ user: toPublicUser(req.user!) });
  });

  return r;
}

/** Resumen corto de una ronda para el historial. */
function summarize(game: string, json: string | null): string {
  if (!json) return '';
  try {
    const r = JSON.parse(json) as Record<string, unknown>;
    if (game === 'roulette') return `Salió el ${String(r.number)}`;
    if (game === 'slots') {
      const lw = (r.lineWins as unknown[] | undefined)?.length ?? 0;
      return lw > 0 || r.scatterWin ? `${lw} línea(s) premiada(s)` : 'Sin premio';
    }
    if (game === 'blackjack') {
      const hands = (r.hands as { outcome?: string; value?: { total: number } }[] | undefined) ?? [];
      const labels: Record<string, string> = { blackjack: 'Blackjack', win: 'Gana', push: 'Empate', lose: 'Pierde', bust: 'Se pasa' };
      return hands.map((h) => `${labels[h.outcome ?? ''] ?? '?'} (${h.value?.total ?? '?'})`).join(' · ');
    }
    if (game === 'poker') return String(r.summary ?? '');
    const mult = (c: number): string => `${(c / 100).toFixed(2).replace('.', ',')}×`;
    if (game === 'plinko') return `Casilla ${Number(r.bucket) + 1} de ${Number(r.rows) + 1}: ${String(r.multiplier).replace('.', ',')}×`;
    if (game === 'crash') return r.cashedAt ? `Ronda ${String(r.roundNo)}: cobrado a ${mult(Number(r.cashedAt))}` : `Ronda ${String(r.roundNo)}: se estrelló en ${mult(Number(r.crash))}`;
    if (game === 'bingo') {
      const wins = [Number(r.line) > 0 ? 'línea' : '', Number(r.bingo) > 0 ? 'bingo' : ''].filter(Boolean).join(' y ');
      return `${String(r.cards)} cartón(es), ${String(r.balls)} bolas${wins ? ` · ¡${wins}!` : ''}`;
    }
  } catch {
    /* ignorar */
  }
  return '';
}
