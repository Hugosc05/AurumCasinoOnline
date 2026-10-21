import type { Database } from '../db/database';
import { nowIso } from '../db/database';
import { AppError, notFound } from '../lib/errors';

export type WalletReason =
  | 'signup_bonus'
  | 'daily_bonus'
  | 'demo_refill'
  | 'bet'
  | 'payout'
  | 'poker_buyin'
  | 'poker_cashout'
  | 'admin_adjustment'
  | 'refund'
  | 'ad_reward';

export interface WalletMove {
  userId: string;
  amount: number;
  balanceBefore: number;
  balanceAfter: number;
  unlimited: boolean;
  transactionId: number;
}

interface Opts {
  roundId?: string | null;
  meta?: Record<string, unknown> | null;
}

/**
 * Aplica un movimiento al monedero dentro de la transacción en curso.
 *
 * - Importes enteros (créditos virtuales sin decimales).
 * - Nunca deja saldo negativo: la actualización es condicional (`balance + ? >= 0`)
 *   y la columna tiene `CHECK (balance >= 0)`.
 * - Cuentas administradoras: saldo ilimitado. El movimiento se registra en el
 *   libro mayor con `unlimited = 1`, pero el saldo almacenado no cambia. El rol
 *   se lee SIEMPRE de la base de datos, nunca de la petición.
 */
export function applyWalletMove(db: Database, userId: string, amount: number, reason: WalletReason, opts: Opts = {}): WalletMove {
  if (!Number.isSafeInteger(amount)) throw new AppError(400, 'INVALID_AMOUNT', 'Importe no válido');
  return db.tx(() => {
    const user = db.get<{ balance: number; role: string; status: string }>('SELECT balance, role, status FROM users WHERE id = ?', userId);
    if (!user) throw notFound('Usuario no encontrado');
    const unlimited = user.role === 'admin';
    const before = user.balance;
    let after = before;
    if (!unlimited && amount !== 0) {
      const r = db.run('UPDATE users SET balance = balance + ? WHERE id = ? AND balance + ? >= 0', amount, userId, amount);
      if (r.changes !== 1) throw new AppError(402, 'INSUFFICIENT_FUNDS', 'Saldo virtual insuficiente');
      after = before + amount;
    }
    const tx = db.get<{ id: number }>(
      `INSERT INTO wallet_transactions (user_id, amount, balance_before, balance_after, reason, round_id, unlimited, meta_json, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?) RETURNING id`,
      userId, amount, before, after, reason, opts.roundId ?? null, unlimited ? 1 : 0, opts.meta ? JSON.stringify(opts.meta) : null, nowIso(),
    );
    return { userId, amount, balanceBefore: before, balanceAfter: after, unlimited, transactionId: Number(tx!.id) };
  });
}

export function debit(db: Database, userId: string, amount: number, reason: WalletReason, opts: Opts = {}): WalletMove {
  if (!Number.isSafeInteger(amount) || amount <= 0) throw new AppError(400, 'INVALID_AMOUNT', 'Importe no válido');
  return applyWalletMove(db, userId, -amount, reason, opts);
}

export function credit(db: Database, userId: string, amount: number, reason: WalletReason, opts: Opts = {}): WalletMove {
  if (!Number.isSafeInteger(amount) || amount < 0) throw new AppError(400, 'INVALID_AMOUNT', 'Importe no válido');
  return applyWalletMove(db, userId, amount, reason, opts);
}

export interface BalanceView {
  balance: number | null;
  unlimited: boolean;
}

export function getBalance(db: Database, userId: string): BalanceView {
  const u = db.get<{ balance: number; role: string }>('SELECT balance, role FROM users WHERE id = ?', userId);
  if (!u) throw notFound('Usuario no encontrado');
  return u.role === 'admin' ? { balance: null, unlimited: true } : { balance: u.balance, unlimited: false };
}

/** Comprobación de integridad: el saldo coincide con el último movimiento del libro mayor. */
export function verifyLedger(db: Database, userId: string): { ok: boolean; balance: number; ledgerBalance: number | null; sum: number } {
  const u = db.get<{ balance: number }>('SELECT balance FROM users WHERE id = ?', userId);
  const last = db.get<{ balance_after: number }>('SELECT balance_after FROM wallet_transactions WHERE user_id = ? ORDER BY id DESC LIMIT 1', userId);
  const sum = db.get<{ s: number | null }>('SELECT SUM(balance_after - balance_before) AS s FROM wallet_transactions WHERE user_id = ?', userId)?.s ?? 0;
  const balance = u?.balance ?? 0;
  const ledgerBalance = last?.balance_after ?? null;
  return { ok: (ledgerBalance ?? 0) === balance && sum === balance, balance, ledgerBalance, sum };
}
