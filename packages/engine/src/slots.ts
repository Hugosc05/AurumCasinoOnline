import type { Rng } from './rng';

/* ------------------------------------------------------------------------- */
/* Configuración de la máquina "Aurum Royale" (5 rodillos × 3 filas)          */
/* ------------------------------------------------------------------------- */

export type SlotSymbol =
  | 'jack'
  | 'queen'
  | 'king'
  | 'ace'
  | 'clover'
  | 'bell'
  | 'diamond'
  | 'crown'
  | 'seven'
  | 'wild'
  | 'scatter';

export const SLOT_SYMBOLS: readonly SlotSymbol[] = [
  'jack', 'queen', 'king', 'ace', 'clover', 'bell', 'diamond', 'crown', 'seven', 'wild', 'scatter',
];

export const SLOT_SYMBOL_LABELS: Readonly<Record<SlotSymbol, string>> = {
  jack: 'J', queen: 'Q', king: 'K', ace: 'A', clover: 'Trébol', bell: 'Campana', diamond: 'Diamante',
  crown: 'Corona', seven: 'Siete', wild: 'Comodín', scatter: 'Estrella (scatter)',
};

export const REELS = 5;
export const ROWS = 3;

/**
 * Pagos de línea (multiplicador de la apuesta por línea) para 3, 4 y 5
 * símbolos consecutivos desde el rodillo izquierdo.
 */
export const LINE_PAYS: Readonly<Record<Exclude<SlotSymbol, 'scatter'>, readonly [number, number, number]>> = {
  jack: [8, 20, 90],
  queen: [8, 30, 110],
  king: [12, 40, 150],
  ace: [15, 45, 180],
  clover: [20, 75, 300],
  bell: [30, 100, 450],
  diamond: [45, 150, 750],
  crown: [60, 225, 1000],
  seven: [90, 400, 2000],
  wild: [150, 750, 5000],
};

/** Pagos de scatter (multiplicador de la apuesta TOTAL) para 3, 4 y 5 estrellas visibles en cualquier posición. */
export const SCATTER_PAYS: Readonly<Record<3 | 4 | 5, number>> = { 3: 2, 4: 10, 5: 50 };

/** Número de apariciones de cada símbolo en cada rodillo. */
export const REEL_COMPOSITION: readonly Readonly<Record<SlotSymbol, number>>[] = [
  { jack: 6, queen: 6, king: 5, ace: 5, clover: 4, bell: 3, diamond: 3, crown: 2, seven: 2, wild: 1, scatter: 2 },
  { jack: 6, queen: 5, king: 5, ace: 4, clover: 4, bell: 3, diamond: 3, crown: 2, seven: 2, wild: 2, scatter: 2 },
  { jack: 5, queen: 5, king: 5, ace: 4, clover: 4, bell: 3, diamond: 3, crown: 3, seven: 2, wild: 2, scatter: 2 },
  { jack: 6, queen: 5, king: 5, ace: 4, clover: 4, bell: 3, diamond: 3, crown: 2, seven: 2, wild: 2, scatter: 2 },
  { jack: 6, queen: 6, king: 5, ace: 5, clover: 4, bell: 3, diamond: 3, crown: 2, seven: 2, wild: 1, scatter: 2 },
];

/** 20 líneas de pago clásicas; cada entrada indica la fila (0 = superior) en cada rodillo. */
export const PAYLINES: readonly (readonly [number, number, number, number, number])[] = [
  [1, 1, 1, 1, 1],
  [0, 0, 0, 0, 0],
  [2, 2, 2, 2, 2],
  [0, 1, 2, 1, 0],
  [2, 1, 0, 1, 2],
  [0, 0, 1, 2, 2],
  [2, 2, 1, 0, 0],
  [1, 0, 0, 0, 1],
  [1, 2, 2, 2, 1],
  [1, 0, 1, 2, 1],
  [1, 2, 1, 0, 1],
  [0, 1, 1, 1, 0],
  [2, 1, 1, 1, 2],
  [0, 1, 0, 1, 0],
  [2, 1, 2, 1, 2],
  [1, 1, 0, 1, 1],
  [1, 1, 2, 1, 1],
  [0, 0, 2, 0, 0],
  [2, 2, 0, 2, 2],
  [0, 2, 2, 2, 0],
];

export interface SlotLimits {
  minBetPerLine: number;
  maxBetPerLine: number;
  allowedLines: readonly number[];
}

export const DEFAULT_SLOT_LIMITS: SlotLimits = {
  minBetPerLine: 1,
  maxBetPerLine: 100,
  allowedLines: [1, 5, 10, 15, 20],
};

/** Categorías de celebración según premio total / apuesta total. */
export type WinTier = 'none' | 'small' | 'medium' | 'big' | 'mega';
export function winTier(totalWin: number, totalBet: number): WinTier {
  if (totalWin <= 0 || totalBet <= 0) return 'none';
  const x = totalWin / totalBet;
  if (x >= 50) return 'mega';
  if (x >= 15) return 'big';
  if (x >= 4) return 'medium';
  return 'small';
}

