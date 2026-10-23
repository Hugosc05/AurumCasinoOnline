import { describe, expect, it } from 'vitest';
import { PLINKO_RISKS, PLINKO_ROWS, dropPlinko, plinkoOdds, plinkoRtp, plinkoTable, seededRng, sequenceRng } from '../src';

describe('Plinko', () => {
  it('tablas simétricas, con rows + 1 casillas y RTP exacto entre 98,5 % y 99,2 %', () => {
    for (const rows of PLINKO_ROWS) {
      for (const risk of PLINKO_RISKS) {
        const t = plinkoTable(rows, risk);
        expect(t).toHaveLength(rows + 1);
        expect(t).toEqual([...t].reverse());
        const rtp = plinkoRtp(rows, risk);
        expect(rtp).toBeGreaterThan(0.985);
        expect(rtp).toBeLessThan(0.992);
      }
      expect(plinkoOdds(rows).reduce((a, b) => a + b, 0)).toBeCloseTo(1, 12);
    }
  });

  it('la casilla es el número de rebotes a la derecha', () => {
    const r = dropPlinko(8, 'medium', 10, sequenceRng([1, 1, 0, 1, 0, 0, 1, 1]));
    expect(r.path).toEqual([1, 1, 0, 1, 0, 0, 1, 1]);
    expect(r.bucket).toBe(5);
    expect(r.multiplier).toBe(plinkoTable(8, 'medium')[5]);
    expect(r.payout).toBe(Math.floor(10 * r.multiplier));
    expect(dropPlinko(16, 'high', 1, sequenceRng(Array(16).fill(0))).multiplier).toBe(1000);
  });

  it('rechaza filas, riesgo y apuestas no válidas', () => {
    expect(() => dropPlinko(10 as 8, 'low', 10, seededRng(1))).toThrow();
    expect(() => dropPlinko(8, 'extreme' as 'low', 10, seededRng(1))).toThrow();
    expect(() => dropPlinko(8, 'low', 0, seededRng(1))).toThrow();
    expect(() => dropPlinko(8, 'low', 1.5, seededRng(1))).toThrow();
  });

  it('una simulación forma la campana de Gauss y converge al RTP', () => {
    const rng = seededRng(42);
    const counts = Array(17).fill(0);
    let paid = 0;
    const N = 200_000;
    for (let i = 0; i < N; i += 1) {
      const r = dropPlinko(16, 'low', 100, rng);
      counts[r.bucket] += 1;
      paid += r.payout;
    }
    const odds = plinkoOdds(16);
    for (let k = 4; k <= 12; k += 1) expect(counts[k] / N).toBeCloseTo(odds[k]!, 2);
    expect(paid / (N * 100)).toBeGreaterThan(plinkoRtp(16, 'low') - 0.02);
    expect(paid / (N * 100)).toBeLessThan(plinkoRtp(16, 'low') + 0.02);
  });
});
