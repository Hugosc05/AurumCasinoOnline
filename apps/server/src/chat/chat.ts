import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { AppError } from '../lib/errors';
import { RateLimiter } from '../lib/rateLimit';
import { maskProfanity } from '../moderation/words';
import type { RealtimeHub, RtClient } from '../realtime/hub';

/**
 * Chat de mesa: un canal por mesa o sala (`poker:<id>`, `bj:<id>`,
 * `bingo:<id>`, `crash`). Los mensajes viven en memoria (los últimos 40 por
 * canal); no se guardan en la base de datos.
 *
 * - Solo escriben usuarios con sesión; mirar se puede sin ella.
 * - Las salas privadas solo admiten a sus miembros (lo decide `canAccess`).
 * - Límite de mensajes, longitud máxima y palabrotas tapadas.
 * - Mensajes rápidos y emojis con identificador: el texto lo pone el servidor.
 */

export const QUICK_MESSAGES: Record<string, string> = {
  hola: '¡Hola a todos! 👋',
  suerte: '¡Suerte! 🍀',
  bien: '¡Bien jugado! 👏',
  gracias: '¡Gracias! 🙏',
  uff: 'Uff… por los pelos 😅',
  vamos: '¡Vamos! 🔥',
  tecomo: '¡Te como y cuento 20! 😈',
  bloqueo: '¡Quita el bloqueo! 🚧',
  pienso: 'Déjame pensar… 🤔',
  farol: 'Eso huele a farol 👀',
  allin: '¡ALL-IN! 💥',
  linea: '¡Me falta una para línea! 🙏',
  cobra: '¡Cobra ya, que se estrella! 🚀',
  gg: 'GG 🤝',
  risa: 'JAJAJA 😂',
  llorar: 'Qué mala suerte 😭',
};
export const QUICK_EMOJIS = ['👍', '😂', '😎', '🔥', '💸', '🍀', '😡', '😱', '🤡', '👑', '🎉', '🙈'];

export interface ChatMessage {
  id: string;
  channel: string;
  from: string;
  text: string;
  kind: 'text' | 'quick' | 'emoji';
  at: number;
}

const channelSchema = z.string().regex(/^(crash|(poker|bj|bingo):[A-Za-z0-9_-]{1,64})$/);
const joinSchema = z.object({ channel: channelSchema });
const sendSchema = z.union([
  z.object({ channel: channelSchema, text: z.string().trim().min(1).max(160) }),
  z.object({ channel: channelSchema, quick: z.string().max(20) }),
  z.object({ channel: channelSchema, emoji: z.string().max(8) }),
]);

const HISTORY = 40;

export class ChatService {
  private history = new Map<string, ChatMessage[]>();
  private members = new Map<string, Set<RtClient>>();
  private limiter = new RateLimiter(5, 8_000);

  constructor(
    private readonly hub: RealtimeHub,
    private readonly canAccess: (channel: string, userId: string | null) => boolean,
  ) {}

  init(): void {
    this.hub.on('chat.join', (c, msg) => this.join(c, this.parse(joinSchema, msg).channel));
    this.hub.on('chat.leave', (c, msg) => this.leave(c, this.parse(joinSchema, msg).channel));
    this.hub.on('chat.send', (c, msg) => this.send(c, this.parse(sendSchema, msg)));
    this.hub.onDisconnect((c) => {
      for (const set of this.members.values()) set.delete(c);
    });
  }

  private parse<T extends z.ZodType>(schema: T, msg: unknown): z.infer<T> {
    const r = schema.safeParse(msg);
    if (!r.success) throw new AppError(400, 'BAD_MESSAGE', 'Mensaje no válido');
    return r.data;
  }

  join(c: RtClient, channel: string): void {
    if (!this.canAccess(channel, c.userId)) throw new AppError(403, 'CHAT_FORBIDDEN', 'No puedes leer este chat');
    let set = this.members.get(channel);
    if (!set) {
      set = new Set();
      this.members.set(channel, set);
    }
    set.add(c);
    this.hub.send(c, { t: 'chat.history', channel, messages: this.history.get(channel) ?? [], quick: QUICK_MESSAGES, emojis: QUICK_EMOJIS });
  }

  leave(c: RtClient, channel: string): void {
    this.members.get(channel)?.delete(c);
  }

  send(c: RtClient, m: z.infer<typeof sendSchema>): void {
    if (!c.userId || !c.username) throw new AppError(401, 'UNAUTHORIZED', 'Inicia sesión para escribir en el chat');
    if (!this.members.get(m.channel)?.has(c)) throw new AppError(403, 'CHAT_FORBIDDEN', 'Entra en la mesa para escribir');
    if (this.limiter.hit(`chat:${c.userId}`) > 0) throw new AppError(429, 'RATE_LIMITED', 'Más despacio: espera un momento antes de escribir');
    let text: string;
    let kind: ChatMessage['kind'];
    if ('quick' in m) {
      const q = QUICK_MESSAGES[m.quick];
      if (!q) throw new AppError(400, 'BAD_MESSAGE', 'Mensaje rápido desconocido');
      text = q;
      kind = 'quick';
    } else if ('emoji' in m) {
      if (!QUICK_EMOJIS.includes(m.emoji)) throw new AppError(400, 'BAD_MESSAGE', 'Emoji no disponible');
      text = m.emoji;
      kind = 'emoji';
    } else {
      // Sin caracteres de control ni saltos de línea; palabrotas tapadas.
      text = maskProfanity(m.text.replace(/[\u0000-\u001f\u007f‪-‮⁦-⁩]/g, ' ').replace(/\s+/g, ' ').trim());
      if (!text) throw new AppError(400, 'BAD_MESSAGE', 'Mensaje vacío');
      kind = 'text';
    }
    const msg: ChatMessage = { id: randomUUID().slice(0, 12), channel: m.channel, from: c.username, text, kind, at: Date.now() };
    const list = this.history.get(m.channel) ?? [];
    list.push(msg);
    if (list.length > HISTORY) list.splice(0, list.length - HISTORY);
    this.history.set(m.channel, list);
    for (const member of this.members.get(m.channel) ?? []) this.hub.send(member, { t: 'chat.message', message: msg });
  }

  /** Al cerrar una sala privada, su chat desaparece. */
  drop(channel: string): void {
    this.history.delete(channel);
    this.members.delete(channel);
  }
}
