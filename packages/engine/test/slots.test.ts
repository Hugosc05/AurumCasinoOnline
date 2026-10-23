import { describe, expect, it } from 'vitest';
import {
  AURUM_ROYALE,
  PAYLINES,
  REEF_TREASURE,
  SLOT_MACHINES,
  SlotError,
  bonusWinnings,
  computeMachineRtp,
  createPickBonus,
  evaluateMachineGrid,
  evaluateMachineLine,
  machineGridFromStops,
  machineInfo,
  machineSpacingOk,
  machineStrips,
  pickBonus,
  publicPickBonus,
  seededRng,
  sequenceRng,
  spinMachine,
  validateSlotBet,
  winTier,
  type MachineGrid,
} from '../src';

const fill = (s: string): MachineGrid => Array.from({ length: 5 }, () => [s, s, s]);
const A = AURUM_ROYALE;
const R = REEF_TREASURE;

describe('líneas de pago', () => {
  it('hay 20 líneas únicas con filas válidas', () => {
    expect(PAYLINES).toHaveLength(20);
    expect(new Set(PAYLINES.map((l) => l.join())).size).toBe(20);
    for (const l of PAYLINES) for (const r of l) expect([0, 1, 2]).toContain(r);
  });

  it('evalúa combinaciones de izquierda a derecha', () => {
    expect(evaluateMachineLine(A, ['king', 'king', 'king', 'jack', 'king'])).toMatchObject({ symbol: 'king', count: 3, multiplier: 7 });
    expect(evaluateMachineLine(A, ['jack', 'king', 'king', 'king', 'king'])).toBeNull();
    expect(evaluateMachineLine(A, ['seven', 'seven', 'seven', 'seven', 'seven'])?.multiplier).toBe(1350);
  });

  it('el comodín sustituye y se elige el mejor pago', () => {
    expect(evaluateMachineLine(A, ['wild', 'bell', 'bell', 'jack', 'jack'])).toMatchObject({ symbol: 'bell', count: 3, multiplier: 18 });
    expect(evaluateMachineLine(A, ['wild', 'wild', 'wild', 'jack', 'queen'])).toMatchObject({ symbol: 'wild', count: 3, multiplier: 99 });
    expect(evaluateMachineLine(A, ['wild', 'wild', 'wild', 'seven', 'seven'])).toMatchObject({ symbol: 'seven', count: 5, multiplier: 1350 });
    expect(evaluateMachineLine(A, ['wild', 'scatter', 'bell', 'bell', 'bell'])).toBeNull();
  });

  it('combinación especial: joyas mezcladas', () => {
    expect(evaluateMachineLine(A, ['diamond', 'crown', 'seven', 'jack', 'jack'])).toMatchObject({ group: 'jewels', count: 3, multiplier: 5 });
    expect(evaluateMachineLine(A, ['crown', 'wild', 'diamond', 'seven', 'ace'])).toMatchObject({ group: 'jewels', count: 4, multiplier: 15 });
    // Si la combinación normal paga más, se paga la normal (una sola vez).
    expect(evaluateMachineLine(A, ['seven', 'seven', 'seven', 'crown', 'jack'])).toMatchObject({ symbol: 'seven', group: null, multiplier: 63 });
  });

  it('la Ola del arrecife multiplica ×2 las líneas en las que sustituye', () => {
    expect(evaluateMachineLine(R, ['turtle', 'turtle', 'turtle', 'shell', 'shell'])).toMatchObject({ multiplier: 10, wildMultiplied: false });
    expect(evaluateMachineLine(R, ['turtle', 'wave', 'turtle', 'shell', 'shell'])).toMatchObject({ multiplier: 20, wildMultiplied: true });
    // Línea de solo olas: paga la ola (sin doble multiplicador).
    expect(evaluateMachineLine(R, ['wave', 'wave', 'wave', 'chest', 'shell'])).toMatchObject({ symbol: 'wave', multiplier: 66 });
    // El cofre no se sustituye.
    expect(evaluateMachineLine(R, ['wave', 'chest', 'pearl', 'pearl', 'pearl'])).toBeNull();
  });

  it('solo cuentan las líneas activas', () => {
    expect(evaluateMachineGrid(A, fill('ace'), 1, 1).lineWins).toHaveLength(1);
    expect(evaluateMachineGrid(A, fill('ace'), 1, 20).lineWins).toHaveLength(20);
    expect(evaluateMachineGrid(A, fill('ace'), 3, 20).totalWin).toBe(20 * 126 * 3);
  });
});

describe('scatter y giros gratis', () => {
  const grid: MachineGrid = [
    ['scatter', 'jack', 'queen'], ['king', 'ace', 'scatter'], ['jack', 'scatter', 'queen'], ['bell', 'king', 'ace'], ['clover', 'queen', 'jack'],
  ];
  it('tres estrellas pagan sobre la apuesta total y conceden giros gratis en tiradas pagadas', () => {
    const r = evaluateMachineGrid(A, grid, 2, 10);
    expect(r.scatterWin).toMatchObject({ count: 3, multiplier: 2, payout: 40 });
    expect(r.freeSpinsAwarded).toBe(5);
    expect(r.charged).toBe(20);
  });
  it('en los giros gratis todo se multiplica ×2, no se cobra y no se reactivan', () => {
    const r = evaluateMachineGrid(A, grid, 2, 10, 'free');
    expect(r.scatterWin).toMatchObject({ payout: 80 });
    expect(r.freeSpinsAwarded).toBe(0);
    expect(r.charged).toBe(0);
    expect(evaluateMachineGrid(A, fill('ace'), 1, 1, 'free').totalWin).toBe(126 * 2);
  });
});

