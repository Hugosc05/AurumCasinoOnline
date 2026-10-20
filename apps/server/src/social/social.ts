import { randomUUID } from 'node:crypto';
import type { Database } from '../db/database';
import { nowIso } from '../db/database';
import { readPrefs } from '../auth/users';
import { AppError, conflict, forbidden, notFound } from '../lib/errors';
import type { RealtimeHub } from '../realtime/hub';

export type PresenceStatus = 'available' | 'playing' | 'offline';

export interface PresenceView {
  status: PresenceStatus;
  /** Juego en el que está sentado (solo si está jugando). */
  game: 'poker' | 'blackjack' | null;
}

/** Datos mínimos y públicos de otro usuario. Nunca correo, saldo ni datos de sesión. */
export interface PublicPerson {
  id: string;
  username: string;
}

interface FriendRow {
  id: string;
  requester_id: string;
  addressee_id: string;
  status: 'pending' | 'accepted';
  created_at: string;
  responded_at: string | null;
}

const pairKey = (a: string, b: string): string => (a < b ? `${a}|${b}` : `${b}|${a}`);

export const MAX_FRIENDS = 200;
export const MAX_PENDING_OUT = 50;

/**
 * Amistades, presencia y notificaciones.
 *
 * - Todas las comprobaciones de permisos se hacen aquí, en el servidor, con
 *   el usuario de la sesión: nadie puede aceptar una solicitud ajena ni ver
 *   datos de quien no es su amigo.
 * - La presencia sale de las conexiones y asientos reales. Una cuenta
 *   invisible aparece siempre «desconectada» para los demás.
 * - Los bots no son usuarios: no aparecen en la búsqueda ni pueden recibir
 *   ni aceptar solicitudes.
 */
export class SocialService {
  private seatLookup: (userId: string) => 'poker' | 'blackjack' | null = () => null;

  constructor(private readonly db: Database, private readonly hub: RealtimeHub) {
    hub.onConnect((c) => c.userId && this.presenceChanged(c.userId));
    hub.onDisconnect((c) => {
      if (c.userId && !hub.isUserConnected(c.userId)) this.presenceChanged(c.userId);
    });
    hub.onLocal('seat', (userId) => this.presenceChanged(userId));
  }

  /** Dónde está sentado cada usuario (lo aportan los gestores de mesas). */
  setSeatLookup(fn: (userId: string) => 'poker' | 'blackjack' | null): void {
    this.seatLookup = fn;
  }

  /* ----------------------------- Presencia ------------------------------ */

  private isInvisible(userId: string): boolean {
    const row = this.db.get<{ prefs_json: string }>('SELECT prefs_json FROM users WHERE id = ?', userId);
    return row ? readPrefs(row.prefs_json).invisible : true;
  }

  /** Presencia tal como la ve otra persona (respeta el modo invisible). */
  presenceOf(userId: string): PresenceView {
    if (!this.hub.isUserConnected(userId) || this.isInvisible(userId)) return { status: 'offline', game: null };
    const game = this.seatLookup(userId);
    return game ? { status: 'playing', game } : { status: 'available', game: null };
  }

  /** Avisa a los amigos para que refresquen la presencia (sin detalles: la piden por HTTP con permisos). */
  presenceChanged(userId: string): void {
    for (const f of this.friendIds(userId)) this.hub.sendToUser(f, { t: 'friends.changed' });
  }

  /* ----------------------------- Amistades ------------------------------ */

  private friendIds(userId: string): string[] {
    return this.db
      .all<{ other: string }>(
        `SELECT CASE WHEN requester_id = ? THEN addressee_id ELSE requester_id END AS other
         FROM friendships WHERE status = 'accepted' AND (requester_id = ? OR addressee_id = ?)`,
        userId, userId, userId,
      )
      .map((r) => r.other);
  }

  areFriends(a: string, b: string): boolean {
    return !!this.db.get(`SELECT 1 AS x FROM friendships WHERE pair_key = ? AND status = 'accepted'`, pairKey(a, b));
  }

  private person(id: string): PublicPerson {
    const u = this.db.get<{ id: string; username: string }>('SELECT id, username FROM users WHERE id = ?', id);
    if (!u) throw notFound('Usuario no encontrado');
    return { id: u.id, username: u.username };
  }

