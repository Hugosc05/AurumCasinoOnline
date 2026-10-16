import { type Card, createShoe, rankOf } from './cards';
import {
  BlackjackError,
  DEFAULT_BLACKJACK_RULES,
  cardValue,
  dealerMustHit,
  dealerNeedsToPlay,
  handValue,
  isNatural,
  legalHandActions,
  needsReshuffle,
  settleHand,
  type BjAction,
  type BjHand,
  type BjOutcome,
  type BlackjackRules,
  type HandValue,
  type ShoeState,
} from './blackjack';
import type { Rng } from './rng';

/**
 * Mesa de blackjack con varios asientos contra un crupier común.
 *
 * Mismas reglas que la mesa individual (las funciones de `blackjack.ts` son
 * compartidas): S17, 3:2, doblar con dos cartas (también tras dividir), una
 * división por asiento, ases divididos con una carta y comprobación del
 * crupier ("peek") cuando muestra as o figura.
 *
 * Cada asiento juega sus manos de forma independiente, en orden: el reparto
 * empieza a la izquierda del crupier (asiento 0, "primera base"). Las reglas
 * del crupier no dependen nunca de las apuestas ni del saldo de nadie.
 */

export type BjTablePhase = 'player' | 'settled';

export interface BjTableSeat {
  seat: number;
  id: string;
  hands: BjHand[];
}

export type BjTableEvent =
  | { type: 'shuffle' }
  | { type: 'deal'; to: 'dealer'; card: Card | null; faceDown: boolean }
  | { type: 'deal'; to: 'seat'; seat: number; hand: number; card: Card }
  | { type: 'split'; seat: number; hand: number }
  | { type: 'double'; seat: number; hand: number }
  | { type: 'stand'; seat: number; hand: number }
  | { type: 'bust'; seat: number; hand: number }
  | { type: 'turn'; seat: number; hand: number }
  | { type: 'reveal'; card: Card }
  | { type: 'settle'; results: { seat: number; hand: number; outcome: BjOutcome; payout: number; bet: number }[] };

export interface BjTableState {
  rules: BlackjackRules;
  phase: BjTablePhase;
  seats: BjTableSeat[];
  turn: { seat: number; hand: number } | null;
  dealer: Card[];
  shoe: Card[];
  shoeSize: number;
  events: BjTableEvent[];
  holeRevealed: boolean;
}

export interface TableBet {
  seat: number;
  id: string;
  bet: number;
}

function draw(state: BjTableState, rng: Rng): Card {
  if (state.shoe.length === 0) {
    state.shoe = createShoe(state.rules.decks, rng);
    state.shoeSize = state.shoe.length;
    state.events.push({ type: 'shuffle' });
  }
  return state.shoe.pop() as Card;
}

/** El crupier comprueba si tiene blackjack cuando su carta vista es un as o vale 10. */
const dealerPeeks = (up: Card): boolean => rankOf(up) === 14 || cardValue(up) === 10;

export function startTableRound(
  bets: readonly TableBet[],
  shoe: ShoeState | null,
  rng: Rng,
  rules: BlackjackRules = DEFAULT_BLACKJACK_RULES,
): BjTableState {
  if (bets.length === 0) throw new BlackjackError('NO_BETS', 'No hay apuestas en la mesa');
  const seen = new Set<number>();
  for (const b of bets) {
    if (seen.has(b.seat)) throw new BlackjackError('DUPLICATE_SEAT', 'Asiento repetido');
    seen.add(b.seat);
    if (!Number.isInteger(b.bet) || b.bet < rules.minBet || b.bet > rules.maxBet) {
      throw new BlackjackError('INVALID_BET', `La apuesta debe estar entre ${rules.minBet} y ${rules.maxBet}`);
    }
  }
  const events: BjTableEvent[] = [];
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
  const state: BjTableState = {
    rules,
    phase: 'player',
    seats: bets
      .slice()
      .sort((a, b) => a.seat - b.seat)
      .map((b) => ({ seat: b.seat, id: b.id, hands: [{ cards: [], bet: b.bet, doubled: false, done: false, fromSplit: false }] })),
    turn: null,
    dealer: [],
    shoe: cards,
    shoeSize: size,
    events,
    holeRevealed: false,
  };
  for (let round = 0; round < 2; round += 1) {
    for (const s of state.seats) {
      const c = draw(state, rng);
      s.hands[0]!.cards.push(c);
      events.push({ type: 'deal', to: 'seat', seat: s.seat, hand: 0, card: c });
    }
    const d = draw(state, rng);
    state.dealer.push(d);
    events.push({ type: 'deal', to: 'dealer', card: round === 0 ? d : null, faceDown: round === 1 });
  }
  // Los blackjacks naturales no juegan: esperan a la liquidación.
  for (const s of state.seats) if (isNatural(s.hands[0]!.cards)) s.hands[0]!.done = true;
  if (dealerPeeks(state.dealer[0]!) && isNatural(state.dealer)) {
    finish(state, rng, false);
    return state;
  }
  advance(state, rng);
  return state;
}

