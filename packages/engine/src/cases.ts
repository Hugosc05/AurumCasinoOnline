import { COSMETIC_BY_ID, RARITY_INFO, cosmeticsByRarity, type Rarity } from './cosmetics';
import type { Rng } from './rng';

/**
 * Cajas de recompensas. Cada caja tiene una lista pública de premios con su
 * peso: la probabilidad de cada uno es peso / suma y se muestra tal cual. El
 * premio lo sortea el servidor al abrir; la cinta de la animación solo frena
 * en el que ya ha salido.
 */

export type CaseDrop =
  | { kind: 'credits'; amount: number; rarity: Rarity; weight: number }
  | { kind: 'cosmetic'; id: string; rarity: Rarity; weight: number };

export interface CaseDef {
  id: string;
  name: string;
  /** Precio en la tienda (null = solo con misiones). */
  price: number | null;
  color: string;
  drops: readonly CaseDrop[];
}

const cr = (amount: number, rarity: Rarity, weight: number): CaseDrop => ({ kind: 'credits', amount, rarity, weight });
/** Reparte el peso de una rareza a partes iguales entre sus cosméticos. */
function cos(rarity: Rarity, weight: number): CaseDrop[] {
  const items = cosmeticsByRarity(rarity);
  return items.map((it) => ({ kind: 'cosmetic' as const, id: it.id, rarity, weight: weight / items.length }));
}

export const CASES: readonly CaseDef[] = [
  {
    id: 'diaria',
    name: 'Caja diaria',
    price: null,
    color: '#5e98d9',
    drops: [
      cr(50, 'common', 3000), cr(100, 'common', 2400), cr(250, 'uncommon', 1500), cr(500, 'rare', 700), cr(1000, 'epic', 220), cr(5000, 'legendary', 40), cr(25000, 'mythic', 6), cr(100000, 'exceptional', 1),
      ...cos('common', 1200), ...cos('uncommon', 600), ...cos('rare', 250), ...cos('epic', 60), ...cos('legendary', 15), ...cos('mythic', 4), ...cos('exceptional', 1),
    ],
  },
  {
    id: 'semanal',
    name: 'Caja semanal',
    price: null,
    color: '#8847ff',
    drops: [
      cr(250, 'common', 2500), cr(500, 'uncommon', 2000), cr(1000, 'rare', 1300), cr(2500, 'epic', 600), cr(10000, 'legendary', 120), cr(50000, 'mythic', 15), cr(250000, 'exceptional', 2),
      ...cos('common', 600), ...cos('uncommon', 900), ...cos('rare', 700), ...cos('epic', 300), ...cos('legendary', 90), ...cos('mythic', 25), ...cos('exceptional', 5),
    ],
  },
  {
    id: 'bronce',
    name: 'Caja de bronce',
    price: 500,
    color: '#b87333',
    drops: [
      cr(150, 'common', 3600), cr(300, 'common', 2600), cr(650, 'uncommon', 1400), cr(1250, 'rare', 500), cr(3000, 'epic', 120), cr(12500, 'legendary', 20), cr(60000, 'mythic', 2),
      ...cos('common', 900), ...cos('uncommon', 500), ...cos('rare', 180), ...cos('epic', 50), ...cos('legendary', 10), ...cos('mythic', 2),
    ],
  },
  {
    id: 'plata',
    name: 'Caja de plata',
    price: 2500,
    color: '#c0c7d6',
    drops: [
      cr(650, 'common', 3200), cr(1300, 'uncommon', 2400), cr(3000, 'rare', 1500), cr(6500, 'epic', 560), cr(20000, 'legendary', 110), cr(100000, 'mythic', 12), cr(300000, 'exceptional', 1),
      ...cos('uncommon', 700), ...cos('rare', 500), ...cos('epic', 200), ...cos('legendary', 60), ...cos('mythic', 12), ...cos('exceptional', 2),
    ],
  },
  {
    id: 'oro',
    name: 'Caja de oro',
    price: 10000,
    color: '#e4ae39',
    drops: [
      cr(2500, 'uncommon', 3000), cr(6500, 'rare', 2600), cr(13000, 'epic', 1400), cr(32000, 'legendary', 420), cr(130000, 'mythic', 50), cr(1000000, 'exceptional', 2),
      ...cos('rare', 700), ...cos('epic', 500), ...cos('legendary', 220), ...cos('mythic', 60), ...cos('exceptional', 12),
    ],
  },
];

export const CASE_BY_ID: Record<string, CaseDef> = Object.fromEntries(CASES.map((x) => [x.id, x]));

export function caseTotalWeight(def: CaseDef): number {
  return def.drops.reduce((a, d) => a + d.weight, 0);
}

/** Probabilidad exacta de cada rareza (para mostrarla en la caja). */
export function caseRarityOdds(def: CaseDef): Record<Rarity, number> {
  const total = caseTotalWeight(def);
  const out = Object.fromEntries(Object.keys(RARITY_INFO).map((r) => [r, 0])) as Record<Rarity, number>;
  for (const d of def.drops) out[d.rarity] += d.weight / total;
  return out;
}

/**
 * Valor esperado en créditos de abrir la caja: los créditos y, para los
 * cosméticos, su valor de repetido (lo que recibirías si ya lo tuvieras).
 */
export function caseExpectedCredits(def: CaseDef): { credits: number; cosmeticChance: number } {
  const total = caseTotalWeight(def);
  let credits = 0;
  let cosmetic = 0;
  for (const d of def.drops) {
    const p = d.weight / total;
    if (d.kind === 'credits') credits += p * d.amount;
    else cosmetic += p;
  }
  return { credits, cosmeticChance: cosmetic };
}

/** Sortea el premio (índice en `drops`). Pesos en milésimas para usar el entero uniforme del RNG. */
export function rollCase(def: CaseDef, rng: Rng): number {
  const scaled = def.drops.map((d) => Math.round(d.weight * 1000));
  const total = scaled.reduce((a, b) => a + b, 0);
  let x = rng.int(total);
  for (let i = 0; i < scaled.length; i += 1) {
    x -= scaled[i]!;
    if (x < 0) return i;
  }
  return scaled.length - 1;
}

export function dropLabel(d: CaseDrop): string {
  return d.kind === 'credits' ? `${d.amount.toLocaleString('es-ES')} créditos` : COSMETIC_BY_ID[d.id]?.name ?? d.id;
}
