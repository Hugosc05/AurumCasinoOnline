import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import type { AppConfig } from '../config';
import type { Database } from '../db/database';
import { nowIso } from '../db/database';
import { getSetting } from '../db/seed';
import { dayKey } from '../economy/period';
import { economyTimezone } from '../economy/daily';
import { AppError, conflict, forbidden, notFound } from '../lib/errors';
import { logger } from '../lib/logger';
import { credit, getBalance, type BalanceView } from '../wallet/wallet';

/**
 * Anuncios recompensados.
 *
 * Interfaz de proveedor independiente del juego. No hay ningún proveedor de
 * pago obligatorio: sin configuración, el módulo queda desactivado y la
 * interfaz muestra «Los anuncios recompensados no están disponibles en este
 * entorno».
 *
 * Reglas de seguridad:
 *  - El saldo solo cambia en el servidor, en una transacción.
 *  - En producción la recompensa SOLO se concede tras una confirmación del
 *    proveedor servidor a servidor, con firma verificada. Una petición del
 *    navegador nunca basta.
 *  - Idempotencia: una sesión se recompensa una vez (transición condicional)
 *    y cada transacción del proveedor solo puede usarse una vez (UNIQUE).
 *  - Límite diario por usuario, tiempo mínimo de visualización, caducidad de
 *    sesión y registro de cada concesión o rechazo.
 *  - El modo de simulación existe solo para desarrollo, está desactivado por
 *    defecto, se rechaza en producción y se etiqueta como simulación.
 */

export type AdMode = 'none' | 'dev-simulation' | 'signed-callback';

export interface AdProvider {
  readonly mode: AdMode;
  readonly label: string;
  /** El navegador puede confirmar la visualización (solo simulación de desarrollo). */
  readonly clientCompletion: boolean;
  /** Configuración pública que necesita el cliente para mostrar el anuncio (sin secretos). */
  clientConfig(sessionId: string): Record<string, unknown>;
}

export interface SignedCallback {
  sessionId: string;
  userId: string;
  providerTxId: string;
  /** Segundos Unix. */
  timestamp: number;
  signature: string;
}

const SESSION_TTL_MS = 30 * 60 * 1000;

export function signCallback(secret: string, c: Omit<SignedCallback, 'signature'>): string {
  return createHmac('sha256', secret).update(`${c.sessionId}.${c.userId}.${c.providerTxId}.${c.timestamp}`).digest('hex');
}

export function createAdProvider(config: AppConfig): AdProvider | null {
  switch (config.ADS_PROVIDER) {
    case 'dev-simulation':
      return {
        mode: 'dev-simulation',
        label: 'Simulación de desarrollo (no es un anuncio real)',
        clientCompletion: true,
        clientConfig: () => ({ simulation: true }),
      };
    case 'signed-callback':
      return {
        mode: 'signed-callback',
        label: 'Proveedor de anuncios',
        clientCompletion: false,
        // El cliente pasa este identificador al SDK del proveedor como "custom data";
        // el proveedor lo devuelve en su llamada firmada.
        clientConfig: (sessionId) => ({ customData: sessionId }),
      };
    default:
      return null;
  }
}

interface SessionRow {
  id: string;
  user_id: string;
  provider: string;
  status: 'started' | 'rewarded' | 'rejected' | 'expired';
  reward: number;
  day: string;
  created_at: string;
}

export class AdsService {
  constructor(
    private readonly db: Database,
    private readonly config: AppConfig,
    readonly provider: AdProvider | null,
    private readonly clock: () => number = Date.now,
  ) {}

  private today(): string {
    return dayKey(new Date(this.clock()), economyTimezone(this.db));
  }

  private rewardedToday(userId: string): number {
    return this.db.get<{ n: number }>(`SELECT COUNT(*) AS n FROM ad_sessions WHERE user_id = ? AND day = ? AND status = 'rewarded'`, userId, this.today())!.n;
  }

