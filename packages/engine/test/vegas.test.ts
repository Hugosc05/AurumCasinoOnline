import { describe, expect, it } from 'vitest';
import {
  VEGAS_NIGHTS,
  computeMachineRtp,
  createHoldWin,
  createSafe,
  createWheel,
  extrasTriggers,
  holdWinBase,
  holdWinRespin,
  machineGridFromStops,
  machineSpacingOk,
  machineStrips,
  pickSafe,
  publicFeature,
  safeOdds,
  seededRng,
  sequenceRng,
  spinMachine,
  wheelEv,
  type CashValue,
} from '../src';

const x = VEGAS_NIGHTS.extras!;

describe('Vegas Nights: máquina', () => {
  it('tiras válidas: billetes apilados de dos en dos y como mucho un scatter o caja por ventana', () => {
    expect(machineSpacingOk(VEGAS_NIGHTS)).toBe(true);
    for (const strip of machineStrips(VEGAS_NIGHTS)) {
      // Cada grupo de billetes tiene al menos dos seguidos (el último puede ir suelto si el total es impar).
      const runs: number[] = [];
      let run = 0;
      for (let i = 0; i < strip.length; i += 1) {
        if (strip[i] === 'cash') run += 1;
        else if (run) {
          runs.push(run);
          run = 0;
        }
      }
      if (run) runs.push(run);
      expect(runs.filter((r) => r >= 2).length).toBeGreaterThanOrEqual(1);
    }
  });

  it('RTP en torno al 96 % y minijuegos con frecuencias de sala', () => {
    const r = computeMachineRtp(VEGAS_NIGHTS);
    expect(r.totalRtp).toBeGreaterThan(0.93);
    expect(r.totalRtp).toBeLessThan(0.975);
    expect(1 / r.holdWinChance).toBeGreaterThan(100);
    expect(1 / r.holdWinChance).toBeLessThan(400);
    expect(1 / r.wheelChance).toBeGreaterThan(60);
    expect(1 / r.safeChance).toBeGreaterThan(150);
    expect(r.grandChance).toBeGreaterThan(0);
  });

  it('la simulación de partidas completas converge al RTP calculado', () => {
    const rng = seededRng(77);
    let bet = 0;
    let won = 0;
    for (let i = 0; i < 120_000; i += 1) {
      const s = spinMachine(VEGAS_NIGHTS, rng, 1, 20, 'paid');
      bet += s.totalBet;
      won += s.totalWin;
      for (const f of s.extrasTriggered) {
        if (f === 'wheel') {
          const w = createWheel(x, s.totalBet, rng);
          const prize = x.wheel.segments[w.segment]!.prize;
          won += prize.kind === 'credit' ? prize.mult * s.totalBet : prize.tier === 'grand' ? 0 : x.jackpots[prize.tier] * s.totalBet;
        } else if (f === 'safe') {
          const sf = createSafe(x, s.totalBet, rng);
          for (let k = 0; !sf.done; k += 1) pickSafe(sf, k);
          won += sf.winner === 'grand' ? 0 : x.jackpots[sf.winner!] * s.totalBet;
        } else {
          const h = createHoldWin(x, s.totalBet, s.cash);
          while (!h.done) holdWinRespin(x, h, rng);
          won += holdWinBase(x, h);
        }
      }
    }
    const rtp = computeMachineRtp(VEGAS_NIGHTS).totalRtp;
    // Las funciones raras tienen mucha varianza: tolerancia amplia, solo coherencia.
    expect(won / bet).toBeGreaterThan(rtp - 0.12);
    expect(won / bet).toBeLessThan(rtp + 0.12);
  });

  it('cada billete visible lleva su premio y 6 o más activan el Hold & Win', () => {
    const rng = seededRng(5);
    let seen = false;
    for (let i = 0; i < 3000 && !seen; i += 1) {
      const s = spinMachine(VEGAS_NIGHTS, rng, 1, 20, 'paid');
      const visible = s.grid.flat().filter((c) => c === 'cash').length;
      expect(s.cash.length).toBe(visible);
      expect(s.extrasTriggered.includes('holdwin')).toBe(visible >= 6);
      if (visible >= 6) seen = true;
    }
    expect(seen).toBe(true);
    // En giros gratis o tiradas no pagadas no se activan minijuegos.
    const strips = machineStrips(VEGAS_NIGHTS);
    const grid = machineGridFromStops(VEGAS_NIGHTS, strips.map(() => 0));
    expect(extrasTriggers(VEGAS_NIGHTS, grid, 'free')).toEqual([]);
  });
});

