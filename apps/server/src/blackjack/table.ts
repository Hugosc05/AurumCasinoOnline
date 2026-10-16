import { randomUUID } from 'node:crypto';
import {
  BJ_STRATEGY_LABELS,
  BOT_PROFILE_LABELS,
  BlackjackError,
  DEFAULT_BLACKJACK_RULES,
  applyTableAction,
  botBet,
  decideBlackjack,
  handValue,
  isNatural,
  publicTableEvents,
  publicTableView,
  seatTotals,
  startTableRound,
  tableExtraStake,
  tableLegalActions,
  type BjAction,
  type BjOutcome,
  type BjTableEvent,
  type BjTableState,
  type BlackjackRules,
  type ShoeState,
} from '@aurum/engine';
import type { Database } from '../db/database';
import { nowIso } from '../db/database';
import { addToRoundBet, openRound, settleRound, type RoundRow } from '../games/rounds';
import { AppError } from '../lib/errors';
import { logger } from '../lib/logger';
import { cryptoRng } from '../lib/rng';
import { credit, getBalance } from '../wallet/wallet';
import type { BotIdentity, BotPool } from '../bots/pool';
import type { RealtimeHub, RtClient } from '../realtime/hub';

export interface BjTableConfig {
  id: string;
  name: string;
  minBet: number;
  maxBet: number;
  maxSeats: number;
  maxBots: number;
  targetPlayers: number;
  enabled: boolean;
}

export interface BjTimings {
  fast: boolean;
  /** Ventana de apuestas cuando hay personas sentadas. */
  betWindowMs: number;
  /** Ventana de apuestas en una mesa de demostración (solo bots y observadores). */
  demoBetWindowMs: number;
  humanTurnMs: number;
  disconnectedTurnMs: number;
  betweenRoundsMs: number;
}

/** Prefijo de las claves de idempotencia de las rondas de estas mesas. */
export const BJ_TABLE_KEY_PREFIX = 'bjt:';

/** Rondas sin apostar seguidas antes de levantar a una persona de la mesa. */
const MAX_MISSED_ROUNDS = 5;

interface SeatState {
  kind: 'human' | 'bot';
  id: string;
  name: string;
  bot?: BotIdentity;
  /** Fichas de demostración de un bot (los humanos apuestan desde su monedero). */
  stack: number;
  connected: boolean;
  disconnectedAt: number | null;
  missed: number;
  timeouts: number;
  leaving: boolean;
  /** Apuesta de la ronda actual (antes de repartir). */
  bet: number | null;
  /** Ronda abierta en `game_rounds` (solo humanos). */
  roundId: string | null;
}

type Phase = 'idle' | 'betting' | 'playing' | 'settled';

export interface BjRoundSummary {
  roundNo: number;
  endedAt: string;
  dealer: string[];
  results: { seat: number; name: string; isBot: boolean; bet: number; payout: number; outcomes: BjOutcome[] }[];
}

type WireEvent = BjTableEvent | { type: 'bet'; seat: number; amount: number } | { type: 'betting'; roundNo: number } | { type: 'seat'; seat: number };

/** Tiempo que necesita el cliente para animar cada evento: el servidor espera antes de seguir. */
function animationMs(events: readonly WireEvent[]): number {
  let ms = 0;
  for (const e of events) {
    switch (e.type) {
      case 'shuffle': ms += 1400; break;
      case 'deal': ms += 420; break;
      case 'split': ms += 450; break;
      case 'double': ms += 300; break;
      case 'bust': ms += 450; break;
      case 'reveal': ms += 700; break;
      case 'settle': ms += 1600; break;
      default: break;
    }
  }
  return ms;
}

/** Tiempo de decisión de un bot: variable y razonable (0,6–1,8 s, más si la mano es delicada). */
function botThinkMs(total: number): number {
  const base = 600 + cryptoRng.int(900);
  return total >= 12 && total <= 16 ? base + cryptoRng.int(500) : base;
}

