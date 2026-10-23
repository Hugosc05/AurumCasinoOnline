import { randomInt, randomUUID } from 'node:crypto';
import { z } from 'zod';
import {
  BINGO_MAX_CARDS,
  bingoPrizes,
  drawOrder,
  generateBingoCard,
  hasBingo,
  hasLine,
  type BingoCard,
} from '@aurum/engine';
import type { Database } from '../db/database';
import { nowIso } from '../db/database';
import { getSetting } from '../db/seed';
import { AppError } from '../lib/errors';
import { logger } from '../lib/logger';
import { cryptoRng } from '../lib/rng';
import { addToRoundBet, openRound, settleRound, type RoundRow } from '../games/rounds';
import type { RealtimeHub, RtClient } from '../realtime/hub';
import { credit, getBalance } from '../wallet/wallet';

/**
 * Salas de bingo de 90 bolas.
 *
 * - Antes de la partida se compran cartones (hasta 6 por jugador y hasta 20
 *   jugadores por partida). La cuenta atrás empieza con la primera compra.
 * - Al empezar se baraja el orden de las 90 bolas con un CSPRNG; nunca se
 *   envía por adelantado: cada bola se publica al extraerse.
 * - Bote = cartones vendidos × precio (incluidos los cartones de la casa, que
 *   en las salas públicas completan la partida). Línea 20 %, bingo 70 %; si
 *   cantan varios cartones en la misma bola, se reparte a partes iguales. Lo
 *   que gane un cartón de la casa no se paga a nadie: cada cartón de jugador
 *   tiene exactamente las mismas opciones que los demás.
 * - La comprobación de línea y bingo es automática y la hace el servidor.
 * - Cada jugador tiene una ronda del monedero por partida; si el servidor se
 *   cae a mitad, se anula y se devuelven los cartones.
 */

export interface BingoTimings {
  countdownMs: number;
  drawMs: number;
  finishedMs: number;
}

export interface BingoRoomConfig {
  id: string;
  name: string;
  cardPrice: number;
  maxPlayers: number;
  /** Cartones de la casa por partida [mín, máx]; null = sin cartones de la casa. */
  house: [number, number] | null;
  /** Sala privada a la que pertenece (null = pública). */
  roomId: string | null;
  fast: boolean;
}

export const PUBLIC_BINGO_ROOMS: Omit<BingoRoomConfig, 'fast'>[] = [
  { id: 'bingo-sol', name: 'Sala Sol', cardPrice: 10, maxPlayers: 20, house: [14, 30], roomId: null },
  { id: 'bingo-luna', name: 'Sala Luna', cardPrice: 50, maxPlayers: 20, house: [14, 30], roomId: null },
  { id: 'bingo-diamante', name: 'Sala Diamante', cardPrice: 200, maxPlayers: 20, house: [12, 26], roomId: null },
];

const KEY_PREFIX = 'bingo:';

interface Card {
  id: string;
  grid: BingoCard;
  owner: string | null; // null = casa
}

interface Player {
  userId: string;
  name: string;
  round: RoundRow;
  cards: Card[];
  won: number;
}

interface Winner {
  name: string;
  house: boolean;
  cardId: string;
  userId: string | null;
  amount: number;
}

type Phase = 'waiting' | 'countdown' | 'playing' | 'finished';

export class BingoRoom {
  phase: Phase = 'waiting';
  gameNo = 1;
  private gameId = randomUUID();
  private order: number[] = [];
  private drawn: number[] = [];
  private players = new Map<string, Player>();
  private houseCards: Card[] = [];
  private countdownEndsAt = 0;
  private nextDrawAt = 0;
  private lineWinners: Winner[] = [];
  private bingoWinners: Winner[] = [];
  private linePrize = 0;
  private bingoPrize = 0;
  private timer: NodeJS.Timeout | null = null;
  private watchers = new Set<RtClient>();
  private pendingCfg: BingoRoomConfig | null = null;
  lastError: string | null = null;

  constructor(
    public cfg: BingoRoomConfig,
    private readonly db: Database,
    private readonly hub: RealtimeHub,
    private readonly timings: BingoTimings,
    private readonly onChange: () => void,
  ) {}

  /* ------------------------------ Espectadores ------------------------------ */

  watch(c: RtClient): void {
    this.watchers.add(c);
    this.send(c);
  }

