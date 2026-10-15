import { describe, expect, it } from 'vitest';
import { REEL_FULL, REEL_REDUCED, createReel, mod, requestStop, slamStop, startSpin, step, type ReelConfig } from './reelMotion';

/** Simula un rodillo fotograma a fotograma (dt en ms). */
function simulate(opts: { L: number; from: number; target: number; stopAt: number; knownAt?: number; dt?: number; cfg?: ReelConfig; slamAt?: number }) {
  const { L, from, target, stopAt, dt = 16.7, cfg = REEL_FULL } = opts;
  const s = createReel(L, from, cfg);
  startSpin(s, 0, 0, cfg);
  const frames: { t: number; pos: number; vel: number; phase: string }[] = [];
  let stoppedAt: number | null = null;
  let stopEvents = 0;
  for (let t = 0; t < 20000; t += dt) {
    if (t >= (opts.knownAt ?? 0) && s.target === null) requestStop(s, target, stopAt);
    if (opts.slamAt !== undefined && t >= opts.slamAt) slamStop(s, t);
    const r = step(s, t);
    frames.push({ t, pos: s.pos, vel: s.vel, phase: s.phase });
    if (r.stopped) {
      stopEvents += 1;
      stoppedAt = t;
      break;
    }
  }
  return { s, frames, stoppedAt, stopEvents };
}

describe('física de los rodillos', () => {
  it('siempre termina exactamente en la parada del servidor, con una sola parada', () => {
    for (const L of [38, 39]) {
      for (let target = 0; target < L; target += 3) {
        for (const from of [0, 7, L - 1]) {
          const { s, stoppedAt, stopEvents } = simulate({ L, from, target, stopAt: 900 + target * 7 });
          expect(stoppedAt).not.toBeNull();
          expect(stopEvents).toBe(1);
          expect(s.phase).toBe('idle');
          expect(s.pos).toBe(target);
          expect(mod(s.pos, L)).toBe(target);
        }
      }
    }
  });

  it('no frena antes de lo previsto y sigue girando mientras no llega el resultado', () => {
    // El resultado llega tarde (servidor lento): el rodillo sigue en crucero.
    const { frames, stoppedAt } = simulate({ L: 38, from: 3, target: 20, stopAt: 2500, knownAt: 2400 });
    const braking = frames.find((f) => f.phase === 'brake')!;
    expect(braking.t).toBeGreaterThanOrEqual(2500);
    expect(frames.filter((f) => f.t > 600 && f.t < 2400).every((f) => f.phase === 'cruise')).toBe(true);
    expect(stoppedAt!).toBeLessThan(2500 + 1200);
  });

  it('el movimiento es continuo: sin saltos de velocidad ni de la fracción visible', () => {
    const { frames } = simulate({ L: 39, from: 11, target: 4, stopAt: 1300, dt: 8 });
    for (let i = 1; i < frames.length; i += 1) {
      const a = frames[i - 1]!;
      const b = frames[i]!;
      const dt = (b.t - a.t) / 1000;
      // Velocidad: cambios suaves (aceleración acotada).
      expect(Math.abs(b.vel - a.vel)).toBeLessThan(REEL_FULL.vmax * 0.2 + 1);
      // Desplazamiento visible módulo 1 coherente con la velocidad (el salto de la frenada es un número entero de símbolos).
      const expected = ((a.vel + b.vel) / 2) * dt;
      const moved = a.pos - b.pos;
      const diff = Math.abs(mod(moved - expected + 0.5, 1) - 0.5);
      expect(diff).toBeLessThan(0.08);
    }
  });

  it('durante la frenada los símbolos solo caen (sin retroceder) y después rebotan a la parada', () => {
    const { frames } = simulate({ L: 38, from: 0, target: 15, stopAt: 1000, dt: 8 });
    const brake = frames.filter((f) => f.phase === 'brake');
    for (let i = 1; i < brake.length; i += 1) expect(brake[i]!.pos).toBeLessThanOrEqual(brake[i - 1]!.pos + 1e-9);
    const settle = frames.filter((f) => f.phase === 'settle');
    expect(settle.length).toBeGreaterThan(0);
    for (const f of settle) expect(Math.abs(f.pos - 15)).toBeLessThan(0.5);
  });

  it('la parada rápida acorta el giro sin cambiar el resultado', () => {
    const normal = simulate({ L: 38, from: 2, target: 30, stopAt: 3000 });
    const slam = simulate({ L: 38, from: 2, target: 30, stopAt: 3000, slamAt: 700 });
    expect(slam.stoppedAt!).toBeLessThan(normal.stoppedAt! - 1500);
    expect(slam.s.pos).toBe(30);
  });

  it('en modo reducido no hay retroceso ni rebote y también acaba en la parada', () => {
    const { s, frames } = simulate({ L: 39, from: 5, target: 9, stopAt: 500, cfg: REEL_REDUCED });
    expect(frames.some((f) => f.phase === 'windup' || f.phase === 'settle')).toBe(false);
    expect(s.pos).toBe(9);
  });

  it('un fotograma muy largo (pestaña en segundo plano) no rompe la parada', () => {
    const { s, stopEvents } = simulate({ L: 38, from: 1, target: 22, stopAt: 800, dt: 900 });
    expect(stopEvents).toBe(1);
    expect(s.pos).toBe(22);
  });
});