/**
 * Mesa de blackjack con varios asientos, autoritativa en el servidor.
 *
 * - Cada asiento juega sus manos de forma independiente contra un crupier común.
 * - El crupier sigue reglas fijas (S17) que no dependen de las apuestas.
 * - Las apuestas humanas se cargan al monedero al apostar y se liquidan al
 *   terminar la ronda (rondas idempotentes en `game_rounds`).
 * - La carta tapada del crupier no viaja al cliente hasta que se revela.
 * - Los bots apuestan y juegan con estrategias legales, sin ver el zapato.
 */
export class BlackjackTable {
  seats: (SeatState | null)[];
  phase: Phase = 'idle';
  roundNo = 0;
  private roundUuid = '';
  state: BjTableState | null = null;
  private shoe: ShoeState | null = null;
  private seq = 0;
  private actionCount = 0;
  private timer: NodeJS.Timeout | null = null;
  private botTimers: NodeJS.Timeout[] = [];
  private deadline: number | null = null;
  private watchers = new Set<RtClient>();
  readonly history: BjRoundSummary[] = [];
  roundsPlayed = 0;
  lastError: string | null = null;
  private stopped = false;
  private roundStartedAt = '';

  constructor(
    public cfg: BjTableConfig,
    private readonly db: Database,
    private readonly hub: RealtimeHub,
    private readonly bots: BotPool,
    private readonly timings: BjTimings,
  ) {
    this.seats = Array.from({ length: cfg.maxSeats }, () => null);
  }

  /** Límites congelados al abrir las apuestas: un cambio del administrador no afecta a la ronda en curso. */
  private limits = { min: 0, max: 0 };

  get rules(): BlackjackRules {
    return { ...DEFAULT_BLACKJACK_RULES, minBet: this.limits.min, maxBet: this.limits.max };
  }

  /* ------------------------------------------------------------------------ */
  /* Consulta                                                                  */
  /* ------------------------------------------------------------------------ */

  humanCount(): number {
    return this.seats.filter((s) => s?.kind === 'human').length;
  }
  botCount(): number {
    return this.seats.filter((s) => s?.kind === 'bot').length;
  }
  seatOf(userId: string): number {
    return this.seats.findIndex((s) => s?.kind === 'human' && s.id === userId);
  }
  hasUser(userId: string): boolean {
    return this.seatOf(userId) !== -1;
  }
  private inRound(seat: number): boolean {
    return this.phase === 'playing' && !!this.state && this.state.seats.some((s) => s.seat === seat);
  }

  mode(): 'bots' | 'public' {
    return this.cfg.maxBots > 0 ? 'bots' : 'public';
  }

  summary() {
    return {
      id: this.cfg.id,
      name: this.cfg.name,
      minBet: this.cfg.minBet,
      maxBet: this.cfg.maxBet,
      maxSeats: this.cfg.maxSeats,
      humans: this.humanCount(),
      bots: this.botCount(),
      free: this.seats.filter((s) => s === null).length,
      watchers: this.watchers.size,
      phase: this.phase,
      mode: this.mode(),
      enabled: this.cfg.enabled,
      roundsPlayed: this.roundsPlayed,
    };
  }

  private legalFor(viewerId: string, seat: number): BjAction[] {
    if (!this.state || this.phase !== 'playing') return [];
    const legal = tableLegalActions(this.state, seat);
    if (legal.length === 0) return legal;
    const bal = getBalance(this.db, viewerId);
    const extra = this.state.turn ? this.state.seats.find((s) => s.seat === seat)!.hands[this.state.turn.hand]!.bet : 0;
    const canAfford = bal.unlimited || (bal.balance ?? 0) >= extra;
    return canAfford ? legal : legal.filter((a) => a !== 'double' && a !== 'split');
  }

