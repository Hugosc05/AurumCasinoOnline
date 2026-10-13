import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { settleRound, openRound } from '../src/games/rounds';
import { verifyLedger } from '../src/wallet/wallet';
import { Client, createAdmin, key, registerUser, startServer, type TestServer } from './helpers';

let s: TestServer;
beforeAll(async () => {
  s = await startServer();
});
afterAll(async () => {
  await s.stop();
});

describe('ruleta (servidor)', () => {
  it('liquida y el saldo cuadra con el libro mayor', async () => {
    const { client, user } = await registerUser(s.base);
    let expected = 10000;
    for (let i = 0; i < 15; i += 1) {
      const r = await client.post('/api/games/roulette/spin', {
        bets: [{ kind: 'red', amount: 10 }, { kind: 'straight', numbers: [17], amount: 5 }, { kind: 'split', numbers: [0, 2], amount: 5 }],
        idempotencyKey: key(),
      });
      expect(r.status).toBe(200);
      expect(r.body.result.number).toBeGreaterThanOrEqual(0);
      expect(r.body.result.number).toBeLessThanOrEqual(36);
      expected += r.body.result.totalPayout - 20;
      expect(r.body.balance.balance).toBe(expected);
    }
    expect(verifyLedger(s.app.ctx.db, user.id).ok).toBe(true);
  });

  it('rechaza apuestas inválidas sin cobrar', async () => {
    const { client } = await registerUser(s.base);
    const bad = [
      { bets: [{ kind: 'split', numbers: [3, 4], amount: 10 }] },
      { bets: [{ kind: 'red', amount: -5 }] },
      { bets: [{ kind: 'straight', numbers: [37], amount: 5 }] },
      { bets: [{ kind: 'dozen', index: 4, amount: 5 }] },
      { bets: [] },
      { bets: [{ kind: 'red', amount: 1.5 }] },
    ];
    for (const b of bad) {
      const r = await client.post('/api/games/roulette/spin', { ...b, idempotencyKey: key() });
      expect(r.status).toBe(400);
    }
    const me = await client.get('/api/auth/me');
    expect(me.body.user.balance).toBe(10000);
  });

  it('idempotencia: la misma clave no cobra dos veces', async () => {
    const { client } = await registerUser(s.base);
    const k = key();
    const body = { bets: [{ kind: 'black', amount: 100 }], idempotencyKey: k };
    const a = await client.post('/api/games/roulette/spin', body);
    const b = await client.post('/api/games/roulette/spin', body);
    expect(b.body.replayed).toBe(true);
    expect(b.body.roundId).toBe(a.body.roundId);
    expect(b.body.result.number).toBe(a.body.result.number);
    expect(b.body.balance.balance).toBe(a.body.balance.balance);
  });

  it('no permite apostar más del saldo', async () => {
    const { client } = await registerUser(s.base);
    const r = await client.post('/api/games/roulette/spin', { bets: Array.from({ length: 11 }, () => ({ kind: 'red', amount: 1000 })), idempotencyKey: key() });
    expect(r.status).toBe(402);
    expect((await client.get('/api/auth/me')).body.user.balance).toBe(10000);
  });
});

describe('slots (servidor)', () => {
  it('el premio cobrado coincide con la cuadrícula devuelta', async () => {
    const { client, user } = await registerUser(s.base);
    for (let i = 0; i < 20; i += 1) {
      const r = await client.post('/api/games/slots/spin', { betPerLine: 2, lines: 20, idempotencyKey: key() });
      expect(r.status).toBe(200);
      const res = r.body.result;
      expect(res.totalBet).toBe(40);
      expect(res.grid).toHaveLength(5);
      const sum = res.lineWins.reduce((a: number, w: { payout: number }) => a + w.payout, 0) + (res.scatterWin?.payout ?? 0);
      expect(res.totalWin).toBe(sum);
    }
    expect(verifyLedger(s.app.ctx.db, user.id).ok).toBe(true);
  });
  it('valida límites de apuesta y líneas', async () => {
    const { client } = await registerUser(s.base);
    expect((await client.post('/api/games/slots/spin', { betPerLine: 0, lines: 20, idempotencyKey: key() })).status).toBe(400);
    expect((await client.post('/api/games/slots/spin', { betPerLine: 101, lines: 20, idempotencyKey: key() })).status).toBe(400);
    expect((await client.post('/api/games/slots/spin', { betPerLine: 1, lines: 3, idempotencyKey: key() })).status).toBe(400);
  });
});

