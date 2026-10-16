import { handValue, type BjOutcome, type BjTableEvent, type HandValue } from '@aurum/engine';
import type { AvatarSpec } from '../../../components/BotAvatar';

/* ------------------------------------------------------------------------- */
/* Mensajes del servidor                                                      */
/* ------------------------------------------------------------------------- */

export interface MultiSeat {
  seat: number;
  name: string;
  isBot: boolean;
  isYou: boolean;
  connected: boolean;
  leaving: boolean;
  bet: number | null;
  stack: number | null;
  bot: { avatar: AvatarSpec | null; experience: string; tagline: string; profile: string; strategy: string; betStyle: string } | null;
}

export interface MultiRoundHand {
  cards: string[];
  bet: number;
  doubled: boolean;
  done: boolean;
  value: HandValue;
  outcome?: BjOutcome;
  payout?: number;
}

export interface MultiSnapshot {
  table: { id: string; name: string; minBet: number; maxBet: number; maxSeats: number; enabled: boolean; mode: 'bots' | 'public' };
  phase: 'idle' | 'betting' | 'playing' | 'settled';
  roundNo: number;
  seats: (MultiSeat | null)[];
  round: {
    phase: 'player' | 'settled';
    seats: { seat: number; hands: MultiRoundHand[] }[];
    turn: { seat: number; hand: number } | null;
    dealer: (string | null)[];
    dealerValue: HandValue | null;
    shoeRemaining: number;
    shoeSize: number;
  } | null;
  you: { seat: number | null; legal: ('hit' | 'stand' | 'double' | 'split')[]; canBet: boolean };
  actionCount: number;
  deadline: number | null;
  history: { roundNo: number; endedAt: string; dealer: string[]; results: { seat: number; name: string; isBot: boolean; bet: number; payout: number; outcomes: BjOutcome[] }[] }[];
  seq: number;
  serverTime: number;
}

export type MultiEvent = BjTableEvent | { type: 'bet'; seat: number; amount: number } | { type: 'betting'; roundNo: number } | { type: 'seat'; seat: number };

export interface MultiUpdate {
  t: 'bj.update';
  tableId: string;
  seq: number;
  events: MultiEvent[];
  snapshot: MultiSnapshot;
}

export interface LobbyTable {
  id: string;
  name: string;
  minBet: number;
  maxBet: number;
  maxSeats: number;
  humans: number;
  bots: number;
  free: number;
  watchers: number;
  phase: MultiSnapshot['phase'];
  mode: 'bots' | 'public';
  roundsPlayed: number;
}

/* ------------------------------------------------------------------------- */
/* Geometría                                                                  */
/* ------------------------------------------------------------------------- */

export interface MultiGeometry {
  w: number;
  h: number;
  /** Elipse sobre la que se reparten los asientos (centro bajo el crupier). */
  cx: number;
  cy: number;
  rx: number;
  ry: number;
  dealerBox: { left: number; top: number; w: number; h: number };
  dealerRow: { x: number; y: number };
  shoe: { x: number; y: number };
  discard: { x: number; y: number };
  cardW: number;
  dealerCardW: number;
  /** Fracción del radio donde van las cartas, la apuesta y la placa del jugador. */
  cardsAt: number;
  betAt: number;
  plateAt: number;
  arcFrom: number;
  arcTo: number;
  /** Escala de las placas de jugador (más grandes en móvil para que se lean). */
  plateScale: number;
  /**
   * radial: cartas, apuesta y placa en línea hacia el crupier (pantallas anchas).
   * stacked: placas en U y cada mano justo encima de su placa (pantallas estrechas).
   */
  layout: 'radial' | 'stacked';
}

export const MULTI_LANDSCAPE: MultiGeometry = {
  w: 1100, h: 700,
  cx: 550, cy: 104, rx: 450, ry: 486,
  dealerBox: { left: 420, top: -10, w: 260, h: 210 },
  dealerRow: { x: 550, y: 262 },
  shoe: { x: 940, y: 110 },
  discard: { x: 160, y: 110 },
  cardW: 62, dealerCardW: 70,
  cardsAt: 0.645, betAt: 0.815, plateAt: 1.0,
  arcFrom: 20, arcTo: 160,
  plateScale: 1,
  layout: 'radial',
};