  snapshot(viewerId: string | null) {
    const yourSeat = viewerId ? this.seatOf(viewerId) : -1;
    const round = this.state ? publicTableView(this.state) : null;
    return {
      table: {
        id: this.cfg.id,
        name: this.cfg.name,
        // Durante una ronda se muestran los límites con los que se abrió.
        minBet: this.phase === 'idle' ? this.cfg.minBet : this.limits.min,
        maxBet: this.phase === 'idle' ? this.cfg.maxBet : this.limits.max,
        maxSeats: this.seats.length,
        enabled: this.cfg.enabled,
        mode: this.mode(),
      },
      phase: this.phase,
      roundNo: this.roundNo,
      seats: this.seats.map((s, i) => {
        if (!s) return null;
        return {
          seat: i,
          name: s.name,
          isBot: s.kind === 'bot',
          isYou: s.kind === 'human' && s.id === viewerId,
          connected: s.connected,
          leaving: s.leaving,
          bet: s.bet,
          // Las fichas de demostración de un bot son públicas; el saldo de una persona no se muestra a nadie más.
          stack: s.kind === 'bot' ? s.stack : null,
          bot: s.bot
            ? {
                avatar: s.bot.avatar,
                experience: s.bot.experience,
                tagline: s.bot.tagline,
                profile: BOT_PROFILE_LABELS[s.bot.profile],
                strategy: BJ_STRATEGY_LABELS[s.bot.bjStrategy],
                betStyle: s.bot.betStyle,
              }
            : null,
        };
      }),
      // Sin identificadores internos de usuario.
      round: round ? { ...round, seats: round.seats.map(({ id: _id, ...rest }) => rest) } : null,
      you: {
        seat: yourSeat === -1 ? null : yourSeat,
        legal: viewerId && yourSeat !== -1 ? this.legalFor(viewerId, yourSeat) : [],
        canBet: yourSeat !== -1 && this.phase === 'betting' && this.seats[yourSeat]!.bet === null && !this.seats[yourSeat]!.leaving,
      },
      actionCount: this.actionCount,
      deadline: this.deadline,
      history: this.history.slice(0, 10),
      seq: this.seq,
      serverTime: Date.now(),
    };
  }

  /* ------------------------------------------------------------------------ */
  /* Observadores y difusión                                                   */
  /* ------------------------------------------------------------------------ */

  watch(client: RtClient): void {
    this.watchers.add(client);
    client.bjWatching = this.cfg.id;
    this.hub.send(client, { t: 'bj.snapshot', tableId: this.cfg.id, snapshot: this.snapshot(client.userId) });
    this.ensureRunning();
  }

  unwatch(client: RtClient): void {
    this.watchers.delete(client);
    if (client.bjWatching === this.cfg.id) client.bjWatching = null;
  }

  watcherCount(): number {
    return this.watchers.size;
  }

  private broadcast(events: WireEvent[]): void {
    this.seq += 1;
    for (const c of this.watchers) {
      this.hub.send(c, { t: 'bj.update', tableId: this.cfg.id, seq: this.seq, events, snapshot: this.snapshot(c.userId) });
    }
  }

  private broadcastSnapshot(): void {
    this.broadcast([]);
  }

  /* ------------------------------------------------------------------------ */
  /* Asientos                                                                  */
  /* ------------------------------------------------------------------------ */

  sit(userId: string, username: string, preferredSeat?: number): number {
    if (!this.cfg.enabled) throw new AppError(503, 'TABLE_DISABLED', 'Mesa desactivada');
    if (this.hasUser(userId)) throw new AppError(409, 'ALREADY_SEATED', 'Ya estás sentado en esta mesa');
    const bal = getBalance(this.db, userId);
    if (!bal.unlimited && (bal.balance ?? 0) < this.cfg.minBet) {
      throw new AppError(402, 'INSUFFICIENT_FUNDS', `Necesitas al menos ${this.cfg.minBet} créditos para sentarte`);
    }
    let seat = preferredSeat !== undefined && preferredSeat < this.seats.length && this.seats[preferredSeat] === null
      ? preferredSeat
      : this.seats.findIndex((s) => s === null);
    if (seat === -1) {
      // Un bot que no está jugando la ronda cede su sitio a una persona.
      const botSeat = this.seats.findIndex((s, i) => s?.kind === 'bot' && !this.inRound(i) && s.bet === null);
      if (botSeat !== -1) {
        this.removeSeat(botSeat);
        seat = botSeat;
      }
    }
    if (seat === -1) throw new AppError(409, 'TABLE_FULL', 'Mesa completa. Inténtalo al terminar la ronda.');
    this.seats[seat] = {
      kind: 'human', id: userId, name: username, stack: 0, connected: true, disconnectedAt: null,
      missed: 0, timeouts: 0, leaving: false, bet: null, roundId: null,
    };
    logger.info('Jugador sentado en mesa de blackjack', { table: this.cfg.id, seat });
    this.markExcessBots();
    this.broadcast([{ type: 'seat', seat }]);
    this.ensureRunning();
    return seat;
  }

