import { randomUUID } from 'node:crypto';
import {
  bonusWinnings,
  createPickBonus,
  getMachine,
  pickBonus,
  publicPickBonus,
  spinMachine,
  validateSlotBet,
  type MachineSpinResult,
  type PickBonusState,
  type SlotMachineDef,
} from '@aurum/engine';
import type { Database } from '../db/database';
import { nowIso } from '../db/database';
import { AppError, conflict } from '../lib/errors';
import { cryptoRng } from '../lib/rng';
import { getBalance } from '../wallet/wallet';
import { openRound, settleRound, type RoundRow } from './rounds';

interface SessionRow {
  user_id: string;
  machine_id: string;
  free_spins_left: number;
  free_spins_total: number;
  bet_per_line: number;
  lines: number;
  feature_win: number;
  bonus_json: string | null;
  version: number;
}

export function featureView(m: SlotMachineDef, row: SessionRow | undefined) {
  const bonus = row?.bonus_json ? (JSON.parse(row.bonus_json) as PickBonusState) : null;
  return {
    machine: m.id,
    freeSpins: row && row.free_spins_left > 0
      ? { left: row.free_spins_left, total: row.free_spins_total, multiplier: m.freeSpins?.multiplier ?? 1, betPerLine: row.bet_per_line, lines: row.lines, won: row.feature_win }
      : null,
    // Solo los cofres abiertos llevan su premio.
    bonus: bonus ? publicPickBonus(bonus) : null,
  };
}

function loadSession(db: Database, userId: string, machineId: string): SessionRow | undefined {
  return db.get<SessionRow>('SELECT * FROM slot_sessions WHERE user_id = ? AND machine_id = ?', userId, machineId);
}

function saveSession(db: Database, userId: string, machineId: string, patch: Partial<Omit<SessionRow, 'user_id' | 'machine_id' | 'version'>>, expectedVersion: number | null): void {
  const cur = loadSession(db, userId, machineId);
  if (!cur) {
    db.run(
      `INSERT INTO slot_sessions (user_id, machine_id, free_spins_left, free_spins_total, bet_per_line, lines, feature_win, bonus_json, version, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1, ?)`,
      userId, machineId, patch.free_spins_left ?? 0, patch.free_spins_total ?? 0, patch.bet_per_line ?? 0, patch.lines ?? 0, patch.feature_win ?? 0,
      patch.bonus_json ?? null, nowIso(),
    );
    return;
  }
  const next = { ...cur, ...patch };
  // Control de concurrencia optimista: dos peticiones a la vez no pueden gastar el mismo giro o cofre.
  const r = db.run(
    `UPDATE slot_sessions SET free_spins_left = ?, free_spins_total = ?, bet_per_line = ?, lines = ?, feature_win = ?, bonus_json = ?, version = version + 1, updated_at = ?
     WHERE user_id = ? AND machine_id = ? AND version = ?`,
    next.free_spins_left, next.free_spins_total, next.bet_per_line, next.lines, next.feature_win, next.bonus_json, nowIso(), userId, machineId,
    expectedVersion ?? cur.version,
  );
  if (r.changes !== 1) throw conflict('STALE_ACTION', 'Acción duplicada o desfasada');
}

/** Ronda sin cargo (giro gratis o bono): no hay movimiento de apuesta, solo el premio al liquidar. */
function openFreeRound(db: Database, userId: string, key: string): RoundRow {
  const id = randomUUID();
  try {
    db.run(`INSERT INTO game_rounds (id, user_id, game, status, bet_total, idempotency_key, created_at) VALUES (?, ?, 'slots', 'open', 0, ?, ?)`, id, userId, key, nowIso());
  } catch (err) {
    if (String(err).includes('UNIQUE')) throw conflict('DUPLICATE_REQUEST', 'Esta jugada ya se ha procesado');
    throw err;
  }
  return db.get<RoundRow>('SELECT * FROM game_rounds WHERE id = ?', id)!;
}

/**
 * Tirada. Si hay giros gratis pendientes, se juega uno con la apuesta con la
 * que se ganaron (sin cargo). Con un bono pendiente no se puede girar.
 * Nunca se encadenan tiradas automáticamente: cada tirada es una petición.
 */
export function slotSpin(db: Database, userId: string, machineId: string, betPerLine: number, lines: number, key: string) {
  const m = getMachine(machineId);
  return db.tx(() => {
    const sess = loadSession(db, userId, m.id);
    if (sess?.bonus_json) throw new AppError(409, 'BONUS_PENDING', 'Termina primero el bono de cofres');
    let result: MachineSpinResult;
    let round: RoundRow;
    if (sess && sess.free_spins_left > 0) {
      round = openFreeRound(db, userId, key);
      result = spinMachine(m, cryptoRng, sess.bet_per_line, sess.lines, 'free');
      saveSession(db, userId, m.id, { free_spins_left: sess.free_spins_left - 1, feature_win: sess.feature_win + result.totalWin }, sess.version);
    } else {
      validateSlotBet(betPerLine, lines, m.limits);
      round = openRound(db, userId, 'slots', betPerLine * lines, key);
      result = spinMachine(m, cryptoRng, betPerLine, lines, 'paid');
      if (result.freeSpinsAwarded > 0) {
        saveSession(db, userId, m.id, { free_spins_left: result.freeSpinsAwarded, free_spins_total: result.freeSpinsAwarded, bet_per_line: betPerLine, lines, feature_win: 0, bonus_json: null }, null);
      }
      if (result.bonusTriggered) {
        // Los premios de los cofres quedan fijados AHORA, antes de que el jugador elija.
        const bonus = createPickBonus(m, result.totalBet, cryptoRng);
        saveSession(db, userId, m.id, { bonus_json: JSON.stringify(bonus) }, null);
      }
    }
    const settled = settleRound(db, round.id, result.totalWin, result, { slotsMultiplier: result.totalBet > 0 ? result.totalWin / result.totalBet : 0 });
    return { roundId: round.id, result, ...settled, feature: featureView(m, loadSession(db, userId, m.id)) };
  });
}

/** Abre un cofre. Al abrir el último se liquida el bono en una ronda propia. */
export function slotBonusPick(db: Database, userId: string, machineId: string, index: number) {
  const m = getMachine(machineId);
  return db.tx(() => {
    const sess = loadSession(db, userId, m.id);
    if (!sess?.bonus_json) throw new AppError(409, 'NO_BONUS', 'No hay ningún bono en curso');
    const state = JSON.parse(sess.bonus_json) as PickBonusState;
    const { prize, done } = pickBonus(state, index);
    let balance = getBalance(db, userId);
    let achievements: unknown[] = [];
    if (done) {
      const round = openFreeRound(db, userId, `bonus-${randomUUID()}`);
      const won = bonusWinnings(state);
      const out = settleRound(db, round.id, won, { machine: m.id, kind: 'pick-bonus', bonus: publicPickBonus(state) }, { slotsMultiplier: won / state.totalBet });
      balance = out.balance;
      achievements = out.achievements;
      saveSession(db, userId, m.id, { bonus_json: null }, sess.version);
    } else {
      saveSession(db, userId, m.id, { bonus_json: JSON.stringify(state) }, sess.version);
    }
    return { prize, done, bonus: publicPickBonus(state), balance, achievements };
  });
}

export function slotFeatureState(db: Database, userId: string, machineId: string) {
  const m = getMachine(machineId);
  return featureView(m, loadSession(db, userId, m.id));
}
