import type { Rng } from './rng';

/* ------------------------------------------------------------------------- */
/* Rueda europea (un solo cero)                                               */
/* ------------------------------------------------------------------------- */

/** Orden real de los bolsillos en la rueda europea, en sentido horario. */
export const WHEEL_ORDER: readonly number[] = [
  0, 32, 15, 19, 4, 21, 2, 25, 17, 34, 6, 27, 13, 36, 11, 30, 8, 23, 10, 5, 24, 16, 33, 1, 20, 14, 31, 9, 22, 18,
  29, 7, 28, 12, 35, 3, 26,
];

export const RED_NUMBERS: ReadonlySet<number> = new Set([
  1, 3, 5, 7, 9, 12, 14, 16, 18, 19, 21, 23, 25, 27, 30, 32, 34, 36,
]);

export type RouletteColor = 'red' | 'black' | 'green';

export function numberColor(n: number): RouletteColor {
  if (!Number.isInteger(n) || n < 0 || n > 36) throw new RangeError(`Número fuera de rango: ${n}`);
  if (n === 0) return 'green';
  return RED_NUMBERS.has(n) ? 'red' : 'black';
}

/* ------------------------------------------------------------------------- */
/* Apuestas                                                                   */
/* ------------------------------------------------------------------------- */

export type InsideKind = 'straight' | 'split' | 'street' | 'corner' | 'sixline';
export type DozenColumnKind = 'dozen' | 'column';
export type EvenKind = 'red' | 'black' | 'even' | 'odd' | 'low' | 'high';
export type RouletteBetKind = InsideKind | DozenColumnKind | EvenKind;

export type RouletteBet =
  | { kind: InsideKind; numbers: number[]; amount: number }
  | { kind: DozenColumnKind; index: 1 | 2 | 3; amount: number }
  | { kind: EvenKind; amount: number };

/** Pago "a uno" (ganancia neta por unidad apostada). */
export const ROULETTE_PAYOUTS: Readonly<Record<RouletteBetKind, number>> = {
  straight: 35,
  split: 17,
  street: 11,
  corner: 8,
  sixline: 5,
  dozen: 2,
  column: 2,
  red: 1,
  black: 1,
  even: 1,
  odd: 1,
  low: 1,
  high: 1,
};

export const ROULETTE_BET_LABELS: Readonly<Record<RouletteBetKind, string>> = {
  straight: 'Pleno',
  split: 'Caballo',
  street: 'Transversal',
  corner: 'Cuadro',
  sixline: 'Seisena',
  dozen: 'Docena',
  column: 'Columna',
  red: 'Rojo',
  black: 'Negro',
  even: 'Par',
  odd: 'Impar',
  low: 'Falta (1-18)',
  high: 'Pasa (19-36)',
};

export interface RouletteLimits {
  minBet: number;
  maxInside: number;
  maxOutside: number;
  maxTotal: number;
  maxBets: number;
}

export const DEFAULT_ROULETTE_LIMITS: RouletteLimits = {
  minBet: 1,
  maxInside: 1000,
  maxOutside: 10000,
  maxTotal: 50000,
  maxBets: 60,
};

export class RouletteError extends Error {
  constructor(public readonly code: string, message: string) {
    super(message);
  }
}

const sorted = (ns: readonly number[]): number[] => ns.slice().sort((a, b) => a - b);
const same = (a: readonly number[], b: readonly number[]): boolean =>
  a.length === b.length && a.every((v, i) => v === b[i]);

/** Comprueba que el conjunto de números forma una apuesta interior válida en el tapete. */
export function isValidInside(kind: InsideKind, numbersIn: readonly number[]): boolean {
  if (!numbersIn.every((n) => Number.isInteger(n) && n >= 0 && n <= 36)) return false;
  const ns = sorted(numbersIn);
  if (new Set(ns).size !== ns.length) return false;
  switch (kind) {
    case 'straight':
      return ns.length === 1;
    case 'split': {
      if (ns.length !== 2) return false;
      const [a, b] = ns as [number, number];
      if (a === 0) return b >= 1 && b <= 3;
      // Horizontal (misma fila, columnas contiguas) o vertical (misma transversal).
      return b - a === 3 || (b - a === 1 && a % 3 !== 0);
    }
    case 'street': {
      if (ns.length !== 3) return false;
      if (same(ns, [0, 1, 2]) || same(ns, [0, 2, 3])) return true; // tríos con el cero
      const [a] = ns as [number];
      return a >= 1 && a % 3 === 1 && same(ns, [a, a + 1, a + 2]);
    }
    case 'corner': {
      if (ns.length !== 4) return false;
      if (same(ns, [0, 1, 2, 3])) return true; // "primeros cuatro"
      const [a] = ns as [number];
      return a >= 1 && a % 3 !== 0 && a <= 32 && same(ns, [a, a + 1, a + 3, a + 4]);
    }
    case 'sixline': {
      if (ns.length !== 6) return false;
      const [a] = ns as [number];
      return a >= 1 && a % 3 === 1 && a <= 31 && same(ns, [a, a + 1, a + 2, a + 3, a + 4, a + 5]);
    }
  }
}

