import { describe, expect, it } from 'vitest';
import { EMPTY_VIS, applyPokerEvent, type PokerVis } from './model';

describe('modelo visual del póker', () => {
  it('reproduce una mano corta y conserva las fichas', () => {
    let v: PokerVis = { ...EMPTY_VIS, stacks: { 0: 1000, 1: 1000 } };
    const ev = (e: Parameters<typeof applyPokerEvent>[1]) => (v = applyPokerEvent(v, e, 0, ['As', 'Ad']));
    ev({ type: 'hand_start', handId: 'h', button: 0, sb: 0, bb: 1, seats: [0, 1] });
    ev({ type: 'blind', seat: 0, kind: 'small', amount: 5, stack: 995 });
    ev({ type: 'blind', seat: 1, kind: 'big', amount: 10, stack: 990 });
    ev({ type: 'deal_hole', seat: 1, index: 0 });
    ev({ type: 'deal_hole', seat: 0, index: 0 });
    expect(v.revealed[0]).toEqual(['As', 'Ad']);
    expect(v.revealed[1]).toBeUndefined();
    ev({ type: 'action', seat: 0, action: 'raise', added: 25, betTo: 30, stack: 970, pot: 40 });
    ev({ type: 'action', seat: 1, action: 'fold', added: 0, betTo: 10, stack: 990, pot: 40 });
    expect(v.folded[1]).toBe(true);
    ev({ type: 'collect', pot: 40 });
    ev({ type: 'return', seat: 0, amount: 20 });
    ev({ type: 'award', pot: 0, amount: 20, winners: [{ seat: 0, amount: 20 }], handName: null });
    expect(v.stacks[0]! + v.stacks[1]!).toBe(2000);
    expect(v.pot).toBe(0);
    expect(v.winners[0]).toBe(20);
  });

  it('el showdown revela solo las manos enviadas por el servidor', () => {
    let v = { ...EMPTY_VIS };
    v = applyPokerEvent(v, { type: 'showdown', hands: [{ seat: 2, cards: ['Kh', 'Kd'], name: 'Pareja', best: [] }] }, 0, null);
    expect(v.revealed).toEqual({ 2: ['Kh', 'Kd'] });
  });
});
