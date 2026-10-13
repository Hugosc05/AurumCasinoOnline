import { loadConfig } from '../config';
import { Database, migrate } from '../db/database';
import { seed } from '../db/seed';

const config = loadConfig();
const db = new Database(config.dbFile);
migrate(db);
const r = seed(db);
console.log(`Datos de demostración: ${r.bots} bots y ${r.tables} mesas nuevas (los existentes no se modifican).`);
db.close();
