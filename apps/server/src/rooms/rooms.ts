import { randomInt, randomUUID } from 'node:crypto';
import type { Database } from '../db/database';
import { nowIso } from '../db/database';
import { readPrefs } from '../auth/users';
import { AppError, conflict, forbidden, notFound } from '../lib/errors';
import { logger } from '../lib/logger';
import type { BlackjackManager } from '../blackjack/manager';
import type { PokerManager } from '../poker/manager';
import type { RealtimeHub } from '../realtime/hub';
import type { SocialService } from '../social/social';
import type { BingoManager } from '../bingo/bingo';

/** Alfabeto Crockford base32 (sin I, L, O ni U para evitar confusiones). */
const ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
export const CODE_LENGTH = 8; // 32^8 ≈ 1,1 billones de combinaciones
export const CODE_TTL_MS = 24 * 3600_000;
/** Tiempo sin anfitrión conectado antes de transferir la sala. */
export const HOST_GRACE_MS = 90_000;
/** Tiempo sin nadie conectado antes del cierre automático. */
export const IDLE_CLOSE_MS = 15 * 60_000;
export const MAX_OPEN_ROOMS_PER_HOST = 3;

export function generateCode(): string {
  let s = '';
  for (let i = 0; i < CODE_LENGTH; i += 1) s += ALPHABET[randomInt(ALPHABET.length)];
  return s;
}

/** Normaliza lo que escribe el usuario (minúsculas, guiones, espacios, O→0, I/L→1). */
export function normalizeCode(input: string): string | null {
  const c = input.toUpperCase().replace(/[\s-]/g, '').replace(/O/g, '0').replace(/[IL]/g, '1');
  return new RegExp(`^[${ALPHABET}]{${CODE_LENGTH}}$`).test(c) ? c : null;
}

export const formatCode = (c: string): string => `${c.slice(0, 4)}-${c.slice(4)}`;

export interface PokerRoomSettings {
  smallBlind: number;
  bigBlind: number;
  minBuyIn: number;
  maxBuyIn: number;
  /** Fichas iniciales de sala (solo con chipMode = 'room'). */
  startingChips: number;
}
export interface BlackjackRoomSettings {
  minBet: number;
  maxBet: number;
}
export interface BingoRoomSettings {
  cardPrice: number;
}

export interface CreateRoomInput {
  name: string;
  game: 'poker' | 'blackjack' | 'bingo';
  maxSeats: number;
  privacy: 'code' | 'friends';
  allowBots: boolean;
  chipMode: 'wallet' | 'room';
  poker?: Partial<PokerRoomSettings>;
  blackjack?: Partial<BlackjackRoomSettings>;
  bingo?: Partial<BingoRoomSettings>;
}

interface RoomRow {
  id: string;
  code: string;
  code_expires_at: string;
  name: string;
  game: 'poker' | 'blackjack' | 'bingo';
  host_id: string;
  privacy: 'code' | 'friends';
  max_seats: number;
  allow_bots: number;
  chip_mode: 'wallet' | 'room';
  settings_json: string;
  status: 'open' | 'closed';
  created_at: string;
  closed_at: string | null;
  close_reason: string | null;
}

const tableIdOf = (roomId: string): string => `room-${roomId}`;

/**
 * Salas privadas de póker y blackjack.
 *
 * - El código de invitación es aleatorio (CSPRNG) y solo da acceso a esa
 *   sala; nunca concede privilegios. Caduca y el anfitrión puede renovarlo.
 * - La pertenencia se comprueba en el servidor para mirar la mesa,
 *   sentarse, invitar o cambiar ajustes.
 * - Cada sala usa el mismo motor que las mesas públicas: las reglas no se
 *   pueden alterar y los cambios de límites se aplican a partir de la
 *   siguiente mano o ronda.
 * - Si el anfitrión desaparece, la sala pasa al miembro conectado más
 *   antiguo; si no queda nadie, se cierra de forma controlada devolviendo
 *   las fichas.
 */
