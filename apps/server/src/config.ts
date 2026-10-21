import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';

const here = path.dirname(fileURLToPath(import.meta.url));
export const SERVER_ROOT = path.resolve(here, '..');
export const REPO_ROOT = path.resolve(SERVER_ROOT, '..', '..');

/** Carga mínima de `.env` (sin dependencias). Las variables ya definidas tienen prioridad. */
function loadDotEnv(): void {
  for (const file of [path.join(REPO_ROOT, '.env'), path.join(SERVER_ROOT, '.env')]) {
    if (!existsSync(file)) continue;
    for (const raw of readFileSync(file, 'utf8').split(/\r?\n/)) {
      const line = raw.trim();
      if (!line || line.startsWith('#')) continue;
      const eq = line.indexOf('=');
      if (eq === -1) continue;
      const key = line.slice(0, eq).trim();
      let value = line.slice(eq + 1).trim();
      if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
        value = value.slice(1, -1);
      }
      if (process.env[key] === undefined) process.env[key] = value;
    }
  }
}
loadDotEnv();

const bool = z
  .enum(['true', 'false', '1', '0'])
  .transform((v) => v === 'true' || v === '1');

const schema = z.object({
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  PORT: z.coerce.number().int().min(1).max(65535).default(3001),
  HOST: z.string().default('127.0.0.1'),
  DATABASE_PATH: z.string().default('data/aurum.db'),
  /**
   * PostgreSQL (p. ej. Supabase). Si se define, se usa en lugar del archivo SQLite.
   * Formato: postgresql://usuario:contraseña@host:5432/postgres
   */
  DATABASE_URL: z.preprocess(
    (v) => (v === '' ? undefined : v),
    z.string().regex(/^(postgres(ql)?|pglite):/, 'DATABASE_URL debe empezar por postgresql://').optional(),
  ),
  /** Certificado de la autoridad de la BD (PEM) para verificar TLS; opcional. */
  DATABASE_SSL_CA: z.string().optional(),
  /** Dirección pública que asigna Render automáticamente (se añade a los orígenes permitidos). */
  RENDER_EXTERNAL_URL: z.string().url().optional(),
  /**
   * Mantener despierto el servicio: cada 5 minutos el servidor se llama a sí mismo por
   * su dirección pública (por defecto, RENDER_EXTERNAL_URL). Desactívalo con KEEPALIVE=false.
   */
  KEEPALIVE: bool.default(true),
  KEEPALIVE_URL: z.string().url().optional(),
  /** Orígenes permitidos (CORS + comprobación anti-CSRF), separados por comas. */
  CLIENT_ORIGINS: z.string().default('http://localhost:5173,http://127.0.0.1:5173,http://localhost:3001,http://127.0.0.1:3001'),
  COOKIE_SECURE: bool.optional(),
  SESSION_TTL_HOURS: z.coerce.number().int().min(1).max(24 * 90).default(24 * 7),
  STARTING_BALANCE: z.coerce.number().int().min(0).max(10_000_000).default(10_000),
  TRUST_PROXY: bool.default(false),
  /** Desactiva la temporización de los bots de póker (solo pruebas). */
  POKER_FAST_MODE: bool.default(false),
  /** Límites anti-abuso (por IP). */
  REGISTER_LIMIT_PER_HOUR: z.coerce.number().int().min(1).default(10),
  LOGIN_LIMIT_PER_15MIN: z.coerce.number().int().min(1).default(30),
  LOG_LEVEL: z.enum(['debug', 'info', 'warn', 'error']).default('info'),
  /**
   * Anuncios recompensados:
   *  - none (por defecto): no hay anuncios; la interfaz lo indica.
   *  - dev-simulation: simulación de desarrollo claramente etiquetada. Prohibida en producción.
   *  - signed-callback: el proveedor confirma cada anuncio con una llamada servidor a servidor firmada (HMAC-SHA256).
   */
  ADS_PROVIDER: z.enum(['none', 'dev-simulation', 'signed-callback']).default('none'),
  ADS_CALLBACK_SECRET: z.string().min(32, 'ADS_CALLBACK_SECRET debe tener al menos 32 caracteres').optional(),
  ADS_CALLBACK_MAX_AGE_SEC: z.coerce.number().int().min(30).max(3600).default(300),
});

export type AppConfig = z.infer<typeof schema> & {
  dbFile: string;
  /** Destino real de la base de datos: la URL de PostgreSQL o el archivo SQLite. */
  dbTarget: string;
  /** Dirección pública a la que hacer ping para que el servicio no se duerma (o null). */
  keepAliveUrl: string | null;
  cookieSecure: boolean;
  allowedOrigins: string[];
};

export function loadConfig(overrides: Partial<Record<keyof z.infer<typeof schema>, string>> = {}): AppConfig {
  const parsed = schema.safeParse({ ...process.env, ...overrides });
  if (!parsed.success) {
    const msg = parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('\n');
    throw new Error(`Configuración no válida:\n${msg}`);
  }
  const c = parsed.data;
  // Las pruebas nunca deben escribir en una base de datos real configurada en .env (p. ej. Supabase):
  // en modo test solo se acepta PGlite, que es local y temporal.
  if (c.NODE_ENV === 'test' && c.DATABASE_URL && !c.DATABASE_URL.startsWith('pglite:') && !overrides.DATABASE_URL) {
    c.DATABASE_URL = undefined;
  }
  if (c.ADS_PROVIDER === 'dev-simulation' && c.NODE_ENV === 'production') {
    throw new Error('Configuración no válida:\nADS_PROVIDER=dev-simulation no se puede usar en producción.');
  }
  if (c.ADS_PROVIDER === 'signed-callback' && !c.ADS_CALLBACK_SECRET) {
    throw new Error('Configuración no válida:\nADS_PROVIDER=signed-callback necesita ADS_CALLBACK_SECRET.');
  }
  const dbFile = c.DATABASE_PATH === ':memory:' ? ':memory:' : path.resolve(SERVER_ROOT, c.DATABASE_PATH);
  const origins = c.CLIENT_ORIGINS.split(',').map((s) => s.trim().replace(/\/$/, '')).filter(Boolean);
  if (c.RENDER_EXTERNAL_URL) origins.push(c.RENDER_EXTERNAL_URL.replace(/\/$/, ''));
  const keepAliveBase = c.KEEPALIVE_URL ?? c.RENDER_EXTERNAL_URL;
  return {
    ...c,
    dbFile,
    dbTarget: c.DATABASE_URL ?? dbFile,
    keepAliveUrl: c.KEEPALIVE && keepAliveBase && c.NODE_ENV !== 'test' ? `${keepAliveBase.replace(/\/$/, '')}/api/health` : null,
    cookieSecure: c.COOKIE_SECURE ?? c.NODE_ENV === 'production',
    allowedOrigins: [...new Set(origins)],
  };
}
