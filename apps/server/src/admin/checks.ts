import { spawn } from 'node:child_process';
import { existsSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { REPO_ROOT, type AppConfig } from '../config';
import type { Database } from '../db/database';
import { logger } from '../lib/logger';
import { verifyLedger } from '../wallet/wallet';
import type { Alerter } from './alerts';
import type { HealthMonitor } from './health';
import { keyIsEphemeral } from './secrets';

export type CheckStatus = 'ok' | 'warn' | 'fail' | 'info';

export interface Check {
  id: string;
  group: 'Configuración' | 'Cuentas' | 'Datos' | 'Dependencias' | 'Avisos';
  label: string;
  status: CheckStatus;
  detail: string;
  /** Qué hacer para arreglarlo (si no está bien). */
  fix?: string;
}

export interface AuditResult {
  at: string;
  counts: { info: number; low: number; moderate: number; high: number; critical: number; total: number };
  dependencies: number;
  packages: { name: string; severity: string; title: string; direct: boolean; fix: boolean }[];
}

/**
 * Auditoría de dependencias con `npm audit` (vulnerabilidades publicadas en
 * los paquetes que usa el casino). Se ejecuta al arrancar y una vez al día.
 */
export class DependencyAudit {
  result: AuditResult | null = null;
  running = false;
  lastError: string | null = null;
  private timer: NodeJS.Timeout | null = null;

  constructor(private readonly alerts: Alerter, private readonly runner: () => Promise<string> = runNpmAudit) {}

  async run(): Promise<AuditResult | null> {
    if (this.running) return this.result;
    this.running = true;
    try {
      const raw = await this.runner();
      const prev = this.result;
      this.result = parseAudit(raw);
      this.lastError = null;
      const serious = this.result.counts.high + this.result.counts.critical;
      const before = prev ? prev.counts.high + prev.counts.critical : 0;
      if (serious > 0 && serious > before) {
        const names = this.result.packages.filter((p) => p.severity === 'high' || p.severity === 'critical').map((p) => p.name).slice(0, 5).join(', ');
        void this.alerts.notify('audit', 'warn', `npm audit: ${serious} vulnerabilidades graves en dependencias (${names}). Mira Seguridad en el panel.`, 24 * 3600_000);
      }
    } catch (err) {
      this.lastError = (err as Error).message;
      logger.warn('No se pudo ejecutar npm audit', { error: this.lastError });
    } finally {
      this.running = false;
    }
    return this.result;
  }

  schedule(firstDelayMs = 60_000, everyMs = 24 * 3600_000): void {
    const first = setTimeout(() => void this.run(), firstDelayMs);
    first.unref();
    this.timer = setInterval(() => void this.run(), everyMs);
    this.timer.unref();
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
  }
}

export function parseAudit(raw: string): AuditResult {
  const json = JSON.parse(raw) as {
    vulnerabilities?: Record<string, { name: string; severity: string; isDirect: boolean; via: (string | { title?: string })[]; fixAvailable: unknown }>;
    metadata?: { vulnerabilities?: Partial<AuditResult['counts']>; dependencies?: { prod?: number; total?: number } };
    error?: { summary?: string };
  };
  if (json.error) throw new Error(json.error.summary ?? 'npm audit devolvió un error');
  const m = json.metadata?.vulnerabilities ?? {};
  const counts = { info: m.info ?? 0, low: m.low ?? 0, moderate: m.moderate ?? 0, high: m.high ?? 0, critical: m.critical ?? 0, total: m.total ?? 0 };
  const order: Record<string, number> = { critical: 0, high: 1, moderate: 2, low: 3, info: 4 };
  const packages = Object.values(json.vulnerabilities ?? {})
    .map((v) => ({
      name: v.name,
      severity: v.severity,
      title: v.via.map((x) => (typeof x === 'string' ? `vía ${x}` : x.title ?? '')).filter(Boolean).join('; ').slice(0, 200),
      direct: v.isDirect,
      fix: !!v.fixAvailable,
    }))
    .sort((a, b) => (order[a.severity] ?? 9) - (order[b.severity] ?? 9));
  return { at: new Date().toISOString(), counts, dependencies: json.metadata?.dependencies?.prod ?? json.metadata?.dependencies?.total ?? 0, packages };
}

/** Ejecuta `npm audit --json --omit=dev` con el npm que acompaña al Node actual (también como servicio de Windows). */
function runNpmAudit(): Promise<string> {
  const nodeDir = path.dirname(process.execPath);
  const candidates = [
    path.join(nodeDir, 'node_modules', 'npm', 'bin', 'npm-cli.js'),
    path.join(nodeDir, '..', 'lib', 'node_modules', 'npm', 'bin', 'npm-cli.js'),
  ];
  const cli = candidates.find((c) => existsSync(c));
  const [cmd, args] = cli ? [process.execPath, [cli]] : [process.platform === 'win32' ? 'npm.cmd' : 'npm', []];
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, [...args, 'audit', '--json', '--omit=dev'], { cwd: REPO_ROOT, shell: !cli && process.platform === 'win32', windowsHide: true });
    let out = '';
    let err = '';
    const timer = setTimeout(() => child.kill(), 120_000);
    child.stdout.on('data', (d: Buffer) => (out += d.toString()));
    child.stderr.on('data', (d: Buffer) => (err += d.toString()));
    child.on('error', (e) => {
      clearTimeout(timer);
      reject(e);
    });
    // npm audit sale con código 1 cuando encuentra vulnerabilidades: lo que cuenta es el JSON.
    child.on('close', () => {
      clearTimeout(timer);
      if (out.trim().startsWith('{')) resolve(out);
      else reject(new Error(err.trim().split('\n').slice(-2).join(' ') || 'npm audit no devolvió datos (¿sin conexión?)'));
    });
  });
}