export class RoomService {
  private lastSeen = new Map<string, number>();
  private sweepTimer: NodeJS.Timeout | null = null;

  constructor(
    private readonly db: Database,
    private readonly hub: RealtimeHub,
    private readonly poker: PokerManager,
    private readonly blackjack: BlackjackManager,
    private readonly social: SocialService,
    private readonly bingo: BingoManager,
    private readonly clock: () => number = Date.now,
  ) {
    const access = (tableId: string, userId: string | null): boolean => {
      if (!userId || !tableId.startsWith('room-')) return false;
      return this.isMember(tableId.slice(5), userId);
    };
    poker.setAccess(access);
    blackjack.setAccess(access);
    bingo.setAccess(access);
  }

  /** Arranque: recrea las mesas de las salas abiertas (vacías: las fichas se devolvieron al reiniciar). */
  init(): void {
    const rows = this.db.all<RoomRow>(`SELECT * FROM rooms WHERE status = 'open'`);
    for (const r of rows) this.createTable(r);
    const now = this.clock();
    for (const r of rows) for (const m of this.memberIds(r.id)) this.lastSeen.set(m, now);
    this.sweepTimer = setInterval(() => this.sweep(), 20_000);
    this.sweepTimer.unref();
    // El indicador de conexión de la sala refleja la conexión real del miembro.
    const touch = (userId: string | null): void => {
      if (!userId) return;
      const rooms = this.db.all<{ room_id: string }>(
        `SELECT m.room_id FROM room_members m JOIN rooms r ON r.id = m.room_id WHERE m.user_id = ? AND r.status = 'open'`, userId);
      for (const r of rooms) this.broadcastRoom(r.room_id);
    };
    this.hub.onConnect((c) => touch(c.userId));
    this.hub.onDisconnect((c) => { if (c.userId && !this.hub.isUserConnected(c.userId)) touch(c.userId); });
    this.hub.onLocal('seat', (userId) => touch(userId));
  }

  shutdown(): void {
    if (this.sweepTimer) clearInterval(this.sweepTimer);
  }

  /* -------------------------------- Mesas -------------------------------- */

  private settings(r: RoomRow): PokerRoomSettings | BlackjackRoomSettings | BingoRoomSettings {
    return JSON.parse(r.settings_json) as PokerRoomSettings | BlackjackRoomSettings | BingoRoomSettings;
  }

  private tableConfig(r: RoomRow) {
    const bots = r.allow_bots === 1;
    if (r.game === 'bingo') {
      const st = this.settings(r) as BingoRoomSettings;
      return { id: tableIdOf(r.id), name: r.name, cardPrice: st.cardPrice, maxSeats: r.max_seats, allowBots: bots, roomId: r.id };
    }
    if (r.game === 'poker') {
      const st = this.settings(r) as PokerRoomSettings;
      const room = r.chip_mode === 'room';
      return {
        id: tableIdOf(r.id), name: r.name, smallBlind: st.smallBlind, bigBlind: st.bigBlind,
        minBuyIn: room ? st.startingChips : st.minBuyIn, maxBuyIn: room ? st.startingChips : st.maxBuyIn,
        maxSeats: r.max_seats, maxBots: bots ? r.max_seats - 1 : 0, targetPlayers: bots ? Math.min(4, r.max_seats) : 0,
        enabled: r.status === 'open', roomId: r.id, chipMode: r.chip_mode,
      };
    }
    const st = this.settings(r) as BlackjackRoomSettings;
    return {
      id: tableIdOf(r.id), name: r.name, minBet: st.minBet, maxBet: st.maxBet, maxSeats: r.max_seats,
      maxBots: bots ? r.max_seats - 1 : 0, targetPlayers: bots ? Math.min(3, r.max_seats) : 0, enabled: r.status === 'open', roomId: r.id,
    };
  }

