import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AdsService, createAdProvider, signCallback } from '../src/ads/ads';
import { loadConfig } from '../src/config';
import { claimDaily, dailyStatus } from '../src/economy/daily';
import { dayKey, periodInfo, startOfDay } from '../src/economy/period';
import { verifyLedger } from '../src/wallet/wallet';
import { Client, createAdmin, registerUser, startServer, type TestServer } from './helpers';

const SECRET = 'x'.repeat(40);

describe('periodos diarios en zona horaria', () => {
  it('el día cambia a medianoche de Madrid, no de UTC', () => {
    // 23:30 UTC del 15 de octubre = 01:30 del 16 en Madrid (CEST, UTC+2).
    expect(dayKey(new Date('2026-10-15T23:30:00Z'), 'Europe/Madrid')).toBe('2026-10-16');
    expect(dayKey(new Date('2026-10-15T21:59:00Z'), 'Europe/Madrid')).toBe('2026-10-15');
    expect(startOfDay('2026-10-16', 'Europe/Madrid').toISOString()).toBe('2026-10-15T22:00:00.000Z');
  });

  it('respeta los cambios de hora (días de 23 y 25 horas)', () => {
    // 25 de octubre de 2026: fin del horario de verano en Madrid.
    expect(startOfDay('2026-10-25', 'Europe/Madrid').toISOString()).toBe('2026-10-24T22:00:00.000Z');
    expect(startOfDay('2026-10-26', 'Europe/Madrid').toISOString()).toBe('2026-10-25T23:00:00.000Z');
    // 29 de marzo de 2026: comienzo del horario de verano.
    expect(startOfDay('2026-03-30', 'Europe/Madrid').toISOString()).toBe('2026-03-29T22:00:00.000Z');
    const p = periodInfo(new Date('2026-10-25T12:00:00Z'), 'Europe/Madrid');
    expect(p.nextResetAt).toBe('2026-10-25T23:00:00.000Z');
    expect(p.msUntilReset).toBe(11 * 3600_000);
  });
});

let s: TestServer;
beforeAll(async () => {
  s = await startServer(undefined, { ADS_PROVIDER: 'dev-simulation' });
});
afterAll(async () => {
  await s.stop();
});

describe('recompensa diaria', () => {
  it('se reclama una vez por periodo, también con peticiones simultáneas', async () => {
    const { client, user } = await registerUser(s.base);
    const results = await Promise.all(Array.from({ length: 6 }, () => client.post('/api/me/promotions/daily-bonus')));
    expect(results.filter((r) => r.status === 200)).toHaveLength(1);
    expect(results.filter((r) => r.status === 409).every((r) => r.body.error.code === 'ALREADY_CLAIMED')).toBe(true);
    const promo = (await client.get('/api/me/promotions')).body;
    expect(promo.daily.claimed).toBe(true);
    expect(Date.parse(promo.daily.nextResetAt)).toBeGreaterThan(Date.now());
    expect(promo.daily.history).toHaveLength(1);
    expect(verifyLedger(s.app.ctx.db, user.id).ok).toBe(true);
    const n = s.app.ctx.db.get<{ n: number }>(`SELECT COUNT(*) AS n FROM wallet_transactions WHERE user_id = ? AND reason = 'daily_bonus'`, user.id)!.n;
    expect(n).toBe(1);
  });

  it('racha amable: suma por cada día reclamado en la última semana y no castiga los días perdidos', async () => {
    const { user } = await registerUser(s.base);
    const db = s.app.ctx.db;
    const at = (d: string) => new Date(`${d}T10:00:00Z`);
    expect(claimDaily(db, user.id, 'player', at('2030-01-01')).amount).toBe(1000);
    expect(claimDaily(db, user.id, 'player', at('2030-01-02')).amount).toBe(1100);
    expect(claimDaily(db, user.id, 'player', at('2030-01-03')).amount).toBe(1200);
    // Se salta dos días: la racha no vuelve a cero, solo deja de sumar esos días.
    expect(claimDaily(db, user.id, 'player', at('2030-01-06')).amount).toBe(1300);
    expect(() => claimDaily(db, user.id, 'player', at('2030-01-06'))).toThrow(/Ya has reclamado/);
    const st = dailyStatus(db, user.id, at('2030-01-07'));
    expect(st.streak.days).toBe(4);
    expect(st.amount).toBe(1400);
    // El extra tiene tope.
    for (let d = 7; d <= 20; d += 1) claimDaily(db, user.id, 'player', at(`2030-01-${String(d).padStart(2, '0')}`));
    expect(dailyStatus(db, user.id, at('2030-01-21')).amount).toBe(1000 + 6 * 100);
  });

  it('el administrador configura el saldo inicial, que se concede una sola vez al registrarse', async () => {
    const admin = await createAdmin(s);
    expect((await admin.client.patch('/api/admin/settings', { startingBalance: 2500 })).status).toBe(200);
    expect((await admin.client.patch('/api/admin/settings', { dailyTimezone: 'Marte/Olympus' })).status).toBe(400);
    const { client, user } = await registerUser(s.base);
    expect(user.balance).toBe(2500);
    const tx = s.app.ctx.db.all<{ reason: string }>('SELECT reason FROM wallet_transactions WHERE user_id = ?', user.id);
    expect(tx.filter((t) => t.reason === 'signup_bonus')).toHaveLength(1);
    // Iniciar sesión de nuevo no vuelve a concederlo.
    await client.post('/api/auth/logout');
    const again = new Client(s.base);
    const login = await again.post('/api/auth/login', { identifier: user.username, password: 'Password123' });
    expect(login.body.user.balance).toBe(2500);
    await admin.client.patch('/api/admin/settings', { startingBalance: null });
  });
});

