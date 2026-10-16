import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Database, migrate, nowIso } from '../src/db/database';
import { seed } from '../src/db/seed';
import { openRound } from '../src/games/rounds';
import { verifyLedger } from '../src/wallet/wallet';
import { BOT_CATALOG } from '../src/bots/catalog';
import { Client, createAdmin, openWs, registerUser, startServer, type TestServer } from './helpers';

let s: TestServer;
beforeAll(async () => {
  s = await startServer();
});
afterAll(async () => {
  await s.stop();
});

type Ws = Awaited<ReturnType<typeof openWs>>;

/** Juega rondas completas: apuesta cuando puede y se planta (o pide con menos de 12). */
async function playRounds(w: Ws, tableId: string, rounds: number, bet: number, onSnap?: (snap: any) => void) {
  const settled = new Set<number>();
  const sentBet = new Set<number>();
  const sentAct = new Set<string>();
  const deadline = Date.now() + 20000;
  while (settled.size < rounds && Date.now() < deadline) {
    const m = await w.next((x) => (x.t === 'bj.update' || x.t === 'bj.snapshot') && x.tableId === tableId, 8000);
    const snap = m.snapshot;
    onSnap?.(snap);
    if (snap.phase === 'settled' && snap.you.seat !== null && snap.round?.seats.some((x: any) => x.seat === snap.you.seat)) settled.add(snap.roundNo);
    if (snap.you.canBet && !sentBet.has(snap.roundNo)) {
      sentBet.add(snap.roundNo);
      w.ws.send(JSON.stringify({ t: 'bj.bet', tableId, roundNo: snap.roundNo, amount: bet }));
    }
    if (snap.you.legal.length > 0) {
      const k = `${snap.roundNo}:${snap.actionCount}`;
      if (sentAct.has(k)) continue;
      sentAct.add(k);
      const mine = snap.round.seats.find((x: any) => x.seat === snap.you.seat);
      const hand = mine.hands[snap.round.turn.hand];
      const action = snap.you.legal.includes('double') && (hand.value.total === 10 || hand.value.total === 11) ? 'double'
        : hand.value.total < 12 ? 'hit' : 'stand';
      w.ws.send(JSON.stringify({ t: 'bj.act', tableId, roundNo: snap.roundNo, actionCount: snap.actionCount, action }));
    }
  }
  return settled.size;
}

