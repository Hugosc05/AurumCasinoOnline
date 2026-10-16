import { type Card, createDeck, rankOf, suitOf } from '../cards';
import { CORE_SIZE, HAND_CATEGORIES, evaluateHand, type HandCategory } from './evaluator';

/**
 * Asistente de manos para principiantes.
 *
 * Recibe ÚNICAMENTE las cartas que el jugador tiene derecho a ver (sus dos
 * cartas privadas y las comunitarias) y devuelve una descripción de su mano
 * actual calculada con el mismo evaluador que usa el servidor para decidir
 * los botes. No conoce ni estima las cartas de los rivales: las
 * probabilidades de mejora se calculan sobre las cartas que quedan sin ver.
 */

export type AssistStage = 'preflop' | 'flop' | 'turn' | 'river';

export interface DrawInfo {
  kind: 'flush' | 'open-ended' | 'gutshot';
  label: string;
  /** Cartas que lo completarían (entre las no vistas). */
  outs: number;
}

export interface ImprovementOdds {
  /** Cartas comunitarias que faltan por salir. */
  cardsToCome: 1 | 2;
  /** Probabilidad exacta (0..1) de terminar con una categoría superior a la actual. */
  probability: number;
  /** Desglose por categoría final (solo las que mejoran la actual), de mayor a menor probabilidad. */
  byCategory: { category: HandCategory; name: string; probability: number }[];
  /** Combinaciones de cartas evaluadas. */
  combinations: number;
}

export interface HandInsight {
  stage: AssistStage;
  /** true cuando ya se han repartido las cinco comunitarias: es la mano definitiva. */
  final: boolean;
  category: HandCategory;
  /** Nombre genérico de la categoría («Pareja»). */
  categoryName: string;
  /** Título concreto en español («Pareja de reyes»). */
  title: string;
  /** Cartas que forman la combinación. */
  core: Card[];
  /** Mejor combinación de cinco cartas (vacía antes del flop). */
  best: Card[];
  /** Cartas de acompañamiento dentro de las cinco mejores. */
  kickers: Card[];
  /** Cuántas de las cinco mejores son cartas propias (0 = la mesa juega por todos). */
  holeCardsUsed: number;
  /** Explicación sencilla de la categoría (modo principiante). */
  explanation: string;
  /** Frase breve sobre la situación actual. */
  summary: string;
  /** Posición de la categoría (1 = la más baja, 10 = la más alta). */
  rankPosition: number;
  draws: DrawInfo[];
  /** Solo en el flop y el turn. */
  improvement: ImprovementOdds | null;
}

const RANK_SINGULAR: Record<number, string> = {
  2: 'dos', 3: 'tres', 4: 'cuatro', 5: 'cinco', 6: 'seis', 7: 'siete', 8: 'ocho', 9: 'nueve', 10: 'diez', 11: 'jota', 12: 'reina', 13: 'rey', 14: 'as',
};
const RANK_PLURAL: Record<number, string> = {
  2: 'doses', 3: 'treses', 4: 'cuatros', 5: 'cincos', 6: 'seises', 7: 'sietes', 8: 'ochos', 9: 'nueves', 10: 'dieces', 11: 'jotas', 12: 'reinas', 13: 'reyes', 14: 'ases',
};
const SUIT_PLURAL: Record<string, string> = { s: 'picas', h: 'corazones', d: 'diamantes', c: 'tréboles' };

export const rankSingular = (r: number): string => RANK_SINGULAR[r] ?? String(r);
export const rankPlural = (r: number): string => RANK_PLURAL[r] ?? String(r);

export const CATEGORY_EXPLANATIONS: Readonly<Record<HandCategory, string>> = {
  0: 'No tienes ninguna combinación, así que cuenta tu carta más alta. Es la jugada más baja del póker.',
  1: 'Dos cartas del mismo valor.',
  2: 'Dos parejas de valores distintos.',
  3: 'Tres cartas del mismo valor.',
  4: 'Cinco cartas de valores consecutivos, de cualquier palo. El as puede ir al principio (A-2-3-4-5) o al final (10-J-Q-K-A).',
  5: 'Cinco cartas del mismo palo, aunque no sean consecutivas.',
  6: 'Un trío y una pareja a la vez.',
  7: 'Las cuatro cartas de un mismo valor.',
  8: 'Cinco cartas consecutivas y del mismo palo.',
  9: 'As, rey, reina, jota y diez del mismo palo: la mejor jugada posible.',
};

