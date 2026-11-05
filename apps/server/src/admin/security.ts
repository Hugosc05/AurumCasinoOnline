import type { RequestHandler } from 'express';
import type { Database } from '../db/database';
import { clientIp } from '../lib/http';
import type { Alerter } from './alerts';

export type SecurityKind =
  | 'login_failed'
  | 'login_locked'
  | 'login_banned'
  | 'rate_limited'
  | 'csrf_blocked'
  | 'ws_origin_blocked'
  | 'probe'
  | 'admin_login'
  | 'admin_new_ip'
  | 'mfa_failed'
  | 'mfa_enabled'
  | 'mfa_disabled'
  | 'mfa_recovery_used'
  | 'user_kicked'
  | 'secret_changed';

const SEVERITY: Record<SecurityKind, 'info' | 'warn' | 'high'> = {
  login_failed: 'warn',
  login_locked: 'high',
  login_banned: 'warn',
  rate_limited: 'warn',
  csrf_blocked: 'warn',
  ws_origin_blocked: 'warn',
  probe: 'warn',
  admin_login: 'info',
  admin_new_ip: 'high',
  mfa_failed: 'high',
  mfa_enabled: 'info',
  mfa_disabled: 'high',
  mfa_recovery_used: 'high',
  user_kicked: 'info',
  secret_changed: 'info',
};

export const SECURITY_LABEL: Record<SecurityKind, string> = {
  login_failed: 'Inicio de sesión fallido',
  login_locked: 'Cuenta bloqueada por intentos',
  login_banned: 'Intento de entrar con cuenta suspendida',
  rate_limited: 'Límite de peticiones superado',
  csrf_blocked: 'Petición de otro sitio bloqueada (CSRF)',
  ws_origin_blocked: 'Conexión en tiempo real de otro sitio bloqueada',
  probe: 'Sondeo de vulnerabilidades',
  admin_login: 'Entrada de administrador',
  admin_new_ip: 'Administrador desde una IP nueva',
  mfa_failed: 'Código 2FA incorrecto',
  mfa_enabled: '2FA activada',
  mfa_disabled: '2FA desactivada',
  mfa_recovery_used: 'Código de recuperación 2FA usado',
  user_kicked: 'Usuario expulsado',
  secret_changed: 'Credencial externa cambiada',
};

/**
 * Rutas que solo pide un escáner de vulnerabilidades (WordPress, PHP, Git,
 * archivos de configuración…). Este servidor no tiene ninguna de ellas.
 */
const PROBE = /(^\/(wp-|wordpress|xmlrpc\.php|phpmyadmin|pma|adminer|cgi-bin|vendor\/|boaform|actuator))|(\.(php|asp|aspx|jsp|cgi|env|ini|sql|bak|old|swp)$)|(\/\.(env|git|svn|hg|aws|ssh|DS_Store|htaccess|htpasswd)(\/|$))|(\/(config|credentials|secrets)\.(json|yml|yaml)$)/i;

export const isProbePath = (p: string): boolean => PROBE.test(p);

interface Window {
  hits: number[];
}

/**
 * Registro de eventos de seguridad con detección de patrones:
 *  - fuerza bruta: muchos inicios de sesión fallidos desde una IP;
 *  - escaneo: varias rutas de sondeo desde una IP;
 * y avisos por Telegram. Para que un ataque no llene la base de datos, cada
 * combinación tipo+IP se guarda como mucho una vez cada 10 s (el resto se cuenta).
 */
export class SecurityLog {
  private windows = new Map<string, Window>();
  private lastWrite = new Map<string, number>();
  private suppressed = 0;

  constructor(
    private readonly db: Database,
    private readonly alerts: Alerter,
    private readonly clock: () => number = Date.now,
  ) {}