describe('blackjack multijugador', () => {
  it('el lobby distingue mesas con bots y mesas solo para personas', async () => {
    const r = (await fetch(`${s.base}/api/lobby`).then((x) => x.json())) as { blackjackTables: any[] };
    expect(r.blackjackTables.map((t) => t.id)).toEqual(expect.arrayContaining(['rubi', 'onix', 'nacar']));
    expect(r.blackjackTables.find((t) => t.id === 'rubi').mode).toBe('bots');
    expect(r.blackjackTables.find((t) => t.id === 'nacar').mode).toBe('public');
    // Sin nadie mirando, no hay bots "jugando" para aparentar actividad.
    expect(r.blackjackTables.every((t) => t.bots === 0 && t.humans === 0)).toBe(true);
  });

  it('una persona juega contra el crupier junto a bots; la carta tapada nunca viaja antes de tiempo', async () => {
    const { client, user } = await registerUser(s.base);
    const w = await openWs(s, client.cookie);
    w.ws.send(JSON.stringify({ t: 'bj.sit', tableId: 'rubi' }));
    let sawBots = false;
    let hiddenChecked = 0;
    const n = await playRounds(w, 'rubi', 3, 20, (snap) => {
      const others = snap.seats.filter((x: any) => x && !x.isYou);
      if (others.length > 0) {
        sawBots = true;
        for (const o of others) {
          expect(o.isBot).toBe(true);
          expect(o.bot.avatar).toBeTruthy();
          expect(o.name.startsWith('Bot ')).toBe(false);
        }
      }
      // Sin identificadores internos de usuario en la vista.
      expect(JSON.stringify(snap)).not.toContain(user.id);
      if (snap.phase === 'playing' && snap.round?.turn) {
        expect(snap.round.dealer[1]).toBeNull();
        hiddenChecked += 1;
      }
    });
    expect(n).toBeGreaterThanOrEqual(3);
    expect(sawBots).toBe(true);
    expect(hiddenChecked).toBeGreaterThan(0);
    w.ws.send(JSON.stringify({ t: 'bj.leave', tableId: 'rubi' }));
    await w.next((m) => m.t === 'bj.left', 10000);
    w.ws.close();
    const db = s.app.ctx.db;
    expect(verifyLedger(db, user.id).ok).toBe(true);
    const rounds = db.all<{ status: string; bet_total: number; payout: number }>(
      `SELECT status, bet_total, payout FROM game_rounds WHERE user_id = ? AND idempotency_key LIKE 'bjt:%'`, user.id,
    );
    expect(rounds.length).toBeGreaterThanOrEqual(3);
    expect(rounds.every((r) => r.status === 'settled' || r.status === 'void')).toBe(true);
    // Las estadísticas de los bots salen de partidas reales.
    const botRounds = db.get<{ n: number }>('SELECT SUM(bj_rounds) AS n FROM bots')!.n;
    expect(botRounds).toBeGreaterThan(0);
  });

  it('valida las apuestas en el servidor y una apuesta sin repartir se devuelve al levantarse', async () => {
    const { client, user } = await registerUser(s.base);
    const w = await openWs(s, client.cookie);
    w.ws.send(JSON.stringify({ t: 'bj.sit', tableId: 'nacar' }));
    const snap = (await w.next((m) => m.t?.startsWith('bj.') && m.snapshot?.you?.canBet, 8000)).snapshot;
    w.ws.send(JSON.stringify({ t: 'bj.bet', tableId: 'nacar', roundNo: snap.roundNo, amount: 5 }));
    expect((await w.next((m) => m.t === 'error')).code).toBe('INVALID_BET');
    w.ws.send(JSON.stringify({ t: 'bj.bet', tableId: 'nacar', roundNo: snap.roundNo + 7, amount: 50 }));
    expect((await w.next((m) => m.t === 'error')).code).toBe('BETTING_CLOSED');
    // Mesa pública: sin bots.
    expect(snap.seats.filter(Boolean)).toHaveLength(1);
    // Se levanta antes del reparto (ronda de otra persona aún sin apostar → la suya se anula y se reembolsa).
    const b = await registerUser(s.base);
    const wb = await openWs(s, b.client.cookie);
    wb.ws.send(JSON.stringify({ t: 'bj.sit', tableId: 'nacar' }));
    await w.next((m) => m.t === 'bj.update' && m.snapshot.seats.filter(Boolean).length === 2);
    const cur = (await w.next((m) => m.t === 'bj.update' && m.snapshot.you.canBet, 8000)).snapshot;
    w.ws.send(JSON.stringify({ t: 'bj.bet', tableId: 'nacar', roundNo: cur.roundNo, amount: 100 }));
    await w.next((m) => m.t === 'balance' && m.balance === 9900);
    w.ws.send(JSON.stringify({ t: 'bj.bet', tableId: 'nacar', roundNo: cur.roundNo, amount: 100 }));
    expect((await w.next((m) => m.t === 'error')).code).toBe('ALREADY_BET');
    w.ws.send(JSON.stringify({ t: 'bj.leave', tableId: 'nacar' }));
    await w.next((m) => m.t === 'balance' && m.balance === 10000);
    expect(verifyLedger(s.app.ctx.db, user.id).ok).toBe(true);
    w.ws.close();
    wb.ws.close();
  });

  it('dos personas en la misma mesa: turnos independientes y cada una se liquida por separado', async () => {
    const a = await registerUser(s.base);
    const b = await registerUser(s.base);
    const wa = await openWs(s, a.client.cookie);
    const wb = await openWs(s, b.client.cookie);
    wa.ws.send(JSON.stringify({ t: 'bj.sit', tableId: 'onix', seat: 0 }));
    await wa.next((m) => m.t === 'bj.snapshot');
    wb.ws.send(JSON.stringify({ t: 'bj.sit', tableId: 'onix', seat: 2 }));
    const [na, nb] = await Promise.all([playRounds(wa, 'onix', 3, 50), playRounds(wb, 'onix', 3, 50)]);
    expect(na).toBeGreaterThanOrEqual(3);
    expect(nb).toBeGreaterThanOrEqual(3);
    const db = s.app.ctx.db;
    for (const u of [a.user, b.user]) {
      expect(verifyLedger(db, u.id).ok).toBe(true);
      const rows = db.all<{ bet_total: number; payout: number; result_json: string }>(
        `SELECT bet_total, payout, result_json FROM game_rounds WHERE user_id = ? AND status = 'settled'`, u.id,
      );
      for (const r of rows) {
        const res = JSON.parse(r.result_json);
        const bet = res.hands.reduce((x: number, h: any) => x + h.bet, 0);
        const pay = res.hands.reduce((x: number, h: any) => x + h.payout, 0);
        expect(bet).toBe(r.bet_total); // los dobles y divisiones se cargaron al monedero
        expect(pay).toBe(r.payout);
      }
    }
    wa.ws.close();
    wb.ws.close();
  });

  it('sin sesión no se puede sentar ni apostar', async () => {
    const w = await openWs(s, '');
    w.ws.send(JSON.stringify({ t: 'bj.sit', tableId: 'rubi' }));
    expect((await w.next((m) => m.t === 'error')).code).toBe('UNAUTHORIZED');
    w.ws.send(JSON.stringify({ t: 'bj.bet', tableId: 'rubi', roundNo: 1, amount: 10 }));
    expect((await w.next((m) => m.t === 'error')).code).toBe('UNAUTHORIZED');
    w.ws.close();
  });

  it('los nombres de bot no se pueden registrar como usuario', async () => {
    const c = new Client(s.base);
    const r = await c.post('/api/auth/register', { username: 'lunacards', email: 'x1@example.com', password: 'Password123' });
    expect(r.status).toBe(409);
    expect(r.body.error.details.fields.username).toMatch(/bot/);
  });

  it('perfiles públicos de bots: identificados como automatizados y con estadísticas reales', async () => {
    const r = (await fetch(`${s.base}/api/bots`).then((x) => x.json())) as any;
    expect(r.automated).toBe(true);
    expect(r.notice).toMatch(/automatizados/);
    expect(r.bots.length).toBe(BOT_CATALOG.length);
    for (const b of r.bots) {
      expect(b).not.toHaveProperty('id');
      expect(b.avatar.bg).toHaveLength(2);
      expect(b.stats.pokerHands).toBeGreaterThanOrEqual(0);
    }
  });
});

