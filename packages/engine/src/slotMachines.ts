import type { Rng } from './rng';
import { DEFAULT_SLOT_LIMITS, PAYLINES, REELS, ROWS, SlotError, validateSlotBet, winTier, type SlotLimits, type WinTier } from './slots';
import { cellIndex, holdWinEv, rollCash, safeEv, wheelEv, type CashValue, type SlotExtras } from './slotExtras';
import { seededRng } from './rng';

/**
 * Máquinas tragaperras configurables.
 *
 * Cada máquina define sus símbolos, la composición de sus rodillos, su tabla
 * de pagos y sus funciones especiales. Toda la lógica de premios está aquí:
 * la interfaz solo representa lo que el motor ya ha decidido. Las funciones
 * no alteran nunca las probabilidades (no hay "rachas" inducidas): cada tirada
 * elige paradas uniformes e independientes, y el RTP se calcula de forma
 * exacta a partir de la propia definición.
 */

export type SymbolKind = 'regular' | 'wild' | 'scatter' | 'bonus' | 'cash';

export interface SlotSymbolDef {
  id: string;
  label: string;
  kind: SymbolKind;
}

export interface SymbolGroup {
  id: string;
  label: string;
  /** Símbolos que forman la combinación (mezclados); el comodín también cuenta. */
  symbols: readonly string[];
  pays: readonly [number, number, number];
}

export interface SlotMachineDef {
  id: string;
  name: string;
  theme: string;
  tagline: string;
  symbols: readonly SlotSymbolDef[];
  /** Apariciones de cada símbolo en cada rodillo. */
  composition: readonly Readonly<Record<string, number>>[];
  stripOffsets: readonly number[];
  /** Pagos por línea (sobre la apuesta por línea) para 3, 4 y 5 símbolos desde la izquierda. */
  linePays: Readonly<Record<string, readonly [number, number, number]>>;
  /** Combinaciones especiales de símbolos mezclados. */
  groups: readonly SymbolGroup[];
  /** Multiplicador cuando un comodín sustituye en una línea ganadora (1 = sin multiplicador). */
  wildMultiplier: number;
  /** Pagos de scatter sobre la apuesta total. */
  scatterPays: Readonly<Partial<Record<3 | 4 | 5, number>>>;
  freeSpins: null | {
    /** Giros concedidos según el número de scatters (solo en tiradas pagadas; no se reactivan). */
    awards: Readonly<Partial<Record<3 | 4 | 5, number>>>;
    multiplier: number;
  };
  bonus: null | {
    symbol: string;
    /** Rodillos en los que aparece el símbolo de bono. */
    reels: readonly number[];
    minCount: number;
    /** Cofres a elegir. */
    picks: number;
    /** Premios (multiplicadores de la apuesta total) repartidos en los cofres; el orden se baraja al activarse. */
    prizes: readonly number[];
  };
  limits: SlotLimits;
  /** Símbolos que aparecen en grupos consecutivos en la tira (p. ej. billetes de dos en dos). */
  stacks?: Readonly<Record<string, number>>;
  /** Minijuegos de sala: Hold & Win, rueda, caja fuerte y botes (Vegas Nights). */
  extras?: SlotExtras;
  /** Contenido solo para adultos (aviso al entrar). */
  adult?: boolean;
}

/* ------------------------------------------------------------------------- */
/* Máquinas                                                                   */
/* ------------------------------------------------------------------------- */

export const AURUM_ROYALE: SlotMachineDef = {
  id: 'aurum-royale',
  name: 'Aurum Royale',
  theme: 'Salón clásico',
  tagline: 'Sietes, coronas y estrellas que abren giros gratis.',
  symbols: [
    { id: 'jack', label: 'J', kind: 'regular' },
    { id: 'queen', label: 'Q', kind: 'regular' },
    { id: 'king', label: 'K', kind: 'regular' },
    { id: 'ace', label: 'A', kind: 'regular' },
    { id: 'clover', label: 'Trébol', kind: 'regular' },
    { id: 'bell', label: 'Campana', kind: 'regular' },
    { id: 'diamond', label: 'Diamante', kind: 'regular' },
    { id: 'crown', label: 'Corona', kind: 'regular' },
    { id: 'seven', label: 'Siete', kind: 'regular' },
    { id: 'wild', label: 'Comodín', kind: 'wild' },
    { id: 'scatter', label: 'Estrella (scatter)', kind: 'scatter' },
  ],
  composition: [
    { jack: 6, queen: 6, king: 5, ace: 5, clover: 4, bell: 3, diamond: 3, crown: 2, seven: 2, wild: 1, scatter: 2 },
    { jack: 6, queen: 5, king: 5, ace: 4, clover: 4, bell: 3, diamond: 3, crown: 2, seven: 2, wild: 2, scatter: 2 },
    { jack: 5, queen: 5, king: 5, ace: 4, clover: 4, bell: 3, diamond: 3, crown: 3, seven: 2, wild: 2, scatter: 2 },
    { jack: 6, queen: 5, king: 5, ace: 4, clover: 4, bell: 3, diamond: 3, crown: 2, seven: 2, wild: 2, scatter: 2 },
    { jack: 6, queen: 6, king: 5, ace: 5, clover: 4, bell: 3, diamond: 3, crown: 2, seven: 2, wild: 1, scatter: 2 },
  ],
  stripOffsets: [0, 2, 4, 6, 8],
  linePays: {
    jack: [5, 14, 63],
    queen: [5, 18, 72],
    king: [7, 27, 99],
    ace: [9, 32, 126],
    clover: [14, 50, 198],
    bell: [18, 68, 297],
    diamond: [27, 99, 495],
    crown: [41, 153, 675],
    seven: [63, 270, 1350],
    wild: [99, 495, 3600],
  },
  groups: [{ id: 'jewels', label: 'Joyas mezcladas (diamante, corona, siete)', symbols: ['diamond', 'crown', 'seven'], pays: [5, 15, 50] }],
  wildMultiplier: 1,
  scatterPays: { 3: 2, 4: 8, 5: 40 },
  freeSpins: { awards: { 3: 5, 4: 8, 5: 12 }, multiplier: 2 },
  bonus: null,
  limits: DEFAULT_SLOT_LIMITS,
};