  private createTable(r: RoomRow): void {
    const cfg = this.tableConfig(r);
    if (r.game === 'bingo') this.bingo.addRoomTable(cfg as Parameters<BingoManager['addRoomTable']>[0]);
    else if (r.game === 'poker') this.poker.addRoomTable(cfg as Parameters<PokerManager['addRoomTable']>[0]);
    else this.blackjack.addRoomTable(cfg as Parameters<BlackjackManager['addRoomTable']>[0]);
  }

  private table(r: RoomRow) {
    const id = tableIdOf(r.id);
    if (r.game === 'bingo') return this.bingo.rooms.get(id) ?? null;
    return r.game === 'poker' ? this.poker.tables.get(id) ?? null : this.blackjack.tables.get(id) ?? null;
  }

  /* ----------------------------- Consultas ------------------------------ */

  private row(id: string): RoomRow {
    const r = this.db.get<RoomRow>('SELECT * FROM rooms WHERE id = ?', id);
    if (!r) throw notFound('Sala no encontrada');
    return r;
  }

  isMember(roomId: string, userId: string): boolean {
    return !!this.db.get(`SELECT 1 AS x FROM room_members m JOIN rooms r ON r.id = m.room_id WHERE m.room_id = ? AND m.user_id = ? AND r.status = 'open'`, roomId, userId);
  }

  private memberIds(roomId: string): string[] {
    return this.db.all<{ user_id: string }>('SELECT user_id FROM room_members WHERE room_id = ? ORDER BY joined_at', roomId).map((m) => m.user_id);
  }

  private requireMember(roomId: string, userId: string): RoomRow {
    const r = this.row(roomId);
    if (!this.db.get('SELECT 1 AS x FROM room_members WHERE room_id = ? AND user_id = ?', roomId, userId)) throw forbidden('No perteneces a esta sala');
    return r;
  }

  private requireHost(roomId: string, userId: string): RoomRow {
    const r = this.requireMember(roomId, userId);
    if (r.host_id !== userId) throw forbidden('Solo el anfitrión puede hacerlo');
    if (r.status !== 'open') throw new AppError(410, 'ROOM_CLOSED', 'La sala está cerrada');
    return r;
  }

  view(roomId: string, userId: string) {
    const r = this.requireMember(roomId, userId);
    const t = this.table(r);
    const seatedIds = new Set<string>(
      t && 'seats' in t ? t.seats.filter((s) => s?.kind === 'human').map((s) => s!.id) : [],
    );
    if (t && !('seats' in t)) for (const m of this.memberIds(r.id)) if (t.hasUser(m)) seatedIds.add(m);
    const members = this.db
      .all<{ id: string; username: string; joined_at: string; prefs_json: string }>(
        'SELECT u.id, u.username, m.joined_at, u.prefs_json FROM room_members m JOIN users u ON u.id = m.user_id WHERE m.room_id = ? ORDER BY m.joined_at',
        r.id,
      )
      .map((m) => {
        const seated = seatedIds.has(m.id);
        // El indicador de conexión respeta el modo invisible salvo para quien está sentado (eso ya lo ve la mesa).
        const connected = this.hub.isUserConnected(m.id) && (seated || !readPrefs(m.prefs_json).invisible || m.id === userId);
        return { id: m.id, username: m.username, isHost: m.id === r.host_id, isYou: m.id === userId, connected, seated, joinedAt: m.joined_at };
      });
    const summary = t?.summary() ?? null;
    return {
      id: r.id,
      name: r.name,
      game: r.game,
      status: r.status,
      closeReason: r.close_reason,
      privacy: r.privacy,
      maxSeats: r.max_seats,
      allowBots: r.allow_bots === 1,
      chipMode: r.chip_mode,
      settings: this.settings(r),
      host: members.find((m) => m.isHost) ?? null,
      isHost: r.host_id === userId,
      // El código solo lo ven los miembros (para invitar a otros).
      code: r.status === 'open' ? formatCode(r.code) : null,
      codeExpiresAt: r.code_expires_at,
      codeExpired: Date.parse(r.code_expires_at) < this.clock(),
      tableId: tableIdOf(r.id),
      members,
      table: summary ? { humans: summary.humans, bots: summary.bots, free: summary.free, maxSeats: summary.maxSeats, inProgress: 'handInProgress' in summary ? summary.handInProgress : summary.phase === 'playing' } : null,
      createdAt: r.created_at,
    };
  }

