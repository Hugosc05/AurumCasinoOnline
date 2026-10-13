import { describe, expect, it } from 'vitest';
import {
  DEFAULT_BLACKJACK_RULES,
  BlackjackError,
  applyBlackjackAction,
  handValue,
  isNatural,
  blackjackLegalActions,
  needsReshuffle,
  parseCards,
  publicBlackjackState,
  seededRng,
  startBlackjack,
  type ShoeState,
} from '../src';

/** Zapato con las cartas en orden de extracción (P1, D1, P2, D2, ...). */
function shoe(order: string): ShoeState {
  const cards = parseCards(order).reverse();
  // Relleno para que nunca se agote durante la prueba.
  const filler = parseCards('2c 3c 4c 5c 6c 7c 8c 9c').concat(parseCards('2d 3d 4d 5d 6d 7d 8d 9d'));
  const all = [...filler, ...cards];
  return { cards: all, size: all.length };
}
const rng = seededRng(1);

describe('valoración de manos', () => {
  it('cuenta los ases como 11 o 1', () => {
    expect(handValue(parseCards('As 6h'))).toEqual({ total: 17, soft: true });
    expect(handValue(parseCards('As 6h Tc'))).toEqual({ total: 17, soft: false });
    expect(handValue(parseCards('As Ad'))).toEqual({ total: 12, soft: true });
    expect(handValue(parseCards('As Ad Ac Ah 7s'))).toEqual({ total: 21, soft: true });
    expect(handValue(parseCards('Kh Qd'))).toEqual({ total: 20, soft: false });
  });
  it('detecta blackjack natural solo con dos cartas', () => {
    expect(isNatural(parseCards('As Kd'))).toBe(true);
    expect(isNatural(parseCards('7s 7d 7h'))).toBe(false);
  });
});