export const REEF_TREASURE: SlotMachineDef = {
  id: 'tesoro-arrecife',
  name: 'Tesoro del Arrecife',
  theme: 'Fondo marino',
  tagline: 'La ola dobla los premios y tres cofres abren el bono de tesoros.',
  symbols: [
    { id: 'shell', label: 'Concha', kind: 'regular' },
    { id: 'starfish', label: 'Estrella de mar', kind: 'regular' },
    { id: 'crab', label: 'Cangrejo', kind: 'regular' },
    { id: 'seahorse', label: 'Caballito de mar', kind: 'regular' },
    { id: 'turtle', label: 'Tortuga', kind: 'regular' },
    { id: 'dolphin', label: 'Delfín', kind: 'regular' },
    { id: 'pearl', label: 'Perla', kind: 'regular' },
    { id: 'wave', label: 'Ola (comodín ×2)', kind: 'wild' },
    { id: 'chest', label: 'Cofre (bono)', kind: 'bonus' },
  ],
  composition: [
    { shell: 7, starfish: 6, crab: 5, seahorse: 4, turtle: 4, dolphin: 3, pearl: 2, wave: 1, chest: 2 },
    { shell: 7, starfish: 6, crab: 5, seahorse: 5, turtle: 4, dolphin: 3, pearl: 2, wave: 2, chest: 0 },
    { shell: 6, starfish: 6, crab: 5, seahorse: 5, turtle: 4, dolphin: 3, pearl: 3, wave: 2, chest: 2 },
    { shell: 7, starfish: 6, crab: 5, seahorse: 5, turtle: 4, dolphin: 3, pearl: 2, wave: 2, chest: 0 },
    { shell: 7, starfish: 6, crab: 5, seahorse: 4, turtle: 4, dolphin: 3, pearl: 2, wave: 1, chest: 2 },
  ],
  stripOffsets: [1, 3, 5, 7, 9],
  linePays: {
    shell: [3, 8, 33],
    starfish: [3, 10, 40],
    crab: [5, 17, 66],
    seahorse: [7, 23, 92],
    turtle: [10, 33, 145],
    dolphin: [17, 59, 264],
    pearl: [33, 132, 660],
    wave: [66, 330, 1980],
  },
  groups: [],
  wildMultiplier: 2,
  scatterPays: {},
  freeSpins: null,
  bonus: { symbol: 'chest', reels: [0, 2, 4], minCount: 3, picks: 3, prizes: [2, 3, 4, 5, 6, 8, 10, 15, 25] },
  limits: DEFAULT_SLOT_LIMITS,
};