describe('blackjack (servidor)', () => {
  it('juega manos completas con control de secuencia y liquidación única', async () => {
    const { client, user } = await registerUser(s.base);
    for (let hand = 0; hand < 10; hand += 1) {
      let r = await client.post('/api/games/blackjack/start', { bet: 50, idempotencyKey: key() });
      expect(r.status).toBe(200);
      // La carta oculta del crupier no viaja al cliente.
      if (r.body.state.phase === 'player') expect(r.body.state.dealer[1]).toBeNull();
      let guard = 0;
      while (r.body.state.phase === 'player' && guard < 10) {
        const { roundId, seq } = r.body;
        const action = r.body.state.hands[r.body.state.active].value.total < 17 ? 'hit' : 'stand';
        r = await client.post('/api/games/blackjack/action', { roundId, action, seq });
        expect(r.status).toBe(200);
        // Repetir la misma acción con el mismo seq se rechaza.
        const dup = await client.post('/api/games/blackjack/action', { roundId, action, seq });
        expect(dup.status).toBe(409);
        guard += 1;
      }
      expect(r.body.state.phase).toBe('settled');
      expect(r.body.state.dealer.every((c: string | null) => c !== null)).toBe(true);
    }
    expect(verifyLedger(s.app.ctx.db, user.id).ok).toBe(true);
  });

  it('no permite dos manos simultáneas y recupera la mano abierta', async () => {
    const { client } = await registerUser(s.base);
    let r: Awaited<ReturnType<Client['post']>>;
    do {
      r = await client.post('/api/games/blackjack/start', { bet: 20, idempotencyKey: key() });
    } while (r.body.state.phase === 'settled');
    const second = await client.post('/api/games/blackjack/start', { bet: 20, idempotencyKey: key() });
    expect(second.status).toBe(409);
    expect(second.body.error.code).toBe('ROUND_IN_PROGRESS');
    const cur = await client.get('/api/games/blackjack/current');
    expect(cur.body.round.roundId).toBe(r.body.roundId);
    expect(cur.body.round.state.dealer[1]).toBeNull();
  });

  it('rechaza acciones sobre manos ajenas', async () => {
    const a = await registerUser(s.base);
    const b = await registerUser(s.base);
    let r: Awaited<ReturnType<Client['post']>>;
    do {
      r = await a.client.post('/api/games/blackjack/start', { bet: 20, idempotencyKey: key() });
    } while (r.body.state.phase === 'settled');
    const steal = await b.client.post('/api/games/blackjack/action', { roundId: r.body.roundId, action: 'stand', seq: 0 });
    expect(steal.status).toBe(404);
  });
});

describe('integridad del monedero', () => {
  it('una ronda no se puede liquidar dos veces', async () => {
    const { user } = await registerUser(s.base);
    const db = s.app.ctx.db;
    const round = openRound(db, user.id, 'roulette', 100, key());
    settleRound(db, round.id, 200, { test: true });
    expect(() => settleRound(db, round.id, 200, { test: true })).toThrow(/liquidada/);
    const bal = db.get<{ balance: number }>('SELECT balance FROM users WHERE id = ?', user.id)!.balance;
    expect(bal).toBe(10000 - 100 + 200);
    expect(verifyLedger(db, user.id).ok).toBe(true);
  });

  it('concurrencia: peticiones simultáneas nunca dejan saldo negativo ni descuadres', async () => {
    const admin = await createAdmin(s);
    const { client, user } = await registerUser(s.base);
    // Saldo exacto de 50: como mucho caben 5 apuestas de 10 si todas pierden.
    await admin.client.post(`/api/admin/users/${user.id}/adjust`, { amount: -9950, reason: 'Preparar prueba de concurrencia' });
    const results = await Promise.all(
      Array.from({ length: 25 }, () => client.post('/api/games/slots/spin', { betPerLine: 1, lines: 10, idempotencyKey: key() })),
    );
    const ok = results.filter((r) => r.status === 200).length;
    const rejected = results.filter((r) => r.status === 402).length;
    expect(ok + rejected).toBe(25);
    expect(ok).toBeGreaterThanOrEqual(5);
    const db = s.app.ctx.db;
    const bal = db.get<{ balance: number }>('SELECT balance FROM users WHERE id = ?', user.id)!.balance;
    expect(bal).toBeGreaterThanOrEqual(0);
    expect(verifyLedger(db, user.id).ok).toBe(true);
    const rounds = db.get<{ n: number }>(`SELECT COUNT(*) AS n FROM game_rounds WHERE user_id = ? AND game = 'slots'`, user.id)!.n;
    expect(rounds).toBe(ok);
  });

  it('la misma clave de idempotencia enviada en paralelo solo se procesa una vez', async () => {
    const { client, user } = await registerUser(s.base);
    const k = key();
    const results = await Promise.all(
      Array.from({ length: 8 }, () => client.post('/api/games/roulette/spin', { bets: [{ kind: 'odd', amount: 100 }], idempotencyKey: k })),
    );
    expect(results.every((r) => r.status === 200)).toBe(true);
    const n = s.app.ctx.db.get<{ n: number }>('SELECT COUNT(*) AS n FROM game_rounds WHERE user_id = ?', user.id)!.n;
    expect(n).toBe(1);
    expect(verifyLedger(s.app.ctx.db, user.id).ok).toBe(true);
  });
});