  leave(userId: string): void {
    const seat = this.seatOf(userId);
    if (seat === -1) throw new AppError(404, 'NOT_SEATED', 'No estás sentado en esta mesa');
    const s = this.seats[seat]!;
    if (this.inRound(seat)) {
      // Su mano sigue hasta el final (se planta automáticamente en su turno) y se liquida con normalidad.
      s.leaving = true;
      if (this.state?.turn?.seat === seat) this.forceStand(seat);
      else this.broadcastSnapshot();
      return;
    }
    this.removeSeat(seat);
    this.broadcastSnapshot();
  }

  /** Retira un asiento. Una apuesta aún no repartida se anula y se devuelve. */
  private removeSeat(seat: number): void {
    const s = this.seats[seat];
    if (!s) return;
    this.seats[seat] = null;
    if (s.kind === 'human') {
      if (s.roundId) this.voidRound(s.roundId, 'left_before_deal');
      this.hub.sendToUser(s.id, { t: 'bj.left', tableId: this.cfg.id });
    } else {
      this.bots.release(s.id, s.stack + (s.bet ?? 0));
    }
  }

  setConnected(userId: string, connected: boolean): void {
    const seat = this.seatOf(userId);
    if (seat === -1) return;
    const s = this.seats[seat]!;
    s.connected = connected;
    s.disconnectedAt = connected ? null : Date.now();
    if (connected) s.timeouts = 0;
    this.broadcastSnapshot();
  }

  /** Anula una ronda abierta y reembolsa lo apostado (idempotente). */
  private voidRound(roundId: string, reason: string): void {
    try {
      this.db.tx(() => {
        const round = this.db.get<RoundRow>('SELECT * FROM game_rounds WHERE id = ?', roundId);
        if (!round || round.status !== 'open') return;
        const r = this.db.run(`UPDATE game_rounds SET status = 'void', settled_at = ? WHERE id = ? AND status = 'open'`, nowIso(), roundId);
        if (r.changes !== 1) return;
        if (round.bet_total > 0) credit(this.db, round.user_id, round.bet_total, 'refund', { roundId, meta: { table: this.cfg.id, reason } });
        this.hub.sendToUser(round.user_id, { t: 'balance', ...getBalance(this.db, round.user_id) });
      });
    } catch (err) {
      logger.error('No se pudo anular una ronda de blackjack', err, { table: this.cfg.id, roundId });
    }
  }

  /* ------------------------------------------------------------------------ */
  /* Bots                                                                      */
  /* ------------------------------------------------------------------------ */

  private desiredBots(): number {
    const humans = this.humanCount();
    if (humans === 0 && this.watchers.size === 0) return 0;
    const want = this.cfg.targetPlayers - humans;
    return Math.max(0, Math.min(want, this.cfg.maxBots, this.cfg.maxSeats - humans - (humans < this.cfg.maxSeats ? 1 : 0)));
  }

  private markExcessBots(): void {
    let excess = this.botCount() - this.desiredBots();
    for (let i = this.seats.length - 1; i >= 0 && excess > 0; i -= 1) {
      const s = this.seats[i];
      if (s?.kind === 'bot' && !s.leaving) {
        s.leaving = true;
        excess -= 1;
      }
    }
  }

