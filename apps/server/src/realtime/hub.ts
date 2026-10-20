import type { IncomingMessage, Server } from 'node:http';
import { WebSocketServer, type WebSocket } from 'ws';
import { z } from 'zod';
import type { AppConfig } from '../config';
import type { Database } from '../db/database';
import { SESSION_COOKIE, getSessionUser } from '../auth/sessions';
import { logger } from '../lib/logger';
import { RateLimiter } from '../lib/rateLimit';

export interface RtClient {
  id: number;
  ws: WebSocket;
  userId: string | null;
  username: string | null;
  role: 'player' | 'admin' | null;
  alive: boolean;
  watching: string | null;
  /** Mesa de blackjack multijugador que está mirando. */
  bjWatching: string | null;
  connectedAt: number;
}

export type ServerMessage = { t: string } & Record<string, unknown>;

const incomingSchema = z.object({ t: z.string().min(1).max(40) }).passthrough();

type Handler = (client: RtClient, msg: { t: string } & Record<string, unknown>) => void;

function parseCookies(header: string | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  if (!header) return out;
  for (const part of header.split(';')) {
    const i = part.indexOf('=');
    if (i === -1) continue;
    const k = part.slice(0, i).trim();
    const v = part.slice(i + 1).trim();
    try {
      out[k] = decodeURIComponent(v);
    } catch {
      out[k] = v;
    }
  }
  return out;
}

/**
 * Canal en tiempo real (WebSocket en /ws):
 *  - autenticación con la misma cookie de sesión (httpOnly) y comprobación de Origin;
 *  - presencia real: número de usuarios autenticados conectados (sin cifras inventadas);
 *  - mensajes de póker delegados al gestor de mesas;
 *  - latidos (ping/pong) para detectar conexiones caídas.
 */
export class RealtimeHub {
  private wss: WebSocketServer | null = null;
  private clients = new Set<RtClient>();
  private nextId = 1;
  private handlers = new Map<string, Handler>();
  private disconnectListeners: ((c: RtClient) => void)[] = [];
  private connectListeners: ((c: RtClient) => void)[] = [];
  /** Avisos internos entre servicios (p. ej., un usuario se sienta o se levanta de una mesa). */
  private local = new Map<string, Set<(userId: string) => void>>();
  private heartbeat: NodeJS.Timeout | null = null;
  private msgLimiter = new RateLimiter(40, 5_000);
  private presenceTimer: NodeJS.Timeout | null = null;

  constructor(private readonly db: Database, private readonly config: AppConfig) {}

  on(type: string, handler: Handler): void {
    this.handlers.set(type, handler);
  }

  onDisconnect(fn: (c: RtClient) => void): void {
    this.disconnectListeners.push(fn);
  }

  onConnect(fn: (c: RtClient) => void): void {
    this.connectListeners.push(fn);
  }

  onLocal(event: 'seat', fn: (userId: string) => void): void {
    let set = this.local.get(event);
    if (!set) {
      set = new Set();
      this.local.set(event, set);
    }
    set.add(fn);
  }

  emitLocal(event: 'seat', userId: string): void {
    for (const fn of this.local.get(event) ?? []) {
      try {
        fn(userId);
      } catch (err) {
        logger.error('Error en un aviso interno', err);
      }
    }
  }

  attach(server: Server): void {
    this.wss = new WebSocketServer({ noServer: true, maxPayload: 16 * 1024 });
    server.on('upgrade', (req, socket, head) => {
      const url = new URL(req.url ?? '/', 'http://localhost');
      if (url.pathname !== '/ws') {
        socket.destroy();
        return;
      }
      const origin = req.headers.origin;
      const host = req.headers.host;
      const sameHost = origin && host && (origin === `http://${host}` || origin === `https://${host}`);
      if (origin && !sameHost && !this.config.allowedOrigins.includes(origin)) {
        socket.write('HTTP/1.1 403 Forbidden\r\n\r\n');
        socket.destroy();
        return;
      }
      this.wss!.handleUpgrade(req, socket, head, (ws) => this.onConnection(ws, req));
    });
    this.heartbeat = setInterval(() => {
      for (const c of this.clients) {
        if (!c.alive) {
          c.ws.terminate();
          continue;
        }
        c.alive = false;
        try {
          c.ws.ping();
        } catch {
          /* ignorar */
        }
      }
    }, 25_000);
  }

