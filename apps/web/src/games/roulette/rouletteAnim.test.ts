import { WHEEL_ORDER } from '@aurum/engine';
import { describe, expect, it } from 'vitest';
import { POCKET_DEG, planSpin } from './rouletteAnim';

const mod = (a: number, n: number) => ((a % n) + n) % n;

describe('trayectoria de la ruleta', () => {
  it('la bola termina SIEMPRE en el bolsillo decidido por el servidor', () => {
    for (let idx = 0; idx < 37; idx += 1) {
      for (const start of [0, 37, 211.4]) {
        const plan = planSpin({ pocketIndex: idx, wheelAngle: start, ballRelAngle: start * 2, duration: 7600, bounces: true, variation: (idx % 7) / 7 });
        const end = plan.final;
        expect(end.phase).toBe('seated');
        expect(end.radius).toBe(0);
        const landed = Math.round(mod(end.ballRel, 360) / POCKET_DEG) % 37;
        expect(landed).toBe(idx);
        expect(WHEEL_ORDER[landed]).toBe(WHEEL_ORDER[idx]);
      }
    }
  });

  it('la rueda decelera de forma continua (sin saltos de velocidad)', () => {
    const plan = planSpin({ pocketIndex: 5, wheelAngle: 0, ballRelAngle: 0, duration: 7600, bounces: false });
    let prevSpeed = Infinity;
    for (let t = 0; t < 7600; t += 100) {
      const a = plan.frame(t).wheel;
      const b = plan.frame(t + 100).wheel;
      const speed = b - a;
      expect(speed).toBeGreaterThan(0);
      expect(speed).toBeLessThanOrEqual(prevSpeed + 1e-9);
      prevSpeed = speed;
    }
  });

  it('la bola gira en sentido contrario y frena progresivamente', () => {
    const plan = planSpin({ pocketIndex: 20, wheelAngle: 0, ballRelAngle: 90, duration: 7600, bounces: false });
    const speeds: number[] = [];
    for (let t = 0; t < 5000; t += 250) speeds.push(plan.frame(t).ballRel - plan.frame(t + 250).ballRel);
    for (let i = 1; i < speeds.length; i += 1) {
      expect(speeds[i]!).toBeGreaterThan(0);
      expect(speeds[i]!).toBeLessThan(speeds[i - 1]!);
    }
  });

  it('empieza desde la posición actual de la bola (continuidad visual)', () => {
    const plan = planSpin({ pocketIndex: 3, wheelAngle: 40, ballRelAngle: 123, duration: 6000, bounces: true });
    const f0 = plan.frame(0);
    expect(f0.wheel).toBeCloseTo(40);
    expect(mod(f0.ballRel, 360)).toBeCloseTo(123, 6);
    expect(f0.radius).toBe(1);
  });

  it('la duración reducida conserva el resultado', () => {
    const plan = planSpin({ pocketIndex: 30, wheelAngle: 0, ballRelAngle: 0, duration: 2200, bounces: false });
    expect(Math.round(mod(plan.final.ballRel, 360) / POCKET_DEG) % 37).toBe(30);
  });
});