  overview(userId: string) {
    const rows = this.db.all<FriendRow>('SELECT * FROM friendships WHERE requester_id = ? OR addressee_id = ? ORDER BY created_at DESC', userId, userId);
    const friends = [];
    const incoming = [];
    const outgoing = [];
    for (const r of rows) {
      const otherId = r.requester_id === userId ? r.addressee_id : r.requester_id;
      const other = this.person(otherId);
      if (r.status === 'accepted') friends.push({ ...other, since: r.responded_at ?? r.created_at, presence: this.presenceOf(otherId) });
      else if (r.addressee_id === userId) incoming.push({ requestId: r.id, from: other, at: r.created_at });
      else outgoing.push({ requestId: r.id, to: other, at: r.created_at });
    }
    const order = { playing: 0, available: 1, offline: 2 } as const;
    friends.sort((a, b) => order[a.presence.status] - order[b.presence.status] || a.username.localeCompare(b.username, 'es'));
    return { friends, incoming, outgoing };
  }

  search(userId: string, q: string) {
    const term = q.trim();
    if (term.length < 2) return [];
    const like = `${term.replace(/[\\%_]/g, (m) => `\\${m}`)}%`;
    const rows = this.db.all<{ id: string; username: string }>(
      `SELECT id, username FROM users WHERE username LIKE ? ESCAPE '\\' AND id <> ? AND status = 'active' ORDER BY length(username), username LIMIT 10`,
      like, userId,
    );
    return rows.map((u) => {
      const f = this.db.get<FriendRow>('SELECT * FROM friendships WHERE pair_key = ?', pairKey(userId, u.id));
      const relation = !f ? 'none' : f.status === 'accepted' ? 'friend' : f.requester_id === userId ? 'outgoing' : 'incoming';
      return { id: u.id, username: u.username, relation, requestId: f && f.status === 'pending' ? f.id : null };
    });
  }

  sendRequest(userId: string, username: string) {
    return this.db.tx(() => {
      const target = this.db.get<{ id: string; username: string; status: string }>('SELECT id, username, status FROM users WHERE lower(username) = lower(?)', username.trim());
      if (!target || target.status !== 'active') throw notFound('No existe ninguna persona con ese nombre');
      if (target.id === userId) throw new AppError(400, 'SELF', 'No puedes enviarte una solicitud a ti mismo');
      const existing = this.db.get<FriendRow>('SELECT * FROM friendships WHERE pair_key = ?', pairKey(userId, target.id));
      if (existing?.status === 'accepted') throw conflict('ALREADY_FRIENDS', 'Ya sois amigos');
      if (existing && existing.requester_id === userId) throw conflict('ALREADY_SENT', 'Ya le has enviado una solicitud');
      if (existing) {
        // La otra persona ya te la había enviado: enviarla tú equivale a aceptar.
        return { accepted: true, ...this.accept(userId, existing.id) };
      }
      const out = this.db.get<{ n: number }>(`SELECT COUNT(*) AS n FROM friendships WHERE requester_id = ? AND status = 'pending'`, userId)!.n;
      if (out >= MAX_PENDING_OUT) throw new AppError(400, 'TOO_MANY_PENDING', 'Tienes demasiadas solicitudes pendientes');
      if (this.friendIds(userId).length >= MAX_FRIENDS) throw new AppError(400, 'TOO_MANY_FRIENDS', `Máximo ${MAX_FRIENDS} amigos`);
      const id = randomUUID();
      try {
        this.db.run(
          `INSERT INTO friendships (id, requester_id, addressee_id, pair_key, status, created_at) VALUES (?, ?, ?, ?, 'pending', ?)`,
          id, userId, target.id, pairKey(userId, target.id), nowIso(),
        );
      } catch (err) {
        if (String(err).includes('UNIQUE')) throw conflict('ALREADY_SENT', 'Ya existe una solicitud entre vosotros');
        throw err;
      }
      const me = this.person(userId);
      this.notify(target.id, 'friend_request', { requestId: id, from: me });
      this.hub.sendToUser(target.id, { t: 'friends.changed' });
      return { accepted: false, requestId: id, to: { id: target.id, username: target.username } };
    });
  }

