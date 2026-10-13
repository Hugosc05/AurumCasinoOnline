import { createHash, randomBytes } from 'node:crypto';
import type { Database } from '../db/database';
import { nowIso } from '../db/database';

export const SESSION_COOKIE = 'aurum_sid';

export interface UserRow {
  id: string;
  username: string;
  email: string;
  password_hash: string;
  role: 'player' | 'admin';
  status: 'active' | 'banned';
  balance: number;
  prefs_json: string;
  created_at: string;
  last_login_at: string | null;
}

const hashToken = (token: string): string => createHash('sha256').update(token).digest('hex');

/** Crea una sesión y devuelve el token opaco (solo se guarda su hash). */
export function createSession(db: Database, userId: string, ttlHours: number, ip: string | null, ua: string | null): string {
  const token = randomBytes(32).toString('base64url');
  const now = new Date();
  const expires = new Date(now.getTime() + ttlHours * 3600_000);
  db.run(
    'INSERT INTO sessions (id_hash, user_id, created_at, expires_at, last_seen_at, ip, user_agent) VALUES (?, ?, ?, ?, ?, ?, ?)',
    hashToken(token), userId, now.toISOString(), expires.toISOString(), now.toISOString(), ip, ua?.slice(0, 300) ?? null,
  );
  return token;
}

/** Resuelve el usuario de una sesión válida (no expirada, usuario activo). Renueva la caducidad deslizante. */
export function getSessionUser(db: Database, token: string | undefined, ttlHours: number): UserRow | null {
  if (!token || token.length > 200) return null;
  const idHash = hashToken(token);
  const row = db.get<UserRow & { expires_at: string; last_seen_at: string }>(
    `SELECT u.*, s.expires_at, s.last_seen_at FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.id_hash = ?`,
    idHash,
  );
  if (!row) return null;
  const now = Date.now();
  if (Date.parse(row.expires_at) <= now) {
    db.run('DELETE FROM sessions WHERE id_hash = ?', idHash);
    return null;
  }
  if (row.status !== 'active') return null;
  // Renovación como mucho una vez por minuto para no escribir en cada petición.
  if (now - Date.parse(row.last_seen_at) > 60_000) {
    db.run(
      'UPDATE sessions SET last_seen_at = ?, expires_at = ? WHERE id_hash = ?',
      nowIso(), new Date(now + ttlHours * 3600_000).toISOString(), idHash,
    );
  }
  const { expires_at: _e, last_seen_at: _l, ...user } = row;
  return user;
}

export function destroySession(db: Database, token: string | undefined): void {
  if (token) db.run('DELETE FROM sessions WHERE id_hash = ?', hashToken(token));
}

export function destroyUserSessions(db: Database, userId: string): void {
  db.run('DELETE FROM sessions WHERE user_id = ?', userId);
}

export function purgeExpiredSessions(db: Database): number {
  return db.run('DELETE FROM sessions WHERE expires_at <= ?', nowIso()).changes;
}
