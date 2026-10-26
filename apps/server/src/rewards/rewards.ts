import { randomUUID } from 'node:crypto';
import {
  CASES,
  CASE_BY_ID,
  COSMETICS,
  COSMETIC_BY_ID,
  MISSION_BY_ID,
  MISSION_REWARD,
  caseExpectedCredits,
  caseRarityOdds,
  isoWeekKey,
  missionIncrement,
  pickMissions,
  rollCase,
  type CosmeticKind,
  type MissionGame,
} from '@aurum/engine';
import type { Database } from '../db/database';
import { nowIso } from '../db/database';
import { getSetting } from '../db/seed';
import { periodInfo, shiftDay, startOfDay } from '../economy/period';
import { AppError, conflict, notFound } from '../lib/errors';
import { cryptoRng } from '../lib/rng';
import { credit, debit, getBalance } from '../wallet/wallet';

/**
 * Misiones, cajas, inventario y cosméticos equipados.
 *
 * - Las misiones del periodo se crean al consultarlas o al jugar (elegidas de
 *   forma reproducible para cada jugador) y avanzan dentro de la misma
 *   transacción que liquida la partida.
 * - El premio de una caja se sortea con el CSPRNG del servidor al abrirla, en
 *   una transacción que marca la caja como abierta una sola vez.
 * - Un cosmético repetido se convierte en créditos (su valor publicado).
 */

const periodsFor = (db: Database, now = new Date()): { daily: string; weekly: string; dailyResetAt: string; weeklyResetAt: string } => {
  const tz = getSetting(db, 'dailyTimezone');
  const p = periodInfo(now, tz);
  const week = isoWeekKey(p.day);
  // Próximo lunes local.
  const [y, m, d] = p.day.split('-').map(Number) as [number, number, number];
  const dow = (new Date(Date.UTC(y, m - 1, d)).getUTCDay() + 6) % 7;
  const nextMonday = startOfDay(shiftDay(p.day, 7 - dow), tz);
  return { daily: `d:${p.day}`, weekly: `w:${week}`, dailyResetAt: p.nextResetAt, weeklyResetAt: nextMonday.toISOString() };
};

interface MissionRow {
  period: string;
  mission_id: string;
  target: number;
  progress: number;
  state_json: string | null;
  claimed: number;
}

function ensureMissions(db: Database, userId: string, now = new Date()) {
  const per = periodsFor(db, now);
  for (const [scope, key] of [['daily', per.daily], ['weekly', per.weekly]] as const) {
    const have = db.get<{ n: number }>('SELECT COUNT(*) AS n FROM user_missions WHERE user_id = ? AND period = ?', userId, key)!.n;
    if (Number(have) > 0) continue;
    for (const m of pickMissions(userId, scope, key)) {
      db.run('INSERT INTO user_missions (user_id, period, mission_id, target, progress, claimed) VALUES (?, ?, ?, ?, 0, 0) ON CONFLICT DO NOTHING', userId, key, m.id, m.target);
    }
  }
  return per;
}

/** Avanza las misiones con una partida liquidada. Devuelve las que se acaban de completar. */
export function advanceMissions(db: Database, userId: string, game: MissionGame, bet: number, payout: number): { id: string; text: string }[] {
  const per = ensureMissions(db, userId);
  const rows = db.all<MissionRow>('SELECT period, mission_id, target, progress, state_json, claimed FROM user_missions WHERE user_id = ? AND period IN (?, ?)', userId, per.daily, per.weekly);
  const done: { id: string; text: string }[] = [];
  for (const r of rows) {
    const m = MISSION_BY_ID[r.mission_id];
    if (!m || r.progress >= r.target) continue;
    let next = r.progress;
    let state = r.state_json;
    if (m.metric === 'distinctGames') {
      const seen = new Set<string>(state ? (JSON.parse(state) as string[]) : []);
      seen.add(game);
      state = JSON.stringify([...seen]);
      next = seen.size;
    } else next = r.progress + missionIncrement(m, { game, bet, payout });
    next = Math.min(r.target, next);
    if (next === r.progress && state === r.state_json) continue;
    db.run('UPDATE user_missions SET progress = ?, state_json = ? WHERE user_id = ? AND period = ? AND mission_id = ?', next, state, userId, r.period, r.mission_id);
    if (next >= r.target) done.push({ id: m.id, text: m.text });
  }
  return done;
}

