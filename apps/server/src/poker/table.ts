import { randomUUID } from 'node:crypto';
import {
  BOT_PROFILE_LABELS,
  PokerError,
  applyPokerAction,
  botThinkTime,
  decideBotAction,
  evaluateHand,
  legalActions,
  playerAt,
  publicHandView,
  startHand,
  timeoutAction,
  type BotDifficulty,
  type BotProfile,
  type BotView,
  type LegalActions,
  type OpponentStats,
  type PokerAction,
  type PokerEvent,
  type PokerHandState,
  type PokerPublicHand,
  type PokerSeat,
} from '@aurum/engine';
import type { Database } from '../db/database';
import { nowIso } from '../db/database';
import { AppError } from '../lib/errors';
import { logger } from '../lib/logger';
import { cryptoRng } from '../lib/rng';
import { recordOutcome } from '../stats/stats';
import { credit, debit, getBalance } from '../wallet/wallet';
import type { RealtimeHub, RtClient } from '../realtime/hub';
import type { BotIdentity, BotPool } from '../bots/pool';

export interface TableConfig {
  id: string;
  name: string;
  smallBlind: number;
  bigBlind: number;
  minBuyIn: number;
  maxBuyIn: number;
  maxSeats: number;
  maxBots: number;
  targetPlayers: number;
  enabled: boolean;
  /** Sala privada a la que pertenece la mesa (no aparece en el salón público). */
  roomId?: string | null;
  /**
   * wallet: las fichas salen del monedero y vuelven al levantarse (como en las mesas públicas).
   * room: fichas propias de la sala, iguales para todos y sin tocar el monedero.
   */
  chipMode?: 'wallet' | 'room';
}

interface SeatState {
  kind: 'human' | 'bot';
  id: string;
  name: string;
  stack: number;
  profile?: BotProfile;
  difficulty?: BotDifficulty;
  bot?: BotIdentity;
  connected: boolean;
  disconnectedAt: number | null;
  timeouts: number;
  leaving: boolean;
  joinedAt: number;
}

export interface HandSummary {
  handId: string;
  endedAt: string;
  board: string[];
  pot: number;
  winners: { name: string; amount: number; handName: string | null; isBot: boolean }[];
}

export interface TableTimings {
  fast: boolean;
  humanTimeoutMs: number;
  disconnectedTimeoutMs: number;
  betweenHandsMs: number;
}

/** Tiempo aproximado que necesita el cliente para animar cada evento (el servidor espera antes de seguir). */
function animationMs(events: readonly PokerEvent[]): number {
  let ms = 0;
  for (const e of events) {
    switch (e.type) {
      case 'hand_start': ms += 1800; break; // recogida + barajado en el cliente
      case 'blind': ms += 250; break;
      case 'deal_hole': ms += 130; break;
      case 'action': ms += 400; break;
      case 'collect': ms += 450; break;
      case 'street': ms += e.street === 'flop' ? 1100 : 750; break;
      case 'return': ms += 350; break;
      case 'showdown': ms += 1500; break;
      case 'award': ms += 1300; break;
      default: break;
    }
  }
  return ms;
}


/**
 * Mesa de Texas Hold'em autoritativa en el servidor.
 *
 * - Todo el estado (mazo, cartas privadas, botes) vive aquí; los clientes
 *   reciben vistas filtradas por jugador.
 * - Los bots solo reciben sus cartas y la información pública.
 * - Ningún jugador (humano o bot) puede bloquear la mesa: hay temporizadores
 *   de turno y acción por defecto (pasar o retirarse).
 */
export class PokerTable {
  seats: (SeatState | null)[];
  hand: PokerHandState | null = null;
  private button = -1;
  private seq = 0;
  private actionCount = 0;
  private timer: NodeJS.Timeout | null = null;
  private deadline: number | null = null;
  private handLog: PokerEvent[] = [];
  private handStartStacks = new Map<number, number>();
  private handStartedAt = '';
  private streetAggressor: number | null = null;
  private watchers = new Set<RtClient>();
  readonly history: HandSummary[] = [];
  readonly oppStats = new Map<string, OpponentStats>();
  handsPlayed = 0;
  lastError: string | null = null;
  private stopped = false;
  /** Fichas de sala de quien se levanta (para que al volver no reciba fichas nuevas). */
  private roomStacks = new Map<string, number>();

  private get roomChips(): boolean {
    return this.cfg.chipMode === 'room';
  }

