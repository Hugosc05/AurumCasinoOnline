import { describe, expect, it } from 'vitest';
import { GEO, POCKET_RAD, planWheelSpin, pocketAt } from './wheelPhysics';

describe('física de la ruleta 3D', () => {
  it('la bola termina siempre en el bolsillo decidido por el servidor', () => {
    for (let pocket = 0; pocket < 37; pocket += 1) {
      for (const seed of [1, 99, 123456]) {
        const run = planWheelSpin({ pocket, wheelAngle: pocket * 0.37, seed: seed + pocket });
        expect(run.pocket).toBe(pocket);
        const last = run.frames[run.frames.length - 1]!;
        expect(last.phase).toBe('seated');
        expect(pocketAt(last.ball - last.wheel)).toBe(pocket);
      }
    }
  });

  it('es una tirada creíble: pista, caída, rebotes y asentamiento en tiempos de casino', () => {
    const stats: number[] = [];
    for (let seed = 1; seed <= 40; seed += 1) {
      const run = planWheelSpin({ pocket: seed % 37, wheelAngle: 0, seed });
      const drop = run.events.find((e) => e.kind === 'drop')!;
      expect(drop.t).toBeGreaterThan(3);
      expect(drop.t).toBeLessThan(8);
      expect(run.seatedAt).toBeGreaterThan(drop.t + 0.5);
      expect(run.seatedAt).toBeLessThan(14);
      expect(run.events.filter((e) => e.kind === 'fret').length).toBeGreaterThan(0);
      // La corrección del rotor es pequeña (pocos bolsillos) y termina antes de que la bola lo toque.
      expect(Math.abs(run.correction)).toBeLessThanOrEqual(Math.PI);
      stats.push(run.seatedAt);
    }
    const avg = stats.reduce((a, b) => a + b, 0) / stats.length;
    expect(avg).toBeGreaterThan(6);
    expect(avg).toBeLessThan(12);
  });

  it('movimiento continuo: sin saltos de posición entre fotogramas', () => {
    const run = planWheelSpin({ pocket: 17, wheelAngle: 1, seed: 7 });
    for (let i = 1; i < run.frames.length; i += 1) {
      const a = run.frames[i - 1]!;
      const b = run.frames[i]!;
      const dx = b.r * Math.cos(b.ball) - a.r * Math.cos(a.ball);
      const dz = b.r * Math.sin(b.ball) - a.r * Math.sin(a.ball);
      // A 120 fotogramas por segundo, la bola (hasta ~10 m/s al lanzarla) nunca recorre más de 11 cm entre dos.
      expect(Math.hypot(dx, dz, b.y - a.y)).toBeLessThan(0.11);
      expect(Math.abs(b.wheel - a.wheel)).toBeLessThan(0.1);
      expect(b.y).toBeGreaterThanOrEqual(GEO.ballR);
    }
  });

  it('la tirada corta es más breve y también exacta', () => {
    const run = planWheelSpin({ pocket: 4, wheelAngle: 0, seed: 3, short: true });
    expect(run.pocket).toBe(4);
    expect(run.seatedAt).toBeLessThan(7);
    expect(POCKET_RAD).toBeCloseTo((2 * Math.PI) / 37);
  });
});
