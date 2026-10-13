/**
 * Motor de secuencias de animación.
 *
 * Una secuencia es una lista de pasos con nombre (preparación, animación
 * principal, desaceleración, estado final…). Cada paso ejecuta su efecto
 * (cambiar estado visual, reproducir sonido) y espera su duración.
 *
 * Garantías:
 *  - `busy` permite bloquear controles mientras corre (anti doble clic);
 *  - `skip()` acelera hasta el final ejecutando igualmente todos los efectos,
 *    de modo que el estado visual final siempre coincide con el del servidor;
 *  - `cancel()` detiene la secuencia (p. ej., al desmontar el componente) sin
 *    ejecutar más efectos ni dejar temporizadores vivos;
 *  - un error en un paso se captura, se informa y la secuencia termina en
 *    estado 'error' (el llamador puede resincronizar con el servidor).
 */

export interface SequenceStep {
  name: string;
  /** Duración del paso a velocidad 1 (ms). */
  duration: number;
  run?: () => void;
  /** Si es false, el paso no se acorta con skip() (p. ej., una pausa mínima de lectura). */
  skippable?: boolean;
}

export type SequenceStatus = 'idle' | 'running' | 'done' | 'skipped' | 'cancelled' | 'error';

export interface Clock {
  sleep(ms: number, signal: AbortSignal): Promise<void>;
}

export const realClock: Clock = {
  sleep(ms, signal) {
    return new Promise((resolve) => {
      if (ms <= 0 || signal.aborted) {
        resolve();
        return;
      }
      const t = setTimeout(resolve, ms);
      signal.addEventListener(
        'abort',
        () => {
          clearTimeout(t);
          resolve();
        },
        { once: true },
      );
    });
  },
};

export class Sequencer {
  status: SequenceStatus = 'idle';
  current: string | null = null;
  private skipCtl: AbortController | null = null;
  private cancelCtl: AbortController | null = null;
  private skipped = false;
  private listeners = new Set<() => void>();

  constructor(
    private speed = 1,
    private readonly clock: Clock = realClock,
    private readonly onError: (err: unknown, step: string) => void = () => {},
  ) {}

  get busy(): boolean {
    return this.status === 'running';
  }

  setSpeed(speed: number): void {
    this.speed = Math.max(0, speed);
  }

  subscribe(fn: () => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  private emit(): void {
    for (const fn of this.listeners) fn();
  }

  async play(steps: readonly SequenceStep[]): Promise<SequenceStatus> {
    if (this.busy) throw new Error('Ya hay una secuencia en curso');
    this.status = 'running';
    this.skipped = false;
    this.skipCtl = new AbortController();
    this.cancelCtl = new AbortController();
    const cancel = this.cancelCtl.signal;
    this.emit();
    try {
      for (const step of steps) {
        if (cancel.aborted) break;
        this.current = step.name;
        step.run?.();
        this.emit();
        const ms = this.skipped && step.skippable !== false ? 0 : step.duration * this.speed;
        if (ms > 0) {
          const ctl = new AbortController();
          const relay = (): void => ctl.abort();
          cancel.addEventListener('abort', relay, { once: true });
          if (step.skippable !== false) this.skipCtl.signal.addEventListener('abort', relay, { once: true });
          await this.clock.sleep(ms, ctl.signal);
          cancel.removeEventListener('abort', relay);
          this.skipCtl.signal.removeEventListener('abort', relay);
        }
      }
      this.status = cancel.aborted ? 'cancelled' : this.skipped ? 'skipped' : 'done';
    } catch (err) {
      this.status = 'error';
      this.onError(err, this.current ?? '?');
    } finally {
      this.current = null;
      this.emit();
    }
    return this.status;
  }

  skip(): void {
    if (!this.busy) return;
    this.skipped = true;
    this.skipCtl?.abort();
  }

  cancel(): void {
    this.cancelCtl?.abort();
  }
}

/** Utilidad para secuencias simples: espera `ms` escalados por la velocidad. */
export function wait(ms: number): SequenceStep {
  return { name: 'wait', duration: ms };
}