/** Comprobación periódica del libro mayor (saldos frente a movimientos). */
export class LedgerWatch {
  last: { at: string; checked: number; problems: { id: string; username: string; balance: number; ledgerBalance: number | null }[] } | null = null;
  private timer: NodeJS.Timeout | null = null;

  constructor(private readonly db: Database, private readonly alerts: Alerter) {}

  run() {
    const users = this.db.all<{ id: string; username: string }>(`SELECT id, username FROM users WHERE role = 'player'`);
    const problems = users
      .map((u) => ({ ...u, ...verifyLedger(this.db, u.id) }))
      .filter((u) => !u.ok && !(u.balance === 0 && u.ledgerBalance === null))
      .map(({ id, username, balance, ledgerBalance }) => ({ id, username, balance, ledgerBalance }));
    this.last = { at: new Date().toISOString(), checked: users.length, problems };
    if (problems.length) void this.alerts.notify('ledger', 'critical', `El saldo de ${problems.length} jugador(es) no cuadra con sus movimientos (${problems.slice(0, 3).map((p) => p.username).join(', ')}). Revisa Seguridad.`, 24 * 3600_000);
    return this.last;
  }

  schedule(everyMs = 24 * 3600_000): void {
    const first = setTimeout(() => this.safeRun(), 5 * 60_000);
    first.unref();
    this.timer = setInterval(() => this.safeRun(), everyMs);
    this.timer.unref();
  }

  private safeRun(): void {
    try {
      this.run();
    } catch (err) {
      logger.warn('Fallo en la comprobación del libro mayor', { error: (err as Error).message });
    }
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
  }
}

export function backupDir(config: AppConfig): string | null {
  if (config.DATABASE_URL || config.dbFile === ':memory:') return null;
  return path.resolve(process.env.BACKUP_DIR ?? path.join(path.dirname(config.dbFile), 'copias'));
}

export function lastBackup(config: AppConfig): { file: string; at: string; ageHours: number; sizeMb: number } | null {
  const dir = backupDir(config);
  if (!dir || !existsSync(dir)) return null;
  const files = readdirSync(dir).filter((f) => /^aurum-.*\.db$/.test(f)).map((f) => {
    const st = statSync(path.join(dir, f));
    return { file: path.join(dir, f), mtime: st.mtimeMs, size: st.size };
  });
  const newest = files.sort((a, b) => b.mtime - a.mtime)[0];
  if (!newest) return null;
  return { file: newest.file, at: new Date(newest.mtime).toISOString(), ageHours: Math.round((Date.now() - newest.mtime) / 360_000) / 10, sizeMb: Math.round(newest.size / 1e5) / 10 };
}

interface CheckDeps {
  config: AppConfig;
  db: Database;
  health: HealthMonitor;
  audit: DependencyAudit;
  ledger: LedgerWatch;
  alerts: Alerter;
  mfaRequired: boolean;
}

