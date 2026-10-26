import type { Database } from '../db/database';
import { nowIso } from '../db/database';
import { AppError, notFound } from '../lib/errors';

/**
 * Foto de perfil y aspecto público (marco y color del nombre).
 *
 * La imagen llega ya recortada y reducida por el navegador (256 × 256, WebP o
 * JPEG). Aquí se comprueba que de verdad es una imagen de ese tipo mirando
 * sus primeros bytes, que no pasa de 96 KB y se guarda en la base de datos
 * (así funciona igual en Render, cuyo disco se borra en cada despliegue).
 */

export const AVATAR_MAX_BYTES = 96 * 1024;

const MAGIC: Record<string, (b: Buffer) => boolean> = {
  'image/webp': (b) => b.length > 12 && b.toString('ascii', 0, 4) === 'RIFF' && b.toString('ascii', 8, 12) === 'WEBP',
  'image/jpeg': (b) => b.length > 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff,
  'image/png': (b) => b.length > 8 && b.readUInt32BE(0) === 0x89504e47,
};

export function decodeAvatar(dataUrl: string): { mime: string; bytes: Buffer } {
  const m = /^data:(image\/(?:webp|jpeg|png));base64,([A-Za-z0-9+/=]+)$/.exec(dataUrl);
  if (!m) throw new AppError(400, 'INVALID_IMAGE', 'La imagen debe ser WebP, JPEG o PNG');
  const bytes = Buffer.from(m[2]!, 'base64');
  if (bytes.length > AVATAR_MAX_BYTES) throw new AppError(413, 'IMAGE_TOO_BIG', 'La imagen es demasiado grande');
  if (!MAGIC[m[1]!]!(bytes)) throw new AppError(400, 'INVALID_IMAGE', 'El archivo no es una imagen válida');
  return { mime: m[1]!, bytes };
}

export interface PublicLook {
  username: string;
  avatarUrl: string | null;
  frame: string | null;
  nameColor: string | null;
  /** Dorso de cartas equipado: lo ven todos en las cartas boca abajo de este jugador. */
  cardBack: string | null;
}

/** Aspecto público por nombre de usuario, con caché en memoria (se invalida al cambiarlo). */
export class LookService {
  private cache = new Map<string, PublicLook | null>();

  constructor(private readonly db: Database) {}

  invalidate(username: string): void {
    this.cache.delete(username.toLowerCase());
  }

  byUsername(username: string): PublicLook | null {
    const key = username.toLowerCase();
    if (this.cache.has(key)) return this.cache.get(key)!;
    const row = this.db.get<{ id: string; username: string; avatar_version: number | null; frame: string | null; name_color: string | null; card_back: string | null }>(
      `SELECT u.id, u.username, p.avatar_version, p.frame, p.name_color, p.card_back FROM users u LEFT JOIN user_profiles p ON p.user_id = u.id WHERE lower(u.username) = ?`, key,
    );
    const look = row
      ? { username: row.username, avatarUrl: row.avatar_version ? `/api/avatars/${row.id}?v=${row.avatar_version}` : null, frame: row.frame, nameColor: row.name_color, cardBack: row.card_back }
      : null;
    if (this.cache.size > 5000) this.cache.clear();
    this.cache.set(key, look);
    return look;
  }

  setAvatar(userId: string, dataUrl: string | null): number {
    const user = this.db.get<{ username: string }>('SELECT username FROM users WHERE id = ?', userId);
    if (!user) throw notFound('Usuario no encontrado');
    this.db.run('INSERT INTO user_profiles (user_id, updated_at) VALUES (?, ?) ON CONFLICT DO NOTHING', userId, nowIso());
    if (dataUrl === null) {
      this.db.run('UPDATE user_profiles SET avatar_mime = NULL, avatar_data = NULL, avatar_version = 0, updated_at = ? WHERE user_id = ?', nowIso(), userId);
      this.invalidate(user.username);
      return 0;
    }
    const { mime, bytes } = decodeAvatar(dataUrl);
    this.db.run(
      'UPDATE user_profiles SET avatar_mime = ?, avatar_data = ?, avatar_version = avatar_version + 1, updated_at = ? WHERE user_id = ?',
      mime, bytes.toString('base64'), nowIso(), userId,
    );
    this.invalidate(user.username);
    return Number(this.db.get<{ v: number }>('SELECT avatar_version AS v FROM user_profiles WHERE user_id = ?', userId)!.v);
  }

  avatar(userId: string): { mime: string; bytes: Buffer; version: number } | null {
    const r = this.db.get<{ avatar_mime: string | null; avatar_data: string | null; avatar_version: number }>('SELECT avatar_mime, avatar_data, avatar_version FROM user_profiles WHERE user_id = ?', userId);
    if (!r?.avatar_data || !r.avatar_mime) return null;
    return { mime: r.avatar_mime, bytes: Buffer.from(r.avatar_data, 'base64'), version: Number(r.avatar_version) };
  }

  /** Tarjeta de jugador: lo que se ve al tocar a alguien en una mesa. */
  card(viewerId: string | null, username: string) {
    const u = this.db.get<{ id: string; username: string; created_at: string; status: string }>('SELECT id, username, created_at, status FROM users WHERE lower(username) = lower(?)', username);
    if (!u || u.status !== 'active') throw notFound('Jugador no encontrado');
    const look = this.byUsername(u.username)!;
    const st = this.db.get<{ rounds: number; wins: number; biggest_win: number; best_streak: number }>('SELECT rounds, wins, biggest_win, best_streak FROM user_stats WHERE user_id = ?', u.id);
    let relation: 'self' | 'friend' | 'outgoing' | 'incoming' | 'none' = 'none';
    let requestId: string | null = null;
    if (viewerId === u.id) relation = 'self';
    else if (viewerId) {
      const key = viewerId < u.id ? `${viewerId}|${u.id}` : `${u.id}|${viewerId}`;
      const f = this.db.get<{ id: string; status: string; requester_id: string }>('SELECT id, status, requester_id FROM friendships WHERE pair_key = ?', key);
      if (f) {
        relation = f.status === 'accepted' ? 'friend' : f.requester_id === viewerId ? 'outgoing' : 'incoming';
        requestId = f.status === 'pending' ? f.id : null;
      }
    }
    return {
      ...look,
      memberSince: u.created_at,
      stats: { rounds: Number(st?.rounds ?? 0), wins: Number(st?.wins ?? 0), biggestWin: Number(st?.biggest_win ?? 0), bestStreak: Number(st?.best_streak ?? 0) },
      relation,
      requestId,
    };
  }
}
