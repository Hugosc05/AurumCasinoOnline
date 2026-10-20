import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Client, registerUser, startServer, type TestServer } from './helpers';

let s: TestServer;
beforeAll(async () => {
  s = await startServer();
});
afterAll(async () => {
  await s.stop();
});

const BETS = [
  { kind: 'straight', numbers: [17], amount: 10 },
  { kind: 'split', numbers: [20, 17], amount: 5 },
  { kind: 'red', amount: 50 },
  { kind: 'dozen', index: 2, amount: 25 },
];

describe('formaciones de ruleta', () => {
  it('guardar, listar, renombrar, duplicar y eliminar (sin apostar nada)', async () => {
    const { client, user } = await registerUser(s.base);
    const balanceBefore = (await client.get('/api/auth/me')).body.user.balance;
    const created = await client.post('/api/me/formations', { name: 'Mi sistema', bets: BETS });
    expect(created.status).toBe(201);
    expect(created.body.total).toBe(90);
    // Los números de los caballos se normalizan.
    expect(created.body.bets.find((b: { kind: string }) => b.kind === 'split').numbers).toEqual([17, 20]);
    const id = created.body.id;

    expect((await client.post('/api/me/formations', { name: 'mi SISTEMA', bets: BETS })).body.error.code).toBe('NAME_TAKEN');
    const renamed = await client.patch(`/api/me/formations/${id}`, { name: 'Números favoritos' });
    expect(renamed.body.name).toBe('Números favoritos');
    const dup = await client.post(`/api/me/formations/${id}/duplicate`);
    expect(dup.body.name).toBe('Números favoritos (copia)');
    expect(dup.body.bets).toEqual(renamed.body.bets);
    const dup2 = await client.post(`/api/me/formations/${id}/duplicate`);
    expect(dup2.body.name).toBe('Números favoritos (copia 2)');

    const list = (await client.get('/api/me/formations')).body.items;
    expect(list).toHaveLength(3);
    expect((await client.req('DELETE', `/api/me/formations/${dup2.body.id}`)).status).toBe(200);
    expect((await client.get('/api/me/formations')).body.items).toHaveLength(2);

    // Nada de esto mueve el saldo ni crea partidas.
    expect((await client.get('/api/auth/me')).body.user.balance).toBe(balanceBefore);
    expect(s.app.ctx.db.get<{ n: number }>('SELECT COUNT(*) AS n FROM game_rounds WHERE user_id = ?', user.id)!.n).toBe(0);
  });

  it('las apuestas repetidas se unen y las ilegales se rechazan con las reglas del motor', async () => {
    const { client } = await registerUser(s.base);
    const merged = await client.post('/api/me/formations', { name: 'Doble', bets: [{ kind: 'red', amount: 10 }, { kind: 'red', amount: 15 }] });
    expect(merged.body.bets).toEqual([{ kind: 'red', amount: 25 }]);
    expect((await client.post('/api/me/formations', { name: 'Mal caballo', bets: [{ kind: 'split', numbers: [1, 5], amount: 5 }] })).body.error.code).toBe('INVALID_NUMBERS');
    expect((await client.post('/api/me/formations', { name: 'Excesiva', bets: [{ kind: 'straight', numbers: [1], amount: 99999 }] })).body.error.code).toBe('OVER_LIMIT');
    expect((await client.post('/api/me/formations', { name: '', bets: BETS })).status).toBe(400);
  });

  it('la comprobación al cargar avisa si no hay saldo suficiente', async () => {
    const { client, user } = await registerUser(s.base);
    const f = (await client.post('/api/me/formations', { name: 'Grande', bets: [{ kind: 'red', amount: 5000 }] })).body;
    expect((await client.get(`/api/me/formations/${f.id}/check`)).body).toMatchObject({ legal: true, affordable: true, total: 5000 });
    s.app.ctx.db.run('UPDATE users SET balance = 100 WHERE id = ?', user.id);
    expect((await client.get(`/api/me/formations/${f.id}/check`)).body).toMatchObject({ legal: true, affordable: false });
  });

  it('cada formación pertenece a su usuario: nadie más puede verla ni tocarla', async () => {
    const a = await registerUser(s.base);
    const b = await registerUser(s.base);
    const f = (await a.client.post('/api/me/formations', { name: 'Privada', bets: BETS })).body;
    expect((await b.client.get('/api/me/formations')).body.items).toHaveLength(0);
    expect((await b.client.patch(`/api/me/formations/${f.id}`, { name: 'Robada' })).status).toBe(404);
    expect((await b.client.post(`/api/me/formations/${f.id}/duplicate`)).status).toBe(404);
    expect((await b.client.req('DELETE', `/api/me/formations/${f.id}`)).status).toBe(404);
    expect((await b.client.get(`/api/me/formations/${f.id}/check`)).status).toBe(404);
    expect((await new Client(s.base).get('/api/me/formations')).status).toBe(401);
    expect((await a.client.get('/api/me/formations')).body.items[0].name).toBe('Privada');
  });
});
