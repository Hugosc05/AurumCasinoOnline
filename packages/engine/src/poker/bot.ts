import { type Card, createDeck, rankOf, suitOf } from '../cards';
import type { Rng } from '../rng';
import { evaluateHand } from './evaluator';
import type { LegalActions, PokerAction, PokerStreet } from './holdem';

/* ------------------------------------------------------------------------- */
/* Perfiles                                                                   */
/* ------------------------------------------------------------------------- */

export type BotProfile = 'conservative' | 'aggressive' | 'balanced' | 'analytical';
export type BotDifficulty = 'easy' | 'normal' | 'hard';

export const BOT_PROFILE_LABELS: Readonly<Record<BotProfile, string>> = {
  conservative: 'Conservador',
  aggressive: 'Agresivo',
  balanced: 'Equilibrado',
  analytical: 'Analítico',
};

interface ProfileParams {
  /** Puntuación Chen mínima para entrar en el bote sin posición. */
  openChen: number;
  /** Ajuste de Chen por posición tardía (se resta al umbral). */
  positionBonus: number;
  /** Equidad (sobre 1) a partir de la cual apuesta/sube por valor. */
  valueEquity: number;
  /** Probabilidad de farol cuando nadie ha mostrado fuerza. */
  bluffRate: number;
  /** Margen sobre las pot odds exigido para pagar. */
  callMargin: number;
  /** Fracción del bote para apuestas de valor. */
  sizing: number;
  /** Usa el modelo de rivales. */
  usesOpponentModel: boolean;
}

const PROFILES: Readonly<Record<BotProfile, ProfileParams>> = {
  conservative: { openChen: 9, positionBonus: 1, valueEquity: 0.7, bluffRate: 0.02, callMargin: 0.08, sizing: 0.5, usesOpponentModel: false },
  aggressive: { openChen: 6, positionBonus: 2, valueEquity: 0.55, bluffRate: 0.16, callMargin: 0.0, sizing: 0.85, usesOpponentModel: false },
  balanced: { openChen: 7, positionBonus: 2, valueEquity: 0.62, bluffRate: 0.07, callMargin: 0.03, sizing: 0.65, usesOpponentModel: false },
  analytical: { openChen: 7, positionBonus: 2, valueEquity: 0.6, bluffRate: 0.06, callMargin: 0.02, sizing: 0.7, usesOpponentModel: true },
};

const DIFFICULTY: Readonly<Record<BotDifficulty, { iterations: number; noise: number }>> = {
  easy: { iterations: 150, noise: 0.12 },
  normal: { iterations: 400, noise: 0.05 },
  hard: { iterations: 1000, noise: 0.015 },
};

/* ------------------------------------------------------------------------- */
/* Información disponible para el bot (solo pública + sus cartas)             */
/* ------------------------------------------------------------------------- */

export interface OpponentStats {
  hands: number;
  /** Manos en las que puso dinero voluntariamente preflop. */
  vpip: number;
  /** Acciones agresivas (bet/raise) y pasivas (call). */
  aggressive: number;
  passive: number;
}

export interface BotView {
  hole: Card[];
  board: Card[];
  street: Exclude<PokerStreet, 'showdown' | 'complete'>;
  legal: LegalActions;
  stack: number;
  bigBlind: number;
  /** Rivales que siguen en la mano. */
  activeOpponents: number;
  /** 0 = primera en hablar … 1 = botón (posición relativa entre los activos). */
  position: number;
  /** ¿Algún rival ha subido en esta calle? */
  facingRaise: boolean;
  /** Estadísticas públicas de los rivales activos que han apostado/subido en esta calle. */
  aggressorStats: OpponentStats | null;
}

/* ------------------------------------------------------------------------- */
/* Fuerza de mano                                                             */
/* ------------------------------------------------------------------------- */

/** Fórmula de Chen para manos iniciales (≈ -1 … 20). */
export function chenScore(hole: readonly Card[]): number {
  const [a, b] = hole as [Card, Card];
  const ra = rankOf(a);
  const rb = rankOf(b);
  const hi = Math.max(ra, rb);
  const lo = Math.min(ra, rb);
  const base = (r: number): number => (r === 14 ? 10 : r === 13 ? 8 : r === 12 ? 7 : r === 11 ? 6 : r / 2);
  let score = base(hi);
  if (ra === rb) return Math.max(5, score * 2);
  if (suitOf(a) === suitOf(b)) score += 2;
  const gap = hi - lo - 1;
  score -= gap === 0 ? 0 : gap === 1 ? 1 : gap === 2 ? 2 : gap === 3 ? 4 : 5;
  if (gap <= 1 && hi < 12) score += 1;
  return Math.ceil(score);
}

