import { type Card, createShoe, rankOf } from './cards';
import type { Rng } from './rng';

/* ------------------------------------------------------------------------- */
/* Reglas                                                                     */
/* ------------------------------------------------------------------------- */

export interface BlackjackRules {
  decks: number;
  /** El crupier pide con 17 blando (H17). Por defecto se planta (S17). */
  dealerHitsSoft17: boolean;
  /** Pago del blackjack natural (1.5 = 3:2). */
  blackjackPayout: number;
  /** Doblar permitido tras dividir. */
  doubleAfterSplit: boolean;
  /** Máximo de manos tras dividir (2 = una sola división). */
  maxHands: number;
  /** Proporción del zapato que se juega antes de volver a barajar. */
  penetration: number;
  minBet: number;
  maxBet: number;
}

export const DEFAULT_BLACKJACK_RULES: BlackjackRules = {
  decks: 6,
  dealerHitsSoft17: false,
  blackjackPayout: 1.5,
  doubleAfterSplit: true,
  maxHands: 2,
  penetration: 0.75,
  minBet: 10,
  maxBet: 5000,
};

/* ------------------------------------------------------------------------- */
/* Tipos de estado                                                            */
/* ------------------------------------------------------------------------- */

export type BjOutcome = 'blackjack' | 'win' | 'push' | 'lose' | 'bust';
export type BjAction = 'hit' | 'stand' | 'double' | 'split';
export type BjPhase = 'player' | 'settled';

export interface BjHand {
  cards: Card[];
  bet: number;
  doubled: boolean;
  done: boolean;
  fromSplit: boolean;
  outcome?: BjOutcome;
  /** Cantidad devuelta al jugador (apuesta + ganancia). 0 si pierde. */
  payout?: number;
}

/** Eventos ordenados que la interfaz reproduce como animaciones. */
export type BjEvent =
  | { type: 'shuffle' }
  | { type: 'deal'; target: 'dealer'; card: Card | null; faceDown: boolean }
  | { type: 'deal'; target: 'player'; hand: number; card: Card }
  | { type: 'split'; hand: number }
  | { type: 'double'; hand: number }
  | { type: 'reveal'; card: Card }
  | { type: 'active'; hand: number }
  | { type: 'settle' };

export interface BjState {
  phase: BjPhase;
  rules: BlackjackRules;
  hands: BjHand[];
  active: number;
  dealer: Card[];
  /** Cartas restantes del zapato (secreto de servidor). */
  shoe: Card[];
  shoeSize: number;
  /** Eventos generados por la última operación. */
  events: BjEvent[];
  /** Apuesta total comprometida (inicial + dobles + divisiones). */
  totalBet: number;
  totalPayout: number;
}

/* ------------------------------------------------------------------------- */
/* Valoración                                                                 */
/* ------------------------------------------------------------------------- */

export function cardValue(card: Card): number {
  const r = rankOf(card);
  if (r === 14) return 11;
  if (r >= 10) return 10;
  return r;
}

export interface HandValue {
  total: number;
  soft: boolean;
}

/** Valor de una mano: los ases cuentan 11 salvo que eso supere 21. */
export function handValue(cards: readonly Card[]): HandValue {
  let total = 0;
  let aces = 0;
  for (const c of cards) {
    const v = cardValue(c);
    total += v;
    if (v === 11) aces += 1;
  }
  while (total > 21 && aces > 0) {
    total -= 10;
    aces -= 1;
  }
  return { total, soft: aces > 0 };
}

export function isNatural(cards: readonly Card[]): boolean {
  return cards.length === 2 && handValue(cards).total === 21;
}

/* ------------------------------------------------------------------------- */
/* Motor                                                                      */
/* ------------------------------------------------------------------------- */

export class BlackjackError extends Error {
  constructor(public readonly code: string, message: string) {
    super(message);
  }
}

export function drawFromShoe(shoe: { shoe: Card[]; shoeSize: number; rules: BlackjackRules; events: { type: string }[] }, rng: Rng): Card {
  if (shoe.shoe.length === 0) {
    shoe.shoe = createShoe(shoe.rules.decks, rng);
    shoe.shoeSize = shoe.shoe.length;
    shoe.events.push({ type: 'shuffle' });
  }
  return shoe.shoe.pop() as Card;
}

function draw(state: BjState, rng: Rng): Card {
  if (state.shoe.length === 0) {
    state.shoe = createShoe(state.rules.decks, rng);
    state.shoeSize = state.shoe.length;
    state.events.push({ type: 'shuffle' });
  }
  return state.shoe.pop() as Card;
}

export interface ShoeState {
  cards: Card[];
  size: number;
}

/** Indica si el zapato debe rebarajarse antes de la siguiente ronda. */
export function needsReshuffle(shoe: ShoeState | null, rules: BlackjackRules): boolean {
  if (!shoe || shoe.size === 0) return true;
  const played = shoe.size - shoe.cards.length;
  return played >= Math.floor(shoe.size * rules.penetration);
}

/**
 * Inicia una ronda: reparte jugador, crupier (vista), jugador, crupier (oculta)
 * y resuelve inmediatamente los blackjacks naturales (con "peek" del crupier).
 */
