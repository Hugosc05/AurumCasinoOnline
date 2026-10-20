import { z } from 'zod';
import type { PokerAction } from '@aurum/engine';
import type { BotPool } from '../bots/pool';
import type { Database } from '../db/database';
import { getSetting } from '../db/seed';
import { AppError } from '../lib/errors';
import { logger } from '../lib/logger';
import { credit } from '../wallet/wallet';
import type { RealtimeHub, RtClient } from '../realtime/hub';
import { PokerTable, type TableConfig, type TableTimings } from './table';

interface TableRow {
  id: string;
  name: string;
  small_blind: number;
  big_blind: number;
  min_buy_in: number;
  max_buy_in: number;
  max_seats: number;
  max_bots: number;
  target_players: number;
  enabled: number;
}

const toConfig = (r: TableRow): TableConfig => ({
  id: r.id,
  name: r.name,
  smallBlind: r.small_blind,
  bigBlind: r.big_blind,
  minBuyIn: r.min_buy_in,
  maxBuyIn: r.max_buy_in,
  maxSeats: r.max_seats,
  maxBots: r.max_bots,
  targetPlayers: r.target_players,
  enabled: r.enabled === 1,
});

const tableId = z.string().min(1).max(64);
const watchSchema = z.object({ tableId });
const sitSchema = z.object({ tableId, buyIn: z.number().int().positive(), seat: z.number().int().min(0).max(8).optional() });
const actSchema = z.object({
  tableId,
  handId: z.string().uuid(),
  actionCount: z.number().int().min(0),
  action: z.enum(['fold', 'check', 'call', 'bet', 'raise', 'allin']),
  amount: z.number().int().positive().optional(),
});

function parseMsg<T extends z.ZodType>(schema: T, msg: unknown): z.infer<T> {
  const r = schema.safeParse(msg);
  if (!r.success) throw new AppError(400, 'BAD_MESSAGE', 'Mensaje no válido');
  return r.data;
}

export class PokerManager {
  readonly tables = new Map<string, PokerTable>();
  private lobbyTimer: NodeJS.Timeout | null = null;
  /** Permiso para mesas de salas privadas (lo decide el servicio de salas, en el servidor). */
  private access: (tableId: string, userId: string | null) => boolean = () => true;

  setAccess(fn: (tableId: string, userId: string | null) => boolean): void {
    this.access = fn;
  }

  private assertAccess(tableId: string, userId: string | null): void {
    const t = this.tables.get(tableId);
    if (t?.cfg.roomId && !this.access(tableId, userId)) throw new AppError(403, 'ROOM_FORBIDDEN', 'Esta mesa es de una sala privada a la que no perteneces');
  }

  constructor(
    private readonly db: Database,
    private readonly hub: RealtimeHub,
    private readonly timings: TableTimings,
    readonly botPool: BotPool,
  ) {}

  /** Arranque: reembolsa fichas de sesiones anteriores (reinicio/caída) y carga las mesas. */
  init(): void {
    const orphans = this.db.all<{ table_id: string; user_id: string; stack: number }>('SELECT table_id, user_id, stack FROM poker_seats');
    for (const o of orphans) {
      this.db.tx(() => {
        if (o.stack > 0) credit(this.db, o.user_id, o.stack, 'refund', { meta: { table: o.table_id, reason: 'server_restart' } });
        this.db.run('DELETE FROM poker_seats WHERE table_id = ? AND user_id = ?', o.table_id, o.user_id);
      });
    }
    if (orphans.length > 0) logger.warn('Fichas de póker reembolsadas tras reinicio', { seats: orphans.length });
    this.reloadTables();

    this.hub.on('poker.watch', (c, msg) => this.watch(c, parseMsg(watchSchema, msg).tableId));
    this.hub.on('poker.unwatch', (c) => this.unwatchAll(c));
    this.hub.on('poker.sync', (c, msg) => this.watch(c, parseMsg(watchSchema, msg).tableId));
    this.hub.on('poker.sit', (c, msg) => {
      const m = parseMsg(sitSchema, msg);
      this.requireUser(c);
      this.assertPokerEnabled();
      for (const t of this.tables.values()) {
        if (t.cfg.id !== m.tableId && t.hasUser(c.userId!)) throw new AppError(409, 'ALREADY_SEATED', `Ya estás sentado en ${t.cfg.name}`);
      }
      this.assertAccess(m.tableId, c.userId);
      const table = this.get(m.tableId);
      table.sit(c.userId!, c.username!, m.buyIn, m.seat);
      if (c.watching !== table.cfg.id) this.watch(c, table.cfg.id);
      this.scheduleLobby();
    });
    this.hub.on('poker.leave', (c, msg) => {
      const m = parseMsg(watchSchema, msg);
      this.requireUser(c);
      this.get(m.tableId).leave(c.userId!);
      this.scheduleLobby();
    });
    this.hub.on('poker.act', (c, msg) => {
      const m = parseMsg(actSchema, msg);
      this.requireUser(c);
      const action: PokerAction = m.amount !== undefined ? { type: m.action, amount: m.amount } : { type: m.action };
      this.get(m.tableId).humanAction(c.userId!, m.handId, m.actionCount, action);
    });
    this.hub.on('lobby.subscribe', (c) => this.hub.send(c, { t: 'lobby', tables: this.lobby(), online: this.hub.onlineCount() }));
    this.hub.onDisconnect((c) => {
      this.unwatchAll(c);
      if (c.userId && !this.hub.isUserConnected(c.userId)) {
        for (const t of this.tables.values()) t.setConnected(c.userId, false);
      }
    });
  }