export const VEGAS_NIGHTS: SlotMachineDef = {
  id: 'vegas-nights',
  name: 'Vegas Nights',
  theme: 'Noche en Las Vegas',
  tagline: 'Billetes que se quedan pegados, la gran rueda, la caja fuerte y cuatro botes.',
  adult: true,
  symbols: [
    { id: 'chip', label: 'Ficha', kind: 'regular' },
    { id: 'dice', label: 'Dados', kind: 'regular' },
    { id: 'cards', label: 'Cartas', kind: 'regular' },
    { id: 'whisky', label: 'Whisky', kind: 'regular' },
    { id: 'cigar', label: 'Puro', kind: 'regular' },
    { id: 'bills', label: 'Fajo de billetes', kind: 'regular' },
    { id: 'showgirl', label: 'Showgirl', kind: 'regular' },
    { id: 'neon', label: 'Neón VEGAS (comodín)', kind: 'wild' },
    { id: 'wheel', label: 'Rueda (3 abren la gran rueda)', kind: 'scatter' },
    { id: 'safe', label: 'Caja fuerte (bono)', kind: 'bonus' },
    { id: 'cash', label: 'Billete con premio (Hold & Win)', kind: 'cash' },
  ],
  composition: [
    { chip: 7, dice: 6, cards: 6, whisky: 5, cigar: 4, bills: 3, showgirl: 2, neon: 1, wheel: 1, safe: 2, cash: 3 },
    { chip: 7, dice: 6, cards: 6, whisky: 5, cigar: 4, bills: 3, showgirl: 2, neon: 2, wheel: 2, safe: 0, cash: 4 },
    { chip: 6, dice: 6, cards: 6, whisky: 5, cigar: 4, bills: 3, showgirl: 3, neon: 2, wheel: 1, safe: 2, cash: 4 },
    { chip: 7, dice: 6, cards: 6, whisky: 5, cigar: 4, bills: 3, showgirl: 2, neon: 2, wheel: 2, safe: 0, cash: 4 },
    { chip: 7, dice: 6, cards: 6, whisky: 5, cigar: 4, bills: 3, showgirl: 2, neon: 1, wheel: 1, safe: 2, cash: 3 },
  ],
  stacks: { cash: 2 },
  stripOffsets: [2, 4, 6, 8, 10],
  linePays: {
    chip: [8, 19, 72],
    dice: [10, 25, 96],
    cards: [10, 29, 110],
    whisky: [14, 44, 173],
    cigar: [19, 61, 245],
    bills: [35, 110, 440],
    showgirl: [61, 220, 960],
    neon: [125, 490, 2400],
  },
  groups: [],
  wildMultiplier: 1,
  scatterPays: {},
  freeSpins: null,
  bonus: null,
  limits: DEFAULT_SLOT_LIMITS,
  extras: {
    jackpots: { mini: 10, minor: 25, major: 100, grandSeed: 250_000, grandContribution: 0.005, grandRefBet: 2000 },
    holdWin: {
      symbol: 'cash',
      trigger: 6,
      respins: 3,
      landChance: 0.035,
      evTable: {
        6: [27.496, 0.0003], 7: [30.3212, 0.00025], 8: [33.1342, 0.00055], 9: [36.2737, 0.00065], 10: [39.2351, 0.00145],
        11: [42.566, 0.00285], 12: [45.5037, 0.00725], 13: [48.8507, 0.0234], 14: [52.0744, 0.10185], 15: [55.2024, 1],
      },
      values: [
        { value: { kind: 'credit', mult: 1 }, weight: 300 },
        { value: { kind: 'credit', mult: 2 }, weight: 250 },
        { value: { kind: 'credit', mult: 3 }, weight: 160 },
        { value: { kind: 'credit', mult: 5 }, weight: 110 },
        { value: { kind: 'credit', mult: 8 }, weight: 60 },
        { value: { kind: 'credit', mult: 10 }, weight: 40 },
        { value: { kind: 'jackpot', tier: 'mini' }, weight: 22 },
        { value: { kind: 'jackpot', tier: 'minor' }, weight: 12 },
        { value: { kind: 'jackpot', tier: 'major' }, weight: 3 },
      ],
    },
    wheel: {
      symbol: 'wheel',
      minCount: 3,
      segments: [
        { prize: { kind: 'credit', mult: 5 }, weight: 18 },
        { prize: { kind: 'jackpot', tier: 'mini' }, weight: 8 },
        { prize: { kind: 'credit', mult: 8 }, weight: 16 },
        { prize: { kind: 'credit', mult: 15 }, weight: 10 },
        { prize: { kind: 'jackpot', tier: 'minor' }, weight: 5 },
        { prize: { kind: 'credit', mult: 6 }, weight: 18 },
        { prize: { kind: 'credit', mult: 20 }, weight: 7 },
        { prize: { kind: 'jackpot', tier: 'major' }, weight: 1 },
        { prize: { kind: 'credit', mult: 10 }, weight: 14 },
        { prize: { kind: 'credit', mult: 30 }, weight: 4 },
        { prize: { kind: 'jackpot', tier: 'grand' }, weight: 0.2 },
        { prize: { kind: 'credit', mult: 12 }, weight: 12 },
      ].map((s) => ({ ...s, weight: Math.round(s.weight * 10) })) as SlotExtras['wheel']['segments'],
    },
    safe: { symbol: 'safe', reels: [0, 2, 4], minCount: 3, tiles: { mini: 5, minor: 4, major: 3, grand: 3 } },
  },
};

export const SLOT_MACHINES: readonly SlotMachineDef[] = [AURUM_ROYALE, REEF_TREASURE, VEGAS_NIGHTS];

