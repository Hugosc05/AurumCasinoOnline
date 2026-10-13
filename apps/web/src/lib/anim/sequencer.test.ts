import { describe, expect, it } from 'vitest';
import { Sequencer, type Clock } from './sequencer';

/** Reloj falso: registra esperas y resuelve inmediatamente salvo que se pida control manual. */
function fakeClock() {
  const sleeps: number[] = [];
  const pending: { resolve: () => void; signal: AbortSignal }[] = [];
  const clock: Clock = {
    sleep(ms, signal) {
      sleeps.push(ms);
      return new Promise((resolve) => {
        const entry = { resolve, signal };
        pending.push(entry);
        signal.addEventListener('abort', () => resolve(), { once: true });
      });
    },
  };
  const flush = async () => {
    await Promise.resolve();
    while (pending.length) {
      pending.shift()!.resolve();
      await Promise.resolve();
      await Promise.resolve();
    }
  };
  return { clock, sleeps, flush };
}

const tick = () => new Promise((r) => setTimeout(r, 0));

describe('Sequencer', () => {
  it('ejecuta los pasos en orden y aplica la velocidad', async () => {
    const waits: number[] = [];
    const seq = new Sequencer(0.5, { sleep: (ms) => { waits.push(ms); return Promise.resolve(); } });
    const order: string[] = [];
    const status = await seq.play([
      { name: 'preparación', duration: 100, run: () => order.push('a') },
      { name: 'principal', duration: 400, run: () => order.push('b') },
      { name: 'final', duration: 0, run: () => order.push('c') },
    ]);
    expect(status).toBe('done');
    expect(order).toEqual(['a', 'b', 'c']);
    expect(waits).toEqual([50, 200]);
  });

  it('impide iniciar una segunda secuencia mientras corre (anti doble clic)', async () => {
    const { clock, flush } = fakeClock();
    const seq = new Sequencer(1, clock);
    const p = seq.play([{ name: 'a', duration: 100 }]);
    await expect(seq.play([{ name: 'b', duration: 1 }])).rejects.toThrow();
    await flush();
    expect(await p).toBe('done');
    expect(seq.busy).toBe(false);
  });

  it('skip() salta las esperas pero ejecuta todos los efectos (estado final coherente)', async () => {
    const { clock } = fakeClock();
    const seq = new Sequencer(1, clock);
    const ran: string[] = [];
    const p = seq.play([
      { name: 'a', duration: 1000, run: () => ran.push('a') },
      { name: 'b', duration: 1000, run: () => ran.push('b') },
      { name: 'c', duration: 1000, run: () => ran.push('c') },
    ]);
    await tick();
    seq.skip();
    expect(await p).toBe('skipped');
    expect(ran).toEqual(['a', 'b', 'c']);
  });

  it('los pasos no saltables respetan su duración', async () => {
    const waits: number[] = [];
    const clock: Clock = { sleep: (ms) => { waits.push(ms); return Promise.resolve(); } };
    const seq = new Sequencer(1, clock);
    seq.skip();
    const p = seq.play([{ name: 'a', duration: 300 }, { name: 'lectura', duration: 500, skippable: false }]);
    seq.skip();
    await p;
    expect(waits).toContain(500);
  });

  it('cancel() detiene la secuencia sin ejecutar más efectos', async () => {
    const { clock } = fakeClock();
    const seq = new Sequencer(1, clock);
    const ran: string[] = [];
    const p = seq.play([
      { name: 'a', duration: 1000, run: () => ran.push('a') },
      { name: 'b', duration: 1000, run: () => ran.push('b') },
    ]);
    await tick();
    seq.cancel();
    expect(await p).toBe('cancelled');
    expect(ran).toEqual(['a']);
  });

  it('un error en un paso termina en estado error y libera el bloqueo', async () => {
    const errors: string[] = [];
    const seq = new Sequencer(0, undefined, (_e, step) => errors.push(step));
    const status = await seq.play([{ name: 'roto', duration: 0, run: () => { throw new Error('x'); } }]);
    expect(status).toBe('error');
    expect(errors).toEqual(['roto']);
    expect(seq.busy).toBe(false);
  });

  it('velocidad 0 (animaciones desactivadas) no espera nada', async () => {
    const waits: number[] = [];
    const seq = new Sequencer(0, { sleep: (ms) => { waits.push(ms); return Promise.resolve(); } });
    const ran: number[] = [];
    await seq.play([{ name: 'a', duration: 500, run: () => ran.push(1) }, { name: 'b', duration: 500, run: () => ran.push(2) }]);
    expect(waits).toEqual([]);
    expect(ran).toEqual([1, 2]);
  });
});
