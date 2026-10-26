import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { openWs, registerUser, startServer, type TestServer } from './helpers';

let s: TestServer;
beforeAll(async () => {
  s = await startServer();
});
afterAll(async () => {
  await s.stop();
});

async function member(channel: string) {
  const u = await registerUser(s.base);
  const ws = await openWs(s, u.client.cookie);
  ws.ws.send(JSON.stringify({ t: 'chat.join', channel }));
  const hist = await ws.next((m) => m.t === 'chat.history' && m.channel === channel);
  return { ...u, ws, hist };
}

describe('chat de mesa', () => {
  it('texto con palabrotas tapadas, mensajes rápidos y emojis para todos los del canal', async () => {
    const a = await member('crash');
    const b = await member('crash');
    expect(a.hist.quick.tecomo).toContain('Te como');
    a.ws.ws.send(JSON.stringify({ t: 'chat.send', channel: 'crash', text: 'vaya mierda\nde ronda' }));
    const m1 = await b.ws.next((m) => m.t === 'chat.message');
    expect(m1.message).toMatchObject({ from: a.username, text: 'vaya m***** de ronda', kind: 'text' });
    a.ws.ws.send(JSON.stringify({ t: 'chat.send', channel: 'crash', quick: 'bloqueo' }));
    expect((await b.ws.next((m) => m.t === 'chat.message')).message.text).toBe('¡Quita el bloqueo! 🚧');
    b.ws.ws.send(JSON.stringify({ t: 'chat.send', channel: 'crash', emoji: '🔥' }));
    expect((await a.ws.next((m) => m.t === 'chat.message' && m.message.kind === 'emoji')).message.text).toBe('🔥');
    b.ws.ws.send(JSON.stringify({ t: 'chat.send', channel: 'crash', emoji: '💩' }));
    expect((await b.ws.next((m) => m.t === 'error' && m.ref === 'chat.send')).code).toBe('BAD_MESSAGE');
    // Quien entra después recibe el historial.
    const c = await member('crash');
    expect(c.hist.messages.length).toBeGreaterThanOrEqual(3);
    for (const x of [a, b, c]) x.ws.ws.close();
  });

  it('límite de mensajes, canal obligatorio y salas privadas solo para miembros', async () => {
    const a = await member('poker:zafiro');
    for (let i = 0; i < 7; i += 1) a.ws.ws.send(JSON.stringify({ t: 'chat.send', channel: 'poker:zafiro', text: `hola ${i}` }));
    expect((await a.ws.next((m) => m.t === 'error' && m.ref === 'chat.send')).code).toBe('RATE_LIMITED');
    a.ws.ws.send(JSON.stringify({ t: 'chat.send', channel: 'bj:rubi', text: 'hola' }));
    expect((await a.ws.next((m) => m.t === 'error' && m.ref === 'chat.send' && m.code !== 'RATE_LIMITED')).code).toBe('CHAT_FORBIDDEN');
    a.ws.ws.send(JSON.stringify({ t: 'chat.join', channel: 'poker:noexiste' }));
    expect((await a.ws.next((m) => m.t === 'error' && m.ref === 'chat.join')).code).toBe('CHAT_FORBIDDEN');
    const host = await registerUser(s.base);
    const room = await host.client.post('/api/rooms', { name: 'Sala chat', game: 'poker', maxSeats: 4 });
    a.ws.ws.send(JSON.stringify({ t: 'chat.join', channel: `poker:${room.body.tableId}` }));
    expect((await a.ws.next((m) => m.t === 'error' && m.ref === 'chat.join')).code).toBe('CHAT_FORBIDDEN');
    a.ws.ws.close();
  });
});
