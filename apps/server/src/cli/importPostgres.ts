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
 *   salvo que se pase `--force`.
 * - Si el origen está en una versión del esquema más antigua, se copia en esa
 *   versión y después se actualiza aquí (ver db/importer.ts).
 */
import { loadConfig } from '../config';
import { ImportError, importFromPostgres } from '../db/importer';

function fail(msg: string): never {
  console.error(`\n✖ ${msg}\n`);
  process.exit(1);
}

const source = process.env.IMPORT_FROM_URL?.trim();
if (!source || !/^postgres(ql)?:\/\//i.test(source)) fail('Falta IMPORT_FROM_URL con la cadena de conexión de PostgreSQL (postgresql://…).');

const config = loadConfig({ DATABASE_URL: undefined });
console.log(`Origen : PostgreSQL (${source.replace(/:\/\/([^:]+):[^@]*@/, '://$1:***@')})`);
console.log(`Destino: ${config.dbFile}`);

try {
  const r = importFromPostgres(source, config.dbFile, { force: process.argv.includes('--force'), log: (l) => console.log(l) });
  console.log(`\n✔ Importación completa: ${r.total} filas en ${r.tables.length} tablas (${r.users} cuentas). Esquema en la versión ${r.finalVersion}.`);
} catch (err) {
  fail(err instanceof ImportError ? err.message : `Error inesperado: ${(err as Error).message}`);
}
