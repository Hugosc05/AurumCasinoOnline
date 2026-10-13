import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Client, createAdmin, key, registerUser, startServer, type TestServer } from './helpers';

let s: TestServer;
beforeAll(async () => {
  s = await startServer();
});
afterAll(async () => {
  await s.stop();
});

describe('registro', () => {
  it('crea la cuenta con saldo inicial, sesión en cookie httpOnly y contraseña hasheada', async () => {
    const c = new Client(s.base);
    const r = await c.post('/api/auth/register', { username: 'Valentina', email: 'Valen@Example.com', password: 'SuperSecreta9' });
    expect(r.status).toBe(201);
    expect(r.body.user).toMatchObject({ username: 'Valentina', email: 'valen@example.com', role: 'player', balance: 10000 });
    const setCookie = r.headers.getSetCookie().join(';');
    expect(setCookie).toMatch(/aurum_sid=/);
    expect(setCookie).toMatch(/HttpOnly/i);
    expect(setCookie).toMatch(/SameSite=Strict/i);
    const row = s.app.ctx.db.get<{ password_hash: string }>('SELECT password_hash FROM users WHERE username = ?', 'Valentina')!;
    expect(row.password_hash).toMatch(/^scrypt\$/);
    expect(row.password_hash).not.toContain('SuperSecreta9');
    const me = await c.get('/api/auth/me');
    expect(me.body.user.username).toBe('Valentina');
  });

  it('rechaza duplicados (sin distinguir mayúsculas) con mensajes por campo', async () => {
    const c = new Client(s.base);
    const r = await c.post('/api/auth/register', { username: 'valentina', email: 'otro@example.com', password: 'SuperSecreta9' });
    expect(r.status).toBe(409);
    expect(r.body.error.details.fields.username).toBeTruthy();
    const r2 = await c.post('/api/auth/register', { username: 'Otra', email: 'VALEN@example.com', password: 'SuperSecreta9' });
    expect(r2.status).toBe(409);
    expect(r2.body.error.details.fields.email).toBeTruthy();
  });

  it('valida los datos en el servidor', async () => {
    const c = new Client(s.base);
    const r = await c.post('/api/auth/register', { username: 'a', email: 'no-es-correo', password: 'corta' });
    expect(r.status).toBe(400);
    expect(Object.keys(r.body.error.details.fields).sort()).toEqual(['email', 'password', 'username']);
    const bot = await c.post('/api/auth/register', { username: 'BotFalso', email: 'b@example.com', password: 'Password123' });
    expect(bot.status).toBe(400);
  });

  it('ignora intentos de auto-asignarse el rol de administrador', async () => {
    const c = new Client(s.base);
    const r = await c.post('/api/auth/register', { username: 'Listillo', email: 'l@example.com', password: 'Password123', role: 'admin', balance: 1e9 });
    expect(r.status).toBe(201);
    expect(r.body.user.role).toBe('player');
    expect(r.body.user.balance).toBe(10000);
    expect((await c.get('/api/admin/overview')).status).toBe(403);
  });
});

describe('inicio y cierre de sesión', () => {
  it('login por correo o por usuario y logout', async () => {
    const { username, password } = await registerUser(s.base);
    const c = new Client(s.base);
    expect((await c.post('/api/auth/login', { identifier: username, password })).status).toBe(200);
    expect((await c.get('/api/me/stats')).status).toBe(200);
    expect((await c.post('/api/auth/logout')).status).toBe(200);
    expect((await c.get('/api/me/stats')).status).toBe(401);
    const c2 = new Client(s.base);
    expect((await c2.post('/api/auth/login', { identifier: `${username}@example.com`.toUpperCase(), password })).status).toBe(200);
  });

  it('credenciales incorrectas → 401 con mensaje genérico; bloqueo tras 5 fallos', async () => {
    const { username, password } = await registerUser(s.base);
    const c = new Client(s.base);
    for (let i = 0; i < 5; i += 1) {
      const r = await c.post('/api/auth/login', { identifier: username, password: 'MalaClave123' });
      expect(r.status).toBe(401);
      expect(r.body.error.message).toBe('Usuario o contraseña incorrectos');
    }
    const locked = await c.post('/api/auth/login', { identifier: username, password });
    expect(locked.status).toBe(429);
    expect(locked.body.error.code).toBe('ACCOUNT_LOCKED');
  });

  it('usuario inexistente → misma respuesta que contraseña errónea', async () => {
    const r = await new Client(s.base).post('/api/auth/login', { identifier: 'nadie_existe', password: 'Password123' });
    expect(r.status).toBe(401);
    expect(r.body.error.code).toBe('INVALID_CREDENTIALS');
  });

  it('una cookie inventada no autentica', async () => {
    const c = new Client(s.base);
    c.cookie = 'aurum_sid=inventada';
    expect((await c.get('/api/me/stats')).status).toBe(401);
  });
});