export const MULTI_PORTRAIT: MultiGeometry = {
  w: 560, h: 840,
  cx: 280, cy: 380, rx: 205, ry: 334,
  dealerBox: { left: 150, top: -16, w: 260, h: 210 },
  dealerRow: { x: 280, y: 246 },
  shoe: { x: 498, y: 92 },
  discard: { x: 62, y: 92 },
  cardW: 46, dealerCardW: 54,
  cardsAt: 1, betAt: 1, plateAt: 1.0,
  arcFrom: 5, arcTo: 175,
  plateScale: 1.05,
  layout: 'stacked',
};

/** Ángulo (grados) del asiento: el 0 ("primera base") queda a la izquierda del crupier, es decir, a nuestra derecha. */
export function seatAngle(seat: number, n: number, g: MultiGeometry): number {
  if (n <= 1) return 90;
  return g.arcFrom + (seat * (g.arcTo - g.arcFrom)) / (n - 1);
}

export function seatPoint(seat: number, n: number, g: MultiGeometry, at: number): { x: number; y: number } {
  const t = (seatAngle(seat, n, g) * Math.PI) / 180;
  return { x: g.cx + g.rx * at * Math.cos(t), y: g.cy + g.ry * at * Math.sin(t) };
}

/** Puntos de un asiento: placa del jugador, apuesta y centro de sus cartas. */
export function seatSpots(seat: number, n: number, g: MultiGeometry): { plate: { x: number; y: number }; bet: { x: number; y: number }; cards: { x: number; y: number }; rotate: number } {
  if (g.layout === 'radial') {
    const rotate = (90 - seatAngle(seat, n, g)) * -0.35; // inclinación suave hacia el crupier
    return { plate: seatPoint(seat, n, g, g.plateAt), bet: seatPoint(seat, n, g, g.betAt), cards: seatPoint(seat, n, g, g.cardsAt), rotate };
  }
  const plate = seatPoint(seat, n, g, 1);
  const cards = { x: plate.x, y: plate.y - 50 * g.plateScale - 14 - (g.cardW * 1.4) / 2 };
  const center = Math.abs(plate.x - g.cx) < 20;
  const dir = center ? -1 : plate.x > g.cx ? -1 : 1; // hacia el interior de la mesa
  const bet = { x: plate.x + dir * (g.cardW * 0.5 + (center ? 32 : 42)), y: cards.y + 18 };
  return { plate, bet, cards, rotate: 0 };
}

/** Centro de cada mano (tras dividir, las dos manos se separan a lo largo del arco). */
export function handAnchor(seat: number, hand: number, hands: number, n: number, g: MultiGeometry): { x: number; y: number; rotate: number } {
  const { cards: c, rotate } = seatSpots(seat, n, g);
  if (hands <= 1) return { ...c, rotate };
  const off = (hand === 0 ? -1 : 1) * g.cardW * 0.78;
  if (g.layout === 'stacked') return { x: c.x + off, y: c.y, rotate };
  const t = (seatAngle(seat, n, g) * Math.PI) / 180;
  return { x: c.x - Math.sin(t) * off, y: c.y + Math.cos(t) * off * 0.4, rotate };
}

/** Punto aproximado de la mano que reparte (las cartas salen de ahí). Hacia nuestra derecha reparte con la otra mano. */
export function dealerHand(g: MultiGeometry, reach = 0): { x: number; y: number } {
  return reach < -15 ? { x: g.dealerBox.left + 190, y: g.dealerBox.top + 196 } : { x: g.dealerBox.left + 70, y: g.dealerBox.top + 196 };
}

