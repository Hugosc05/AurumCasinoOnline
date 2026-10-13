import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { verifyLedger } from '../src/wallet/wallet';
import { openWs, registerUser, startServer, type TestServer } from './helpers';

let s: TestServer;
beforeAll(async () => {
  s = await startServer();
});
afterAll(async () => {
  await s.stop();
});

describe('póker en tiempo real', () => {
  it('lobby con mesas reales y sin presencia inventada', async () => {
    const r = await fetch(`${s.base}/api/lobby`).then((x) => x.json());
    expect(r.tables.length).toBeGreaterThanOrEqual(3);
    expect(r.online).toBe(0);
  });

  it('un humano se sienta, juega contra bots, nunca ve cartas ajenas y cobra al levantarse', async () => {
    const { client, user } = await registerUser(s.base);
    const { ws, next, messages } = await openWs(s, client.cookie);
    ws.send(JSON.stringify({ t: 'poker.watch', tableId: 'esmeralda' }));
    await next((m) => m.t === 'poker.snapshot');
    ws.send(JSON.stringify({ t: 'poker.sit', tableId: 'esmeralda', buyIn: 1000 }));
    await next((m) => m.t === 'balance' && m.balance === 9000);

    let handsSeen = new Set<string>();
    const deadline = Date.now() + 15000;
    // Responde a cada turno propio con check/call; observa varias manos completas.
    while (handsSeen.size < 4 && Date.now() < deadline) {
      const m = await next((x) => x.t === 'poker.update' || x.t === 'poker.snapshot');
      const snap = m.snapshot;
      if (!snap?.hand) continue;
      handsSeen.add(snap.hand.handId);
      // Seguridad: antes del showdown, ninguna carta ajena es visible.
      const revealed = snap.hand.street === 'complete' || snap.hand.street === 'showdown';
      for (const p of snap.hand.players) {
        if (p.id !== user.id && !revealed) expect(p.hole.every((c: string | null) => c === null)).toBe(true);
        if (p.id === user.id) expect(p.hole.every((c: string | null) => typeof c === 'string')).toBe(true);
      }
      if (snap.you.legal) {
        const action = snap.you.legal.canCheck ? 'check' : 'call';
        ws.send(JSON.stringify({ t: 'poker.act', tableId: 'esmeralda', handId: snap.hand.handId, actionCount: snap.actionCount, action }));
      }
    }
    expect(handsSeen.size).toBeGreaterThanOrEqual(2);
    // Los bots están identificados como tales.
    const last = [...messages].reverse().find((m) => m.snapshot)?.snapshot;
    if (last) for (const seat of last.seats.filter(Boolean)) if (!seat.isYou) expect(seat.isBot).toBe(true);

    ws.send(JSON.stringify({ t: 'poker.leave', tableId: 'esmeralda' }));
    await next((m) => m.t === 'poker.left', 10000);
    ws.close();
    const db = s.app.ctx.db;
    expect(verifyLedger(db, user.id).ok).toBe(true);
    const seated = db.get<{ n: number }>('SELECT COUNT(*) AS n FROM poker_seats WHERE user_id = ?', user.id)!.n;
    expect(seated).toBe(0);
    const tx = db.all<{ reason: string }>('SELECT reason FROM wallet_transactions WHERE user_id = ? ORDER BY id', user.id).map((t) => t.reason);
    expect(tx).toContain('poker_buyin');
    expect(tx).toContain('poker_cashout');
  });

  it('rechaza acciones fuera de turno y entradas fuera de límites', async () => {
    const { client } = await registerUser(s.base);
    const { ws, next } = await openWs(s, client.cookie);
    ws.send(JSON.stringify({ t: 'poker.sit', tableId: 'zafiro', buyIn: 50 }));
    const e1 = await next((m) => m.t === 'error');
    expect(e1.code).toBe('INVALID_BUYIN');
    ws.send(JSON.stringify({ t: 'poker.act', tableId: 'zafiro', handId: '00000000-0000-4000-8000-000000000000', actionCount: 0, action: 'call' }));
    const e2 = await next((m) => m.t === 'error');
    expect(e2.code).toBe('NOT_SEATED');
    ws.close();
  });

  it('un WebSocket sin sesión puede mirar pero no sentarse', async () => {
    const { ws, next } = await openWs(s, '');
    ws.send(JSON.stringify({ t: 'poker.sit', tableId: 'esmeralda', buyIn: 500 }));
    const e = await next((m) => m.t === 'error');
    expect(e.code).toBe('UNAUTHORIZED');
    ws.close();
  });

  it('al reiniciar el servidor las fichas en mesa se reembolsan', async () => {
    const local = await startServer();
    const { client, user } = await registerUser(local.base);
    const { ws, next } = await openWs(local, client.cookie);
    ws.send(JSON.stringify({ t: 'poker.sit', tableId: 'obsidiana', buyIn: 4000 }));
    await next((m) => m.t === 'balance');
    // Simula una caída: se marca el asiento como persistido y se cierra sin apagado ordenado de mesas.
    const file = local.dbFile;
    const stack = local.app.ctx.db.get<{ stack: number }>('SELECT stack FROM poker_seats WHERE user_id = ?', user.id)!.stack;
    expect(stack).toBeGreaterThan(0);
    ws.close();
    // Cierre "brusco": solo servidor HTTP y BD, sin devolver fichas.
    local.app.ctx.realtime.close();
    for (const t of local.app.ctx.poker.tables.values()) (t as unknown as { stopped: boolean }).stopped = true;
    await new Promise<void>((r) => local.app.server.close(() => r()));
    local.app.ctx.db.close();

    const again = await startServer(file);
    try {
      const n = again.app.ctx.db.get<{ n: number }>('SELECT COUNT(*) AS n FROM poker_seats')!.n;
      expect(n).toBe(0);
      const refund = again.app.ctx.db.get<{ amount: number }>(`SELECT amount FROM wallet_transactions WHERE user_id = ? AND reason = 'refund'`, user.id);
      expect(refund?.amount).toBe(stack);
      expect(verifyLedger(again.app.ctx.db, user.id).ok).toBe(true);
    } finally {
      await again.stop();
    }
  });
});
