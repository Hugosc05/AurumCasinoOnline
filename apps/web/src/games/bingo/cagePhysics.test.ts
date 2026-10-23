import { describe, expect, it } from 'vitest';
import { CAGE, createBalls, stepCage } from './cagePhysics';

describe('física del bombo', () => {
  it('90 bolas giran 15 s sin salirse, sin NaN y sin acumular energía', () => {
    const balls = createBalls(Array.from({ length: 90 }, (_, i) => i + 1), 3);
    const acc = { t: 0 };
    let maxSpeed = 0;
    let lifted = 0;
    for (let f = 0; f < 60 * 15; f += 1) {
      stepCage(balls, 1 / 60, 2.2, acc);
      for (const b of balls) {
        const d = Math.hypot(...b.p);
        expect(Number.isFinite(d)).toBe(true);
        expect(d).toBeLessThanOrEqual(CAGE.radius);
        maxSpeed = Math.max(maxSpeed, Math.hypot(...b.v));
        if (b.p[1] > 0.1) lifted += 1;
      }
    }
    expect(maxSpeed).toBeLessThan(6);
    // El giro arrastra bolas hacia arriba (no se quedan quietas en el fondo).
    expect(lifted).toBeGreaterThan(500);
  });

  it('las bolas inactivas (ya extraídas) no se mueven', () => {
    const balls = createBalls([1, 2, 3], 1);
    balls[1]!.active = false;
    const p = [...balls[1]!.p];
    stepCage(balls, 1, 2);
    expect(balls[1]!.p).toEqual(p);
  });
});
