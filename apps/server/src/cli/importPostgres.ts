/**
 * Copia TODOS los datos de Supabase (PostgreSQL) a la base SQLite del servidor:
 * cuentas, saldos y movimientos, historial, amigos, salas, cosméticos…
 * Pensado para pasar el casino de Render + Supabase a un servidor propio.
 *
 * Dos formas:
 *   - Con un archivo descargado del SQL Editor de Supabase (deploy/supabase-export.sql):
 *       npm run db:import -w @aurum/server -- --file C:\Aurum\datos\export.csv
 *   - Conectándose directamente:
 *       IMPORT_FROM_URL=postgresql://…  npm run db:import -w @aurum/server
 *
 * El destino es DATABASE_PATH (del .env). Si ya tiene cuentas, se detiene salvo
 * con `--force`. Si el origen está en una versión del esquema más antigua, se
 * copia en esa versión y después se actualiza aquí (ver db/importer.ts).
 */
import { loadConfig } from '../config';
import { ImportError, importFromFile, importFromPostgres } from '../db/importer';

function fail(msg: string): never {
  console.error(`\n✖ ${msg}\n`);
  process.exit(1);
}

const fi = process.argv.indexOf('--file');
const file = fi > -1 ? process.argv[fi + 1] : undefined;
const source = process.env.IMPORT_FROM_URL?.trim();
if (!file && (!source || !/^postgres(ql)?:\/\//i.test(source))) {
  fail('Indica el archivo exportado con --file <ruta> o la cadena de conexión en IMPORT_FROM_URL (postgresql://…).');
}

const config = loadConfig({ DATABASE_URL: undefined });
console.log(`Origen : ${file ? `archivo ${file}` : `PostgreSQL (${source!.replace(/:\/\/([^:]+):[^@]*@/, '://$1:***@')})`}`);
console.log(`Destino: ${config.dbFile}`);

try {
  const opts = { force: process.argv.includes('--force'), log: (l: string) => console.log(l) };
  const r = file ? importFromFile(file, config.dbFile, opts) : importFromPostgres(source!, config.dbFile, opts);
  console.log(`\n✔ Importación completa: ${r.total} filas en ${r.tables.length} tablas (${r.users} cuentas). Esquema en la versión ${r.finalVersion}.`);
} catch (err) {
  fail(err instanceof ImportError ? err.message : `Error inesperado: ${(err as Error).message}`);
}
