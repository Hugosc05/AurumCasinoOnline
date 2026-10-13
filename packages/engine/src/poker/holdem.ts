import { type Card, createDeck } from '../cards';
import { type Rng, shuffle } from '../rng';
import { evaluateHand } from './evaluator';
import { type Pot, buildPots, uncalledExcess } from './pots';

/* ------------------------------------------------------------------------- */
/* Tipos                                                                      */
/* ------------------------------------------------------------------------- */

export interface PokerConfig {
  smallBlind: number;
  bigBlind: number;
}

export interface PokerSeat {
  id: string;
  name: string;
  isBot: boolean;
  stack: number;
  sittingOut?: boolean;
}

export type PokerStreet = 'preflop' | 'flop' | 'turn' | 'river' | 'showdown' | 'complete';
export type PokerActionType = 'fold' | 'check' | 'call' | 'bet' | 'raise' | 'allin';

export interface PokerAction {
  type: PokerActionType;
  /** Para bet/raise: importe TOTAL de la apuesta en la calle ("subir a"). */
  amount?: number;
}

export interface PokerHandPlayer {
  seat: number;
  id: string;
  name: string;
  isBot: boolean;
  hole: Card[];
  stack: number;
  /** Apostado en la calle actual. */
  bet: number;
  /** Total aportado en la mano. */
  contributed: number;
  folded: boolean;
  allIn: boolean;
  acted: boolean;
  raiseLevelWhenActed: number;
  lastAction: PokerActionType | 'sb' | 'bb' | null;
}

export type PokerEvent =
  | { type: 'hand_start'; handId: string; button: number; sb: number; bb: number; seats: number[] }
  | { type: 'blind'; seat: number; kind: 'small' | 'big'; amount: number; stack: number }
  | { type: 'deal_hole'; seat: number; index: 0 | 1 }
  | { type: 'turn'; seat: number }
  | { type: 'action'; seat: number; action: PokerActionType; added: number; betTo: number; stack: number; pot: number }
  | { type: 'collect'; pot: number }
  | { type: 'street'; street: 'flop' | 'turn' | 'river'; cards: Card[] }
  | { type: 'return'; seat: number; amount: number }
  | { type: 'showdown'; hands: { seat: number; cards: Card[]; name: string; best: Card[] }[] }
  | { type: 'award'; pot: number; amount: number; winners: { seat: number; amount: number }[]; handName: string | null }
  | { type: 'hand_end' };

export interface PokerHandResult {
  winners: { seat: number; id: string; amount: number; handName: string | null }[];
  pots: Pot[];
  showdown: boolean;
}

export interface PokerHandState {
  handId: string;
  config: PokerConfig;
  maxSeats: number;
  button: number;
  sbSeat: number;
  bbSeat: number;
  street: PokerStreet;
  deck: Card[];
  board: Card[];
  players: PokerHandPlayer[];
  toAct: number | null;
  currentBet: number;
  lastRaiseSize: number;
  raiseLevel: number;
  /** Bote acumulado de calles anteriores (sin las apuestas de la calle actual). */
  potCollected: number;
  events: PokerEvent[];
  result: PokerHandResult | null;
}

export class PokerError extends Error {
  constructor(public readonly code: string, message: string) {
    super(message);
  }
}

/* ------------------------------------------------------------------------- */
/* Utilidades                                                                 */
/* ------------------------------------------------------------------------- */

const canAct = (p: PokerHandPlayer): boolean => !p.folded && !p.allIn;

export function playerAt(state: PokerHandState, seat: number): PokerHandPlayer | undefined {
  return state.players.find((p) => p.seat === seat);
}

/** Siguiente jugador (en sentido horario) tras `from` que cumple el predicado. */
function nextPlayer(state: PokerHandState, from: number, pred: (p: PokerHandPlayer) => boolean): PokerHandPlayer | null {
  for (let i = 1; i <= state.maxSeats; i += 1) {
    const seat = (from + i) % state.maxSeats;
    const p = playerAt(state, seat);
    if (p && pred(p)) return p;
  }
  return null;
}

export function totalPot(state: PokerHandState): number {
  return state.potCollected + state.players.reduce((a, p) => a + p.bet, 0);
}

