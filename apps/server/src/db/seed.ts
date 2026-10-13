import { randomUUID } from 'node:crypto';
import type { Database } from './database';
import { nowIso } from './database';

export interface GameSettings {
  blackjack: boolean;
  roulette: boolean;
  slots: boolean;
  poker: boolean;
}

export const DEFAULT_SETTINGS = {
  gamesEnabled: { blackjack: true, roulette: true, slots: true, poker: true } as GameSettings,
  dailyBonus: 1000,
  demoRefillAmount: 5000,
  demoRefillThreshold: 500,
  maintenanceMessage: '' as string,
};
export type SettingsShape = typeof DEFAULT_SETTINGS;

/**
 * Bots de demostración. Sus nombres llevan el prefijo "Bot" y se marcan como
 * bots en todas las vistas: nunca se presentan como personas reales.
 */
const DEMO_BOTS: { name: string; profile: 'conservative' | 'aggressive' | 'balanced' | 'analytical'; difficulty: 'easy' | 'normal' | 'hard' }[] = [
  { name: 'Bot Atlas', profile: 'analytical', difficulty: 'hard' },
  { name: 'Bot Brisa', profile: 'conservative', difficulty: 'normal' },
  { name: 'Bot Ciro', profile: 'aggressive', difficulty: 'normal' },
  { name: 'Bot Dalia', profile: 'balanced', difficulty: 'normal' },
  { name: 'Bot Eco', profile: 'analytical', difficulty: 'normal' },
  { name: 'Bot Fénix', profile: 'aggressive', difficulty: 'hard' },
  { name: 'Bot Gaia', profile: 'conservative', difficulty: 'easy' },
  { name: 'Bot Hugo', profile: 'balanced', difficulty: 'easy' },
  { name: 'Bot Iris', profile: 'balanced', difficulty: 'hard' },
  { name: 'Bot Jano', profile: 'conservative', difficulty: 'hard' },
  { name: 'Bot Kira', profile: 'aggressive', difficulty: 'easy' },
  { name: 'Bot Lince', profile: 'analytical', difficulty: 'easy' },
  { name: 'Bot Mora', profile: 'balanced', difficulty: 'normal' },
  { name: 'Bot Nilo', profile: 'conservative', difficulty: 'normal' },
  { name: 'Bot Onix', profile: 'analytical', difficulty: 'hard' },
  { name: 'Bot Pira', profile: 'aggressive', difficulty: 'normal' },
];

const DEMO_TABLES = [
  { id: 'esmeralda', name: 'Salón Esmeralda', sb: 5, bb: 10, min: 200, max: 2000, seats: 6, bots: 4, target: 4, order: 1 },
  { id: 'zafiro', name: 'Mesa Zafiro', sb: 25, bb: 50, min: 1000, max: 10000, seats: 6, bots: 4, target: 5, order: 2 },
  { id: 'obsidiana', name: 'Sala Obsidiana', sb: 100, bb: 200, min: 4000, max: 40000, seats: 6, bots: 3, target: 4, order: 3 },
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
    for (const b of DEMO_BOTS) {
      bots += db.run(
        'INSERT OR IGNORE INTO bots (id, name, profile, difficulty, created_at) VALUES (?, ?, ?, ?, ?)',
        randomUUID(), b.name, b.profile, b.difficulty, now,
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
