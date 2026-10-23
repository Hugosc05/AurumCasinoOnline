import { describe, expect, it } from 'vitest';
import { CRASH_MAX, crashPayout, crashPointFromHex, crashSurvival, formatMultiplier, multiplierAt, seededRng, timeToMultiplier } from '../src';

const hexFromUniform = (x: number): string => Math.floor(x * 2 ** 52).toString(16).padStart(13, '0') + 'ab';

describe('Cohete', () => {
  it('punto de choque: ≈2 % en 1,00×, P(≥ m) ≈ 0,99/m y tope de 1.000×', () => {
    expect(crashPointFromHex(hexFromUniform(0))).toBe(100);
    expect(crashPointFromHex(hexFromUniform(0.009))).toBe(100);
    expect(crashPointFromHex(hexFromUniform(0.01))).toBe(100);
    expect(crashPointFromHex(hexFromUniform(0.5051))).toBe(200);
    expect(crashPointFromHex(hexFromUniform(0.999999))).toBe(CRASH_MAX);
    expect(() => crashPointFromHex('zz')).toThrow();
    const rng = seededRng(3);
    const N = 200_000;
    const at = [150, 200, 500, 1000];
    const hits = at.map(() => 0);
    let instant = 0;
    for (let i = 0; i < N; i += 1) {
      const x = (rng.int(2 ** 26) * 2 ** 26 + rng.int(2 ** 26)) / 2 ** 52;
      const c = crashPointFromHex(hexFromUniform(x));
      if (c === 100) instant += 1;
      at.forEach((m, k) => { if (c >= m) hits[k]! += 1; });
    }
    // 1,00× incluye el 1 % de ventaja y los choques entre 1,00× y 1,01× (nadie puede cobrar antes de 1,01×).
    expect(instant / N).toBeCloseTo(1 - 0.99 / 1.01, 2);
    at.forEach((m, k) => expect(hits[k]! / N).toBeCloseTo(crashSurvival(m), 2));
  });

  it('cobrar en cualquier objetivo devuelve en torno al 99 %', () => {
    const rng = seededRng(9);
    for (const target of [110, 200, 300]) {
      let paid = 0;
      const N = 150_000;
      for (let i = 0; i < N; i += 1) {
        const x = (rng.int(2 ** 26) * 2 ** 26 + rng.int(2 ** 26)) / 2 ** 52;
        if (crashPointFromHex(hexFromUniform(x)) >= target) paid += crashPayout(100, target);
      }
      expect(paid / (N * 100)).toBeGreaterThan(0.97);
      expect(paid / (N * 100)).toBeLessThan(1.01);
    }
  });

  it('crecimiento exponencial coherente con el tiempo', () => {
    expect(multiplierAt(0)).toBe(100);
    expect(multiplierAt(timeToMultiplier(200))).toBe(200);
    expect(multiplierAt(timeToMultiplier(1000) - 5)).toBeLessThan(1000);
    expect(Math.round(timeToMultiplier(200))).toBe(8664);
    for (let t = 0; t < 60_000; t += 997) expect(multiplierAt(t + 997)).toBeGreaterThanOrEqual(multiplierAt(t));
    expect(crashPayout(37, 245)).toBe(90);
    expect(formatMultiplier(245)).toBe('2,45×');
  });
});
