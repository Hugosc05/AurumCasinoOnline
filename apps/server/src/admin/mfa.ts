import { createHash } from 'node:crypto';
import type { RequestHandler } from 'express';
import QRCode from 'qrcode';
import type { Database } from '../db/database';
import { nowIso } from '../db/database';
import { AppError } from '../lib/errors';
import { RateLimiter } from '../lib/rateLimit';
import { generateRecoveryCodes, generateSecret, hashRecoveryCode, otpauthUri, stepAt, verifyTotp } from '../auth/totp';
import type { SecurityLog } from './security';

interface MfaRow {
  user_id: string;
  secret: string;
  enabled: number;
  recovery_json: string;
  last_step: number;
}

/** Tras superar el segundo paso, el panel no lo vuelve a pedir durante 12 horas en esa sesión. */
export const MFA_SESSION_HOURS = 12;

const tokenHash = (token: string): string => createHash('sha256').update(token).digest('hex');

/**
 * Verificación en dos pasos (TOTP) para administradores, en modo «step-up»:
 * el inicio de sesión normal no cambia (el jugador no nota nada), pero para
 * usar el panel la sesión debe haber superado un código en las últimas 12 h.
 * Si `required` es true, un administrador sin 2FA solo puede configurarla.
 */
export class MfaService {
  private attempts = new RateLimiter(6, 15 * 60_000);

  constructor(
    private readonly db: Database,
    private readonly security: SecurityLog,
    readonly required: boolean,
    private readonly clock: () => number = Date.now,
  ) {}

  private row(userId: string): MfaRow | undefined {
    return this.db.get<MfaRow>('SELECT user_id, secret, enabled, recovery_json, last_step FROM admin_mfa WHERE user_id = ?', userId);
  }

  enabled(userId: string): boolean {
    return !!this.row(userId)?.enabled;
  }

  /** ¿Superó esta sesión el segundo paso hace menos de 12 h? */
  sessionVerified(token: string | undefined): boolean {
    if (!token) return false;
    const r = this.db.get<{ mfa_at: string | null }>('SELECT mfa_at FROM sessions WHERE id_hash = ?', tokenHash(token));
    return !!r?.mfa_at && this.clock() - Date.parse(r.mfa_at) < MFA_SESSION_HOURS * 3600_000;
  }

  private markSession(token: string | undefined): void {
    if (token) this.db.run('UPDATE sessions SET mfa_at = ? WHERE id_hash = ?', new Date(this.clock()).toISOString(), tokenHash(token));
  }

  status(userId: string, token: string | undefined) {
    const enabled = this.enabled(userId);
    return {
      enabled,
      required: this.required,
      verified: enabled && this.sessionVerified(token),
      recoveryLeft: enabled ? (JSON.parse(this.row(userId)!.recovery_json) as string[]).length : 0,
    };
  }

  /** Paso 1: secreto nuevo (pendiente hasta confirmar un código). Devuelve el QR para la app. */
  async begin(userId: string, account: string): Promise<{ secret: string; uri: string; qr: string }> {
    if (this.enabled(userId)) throw new AppError(409, 'MFA_ALREADY_ENABLED', 'La verificación en dos pasos ya está activada');
    const secret = generateSecret();
    this.db.run(
      `INSERT INTO admin_mfa (user_id, secret, enabled, recovery_json, last_step, created_at) VALUES (?, ?, 0, '[]', 0, ?)
       ON CONFLICT(user_id) DO UPDATE SET secret = excluded.secret, enabled = 0, recovery_json = '[]', last_step = 0, created_at = excluded.created_at, enabled_at = NULL`,
      userId, secret, nowIso(),
    );
    const uri = otpauthUri(secret, account);
    const svg = await QRCode.toString(uri, { type: 'svg', margin: 1, errorCorrectionLevel: 'M', color: { dark: '#0b0f17', light: '#ffffff' } });
    return { secret, uri, qr: `data:image/svg+xml;base64,${Buffer.from(svg).toString('base64')}` };
  }

