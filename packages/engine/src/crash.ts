/**
 * Cohete (crash). El multiplicador crece de forma exponencial desde 1,00× y la
 * ronda termina en un punto de choque fijado ANTES de aceptar apuestas.
 *
 * Verificable: el servidor elige una semilla secreta y publica su SHA-256 al
 * abrir las apuestas; el punto de choque sale de HMAC-SHA256(semilla,
 * "aurum-crash:<ronda>") y la semilla se revela al estrellarse, de modo que
 * cualquiera puede comprobar que no se cambió después.
 *
 * Con X uniforme en [0, 1): choque = ⌊99 / (1 − X)⌋ / 100 (mínimo 1,00×).
 * P(choque ≥ m) = 0,99 / m, así que cobrar en cualquier m devuelve el 99 %
 * (ventaja de la casa del 1 %; cerca del 2 % de las rondas se estrella en 1,00×,
 * antes del primer cobro posible, 1,01×).
 */

/** Crecimiento: m(t) = e^(RATE · t), t en milisegundos (2× a los 8,7 s; 10× a los 28,8 s). */
export const CRASH_RATE = 0.00008;
/** Tope del multiplicador (en centésimas): 1.000×. */
export const CRASH_MAX = 100_000;
export const CRASH_LIMITS = { minBet: 1, maxBet: 10_000, minAuto: 101, maxAuto: CRASH_MAX } as const;
export const CRASH_TIMINGS = { bettingMs: 7000, crashedMs: 3500 } as const;

/** Punto de choque (en centésimas) a partir del HMAC en hexadecimal (se usan los primeros 52 bits). */
export function crashPointFromHex(hex: string): number {
  if (!/^[0-9a-f]{13,}$/i.test(hex)) throw new RangeError('Hash no válido');
  const h = Number.parseInt(hex.slice(0, 13), 16);
  const x = h / 2 ** 52;
  const cents = Math.floor(99 / (1 - x));
  return Math.max(100, Math.min(CRASH_MAX, cents));
}

/** Multiplicador (en centésimas, redondeado hacia abajo) a los `ms` milisegundos del despegue. */
export function multiplierAt(ms: number): number {
  if (ms <= 0) return 100;
  return Math.min(CRASH_MAX, Math.floor(100 * Math.exp(CRASH_RATE * ms) + 1e-9));
}

/** Milisegundos que tarda el multiplicador en llegar a `cents`. */
export function timeToMultiplier(cents: number): number {
  if (cents <= 100) return 0;
  return Math.log(cents / 100) / CRASH_RATE;
}

/** Premio entero de una apuesta cobrada a `cents`. */
export function crashPayout(amount: number, cents: number): number {
  return Math.floor((amount * cents) / 100);
}

/** Probabilidad exacta (modelo continuo) de que el cohete llegue a `cents`. */
export function crashSurvival(cents: number): number {
  return cents <= 100 ? 1 : Math.min(1, 99 / cents);
}

export const formatMultiplier = (cents: number): string => `${(cents / 100).toFixed(2).replace('.', ',')}×`;
