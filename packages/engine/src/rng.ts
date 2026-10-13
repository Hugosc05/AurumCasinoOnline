/**
 * Fuente de aleatoriedad inyectable.
 *
 * Los motores nunca llaman a Math.random(): reciben un `Rng`. En producción el
 * servidor inyecta un RNG criptográfico (crypto.randomInt); en las pruebas se
 * usa `seededRng` o `sequenceRng` para obtener resultados reproducibles.
 */
export interface Rng {
  /** Entero uniforme en [0, maxExclusive). */
  int(maxExclusive: number): number;
}

/** PRNG determinista (mulberry32). SOLO para pruebas y simulaciones de bots. */
export function seededRng(seed: number): Rng {
  let a = seed >>> 0;
  const next = (): number => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  return {
    int(maxExclusive: number): number {
      if (!Number.isInteger(maxExclusive) || maxExclusive <= 0) {
        throw new RangeError('maxExclusive debe ser un entero positivo');
      }
      return Math.floor(next() * maxExclusive);
    },
  };
}

/**
 * RNG que devuelve una secuencia fija (módulo maxExclusive). Útil para forzar
 * resultados concretos en pruebas sin depender del azar.
 */
export function sequenceRng(values: readonly number[]): Rng {
  let i = 0;
  return {
    int(maxExclusive: number): number {
      if (values.length === 0) return 0;
      const v = values[i % values.length] ?? 0;
      i += 1;
      return ((v % maxExclusive) + maxExclusive) % maxExclusive;
    },
  };
}

/** Barajado Fisher–Yates in situ sobre una copia. */
export function shuffle<T>(items: readonly T[], rng: Rng): T[] {
  const out = items.slice();
  for (let i = out.length - 1; i > 0; i -= 1) {
    const j = rng.int(i + 1);
    const tmp = out[i] as T;
    out[i] = out[j] as T;
    out[j] = tmp;
  }
  return out;
}
