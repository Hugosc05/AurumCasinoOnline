import { existsSync, readFileSync, rmSync } from 'node:fs';
import { DatabaseSync, type SQLInputValue } from 'node:sqlite';
import { Database, migrate } from './database';

const PAGE = 2000;

export class ImportError extends Error {}

export interface ImportSummary {
  tables: { table: string; rows: number }[];
  total: number;
  users: number;
  /** Versión del esquema en el origen y la que queda en el destino tras migrar. */
  sourceVersion: number;
  finalVersion: number;
  /** Migraciones aplicadas después de copiar (si el origen era más antiguo). */
  upgraded: string[];
}

/** De dónde salen los datos: una conexión a PostgreSQL o un archivo exportado. */
interface Source {
  version(): number;
  /** Filas de una tabla, con las claves en minúsculas (como las devuelve PostgreSQL). */
  pages(table: string, cols: string[], order: string[]): Iterable<Record<string, unknown>[]>;
  close(): void;
}

/** Convierte un valor leído de PostgreSQL (o de su JSON) a algo que SQLite acepte. */
function toSqlite(v: unknown): SQLInputValue {
  if (v === null || v === undefined) return null;
  if (typeof v === 'boolean') return v ? 1 : 0;
  if (typeof v === 'number' || typeof v === 'string' || typeof v === 'bigint') return v;
  if (v instanceof Date) return v.toISOString();
  if (v instanceof Uint8Array) return v;
  return JSON.stringify(v);
}

const latestVersion = (): number => {
  const probe = new Database(':memory:');
  try {
    migrate(probe);
    return Number(probe.get<{ v: number }>('SELECT MAX(version) AS v FROM schema_migrations')!.v);
  } finally {
    probe.close();
  }
};

/* --------------------------------- Orígenes -------------------------------- */

function postgresSource(url: string): Source {
  const src = new Database(url);
  return {
    version: () => Number(src.get<{ v: number }>('SELECT MAX(version) AS v FROM schema_migrations')?.v ?? 0),
    *pages(table, cols, order) {
      const select = `SELECT ${cols.map((c) => `"${c.toLowerCase()}"`).join(', ')} FROM "${table.toLowerCase()}" ORDER BY ${order.map((c) => `"${c.toLowerCase()}"`).join(', ')} LIMIT ${PAGE} OFFSET `;
      for (let offset = 0; ; offset += PAGE) {
        const page = src.all<Record<string, unknown>>(select + offset);
        yield page;
        if (page.length < PAGE) return;
      }
    },
    close: () => src.close(),
  };
}

/**
 * CSV estándar (RFC 4180): comillas dobles, "" para escapar y saltos de línea
 * dentro de campos entrecomillados. Es lo que descarga el SQL Editor de Supabase.
 */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let quoted = false;
  const s = text.replace(/^﻿/, '');
  for (let i = 0; i < s.length; i += 1) {
    const ch = s[i]!;
    if (quoted) {
      if (ch === '"') {
        if (s[i + 1] === '"') {
          field += '"';
          i += 1;
        } else quoted = false;
      } else field += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ',') {
      row.push(field);
      field = '';
    } else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && s[i + 1] === '\n') i += 1;
      row.push(field);
      rows.push(row);
      row = [];
      field = '';
    } else field += ch;
  }
  if (field !== '' || row.length) {
    row.push(field);
    rows.push(row);
  }
  return rows.filter((r) => r.some((c) => c !== ''));
}

/**
 * Archivo exportado con deploy/supabase-export.sql: una fila por tabla con sus
 * datos en JSON. Se admite el CSV que descarga Supabase o el mismo contenido en
 * JSON ([{ tabla, datos }] o { tabla: [...] }).
 */
function fileSource(file: string): Source {
  if (!existsSync(file)) throw new ImportError(`No encuentro el archivo ${file}.`);
  const text = readFileSync(file, 'utf8');
  const tables = new Map<string, Record<string, unknown>[]>();
  const add = (name: string, data: unknown): void => {
    const rows = typeof data === 'string' ? (JSON.parse(data) as unknown) : data;
    if (!Array.isArray(rows)) throw new ImportError(`Los datos de la tabla ${name} no tienen el formato esperado.`);
    tables.set(name.toLowerCase(), rows as Record<string, unknown>[]);
  };
  try {
    const trimmed = text.replace(/^﻿/, '').trimStart();
    if (trimmed.startsWith('[') || trimmed.startsWith('{')) {
      const json = JSON.parse(trimmed) as unknown;
      if (Array.isArray(json)) for (const r of json as { tabla: string; datos: unknown }[]) add(r.tabla, r.datos);
      else for (const [k, v] of Object.entries(json as Record<string, unknown>)) add(k, v);
    } else {
      const rows = parseCsv(text);
      const header = rows.shift()?.map((h) => h.trim().toLowerCase()) ?? [];
      const ti = header.indexOf('tabla');
      const di = header.indexOf('datos');
      if (ti === -1 || di === -1) throw new ImportError('El CSV no tiene las columnas «tabla» y «datos». ¿Es el resultado de deploy/supabase-export.sql?');
      for (const r of rows) add(r[ti]!, r[di]!);
    }
  } catch (err) {
    if (err instanceof ImportError) throw err;
    throw new ImportError(`No se pudo leer el archivo (¿está completo?): ${(err as Error).message}`);
  }
  if (!tables.has('schema_migrations')) throw new ImportError('El archivo no contiene la tabla schema_migrations: no es una exportación completa de Aurum.');
  return {
    version: () => Math.max(0, ...tables.get('schema_migrations')!.map((r) => Number(r.version))),
    *pages(table) {
      yield tables.get(table.toLowerCase()) ?? [];
    },
    close: () => {},
  };
}