  unwatch(c: RtClient): void {
    this.watchers.delete(c);
  }

  hasUser(userId: string): boolean {
    return this.players.has(userId);
  }

  /** Salir de una sala privada: si aún no ha empezado, se devuelven los cartones. */
  leave(userId: string): void {
    const p = this.players.get(userId);
    if (!p || this.phase === 'playing' || this.phase === 'finished') return;
    this.refund(p, 'left');
    this.players.delete(userId);
    if (this.humanCards() === 0) {
      this.clearTimer();
      this.phase = 'waiting';
    }
    this.broadcast();
  }

  /* -------------------------------- Compras -------------------------------- */

  buy(userId: string, username: string, gameNo: number, count: number): void {
    if (this.phase !== 'waiting' && this.phase !== 'countdown') throw new AppError(409, 'GAME_RUNNING', 'La partida ya ha empezado: espera a la siguiente');
    if (gameNo !== this.gameNo) throw new AppError(409, 'STALE_GAME', 'Esa partida ya no está a la venta');
    const p = this.players.get(userId);
    const have = p?.cards.length ?? 0;
    if (have + count > BINGO_MAX_CARDS) throw new AppError(400, 'TOO_MANY_CARDS', `Puedes jugar con hasta ${BINGO_MAX_CARDS} cartones por partida`);
    if (!p && this.players.size >= this.cfg.maxPlayers) throw new AppError(409, 'ROOM_FULL', `La partida está completa (${this.cfg.maxPlayers} jugadores)`);
    const amount = count * this.cfg.cardPrice;
    const cards = Array.from({ length: count }, () => ({ id: randomUUID().slice(0, 8), grid: generateBingoCard(cryptoRng), owner: userId }));
    this.db.tx(() => {
      if (p) {
        addToRoundBet(this.db, p.round, amount);
        p.round = this.db.get<RoundRow>('SELECT * FROM game_rounds WHERE id = ?', p.round.id)!;
        p.cards.push(...cards);
      } else {
        const round = openRound(this.db, userId, 'bingo', amount, `${KEY_PREFIX}${this.gameId}:${userId}`);
        this.players.set(userId, { userId, name: username, round, cards, won: 0 });
      }
    });
    this.hub.sendToUser(userId, { t: 'balance', ...getBalance(this.db, userId) });
    if (this.phase === 'waiting') {
      this.phase = 'countdown';
      this.countdownEndsAt = Date.now() + this.timings.countdownMs;
      this.timer = setTimeout(() => this.start(), this.timings.countdownMs);
    }
    this.broadcast();
  }

  private humanCards(): number {
    let n = 0;
    for (const p of this.players.values()) n += p.cards.length;
    return n;
  }

  private allCards(): Card[] {
    return [...[...this.players.values()].flatMap((p) => p.cards), ...this.houseCards];
  }

  /* -------------------------------- Partida -------------------------------- */

  private start(): void {
    this.clearTimer();
    if (this.humanCards() === 0) {
      this.phase = 'waiting';
      this.broadcast();
      return;
    }
    const [lo, hi] = this.cfg.house ?? [0, 0];
    const house = this.cfg.house ? lo + randomInt(hi - lo + 1) : 0;
    this.houseCards = Array.from({ length: house }, () => ({ id: randomUUID().slice(0, 8), grid: generateBingoCard(cryptoRng), owner: null }));
    const pot = (this.humanCards() + house) * this.cfg.cardPrice;
    const prizes = bingoPrizes(pot);
    this.linePrize = prizes.line;
    this.bingoPrize = prizes.bingo;
    this.order = drawOrder(cryptoRng);
    this.drawn = [];
    this.phase = 'playing';
    this.nextDrawAt = Date.now() + this.timings.drawMs;
    this.broadcast();
    this.onChange();
    this.timer = setTimeout(() => this.draw(), this.timings.drawMs);
  }

