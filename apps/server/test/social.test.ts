import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Client, openWs, registerUser, startServer, type TestServer } from './helpers';

let s: TestServer;
beforeAll(async () => {
  s = await startServer();
});
afterAll(async () => {
  await s.stop();
});

describe('amigos', () => {
  it('buscar, enviar, aceptar y eliminar; sin datos privados', async () => {
    const a = await registerUser(s.base, 'ana');
    const b = await registerUser(s.base, 'bea');
    const found = (await a.client.get(`/api/social/friends/search?q=${b.username.slice(0, 6)}`)).body.items;
    const hit = found.find((x: { username: string }) => x.username === b.username);
    expect(hit).toMatchObject({ relation: 'none' });
    expect(Object.keys(hit).sort()).toEqual(['id', 'relation', 'requestId', 'username']);
    expect(JSON.stringify(found)).not.toContain('@example.com');

    const sent = await a.client.post('/api/social/friends/requests', { username: b.username });
    expect(sent.status).toBe(201);
    expect((await a.client.post('/api/social/friends/requests', { username: b.username })).body.error.code).toBe('ALREADY_SENT');
    const inbox = (await b.client.get('/api/social/friends')).body;
    expect(inbox.incoming).toHaveLength(1);
    expect((await b.client.get('/api/social/notifications')).body.unread).toBe(1);

    // Quien envía no puede aceptar su propia solicitud.
    expect((await a.client.post(`/api/social/friends/requests/${sent.body.requestId}/accept`)).status).toBe(403);
    expect((await b.client.post(`/api/social/friends/requests/${sent.body.requestId}/accept`)).status).toBe(200);
    const listA = (await a.client.get('/api/social/friends')).body;
    expect(listA.friends.map((f: { username: string }) => f.username)).toEqual([b.username]);
    expect(JSON.stringify(listA)).not.toMatch(/email|balance|password/);
    expect((await a.client.get('/api/social/notifications')).body.items[0].kind).toBe('friend_accepted');

    expect((await b.client.req('DELETE', `/api/social/friends/${a.user.id}`)).status).toBe(200);
    expect((await a.client.get('/api/social/friends')).body.friends).toHaveLength(0);
    expect((await b.client.req('DELETE', `/api/social/friends/${a.user.id}`)).status).toBe(404);
  });

  it('rechazar y cancelar solo los puede hacer quien corresponde; no hay relaciones duplicadas', async () => {
    const a = await registerUser(s.base);
    const b = await registerUser(s.base);
    const c = await registerUser(s.base);
    const r1 = (await a.client.post('/api/social/friends/requests', { username: b.username })).body.requestId;
    // Un tercero no puede tocar la solicitud.
    expect((await c.client.post(`/api/social/friends/requests/${r1}/accept`)).status).toBe(403);
    expect((await c.client.post(`/api/social/friends/requests/${r1}/reject`)).status).toBe(403);
    expect((await c.client.req('DELETE', `/api/social/friends/requests/${r1}`)).status).toBe(403);
    // El destinatario no la puede "cancelar"; el remitente no la puede "rechazar".
    expect((await b.client.req('DELETE', `/api/social/friends/requests/${r1}`)).status).toBe(403);
    expect((await a.client.post(`/api/social/friends/requests/${r1}/reject`)).status).toBe(403);
    expect((await a.client.req('DELETE', `/api/social/friends/requests/${r1}`)).status).toBe(200);
    expect((await b.client.get('/api/social/friends')).body.incoming).toHaveLength(0);

    // Si B la envía estando pendiente la de A, se acepta: nunca dos filas para la misma pareja.
    await a.client.post('/api/social/friends/requests', { username: b.username });
    const back = await b.client.post('/api/social/friends/requests', { username: a.username });
    expect(back.body.accepted).toBe(true);
    const rows = s.app.ctx.db.get<{ n: number }>('SELECT COUNT(*) AS n FROM friendships WHERE pair_key IN (?, ?)', `${a.user.id}|${b.user.id}`, `${b.user.id}|${a.user.id}`)!.n;
    expect(rows).toBe(1);
    expect((await a.client.post('/api/social/friends/requests', { username: b.username })).body.error.code).toBe('ALREADY_FRIENDS');

    // Rechazo.
    const r2 = (await a.client.post('/api/social/friends/requests', { username: c.username })).body.requestId;
    expect((await c.client.post(`/api/social/friends/requests/${r2}/reject`)).status).toBe(200);
    expect((await a.client.get('/api/social/friends')).body.outgoing).toHaveLength(0);
  });

  it('no se puede enviar a uno mismo, a nombres inexistentes ni a bots; sin sesión no hay acceso', async () => {
    const a = await registerUser(s.base);
    expect((await a.client.post('/api/social/friends/requests', { username: a.username })).body.error.code).toBe('SELF');
    expect((await a.client.post('/api/social/friends/requests', { username: 'nadiexyz123' })).status).toBe(404);
    // Los bots no son usuarios: ni se encuentran ni aceptan solicitudes.
    expect((await a.client.post('/api/social/friends/requests', { username: 'LunaCards' })).status).toBe(404);
    expect((await a.client.get('/api/social/friends/search?q=LunaC')).body.items).toHaveLength(0);
    expect((await new Client(s.base).get('/api/social/friends')).status).toBe(401);
  });

  it('presencia real: conectado, jugando o desconectado; el modo invisible oculta la actividad', async () => {
    const a = await registerUser(s.base);
    const b = await registerUser(s.base);
    await a.client.post('/api/social/friends/requests', { username: b.username });
    const req = (await b.client.get('/api/social/friends')).body.incoming[0].requestId;
    await b.client.post(`/api/social/friends/requests/${req}/accept`);
    const presence = async () => (await a.client.get('/api/social/friends')).body.friends[0].presence;
    expect(await presence()).toEqual({ status: 'offline', game: null });

    const wa = await openWs(s, a.client.cookie);
    const wb = await openWs(s, b.client.cookie);
    await wa.next((m) => m.t === 'friends.changed');
    expect(await presence()).toEqual({ status: 'available', game: null });
    wb.ws.send(JSON.stringify({ t: 'bj.sit', tableId: 'nacar' }));
    await wb.next((m) => m.t === 'bj.snapshot');
    expect(await presence()).toEqual({ status: 'playing', game: 'blackjack' });

    await b.client.patch('/api/me/preferences', { invisible: true });
    expect(await presence()).toEqual({ status: 'offline', game: null });
    await b.client.patch('/api/me/preferences', { invisible: false });
    wb.ws.send(JSON.stringify({ t: 'bj.leave', tableId: 'nacar' }));
    await wb.next((m) => m.t === 'bj.left');
    expect((await presence()).status).toBe('available');
    wb.ws.close();
    await new Promise((r) => setTimeout(r, 150));
    expect((await presence()).status).toBe('offline');
    wa.ws.close();
  });

  it('las notificaciones se marcan como leídas solo para su dueño', async () => {
    const a = await registerUser(s.base);
    const b = await registerUser(s.base);
    await a.client.post('/api/social/friends/requests', { username: b.username });
    const n = (await b.client.get('/api/social/notifications')).body.items[0];
    await a.client.post('/api/social/notifications/read', { ids: [n.id] });
    expect((await b.client.get('/api/social/notifications')).body.unread).toBe(1);
    await b.client.post('/api/social/notifications/read', {});
    expect((await b.client.get('/api/social/notifications')).body.unread).toBe(0);
  });
});
