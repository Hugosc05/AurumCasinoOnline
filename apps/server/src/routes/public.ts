import { Router } from 'express';
import { z } from 'zod';
import {
  BOT_PROFILE_LABELS,
  DEFAULT_BLACKJACK_RULES,
  DEFAULT_ROULETTE_LIMITS,
  DEFAULT_SLOT_LIMITS,
  LINE_PAYS,
  PAYLINES,
  REEL_STRIPS,
  ROULETTE_PAYOUTS,
  SCATTER_PAYS,
  computeRtp,
} from '@aurum/engine';
import type { AppContext } from '../context';
import { getSetting } from '../db/seed';
import { parse } from '../lib/http';
import { anonymize } from '../auth/users';

const rtp = computeRtp();

export function publicRoutes(ctx: AppContext): Router {
  const r = Router();
  const { db } = ctx;

  r.get('/health', (_req, res) => {
    res.json({ ok: true, uptimeSec: Math.round((Date.now() - ctx.startedAt) / 1000) });
  });

  /** Datos de la portada: juegos habilitados, mesas reales y presencia real. */
  r.get('/lobby', (_req, res) => {
    const registered = db.get<{ n: number }>(`SELECT COUNT(*) AS n FROM users WHERE role = 'player'`)!.n;
    res.json({
      games: getSetting(db, 'gamesEnabled'),
      tables: ctx.poker.lobby(),
      online: ctx.realtime.onlineCount(),
      registeredPlayers: registered,
      maintenanceMessage: getSetting(db, 'maintenanceMessage'),
    });
  });

  /** Actividad reciente REAL de jugadores humanos, anonimizada. Sin cifras inventadas. */
  r.get('/activity', (_req, res) => {
    const rows = db.all<{ username: string; game: string; bet: number; payout: number; at: string }>(
      `SELECT u.username, r.game, r.bet_total AS bet, r.payout, r.settled_at AS at
       FROM game_rounds r JOIN users u ON u.id = r.user_id
       WHERE r.status = 'settled' AND u.role = 'player' AND r.payout > r.bet_total
       ORDER BY r.settled_at DESC LIMIT 12`,
    );
    res.json({
      items: rows.map((x) => ({ player: anonymize(x.username), game: x.game, net: x.payout - x.bet, at: x.at })),
    });
  });

  const lbSchema = z.object({ by: z.enum(['net', 'balance', 'biggest', 'streak']).default('net') });
  r.get('/leaderboard', (req, res) => {
    const { by } = parse(lbSchema, req.query);
    const order = {
      net: '(s.total_payout - s.total_bet) DESC',
      balance: 'u.balance DESC',
      biggest: 's.biggest_win DESC',
      streak: 's.best_streak DESC',
    }[by];
    const rows = db.all<Record<string, number | string>>(
      `SELECT u.username, u.balance, COALESCE(s.rounds, 0) AS rounds, COALESCE(s.wins, 0) AS wins,
              COALESCE(s.total_payout - s.total_bet, 0) AS net, COALESCE(s.biggest_win, 0) AS biggestWin,
              COALESCE(s.best_streak, 0) AS bestStreak
       FROM users u LEFT JOIN user_stats s ON s.user_id = u.id
       WHERE u.role = 'player' AND u.status = 'active' AND COALESCE(s.rounds, 0) > 0
       ORDER BY ${order}, u.created_at ASC LIMIT 25`,
    );
    res.json({ by, items: rows.map((x, i) => ({ rank: i + 1, ...x })) });
  });

  /** Reglas y tablas de pago que usa el servidor (fuente única de verdad para la interfaz). */
  r.get('/rules', (_req, res) => {
    res.json({
      blackjack: DEFAULT_BLACKJACK_RULES,
      roulette: { payouts: ROULETTE_PAYOUTS, limits: DEFAULT_ROULETTE_LIMITS, houseEdge: 1 / 37 },
      slots: {
        linePays: LINE_PAYS,
        scatterPays: SCATTER_PAYS,
        paylines: PAYLINES,
        strips: REEL_STRIPS,
        limits: DEFAULT_SLOT_LIMITS,
        rtp,
      },
      poker: { profiles: BOT_PROFILE_LABELS },
    });
  });

  return r;
}