describe('bono de cofres', () => {
  const trigger: MachineGrid = [
    ['chest', 'shell', 'crab'], ['shell', 'crab', 'turtle'], ['crab', 'chest', 'shell'], ['turtle', 'shell', 'crab'], ['shell', 'crab', 'chest'],
  ];
  it('tres cofres en los rodillos 1, 3 y 5 activan el bono (solo en tiradas pagadas)', () => {
    expect(evaluateMachineGrid(R, trigger, 1, 20).bonusTriggered?.cells).toHaveLength(3);
    const two = trigger.map((c) => c.slice());
    two[4] = ['shell', 'crab', 'turtle'];
    expect(evaluateMachineGrid(R, two, 1, 20).bonusTriggered).toBeNull();
  });

  it('los premios se fijan al activarse; abrir cofres solo revela lo ya decidido', () => {
    const st = createPickBonus(R, 20, seededRng(5));
    expect(st.prizes.slice().sort((a, b) => a - b)).toEqual(R.bonus!.prizes.slice().sort((a, b) => a - b));
    const before = st.prizes.slice();
    const view = publicPickBonus(st);
    expect(view.chests.every((c) => c.prize === null)).toBe(true); // nada se filtra antes de abrir
    expect(pickBonus(st, 4)).toEqual({ prize: before[4]! * 20, done: false });
    expect(() => pickBonus(st, 4)).toThrow(SlotError);
    pickBonus(st, 0);
    expect(pickBonus(st, 8).done).toBe(true);
    expect(() => pickBonus(st, 1)).toThrow(SlotError);
    expect(st.prizes).toEqual(before);
    expect(bonusWinnings(st)).toBe((before[4]! + before[0]! + before[8]!) * 20);
    const end = publicPickBonus(st);
    expect(end.done).toBe(true);
    expect(end.chests.every((c) => c.prize !== null)).toBe(true);
  });
});

describe('apuestas, consistencia y RTP', () => {
  it('valida límites de apuesta y líneas', () => {
    expect(validateSlotBet(5, 20)).toBe(100);
    expect(() => validateSlotBet(0, 20)).toThrow(SlotError);
    expect(() => validateSlotBet(1000, 20)).toThrow(SlotError);
    expect(() => validateSlotBet(1, 7)).toThrow(SlotError);
    expect(() => validateSlotBet(1.5, 10)).toThrow(SlotError);
  });

  it('el resultado se deriva de las paradas y el total cuadra con los premios', () => {
    const rng = seededRng(99);
    for (const m of SLOT_MACHINES) {
      for (let i = 0; i < 400; i += 1) {
        const r = spinMachine(m, rng, 2, 20);
        expect(r.grid).toEqual(machineGridFromStops(m, r.stops));
        const sum = r.lineWins.reduce((a, w) => a + w.payout, 0) + (r.scatterWin?.payout ?? 0);
        expect(r.totalWin).toBe(sum);
      }
    }
  });

  it('las paradas usan el RNG inyectado', () => {
    const r = spinMachine(A, sequenceRng([0, 1, 2, 3, 4]), 1, 20);
    expect(r.stops).toEqual([0, 1, 2, 3, 4]);
  });

  it('cada máquina tiene sus propios símbolos y tiras (no son copias)', () => {
    const ids = SLOT_MACHINES.map((m) => m.symbols.map((s) => s.id).join());
    expect(new Set(ids).size).toBe(SLOT_MACHINES.length);
    for (const m of SLOT_MACHINES) {
      expect(machineSpacingOk(m)).toBe(true);
      for (const strip of machineStrips(m)) for (const s of strip) expect(m.symbols.some((x) => x.id === s)).toBe(true);
    }
  });

  it('RTP exacto entre el 95 % y el 97 % en todas las máquinas, funciones incluidas', () => {
    for (const m of SLOT_MACHINES) {
      const r = computeMachineRtp(m);
      expect(r.totalRtp).toBeGreaterThan(0.95);
      expect(r.totalRtp).toBeLessThan(0.97);
      expect(machineInfo(m).rtp.total).toBeCloseTo(r.totalRtp, 10);
    }
    expect(computeMachineRtp(A).freeSpinsRtp).toBeGreaterThan(0);
    expect(computeMachineRtp(R).bonusRtp).toBeGreaterThan(0);
  });

  it('la simulación converge al RTP calculado (giros gratis y bono incluidos)', () => {
    // Las máquinas con minijuegos de sala (Vegas Nights) tienen su propia simulación en vegas.test.ts.
    for (const m of SLOT_MACHINES.filter((mm) => !mm.extras)) {
      const rng = seededRng(m === A ? 7 : 11);
      let bet = 0;
      let won = 0;
      const N = 120_000;
      for (let i = 0; i < N; i += 1) {
        const r = spinMachine(m, rng, 1, 20);
        bet += r.charged;
        won += r.totalWin;
        for (let f = 0; f < r.freeSpinsAwarded; f += 1) won += spinMachine(m, rng, 1, 20, 'free').totalWin;
        if (r.bonusTriggered) {
          const st = createPickBonus(m, r.totalBet, rng);
          while (st.opened.length < st.picks) pickBonus(st, st.opened.length);
          won += bonusWinnings(st);
        }
      }
      expect(Math.abs(won / bet - computeMachineRtp(m).totalRtp)).toBeLessThan(0.05);
    }
  });

  it('niveles de celebración', () => {
    expect(winTier(0, 10)).toBe('none');
    expect(winTier(5, 10)).toBe('small');
    expect(winTier(40, 10)).toBe('medium');
    expect(winTier(150, 10)).toBe('big');
    expect(winTier(600, 10)).toBe('mega');
  });
});