  private draw(): void {
    if (this.phase !== 'playing') return;
    try {
      const ball = this.order[this.drawn.length];
      if (ball === undefined) {
        this.finish();
        return;
      }
      this.drawn.push(ball);
      const drawn = new Set(this.drawn);
      const cards = this.allCards();
      if (this.lineWinners.length === 0) {
        const winners = cards.filter((c) => hasLine(c.grid, drawn));
        if (winners.length > 0) this.lineWinners = this.award(winners, this.linePrize);
      }
      const bingo = cards.filter((c) => hasBingo(c.grid, drawn));
      if (bingo.length > 0) {
        this.bingoWinners = this.award(bingo, this.bingoPrize);
        this.finish();
        return;
      }
      this.nextDrawAt = Date.now() + this.timings.drawMs;
      this.broadcast();
      this.timer = setTimeout(() => this.draw(), this.timings.drawMs);
    } catch (err) {
      this.lastError = String(err);
      logger.error('Error en la extracción del bingo', err, { room: this.cfg.id });
      this.abort();
    }
  }

  /** Reparte un premio a partes iguales entre los cartones ganadores (lo de la casa no se paga). */
  private award(cards: Card[], prize: number): Winner[] {
    const share = Math.floor(prize / cards.length);
    return cards.map((c) => {
      const p = c.owner ? this.players.get(c.owner) : undefined;
      if (p) p.won += share;
      return { name: p?.name ?? 'Casa', house: !p, cardId: c.id, userId: p?.userId ?? null, amount: share };
    });
  }

  private finish(): void {
    this.clearTimer();
    this.phase = 'finished';
    for (const p of this.players.values()) {
      try {
        const out = settleRound(this.db, p.round.id, p.won, {
          room: this.cfg.id, gameNo: this.gameNo, cards: p.cards.length, balls: this.drawn.length,
          line: this.lineWinners.filter((w) => w.userId === p.userId).length, bingo: this.bingoWinners.filter((w) => w.userId === p.userId).length,
        });
        this.hub.sendToUser(p.userId, { t: 'balance', ...out.balance });
        if (out.achievements.length > 0) this.hub.sendToUser(p.userId, { t: 'achievements', achievements: out.achievements });
      } catch (err) {
        logger.error('No se pudo liquidar un jugador del bingo', err, { room: this.cfg.id });
      }
    }
    this.broadcast();
    this.onChange();
    this.timer = setTimeout(() => this.reset(), this.timings.finishedMs);
  }

  /** Cambios del anfitrión de una sala privada: se aplican en la siguiente partida. */
  updateConfig(cfg: { name: string; cardPrice: number; maxSeats: number; allowBots: boolean }): void {
    const next: BingoRoomConfig = { ...this.cfg, name: cfg.name, cardPrice: cfg.cardPrice, maxPlayers: cfg.maxSeats, house: cfg.allowBots ? [8, 20] : null };
    if (this.phase === 'waiting') this.cfg = next;
    else this.pendingCfg = next;
    this.broadcast();
  }

  private reset(): void {
    this.clearTimer();
    if (this.pendingCfg) {
      this.cfg = this.pendingCfg;
      this.pendingCfg = null;
    }
    this.gameNo += 1;
    this.gameId = randomUUID();
    this.players.clear();
    this.houseCards = [];
    this.order = [];
    this.drawn = [];
    this.lineWinners = [];
    this.bingoWinners = [];
    this.linePrize = 0;
    this.bingoPrize = 0;
    this.phase = 'waiting';
    this.broadcast();
    this.onChange();
  }

  private refund(p: Player, reason: string): void {
    this.db.tx(() => {
      const upd = this.db.run(`UPDATE game_rounds SET status = 'void', settled_at = ? WHERE id = ? AND status = 'open'`, nowIso(), p.round.id);
      if (upd.changes === 1) credit(this.db, p.userId, p.round.bet_total, 'refund', { roundId: p.round.id, meta: { reason, game: 'bingo' } });
    });
    this.hub.sendToUser(p.userId, { t: 'balance', ...getBalance(this.db, p.userId) });
  }

  /** Anula la partida en curso devolviendo todos los cartones (error o cierre de la sala). */
  abort(): void {
    this.clearTimer();
    for (const p of this.players.values()) {
      try {
        this.refund(p, 'aborted');
      } catch (err) {
        logger.error('No se pudo devolver un cartón de bingo', err);
      }
    }
    this.reset();
  }

  shutdown(): void {
    this.clearTimer();
    if (this.phase !== 'finished') {
      for (const p of this.players.values()) {
        try {
          this.refund(p, 'shutdown');
        } catch {
          /* la base de datos puede estar cerrándose */
        }
      }
    }
    this.players.clear();
    this.watchers.clear();
  }

