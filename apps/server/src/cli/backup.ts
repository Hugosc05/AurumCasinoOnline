/**
 * Copia de seguridad de la base SQLite, segura con el servidor en marcha
 * (`VACUUM INTO` lee una instantánea coherente).
 *
 *   npm run db:backup -w @aurum/server
 *
 * - Carpeta: BACKUP_DIR (por defecto, `copias` junto a la base de datos).
 * - Conserva las BACKUP_KEEP más recientes (por defecto, 14).
 * - BACKUP_COPY_DIR (opcional): además deja ahí la última copia, p. ej. una
 *   carpeta de OneDrive o Google Drive para tenerla fuera de casa.
 */
import { copyFileSync, mkdirSync, readdirSync, rmSync, statSync } from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { loadConfig } from '../config';

const config = loadConfig({ DATABASE_URL: undefined });
if (config.dbFile === ':memory:') {
  console.error('No hay base de datos en archivo que copiar.');
  process.exit(1);
}
const dir = path.resolve(process.env.BACKUP_DIR ?? path.join(path.dirname(config.dbFile), 'copias'));
const keep = Math.max(1, Number(process.env.BACKUP_KEEP ?? 14) || 14);
mkdirSync(dir, { recursive: true });

const stamp = new Date().toISOString().slice(0, 23).replace('T', '_').replace(/[:.]/g, '');
const file = path.join(dir, `aurum-${stamp}.db`);
const db = new DatabaseSync(config.dbFile);
db.exec('PRAGMA busy_timeout = 10000;');
db.prepare('VACUUM INTO ?').run(file);
db.close();
console.log(`Copia creada: ${file} (${(statSync(file).size / 1024 / 1024).toFixed(1)} MB)`);

const old = readdirSync(dir).filter((f) => /^aurum-.*\.db$/.test(f)).sort().reverse().slice(keep);
for (const f of old) rmSync(path.join(dir, f));
if (old.length) console.log(`Borradas ${old.length} copias antiguas (se conservan ${keep}).`);

const extra = process.env.BACKUP_COPY_DIR;
if (extra) {
  mkdirSync(extra, { recursive: true });
  copyFileSync(file, path.join(extra, 'aurum-ultima.db'));
  console.log(`Última copia también en: ${path.join(extra, 'aurum-ultima.db')}`);
}
