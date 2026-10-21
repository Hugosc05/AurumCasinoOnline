import { mkdirSync, readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { MessageChannel, Worker, receiveMessageOnPort, type MessagePort } from 'node:worker_threads';
import { DatabaseSync, type SQLInputValue } from 'node:sqlite';
import { migrationToPostgres, toPostgres } from './sql';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const MIGRATIONS_DIR = path.join(HERE, 'migrations');

export type Row = Record<string, SQLInputValue>;
export type Dialect = 'sqlite' | 'postgres';
type RunResult = { changes: number; lastInsertRowid: number };

/** Error de base de datos con un mensaje común a los dos motores (p. ej. «UNIQUE constraint failed»). */
export class DbError extends Error {
  constructor(message: string, readonly code: string | null) {
    super(message);
    this.name = 'DbError';
  }
}

interface Driver {
  readonly dialect: Dialect;
  query(sql: string, params: SQLInputValue[], inTx: boolean): { rows: unknown[]; changes: number; lastInsertRowid: number };
  exec(sql: string, inTx: boolean): void;
  close(): void;
}

/* ------------------------------- SQLite -------------------------------- */

class SqliteDriver implements Driver {
  readonly dialect = 'sqlite' as const;
  readonly raw: DatabaseSync;

  constructor(file: string) {
    if (file !== ':memory:') mkdirSync(path.dirname(file), { recursive: true });
    this.raw = new DatabaseSync(file);
    this.raw.exec('PRAGMA journal_mode = WAL;');
    this.raw.exec('PRAGMA foreign_keys = ON;');
    this.raw.exec('PRAGMA busy_timeout = 5000;');
    this.raw.exec('PRAGMA synchronous = NORMAL;');
  }

  query(sql: string, params: SQLInputValue[]) {
    const stmt = this.raw.prepare(sql);
    if (/^\s*(SELECT|WITH|PRAGMA)\b/i.test(sql) || /\bRETURNING\b/i.test(sql)) {
      return { rows: stmt.all(...params), changes: 0, lastInsertRowid: 0 };
    }
    const r = stmt.run(...params);
    return { rows: [], changes: Number(r.changes), lastInsertRowid: Number(r.lastInsertRowid) };
  }

  exec(sql: string): void {
    this.raw.exec(sql);
  }

  close(): void {
    this.raw.close();
  }
}

/* ------------------------------ PostgreSQL ----------------------------- */

const PG_ERRORS: Record<string, string> = {
  '23505': 'UNIQUE constraint failed',
  '23514': 'CHECK constraint failed',
  '23503': 'FOREIGN KEY constraint failed',
  '23502': 'NOT NULL constraint failed',
};

/**
 * PostgreSQL (p. ej. Supabase) con la misma interfaz síncrona que SQLite: las
 * consultas se ejecutan en un hilo auxiliar y este hilo espera la respuesta con
 * `Atomics.wait`. Así las transacciones siguen siendo atómicas respecto al resto
 * del proceso sin reescribir la lógica del monedero ni de las mesas. Pensado
 * para una base de datos en la misma región que el servidor (latencia de 1–3 ms).
 */
class PostgresDriver implements Driver {
  readonly dialect = 'postgres' as const;
  private readonly worker: Worker;
  private readonly port: MessagePort;
  private readonly signal = new Int32Array(new SharedArrayBuffer(4));
  private closed = false;

  constructor(url: string) {
    const { port1, port2 } = new MessageChannel();
    this.port = port1;
    const ca = process.env.DATABASE_SSL_CA?.replace(/\\n/g, '\n');
    const ssl = ca ? { ca, rejectUnauthorized: true } : { rejectUnauthorized: false };
    this.worker = new Worker(path.join(HERE, 'pgWorker.mjs'), {
      workerData: { url, port: port2, signal: this.signal.buffer, ssl },
      transferList: [port2],
      execArgv: [],
    });
    this.worker.unref();
  }

  private seq = 0;

  private call(msg: Record<string, unknown>): { rows: unknown[]; rowCount: number } {
    if (this.closed) throw new DbError('La base de datos está cerrada', 'DB_CLOSED');
    // Cada petición lleva un número; el hilo auxiliar escribe en la memoria compartida el
    // número de la última respuesta enviada. Una respuesta tardía de una petición que ya
    // agotó su tiempo nunca se confunde con la actual.
    this.seq = (this.seq % 2_000_000_000) + 1;
    const id = this.seq;
    this.port.postMessage({ ...msg, id });
    const deadline = Date.now() + 20_000;
    for (;;) {
      const current = Atomics.load(this.signal, 0);
      if (current === id) break;
      const left = deadline - Date.now();
      if (left <= 0) throw new DbError('La base de datos no responde', 'DB_TIMEOUT');
      Atomics.wait(this.signal, 0, current, left);
    }
    let reply:
      | { id: number; ok: true; rows: unknown[]; rowCount: number }
      | { id: number; ok: false; error: { message: string; code: string | null } }
      | undefined;
    for (let m = receiveMessageOnPort(this.port); m; m = receiveMessageOnPort(this.port)) {
      if ((m.message as { id: number }).id === id) reply = m.message as typeof reply;
    }
    if (!reply) throw new DbError('Respuesta vacía de la base de datos', 'DB_PROTOCOL');
    if (!reply.ok) {
      const prefix = reply.error.code ? PG_ERRORS[reply.error.code] : undefined;
      throw new DbError(prefix ? `${prefix}: ${reply.error.message}` : reply.error.message, reply.error.code);
    }
    return reply;
  }

  query(sql: string, params: SQLInputValue[], inTx: boolean) {
    const r = this.call({ sql: toPostgres(sql), params: params.map(toPgParam), inTx });
    return { rows: r.rows, changes: r.rowCount, lastInsertRowid: 0 };
  }

  exec(sql: string, inTx: boolean): void {
    // Sin parámetros: se envía tal cual (puede contener varias sentencias).
    this.call({ sql, inTx });
  }

  close(): void {
    if (this.closed) return;
    try {
      this.call({ op: 'close' });
    } catch {
      /* ya cerrada */
    }
    this.closed = true;
    void this.worker.terminate();
  }
}

function toPgParam(v: SQLInputValue): unknown {
  if (typeof v === 'bigint') return v.toString();
  if (v instanceof Uint8Array) return Buffer.from(v);
  return v;
}

/* ------------------------------- Fachada ------------------------------- */

export const isPostgresUrl = (target: string): boolean => /^(postgres(ql)?|pglite):/i.test(target);

/**
 * Acceso a datos con consultas parametrizadas (`?`), lo que impide la inyección
 * SQL. Funciona con SQLite (archivo local, por defecto) o con PostgreSQL cuando
 * se le pasa una URL `postgres://…`. Las transacciones son síncronas: mientras
 * se ejecuta una no puede intercalarse otra petición del mismo proceso.
 */
export class Database {
  private readonly driver: Driver;
  private depth = 0;

  constructor(target: string) {
    this.driver = isPostgresUrl(target) ? new PostgresDriver(target) : new SqliteDriver(target);
  }

  get dialect(): Dialect {
    return this.driver.dialect;
  }

  get<T>(sql: string, ...params: SQLInputValue[]): T | undefined {
    return this.driver.query(sql, params, this.depth > 0).rows[0] as T | undefined;
  }

  all<T>(sql: string, ...params: SQLInputValue[]): T[] {
    return this.driver.query(sql, params, this.depth > 0).rows as T[];
  }

  run(sql: string, ...params: SQLInputValue[]): RunResult {
    const r = this.driver.query(sql, params, this.depth > 0);
    return { changes: r.changes, lastInsertRowid: r.lastInsertRowid };
  }

  exec(sql: string): void {
    this.driver.exec(sql, this.depth > 0);
  }

  /**
   * Ejecuta `fn` dentro de una transacción (en SQLite, `BEGIN IMMEDIATE`:
   * bloqueo de escritura desde el inicio). Anidable: las llamadas internas
   * reutilizan la transacción externa.
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
    this.driver.exec(this.dialect === 'sqlite' ? 'BEGIN IMMEDIATE' : 'BEGIN', false);
    this.depth = 1;
    try {
      const result = fn();
      if (result instanceof Promise) throw new Error('Las transacciones deben ser síncronas');
      this.driver.exec('COMMIT', true);
      return result;
    } catch (err) {
      try {
        this.driver.exec('ROLLBACK', true);
      } catch {
        /* sin transacción activa */
      }
      throw err;
    } finally {
      this.depth = 0;
    }
  }

  close(): void {
    this.driver.close();
  }
}

