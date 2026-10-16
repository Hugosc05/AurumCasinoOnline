import { randomUUID } from 'node:crypto';
import type { Database } from './database';
import { nowIso } from './database';
import { BOT_CATALOG } from '../bots/catalog';

export interface GameSettings {
  blackjack: boolean;
  roulette: boolean;
  slots: boolean;
  poker: boolean;
}

export const DEFAULT_SETTINGS = {
  gamesEnabled: { blackjack: true, roulette: true, slots: true, poker: true } as GameSettings,
  /** Saldo inicial de las cuentas nuevas (se concede una sola vez, al registrarse). null = valor de STARTING_BALANCE. */
  startingBalance: null as number | null,
  dailyBonus: 1000,
  /** Zona horaria que define el día de la recompensa diaria. */
  dailyTimezone: 'Europe/Madrid',
  /** Racha amable: cada día reclamado en la última semana suma un extra; saltarse un día no la reinicia. */
  dailyStreakEnabled: true,
  dailyStreakStep: 100,
  dailyStreakMaxSteps: 6,
  demoRefillAmount: 5000,
  demoRefillThreshold: 500,
  /** Anuncios recompensados (solo si hay un proveedor configurado en el servidor). */
  adsRewardAmount: 250,
  adsDailyLimit: 5,
  adsMinWatchSeconds: 15,
  maintenanceMessage: '' as string,
};
export type SettingsShape = typeof DEFAULT_SETTINGS;

const DEMO_TABLES = [
  { id: 'esmeralda', name: 'Salón Esmeralda', sb: 5, bb: 10, min: 200, max: 2000, seats: 6, bots: 4, target: 4, order: 1 },
  { id: 'zafiro', name: 'Mesa Zafiro', sb: 25, bb: 50, min: 1000, max: 10000, seats: 6, bots: 4, target: 5, order: 2 },
  { id: 'obsidiana', name: 'Sala Obsidiana', sb: 100, bb: 200, min: 4000, max: 40000, seats: 6, bots: 3, target: 4, order: 3 },
  // Mesa pública sin bots: solo juega cuando se sientan al menos dos personas.
  { id: 'marfil', name: 'Mesa Marfil', sb: 10, bb: 20, min: 400, max: 4000, seats: 6, bots: 0, target: 0, order: 4 },
];

const BJ_TABLES = [
  { id: 'rubi', name: 'Mesa Rubí', min: 10, max: 500, seats: 5, bots: 3, target: 3, order: 1 },
  { id: 'onix', name: 'Mesa Ónix', min: 50, max: 2500, seats: 5, bots: 2, target: 3, order: 2 },
  { id: 'nacar', name: 'Mesa Nácar', min: 10, max: 1000, seats: 5, bots: 0, target: 0, order: 3 },
];

/** Datos de demostración reproducibles e idempotentes (no sobrescribe cambios del administrador). */
export function seed(db: Database): { bots: number; tables: number } {
  const now = nowIso();
  let bots = 0;
  let tables = 0;
  db.tx(() => {
    for (const [key, value] of Object.entries(DEFAULT_SETTINGS)) {
      db.run('INSERT OR IGNORE INTO settings (key, value_json, updated_at) VALUES (?, ?, ?)', key, JSON.stringify(value), now);
    }
    bots += seedBots(db, now);
    for (const t of BJ_TABLES) {
      tables += db.run(
        `INSERT OR IGNORE INTO blackjack_tables (id, name, min_bet, max_bet, min_buy_in, max_buy_in, max_seats, max_bots, target_players, sort_order, created_at)
         VALUES (?, ?, ?, ?, 0, 0, ?, ?, ?, ?, ?)`,
        t.id, t.name, t.min, t.max, t.seats, t.bots, t.target, t.order, now,
      ).changes;
    }
    for (const t of DEMO_TABLES) {
      tables += db.run(
        `INSERT OR IGNORE INTO poker_tables (id, name, small_blind, big_blind, min_buy_in, max_buy_in, max_seats, max_bots, target_players, sort_order, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        t.id, t.name, t.sb, t.bb, t.min, t.max, t.seats, t.bots, t.target, t.order, now,
      ).changes;
    }
  });
  return { bots, tables };
}

/**
 * Bots del catálogo. Los bots de versiones anteriores ("Bot Atlas"…) se
 * renombran conservando su id e historial. Si un usuario humano ya usa un
 * nombre del catálogo, ese bot no se crea, para no confundirse con él.
 */
function seedBots(db: Database, now: string): number {
  let n = 0;
  for (const b of BOT_CATALOG) {
    const clash = db.get('SELECT 1 AS x FROM users WHERE lower(username) = lower(?)', b.name);
    if (clash) continue;
    const identity = [JSON.stringify(b.avatar), b.experience, b.betStyle, b.bjStrategy, b.tagline] as const;
    const existing = db.get<{ id: string }>('SELECT id FROM bots WHERE name = ?', b.name);
    if (existing) {
      // Solo se completa la identidad si aún está vacía (no pisa cambios del administrador).
      db.run(
        `UPDATE bots SET avatar_json = ?, experience = ?, bet_style = ?, bj_strategy = ?, tagline = ? WHERE id = ? AND avatar_json = '{}'`,
        ...identity, existing.id,
      );
      continue;
    }
    const legacy = b.legacy ? db.get<{ id: string }>('SELECT id FROM bots WHERE name = ?', b.legacy) : undefined;
    if (legacy) {
      db.run(
        'UPDATE bots SET name = ?, avatar_json = ?, experience = ?, bet_style = ?, bj_strategy = ?, tagline = ? WHERE id = ?',
        b.name, ...identity, legacy.id,
      );
      n += 1;
      continue;
    }
    n += db.run(
      `INSERT INTO bots (id, name, profile, difficulty, avatar_json, experience, bet_style, bj_strategy, tagline, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      randomUUID(), b.name, b.profile, b.difficulty, ...identity, now,
    ).changes;
  }
  return n;
}

export function getSetting<K extends keyof SettingsShape>(db: Database, key: K): SettingsShape[K] {
  const row = db.get<{ value_json: string }>('SELECT value_json FROM settings WHERE key = ?', key);
  if (!row) return DEFAULT_SETTINGS[key];
  try {
    return JSON.parse(row.value_json) as SettingsShape[K];
  } catch {
    return DEFAULT_SETTINGS[key];
  }
}

export function setSetting<K extends keyof SettingsShape>(db: Database, key: K, value: SettingsShape[K]): void {
  db.run(
    `INSERT INTO settings (key, value_json, updated_at) VALUES (?, ?, ?)
     ON CONFLICT(key) DO UPDATE SET value_json = excluded.value_json, updated_at = excluded.updated_at`,
    key, JSON.stringify(value), nowIso(),
  );
}
