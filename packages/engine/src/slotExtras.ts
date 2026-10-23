import type { Rng } from './rng';
import { REELS, ROWS, SlotError } from './slots';

/**
 * Minijuegos de las máquinas "de sala" (Vegas Nights): Hold & Win de
 * billetes, rueda de la fortuna, caja fuerte de tres iguales y botes.
 *
 * Todo se decide con el RNG del servidor:
 *  - el sector de la rueda se fija al activarse y no se revela hasta girar;
 *  - el contenido de las cajas fuertes se baraja al activarse y solo se
 *    envían las ya abiertas;
 *  - cada re-giro del Hold & Win se sortea en el momento, celda a celda, con
 *    una probabilidad fija (sin "rachas" ni ajustes según lo que va saliendo).
 */

export type JackpotTier = 'mini' | 'minor' | 'major' | 'grand';
export const JACKPOT_TIERS: readonly JackpotTier[] = ['mini', 'minor', 'major', 'grand'];
export const JACKPOT_LABEL: Record<JackpotTier, string> = { mini: 'Mini', minor: 'Menor', major: 'Mayor', grand: 'Grand' };

export type CashValue = { kind: 'credit'; mult: number } | { kind: 'jackpot'; tier: Exclude<JackpotTier, 'grand'> };

export interface WheelSegment {
  /** Multiplicador de la apuesta total o bote. */
  prize: { kind: 'credit'; mult: number } | { kind: 'jackpot'; tier: JackpotTier };
  /** Peso relativo (probabilidad = peso / suma). El dibujo usa un sector por elemento. */
  weight: number;
}

export interface SlotExtras {
  jackpots: {
    /** Botes fijos: múltiplos de la apuesta total. */
    mini: number;
    minor: number;
    major: number;
    /** Grand progresivo compartido: valor inicial y fracción de cada apuesta pagada que lo alimenta. */
    grandSeed: number;
    grandContribution: number;
    /** Apuesta total con la que el Grand se paga entero (con menos, la parte proporcional). */
    grandRefBet: number;
  };
  holdWin: {
    symbol: string;
    trigger: number;
    respins: number;
    /** Probabilidad de que en un re-giro aparezca un billete en cada celda vacía. */
    landChance: number;
    values: readonly { value: CashValue; weight: number }[];
  };
  wheel: { symbol: string; minCount: number; segments: readonly WheelSegment[] };
  safe: { symbol: string; reels: readonly number[]; minCount: number; tiles: Readonly<Record<JackpotTier, number>> };
}

const CELLS = REELS * ROWS;
export const cellIndex = (reel: number, row: number): number => reel * ROWS + row;

function weighted(items: readonly { weight: number }[], rng: Rng): number {
  const total = items.reduce((a, b) => a + b.weight, 0);
  let x = rng.int(total);
  for (let i = 0; i < items.length; i += 1) {
    x -= items[i]!.weight;
    if (x < 0) return i;
  }
  return items.length - 1;
}

export function rollCash(x: SlotExtras, rng: Rng): CashValue {
  return x.holdWin.values[weighted(x.holdWin.values, rng)]!.value;
}

/** Importe de un bote para una apuesta total (el Grand depende del bote acumulado). */
export function jackpotAmount(x: SlotExtras, tier: JackpotTier, totalBet: number, grandPool: number): number {
  if (tier === 'grand') return Math.floor(grandPool * Math.min(1, totalBet / x.jackpots.grandRefBet));
  return x.jackpots[tier] * totalBet;
}

export function cashAmount(x: SlotExtras, v: CashValue, totalBet: number): number {
  return v.kind === 'credit' ? v.mult * totalBet : jackpotAmount(x, v.tier, totalBet, 0);
}

/* ------------------------------- Hold & Win ------------------------------ */

export interface HoldWinState {
  kind: 'holdwin';
  totalBet: number;
  /** Celdas (reel·3 + fila) con su billete fijado; null = vacía. */
  cells: (CashValue | null)[];
  respinsLeft: number;
  /** Celdas nuevas del último re-giro (para la animación). */
  last: number[];
  respinsPlayed: number;
  done: boolean;
}