function put(state: PokerHandState, p: PokerHandPlayer, amount: number): number {
  const a = Math.min(amount, p.stack);
  p.stack -= a;
  p.bet += a;
  p.contributed += a;
  if (p.stack === 0) p.allIn = true;
  return a;
}

/* ------------------------------------------------------------------------- */
/* Inicio de mano                                                             */
/* ------------------------------------------------------------------------- */

/** Asientos que pueden participar en la siguiente mano. */
export function eligibleSeats(seats: readonly (PokerSeat | null)[], minStack = 1): number[] {
  return seats.flatMap((s, i) => (s && !s.sittingOut && s.stack >= minStack ? [i] : []));
}

/** Calcula la posición del botón para la siguiente mano (rotación horaria). */
export function nextButton(seats: readonly (PokerSeat | null)[], prevButton: number): number {
  const eligible = eligibleSeats(seats);
  if (eligible.length === 0) return -1;
  for (let i = 1; i <= seats.length; i += 1) {
    const s = (((prevButton + i) % seats.length) + seats.length) % seats.length;
    if (eligible.includes(s)) return s;
  }
  return eligible[0]!;
}

export function startHand(
  seats: readonly (PokerSeat | null)[],
  prevButton: number,
  config: PokerConfig,
  rng: Rng,
  handId: string,
  presetDeck?: Card[],
): PokerHandState {
  const eligible = eligibleSeats(seats);
  if (eligible.length < 2) throw new PokerError('NOT_ENOUGH_PLAYERS', 'Se necesitan al menos 2 jugadores');
  const button = nextButton(seats, prevButton);

  const state: PokerHandState = {
    handId,
    config,
    maxSeats: seats.length,
    button,
    sbSeat: -1,
    bbSeat: -1,
    street: 'preflop',
    deck: presetDeck ? presetDeck.slice() : shuffle(createDeck(), rng),
    board: [],
    players: eligible.map((i) => {
      const s = seats[i]!;
      return {
        seat: i, id: s.id, name: s.name, isBot: s.isBot, hole: [], stack: s.stack, bet: 0, contributed: 0,
        folded: false, allIn: false, acted: false, raiseLevelWhenActed: -1, lastAction: null,
      };
    }),
    toAct: null,
    currentBet: 0,
    lastRaiseSize: config.bigBlind,
    raiseLevel: 0,
    potCollected: 0,
    events: [],
    result: null,
  };

  const headsUp = state.players.length === 2;
  const sb = headsUp ? playerAt(state, button)! : nextPlayer(state, button, () => true)!;
  const bb = nextPlayer(state, sb.seat, () => true)!;
  state.sbSeat = sb.seat;
  state.bbSeat = bb.seat;
  state.events.push({ type: 'hand_start', handId, button, sb: sb.seat, bb: bb.seat, seats: state.players.map((p) => p.seat) });

  const sbAmt = put(state, sb, config.smallBlind);
  sb.lastAction = 'sb';
  state.events.push({ type: 'blind', seat: sb.seat, kind: 'small', amount: sbAmt, stack: sb.stack });
  const bbAmt = put(state, bb, config.bigBlind);
  bb.lastAction = 'bb';
  state.events.push({ type: 'blind', seat: bb.seat, kind: 'big', amount: bbAmt, stack: bb.stack });
  state.currentBet = config.bigBlind;

  // Reparto: una carta a cada jugador empezando a la izquierda del botón, dos vueltas.
  const order: PokerHandPlayer[] = [];
  let cur = nextPlayer(state, button, () => true)!;
  for (let i = 0; i < state.players.length; i += 1) {
    order.push(cur);
    cur = nextPlayer(state, cur.seat, () => true)!;
  }
  for (const index of [0, 1] as const) {
    for (const p of order) {
      p.hole.push(state.deck.pop()!);
      state.events.push({ type: 'deal_hole', seat: p.seat, index });
    }
  }

  const first = nextPlayer(state, bb.seat, canAct);
  state.toAct = first ? first.seat : null;
  progressIfDone(state);
  if (state.toAct !== null && state.street === 'preflop') state.events.push({ type: 'turn', seat: state.toAct });
  return state;
}

