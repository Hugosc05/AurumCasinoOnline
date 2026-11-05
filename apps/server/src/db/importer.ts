import { existsSync, rmSync } from 'node:fs';
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

/** Convierte un valor leído de PostgreSQL a algo que SQLite acepte. */
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

/**
 * Copia todos los datos de una base PostgreSQL (p. ej. Supabase) a un archivo
 * SQLite nuevo. Solo lee el origen.
 *
 * Si el origen está en una versión del esquema más antigua que este código
 * (p. ej., Supabase se quedó en la 10 porque el servidor de Render ya no
 * arrancó la 11), el destino se crea en esa misma versión, se copian los datos
 * y después se aplican aquí las migraciones que falten. Así no hace falta
 * tocar el origen.
 */
export function importFromPostgres(
  sourceUrl: string,
  targetFile: string,
  opts: { force?: boolean; log?: (line: string) => void } = {},
): ImportSummary {
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

  const src = new Database(sourceUrl);
  try {
    const srcVersion = Number(src.get<{ v: number }>('SELECT MAX(version) AS v FROM schema_migrations')?.v ?? 0);
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
        const order = (pk.length ? pk : cols).map((c) => `"${c.toLowerCase()}"`).join(', ');
        const select = `SELECT ${cols.map((c) => `"${c.toLowerCase()}" AS "${c}"`).join(', ')} FROM "${table.toLowerCase()}" ORDER BY ${order} LIMIT ${PAGE} OFFSET `;
        const insert = raw.prepare(`INSERT INTO "${table}" (${cols.map((c) => `"${c}"`).join(', ')}) VALUES (${cols.map(() => '?').join(', ')})`);
        let rows = 0;
        for (let offset = 0; ; offset += PAGE) {
          const page = src.all<Record<string, unknown>>(select + offset);
          for (const r of page) insert.run(...cols.map((c) => toSqlite(r[c])));
          rows += page.length;
          if (page.length < PAGE) break;
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
  } finally {
    src.close();
  }
}