export function getMachine(id: string): SlotMachineDef {
  const m = SLOT_MACHINES.find((x) => x.id === id);
  if (!m) throw new SlotError('UNKNOWN_MACHINE', 'Máquina desconocida');
  return m;
}

/* ------------------------------------------------------------------------- */
/* Tiras                                                                      */
/* ------------------------------------------------------------------------- */

/**
 * Reparte los símbolos de forma regular a lo largo de la tira. Los símbolos
 * con menos apariciones se colocan primero, separados al máximo, de modo que
 * nunca hay dos scatters (ni dos cofres) en la misma ventana visible.
 */
export function buildMachineStrip(symbols: readonly string[], composition: Readonly<Record<string, number>>, offset = 0, stacks: Readonly<Record<string, number>> = {}): string[] {
  const length = symbols.reduce((acc, s) => acc + (composition[s] ?? 0), 0);
  const strip: (string | null)[] = Array.from({ length }, () => null);
  // Primero los apilados (necesitan huecos consecutivos), después del más escaso al más común.
  const order = symbols.slice().sort((a, b) => Number(!!stacks[b]) - Number(!!stacks[a]) || (composition[a] ?? 0) - (composition[b] ?? 0) || symbols.indexOf(b) - symbols.indexOf(a));
  let shift = offset;
  for (const sym of order) {
    const count = composition[sym] ?? 0;
    const stack = Math.max(1, stacks[sym] ?? 1);
    const groups = Math.ceil(count / stack);
    let placed = 0;
    for (let k = 0; k < groups; k += 1) {
      const size = Math.min(stack, count - placed);
      let pos = (Math.floor((k * length) / groups) + shift) % length;
      const free = (p: number): boolean => Array.from({ length: size }, (_, j) => strip[(p + j) % length] === null).every(Boolean);
      let guard = 0;
      while (!free(pos) && guard < length) {
        pos = (pos + 1) % length;
        guard += 1;
      }
      for (let j = 0; j < size; j += 1) {
        let q = (pos + j) % length;
        while (strip[q] !== null) q = (q + 1) % length;
        strip[q] = sym;
      }
      placed += size;
    }
    shift += 3;
  }
  return strip as string[];
}

const stripCache = new Map<string, string[][]>();
export function machineStrips(m: SlotMachineDef): string[][] {
  let s = stripCache.get(m.id);
  if (!s) {
    const ids = m.symbols.map((x) => x.id);
    s = m.composition.map((c, i) => buildMachineStrip(ids, c, m.stripOffsets[i] ?? 0, m.stacks));
    stripCache.set(m.id, s);
  }
  return s;
}

/* ------------------------------------------------------------------------- */
/* Evaluación                                                                 */
/* ------------------------------------------------------------------------- */

export interface MachineLineWin {
  line: number;
  symbol: string;
  /** Combinación especial (si la hay). */
  group: string | null;
  count: 3 | 4 | 5;
  /** Multiplicador final de la línea (incluido el del comodín y el de giros gratis). */
  multiplier: number;
  wildMultiplied: boolean;
  payout: number;
  cells: [number, number][];
}

export interface MachineScatterWin {
  count: 3 | 4 | 5;
  multiplier: number;
  payout: number;
  cells: [number, number][];
}

const kindOf = (m: SlotMachineDef): Map<string, SymbolKind> => new Map(m.symbols.map((s) => [s.id, s.kind]));
const kindCache = new Map<string, Map<string, SymbolKind>>();
function kinds(m: SlotMachineDef): Map<string, SymbolKind> {
  let k = kindCache.get(m.id);
  if (!k) {
    k = kindOf(m);
    kindCache.set(m.id, k);
  }
  return k;
}
const wildOf = (m: SlotMachineDef): string | null => m.symbols.find((s) => s.kind === 'wild')?.id ?? null;