export function currentHand(state: BjTableState): BjHand | null {
  if (!state.turn) return null;
  return state.seats.find((s) => s.seat === state.turn!.seat)?.hands[state.turn.hand] ?? null;
}

export function tableLegalActions(state: BjTableState, seat: number): BjAction[] {
  if (state.phase !== 'player' || !state.turn || state.turn.seat !== seat) return [];
  const s = state.seats.find((x) => x.seat === seat)!;
  return legalHandActions(s.hands[state.turn.hand]!, s.hands.length, state.rules);
}

/** Apuesta adicional que exige una acción (doblar o dividir), para descontarla antes. */
export function tableExtraStake(state: BjTableState, seat: number, action: BjAction): number {
  const h = state.turn?.seat === seat ? currentHand(state) : null;
  return h && (action === 'double' || action === 'split') ? h.bet : 0;
}

export function applyTableAction(state: BjTableState, seat: number, action: BjAction, rng: Rng): BjTableState {
  state.events = [];
  if (!state.turn || state.turn.seat !== seat) throw new BlackjackError('NOT_YOUR_TURN', 'No es tu turno');
  if (!tableLegalActions(state, seat).includes(action)) throw new BlackjackError('ILLEGAL_ACTION', `Acción no permitida: ${action}`);
  const s = state.seats.find((x) => x.seat === seat)!;
  const idx = state.turn.hand;
  const hand = s.hands[idx]!;
  switch (action) {
    case 'hit': {
      const c = draw(state, rng);
      hand.cards.push(c);
      state.events.push({ type: 'deal', to: 'seat', seat, hand: idx, card: c });
      const { total } = handValue(hand.cards);
      if (total > 21) state.events.push({ type: 'bust', seat, hand: idx });
      if (total >= 21) hand.done = true;
      break;
    }
    case 'stand':
      hand.done = true;
      state.events.push({ type: 'stand', seat, hand: idx });
      break;
    case 'double': {
      hand.bet *= 2;
      hand.doubled = true;
      state.events.push({ type: 'double', seat, hand: idx });
      const c = draw(state, rng);
      hand.cards.push(c);
      state.events.push({ type: 'deal', to: 'seat', seat, hand: idx, card: c });
      if (handValue(hand.cards).total > 21) state.events.push({ type: 'bust', seat, hand: idx });
      hand.done = true;
      break;
    }
    case 'split': {
      const moved = hand.cards.pop() as Card;
      hand.fromSplit = true;
      s.hands.splice(idx + 1, 0, { cards: [moved], bet: hand.bet, doubled: false, done: false, fromSplit: true });
      state.events.push({ type: 'split', seat, hand: idx });
      const aces = rankOf(hand.cards[0]!) === 14;
      for (const h of [idx, idx + 1]) {
        const c = draw(state, rng);
        s.hands[h]!.cards.push(c);
        state.events.push({ type: 'deal', to: 'seat', seat, hand: h, card: c });
        if (aces || handValue(s.hands[h]!.cards).total === 21) s.hands[h]!.done = true;
      }
      break;
    }
  }
  advance(state, rng);
  return state;
}

