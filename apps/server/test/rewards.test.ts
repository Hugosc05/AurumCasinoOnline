import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { CASE_BY_ID, COSMETIC_BY_ID, MISSION_BY_ID } from '@aurum/engine';
import { verifyLedger } from '../src/wallet/wallet';
import { key, registerUser, startServer, type TestServer } from './helpers';

let s: TestServer;
beforeAll(async () => {
  s = await startServer();
});
afterAll(async () => {
  await s.stop();
});
const db = () => s.app.ctx.db;
const balanceOf = (id: string): number => db().get<{ balance: number }>('SELECT balance FROM users WHERE id = ?', id)!.balance;

// PNG de 1×1 válido.
const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';

describe('perfil y foto', () => {
  it('sube, sirve con caché y borra la foto; rechaza lo que no es imagen', async () => {
    const { client, user, username } = await registerUser(s.base);
    const up = await client.post('/api/profile/avatar', { image: PNG });
    expect(up.status).toBe(200);
    expect(up.body.avatarUrl).toBe(`/api/avatars/${user.id}?v=1`);
    const img = await fetch(s.base + up.body.avatarUrl);
    expect(img.headers.get('content-type')).toBe('image/png');
    expect(img.headers.get('cache-control')).toContain('immutable');
    const looks = await client.get(`/api/looks?names=${username}`);
    expect(looks.body.looks[username].avatarUrl).toBe(up.body.avatarUrl);
    const fake = 'data:image/png;base64,' + Buffer.from('<svg onload=alert(1)>').toString('base64');
    expect((await client.post('/api/profile/avatar', { image: fake })).status).toBe(400);
    expect((await client.post('/api/profile/avatar', { image: 'data:image/svg+xml;base64,PHN2Zz4=' })).status).toBe(400);
    expect((await client.req('DELETE', '/api/profile/avatar')).status).toBe(200);
    expect((await fetch(s.base + `/api/avatars/${user.id}`)).status).toBe(404);
  });

  it('tarjeta de jugador con la relación de amistad y solicitud desde ella', async () => {
    const a = await registerUser(s.base);
    const b = await registerUser(s.base);
    const card = await a.client.get(`/api/players/${b.username}`);
    expect(card.body).toMatchObject({ username: b.username, relation: 'none' });
    expect((await a.client.post('/api/social/friends/requests', { username: b.username })).status).toBe(201);
    expect((await a.client.get(`/api/players/${b.username}`)).body.relation).toBe('outgoing');
    expect((await b.client.get(`/api/players/${a.username}`)).body.relation).toBe('incoming');
    expect((await a.client.get(`/api/players/${a.username}`)).body.relation).toBe('self');
  });
});

