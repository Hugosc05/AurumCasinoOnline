import { z } from 'zod';
import type { BjAction } from '@aurum/engine';
import type { Database } from '../db/database';
import { nowIso } from '../db/database';
import { getSetting } from '../db/seed';
import { AppError } from '../lib/errors';
import { logger } from '../lib/logger';
import { credit } from '../wallet/wallet';
import type { BotPool } from '../bots/pool';
import type { RealtimeHub, RtClient } from '../realtime/hub';
import { BJ_TABLE_KEY_PREFIX, BlackjackTable, type BjTableConfig, type BjTimings } from './table';

interface TableRow {
  id: string;
  name: string;
  min_bet: number;
  max_bet: number;
  max_seats: number;
  max_bots: number;
  target_players: number;
  enabled: number;
}

const toConfig = (r: TableRow): BjTableConfig => ({
  id: r.id,
  name: r.name,
  minBet: r.min_bet,
  maxBet: r.max_bet,
  maxSeats: r.max_seats,
  maxBots: r.max_bots,
  targetPlayers: r.target_players,
  enabled: r.enabled === 1,
});

const tableId = z.string().min(1).max(64);
const watchSchema = z.object({ tableId });
const sitSchema = z.object({ tableId, seat: z.number().int().min(0).max(6).optional() });
const betSchema = z.object({ tableId, roundNo: z.number().int().min(1), amount: z.number().int().positive() });
const actSchema = z.object({
  tableId,
  roundNo: z.number().int().min(1),
  actionCount: z.number().int().min(0),
  action: z.enum(['hit', 'stand', 'double', 'split']),
});

function parseMsg<T extends z.ZodType>(schema: T, msg: unknown): z.infer<T> {
  const r = schema.safeParse(msg);
  if (!r.success) throw new AppError(400, 'BAD_MESSAGE', 'Mensaje no válido');
  return r.data;
}

/** Gestor de las mesas de blackjack multijugador (mensajes `bj.*` del WebSocket). */
export class BlackjackManager {
  readonly tables = new Map<string, BlackjackTable>();
  private lobbyTimer: NodeJS.Timeout | null = null;
  private lobbyWatchers = new Set<RtClient>();

  constructor(
    private readonly db: Database,
    private readonly hub: RealtimeHub,
    private readonly timings: BjTimings,
    private readonly botPool: BotPool,
  ) {}

  /** Arranque: anula y reembolsa las rondas que quedaron abiertas (reinicio o caída). */
  init(): void {
    const open = this.db.all<{ id: string; user_id: string; bet_total: number }>(
      `SELECT id, user_id, bet_total FROM game_rounds WHERE game = 'blackjack' AND status = 'open' AND idempotency_key LIKE ?`,
      `${BJ_TABLE_KEY_PREFIX}%`,
    );
    for (const r of open) {
      this.db.tx(() => {
        const upd = this.db.run(`UPDATE game_rounds SET status = 'void', settled_at = ? WHERE id = ? AND status = 'open'`, nowIso(), r.id);
        if (upd.changes === 1 && r.bet_total > 0) credit(this.db, r.user_id, r.bet_total, 'refund', { roundId: r.id, meta: { reason: 'server_restart' } });
      });
    }
    if (open.length > 0) logger.warn('Apuestas de blackjack reembolsadas tras reinicio', { rounds: open.length });
    this.reloadTables();

    this.hub.on('bj.watch', (c, msg) => this.watch(c, parseMsg(watchSchema, msg).tableId));
    this.hub.on('bj.unwatch', (c) => this.unwatchAll(c));
    this.hub.on('bj.sit', (c, msg) => {
      const m = parseMsg(sitSchema, msg);
      this.requireUser(c);
      this.assertEnabled();
      for (const t of this.tables.values()) {
        if (t.cfg.id !== m.tableId && t.hasUser(c.userId!)) throw new AppError(409, 'ALREADY_SEATED', `Ya estás sentado en ${t.cfg.name}`);
      }
      const table = this.get(m.tableId);
      table.sit(c.userId!, c.username!, m.seat);
      if (c.bjWatching !== table.cfg.id) this.watch(c, table.cfg.id);
      this.scheduleLobby();
    });
    this.hub.on('bj.leave', (c, msg) => {
      const m = parseMsg(watchSchema, msg);
      this.requireUser(c);
      this.get(m.tableId).leave(c.userId!);
      this.scheduleLobby();
    });
    this.hub.on('bj.bet', (c, msg) => {
      const m = parseMsg(betSchema, msg);
      this.requireUser(c);
      this.assertEnabled();
      this.get(m.tableId).placeBet(c.userId!, m.roundNo, m.amount);
    });
    this.hub.on('bj.act', (c, msg) => {
      const m = parseMsg(actSchema, msg);
      this.requireUser(c);
      this.get(m.tableId).humanAction(c.userId!, m.roundNo, m.actionCount, m.action as BjAction);
    });
    this.hub.on('bj.lobby', (c) => {
      this.lobbyWatchers.add(c);
      this.hub.send(c, { t: 'bj.lobby', tables: this.lobby() });
    });
    this.hub.onDisconnect((c) => {
      this.lobbyWatchers.delete(c);
      this.unwatchAll(c);
      if (c.userId && !this.hub.isUserConnected(c.userId)) {
        for (const t of this.tables.values()) t.setConnected(c.userId, false);
      }
    });
  }