/** Ángulo del brazo del crupier hacia un punto del escenario (mismo criterio que la ilustración). */
export function reachTo(p: { x: number; y: number }, g: MultiGeometry): number {
  const shoulder = { x: g.dealerBox.left + 90, y: g.dealerBox.top + 126 };
  return Math.max(-70, Math.min(60, (-Math.atan2(p.x - shoulder.x, p.y - shoulder.y) * 180) / Math.PI));
}

/* ------------------------------------------------------------------------- */
/* Estado visual                                                              */
/* ------------------------------------------------------------------------- */

export interface VisCard {
  /** Identificador determinista por posición: el mismo al animar y al reconstruir. */
  id: string;
  owner: 'dealer' | { seat: number; hand: number };
  index: number;
  card: string | null;
  faceUp: boolean;
  fromShoe: boolean;
}

export interface VisHand {
  bet: number;
  doubled: boolean;
  outcome?: BjOutcome;
  payout?: number;
  bust?: boolean;
}

export interface MultiVis {
  cards: VisCard[];
  /** Manos por asiento (solo los que juegan la ronda). */
  hands: Record<number, VisHand[]>;
  /** Apuesta colocada por asiento antes de repartir. */
  bets: Record<number, number>;
  turn: { seat: number; hand: number } | null;
  dealerRevealed: boolean;
  settled: boolean;
}

export const EMPTY_MULTI: MultiVis = { cards: [], hands: {}, bets: {}, turn: null, dealerRevealed: false, settled: false };

const cardId = (o: VisCard['owner'], i: number): string => (o === 'dealer' ? `d${i}` : `s${o.seat}h${o.hand}c${i}`);

export function visFromSnapshot(s: MultiSnapshot): MultiVis {
  const bets: Record<number, number> = {};
  for (const seat of s.seats) if (seat && seat.bet !== null) bets[seat.seat] = seat.bet;
  if (!s.round) return { ...EMPTY_MULTI, bets };
  const cards: VisCard[] = [];
  s.round.dealer.forEach((c, i) => cards.push({ id: cardId('dealer', i), owner: 'dealer', index: i, card: c, faceUp: c !== null, fromShoe: false }));
  const hands: Record<number, VisHand[]> = {};
  for (const rs of s.round.seats) {
    hands[rs.seat] = rs.hands.map((h) => ({ bet: h.bet, doubled: h.doubled, outcome: h.outcome, payout: h.payout, bust: h.value.total > 21 }));
    rs.hands.forEach((h, hi) => h.cards.forEach((c, i) => {
      const owner = { seat: rs.seat, hand: hi };
      cards.push({ id: cardId(owner, i), owner, index: i, card: c, faceUp: true, fromShoe: false });
    }));
  }
  return { cards, hands, bets, turn: s.round.turn, dealerRevealed: s.round.dealer.every((c) => c !== null), settled: s.round.phase === 'settled' };
}

const sameHand = (o: VisCard['owner'], seat: number, hand: number): boolean => o !== 'dealer' && o.seat === seat && o.hand === hand;