export function createHoldWin(x: SlotExtras, totalBet: number, start: readonly { cell: number; value: CashValue }[]): HoldWinState {
  const cells: (CashValue | null)[] = Array.from({ length: CELLS }, () => null);
  for (const s of start) cells[s.cell] = s.value;
  return { kind: 'holdwin', totalBet, cells, respinsLeft: x.holdWin.respins, last: start.map((s) => s.cell), respinsPlayed: 0, done: false };
}

/** Un re-giro: cada celda vacía puede recibir un billete. Si llega alguno, los re-giros vuelven a 3. */
export function holdWinRespin(x: SlotExtras, s: HoldWinState, rng: Rng): number[] {
  if (s.done) throw new SlotError('FEATURE_DONE', 'El Hold & Win ya ha terminado');
  const landed: number[] = [];
  // Probabilidad en milésimas para usar el entero uniforme del RNG.
  const p = Math.round(x.holdWin.landChance * 10000);
  for (let i = 0; i < CELLS; i += 1) {
    if (s.cells[i] === null && rng.int(10000) < p) {
      s.cells[i] = rollCash(x, rng);
      landed.push(i);
    }
  }
  s.respinsPlayed += 1;
  s.last = landed;
  s.respinsLeft = landed.length > 0 ? x.holdWin.respins : s.respinsLeft - 1;
  if (s.respinsLeft <= 0 || s.cells.every((c) => c !== null)) s.done = true;
  return landed;
}

export function holdWinFull(s: HoldWinState): boolean {
  return s.cells.every((c) => c !== null);
}

/** Premio del Hold & Win sin el Grand (que depende del bote acumulado). */
export function holdWinBase(x: SlotExtras, s: HoldWinState): number {
  return s.cells.reduce((a, c) => a + (c ? cashAmount(x, c, s.totalBet) : 0), 0);
}

/* ---------------------------- Rueda de la fortuna ------------------------- */

export interface WheelState {
  kind: 'wheel';
  totalBet: number;
  /** Sector ganador, fijado al activarse. Nunca se envía antes de girar. */
  segment: number;
  spun: boolean;
  done: boolean;
}

export function createWheel(x: SlotExtras, totalBet: number, rng: Rng): WheelState {
  return { kind: 'wheel', totalBet, segment: weighted(x.wheel.segments, rng), spun: false, done: false };
}

/* --------------------------- Caja fuerte (3 iguales) ---------------------- */

export interface SafeState {
  kind: 'safe';
  totalBet: number;
  /** Contenido de cada caja, barajado al activarse. Solo se envían las abiertas. */
  tiles: JackpotTier[];
  opened: number[];
  winner: JackpotTier | null;
  done: boolean;
}

export function createSafe(x: SlotExtras, totalBet: number, rng: Rng): SafeState {
  const tiles: JackpotTier[] = [];
  for (const t of JACKPOT_TIERS) for (let k = 0; k < x.safe.tiles[t]; k += 1) tiles.push(t);
  for (let i = tiles.length - 1; i > 0; i -= 1) {
    const j = rng.int(i + 1);
    [tiles[i], tiles[j]] = [tiles[j]!, tiles[i]!];
  }
  return { kind: 'safe', totalBet, tiles, opened: [], winner: null, done: false };
}

export function pickSafe(s: SafeState, index: number): JackpotTier {
  if (s.done) throw new SlotError('FEATURE_DONE', 'La caja fuerte ya está resuelta');
  if (!Number.isInteger(index) || index < 0 || index >= s.tiles.length) throw new SlotError('INVALID_PICK', 'Caja no válida');
  if (s.opened.includes(index)) throw new SlotError('ALREADY_OPENED', 'Esa caja ya está abierta');
  s.opened.push(index);
  const tier = s.tiles[index]!;
  if (s.opened.filter((i) => s.tiles[i] === tier).length >= 3) {
    s.winner = tier;
    s.done = true;
  }
  return tier;
}

export type ExtraFeature = HoldWinState | WheelState | SafeState;

