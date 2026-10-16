import { type Card, rankOf } from './cards';
import { cardValue, handValue, type BjAction } from './blackjack';
import type { Rng } from './rng';

/**
 * Estrategias de blackjack para bots. Todas devuelven siempre una acción
 * legal (si la preferida no lo es, se usa la alternativa estándar) y dependen
 * solo de su mano y de la carta vista del crupier: no ven el zapato ni las
 * cartas ocultas, y no cambian según lo que apuesten los demás.
 */
export type BjStrategy = 'basic' | 'cautious' | 'bold';
export type BjBetStyle = 'minimum' | 'steady' | 'varied';

export const BJ_STRATEGY_LABELS: Readonly<Record<BjStrategy, string>> = {
  basic: 'Estrategia básica',
  cautious: 'Prudente',
  bold: 'Atrevido',
};

type Pref = 'H' | 'S' | 'D' | 'Ds' | 'P';

/** Valor de la carta vista del crupier: 2..10, 11 = as. */
const up = (c: Card): number => cardValue(c);

/** Estrategia básica estándar para 6 barajas, S17, doblar tras dividir, sin rendición. */
function basicStrategy(cards: readonly Card[], dealerUp: Card, canSplit: boolean): Pref {
  const d = up(dealerUp);
  const v = handValue(cards);
  if (canSplit && cards.length === 2 && cardValue(cards[0]!) === cardValue(cards[1]!)) {
    const p = rankOf(cards[0]!) === 14 ? 11 : cardValue(cards[0]!);
    if (p === 11 || p === 8) return 'P';
    if (p === 9) return d === 7 || d === 10 || d === 11 ? 'S' : 'P';
    if (p === 7) return d <= 7 ? 'P' : 'H';
    if (p === 6) return d <= 6 ? 'P' : 'H';
    if (p === 4) return d === 5 || d === 6 ? 'P' : 'H';
    if (p === 2 || p === 3) return d <= 7 ? 'P' : 'H';
    // 5,5 se juega como 10 duro; 10,10 se planta.
  }
  if (v.soft && cards.length >= 2) {
    const t = v.total;
    if (t >= 19) return 'S';
    if (t === 18) return d >= 3 && d <= 6 ? 'Ds' : d === 2 || d === 7 || d === 8 ? 'S' : 'H';
    if (t === 17) return d >= 3 && d <= 6 ? 'D' : 'H';
    if (t === 15 || t === 16) return d >= 4 && d <= 6 ? 'D' : 'H';
    if (t === 13 || t === 14) return d === 5 || d === 6 ? 'D' : 'H';
    return 'H';
  }
  const t = v.total;
  if (t >= 17) return 'S';
  if (t >= 13) return d <= 6 ? 'S' : 'H';
  if (t === 12) return d >= 4 && d <= 6 ? 'S' : 'H';
  if (t === 11) return d === 11 ? 'H' : 'D';
  if (t === 10) return d <= 9 ? 'D' : 'H';
  if (t === 9) return d >= 3 && d <= 6 ? 'D' : 'H';
  return 'H';
}

function cautiousStrategy(cards: readonly Card[], dealerUp: Card, canSplit: boolean): Pref {
  const v = handValue(cards);
  if (canSplit && cards.length === 2 && cardValue(cards[0]!) === cardValue(cards[1]!)) {
    const p = rankOf(cards[0]!) === 14 ? 11 : cardValue(cards[0]!);
    if (p === 11 || p === 8) return 'P';
  }
  if (v.soft) return v.total >= 18 ? 'S' : 'H';
  if (v.total >= 12) return 'S';
  if (v.total === 11 && up(dealerUp) <= 10) return 'D';
  return 'H';
}

function boldStrategy(cards: readonly Card[], _dealerUp: Card, canSplit: boolean): Pref {
  const v = handValue(cards);
  if (canSplit && cards.length === 2 && cardValue(cards[0]!) === cardValue(cards[1]!)) {
    const p = cardValue(cards[0]!);
    if (p !== 5 && p !== 10) return 'P';
  }
  if (!v.soft && v.total >= 9 && v.total <= 11) return 'D';
  if (v.soft) return v.total >= 19 ? 'S' : 'H';
  return v.total >= 17 ? 'S' : 'H';
}

const STRATEGIES: Readonly<Record<BjStrategy, (c: readonly Card[], d: Card, s: boolean) => Pref>> = {
  basic: basicStrategy,
  cautious: cautiousStrategy,
  bold: boldStrategy,
};

/**
 * Decide una acción legal. `legal` son las acciones permitidas en este
 * momento; `canAfford` indica si le quedan fichas para doblar o dividir.
 */
export function decideBlackjack(strategy: BjStrategy, cards: readonly Card[], dealerUp: Card, legal: readonly BjAction[], canAfford: boolean): BjAction {
  const canSplit = legal.includes('split') && canAfford;
  const pref = STRATEGIES[strategy](cards, dealerUp, canSplit);
  const canDouble = legal.includes('double') && canAfford;
  let action: BjAction;
  switch (pref) {
    case 'P':
      action = canSplit ? 'split' : 'hit';
      break;
    case 'D':
      action = canDouble ? 'double' : 'hit';
      break;
    case 'Ds':
      action = canDouble ? 'double' : 'stand';
      break;
    case 'S':
      action = 'stand';
      break;
    default:
      action = 'hit';
  }
  if (!legal.includes(action)) action = legal.includes('stand') ? 'stand' : legal[0]!;
  return action;
}

/** Apuesta de un bot según su estilo, siempre dentro de los límites y de sus fichas. */
export function botBet(style: BjBetStyle, stack: number, min: number, max: number, rng: Rng): number {
  const cap = Math.min(max, stack);
  if (cap < min) return 0;
  const round5 = (x: number): number => Math.max(min, Math.floor(x / 5) * 5);
  let bet: number;
  if (style === 'minimum') bet = min;
  else if (style === 'steady') bet = round5(Math.max(min, stack * 0.03));
  else bet = round5(min * (1 + rng.int(5)));
  return Math.min(cap, Math.max(min, bet));
}