/** Título concreto de una combinación evaluada. */
export function handTitle(category: HandCategory, core: readonly Card[]): string {
  const r = core.map(rankOf);
  switch (category) {
    case 0:
      return `Carta alta: ${rankSingular(r[0]!)}`;
    case 1:
      return `Pareja de ${rankPlural(r[0]!)}`;
    case 2:
      return `Doble pareja: ${rankPlural(r[0]!)} y ${rankPlural(r[2]!)}`;
    case 3:
      return `Trío de ${rankPlural(r[0]!)}`;
    case 4:
      return `Escalera al ${rankSingular(r[0]!)}`;
    case 5:
      return `Color de ${SUIT_PLURAL[suitOf(core[0]!)]} al ${rankSingular(r[0]!)}`;
    case 6:
      return `Full de ${rankPlural(r[0]!)} con ${rankPlural(r[3]!)}`;
    case 7:
      return `Póker de ${rankPlural(r[0]!)}`;
    case 8:
      return `Escalera de color al ${rankSingular(r[0]!)}`;
    case 9:
      return `Escalera real de ${SUIT_PLURAL[suitOf(core[0]!)]}`;
  }
}

function stageOf(boardLength: number): AssistStage {
  if (boardLength === 0) return 'preflop';
  if (boardLength === 3) return 'flop';
  if (boardLength === 4) return 'turn';
  if (boardLength === 5) return 'river';
  throw new Error('El tablero debe tener 0, 3, 4 o 5 cartas');
}

/** Ranks que completarían una escalera que aún no existe (con as alto y bajo). */
function straightCompleters(ranks: ReadonlySet<number>): number[] {
  const has = (r: number): boolean => ranks.has(r === 1 ? 14 : r);
  const out = new Set<number>();
  for (let high = 5; high <= 14; high += 1) {
    const window = Array.from({ length: 5 }, (_, k) => high - k);
    const missing = window.filter((r) => !has(r));
    if (missing.length === 1) out.add(missing[0] === 1 ? 14 : missing[0]!);
  }
  return [...out];
}

function hasStraight(ranks: ReadonlySet<number>): boolean {
  for (let high = 5; high <= 14; high += 1) {
    if (Array.from({ length: 5 }, (_, k) => high - k).every((r) => ranks.has(r === 1 ? 14 : r))) return true;
  }
  return false;
}

/** Proyectos de color y escalera (información educativa, no un resultado). */
export function detectDraws(hole: readonly Card[], board: readonly Card[], category: HandCategory): DrawInfo[] {
  if (board.length === 0 || board.length === 5) return [];
  const all = [...hole, ...board];
  const draws: DrawInfo[] = [];
  if (category < 5) {
    for (const suit of ['s', 'h', 'd', 'c']) {
      const n = all.filter((c) => suitOf(c) === suit).length;
      const mine = hole.some((c) => suitOf(c) === suit);
      if (n === 4 && mine) draws.push({ kind: 'flush', label: `Proyecto de color de ${SUIT_PLURAL[suit]}`, outs: 9 });
    }
  }
  const ranks = new Set<number>(all.map(rankOf));
  if (category < 4 && !hasStraight(ranks)) {
    const boardRanks = new Set<number>(board.map(rankOf));
    // Solo cuenta si la escalera necesita alguna carta propia (si la mesa sola la forma, la comparten todos).
    const completers = straightCompleters(ranks).filter((r) => !hasStraight(new Set(boardRanks).add(r)));
    if (completers.length >= 2) draws.push({ kind: 'open-ended', label: 'Proyecto de escalera abierta', outs: completers.length * 4 });
    else if (completers.length === 1) draws.push({ kind: 'gutshot', label: 'Proyecto de escalera interna', outs: 4 });
  }
  return draws;
}

/**
 * Probabilidad exacta de que la categoría final sea superior a la actual,
 * enumerando todas las cartas que pueden salir entre las que el jugador no ve.
 */