/** Aplica un evento al estado visual (puro). */
export function applyMultiEvent(v: MultiVis, e: MultiEvent): MultiVis {
  switch (e.type) {
    case 'betting':
      return { ...EMPTY_MULTI };
    case 'bet':
      return { ...v, bets: { ...v.bets, [e.seat]: e.amount } };
    case 'deal': {
      if (e.to === 'dealer') {
        const index = v.cards.filter((c) => c.owner === 'dealer').length;
        return { ...v, cards: [...v.cards, { id: cardId('dealer', index), owner: 'dealer', index, card: e.card, faceUp: !e.faceDown, fromShoe: true }] };
      }
      const hands = { ...v.hands };
      if (!hands[e.seat]) hands[e.seat] = [{ bet: v.bets[e.seat] ?? 0, doubled: false }];
      const owner = { seat: e.seat, hand: e.hand };
      const index = v.cards.filter((c) => sameHand(c.owner, e.seat, e.hand)).length;
      return { ...v, hands, cards: [...v.cards, { id: cardId(owner, index), owner, index, card: e.card, faceUp: true, fromShoe: true }] };
    }
    case 'split': {
      const list = [...(v.hands[e.seat] ?? [])];
      const h = list[e.hand] ?? { bet: 0, doubled: false };
      list.splice(e.hand + 1, 0, { bet: h.bet, doubled: false });
      const cards = v.cards.map((c) => {
        if (c.owner === 'dealer' || c.owner.seat !== e.seat) return c;
        if (c.owner.hand === e.hand && c.index === 1) {
          const owner = { seat: e.seat, hand: e.hand + 1 };
          return { ...c, id: cardId(owner, 0), owner, index: 0, fromShoe: false };
        }
        if (c.owner.hand > e.hand) {
          const owner = { seat: e.seat, hand: c.owner.hand + 1 };
          return { ...c, id: cardId(owner, c.index), owner };
        }
        return c;
      });
      return { ...v, hands: { ...v.hands, [e.seat]: list }, cards };
    }
    case 'double': {
      const list = (v.hands[e.seat] ?? []).map((h, i) => (i === e.hand ? { ...h, bet: h.bet * 2, doubled: true } : h));
      return { ...v, hands: { ...v.hands, [e.seat]: list } };
    }
    case 'bust': {
      const list = (v.hands[e.seat] ?? []).map((h, i) => (i === e.hand ? { ...h, bust: true } : h));
      return { ...v, hands: { ...v.hands, [e.seat]: list } };
    }
    case 'turn':
      return { ...v, turn: { seat: e.seat, hand: e.hand } };
    case 'reveal': {
      const cards = v.cards.map((c) => (c.owner === 'dealer' && c.index === 1 ? { ...c, card: e.card, faceUp: true } : c));
      return { ...v, cards, turn: null, dealerRevealed: true };
    }
    case 'settle': {
      const hands = { ...v.hands };
      for (const r of e.results) {
        const list = [...(hands[r.seat] ?? [])];
        list[r.hand] = { ...(list[r.hand] ?? { bet: r.bet, doubled: false }), bet: r.bet, outcome: r.outcome, payout: r.payout };
        hands[r.seat] = list;
      }
      return { ...v, hands, settled: true, turn: null };
    }
    default:
      return v;
  }
}

/** Posición de una carta según su mano (abanico ligeramente ascendente). */
export function multiCardPos(c: VisCard, v: MultiVis, n: number, g: MultiGeometry): { x: number; y: number; rotate: number } {
  if (c.owner === 'dealer') {
    const count = v.cards.filter((x) => x.owner === 'dealer').length;
    const spacing = count > 4 ? g.dealerCardW * 0.6 : g.dealerCardW * 0.78;
    return { x: g.dealerRow.x + (c.index - (count - 1) / 2) * spacing, y: g.dealerRow.y, rotate: 0 };
  }
  const { seat, hand } = c.owner;
  const hands = v.hands[seat]?.length ?? 1;
  const a = handAnchor(seat, hand, hands, n, g);
  const count = v.cards.filter((x) => sameHand(x.owner, seat, hand)).length;
  const spread = count > 4 ? g.cardW * 0.26 : g.cardW * 0.34;
  const k = c.index - (count - 1) / 2;
  const doubledSideways = !!v.hands[seat]?.[hand]?.doubled && c.index === 2;
  return { x: a.x + k * spread, y: a.y - c.index * (g.cardW * 0.12), rotate: doubledSideways ? a.rotate + 90 : a.rotate };
}

/** Total visible de una mano (solo cartas boca arriba). */
export function visibleTotal(cards: readonly VisCard[]): string | null {
  const faces = cards.filter((c) => c.faceUp && c.card).sort((a, b) => a.index - b.index).map((c) => c.card!);
  if (faces.length === 0) return null;
  const v = handValue(faces);
  if (faces.length === 2 && v.total === 21) return '21';
  return v.soft && v.total < 21 ? `${v.total - 10} / ${v.total}` : String(v.total);
}

export const OUTCOME_LABEL: Record<BjOutcome, string> = { blackjack: 'Blackjack', win: 'Gana', push: 'Empate', lose: 'Pierde', bust: 'Se pasa' };
