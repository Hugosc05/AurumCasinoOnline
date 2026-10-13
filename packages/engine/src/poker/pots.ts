export interface Contribution {
  seat: number;
  amount: number;
  folded: boolean;
}

export interface Pot {
  amount: number;
  /** Asientos con derecho a ganar este bote. */
  eligible: number[];
}

/**
 * Devuelve el exceso no igualado de la apuesta más alta (si nadie la cubrió),
 * que debe reintegrarse a su dueño antes de formar los botes.
 */
export function uncalledExcess(contribs: readonly Contribution[]): { seat: number; amount: number } | null {
  if (contribs.length < 2) return null;
  const sorted = contribs.slice().sort((a, b) => b.amount - a.amount);
  const top = sorted[0]!;
  const second = sorted[1]!;
  if (top.amount > second.amount) return { seat: top.seat, amount: top.amount - second.amount };
  return null;
}

/**
 * Construye bote principal y botes secundarios a partir de lo aportado por cada
 * jugador en la mano. Las aportaciones de jugadores retirados cuentan para los
 * botes, pero no pueden ganarlos.
 */
export function buildPots(contribs: readonly Contribution[]): Pot[] {
  const live = contribs.filter((c) => !c.folded && c.amount > 0);
  const levels = [...new Set(live.map((c) => c.amount))].sort((a, b) => a - b);
  const pots: Pot[] = [];
  let prev = 0;
  for (const level of levels) {
    let amount = 0;
    for (const c of contribs) amount += Math.max(0, Math.min(c.amount, level) - Math.min(c.amount, prev));
    const eligible = live.filter((c) => c.amount >= level).map((c) => c.seat).sort((a, b) => a - b);
    const last = pots[pots.length - 1];
    if (last && last.eligible.length === eligible.length && last.eligible.every((s, i) => s === eligible[i])) {
      last.amount += amount;
    } else if (amount > 0) {
      pots.push({ amount, eligible });
    }
    prev = level;
  }
  // Fichas por encima del nivel más alto (solo posible con aportes de retirados): al último bote.
  let leftover = 0;
  for (const c of contribs) leftover += Math.max(0, c.amount - prev);
  if (leftover > 0) {
    if (pots.length > 0) pots[pots.length - 1]!.amount += leftover;
    else pots.push({ amount: leftover, eligible: live.map((c) => c.seat) });
  }
  return pots;
}
