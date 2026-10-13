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