export function startBlackjack(
  bet: number,
  shoe: ShoeState | null,
  rng: Rng,
  rules: BlackjackRules = DEFAULT_BLACKJACK_RULES,
): BjState {
  if (!Number.isInteger(bet) || bet < rules.minBet || bet > rules.maxBet) {
    throw new BlackjackError('INVALID_BET', `La apuesta debe estar entre ${rules.minBet} y ${rules.maxBet}`);
  }
  const events: BjEvent[] = [];
  let cards: Card[];
  let size: number;
  if (needsReshuffle(shoe, rules)) {
    cards = createShoe(rules.decks, rng);
    size = cards.length;
    events.push({ type: 'shuffle' });
  } else {
    cards = shoe!.cards.slice();
    size = shoe!.size;
  }
  const state: BjState = {
    phase: 'player',
    rules,
    hands: [{ cards: [], bet, doubled: false, done: false, fromSplit: false }],
    active: 0,
    dealer: [],
    shoe: cards,
    shoeSize: size,
    events,
    totalBet: bet,
    totalPayout: 0,
  };
  const hand = state.hands[0]!;
  const p1 = draw(state, rng);
  hand.cards.push(p1);
  events.push({ type: 'deal', target: 'player', hand: 0, card: p1 });
  const d1 = draw(state, rng);
  state.dealer.push(d1);
  events.push({ type: 'deal', target: 'dealer', card: d1, faceDown: false });
  const p2 = draw(state, rng);
  hand.cards.push(p2);
  events.push({ type: 'deal', target: 'player', hand: 0, card: p2 });
  const d2 = draw(state, rng);
  state.dealer.push(d2);
  events.push({ type: 'deal', target: 'dealer', card: null, faceDown: true });

  const dealerBj = isNatural(state.dealer);
  const playerBj = isNatural(hand.cards);
  if (dealerBj || playerBj) {
    hand.done = true;
    events.push({ type: 'reveal', card: d2 });
    settle(state);
  } else {
    events.push({ type: 'active', hand: 0 });
  }
  return state;
}

/** Acciones legales para una mano concreta (compartido por la mesa individual y la multijugador). */
export function legalHandActions(hand: BjHand, handsInSeat: number, rules: BlackjackRules): BjAction[] {
  if (hand.done) return [];
  const actions: BjAction[] = ['hit', 'stand'];
  if (hand.cards.length === 2) {
    const splitAces = hand.fromSplit && rankOf(hand.cards[0]!) === 14;
    if (!splitAces && (!hand.fromSplit || rules.doubleAfterSplit)) actions.push('double');
    if (handsInSeat < rules.maxHands && cardValue(hand.cards[0]!) === cardValue(hand.cards[1]!)) actions.push('split');
  }
  return actions;
}

export function blackjackLegalActions(state: BjState): BjAction[] {
  if (state.phase !== 'player') return [];
  const hand = state.hands[state.active];
  if (!hand) return [];
  return legalHandActions(hand, state.hands.length, state.rules);
}

/** Regla del crupier: pide con menos de 17 (y con 17 blando si la mesa es H17). */
export function dealerMustHit(cards: readonly Card[], rules: BlackjackRules): boolean {
  const v = handValue(cards);
  return v.total < 17 || (v.total === 17 && v.soft && rules.dealerHitsSoft17);
}

/** El crupier solo roba si queda alguna mano que no se haya pasado ni sea blackjack natural. */
export function dealerNeedsToPlay(hands: readonly BjHand[]): boolean {
  return hands.some((h) => handValue(h.cards).total <= 21 && !(!h.fromSplit && isNatural(h.cards)));
}

/** Resultado y pago (apuesta + ganancia) de una mano contra la mano final del crupier. */
export function settleHand(hand: BjHand, dealer: readonly Card[], rules: BlackjackRules): { outcome: BjOutcome; payout: number } {
  const dealerTotal = handValue(dealer).total;
  const dealerBj = isNatural(dealer);
  const v = handValue(hand.cards).total;
  const natural = !hand.fromSplit && isNatural(hand.cards);
  if (natural && !dealerBj) return { outcome: 'blackjack', payout: hand.bet + Math.floor(hand.bet * rules.blackjackPayout) };
  if (natural && dealerBj) return { outcome: 'push', payout: hand.bet };
  if (v > 21) return { outcome: 'bust', payout: 0 };
  if (dealerBj) return { outcome: 'lose', payout: 0 };
  if (dealerTotal > 21 || v > dealerTotal) return { outcome: 'win', payout: hand.bet * 2 };
  if (v === dealerTotal) return { outcome: 'push', payout: hand.bet };
  return { outcome: 'lose', payout: 0 };
}

/** Apuesta adicional que requiere una acción (para descontarla del monedero antes). */
export function extraStakeFor(state: BjState, action: BjAction): number {
  const hand = state.hands[state.active];
  if (!hand) return 0;
  return action === 'double' || action === 'split' ? hand.bet : 0;
}

