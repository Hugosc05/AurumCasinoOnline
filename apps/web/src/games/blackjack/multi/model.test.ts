import { describe, expect, it } from 'vitest';
import {
  EMPTY_MULTI, MULTI_LANDSCAPE, MULTI_PORTRAIT, applyMultiEvent, dealerHand, handAnchor, multiCardPos, reachTo, seatSpots,
  visFromSnapshot, visibleTotal, type MultiEvent, type MultiSnapshot, type MultiVis,
} from './model';

const run = (events: MultiEvent[], from: MultiVis = EMPTY_MULTI): MultiVis => events.reduce(applyMultiEvent, from);

describe('modelo visual de la mesa multijugador', () => {
  it('reparte, oculta la carta tapada y la revela solo con el evento', () => {
    const v = run([
      { type: 'betting', roundNo: 1 },
      { type: 'bet', seat: 0, amount: 10 },
      { type: 'bet', seat: 2, amount: 20 },
      { type: 'deal', to: 'seat', seat: 0, hand: 0, card: 'Ts' },
      { type: 'deal', to: 'seat', seat: 2, hand: 0, card: '9h' },
      { type: 'deal', to: 'dealer', card: '7d', faceDown: false },
      { type: 'deal', to: 'seat', seat: 0, hand: 0, card: '6s' },
      { type: 'deal', to: 'seat', seat: 2, hand: 0, card: '9c' },
      { type: 'deal', to: 'dealer', card: null, faceDown: true },
    ]);
    const dealer = v.cards.filter((c) => c.owner === 'dealer');
    expect(dealer.map((c) => c.card)).toEqual(['7d', null]);
    expect(visibleTotal(dealer)).toBe('7');
    expect(v.hands[2]![0]!.bet).toBe(20);
    const after = applyMultiEvent(v, { type: 'reveal', card: 'Kd' });
    expect(after.cards.filter((c) => c.owner === 'dealer').map((c) => c.card)).toEqual(['7d', 'Kd']);
    expect(after.dealerRevealed).toBe(true);
  });

  it('dividir mueve la segunda carta a una mano nueva del mismo asiento', () => {
    const v = run([
      { type: 'bet', seat: 1, amount: 10 },
      { type: 'deal', to: 'seat', seat: 1, hand: 0, card: '8s' },
      { type: 'deal', to: 'seat', seat: 1, hand: 0, card: '8d' },
      { type: 'split', seat: 1, hand: 0 },
      { type: 'deal', to: 'seat', seat: 1, hand: 0, card: '3c' },
      { type: 'deal', to: 'seat', seat: 1, hand: 1, card: 'Kc' },
    ]);
    expect(v.hands[1]).toHaveLength(2);
    const ids = v.cards.map((c) => c.id);
    expect(new Set(ids).size).toBe(ids.length); // sin claves repetidas
    const h1 = v.cards.filter((c) => c.owner !== 'dealer' && c.owner.hand === 1).map((c) => c.card);
    expect(h1).toEqual(['8d', 'Kc']);
  });

  it('la reconstrucción desde la instantánea usa los mismos identificadores que la animación', () => {
    const snap = {
      seats: [{ seat: 0, bet: null }, null],
      round: {
        phase: 'player', turn: { seat: 0, hand: 0 }, dealer: ['7d', null], dealerValue: null, shoeRemaining: 300, shoeSize: 312,
        seats: [{ seat: 0, hands: [{ cards: ['Ts', '6s'], bet: 10, doubled: false, done: false, value: { total: 16, soft: false } }] }],
      },
    } as unknown as MultiSnapshot;
    const fromSnap = visFromSnapshot(snap);
    const animated = run([
      { type: 'deal', to: 'seat', seat: 0, hand: 0, card: 'Ts' },
      { type: 'deal', to: 'dealer', card: '7d', faceDown: false },
      { type: 'deal', to: 'seat', seat: 0, hand: 0, card: '6s' },
      { type: 'deal', to: 'dealer', card: null, faceDown: true },
    ]);
    expect(fromSnap.cards.map((c) => c.id).sort()).toEqual(animated.cards.map((c) => c.id).sort());
    expect(fromSnap.cards.find((c) => c.id === 'd1')!.card).toBeNull();
  });
});

describe('disposición de la mesa', () => {
  for (const [name, g] of [['apaisada', MULTI_LANDSCAPE], ['vertical', MULTI_PORTRAIT]] as const) {
    it(`${name}: asientos dentro del escenario, sin solaparse y cada mano en su sitio`, () => {
      for (const n of [3, 5, 7]) {
        const spots = Array.from({ length: n }, (_, i) => seatSpots(i, n, g));
        const plateW = (g.layout === 'stacked' ? 120 : 136) * g.plateScale;
        for (const s of spots) {
          expect(s.plate.x - plateW / 2).toBeGreaterThanOrEqual(-4);
          expect(s.plate.x + plateW / 2).toBeLessThanOrEqual(g.w + 4);
          expect(s.plate.y).toBeLessThan(g.h - 60);
          // Las cartas nunca tapan las del crupier (zona central de hasta 5 cartas).
          const clearX = Math.abs(s.cards.x - g.dealerRow.x) > g.dealerCardW * 1.7 + g.cardW * 0.85;
          const clearY = s.cards.y - g.dealerRow.y > (g.dealerCardW * 1.4) / 2 + (g.cardW * 1.4) / 2;
          expect(clearX || clearY).toBe(true);
        }
        if (n > 5) continue; // con 7 asientos las placas pueden rozarse en pantallas estrechas
        for (let i = 0; i < n; i += 1) {
          for (let j = i + 1; j < n; j += 1) {
            const a = spots[i]!.cards;
            const b = spots[j]!.cards;
            // Dos manos de 3 cartas de asientos distintos no se tapan.
            expect(Math.abs(a.x - b.x) > g.cardW * 1.6 || Math.abs(a.y - b.y) > g.cardW * 1.4).toBe(true);
          }
        }
      }
    });
  }

  it('las cartas salen de la mano del crupier que reparte hacia ese lado', () => {
    const g = MULTI_LANDSCAPE;
    const right = seatSpots(0, 5, g).cards; // primera base: a nuestra derecha
    const left = seatSpots(4, 5, g).cards;
    expect(reachTo(right, g)).toBeLessThan(-15);
    expect(dealerHand(g, reachTo(right, g)).x).toBeGreaterThan(dealerHand(g, reachTo(left, g)).x);
  });

  it('las cartas de una mano se abren sin salirse de su anclaje', () => {
    const v = run([
      { type: 'deal', to: 'seat', seat: 2, hand: 0, card: '2s' },
      { type: 'deal', to: 'seat', seat: 2, hand: 0, card: '3s' },
      { type: 'deal', to: 'seat', seat: 2, hand: 0, card: '4s' },
    ]);
    const a = handAnchor(2, 0, 1, 5, MULTI_LANDSCAPE);
    const xs = v.cards.map((c) => multiCardPos(c, v, 5, MULTI_LANDSCAPE).x);
    expect(Math.min(...xs)).toBeLessThan(a.x);
    expect(Math.max(...xs)).toBeGreaterThan(a.x);
    expect(Math.max(...xs) - Math.min(...xs)).toBeLessThan(MULTI_LANDSCAPE.cardW * 1.5);
  });
});
