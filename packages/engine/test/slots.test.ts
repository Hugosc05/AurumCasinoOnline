import { describe, expect, it } from 'vitest';
import {
  PAYLINES,
  REEL_STRIPS,
  SlotError,
  computeRtp,
  evaluateLineSymbols,
  evaluateSlotGrid,
  gridFromStops,
  scatterSpacingOk,
  seededRng,
  sequenceRng,
  spinSlots,
  validateSlotBet,
  winTier,
  type SlotGrid,
  type SlotSymbol,
} from '../src';

const fill = (s: SlotSymbol): SlotGrid => Array.from({ length: 5 }, () => [s, s, s]);

describe('líneas de pago', () => {
  it('hay 20 líneas únicas con filas válidas', () => {
    expect(PAYLINES).toHaveLength(20);
    expect(new Set(PAYLINES.map((l) => l.join())).size).toBe(20);
    for (const l of PAYLINES) for (const r of l) expect([0, 1, 2]).toContain(r);
  });

  it('evalúa combinaciones de izquierda a derecha', () => {
    expect(evaluateLineSymbols(['king', 'king', 'king', 'jack', 'king'])).toEqual({ symbol: 'king', count: 3, multiplier: 12 });
    expect(evaluateLineSymbols(['jack', 'king', 'king', 'king', 'king'])).toBeNull();
    expect(evaluateLineSymbols(['seven', 'seven', 'seven', 'seven', 'seven'])?.multiplier).toBe(2000);
  });

  it('el comodín sustituye y elige el mejor pago', () => {
    expect(evaluateLineSymbols(['wild', 'bell', 'bell', 'jack', 'jack'])).toEqual({ symbol: 'bell', count: 3, multiplier: 30 });
    expect(evaluateLineSymbols(['wild', 'wild', 'wild', 'jack', 'queen'])).toEqual({ symbol: 'wild', count: 3, multiplier: 150 });
    expect(evaluateLineSymbols(['wild', 'wild', 'wild', 'seven', 'seven'])).toEqual({ symbol: 'seven', count: 5, multiplier: 2000 });
    expect(evaluateLineSymbols(['wild', 'scatter', 'bell', 'bell', 'bell'])).toBeNull();
  });

  it('el scatter paga en cualquier posición sobre la apuesta total', () => {
    const grid: SlotGrid = [
      ['scatter', 'jack', 'queen'], ['king', 'ace', 'scatter'], ['jack', 'scatter', 'queen'], ['bell', 'king', 'ace'], ['clover', 'queen', 'jack'],
    ];
    const r = evaluateSlotGrid(grid, 2, 10);
    expect(r.scatterWin).toMatchObject({ count: 3, multiplier: 2, payout: 40 });
  });

  it('solo cuentan las líneas activas', () => {
    const grid = fill('ace');
    expect(evaluateSlotGrid(grid, 1, 1).lineWins).toHaveLength(1);
    expect(evaluateSlotGrid(grid, 1, 20).lineWins).toHaveLength(20);
    expect(evaluateSlotGrid(grid, 3, 20).totalWin).toBe(20 * 180 * 3);
  });
});

describe('apuestas y consistencia', () => {
  it('valida límites de apuesta y líneas', () => {
    expect(validateSlotBet(5, 20)).toBe(100);
    expect(() => validateSlotBet(0, 20)).toThrow(SlotError);
    expect(() => validateSlotBet(1000, 20)).toThrow(SlotError);
    expect(() => validateSlotBet(1, 7)).toThrow(SlotError);
    expect(() => validateSlotBet(1.5, 10)).toThrow(SlotError);
  });

  it('el resultado se deriva de las paradas y la liquidación coincide con la cuadrícula', () => {
    const rng = seededRng(99);
    for (let i = 0; i < 500; i += 1) {
      const r = spinSlots(rng, 2, 20);
      expect(r.grid).toEqual(gridFromStops(r.stops));
      const re = evaluateSlotGrid(r.grid, 2, 20);
      expect(re.totalWin).toBe(r.totalWin);
      const sum = r.lineWins.reduce((a, w) => a + w.payout, 0) + (r.scatterWin?.payout ?? 0);
      expect(r.totalWin).toBe(sum);
    }
  });

  it('las paradas usan el RNG inyectado', () => {
    const r = spinSlots(sequenceRng([0, 1, 2, 3, 4]), 1, 20);
    expect(r.stops).toEqual([0, 1, 2, 3, 4]);
  });

  it('categorías de premio', () => {
    expect(winTier(0, 10)).toBe('none');
    expect(winTier(20, 10)).toBe('small');
    expect(winTier(50, 10)).toBe('medium');
    expect(winTier(150, 10)).toBe('big');
    expect(winTier(500, 10)).toBe('mega');
  });
});

describe('RTP', () => {
  it('ningún rodillo muestra dos scatters a la vez', () => {
    expect(scatterSpacingOk()).toBe(true);
  });

  it('el RTP teórico exacto es ≈95,26 %', () => {
    const r = computeRtp();
    expect(r.totalRtp).toBeGreaterThan(0.95);
    expect(r.totalRtp).toBeLessThan(0.96);
    expect(r.combinations).toBe(REEL_STRIPS.reduce((a, s) => a * s.length, 1));
  });

  it('una simulación grande converge al RTP teórico (tolerancia amplia)', () => {
    const rng = seededRng(2024);
    let bet = 0;
    let win = 0;
    for (let i = 0; i < 200000; i += 1) {
      const r = spinSlots(rng, 1, 20);
      bet += r.totalBet;
      win += r.totalWin;
    }
    expect(Math.abs(win / bet - computeRtp().totalRtp)).toBeLessThan(0.05);
  });
});
