import { describe, expect, it } from 'vitest';
import { BINGO_BALLS, bingoPrizes, bingoCardNumbers, drawOrder, generateBingoCard, hasBingo, hasLine, isValidBingoCard, bingoMissing, seededRng } from '../src';

describe('Bingo de 90 bolas', () => {
  it('genera cartones válidos: 15 números, 5 por fila, columnas ordenadas y en su rango', () => {
    const rng = seededRng(1);
    const colCounts = new Map<number, number>();
    for (let i = 0; i < 3000; i += 1) {
      const c = generateBingoCard(rng);
      expect(isValidBingoCard(c)).toBe(true);
      for (let col = 0; col < 9; col += 1) {
        const k = c.filter((r) => r[col] !== null).length;
        colCounts.set(k, (colCounts.get(k) ?? 0) + 1);
      }
    }
    // Hay columnas con 1, 2 y 3 números (no siempre el mismo patrón).
    expect([...colCounts.keys()].sort()).toEqual([1, 2, 3]);
    const bad = generateBingoCard(seededRng(2));
    bad[0]![0] = bad[0]![0] === null ? 5 : null;
    expect(isValidBingoCard(bad)).toBe(false);
  });

  it('el orden de extracción es una permutación de las 90 bolas', () => {
    const order = drawOrder(seededRng(5));
    expect(order).toHaveLength(BINGO_BALLS);
    expect(new Set(order).size).toBe(BINGO_BALLS);
    expect(Math.min(...order)).toBe(1);
    expect(Math.max(...order)).toBe(90);
  });

  it('línea, bingo y números que faltan', () => {
    const card = generateBingoCard(seededRng(7));
    const row0 = card[0]!.filter((n): n is number => n !== null);
    const drawn = new Set(row0.slice(0, 4));
    expect(hasLine(card, drawn)).toBe(false);
    expect(bingoMissing(card, drawn).line).toBe(1);
    drawn.add(row0[4]!);
    expect(hasLine(card, drawn)).toBe(true);
    expect(hasBingo(card, drawn)).toBe(false);
    for (const n of bingoCardNumbers(card)) drawn.add(n);
    expect(hasBingo(card, drawn)).toBe(true);
    expect(bingoMissing(card, drawn)).toEqual({ line: 0, bingo: 0 });
  });

  it('premios: 20 % línea y 70 % bingo del bote, redondeados hacia abajo', () => {
    expect(bingoPrizes(1000)).toEqual({ line: 200, bingo: 700 });
    expect(bingoPrizes(333)).toEqual({ line: 66, bingo: 233 });
  });

  it('una partida simulada termina siempre con un bingo antes de la bola 90', () => {
    const rng = seededRng(11);
    for (let g = 0; g < 200; g += 1) {
      const cards = Array.from({ length: 30 }, () => generateBingoCard(rng));
      const order = drawOrder(rng);
      const drawn = new Set<number>();
      let lineAt = 0;
      let bingoAt = 0;
      for (const [i, n] of order.entries()) {
        drawn.add(n);
        if (!lineAt && cards.some((c) => hasLine(c, drawn))) lineAt = i + 1;
        if (cards.some((c) => hasBingo(c, drawn))) {
          bingoAt = i + 1;
          break;
        }
      }
      expect(lineAt).toBeGreaterThan(4);
      expect(bingoAt).toBeGreaterThanOrEqual(lineAt);
      expect(bingoAt).toBeLessThanOrEqual(90);
    }
  });
});
