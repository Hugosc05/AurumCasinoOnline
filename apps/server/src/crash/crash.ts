import { createHash, createHmac, randomBytes, randomInt } from 'node:crypto';
import { z } from 'zod';
import { CRASH_LIMITS, CRASH_RATE, crashPayout, crashPointFromHex, multiplierAt, timeToMultiplier } from '@aurum/engine';
import type { Database } from '../db/database';
import { nowIso } from '../db/database';
import { getSetting } from '../db/seed';
import { AppError } from '../lib/errors';
import { logger } from '../lib/logger';
import { openRound, settleRound } from '../games/rounds';
import type { RealtimeHub, RtClient } from '../realtime/hub';
import { credit, getBalance } from '../wallet/wallet';

/**
 * Cohete (crash) multijugador: una sola ronda compartida por todos.
 *
 * - Antes de abrir las apuestas se fija la semilla secreta y se publica su
 *   SHA-256. El punto de choque sale de HMAC-SHA256(semilla, "aurum-crash:N")
 *   y no cambia con las apuestas. Al estrellarse se revela la semilla.
 * - El multiplicador lo calcula el servidor con su propio reloj: un cobro vale
 *   lo que marcaba el cohete al recibirlo, nunca lo que diga el cliente.
 * - Cada apuesta es una ronda del monedero (cobro al apostar, liquidación
 *   única al cobrar o al estrellarse) y se reembolsa si el servidor se cae.
 * - Los bots (marcados) dan vida a la lista, pero no usan créditos de nadie.
 */

export interface CrashTimings {
  bettingMs: number;
  crashedMs: number;
  tickMs: number;
}

interface Bet {
  userId: string | null;
  name: string;
  bot: boolean;
  amount: number;
  auto: number | null;
  roundId: string | null;
  cashedAt: number | null;
  payout: number;
}

type Phase = 'idle' | 'betting' | 'running' | 'crashed';

const KEY_PREFIX = 'crash:';
const roundNoSchema = z.number().int().min(1);
const betSchema = z.object({
  roundNo: roundNoSchema,
  amount: z.number().int().min(CRASH_LIMITS.minBet).max(CRASH_LIMITS.maxBet),
  auto: z.number().int().min(CRASH_LIMITS.minAuto).max(CRASH_LIMITS.maxAuto).nullable().optional(),
});
const roundSchema = z.object({ roundNo: roundNoSchema });

function parseMsg<T extends z.ZodType>(schema: T, msg: unknown): z.infer<T> {
  const r = schema.safeParse(msg);
  if (!r.success) throw new AppError(400, 'BAD_MESSAGE', 'Datos de la apuesta no válidos');
  return r.data;
}

export const crashHashFor = (seed: string, roundNo: number): string => createHmac('sha256', seed).update(`aurum-crash:${roundNo}`).digest('hex');
export const seedHashOf = (seed: string): string => createHash('sha256').update(seed).digest('hex');

export class CrashGame {
  private phase: Phase = 'idle';
  private roundNo = 0;
  private seed = '';
  private seedHash = '';
  private crashPoint = 100;
  private bettingEndsAt = 0;
  private startedAt = 0;
  private bets: Bet[] = [];
  private history: { roundNo: number; crash: number; seed: string; seedHash: string }[] = [];
  private watchers = new Set<RtClient>();
  private timer: NodeJS.Timeout | null = null;
  private ticker: NodeJS.Timeout | null = null;
  private botNames: string[] = [];
  private stopped = false;

  constructor(
    private readonly db: Database,
    private readonly hub: RealtimeHub,
    private readonly timings: CrashTimings,
    private readonly clock: () => number = Date.now,
    private newSeed: (roundNo: number) => string = () => randomBytes(32).toString('hex'),
  ) {}

  /** Solo para pruebas: fija cómo se eligen las semillas (para forzar puntos de choque conocidos). */
  useSeedSource(fn: (roundNo: number) => string): void {
    this.newSeed = fn;
  }

