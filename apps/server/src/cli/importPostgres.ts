/**
 * Copia TODOS los datos de una base PostgreSQL (p. ej. Supabase) a una base
 * SQLite nueva: cuentas, saldos y movimientos, historial, amigos, salas,
 * cosméticos, misiones…  Pensado para pasar el casino de Render + Supabase a un
 * servidor propio (DEPLOY-CASA.md).
 *
 *   IMPORT_FROM_URL=postgresql://…  npm run db:import -w @aurum/server
 *
 * - Solo LEE la base de origen; no la modifica.
 * - El destino es DATABASE_PATH (del .env). Si ya tiene cuentas, se detiene
 *   salvo que se pase `--force` (entonces se vacían sus tablas antes).
 * - El esquema del destino se crea con las mismas migraciones; si el origen
 *   está en otra versión del esquema, se avisa y se detiene.
 */
import { existsSync } from 'node:fs';
import { DatabaseSync, type SQLInputValue } from 'node:sqlite';
import { loadConfig } from '../config';
import { Database, migrate } from '../db/database';

const PAGE = 2000;

function fail(msg: string): never {
  console.error(`\n✖ ${msg}\n`);
  process.exit(1);
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

const source = process.env.IMPORT_FROM_URL?.trim();
if (!source || !/^postgres(ql)?:\/\//i.test(source)) fail('Falta IMPORT_FROM_URL con la cadena de conexión de PostgreSQL (postgresql://…).');
const force = process.argv.includes('--force');

const config = loadConfig({ DATABASE_URL: undefined });
const target = config.dbFile;
if (target === ':memory:') fail('DATABASE_PATH no puede ser :memory: para importar.');

console.log(`Origen : PostgreSQL (${source.replace(/:\/\/([^:]+):[^@]*@/, '://$1:***@')})`);
console.log(`Destino: ${target}${existsSync(target) ? ' (ya existe)' : ' (nuevo)'}`);

// 1. Esquema del destino con las migraciones de la aplicación.
const dst = new Database(target);
migrate(dst);
dst.close();

const raw = new DatabaseSync(target);
raw.exec('PRAGMA busy_timeout = 5000;');
const existing = Number((raw.prepare('SELECT COUNT(*) AS n FROM users').get() as { n: number }).n);
if (existing > 0 && !force) {
  raw.close();
  fail(`El destino ya tiene ${existing} cuentas. Para sobrescribirlo, repite con --force (o borra el archivo).`);
}

// 2. Origen: misma versión del esquema.
const src = new Database(source);
const srcVersion = Number(src.get<{ v: number }>('SELECT MAX(version) AS v FROM schema_migrations')?.v ?? 0);
const dstVersion = Number((raw.prepare('SELECT MAX(version) AS v FROM schema_migrations').get() as { v: number }).v);
if (srcVersion !== dstVersion) {
  src.close();
  raw.close();
  fail(`El origen está en la versión ${srcVersion} del esquema y esta copia del código en la ${dstVersion}. Actualiza el código (git pull) o arranca una vez el servidor de origen para que migre.`);
}

const tables = (raw.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' AND name <> 'schema_migrations' ORDER BY name").all() as { name: string }[]).map((t) => t.name);

// 3. Copia tabla a tabla, sin claves foráneas durante la carga (se comprueban al final).
raw.exec('PRAGMA foreign_keys = OFF;');
let total = 0;
const summary: { table: string; rows: number }[] = [];
raw.exec('BEGIN IMMEDIATE');
try {
  if (force) for (const t of tables) raw.exec(`DELETE FROM "${t}"`);
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
    process.stdout.write(`  ${table.padEnd(28)} ${String(rows).padStart(8)}\n`);
  }
  const broken = raw.prepare('PRAGMA foreign_key_check').all();
  if (broken.length > 0) throw new Error(`Hay ${broken.length} filas con referencias rotas (primera: ${JSON.stringify(broken[0])}).`);
  raw.exec('COMMIT');
} catch (err) {
  raw.exec('ROLLBACK');
  src.close();
  raw.close();
  fail(`Importación cancelada, el destino no se ha modificado: ${(err as Error).message}`);
}
raw.exec('PRAGMA foreign_keys = ON;');
raw.exec('PRAGMA wal_checkpoint(TRUNCATE);');
raw.close();
src.close();

const users = summary.find((s) => s.table === 'users')?.rows ?? 0;
console.log(`\n✔ Importación completa: ${total} filas en ${summary.length} tablas (${users} cuentas).`);
