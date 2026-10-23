import { randomUUID } from 'node:crypto';
import {
  JACKPOT_TIERS,
  createHoldWin,
  createSafe,
  createWheel,
  holdWinBase,
  holdWinFull,
  holdWinRespin,
  jackpotAmount,
  pickSafe,
  publicFeature,
  type ExtraFeature,
  type JackpotTier,
  type SlotExtras,
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
  feature_json: string | null;
  version: number;
}

/** Cola de minijuegos de sala pendientes (el primero es el que se está jugando). */
interface FeatureQueue {
  queue: ExtraFeature[];
}

const readQueue = (row: SessionRow | undefined): ExtraFeature[] => (row?.feature_json ? (JSON.parse(row.feature_json) as FeatureQueue).queue : []);

/* --------------------------- Bote Grand progresivo -------------------------- */

function grandMilli(db: Database, m: SlotMachineDef): number {
  const x = m.extras!;
  const row = db.get<{ grand_milli: number }>('SELECT grand_milli FROM slot_jackpots WHERE machine_id = ?', m.id);
  if (row) return Number(row.grand_milli);
  db.run('INSERT INTO slot_jackpots (machine_id, grand_milli, updated_at) VALUES (?, ?, ?) ON CONFLICT DO NOTHING', m.id, x.jackpots.grandSeed * 1000, nowIso());
  return Number(db.get<{ grand_milli: number }>('SELECT grand_milli FROM slot_jackpots WHERE machine_id = ?', m.id)!.grand_milli);
}

export function grandPool(db: Database, m: SlotMachineDef): number {
  return m.extras ? Math.floor(grandMilli(db, m) / 1000) : 0;
}

/** Cada apuesta pagada aporta una fracción al Grand (créditos virtuales). */
function contributeGrand(db: Database, m: SlotMachineDef, totalBet: number): void {
  const x = m.extras!;
  grandMilli(db, m);
  db.run('UPDATE slot_jackpots SET grand_milli = grand_milli + ?, updated_at = ? WHERE machine_id = ?', Math.round(totalBet * x.jackpots.grandContribution * 1000), nowIso(), m.id);
}

/** Paga el Grand (proporcional a la apuesta) y lo deja como mínimo en su valor inicial. */
function payGrand(db: Database, m: SlotMachineDef, totalBet: number): number {
  const x = m.extras!;
  const pool = grandMilli(db, m);
  const amount = jackpotAmount(x, 'grand', totalBet, Math.floor(pool / 1000));
  const left = Math.max(x.jackpots.grandSeed * 1000, pool - amount * 1000);
  db.run('UPDATE slot_jackpots SET grand_milli = ?, updated_at = ? WHERE machine_id = ?', left, nowIso(), m.id);
  return amount;
}

/** Botes a mostrar: múltiplos fijos y el Grand acumulado (la interfaz los calcula para la apuesta elegida). */
export function jackpotInfo(db: Database, m: SlotMachineDef) {
  if (!m.extras) return null;
  const j = m.extras.jackpots;
  return { mini: j.mini, minor: j.minor, major: j.major, grandPool: grandPool(db, m), grandRefBet: j.grandRefBet };
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
    extra: null as ReturnType<typeof publicFeature> | null,
    pending: [] as ExtraFeature['kind'][],
  };
}

function fullView(db: Database, m: SlotMachineDef, row: SessionRow | undefined) {
  const v = featureView(m, row);
  const q = readQueue(row);
  if (m.extras && q[0]) v.extra = publicFeature(q[0], m.extras, grandPool(db, m));
  v.pending = q.slice(1).map((f) => f.kind);
  return { ...v, jackpots: jackpotInfo(db, m) };
}

function loadSession(db: Database, userId: string, machineId: string): SessionRow | undefined {
  return db.get<SessionRow>('SELECT * FROM slot_sessions WHERE user_id = ? AND machine_id = ?', userId, machineId);
}

function saveSession(db: Database, userId: string, machineId: string, patch: Partial<Omit<SessionRow, 'user_id' | 'machine_id' | 'version'>>, expectedVersion: number | null): void {
  const cur = loadSession(db, userId, machineId);
  if (!cur) {
    db.run(
      `INSERT INTO slot_sessions (user_id, machine_id, free_spins_left, free_spins_total, bet_per_line, lines, feature_win, bonus_json, feature_json, version, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?)`,
      userId, machineId, patch.free_spins_left ?? 0, patch.free_spins_total ?? 0, patch.bet_per_line ?? 0, patch.lines ?? 0, patch.feature_win ?? 0,
      patch.bonus_json ?? null, patch.feature_json ?? null, nowIso(),
    );
    return;
  }
  const next = { ...cur, ...patch };
  // Control de concurrencia optimista: dos peticiones a la vez no pueden gastar el mismo giro o cofre.
  const r = db.run(
    `UPDATE slot_sessions SET free_spins_left = ?, free_spins_total = ?, bet_per_line = ?, lines = ?, feature_win = ?, bonus_json = ?, feature_json = ?, version = version + 1, updated_at = ?
     WHERE user_id = ? AND machine_id = ? AND version = ?`,
    next.free_spins_left, next.free_spins_total, next.bet_per_line, next.lines, next.feature_win, next.bonus_json, next.feature_json, nowIso(), userId, machineId,
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
    if (readQueue(sess).length > 0) throw new AppError(409, 'FEATURE_PENDING', 'Termina primero el minijuego en curso');
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
      if (m.extras) {
        contributeGrand(db, m, result.totalBet);
        if (result.extrasTriggered.length > 0) {
          // Sector de la rueda y contenido de las cajas fijados AHORA (no se envían hasta destaparse).
          const queue: ExtraFeature[] = result.extrasTriggered.map((k) =>
            k === 'holdwin' ? createHoldWin(m.extras!, result.totalBet, result.cash) : k === 'wheel' ? createWheel(m.extras!, result.totalBet, cryptoRng) : createSafe(m.extras!, result.totalBet, cryptoRng),
          );
          saveSession(db, userId, m.id, { feature_json: JSON.stringify({ queue } satisfies FeatureQueue) }, null);
        }
      }
    }
    const settled = settleRound(db, round.id, result.totalWin, result, { slotsMultiplier: result.totalBet > 0 ? result.totalWin / result.totalBet : 0 });
    return { roundId: round.id, result, ...settled, feature: fullView(db, m, loadSession(db, userId, m.id)) };
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
  return fullView(db, m, loadSession(db, userId, m.id));
}