  /** Entre rondas: salen los marcados, inactivos o sin fichas; entran bots si faltan. */
  private manageSeats(): void {
    this.markExcessBots();
    for (let i = 0; i < this.seats.length; i += 1) {
      const s = this.seats[i];
      if (!s) continue;
      const disconnectedTooLong = s.kind === 'human' && !s.connected && s.disconnectedAt !== null && Date.now() - s.disconnectedAt > 120_000;
      const idleHuman = s.kind === 'human' && (s.missed >= MAX_MISSED_ROUNDS || s.timeouts >= 3);
      const poorBot = s.kind === 'bot' && s.stack < this.cfg.minBet;
      if (s.leaving || disconnectedTooLong || idleHuman || poorBot) {
        if (s.kind === 'human' && (idleHuman || disconnectedTooLong)) {
          this.hub.sendToUser(s.id, { t: 'bj.notice', tableId: this.cfg.id, message: 'Te hemos levantado de la mesa por inactividad.' });
        }
        this.removeSeat(i);
      }
    }
    let need = this.desiredBots() - this.botCount();
    // Los bots se reparten por la mesa sin ocupar siempre los primeros asientos.
    const order = [1, 3, 0, 4, 2, 5, 6].filter((i) => i < this.seats.length);
    while (need > 0) {
      const free = order.find((i) => this.seats[i] === null);
      if (free === undefined) break;
      const bot = this.bots.acquire(`bj:${this.cfg.id}`);
      if (!bot) break;
      const stack = this.bots.takeBuyIn(bot.id, this.cfg.minBet * 40);
      this.seats[free] = {
        kind: 'bot', id: bot.id, name: bot.name, bot, stack, connected: true, disconnectedAt: null,
        missed: 0, timeouts: 0, leaving: false, bet: null, roundId: null,
      };
      need -= 1;
    }
  }

  /* ------------------------------------------------------------------------ */
  /* Ciclo de rondas                                                           */
  /* ------------------------------------------------------------------------ */

  ensureRunning(): void {
    if (this.stopped || this.timer || this.phase === 'betting' || this.phase === 'playing') return;
    this.schedule(this.timings.fast ? 0 : 500, () => this.openBetting());
  }