  init(): void {
    // Apuestas que quedaron abiertas por una caída del servidor: se anulan y se devuelven.
    const open = this.db.all<{ id: string; user_id: string; bet_total: number }>(
      `SELECT id, user_id, bet_total FROM game_rounds WHERE game = 'crash' AND status = 'open' AND idempotency_key LIKE ?`, `${KEY_PREFIX}%`,
    );
    for (const r of open) {
      this.db.tx(() => {
        const upd = this.db.run(`UPDATE game_rounds SET status = 'void', settled_at = ? WHERE id = ? AND status = 'open'`, nowIso(), r.id);
        if (upd.changes === 1 && r.bet_total > 0) credit(this.db, r.user_id, r.bet_total, 'refund', { roundId: r.id, meta: { reason: 'server_restart', game: 'crash' } });
      });
    }
    if (open.length > 0) logger.warn('Apuestas del cohete reembolsadas tras reinicio', { rounds: open.length });
    const last = this.db.get<{ n: number | null }>('SELECT MAX(round_no) AS n FROM crash_rounds');
    this.roundNo = Number(last?.n ?? 0);
    this.history = this.db
      .all<{ round_no: number; crash_point: number; seed: string; seed_hash: string }>(
        'SELECT round_no, crash_point, seed, seed_hash FROM crash_rounds WHERE crash_point IS NOT NULL ORDER BY round_no DESC LIMIT 25',
      )
      .map((r) => ({ roundNo: Number(r.round_no), crash: Number(r.crash_point), seed: r.seed, seedHash: r.seed_hash }));
    this.botNames = this.db.all<{ name: string }>('SELECT name FROM bots WHERE enabled = 1 ORDER BY name').map((b) => b.name);

    this.hub.on('crash.watch', (c) => this.watch(c));
    this.hub.on('crash.unwatch', (c) => this.unwatch(c));
    this.hub.on('crash.bet', (c, msg) => this.placeBet(c, parseMsg(betSchema, msg)));
    this.hub.on('crash.cancel', (c, msg) => this.cancelBet(c, parseMsg(roundSchema, msg).roundNo));
    this.hub.on('crash.cashout', (c, msg) => this.cashOut(c, parseMsg(roundSchema, msg).roundNo));
    this.hub.onDisconnect((c) => this.watchers.delete(c));
  }

  /* -------------------------------- Ciclo -------------------------------- */

  private watch(c: RtClient): void {
    this.watchers.add(c);
    if (this.phase === 'idle' && !this.stopped) this.openBetting();
    this.send(c);
  }

  private unwatch(c: RtClient): void {
    this.watchers.delete(c);
  }

  private hasHumans(): boolean {
    return this.bets.some((b) => !b.bot);
  }

  private openBetting(): void {
    this.clearTimers();
    this.roundNo += 1;
    this.seed = this.newSeed(this.roundNo + 0);
    this.seedHash = seedHashOf(this.seed);
    this.crashPoint = crashPointFromHex(crashHashFor(this.seed, this.roundNo));
    this.db.run('INSERT INTO crash_rounds (round_no, seed_hash) VALUES (?, ?) ON CONFLICT DO NOTHING', this.roundNo, this.seedHash);
    this.bets = [];
    this.phase = 'betting';
    this.bettingEndsAt = this.clock() + this.timings.bettingMs;
    this.addBots();
    this.broadcast();
    this.timer = setTimeout(() => this.launch(), this.timings.bettingMs);
  }

  /** Bots de ambiente: apuestas y objetivos variados (no mueven créditos de nadie). */
  private addBots(): void {
    if (this.botNames.length === 0) return;
    const n = Math.min(this.botNames.length, 3 + randomInt(6));
    const names = [...this.botNames].sort(() => randomInt(3) - 1).slice(0, n);
    for (const name of names) {
      const amount = [10, 20, 25, 50, 100, 150, 200, 500][randomInt(8)]!;
      // Objetivos con cola larga: la mayoría entre 1,2× y 3×, algunos muy altos.
      const r = randomInt(1000) / 1000;
      const auto = Math.max(110, Math.min(5000, Math.round(100 * (1.1 + 0.25 / Math.max(0.02, 1 - r)))));
      this.bets.push({ userId: null, name, bot: true, amount, auto, roundId: null, cashedAt: null, payout: 0 });
    }
  }

  private launch(): void {
    this.phase = 'running';
    this.startedAt = this.clock();
    this.db.run('UPDATE crash_rounds SET started_at = ? WHERE round_no = ?', nowIso(), this.roundNo);
    this.broadcast();
    this.ticker = setInterval(() => this.tick(), this.timings.tickMs);
    this.timer = setTimeout(() => this.tick(), Math.max(0, Math.ceil(timeToMultiplier(this.crashPoint))));
  }