/* --------------------------------- Importar -------------------------------- */

function runImport(src: Source, targetFile: string, opts: { force?: boolean; log?: (line: string) => void }): ImportSummary {
  const log = opts.log ?? (() => {});
  if (targetFile === ':memory:') throw new ImportError('El destino no puede ser :memory:.');

  // Destino existente: solo se reemplaza si está vacío o con --force.
  if (existsSync(targetFile)) {
    const probe = new DatabaseSync(targetFile);
    let users = 0;
    try {
      users = Number((probe.prepare('SELECT COUNT(*) AS n FROM users').get() as { n: number }).n);
    } catch {
      users = 0;
    } finally {
      probe.close();
    }
    if (users > 0 && !opts.force) throw new ImportError(`El destino ya tiene ${users} cuentas. Para sobrescribirlo, repite con --force (o borra el archivo).`);
    for (const f of [targetFile, `${targetFile}-wal`, `${targetFile}-shm`]) rmSync(f, { force: true });
  }

  const srcVersion = src.version();
  const latest = latestVersion();
  if (srcVersion === 0) throw new ImportError('El origen no tiene el esquema de Aurum (no hay migraciones aplicadas).');
  if (srcVersion > latest) {
    throw new ImportError(`El origen está en la versión ${srcVersion} del esquema y este código solo llega a la ${latest}. Actualiza el código (git pull) y repite.`);
  }
  if (srcVersion < latest) log(`El origen está en la versión ${srcVersion} del esquema; se copiará en esa versión y luego se actualizará a la ${latest}.`);

  // 1. Destino con el mismo esquema que el origen.
  const dst = new Database(targetFile);
  migrate(dst, srcVersion);
  dst.close();

  const raw = new DatabaseSync(targetFile);
  raw.exec('PRAGMA busy_timeout = 5000;');
  const tables = (raw.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' AND name <> 'schema_migrations' ORDER BY name").all() as { name: string }[]).map((t) => t.name);

  // 2. Copia tabla a tabla, sin claves foráneas durante la carga (se comprueban al final).
  raw.exec('PRAGMA foreign_keys = OFF;');
  const summary: { table: string; rows: number }[] = [];
  let total = 0;
  raw.exec('BEGIN IMMEDIATE');
  try {
    for (const table of tables) {
      const info = raw.prepare(`PRAGMA table_info("${table}")`).all() as { name: string; pk: number }[];
      const cols = info.map((c) => c.name);
      const pk = info.filter((c) => c.pk > 0).sort((a, b) => a.pk - b.pk).map((c) => c.name);
      const insert = raw.prepare(`INSERT INTO "${table}" (${cols.map((c) => `"${c}"`).join(', ')}) VALUES (${cols.map(() => '?').join(', ')})`);
      let rows = 0;
      for (const page of src.pages(table, cols, pk.length ? pk : cols)) {
        for (const r of page) insert.run(...cols.map((c) => toSqlite(r[c] !== undefined ? r[c] : r[c.toLowerCase()])));
        rows += page.length;
      }
      summary.push({ table, rows });
      total += rows;
      log(`  ${table.padEnd(28)} ${String(rows).padStart(8)}`);
    }
    const broken = raw.prepare('PRAGMA foreign_key_check').all();
    if (broken.length > 0) throw new ImportError(`Hay ${broken.length} filas con referencias rotas (primera: ${JSON.stringify(broken[0])}).`);
    raw.exec('COMMIT');
  } catch (err) {
    raw.exec('ROLLBACK');
    raw.close();
    for (const f of [targetFile, `${targetFile}-wal`, `${targetFile}-shm`]) rmSync(f, { force: true });
    throw err instanceof ImportError ? err : new ImportError(`Importación cancelada: ${(err as Error).message}`);
  }
  raw.exec('PRAGMA foreign_keys = ON;');
  raw.close();

  // 3. Migraciones que le faltaban al origen, ya sobre los datos copiados.
  const up = new Database(targetFile);
  const upgraded = migrate(up).map((m) => m.name);
  const finalVersion = Number(up.get<{ v: number }>('SELECT MAX(version) AS v FROM schema_migrations')!.v);
  up.exec('PRAGMA wal_checkpoint(TRUNCATE);');
  up.close();
  if (upgraded.length) log(`Esquema actualizado: ${upgraded.join(', ')}`);

  return { tables: summary, total, users: summary.find((s) => s.table === 'users')?.rows ?? 0, sourceVersion: srcVersion, finalVersion, upgraded };
}

/**
 * Copia todos los datos de una base PostgreSQL (p. ej. Supabase) a un archivo
 * SQLite nuevo. Solo lee el origen.
 *
 * Si el origen está en una versión del esquema más antigua que este código,
 * el destino se crea en esa misma versión, se copian los datos y después se
 * aplican aquí las migraciones que falten. Así no hace falta tocar el origen.
 */
export function importFromPostgres(sourceUrl: string, targetFile: string, opts: { force?: boolean; log?: (line: string) => void } = {}): ImportSummary {
  const src = postgresSource(sourceUrl);
  try {
    return runImport(src, targetFile, opts);
  } finally {
    src.close();
  }
}

/** Igual, pero desde el archivo descargado con deploy/supabase-export.sql (sin conectarse a nada). */
export function importFromFile(file: string, targetFile: string, opts: { force?: boolean; log?: (line: string) => void } = {}): ImportSummary {
  return runImport(fileSource(file), targetFile, opts);
}
