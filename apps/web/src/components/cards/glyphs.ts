/**
 * Geometría vectorial de la baraja (sin fuentes): los rangos se dibujan como
 * trazos y los palos como trayectorias SVG. Así la carta se ve igual en
 * cualquier ordenador, aunque falte una tipografía o tarde en cargar.
 */

export type SuitChar = 's' | 'h' | 'd' | 'c';
export type RankChar = 'A' | '2' | '3' | '4' | '5' | '6' | '7' | '8' | '9' | 'T' | 'J' | 'Q' | 'K';

export const RANK_CHARS: readonly RankChar[] = ['A', '2', '3', '4', '5', '6', '7', '8', '9', 'T', 'J', 'Q', 'K'];
export const SUIT_CHARS: readonly SuitChar[] = ['s', 'h', 'd', 'c'];

export const SUIT_NAME: Record<SuitChar, string> = { s: 'picas', h: 'corazones', d: 'diamantes', c: 'tréboles' };
export const RANK_NAME: Record<RankChar, string> = {
  A: 'As', '2': '2', '3': '3', '4': '4', '5': '5', '6': '6', '7': '7', '8': '8', '9': '9', T: '10', J: 'Jota', Q: 'Reina', K: 'Rey',
};
export const RANK_LABEL: Record<RankChar, string> = {
  A: 'A', '2': '2', '3': '3', '4': '4', '5': '5', '6': '6', '7': '7', '8': '8', '9': '9', T: '10', J: 'J', Q: 'Q', K: 'K',
};

export const RED = '#B3172E';
export const BLACK = '#121826';
export const isRed = (s: SuitChar): boolean => s === 'h' || s === 'd';
export const suitColor = (s: SuitChar): string => (isRed(s) ? RED : BLACK);

/** Trazos de cada rango en una caja de 10 × 14 (el 10 ocupa 14 × 14). */
export const RANK_STROKES: Record<RankChar, { d: string; width: number }> = {
  A: { d: 'M1 14 L5 0 L9 14 M2.6 8.6 H7.4', width: 10 },
  '2': { d: 'M1.3 3.6 C1.3 1.3 3 0 5 0 C7.2 0 8.7 1.4 8.7 3.6 C8.7 6.4 6.2 8 1 14 H9.2', width: 10 },
  '3': { d: 'M1.4 0.6 H8.4 L4.6 5.8 C7.3 5.8 9 7.4 9 10 C9 12.5 7.2 14 4.9 14 C3 14 1.6 13.2 1 11.9', width: 10 },
  '4': { d: 'M7 14 V0 L0.8 9.7 H9.4', width: 10 },
  '5': { d: 'M8.4 0.6 H2.2 L1.6 6.3 C2.5 5.5 3.7 5.1 5 5.1 C7.4 5.1 9 6.9 9 9.5 C9 12.2 7.2 14 4.8 14 C3 14 1.6 13.2 1 11.9', width: 10 },
  '6': { d: 'M7.9 1.1 C7.1 0.4 6.1 0 5 0 C2.5 0 1 2.7 1 7.1 C1 11.6 2.6 14 5 14 C7.4 14 9 12.2 9 9.6 C9 7 7.4 5.4 5.1 5.4 C3.2 5.4 1.8 6.6 1.1 8.1', width: 10 },
  '7': { d: 'M1 0.6 H9 L3.9 14', width: 10 },
  '8': { d: 'M5 6.4 C2.9 6.4 1.6 5.2 1.6 3.3 C1.6 1.3 3 0 5 0 C7 0 8.4 1.3 8.4 3.3 C8.4 5.2 7.1 6.4 5 6.4 C2.5 6.4 1 7.9 1 10.1 C1 12.5 2.7 14 5 14 C7.3 14 9 12.5 9 10.1 C9 7.9 7.5 6.4 5 6.4 Z', width: 10 },
  '9': { d: 'M2.1 12.9 C2.9 13.6 3.9 14 5 14 C7.5 14 9 11.3 9 6.9 C9 2.4 7.4 0 5 0 C2.6 0 1 1.8 1 4.4 C1 7 2.6 8.6 4.9 8.6 C6.8 8.6 8.2 7.4 8.9 5.9', width: 10 },
  T: { d: 'M1.2 2.4 L3.6 0 V14 M9.9 0 C7.7 0 6.5 2.8 6.5 7 C6.5 11.2 7.7 14 9.9 14 C12.1 14 13.3 11.2 13.3 7 C13.3 2.8 12.1 0 9.9 0 Z', width: 14 },
  J: { d: 'M3.6 0.6 H9 M7.4 0.6 V10 C7.4 12.6 6 14 4 14 C2.2 14 1 12.8 0.8 11', width: 10 },
  Q: { d: 'M5 0 C2.4 0 1 3 1 7 C1 11 2.4 14 5 14 C7.6 14 9 11 9 7 C9 3 7.6 0 5 0 Z M5.9 10.2 L9.6 14.6', width: 10 },
  K: { d: 'M1.5 0 V14 M8.9 0 L1.5 8.4 M4.3 5.3 L9.1 14', width: 10 },
};