  private pending(requestId: string): FriendRow {
    const r = this.db.get<FriendRow>(`SELECT * FROM friendships WHERE id = ? AND status = 'pending'`, requestId);
    if (!r) throw notFound('Solicitud no encontrada');
    return r;
  }

  /** Solo el destinatario puede aceptar. */
  accept(userId: string, requestId: string) {
    return this.db.tx(() => {
      const r = this.pending(requestId);
      if (r.addressee_id !== userId) throw forbidden('Esta solicitud no es para ti');
      this.db.run(`UPDATE friendships SET status = 'accepted', responded_at = ? WHERE id = ? AND status = 'pending'`, nowIso(), r.id);
      this.notify(r.requester_id, 'friend_accepted', { by: this.person(userId) });
      this.hub.sendToUser(r.requester_id, { t: 'friends.changed' });
      return { friend: this.person(r.requester_id) };
    });
  }

  /** Solo el destinatario puede rechazar (se borra sin avisar al remitente). */
  reject(userId: string, requestId: string): void {
    const r = this.pending(requestId);
    if (r.addressee_id !== userId) throw forbidden('Esta solicitud no es para ti');
    this.db.run('DELETE FROM friendships WHERE id = ?', r.id);
    this.hub.sendToUser(r.requester_id, { t: 'friends.changed' });
  }

  /** Solo quien la envió puede cancelarla. */
  cancel(userId: string, requestId: string): void {
    const r = this.pending(requestId);
    if (r.requester_id !== userId) throw forbidden('Solo puedes cancelar tus propias solicitudes');
    this.db.run('DELETE FROM friendships WHERE id = ?', r.id);
    this.db.run(`DELETE FROM notifications WHERE user_id = ? AND kind = 'friend_request' AND json_extract(payload_json, '$.requestId') = ?`, r.addressee_id, r.id);
    this.hub.sendToUser(r.addressee_id, { t: 'friends.changed' });
  }

  removeFriend(userId: string, otherId: string): void {
    const r = this.db.run(`DELETE FROM friendships WHERE pair_key = ? AND status = 'accepted'`, pairKey(userId, otherId));
    if (r.changes !== 1) throw notFound('No sois amigos');
    this.hub.sendToUser(otherId, { t: 'friends.changed' });
  }

  /* --------------------------- Notificaciones --------------------------- */

  notify(userId: string, kind: 'friend_request' | 'friend_accepted' | 'room_invite', payload: Record<string, unknown>): void {
    const at = nowIso();
    const r = this.db.run('INSERT INTO notifications (user_id, kind, payload_json, created_at) VALUES (?, ?, ?, ?)', userId, kind, JSON.stringify(payload), at);
    this.hub.sendToUser(userId, { t: 'notification', notification: { id: r.lastInsertRowid, kind, payload, readAt: null, createdAt: at } });
    // Se conservan las 100 más recientes.
    this.db.run('DELETE FROM notifications WHERE user_id = ? AND id NOT IN (SELECT id FROM notifications WHERE user_id = ? ORDER BY id DESC LIMIT 100)', userId, userId);
  }

  notifications(userId: string) {
    const items = this.db
      .all<{ id: number; kind: string; payload_json: string; read_at: string | null; created_at: string }>(
        'SELECT * FROM notifications WHERE user_id = ? ORDER BY id DESC LIMIT 30',
        userId,
      )
      .map((n) => ({ id: n.id, kind: n.kind, payload: JSON.parse(n.payload_json) as Record<string, unknown>, readAt: n.read_at, createdAt: n.created_at }));
    const unread = this.db.get<{ n: number }>('SELECT COUNT(*) AS n FROM notifications WHERE user_id = ? AND read_at IS NULL', userId)!.n;
    return { items, unread };
  }

  markRead(userId: string, ids: number[] | null): void {
    if (ids === null) {
      this.db.run('UPDATE notifications SET read_at = ? WHERE user_id = ? AND read_at IS NULL', nowIso(), userId);
      return;
    }
    for (const id of ids) this.db.run('UPDATE notifications SET read_at = ? WHERE id = ? AND user_id = ? AND read_at IS NULL', nowIso(), id, userId);
  }
}
