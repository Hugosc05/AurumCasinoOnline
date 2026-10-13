/**
 * Conexión WebSocket única con reconexión automática (retroceso exponencial).
 * La autenticación usa la cookie de sesión httpOnly enviada en el handshake.
 */
export type WsStatus = 'connecting' | 'open' | 'closed';
export type WsMessage = { t: string } & Record<string, any>;

type Listener = (msg: WsMessage) => void;

class Socket {
  private ws: WebSocket | null = null;
  private listeners = new Map<string, Set<Listener>>();
  private statusListeners = new Set<(s: WsStatus) => void>();
  private openHooks = new Set<() => void>();
  private retry = 0;
  private timer: number | null = null;
  private pingTimer: number | null = null;
  status: WsStatus = 'closed';
  private wanted = false;

  connect(): void {
    this.wanted = true;
    if (this.ws && (this.ws.readyState === WebSocket.OPEN || this.ws.readyState === WebSocket.CONNECTING)) return;
    const proto = location.protocol === 'https:' ? 'wss' : 'ws';
    this.setStatus('connecting');
    const ws = new WebSocket(`${proto}://${location.host}/ws`);
    this.ws = ws;
    ws.onopen = () => {
      this.retry = 0;
      this.setStatus('open');
      for (const h of this.openHooks) h();
      this.pingTimer = window.setInterval(() => this.send({ t: 'ping' }), 20_000);
    };
    ws.onmessage = (ev) => {
      let msg: WsMessage;
      try {
        msg = JSON.parse(String(ev.data));
      } catch {
        return;
      }
      for (const l of this.listeners.get(msg.t) ?? []) l(msg);
      for (const l of this.listeners.get('*') ?? []) l(msg);
    };
    ws.onclose = () => {
      if (this.pingTimer) clearInterval(this.pingTimer);
      this.ws = null;
      this.setStatus('closed');
      if (this.wanted) this.scheduleReconnect();
    };
    ws.onerror = () => ws.close();
  }

  /** Reconecta (p. ej., tras iniciar o cerrar sesión, para que el servidor lea la nueva cookie). */
  reconnect(): void {
    this.ws?.close();
    this.retry = 0;
    if (this.timer) clearTimeout(this.timer);
    this.timer = window.setTimeout(() => this.connect(), 50);
  }

  private scheduleReconnect(): void {
    if (this.timer) clearTimeout(this.timer);
    const delay = Math.min(15_000, 500 * 2 ** this.retry) + Math.random() * 300;
    this.retry += 1;
    this.timer = window.setTimeout(() => this.connect(), delay);
  }

  private setStatus(s: WsStatus): void {
    this.status = s;
    for (const l of this.statusListeners) l(s);
  }

  send(msg: WsMessage): boolean {
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(msg));
      return true;
    }
    return false;
  }

  on(type: string, fn: Listener): () => void {
    let set = this.listeners.get(type);
    if (!set) {
      set = new Set();
      this.listeners.set(type, set);
    }
    set.add(fn);
    return () => set!.delete(fn);
  }

  onStatus(fn: (s: WsStatus) => void): () => void {
    this.statusListeners.add(fn);
    return () => this.statusListeners.delete(fn);
  }

  /** Se ejecuta en cada (re)conexión: útil para volver a suscribirse a una mesa. */
  onOpen(fn: () => void): () => void {
    this.openHooks.add(fn);
    if (this.status === 'open') fn();
    return () => this.openHooks.delete(fn);
  }
}

export const socket = new Socket();
