import { createHash } from 'node:crypto';
import type { Database } from '../db/database';
import { getSetting } from '../db/seed';
import { dayKey } from '../economy/period';
import { logger } from '../lib/logger';

/**
 * Contadores de actividad baratos para el panel:
 *  - usuarios activos por día (una fila por usuario y día);
 *  - visitas por sección (ruta normalizada: /poker/abc → /poker) y visitantes
 *    únicos por día con una clave anónima (hash de IP + navegador + día; la IP
 *    no se guarda);
 *  - pico diario de jugadores conectados.
 * Las visitas se acumulan en memoria y se vuelcan cada minuto.
 */
export class ActivityTracker {
  private seen = new Set<string>();
  private views = new Map<string, number>();
  private visitors = new Set<string>();
  private peak = new Map<string, number>();
  private timer: NodeJS.Timeout | null = null;
  private tzCache: { tz: string; at: number } | null = null;

  constructor(private readonly db: Database, private readonly clock: () => number = Date.now) {}

  private tz(): string {
    const now = this.clock();
    if (!this.tzCache || now - this.tzCache.at > 60_000) this.tzCache = { tz: getSetting(this.db, 'dailyTimezone'), at: now };
    return this.tzCache.tz;
  }

  today(): string {
    return dayKey(new Date(this.clock()), this.tz());
  }

  /** Marca al usuario como activo hoy (como mucho una escritura por usuario y día). */
  touchUser(userId: string): void {
    const key = `${this.today()}|${userId}`;
    if (this.seen.has(key)) return;
    this.seen.add(key);
    if (this.seen.size > 100_000) this.seen.clear();
    try {
      this.db.run('INSERT INTO daily_activity (day, user_id) VALUES (?, ?) ON CONFLICT DO NOTHING', this.today(), userId);
    } catch {
      this.seen.delete(key);
    }
  }

  /** Una visita a una sección de la web (la envía el navegador al cambiar de página). */
  pageView(rawPath: string, visitor: { userId: string | null; ip: string | null; ua: string | null }): void {
    const path = normalizePath(rawPath);
    if (!path) return;
    const day = this.today();
    const k = `${day}|${path}`;
    this.views.set(k, (this.views.get(k) ?? 0) + 1);
    const who = visitor.userId ?? `${visitor.ip ?? '?'}|${visitor.ua ?? '?'}`;
    this.visitors.add(`${day}|${createHash('sha256').update(`${day}|${who}`).digest('base64url').slice(0, 22)}`);
    if (visitor.userId) this.touchUser(visitor.userId);
  }

  /** Actualiza el pico de conectados del día. */
  online(count: number): void {
    const day = this.today();
    if (count > (this.peak.get(day) ?? 0)) this.peak.set(day, count);
  }

  flush(): void {
    if (this.views.size === 0 && this.visitors.size === 0 && this.peak.size === 0) return;
    const views = this.views;
    const visitors = this.visitors;
    const peak = this.peak;
    this.views = new Map();
    this.visitors = new Set();
    this.peak = new Map();
    try {
      this.db.tx(() => {
        for (const [k, n] of views) {
          const [day, path] = k.split('|') as [string, string];
          this.db.run(
            `INSERT INTO page_views (day, path, views) VALUES (?, ?, ?)
             ON CONFLICT(day, path) DO UPDATE SET views = page_views.views + excluded.views`,
            day, path, n,
          );
        }
        for (const k of visitors) {
          const [day, key] = k.split('|') as [string, string];
          this.db.run('INSERT INTO daily_visitors (day, visitor_key) VALUES (?, ?) ON CONFLICT DO NOTHING', day, key);
        }
        for (const [day, n] of peak) {
          this.db.run(
            `INSERT INTO site_daily (day, peak_online) VALUES (?, ?)
             ON CONFLICT(day) DO UPDATE SET peak_online = CASE WHEN excluded.peak_online > site_daily.peak_online THEN excluded.peak_online ELSE site_daily.peak_online END`,
            day, n,
          );
        }
      });
    } catch (err) {
      logger.warn('No se pudieron guardar las estadísticas de visitas', { error: (err as Error).message });
    }
  }

  start(): void {
    this.timer = setInterval(() => this.flush(), 60_000);
    this.timer.unref();
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.flush();
  }

  /** Borra el detalle antiguo (las cifras agregadas por día se conservan en page_views). */
  purgeOld(days = 400): void {
    const cutoff = dayKey(new Date(this.clock() - days * 86_400_000), this.tz());
    this.db.run('DELETE FROM daily_visitors WHERE day < ?', cutoff);
  }
}

/**
 * Agrupa las rutas por sección para no guardar una fila por cada mesa o sala
 * (y no guardar identificadores): /poker/zafiro → /poker, /salas/abc → /salas.
 * Solo se aceptan rutas de la propia web; el panel de administración no cuenta.
 */
export function normalizePath(raw: string): string | null {
  if (typeof raw !== 'string' || raw.length > 300 || !raw.startsWith('/')) return null;
  const clean = raw.split(/[?#]/)[0]!.toLowerCase();
  const first = clean.split('/')[1] ?? '';
  if (first === 'admin' || first === 'api') return null;
  if (!/^[a-z0-9-]{0,30}$/.test(first)) return null;
  return `/${first}`;
}