describe('seguridad de peticiones', () => {
  it('rechaza peticiones que modifican estado sin cabecera anti-CSRF', async () => {
    const { client } = await registerUser(s.base);
    const r = await client.post('/api/games/roulette/spin', { bets: [{ kind: 'red', amount: 10 }], idempotencyKey: key() }, { csrf: false });
    expect(r.status).toBe(403);
  });

  it('rechaza orígenes no permitidos', async () => {
    const { client } = await registerUser(s.base);
    const res = await fetch(`${s.base}/api/games/roulette/spin`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-requested-with': 'aurum', origin: 'https://evil.example', cookie: client.cookie },
      body: JSON.stringify({ bets: [{ kind: 'red', amount: 10 }], idempotencyKey: key() }),
    });
    expect(res.status).toBe(403);
  });

  it('JSON mal formado → 400 sin detalles internos', async () => {
    const { client } = await registerUser(s.base);
    const r = await client.post('/api/games/slots/spin', undefined, { raw: '{"betPerLine": ' });
    expect(r.status).toBe(400);
    expect(r.body.error.code).toBe('INVALID_JSON');
  });

  it('cabeceras de seguridad presentes', async () => {
    const r = await fetch(`${s.base}/api/health`);
    expect(r.headers.get('x-content-type-options')).toBe('nosniff');
    expect(r.headers.get('content-security-policy')).toContain("default-src 'self'");
    expect(r.headers.get('x-powered-by')).toBeNull();
  });
});

describe('roles', () => {
  it('sin sesión 401, jugador 403, administrador 200', async () => {
    expect((await new Client(s.base).get('/api/admin/overview')).status).toBe(401);
    const { client } = await registerUser(s.base);
    expect((await client.get('/api/admin/users')).status).toBe(403);
    expect((await client.post('/api/admin/users/00000000-0000-0000-0000-000000000000/adjust', { amount: 1000, reason: 'hack' })).status).toBe(403);
    const admin = await createAdmin(s);
    expect((await admin.client.get('/api/admin/overview')).status).toBe(200);
  });

  it('el administrador tiene saldo ilimitado sin alterar el saldo almacenado', async () => {
    const admin = await createAdmin(s);
    const me = await admin.client.get('/api/auth/me');
    expect(me.body.user).toMatchObject({ role: 'admin', unlimited: true, balance: null });
    const r = await admin.client.post('/api/games/roulette/spin', { bets: [{ kind: 'red', amount: 10000 }], idempotencyKey: key() });
    expect(r.status).toBe(200);
    expect(r.body.balance).toEqual({ balance: null, unlimited: true });
    const row = s.app.ctx.db.get<{ balance: number }>('SELECT balance FROM users WHERE id = ?', admin.id)!;
    expect(row.balance).toBe(0);
    const tx = s.app.ctx.db.all<{ unlimited: number }>('SELECT unlimited FROM wallet_transactions WHERE user_id = ?', admin.id);
    expect(tx.length).toBeGreaterThan(0);
    expect(tx.every((t) => t.unlimited === 1)).toBe(true);
  });

  it('un jugador no puede convertirse en admin alterando su id ni con ajustes manuales', async () => {
    const { client, user } = await registerUser(s.base);
    const r = await client.patch('/api/me/preferences', { role: 'admin' });
    expect(r.status).toBe(400);
    const row = s.app.ctx.db.get<{ role: string }>('SELECT role FROM users WHERE id = ?', user.id)!;
    expect(row.role).toBe('player');
  });

  it('el administrador puede ajustar saldos con motivo (auditado) y suspender cuentas', async () => {
    const admin = await createAdmin(s);
    const { client, user } = await registerUser(s.base);
    const adj = await admin.client.post(`/api/admin/users/${user.id}/adjust`, { amount: 500, reason: 'Compensación de prueba' });
    expect(adj.status).toBe(200);
    expect(adj.body.move).toMatchObject({ balanceBefore: 10000, balanceAfter: 10500 });
    const neg = await admin.client.post(`/api/admin/users/${user.id}/adjust`, { amount: -999999, reason: 'Excesivo' });
    expect(neg.status).toBe(402);
    const audit = await admin.client.get('/api/admin/audit');
    expect(audit.body.items.some((a: { action: string }) => a.action === 'wallet.adjust')).toBe(true);
    expect((await admin.client.patch(`/api/admin/users/${user.id}`, { status: 'banned' })).status).toBe(200);
    expect((await client.get('/api/me/stats')).status).toBe(401);
  });
});

describe('limitación de frecuencia', () => {
  it('limita los registros por conexión', async () => {
    const limited = await startServer(undefined, { REGISTER_LIMIT_PER_HOUR: '2' });
    try {
      const c = new Client(limited.base);
      const codes: number[] = [];
      for (let i = 0; i < 3; i += 1) {
        codes.push((await c.post('/api/auth/register', { username: `rl${i}user`, email: `rl${i}@example.com`, password: 'Password123' })).status);
      }
      expect(codes).toEqual([201, 201, 429]);
    } finally {
      await limited.stop();
    }
  });
});