describe('administración y bots compartidos', () => {
  it('solo un administrador cambia las mesas; los límites nuevos no afectan a la ronda abierta', async () => {
    const player = await registerUser(s.base);
    expect((await player.client.patch('/api/admin/blackjack-tables/onix', { minBet: 5 })).status).toBe(403);
    const admin = await createAdmin(s);
    expect((await admin.client.patch('/api/admin/blackjack-tables/onix', { maxBots: 5 })).status).toBe(400); // sin asiento libre para personas
    expect((await admin.client.patch('/api/admin/blackjack-tables/onix', { minBet: 100, maxBet: 50 })).status).toBe(400);

    const w = await openWs(s, player.client.cookie);
    w.ws.send(JSON.stringify({ t: 'bj.sit', tableId: 'nacar' }));
    const open = (await w.next((m) => m.t?.startsWith('bj.') && m.snapshot?.you?.canBet, 8000)).snapshot;
    expect(open.table.minBet).toBe(10);
    // El administrador sube la mínima mientras la ronda está abierta: esta ronda conserva sus límites.
    expect((await admin.client.patch('/api/admin/blackjack-tables/nacar', { minBet: 50 })).status).toBe(200);
    w.ws.send(JSON.stringify({ t: 'bj.bet', tableId: 'nacar', roundNo: open.roundNo, amount: 20 }));
    await w.next((m) => m.t === 'balance' && m.balance === 9980);
    // En la siguiente ronda ya rige la nueva mínima.
    const next = (await w.next((m) => m.t === 'bj.update' && m.snapshot.phase === 'betting' && m.snapshot.roundNo > open.roundNo, 10000)).snapshot;
    expect(next.table.minBet).toBe(50);
    w.ws.send(JSON.stringify({ t: 'bj.bet', tableId: 'nacar', roundNo: next.roundNo, amount: 20 }));
    expect((await w.next((m) => m.t === 'error')).code).toBe('INVALID_BET');
    await admin.client.patch('/api/admin/blackjack-tables/nacar', { minBet: 10 });
    w.ws.send(JSON.stringify({ t: 'bj.leave', tableId: 'nacar' }));
    w.ws.close();
  });

  it('un bot nunca está sentado en dos mesas a la vez', async () => {
    const watchers = await Promise.all(['esmeralda', 'zafiro', 'rubi', 'onix'].map(async (id) => {
      const w = await openWs(s, '');
      w.ws.send(JSON.stringify({ t: id === 'rubi' || id === 'onix' ? 'bj.watch' : 'poker.watch', tableId: id }));
      return w;
    }));
    await new Promise((r) => setTimeout(r, 400));
    const seated = s.app.ctx.db.all<{ id: string }>('SELECT id FROM bots').map((b) => s.app.ctx.bots.seatedAt(b.id)).filter(Boolean);
    const names = [
      ...[...s.app.ctx.poker.tables.values()].flatMap((t) => t.seats.filter((x) => x?.kind === 'bot').map((x) => x!.name)),
      ...[...s.app.ctx.blackjack.tables.values()].flatMap((t) => t.seats.filter((x) => x?.kind === 'bot').map((x) => x!.name)),
    ];
    expect(names.length).toBeGreaterThan(4);
    expect(new Set(names).size).toBe(names.length);
    expect(seated.length).toBe(names.length);
    for (const w of watchers) w.ws.close();
  });
});