/** Mejor premio de una línea de 5 símbolos (sin apuesta ni multiplicador de giros gratis). */
export function evaluateMachineLine(m: SlotMachineDef, symbols: readonly string[]): { symbol: string; group: string | null; count: 3 | 4 | 5; multiplier: number; wildMultiplied: boolean } | null {
  const wild = wildOf(m);
  const k = kinds(m);
  let wildRun = 0;
  while (wild && wildRun < symbols.length && symbols[wildRun] === wild) wildRun += 1;
  let best: { symbol: string; group: string | null; count: 3 | 4 | 5; multiplier: number; wildMultiplied: boolean } | null = null;
  const consider = (c: NonNullable<typeof best>): void => {
    if (!best || c.multiplier > best.multiplier) best = c;
  };
  if (wild && wildRun >= 3) {
    const count = Math.min(wildRun, 5) as 3 | 4 | 5;
    consider({ symbol: wild, group: null, count, multiplier: m.linePays[wild]![count - 3]!, wildMultiplied: false });
  }
  const target = symbols[wildRun];
  if (target !== undefined && k.get(target) === 'regular') {
    let count = wildRun;
    while (count < symbols.length && (symbols[count] === target || symbols[count] === wild)) count += 1;
    if (count >= 3) {
      const c = Math.min(count, 5) as 3 | 4 | 5;
      const usedWild = wild !== null && symbols.slice(0, c).includes(wild);
      const mult = usedWild && m.wildMultiplier > 1 ? m.wildMultiplier : 1;
      consider({ symbol: target, group: null, count: c, multiplier: m.linePays[target]![c - 3]! * mult, wildMultiplied: mult > 1 });
    }
  }
  for (const g of m.groups) {
    let count = 0;
    while (count < symbols.length && (g.symbols.includes(symbols[count]!) || (wild !== null && symbols[count] === wild))) count += 1;
    // Debe haber al menos un símbolo del grupo (una línea de solo comodines no es "mezcla").
    if (count >= 3 && symbols.slice(0, count).some((s) => g.symbols.includes(s))) {
      const c = Math.min(count, 5) as 3 | 4 | 5;
      consider({ symbol: g.symbols[0]!, group: g.id, count: c, multiplier: g.pays[c - 3]!, wildMultiplied: false });
    }
  }
  return best;
}

export type MachineGrid = string[][]; // grid[reel][row]

export function machineGridFromStops(m: SlotMachineDef, stops: readonly number[]): MachineGrid {
  const strips = machineStrips(m);
  return stops.map((stop, reel) => {
    const strip = strips[reel]!;
    return Array.from({ length: ROWS }, (_, row) => strip[(stop + row) % strip.length]!);
  });
}

export interface MachineSpinResult {
  machine: string;
  mode: 'paid' | 'free';
  stops: number[];
  grid: MachineGrid;
  lines: number;
  betPerLine: number;
  /** Apuesta total de referencia (en giros gratis no se cobra). */
  totalBet: number;
  /** Lo que se ha cobrado por esta tirada (0 en giros gratis). */
  charged: number;
  /** Multiplicador global (giros gratis). */
  spinMultiplier: number;
  lineWins: MachineLineWin[];
  scatterWin: MachineScatterWin | null;
  totalWin: number;
  tier: WinTier;
  /** Giros gratis concedidos en esta tirada. */
  freeSpinsAwarded: number;
  /** Celdas de los símbolos de bono si se activa el bono. */
  bonusTriggered: { cells: [number, number][] } | null;
  /** Billetes visibles con su premio (máquinas con Hold & Win). */
  cash: { cell: number; value: CashValue }[];
  /** Minijuegos activados en esta tirada, en el orden en que se jugarán. */
  extrasTriggered: ('holdwin' | 'wheel' | 'safe')[];
}

export function evaluateMachineGrid(
  m: SlotMachineDef,
  grid: MachineGrid,
  betPerLine: number,
  lines: number,
  mode: 'paid' | 'free' = 'paid',
): Omit<MachineSpinResult, 'stops'> {
  const totalBet = betPerLine * lines;
  const spinMultiplier = mode === 'free' && m.freeSpins ? m.freeSpins.multiplier : 1;
  const lineWins: MachineLineWin[] = [];
  for (let li = 0; li < lines; li += 1) {
    const rows = PAYLINES[li]!;
    const symbols = rows.map((row, reel) => grid[reel]![row]!);
    const w = evaluateMachineLine(m, symbols);
    if (w) {
      const multiplier = w.multiplier * spinMultiplier;
      lineWins.push({
        line: li, symbol: w.symbol, group: w.group, count: w.count, multiplier, wildMultiplied: w.wildMultiplied,
        payout: multiplier * betPerLine, cells: rows.slice(0, w.count).map((row, reel) => [reel, row]),
      });
    }
  }
  const k = kinds(m);
  const scatterCells: [number, number][] = [];
  const bonusCells: [number, number][] = [];
  grid.forEach((col, reel) => col.forEach((s, row) => {
    if (k.get(s) === 'scatter') scatterCells.push([reel, row]);
    if (m.bonus && s === m.bonus.symbol) bonusCells.push([reel, row]);
  }));
  let scatterWin: MachineScatterWin | null = null;
  let freeSpinsAwarded = 0;
  if (scatterCells.length >= 3) {
    const count = Math.min(scatterCells.length, 5) as 3 | 4 | 5;
    const base = m.scatterPays[count] ?? 0;
    if (base > 0) scatterWin = { count, multiplier: base * spinMultiplier, payout: base * spinMultiplier * totalBet, cells: scatterCells };
    // Los giros gratis solo se activan en tiradas pagadas (no se reactivan dentro del bono).
    if (mode === 'paid' && m.freeSpins) freeSpinsAwarded = m.freeSpins.awards[count] ?? 0;
  }
  const bonusTriggered = mode === 'paid' && m.bonus && bonusCells.length >= m.bonus.minCount ? { cells: bonusCells } : null;
  const totalWin = lineWins.reduce((a, w) => a + w.payout, 0) + (scatterWin?.payout ?? 0);
  return {
    machine: m.id, mode, grid, lines, betPerLine, totalBet, charged: mode === 'paid' ? totalBet : 0, spinMultiplier,
    lineWins, scatterWin, totalWin, tier: winTier(totalWin, totalBet), freeSpinsAwarded, bonusTriggered,
    cash: [], extrasTriggered: extrasTriggers(m, grid, mode),
  };
}

