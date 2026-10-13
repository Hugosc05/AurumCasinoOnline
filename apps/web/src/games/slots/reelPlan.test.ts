import { REEL_STRIPS, gridFromStops } from '@aurum/engine';
import { describe, expect, it } from 'vitest';
import { reelPath } from './reelPlan';

describe('recorrido visual de los rodillos', () => {
  it('empieza en la ventana actual y termina exactamente en la ventana del servidor', () => {
    for (let reel = 0; reel < 5; reel += 1) {
      const strip = REEL_STRIPS[reel]!;
      for (const [cur, fin] of [[0, 0], [3, 17], [30, 2], [strip.length - 1, 0]] as const) {
        const path = reelPath(strip, cur, fin, 2);
        const finalWindow = path.slice(0, 3);
        const startWindow = path.slice(-3);
        expect(finalWindow).toEqual(gridFromStops([fin, fin, fin, fin, fin])[reel]);
        expect(startWindow).toEqual(gridFromStops([cur, cur, cur, cur, cur])[reel]);
        expect(path.length).toBeGreaterThanOrEqual(2 * strip.length + 3);
      }
    }
  });
  it('cada símbolo intermedio sigue el orden real de la tira', () => {
    const strip = REEL_STRIPS[2]!;
    const path = reelPath(strip, 10, 25, 1);
    for (let k = 0; k < path.length; k += 1) expect(path[k]).toBe(strip[(25 + k) % strip.length]);
  });
});
