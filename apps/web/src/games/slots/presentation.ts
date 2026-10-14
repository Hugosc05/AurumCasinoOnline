import { PAYLINES, type LineWin, type ScatterWin, type SlotSpinResult, type WinTier } from '@aurum/engine';

/**
 * Plan de presentación de una tirada de slots (función pura).
 *
 * Traduce el resultado YA liquidado por el servidor en eventos de interfaz:
 * REELS_STOPPED → WINNING_LINE_DETECTED (uno por línea, en orden) →
 * SCATTER_WIN → TOTAL_WIN → CELEBRATION. No calcula premios propios: solo
 * reordena y etiqueta los que devuelve el motor, de modo que lo que se ve
 * coincide siempre con lo que se ha abonado.
 */

export const LINE_COLORS = ['#F4D27A', '#7FD3FF', '#FF8A96', '#9BE8A6', '#D2A8FF', '#FFC66B', '#7FF0D8', '#FFA3D7', '#A7B8FF', '#F5F08A'] as const;
export const lineColor = (line: number): string => LINE_COLORS[line % LINE_COLORS.length]!;

export type CelebrationLevel = 'none' | 'sparkle' | 'burst' | 'fireworks';

/** Intensidad de la celebración según la categoría de premio definida por el motor. */
export const CELEBRATION_BY_TIER: Readonly<Record<WinTier, CelebrationLevel>> = {
  none: 'none',
  small: 'sparkle', // premio normal: destello y resaltado
  medium: 'burst', // premio destacado: partículas y brillo
  big: 'burst',
  mega: 'fireworks', // premio excepcional (≥ 50 × la apuesta)
};

export type SlotPresentationEvent =
  | { type: 'REELS_STOPPED'; stops: number[] }
  | { type: 'WINNING_LINE_DETECTED'; index: number; line: number; rows: readonly number[]; symbol: LineWin['symbol']; count: number; payout: number; cells: [number, number][]; color: string }
  | { type: 'SCATTER_WIN'; count: number; payout: number; cells: [number, number][] }
  | { type: 'TOTAL_WIN'; amount: number; tier: WinTier; multiplier: number }
  | { type: 'CELEBRATION'; level: CelebrationLevel };

export interface SlotPresentation {
  events: SlotPresentationEvent[];
  lines: Extract<SlotPresentationEvent, { type: 'WINNING_LINE_DETECTED' }>[];
  scatter: ScatterWin | null;
  total: number;
  celebration: CelebrationLevel;
}

export function planSlotPresentation(result: SlotSpinResult): SlotPresentation {
  const lines = result.lineWins
    .slice()
    .sort((a, b) => b.payout - a.payout || a.line - b.line)
    .map((w, index) => ({
      type: 'WINNING_LINE_DETECTED' as const,
      index,
      line: w.line,
      rows: PAYLINES[w.line]!,
      symbol: w.symbol,
      count: w.count,
      payout: w.payout,
      cells: w.cells,
      color: lineColor(w.line),
    }));
  const total = result.totalWin;
  const celebration = CELEBRATION_BY_TIER[result.tier];
  const events: SlotPresentationEvent[] = [{ type: 'REELS_STOPPED', stops: result.stops }, ...lines];
  if (result.scatterWin) events.push({ type: 'SCATTER_WIN', count: result.scatterWin.count, payout: result.scatterWin.payout, cells: result.scatterWin.cells });
  if (total > 0) {
    events.push({ type: 'TOTAL_WIN', amount: total, tier: result.tier, multiplier: total / result.totalBet });
    events.push({ type: 'CELEBRATION', level: celebration });
  }
  return { events, lines, scatter: result.scatterWin, total, celebration };
}
