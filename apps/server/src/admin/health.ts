import { statfsSync } from 'node:fs';
import os from 'node:os';
import { monitorEventLoopDelay, type IntervalHistogram } from 'node:perf_hooks';
import type { RequestHandler } from 'express';
import type { Alerter } from './alerts';

export interface HealthSample {
  at: number;
  /** % de CPU del equipo entero (todas las CPU). */
  cpu: number;
  /** % de CPU que usa el propio casino. */
  cpuProcess: number;
  memUsedPct: number;
  rssMb: number;
  /** Retraso del bucle de eventos (ms): si sube, todo el casino responde tarde. */
  loopP50: number;
  loopMax: number;
  /** Peticiones HTTP en el intervalo y su duración. */
  requests: number;
  latencyP50: number;
  latencyP95: number;
  errors5xx: number;
  connections: number;
  online: number;
}

export interface DiskInfo {
  path: string;
  totalGb: number;
  freeGb: number;
  freePct: number;
}

/**
 * Mide la salud del servidor cada 10 s y guarda la última hora en memoria.
 * Avisa por Telegram si el disco se llena, la memoria se agota o el servidor
 * va lento de forma sostenida.
 */
export class HealthMonitor {
  private samples: HealthSample[] = [];
  private timer: NodeJS.Timeout | null = null;
  private loop: IntervalHistogram | null = null;
  private lastCpu = cpuTimes();
  private lastProc = process.cpuUsage();
  private lastAt = Date.now();
  private durations: number[] = [];
  private count5xx = 0;
  private slowStreak = 0;

  constructor(
    private readonly diskPath: string,
    private readonly live: () => { connections: number; online: number },
    private readonly alerts: Alerter,
    private readonly intervalMs = 10_000,
  ) {}

  /** Middleware que mide cuánto tarda cada petición. */
  middleware(): RequestHandler {
    return (_req, res, next) => {
      const start = process.hrtime.bigint();
      res.on('finish', () => {
        const ms = Number(process.hrtime.bigint() - start) / 1e6;
        if (this.durations.length < 50_000) this.durations.push(ms);
        if (res.statusCode >= 500) this.count5xx += 1;
      });
      next();
    };
  }

  start(): void {
    this.loop = monitorEventLoopDelay({ resolution: LOOP_RES_MS });
    this.loop.enable();
    this.timer = setInterval(() => this.sample(), this.intervalMs);
    this.timer.unref();
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.loop?.disable();
  }

  sample(): HealthSample {
    const now = Date.now();
    const cpu = cpuTimes();
    const busy = cpu.busy - this.lastCpu.busy;
    const total = cpu.total - this.lastCpu.total;
    const proc = process.cpuUsage();
    const procUs = proc.user - this.lastProc.user + (proc.system - this.lastProc.system);
    const elapsedUs = Math.max(1, (now - this.lastAt) * 1000);
    this.lastCpu = cpu;
    this.lastProc = proc;
    this.lastAt = now;

    const d = this.durations.sort((a, b) => a - b);
    const pick = (q: number): number => (d.length ? round(d[Math.min(d.length - 1, Math.floor(q * d.length))]!) : 0);
    const live = this.live();
    const s: HealthSample = {
      at: now,
      cpu: total > 0 ? round((busy / total) * 100) : 0,
      cpuProcess: round((procUs / elapsedUs / os.cpus().length) * 100),
      memUsedPct: round((1 - os.freemem() / os.totalmem()) * 100),
      rssMb: Math.round(process.memoryUsage().rss / 1e6),
      // El histograma incluye su propia resolución (20 ms): se resta para ver solo el retraso real.
      loopP50: this.loop ? round(Math.max(0, this.loop.percentile(50) / 1e6 - LOOP_RES_MS)) : 0,
      loopMax: this.loop ? round(Math.max(0, this.loop.max / 1e6 - LOOP_RES_MS)) : 0,
      requests: d.length,
      latencyP50: pick(0.5),
      latencyP95: pick(0.95),
      errors5xx: this.count5xx,
      connections: live.connections,
      online: live.online,
    };
    this.loop?.reset();
    this.durations = [];
    this.count5xx = 0;
    this.samples.push(s);
    if (this.samples.length > 360) this.samples.shift();
    this.checkAlerts(s);
    return s;
  }

  private checkAlerts(s: HealthSample): void {
    if (s.memUsedPct >= 92) void this.alerts.notify('mem', 'warn', `Memoria del equipo casi llena: ${s.memUsedPct} % en uso (el casino usa ${s.rssMb} MB).`, 3 * 3600_000);
    this.slowStreak = s.loopP50 > 200 || s.latencyP95 > 2000 ? this.slowStreak + 1 : 0;
    if (this.slowStreak === 6) void this.alerts.notify('slow', 'warn', `El servidor va lento desde hace 1 minuto (retraso ${s.loopP50} ms, respuestas p95 ${s.latencyP95} ms).`, 3600_000);
    const disk = this.disk();
    if (disk && disk.freePct < 8) void this.alerts.notify('disk', 'critical', `Disco casi lleno: quedan ${disk.freeGb} GB (${disk.freePct} %). La base de datos y las copias pueden fallar.`, 6 * 3600_000);
  }

  disk(): DiskInfo | null {
    try {
      const st = statfsSync(this.diskPath);
      const total = Number(st.blocks) * Number(st.bsize);
      const free = Number(st.bavail) * Number(st.bsize);
      return { path: this.diskPath, totalGb: round(total / 1e9), freeGb: round(free / 1e9), freePct: total > 0 ? round((free / total) * 100) : 0 };
    } catch {
      return null;
    }
  }

  snapshot() {
    const current = this.samples.at(-1) ?? this.sample();
    return {
      current,
      series: this.samples,
      disk: this.disk(),
      system: {
        hostname: os.hostname(),
        platform: `${os.type()} ${os.release()} (${process.arch})`,
        cpus: os.cpus().length,
        cpuModel: os.cpus()[0]?.model ?? null,
        memTotalGb: round(os.totalmem() / 1e9),
        uptimeSystemSec: Math.round(os.uptime()),
        uptimeProcessSec: Math.round(process.uptime()),
        node: process.version,
      },
    };
  }
}

function cpuTimes(): { busy: number; total: number } {
  let busy = 0;
  let total = 0;
  for (const c of os.cpus()) {
    const t = c.times;
    const sum = t.user + t.nice + t.sys + t.idle + t.irq;
    total += sum;
    busy += sum - t.idle;
  }
  return { busy, total };
}

const round = (n: number): number => Math.round(n * 10) / 10;
const LOOP_RES_MS = 20;
