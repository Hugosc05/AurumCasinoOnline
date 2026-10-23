import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createHash } from 'node:crypto';
import { crashPayout, crashPointFromHex } from '@aurum/engine';
import { crashHashFor } from '../src/crash/crash';
import { verifyLedger } from '../src/wallet/wallet';
import { openWs, registerUser, startServer, type TestServer } from './helpers';

let s: TestServer;
/** Punto de choque deseado para cada ronda (rango en centésimas). */
let want: [number, number] = [150, 200];
beforeAll(async () => {
  s = await startServer();
  s.app.ctx.crash.useSeedSource((roundNo) => {
    for (let i = 0; ; i += 1) {
      const seed = `prueba-${roundNo}-${i}`;
      const c = crashPointFromHex(crashHashFor(seed, roundNo));
      if (c >= want[0] && c <= want[1]) return seed;
    }
  });
});
afterAll(async () => {
  await s.stop();
});

const balanceOf = (id: string): number => s.app.ctx.db.get<{ balance: number }>('SELECT balance FROM users WHERE id = ?', id)!.balance;

async function join() {
  const { client, user } = await registerUser(s.base);
  const ws = await openWs(s, client.cookie);
  ws.ws.send(JSON.stringify({ t: 'crash.watch' }));
  const betting = await ws.next((m) => m.t === 'crash.state' && m.state.phase === 'betting', 40_000);
  return { client, user, ws, state: betting.state };
}

