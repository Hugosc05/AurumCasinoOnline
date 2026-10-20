import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { HOST_GRACE_MS, IDLE_CLOSE_MS, normalizeCode } from '../src/rooms/rooms';
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

async function friends(a: Awaited<ReturnType<typeof registerUser>>, b: Awaited<ReturnType<typeof registerUser>>) {
  await a.client.post('/api/social/friends/requests', { username: b.username });
  const req = (await b.client.get('/api/social/friends')).body.incoming[0].requestId;
  await b.client.post(`/api/social/friends/requests/${req}/accept`);
}

describe('códigos de invitación', () => {
  it('normalización tolerante y formato estricto', () => {
    expect(normalizeCode('abcd-efgh')).toBe('ABCDEFGH');
    expect(normalizeCode(' 0o1i l2 34 ')).toBe('00111234');
    expect(normalizeCode('ABC')).toBeNull();
    expect(normalizeCode('ABCDEFGU')).toBeNull(); // la U no existe en el alfabeto
  });
});

describe('salas privadas', () => {
  it('crear, entrar con código y acceso solo para miembros; no aparece en el salón público', async () => {
    const host = await registerUser(s.base);
    const guest = await registerUser(s.base);
    const outsider = await registerUser(s.base);
    const room = (await host.client.post('/api/rooms', { name: 'Partida del viernes', game: 'poker', maxSeats: 4 })).body;
    expect(room.code).toMatch(/^[0-9A-HJKMNP-TV-Z]{4}-[0-9A-HJKMNP-TV-Z]{4}$/);
    expect(room.isHost).toBe(true);
    const lobby = (await fetch(`${s.base}/api/lobby`).then((x) => x.json())) as { tables: { id: string }[] };
    expect(lobby.tables.some((t) => t.id === room.tableId)).toBe(false);

    // Sin ser miembro: ni ver la sala ni mirar la mesa.
    expect((await outsider.client.get(`/api/rooms/${room.id}`)).status).toBe(403);
    const wo = await openWs(s, outsider.client.cookie);
    wo.ws.send(JSON.stringify({ t: 'poker.watch', tableId: room.tableId }));
    expect((await wo.next((m) => m.t === 'error')).code).toBe('ROOM_FORBIDDEN');
    wo.ws.send(JSON.stringify({ t: 'poker.sit', tableId: room.tableId, buyIn: 1000 }));
    expect((await wo.next((m) => m.t === 'error')).code).toBe('ROOM_FORBIDDEN');
    wo.ws.close();

    // El código entra en minúsculas y con o sin guion.
    const joined = await guest.client.post('/api/rooms/join', { code: room.code.toLowerCase() });
    expect(joined.status).toBe(200);
    expect(joined.body.members.map((m: { username: string }) => m.username)).toEqual([host.username, guest.username]);
    expect(JSON.stringify(joined.body)).not.toMatch(/email|password|balance/);
    expect((await guest.client.post('/api/rooms/join', { code: 'ZZZZ-ZZZZ' })).status).toBe(404);
    // El código no da privilegios: el invitado no puede cerrar ni renovar.
    expect((await guest.client.post(`/api/rooms/${room.id}/close`)).status).toBe(403);
    expect((await guest.client.post(`/api/rooms/${room.id}/code`)).status).toBe(403);
    expect((await guest.client.get('/api/admin/users')).status).toBe(403);
  });

  it('sala llena, código caducado y renovado, y cierre controlado con devolución de fichas', async () => {
    const host = await registerUser(s.base);
    const b = await registerUser(s.base);
    const c = await registerUser(s.base);
    const room = (await host.client.post('/api/rooms', { name: 'Dos plazas', game: 'poker', maxSeats: 2 })).body;
    await b.client.post('/api/rooms/join', { code: room.code });
    expect((await c.client.post('/api/rooms/join', { code: room.code })).body.error.code).toBe('ROOM_FULL');
    await b.client.post(`/api/rooms/${room.id}/leave`);

    s.app.ctx.db.run(`UPDATE rooms SET code_expires_at = '2000-01-01T00:00:00.000Z' WHERE id = ?`, room.id);
    expect((await c.client.post('/api/rooms/join', { code: room.code })).body.error.code).toBe('CODE_EXPIRED');
    const renewed = (await host.client.post(`/api/rooms/${room.id}/code`)).body;
    expect(renewed.code).not.toBe(room.code);
    expect((await c.client.post('/api/rooms/join', { code: room.code })).status).toBe(404);
    expect((await c.client.post('/api/rooms/join', { code: renewed.code })).status).toBe(200);

    // C se sienta con su saldo y el anfitrión cierra: las fichas vuelven al monedero.
    const wc = await openWs(s, c.client.cookie);
    wc.ws.send(JSON.stringify({ t: 'poker.sit', tableId: room.tableId, buyIn: 1000 }));
    await wc.next((m) => m.t === 'balance' && m.balance === 9000);
    expect((await host.client.post(`/api/rooms/${room.id}/close`)).status).toBe(200);
    await wc.next((m) => m.t === 'room.closed');
    expect(balanceOf(c.user.id)).toBe(10000);
    expect(verifyLedger(s.app.ctx.db, c.user.id).ok).toBe(true);
    expect((await c.client.post('/api/rooms/join', { code: renewed.code })).body.error.code).toBe('ROOM_CLOSED');
    expect((await c.client.get(`/api/rooms/${room.id}`)).body.status).toBe('closed');
    wc.ws.close();
  });

  it('póker privado entre dos personas: cartas privadas solo para su dueño y sin bots', async () => {
    const a = await registerUser(s.base);
    const b = await registerUser(s.base);
    const room = (await a.client.post('/api/rooms', { name: 'Mano a mano', game: 'poker', maxSeats: 2, chipMode: 'room', poker: { smallBlind: 5, bigBlind: 10, startingChips: 1000 } })).body;
    await b.client.post('/api/rooms/join', { code: room.code });
    const wa = await openWs(s, a.client.cookie);
    const wb = await openWs(s, b.client.cookie);
    wa.ws.send(JSON.stringify({ t: 'poker.sit', tableId: room.tableId, buyIn: 1 }));
    wb.ws.send(JSON.stringify({ t: 'poker.sit', tableId: room.tableId, buyIn: 1 }));
    // Con fichas de sala no se toca el monedero.
    const checkHands = async (w: typeof wa, me: string) => {
      const deadline = Date.now() + 10000;
      let checked = 0;
      while (checked < 3 && Date.now() < deadline) {
        const m = await w.next((x) => (x.t === 'poker.update' || x.t === 'poker.snapshot') && x.tableId === room.tableId);
        const hand = m.snapshot.hand;
        expect(m.snapshot.seats.filter(Boolean).every((x: { isBot: boolean }) => !x.isBot)).toBe(true);
        if (!hand) continue;
        const revealed = hand.street === 'complete' || hand.street === 'showdown';
        for (const p of hand.players) {
          if (p.id === me) expect(p.hole.every((c: string | null) => typeof c === 'string')).toBe(true);
          else if (!revealed) expect(p.hole.every((c: string | null) => c === null)).toBe(true);
        }
        checked += 1;
        if (m.snapshot.you.legal) {
          const action = m.snapshot.you.legal.canCheck ? 'check' : 'call';
          w.ws.send(JSON.stringify({ t: 'poker.act', tableId: room.tableId, handId: hand.handId, actionCount: m.snapshot.actionCount, action }));
        }
      }
      return checked;
    };
    const [ca, cb] = await Promise.all([checkHands(wa, a.user.id), checkHands(wb, b.user.id)]);
    expect(ca + cb).toBeGreaterThan(2);
    expect(balanceOf(a.user.id)).toBe(10000);
    expect(balanceOf(b.user.id)).toBe(10000);
    wa.ws.close();
    wb.ws.close();
  });

  it('blackjack privado: asientos independientes contra el crupier común', async () => {
    const a = await registerUser(s.base);
    const b = await registerUser(s.base);
    const room = (await a.client.post('/api/rooms', { name: 'Blackjack en casa', game: 'blackjack', maxSeats: 3, blackjack: { minBet: 10, maxBet: 200 } })).body;
    await b.client.post('/api/rooms/join', { code: room.code });
    const wa = await openWs(s, a.client.cookie);
    const wb = await openWs(s, b.client.cookie);
    wa.ws.send(JSON.stringify({ t: 'bj.sit', tableId: room.tableId, seat: 0 }));
    await wa.next((m) => m.t === 'bj.snapshot');
    wb.ws.send(JSON.stringify({ t: 'bj.sit', tableId: room.tableId, seat: 2 }));
    const play = async (w: typeof wa) => {
      const sentBet = new Set<number>();
      const sent = new Set<string>();
      const deadline = Date.now() + 15000;
      while (Date.now() < deadline) {
        const m = await w.next((x) => (x.t === 'bj.update' || x.t === 'bj.snapshot') && x.tableId === room.tableId, 8000);
        const snap = m.snapshot;
        expect(snap.table.mode).toBe('private');
        if (snap.phase === 'settled' && snap.round?.seats.length === 2) return snap;
        if (snap.you.canBet && !sentBet.has(snap.roundNo)) {
          sentBet.add(snap.roundNo);
          w.ws.send(JSON.stringify({ t: 'bj.bet', tableId: room.tableId, roundNo: snap.roundNo, amount: 20 }));
        }
        const k = `${snap.roundNo}:${snap.actionCount}`;
        if (snap.you.legal.length > 0 && !sent.has(k)) {
          sent.add(k);
          w.ws.send(JSON.stringify({ t: 'bj.act', tableId: room.tableId, roundNo: snap.roundNo, actionCount: snap.actionCount, action: 'stand' }));
        }
      }
      return null;
    };
    const [sa] = await Promise.all([play(wa), play(wb)]);
    expect(sa).not.toBeNull();
    expect(sa.seats.filter(Boolean).every((x: { isBot: boolean }) => !x.isBot)).toBe(true);
    expect(verifyLedger(s.app.ctx.db, a.user.id).ok).toBe(true);
    wa.ws.close();
    wb.ws.close();
  });

  it('sala solo para amigos e invitaciones: solo a amigos, y la invitación permite entrar sin código', async () => {
    const host = await registerUser(s.base);
    const friend = await registerUser(s.base);
    const stranger = await registerUser(s.base);
    await friends(host, friend);
    const room = (await host.client.post('/api/rooms', { name: 'Solo amigos', game: 'blackjack', maxSeats: 4, privacy: 'friends' })).body;
    expect((await stranger.client.post('/api/rooms/join', { code: room.code })).status).toBe(403);
    expect((await host.client.post(`/api/rooms/${room.id}/invite`, { username: stranger.username })).status).toBe(403);
    expect((await stranger.client.post(`/api/rooms/${room.id}/accept-invite`)).status).toBe(403);
    expect((await host.client.post(`/api/rooms/${room.id}/invite`, { username: friend.username })).status).toBe(200);
    const notes = (await friend.client.get('/api/social/notifications')).body.items;
    expect(notes[0]).toMatchObject({ kind: 'room_invite', payload: { roomId: room.id, roomName: 'Solo amigos' } });
    expect((await friend.client.post(`/api/rooms/${room.id}/accept-invite`)).status).toBe(200);
    expect((await friend.client.get('/api/rooms')).body.items.map((r: { id: string }) => r.id)).toContain(room.id);
  });

  it('si el anfitrión desaparece la sala pasa a otro miembro; sin nadie, se cierra sola', async () => {
    const host = await registerUser(s.base);
    const b = await registerUser(s.base);
    const room = (await host.client.post('/api/rooms', { name: 'Anfitrión ausente', game: 'blackjack', maxSeats: 3 })).body;
    await b.client.post('/api/rooms/join', { code: room.code });
    const wb = await openWs(s, b.client.cookie);
    const rooms = s.app.ctx.rooms;
    rooms.sweep(Date.now() + HOST_GRACE_MS + 5000);
    const after = (await b.client.get(`/api/rooms/${room.id}`)).body;
    expect(after.host.username).toBe(b.username);
    expect(after.isHost).toBe(true);
    wb.ws.close();
    await new Promise((r) => setTimeout(r, 100));
    rooms.sweep(Date.now() + HOST_GRACE_MS + IDLE_CLOSE_MS + 60_000);
    expect((await b.client.get(`/api/rooms/${room.id}`)).body.status).toBe('closed');
  });

  it('el anfitrión que se va cede la sala; el último en irse la cierra', async () => {
    const host = await registerUser(s.base);
    const b = await registerUser(s.base);
    const room = (await host.client.post('/api/rooms', { name: 'Relevo', game: 'poker', maxSeats: 3 })).body;
    await b.client.post('/api/rooms/join', { code: room.code });
    await host.client.post(`/api/rooms/${room.id}/leave`);
    expect((await b.client.get(`/api/rooms/${room.id}`)).body.host.username).toBe(b.username);
    await b.client.post(`/api/rooms/${room.id}/leave`);
    expect(s.app.ctx.db.get<{ status: string }>('SELECT status FROM rooms WHERE id = ?', room.id)!.status).toBe('closed');
    expect(s.app.ctx.poker.tables.has(room.tableId)).toBe(false);
  });

  it('los cambios del anfitrión respetan el motor y los intentos de código están limitados', async () => {
    const host = await registerUser(s.base);
    const room = (await host.client.post('/api/rooms', { name: 'Ajustes', game: 'poker', maxSeats: 4, chipMode: 'room' })).body;
    expect((await host.client.patch(`/api/rooms/${room.id}`, { poker: { startingChips: 99999 } })).body.error.code).toBe('LOCKED');
    expect((await host.client.patch(`/api/rooms/${room.id}`, { poker: { smallBlind: 50, bigBlind: 10 } })).status).toBe(400);
    expect((await host.client.patch(`/api/rooms/${room.id}`, { maxSeats: 6 })).status).toBe(400); // no se puede cambiar
    expect((await host.client.patch(`/api/rooms/${room.id}`, { name: 'Ajustes nuevos', poker: { smallBlind: 10, bigBlind: 20 } })).body.settings.bigBlind).toBe(20);
    expect((await host.client.post('/api/rooms', { name: 'Fichas', game: 'blackjack', maxSeats: 3, chipMode: 'room' })).status).toBe(400);

    const guesser = await registerUser(s.base);
    const codes = await Promise.all(Array.from({ length: 12 }, (_, i) => guesser.client.post('/api/rooms/join', { code: `AAAA-AAA${i % 10}` })));
    expect(codes.some((r) => r.status === 429)).toBe(true);
  });
});