  mine(userId: string) {
    return this.db
      .all<RoomRow & { members: number }>(
        `SELECT r.*, (SELECT COUNT(*) FROM room_members x WHERE x.room_id = r.id) AS members
         FROM rooms r JOIN room_members m ON m.room_id = r.id WHERE m.user_id = ? AND r.status = 'open' ORDER BY r.created_at DESC`,
        userId,
      )
      .map((r) => ({ id: r.id, name: r.name, game: r.game, isHost: r.host_id === userId, members: r.members, maxSeats: r.max_seats, allowBots: r.allow_bots === 1 }));
  }

  /* ------------------------------ Acciones ------------------------------ */

  create(userId: string, input: CreateRoomInput) {
    const open = this.db.get<{ n: number }>(`SELECT COUNT(*) AS n FROM rooms WHERE host_id = ? AND status = 'open'`, userId)!.n;
    if (open >= MAX_OPEN_ROOMS_PER_HOST) throw new AppError(400, 'TOO_MANY_ROOMS', `Puedes tener hasta ${MAX_OPEN_ROOMS_PER_HOST} salas abiertas`);
    let settings: PokerRoomSettings | BlackjackRoomSettings | BingoRoomSettings;
    if (input.game === 'bingo') {
      if (input.chipMode === 'room') throw new AppError(400, 'UNSUPPORTED', 'El bingo privado se juega con tu saldo virtual');
      const cardPrice = input.bingo?.cardPrice ?? 10;
      if (cardPrice < 1 || cardPrice > 10_000) throw new AppError(400, 'INVALID_PRICE', 'Precio del cartón no válido');
      settings = { cardPrice };
    } else if (input.game === 'poker') {
      const p = input.poker ?? {};
      const bb = p.bigBlind ?? 20;
      const sb = p.smallBlind ?? Math.max(1, Math.floor(bb / 2));
      if (sb > bb) throw new AppError(400, 'INVALID_BLINDS', 'La ciega pequeña no puede superar a la grande');
      const minBuyIn = p.minBuyIn ?? bb * 20;
      const maxBuyIn = p.maxBuyIn ?? bb * 200;
      if (minBuyIn < bb * 10 || maxBuyIn < minBuyIn) throw new AppError(400, 'INVALID_BUYIN', 'Entrada mínima ≥ 10 ciegas grandes y máxima ≥ mínima');
      const startingChips = p.startingChips ?? bb * 100;
      if (input.chipMode === 'room' && startingChips < bb * 10) throw new AppError(400, 'INVALID_CHIPS', 'Las fichas iniciales deben ser al menos 10 ciegas grandes');
      settings = { smallBlind: sb, bigBlind: bb, minBuyIn, maxBuyIn, startingChips };
    } else {
      if (input.chipMode === 'room') throw new AppError(400, 'UNSUPPORTED', 'El blackjack privado se juega con tu saldo virtual');
      const b = input.blackjack ?? {};
      const minBet = b.minBet ?? 10;
      const maxBet = b.maxBet ?? 1000;
      if (maxBet < minBet) throw new AppError(400, 'INVALID_LIMITS', 'La apuesta máxima debe ser mayor o igual que la mínima');
      settings = { minBet, maxBet };
    }
    const id = randomUUID();
    const now = nowIso();
    const expires = new Date(this.clock() + CODE_TTL_MS).toISOString();
    for (let attempt = 0; ; attempt += 1) {
      try {
        this.db.tx(() => {
          this.db.run(
            `INSERT INTO rooms (id, code, code_expires_at, name, game, host_id, privacy, max_seats, allow_bots, chip_mode, settings_json, status, created_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'open', ?)`,
            id, generateCode(), expires, input.name, input.game, userId, input.privacy, input.maxSeats, input.allowBots ? 1 : 0, input.chipMode,
            JSON.stringify(settings), now,
          );
          this.db.run('INSERT INTO room_members (room_id, user_id, joined_at) VALUES (?, ?, ?)', id, userId, now);
        });
        break;
      } catch (err) {
        // Colisión de código (improbabilísima): se genera otro.
        if (String(err).includes('UNIQUE') && attempt < 5) continue;
        throw err;
      }
    }
    this.createTable(this.row(id));
    this.lastSeen.set(userId, this.clock());
    logger.info('Sala privada creada', { room: id, game: input.game });
    return this.view(id, userId);
  }