  /** Paso del reloj: cobros automáticos alcanzados y, si toca, el choque. */
  private tick(): void {
    if (this.phase !== 'running') return;
    const elapsed = this.clock() - this.startedAt;
    const crashAt = timeToMultiplier(this.crashPoint);
    // Los objetivos automáticos por debajo del choque se pagan exactamente a su objetivo.
    let changed = false;
    const reached = Math.min(multiplierAt(elapsed), this.crashPoint);
    for (const b of this.bets) {
      if (b.cashedAt === null && b.auto !== null && b.auto <= reached && b.auto < this.crashPoint) {
        this.settleCashout(b, b.auto);
        changed = true;
      }
    }
    if (elapsed >= crashAt) {
      this.crash();
      return;
    }
    if (changed) this.broadcast();
  }

  private crash(): void {
    this.clearTimers();
    this.phase = 'crashed';
    for (const b of this.bets) {
      if (b.cashedAt !== null || b.bot || !b.roundId) continue;
      try {
        settleRound(this.db, b.roundId, 0, { roundNo: this.roundNo, crash: this.crashPoint, cashedAt: null, amount: b.amount });
        this.hub.sendToUser(b.userId!, { t: 'balance', ...getBalance(this.db, b.userId!) });
      } catch (err) {
        logger.error('No se pudo liquidar una apuesta del cohete', err, { round: this.roundNo });
      }
    }
    this.db.run('UPDATE crash_rounds SET seed = ?, crash_point = ?, ended_at = ? WHERE round_no = ?', this.seed, this.crashPoint, nowIso(), this.roundNo);
    this.history.unshift({ roundNo: this.roundNo, crash: this.crashPoint, seed: this.seed, seedHash: this.seedHash });
    this.history = this.history.slice(0, 25);
    this.broadcast();
    this.timer = setTimeout(() => {
      // Sin nadie mirando, el cohete se detiene hasta que alguien vuelva.
      if (this.watchers.size === 0 || this.stopped) {
        this.phase = 'idle';
        return;
      }
      this.openBetting();
    }, this.timings.crashedMs);
  }

  /* ------------------------------- Jugadas ------------------------------- */

  private requireUser(c: RtClient): string {
    if (!c.userId) throw new AppError(401, 'UNAUTHORIZED', 'Debes iniciar sesión');
    return c.userId;
  }

  placeBet(c: RtClient, m: { roundNo: number; amount: number; auto?: number | null }): void {
    const userId = this.requireUser(c);
    if (!getSetting(this.db, 'gamesEnabled').crash) throw new AppError(503, 'GAME_DISABLED', 'El cohete está temporalmente desactivado');
    if (this.phase !== 'betting' || m.roundNo !== this.roundNo) throw new AppError(409, 'BETTING_CLOSED', 'Las apuestas de esta ronda ya están cerradas');
    if (this.bets.some((b) => b.userId === userId)) throw new AppError(409, 'ALREADY_BET', 'Ya tienes una apuesta en esta ronda');
    const round = openRound(this.db, userId, 'crash', m.amount, `${KEY_PREFIX}${this.roundNo}:${userId}`);
    this.bets.push({ userId, name: c.username ?? 'Jugador', bot: false, amount: m.amount, auto: m.auto ?? null, roundId: round.id, cashedAt: null, payout: 0 });
    this.hub.sendToUser(userId, { t: 'balance', ...getBalance(this.db, userId) });
    this.broadcast();
  }

  cancelBet(c: RtClient, roundNo: number): void {
    const userId = this.requireUser(c);
    const b = this.bets.find((x) => x.userId === userId);
    if (this.phase !== 'betting' || roundNo !== this.roundNo || !b?.roundId) throw new AppError(409, 'CANNOT_CANCEL', 'Ya no se puede retirar la apuesta');
    this.db.tx(() => {
      const upd = this.db.run(`UPDATE game_rounds SET status = 'void', settled_at = ? WHERE id = ? AND status = 'open'`, nowIso(), b.roundId);
      if (upd.changes === 1) credit(this.db, userId, b.amount, 'refund', { roundId: b.roundId, meta: { reason: 'cancelled', game: 'crash' } });
    });
    this.bets = this.bets.filter((x) => x !== b);
    this.hub.sendToUser(userId, { t: 'balance', ...getBalance(this.db, userId) });
    this.broadcast();
  }