/** Pasa el turno a la siguiente mano pendiente (mismo asiento primero) o al crupier. */
function advance(state: BjTableState, rng: Rng): void {
  for (const s of state.seats) {
    const h = s.hands.findIndex((x) => !x.done);
    if (h !== -1) {
      if (!state.turn || state.turn.seat !== s.seat || state.turn.hand !== h) {
        state.turn = { seat: s.seat, hand: h };
        state.events.push({ type: 'turn', seat: s.seat, hand: h });
      }
      return;
    }
  }
  finish(state, rng, true);
}

function finish(state: BjTableState, rng: Rng, dealerPlays: boolean): void {
  state.turn = null;
  state.holeRevealed = true;
  state.events.push({ type: 'reveal', card: state.dealer[1]! });
  const all = state.seats.flatMap((s) => s.hands);
  if (dealerPlays && dealerNeedsToPlay(all)) {
    while (dealerMustHit(state.dealer, state.rules)) {
      const c = draw(state, rng);
      state.dealer.push(c);
      state.events.push({ type: 'deal', to: 'dealer', card: c, faceDown: false });
    }
  }
  const results: Extract<BjTableEvent, { type: 'settle' }>['results'] = [];
  for (const s of state.seats) {
    s.hands.forEach((h, i) => {
      const r = settleHand(h, state.dealer, state.rules);
      h.outcome = r.outcome;
      h.payout = r.payout;
      h.done = true;
      results.push({ seat: s.seat, hand: i, outcome: r.outcome, payout: r.payout, bet: h.bet });
    });
  }
  state.phase = 'settled';
  state.events.push({ type: 'settle', results });
}

/** Total apostado (incluidos dobles y divisiones) y pagado por asiento. */
export function seatTotals(state: BjTableState, seat: number): { bet: number; payout: number } {
  const s = state.seats.find((x) => x.seat === seat);
  if (!s) return { bet: 0, payout: 0 };
  return { bet: s.hands.reduce((a, h) => a + h.bet, 0), payout: s.hands.reduce((a, h) => a + (h.payout ?? 0), 0) };
}

/* ------------------------------------------------------------------------- */
/* Vista pública                                                              */
/* ------------------------------------------------------------------------- */

export interface BjTablePublicHand {
  cards: Card[];
  bet: number;
  doubled: boolean;
  done: boolean;
  value: HandValue;
  outcome?: BjOutcome;
  payout?: number;
}

export interface BjTablePublic {
  phase: BjTablePhase;
  seats: { seat: number; id: string; hands: BjTablePublicHand[] }[];
  turn: { seat: number; hand: number } | null;
  /** La carta tapada del crupier es null hasta que se revela. */
  dealer: (Card | null)[];
  dealerValue: HandValue | null;
  shoeRemaining: number;
  shoeSize: number;
}

/**
 * En el blackjack las cartas de los jugadores se reparten boca arriba; la
 * única carta oculta es la tapada del crupier, que no viaja al cliente hasta
 * que se revela.
 */
export function publicTableView(state: BjTableState): BjTablePublic {
  const hidden = !state.holeRevealed;
  return {
    phase: state.phase,
    seats: state.seats.map((s) => ({
      seat: s.seat,
      id: s.id,
      hands: s.hands.map((h) => ({
        cards: h.cards.slice(),
        bet: h.bet,
        doubled: h.doubled,
        done: h.done,
        value: handValue(h.cards),
        ...(h.outcome ? { outcome: h.outcome } : {}),
        ...(h.payout !== undefined ? { payout: h.payout } : {}),
      })),
    })),
    turn: state.turn,
    dealer: hidden ? [state.dealer[0] ?? null, ...(state.dealer.length > 1 ? [null] : [])] : state.dealer.slice(),
    dealerValue: state.dealer.length === 0 ? null : hidden ? handValue([state.dealer[0]!]) : handValue(state.dealer),
    shoeRemaining: state.shoe.length,
    shoeSize: state.shoeSize,
  };
}

export function publicTableEvents(events: readonly BjTableEvent[]): BjTableEvent[] {
  return events.map((e) => (e.type === 'deal' && e.to === 'dealer' && e.faceDown ? { ...e, card: null } : e));
}
