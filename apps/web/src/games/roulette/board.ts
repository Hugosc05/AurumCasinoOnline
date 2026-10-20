import type { RouletteBetSpec } from '@aurum/engine';

/** Geometría del tapete en coordenadas de diseño (horizontal). */
export const CELL_W = 58;
export const CELL_H = 66;
export const ZERO_W = 58;
export const OUT_H = 52;
export const BOARD_W = ZERO_W + 12 * CELL_W + CELL_W; // cero + 12 columnas + "2 a 1"
export const BOARD_H = 3 * CELL_H + OUT_H * 2;

/** Número en (columna 0..11, fila 0..2), fila 0 = superior (3, 6, …, 36). */
export const numberAt = (col: number, row: number): number => 3 * col + (3 - row);

export const cellX = (col: number): number => ZERO_W + col * CELL_W;
export const cellY = (row: number): number => row * CELL_H;

export interface Zone {
  key: string;
  bet: RouletteBetSpec;
  x: number;
  y: number;
  w: number;
  h: number;
  /** Punto donde se apoya la ficha. */
  cx: number;
  cy: number;
  label: string;
  focusable: boolean;
}

export function betKey(b: RouletteBetSpec): string {
  if ('numbers' in b) return `${b.kind}:${[...b.numbers].sort((x, y) => x - y).join('-')}`;
  if ('index' in b) return `${b.kind}:${b.index}`;
  return b.kind;
}

const inside = (kind: 'straight' | 'split' | 'street' | 'corner' | 'sixline', numbers: number[]): RouletteBetSpec => ({ kind, numbers });

/** Construye todas las zonas de apuesta del tapete europeo. */
export function buildZones(): Zone[] {
  const z: Zone[] = [];
  const add = (bet: RouletteBetSpec, x: number, y: number, w: number, h: number, label: string, focusable = false): void => {
    z.push({ key: betKey(bet), bet, x, y, w, h, cx: x + w / 2, cy: y + h / 2, label, focusable });
  };
  const E = 14; // grosor de las zonas de borde
  const numbersH = 3 * CELL_H;

  // Exteriores (primero: quedan debajo de las interiores en el orden de pintado).
  for (let d = 0; d < 3; d += 1) add({ kind: 'dozen', index: (d + 1) as 1 | 2 | 3 }, cellX(d * 4), numbersH, CELL_W * 4, OUT_H, `Docena ${d + 1}`, true);
  const even: [string, RouletteBetSpec][] = [
    ['1 a 18', { kind: 'low' }],
    ['Par', { kind: 'even' }],
    ['Rojo', { kind: 'red' }],
    ['Negro', { kind: 'black' }],
    ['Impar', { kind: 'odd' }],
    ['19 a 36', { kind: 'high' }],
  ];
  even.forEach(([label, bet], i) => add(bet, cellX(i * 2), numbersH + OUT_H, CELL_W * 2, OUT_H, label, true));
  for (let r = 0; r < 3; r += 1) add({ kind: 'column', index: (3 - r) as 1 | 2 | 3 }, cellX(12), cellY(r), CELL_W, CELL_H, `Columna ${3 - r}`, true);

  // Plenos
  add(inside('straight', [0]), 0, 0, ZERO_W - E / 2, numbersH, 'Pleno al 0', true);
  for (let c = 0; c < 12; c += 1) {
    for (let r = 0; r < 3; r += 1) {
      const n = numberAt(c, r);
      add(inside('straight', [n]), cellX(c) + E / 2, cellY(r) + E / 2, CELL_W - E, CELL_H - E, `Pleno al ${n}`, true);
    }
  }
  // Caballos verticales (misma columna, filas contiguas) y horizontales (misma fila, columnas contiguas)
  for (let c = 0; c < 12; c += 1) {
    for (let r = 0; r < 2; r += 1) {
      const a = numberAt(c, r);
      const b = numberAt(c, r + 1);
      add(inside('split', [a, b]), cellX(c) + E / 2, cellY(r + 1) - E / 2, CELL_W - E, E, `Caballo ${b}-${a}`);
    }
  }
  for (let c = 0; c < 11; c += 1) {
    for (let r = 0; r < 3; r += 1) {
      const a = numberAt(c, r);
      const b = numberAt(c + 1, r);
      add(inside('split', [a, b]), cellX(c + 1) - E / 2, cellY(r) + E / 2, E, CELL_H - E, `Caballo ${a}-${b}`);
    }
  }
  // Caballos con el cero
  for (let r = 0; r < 3; r += 1) add(inside('split', [0, numberAt(0, r)]), ZERO_W - E / 2, cellY(r) + E / 2, E, CELL_H - E, `Caballo 0-${numberAt(0, r)}`);
  // Tríos con el cero (0-2-3 y 0-1-2)
  add(inside('street', [0, 2, 3]), ZERO_W - E / 2, cellY(1) - E / 2, E, E, 'Transversal 0-2-3');
  add(inside('street', [0, 1, 2]), ZERO_W - E / 2, cellY(2) - E / 2, E, E, 'Transversal 0-1-2');
  // Cuadros
  for (let c = 0; c < 11; c += 1) {
    for (let r = 0; r < 2; r += 1) {
      const ns = [numberAt(c, r), numberAt(c, r + 1), numberAt(c + 1, r), numberAt(c + 1, r + 1)];
      add(inside('corner', ns), cellX(c + 1) - E / 2, cellY(r + 1) - E / 2, E, E, `Cuadro ${Math.min(...ns)}-${Math.max(...ns)}`);
    }
  }
  // Transversales (borde inferior de cada columna) y seisenas (cruce del borde inferior)
  for (let c = 0; c < 12; c += 1) {
    const base = 3 * c + 1;
    add(inside('street', [base, base + 1, base + 2]), cellX(c) + E / 2, numbersH - E / 2, CELL_W - E, E, `Transversal ${base}-${base + 2}`);
  }
  for (let c = 0; c < 11; c += 1) {
    const base = 3 * c + 1;
    add(inside('sixline', [base, base + 1, base + 2, base + 3, base + 4, base + 5]), cellX(c + 1) - E / 2, numbersH - E / 2, E, E, `Seisena ${base}-${base + 5}`);
  }
  // Primeros cuatro (0-1-2-3)
  add(inside('corner', [0, 1, 2, 3]), ZERO_W - E / 2, numbersH - E / 2, E, E, 'Cuadro 0-1-2-3');
  return z;
}