/** Lista de comprobaciones de seguridad que se muestran en el panel. */
export function runChecks(d: CheckDeps): Check[] {
  const { config, db } = d;
  const out: Check[] = [];
  const prod = config.NODE_ENV === 'production';
  const loopback = ['127.0.0.1', '::1', 'localhost'].includes(config.HOST);

  out.push({
    id: 'env', group: 'Configuración', label: 'Modo producción',
    status: prod ? 'ok' : 'warn', detail: `NODE_ENV=${config.NODE_ENV}`,
    fix: prod ? undefined : 'Pon NODE_ENV=production en el .env del servidor.',
  });
  out.push({
    id: 'cookies', group: 'Configuración', label: 'Cookies de sesión seguras (solo HTTPS, httpOnly, SameSite=Strict)',
    status: config.cookieSecure ? 'ok' : prod ? 'fail' : 'warn', detail: config.cookieSecure ? 'Activadas' : 'Desactivadas',
    fix: config.cookieSecure ? undefined : 'Sirve la web por HTTPS y deja COOKIE_SECURE sin definir o en true.',
  });
  out.push({
    id: 'bind', group: 'Configuración', label: 'El servidor solo escucha en el propio equipo',
    status: loopback ? 'ok' : config.TRUST_PROXY ? 'fail' : 'warn',
    detail: `HOST=${config.HOST}${config.TRUST_PROXY ? ' · TRUST_PROXY=true' : ''}`,
    fix: loopback ? undefined : config.TRUST_PROXY
      ? 'Con TRUST_PROXY=true y HOST abierto, alguien de tu red podría falsear su IP y saltarse los límites. Usa HOST=127.0.0.1 (el túnel llega por ahí).'
      : 'Si usas un túnel (Tailscale o Cloudflare), pon HOST=127.0.0.1 para que nadie de tu red entre sin pasar por él.',
  });
  out.push({
    id: 'headers', group: 'Configuración', label: 'Cabeceras de seguridad (CSP, HSTS, anti-clickjacking) y protección CSRF',
    status: 'ok', detail: config.cookieSecure ? 'Activas, con HSTS' : 'Activas (HSTS solo con HTTPS)',
  });
  out.push({
    id: 'secrets', group: 'Configuración', label: 'Credenciales externas cifradas en reposo',
    status: keyIsEphemeral && prod ? 'warn' : 'ok',
    detail: keyIsEphemeral ? 'Clave temporal: las credenciales guardadas se pierden al reiniciar' : 'AES-256-GCM con clave en secrets.key',
    fix: keyIsEphemeral && prod ? 'Define SECRETS_KEY (64 caracteres hexadecimales) en las variables de entorno.' : undefined,
  });
  const nodeMajor = Number(process.versions.node.split('.')[0]);
  out.push({
    id: 'node', group: 'Dependencias', label: 'Versión de Node.js con soporte',
    status: nodeMajor >= 22 && nodeMajor % 2 === 0 ? 'ok' : 'warn', detail: process.version,
    fix: nodeMajor >= 22 && nodeMajor % 2 === 0 ? undefined : 'Instala la versión LTS de Node.js (actualizar.ps1 en el mini PC).',
  });

  // Cuentas
  const admins = db.all<{ id: string; username: string; mfa: number | null }>(
    `SELECT u.id, u.username, m.enabled AS mfa FROM users u LEFT JOIN admin_mfa m ON m.user_id = u.id WHERE u.role = 'admin' AND u.status = 'active'`,
  );
  const noMfa = admins.filter((a) => !a.mfa);
  out.push({
    id: 'mfa', group: 'Cuentas', label: 'Todos los administradores con verificación en dos pasos',
    status: noMfa.length === 0 ? 'ok' : 'fail',
    detail: noMfa.length === 0 ? `${admins.length} administrador(es), todos con 2FA` : `Sin 2FA: ${noMfa.map((a) => a.username).join(', ')}`,
    fix: noMfa.length ? 'Cada administrador debe activarla en el panel (Seguridad → Verificación en dos pasos).' : undefined,
  });
  out.push({
    id: 'mfa-required', group: 'Cuentas', label: '2FA obligatoria para entrar al panel',
    status: d.mfaRequired ? 'ok' : 'warn', detail: d.mfaRequired ? 'Obligatoria' : 'Opcional',
    fix: d.mfaRequired ? undefined : 'Pon ADMIN_MFA_REQUIRED=true (es el valor por defecto en producción).',
  });
  out.push({
    id: 'admins', group: 'Cuentas', label: 'Número de administradores',
    status: admins.length <= 3 ? 'ok' : 'warn', detail: `${admins.length}: ${admins.map((a) => a.username).join(', ')}`,
    fix: admins.length > 3 ? 'Cuantos menos administradores, menos riesgo: quita el rol a quien no lo necesite.' : undefined,
  });
  const since = new Date(Date.now() - 24 * 3600_000).toISOString();
  const failed = db.get<{ n: number }>(`SELECT COUNT(*) AS n FROM security_events WHERE kind IN ('login_failed','login_locked') AND created_at >= ?`, since)!.n;
  out.push({
    id: 'bruteforce', group: 'Cuentas', label: 'Intentos de acceso fallidos (24 h)',
    status: failed > 100 ? 'warn' : 'ok', detail: `${failed} registrados`,
    fix: failed > 100 ? 'Revisa las IP en «Eventos»: si es un ataque, los límites ya lo frenan; puedes suspender cuentas afectadas.' : undefined,
  });

  // Datos
  if (db.dialect === 'sqlite') {
    const integrity = db.get<{ quick_check: string }>('PRAGMA quick_check')?.quick_check ?? 'desconocido';
    out.push({
      id: 'integrity', group: 'Datos', label: 'Integridad de la base de datos',
      status: integrity === 'ok' ? 'ok' : 'fail', detail: integrity,
      fix: integrity === 'ok' ? undefined : 'Para el servicio y restaura la última copia (DEPLOY-CASA.md → Restaurar una copia).',
    });
    const b = lastBackup(config);
    out.push({
      id: 'backup', group: 'Datos', label: 'Copia de seguridad reciente',
      status: !b ? 'fail' : b.ageHours <= 30 ? 'ok' : 'warn',
      detail: b ? `Hace ${b.ageHours} h (${b.sizeMb} MB) en ${path.dirname(b.file)}` : `No hay copias en ${backupDir(config)}`,
      fix: !b || b.ageHours > 30 ? 'Comprueba la tarea programada «Aurum - copia de seguridad» o ejecuta npm run db:backup -w @aurum/server.' : undefined,
    });
  } else {
    out.push({ id: 'backup', group: 'Datos', label: 'Copias de seguridad', status: 'info', detail: 'PostgreSQL: las copias las hace el proveedor (Supabase).' });
  }
  const disk = d.health.disk();
  if (disk) {
    out.push({
      id: 'disk', group: 'Datos', label: 'Espacio libre en disco',
      status: disk.freePct >= 15 ? 'ok' : disk.freePct >= 8 ? 'warn' : 'fail', detail: `${disk.freeGb} GB libres (${disk.freePct} %)`,
      fix: disk.freePct < 15 ? 'Libera espacio en el disco del servidor.' : undefined,
    });
  }
  const l = d.ledger.last;
  out.push({
    id: 'ledger', group: 'Datos', label: 'Saldos cuadran con el libro mayor',
    status: !l ? 'info' : l.problems.length ? 'fail' : 'ok',
    detail: l ? `${l.checked} jugadores revisados, ${l.problems.length} con diferencias (${new Date(l.at).toLocaleString('es-ES')})` : 'Pendiente (se revisa a diario)',
    fix: l?.problems.length ? 'Revisa los movimientos de esos jugadores en Usuarios.' : undefined,
  });

  // Dependencias
  const a = d.audit.result;
  out.push({
    id: 'audit', group: 'Dependencias', label: 'Vulnerabilidades conocidas en dependencias (npm audit)',
    status: !a ? (d.audit.lastError ? 'warn' : 'info') : a.counts.critical + a.counts.high > 0 ? 'fail' : a.counts.moderate > 0 ? 'warn' : 'ok',
    detail: !a
      ? d.audit.lastError ? `No se pudo analizar: ${d.audit.lastError}` : d.audit.running ? 'Analizando…' : 'Pendiente'
      : `${a.counts.critical} críticas, ${a.counts.high} altas, ${a.counts.moderate} moderadas, ${a.counts.low} bajas · ${a.dependencies} paquetes`,
    fix: a && a.counts.total > 0 ? 'Actualiza el casino (actualizar.ps1). Si persisten, pídeme que actualice las dependencias afectadas.' : undefined,
  });

  // Avisos
  const st = d.alerts.status();
  out.push({
    id: 'telegram', group: 'Avisos', label: 'Avisos al móvil (Telegram)',
    status: st.telegram.configured ? (st.lastError ? 'warn' : 'ok') : 'warn',
    detail: st.telegram.configured ? (st.lastError ?? `Configurados · ${st.sent} enviados desde el arranque`) : 'Sin configurar',
    fix: st.telegram.configured && !st.lastError ? undefined : 'Configúralos en Seguridad → Avisos.',
  });
  out.push({
    id: 'heartbeat', group: 'Avisos', label: 'Aviso si el servidor se cae (latido externo)',
    status: st.heartbeat.configured ? 'ok' : 'warn', detail: st.heartbeat.configured ? 'Configurado' : 'Sin configurar',
    fix: st.heartbeat.configured ? undefined : 'Crea un check gratuito en healthchecks.io conectado a tu Telegram y pega su URL en Seguridad → Avisos.',
  });
  return out;
}
