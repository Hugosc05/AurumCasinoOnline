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
});

export type AppConfig = z.infer<typeof schema> & {
  dbFile: string;
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
  const dbFile = c.DATABASE_PATH === ':memory:' ? ':memory:' : path.resolve(SERVER_ROOT, c.DATABASE_PATH);
  return {
    ...c,
    dbFile,
    cookieSecure: c.COOKIE_SECURE ?? c.NODE_ENV === 'production',
    allowedOrigins: c.CLIENT_ORIGINS.split(',').map((s) => s.trim()).filter(Boolean),
  };
}
