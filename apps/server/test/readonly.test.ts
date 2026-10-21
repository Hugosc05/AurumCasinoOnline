import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createAdmin, key, registerUser, startServer, type TestServer } from './helpers';

// Recorre todas las consultas de lectura (también las del panel) tras generar algo de actividad.
// Sirve sobre todo para comprobar que el SQL es válido en SQLite y en PostgreSQL (npm run test:pg).
let s: TestServer;
beforeAll(async () => {
  s = await startServer();
});
afterAll(async () => {
  await s.stop();
});

describe('consultas de lectura en ambos motores', () => {
  it('jugador y administración responden sin errores con datos reales', async () => {
    const { client, user } = await registerUser(s.base);
    await client.post('/api/games/roulette/spin', { idempotencyKey: key(), bets: [{ kind: 'red', amount: 10 }, { kind: 'straight', numbers: [7], amount: 5 }] });
    await client.post('/api/games/slots/spin', { betPerLine: 1, lines: 20, idempotencyKey: key() });
    await client.post('/api/me/promotions/daily-bonus');
    for (const p of ['/api/health', '/api/lobby', '/api/activity', '/api/rules', '/api/bots', '/api/me/stats', '/api/me/history', '/api/me/transactions', '/api/me/achievements', '/api/me/promotions', '/api/me/formations', '/api/social/friends', '/api/social/notifications', '/api/rooms']) {
      const r = await client.get(p);
      expect(r.status, p).toBe(200);
    }
    for (const by of ['net', 'balance', 'biggest', 'streak']) expect((await client.get(`/api/leaderboard?by=${by}`)).status, by).toBe(200);
    expect((await client.get('/api/me/history?game=roulette')).body.total).toBe(1);

    const admin = (await createAdmin(s)).client;
    for (const p of ['/api/admin/overview', '/api/admin/users', `/api/admin/users?q=${user.username.slice(0, 5)}`, `/api/admin/users/${user.id}`, '/api/admin/rounds', '/api/admin/rounds?game=slots', '/api/admin/poker-hands', '/api/admin/bots', '/api/admin/blackjack-tables', '/api/admin/tables', '/api/admin/settings', '/api/admin/errors', '/api/admin/audit', '/api/admin/diagnostics']) {
      const r = await admin.get(p);
      expect(r.status, p).toBe(200);
    }
    const check = await admin.post('/api/admin/diagnostics/ledger-check');
    expect(check.status).toBe(200);
    expect(check.body.problems).toEqual([]);
  });
});
