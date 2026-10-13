import { describe, expect, it } from 'vitest';
import { EMPTY_VIEW, applyEvent, cardPosition, displayValue, viewFromState } from './model';

describe('modelo visual del blackjack', () => {
  it('el reparto sigue el orden jugador, crupier, jugador, crupier (tapada)', () => {
    let v = { ...EMPTY_VIEW, hands: [{ bet: 10, doubled: false }] };
    v = applyEvent(v, { type: 'deal', target: 'player', hand: 0, card: 'As' });
    v = applyEvent(v, { type: 'deal', target: 'dealer', card: '9d', faceDown: false });
    v = applyEvent(v, { type: 'deal', target: 'player', hand: 0, card: '7h' });
    v = applyEvent(v, { type: 'deal', target: 'dealer', card: null, faceDown: true });
    expect(v.cards.map((c) => [c.owner, c.index, c.faceUp])).toEqual([
      [0, 0, true], ['dealer', 0, true], [0, 1, true], ['dealer', 1, false],
    ]);
    expect(displayValue(v, 0)).toBe('8 / 18');
    expect(displayValue(v, 'dealer')).toBe('9');
    v = applyEvent(v, { type: 'reveal', card: 'Kc' });
    expect(displayValue(v, 'dealer')).toBe('19');
  });

  it('dividir mueve la segunda carta a una nueva mano y recoloca posiciones', () => {
    let v = { ...EMPTY_VIEW, hands: [{ bet: 10, doubled: false }] };
    v = applyEvent(v, { type: 'deal', target: 'player', hand: 0, card: '8s' });
    v = applyEvent(v, { type: 'deal', target: 'player', hand: 0, card: '8h' });
    const before = cardPosition(v.cards[1]!, v);
    v = applyEvent(v, { type: 'split', hand: 0 });
    expect(v.hands).toHaveLength(2);
    const moved = v.cards[1]!;
    expect(moved.owner).toBe(1);
    expect(cardPosition(moved, v).x).toBeGreaterThan(before.x);
  });

  it('doblar duplica la apuesta y la tercera carta se coloca de lado', () => {
    let v = { ...EMPTY_VIEW, hands: [{ bet: 10, doubled: false }] };
    v = applyEvent(v, { type: 'deal', target: 'player', hand: 0, card: '6s' });
    v = applyEvent(v, { type: 'deal', target: 'player', hand: 0, card: '5h' });
    v = applyEvent(v, { type: 'double', hand: 0 });
    v = applyEvent(v, { type: 'deal', target: 'player', hand: 0, card: 'Td' });
    expect(v.hands[0]!.bet).toBe(20);
    expect(v.cards[2]!.sideways).toBe(true);
    expect(cardPosition(v.cards[2]!, v).rotate).toBe(90);
  });

  it('reconstrucción desde el estado público oculta la carta tapada', () => {
    const v = viewFromState({
      phase: 'player', hands: [{ cards: ['Ts', '6d'], bet: 50, doubled: false, done: false, value: { total: 16, soft: false } }],
      active: 0, dealer: ['9c', null], dealerValue: { total: 9, soft: false }, legalActions: ['hit', 'stand'], shoeRemaining: 300, shoeSize: 312, totalBet: 50, totalPayout: 0,
    });
    expect(v.cards.find((c) => c.owner === 'dealer' && c.index === 1)!.faceUp).toBe(false);
    expect(v.active).toBe(0);
  });
});
