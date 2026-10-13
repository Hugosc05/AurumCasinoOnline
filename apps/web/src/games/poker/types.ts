import type { LegalActions, PokerEvent, PokerPublicHand } from '@aurum/engine';

export interface SeatView {
  seat: number;
  name: string;
  isBot: boolean;
  profile: string | null;
  difficulty: string | null;
  stack: number;
  connected: boolean;
  leaving: boolean;
  isYou: boolean;
  inHand: boolean;
}

export interface HandSummary {
  handId: string;
  endedAt: string;
  board: string[];
  pot: number;
  winners: { name: string; amount: number; handName: string | null; isBot: boolean }[];
}

export interface Snapshot {
  table: { id: string; name: string; smallBlind: number; bigBlind: number; minBuyIn: number; maxBuyIn: number; maxSeats: number; enabled: boolean };
  seats: (SeatView | null)[];
  hand: PokerPublicHand | null;
  you: { seat: number | null; legal: LegalActions | null };
  actionCount: number;
  deadline: number | null;
  history: HandSummary[];
  demo: boolean;
  seq: number;
  serverTime: number;
}

export interface UpdateMsg {
  t: 'poker.update';
  tableId: string;
  seq: number;
  events: PokerEvent[];
  snapshot: Snapshot;
}
