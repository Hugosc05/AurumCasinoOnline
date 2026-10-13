import { mkdirSync, readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DatabaseSync, type SQLInputValue } from 'node:sqlite';

const MIGRATIONS_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), 'migrations');

export type Row = Record<string, SQLInputValue>;

/**
 * Envoltorio mínimo sobre `node:sqlite` (síncrono). Toda la lógica de acceso
 * a datos pasa por aquí con consultas parametrizadas (`?`), lo que impide la
 * inyección SQL. Las transacciones son síncronas: mientras se ejecuta una no
 * puede intercalarse otra petición del mismo proceso.
 */
export class Database {
  readonly raw: DatabaseSync;
  private depth = 0;

  constructor(file: string) {
    if (file !== ':memory:') mkdirSync(path.dirname(file), { recursive: true });
    this.raw = new DatabaseSync(file);
    this.raw.exec('PRAGMA journal_mode = WAL;');
    this.raw.exec('PRAGMA foreign_keys = ON;');
    this.raw.exec('PRAGMA busy_timeout = 5000;');
    this.raw.exec('PRAGMA synchronous = NORMAL;');
  }

  get<T>(sql: string, ...params: SQLInputValue[]): T | undefined {
    return this.raw.prepare(sql).get(...params) as T | undefined;
  }

  all<T>(sql: string, ...params: SQLInputValue[]): T[] {
    return this.raw.prepare(sql).all(...params) as T[];
  }

  run(sql: string, ...params: SQLInputValue[]): { changes: number; lastInsertRowid: number } {
    const r = this.raw.prepare(sql).run(...params);
    return { changes: Number(r.changes), lastInsertRowid: Number(r.lastInsertRowid) };
  }

  exec(sql: string): void {
    this.raw.exec(sql);
  }

  /**
   * Ejecuta `fn` dentro de una transacción `BEGIN IMMEDIATE` (bloqueo de
   * escritura desde el inicio). Anidable: las llamadas internas reutilizan la
   * transacción externa.
   */
  tx<T>(fn: () => T): T {
    if (this.depth > 0) {
      this.depth += 1;
      try {
        return fn();
      } finally {
        this.depth -= 1;
      }
    }
    this.raw.exec('BEGIN IMMEDIATE');
    this.depth = 1;
    try {
      const result = fn();
      if (result instanceof Promise) throw new Error('Las transacciones deben ser síncronas');
      this.raw.exec('COMMIT');
      return result;
    } catch (err) {
      try {
        this.raw.exec('ROLLBACK');
      } catch {
        /* sin transacción activa */
      }
      throw err;
    } finally {
      this.depth = 0;
    }
  }

  close(): void {
    this.raw.close();
  }
}

export interface MigrationInfo {
  version: number;
  name: string;
}

/** Aplica en orden las migraciones SQL pendientes (`NNN_nombre.sql`). */
export function migrate(db: Database): MigrationInfo[] {
  db.exec(`CREATE TABLE IF NOT EXISTS schema_migrations (
    version INTEGER PRIMARY KEY, name TEXT NOT NULL, applied_at TEXT NOT NULL
  )`);
  const applied = new Set(db.all<{ version: number }>('SELECT version FROM schema_migrations').map((r) => r.version));
  const files = readdirSync(MIGRATIONS_DIR).filter((f) => /^\d+_.+\.sql$/.test(f)).sort();
  const done: MigrationInfo[] = [];
  for (const file of files) {
    const version = Number.parseInt(file, 10);
    if (applied.has(version)) continue;
    const sql = readFileSync(path.join(MIGRATIONS_DIR, file), 'utf8');
    db.tx(() => {
      db.exec(sql);
      db.run('INSERT INTO schema_migrations (version, name, applied_at) VALUES (?, ?, ?)', version, file, new Date().toISOString());
    });
    done.push({ version, name: file });
  }
  return done;
}

export const nowIso = (): string => new Date().toISOString();