describe('Cohete en el servidor', () => {
  it('cobro automático: paga a su objetivo y la semilla revelada verifica el choque', async () => {
    want = [160, 200];
    const { user, ws, state } = await join();
    expect(state.crash).toBeNull();
    expect(state.seed).toBeNull();
    const before = balanceOf(user.id);
    ws.ws.send(JSON.stringify({ t: 'crash.bet', roundNo: state.roundNo, amount: 100, auto: 130 }));
    await ws.next((m) => m.t === 'crash.state' && m.state.you?.amount === 100);
    expect(balanceOf(user.id)).toBe(before - 100);
    const cashed = await ws.next((m) => m.t === 'crash.state' && m.state.you?.cashedAt === 130, 15_000);
    expect(cashed.state.you.payout).toBe(130);
    expect(cashed.state.crash).toBeNull();
    const end = await ws.next((m) => m.t === 'crash.state' && m.state.phase === 'crashed' && m.state.roundNo === state.roundNo, 60_000);
    expect(createHash('sha256').update(end.state.seed).digest('hex')).toBe(state.seedHash);
    expect(crashPointFromHex(crashHashFor(end.state.seed, state.roundNo))).toBe(end.state.crash);
    expect(balanceOf(user.id)).toBe(before + 30);
    expect(verifyLedger(s.app.ctx.db, user.id).ok).toBe(true);
    ws.ws.close();
  }, 90_000);

  it('sin cobrar se pierde la apuesta al estrellarse; cobrar tarde se rechaza', async () => {
    want = [120, 160];
    const { user, ws, state } = await join();
    const before = balanceOf(user.id);
    ws.ws.send(JSON.stringify({ t: 'crash.bet', roundNo: state.roundNo, amount: 40 }));
    const end = await ws.next((m) => m.t === 'crash.state' && m.state.phase === 'crashed' && m.state.roundNo === state.roundNo, 30_000);
    expect(end.state.you.cashedAt).toBeNull();
    ws.ws.send(JSON.stringify({ t: 'crash.cashout', roundNo: state.roundNo }));
    const err = await ws.next((m) => m.t === 'error' && m.ref === 'crash.cashout');
    expect(err.code).toBe('TOO_LATE');
    expect(balanceOf(user.id)).toBe(before - 40);
    const round = s.app.ctx.db.get<{ status: string; payout: number }>(`SELECT status, payout FROM game_rounds WHERE user_id = ? AND game = 'crash'`, user.id)!;
    expect(round).toMatchObject({ status: 'settled', payout: 0 });
    ws.ws.close();
  }, 60_000);

  it('cobro manual: vale lo que marca el reloj del servidor, una sola vez', async () => {
    want = [200, 260];
    const { user, ws, state } = await join();
    const before = balanceOf(user.id);
    ws.ws.send(JSON.stringify({ t: 'crash.bet', roundNo: state.roundNo, amount: 200 }));
    await ws.next((m) => m.t === 'crash.state' && m.state.phase === 'running' && m.state.roundNo === state.roundNo, 10_000);
    await new Promise((r) => setTimeout(r, 1200));
    ws.ws.send(JSON.stringify({ t: 'crash.cashout', roundNo: state.roundNo }));
    ws.ws.send(JSON.stringify({ t: 'crash.cashout', roundNo: state.roundNo }));
    const done = await ws.next((m) => m.t === 'crash.state' && m.state.you?.cashedAt !== null && m.state.you?.cashedAt !== undefined);
    const at = done.state.you.cashedAt as number;
    expect(at).toBeGreaterThanOrEqual(108);
    expect(at).toBeLessThan(130);
    expect(done.state.you.payout).toBe(crashPayout(200, at));
    const dup = await ws.next((m) => m.t === 'error' && m.ref === 'crash.cashout');
    expect(dup.code).toBe('ALREADY_CASHED');
    expect(balanceOf(user.id)).toBe(before - 200 + crashPayout(200, at));
    ws.ws.close();
  }, 60_000);

  it('retirar la apuesta antes del despegue la devuelve; no se puede apostar dos veces ni con la ronda cerrada', async () => {
    want = [150, 200];
    const { user, ws, state } = await join();
    const before = balanceOf(user.id);
    ws.ws.send(JSON.stringify({ t: 'crash.bet', roundNo: state.roundNo, amount: 30 }));
    await ws.next((m) => m.t === 'crash.state' && m.state.you?.amount === 30);
    ws.ws.send(JSON.stringify({ t: 'crash.bet', roundNo: state.roundNo, amount: 30 }));
    expect((await ws.next((m) => m.t === 'error' && m.ref === 'crash.bet')).code).toBe('ALREADY_BET');
    ws.ws.send(JSON.stringify({ t: 'crash.cancel', roundNo: state.roundNo }));
    await ws.next((m) => m.t === 'crash.state' && m.state.you === null && m.state.phase === 'betting');
    expect(balanceOf(user.id)).toBe(before);
    await ws.next((m) => m.t === 'crash.state' && m.state.phase === 'running' && m.state.roundNo === state.roundNo, 10_000);
    ws.ws.send(JSON.stringify({ t: 'crash.bet', roundNo: state.roundNo, amount: 30 }));
    expect((await ws.next((m) => m.t === 'error' && m.ref === 'crash.bet')).code).toBe('BETTING_CLOSED');
    ws.ws.send(JSON.stringify({ t: 'crash.bet', roundNo: state.roundNo, amount: 0 }));
    expect((await ws.next((m) => m.t === 'error' && m.ref === 'crash.bet')).code).toBe('BAD_MESSAGE');
    expect(verifyLedger(s.app.ctx.db, user.id).ok).toBe(true);
    ws.ws.close();
  }, 60_000);

  it('al apagar, las apuestas pendientes se devuelven', async () => {
    want = [150, 200];
    const { user, ws, state } = await join();
    const before = balanceOf(user.id);
    ws.ws.send(JSON.stringify({ t: 'crash.bet', roundNo: state.roundNo, amount: 70 }));
    await ws.next((m) => m.t === 'crash.state' && m.state.you?.amount === 70);
    s.app.ctx.crash.shutdown();
    expect(balanceOf(user.id)).toBe(before);
    expect(s.app.ctx.db.get<{ status: string }>(`SELECT status FROM game_rounds WHERE user_id = ? AND game = 'crash'`, user.id)!.status).toBe('void');
    ws.ws.close();
  });
});