  status(userId: string | null, role: string | null) {
    const limit = getSetting(this.db, 'adsDailyLimit');
    const base = {
      mode: (this.provider?.mode ?? 'none') as AdMode,
      reward: getSetting(this.db, 'adsRewardAmount'),
      dailyLimit: limit,
      minWatchSeconds: getSetting(this.db, 'adsMinWatchSeconds'),
    };
    if (!this.provider) {
      return { ...base, available: false, remainingToday: 0, label: null, message: 'Los anuncios recompensados no están disponibles en este entorno.' };
    }
    if (role === 'admin') {
      return { ...base, available: false, remainingToday: 0, label: this.provider.label, message: 'Las cuentas administradoras tienen saldo ilimitado.' };
    }
    const remaining = userId ? Math.max(0, limit - this.rewardedToday(userId)) : 0;
    return {
      ...base,
      available: remaining > 0,
      remainingToday: remaining,
      label: this.provider.label,
      message: remaining > 0 ? null : 'Has alcanzado el límite de anuncios recompensados de hoy.',
    };
  }

  startSession(userId: string, role: string) {
    if (!this.provider) throw new AppError(503, 'ADS_UNAVAILABLE', 'Los anuncios recompensados no están disponibles en este entorno.');
    if (role === 'admin') throw new AppError(400, 'NOT_APPLICABLE', 'Las cuentas administradoras tienen saldo ilimitado');
    const limit = getSetting(this.db, 'adsDailyLimit');
    if (this.rewardedToday(userId) >= limit) throw new AppError(429, 'ADS_DAILY_LIMIT', 'Has alcanzado el límite de anuncios recompensados de hoy.');
    // Sesiones abiertas a la vez: como mucho una (evita acumular sesiones para canjearlas después).
    this.db.run(`UPDATE ad_sessions SET status = 'expired', completed_at = ? WHERE user_id = ? AND status = 'started'`, nowIso(), userId);
    const id = randomBytes(18).toString('base64url');
    const reward = getSetting(this.db, 'adsRewardAmount');
    this.db.run(
      `INSERT INTO ad_sessions (id, user_id, provider, status, reward, day, created_at) VALUES (?, ?, ?, 'started', ?, ?, ?)`,
      id, userId, this.provider.mode, reward, this.today(), new Date(this.clock()).toISOString(),
    );
    return { sessionId: id, mode: this.provider.mode, label: this.provider.label, minWatchSeconds: getSetting(this.db, 'adsMinWatchSeconds'), reward, client: this.provider.clientConfig(id) };
  }

  sessionStatus(userId: string, id: string) {
    const row = this.db.get<SessionRow>('SELECT * FROM ad_sessions WHERE id = ? AND user_id = ?', id, userId);
    if (!row) throw notFound('Sesión de anuncio no encontrada');
    return { status: row.status, reward: row.status === 'rewarded' ? row.reward : 0 };
  }

  /** Confirmación desde el navegador: SOLO en la simulación de desarrollo. */
  completeFromClient(userId: string, id: string): { balance: BalanceView; reward: number } {
    if (!this.provider) throw new AppError(503, 'ADS_UNAVAILABLE', 'Los anuncios recompensados no están disponibles en este entorno.');
    if (!this.provider.clientCompletion || this.config.NODE_ENV === 'production') {
      throw forbidden('La recompensa la confirma el servidor del proveedor de anuncios');
    }
    return this.grant(id, userId, null, 'client-simulation');
  }