describe('anuncios recompensados', () => {
  it('sin proveedor configurado se indica que no están disponibles y no se puede abrir una sesión', async () => {
    const plain = await startServer();
    const { client } = await registerUser(plain.base);
    const st = (await client.get('/api/ads/status')).body;
    expect(st.available).toBe(false);
    expect(st.message).toBe('Los anuncios recompensados no están disponibles en este entorno.');
    expect((await client.post('/api/ads/sessions')).status).toBe(503);
    await plain.stop();
  });

  it('la simulación está prohibida en producción y el modo firmado exige secreto', () => {
    expect(() => loadConfig({ NODE_ENV: 'production', ADS_PROVIDER: 'dev-simulation' })).toThrow(/producción/);
    expect(() => loadConfig({ ADS_PROVIDER: 'signed-callback' })).toThrow(/SECRET/);
    expect(loadConfig({}).ADS_PROVIDER).toBe('none');
  });

  it('simulación de desarrollo: etiquetada, con tiempo mínimo, idempotente y con límite diario', async () => {
    const { client, user } = await registerUser(s.base);
    const st = (await client.get('/api/ads/status')).body;
    expect(st.mode).toBe('dev-simulation');
    expect(st.label).toMatch(/Simulación de desarrollo/);
    const sess = (await client.post('/api/ads/sessions')).body;
    // Terminar antes de tiempo no da nada.
    const early = await client.post(`/api/ads/sessions/${sess.sessionId}/complete`);
    expect(early.body.error.code).toBe('AD_NOT_FINISHED');

    // Con un reloj adelantado (sin esperar de verdad) se comprueba el resto de reglas.
    let now = Date.now() + 16_000;
    const svc = new AdsService(s.app.ctx.db, s.app.ctx.config, createAdProvider(s.app.ctx.config), () => now);
    const before = s.app.ctx.db.get<{ balance: number }>('SELECT balance FROM users WHERE id = ?', user.id)!.balance;
    expect(svc.completeFromClient(user.id, sess.sessionId).reward).toBe(250);
    expect(() => svc.completeFromClient(user.id, sess.sessionId)).toThrow(/ya se ha recompensado/);
    // Otra persona no puede cobrar la sesión ajena.
    const other = await registerUser(s.base);
    const s2 = svc.startSession(user.id, 'player');
    now += 16_000;
    expect(() => svc.completeFromClient(other.user.id, s2.sessionId)).toThrow(/no encontrada/);
    svc.completeFromClient(user.id, s2.sessionId);
    for (let i = 0; i < 3; i += 1) {
      const x = svc.startSession(user.id, 'player');
      now += 16_000;
      svc.completeFromClient(user.id, x.sessionId);
    }
    // Límite diario (5).
    expect(() => svc.startSession(user.id, 'player')).toThrow(/límite/);
    const after = s.app.ctx.db.get<{ balance: number }>('SELECT balance FROM users WHERE id = ?', user.id)!.balance;
    expect(after - before).toBe(5 * 250);
    expect(verifyLedger(s.app.ctx.db, user.id).ok).toBe(true);
  });
});

describe('anuncios con confirmación firmada del proveedor', () => {
  let p: TestServer;
  beforeAll(async () => {
    p = await startServer(undefined, { ADS_PROVIDER: 'signed-callback', ADS_CALLBACK_SECRET: SECRET });
  });
  afterAll(async () => {
    await p.stop();
  });

  it('el navegador no puede concederse la recompensa; solo la llamada firmada del proveedor', async () => {
    const { client, user } = await registerUser(p.base);
    const sess = (await client.post('/api/ads/sessions')).body;
    expect(sess.client.customData).toBe(sess.sessionId);
    const fromBrowser = await client.post(`/api/ads/sessions/${sess.sessionId}/complete`);
    expect(fromBrowser.status).toBe(403);

    // El proveedor confirma (tras el tiempo mínimo) con un reloj adelantado.
    const now = Date.now() + 20_000;
    const svc = new AdsService(p.app.ctx.db, p.app.ctx.config, createAdProvider(p.app.ctx.config), () => now);
    const base = { sessionId: sess.sessionId, userId: user.id, providerTxId: 'tx-1', timestamp: Math.floor(now / 1000) };
    expect(() => svc.handleCallback({ ...base, signature: 'ab'.repeat(32) })).toThrow(/Firma/);
    expect(() => svc.handleCallback({ ...base, timestamp: base.timestamp - 3600, signature: signCallback(SECRET, { ...base, timestamp: base.timestamp - 3600 }) })).toThrow(/caducada/);
    const good = { ...base, signature: signCallback(SECRET, base) };
    expect(svc.handleCallback(good)).toEqual({ ok: true, duplicate: false });
    // Reintento del proveedor: no vuelve a abonar.
    expect(svc.handleCallback(good)).toEqual({ ok: true, duplicate: true });
    const credited = p.app.ctx.db.all(`SELECT 1 FROM wallet_transactions WHERE user_id = ? AND reason = 'ad_reward'`, user.id);
    expect(credited).toHaveLength(1);
    expect((await client.get(`/api/ads/sessions/${sess.sessionId}`)).body.status).toBe('rewarded');
    expect(verifyLedger(p.app.ctx.db, user.id).ok).toBe(true);
  });

  it('la ruta de llamada rechaza firmas falsas sin necesitar cookie ni cabecera CSRF', async () => {
    const res = await fetch(`${p.base}/api/ads/callback`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ sessionId: 'abcdefghijklmnop', userId: 'u', providerTxId: 't', timestamp: Math.floor(Date.now() / 1000), signature: '00' }),
    });
    expect(res.status).toBe(401);
  });
});
