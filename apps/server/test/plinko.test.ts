import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { plinkoTable } from '@aurum/engine';
import { verifyLedger } from '../src/wallet/wallet';
import { key, registerUser, startServer, type TestServer } from './helpers';

let s: TestServer;
beforeAll(async () => {
  s = await startServer();
});
afterAll(async () => {
  await s.stop();
});

describe('Plinko en el servidor', () => {
  it('cada bola cobra la apuesta, paga según su casilla y cuadra con el libro mayor', async () => {
    const { client, user } = await registerUser(s.base);
    const before = (await client.get('/api/auth/me')).body.user.balance as number;
    const r = await client.post('/api/games/plinko/drop', { rows: 12, risk: 'high', bet: 10, count: 5, idempotencyKey: key() });
    expect(r.status).toBe(200);
    expect(r.body.balls).toHaveLength(5);
    let paid = 0;
    for (const b of r.body.balls) {
      expect(b.path).toHaveLength(12);
      expect(b.bucket).toBe(b.path.reduce((a: number, x: number) => a + x, 0));
      expect(b.multiplier).toBe(plinkoTable(12, 'high')[b.bucket]);
      expect(b.payout).toBe(Math.floor(10 * b.multiplier + 1e-9));
      paid += b.payout;
    }
    expect(r.body.balance.balance).toBe(before - 50 + paid);
    expect(verifyLedger(s.app.ctx.db, user.id).ok).toBe(true);
  });

  it('repetir la clave devuelve las mismas bolas sin cobrar otra vez', async () => {
    const { client } = await registerUser(s.base);
    const k = key();
    const a = await client.post('/api/games/plinko/drop', { rows: 8, risk: 'low', bet: 20, count: 3, idempotencyKey: k });
    const b = await client.post('/api/games/plinko/drop', { rows: 8, risk: 'low', bet: 20, count: 3, idempotencyKey: k });
    expect(b.body.replayed).toBe(true);
    expect(b.body.balls.map((x: { roundId: string }) => x.roundId)).toEqual(a.body.balls.map((x: { roundId: string }) => x.roundId));
    expect(b.body.balance.balance).toBe(a.body.balance.balance);
  });

  it('rechaza filas, riesgo y apuestas no válidas sin cobrar', async () => {
    const { client } = await registerUser(s.base);
    const before = (await client.get('/api/auth/me')).body.user.balance as number;
    for (const body of [{ rows: 10, risk: 'low', bet: 10 }, { rows: 8, risk: 'x', bet: 10 }, { rows: 8, risk: 'low', bet: 0 }, { rows: 8, risk: 'low', bet: 999999 }, { rows: 8, risk: 'low', bet: 10, count: 11 }]) {
      const r = await client.post('/api/games/plinko/drop', { ...body, idempotencyKey: key() });
      expect(r.status).toBe(400);
    }
    expect((await client.post('/api/games/plinko/drop', { rows: 16, risk: 'low', bet: 1_000_000, idempotencyKey: key() })).status).toBe(400);
    expect((await client.get('/api/auth/me')).body.user.balance).toBe(before);
  });
});