export function missionsView(db: Database, userId: string) {
  const per = db.tx(() => ensureMissions(db, userId));
  const rows = db.all<MissionRow>('SELECT period, mission_id, target, progress, state_json, claimed FROM user_missions WHERE user_id = ? AND period IN (?, ?)', userId, per.daily, per.weekly);
  const view = (r: MissionRow) => {
    const m = MISSION_BY_ID[r.mission_id]!;
    return { id: m.id, period: r.period, scope: m.scope, text: m.text, game: m.game, target: r.target, progress: r.progress, done: r.progress >= r.target, claimed: r.claimed === 1, reward: MISSION_REWARD[m.scope] };
  };
  const list = rows.filter((r) => MISSION_BY_ID[r.mission_id]).map(view);
  return {
    daily: list.filter((x) => x.scope === 'daily'),
    weekly: list.filter((x) => x.scope === 'weekly'),
    dailyResetAt: per.dailyResetAt,
    weeklyResetAt: per.weeklyResetAt,
  };
}

export function claimMission(db: Database, userId: string, missionId: string, period: string) {
  return db.tx(() => {
    const r = db.get<MissionRow>('SELECT period, mission_id, target, progress, state_json, claimed FROM user_missions WHERE user_id = ? AND period = ? AND mission_id = ?', userId, period, missionId);
    if (!r) throw notFound('Misión no encontrada');
    if (r.progress < r.target) throw new AppError(409, 'NOT_DONE', 'Todavía no has completado esta misión');
    const upd = db.run('UPDATE user_missions SET claimed = 1 WHERE user_id = ? AND period = ? AND mission_id = ? AND claimed = 0', userId, period, missionId);
    if (upd.changes !== 1) throw conflict('ALREADY_CLAIMED', 'Ya has reclamado esta misión');
    const m = MISSION_BY_ID[missionId]!;
    const caseId = MISSION_REWARD[m.scope];
    const id = randomUUID();
    db.run(`INSERT INTO user_cases (id, user_id, case_id, source, status, created_at) VALUES (?, ?, ?, 'mission', 'unopened', ?)`, id, userId, caseId, nowIso());
    return { caseInstanceId: id, caseId };
  });
}

/* --------------------------------- Cajas --------------------------------- */

export function caseCatalog() {
  return CASES.map((c) => {
    const ev = caseExpectedCredits(c);
    return { id: c.id, name: c.name, price: c.price, color: c.color, drops: c.drops, odds: caseRarityOdds(c), expectedCredits: Math.round(ev.credits), cosmeticChance: ev.cosmeticChance };
  });
}

export function buyCase(db: Database, userId: string, caseId: string, count: number) {
  const def = CASE_BY_ID[caseId];
  if (!def || def.price === null) throw new AppError(400, 'NOT_FOR_SALE', 'Esa caja no está a la venta');
  return db.tx(() => {
    const ids: string[] = [];
    for (let i = 0; i < count; i += 1) {
      const id = randomUUID();
      debit(db, userId, def.price!, 'case_purchase', { meta: { caseId, caseInstanceId: id } });
      db.run(`INSERT INTO user_cases (id, user_id, case_id, source, status, created_at) VALUES (?, ?, ?, 'shop', 'unopened', ?)`, id, userId, caseId, nowIso());
      ids.push(id);
    }
    return { ids, balance: getBalance(db, userId) };
  });
}

