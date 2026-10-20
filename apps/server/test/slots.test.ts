import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { REEF_TREASURE, createPickBonus, seededRng } from '@aurum/engine';
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

const balanceOf = (id: string): number => s.app.ctx.db.get<{ balance: number }>('SELECT balance FROM users WHERE id = ?', id)!.balance;

describe('máquinas y funciones especiales', () => {
  it('lista las máquinas con su RTP y funciones', async () => {
    const r = (await fetch(`${s.base}/api/rules`).then((x) => x.json())) as any;
    const ids = r.slots.machines.map((m: { id: string }) => m.id);
    expect(ids).toEqual(['aurum-royale', 'tesoro-arrecife']);
    for (const m of r.slots.machines) expect(m.rtp.total).toBeGreaterThan(0.95);
    expect(r.slots.machines[0].freeSpins.multiplier).toBe(2);
    expect(r.slots.machines[1].bonus.picks).toBe(3);
  });

  it('una tirada normal cobra en cada máquina; una máquina desconocida se rechaza', async () => {
    const { client, user } = await registerUser(s.base);
    for (const machine of ['aurum-royale', 'tesoro-arrecife']) {
      const before = balanceOf(user.id);
      const r = await client.post('/api/games/slots/spin', { machine, betPerLine: 1, lines: 20, idempotencyKey: key() });
      expect(r.status).toBe(200);
      expect(r.body.result.machine).toBe(machine);
      expect(balanceOf(user.id)).toBe(before - 20 + r.body.result.totalWin);
    }
    expect((await client.post('/api/games/slots/spin', { machine: 'nope', betPerLine: 1, lines: 20, idempotencyKey: key() })).status).toBe(400);
    expect(verifyLedger(s.app.ctx.db, user.id).ok).toBe(true);
  });

  it('los giros gratis no cobran, usan la apuesta con la que se ganaron y se consumen uno a uno', async () => {
    const { client, user } = await registerUser(s.base);
    s.app.ctx.db.run(
      `INSERT INTO slot_sessions (user_id, machine_id, free_spins_left, free_spins_total, bet_per_line, lines, feature_win, version, updated_at) VALUES (?, 'aurum-royale', 3, 5, 2, 10, 0, 1, ?)`,
      user.id, nowIso(),
    );
    let won = 0;
    for (let i = 0; i < 3; i += 1) {
      const before = balanceOf(user.id);
      // Aunque se pida otra apuesta, el giro gratis usa la original y no cobra nada.
      const r = await client.post('/api/games/slots/spin', { machine: 'aurum-royale', betPerLine: 50, lines: 20, idempotencyKey: key() });
      expect(r.body.result.mode).toBe('free');
      expect(r.body.result.charged).toBe(0);
      expect(r.body.result.betPerLine).toBe(2);
      expect(r.body.result.spinMultiplier).toBe(2);
      expect(r.body.result.freeSpinsAwarded).toBe(0); // no se reactivan
      expect(balanceOf(user.id)).toBe(before + r.body.result.totalWin);
      won += r.body.result.totalWin;
      if (i < 2) expect(r.body.feature.freeSpins.left).toBe(2 - i);
      else expect(r.body.feature.freeSpins).toBeNull();
    }
    // La siguiente vuelve a ser pagada.
    const paid = await client.post('/api/games/slots/spin', { machine: 'aurum-royale', betPerLine: 1, lines: 20, idempotencyKey: key() });
    expect(paid.body.result.mode).toBe('paid');
    expect(won).toBeGreaterThanOrEqual(0);
    expect(verifyLedger(s.app.ctx.db, user.id).ok).toBe(true);
  });

  it('bono de cofres: premios fijados de antemano, nunca enviados sin abrir, sin repetir cofre y bloquea las tiradas', async () => {
    const { client, user } = await registerUser(s.base);
    const state = createPickBonus(REEF_TREASURE, 20, seededRng(3));
    s.app.ctx.db.run(
      `INSERT INTO slot_sessions (user_id, machine_id, bonus_json, version, updated_at) VALUES (?, 'tesoro-arrecife', ?, 1, ?)`,
      user.id, JSON.stringify(state), nowIso(),
    );
    const st = (await client.get('/api/games/slots/state?machine=tesoro-arrecife')).body;
    expect(st.bonus.chests).toHaveLength(9);
    expect(st.bonus.chests.every((c: { prize: number | null }) => c.prize === null)).toBe(true);
    expect(JSON.stringify(st)).not.toContain('prizes');

    const spin = await client.post('/api/games/slots/spin', { machine: 'tesoro-arrecife', betPerLine: 1, lines: 20, idempotencyKey: key() });
    expect(spin.body.error.code).toBe('BONUS_PENDING');

    const before = balanceOf(user.id);
    // Dos clics simultáneos en el mismo cofre: solo uno cuenta.
    const both = await Promise.all([0, 0].map(() => client.post('/api/games/slots/bonus/pick', { machine: 'tesoro-arrecife', index: 6 })));
    expect(both.filter((r) => r.status === 200)).toHaveLength(1);
    const first = both.find((r) => r.status === 200)!.body;
    expect(first.prize).toBe(state.prizes[6]! * 20);
    expect(first.bonus.chests.filter((c: { prize: number | null }) => c.prize !== null)).toHaveLength(1);
    await client.post('/api/games/slots/bonus/pick', { machine: 'tesoro-arrecife', index: 1 });
    const last = (await client.post('/api/games/slots/bonus/pick', { machine: 'tesoro-arrecife', index: 7 })).body;
    expect(last.done).toBe(true);
    const total = (state.prizes[6]! + state.prizes[1]! + state.prizes[7]!) * 20;
    expect(last.bonus.won).toBe(total);
    expect(balanceOf(user.id)).toBe(before + total);
    // Al terminar se revelan todos y se puede volver a girar.
    expect(last.bonus.chests.every((c: { prize: number | null }) => c.prize !== null)).toBe(true);
    expect((await client.post('/api/games/slots/bonus/pick', { machine: 'tesoro-arrecife', index: 2 })).body.error.code).toBe('NO_BONUS');
    expect((await client.post('/api/games/slots/spin', { machine: 'tesoro-arrecife', betPerLine: 1, lines: 20, idempotencyKey: key() })).status).toBe(200);
    expect(verifyLedger(s.app.ctx.db, user.id).ok).toBe(true);
  });
});