  private schedule(ms: number, fn: () => void): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(() => {
      this.timer = null;
      this.guard(fn);
    }, ms);
  }

  private guard(fn: () => void): void {
    try {
      fn();
    } catch (err) {
      this.lastError = String(err);
      logger.error(`Error en la mesa de blackjack ${this.cfg.id}`, err);
      this.recover();
    }
  }

  private clearBotTimers(): void {
    for (const t of this.botTimers) clearTimeout(t);
    this.botTimers = [];
  }

  /** Ante un error inesperado: se anula la ronda y se devuelven todas las apuestas. */
  private recover(): void {
    this.clearBotTimers();
    for (const s of this.seats) {
      if (!s) continue;
      if (s.kind === 'human' && s.roundId) this.voidRound(s.roundId, 'table_error');
      if (s.kind === 'bot' && this.state && this.phase === 'playing') s.stack += seatTotals(this.state, this.seats.indexOf(s)).bet;
      else if (s.kind === 'bot' && s.bet && this.phase === 'betting') s.stack += s.bet;
      s.bet = null;
      s.roundId = null;
    }
    this.state = null;
    this.phase = 'idle';
    this.deadline = null;
    this.broadcastSnapshot();
    this.schedule(this.timings.fast ? 0 : 3000, () => this.openBetting());
  }

  private openBetting(): void {
    if (this.stopped) return;
    this.clearBotTimers();
    this.state = null;
    this.applySeatCount();
    this.manageSeats();
    const hasAudience = this.humanCount() > 0 || this.watchers.size > 0;
    const occupied = this.seats.some(Boolean);
    if (!this.cfg.enabled || !hasAudience || !occupied) {
      this.phase = 'idle';
      this.deadline = null;
      this.broadcastSnapshot();
      return; // en reposo hasta que alguien mire o se siente
    }
    this.limits = { min: this.cfg.minBet, max: this.cfg.maxBet };
    this.phase = 'betting';
    this.roundNo += 1;
    this.roundUuid = randomUUID();
    this.actionCount = 0;
    for (const s of this.seats) if (s) { s.bet = null; s.roundId = null; }
    const window = this.humanCount() > 0 ? this.timings.betWindowMs : this.timings.demoBetWindowMs;
    this.deadline = Date.now() + window;
    this.broadcast([{ type: 'betting', roundNo: this.roundNo }]);
    // Cada bot apuesta en un momento distinto de la ventana.
    for (const [i, s] of this.seats.entries()) {
      if (s?.kind !== 'bot' || s.leaving) continue;
      const delay = this.timings.fast ? 0 : 500 + cryptoRng.int(Math.max(1, Math.min(2500, window - 1200)));
      this.botTimers.push(setTimeout(() => this.guard(() => this.botPlaceBet(i)), delay));
    }
    this.schedule(window, () => this.closeBetting());
  }

  private botPlaceBet(seat: number): void {
    const s = this.seats[seat];
    if (this.phase !== 'betting' || !s || s.kind !== 'bot' || s.bet !== null || !s.bot) return;
    const amount = botBet(s.bot.betStyle, s.stack, this.limits.min, this.limits.max, cryptoRng);
    if (amount <= 0) return;
    s.stack -= amount;
    s.bet = amount;
    this.broadcast([{ type: 'bet', seat, amount }]);
    this.maybeCloseEarly();
  }

  /** Apuesta de una persona: se descuenta del monedero en el acto (ronda abierta). */
  placeBet(userId: string, roundNo: number, amount: number): void {
    const seat = this.seatOf(userId);
    if (seat === -1) throw new AppError(403, 'NOT_SEATED', 'No estás sentado en esta mesa');
    if (this.phase !== 'betting' || roundNo !== this.roundNo) throw new AppError(409, 'BETTING_CLOSED', 'Las apuestas están cerradas');
    const s = this.seats[seat]!;
    if (s.leaving) throw new AppError(409, 'LEAVING', 'Estás saliendo de la mesa');
    if (s.bet !== null) throw new AppError(409, 'ALREADY_BET', 'Ya has apostado en esta ronda');
    if (!Number.isInteger(amount) || amount < this.limits.min || amount > this.limits.max) {
      throw new AppError(400, 'INVALID_BET', `La apuesta debe estar entre ${this.limits.min} y ${this.limits.max}`);
    }
    const round = openRound(this.db, userId, 'blackjack', amount, `${BJ_TABLE_KEY_PREFIX}${this.cfg.id}:${this.roundUuid}:${userId}`);
    s.bet = amount;
    s.roundId = round.id;
    s.missed = 0;
    this.hub.sendToUser(userId, { t: 'balance', ...getBalance(this.db, userId) });
    this.broadcast([{ type: 'bet', seat, amount }]);
    this.maybeCloseEarly();
  }

  /** Si todos los presentes ya han apostado, no hace falta esperar al final de la ventana. */
  private maybeCloseEarly(): void {
    const pending = this.seats.some((s) => s && !s.leaving && s.bet === null && (s.kind === 'bot' || s.connected));
    const anyHuman = this.seats.some((s) => s?.kind === 'human');
    if (!pending && (anyHuman || this.timings.fast)) this.schedule(this.timings.fast ? 0 : 700, () => this.closeBetting());
  }

  private closeBetting(): void {
    if (this.phase !== 'betting') return;
    this.clearBotTimers();
    const bets = this.seats.flatMap((s, i) => (s && s.bet !== null ? [{ seat: i, id: s.id, bet: s.bet }] : []));
    for (const s of this.seats) if (s?.kind === 'human' && s.bet === null) s.missed += 1;
    this.deadline = null;
    if (bets.length === 0) {
      this.phase = 'idle';
      this.broadcastSnapshot();
      this.schedule(this.timings.fast ? 0 : this.timings.betweenRoundsMs, () => this.openBetting());
      return;
    }
    this.roundStartedAt = nowIso();
    let state: BjTableState;
    try {
      state = startTableRound(bets, this.shoe, cryptoRng, this.rules);
    } catch (err) {
      if (err instanceof BlackjackError) throw new Error(`${err.code}: ${err.message}`);
      throw err;
    }
    this.state = state;
    this.phase = 'playing';
    this.commit();
  }

  private afterEvents(events: WireEvent[]): void {
    const state = this.state;
    if (!state) return;
    const anim = this.timings.fast ? 0 : animationMs(events);
    if (state.phase === 'settled') {
      this.schedule(this.timings.fast ? 0 : anim + this.timings.betweenRoundsMs, () => this.openBetting());
      return;
    }
    const turn = state.turn;
    if (!turn) return;
    const s = this.seats[turn.seat];
    // Una persona que se levanta durante su mano se planta; un bot que se va termina su mano.
    if (!s || (s.kind === 'human' && s.leaving)) {
      this.deadline = null;
      this.schedule(this.timings.fast ? 0 : anim + 400, () => this.forceStand(turn.seat));
      return;
    }
    if (s.kind === 'bot') {
      this.deadline = null;
      const hand = state.seats.find((x) => x.seat === turn.seat)!.hands[turn.hand]!;
      const think = this.timings.fast ? 0 : botThinkMs(handValue(hand.cards).total);
      this.schedule(anim + think, () => this.botAct(turn.seat));
      return;
    }
    const limit = s.connected ? this.timings.humanTurnMs : this.timings.disconnectedTurnMs;
    this.deadline = Date.now() + anim + limit;
    const count = this.actionCount;
    const roundNo = this.roundNo;
    this.schedule(anim + limit, () => {
      if (this.roundNo !== roundNo || this.actionCount !== count) return;
      s.timeouts += 1;
      this.forceStand(turn.seat);
    });
  }

  /** Acción por defecto (tiempo agotado, desconexión o salida): plantarse. */
  private forceStand(seat: number): void {
    if (!this.state || this.state.turn?.seat !== seat) return;
    this.apply(seat, 'stand');
  }

  private botAct(seat: number): void {
    const state = this.state;
    if (!state || state.turn?.seat !== seat) return;
    const s = this.seats[seat];
    if (!s || s.kind !== 'bot' || !s.bot) {
      this.forceStand(seat);
      return;
    }
    const hand = state.seats.find((x) => x.seat === seat)!.hands[state.turn.hand]!;
    const legal = tableLegalActions(state, seat);
    const action = decideBlackjack(s.bot.bjStrategy, hand.cards, state.dealer[0]!, legal, s.stack >= hand.bet);
    const extra = tableExtraStake(state, seat, action);
    if (extra > s.stack) {
      this.apply(seat, legal.includes('hit') ? 'hit' : 'stand');
      return;
    }
    s.stack -= extra;
    this.apply(seat, action);
  }

  /** Acción recibida por WebSocket de una persona. */
  humanAction(userId: string, roundNo: number, expectedCount: number, action: BjAction): void {
    const seat = this.seatOf(userId);
    if (seat === -1) throw new AppError(403, 'NOT_SEATED', 'No estás sentado en esta mesa');
    const state = this.state;
    if (!state || this.phase !== 'playing' || roundNo !== this.roundNo) throw new AppError(409, 'STALE_ACTION', 'La ronda ya no está activa');
    if (expectedCount !== this.actionCount) throw new AppError(409, 'STALE_ACTION', 'Acción duplicada o desfasada');
    if (state.turn?.seat !== seat) throw new AppError(409, 'NOT_YOUR_TURN', 'No es tu turno');
    if (!tableLegalActions(state, seat).includes(action)) throw new AppError(400, 'ILLEGAL_ACTION', 'Acción no permitida ahora');
    const s = this.seats[seat]!;
    const extra = tableExtraStake(state, seat, action);
    if (extra > 0) {
      const round = this.db.get<RoundRow>('SELECT * FROM game_rounds WHERE id = ?', s.roundId);
      if (!round || round.status !== 'open') throw new AppError(409, 'ROUND_CLOSED', 'La ronda ya no está abierta');
      addToRoundBet(this.db, round, extra); // lanza INSUFFICIENT_FUNDS sin cambiar nada
      this.hub.sendToUser(userId, { t: 'balance', ...getBalance(this.db, userId) });
    }
    s.timeouts = 0;
    this.apply(seat, action);
  }

  private apply(seat: number, action: BjAction): void {
    const state = this.state!;
    applyTableAction(state, seat, action, cryptoRng);
    this.actionCount += 1;
    this.commit();
  }

  /** Liquida (si procede) antes de difundir, para que todos vean el resultado ya cerrado. */
  private commit(): void {
    const state = this.state!;
    const events = publicTableEvents(state.events);
    if (state.phase === 'settled') this.onSettled();
    this.broadcast(events);
    this.afterEvents(events);
  }

  private onSettled(): void {
    const state = this.state!;
    this.phase = 'settled';
    this.deadline = null;
    this.roundsPlayed += 1;
    this.shoe = { cards: state.shoe.slice(), size: state.shoeSize };
    const results: BjRoundSummary['results'] = [];
    for (const ts of state.seats) {
      const s = this.seats[ts.seat];
      const { bet, payout } = seatTotals(state, ts.seat);
      const outcomes = ts.hands.map((h) => h.outcome!);
      if (!s || s.id !== ts.id) {
        // El asiento se vació durante la ronda (no debería ocurrir: las salidas esperan al final).
        logger.warn('Asiento vacío al liquidar blackjack', { table: this.cfg.id, seat: ts.seat });
        continue;
      }
      results.push({ seat: ts.seat, name: s.name, isBot: s.kind === 'bot', bet, payout, outcomes });
      if (s.kind === 'bot') {
        s.stack += payout;
        try {
          this.bots.recordBlackjack(s.id, payout - bet);
        } catch (err) {
          logger.warn('No se pudo registrar la ronda de un bot', { table: this.cfg.id }, err);
        }
      } else if (s.roundId) {
        try {
          const natural = ts.hands.length === 1 && ts.hands[0]!.outcome === 'blackjack' && isNatural(ts.hands[0]!.cards);
          const out = settleRound(this.db, s.roundId, payout, {
            table: this.cfg.id,
            roundNo: this.roundNo,
            seat: ts.seat,
            dealer: state.dealer,
            hands: ts.hands.map((h) => ({ cards: h.cards, bet: h.bet, outcome: h.outcome, payout: h.payout })),
            summary: payout > bet ? `Ganó ${payout - bet} en ${this.cfg.name}` : payout === bet ? `Empate en ${this.cfg.name}` : `Perdió en ${this.cfg.name}`,
          }, { natural });
          this.hub.sendToUser(s.id, { t: 'balance', ...out.balance });
          if (out.achievements.length > 0) this.hub.sendToUser(s.id, { t: 'achievements', achievements: out.achievements });
        } catch (err) {
          logger.error('Error liquidando una ronda de blackjack', err, { table: this.cfg.id, roundId: s.roundId });
        }
      }
      s.bet = null;
      s.roundId = null;
    }
    this.history.unshift({ roundNo: this.roundNo, endedAt: nowIso(), dealer: state.dealer.slice(), results });
    this.history.length = Math.min(this.history.length, 20);
  }

  /* ------------------------------------------------------------------------ */
  /* Administración                                                            */
  /* ------------------------------------------------------------------------ */

  updateConfig(cfg: BjTableConfig): void {
    this.cfg = cfg;
    if (this.phase === 'idle') this.applySeatCount();
    this.broadcastSnapshot();
    this.ensureRunning();
  }

  /** Redimensiona la mesa entre rondas sin perder asientos ocupados. */
  private applySeatCount(): void {
    if (this.seats.length === this.cfg.maxSeats) return;
    const occupied = this.seats.filter(Boolean) as SeatState[];
    if (occupied.length > this.cfg.maxSeats) return; // se aplicará cuando haya sitio
    this.seats = Array.from({ length: this.cfg.maxSeats }, (_, i) => occupied[i] ?? null);
  }

  /** Apagado: se anulan las rondas abiertas devolviendo las apuestas. */
  shutdown(): void {
    this.stopped = true;
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    this.clearBotTimers();
    for (let i = 0; i < this.seats.length; i += 1) {
      const s = this.seats[i];
      if (!s) continue;
      if (s.kind === 'bot' && this.state && this.phase === 'playing') {
        s.stack += seatTotals(this.state, i).bet;
        s.bet = null;
      }
      this.removeSeat(i);
    }
    this.state = null;
  }

  isIdle(): boolean {
    return !this.timer && this.phase !== 'playing' && this.phase !== 'betting';
  }

  /** Para pruebas y diagnóstico. */
  timerPending(): boolean {
    return !!this.timer;
  }
}
