import { describe, expect, it } from 'vitest';
import { CASES, COSMETIC_BY_ID, caseExpectedCredits, caseRarityOdds, caseTotalWeight, isoWeekKey, missionIncrement, pickMissions, rollCase, seededRng, MISSION_BY_ID } from '../src';

describe('misiones', () => {
  it('3 diarias y 5 semanales, reproducibles, distintas y sin repetir juego', () => {
    const a = pickMissions('user-1', 'daily', 'd:2026-10-26');
    expect(a).toHaveLength(3);
    expect(pickMissions('user-1', 'daily', 'd:2026-10-26')).toEqual(a);
    expect(pickMissions('user-1', 'daily', 'd:2026-10-27').map((m) => m.id)).not.toEqual(a.map((m) => m.id));
    for (let i = 0; i < 200; i += 1) {
      const w = pickMissions(`u${i}`, 'weekly', 'w:2026-W44');
      expect(w).toHaveLength(5);
      expect(new Set(w.map((m) => m.id)).size).toBe(5);
      const games = w.map((m) => m.game).filter(Boolean);
      expect(new Set(games).size).toBe(games.length);
    }
  });

  it('avance según la métrica', () => {
    expect(missionIncrement(MISSION_BY_ID['d-jugar10']!, { game: 'slots', bet: 20, payout: 0 })).toBe(1);
    expect(missionIncrement(MISSION_BY_ID['d-poker5']!, { game: 'slots', bet: 20, payout: 0 })).toBe(0);
    expect(missionIncrement(MISSION_BY_ID['d-ganar3']!, { game: 'slots', bet: 20, payout: 20 })).toBe(0);
    expect(missionIncrement(MISSION_BY_ID['d-ganar3']!, { game: 'slots', bet: 20, payout: 21 })).toBe(1);
    expect(missionIncrement(MISSION_BY_ID['d-apostar1000']!, { game: 'bingo', bet: 150, payout: 0 })).toBe(150);
    expect(missionIncrement(MISSION_BY_ID['d-neto500']!, { game: 'crash', bet: 100, payout: 260 })).toBe(160);
  });

  it('semana ISO (lunes a domingo, con el cambio de año)', () => {
    expect(isoWeekKey('2026-10-26')).toBe('2026-W44');
    expect(isoWeekKey('2026-11-01')).toBe('2026-W44');
    expect(isoWeekKey('2026-11-02')).toBe('2026-W45');
    expect(isoWeekKey('2027-01-01')).toBe('2026-W53');
    expect(isoWeekKey('2025-12-29')).toBe('2026-W01');
  });
});

describe('cajas', () => {
  it('probabilidades que suman 1, cosméticos existentes y tienda que devuelve menos de lo que cuesta en créditos', () => {
    for (const c of CASES) {
      const odds = caseRarityOdds(c);
      expect(Object.values(odds).reduce((a, b) => a + b, 0)).toBeCloseTo(1, 10);
      for (const d of c.drops) if (d.kind === 'cosmetic') expect(COSMETIC_BY_ID[d.id]).toBeTruthy();
      if (c.price) {
        const ev = caseExpectedCredits(c).credits;
        expect(ev).toBeLessThan(c.price);
        expect(ev).toBeGreaterThan(c.price * 0.6);
      }
    }
  });

  it('el sorteo respeta los pesos publicados', () => {
    const c = CASES.find((x) => x.id === 'diaria')!;
    const rng = seededRng(4);
    const counts = new Map<number, number>();
    const N = 200_000;
    for (let i = 0; i < N; i += 1) {
      const k = rollCase(c, rng);
      counts.set(k, (counts.get(k) ?? 0) + 1);
    }
    const total = caseTotalWeight(c);
    c.drops.forEach((d, i) => {
      if (d.weight / total > 0.02) expect((counts.get(i) ?? 0) / N).toBeCloseTo(d.weight / total, 2);
    });
  });
});
