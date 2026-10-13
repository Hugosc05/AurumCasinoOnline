import { randomInt } from 'node:crypto';
import type { Rng } from '@aurum/engine';

/** RNG criptográficamente seguro (CSPRNG del sistema operativo) para todos los sorteos reales. */
export const cryptoRng: Rng = {
  int(maxExclusive: number): number {
    return randomInt(maxExclusive);
  },
};