export interface MigrationInfo {
  version: number;
  name: string;
}

/** Aplica en orden las migraciones SQL pendientes (`NNN_nombre.sql`). */
export function migrate(db: Database): MigrationInfo[] {
  if (db.dialect === 'postgres') db.exec('CREATE EXTENSION IF NOT EXISTS citext');
  db.exec(`CREATE TABLE IF NOT EXISTS schema_migrations (
    version INTEGER PRIMARY KEY, name TEXT NOT NULL, applied_at TEXT NOT NULL
  )`);
  const applied = new Set(db.all<{ version: number }>('SELECT version FROM schema_migrations').map((r) => Number(r.version)));
  const files = readdirSync(MIGRATIONS_DIR).filter((f) => /^\d+_.+\.sql$/.test(f)).sort();
  const done: MigrationInfo[] = [];
  for (const file of files) {
    const version = Number.parseInt(file, 10);
    if (applied.has(version)) continue;
    const source = readFileSync(path.join(MIGRATIONS_DIR, file), 'utf8');
    const sql = db.dialect === 'postgres' ? migrationToPostgres(source) : source;
    db.tx(() => {
      db.exec(sql);
      db.run('INSERT INTO schema_migrations (version, name, applied_at) VALUES (?, ?, ?)', version, file, new Date().toISOString());
    });
    done.push({ version, name: file });
  }
  return done;
}

export const nowIso = (): string => new Date().toISOString();
