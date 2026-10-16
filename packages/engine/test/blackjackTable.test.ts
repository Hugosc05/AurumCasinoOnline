import { describe, expect, it } from 'vitest';
import {
  BlackjackError,
  applyTableAction,
  botBet,
  decideBlackjack,
  handValue,
  legalHandActions,
  parseCards,
  publicTableEvents,
  publicTableView,
  seatTotals,
  seededRng,
  startTableRound,
  tableLegalActions,
  type BjStrategy,
  type ShoeState,
} from '../src';

/** Zapato con las cartas en orden de extracción. */
function shoe(order: string): ShoeState {
  const cards = parseCards(order).reverse();
  const filler = parseCards('2c 3c 4c 5c 6c 7c 8c 9c 2d 3d 4d 5d 6d 7d 8d 9d 2h 3h 4h 5h');
  const all = [...filler, ...cards];
  return { cards: all, size: all.length };
}
const rng = seededRng(3);
const bets = (...seats: number[]) => seats.map((s) => ({ seat: s, id: `p${s}`, bet: 10 }));

describe('mesa de blackjack con varios asientos', () => {
  it('reparte en orden: cada asiento, crupier visto, cada asiento, crupier tapada', () => {
    // asientos 0, 2, 4 → cartas en orden: s0 s2 s4 D s0 s2 s4 D
    const st = startTableRound(bets(4, 0, 2), shoe('Ts 9s 8s 7d 2s 3s 4s Kd'), rng);
    expect(st.seats.map((s) => s.seat)).toEqual([0, 2, 4]);
    expect(st.seats.map((s) => s.hands[0]!.cards)).toEqual([parseCards('Ts 2s'), parseCards('9s 3s'), parseCards('8s 4s')]);
    expect(st.dealer).toEqual(parseCards('7d Kd'));
    expect(st.turn).toEqual({ seat: 0, hand: 0 });
  });

  it('turnos independientes: solo actúa el asiento en turno y después pasa al siguiente', () => {
    const st = startTableRound(bets(0, 1), shoe('Ts 9s 7d 6s 7s Kd'), rng);
    expect(tableLegalActions(st, 1)).toEqual([]);
    expect(() => applyTableAction(st, 1, 'stand', rng)).toThrow(BlackjackError);
    applyTableAction(st, 0, 'stand', rng);
    expect(st.turn).toEqual({ seat: 1, hand: 0 });
    expect(() => applyTableAction(st, 0, 'hit', rng)).toThrow(/turno/);
  });

  it('el crupier juega una vez al final con S17 y cada asiento se liquida por separado', () => {
    // s0: T+9=19, s1: 9+7=16; crupier 7+K=17 se planta.
    const st = startTableRound(bets(0, 1), shoe('Ts 9s 7d 9h 7s Kd'), rng);
    applyTableAction(st, 0, 'stand', rng);
    applyTableAction(st, 1, 'stand', rng);
    expect(st.phase).toBe('settled');
    expect(st.dealer).toHaveLength(2);
    expect(st.seats[0]!.hands[0]!.outcome).toBe('win');
    expect(st.seats[1]!.hands[0]!.outcome).toBe('lose');
    expect(seatTotals(st, 0)).toEqual({ bet: 10, payout: 20 });
    expect(seatTotals(st, 1)).toEqual({ bet: 10, payout: 0 });
  });

  it('si todos se pasan, el crupier no roba', () => {
    const st = startTableRound(bets(0), shoe('Ts 6d 6s 9d Kc'), rng);
    applyTableAction(st, 0, 'hit', rng);
    expect(st.phase).toBe('settled');
    expect(st.dealer).toHaveLength(2);
    expect(st.seats[0]!.hands[0]!.outcome).toBe('bust');
  });

  it('el crupier con blackjack (peek con as visto) liquida a todos de inmediato', () => {
    const st = startTableRound(bets(0, 1), shoe('Ts As Ad Kd Kh Kc'), rng);
    expect(st.phase).toBe('settled');
    expect(st.seats[0]!.hands[0]!.outcome).toBe('lose');
    expect(st.seats[1]!.hands[0]!.outcome).toBe('push'); // A+K natural contra natural
  });

  it('un blackjack natural no juega y cobra 3:2 al final', () => {
    // s0 natural (A+K), s1 juega; crupier 9+7.
    const st = startTableRound(bets(0, 1), shoe('As Ts 9d Kd 7s 7d 5c'), rng);
    expect(st.turn).toEqual({ seat: 1, hand: 0 });
    applyTableAction(st, 1, 'stand', rng);
    const s0 = st.seats[0]!.hands[0]!;
    expect(s0.outcome).toBe('blackjack');
    expect(s0.payout).toBe(25);
  });

  it('dividir crea dos manos en el mismo asiento y se juegan antes de pasar al siguiente', () => {
    const st = startTableRound(bets(0, 1), shoe('8s 9s 7d 8h 9h Kd 3c 2c'), rng);
    applyTableAction(st, 0, 'split', rng);
    expect(st.seats[0]!.hands).toHaveLength(2);
    expect(st.turn).toEqual({ seat: 0, hand: 0 });
    applyTableAction(st, 0, 'stand', rng);
    expect(st.turn).toEqual({ seat: 0, hand: 1 });
    applyTableAction(st, 0, 'stand', rng);
    expect(st.turn).toEqual({ seat: 1, hand: 0 });
    expect(seatTotals(st, 0).bet).toBe(20);
  });

  it('la carta tapada del crupier no viaja al cliente hasta que se revela', () => {
    const st = startTableRound(bets(0), shoe('Ts 7d 9s Kd'), rng);
    const view = publicTableView(st);
    expect(view.dealer).toEqual(['7d', null]);
    expect(JSON.stringify(view)).not.toContain('Kd');
    expect(JSON.stringify(publicTableEvents(st.events))).not.toContain('Kd');
    applyTableAction(st, 0, 'stand', rng);
    expect(publicTableView(st).dealer).toContain('Kd');
  });

  it('rechaza apuestas fuera de límites y asientos repetidos', () => {
    expect(() => startTableRound([{ seat: 0, id: 'a', bet: 5 }], null, rng)).toThrow(BlackjackError);
    expect(() => startTableRound([{ seat: 0, id: 'a', bet: 10 }, { seat: 0, id: 'b', bet: 10 }], null, rng)).toThrow(BlackjackError);
  });

  it('cientos de rondas con 5 asientos y bots: siempre terminan y los pagos son coherentes', () => {
    const r = seededRng(42);
    let shoeState: ShoeState | null = null;
    const strategies: BjStrategy[] = ['basic', 'cautious', 'bold', 'basic', 'bold'];
    for (let round = 0; round < 400; round += 1) {
      const st = startTableRound(strategies.map((_, i) => ({ seat: i, id: `b${i}`, bet: 10 })), shoeState, r);
      let guard = 0;
      while (st.turn && guard < 100) {
        const seat = st.turn.seat;
        const s = st.seats.find((x) => x.seat === seat)!;
        const hand = s.hands[st.turn.hand]!;
        const legal = tableLegalActions(st, seat);
        const a = decideBlackjack(strategies[seat]!, hand.cards, st.dealer[0]!, legal, true);
        expect(legal).toContain(a);
        applyTableAction(st, seat, a, r);
        guard += 1;
      }
      expect(st.phase).toBe('settled');
      // El crupier respeta S17: termina con 17 o más, o se pasa, o no necesita jugar.
      const dv = handValue(st.dealer).total;
      const live = st.seats.some((s) => s.hands.some((h) => h.outcome !== 'bust' && h.outcome !== 'blackjack'));
      if (live && st.dealer.length > 2) expect(dv).toBeGreaterThanOrEqual(17);
      for (const s of st.seats) for (const h of s.hands) expect([0, h.bet, h.bet * 2, h.bet + Math.floor(h.bet * 1.5)]).toContain(h.payout);
      shoeState = { cards: st.shoe, size: st.shoeSize };
    }
  });
});