describe('arranque y migración', () => {
  it('reembolsa las apuestas de blackjack que quedaron abiertas tras un reinicio', async () => {
    const first = await startServer();
    const { user } = await registerUser(first.base);
    openRound(first.app.ctx.db, user.id, 'blackjack', 300, `bjt:rubi:${randomUUID()}:${user.id}`);
    await first.stop(true);
    const second = await startServer(first.dbFile);
    const db = second.app.ctx.db;
    expect(db.get<{ balance: number }>('SELECT balance FROM users WHERE id = ?', user.id)!.balance).toBe(10000);
    expect(db.get<{ status: string }>(`SELECT status FROM game_rounds WHERE user_id = ?`, user.id)!.status).toBe('void');
    expect(verifyLedger(db, user.id).ok).toBe(true);
    await second.stop();
  });

  it('renombra los bots antiguos conservando su id e historial', () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'aurum-bots-'));
    const db = new Database(path.join(dir, 't.db'));
    migrate(db);
    const id = randomUUID();
    db.run(`INSERT INTO bots (id, name, profile, difficulty, hands_played, created_at) VALUES (?, 'Bot Atlas', 'analytical', 'hard', 321, ?)`, id, nowIso());
    seed(db);
    seed(db); // idempotente
    const row = db.get<{ name: string; hands_played: number; avatar_json: string }>('SELECT * FROM bots WHERE id = ?', id)!;
    expect(row.name).toBe('AlexRacing');
    expect(row.hands_played).toBe(321);
    expect(JSON.parse(row.avatar_json).bg).toHaveLength(2);
    expect(db.get<{ n: number }>('SELECT COUNT(*) AS n FROM bots')!.n).toBe(BOT_CATALOG.length);
    expect(db.get<{ n: number }>(`SELECT COUNT(*) AS n FROM bots WHERE name LIKE 'Bot %'`)!.n).toBe(0);
    db.close();
    rmSync(dir, { recursive: true, force: true });
  });
});