  /** Llamada servidor a servidor del proveedor, firmada con HMAC-SHA256. */
  handleCallback(body: unknown): { ok: true; duplicate: boolean } {
    if (!this.provider || this.provider.mode !== 'signed-callback' || !this.config.ADS_CALLBACK_SECRET) {
      throw new AppError(404, 'NOT_FOUND', 'No encontrado');
    }
    const c = body as Partial<SignedCallback>;
    if (typeof c?.sessionId !== 'string' || typeof c.userId !== 'string' || typeof c.providerTxId !== 'string'
      || typeof c.timestamp !== 'number' || typeof c.signature !== 'string' || c.providerTxId.length > 200 || c.sessionId.length > 100) {
      throw new AppError(400, 'BAD_CALLBACK', 'Llamada no válida');
    }
    const expected = Buffer.from(signCallback(this.config.ADS_CALLBACK_SECRET, c as SignedCallback), 'hex');
    const got = Buffer.from(c.signature, 'hex');
    if (got.length !== expected.length || !timingSafeEqual(got, expected)) {
      logger.warn('Anuncio: firma no válida', { sessionId: c.sessionId });
      throw new AppError(401, 'BAD_SIGNATURE', 'Firma no válida');
    }
    if (Math.abs(this.clock() / 1000 - c.timestamp) > this.config.ADS_CALLBACK_MAX_AGE_SEC) {
      throw new AppError(401, 'STALE_CALLBACK', 'Llamada caducada');
    }
    // Reintentos del proveedor: la misma transacción no se abona dos veces.
    const dup = this.db.get<{ id: string }>('SELECT id FROM ad_sessions WHERE provider_tx_id = ?', c.providerTxId);
    if (dup) return { ok: true, duplicate: true };
    this.grant(c.sessionId, c.userId, c.providerTxId, 'provider-callback');
    return { ok: true, duplicate: false };
  }

  private reject(id: string, reason: string, status: 'rejected' | 'expired' = 'rejected'): void {
    this.db.run(`UPDATE ad_sessions SET status = ?, reject_reason = ?, completed_at = ? WHERE id = ? AND status = 'started'`, status, reason, nowIso(), id);
  }

  private grant(id: string, userId: string, providerTxId: string | null, source: string): { balance: BalanceView; reward: number } {
    const out = this.db.tx(() => {
      const row = this.db.get<SessionRow>('SELECT * FROM ad_sessions WHERE id = ?', id);
      if (!row || row.user_id !== userId) throw notFound('Sesión de anuncio no encontrada');
      if (row.status === 'rewarded') throw conflict('ALREADY_REWARDED', 'Este anuncio ya se ha recompensado');
      if (row.status !== 'started') throw conflict('AD_SESSION_CLOSED', 'La sesión del anuncio ya no está activa');
      const age = this.clock() - Date.parse(row.created_at);
      if (age > SESSION_TTL_MS) {
        this.reject(id, 'expired', 'expired');
        return { error: conflict('AD_SESSION_EXPIRED', 'La sesión del anuncio ha caducado') };
      }
      const minWatch = getSetting(this.db, 'adsMinWatchSeconds') * 1000;
      if (age < minWatch) throw new AppError(400, 'AD_NOT_FINISHED', 'El anuncio aún no ha terminado');
      if (this.rewardedToday(userId) >= getSetting(this.db, 'adsDailyLimit')) {
        this.reject(id, 'daily_limit');
        return { error: new AppError(429, 'ADS_DAILY_LIMIT', 'Has alcanzado el límite de anuncios recompensados de hoy.') };
      }
      const upd = this.db.run(
        `UPDATE ad_sessions SET status = 'rewarded', provider_tx_id = ?, completed_at = ? WHERE id = ? AND status = 'started'`,
        providerTxId, nowIso(), id,
      );
      if (upd.changes !== 1) throw conflict('ALREADY_REWARDED', 'Este anuncio ya se ha recompensado');
      credit(this.db, userId, row.reward, 'ad_reward', { meta: { adSession: id, source } });
      logger.info('Anuncio recompensado', { userId, adSession: id, source, reward: row.reward });
      return { balance: getBalance(this.db, userId), reward: row.reward };
    });
    // Los rechazos se guardan (la transacción se confirma) y después se informa del error.
    if ('error' in out) throw out.error;
    return out;
  }
}