/* ------------------------------------------------------------------------- */
/* Pintado de apuestas por arrastre (lógica pura, independiente del DOM)      */
/* ------------------------------------------------------------------------- */

/**
 * Categoría de pintado. Un trazo solo coloca fichas en zonas de la misma
 * categoría que la zona donde empezó: si empiezas en un número, pintas
 * plenos; si empiezas en una línea entre dos números, pintas caballos; si
 * empiezas en un cruce, cuadros. Así, al pasar por encima de los bordes no se
 * crean apuestas que no se querían, y cada zona conserva su regla real.
 */
export type PaintCategory = 'straight' | 'split' | 'street' | 'corner' | 'sixline' | 'outside';

export function paintCategory(bet: RouletteBetSpec): PaintCategory {
  if (bet.kind === 'straight' || bet.kind === 'split' || bet.kind === 'street' || bet.kind === 'corner' || bet.kind === 'sixline') return bet.kind;
  return 'outside';
}

/** Zona bajo un punto (coordenadas del tapete horizontal). Las zonas finas de borde tienen prioridad. */
export function zoneAt(zones: readonly Zone[], x: number, y: number): Zone | null {
  for (let i = zones.length - 1; i >= 0; i -= 1) {
    const z = zones[i]!;
    if (x >= z.x && x <= z.x + z.w && y >= z.y && y <= z.y + z.h) return z;
  }
  return null;
}

/**
 * Zonas atravesadas por un segmento del puntero. Se muestrea cada pocos
 * píxeles para no saltarse casillas cuando el movimiento es rápido.
 */
export function zonesAlong(zones: readonly Zone[], from: { x: number; y: number }, to: { x: number; y: number }, step = 4): Zone[] {
  const out: Zone[] = [];
  const seen = new Set<string>();
  const dist = Math.hypot(to.x - from.x, to.y - from.y);
  const n = Math.max(1, Math.ceil(dist / step));
  for (let i = 0; i <= n; i += 1) {
    const t = i / n;
    const z = zoneAt(zones, from.x + (to.x - from.x) * t, from.y + (to.y - from.y) * t);
    if (z && !seen.has(z.key)) {
      seen.add(z.key);
      out.push(z);
    }
  }
  return out;
}

/** Desplazamiento mínimo (px del tapete) para que un toque se convierta en trazo. */
export const DRAG_THRESHOLD = 8;

export interface Stroke {
  category: PaintCategory;
  /** Zonas ya tocadas en este trazo (no se repite ficha al quedarse encima). */
  visited: Set<string>;
  last: { x: number; y: number };
  start: { x: number; y: number };
  dragging: boolean;
  startKey: string;
}

export function beginStroke(zones: readonly Zone[], p: { x: number; y: number }): Stroke | null {
  const z = zoneAt(zones, p.x, p.y);
  if (!z) return null;
  return { category: paintCategory(z.bet), visited: new Set(), last: p, start: p, dragging: false, startKey: z.key };
}

/**
 * Avanza el trazo hasta el punto `p` y devuelve las zonas nuevas sobre las
 * que hay que actuar (colocar o borrar ficha). Mientras no se supere el
 * umbral de arrastre no devuelve nada: un toque simple se resuelve al soltar.
 */
export function advanceStroke(stroke: Stroke, zones: readonly Zone[], p: { x: number; y: number }): Zone[] {
  if (!stroke.dragging) {
    if (Math.hypot(p.x - stroke.start.x, p.y - stroke.start.y) < DRAG_THRESHOLD) return [];
    stroke.dragging = true;
    stroke.last = stroke.start;
  }
  const hits = zonesAlong(zones, stroke.last, p).filter((z) => paintCategory(z.bet) === stroke.category && !stroke.visited.has(z.key));
  for (const z of hits) stroke.visited.add(z.key);
  stroke.last = p;
  return hits;
}