  private requireUser(c: RtClient): void {
    if (!c.userId) throw new AppError(401, 'UNAUTHORIZED', 'Debes iniciar sesión');
  }

  private assertEnabled(): void {
    if (!getSetting(this.db, 'gamesEnabled').blackjack) throw new AppError(503, 'GAME_DISABLED', 'El blackjack está temporalmente desactivado');
  }

  reloadTables(): void {
    const rows = this.db.all<TableRow>('SELECT * FROM blackjack_tables ORDER BY sort_order, name');
    for (const row of rows) {
      const cfg = toConfig(row);
      const existing = this.tables.get(cfg.id);
      if (existing) existing.updateConfig(cfg);
      else this.tables.set(cfg.id, new BlackjackTable(cfg, this.db, this.hub, this.botPool, this.timings));
    }
    this.scheduleLobby();
  }

  get(id: string): BlackjackTable {
    const t = this.tables.get(id);
    if (!t) throw new AppError(404, 'TABLE_NOT_FOUND', 'Mesa no encontrada');
    return t;
  }

  /** Mesa en la que está sentado un usuario (para presencia). */
  seatedTable(userId: string): BlackjackTable | null {
    for (const t of this.tables.values()) if (t.hasUser(userId)) return t;
    return null;
  }

  watch(c: RtClient, id: string): void {
    const table = this.get(id);
    if (c.bjWatching && c.bjWatching !== id) this.tables.get(c.bjWatching)?.unwatch(c);
    if (c.userId) table.setConnected(c.userId, true);
    table.watch(c);
    this.scheduleLobby();
  }

  unwatchAll(c: RtClient): void {
    for (const t of this.tables.values()) t.unwatch(c);
    this.scheduleLobby();
  }

  lobby() {
    return [...this.tables.values()].filter((t) => t.cfg.enabled).map((t) => t.summary());
  }

  private scheduleLobby(): void {
    if (this.lobbyTimer) return;
    this.lobbyTimer = setTimeout(() => {
      this.lobbyTimer = null;
      const tables = this.lobby();
      for (const c of this.lobbyWatchers) this.hub.send(c, { t: 'bj.lobby', tables });
    }, 400);
  }

  diagnostics() {
    return [...this.tables.values()].map((t) => ({ ...t.summary(), lastError: t.lastError, idle: t.isIdle() }));
  }

  shutdown(): void {
    if (this.lobbyTimer) clearTimeout(this.lobbyTimer);
    for (const t of this.tables.values()) t.shutdown();
  }
}
