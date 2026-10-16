import { describe, expect, it } from 'vitest';
import { describeHand, evaluateHand, improvementOdds, parseCards } from '../src';

const H = (s: string) => parseCards(s);
const d = (hole: string, board: string) => describeHand(H(hole), board ? H(board) : []);

describe('asistente de manos: las diez categorías con título en español', () => {
  it.each([
    ['Ah 9d', '2c 5s Jh 7d 3c', 0, 'Carta alta: as'],
    ['Kh Kd', '2c 5s 9h', 1, 'Pareja de reyes'],
    ['Kh 8d', 'Kc 8s 2h', 2, 'Doble pareja: reyes y ochos'],
    ['7h 7d', '7c 2s 9h', 3, 'Trío de sietes'],
    ['9h 8d', '7c 6s 5h', 4, 'Escalera al nueve'],
    ['Ah 2d', '3c 4s 5h', 4, 'Escalera al cinco'],
    ['Ah 9h', '2h 5h Jh', 5, 'Color de corazones al as'],
    ['Ah Ad', 'Ac Ks Kh', 6, 'Full de ases con reyes'],
    ['Qh Qd', 'Qc Qs 2h', 7, 'Póker de reinas'],
    ['9h 8h', '7h 6h 5h', 8, 'Escalera de color al nueve'],
    ['Ah Kh', 'Qh Jh Th', 9, 'Escalera real de corazones'],
  ])('%s + %s → %s', (hole, board, category, title) => {
    const r = d(hole, board);
    expect(r.category).toBe(category);
    expect(r.title).toBe(title);
    expect(r.best).toHaveLength(5);
  });
});

describe('cartas resaltadas = cartas de la combinación', () => {
  it('pareja de reyes: solo los dos reyes, el resto son acompañamiento', () => {
    const r = d('Kh Kd', '2c 5s 9h');
    expect(new Set(r.core)).toEqual(new Set(H('Kh Kd')));
    expect(r.kickers).toHaveLength(3);
    expect(r.kickers).not.toContain('Kh');
  });
  it('doble pareja: las cuatro cartas de las dos parejas', () => {
    const r = d('Kh 8d', 'Kc 8s 2h');
    expect(new Set(r.core)).toEqual(new Set(H('Kh Kc 8d 8s')));
  });
  it('póker: cuatro cartas, sin el kicker', () => {
    const r = d('Qh Qd', 'Qc Qs 2h');
    expect(r.core).toHaveLength(4);
    expect(r.core.every((c) => c[0] === 'Q')).toBe(true);
  });
  it('carta alta: solo la carta más alta', () => {
    expect(d('Ah 9d', '2c 5s Jh 7d 3c').core).toEqual(['Ah']);
  });
  it('escalera rueda: incluye el as', () => {
    expect(new Set(d('Ah 2d', '3c 4s 5h').core)).toEqual(new Set(H('Ah 2d 3c 4s 5h')));
  });
  it('nunca resalta cartas fuera de las cinco mejores', () => {
    const r = d('2c 3d', 'Ah Kh Qh Jh 9s');
    for (const c of r.core) expect(r.best).toContain(c);
    expect(r.core).not.toContain('2c');
    expect(r.holeCardsUsed).toBe(0);
    expect(r.summary).toMatch(/La mesa juega por ti/);
  });
  it('el asistente usa el mismo evaluador que el servidor', () => {
    const r = d('Th 9h', '8c 7s 2h Jd Kc');
    expect(r.best).toEqual(evaluateHand(H('Th 9h 8c 7s 2h Jd Kc')).best);
  });
});

describe('evolución de la mano', () => {
  it('pareja en el flop → doble pareja en el turn → full en el river', () => {
    const flop = d('Kh 8d', 'Kc 4s 2h');
    expect(flop.title).toBe('Pareja de reyes');
    expect(flop.final).toBe(false);
    const turn = d('Kh 8d', 'Kc 4s 2h 8c');
    expect(turn.title).toBe('Doble pareja: reyes y ochos');
    expect(turn.core).toHaveLength(4);
    const river = d('Kh 8d', 'Kc 4s 2h 8c Ks');
    expect(river.title).toBe('Full de reyes con ochos');
    expect(river.final).toBe(true);
    expect(river.improvement).toBeNull();
    expect(river.summary).toMatch(/mano final/);
  });
  it('antes del flop: pareja o carta alta con pistas', () => {
    expect(d('8h 8d', '').title).toBe('Pareja de ochos');
    const s = d('Ah Kh', '');
    expect(s.title).toBe('Carta alta: as');
    expect(s.summary).toMatch(/mismo palo/);
    expect(s.summary).toMatch(/consecutivas/);
    expect(s.improvement).toBeNull();
  });
  it('antes del river nunca afirma un resultado: habla de posibilidades', () => {
    const r = d('8h 8d', 'Kc 4s 2h');
    expect(r.summary).toMatch(/no garantiza que ganes/);
  });
});

describe('probabilidades exactas de mejora', () => {
  it('proyecto de color en el flop: 34,98 % de completar el color', () => {
    const r = d('Ah Kh', '2h 7h 9c');
    expect(r.draws.map((x) => x.kind)).toContain('flush');
    const flushOrBetter = r.improvement!.byCategory.filter((c) => c.category >= 5).reduce((a, c) => a + c.probability, 0);
    expect(flushOrBetter).toBeCloseTo(1 - (38 * 37) / (47 * 46), 10);
    expect(r.improvement!.combinations).toBe((47 * 46) / 2);
    expect(r.improvement!.probability).toBeGreaterThan(flushOrBetter);
  });
  it('en el turn se enumeran las 46 cartas posibles', () => {
    const o = improvementOdds(H('Ah Kh'), H('2h 7h 9c 3d'))!;
    expect(o.combinations).toBe(46);
    expect(o.cardsToCome).toBe(1);
  });
  it('escalera abierta (8 outs) e interna (4 outs)', () => {
    expect(d('9h 8d', '7c 6s Kh').draws.find((x) => x.kind === 'open-ended')?.outs).toBe(8);
    expect(d('9h 8d', '6c 5s Kh').draws.find((x) => x.kind === 'gutshot')?.outs).toBe(4);
  });
  it('no cuenta proyectos que la mesa forma sin las cartas propias', () => {
    expect(d('2c 2d', '9h 8s 7c 6d').draws.some((x) => x.kind === 'open-ended' || x.kind === 'gutshot')).toBe(false);
    expect(d('Tc 2d', '9h 8s 7c 3d').draws.find((x) => x.kind === 'open-ended')?.outs).toBe(8);
  });
});