  record(kind: SecurityKind, info: { ip?: string | null; userId?: string | null; detail?: string | null } = {}): void {
    const now = this.clock();
    const ip = info.ip ?? null;
    const throttleKey = `${kind}|${ip}|${info.userId ?? ''}`;
    const prev = this.lastWrite.get(throttleKey);
    const severity = SEVERITY[kind];
    if (prev !== undefined && now - prev < 10_000 && severity !== 'high') {
      this.suppressed += 1;
    } else {
      this.lastWrite.set(throttleKey, now);
      if (this.lastWrite.size > 20_000) this.lastWrite.clear();
      try {
        this.db.run(
          'INSERT INTO security_events (kind, severity, ip, user_id, detail, created_at) VALUES (?, ?, ?, ?, ?, ?)',
          kind, severity, ip, info.userId ?? null, info.detail?.slice(0, 500) ?? null, new Date(now).toISOString(),
        );
      } catch {
        /* nunca romper una petición por el registro */
      }
    }
    this.detect(kind, ip, info, now);
  }

  /** Cuenta eventos por IP en una ventana de 10 minutos y avisa al superar el umbral. */
  private bump(key: string, now: number): number {
    const w = this.windows.get(key) ?? { hits: [] };
    w.hits = w.hits.filter((t) => now - t < 10 * 60_000);
    w.hits.push(now);
    this.windows.set(key, w);
    if (this.windows.size > 20_000) this.windows.clear();
    return w.hits.length;
  }

  private detect(kind: SecurityKind, ip: string | null, info: { userId?: string | null; detail?: string | null }, now: number): void {
    const who = ip ?? 'IP desconocida';
    switch (kind) {
      case 'login_failed':
        if (ip && this.bump(`login|${ip}`, now) === 15) {
          void this.alerts.notify(`brute|${ip}`, 'critical', `Posible ataque de fuerza bruta: 15 contraseñas fallidas en 10 min desde ${who}.`);
        }
        break;
      case 'login_locked':
        void this.alerts.notify(`locked|${info.detail ?? ''}`, 'warn', `Cuenta bloqueada temporalmente por intentos fallidos: ${info.detail ?? '?'} (desde ${who}).`);
        break;
      case 'probe':
        if (ip && this.bump(`probe|${ip}`, now) === 10) {
          void this.alerts.notify(`scan|${ip}`, 'warn', `Escaneo de vulnerabilidades desde ${who} (10 rutas sospechosas en 10 min, p. ej. ${info.detail ?? ''}). No hay nada que encontrar, pero conviene saberlo.`);
        }
        break;
      case 'mfa_failed':
        void this.alerts.notify(`mfa|${info.userId ?? ''}`, 'critical', `Código 2FA incorrecto en una cuenta de administrador desde ${who}. Si no has sido tú, cambia la contraseña.`, 5 * 60_000);
        break;
      case 'mfa_disabled':
        void this.alerts.notify(`mfaoff|${info.userId ?? ''}`, 'critical', `Se ha desactivado la verificación en dos pasos de un administrador (${info.detail ?? ''}) desde ${who}.`, 0);
        break;
      case 'mfa_recovery_used':
        void this.alerts.notify(`mfarec|${info.userId ?? ''}`, 'warn', `Se ha usado un código de recuperación 2FA (${info.detail ?? ''}) desde ${who}.`, 0);
        break;
      case 'admin_new_ip':
        void this.alerts.notify(`adminip|${info.userId ?? ''}|${ip}`, 'warn', `Entrada de administrador desde una IP nueva: ${info.detail ?? ''} (${who}).`, 0);
        break;
      default:
        break;
    }
  }

  stats() {
    return { suppressed: this.suppressed };
  }

  /** Middleware: responde 404 a rutas de sondeo y lo registra. */
  probeTrap(): RequestHandler {
    return (req, res, next) => {
      if (!isProbePath(req.path)) return next();
      this.record('probe', { ip: clientIp(req), detail: `${req.method} ${req.path}`.slice(0, 200) });
      res.status(404).type('text/plain').send('Not found');
    };
  }

  purgeOld(days = 90): void {
    this.db.run('DELETE FROM security_events WHERE created_at < ?', new Date(this.clock() - days * 86_400_000).toISOString());
  }
}

