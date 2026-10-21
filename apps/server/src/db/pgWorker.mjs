// Hilo auxiliar que habla con PostgreSQL. El hilo principal le envía cada consulta
// y espera la respuesta de forma síncrona (Atomics.wait), de modo que el resto del
// servidor conserva el mismo modelo síncrono que con SQLite: una transacción se
// ejecuta entera sin que otra petición del proceso pueda intercalarse.
//
// Una sola conexión: las transacciones (BEGIN … COMMIT) viajan por ella en orden.
import { createServer } from 'node:net';
import { workerData } from 'node:worker_threads';
import pg from 'pg';

const { url, port, signal: signalBuffer, ssl } = workerData;
const signal = new Int32Array(signalBuffer);

// Enteros de 64 bits y NUMERIC como números de JavaScript (los importes caben de sobra).
pg.types.setTypeParser(20, (v) => Number(v));
pg.types.setTypeParser(1700, (v) => Number(v));

let client = null;
let pglite = null;
let socketServer = null;

async function freePort() {
  return new Promise((resolve, reject) => {
    const srv = createServer();
    srv.unref();
    srv.on('error', reject);
    srv.listen(0, '127.0.0.1', () => {
      const { port: p } = srv.address();
      srv.close(() => resolve(p));
    });
  });
}

/** `pglite:<carpeta>` (solo pruebas): PostgreSQL real compilado a WebAssembly, servido por un socket local. */
async function startPglite(dir) {
  const { PGlite } = await import('@electric-sql/pglite');
  const { citext } = await import('@electric-sql/pglite/contrib/citext');
  const { PGLiteSocketServer } = await import('@electric-sql/pglite-socket');
  pglite = await PGlite.create(dir === 'memory' ? undefined : dir, { extensions: { citext } });
  const p = await freePort();
  socketServer = new PGLiteSocketServer({ db: pglite, port: p, host: '127.0.0.1' });
  await socketServer.start();
  return `postgresql://postgres:postgres@127.0.0.1:${p}/postgres`;
}

let connectionString = null;

async function connect() {
  if (!connectionString) connectionString = url.startsWith('pglite:') ? await startPglite(url.slice('pglite:'.length)) : url;
  const isLocal = /@(localhost|127\.0\.0\.1|\[::1\])[:/]/.test(connectionString);
  const c = new pg.Client({
    connectionString,
    ssl: isLocal ? false : ssl,
    connectionTimeoutMillis: 10_000,
    keepAlive: true,
    application_name: 'aurum-casino',
  });
  c.on('error', () => {
    // Conexión rota (red, reinicio del servidor de BD): la siguiente consulta reconecta.
    if (client === c) client = null;
  });
  await c.connect();
  client = c;
}

async function handle(msg) {
  if (msg.op === 'close') {
    await client?.end().catch(() => {});
    await socketServer?.stop().catch(() => {});
    await pglite?.close().catch(() => {});
    return { ok: true };
  }
  if (!client) {
    if (msg.inTx) throw Object.assign(new Error('Se perdió la conexión con la base de datos durante una transacción'), { code: 'DB_CONNECTION_LOST' });
    await connect();
  }
  const r = msg.params ? await client.query({ text: msg.sql, values: msg.params }) : await client.query(msg.sql);
  const last = Array.isArray(r) ? r[r.length - 1] : r;
  return { rows: last?.rows ?? [], rowCount: last?.rowCount ?? 0 };
}

port.on('message', async (msg) => {
  let reply;
  try {
    reply = { ok: true, ...(await handle(msg)) };
  } catch (err) {
    reply = {
      ok: false,
      error: { message: err?.message ?? String(err), code: err?.code ?? null, detail: err?.detail ?? null, constraint: err?.constraint ?? null },
    };
  }
  port.postMessage({ ...reply, id: msg.id });
  Atomics.store(signal, 0, msg.id);
  Atomics.notify(signal, 0);
});
