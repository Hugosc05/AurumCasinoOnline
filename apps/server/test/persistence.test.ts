import { describe, expect, it } from 'vitest';
import { Client, key, registerUser, startServer } from './helpers';

describe('persistencia', () => {
  it('saldo, historial y sesión sobreviven a un reinicio del servidor', async () => {
    const s1 = await startServer();
    const { client, username, password } = await registerUser(s1.base);
    for (let i = 0; i < 5; i += 1) {
      await client.post('/api/games/slots/spin', { betPerLine: 1, lines: 20, idempotencyKey: key() });
    }
    const before = (await client.get('/api/auth/me')).body.user.balance as number;
    const cookie = client.cookie;
    const dbFile = s1.dbFile;
    await s1.stop(true);

    const s2 = await startServer(dbFile);
    try {
      // La sesión sigue siendo válida (token persistido como hash).
      const same = new Client(s2.base);
      same.cookie = cookie;
      expect((await same.get('/api/auth/me')).body.user.balance).toBe(before);
      const fresh = new Client(s2.base);
      expect((await fresh.post('/api/auth/login', { identifier: username, password })).status).toBe(200);
      const hist = await fresh.get('/api/me/history');
      expect(hist.body.total).toBe(5);
    } finally {
      await s2.stop();
    }
  });
});