  constructor(
    public cfg: TableConfig,
    private readonly db: Database,
    private readonly hub: RealtimeHub,
    private readonly bots: BotPool,
    private readonly timings: TableTimings,
  ) {
    this.seats = Array.from({ length: cfg.maxSeats }, () => null);
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
  watcherCount(): number {
    return this.watchers.size;
  }
  seatOf(userId: string): number {
    return this.seats.findIndex((s) => s?.kind === 'human' && s.id === userId);
  }
  hasUser(userId: string): boolean {
    return this.seatOf(userId) !== -1;
  }

  summary() {
    return {
      id: this.cfg.id,
      name: this.cfg.name,
      smallBlind: this.cfg.smallBlind,
      bigBlind: this.cfg.bigBlind,
      minBuyIn: this.cfg.minBuyIn,
      maxBuyIn: this.cfg.maxBuyIn,
      maxSeats: this.cfg.maxSeats,
      humans: this.humanCount(),
      bots: this.botCount(),
      watchers: this.watcherCount(),
      handInProgress: !!this.hand && !this.hand.result,
      enabled: this.cfg.enabled,
      handsPlayed: this.handsPlayed,
      free: this.seats.filter((x) => x === null).length,
      mode: this.cfg.roomId ? ('private' as const) : this.cfg.maxBots > 0 ? ('bots' as const) : ('public' as const),
    };
  }

  snapshot(viewerId: string | null) {
    const hand: PokerPublicHand | null = this.hand ? publicHandView(this.hand, viewerId) : null;
    const yourSeat = viewerId ? this.seatOf(viewerId) : -1;
    let legal: LegalActions | null = null;
    if (this.hand && yourSeat !== -1 && this.hand.toAct === yourSeat) legal = legalActions(this.hand, yourSeat);
    return {
      table: {
        id: this.cfg.id,
        name: this.cfg.name,
        smallBlind: this.cfg.smallBlind,
        bigBlind: this.cfg.bigBlind,
        minBuyIn: this.cfg.minBuyIn,
        maxBuyIn: this.cfg.maxBuyIn,
        maxSeats: this.cfg.maxSeats,
        enabled: this.cfg.enabled,
        mode: this.cfg.roomId ? ('private' as const) : this.cfg.maxBots > 0 ? ('bots' as const) : ('public' as const),
        roomId: this.cfg.roomId ?? null,
        chipMode: this.cfg.chipMode ?? 'wallet',
        maxBots: this.cfg.maxBots,
      },
      seats: this.seats.map((s, i) => {
        if (!s) return null;
        const inHand = this.hand ? playerAt(this.hand, i) : undefined;
        return {
          seat: i,
          name: s.name,
          isBot: s.kind === 'bot',
          profile: s.profile ? BOT_PROFILE_LABELS[s.profile] : null,
          difficulty: s.difficulty ?? null,
          avatar: s.bot?.avatar ?? null,
          experience: s.bot?.experience ?? null,
          tagline: s.bot?.tagline ?? null,
          stack: inHand ? inHand.stack : s.stack,
          connected: s.connected,
          leaving: s.leaving,
          isYou: s.kind === 'human' && s.id === viewerId,
          inHand: !!inHand,
        };
      }),
      hand,
      you: { seat: yourSeat === -1 ? null : yourSeat, legal },
      actionCount: this.actionCount,
      deadline: this.deadline,
      history: this.history.slice(0, 10),
      // «Solo juegan bots» solo es cierto si hay bots sentados (nunca en una sala vacía sin bots).
      demo: this.humanCount() === 0 && this.seats.some((s) => s?.kind === 'bot'),
      seq: this.seq,
      serverTime: Date.now(),
    };
  }

  /* ------------------------------------------------------------------------ */
  /* Observadores y difusión                                                   */
  /* ------------------------------------------------------------------------ */

  watch(client: RtClient): void {
    this.watchers.add(client);
    client.watching = this.cfg.id;
    this.hub.send(client, { t: 'poker.snapshot', tableId: this.cfg.id, snapshot: this.snapshot(client.userId) });
    this.ensureRunning();
  }

  unwatch(client: RtClient): void {
    this.watchers.delete(client);
    if (client.watching === this.cfg.id) client.watching = null;
  }

  private broadcast(events: PokerEvent[]): void {
    this.seq += 1;
    for (const c of this.watchers) {
      this.hub.send(c, { t: 'poker.update', tableId: this.cfg.id, seq: this.seq, events, snapshot: this.snapshot(c.userId) });
    }
  }

  private broadcastSnapshot(): void {
    this.seq += 1;
    for (const c of this.watchers) this.hub.send(c, { t: 'poker.snapshot', tableId: this.cfg.id, snapshot: this.snapshot(c.userId) });
  }

  /* ------------------------------------------------------------------------ */
  /* Asientos                                                                  */
  /* ------------------------------------------------------------------------ */

  sit(userId: string, username: string, buyIn: number, preferredSeat?: number): number {
    if (!this.cfg.enabled) throw new AppError(503, 'TABLE_DISABLED', 'Mesa desactivada');
    if (this.hasUser(userId)) throw new AppError(409, 'ALREADY_SEATED', 'Ya estás sentado en esta mesa');
    if (this.roomChips) {
      // Fichas de sala: todos empiezan igual; quien vuelve recupera las que tenía.
      buyIn = this.roomStacks.get(userId) ?? this.cfg.maxBuyIn;
      if (buyIn <= 0) throw new AppError(409, 'NO_ROOM_CHIPS', 'Te has quedado sin fichas de esta sala');
    } else if (!Number.isInteger(buyIn) || buyIn < this.cfg.minBuyIn || buyIn > this.cfg.maxBuyIn) {
      throw new AppError(400, 'INVALID_BUYIN', `La entrada debe estar entre ${this.cfg.minBuyIn} y ${this.cfg.maxBuyIn}`);
    }
    let seat = preferredSeat !== undefined && this.seats[preferredSeat] === null ? preferredSeat : this.seats.findIndex((s) => s === null);
    if (seat === -1) {
      // Si un bot ocupa un asiento y no está jugando la mano, cede su sitio al humano.
      const botSeat = this.seats.findIndex((s, i) => s?.kind === 'bot' && !(this.hand && !this.hand.result && playerAt(this.hand, i)));
      if (botSeat !== -1) {
        this.removeSeat(botSeat);
        seat = botSeat;
      }
    }
    if (seat === -1) throw new AppError(409, 'TABLE_FULL', 'Mesa completa. Inténtalo al terminar la mano.');
    if (!this.roomChips) {
      this.db.tx(() => {
        debit(this.db, userId, buyIn, 'poker_buyin', { meta: { table: this.cfg.id } });
        this.db.run(
          'INSERT INTO poker_seats (table_id, seat, user_id, stack, joined_at) VALUES (?, ?, ?, ?, ?)',
          this.cfg.id, seat, userId, buyIn, nowIso(),
        );
      });
    }
    this.seats[seat] = {
      kind: 'human', id: userId, name: username, stack: buyIn, connected: true, disconnectedAt: null,
      timeouts: 0, leaving: false, joinedAt: Date.now(),
    };
    this.hub.sendToUser(userId, { t: 'balance', ...getBalance(this.db, userId) });
    logger.info('Jugador sentado en mesa de póker', { table: this.cfg.id, seat });
    this.hub.emitLocal('seat', userId);
    // Si sobran bots respecto al objetivo, uno abandonará al terminar la mano.
    this.markExcessBots();
    this.broadcastSnapshot();
    this.ensureRunning();
    return seat;
  }

  leave(userId: string): void {
    const seat = this.seatOf(userId);
    if (seat === -1) throw new AppError(404, 'NOT_SEATED', 'No estás sentado en esta mesa');
    const s = this.seats[seat]!;
    const inHand = this.hand && !this.hand.result ? playerAt(this.hand, seat) : undefined;
    if (inHand && !inHand.folded) {
      s.leaving = true;
      if (this.hand!.toAct === seat) this.applyAction(seat, { type: 'fold' }, 'leave');
      else this.broadcastSnapshot();
      return;
    }
    this.removeSeat(seat);
    this.broadcastSnapshot();
  }

  /** Retira un asiento devolviendo las fichas (humano → monedero, bot → bankroll). */
  private removeSeat(seat: number): void {
    const s = this.seats[seat];
    if (!s) return;
    this.seats[seat] = null;
    if (s.kind === 'human' && this.roomChips) {
      this.roomStacks.set(s.id, s.stack);
      this.hub.sendToUser(s.id, { t: 'poker.left', tableId: this.cfg.id, cashOut: 0, roomChips: s.stack });
      this.hub.emitLocal('seat', s.id);
    } else if (s.kind === 'human') {
      this.db.tx(() => {
        if (s.stack > 0) credit(this.db, s.id, s.stack, 'poker_cashout', { meta: { table: this.cfg.id } });
        this.db.run('DELETE FROM poker_seats WHERE table_id = ? AND user_id = ?', this.cfg.id, s.id);
      });
      this.hub.sendToUser(s.id, { t: 'balance', ...getBalance(this.db, s.id) });
      this.hub.sendToUser(s.id, { t: 'poker.left', tableId: this.cfg.id, cashOut: s.stack });
      this.hub.emitLocal('seat', s.id);
    } else {
      this.bots.release(s.id, s.stack);
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

  /* ------------------------------------------------------------------------ */
  /* Bots                                                                      */
  /* ------------------------------------------------------------------------ */

  private desiredBots(): number {
    const humans = this.humanCount();
    if (humans === 0 && this.watchers.size === 0) return 0;
    const want = Math.max(this.cfg.targetPlayers - humans, humans === 1 ? 1 : 0);
    return Math.max(0, Math.min(want, this.cfg.maxBots, this.cfg.maxSeats - humans));
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

  /** Entre manos: salida de bots marcados o sin fichas y entrada controlada de nuevos bots. */
  private manageSeats(): void {
    const minBotStack = this.cfg.bigBlind * 15;
    this.markExcessBots();
    for (let i = 0; i < this.seats.length; i += 1) {
      const s = this.seats[i];
      if (!s) continue;
      const disconnectedTooLong = s.kind === 'human' && !s.connected && s.disconnectedAt !== null && Date.now() - s.disconnectedAt > 120_000;
      const bustedHuman = s.kind === 'human' && s.stack === 0;
      const poorBot = s.kind === 'bot' && s.stack < minBotStack;
      const idleHuman = s.kind === 'human' && s.timeouts >= 3;
      if (s.leaving || disconnectedTooLong || bustedHuman || poorBot || idleHuman) {
        if (s.kind === 'human' && (bustedHuman || idleHuman || disconnectedTooLong)) {
          this.hub.sendToUser(s.id, {
            t: 'poker.notice',
            tableId: this.cfg.id,
            message: bustedHuman ? 'Te has quedado sin fichas en la mesa.' : 'Te hemos levantado de la mesa por inactividad.',
          });
        }
        this.removeSeat(i);
      }
    }
    let need = this.desiredBots() - this.botCount();
    while (need > 0) {
      const free = this.seats.findIndex((s) => s === null);
      if (free === -1) break;
      const bot = this.bots.acquire(`poker:${this.cfg.id}`);
      if (!bot) break;
      const buyIn = Math.min(this.cfg.maxBuyIn, Math.max(this.cfg.minBuyIn, this.cfg.bigBlind * 100));
      const stack = this.bots.takeBuyIn(bot.id, buyIn);
      this.seats[free] = {
        kind: 'bot', id: bot.id, name: bot.name, stack, profile: bot.profile, difficulty: bot.difficulty, bot,
        connected: true, disconnectedAt: null, timeouts: 0, leaving: false, joinedAt: Date.now(),
      };
      need -= 1;
    }
  }

  /* ------------------------------------------------------------------------ */
  /* Ciclo de manos                                                            */
  /* ------------------------------------------------------------------------ */

  /** Arranca el ciclo si hay a quién mostrarle la partida. */
  ensureRunning(): void {
    if (this.stopped || this.timer || (this.hand && !this.hand.result)) return;
    this.schedule(this.timings.fast ? 0 : 600, () => this.startNextHand());
  }

  private schedule(ms: number, fn: () => void): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(() => {
      this.timer = null;
      try {
        fn();
      } catch (err) {
        this.lastError = String(err);
        logger.error(`Error en la mesa ${this.cfg.id}`, err);
        this.recover();
      }
    }, ms);
  }

  /** Recuperación ante un error inesperado: anula la mano y devuelve las fichas iniciales. */
  private recover(): void {
    if (this.hand && !this.hand.result) {
      for (const [seat, stack] of this.handStartStacks) {
        const s = this.seats[seat];
        if (s) s.stack = stack;
      }
      this.persistHumanStacks();
      logger.warn('Mano anulada por error; fichas restauradas', { table: this.cfg.id, hand: this.hand.handId });
    }
    this.hand = null;
    this.deadline = null;
    this.broadcastSnapshot();
    this.schedule(this.timings.fast ? 0 : 3000, () => this.startNextHand());
  }

  private startNextHand(): void {
    if (this.stopped) return;
    if (this.hand?.result) this.hand = null;
    this.manageSeats();
    const hasAudience = this.humanCount() > 0 || this.watchers.size > 0;
    const seatsForHand: (PokerSeat | null)[] = this.seats.map((s) =>
      s && s.stack > 0 && !s.leaving ? { id: s.id, name: s.name, isBot: s.kind === 'bot', stack: s.stack } : null,
    );
    const eligible = seatsForHand.filter(Boolean).length;
    if (!this.cfg.enabled || !hasAudience || eligible < 2) {
      this.hand = null;
      this.deadline = null;
      this.broadcastSnapshot();
      return; // en reposo hasta que alguien mire o se siente
    }
    const handId = randomUUID();
    this.hand = startHand(seatsForHand, this.button, { smallBlind: this.cfg.smallBlind, bigBlind: this.cfg.bigBlind }, cryptoRng, handId);
    this.button = this.hand.button;
    this.actionCount = 0;
    this.streetAggressor = null;
    this.handStartedAt = nowIso();
    this.handStartStacks = new Map(this.hand.players.map((p) => [p.seat, p.stack + p.contributed]));
    this.handLog = [...this.hand.events];
    // Fichas comprometidas: el stack del asiento refleja ya las ciegas.
    for (const p of this.hand.players) this.seats[p.seat]!.stack = p.stack;
    this.broadcast(this.hand.events);
    this.afterEvents(this.hand.events);
  }

  private afterEvents(events: PokerEvent[]): void {
    const hand = this.hand;
    if (!hand) return;
    const anim = this.timings.fast ? 0 : animationMs(events);
    if (hand.result) {
      this.deadline = null;
      this.onHandComplete();
      this.schedule(this.timings.fast ? 0 : anim + this.timings.betweenHandsMs, () => this.startNextHand());
      return;
    }
    const seat = hand.toAct;
    if (seat === null) return;
    const s = this.seats[seat];
    if (!s) {
      this.schedule(0, () => this.applyAction(seat, timeoutAction(hand, seat), 'timeout'));
      return;
    }
    if (s.kind === 'bot') {
      this.deadline = null;
      const think = this.timings.fast ? 0 : botThinkTime(cryptoRng, hand.street, s.difficulty ?? 'normal');
      this.schedule(anim + think, () => this.botAct(seat));
    } else {
      const limit = s.leaving ? 0 : s.connected ? this.timings.humanTimeoutMs : this.timings.disconnectedTimeoutMs;
      this.deadline = Date.now() + anim + limit;
      const handId = hand.handId;
      const count = this.actionCount;
      this.schedule(anim + limit, () => {
        if (this.hand?.handId !== handId || this.actionCount !== count) return;
        if (!s.leaving) s.timeouts += 1;
        this.applyAction(seat, s.leaving ? { type: 'fold' } : timeoutAction(this.hand, seat), 'timeout');
      });
    }
  }

  private botView(seat: number): BotView {
    const hand = this.hand!;
    const p = playerAt(hand, seat)!;
    const live = hand.players.filter((x) => !x.folded);
    // Posición relativa: orden de habla tras el botón (el botón es el último = 1).
    const order: number[] = [];
    for (let i = 1; i <= hand.maxSeats; i += 1) {
      const sIdx = (hand.button + i) % hand.maxSeats;
      if (live.some((x) => x.seat === sIdx)) order.push(sIdx);
    }
    const pos = order.length > 1 ? order.indexOf(seat) / (order.length - 1) : 1;
    const aggressor = this.streetAggressor !== null && this.streetAggressor !== seat ? playerAt(hand, this.streetAggressor) : undefined;
    return {
      hole: p.hole.slice(),
      board: hand.board.slice(),
      street: hand.street as BotView['street'],
      legal: legalActions(hand, seat)!,
      stack: p.stack,
      bigBlind: this.cfg.bigBlind,
      activeOpponents: live.length - 1,
      position: pos,
      facingRaise: hand.currentBet > (hand.street === 'preflop' ? this.cfg.bigBlind : 0) && !!aggressor,
      aggressorStats: aggressor ? this.oppStats.get(aggressor.id) ?? null : null,
    };
  }

  private botAct(seat: number): void {
    const hand = this.hand;
    if (!hand || hand.toAct !== seat) return;
    const s = this.seats[seat];
    let action: PokerAction;
    try {
      const d = decideBotAction(this.botView(seat), s?.profile ?? 'balanced', s?.difficulty ?? 'normal', cryptoRng);
      action = d.action;
    } catch (err) {
      logger.warn('Fallo en la decisión de un bot; acción por defecto', { table: this.cfg.id }, err);
      action = timeoutAction(hand, seat);
    }
    try {
      this.applyAction(seat, action, 'bot');
    } catch (err) {
      // Una decisión ilegal nunca debe bloquear la mesa.
      logger.warn('Acción de bot rechazada; se aplica acción por defecto', { table: this.cfg.id, action }, err);
      this.applyAction(seat, timeoutAction(hand, seat), 'timeout');
    }
  }

  /** Acción de un humano recibida por WebSocket. */
  humanAction(userId: string, handId: string, expectedCount: number, action: PokerAction): void {
    const seat = this.seatOf(userId);
    if (seat === -1) throw new AppError(403, 'NOT_SEATED', 'No estás sentado en esta mesa');
    if (!this.hand || this.hand.handId !== handId || this.hand.result) throw new AppError(409, 'STALE_ACTION', 'La mano ya no está activa');
    if (expectedCount !== this.actionCount) throw new AppError(409, 'STALE_ACTION', 'Acción duplicada o desfasada');
    if (this.hand.toAct !== seat) throw new AppError(409, 'NOT_YOUR_TURN', 'No es tu turno');
    this.seats[seat]!.timeouts = 0;
    this.applyAction(seat, action, 'human');
  }

  private applyAction(seat: number, action: PokerAction, source: 'human' | 'bot' | 'timeout' | 'leave'): void {
    const hand = this.hand!;
    try {
      applyPokerAction(hand, seat, action, cryptoRng);
    } catch (err) {
      if (err instanceof PokerError) {
        if (source === 'human') throw new AppError(400, err.code, err.message);
        throw err;
      }
      throw err;
    }
    this.actionCount += 1;
    const events = hand.events.slice();
    for (const e of events) {
      if (e.type === 'action' && (e.action === 'bet' || e.action === 'raise' || (e.action === 'allin' && e.betTo >= hand.currentBet))) {
        this.streetAggressor = e.seat;
      }
      if (e.type === 'street') this.streetAggressor = null;
    }
    this.handLog.push(...events);
    for (const p of hand.players) {
      const s = this.seats[p.seat];
      if (s && s.id === p.id) s.stack = p.stack;
    }
    this.broadcast(events);
    this.afterEvents(events);
  }

  private onHandComplete(): void {
    const hand = this.hand!;
    const result = hand.result!;
    this.handsPlayed += 1;
    const pot = result.pots.reduce((a, p) => a + p.amount, 0);
    const winnersBySeat = new Map(result.winners.map((w) => [w.seat, w]));

    // Estadísticas de rivales (solo información pública de acciones).
    const preflopVoluntary = new Set<number>();
    let street = 'preflop';
    for (const e of this.handLog) {
      if (e.type === 'street') street = e.street;
      if (e.type === 'action') {
        const p = playerAt(hand, e.seat)!;
        const st = this.oppStats.get(p.id) ?? { hands: 0, vpip: 0, aggressive: 0, passive: 0 };
        if (e.action === 'bet' || e.action === 'raise' || e.action === 'allin') st.aggressive += 1;
        if (e.action === 'call') st.passive += 1;
        this.oppStats.set(p.id, st);
        if (street === 'preflop' && e.action !== 'fold' && e.action !== 'check') preflopVoluntary.add(e.seat);
      }
    }
    for (const p of hand.players) {
      const st = this.oppStats.get(p.id) ?? { hands: 0, vpip: 0, aggressive: 0, passive: 0 };
      st.hands += 1;
      if (preflopVoluntary.has(p.seat)) st.vpip += 1;
      this.oppStats.set(p.id, st);
    }

    try {
      this.db.tx(() => {
        this.db.run(
          `INSERT INTO poker_hands (id, table_id, started_at, ended_at, button, board_json, pot, players_json, winners_json, log_json)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          hand.handId, this.cfg.id, this.handStartedAt, nowIso(), hand.button, JSON.stringify(hand.board), pot,
          JSON.stringify(hand.players.map((p) => ({
            seat: p.seat, id: p.id, name: p.name, isBot: p.isBot, startStack: this.handStartStacks.get(p.seat) ?? null,
            endStack: p.stack, contributed: p.contributed, folded: p.folded,
            // Las cartas privadas solo se guardan si se mostraron en el showdown.
            shown: result.showdown && !p.folded ? p.hole : null,
          }))),
          JSON.stringify(result.winners),
          JSON.stringify(this.handLog),
        );
        for (const p of hand.players) {
          const won = winnersBySeat.get(p.seat)?.amount ?? 0;
          if (p.isBot) {
            this.bots.recordHand(p.id, won - p.contributed);
            continue;
          }
          if (p.contributed <= 0 && won <= 0) continue;
          // Con fichas de sala no hay nada que liquidar en el monedero ni en las estadísticas.
          if (this.roomChips) continue;
          // Ronda "settled" sin movimiento de monedero: las fichas están en la mesa.
          const roundId = randomUUID();
          let category = -1;
          if (result.showdown && !p.folded) category = evaluateHand([...p.hole, ...hand.board]).category;
          const summary = won > p.contributed ? `Ganó ${won} en ${this.cfg.name}` : p.folded ? 'Se retiró' : `Perdió en ${this.cfg.name}`;
          this.db.run(
            `INSERT INTO game_rounds (id, user_id, game, status, bet_total, payout, result_json, created_at, settled_at)
             VALUES (?, ?, 'poker', 'settled', ?, ?, ?, ?, ?)`,
            roundId, p.id, p.contributed, won,
            JSON.stringify({ handId: hand.handId, table: this.cfg.id, board: hand.board, hole: p.hole, summary, handName: winnersBySeat.get(p.seat)?.handName ?? null }),
            this.handStartedAt, nowIso(),
          );
          const { unlocked } = recordOutcome(this.db, {
            userId: p.id, game: 'poker', bet: p.contributed, payout: won, roundId,
            flags: { pokerCategory: won > 0 ? category : -1 },
          });
          if (unlocked.length > 0) this.hub.sendToUser(p.id, { t: 'achievements', achievements: unlocked });
        }
        this.persistHumanStacks();
      });
    } catch (err) {
      logger.error('Error guardando la mano de póker', err, { table: this.cfg.id });
    }

    this.history.unshift({
      handId: hand.handId,
      endedAt: nowIso(),
      board: hand.board.slice(),
      pot,
      winners: result.winners.map((w) => {
        const p = playerAt(hand, w.seat)!;
        return { name: p.name, amount: w.amount, handName: w.handName, isBot: p.isBot };
      }),
    });
    this.history.length = Math.min(this.history.length, 20);
  }

  private persistHumanStacks(): void {
    if (this.roomChips) return;
    for (const s of this.seats) {
      if (s?.kind === 'human') this.db.run('UPDATE poker_seats SET stack = ? WHERE table_id = ? AND user_id = ?', s.stack, this.cfg.id, s.id);
    }
  }

  /* ------------------------------------------------------------------------ */
  /* Administración                                                            */
  /* ------------------------------------------------------------------------ */

  updateConfig(cfg: TableConfig): void {
    const seatsChanged = cfg.maxSeats !== this.cfg.maxSeats;
    this.cfg = cfg;
    if (seatsChanged && !this.hand) {
      // Solo se redimensiona entre manos y sin perder asientos ocupados.
      const occupied = this.seats.filter(Boolean) as SeatState[];
      if (occupied.length <= cfg.maxSeats) {
        this.seats = Array.from({ length: cfg.maxSeats }, (_, i) => occupied[i] ?? null);
        for (const [i, s] of this.seats.entries()) {
          if (s?.kind === 'human') this.db.run('UPDATE poker_seats SET seat = ? WHERE table_id = ? AND user_id = ?', i, cfg.id, s.id);
        }
      }
    }
    this.broadcastSnapshot();
    this.ensureRunning();
  }

  /** Detiene la mesa devolviendo todas las fichas (apagado del servidor). */
  shutdown(): void {
    this.stopped = true;
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    if (this.hand && !this.hand.result) {
      for (const [seat, stack] of this.handStartStacks) {
        const s = this.seats[seat];
        if (s) s.stack = stack;
      }
    }
    for (let i = 0; i < this.seats.length; i += 1) this.removeSeat(i);
    this.hand = null;
  }

  /** Para pruebas: ¿hay un temporizador pendiente? */
  isIdle(): boolean {
    return !this.timer && (!this.hand || !!this.hand.result);
  }
}
