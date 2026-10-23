import type { Rng } from './rng';

/**
 * Plinko: la bola cae por `rows` filas de clavos y en cada una rebota a la
 * izquierda o a la derecha con probabilidad 1/2. La casilla final es el número
 * de rebotes a la derecha (0..rows), así que sigue una distribución binomial:
 * la campana de Gauss que se ve al lanzar muchas bolas.
 *
 * El servidor sortea la ruta completa antes de que la bola empiece a caer; la
 * interfaz solo la dibuja.
 */

export type PlinkoRisk = 'low' | 'medium' | 'high';
export const PLINKO_ROWS = [8, 12, 16] as const;
export type PlinkoRows = (typeof PLINKO_ROWS)[number];
export const PLINKO_RISKS: readonly PlinkoRisk[] = ['low', 'medium', 'high'];
export const PLINKO_RISK_LABEL: Record<PlinkoRisk, string> = { low: 'Bajo', medium: 'Medio', high: 'Alto' };

/** Mitad izquierda de cada tabla (de la casilla del borde al centro); la otra mitad es simétrica. */
const HALVES: Record<PlinkoRows, Record<PlinkoRisk, number[]>> = {
  8: { low: [5.6, 2.1, 1.1, 1, 0.5], medium: [13, 3, 1.3, 0.7, 0.4], high: [29, 4, 1.5, 0.3, 0.2] },
  12: { low: [10, 3, 1.6, 1.4, 1.1, 1, 0.5], medium: [33, 11, 4, 2, 1.1, 0.6, 0.3], high: [170, 24, 8.1, 2, 0.7, 0.2, 0.2] },
  16: {
    low: [16, 9, 2, 1.4, 1.4, 1.2, 1.1, 1, 0.5],
    medium: [110, 41, 10, 5, 3, 1.5, 1, 0.5, 0.3],
    high: [1000, 130, 26, 9, 4, 2, 0.2, 0.2, 0.2],
  },
};

/** Multiplicadores de las rows + 1 casillas, de izquierda a derecha. */
export function plinkoTable(rows: PlinkoRows, risk: PlinkoRisk): number[] {
  const half = HALVES[rows][risk];
  return [...half, ...half.slice(0, -1).reverse()];
}

export const PLINKO_LIMITS = { minBet: 1, maxBet: 5000 } as const;

export class PlinkoError extends Error {
  constructor(readonly code: string, message: string) {
    super(message);
  }
}

export function validatePlinko(rows: number, risk: string, bet: number): asserts rows is PlinkoRows {
  if (!(PLINKO_ROWS as readonly number[]).includes(rows)) throw new PlinkoError('INVALID_ROWS', 'Número de filas no válido');
  if (!(PLINKO_RISKS as readonly string[]).includes(risk)) throw new PlinkoError('INVALID_RISK', 'Nivel de riesgo no válido');
  if (!Number.isInteger(bet) || bet < PLINKO_LIMITS.minBet || bet > PLINKO_LIMITS.maxBet) {
    throw new PlinkoError('INVALID_BET', `La apuesta debe estar entre ${PLINKO_LIMITS.minBet} y ${PLINKO_LIMITS.maxBet}`);
  }
}

export interface PlinkoResult {
  rows: PlinkoRows;
  risk: PlinkoRisk;
  bet: number;
  /** 0 = rebote a la izquierda, 1 = a la derecha, uno por fila. */
  path: number[];
  bucket: number;
  multiplier: number;
  /** Premio en créditos enteros (se redondea hacia abajo). */
  payout: number;
}

export function dropPlinko(rows: PlinkoRows, risk: PlinkoRisk, bet: number, rng: Rng): PlinkoResult {
  validatePlinko(rows, risk, bet);
  const path = Array.from({ length: rows }, () => rng.int(2));
  const bucket = path.reduce((a, b) => a + b, 0);
  const multiplier = plinkoTable(rows, risk)[bucket]!;
  return { rows, risk, bet, path, bucket, multiplier, payout: Math.floor(bet * multiplier + 1e-9) };
}

function binom(n: number, k: number): number {
  let r = 1;
  for (let i = 1; i <= k; i += 1) r = (r * (n - k + i)) / i;
  return r;
}

/** Probabilidad exacta de cada casilla: C(n, k) / 2^n. */
export function plinkoOdds(rows: PlinkoRows): number[] {
  return Array.from({ length: rows + 1 }, (_, k) => binom(rows, k) / 2 ** rows);
}

/** RTP exacto (sin el redondeo a créditos enteros, que solo afecta a apuestas pequeñas). */
export function plinkoRtp(rows: PlinkoRows, risk: PlinkoRisk): number {
  const odds = plinkoOdds(rows);
  return plinkoTable(rows, risk).reduce((a, m, k) => a + m * odds[k]!, 0);
}