/* ------------------------------------------------------------------------- */
/* Acciones                                                                   */
/* ------------------------------------------------------------------------- */

export interface LegalActions {
  seat: number;
  canFold: boolean;
  canCheck: boolean;
  callAmount: number;
  canRaise: boolean;
  /** true si la acción de apertura es "bet" (no hay apuesta previa en la calle). */
  isBet: boolean;
  minRaiseTo: number;
  maxRaiseTo: number;
  currentBet: number;
  pot: number;
}

export function legalActions(state: PokerHandState, seat: number): LegalActions | null {
  if (state.toAct !== seat || state.result) return null;
  const p = playerAt(state, seat);
  if (!p || !canAct(p)) return null;
  const toCall = Math.max(0, state.currentBet - p.bet);
  const maxRaiseTo = p.bet + p.stack;
  const othersCanAct = state.players.some((o) => o !== p && canAct(o));
  const reopened = !(p.acted && p.raiseLevelWhenActed === state.raiseLevel);
  const canRaise = p.stack > toCall && othersCanAct && reopened;
  const minRaiseTo = Math.min(maxRaiseTo, state.currentBet === 0 ? state.config.bigBlind : state.currentBet + state.lastRaiseSize);
  return {
    seat,
    canFold: toCall > 0,
    canCheck: toCall === 0,
    callAmount: Math.min(toCall, p.stack),
    canRaise,
    isBet: state.currentBet === 0,
    minRaiseTo,
    maxRaiseTo,
    currentBet: state.currentBet,
    pot: totalPot(state),
  };
}

export function applyPokerAction(state: PokerHandState, seat: number, action: PokerAction, rng?: Rng): PokerHandState {
  state.events = [];
  if (state.result || state.street === 'complete' || state.street === 'showdown') {
    throw new PokerError('HAND_OVER', 'La mano ha terminado');
  }
  if (state.toAct !== seat) throw new PokerError('NOT_YOUR_TURN', 'No es tu turno');
  const p = playerAt(state, seat)!;
  const legal = legalActions(state, seat)!;
  const toCall = state.currentBet - p.bet;
  let type = action.type;
  let added = 0;

  // Fold con check disponible se acepta (es legal, aunque poco sensato).
  if (type === 'fold') {
    p.folded = true;
  } else if (type === 'check') {
    if (!legal.canCheck) throw new PokerError('ILLEGAL_ACTION', 'No puedes pasar: hay una apuesta pendiente');
  } else if (type === 'call') {
    if (toCall <= 0) throw new PokerError('ILLEGAL_ACTION', 'No hay nada que igualar');
    added = put(state, p, toCall);
  } else {
    let target: number;
    if (type === 'allin') {
      target = p.bet + p.stack;
    } else {
      if (type === 'bet' && state.currentBet > 0) throw new PokerError('ILLEGAL_ACTION', 'Ya hay una apuesta: usa subir');
      if (type === 'raise' && state.currentBet === 0) throw new PokerError('ILLEGAL_ACTION', 'No hay apuesta que subir: usa apostar');
      if (!Number.isInteger(action.amount)) throw new PokerError('INVALID_AMOUNT', 'Importe no válido');
      target = action.amount!;
    }
    if (target <= state.currentBet) {
      // All-in por menos de lo que hay que igualar → cuenta como "call" all-in.
      if (type !== 'allin') throw new PokerError('INVALID_AMOUNT', 'La subida debe superar la apuesta actual');
      added = put(state, p, target - p.bet);
    } else {
      if (!legal.canRaise) throw new PokerError('ILLEGAL_ACTION', 'No puedes subir en esta situación');
      if (target > legal.maxRaiseTo) throw new PokerError('INSUFFICIENT_STACK', 'No tienes fichas suficientes');
      if (target < legal.minRaiseTo && target !== legal.maxRaiseTo) {
        throw new PokerError('RAISE_TOO_SMALL', `La subida mínima es a ${legal.minRaiseTo}`);
      }
      const raiseSize = target - state.currentBet;
      if (raiseSize >= state.lastRaiseSize) {
        state.lastRaiseSize = raiseSize;
        state.raiseLevel += 1;
      }
      state.currentBet = target;
      added = put(state, p, target - p.bet);
    }
    if (p.allIn) type = 'allin';
  }
  p.acted = true;
  p.raiseLevelWhenActed = state.raiseLevel;
  p.lastAction = type;
  state.events.push({ type: 'action', seat, action: type, added, betTo: p.bet, stack: p.stack, pot: totalPot(state) });

  const next = nextPlayer(state, seat, canAct);
  state.toAct = next ? next.seat : null;
  progressIfDone(state, rng);
  if (state.toAct !== null && !state.result) state.events.push({ type: 'turn', seat: state.toAct });
  return state;
}