describe('promociones virtuales', () => {
  it('bono diario una sola vez y recarga solo con saldo bajo', async () => {
    const { client } = await registerUser(s.base);
    const a = await client.post('/api/me/promotions/daily-bonus');
    expect(a.status).toBe(200);
    expect(a.body.balance.balance).toBe(11000);
    expect((await client.post('/api/me/promotions/daily-bonus')).status).toBe(409);
    expect((await client.post('/api/me/promotions/demo-refill')).status).toBe(400);
  });
});

describe('historial, estadísticas y logros', () => {
  it('registra rondas, estadísticas y logros a partir de resultados reales', async () => {
    const { client } = await registerUser(s.base);
    for (let i = 0; i < 6; i += 1) {
      await client.post('/api/games/roulette/spin', { bets: [{ kind: 'red', amount: 10 }], idempotencyKey: key() });
    }
    const stats = await client.get('/api/me/stats');
    expect(stats.body.stats.rounds).toBe(6);
    expect(stats.body.stats.wins + stats.body.stats.losses + stats.body.stats.pushes).toBe(6);
    expect(stats.body.recent).toHaveLength(6);
    const hist = await client.get('/api/me/history?game=roulette');
    expect(hist.body.total).toBe(6);
    const ach = await client.get('/api/me/achievements');
    const firstWin = ach.body.achievements.find((a: { id: string }) => a.id === 'first_win');
    expect(firstWin.unlockedAt !== null).toBe(stats.body.stats.wins > 0);
  });

  it('la actividad pública está anonimizada y solo incluye jugadores reales', async () => {
    const r = await new Client(s.base).get('/api/activity');
    expect(r.status).toBe(200);
    for (const item of r.body.items) expect(item.player).toContain('•••');
  });
});

describe('administración', () => {
  it('desactivar un juego bloquea nuevas partidas', async () => {
    const admin = await createAdmin(s);
    const { client } = await registerUser(s.base);
    await admin.client.patch('/api/admin/settings', { gamesEnabled: { blackjack: true, roulette: true, slots: false, poker: true } });
    const r = await client.post('/api/games/slots/spin', { betPerLine: 1, lines: 10, idempotencyKey: key() });
    expect(r.status).toBe(503);
    await admin.client.patch('/api/admin/settings', { gamesEnabled: { blackjack: true, roulette: true, slots: true, poker: true } });
    expect((await client.post('/api/games/slots/spin', { betPerLine: 1, lines: 10, idempotencyKey: key() })).status).toBe(200);
  });

  it('diagnóstico y comprobación del libro mayor', async () => {
    const admin = await createAdmin(s);
    const d = await admin.client.get('/api/admin/diagnostics');
    expect(d.status).toBe(200);
    expect(d.body.database.integrity).toBe('ok');
    const l = await admin.client.post('/api/admin/diagnostics/ledger-check');
    expect(l.body.problems).toEqual([]);
  });
});