/**
 * Equidad estimada por Monte Carlo contra `opponents` manos aleatorias.
 * Nunca usa las cartas reales de los rivales: solo las propias y el tablero.
 */
export function estimateEquity(
  hole: readonly Card[],
  board: readonly Card[],
  opponents: number,
  iterations: number,
  rng: Rng,
  timeBudgetMs = 40,
): number {
  if (opponents <= 0) return 1;
  const known = new Set([...hole, ...board]);
  const remaining = createDeck().filter((c) => !known.has(c));
  const start = Date.now();
  let wins = 0;
  let runs = 0;
  const deck = remaining.slice();
  for (let it = 0; it < iterations; it += 1) {
    if ((it & 31) === 31 && Date.now() - start > timeBudgetMs) break;
    // Barajado parcial: solo las cartas necesarias.
    const need = opponents * 2 + (5 - board.length);
    for (let i = 0; i < need; i += 1) {
      const j = i + rng.int(deck.length - i);
      const t = deck[i]!;
      deck[i] = deck[j]!;
      deck[j] = t;
    }
    let k = 0;
    const fullBoard = board.slice();
    while (fullBoard.length < 5) fullBoard.push(deck[k++]!);
    const mine = evaluateHand([...hole, ...fullBoard]).score;
    let best = 0;
    let tied = 0;
    let lost = false;
    for (let o = 0; o < opponents; o += 1) {
      const s = evaluateHand([deck[k++]!, deck[k++]!, ...fullBoard]).score;
      if (s > mine) {
        lost = true;
        break;
      }
      if (s === mine) tied += 1;
      best = Math.max(best, s);
    }
    runs += 1;
    if (!lost) wins += tied > 0 ? 1 / (tied + 1) : 1;
  }
  return runs === 0 ? 0.5 : wins / runs;
}

/* ------------------------------------------------------------------------- */
/* Decisión                                                                   */
/* ------------------------------------------------------------------------- */

export interface BotDecision {
  action: PokerAction;
  equity: number | null;
  reason: string;
}

function clampRaise(legal: LegalActions, target: number): number {
  return Math.max(legal.minRaiseTo, Math.min(legal.maxRaiseTo, Math.round(target)));
}

function raiseOrBet(legal: LegalActions, target: number): PokerAction {
  const to = clampRaise(legal, target);
  if (to >= legal.maxRaiseTo) return { type: 'allin' };
  return { type: legal.isBet ? 'bet' : 'raise', amount: to };
}

function passive(legal: LegalActions): PokerAction {
  return legal.canCheck ? { type: 'check' } : { type: 'call' };
}

function foldOrCheck(legal: LegalActions): PokerAction {
  return legal.canCheck ? { type: 'check' } : { type: 'fold' };
}

/**
 * Decide una acción legal. Considera: posición, coste de continuar (pot odds),
 * equidad estimada, cartas comunitarias, tamaño de apuestas y, en el perfil
 * analítico, el historial público del agresor.
 */
