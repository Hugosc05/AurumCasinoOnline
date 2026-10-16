import type { Database } from '../db/database';
import { nowIso } from '../db/database';
import { getSetting } from '../db/seed';
import { AppError, conflict } from '../lib/errors';
import { credit, getBalance, type BalanceView } from '../wallet/wallet';
import { isValidTimezone, periodInfo, shiftDay } from './period';

export function economyTimezone(db: Database): string {
  const tz = getSetting(db, 'dailyTimezone');
  return isValidTimezone(tz) ? tz : 'Europe/Madrid';
}

export interface DailyStatus {
  day: string;
  timezone: string;
  claimed: boolean;
  amount: number;
  base: number;
  streak: { enabled: boolean; days: number; maxSteps: number; step: number; bonus: number };
  nextResetAt: string;
  msUntilReset: number;
  history: { day: string; amount: number; at: string }[];
}

/**
 * Racha amable: cuenta los días reclamados en los 6 días anteriores. Si un
 * día no se reclama, ese día simplemente no suma; no hay castigo ni reinicio.
 */
function streakDays(db: Database, userId: string, day: string): number {
  const from = shiftDay(day, -6);
  return db.get<{ n: number }>(
    `SELECT COUNT(*) AS n FROM daily_claims WHERE user_id = ? AND kind = 'daily_bonus' AND day >= ? AND day < ?`,
    userId, from, day,
  )!.n;
}

export function dailyStatus(db: Database, userId: string, now = new Date()): DailyStatus {
  const tz = economyTimezone(db);
  const p = periodInfo(now, tz);
  const base = getSetting(db, 'dailyBonus');
  const enabled = getSetting(db, 'dailyStreakEnabled');
  const step = getSetting(db, 'dailyStreakStep');
  const maxSteps = getSetting(db, 'dailyStreakMaxSteps');
  const today = db.get<{ amount: number }>(`SELECT amount FROM daily_claims WHERE user_id = ? AND kind = 'daily_bonus' AND day = ?`, userId, p.day);
  const days = streakDays(db, userId, p.day);
  const bonus = enabled ? step * Math.min(days, maxSteps) : 0;
  return {
    day: p.day,
    timezone: tz,
    claimed: !!today,
    amount: today ? today.amount : base + bonus,
    base,
    streak: { enabled, days, maxSteps, step, bonus },
    nextResetAt: p.nextResetAt,
    msUntilReset: p.msUntilReset,
    history: db.all<{ day: string; amount: number; at: string }>(
      `SELECT day, amount, created_at AS at FROM daily_claims WHERE user_id = ? AND kind = 'daily_bonus' ORDER BY day DESC LIMIT 10`,
      userId,
    ),
  };
}

/**
 * Reclama la recompensa del periodo vigente. La clave primaria
 * (usuario, tipo, día) impide cobrarla dos veces, también con peticiones
 * simultáneas: la inserción y el abono van en la misma transacción.
 */
export function claimDaily(db: Database, userId: string, role: string, now = new Date()): { balance: BalanceView; amount: number; status: DailyStatus } {
  if (role === 'admin') throw new AppError(400, 'NOT_APPLICABLE', 'Las cuentas administradoras tienen saldo ilimitado');
  return db.tx(() => {
    const st = dailyStatus(db, userId, now);
    if (st.claimed) throw conflict('ALREADY_CLAIMED', 'Ya has reclamado la recompensa de hoy', { nextResetAt: st.nextResetAt });
    try {
      db.run('INSERT INTO daily_claims (user_id, kind, day, amount, created_at) VALUES (?, ?, ?, ?, ?)', userId, 'daily_bonus', st.day, st.amount, nowIso());
    } catch (err) {
      if (String(err).includes('UNIQUE') || String(err).includes('PRIMARY')) throw conflict('ALREADY_CLAIMED', 'Ya has reclamado la recompensa de hoy');
      throw err;
    }
    credit(db, userId, st.amount, 'daily_bonus', { meta: { day: st.day, streakDays: st.streak.days } });
    return { balance: getBalance(db, userId), amount: st.amount, status: dailyStatus(db, userId, now) };
  });
}