  cashOut(c: RtClient, roundNo: number): void {
    const userId = this.requireUser(c);
    const b = this.bets.find((x) => x.userId === userId);
    if (!b || roundNo !== this.roundNo) throw new AppError(404, 'NO_BET', 'No tienes apuesta en esta ronda');
    if (b.cashedAt !== null) throw new AppError(409, 'ALREADY_CASHED', 'Ya has cobrado');
    if (this.phase !== 'running') throw new AppError(409, 'TOO_LATE', this.phase === 'crashed' ? 'Demasiado tarde: el cohete ya se ha estrellado' : 'El cohete todavía no ha despegado');
    const elapsed = this.clock() - this.startedAt;
    const m = multiplierAt(elapsed);
    if (elapsed >= timeToMultiplier(this.crashPoint) || m >= this.crashPoint) {
      // Llegó después del choque (aunque el temporizador aún no hubiera saltado).
      this.crash();
      throw new AppError(409, 'TOO_LATE', 'Demasiado tarde: el cohete ya se ha estrellado');
    }
    this.settleCashout(b, Math.max(100, m));
    this.broadcast();
  }

  private settleCashout(b: Bet, at: number): void {
    b.cashedAt = at;
    b.payout = crashPayout(b.amount, at);
    if (b.bot || !b.roundId || !b.userId) return;
    const out = settleRound(this.db, b.roundId, b.payout, { roundNo: this.roundNo, cashedAt: at, amount: b.amount });
    this.hub.sendToUser(b.userId, { t: 'balance', ...out.balance });
    if (out.achievements.length > 0) this.hub.sendToUser(b.userId, { t: 'achievements', achievements: out.achievements });
  }

  /* ------------------------------- Vistas ------------------------------- */

  snapshot(userId: string | null) {
    const mine = userId ? this.bets.find((b) => b.userId === userId) : undefined;
    return {
      roundNo: this.roundNo,
      phase: this.phase,
      seedHash: this.seedHash,
      bettingEndsAt: this.bettingEndsAt,
      startedAt: this.startedAt,
      serverTime: this.clock(),
      rate: CRASH_RATE,
      // El punto de choque y la semilla solo se envían cuando ya se ha estrellado.
      crash: this.phase === 'crashed' ? this.crashPoint : null,
      seed: this.phase === 'crashed' ? this.seed : null,
      bets: this.bets
        .map((b) => ({ name: b.name, bot: b.bot, you: b === mine, amount: b.amount, cashedAt: b.cashedAt, payout: b.payout }))
        .sort((a, b) => Number(b.you) - Number(a.you) || b.amount - a.amount),
      you: mine ? { amount: mine.amount, auto: mine.auto, cashedAt: mine.cashedAt, payout: mine.payout } : null,
      history: this.history.slice(0, 20),
      limits: CRASH_LIMITS,
    };
  }

  private send(c: RtClient): void {
    this.hub.send(c, { t: 'crash.state', state: this.snapshot(c.userId) });
  }

  private broadcast(): void {
    for (const c of this.watchers) this.send(c);
  }

  private clearTimers(): void {
    if (this.timer) clearTimeout(this.timer);
    if (this.ticker) clearInterval(this.ticker);
    this.timer = null;
    this.ticker = null;
  }

  /** Apagado: las apuestas sin liquidar se devuelven (como en un reinicio). */
  shutdown(): void {
    this.stopped = true;
    this.clearTimers();
    for (const b of this.bets) {
      if (b.bot || !b.roundId || b.cashedAt !== null) continue;
      try {
        this.db.tx(() => {
          const upd = this.db.run(`UPDATE game_rounds SET status = 'void', settled_at = ? WHERE id = ? AND status = 'open'`, nowIso(), b.roundId);
          if (upd.changes === 1) credit(this.db, b.userId!, b.amount, 'refund', { roundId: b.roundId, meta: { reason: 'shutdown', game: 'crash' } });
        });
      } catch (err) {
        logger.error('No se pudo devolver una apuesta del cohete al apagar', err);
      }
    }
    this.bets = [];
    this.phase = 'idle';
  }

  diagnostics() {
    return { phase: this.phase, roundNo: this.roundNo, watchers: this.watchers.size, humans: this.hasHumans() };
  }
}