/** Minijuegos de sala que activa una cuadrícula (solo en tiradas pagadas). */
export function extrasTriggers(m: SlotMachineDef, grid: MachineGrid, mode: 'paid' | 'free'): ('holdwin' | 'wheel' | 'safe')[] {
  const x = m.extras;
  if (!x || mode !== 'paid') return [];
  const count = (sym: string, reels?: readonly number[]): number =>
    grid.reduce((a, col, reel) => a + (reels && !reels.includes(reel) ? 0 : col.filter((s) => s === sym).length), 0);
  const out: ('holdwin' | 'wheel' | 'safe')[] = [];
  if (count(x.holdWin.symbol) >= x.holdWin.trigger) out.push('holdwin');
  if (count(x.wheel.symbol) >= x.wheel.minCount) out.push('wheel');
  if (count(x.safe.symbol, x.safe.reels) >= x.safe.minCount) out.push('safe');
  return out;
}

/** Tirada: paradas uniformes e independientes elegidas por el RNG inyectado. */
export function spinMachine(m: SlotMachineDef, rng: Rng, betPerLine: number, lines: number, mode: 'paid' | 'free' = 'paid'): MachineSpinResult {
  validateSlotBet(betPerLine, lines, m.limits);
  const stops = machineStrips(m).map((strip) => rng.int(strip.length));
  const grid = machineGridFromStops(m, stops);
  const out: MachineSpinResult = { stops, ...evaluateMachineGrid(m, grid, betPerLine, lines, mode) };
  // Cada billete visible lleva su premio, sorteado ahora (se muestra aunque no se active el Hold & Win).
  if (m.extras) {
    grid.forEach((col, reel) => col.forEach((s, row) => {
      if (s === m.extras!.holdWin.symbol) out.cash.push({ cell: cellIndex(reel, row), value: rollCash(m.extras!, rng) });
    }));
  }
  return out;
}

/* ------------------------------------------------------------------------- */
/* Minijuego: cofres                                                          */
/* ------------------------------------------------------------------------- */

export interface PickBonusState {
  machine: string;
  totalBet: number;
  /** Premio de cada cofre (multiplicador de la apuesta total), fijado al activarse. Nunca se envía al cliente sin abrir. */
  prizes: number[];
  picks: number;
  opened: number[];
}

/** Crea el bono con los premios ya repartidos (barajado Fisher-Yates con el RNG del servidor). */
export function createPickBonus(m: SlotMachineDef, totalBet: number, rng: Rng): PickBonusState {
  if (!m.bonus) throw new SlotError('NO_BONUS', 'Esta máquina no tiene bono');
  const prizes = m.bonus.prizes.slice();
  for (let i = prizes.length - 1; i > 0; i -= 1) {
    const j = rng.int(i + 1);
    [prizes[i], prizes[j]] = [prizes[j]!, prizes[i]!];
  }
  return { machine: m.id, totalBet, prizes, picks: m.bonus.picks, opened: [] };
}

export function pickBonus(state: PickBonusState, index: number): { prize: number; done: boolean } {
  if (!Number.isInteger(index) || index < 0 || index >= state.prizes.length) throw new SlotError('INVALID_PICK', 'Cofre no válido');
  if (state.opened.length >= state.picks) throw new SlotError('BONUS_DONE', 'El bono ya ha terminado');
  if (state.opened.includes(index)) throw new SlotError('ALREADY_OPENED', 'Ese cofre ya está abierto');
  state.opened.push(index);
  return { prize: state.prizes[index]! * state.totalBet, done: state.opened.length >= state.picks };
}

export function bonusWinnings(state: PickBonusState): number {
  return state.opened.reduce((a, i) => a + state.prizes[i]! * state.totalBet, 0);
}

/** Vista pública: solo los cofres abiertos muestran su premio (los demás, al terminar). */
export function publicPickBonus(state: PickBonusState) {
  const done = state.opened.length >= state.picks;
  return {
    machine: state.machine,
    totalBet: state.totalBet,
    chests: state.prizes.map((p, i) => ({ index: i, opened: state.opened.includes(i), prize: state.opened.includes(i) || done ? p * state.totalBet : null })),
    picksLeft: state.picks - state.opened.length,
    won: bonusWinnings(state),
    done,
  };
}

