import type { PokerEvent } from '@aurum/engine';
import type { Snapshot } from './types';

/** Estado visual de la mesa de póker (lo que se dibuja mientras se animan los eventos). */
export interface PokerVis {
  handId: string | null;
  button: number;
  sb: number;
  bb: number;
  stacks: Record<number, number>;
  bets: Record<number, number>;
  pot: number;
  board: string[];
  dealt: Record<number, number>;
  folded: Record<number, boolean>;
  revealed: Record<number, string[]>;
  lastAction: Record<number, string>;
  winners: Record<number, number>;
  winningHand: string | null;
  best: string[];
  toAct: number | null;
}

export const EMPTY_VIS: PokerVis = {
  handId: null, button: -1, sb: -1, bb: -1, stacks: {}, bets: {}, pot: 0, board: [], dealt: {}, folded: {}, revealed: {}, lastAction: {}, winners: {}, winningHand: null, best: [], toAct: null,
};

const ACTION_TEXT: Record<string, string> = { fold: 'No va', check: 'Pasa', call: 'Iguala', bet: 'Apuesta', raise: 'Sube', allin: 'All-in' };

export function actionText(action: string, betTo: number): string {
  if (action === 'bet' || action === 'raise') return `${ACTION_TEXT[action]} ${betTo}`;
  return ACTION_TEXT[action] ?? action;
}

/** Estado autoritativo tal como lo describe la instantánea del servidor. */
export function visFromSnapshot(s: Snapshot): PokerVis {
  const h = s.hand;
  const stacks: Record<number, number> = {};
  for (const seat of s.seats) if (seat) stacks[seat.seat] = seat.stack;
  if (!h) return { ...EMPTY_VIS, stacks };
  const bets: Record<number, number> = {};
  const dealt: Record<number, number> = {};
  const folded: Record<number, boolean> = {};
  const revealed: Record<number, string[]> = {};
  const lastAction: Record<number, string> = {};
  for (const p of h.players) {
    stacks[p.seat] = p.stack;
    if (p.bet > 0) bets[p.seat] = p.bet;
    dealt[p.seat] = 2;
    if (p.folded) folded[p.seat] = true;
    if (p.hole.every((c) => c !== null)) revealed[p.seat] = p.hole as string[];
    if (p.lastAction && p.lastAction !== 'sb' && p.lastAction !== 'bb') lastAction[p.seat] = ACTION_TEXT[p.lastAction] ?? '';
  }
  return {
    ...EMPTY_VIS,
    handId: h.handId,
    button: h.button,
    sb: h.sbSeat,
    bb: h.bbSeat,
    stacks,
    bets,
    pot: h.potCollected,
    board: h.board,
    dealt,
    folded,
    revealed,
    lastAction: h.street === 'complete' ? {} : lastAction,
    toAct: h.toAct,
  };
}