/** Acción por defecto cuando expira el tiempo: pasar si se puede, si no retirarse. */
export function timeoutAction(state: PokerHandState, seat: number): PokerAction {
  const legal = legalActions(state, seat);
  return legal?.canCheck ? { type: 'check' } : { type: 'fold' };
}

/* ------------------------------------------------------------------------- */
/* Progresión de calles y resolución                                          */
/* ------------------------------------------------------------------------- */

function pendingPlayers(state: PokerHandState): PokerHandPlayer[] {
  const actors = state.players.filter(canAct);
  if (actors.length === 1 && actors[0]!.bet >= state.currentBet) return [];
  return actors.filter((p) => !p.acted || p.bet < state.currentBet);
}

function collectBets(state: PokerHandState): void {
  const sum = state.players.reduce((a, p) => a + p.bet, 0);
  if (sum === 0) return;
  for (const p of state.players) p.bet = 0;
  state.potCollected += sum;
  state.events.push({ type: 'collect', pot: state.potCollected });
}

function dealStreet(state: PokerHandState): void {
  state.deck.pop(); // carta quemada
  if (state.street === 'preflop') {
    const cards = [state.deck.pop()!, state.deck.pop()!, state.deck.pop()!];
    state.board.push(...cards);
    state.street = 'flop';
    state.events.push({ type: 'street', street: 'flop', cards });
  } else if (state.street === 'flop' || state.street === 'turn') {
    const card = state.deck.pop()!;
    state.board.push(card);
    state.street = state.street === 'flop' ? 'turn' : 'river';
    state.events.push({ type: 'street', street: state.street, cards: [card] });
  }
}

function progressIfDone(state: PokerHandState, _rng?: Rng): void {
  const live = state.players.filter((p) => !p.folded);
  if (live.length === 1) {
    collectBets(state);
    finish(state, false);
    return;
  }
  // Si queda gente por actuar, el turno ya está asignado.
  const pending = pendingPlayers(state);
  if (pending.length > 0) {
    if (state.toAct === null || !pending.some((p) => p.seat === state.toAct)) {
      const from = state.toAct ?? state.button;
      const n = nextPlayer(state, from, (p) => pending.includes(p));
      state.toAct = n ? n.seat : pending[0]!.seat;
    }
    return;
  }
  // Ronda de apuestas cerrada.
  collectBets(state);
  if (state.street === 'river') {
    finish(state, true);
    return;
  }
  const actors = state.players.filter(canAct);
  if (actors.length <= 1) {
    // Todos (o todos menos uno) all-in: se reparten las calles restantes sin apuestas.
    while (state.board.length < 5) dealStreet(state);
    finish(state, true);
    return;
  }
  dealStreet(state);
  state.currentBet = 0;
  state.lastRaiseSize = state.config.bigBlind;
  state.raiseLevel += 1;
  for (const p of state.players) {
    p.acted = false;
    if (!p.folded && !p.allIn) p.lastAction = null;
  }
  const first = nextPlayer(state, state.button, canAct);
  state.toAct = first ? first.seat : null;
}

