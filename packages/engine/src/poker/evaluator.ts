import { type Card, type Rank, rankOf, suitOf } from '../cards';

/** Las diez categorías clásicas, de menor a mayor. */
export const HAND_CATEGORIES = [
  'Carta alta',
  'Pareja',
  'Doble pareja',
  'Trío',
  'Escalera',
  'Color',
  'Full',
  'Póker',
  'Escalera de color',
  'Escalera real',
] as const;
export type HandCategory = 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9;

export interface EvaluatedHand {
  /** Puntuación comparable: mayor es mejor; igual es empate exacto. */
  score: number;
  category: HandCategory;
  name: string;
  /** Las cinco cartas que forman la mejor jugada (primero las de la combinación, después las de acompañamiento). */
  best: Card[];
  /**
   * Cartas que forman la combinación propiamente dicha (sin las de acompañamiento):
   * 1 en carta alta, 2 en pareja, 4 en doble pareja, 3 en trío, 4 en póker y 5 en
   * escalera, color, full, escalera de color y escalera real.
   */
  core: Card[];
}

/** Número de cartas de `best` que forman la combinación, por categoría. */
export const CORE_SIZE: Readonly<Record<HandCategory, number>> = { 0: 1, 1: 2, 2: 4, 3: 3, 4: 5, 5: 5, 6: 5, 7: 4, 8: 5, 9: 5 };

type Partial5 = Omit<EvaluatedHand, 'core'>;
const withCore = (h: Partial5): EvaluatedHand => ({ ...h, core: h.best.slice(0, CORE_SIZE[h.category]) });

function encode(category: number, kickers: readonly number[]): number {
  let s = category;
  for (let i = 0; i < 5; i += 1) s = s * 16 + (kickers[i] ?? 0);
  return s;
}

/** Busca la escalera más alta en un conjunto de rangos (devuelve la carta alta, 5 para la "rueda" A-2-3-4-5). */
function straightHigh(ranks: ReadonlySet<number>): number {
  for (let high = 14; high >= 5; high -= 1) {
    let ok = true;
    for (let k = 0; k < 5; k += 1) {
      const r = high - k;
      const rr = r === 1 ? 14 : r;
      if (!ranks.has(rr)) {
        ok = false;
        break;
      }
    }
    if (ok) return high;
  }
  return 0;
}

function straightCards(cards: readonly Card[], high: number): Card[] {
  const out: Card[] = [];
  for (let k = 0; k < 5; k += 1) {
    const r = high - k === 1 ? 14 : high - k;
    out.push(cards.find((c) => rankOf(c) === r)!);
  }
  return out;
}

/**
 * Evalúa la mejor mano de 5 cartas entre 5, 6 o 7 cartas.
 * Algoritmo directo por recuento de rangos y palos (sin tablas precalculadas).
 */
export function evaluateHand(cards: readonly Card[]): EvaluatedHand {
  return withCore(evaluate5(cards));
}

function evaluate5(cards: readonly Card[]): Partial5 {
  if (cards.length < 5 || cards.length > 7) throw new Error('Se necesitan entre 5 y 7 cartas');
  const sortedCards = cards.slice().sort((a, b) => rankOf(b) - rankOf(a));

  // Color y escalera de color.
  const bySuit = new Map<string, Card[]>();
  for (const c of sortedCards) {
    const s = suitOf(c);
    const arr = bySuit.get(s) ?? [];
    arr.push(c);
    bySuit.set(s, arr);
  }
  let flush: Card[] | null = null;
  for (const arr of bySuit.values()) if (arr.length >= 5) flush = arr;

  if (flush) {
    const high = straightHigh(new Set(flush.map(rankOf)));
    if (high) {
      const best = straightCards(flush, high);
      const category: HandCategory = high === 14 ? 9 : 8;
      return { score: encode(category, [high]), category, name: HAND_CATEGORIES[category], best };
    }
  }

  // Agrupación por rango.
  const groups = new Map<Rank, Card[]>();
  for (const c of sortedCards) {
    const r = rankOf(c);
    const arr = groups.get(r) ?? [];
    arr.push(c);
    groups.set(r, arr);
  }
  const ordered = [...groups.entries()].sort((a, b) => b[1].length - a[1].length || b[0] - a[0]);
  const quads = ordered.filter(([, g]) => g.length === 4);
  const trips = ordered.filter(([, g]) => g.length === 3);
  const pairs = ordered.filter(([, g]) => g.length === 2);

  const kickersExcluding = (exclude: ReadonlySet<number>, n: number): Card[] =>
    sortedCards.filter((c) => !exclude.has(rankOf(c))).slice(0, n);

  if (quads.length > 0) {
    const [qr, qc] = quads[0]!;
    const k = kickersExcluding(new Set([qr]), 1);
    return { score: encode(7, [qr, rankOf(k[0]!)]), category: 7, name: HAND_CATEGORIES[7], best: [...qc, ...k] };
  }

  if (trips.length > 0 && (trips.length > 1 || pairs.length > 0)) {
    const [tr, tc] = trips[0]!;
    // El "par" del full puede salir de un segundo trío.
    const pairCandidates = [...trips.slice(1), ...pairs].sort((a, b) => b[0] - a[0]);
    const [pr, pc] = pairCandidates[0]!;
    return { score: encode(6, [tr, pr]), category: 6, name: HAND_CATEGORIES[6], best: [...tc, ...pc.slice(0, 2)] };
  }

  if (flush) {
    const best = flush.slice(0, 5);
    return { score: encode(5, best.map(rankOf)), category: 5, name: HAND_CATEGORIES[5], best };
  }

  const high = straightHigh(new Set(sortedCards.map(rankOf)));
  if (high) {
    return { score: encode(4, [high]), category: 4, name: HAND_CATEGORIES[4], best: straightCards(sortedCards, high) };
  }

  if (trips.length > 0) {
    const [tr, tc] = trips[0]!;
    const k = kickersExcluding(new Set([tr]), 2);
    return { score: encode(3, [tr, ...k.map(rankOf)]), category: 3, name: HAND_CATEGORIES[3], best: [...tc, ...k] };
  }

  if (pairs.length >= 2) {
    const [p1r, p1c] = pairs[0]!;
    const [p2r, p2c] = pairs[1]!;
    const k = kickersExcluding(new Set([p1r, p2r]), 1);
    return {
      score: encode(2, [p1r, p2r, rankOf(k[0]!)]),
      category: 2,
      name: HAND_CATEGORIES[2],
      best: [...p1c, ...p2c, ...k],
    };
  }

  if (pairs.length === 1) {
    const [pr, pc] = pairs[0]!;
    const k = kickersExcluding(new Set([pr]), 3);
    return { score: encode(1, [pr, ...k.map(rankOf)]), category: 1, name: HAND_CATEGORIES[1], best: [...pc, ...k] };
  }

  const best = sortedCards.slice(0, 5);
  return { score: encode(0, best.map(rankOf)), category: 0, name: HAND_CATEGORIES[0], best };
}

/** Compara dos manos: >0 si a gana, <0 si b gana, 0 empate. */
export function compareHands(a: readonly Card[], b: readonly Card[]): number {
  return evaluateHand(a).score - evaluateHand(b).score;
}
