import { mkdtempSync, rmSync } from 'node:fs';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import WebSocket from 'ws';
import { buildApp, type RunningApp } from '../src/app';
import { loadConfig } from '../src/config';
import { hashPassword } from '../src/auth/password';
import { nowIso } from '../src/db/database';

process.env.NODE_ENV = 'test';

export interface TestServer {
  app: RunningApp;
  base: string;
  dir: string;
  dbFile: string;
  stop(keepFiles?: boolean): Promise<void>;
}

export async function startServer(dbFile?: string, extra: Record<string, string> = {}): Promise<TestServer> {
  const dir = dbFile ? path.dirname(dbFile) : mkdtempSync(path.join(tmpdir(), 'aurum-test-'));
  const file = dbFile ?? path.join(dir, 'test.db');
  const config = loadConfig({
    NODE_ENV: 'test',
    DATABASE_PATH: file,
    POKER_FAST_MODE: 'true',
    STARTING_BALANCE: '10000',
    LOG_LEVEL: 'error',
    REGISTER_LIMIT_PER_HOUR: '1000',
    LOGIN_LIMIT_PER_15MIN: '1000',
    // TEST_DB=pg: la misma batería contra PostgreSQL real (PGlite, persistido en la carpeta de la prueba).
    ...(process.env.TEST_DB === 'pg' ? { DATABASE_URL: `pglite:${path.join(dir, 'pgdata')}` } : {}),
    ...extra,
  });
  const app = buildApp(config);
  await new Promise<void>((resolve) => app.server.listen(0, '127.0.0.1', () => resolve()));
  const port = (app.server.address() as AddressInfo).port;
  return {
    app,
    base: `http://127.0.0.1:${port}`,
    dir,
    dbFile: file,
    async stop(keepFiles = false) {
      await app.close();
      if (!keepFiles) rmSync(dir, { recursive: true, force: true });
    },
  };
}

/** Cliente HTTP con "tarro" de cookies y cabecera anti-CSRF. */
export class Client {
  cookie = '';
  constructor(private readonly base: string) {}

  async req<T = any>(method: string, url: string, body?: unknown, opts: { csrf?: boolean; raw?: string } = {}): Promise<{ status: number; body: T; headers: Headers }> {
    const headers: Record<string, string> = {};
    if (body !== undefined || opts.raw !== undefined) headers['content-type'] = 'application/json';
    if (opts.csrf !== false) headers['x-requested-with'] = 'aurum';
    if (this.cookie) headers.cookie = this.cookie;
    const res = await fetch(this.base + url, {
      method,
      headers,
      body: opts.raw ?? (body !== undefined ? JSON.stringify(body) : undefined),
    });
    const set = res.headers.getSetCookie();
    for (const c of set) {
      const [pair] = c.split(';');
      if (pair!.startsWith('aurum_sid=')) this.cookie = pair!.endsWith('=') ? '' : pair!;
    }
    const text = await res.text();
    return { status: res.status, body: text ? JSON.parse(text) : null, headers: res.headers };
  }
  get<T = any>(url: string) {
    return this.req<T>('GET', url);
  }
  post<T = any>(url: string, body?: unknown, opts?: { csrf?: boolean; raw?: string }) {
    return this.req<T>('POST', url, body ?? {}, opts);
  }
  patch<T = any>(url: string, body?: unknown) {
    return this.req<T>('PATCH', url, body ?? {});
  }
}

let counter = 0;
export async function registerUser(base: string, prefix = 'jugador') {
  counter += 1;
  const username = `${prefix}${counter}${Math.floor(Math.random() * 1e6)}`.slice(0, 20);
  const c = new Client(base);
  const password = 'Password123';
  const r = await c.post('/api/auth/register', { username, email: `${username}@example.com`, password });
  if (r.status !== 201) throw new Error(`registro falló: ${JSON.stringify(r.body)}`);
  return { client: c, user: r.body.user, username, password };
}

/** Simula la CLI protegida: crea un administrador directamente en BD. */
export async function createAdmin(server: TestServer) {
  const id = randomUUID();
  const username = `admin${Math.floor(Math.random() * 1e6)}`;
  server.app.ctx.db.run(
    `INSERT INTO users (id, username, email, password_hash, role, balance, created_at) VALUES (?, ?, ?, ?, 'admin', 0, ?)`,
    id, username, `${username}@example.com`, await hashPassword('AdminPass123'), nowIso(),
  );
  const c = new Client(server.base);
  const r = await c.post('/api/auth/login', { identifier: username, password: 'AdminPass123' });
  if (r.status !== 200) throw new Error('login admin falló');
  return { client: c, id, username };
}

export const key = (): string => randomUUID().replace(/-/g, '');

export function openWs(server: TestServer, cookie: string): Promise<{ ws: WebSocket; messages: any[]; next: (pred: (m: any) => boolean, timeoutMs?: number) => Promise<any> }> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(server.base.replace('http', 'ws') + '/ws', { headers: { cookie, origin: server.base } });
    const messages: any[] = [];
    const waiters: { pred: (m: any) => boolean; resolve: (m: any) => void }[] = [];
    ws.on('message', (d) => {
      const m = JSON.parse(d.toString());
      messages.push(m);
      for (const w of waiters.slice()) {
        if (w.pred(m)) {
          waiters.splice(waiters.indexOf(w), 1);
          w.resolve(m);
        }
      }
    });
    ws.on('open', () =>
      resolve({
        ws,
        messages,
        next: (pred, timeoutMs = 8000) =>
          new Promise((res, rej) => {
            const found = messages.find(pred);
            if (found) {
              messages.splice(messages.indexOf(found), 1);
              res(found);
              return;
            }
            const t = setTimeout(() => rej(new Error('timeout esperando mensaje WS')), timeoutMs);
            waiters.push({ pred, resolve: (m) => { clearTimeout(t); messages.splice(messages.indexOf(m), 1); res(m); } });
          }),
      }),
    );
    ws.on('error', reject);
  });
}