/** Números cubiertos por una apuesta. */
export function coveredNumbers(bet: RouletteBet): number[] {
  const all = Array.from({ length: 36 }, (_, i) => i + 1);
  switch (bet.kind) {
    case 'straight':
    case 'split':
    case 'street':
    case 'corner':
    case 'sixline':
      return sorted(bet.numbers);
    case 'dozen':
      return all.filter((n) => Math.ceil(n / 12) === bet.index);
    case 'column':
      return all.filter((n) => ((n - 1) % 3) + 1 === bet.index);
    case 'red':
      return all.filter((n) => RED_NUMBERS.has(n));
    case 'black':
      return all.filter((n) => !RED_NUMBERS.has(n));
    case 'even':
      return all.filter((n) => n % 2 === 0);
    case 'odd':
      return all.filter((n) => n % 2 === 1);
    case 'low':
      return all.filter((n) => n <= 18);
    case 'high':
      return all.filter((n) => n >= 19);
  }
}

const INSIDE: ReadonlySet<string> = new Set(['straight', 'split', 'street', 'corner', 'sixline']);

/** Valida un conjunto de apuestas y devuelve el total apostado. Lanza RouletteError si algo no es válido. */
export function validateRouletteBets(bets: readonly RouletteBet[], limits: RouletteLimits = DEFAULT_ROULETTE_LIMITS): number {
  if (!Array.isArray(bets) || bets.length === 0) throw new RouletteError('NO_BETS', 'No hay apuestas');
  if (bets.length > limits.maxBets) throw new RouletteError('TOO_MANY_BETS', `Máximo ${limits.maxBets} apuestas`);
  let total = 0;
  for (const bet of bets) {
    if (!(bet.kind in ROULETTE_PAYOUTS)) throw new RouletteError('INVALID_KIND', 'Tipo de apuesta desconocido');
    if (!Number.isInteger(bet.amount) || bet.amount < limits.minBet) {
      throw new RouletteError('INVALID_AMOUNT', `Apuesta mínima: ${limits.minBet}`);
    }
    const inside = INSIDE.has(bet.kind);
    const max = inside ? limits.maxInside : limits.maxOutside;
    if (bet.amount > max) throw new RouletteError('OVER_LIMIT', `Máximo por apuesta ${inside ? 'interior' : 'exterior'}: ${max}`);
    if (inside) {
      const b = bet as Extract<RouletteBet, { numbers: number[] }>;
      if (!Array.isArray(b.numbers) || !isValidInside(b.kind, b.numbers)) {
        throw new RouletteError('INVALID_NUMBERS', `Combinación no válida para ${ROULETTE_BET_LABELS[b.kind]}`);
      }
    } else if (bet.kind === 'dozen' || bet.kind === 'column') {
      if (![1, 2, 3].includes(bet.index)) throw new RouletteError('INVALID_INDEX', 'Índice de docena/columna no válido');
    }
    total += bet.amount;
  }
  if (total > limits.maxTotal) throw new RouletteError('OVER_TABLE_LIMIT', `Máximo total por giro: ${limits.maxTotal}`);
  return total;
}

export interface RouletteBetResult {
  bet: RouletteBet;
  won: boolean;
  /** Devuelto al jugador (apuesta + ganancia) o 0. */
  payout: number;
}

export interface RouletteResult {
  number: number;
  color: RouletteColor;
  /** Índice del bolsillo en WHEEL_ORDER (para la animación). */
  pocketIndex: number;
  totalBet: number;
  totalPayout: number;
  bets: RouletteBetResult[];
}

/** Liquida apuestas contra un número ganador. El cero hace perder todas las apuestas exteriores. */
export function settleRoulette(bets: readonly RouletteBet[], winning: number): RouletteResult {
  const color = numberColor(winning);
  let totalBet = 0;
  let totalPayout = 0;
  const results = bets.map((bet) => {
    totalBet += bet.amount;
    const won = coveredNumbers(bet).includes(winning);
    const payout = won ? bet.amount * (ROULETTE_PAYOUTS[bet.kind] + 1) : 0;
    totalPayout += payout;
    return { bet, won, payout };
  });
  return { number: winning, color, pocketIndex: WHEEL_ORDER.indexOf(winning), totalBet, totalPayout, bets: results };
}

/** Sorteo: un número uniforme 0..36 con el RNG del servidor. */
export function spinRoulette(rng: Rng): number {
  return rng.int(37);
}