  private onConnection(ws: WebSocket, req: IncomingMessage): void {
    const cookies = parseCookies(req.headers.cookie);
    const user = getSessionUser(this.db, cookies[SESSION_COOKIE], this.config.SESSION_TTL_HOURS);
    const client: RtClient = {
      id: this.nextId++,
      ws,
      userId: user?.id ?? null,
      username: user?.username ?? null,
      role: user?.role ?? null,
      alive: true,
      watching: null,
      bjWatching: null,
      connectedAt: Date.now(),
    };
    this.clients.add(client);
    ws.on('pong', () => {
      client.alive = true;
    });
    ws.on('message', (data) => this.onMessage(client, data.toString()));
    ws.on('close', () => {
      this.clients.delete(client);
      for (const fn of this.disconnectListeners) {
        try {
          fn(client);
        } catch (err) {
          logger.error('Error en desconexión WS', err);
        }
      }
      this.schedulePresence();
    });
    ws.on('error', () => {
      /* el cierre se gestiona en 'close' */
    });
    this.send(client, { t: 'hello', userId: client.userId, online: this.onlineCount() });
    for (const fn of this.connectListeners) {
      try {
        fn(client);
      } catch (err) {
        logger.error('Error en conexión WS', err);
      }
    }
    this.schedulePresence();
  }

  private onMessage(client: RtClient, raw: string): void {
    if (this.msgLimiter.hit(`ws:${client.id}`) > 0) {
      this.send(client, { t: 'error', code: 'RATE_LIMITED', message: 'Demasiados mensajes' });
      return;
    }
    let msg: unknown;
    try {
      msg = JSON.parse(raw);
    } catch {
      this.send(client, { t: 'error', code: 'BAD_MESSAGE', message: 'Mensaje no válido' });
      return;
    }
    const parsed = incomingSchema.safeParse(msg);
    if (!parsed.success) {
      this.send(client, { t: 'error', code: 'BAD_MESSAGE', message: 'Mensaje no válido' });
      return;
    }
    if (parsed.data.t === 'ping') {
      this.send(client, { t: 'pong', at: Date.now() });
      return;
    }
    const handler = this.handlers.get(parsed.data.t);
    if (!handler) {
      this.send(client, { t: 'error', code: 'UNKNOWN_TYPE', message: 'Tipo de mensaje desconocido' });
      return;
    }
    try {
      handler(client, parsed.data);
    } catch (err) {
      const e = err as { code?: string; message?: string; status?: number };
      if (e.code && e.status && e.status < 500) {
        this.send(client, { t: 'error', code: e.code, message: e.message ?? 'Error', ref: parsed.data.t });
      } else {
        logger.error('Error procesando mensaje WS', err, { type: parsed.data.t });
        this.send(client, { t: 'error', code: 'INTERNAL_ERROR', message: 'Error interno', ref: parsed.data.t });
      }
    }
  }

  send(client: RtClient, msg: ServerMessage): void {
    if (client.ws.readyState === client.ws.OPEN) client.ws.send(JSON.stringify(msg));
  }

  sendToUser(userId: string, msg: ServerMessage): void {
    for (const c of this.clients) if (c.userId === userId) this.send(c, msg);
  }

  broadcast(msg: ServerMessage): void {
    for (const c of this.clients) this.send(c, msg);
  }

  /** Usuarios humanos autenticados distintos conectados ahora mismo. */
  onlineCount(): number {
    return new Set([...this.clients].filter((c) => c.userId).map((c) => c.userId)).size;
  }

  connectionCount(): number {
    return this.clients.size;
  }

  isUserConnected(userId: string): boolean {
    for (const c of this.clients) if (c.userId === userId) return true;
    return false;
  }

  /** Refresca la sesión de los sockets de un usuario (p. ej., tras cerrar sesión o banearlo). */
  disconnectUser(userId: string): void {
    for (const c of this.clients) if (c.userId === userId) c.ws.close(4001, 'session-ended');
  }

  private schedulePresence(): void {
    if (this.presenceTimer) return;
    this.presenceTimer = setTimeout(() => {
      this.presenceTimer = null;
      this.broadcast({ t: 'presence', online: this.onlineCount() });
    }, 500);
  }

  close(): void {
    if (this.heartbeat) clearInterval(this.heartbeat);
    if (this.presenceTimer) clearTimeout(this.presenceTimer);
    for (const c of this.clients) c.ws.terminate();
    this.wss?.close();
  }
}