  private clearTimer(): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
  }

  /* --------------------------------- Vistas --------------------------------- */

  summary() {
    return {
      id: this.cfg.id,
      name: this.cfg.name,
      cardPrice: this.cfg.cardPrice,
      maxSeats: this.cfg.maxPlayers,
      humans: this.players.size,
      bots: this.phase === 'playing' || this.phase === 'finished' ? this.houseCards.length : 0,
      free: Math.max(0, this.cfg.maxPlayers - this.players.size),
      phase: this.phase === 'playing' ? ('playing' as const) : this.phase,
      watchers: this.watchers.size,
      cardsSold: this.humanCards(),
      balls: this.drawn.length,
      house: this.cfg.house !== null,
    };
  }

  snapshot(userId: string | null) {
    const me = userId ? this.players.get(userId) : undefined;
    const pot = (this.humanCards() + (this.phase === 'playing' || this.phase === 'finished' ? this.houseCards.length : 0)) * this.cfg.cardPrice;
    const prizes = this.phase === 'playing' || this.phase === 'finished' ? { line: this.linePrize, bingo: this.bingoPrize } : bingoPrizes(pot);
    return {
      roomId: this.cfg.id,
      name: this.cfg.name,
      privateRoom: this.cfg.roomId,
      cardPrice: this.cfg.cardPrice,
      maxPlayers: this.cfg.maxPlayers,
      maxCards: BINGO_MAX_CARDS,
      house: this.cfg.house !== null,
      phase: this.phase,
      gameNo: this.gameNo,
      countdownEndsAt: this.countdownEndsAt,
      nextDrawAt: this.nextDrawAt,
      drawMs: this.timings.drawMs,
      serverTime: Date.now(),
      // Solo las bolas ya extraídas: el orden restante no sale del servidor.
      drawn: this.drawn,
      players: [...this.players.values()].map((p) => ({ name: p.name, cards: p.cards.length, you: p.userId === userId })),
      houseCards: this.phase === 'playing' || this.phase === 'finished' ? this.houseCards.length : 0,
      cardsTotal: this.humanCards() + (this.phase === 'playing' || this.phase === 'finished' ? this.houseCards.length : 0),
      pot,
      prizes,
      lineWinners: this.lineWinners.map(({ name, house, cardId, amount, userId: u }) => ({ name, house, cardId, amount, you: !!userId && u === userId })),
      bingoWinners: this.bingoWinners.map(({ name, house, cardId, amount, userId: u }) => ({ name, house, cardId, amount, you: !!userId && u === userId })),
      you: me ? { cards: me.cards.map((c) => ({ id: c.id, grid: c.grid })), spent: me.round.bet_total, won: me.won } : null,
    };
  }

  private send(c: RtClient): void {
    this.hub.send(c, { t: 'bingo.state', roomId: this.cfg.id, state: this.snapshot(c.userId) });
  }

  broadcast(): void {
    for (const c of this.watchers) this.send(c);
  }

  isIdle(): boolean {
    return this.phase === 'waiting';
  }
}

/* ---------------------------------- Gestor ---------------------------------- */

const roomIdSchema = z.string().min(1).max(64);
const watchSchema = z.object({ roomId: roomIdSchema });
const buySchema = z.object({ roomId: roomIdSchema, gameNo: z.number().int().min(1), count: z.number().int().min(1).max(BINGO_MAX_CARDS) });

function parseMsg<T extends z.ZodType>(schema: T, msg: unknown): z.infer<T> {
  const r = schema.safeParse(msg);
  if (!r.success) throw new AppError(400, 'BAD_MESSAGE', 'Mensaje no válido');
  return r.data;
}

export class BingoManager {
  readonly rooms = new Map<string, BingoRoom>();
  private lobbyWatchers = new Set<RtClient>();
  private lobbyTimer: NodeJS.Timeout | null = null;
  private access: (roomId: string, userId: string | null) => boolean = () => true;

  constructor(
    private readonly db: Database,
    private readonly hub: RealtimeHub,
    private readonly timings: BingoTimings,
    private readonly fast: boolean,
  ) {}

  setAccess(fn: (tableId: string, userId: string | null) => boolean): void {
    this.access = fn;
  }

