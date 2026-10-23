import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { bingoPrizes, hasBingo, hasLine, isValidBingoCard } from '@aurum/engine';
import { verifyLedger } from '../src/wallet/wallet';
import { openWs, registerUser, startServer, type TestServer } from './helpers';

let s: TestServer;
beforeAll(async () => {
  s = await startServer();
});
afterAll(async () => {
  await s.stop();
});

const balanceOf = (id: string): number => s.app.ctx.db.get<{ balance: number }>('SELECT balance FROM users WHERE id = ?', id)!.balance;

async function player(roomId: string) {
  const { client, user } = await registerUser(s.base);
  const ws = await openWs(s, client.cookie);
  ws.ws.send(JSON.stringify({ t: 'bingo.watch', roomId }));
  const first = await ws.next((m) => m.t === 'bingo.state' && m.roomId === roomId && m.state.phase === 'waiting', 20_000);
  return { client, user, ws, state: first.state };
}

describe('Bingo en el servidor', () => {
  it('partida completa: cartones válidos, bote con los de la casa, premios repartidos y libro mayor cuadrado', async () => {
    const a = await player('bingo-sol');
    const b = await player('bingo-sol');
    const beforeA = balanceOf(a.user.id);
    const beforeB = balanceOf(b.user.id);
    a.ws.ws.send(JSON.stringify({ t: 'bingo.buy', roomId: 'bingo-sol', gameNo: a.state.gameNo, count: 6 }));
    const mine = await a.ws.next((m) => m.t === 'bingo.state' && m.state.you?.cards.length === 6);
    expect(mine.state.phase).toBe('countdown');
    for (const c of mine.state.you.cards) expect(isValidBingoCard(c.grid)).toBe(true);
    expect(balanceOf(a.user.id)).toBe(beforeA - 60);
    b.ws.ws.send(JSON.stringify({ t: 'bingo.buy', roomId: 'bingo-sol', gameNo: a.state.gameNo, count: 4 }));
    // B ve que A juega, pero no sus cartones.
    const seen = await b.ws.next((m) => m.t === 'bingo.state' && m.state.you?.cards.length === 4);
    expect(seen.state.players.find((p: { you: boolean }) => !p.you).cards).toBe(6);
    expect(JSON.stringify(seen.state)).not.toContain(JSON.stringify(mine.state.you.cards[0].grid));
    const end = await a.ws.next((m) => m.t === 'bingo.state' && m.state.phase === 'finished', 30_000);
    const st = end.state;
    expect(st.houseCards).toBeGreaterThanOrEqual(14);
    expect(st.cardsTotal).toBe(10 + st.houseCards);
    expect(st.pot).toBe(st.cardsTotal * 10);
    expect(st.prizes).toEqual(bingoPrizes(st.pot));
    expect(st.lineWinners.length).toBeGreaterThan(0);
    expect(st.bingoWinners.length).toBeGreaterThan(0);
    const drawn = new Set<number>(st.drawn);
    // Los cartones propios premiados de verdad tienen línea / bingo con las bolas extraídas.
    for (const w of st.bingoWinners.filter((x: { you: boolean }) => x.you)) {
      expect(hasBingo(st.you.cards.find((c: { id: string }) => c.id === w.cardId).grid, drawn)).toBe(true);
    }
    for (const w of st.lineWinners.filter((x: { you: boolean }) => x.you)) {
      expect(hasLine(st.you.cards.find((c: { id: string }) => c.id === w.cardId).grid, drawn)).toBe(true);
    }
    // Ninguna bola extraída antes de terminar sobra: el bingo cantó en la última.
    const last = st.drawn.at(-1);
    expect(st.drawn.slice(0, -1)).not.toContain(last);
    const wonA = [...st.lineWinners, ...st.bingoWinners].filter((w: { you: boolean }) => w.you).reduce((acc: number, w: { amount: number }) => acc + w.amount, 0);
    expect(st.you.won).toBe(wonA);
    expect(balanceOf(a.user.id)).toBe(beforeA - 60 + wonA);
    const endB = await b.ws.next((m) => m.t === 'bingo.state' && m.state.phase === 'finished', 5000);
    expect(balanceOf(b.user.id)).toBe(beforeB - 40 + endB.state.you.won);
    expect(verifyLedger(s.app.ctx.db, a.user.id).ok).toBe(true);
    expect(verifyLedger(s.app.ctx.db, b.user.id).ok).toBe(true);
    const rounds = s.app.ctx.db.all<{ status: string; bet_total: number }>(`SELECT status, bet_total FROM game_rounds WHERE user_id = ? AND game = 'bingo'`, a.user.id);
    expect(rounds).toEqual([{ status: 'settled', bet_total: 60 }]);
    a.ws.ws.close();
    b.ws.ws.close();
  }, 60_000);

  it('límites: hasta 6 cartones, no se compra con la partida empezada ni para otra partida', async () => {
    const a = await player('bingo-luna');
    a.ws.ws.send(JSON.stringify({ t: 'bingo.buy', roomId: 'bingo-luna', gameNo: a.state.gameNo, count: 7 }));
    expect((await a.ws.next((m) => m.t === 'error' && m.ref === 'bingo.buy')).code).toBe('BAD_MESSAGE');
    a.ws.ws.send(JSON.stringify({ t: 'bingo.buy', roomId: 'bingo-luna', gameNo: a.state.gameNo + 5, count: 1 }));
    expect((await a.ws.next((m) => m.t === 'error' && m.ref === 'bingo.buy')).code).toBe('STALE_GAME');
    a.ws.ws.send(JSON.stringify({ t: 'bingo.buy', roomId: 'bingo-luna', gameNo: a.state.gameNo, count: 4 }));
    await a.ws.next((m) => m.t === 'bingo.state' && m.state.you?.cards.length === 4);
    a.ws.ws.send(JSON.stringify({ t: 'bingo.buy', roomId: 'bingo-luna', gameNo: a.state.gameNo, count: 3 }));
    expect((await a.ws.next((m) => m.t === 'error' && m.ref === 'bingo.buy')).code).toBe('TOO_MANY_CARDS');
    a.ws.ws.send(JSON.stringify({ t: 'bingo.buy', roomId: 'bingo-luna', gameNo: a.state.gameNo, count: 2 }));
    await a.ws.next((m) => m.t === 'bingo.state' && m.state.you?.cards.length === 6 && m.state.you.spent === 300);
    await a.ws.next((m) => m.t === 'bingo.state' && m.state.phase === 'playing', 10_000);
    a.ws.ws.send(JSON.stringify({ t: 'bingo.buy', roomId: 'bingo-luna', gameNo: a.state.gameNo, count: 1 }));
    const err = await a.ws.next((m) => m.t === 'error' && m.ref === 'bingo.buy');
    expect(['GAME_RUNNING', 'STALE_GAME']).toContain(err.code);
    a.ws.ws.close();
  }, 60_000);

  it('sala privada de bingo: solo miembros, sin cartones de la casa y con aforo', async () => {
    const host = await registerUser(s.base);
    const created = await host.client.post('/api/rooms', { name: 'Bingo en casa', game: 'bingo', maxSeats: 2, allowBots: false, bingo: { cardPrice: 5 } });
    expect(created.status).toBe(201);
    const tableId = created.body.tableId as string;
    const guest = await registerUser(s.base);
    const outsider = await registerUser(s.base);
    expect((await guest.client.post('/api/rooms/join', { code: created.body.code })).status).toBe(200);
    const wsOut = await openWs(s, outsider.client.cookie);
    wsOut.ws.send(JSON.stringify({ t: 'bingo.watch', roomId: tableId }));
    expect((await wsOut.next((m) => m.t === 'error' && m.ref === 'bingo.watch')).code).toBe('ROOM_FORBIDDEN');
    const wsH = await openWs(s, host.client.cookie);
    wsH.ws.send(JSON.stringify({ t: 'bingo.watch', roomId: tableId }));
    const st = (await wsH.next((m) => m.t === 'bingo.state' && m.roomId === tableId)).state;
    expect(st.house).toBe(false);
    const wsG = await openWs(s, guest.client.cookie);
    wsG.ws.send(JSON.stringify({ t: 'bingo.watch', roomId: tableId }));
    await wsG.next((m) => m.t === 'bingo.state' && m.roomId === tableId);
    wsH.ws.send(JSON.stringify({ t: 'bingo.buy', roomId: tableId, gameNo: st.gameNo, count: 2 }));
    wsG.ws.send(JSON.stringify({ t: 'bingo.buy', roomId: tableId, gameNo: st.gameNo, count: 1 }));
    const end = await wsH.next((m) => m.t === 'bingo.state' && m.roomId === tableId && m.state.phase === 'finished', 30_000);
    expect(end.state.houseCards).toBe(0);
    expect(end.state.pot).toBe(15);
    expect([...end.state.lineWinners, ...end.state.bingoWinners].every((w: { house: boolean }) => !w.house)).toBe(true);
    // La sala no aparece en el salón público.
    expect(s.app.ctx.bingo.lobby().some((r) => r.id === tableId)).toBe(false);
    for (const w of [wsOut, wsH, wsG]) w.ws.close();
  }, 60_000);

  it('salir antes de empezar o apagar el servidor devuelve los cartones', async () => {
    const a = await player('bingo-diamante');
    const before = balanceOf(a.user.id);
    a.ws.ws.send(JSON.stringify({ t: 'bingo.buy', roomId: 'bingo-diamante', gameNo: a.state.gameNo, count: 2 }));
    await a.ws.next((m) => m.t === 'bingo.state' && m.state.you?.cards.length === 2);
    expect(balanceOf(a.user.id)).toBe(before - 400);
    s.app.ctx.bingo.get('bingo-diamante').shutdown();
    expect(balanceOf(a.user.id)).toBe(before);
    expect(s.app.ctx.db.get<{ status: string }>(`SELECT status FROM game_rounds WHERE user_id = ? AND game = 'bingo'`, a.user.id)!.status).toBe('void');
    expect(verifyLedger(s.app.ctx.db, a.user.id).ok).toBe(true);
    a.ws.ws.close();
  });
});