/* ------------------------------------------------------------------------- */
/* RTP exacto                                                                 */
/* ------------------------------------------------------------------------- */

export interface MachineRtp {
  lineRtp: number;
  scatterRtp: number;
  baseRtp: number;
  freeSpinsRtp: number;
  bonusRtp: number;
  totalRtp: number;
  hitFrequencyPerLine: number;
  freeSpinsChance: number;
  bonusChance: number;
  /** Minijuegos de sala (0 si la máquina no los tiene). */
  holdWinRtp: number;
  wheelRtp: number;
  safeRtp: number;
  holdWinChance: number;
  wheelChance: number;
  safeChance: number;
  /** Probabilidad por tirada de ganar el Grand (se paga del bote progresivo, aparte del RTP). */
  grandChance: number;
}

/** Distribución exacta del número de un símbolo visible en la ventana de cada rodillo (enumerando paradas). */
function windowCountDist(strips: readonly (readonly string[])[], sym: string): number[] {
  let dist = [1];
  for (const s of strips) {
    const per = Array.from({ length: ROWS + 1 }, () => 0);
    for (let i = 0; i < s.length; i += 1) {
      let c = 0;
      for (let r = 0; r < ROWS; r += 1) if (s[(i + r) % s.length] === sym) c += 1;
      per[c]! += 1 / s.length;
    }
    const next = Array.from({ length: dist.length + ROWS }, () => 0);
    dist.forEach((q, k) => per.forEach((pp, c) => (next[k + c]! += q * pp)));
    dist = next;
  }
  return dist;
}

const extrasCache = new Map<string, Pick<MachineRtp, 'holdWinRtp' | 'wheelRtp' | 'safeRtp' | 'holdWinChance' | 'wheelChance' | 'safeChance' | 'grandChance'>>();

/**
 * RTP de los minijuegos de sala. Rueda y caja fuerte: exacto. Hold & Win:
 * probabilidad de activación exacta y valor esperado por simulación con
 * semilla fija (20 000 partidas por cada número inicial de billetes).
 */
function extrasRtp(m: SlotMachineDef) {
  const hit = extrasCache.get(m.id);
  if (hit) return hit;
  const x = m.extras;
  const out = { holdWinRtp: 0, wheelRtp: 0, safeRtp: 0, holdWinChance: 0, wheelChance: 0, safeChance: 0, grandChance: 0 };
  if (x) {
    const strips = machineStrips(m);
    const cash = windowCountDist(strips, x.holdWin.symbol);
    const rng = seededRng(20261023);
    for (let k = x.holdWin.trigger; k < cash.length; k += 1) {
      const p = cash[k] ?? 0;
      if (p <= 0) continue;
      const row = x.holdWin.evTable?.[k];
      const ev = row ? { ev: row[0], fullChance: row[1] } : holdWinEv(x, k, 20000, rng);
      out.holdWinChance += p;
      out.holdWinRtp += p * ev.ev;
      out.grandChance += p * ev.fullChance;
    }
    const wheelDist = visibleCountDist(strips, x.wheel.symbol, [0, 1, 2, 3, 4]);
    for (let k = x.wheel.minCount; k < wheelDist.length; k += 1) out.wheelChance += wheelDist[k]!;
    const w = wheelEv(x);
    out.wheelRtp = out.wheelChance * w.ev;
    out.grandChance += out.wheelChance * w.grandChance;
    const safeDist = visibleCountDist(strips, x.safe.symbol, x.safe.reels);
    for (let k = x.safe.minCount; k < safeDist.length; k += 1) out.safeChance += safeDist[k]!;
    const sf = safeEv(x);
    out.safeRtp = out.safeChance * sf.ev;
    out.grandChance += out.safeChance * sf.grandChance;
  }
  extrasCache.set(m.id, out);
  return out;
}

/** Distribución del número de rodillos (de una lista) que muestran un símbolo de separación ≥ 3. */
function visibleCountDist(strips: readonly (readonly string[])[], sym: string, reels: readonly number[]): number[] {
  let dist = [1];
  for (const r of reels) {
    const s = strips[r]!;
    const p = (ROWS * s.filter((x) => x === sym).length) / s.length;
    const next = Array.from({ length: dist.length + 1 }, () => 0);
    dist.forEach((q, k) => {
      next[k]! += q * (1 - p);
      next[k + 1]! += q * p;
    });
    dist = next;
  }
  return dist;
}

/**
 * RTP exacto. En cualquier línea, el símbolo de cada rodillo es uniforme sobre
 * su tira e independiente entre rodillos: se enumeran las combinaciones
 * ponderadas. Scatter y bono usan la distribución exacta del número de
 * rodillos con el símbolo visible (separación ≥ 3 en las tiras).
 *
 *   total = base + P(giros) · nº de giros · multiplicador · base + P(bono) · E[bono]
 */