  init(): void {
    const open = this.db.all<{ id: string; user_id: string; bet_total: number }>(
      `SELECT id, user_id, bet_total FROM game_rounds WHERE game = 'bingo' AND status = 'open' AND idempotency_key LIKE ?`, `${KEY_PREFIX}%`,
    );
    for (const r of open) {
      this.db.tx(() => {
        const upd = this.db.run(`UPDATE game_rounds SET status = 'void', settled_at = ? WHERE id = ? AND status = 'open'`, nowIso(), r.id);
        if (upd.changes === 1 && r.bet_total > 0) credit(this.db, r.user_id, r.bet_total, 'refund', { roundId: r.id, meta: { reason: 'server_restart', game: 'bingo' } });
      });
    }
    if (open.length > 0) logger.warn('Cartones de bingo reembolsados tras reinicio', { rounds: open.length });
    for (const cfg of PUBLIC_BINGO_ROOMS) this.rooms.set(cfg.id, new BingoRoom({ ...cfg, fast: this.fast }, this.db, this.hub, this.timings, () => this.scheduleLobby()));

    this.hub.on('bingo.lobby', (c) => {
      this.lobbyWatchers.add(c);
      this.hub.send(c, { t: 'bingo.lobby', rooms: this.lobby() });
    });
    this.hub.on('bingo.watch', (c, msg) => {
      const { roomId } = parseMsg(watchSchema, msg);
      const room = this.get(roomId);
      this.assertAccess(room, c.userId);
      for (const r of this.rooms.values()) if (r !== room) r.unwatch(c);
      room.watch(c);
      this.scheduleLobby();
    });
    this.hub.on('bingo.unwatch', (c) => {
      for (const r of this.rooms.values()) r.unwatch(c);
      this.scheduleLobby();
    });
    this.hub.on('bingo.buy', (c, msg) => {
      const m = parseMsg(buySchema, msg);
      if (!c.userId) throw new AppError(401, 'UNAUTHORIZED', 'Debes iniciar sesión');
      if (!getSetting(this.db, 'gamesEnabled').bingo) throw new AppError(503, 'GAME_DISABLED', 'El bingo está temporalmente desactivado');
      const room = this.get(m.roomId);
      this.assertAccess(room, c.userId);
      room.buy(c.userId, c.username ?? 'Jugador', m.gameNo, m.count);
      this.scheduleLobby();
    });
    this.hub.onDisconnect((c) => {
      this.lobbyWatchers.delete(c);
      for (const r of this.rooms.values()) r.unwatch(c);
    });
  }

  private assertAccess(room: BingoRoom, userId: string | null): void {
    if (room.cfg.roomId && !this.access(room.cfg.id, userId)) throw new AppError(403, 'ROOM_FORBIDDEN', 'Esta sala de bingo es privada');
  }

  get(id: string): BingoRoom {
    const r = this.rooms.get(id);
    if (!r) throw new AppError(404, 'ROOM_NOT_FOUND', 'Sala de bingo no encontrada');
    return r;
  }

  lobby() {
    return [...this.rooms.values()].filter((r) => !r.cfg.roomId).map((r) => r.summary());
  }

  private scheduleLobby(): void {
    if (this.lobbyTimer) return;
    this.lobbyTimer = setTimeout(() => {
      this.lobbyTimer = null;
      const rooms = this.lobby();
      for (const c of this.lobbyWatchers) this.hub.send(c, { t: 'bingo.lobby', rooms });
    }, 400);
  }

  /** Mesa de una sala privada (la crea y la cierra el servicio de salas). */
  addRoomTable(cfg: { id: string; name: string; cardPrice: number; maxSeats: number; allowBots: boolean; roomId: string }): BingoRoom {
    const room = new BingoRoom(
      { id: cfg.id, name: cfg.name, cardPrice: cfg.cardPrice, maxPlayers: cfg.maxSeats, house: cfg.allowBots ? [8, 20] : null, roomId: cfg.roomId, fast: this.fast },
      this.db, this.hub, this.timings, () => this.scheduleLobby(),
    );
    this.rooms.set(cfg.id, room);
    return room;
  }

  removeRoomTable(id: string): void {
    const r = this.rooms.get(id);
    if (!r?.cfg.roomId) return;
    r.shutdown();
    this.rooms.delete(id);
  }

  diagnostics() {
    return [...this.rooms.values()].map((r) => ({ ...r.summary(), lastError: r.lastError }));
  }

  shutdown(): void {
    if (this.lobbyTimer) clearTimeout(this.lobbyTimer);
    for (const r of this.rooms.values()) r.shutdown();
  }
}
