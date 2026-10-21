// Solo para pruebas: un PostgreSQL real (PGlite, en memoria) escuchando en un puerto local,
// para lanzar las pruebas de extremo a extremo contra PostgreSQL como si fuera Supabase.
//   node scripts/pglite-server.mjs [puerto]
import { PGlite } from '@electric-sql/pglite';
import { citext } from '@electric-sql/pglite/contrib/citext';
import { PGLiteSocketServer } from '@electric-sql/pglite-socket';

const port = Number(process.argv[2] ?? 54329);
const db = await PGlite.create({ extensions: { citext } });
const server = new PGLiteSocketServer({ db, port, host: '127.0.0.1', maxConnections: 8 });
await server.start();
console.log(`PGlite escuchando en postgresql://postgres:postgres@127.0.0.1:${port}/postgres`);
const stop = async () => {
  await server.stop();
  await db.close();
  process.exit(0);
};
process.on('SIGINT', stop);
process.on('SIGTERM', stop);
