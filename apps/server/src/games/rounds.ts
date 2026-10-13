import { randomUUID } from 'node:crypto';
import type { Database } from '../db/database';
import { nowIso } from '../db/database';
import { AppError, conflict } from '../lib/errors';
import { type GameId, type OutcomeFlags, type UnlockedAchievement, recordOutcome } from '../stats/stats';
import { credit, debit, getBalance, type BalanceView } from '../wallet/wallet';
import { getSetting } from '../db/seed';

export interface RoundRow {
  id: string;
  user_id: string;
  game: GameId;
  status: 'open' | 'settled' | 'void';
  bet_total: number;
  payout: number;
  idempotency_key: string | null;
  action_seq: number;
  state_json: string | null;
  result_json: string | null;
  created_at: string;
  settled_at: string | null;
}

export function assertGameEnabled(db: Database, game: GameId): void {
  const enabled = getSetting(db, 'gamesEnabled');
  if (!enabled[game]) throw new AppError(503, 'GAME_DISABLED', 'Este juego está temporalmente desactivado');
}

export function findRoundByKey(db: Database, userId: string, key: string): RoundRow | undefined {
  return db.get<RoundRow>('SELECT * FROM game_rounds WHERE user_id = ? AND idempotency_key = ?', userId, key);
}

/** Abre una ronda y descuenta la apuesta en la misma transacción. */
export function openRound(
  db: Database,
  userId: string,
  game: GameId,
  bet: number,
  idempotencyKey: string,
): RoundRow {
  return db.tx(() => {
    const id = randomUUID();
    const now = nowIso();
    try {
      db.run(
        `INSERT INTO game_rounds (id, user_id, game, status, bet_total, idempotency_key, created_at) VALUES (?, ?, ?, 'open', ?, ?, ?)`,
        id, userId, game, bet, idempotencyKey, now,
      );
    } catch (err) {
      if (String(err).includes('UNIQUE')) throw conflict('DUPLICATE_REQUEST', 'Esta jugada ya se ha procesado');
      throw err;
    }
    debit(db, userId, bet, 'bet', { roundId: id, meta: { game } });
    return db.get<RoundRow>('SELECT * FROM game_rounds WHERE id = ?', id)!;
  });
}

/** Descuenta una apuesta adicional de una ronda abierta (doblar, dividir). */
export function addToRoundBet(db: Database, round: RoundRow, amount: number): void {
  db.tx(() => {
    debit(db, round.user_id, amount, 'bet', { roundId: round.id, meta: { game: round.game, extra: true } });
    db.run('UPDATE game_rounds SET bet_total = bet_total + ? WHERE id = ? AND status = ?', amount, round.id, 'open');
  });
}

export interface SettleOutcome {
  balance: BalanceView;
  achievements: UnlockedAchievement[];
  streak: number;
}

/**
 * Liquida una ronda UNA sola vez: la transición open → settled es condicional,
 * de modo que una segunda liquidación (petición duplicada o concurrente) falla
 * sin abonar nada.
 */
export function settleRound(
  db: Database,
  roundId: string,
  payout: number,
  result: unknown,
  flags: OutcomeFlags = {},
  stateJson: string | null = null,
): SettleOutcome {
  return db.tx(() => {
    const round = db.get<RoundRow>('SELECT * FROM game_rounds WHERE id = ?', roundId);
    if (!round) throw new AppError(404, 'ROUND_NOT_FOUND', 'Ronda no encontrada');
    const r = db.run(
      `UPDATE game_rounds SET status = 'settled', payout = ?, result_json = ?, state_json = ?, settled_at = ? WHERE id = ? AND status = 'open'`,
      payout, JSON.stringify(result), stateJson, nowIso(), roundId,
    );
    if (r.changes !== 1) throw conflict('ALREADY_SETTLED', 'La ronda ya estaba liquidada');
    if (payout > 0) credit(db, round.user_id, payout, 'payout', { roundId, meta: { game: round.game } });
    const { unlocked, streak } = recordOutcome(db, {
      userId: round.user_id, game: round.game, bet: round.bet_total, payout, roundId, flags,
    });
    return { balance: getBalance(db, round.user_id), achievements: unlocked, streak };
  });
}