export function decideBotAction(view: BotView, profile: BotProfile, difficulty: BotDifficulty, rng: Rng): BotDecision {
  const p = PROFILES[profile];
  const d = DIFFICULTY[difficulty];
  const { legal } = view;
  const toCall = legal.callAmount;
  const potAfterCall = legal.pot + toCall;
  const potOdds = toCall > 0 ? toCall / potAfterCall : 0;
  const random = (): number => rng.int(10000) / 10000;

  /* --- Preflop: selección de manos por Chen + posición ------------------ */
  if (view.street === 'preflop') {
    const chen = chenScore(view.hole);
    const threshold = p.openChen - p.positionBonus * view.position + (view.facingRaise ? 2 : 0);
    const premium = chen >= 12;
    const callCostBB = toCall / view.bigBlind;

    if (chen < threshold) {
      // Faroles preflop ocasionales en posición tardía sin subida previa.
      if (!view.facingRaise && view.position > 0.6 && legal.canRaise && random() < p.bluffRate) {
        return { action: raiseOrBet(legal, view.bigBlind * 2.5), equity: null, reason: 'robo de ciegas' };
      }
      // Ciega grande que puede pasar gratis.
      if (legal.canCheck) return { action: { type: 'check' }, equity: null, reason: 'mano débil, check gratis' };
      // Completar barato con manos cercanas al umbral.
      if (callCostBB <= 1 && chen >= threshold - 2 && random() < 0.4) {
        return { action: { type: 'call' }, equity: null, reason: 'precio bajo' };
      }
      return { action: { type: 'fold' }, equity: null, reason: 'mano inicial por debajo del umbral' };
    }
    if (premium && legal.canRaise) {
      const target = view.facingRaise ? legal.currentBet * 3 : view.bigBlind * (3 + view.activeOpponents * 0.25);
      return { action: raiseOrBet(legal, target), equity: null, reason: 'mano premium' };
    }
    if (legal.canRaise && !view.facingRaise && chen >= threshold + 2) {
      return { action: raiseOrBet(legal, view.bigBlind * 3), equity: null, reason: 'apertura por valor' };
    }
    // Pagar subidas grandes solo con manos claramente por encima del umbral.
    if (view.facingRaise && callCostBB > 8 && chen < threshold + 3) {
      return { action: foldOrCheck(legal), equity: null, reason: 'subida demasiado cara' };
    }
    return { action: passive(legal), equity: null, reason: 'mano jugable' };
  }

  /* --- Postflop: equidad Monte Carlo ------------------------------------- */
  let equity = estimateEquity(view.hole, view.board, view.activeOpponents, d.iterations, rng);
  // Ruido según dificultad (los bots fáciles leen peor su mano).
  equity = Math.min(1, Math.max(0, equity + (random() * 2 - 1) * d.noise));

  // Modelo de rivales: un agresor muy agresivo apuesta con rangos más amplios.
  let required = potOdds + p.callMargin;
  if (p.usesOpponentModel && view.aggressorStats && view.aggressorStats.hands >= 8) {
    const s = view.aggressorStats;
    const af = s.aggressive / Math.max(1, s.passive);
    const vpipRate = s.vpip / s.hands;
    if (af > 2 || vpipRate > 0.45) required -= 0.05; // rival "maníaco": pagamos más
    else if (af < 0.7 && vpipRate < 0.25) required += 0.08; // rival "roca": su apuesta indica fuerza
  }
  // Apuestas grandes respecto al stack exigen más.
  if (toCall > view.stack * 0.5) required += 0.05;

  const strongDraw = view.street !== 'river' && equity > 0.35 && equity < p.valueEquity;

  if (equity >= p.valueEquity && legal.canRaise) {
    const sizing = p.sizing + (equity > 0.85 ? 0.2 : 0);
    const target = legal.currentBet + Math.max(view.bigBlind, legal.pot * sizing);
    return { action: raiseOrBet(legal, target), equity, reason: 'apuesta de valor' };
  }
  if (toCall === 0) {
    // Semifarol con proyecto o farol puro si nadie ha mostrado fuerza.
    const bluff = strongDraw ? p.bluffRate * 2.5 : p.bluffRate;
    if (legal.canRaise && random() < bluff) {
      const target = Math.max(view.bigBlind, legal.pot * 0.55);
      return { action: raiseOrBet(legal, target), equity, reason: strongDraw ? 'semifarol' : 'farol' };
    }
    return { action: { type: 'check' }, equity, reason: 'control del bote' };
  }
  if (equity >= required) {
    return { action: { type: 'call' }, equity, reason: 'pot odds favorables' };
  }
  return { action: { type: 'fold' }, equity, reason: 'equidad insuficiente para el precio' };
}

/** Tiempo de "pensar" variable y acotado (ms), para naturalidad. */
export function botThinkTime(rng: Rng, street: PokerStreet, difficulty: BotDifficulty): number {
  const base = street === 'preflop' ? 700 : 1000;
  const extra = difficulty === 'hard' ? 600 : difficulty === 'normal' ? 400 : 200;
  return base + rng.int(900 + extra);
}