  /** Paso 2: confirma el primer código, activa la 2FA y entrega los códigos de recuperación (solo esta vez). */
  enable(userId: string, code: string, token: string | undefined, ip: string): string[] {
    const r = this.row(userId);
    if (!r) throw new AppError(400, 'MFA_NOT_STARTED', 'Primero genera el código QR');
    if (r.enabled) throw new AppError(409, 'MFA_ALREADY_ENABLED', 'La verificación en dos pasos ya está activada');
    this.throttle(userId);
    const step = verifyTotp(r.secret, code, 0, this.clock());
    if (step === null) {
      this.security.record('mfa_failed', { ip, userId, detail: 'activación' });
      throw new AppError(400, 'MFA_INVALID', 'Código incorrecto. Comprueba que la hora del móvil es automática.');
    }
    const codes = generateRecoveryCodes();
    this.db.run(
      'UPDATE admin_mfa SET enabled = 1, last_step = ?, recovery_json = ?, enabled_at = ? WHERE user_id = ?',
      step, JSON.stringify(codes.map(hashRecoveryCode)), nowIso(), userId,
    );
    this.attempts.reset(userId);
    this.markSession(token);
    this.security.record('mfa_enabled', { ip, userId });
    return codes;
  }

  /** Verifica un código de la app o uno de recuperación (que se gasta) y marca la sesión. */
  verify(userId: string, username: string, code: string, token: string | undefined, ip: string): { usedRecovery: boolean } {
    const r = this.row(userId);
    if (!r?.enabled) throw new AppError(400, 'MFA_NOT_ENABLED', 'La verificación en dos pasos no está activada');
    this.throttle(userId);
    const clean = code.trim();
    if (/^\d{6}$/.test(clean.replace(/\s/g, ''))) {
      const step = verifyTotp(r.secret, clean, r.last_step, this.clock());
      if (step !== null) {
        this.db.run('UPDATE admin_mfa SET last_step = ? WHERE user_id = ?', step, userId);
        this.attempts.reset(userId);
        this.markSession(token);
        return { usedRecovery: false };
      }
    } else {
      const hashes = JSON.parse(r.recovery_json) as string[];
      const h = hashRecoveryCode(clean);
      if (hashes.includes(h)) {
        this.db.run('UPDATE admin_mfa SET recovery_json = ? WHERE user_id = ?', JSON.stringify(hashes.filter((x) => x !== h)), userId);
        this.attempts.reset(userId);
        this.markSession(token);
        this.security.record('mfa_recovery_used', { ip, userId, detail: `${username}; quedan ${hashes.length - 1}` });
        return { usedRecovery: true };
      }
    }
    this.security.record('mfa_failed', { ip, userId, detail: username });
    throw new AppError(400, 'MFA_INVALID', 'Código incorrecto');
  }

  disable(userId: string, username: string, ip: string): void {
    this.db.run('DELETE FROM admin_mfa WHERE user_id = ?', userId);
    this.db.run('UPDATE sessions SET mfa_at = NULL WHERE user_id = ?', userId);
    this.security.record('mfa_disabled', { ip, userId, detail: username });
  }

  private throttle(userId: string): void {
    const wait = this.attempts.hit(userId, this.clock());
    if (wait > 0) throw new AppError(429, 'MFA_RATE_LIMITED', 'Demasiados intentos. Espera unos minutos.', { retryAfterSec: wait });
  }

  /**
   * Middleware para todo el panel (excepto las rutas de 2FA): exige que la
   * sesión haya superado el segundo paso. Responde 403 con un código que el
   * panel entiende para mostrar la pantalla adecuada.
   */
  gate(): RequestHandler {
    return (req, _res, next) => {
      const user = req.user!;
      if (this.enabled(user.id)) {
        if (this.sessionVerified(req.sessionToken)) return next();
        return next(new AppError(403, 'MFA_REQUIRED', 'Introduce el código de verificación en dos pasos'));
      }
      if (this.required) return next(new AppError(403, 'MFA_SETUP_REQUIRED', 'Activa la verificación en dos pasos para usar el panel'));
      next();
    };
  }

  /** Para pruebas: paso TOTP actual. */
  currentStep(): number {
    return stepAt(this.clock());
  }
}