  private admit(r: RoomRow, userId: string): void {
    if (this.db.get('SELECT 1 AS x FROM room_members WHERE room_id = ? AND user_id = ?', r.id, userId)) return;
    const n = this.memberIds(r.id).length;
    if (n >= r.max_seats) throw conflict('ROOM_FULL', 'La sala está completa');
    this.db.run('INSERT INTO room_members (room_id, user_id, joined_at) VALUES (?, ?, ?)', r.id, userId, nowIso());
    this.db.run('DELETE FROM room_invites WHERE room_id = ? AND user_id = ?', r.id, userId);
    this.lastSeen.set(userId, this.clock());
    this.broadcastRoom(r.id);
  }

  /** Entrar con código. Los errores no revelan si una sala existe salvo con el código correcto. */
  joinByCode(userId: string, rawCode: string) {
    const code = normalizeCode(rawCode);
    if (!code) throw notFound('Código no válido');
    const r = this.db.get<RoomRow>('SELECT * FROM rooms WHERE code = ?', code);
    if (!r) throw notFound('Código no válido');
    if (r.status !== 'open') throw new AppError(410, 'ROOM_CLOSED', 'Esa sala ya está cerrada');
    const member = this.db.get('SELECT 1 AS x FROM room_members WHERE room_id = ? AND user_id = ?', r.id, userId);
    if (!member) {
      if (Date.parse(r.code_expires_at) < this.clock()) throw new AppError(410, 'CODE_EXPIRED', 'El código ha caducado. Pide uno nuevo al anfitrión.');
      if (r.privacy === 'friends' && !this.social.areFriends(userId, r.host_id) && !this.hasInvite(r.id, userId)) {
        throw forbidden('Esta sala es solo para amigos del anfitrión');
      }
      this.db.tx(() => this.admit(r, userId));
    }
    return this.view(r.id, userId);
  }

  private hasInvite(roomId: string, userId: string): boolean {
    return !!this.db.get('SELECT 1 AS x FROM room_invites WHERE room_id = ? AND user_id = ?', roomId, userId);
  }

  /** Entrar desde una invitación nominal (sin escribir el código). */
  joinByInvite(userId: string, roomId: string) {
    const r = this.row(roomId);
    if (r.status !== 'open') throw new AppError(410, 'ROOM_CLOSED', 'Esa sala ya está cerrada');
    if (!this.hasInvite(roomId, userId) && !this.db.get('SELECT 1 AS x FROM room_members WHERE room_id = ? AND user_id = ?', roomId, userId)) {
      throw forbidden('No tienes invitación para esta sala');
    }
    this.db.tx(() => this.admit(r, userId));
    return this.view(roomId, userId);
  }

