import { isValidInside, validateRouletteBets, type RouletteBet } from '@aurum/engine';
import { describe, expect, it } from 'vitest';
import { betKey, buildZones } from './board';

describe('tapete de ruleta', () => {
  const zones = buildZones();
  it('todas las zonas generan apuestas válidas para el servidor', () => {
    for (const z of zones) {
      const bet = { ...z.bet, amount: 1 } as RouletteBet;
      if ('numbers' in bet) expect(isValidInside(bet.kind, bet.numbers), z.label).toBe(true);
      expect(() => validateRouletteBets([bet])).not.toThrow();
    }
  });
  it('no hay zonas duplicadas y están todas las modalidades', () => {
    const keys = zones.map((z) => z.key);
    expect(new Set(keys).size).toBe(keys.length);
    const count = (k: string) => zones.filter((z) => z.bet.kind === k).length;
    expect(count('straight')).toBe(37);
    expect(count('split')).toBe(24 + 33 + 3); // verticales + horizontales + con el cero
    expect(count('street')).toBe(12 + 2);
    expect(count('corner')).toBe(22 + 1);
    expect(count('sixline')).toBe(11);
    expect(count('dozen')).toBe(3);
    expect(count('column')).toBe(3);
    for (const k of ['red', 'black', 'even', 'odd', 'low', 'high']) expect(count(k)).toBe(1);
  });
  it('la clave es independiente del orden de los números', () => {
    expect(betKey({ kind: 'split', numbers: [5, 2] })).toBe(betKey({ kind: 'split', numbers: [2, 5] }));
  });
});