/* ------------------------------------------------------------------------- */
/* Construcción determinista de las tiras de los rodillos                     */
/* ------------------------------------------------------------------------- */

/**
 * Reparte los símbolos de forma regular a lo largo de la tira. Los símbolos
 * con menos apariciones (los más valiosos y el scatter) se colocan primero con
 * separación máxima, de modo que nunca hay dos scatters en la misma ventana
 * visible de 3 posiciones (necesario para el cálculo exacto del RTP).
 */
export function buildStrip(composition: Readonly<Record<SlotSymbol, number>>, offset = 0): SlotSymbol[] {
  const length = SLOT_SYMBOLS.reduce((acc, s) => acc + composition[s], 0);
  const strip: (SlotSymbol | null)[] = Array.from({ length }, () => null);
  const order = SLOT_SYMBOLS.slice().sort((a, b) => composition[a] - composition[b] || SLOT_SYMBOLS.indexOf(b) - SLOT_SYMBOLS.indexOf(a));
  let shift = offset;
  for (const sym of order) {
    const count = composition[sym];
    for (let k = 0; k < count; k += 1) {
      let pos = (Math.floor((k * length) / count) + shift) % length;
      while (strip[pos] !== null) pos = (pos + 1) % length;
      strip[pos] = sym;
    }
    shift += 3;
  }
  return strip as SlotSymbol[];
}

export const REEL_STRIPS: readonly (readonly SlotSymbol[])[] = REEL_COMPOSITION.map((c, i) => buildStrip(c, i * 2));

/* ------------------------------------------------------------------------- */
/* Evaluación                                                                 */
/* ------------------------------------------------------------------------- */

export interface LineWin {
  line: number; // índice 0-based en PAYLINES
  symbol: Exclude<SlotSymbol, 'scatter'>;
  count: 3 | 4 | 5;
  multiplier: number;
  payout: number;
  /** Posiciones [rodillo, fila] implicadas. */
  cells: [number, number][];
}

export interface ScatterWin {
  count: 3 | 4 | 5;
  multiplier: number;
  payout: number;
  cells: [number, number][];
}

/** Multiplicador de una línea concreta de 5 símbolos (sin considerar la apuesta). */
export function evaluateLineSymbols(symbols: readonly SlotSymbol[]): { symbol: Exclude<SlotSymbol, 'scatter'>; count: 3 | 4 | 5; multiplier: number } | null {
  let wildRun = 0;
  while (wildRun < symbols.length && symbols[wildRun] === 'wild') wildRun += 1;

  let best: { symbol: Exclude<SlotSymbol, 'scatter'>; count: 3 | 4 | 5; multiplier: number } | null = null;
  if (wildRun >= 3) {
    const count = Math.min(wildRun, 5) as 3 | 4 | 5;
    best = { symbol: 'wild', count, multiplier: LINE_PAYS.wild[count - 3]! };
  }
  const target = symbols[wildRun];
  if (target !== undefined && target !== 'scatter' && target !== 'wild') {
    let count = wildRun;
    while (count < symbols.length && (symbols[count] === target || symbols[count] === 'wild')) count += 1;
    if (count >= 3) {
      const c = Math.min(count, 5) as 3 | 4 | 5;
      const m = LINE_PAYS[target][c - 3]!;
      if (!best || m > best.multiplier) best = { symbol: target, count: c, multiplier: m };
    }
  }
  return best;
}

export type SlotGrid = SlotSymbol[][]; // grid[reel][row]

export function gridFromStops(stops: readonly number[], strips: readonly (readonly SlotSymbol[])[] = REEL_STRIPS): SlotGrid {
  return stops.map((stop, reel) => {
    const strip = strips[reel]!;
    return Array.from({ length: ROWS }, (_, row) => strip[(stop + row) % strip.length]!);
  });
}

export interface SlotSpinResult {
  stops: number[];
  grid: SlotGrid;
  lines: number;
  betPerLine: number;
  totalBet: number;
  lineWins: LineWin[];
  scatterWin: ScatterWin | null;
  totalWin: number;
  tier: WinTier;
}

export class SlotError extends Error {
  constructor(public readonly code: string, message: string) {
    super(message);
  }
}

export function validateSlotBet(betPerLine: number, lines: number, limits: SlotLimits = DEFAULT_SLOT_LIMITS): number {
  if (!Number.isInteger(betPerLine) || betPerLine < limits.minBetPerLine || betPerLine > limits.maxBetPerLine) {
    throw new SlotError('INVALID_BET', `Apuesta por línea entre ${limits.minBetPerLine} y ${limits.maxBetPerLine}`);
  }
  if (!limits.allowedLines.includes(lines)) {
    throw new SlotError('INVALID_LINES', `Líneas permitidas: ${limits.allowedLines.join(', ')}`);
  }
  return betPerLine * lines;
}