/**
 * Aplica una acción del jugador. Muta y devuelve el estado; `state.events`
 * contiene solo los eventos producidos por esta acción.
 */
export function applyBlackjackAction(state: BjState, action: BjAction, rng: Rng): BjState {
  state.events = [];
  if (!blackjackLegalActions(state).includes(action)) {
    throw new BlackjackError('ILLEGAL_ACTION', `Acción no permitida: ${action}`);
  }
  const idx = state.active;
  const hand = state.hands[idx]!;

  switch (action) {
    case 'hit': {
      const c = draw(state, rng);
      hand.cards.push(c);
      state.events.push({ type: 'deal', target: 'player', hand: idx, card: c });
      const { total } = handValue(hand.cards);
      if (total >= 21) hand.done = true;
      break;
    }
    case 'stand':
      hand.done = true;
      break;
    case 'double': {
      state.totalBet += hand.bet;
      hand.bet *= 2;
      hand.doubled = true;
      state.events.push({ type: 'double', hand: idx });
      const c = draw(state, rng);
      hand.cards.push(c);
      state.events.push({ type: 'deal', target: 'player', hand: idx, card: c });
      hand.done = true;
      break;
    }
    case 'split': {
      const moved = hand.cards.pop() as Card;
      const newHand: BjHand = { cards: [moved], bet: hand.bet, doubled: false, done: false, fromSplit: true };
      hand.fromSplit = true;
      state.totalBet += hand.bet;
      state.hands.splice(idx + 1, 0, newHand);
      state.events.push({ type: 'split', hand: idx });
      const aces = rankOf(hand.cards[0]!) === 14;
      for (const h of [idx, idx + 1]) {
        const c = draw(state, rng);
        state.hands[h]!.cards.push(c);
        state.events.push({ type: 'deal', target: 'player', hand: h, card: c });
        // Los ases divididos reciben una sola carta; 21 tras dividir no es blackjack.
        if (aces || handValue(state.hands[h]!.cards).total === 21) state.hands[h]!.done = true;
      }
      break;
    }
  }
  advance(state, rng);
  return state;
}

function advance(state: BjState, rng: Rng): void {
  const next = state.hands.findIndex((h) => !h.done);
  if (next !== -1) {
    if (next !== state.active) {
      state.active = next;
      state.events.push({ type: 'active', hand: next });
    }
    return;
  }
  // Turno del crupier.
  const hole = state.dealer[1]!;
  state.events.push({ type: 'reveal', card: hole });
  const anyLive = state.hands.some((h) => handValue(h.cards).total <= 21);
  if (anyLive) {
    while (dealerMustHit(state.dealer, state.rules)) {
      const c = draw(state, rng);
      state.dealer.push(c);
      state.events.push({ type: 'deal', target: 'dealer', card: c, faceDown: false });
    }
  }
  settle(state);
}

function settle(state: BjState): void {
  let total = 0;
  for (const hand of state.hands) {
    const { outcome, payout } = settleHand(hand, state.dealer, state.rules);
    hand.outcome = outcome;
    hand.payout = payout;
    hand.done = true;
    total += payout;
  }
  state.totalPayout = total;
  state.phase = 'settled';
  state.events.push({ type: 'settle' });
}

/* ------------------------------------------------------------------------- */
/* Vista pública                                                              */
/* ------------------------------------------------------------------------- */

export interface BjPublicHand {
  cards: Card[];
  bet: number;
  doubled: boolean;
  done: boolean;
  value: HandValue;
  outcome?: BjOutcome;
  payout?: number;
}

export interface BjPublicState {
  phase: BjPhase;
  hands: BjPublicHand[];
  active: number;
  /** Carta oculta como null mientras el jugador decide. */
  dealer: (Card | null)[];
  dealerValue: HandValue | null;
  legalActions: BjAction[];
  shoeRemaining: number;
  shoeSize: number;
  totalBet: number;
  totalPayout: number;
}

export function publicBlackjackState(state: BjState): BjPublicState {
  const hidden = state.phase === 'player';
  const dealer = hidden ? [state.dealer[0] ?? null, null] : state.dealer.slice();
  return {
    phase: state.phase,
    hands: state.hands.map((h) => ({
      cards: h.cards.slice(),
      bet: h.bet,
      doubled: h.doubled,
      done: h.done,
      value: handValue(h.cards),
      ...(h.outcome ? { outcome: h.outcome } : {}),
      ...(h.payout !== undefined ? { payout: h.payout } : {}),
    })),
    active: state.active,
    dealer,
    dealerValue: hidden ? (state.dealer[0] ? handValue([state.dealer[0]]) : null) : handValue(state.dealer),
    legalActions: blackjackLegalActions(state),
    shoeRemaining: state.shoe.length,
    shoeSize: state.shoeSize,
    totalBet: state.totalBet,
    totalPayout: state.totalPayout,
  };
}

/** Oculta la carta tapada dentro de los eventos mientras la mano sigue abierta. */
export function publicBlackjackEvents(events: readonly BjEvent[]): BjEvent[] {
  return events.map((e) => (e.type === 'deal' && e.target === 'dealer' && e.faceDown ? { ...e, card: null } : e));
}