export function openCase(db: Database, userId: string, caseInstanceId: string) {
  return db.tx(() => {
    const row = db.get<{ id: string; case_id: string; status: string }>('SELECT id, case_id, status FROM user_cases WHERE id = ? AND user_id = ?', caseInstanceId, userId);
    if (!row) throw notFound('Caja no encontrada');
    const def = CASE_BY_ID[row.case_id];
    if (!def) throw notFound('Caja desconocida');
    // El premio se decide aquí, con el CSPRNG del servidor.
    const index = rollCase(def, cryptoRng);
    const drop = def.drops[index]!;
    let credited = 0;
    let duplicate = false;
    if (drop.kind === 'credits') {
      credited = drop.amount;
    } else {
      const ins = db.run('INSERT INTO user_items (user_id, item_id, source, created_at) VALUES (?, ?, ?, ?) ON CONFLICT DO NOTHING', userId, drop.id, `case:${def.id}`, nowIso());
      if (ins.changes !== 1) {
        duplicate = true;
        credited = COSMETIC_BY_ID[drop.id]?.dupValue ?? 0;
      }
    }
    const result = { index, drop, credited, duplicate };
    const upd = db.run(`UPDATE user_cases SET status = 'opened', opened_at = ?, result_json = ? WHERE id = ? AND status = 'unopened'`, nowIso(), JSON.stringify(result), caseInstanceId);
    if (upd.changes !== 1) throw conflict('ALREADY_OPENED', 'Esa caja ya está abierta');
    if (credited > 0) credit(db, userId, credited, 'case_reward', { meta: { caseId: def.id, caseInstanceId } });
    return { caseId: def.id, ...result, balance: getBalance(db, userId) };
  });
}

/* ------------------------------- Inventario ------------------------------- */

export interface Look {
  frame: string | null;
  nameColor: string | null;
  cardBack: string | null;
  avatarVersion: number;
}

export function inventory(db: Database, userId: string) {
  const cases = db.all<{ id: string; case_id: string; source: string; created_at: string }>(
    `SELECT id, case_id, source, created_at FROM user_cases WHERE user_id = ? AND status = 'unopened' ORDER BY created_at`, userId,
  );
  const items = db.all<{ item_id: string; created_at: string }>('SELECT item_id, created_at FROM user_items WHERE user_id = ? ORDER BY created_at DESC', userId);
  const p = db.get<{ frame: string | null; name_color: string | null; card_back: string | null }>('SELECT frame, name_color, card_back FROM user_profiles WHERE user_id = ?', userId);
  return {
    cases: cases.map((c) => ({ id: c.id, caseId: c.case_id, source: c.source, createdAt: c.created_at })),
    items: items.filter((i) => COSMETIC_BY_ID[i.item_id]).map((i) => ({ ...COSMETIC_BY_ID[i.item_id]!, obtainedAt: i.created_at })),
    equipped: { frame: p?.frame ?? null, nameColor: p?.name_color ?? null, cardBack: p?.card_back ?? null },
    catalogSize: COSMETICS.length,
  };
}

const COLUMN: Record<CosmeticKind, 'frame' | 'name_color' | 'card_back'> = { frame: 'frame', nameColor: 'name_color', cardBack: 'card_back' };

export function equip(db: Database, userId: string, kind: CosmeticKind, itemId: string | null): void {
  if (itemId !== null) {
    const item = COSMETIC_BY_ID[itemId];
    if (!item || item.kind !== kind) throw new AppError(400, 'INVALID_ITEM', 'Ese objeto no corresponde');
    if (!db.get('SELECT 1 AS x FROM user_items WHERE user_id = ? AND item_id = ?', userId, itemId)) throw new AppError(403, 'NOT_OWNED', 'Todavía no tienes ese objeto');
  }
  db.run('INSERT INTO user_profiles (user_id, updated_at) VALUES (?, ?) ON CONFLICT DO NOTHING', userId, nowIso());
  db.run(`UPDATE user_profiles SET ${COLUMN[kind]} = ?, updated_at = ? WHERE user_id = ?`, itemId, nowIso(), userId);
}