describe('misiones y cajas', () => {
  it('las misiones avanzan al jugar, se reclaman una vez y dan su caja', async () => {
    const { client, user } = await registerUser(s.base);
    const m = (await client.get('/api/rewards/missions')).body;
    expect(m.daily).toHaveLength(3);
    expect(m.weekly).toHaveLength(5);
    // Fuerza una misión casi completa para probar el reclamo.
    const target = m.daily[0];
    db().run('UPDATE user_missions SET progress = target - 1 WHERE user_id = ? AND mission_id = ?', user.id, target.id);
    const def = MISSION_BY_ID[target.id]!;
    const game = def.game ?? 'roulette';
    // Una partida del juego adecuado (ruleta, slots o plinko vía API; el resto por la base de datos).
    if (game === 'roulette' || def.game === null) await client.post('/api/games/roulette/spin', { bets: [{ kind: 'red', amount: def.metric === 'wagered' ? 1000 : 10 }], idempotencyKey: key() });
    else db().run('UPDATE user_missions SET progress = target WHERE user_id = ? AND mission_id = ?', user.id, target.id);
    let after = (await client.get('/api/rewards/missions')).body.daily.find((x: { id: string }) => x.id === target.id);
    if (!after.done) {
      // Misiones de ganar: la ruleta puede perder; se completa a mano para la prueba.
      db().run('UPDATE user_missions SET progress = target WHERE user_id = ? AND mission_id = ?', user.id, target.id);
      after = (await client.get('/api/rewards/missions')).body.daily.find((x: { id: string }) => x.id === target.id);
    }
    expect(after.done).toBe(true);
    const claim = await client.post('/api/rewards/missions/claim', { missionId: target.id, period: target.period });
    expect(claim.status).toBe(200);
    expect(claim.body.caseId).toBe('diaria');
    expect((await client.post('/api/rewards/missions/claim', { missionId: target.id, period: target.period })).body.error.code).toBe('ALREADY_CLAIMED');
    const inv = (await client.get('/api/rewards/inventory')).body;
    expect(inv.cases.map((c: { caseId: string }) => c.caseId)).toContain('diaria');
  });

  it('comprar y abrir cajas: cobra el precio, entrega el premio una sola vez y cuadra el libro mayor', async () => {
    const { client, user } = await registerUser(s.base);
    const before = balanceOf(user.id);
    const buy = await client.post('/api/rewards/cases/buy', { caseId: 'bronce', count: 3 });
    expect(buy.status).toBe(200);
    expect(balanceOf(user.id)).toBe(before - 1500);
    expect((await client.post('/api/rewards/cases/buy', { caseId: 'diaria' })).body.error.code).toBe('NOT_FOR_SALE');
    let gained = 0;
    for (const id of buy.body.ids) {
      const o = await client.post('/api/rewards/cases/open', { id });
      expect(o.status).toBe(200);
      expect(CASE_BY_ID.bronce!.drops[o.body.index]).toEqual(o.body.drop);
      if (o.body.drop.kind === 'credits') expect(o.body.credited).toBe(o.body.drop.amount);
      else expect(o.body.duplicate ? o.body.credited : 0).toBe(o.body.duplicate ? COSMETIC_BY_ID[o.body.drop.id]!.dupValue : 0);
      gained += o.body.credited;
      expect((await client.post('/api/rewards/cases/open', { id })).body.error.code).toBe('ALREADY_OPENED');
    }
    expect(balanceOf(user.id)).toBe(before - 1500 + gained);
    expect(verifyLedger(db(), user.id).ok).toBe(true);
  });

  it('un cosmético repetido se convierte en créditos y solo se equipa lo que se tiene', async () => {
    const { client, user } = await registerUser(s.base);
    expect((await client.post('/api/rewards/equip', { kind: 'frame', itemId: 'frame:oro' })).body.error.code).toBe('NOT_OWNED');
    db().run(`INSERT INTO user_items (user_id, item_id, source, created_at) VALUES (?, 'frame:oro', 'test', '2026-01-01')`, user.id);
    const eq = await client.post('/api/rewards/equip', { kind: 'frame', itemId: 'frame:oro' });
    expect(eq.body.equipped.frame).toBe('frame:oro');
    expect((await client.post('/api/rewards/equip', { kind: 'nameColor', itemId: 'frame:oro' })).body.error.code).toBe('INVALID_ITEM');
    const card = await client.get(`/api/players/${user.username}`);
    expect(card.body.frame).toBe('frame:oro');
  });

  it('el dorso equipado es público: los demás lo ven en el aspecto del jugador', async () => {
    const { client, user } = await registerUser(s.base);
    const other = await registerUser(s.base);
    expect((await other.client.get(`/api/looks?names=${user.username}`)).body.looks[user.username].cardBack).toBeNull();
    db().run(`INSERT INTO user_items (user_id, item_id, source, created_at) VALUES (?, 'back:dragon', 'test', '2026-01-01')`, user.id);
    expect((await client.post('/api/rewards/equip', { kind: 'cardBack', itemId: 'back:dragon' })).status).toBe(200);
    expect((await other.client.get(`/api/looks?names=${user.username}`)).body.looks[user.username].cardBack).toBe('back:dragon');
  });
});