/** Evalúa una cuadrícula ya determinada. */
export function evaluateSlotGrid(grid: SlotGrid, betPerLine: number, lines: number): Omit<SlotSpinResult, 'stops'> {
  const totalBet = betPerLine * lines;
  const lineWins: LineWin[] = [];
  for (let li = 0; li < lines; li += 1) {
    const rows = PAYLINES[li]!;
    const symbols = rows.map((row, reel) => grid[reel]![row]!);
    const win = evaluateLineSymbols(symbols);
    if (win) {
      lineWins.push({
        line: li,
        symbol: win.symbol,
        count: win.count,
        multiplier: win.multiplier,
        payout: win.multiplier * betPerLine,
        cells: rows.slice(0, win.count).map((row, reel) => [reel, row]),
      });
    }
  }
  const scatterCells: [number, number][] = [];
  grid.forEach((col, reel) => col.forEach((s, row) => {
    if (s === 'scatter') scatterCells.push([reel, row]);
  }));
  let scatterWin: ScatterWin | null = null;
  if (scatterCells.length >= 3) {
    const count = Math.min(scatterCells.length, 5) as 3 | 4 | 5;
    const multiplier = SCATTER_PAYS[count];
    scatterWin = { count, multiplier, payout: multiplier * totalBet, cells: scatterCells };
  }
  const totalWin = lineWins.reduce((a, w) => a + w.payout, 0) + (scatterWin?.payout ?? 0);
  return { grid, lines, betPerLine, totalBet, lineWins, scatterWin, totalWin, tier: winTier(totalWin, totalBet) };
}

/** Tirada completa: el RNG elige la parada de cada rodillo de forma uniforme e independiente. */
export function spinSlots(rng: Rng, betPerLine: number, lines: number, limits: SlotLimits = DEFAULT_SLOT_LIMITS): SlotSpinResult {
  validateSlotBet(betPerLine, lines, limits);
  const stops = REEL_STRIPS.map((strip) => rng.int(strip.length));
  const grid = gridFromStops(stops);
  return { stops, ...evaluateSlotGrid(grid, betPerLine, lines) };
}

/* ------------------------------------------------------------------------- */
/* RTP teórico exacto                                                         */
/* ------------------------------------------------------------------------- */

export interface RtpReport {
  lineRtp: number;
  scatterRtp: number;
  totalRtp: number;
  hitFrequencyPerLine: number;
  combinations: number;
}

/**
 * Calcula el RTP exacto a partir de las tiras y la tabla de pagos.
 *
 * - Línea: en cualquier línea, el símbolo de cada rodillo es uniforme sobre su
 *   tira e independiente entre rodillos, así que se enumeran todas las
 *   combinaciones de símbolos ponderadas por su frecuencia.
 * - Scatter: con separación ≥ 3 entre scatters, la probabilidad de ver uno en
 *   un rodillo es 3·n/L; el número total sigue una distribución de Poisson-binomial.
 *
 * El RTP es independiente del número de líneas activas (los pagos de línea se
 * expresan sobre la apuesta por línea y los de scatter sobre la total).
 */
export function computeRtp(strips: readonly (readonly SlotSymbol[])[] = REEL_STRIPS): RtpReport {
  const freq = strips.map((strip) => {
    const m = new Map<SlotSymbol, number>();
    for (const s of strip) m.set(s, (m.get(s) ?? 0) + 1);
    return { m, len: strip.length };
  });
  let lineRtp = 0;
  let hit = 0;
  let combinations = 1;
  for (const f of freq) combinations *= f.len;
  const syms = SLOT_SYMBOLS;
  const current: SlotSymbol[] = [];
  const rec = (reel: number, prob: number): void => {
    if (reel === REELS) {
      const win = evaluateLineSymbols(current);
      if (win) {
        lineRtp += prob * win.multiplier;
        hit += prob;
      }
      return;
    }
    const f = freq[reel]!;
    for (const s of syms) {
      const n = f.m.get(s) ?? 0;
      if (n === 0) continue;
      current[reel] = s;
      rec(reel + 1, prob * (n / f.len));
    }
    current.length = reel;
  };
  rec(0, 1);

  // Scatter: distribución del número de rodillos con scatter visible.
  let dist = [1];
  for (const f of freq) {
    const p = (ROWS * (f.m.get('scatter') ?? 0)) / f.len;
    const next = Array.from({ length: dist.length + 1 }, () => 0);
    dist.forEach((q, k) => {
      next[k]! += q * (1 - p);
      next[k + 1]! += q * p;
    });
    dist = next;
  }
  let scatterRtp = 0;
  for (const k of [3, 4, 5] as const) scatterRtp += (dist[k] ?? 0) * SCATTER_PAYS[k];
  return { lineRtp, scatterRtp, totalRtp: lineRtp + scatterRtp, hitFrequencyPerLine: hit, combinations };
}

/** Comprueba que ninguna ventana visible de un rodillo contiene dos scatters. */
export function scatterSpacingOk(strips: readonly (readonly SlotSymbol[])[] = REEL_STRIPS): boolean {
  return strips.every((strip) => {
    for (let i = 0; i < strip.length; i += 1) {
      let c = 0;
      for (let r = 0; r < ROWS; r += 1) if (strip[(i + r) % strip.length] === 'scatter') c += 1;
      if (c > 1) return false;
    }
    return true;
  });
}
