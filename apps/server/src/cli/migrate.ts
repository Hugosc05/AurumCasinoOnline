import { loadConfig } from '../config';
import { Database, migrate } from '../db/database';

const config = loadConfig();
const db = new Database(config.dbFile);
const applied = migrate(db);
console.log(applied.length ? `Migraciones aplicadas: ${applied.map((m) => m.name).join(', ')}` : 'La base de datos ya está al día.');
db.close();