/** Palos en una caja de 100 × 100 (centro en 50, 50). */
export const SUIT_PATHS: Record<SuitChar, string> = {
  h: 'M50 90 C50 90 7 61 7 32 C7 16 18 7 31 7 C40 7 46.5 12 50 19 C53.5 12 60 7 69 7 C82 7 93 16 93 32 C93 61 50 90 50 90 Z',
  d: 'M50 4 C59 21 72 37 90 50 C72 63 59 79 50 96 C41 79 28 63 10 50 C28 37 41 21 50 4 Z',
  s: 'M50 4 C50 4 9 35 9 59 C9 74.5 20 83 32 83 C39.5 83 45 79.5 47.6 74.6 C46.6 84.6 42.6 91 35 96 H65 C57.4 91 53.4 84.6 52.4 74.6 C55 79.5 60.5 83 68 83 C80 83 91 74.5 91 59 C91 35 50 4 50 4 Z',
  // Trébol: tres hojas redondas bien separadas + tallo, para distinguirlo de la pica a tamaño pequeño.
  c: 'M50 6 A20 20 0 0 1 66.5 37.3 A20.5 20.5 0 1 1 53.6 72.5 C54.4 82.6 58.4 90 65 96 H35 C41.6 90 45.6 82.6 46.4 72.5 A20.5 20.5 0 1 1 33.5 37.3 A20 20 0 0 1 50 6 Z',
};

/** Posiciones de los símbolos en las cartas numéricas (carta de 100 × 140). */
export const PIP_LAYOUT: Record<number, [number, number][]> = {
  2: [[50, 27], [50, 113]],
  3: [[50, 27], [50, 70], [50, 113]],
  4: [[33, 27], [67, 27], [33, 113], [67, 113]],
  5: [[33, 27], [67, 27], [50, 70], [33, 113], [67, 113]],
  6: [[33, 27], [67, 27], [33, 70], [67, 70], [33, 113], [67, 113]],
  7: [[33, 27], [67, 27], [50, 48.5], [33, 70], [67, 70], [33, 113], [67, 113]],
  8: [[33, 27], [67, 27], [50, 48.5], [33, 70], [67, 70], [50, 91.5], [33, 113], [67, 113]],
  9: [[33, 27], [67, 27], [33, 55.7], [67, 55.7], [50, 70], [33, 84.3], [67, 84.3], [33, 113], [67, 113]],
  10: [[33, 27], [67, 27], [50, 41.3], [33, 55.7], [67, 55.7], [33, 84.3], [67, 84.3], [50, 98.7], [33, 113], [67, 113]],
};

export const RANK_PIPS: Partial<Record<RankChar, number>> = { '2': 2, '3': 3, '4': 4, '5': 5, '6': 6, '7': 7, '8': 8, '9': 9, T: 10 };

export function parseCard(card: string): { rank: RankChar; suit: SuitChar } {
  const rank = card[0] as RankChar;
  const suit = card[1] as SuitChar;
  if (!RANK_CHARS.includes(rank) || !SUIT_CHARS.includes(suit)) throw new Error(`Carta no válida: ${card}`);
  return { rank, suit };
}

export function cardName(card: string): string {
  const { rank, suit } = parseCard(card);
  return `${RANK_NAME[rank]} de ${SUIT_NAME[suit]}`;
}
