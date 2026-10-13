import type { NextFunction, Request, Response } from 'express';
import { tooMany } from './errors';

/** Limitador de ventana deslizante en memoria (suficiente para un único proceso local). */
export class RateLimiter {
  private hits = new Map<string, number[]>();
  constructor(private readonly limit: number, private readonly windowMs: number) {}

  /** Registra un intento. Devuelve los segundos de espera si se supera el límite, o 0. */
  hit(key: string, now = Date.now()): number {
    const arr = (this.hits.get(key) ?? []).filter((t) => now - t < this.windowMs);
    if (arr.length >= this.limit) {
      this.hits.set(key, arr);
      return Math.ceil((this.windowMs - (now - arr[0]!)) / 1000);
    }
    arr.push(now);
    this.hits.set(key, arr);
    if (this.hits.size > 50_000) this.prune(now);
    return 0;
  }

  /** Consulta sin registrar. */
  blocked(key: string, now = Date.now()): number {
    const arr = (this.hits.get(key) ?? []).filter((t) => now - t < this.windowMs);
    if (arr.length >= this.limit) return Math.ceil((this.windowMs - (now - arr[0]!)) / 1000);
    return 0;
  }

  reset(key: string): void {
    this.hits.delete(key);
  }

  private prune(now: number): void {
    for (const [k, arr] of this.hits) if (arr.every((t) => now - t >= this.windowMs)) this.hits.delete(k);
  }
}

export function rateLimit(limiter: RateLimiter, keyFn: (req: Request) => string, message: string) {
  return (req: Request, _res: Response, next: NextFunction): void => {
    const wait = limiter.hit(keyFn(req));
    if (wait > 0) return next(tooMany(message, wait));
    next();
  };
}