/** Premio de un minijuego terminado (sin el Grand, que se paga aparte del bote). */
function featurePrize(x: SlotExtras, f: ExtraFeature): { base: number; grand: boolean; jackpots: JackpotTier[] } {
  if (f.kind === 'holdwin') {
    const jackpots = f.cells.flatMap((c) => (c?.kind === 'jackpot' ? [c.tier] : []));
    return { base: holdWinBase(x, f), grand: holdWinFull(f), jackpots: holdWinFull(f) ? [...jackpots, 'grand'] : jackpots };
  }
  if (f.kind === 'wheel') {
    const p = x.wheel.segments[f.segment]!.prize;
    if (p.kind === 'credit') return { base: p.mult * f.totalBet, grand: false, jackpots: [] };
    return p.tier === 'grand' ? { base: 0, grand: true, jackpots: ['grand'] } : { base: jackpotAmount(x, p.tier, f.totalBet, 0), grand: false, jackpots: [p.tier] };
  }
  const t = f.winner!;
  return t === 'grand' ? { base: 0, grand: true, jackpots: ['grand'] } : { base: jackpotAmount(x, t, f.totalBet, 0), grand: false, jackpots: [t] };
}

/**
 * Acción del minijuego en curso: girar la rueda, abrir una caja o pedir el
 * siguiente re-giro del Hold & Win. Cada acción es una petición (nada se
 * juega solo). Al terminar se liquida en una ronda propia y pasa al siguiente.
 */
export function slotFeatureAct(db: Database, userId: string, machineId: string, action: 'spin' | 'pick' | 'respin', index: number | undefined) {
  const m = getMachine(machineId);
  if (!m.extras) throw new AppError(400, 'NO_FEATURE', 'Esta máquina no tiene minijuegos de sala');
  const x = m.extras;
  return db.tx(() => {
    const sess = loadSession(db, userId, m.id);
    const queue = readQueue(sess);
    const f = queue[0];
    if (!sess || !f) throw new AppError(409, 'NO_FEATURE', 'No hay ningún minijuego en curso');
    let reveal: unknown = null;
    if (f.kind === 'wheel') {
      if (action !== 'spin') throw new AppError(400, 'INVALID_ACTION', 'La rueda solo se puede girar');
      f.spun = true;
      f.done = true;
      reveal = { segment: f.segment };
    } else if (f.kind === 'safe') {
      if (action !== 'pick' || index === undefined) throw new AppError(400, 'INVALID_ACTION', 'Elige una caja');
      reveal = { index, tier: pickSafe(f, index) };
    } else {
      if (action !== 'respin') throw new AppError(400, 'INVALID_ACTION', 'Pulsa girar para el siguiente re-giro');
      reveal = { landed: holdWinRespin(x, f, cryptoRng) };
    }
    let finished: null | { won: number; jackpots: JackpotTier[]; grand: number } = null;
    let balance = getBalance(db, userId);
    let achievements: unknown[] = [];
    const publicNow = publicFeature(f, x, grandPool(db, m));
    if (f.done) {
      const prize = featurePrize(x, f);
      const grand = prize.grand ? payGrand(db, m, f.totalBet) : 0;
      const won = prize.base + grand;
      const round = openFreeRound(db, userId, `feat-${randomUUID()}`);
      const out = settleRound(db, round.id, won, { machine: m.id, kind: f.kind, feature: publicNow, jackpots: prize.jackpots, grand }, { slotsMultiplier: won / f.totalBet });
      balance = out.balance;
      achievements = out.achievements;
      finished = { won, jackpots: prize.jackpots, grand };
      queue.shift();
    }
    saveSession(db, userId, m.id, { feature_json: queue.length ? JSON.stringify({ queue } satisfies FeatureQueue) : null }, sess.version);
    return { reveal, feature: publicNow, finished, balance, achievements, state: fullView(db, m, loadSession(db, userId, m.id)) };
  });
}

export { JACKPOT_TIERS };
