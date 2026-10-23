import type { Rng } from './rng';

/**
 * Bingo de 90 bolas (el de las salas españolas).
 *
 * Cartón de 3 filas × 9 columnas con 15 números: 5 por fila y al menos uno
 * por columna. La columna 1 lleva del 1 al 9, la 2 del 10 al 19 … y la 9 del
 * 80 al 90; dentro de cada columna los números van de menor a mayor hacia
 * abajo. Premios: línea (la primera fila completa) y bingo (el cartón entero).
 */

export const BINGO_BALLS = 90;
export const BINGO_ROWS = 3;
export const BINGO_COLS = 9;
/** Reparto del bote: línea 20 %, bingo 70 % (devolución 90 % para cada cartón, con o sin cartones de la casa). */
export const BINGO_LINE_SHARE = 0.2;
export const BINGO_BINGO_SHARE = 0.7;
export const BINGO_MAX_CARDS = 6;

export type BingoCard = (number | null)[][];

const colRange = (c: number): [number, number] => (c === 0 ? [1, 9] : c === 8 ? [80, 90] : [c * 10, c * 10 + 9]);
export const bingoColumnOf = (n: number): number => (n >= 90 ? 8 : Math.floor(n / 10));

function shuffle<T>(a: T[], rng: Rng): T[] {
  for (let i = a.length - 1; i > 0; i -= 1) {
    const j = rng.int(i + 1);
    [a[i], a[j]] = [a[j]!, a[i]!];
  }
  return a;
}

/** Genera un cartón válido. */
export function generateBingoCard(rng: Rng): BingoCard {
  // Reparto de huecos: 5 por fila, toda columna con al menos un número.
  let layout: boolean[][];
  for (;;) {
    layout = Array.from({ length: BINGO_ROWS }, () => {
      const cols = shuffle([0, 1, 2, 3, 4, 5, 6, 7, 8], rng).slice(0, 5);
      return Array.from({ length: BINGO_COLS }, (_, c) => cols.includes(c));
    });
    if (Array.from({ length: BINGO_COLS }, (_, c) => layout.some((row) => row[c])).every(Boolean)) break;
  }
  const card: BingoCard = Array.from({ length: BINGO_ROWS }, () => Array.from({ length: BINGO_COLS }, () => null));
  for (let c = 0; c < BINGO_COLS; c += 1) {
    const rows = [0, 1, 2].filter((r) => layout[r]![c]);
    const [lo, hi] = colRange(c);
    const pool = shuffle(Array.from({ length: hi - lo + 1 }, (_, i) => lo + i), rng).slice(0, rows.length).sort((a, b) => a - b);
    rows.forEach((r, k) => (card[r]![c] = pool[k]!));
  }
  return card;
}

export function bingoCardNumbers(card: BingoCard): number[] {
  return card.flat().filter((n): n is number => n !== null);
}

export function isValidBingoCard(card: BingoCard): boolean {
  if (card.length !== BINGO_ROWS || card.some((r) => r.length !== BINGO_COLS)) return false;
  if (card.some((r) => r.filter((n) => n !== null).length !== 5)) return false;
  const nums = bingoCardNumbers(card);
  if (new Set(nums).size !== 15) return false;
  for (let c = 0; c < BINGO_COLS; c += 1) {
    const col = card.map((r) => r[c]).filter((n): n is number => n !== null);
    if (col.length === 0) return false;
    const [lo, hi] = colRange(c);
    if (col.some((n) => n < lo || n > hi)) return false;
    if (col.some((n, i) => i > 0 && n <= col[i - 1]!)) return false;
  }
  return true;
}

/** Orden de extracción: las 90 bolas barajadas al empezar (el servidor no la revela). */
export function drawOrder(rng: Rng): number[] {
  return shuffle(Array.from({ length: BINGO_BALLS }, (_, i) => i + 1), rng);
}

export function hasLine(card: BingoCard, drawn: ReadonlySet<number>): boolean {
  return card.some((row) => row.every((n) => n === null || drawn.has(n)));
}

export function hasBingo(card: BingoCard, drawn: ReadonlySet<number>): boolean {
  return bingoCardNumbers(card).every((n) => drawn.has(n));
}

/** Números que le faltan al cartón para la línea más cercana y para el bingo. */
export function bingoMissing(card: BingoCard, drawn: ReadonlySet<number>): { line: number; bingo: number } {
  const line = Math.min(...card.map((row) => row.filter((n) => n !== null && !drawn.has(n)).length));
  return { line, bingo: bingoCardNumbers(card).filter((n) => !drawn.has(n)).length };
}

/** Premios del bote: se reparten a partes iguales entre los cartones que cantan en la misma bola. */
export function bingoPrizes(pot: number): { line: number; bingo: number } {
  return { line: Math.floor(pot * BINGO_LINE_SHARE), bingo: Math.floor(pot * BINGO_BINGO_SHARE) };
}
