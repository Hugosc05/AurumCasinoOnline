import { PAYLINES, evaluateSlotGrid, gridFromStops, seededRng, spinSlots, type SlotSymbol } from '@aurum/engine';
import { describe, expect, it } from 'vitest';
import { CELEBRATION_BY_TIER, planSlotPresentation } from './presentation';

describe('presentación de slots', () => {
  it('las líneas dibujadas coinciden exactamente con las del motor y el total no se duplica', () => {
    const rng = seededRng(77);
    let wins = 0;
    for (let i = 0; i < 3000; i += 1) {
      const r = spinSlots(rng, 2, 20);
      const plan = planSlotPresentation(r);
      // Mismo conjunto de líneas (sin inventar ni omitir ninguna)
      expect(plan.lines.map((l) => l.line).sort((a, b) => a - b)).toEqual(r.lineWins.map((w) => w.line).sort((a, b) => a - b));
      expect(new Set(plan.lines.map((l) => l.line)).size).toBe(plan.lines.length);
      for (const l of plan.lines) {
        const engine = r.lineWins.find((w) => w.line === l.line)!;
        expect(l.payout).toBe(engine.payout);
        expect(l.cells).toEqual(engine.cells);
        // Cada celda resaltada está en el recorrido real de la línea de pago.
        for (const [reel, row] of l.cells) expect(PAYLINES[l.line]![reel]).toBe(row);
      }
      // La suma presentada es la liquidada por el servidor.
      const sum = plan.lines.reduce((a, l) => a + l.payout, 0) + (plan.scatter?.payout ?? 0);
      expect(sum).toBe(r.totalWin);
      expect(plan.total).toBe(r.totalWin);
      expect(plan.events.filter((e) => e.type === 'TOTAL_WIN')).toHaveLength(r.totalWin > 0 ? 1 : 0);
      // La celebración depende solo de la categoría real.
      expect(plan.celebration).toBe(CELEBRATION_BY_TIER[r.tier]);
      if (r.totalWin === 0) expect(plan.events.some((e) => e.type === 'CELEBRATION')).toBe(false);
      if (r.totalWin > 0) wins += 1;
    }
    expect(wins).toBeGreaterThan(100);
  });

  it('la celebración intensa solo aparece en premios excepcionales', () => {
    const allSevens: SlotSymbol[][] = Array.from({ length: 5 }, () => ['seven', 'seven', 'seven']);
    const mega = evaluateSlotGrid(allSevens, 1, 20);
    expect(planSlotPresentation({ ...mega, stops: [0, 0, 0, 0, 0] }).celebration).toBe('fireworks');
    const r = spinSlots(seededRng(1), 1, 1);
    const plan = planSlotPresentation(r);
    if (r.tier === 'none') expect(plan.celebration).toBe('none');
  });

  it('ordena las líneas de mayor a menor premio', () => {
    const g = gridFromStops([0, 0, 0, 0, 0]);
    const res = evaluateSlotGrid(g, 1, 20);
    const plan = planSlotPresentation({ ...res, stops: [0, 0, 0, 0, 0] });
    for (let i = 1; i < plan.lines.length; i += 1) expect(plan.lines[i - 1]!.payout).toBeGreaterThanOrEqual(plan.lines[i]!.payout);
  });
});