export function improvementOdds(hole: readonly Card[], board: readonly Card[]): ImprovementOdds | null {
  if (board.length !== 3 && board.length !== 4) return null;
  const known = new Set([...hole, ...board]);
  const deck = createDeck().filter((c) => !known.has(c));
  const current = evaluateHand([...hole, ...board]).category;
  const counts = new Map<HandCategory, number>();
  let total = 0;
  let better = 0;
  const tally = (extra: Card[]): void => {
    const cat = evaluateHand([...hole, ...board, ...extra]).category;
    total += 1;
    if (cat > current) {
      better += 1;
      counts.set(cat, (counts.get(cat) ?? 0) + 1);
    }
  };
  if (board.length === 4) {
    for (const c of deck) tally([c]);
  } else {
    for (let i = 0; i < deck.length; i += 1) for (let j = i + 1; j < deck.length; j += 1) tally([deck[i]!, deck[j]!]);
  }
  return {
    cardsToCome: board.length === 4 ? 1 : 2,
    probability: better / total,
    byCategory: [...counts.entries()]
      .map(([category, n]) => ({ category, name: HAND_CATEGORIES[category], probability: n / total }))
      .sort((a, b) => b.probability - a.probability),
    combinations: total,
  };
}

/** Describe la mano actual del jugador a partir de la información que puede ver. */
export function describeHand(hole: readonly Card[], board: readonly Card[], opts: { odds?: boolean } = {}): HandInsight {
  if (hole.length !== 2) throw new Error('Se necesitan las dos cartas privadas');
  const stage = stageOf(board.length);
  const holeSet = new Set(hole);

  if (stage === 'preflop') {
    const [a, b] = hole as [Card, Card];
    const ra = rankOf(a);
    const rb = rankOf(b);
    const pair = ra === rb;
    const sorted = ra >= rb ? [a, b] : [b, a];
    const category: HandCategory = pair ? 1 : 0;
    const core = pair ? sorted : [sorted[0]!];
    const notes: string[] = [];
    if (pair) notes.push('Empiezas con pareja: ya tienes una combinación antes de ver la mesa.');
    else {
      if (suitOf(a) === suitOf(b)) notes.push('Tus cartas son del mismo palo: podrían ayudarte a formar color.');
      if (Math.abs(ra - rb) === 1 || (Math.max(ra, rb) === 14 && Math.min(ra, rb) === 2)) notes.push('Son consecutivas: podrían ayudarte a formar escalera.');
    }
    return {
      stage,
      final: false,
      category,
      categoryName: HAND_CATEGORIES[category],
      title: handTitle(category, core),
      core,
      best: [],
      kickers: pair ? [] : [sorted[1]!],
      holeCardsUsed: 2,
      explanation: CATEGORY_EXPLANATIONS[category],
      summary: [`Antes del flop solo cuentan tus dos cartas.`, ...notes, 'Aún saldrán cinco cartas comunitarias que pueden cambiarlo todo.'].join(' '),
      rankPosition: category + 1,
      draws: [],
      improvement: null,
    };
  }

  const ev = evaluateHand([...hole, ...board]);
  const kickers = ev.best.slice(CORE_SIZE[ev.category]);
  const holeCardsUsed = ev.best.filter((c) => holeSet.has(c)).length;
  const final = stage === 'river';
  const title = handTitle(ev.category, ev.core);
  const usage =
    holeCardsUsed === 0
      ? 'La mesa juega por ti: la mejor jugada está entera en las cartas comunitarias y la comparten todos los jugadores.'
      : holeCardsUsed === 1
        ? 'Usas una de tus cartas y cuatro de la mesa.'
        : 'Usas tus dos cartas y tres de la mesa.';
  const draws = detectDraws(hole, board, ev.category);
  const improvement = opts.odds === false ? null : improvementOdds(hole, board);
  const summary = final
    ? `Tu mano final es ${title.toLowerCase()}. ${usage}`
    : `Tienes ${title.toLowerCase()}. ${usage} ${board.length === 3 ? 'Quedan dos cartas por salir' : 'Queda una carta por salir'}: podría mejorar tu combinación, pero no garantiza que ganes la mano.`;
  return {
    stage,
    final,
    category: ev.category,
    categoryName: ev.name,
    title,
    core: ev.core,
    best: ev.best,
    kickers,
    holeCardsUsed,
    explanation: CATEGORY_EXPLANATIONS[ev.category],
    summary,
    rankPosition: ev.category + 1,
    draws,
    improvement,
  };
}
