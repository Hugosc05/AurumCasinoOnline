import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import type { AppConfig } from '../config';
import type { Database } from '../db/database';
import { nowIso } from '../db/database';

/**
 * Credenciales de servicios externos (AdSense, Telegram, latido) guardadas en
 * `app_secrets` cifradas con AES-256-GCM. La clave vive en un archivo aparte
 * (`secrets.key`, junto a la base de datos o en SECRETS_KEY): una copia de la
 * base de datos por sí sola no revela los tokens.
 */
export class SecretStore {
  private key: Buffer;

  constructor(private readonly db: Database, config: AppConfig) {
    this.key = loadKey(config);
  }

  get<T>(name: string): T | null {
    const row = this.db.get<{ value: string }>('SELECT value FROM app_secrets WHERE key = ?', name);
    if (!row) return null;
    try {
      return JSON.parse(this.decrypt(row.value)) as T;
    } catch {
      return null;
    }
  }

  set(name: string, value: unknown): void {
    const enc = this.encrypt(JSON.stringify(value));
    this.db.run(
      `INSERT INTO app_secrets (key, value, updated_at) VALUES (?, ?, ?)
       ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`,
      name, enc, nowIso(),
    );
  }

  delete(name: string): void {
    this.db.run('DELETE FROM app_secrets WHERE key = ?', name);
  }

  private encrypt(plain: string): string {
    const iv = randomBytes(12);
    const c = createCipheriv('aes-256-gcm', this.key, iv);
    const body = Buffer.concat([c.update(plain, 'utf8'), c.final()]);
    return `v1:${iv.toString('base64')}:${c.getAuthTag().toString('base64')}:${body.toString('base64')}`;
  }

  private decrypt(stored: string): string {
    const [v, iv, tag, body] = stored.split(':');
    if (v !== 'v1' || !iv || !tag || !body) throw new Error('Formato de secreto no válido');
    const d = createDecipheriv('aes-256-gcm', this.key, Buffer.from(iv, 'base64'));
    d.setAuthTag(Buffer.from(tag, 'base64'));
    return Buffer.concat([d.update(Buffer.from(body, 'base64')), d.final()]).toString('utf8');
  }
}

function loadKey(config: AppConfig): Buffer {
  const fromEnv = process.env.SECRETS_KEY;
  if (fromEnv && /^[0-9a-f]{64}$/i.test(fromEnv)) return Buffer.from(fromEnv, 'hex');
  // Memoria (pruebas) o PostgreSQL sin disco propio (Render): clave efímera del proceso.
  // Sin SECRETS_KEY, en ese caso los secretos no sobreviven a un reinicio (se avisa en Seguridad).
  if (config.dbFile === ':memory:' || config.DATABASE_URL) {
    keyIsEphemeral = true;
    return ephemeralKey;
  }
  const file = path.join(path.dirname(config.dbFile), 'secrets.key');
  if (existsSync(file)) return Buffer.from(readFileSync(file, 'utf8').trim(), 'hex');
  mkdirSync(path.dirname(file), { recursive: true });
  const key = randomBytes(32);
  writeFileSync(file, key.toString('hex'), { mode: 0o600 });
  return key;
}

const ephemeralKey = randomBytes(32);
/** true si los secretos se cifran con una clave que se pierde al reiniciar. */
export let keyIsEphemeral = false;

/** Muestra solo el final de un secreto (p. ej., «••••9f3a»). */
export const maskSecret = (s: string | null | undefined): string | null => (s ? `••••${s.slice(-4)}` : null);