/** Aplica un evento (puro). Las cartas propias llegan en la instantánea, no en los eventos. */
export function applyPokerEvent(v: PokerVis, e: PokerEvent, ownSeat: number | null, ownCards: string[] | null): PokerVis {
  switch (e.type) {
    case 'hand_start':
      return { ...EMPTY_VIS, stacks: v.stacks, handId: e.handId, button: e.button, sb: e.sb, bb: e.bb };
    case 'blind':
      return { ...v, stacks: { ...v.stacks, [e.seat]: e.stack }, bets: { ...v.bets, [e.seat]: (v.bets[e.seat] ?? 0) + e.amount }, lastAction: { ...v.lastAction, [e.seat]: e.kind === 'small' ? 'Ciega pequeña' : 'Ciega grande' } };
    case 'deal_hole': {
      const dealt = { ...v.dealt, [e.seat]: (v.dealt[e.seat] ?? 0) + 1 };
      const revealed = e.seat === ownSeat && ownCards ? { ...v.revealed, [e.seat]: ownCards } : v.revealed;
      return { ...v, dealt, revealed };
    }
    case 'turn':
      return { ...v, toAct: e.seat };
    case 'action':
      return {
        ...v,
        toAct: null,
        stacks: { ...v.stacks, [e.seat]: e.stack },
        bets: e.betTo > 0 ? { ...v.bets, [e.seat]: e.betTo } : v.bets,
        folded: e.action === 'fold' ? { ...v.folded, [e.seat]: true } : v.folded,
        lastAction: { ...v.lastAction, [e.seat]: actionText(e.action, e.betTo) },
      };
    case 'collect':
      return { ...v, bets: {}, pot: e.pot, lastAction: Object.fromEntries(Object.entries(v.lastAction).filter(([, t]) => t === 'No va' || t === 'All-in')) };
    case 'street':
      return { ...v, board: [...v.board, ...e.cards], toAct: null };
    case 'return':
      return { ...v, stacks: { ...v.stacks, [e.seat]: (v.stacks[e.seat] ?? 0) + e.amount }, pot: Math.max(0, v.pot - e.amount), bets: Object.fromEntries(Object.entries(v.bets).filter(([s]) => Number(s) !== e.seat)) };
    case 'showdown': {
      const revealed = { ...v.revealed };
      for (const h of e.hands) revealed[h.seat] = h.cards;
      return { ...v, revealed, toAct: null };
    }
    case 'award': {
      const stacks = { ...v.stacks };
      const winners = { ...v.winners };
      for (const w of e.winners) {
        stacks[w.seat] = (stacks[w.seat] ?? 0) + w.amount;
        winners[w.seat] = (winners[w.seat] ?? 0) + w.amount;
      }
      return { ...v, stacks, winners, pot: Math.max(0, v.pot - e.amount), bets: {}, winningHand: e.handName ?? v.winningHand };
    }
    case 'hand_end':
      return { ...v, toAct: null };
  }
}

/** Geometría de la mesa (coordenadas de diseño). Variante apaisada y vertical (móvil). */
export interface PokerGeometry {
  w: number;
  h: number;
  cx: number;
  cy: number;
  rx: number;
  ry: number;
  dealer: { x: number; y: number };
  pot: { x: number; y: number };
  boardY: number;
  boardGap: number;
  /** Ángulo (radianes) del asiento 0 visual (abajo). */
  rotation: number;
}

export const POKER_LANDSCAPE: PokerGeometry = { w: 1000, h: 620, cx: 500, cy: 300, rx: 420, ry: 236, dealer: { x: 500, y: 92 }, pot: { x: 500, y: 346 }, boardY: 284, boardGap: 80, rotation: Math.PI / 2 };
export const POKER_PORTRAIT: PokerGeometry = { w: 660, h: 940, cx: 330, cy: 460, rx: 250, ry: 375, dealer: { x: 330, y: 150 }, pot: { x: 330, y: 560 }, boardY: 450, boardGap: 76, rotation: Math.PI / 2 };

export const TABLE = { w: POKER_LANDSCAPE.w, h: POKER_LANDSCAPE.h, cx: POKER_LANDSCAPE.cx, cy: POKER_LANDSCAPE.cy };
export const DEALER_POS = POKER_LANDSCAPE.dealer;
export const POT_POS = POKER_LANDSCAPE.pot;

export function seatPosition(displayIndex: number, n: number, g: PokerGeometry = POKER_LANDSCAPE): { x: number; y: number } {
  const a = g.rotation + (displayIndex * 2 * Math.PI) / n;
  return { x: g.cx + Math.cos(a) * g.rx, y: g.cy + Math.sin(a) * g.ry };
}

export function towardCenter(p: { x: number; y: number }, f: number, g: PokerGeometry = POKER_LANDSCAPE): { x: number; y: number } {
  return { x: p.x + (g.cx - p.x) * f, y: p.y + (g.cy - p.y) * f };
}

export function boardSlot(i: number, g: PokerGeometry = POKER_LANDSCAPE): { x: number; y: number } {
  return { x: g.cx + (i - 2) * g.boardGap, y: g.boardY };
}