  /** Invitar a un amigo: solo miembros, y solo a personas que son sus amigos. */
  invite(userId: string, roomId: string, username: string) {
    const r = this.requireMember(roomId, userId);
    if (r.status !== 'open') throw new AppError(410, 'ROOM_CLOSED', 'La sala está cerrada');
    const target = this.db.get<{ id: string; username: string }>('SELECT id, username FROM users WHERE lower(username) = lower(?)', username.trim());
    if (!target || !this.social.areFriends(userId, target.id)) throw forbidden('Solo puedes invitar a tus amigos');
    if (this.db.get('SELECT 1 AS x FROM room_members WHERE room_id = ? AND user_id = ?', roomId, target.id)) throw conflict('ALREADY_MEMBER', 'Ya está en la sala');
    this.db.run('INSERT INTO room_invites (room_id, user_id, invited_by, created_at) VALUES (?, ?, ?, ?) ON CONFLICT DO NOTHING', roomId, target.id, userId, nowIso());
    const from = this.db.get<{ id: string; username: string }>('SELECT id, username FROM users WHERE id = ?', userId)!;
    this.social.notify(target.id, 'room_invite', { roomId, roomName: r.name, game: r.game, from });
    return { ok: true, invited: { id: target.id, username: target.username } };
  }

  regenerateCode(userId: string, roomId: string) {
    this.requireHost(roomId, userId);
    const expires = new Date(this.clock() + CODE_TTL_MS).toISOString();
    for (let attempt = 0; attempt < 5; attempt += 1) {
      try {
        this.db.run('UPDATE rooms SET code = ?, code_expires_at = ? WHERE id = ?', generateCode(), expires, roomId);
        break;
      } catch (err) {
        if (!String(err).includes('UNIQUE')) throw err;
      }
    }
    this.broadcastRoom(roomId);
    return this.view(roomId, userId);
  }

  /**
   * Cambios del anfitrión. No se pueden cambiar el juego, los asientos ni el
   * modo de fichas; los límites nuevos se aplican desde la siguiente mano o
   * ronda (la mano en curso no se altera).
   */
  update(userId: string, roomId: string, patch: { name?: string; allowBots?: boolean; poker?: Partial<PokerRoomSettings>; blackjack?: Partial<BlackjackRoomSettings>; bingo?: Partial<BingoRoomSettings>; privacy?: 'code' | 'friends' }) {
    const r = this.requireHost(roomId, userId);
    const st = this.settings(r);
    let next: PokerRoomSettings | BlackjackRoomSettings | BingoRoomSettings = st;
    if (r.game === 'bingo' && patch.bingo) {
      const n = { ...(st as BingoRoomSettings), ...patch.bingo };
      if (n.cardPrice < 1 || n.cardPrice > 10_000) throw new AppError(400, 'INVALID_SETTINGS', 'Precio del cartón no válido');
      next = n;
    }
    if (r.game === 'poker' && patch.poker) {
      const cur = st as PokerRoomSettings;
      if (patch.poker.startingChips !== undefined && patch.poker.startingChips !== cur.startingChips) {
        throw new AppError(400, 'LOCKED', 'Las fichas iniciales no se pueden cambiar una vez creada la sala');
      }
      const n = { ...cur, ...patch.poker };
      if (n.smallBlind > n.bigBlind || n.minBuyIn < n.bigBlind * 10 || n.maxBuyIn < n.minBuyIn) throw new AppError(400, 'INVALID_SETTINGS', 'Ciegas o entradas no válidas');
      next = n;
    }
    if (r.game === 'blackjack' && patch.blackjack) {
      const n = { ...(st as BlackjackRoomSettings), ...patch.blackjack };
      if (n.maxBet < n.minBet) throw new AppError(400, 'INVALID_SETTINGS', 'La apuesta máxima debe ser mayor o igual que la mínima');
      next = n;
    }
    this.db.run(
      'UPDATE rooms SET name = ?, allow_bots = ?, privacy = ?, settings_json = ? WHERE id = ?',
      patch.name ?? r.name, (patch.allowBots ?? r.allow_bots === 1) ? 1 : 0, patch.privacy ?? r.privacy, JSON.stringify(next), roomId,
    );
    const fresh = this.row(roomId);
    const t = this.table(fresh);
    // updateConfig aplica los límites desde la siguiente mano/ronda; los asientos no cambian.
    if (t) (t as { updateConfig(c: unknown): void }).updateConfig(this.tableConfig(fresh));
    this.broadcastRoom(roomId);
    return this.view(roomId, userId);
  }

