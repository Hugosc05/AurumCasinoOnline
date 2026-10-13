import { describe, expect, it } from 'vitest';
import {
  RED_NUMBERS,
  RouletteError,
  WHEEL_ORDER,
  isValidInside,
  numberColor,
  sequenceRng,
  settleRoulette,
  spinRoulette,
  validateRouletteBets,
  type RouletteBet,
} from '../src';

describe('rueda europea', () => {
  it('tiene 37 bolsillos únicos del 0 al 36', () => {
    expect(WHEEL_ORDER).toHaveLength(37);
    expect(new Set(WHEEL_ORDER).size).toBe(37);
    expect([...WHEEL_ORDER].sort((a, b) => a - b)).toEqual(Array.from({ length: 37 }, (_, i) => i));
  });
  it('alterna rojo y negro alrededor de la rueda', () => {
    for (let i = 1; i < 36; i += 1) {
      expect(numberColor(WHEEL_ORDER[i]!)).not.toBe(numberColor(WHEEL_ORDER[i + 1]!));
    }
  });
  it('asigna colores correctos', () => {
    expect(numberColor(0)).toBe('green');
    expect(RED_NUMBERS.size).toBe(18);
    expect(numberColor(1)).toBe('red');
    expect(numberColor(2)).toBe('black');
    expect(numberColor(10)).toBe('black');
    expect(numberColor(19)).toBe('red');
    expect(numberColor(36)).toBe('red');
    expect(() => numberColor(37)).toThrow();
  });
  it('el sorteo produce números 0..36 según el RNG', () => {
    expect(spinRoulette(sequenceRng([0]))).toBe(0);
    expect(spinRoulette(sequenceRng([36]))).toBe(36);
    expect(spinRoulette(sequenceRng([37]))).toBe(0);
  });
});

describe('validación de apuestas interiores', () => {
  it('caballos válidos e inválidos', () => {
    expect(isValidInside('split', [1, 2])).toBe(true);
    expect(isValidInside('split', [1, 4])).toBe(true);
    expect(isValidInside('split', [0, 3])).toBe(true);
    expect(isValidInside('split', [3, 4])).toBe(false); // cambio de transversal
    expect(isValidInside('split', [1, 3])).toBe(false);
    expect(isValidInside('split', [0, 4])).toBe(false);
  });
  it('transversales, cuadros y seisenas', () => {
    expect(isValidInside('street', [4, 5, 6])).toBe(true);
    expect(isValidInside('street', [0, 1, 2])).toBe(true);
    expect(isValidInside('street', [5, 6, 7])).toBe(false);
    expect(isValidInside('corner', [1, 2, 4, 5])).toBe(true);
    expect(isValidInside('corner', [0, 1, 2, 3])).toBe(true);
    expect(isValidInside('corner', [3, 4, 6, 7])).toBe(false);
    expect(isValidInside('corner', [32, 33, 35, 36])).toBe(true);
    expect(isValidInside('sixline', [31, 32, 33, 34, 35, 36])).toBe(true);
    expect(isValidInside('sixline', [2, 3, 4, 5, 6, 7])).toBe(false);
    expect(isValidInside('straight', [37])).toBe(false);
  });
  it('rechaza importes y totales fuera de límites', () => {
    expect(() => validateRouletteBets([])).toThrow(RouletteError);
    expect(() => validateRouletteBets([{ kind: 'red', amount: 0 }])).toThrow(RouletteError);
    expect(() => validateRouletteBets([{ kind: 'straight', numbers: [7], amount: 5000 }])).toThrow(RouletteError);
    expect(() => validateRouletteBets([{ kind: 'split', numbers: [3, 4], amount: 10 }])).toThrow(RouletteError);
    expect(validateRouletteBets([{ kind: 'red', amount: 10 }, { kind: 'straight', numbers: [7], amount: 5 }])).toBe(15);
  });
});

describe('pagos de cada modalidad', () => {
  const cases: [RouletteBet, number, number][] = [
    [{ kind: 'straight', numbers: [17], amount: 10 }, 17, 360],
    [{ kind: 'split', numbers: [17, 20], amount: 10 }, 20, 180],
    [{ kind: 'street', numbers: [16, 17, 18], amount: 10 }, 18, 120],
    [{ kind: 'corner', numbers: [17, 18, 20, 21], amount: 10 }, 21, 90],
    [{ kind: 'sixline', numbers: [13, 14, 15, 16, 17, 18], amount: 10 }, 13, 60],
    [{ kind: 'dozen', index: 2, amount: 10 }, 24, 30],
    [{ kind: 'column', index: 3, amount: 10 }, 36, 30],
    [{ kind: 'red', amount: 10 }, 1, 20],
    [{ kind: 'black', amount: 10 }, 2, 20],
    [{ kind: 'even', amount: 10 }, 2, 20],
    [{ kind: 'odd', amount: 10 }, 35, 20],
    [{ kind: 'low', amount: 10 }, 18, 20],
    [{ kind: 'high', amount: 10 }, 19, 20],
  ];
  it.each(cases)('%o con el %i devuelve %i', (bet, n, payout) => {
    const r = settleRoulette([bet], n);
    expect(r.totalPayout).toBe(payout);
    expect(r.bets[0]!.won).toBe(true);
  });
  it('las apuestas perdedoras no pagan', () => {
    const r = settleRoulette([{ kind: 'straight', numbers: [5], amount: 10 }, { kind: 'dozen', index: 1, amount: 10 }], 30);
    expect(r.totalPayout).toBe(0);
    expect(r.totalBet).toBe(20);
  });
  it('el cero hace perder todas las apuestas exteriores y paga el pleno al 0', () => {
    const outside: RouletteBet[] = [
      { kind: 'red', amount: 10 }, { kind: 'black', amount: 10 }, { kind: 'even', amount: 10 }, { kind: 'odd', amount: 10 },
      { kind: 'low', amount: 10 }, { kind: 'high', amount: 10 }, { kind: 'dozen', index: 1, amount: 10 }, { kind: 'column', index: 1, amount: 10 },
    ];
    expect(settleRoulette(outside, 0).totalPayout).toBe(0);
    expect(settleRoulette([{ kind: 'straight', numbers: [0], amount: 10 }], 0).totalPayout).toBe(360);
    expect(settleRoulette([{ kind: 'street', numbers: [0, 1, 2], amount: 10 }], 0).totalPayout).toBe(120);
  });
  it('liquidación combinada y posición en la rueda', () => {
    const r = settleRoulette([{ kind: 'red', amount: 20 }, { kind: 'straight', numbers: [32], amount: 5 }], 32);
    expect(r.totalPayout).toBe(40 + 180);
    expect(r.pocketIndex).toBe(1);
    expect(r.color).toBe('red');
  });
  it('ventaja de la casa del 2,70 % en todas las apuestas', () => {
    const bets: RouletteBet[] = [
      { kind: 'straight', numbers: [7], amount: 1 },
      { kind: 'split', numbers: [7, 8], amount: 1 },
      { kind: 'corner', numbers: [7, 8, 10, 11], amount: 1 },
      { kind: 'red', amount: 1 },
      { kind: 'dozen', index: 3, amount: 1 },
    ];
    for (const bet of bets) {
      let ret = 0;
      for (let n = 0; n <= 36; n += 1) ret += settleRoulette([bet], n).totalPayout;
      expect(ret / 37).toBeCloseTo(36 / 37, 10);
    }
  });
});
