/* ------------------------------------------------------------------------- */
/* Elementos comunes de las tragaperras (5 rodillos × 3 filas, 20 líneas).   */
/* Cada máquina concreta se define en slotMachines.ts.                        */
/* ------------------------------------------------------------------------- */

export const REELS = 5;
export const ROWS = 3;

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