export function computeMachineRtp(m: SlotMachineDef): MachineRtp {
  const strips = machineStrips(m);
  const freq = strips.map((strip) => {
    const map = new Map<string, number>();
    for (const s of strip) map.set(s, (map.get(s) ?? 0) + 1);
    return { map, len: strip.length };
  });
  let lineRtp = 0;
  let hit = 0;
  const current: string[] = [];
  const rec = (reel: number, prob: number): void => {
    if (reel === REELS) {
      const w = evaluateMachineLine(m, current);
      if (w) {
        lineRtp += prob * w.multiplier;
        hit += prob;
      }
      return;
    }
    for (const [s, n] of freq[reel]!.map) {
      current[reel] = s;
      rec(reel + 1, prob * (n / freq[reel]!.len));
    }
    current.length = reel;
  };
  rec(0, 1);

  const scatter = m.symbols.find((s) => s.kind === 'scatter')?.id;
  let scatterRtp = 0;
  let fsSpins = 0;
  let fsChance = 0;
  if (scatter) {
    const dist = visibleCountDist(strips, scatter, [0, 1, 2, 3, 4]);
    for (const k of [3, 4, 5] as const) {
      scatterRtp += (dist[k] ?? 0) * (m.scatterPays[k] ?? 0);
      if (m.freeSpins) {
        fsSpins += (dist[k] ?? 0) * (m.freeSpins.awards[k] ?? 0);
        if (m.freeSpins.awards[k]) fsChance += dist[k] ?? 0;
      }
    }
  }
  const baseRtp = lineRtp + scatterRtp;
  const freeSpinsRtp = m.freeSpins ? fsSpins * m.freeSpins.multiplier * baseRtp : 0;
  let bonusRtp = 0;
  let bonusChance = 0;
  if (m.bonus) {
    const dist = visibleCountDist(strips, m.bonus.symbol, m.bonus.reels);
    for (let k = m.bonus.minCount; k < dist.length; k += 1) bonusChance += dist[k]!;
    const mean = m.bonus.prizes.reduce((a, b) => a + b, 0) / m.bonus.prizes.length;
    bonusRtp = bonusChance * m.bonus.picks * mean;
  }
  const ex = extrasRtp(m);
  return {
    lineRtp, scatterRtp, baseRtp, freeSpinsRtp, bonusRtp,
    totalRtp: baseRtp + freeSpinsRtp + bonusRtp + ex.holdWinRtp + ex.wheelRtp + ex.safeRtp,
    hitFrequencyPerLine: hit, freeSpinsChance: fsChance, bonusChance, ...ex,
  };
}

/** Ninguna ventana visible contiene dos símbolos de scatter o de bono (requisito del cálculo exacto). */
export function machineSpacingOk(m: SlotMachineDef): boolean {
  const special = m.symbols.filter((s) => s.kind === 'scatter' || s.kind === 'bonus').map((s) => s.id);
  return machineStrips(m).every((strip) => {
    for (let i = 0; i < strip.length; i += 1) {
      for (const sym of special) {
        let c = 0;
        for (let r = 0; r < ROWS; r += 1) if (strip[(i + r) % strip.length] === sym) c += 1;
        if (c > 1) return false;
      }
    }
    return true;
  });
}

/** Descripción pública de una máquina (tabla de pagos y funciones) para la interfaz. */
export function machineInfo(m: SlotMachineDef) {
  const rtp = computeMachineRtp(m);
  return {
    id: m.id, name: m.name, theme: m.theme, tagline: m.tagline,
    symbols: m.symbols, linePays: m.linePays, groups: m.groups, wildMultiplier: m.wildMultiplier,
    scatterPays: m.scatterPays, freeSpins: m.freeSpins,
    bonus: m.bonus ? { symbol: m.bonus.symbol, reels: m.bonus.reels, minCount: m.bonus.minCount, picks: m.bonus.picks, chests: m.bonus.prizes.length, prizes: m.bonus.prizes.slice().sort((a, b) => a - b) } : null,
    strips: machineStrips(m), paylines: PAYLINES, limits: m.limits,
    rtp: {
      total: rtp.totalRtp, base: rtp.baseRtp, freeSpins: rtp.freeSpinsRtp, bonus: rtp.bonusRtp, freeSpinsChance: rtp.freeSpinsChance, bonusChance: rtp.bonusChance, hitFrequencyPerLine: rtp.hitFrequencyPerLine,
      holdWin: rtp.holdWinRtp, wheel: rtp.wheelRtp, safe: rtp.safeRtp, holdWinChance: rtp.holdWinChance, wheelChance: rtp.wheelChance, safeChance: rtp.safeChance, grandChance: rtp.grandChance,
    },
    extras: m.extras ?? null,
    adult: !!m.adult,
  };
}