describe('estrategias de los bots', () => {
  const D = (c: string) => parseCards(c)[0]!;
  const all = ['hit', 'stand', 'double', 'split'] as const;
  it('estrategia básica: casos de referencia', () => {
    expect(decideBlackjack('basic', parseCards('Ts 6d'), D('Th'), all, true)).toBe('hit');
    expect(decideBlackjack('basic', parseCards('Ts 6d'), D('5h'), all, true)).toBe('stand');
    expect(decideBlackjack('basic', parseCards('6s 5d'), D('Th'), all, true)).toBe('double');
    expect(decideBlackjack('basic', parseCards('6s 5d'), D('Ah'), all, true)).toBe('hit');
    expect(decideBlackjack('basic', parseCards('8s 8d'), D('Th'), all, true)).toBe('split');
    expect(decideBlackjack('basic', parseCards('Ts Td'), D('6h'), all, true)).toBe('stand');
    expect(decideBlackjack('basic', parseCards('As 7d'), D('9h'), all, true)).toBe('hit');
    expect(decideBlackjack('basic', parseCards('As 7d'), D('4h'), all, true)).toBe('double');
    expect(decideBlackjack('basic', parseCards('5s 5d'), D('6h'), all, true)).toBe('double');
  });
  it('si la acción preferida no es legal o no hay fichas, elige la alternativa legal', () => {
    // 3 cartas: no se puede doblar → pedir (11) o plantarse (18 blando)
    expect(decideBlackjack('basic', parseCards('2s 4d 5h'), D('6h'), ['hit', 'stand'], true)).toBe('hit');
    expect(decideBlackjack('basic', parseCards('As 3d 4h'), D('5h'), ['hit', 'stand'], true)).toBe('stand');
    expect(decideBlackjack('basic', parseCards('8s 8d'), D('Th'), all, false)).toBe('hit');
  });
  it('prudente se planta con 12 o más; atrevido pide hasta 17', () => {
    expect(decideBlackjack('cautious', parseCards('Ts 2d'), D('Th'), all, true)).toBe('stand');
    expect(decideBlackjack('bold', parseCards('Ts 6d'), D('5h'), all, true)).toBe('hit');
  });
  it('todas las estrategias devuelven acciones legales en todas las manos de dos cartas', () => {
    const ranks = '23456789TJQKA'.split('');
    for (const s of ['basic', 'cautious', 'bold'] as const) {
      for (const a of ranks) for (const b of ranks) for (const d of ranks) {
        const hand = { cards: parseCards(`${a}s ${b}d`), bet: 10, doubled: false, done: false, fromSplit: false };
        const legal = legalHandActions(hand, 1, { decks: 6, dealerHitsSoft17: false, blackjackPayout: 1.5, doubleAfterSplit: true, maxHands: 2, penetration: 0.75, minBet: 10, maxBet: 5000 });
        expect(legal).toContain(decideBlackjack(s, hand.cards, D(`${d}h`), legal, true));
      }
    }
  });
  it('las apuestas de los bots respetan los límites y sus fichas', () => {
    const r = seededRng(1);
    for (const style of ['minimum', 'steady', 'varied'] as const) {
      for (let i = 0; i < 200; i += 1) {
        const b = botBet(style, 300, 10, 100, r);
        expect(b).toBeGreaterThanOrEqual(10);
        expect(b).toBeLessThanOrEqual(100);
      }
    }
    expect(botBet('varied', 5, 10, 100, r)).toBe(0);
  });
});
