import { handValue, type BjEvent, type BjOutcome, type BjPublicState } from '@aurum/engine';

/** Geometría del escenario de blackjack (coordenadas de diseño). Dos variantes: apaisada y vertical (móvil). */
export interface BjGeometry {
  stage: { w: number; h: number };
  shoe: { x: number; y: number };
  dealerRow: { x: number; y: number };
  betSpot: { x: number; y: number };
  hand1: { x: number; y: number };
  hand2: [{ x: number; y: number }, { x: number; y: number }];
  dealerBox: { left: number; top: number };
  shuffleAt: { x: number; y: number };
  /** Bandeja de descartes (cartas recogidas). */
  discard: { x: number; y: number };
  arc: string;
}

export const LANDSCAPE: BjGeometry = {
  stage: { w: 1000, h: 650 },
  shoe: { x: 850, y: 150 },
  dealerRow: { x: 500, y: 262 },
  betSpot: { x: 500, y: 590 },
  hand1: { x: 500, y: 462 },
  hand2: [{ x: 330, y: 462 }, { x: 670, y: 462 }],
  dealerBox: { left: 370, top: -8 },
  shuffleAt: { x: 500, y: 300 },
  discard: { x: 150, y: 150 },
  arc: 'M150 320 Q 500 440 850 320',
};

export const PORTRAIT: BjGeometry = {
  stage: { w: 640, h: 720 },
  shoe: { x: 560, y: 120 },
  dealerRow: { x: 320, y: 268 },
  betSpot: { x: 320, y: 660 },
  hand1: { x: 320, y: 500 },
  hand2: [{ x: 175, y: 500 }, { x: 465, y: 500 }],
  dealerBox: { left: 150, top: -8 },
  shuffleAt: { x: 320, y: 330 },
  discard: { x: 80, y: 120 },
  arc: 'M60 350 Q 320 440 580 350',
};

export const CARD_W = 92;
export const STAGE = LANDSCAPE.stage;
export const SHOE = LANDSCAPE.shoe;
export const DEALER_ROW = LANDSCAPE.dealerRow;
export const BET_SPOT = LANDSCAPE.betSpot;

export type Owner = 'dealer' | 0 | 1;

export interface VisualCard {
  id: string;
  owner: Owner;
  index: number;
  card: string | null;
  faceUp: boolean;
  fromShoe: boolean;
  sideways: boolean;
}

export interface VisualHand {
  bet: number;
  doubled: boolean;
  outcome?: BjOutcome;
  payout?: number;
}

export interface TableView {
  cards: VisualCard[];
  hands: VisualHand[];
  active: number | null;
  settled: boolean;
  seq: number;
}

export const EMPTY_VIEW: TableView = { cards: [], hands: [], active: null, settled: false, seq: 0 };

export function handCenter(hand: number, handCount: number, g: BjGeometry = LANDSCAPE): { x: number; y: number } {
  if (handCount <= 1) return g.hand1;
  return g.hand2[hand === 0 ? 0 : 1];
}

/** Posición de destino de cada carta según su dueño e índice. */
export function cardPosition(c: VisualCard, view: TableView, g: BjGeometry = LANDSCAPE): { x: number; y: number; rotate: number } {
  if (c.owner === 'dealer') {
    const n = view.cards.filter((x) => x.owner === 'dealer').length;
    const spacing = n > 4 ? 52 : 66;
    return { x: g.dealerRow.x + (c.index - (n - 1) / 2) * spacing, y: g.dealerRow.y, rotate: 0 };
  }
  const handCount = Math.max(1, view.hands.length);
  const center = handCenter(c.owner, handCount, g);
  const n = view.cards.filter((x) => x.owner === c.owner).length;
  const spacing = n > 5 ? 22 : 30;
  return {
    x: center.x + (c.index - (n - 1) / 2) * spacing,
    y: center.y - c.index * 5 + (c.sideways ? 10 : 0),
    rotate: c.sideways ? 90 : 0,
  };
}

export function visibleCards(view: TableView, owner: Owner): string[] {
  return view.cards.filter((c) => c.owner === owner && c.faceUp && c.card).sort((a, b) => a.index - b.index).map((c) => c.card!);
}

export function displayValue(view: TableView, owner: Owner): string | null {
  const cards = visibleCards(view, owner);
  if (cards.length === 0) return null;
  const v = handValue(cards);
  if (cards.length === 2 && v.total === 21 && owner !== 'dealer' && view.hands.length === 1) return 'Blackjack';
  // Mano blanda en juego: se muestran ambos valores; terminada, solo el mejor.
  if (v.soft && v.total < 21 && !view.settled && (owner === 'dealer' || view.active === null || view.active === owner)) return `${v.total - 10} / ${v.total}`;
  return String(v.total);
}

/** Reconstruye la mesa sin animaciones (al recargar o recuperar una mano en curso). */
export function viewFromState(state: BjPublicState): TableView {
  const cards: VisualCard[] = [];
  state.dealer.forEach((card, index) => cards.push({ id: `d${index}`, owner: 'dealer', index, card, faceUp: card !== null, fromShoe: false, sideways: false }));
  state.hands.forEach((h, hi) =>
    h.cards.forEach((card, index) =>
      cards.push({ id: `h${hi}-${index}`, owner: hi as 0 | 1, index, card, faceUp: true, fromShoe: false, sideways: h.doubled && index === 2 }),
    ),
  );
  return {
    cards,
    hands: state.hands.map((h) => ({ bet: h.bet, doubled: h.doubled, ...(h.outcome ? { outcome: h.outcome } : {}), ...(h.payout !== undefined ? { payout: h.payout } : {}) })),
    active: state.phase === 'player' ? state.active : null,
    settled: state.phase === 'settled',
    seq: 0,
  };
}

let uid = 0;
const nextId = (): string => `c${++uid}`;

/** Aplica un evento del servidor al modelo visual (puro). */
export function applyEvent(view: TableView, e: BjEvent): TableView {
  switch (e.type) {
    case 'shuffle':
      return view;
    case 'deal': {
      if (e.target === 'dealer') {
        const index = view.cards.filter((c) => c.owner === 'dealer').length;
        return { ...view, cards: [...view.cards, { id: nextId(), owner: 'dealer', index, card: e.card, faceUp: !e.faceDown, fromShoe: true, sideways: false }] };
      }
      const owner = e.hand as 0 | 1;
      const index = view.cards.filter((c) => c.owner === owner).length;
      const sideways = !!view.hands[owner]?.doubled && index === 2;
      return { ...view, cards: [...view.cards, { id: nextId(), owner, index, card: e.card, faceUp: true, fromShoe: true, sideways }] };
    }
    case 'split': {
      const hands = [...view.hands];
      const h = hands[e.hand]!;
      hands.splice(e.hand + 1, 0, { bet: h.bet, doubled: false });
      const cards = view.cards.map((c) => (c.owner === e.hand && c.index === 1 ? { ...c, owner: (e.hand + 1) as 0 | 1, index: 0 } : c));
      return { ...view, hands, cards };
    }
    case 'double': {
      const hands = view.hands.map((h, i) => (i === e.hand ? { ...h, bet: h.bet * 2, doubled: true } : h));
      return { ...view, hands };
    }
    case 'reveal': {
      const cards = view.cards.map((c) => (c.owner === 'dealer' && c.index === 1 ? { ...c, card: e.card, faceUp: true } : c));
      return { ...view, cards, active: null };
    }
    case 'active':
      return { ...view, active: e.hand };
    case 'settle':
      return { ...view, settled: true, active: null };
  }
}