describe('Hold & Win', () => {
  const credit = (mult: number): CashValue => ({ kind: 'credit', mult });

  it('un billete nuevo devuelve los re-giros a 3; sin billetes nuevos se descuentan', () => {
    const h = createHoldWin(x, 10, [0, 1, 2, 3, 4, 5].map((cell) => ({ cell, value: credit(1) })));
    expect(h.respinsLeft).toBe(3);
    // 9 celdas vacías: el RNG decide si cae billete (int(10000) < 350) en cada una.
    const miss = sequenceRng(Array.from({ length: 9 }, () => 9999));
    expect(holdWinRespin(x, h, miss)).toEqual([]);
    expect(h.respinsLeft).toBe(2);
    const hitFirst = sequenceRng([0, 0, ...Array.from({ length: 8 }, () => 9999)]);
    expect(holdWinRespin(x, h, hitFirst)).toEqual([6]);
    expect(h.respinsLeft).toBe(3);
    expect(holdWinBase(x, h)).toBe(10 * 6 + (h.cells[6]!.kind === 'credit' ? (h.cells[6] as { mult: number }).mult * 10 : x.jackpots[(h.cells[6] as { tier: 'mini' }).tier] * 10));
  });

  it('termina al agotar los re-giros o al llenar la pantalla (Grand)', () => {
    const h = createHoldWin(x, 1, Array.from({ length: 14 }, (_, cell) => ({ cell, value: credit(1) })));
    holdWinRespin(x, h, sequenceRng([0, 0]));
    expect(h.done).toBe(true);
    expect(publicFeature(h, x, 1000).full).toBe(true);
    expect(() => holdWinRespin(x, h, seededRng(1))).toThrow();
    const g = createHoldWin(x, 1, [{ cell: 0, value: credit(2) }]);
    const none = (): ReturnType<typeof seededRng> => sequenceRng(Array.from({ length: 14 }, () => 9999));
    holdWinRespin(x, g, none());
    holdWinRespin(x, g, none());
    holdWinRespin(x, g, none());
    expect(g.done).toBe(true);
    expect(holdWinBase(x, g)).toBe(2);
  });
});

describe('Rueda y caja fuerte', () => {
  it('el sector de la rueda se fija al activarse y no se envía hasta girar', () => {
    const w = createWheel(x, 20, seededRng(3));
    expect(publicFeature(w, x, 0)).toMatchObject({ kind: 'wheel', segment: null });
    w.spun = true;
    expect(publicFeature(w, x, 0)).toMatchObject({ segment: w.segment });
    expect(wheelEv(x).ev).toBeGreaterThan(5);
  });

  it('caja fuerte: gana el primer bote con tres cajas; las cerradas no se envían', () => {
    const odds = safeOdds(x);
    expect(odds.mini + odds.minor + odds.major + odds.grand).toBeCloseTo(1, 10);
    expect(odds.grand).toBeGreaterThan(0);
    expect(odds.mini).toBeGreaterThan(odds.grand);
    const s = createSafe(x, 10, seededRng(9));
    const pub = publicFeature(s, x, 0) as { revealed: unknown; opened: unknown[] };
    expect(pub.revealed).toBeNull();
    expect(JSON.stringify(pub)).not.toContain('tiles');
    let i = 0;
    while (!s.done) pickSafe(s, i++);
    const tier = s.winner!;
    expect(s.opened.filter((k) => s.tiles[k] === tier)).toHaveLength(3);
    expect(() => pickSafe(s, i)).toThrow();
    expect((publicFeature(s, x, 0) as { revealed: unknown }).revealed).toHaveLength(15);
  });
});