/** Vista pública: nada que no se haya destapado. */
export function publicFeature(f: ExtraFeature, x: SlotExtras, grandPool: number) {
  const jackpots = Object.fromEntries(JACKPOT_TIERS.map((t) => [t, jackpotAmount(x, t, f.totalBet, grandPool)])) as Record<JackpotTier, number>;
  if (f.kind === 'holdwin') {
    return { kind: f.kind, totalBet: f.totalBet, cells: f.cells, respinsLeft: f.respinsLeft, last: f.last, respinsPlayed: f.respinsPlayed, done: f.done, full: holdWinFull(f), won: holdWinBase(x, f) + (holdWinFull(f) ? jackpots.grand : 0), jackpots };
  }
  if (f.kind === 'wheel') {
    return { kind: f.kind, totalBet: f.totalBet, segments: x.wheel.segments.map((s) => s.prize), segment: f.spun ? f.segment : null, done: f.done, jackpots };
  }
  return {
    kind: f.kind,
    totalBet: f.totalBet,
    count: f.tiles.length,
    opened: f.opened.map((i) => ({ index: i, tier: f.tiles[i]! })),
    // Al terminar se muestran todas (como en la máquina real).
    revealed: f.done ? f.tiles : null,
    winner: f.winner,
    done: f.done,
    jackpots,
  };
}

/* ---------------------------------- RTP ---------------------------------- */

/** Valor esperado de la rueda (múltiplos de la apuesta; el Grand se cuenta aparte, como bote). */
export function wheelEv(x: SlotExtras): { ev: number; grandChance: number } {
  const total = x.wheel.segments.reduce((a, s) => a + s.weight, 0);
  let ev = 0;
  let grandChance = 0;
  for (const s of x.wheel.segments) {
    const p = s.weight / total;
    if (s.prize.kind === 'credit') ev += p * s.prize.mult;
    else if (s.prize.tier === 'grand') grandChance += p;
    else ev += p * x.jackpots[s.prize.tier];
  }
  return { ev, grandChance };
}

/** Probabilidad exacta de que cada bote sea el primero en reunir tres cajas (recorrido de estados). */
export function safeOdds(x: SlotExtras): Record<JackpotTier, number> {
  const counts = JACKPOT_TIERS.map((t) => x.safe.tiles[t]);
  const out: Record<JackpotTier, number> = { mini: 0, minor: 0, major: 0, grand: 0 };
  const memo = new Map<string, number[]>();
  const rec = (seen: number[]): number[] => {
    const key = seen.join(',');
    const hit = memo.get(key);
    if (hit) return hit;
    const left = counts.map((c, i) => c - seen[i]!);
    const total = left.reduce((a, b) => a + b, 0);
    const res = [0, 0, 0, 0];
    for (let i = 0; i < 4; i += 1) {
      if (left[i]! === 0) continue;
      const p = left[i]! / total;
      if (seen[i]! + 1 >= 3) res[i]! += p;
      else {
        const next = seen.slice();
        next[i]! += 1;
        const sub = rec(next);
        for (let j = 0; j < 4; j += 1) res[j]! += p * sub[j]!;
      }
    }
    memo.set(key, res);
    return res;
  };
  const r = rec([0, 0, 0, 0]);
  JACKPOT_TIERS.forEach((t, i) => (out[t] = r[i]!));
  return out;
}

export function safeEv(x: SlotExtras): { ev: number; grandChance: number } {
  const o = safeOdds(x);
  return { ev: o.mini * x.jackpots.mini + o.minor * x.jackpots.minor + o.major * x.jackpots.major, grandChance: o.grand };
}

/**
 * Valor esperado del Hold & Win según cuántos billetes lo activan, por
 * simulación determinista (semilla fija): el reparto de re-giros no tiene una
 * forma cerrada sencilla. Devuelve múltiplos de la apuesta (sin el Grand) y la
 * probabilidad de llenar la pantalla.
 */
export function holdWinEv(x: SlotExtras, startCount: number, runs: number, rng: Rng): { ev: number; fullChance: number } {
  let sum = 0;
  let full = 0;
  for (let r = 0; r < runs; r += 1) {
    const start = Array.from({ length: startCount }, (_, i) => ({ cell: i, value: rollCash(x, rng) }));
    const s = createHoldWin(x, 1, start);
    while (!s.done) holdWinRespin(x, s, rng);
    sum += holdWinBase(x, s);
    if (holdWinFull(s)) full += 1;
  }
  return { ev: sum / runs, fullChance: full / runs };
}