  private requireUser(c: RtClient): void {
    if (!c.userId) throw new AppError(401, 'UNAUTHORIZED', 'Debes iniciar sesión');
  }

  private assertPokerEnabled(): void {
    if (!getSetting(this.db, 'gamesEnabled').poker) throw new AppError(503, 'GAME_DISABLED', 'El póker está temporalmente desactivado');
  }

  reloadTables(): void {
    const rows = this.db.all<TableRow>('SELECT * FROM poker_tables ORDER BY sort_order, name');
    for (const row of rows) {
      const cfg = toConfig(row);
      const existing = this.tables.get(cfg.id);
      if (existing) existing.updateConfig(cfg);
      else this.tables.set(cfg.id, new PokerTable(cfg, this.db, this.hub, this.botPool, this.timings));
    }
    this.scheduleLobby();
  }

  get(id: string): PokerTable {
    const t = this.tables.get(id);
    if (!t) throw new AppError(404, 'TABLE_NOT_FOUND', 'Mesa no encontrada');
    return t;
  }

  watch(c: RtClient, id: string): void {
    const table = this.get(id);
    this.assertAccess(id, c.userId);
    if (c.watching && c.watching !== id) this.tables.get(c.watching)?.unwatch(c);
    if (c.userId) table.setConnected(c.userId, true);
    table.watch(c);
    this.scheduleLobby();
  }

  unwatchAll(c: RtClient): void {
    for (const t of this.tables.values()) t.unwatch(c);
    this.scheduleLobby();
  }

  lobby() {
    // Las mesas de salas privadas nunca aparecen en el salón público.
    return [...this.tables.values()].filter((t) => t.cfg.enabled && !t.cfg.roomId).map((t) => t.summary());
  }

  private scheduleLobby(): void {
    if (this.lobbyTimer) return;
    this.lobbyTimer = setTimeout(() => {
      this.lobbyTimer = null;
      this.hub.broadcast({ t: 'lobby', tables: this.lobby(), online: this.hub.onlineCount() });
    }, 400);
  }

  /** Mesa de una sala privada (no se guarda en poker_tables: vive mientras la sala esté abierta). */
  addRoomTable(cfg: TableConfig): PokerTable {
    const t = new PokerTable(cfg, this.db, this.hub, this.botPool, this.timings);
    this.tables.set(cfg.id, t);
    return t;
  }

  /** Cierre controlado: devuelve las fichas (monedero) y elimina la mesa. */
  removeRoomTable(id: string): void {
    const t = this.tables.get(id);
    if (!t?.cfg.roomId) return;
    t.shutdown();
    this.tables.delete(id);
  }

  diagnostics() {
    return [...this.tables.values()].map((t) => ({
      ...t.summary(),
      lastError: t.lastError,
      idle: t.isIdle(),
      seats: t.seats.map((s) => (s ? { kind: s.kind, name: s.name, stack: s.stack, connected: s.connected, leaving: s.leaving } : null)),
    }));
  }

  shutdown(): void {
    if (this.lobbyTimer) clearTimeout(this.lobbyTimer);
    for (const t of this.tables.values()) t.shutdown();
  }
}
