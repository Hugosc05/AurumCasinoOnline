import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { VEGAS_NIGHTS, createHoldWin, createSafe, createWheel, seededRng, type ExtraFeature } from '@aurum/engine';
import { nowIso } from '../src/db/database';
import { verifyLedger } from '../src/wallet/wallet';
import { key, registerUser, startServer, type TestServer } from './helpers';

let s: TestServer;
beforeAll(async () => {
  s = await startServer();
});
afterAll(async () => {
  await s.stop();
});

const x = VEGAS_NIGHTS.extras!;
const M = 'vegas-nights';
const db = () => s.app.ctx.db;
const balanceOf = (id: string): number => db().get<{ balance: number }>('SELECT balance FROM users WHERE id = ?', id)!.balance;
const pool = (): number => Number(db().get<{ grand_milli: number }>('SELECT grand_milli FROM slot_jackpots WHERE machine_id = ?', M)?.grand_milli ?? 0);

/** Deja un minijuego pendiente como si lo hubiera activado una tirada (solo para las pruebas). */
function inject(userId: string, queue: ExtraFeature[]): void {
  db().run(
    `INSERT INTO slot_sessions (user_id, machine_id, feature_json, version, updated_at) VALUES (?, ?, ?, 1, ?)
     ON CONFLICT(user_id, machine_id) DO UPDATE SET feature_json = excluded.feature_json, version = slot_sessions.version + 1`,
    userId, M, JSON.stringify({ queue }), nowIso(),
  );
}

describe('Vegas Nights en el servidor', () => {
  it('cada tirada pagada alimenta el Grand y los billetes visibles llevan su premio', async () => {
    const { client } = await registerUser(s.base);
    const r0 = await client.post('/api/games/slots/spin', { machine: M, betPerLine: 5, lines: 20, idempotencyKey: key() });
    expect(r0.status).toBe(200);
    // Si la primera tirada activó un minijuego (poco probable), se descarta para la prueba.
    db().run('UPDATE slot_sessions SET feature_json = NULL WHERE machine_id = ?', M);
    const before = pool();
    const r = await client.post('/api/games/slots/spin', { machine: M, betPerLine: 5, lines: 20, idempotencyKey: key() });
    expect(pool() - before).toBe(100 * x.jackpots.grandContribution * 1000);
    expect(r.body.result.cash.length).toBe(r.body.result.grid.flat().filter((c: string) => c === 'cash').length);
    expect(r.body.feature.jackpots).toMatchObject({ mini: 10, minor: 25, major: 100, grandRefBet: 2000 });
    expect(r.body.feature.jackpots.grandPool).toBeGreaterThanOrEqual(x.jackpots.grandSeed);
  });

  it('rueda: el sector no viaja hasta girar; bloquea las tiradas y paga al girar', async () => {
    const { client, user } = await registerUser(s.base);
    const wheel = createWheel(x, 20, seededRng(4));
    inject(user.id, [wheel]);
    const st = (await client.get(`/api/games/slots/state?machine=${M}`)).body;
    expect(st.extra).toMatchObject({ kind: 'wheel', segment: null });
    expect(JSON.stringify(st)).not.toContain('"segment":' + wheel.segment + ',');
    expect((await client.post('/api/games/slots/spin', { machine: M, betPerLine: 1, lines: 20, idempotencyKey: key() })).body.error.code).toBe('FEATURE_PENDING');
    expect((await client.post('/api/games/slots/feature', { machine: M, action: 'pick', index: 0 })).status).toBe(400);
    const before = balanceOf(user.id);
    const r = await client.post('/api/games/slots/feature', { machine: M, action: 'spin' });
    expect(r.status).toBe(200);
    expect(r.body.reveal.segment).toBe(wheel.segment);
    const prize = x.wheel.segments[wheel.segment]!.prize;
    if (prize.kind === 'credit') expect(r.body.finished.won).toBe(prize.mult * 20);
    expect(balanceOf(user.id)).toBe(before + r.body.finished.won);
    expect(r.body.state.extra).toBeNull();
    expect((await client.post('/api/games/slots/feature', { machine: M, action: 'spin' })).status).toBe(409);
    expect(verifyLedger(db(), user.id).ok).toBe(true);
  });

  it('caja fuerte: solo se envían las abiertas; gana el primer bote con tres; el Grand sale del bote', async () => {
    const { client, user } = await registerUser(s.base);
    const safe = createSafe(x, 2000, seededRng(1));
    // Se ordena para que el Grand sea el primero en reunir tres.
    safe.tiles = ['grand', 'mini', 'grand', 'minor', 'grand', ...safe.tiles.filter((t) => t !== 'grand').slice(2)] as typeof safe.tiles;
    inject(user.id, [safe]);
    const st = (await client.get(`/api/games/slots/state?machine=${M}`)).body;
    expect(st.extra.revealed).toBeNull();
    expect(JSON.stringify(st)).not.toContain('tiles');
    const poolBefore = Math.floor(pool() / 1000);
    const before = balanceOf(user.id);
    for (const i of [0, 1, 2, 3]) expect((await client.post('/api/games/slots/feature', { machine: M, action: 'pick', index: i })).body.finished).toBeNull();
    expect((await client.post('/api/games/slots/feature', { machine: M, action: 'pick', index: 1 })).body.error.code).toBe('ALREADY_OPENED');
    const last = await client.post('/api/games/slots/feature', { machine: M, action: 'pick', index: 4 });
    expect(last.body.finished.jackpots).toEqual(['grand']);
    expect(last.body.finished.grand).toBe(poolBefore);
    expect(balanceOf(user.id)).toBe(before + poolBefore);
    expect(Math.floor(pool() / 1000)).toBe(x.jackpots.grandSeed);
    expect(last.body.feature.revealed).toHaveLength(15);
  });

  it('Hold & Win: cada re-giro es una petición; termina y paga la suma de billetes', async () => {
    const { client, user } = await registerUser(s.base);
    const hw = createHoldWin(x, 10, Array.from({ length: 6 }, (_, cell) => ({ cell, value: { kind: 'credit' as const, mult: 2 } })));
    inject(user.id, [hw, createWheel(x, 10, seededRng(2))]);
    const before = balanceOf(user.id);
    let r;
    let n = 0;
    do {
      r = await client.post('/api/games/slots/feature', { machine: M, action: 'respin' });
      expect(r.status).toBe(200);
      n += 1;
    } while (!r.body.finished && n < 200);
    expect(r.body.finished.won).toBe(r.body.feature.won);
    expect(r.body.finished.won).toBeGreaterThanOrEqual(120);
    expect(balanceOf(user.id)).toBe(before + r.body.finished.won);
    // Pasa al siguiente minijuego de la cola.
    expect(r.body.state.extra.kind).toBe('wheel');
    expect((await client.post('/api/games/slots/feature', { machine: M, action: 'respin' })).status).toBe(400);
    expect(verifyLedger(db(), user.id).ok).toBe(true);
  });

  it('dos acciones simultáneas no juegan dos veces el mismo paso', async () => {
    const { client, user } = await registerUser(s.base);
    inject(user.id, [createWheel(x, 10, seededRng(8))]);
    const before = balanceOf(user.id);
    const rs = await Promise.all([1, 2, 3].map(() => client.post('/api/games/slots/feature', { machine: M, action: 'spin' })));
    expect(rs.filter((r) => r.status === 200)).toHaveLength(1);
    const won = rs.find((r) => r.status === 200)!.body.finished.won;
    expect(balanceOf(user.id)).toBe(before + won);
  });
});
