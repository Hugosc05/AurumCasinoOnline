import { isValidInside, validateRouletteBets, type RouletteBet, type RouletteBetSpec } from '@aurum/engine';
import { describe, expect, it } from 'vitest';
import { CELL_H, CELL_W, OUT_H, advanceStroke, beginStroke, betKey, buildZones, cellX, cellY, zoneAt } from './board';

describe('tapete de ruleta', () => {
  const zones = buildZones();
  it('todas las zonas generan apuestas válidas para el servidor', () => {
    for (const z of zones) {
      const bet = { ...z.bet, amount: 1 } as RouletteBet;
      if ('numbers' in bet) expect(isValidInside(bet.kind, bet.numbers), z.label).toBe(true);
      expect(() => validateRouletteBets([bet])).not.toThrow();
    }
  });
  it('no hay zonas duplicadas y están todas las modalidades', () => {
    const keys = zones.map((z) => z.key);
    expect(new Set(keys).size).toBe(keys.length);
    const count = (k: string) => zones.filter((z) => z.bet.kind === k).length;
    expect(count('straight')).toBe(37);
    expect(count('split')).toBe(24 + 33 + 3); // verticales + horizontales + con el cero
    expect(count('street')).toBe(12 + 2);
    expect(count('corner')).toBe(22 + 1);
    expect(count('sixline')).toBe(11);
    expect(count('dozen')).toBe(3);
    expect(count('column')).toBe(3);
    for (const k of ['red', 'black', 'even', 'odd', 'low', 'high']) expect(count(k)).toBe(1);
  });
  it('la clave es independiente del orden de los números', () => {
    expect(betKey({ kind: 'split', numbers: [5, 2] })).toBe(betKey({ kind: 'split', numbers: [2, 5] }));
  });
});

describe('pintado por arrastre', () => {
  const zones = buildZones();
  const center = (n: number) => {
    const z = zones.find((x) => x.key === `straight:${n}`)!;
    return { x: z.cx, y: z.cy };
  };
  const keyOf = (b: RouletteBetSpec) => betKey(b);

  it('el punto central de cada casilla es su pleno; los bordes son caballos y los cruces cuadros', () => {
    for (let n = 1; n <= 36; n += 1) expect(zoneAt(zones, center(n).x, center(n).y)!.key).toBe(`straight:${n}`);
    // Borde entre el 2 (fila central) y el 3 (fila superior) de la primera columna.
    const border = { x: cellX(0) + CELL_W / 2, y: cellY(1) };
    expect(zoneAt(zones, border.x, border.y)!.bet).toEqual({ kind: 'split', numbers: [3, 2] });
    const cross = { x: cellX(1), y: cellY(1) };
    expect(zoneAt(zones, cross.x, cross.y)!.bet.kind).toBe('corner');
    expect(zoneAt(zones, cellX(0) + 5, 3 * CELL_H + OUT_H / 2)!.bet).toEqual({ kind: 'dozen', index: 1 });
    expect(zoneAt(zones, -20, -20)).toBeNull();
  });

  it('un toque sin desplazamiento no pinta: se resuelve como selección simple', () => {
    const s = beginStroke(zones, center(17))!;
    expect(advanceStroke(s, zones, { x: center(17).x + 3, y: center(17).y + 2 })).toEqual([]);
    expect(s.dragging).toBe(false);
    expect(s.startKey).toBe('straight:17');
  });

  it('arrastrar por una fila pinta cada pleno una sola vez aunque se pase varias veces por encima', () => {
    // Fila superior: 3, 6, 9, 12…
    const s = beginStroke(zones, center(3))!;
    const got: string[] = [];
    for (const n of [6, 9, 12, 9, 6, 9]) got.push(...advanceStroke(s, zones, center(n)).map((z) => z.key));
    expect(got).toEqual(['straight:3', 'straight:6', 'straight:9', 'straight:12']);
    // Cruzar los bordes no crea caballos: el trazo empezó en un pleno.
    expect(got.every((k) => k.startsWith('straight'))).toBe(true);
  });

  it('un movimiento rápido (pocos eventos) no se salta casillas', () => {
    const s = beginStroke(zones, center(1))!;
    const got = advanceStroke(s, zones, center(34)).map((z) => keyOf(z.bet));
    expect(got).toEqual(Array.from({ length: 12 }, (_, i) => `straight:${3 * i + 1}`));
  });

  it('empezar en un borde pinta caballos y empezar fuera pinta apuestas exteriores', () => {
    const start = { x: cellX(0) + CELL_W / 2, y: cellY(1) };
    const s = beginStroke(zones, start)!;
    expect(s.category).toBe('split');
    const got = advanceStroke(s, zones, { x: cellX(3) + CELL_W / 2, y: cellY(1) });
    expect(got.length).toBeGreaterThanOrEqual(3);
    expect(got.every((z) => z.bet.kind === 'split')).toBe(true);
    const o = beginStroke(zones, { x: cellX(0) + 5, y: 3 * CELL_H + OUT_H * 1.5 })!;
    expect(o.category).toBe('outside');
    const outs = advanceStroke(o, zones, { x: cellX(11) - 5, y: 3 * CELL_H + OUT_H * 1.5 }).map((z) => z.bet.kind);
    expect(outs).toEqual(['low', 'even', 'red', 'black', 'odd', 'high']);
  });

  it('todas las apuestas pintadas son legales para el servidor', () => {
    const s = beginStroke(zones, center(2))!;
    const got = advanceStroke(s, zones, center(35));
    expect(() => validateRouletteBets(got.map((z) => ({ ...z.bet, amount: 1 }) as RouletteBet))).not.toThrow();
  });
});