  leave(userId: string, roomId: string): void {
    const r = this.requireMember(roomId, userId);
    const t = this.table(r);
    if (t?.hasUser(userId)) t.leave(userId);
    this.db.run('DELETE FROM room_members WHERE room_id = ? AND user_id = ?', roomId, userId);
    this.hub.sendToUser(userId, { t: 'room.left', roomId });
    const rest = this.memberIds(roomId);
    if (rest.length === 0) {
      this.closeRoom(roomId, 'empty');
      return;
    }
    if (r.host_id === userId) this.transferHost(r, rest);
    this.broadcastRoom(roomId);
  }

  close(userId: string, roomId: string): void {
    this.requireHost(roomId, userId);
    this.closeRoom(roomId, 'host');
  }

  private transferHost(r: RoomRow, candidates: string[]): void {
    const connected = candidates.filter((id) => id !== r.host_id && this.hub.isUserConnected(id));
    const next = connected[0] ?? candidates.find((id) => id !== r.host_id);
    if (!next) return;
    this.db.run('UPDATE rooms SET host_id = ? WHERE id = ?', next, r.id);
    logger.info('Anfitrión de sala transferido', { room: r.id });
    this.hub.sendToUser(next, { t: 'room.host', roomId: r.id });
  }

  /** Cierre controlado: la mesa devuelve fichas y apuestas abiertas antes de desaparecer. */
  closeRoom(roomId: string, reason: 'host' | 'empty' | 'inactive'): void {
    const r = this.row(roomId);
    if (r.status !== 'open') return;
    const members = this.memberIds(roomId);
    if (r.game === 'poker') this.poker.removeRoomTable(tableIdOf(roomId));
    else if (r.game === 'bingo') this.bingo.removeRoomTable(tableIdOf(roomId));
    else this.blackjack.removeRoomTable(tableIdOf(roomId));
    this.db.run(`UPDATE rooms SET status = 'closed', closed_at = ?, close_reason = ? WHERE id = ?`, nowIso(), reason, roomId);
    this.db.run('DELETE FROM room_invites WHERE room_id = ?', roomId);
    for (const m of members) this.hub.sendToUser(m, { t: 'room.closed', roomId, reason });
    logger.info('Sala privada cerrada', { room: roomId, reason });
  }

  private broadcastRoom(roomId: string): void {
    for (const m of this.memberIds(roomId)) this.hub.sendToUser(m, { t: 'room.changed', roomId });
  }

  /** Revisión periódica: transferencia del anfitrión ausente y cierre de salas abandonadas. */
  sweep(now = this.clock()): void {
    const rooms = this.db.all<RoomRow>(`SELECT * FROM rooms WHERE status = 'open'`);
    for (const r of rooms) {
      const members = this.memberIds(r.id);
      for (const m of members) if (this.hub.isUserConnected(m)) this.lastSeen.set(m, now);
      const seen = (id: string): number => this.lastSeen.get(id) ?? Date.parse(r.created_at);
      const anyone = members.some((m) => now - seen(m) < IDLE_CLOSE_MS);
      if (!anyone) {
        this.closeRoom(r.id, 'inactive');
        continue;
      }
      if (now - seen(r.host_id) > HOST_GRACE_MS) {
        const candidates = members.filter((m) => m !== r.host_id && now - seen(m) < HOST_GRACE_MS);
        if (candidates.length > 0) {
          this.transferHost(r, candidates);
          this.broadcastRoom(r.id);
        }
      }
    }
  }
}