describe('ronda de blackjack', () => {
  it('blackjack natural del jugador paga 3:2', () => {
    const s = startBlackjack(100, shoe('As 9d Kh 7c'), rng);
    expect(s.phase).toBe('settled');
    expect(s.hands[0]!.outcome).toBe('blackjack');
    expect(s.totalPayout).toBe(250);
  });

  it('blackjack de ambos es empate', () => {
    const s = startBlackjack(100, shoe('As Ad Kh Qc'), rng);
    expect(s.hands[0]!.outcome).toBe('push');
    expect(s.totalPayout).toBe(100);
  });

  it('el crupier con blackjack (peek) gana inmediatamente', () => {
    const s = startBlackjack(100, shoe('9s Ad Kh Qc'), rng);
    expect(s.phase).toBe('settled');
    expect(s.hands[0]!.outcome).toBe('lose');
    expect(s.totalPayout).toBe(0);
  });

  it('el jugador se pasa (bust) y pierde sin que el crupier robe', () => {
    let s = startBlackjack(50, shoe('Ts 9d 6h 7c Kd'), rng);
    s = applyBlackjackAction(s, 'hit', rng);
    expect(s.phase).toBe('settled');
    expect(s.hands[0]!.outcome).toBe('bust');
    expect(s.dealer).toHaveLength(2);
    expect(s.totalPayout).toBe(0);
  });

  it('victoria del jugador cuando el crupier se pasa', () => {
    // Jugador 10+8=18; crupier 10+6=16 → pide 9 → 25.
    let s = startBlackjack(50, shoe('Ts Td 8h 6c 9d'), rng);
    s = applyBlackjackAction(s, 'stand', rng);
    expect(s.hands[0]!.outcome).toBe('win');
    expect(s.totalPayout).toBe(100);
  });

  it('victoria del crupier con mejor mano', () => {
    let s = startBlackjack(50, shoe('Ts Td 7h 9c'), rng);
    s = applyBlackjackAction(s, 'stand', rng);
    expect(s.hands[0]!.outcome).toBe('lose');
    expect(s.totalPayout).toBe(0);
  });

  it('empate devuelve la apuesta', () => {
    let s = startBlackjack(50, shoe('Ts Td 8h 8c'), rng);
    s = applyBlackjackAction(s, 'stand', rng);
    expect(s.hands[0]!.outcome).toBe('push');
    expect(s.totalPayout).toBe(50);
  });

  it('el crupier se planta en 17 blando (S17)', () => {
    let s = startBlackjack(50, shoe('Ts As 9h 6c 5d'), rng);
    s = applyBlackjackAction(s, 'stand', rng);
    expect(s.dealer).toHaveLength(2);
    expect(s.hands[0]!.outcome).toBe('win');
  });

  it('con H17 el crupier pide con 17 blando', () => {
    let s = startBlackjack(50, shoe('Ts As 9h 6c 5d'), rng, { ...DEFAULT_BLACKJACK_RULES, dealerHitsSoft17: true });
    s = applyBlackjackAction(s, 'stand', rng);
    // A+6 (17 blando) → pide 5 → 12 duro → pide 9 (relleno) → 21.
    expect(s.dealer.slice(0, 3)).toEqual(['As', '6c', '5d']);
    expect(handValue(s.dealer).total).toBeGreaterThanOrEqual(17);
  });

  it('doblar duplica la apuesta, da una carta y cierra la mano', () => {
    let s = startBlackjack(100, shoe('6s Td 5h 7c Ts Kd'), rng);
    expect(blackjackLegalActions(s)).toContain('double');
    s = applyBlackjackAction(s, 'double', rng);
    expect(s.hands[0]!.bet).toBe(200);
    expect(s.hands[0]!.cards).toHaveLength(3);
    expect(s.totalBet).toBe(200);
    // Jugador 21, crupier 17 + K = 27 → gana el jugador 2×200.
    expect(s.hands[0]!.outcome).toBe('win');
    expect(s.totalPayout).toBe(400);
  });

  it('no permite doblar con tres cartas ni acciones tras liquidar', () => {
    let s = startBlackjack(100, shoe('2s Td 3h 7c 2d 9s'), rng);
    s = applyBlackjackAction(s, 'hit', rng);
    expect(blackjackLegalActions(s)).not.toContain('double');
    expect(() => applyBlackjackAction(s, 'double', rng)).toThrow(BlackjackError);
    s = applyBlackjackAction(s, 'stand', rng);
    expect(s.phase).toBe('settled');
    expect(() => applyBlackjackAction(s, 'hit', rng)).toThrow(BlackjackError);
  });

  it('divide parejas en dos manos con apuesta independiente', () => {
    let s = startBlackjack(100, shoe('8s Td 8h 7c 3d Ts'), rng);
    expect(blackjackLegalActions(s)).toContain('split');
    s = applyBlackjackAction(s, 'split', rng);
    expect(s.hands).toHaveLength(2);
    expect(s.totalBet).toBe(200);
    expect(s.hands[0]!.cards).toEqual(parseCards('8s 3d'));
    expect(s.hands[1]!.cards).toEqual(parseCards('8h Ts'));
    expect(blackjackLegalActions(s)).not.toContain('split'); // una sola división
  });

  it('rechaza apuestas fuera de límites', () => {
    expect(() => startBlackjack(1, null, rng)).toThrow(BlackjackError);
    expect(() => startBlackjack(10.5, null, rng)).toThrow(BlackjackError);
  });

  it('oculta la carta del crupier en la vista pública mientras juega el jugador', () => {
    const s = startBlackjack(50, shoe('Ts Td 8h 8c'), rng);
    const pub = publicBlackjackState(s);
    expect(pub.dealer).toEqual(['Td', null]);
    expect(JSON.stringify(pub)).not.toContain('8c');
  });

  it('rebaraja al superar la penetración del zapato', () => {
    expect(needsReshuffle(null, DEFAULT_BLACKJACK_RULES)).toBe(true);
    expect(needsReshuffle({ cards: new Array(300).fill('2c'), size: 312 }, DEFAULT_BLACKJACK_RULES)).toBe(false);
    expect(needsReshuffle({ cards: new Array(70).fill('2c'), size: 312 }, DEFAULT_BLACKJACK_RULES)).toBe(true);
    const s = startBlackjack(50, null, seededRng(4));
    expect(s.events[0]).toEqual({ type: 'shuffle' });
    expect(s.shoeSize).toBe(312);
  });
});