function finish(state: PokerHandState, showdown: boolean): void {
  state.toAct = null;
  const contribs = state.players.map((p) => ({ seat: p.seat, amount: p.contributed, folded: p.folded }));
  const excess = uncalledExcess(contribs);
  if (excess) {
    const p = playerAt(state, excess.seat)!;
    p.stack += excess.amount;
    p.contributed -= excess.amount;
    state.potCollected -= excess.amount;
    if (p.stack > 0) p.allIn = false;
    state.events.push({ type: 'return', seat: excess.seat, amount: excess.amount });
  }
  const pots = buildPots(state.players.map((p) => ({ seat: p.seat, amount: p.contributed, folded: p.folded })));
  const live = state.players.filter((p) => !p.folded);
  const scores = new Map<number, { score: number; name: string; best: Card[] }>();
  if (showdown && live.length > 1) {
    state.street = 'showdown';
    for (const p of live) {
      const ev = evaluateHand([...p.hole, ...state.board]);
      scores.set(p.seat, { score: ev.score, name: ev.name, best: ev.best });
    }
    state.events.push({
      type: 'showdown',
      hands: live.map((p) => ({ seat: p.seat, cards: p.hole.slice(), name: scores.get(p.seat)!.name, best: scores.get(p.seat)!.best })),
    });
  }
  const won = new Map<number, number>();
  pots.forEach((pot, idx) => {
    let winners: number[];
    if (pot.eligible.length === 1 || scores.size === 0) {
      winners = pot.eligible.length > 0 ? [pot.eligible[0]!] : [live[0]!.seat];
    } else {
      const best = Math.max(...pot.eligible.map((s) => scores.get(s)!.score));
      winners = pot.eligible.filter((s) => scores.get(s)!.score === best);
    }
    // Orden de reparto del resto: desde la izquierda del botón.
    winners.sort((a, b) => ((a - state.button - 1 + state.maxSeats) % state.maxSeats) - ((b - state.button - 1 + state.maxSeats) % state.maxSeats));
    const share = Math.floor(pot.amount / winners.length);
    let remainder = pot.amount - share * winners.length;
    const awards = winners.map((seat) => {
      const extra = remainder > 0 ? 1 : 0;
      remainder -= extra;
      return { seat, amount: share + extra };
    });
    for (const a of awards) {
      playerAt(state, a.seat)!.stack += a.amount;
      won.set(a.seat, (won.get(a.seat) ?? 0) + a.amount);
    }
    state.events.push({
      type: 'award',
      pot: idx,
      amount: pot.amount,
      winners: awards,
      handName: scores.size > 0 ? scores.get(winners[0]!)!.name : null,
    });
  });
  state.potCollected = 0;
  state.result = {
    winners: [...won.entries()].map(([seat, amount]) => ({
      seat,
      id: playerAt(state, seat)!.id,
      amount,
      handName: scores.get(seat)?.name ?? null,
    })),
    pots,
    showdown: scores.size > 0,
  };
  state.street = 'complete';
  state.events.push({ type: 'hand_end' });
}

/* ------------------------------------------------------------------------- */
/* Vista pública por jugador                                                  */
/* ------------------------------------------------------------------------- */

export interface PokerPublicPlayer {
  seat: number;
  id: string;
  name: string;
  isBot: boolean;
  stack: number;
  bet: number;
  folded: boolean;
  allIn: boolean;
  lastAction: PokerHandPlayer['lastAction'];
  /** Cartas visibles para este observador: propias, o reveladas en el showdown. */
  hole: (Card | null)[];
}

export interface PokerPublicHand {
  handId: string;
  street: PokerStreet;
  button: number;
  sbSeat: number;
  bbSeat: number;
  board: Card[];
  pot: number;
  potCollected: number;
  currentBet: number;
  toAct: number | null;
  players: PokerPublicPlayer[];
}

export function publicHandView(state: PokerHandState, viewerId: string | null): PokerPublicHand {
  const revealed = state.result?.showdown ?? false;
  return {
    handId: state.handId,
    street: state.street,
    button: state.button,
    sbSeat: state.sbSeat,
    bbSeat: state.bbSeat,
    board: state.board.slice(),
    pot: totalPot(state),
    potCollected: state.potCollected,
    currentBet: state.currentBet,
    toAct: state.toAct,
    players: state.players.map((p) => ({
      seat: p.seat,
      id: p.id,
      name: p.name,
      isBot: p.isBot,
      stack: p.stack,
      bet: p.bet,
      folded: p.folded,
      allIn: p.allIn,
      lastAction: p.lastAction,
      hole: p.id === viewerId || (revealed && !p.folded) ? p.hole.slice() : p.hole.map(() => null),
    })),
  };
}
