import { logger } from '../lib/logger';
import type { SecretStore } from './secrets';

export interface TelegramConfig {
  botToken: string;
  chatId: string;
}

export type AlertLevel = 'info' | 'warn' | 'critical';

const ICON: Record<AlertLevel, string> = { info: 'ℹ️', warn: '⚠️', critical: '🚨' };

type FetchFn = typeof fetch;

/**
 * Avisos al móvil por Telegram (bot propio, gratis) y latido externo.
 *
 * - Cada tipo de aviso (`key`) se envía como mucho una vez por ventana
 *   (`cooldownMs`), para no inundar el móvil durante un ataque.
 * - Latido: si se configura una URL (p. ej., de healthchecks.io), el servidor
 *   la llama cada 5 minutos; si deja de hacerlo (apagón, caída de internet,
 *   cuelgue), ese servicio avisa por su cuenta. Es la única forma de enterarse
 *   de que el servidor está caído, porque un servidor caído no puede avisar.
 */
export class Alerter {
  private last = new Map<string, number>();
  private heartbeatTimer: NodeJS.Timeout | null = null;
  private sent = 0;
  private lastError: string | null = null;
  private history: { at: string; level: AlertLevel; text: string; delivered: boolean }[] = [];

  constructor(
    private readonly secrets: SecretStore,
    private readonly fetchFn: FetchFn = fetch,
    private readonly clock: () => number = Date.now,
  ) {}

  telegram(): TelegramConfig | null {
    return this.secrets.get<TelegramConfig>('telegram');
  }

  heartbeatUrl(): string | null {
    return this.secrets.get<{ url: string }>('heartbeat')?.url ?? null;
  }

  status() {
    const tg = this.telegram();
    return {
      telegram: tg ? { configured: true, chatId: tg.chatId } : { configured: false, chatId: null },
      heartbeat: { configured: !!this.heartbeatUrl() },
      sent: this.sent,
      lastError: this.lastError,
      recent: this.history.slice(-20).reverse(),
    };
  }

  /**
   * Envía un aviso si su tipo no se ha enviado en `cooldownMs`. No lanza
   * excepciones: un fallo de Telegram nunca afecta al casino.
   */
  async notify(key: string, level: AlertLevel, text: string, cooldownMs = 30 * 60_000): Promise<boolean> {
    const now = this.clock();
    const prev = this.last.get(key);
    if (prev !== undefined && now - prev < cooldownMs) return false;
    this.last.set(key, now);
    if (this.last.size > 2000) this.last.clear();
    const tg = this.telegram();
    const entry = { at: new Date(now).toISOString(), level, text, delivered: false };
    this.history.push(entry);
    if (this.history.length > 100) this.history.shift();
    if (!tg) return false;
    entry.delivered = await this.sendTelegram(tg, `${ICON[level]} <b>Aurum</b>\n${escapeHtml(text)}`);
    return entry.delivered;
  }

  async sendTelegram(tg: TelegramConfig, html: string): Promise<boolean> {
    try {
      const res = await this.fetchFn(`https://api.telegram.org/bot${tg.botToken}/sendMessage`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ chat_id: tg.chatId, text: html, parse_mode: 'HTML', disable_web_page_preview: true }),
        signal: AbortSignal.timeout(10_000),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as { description?: string } | null;
        this.lastError = `Telegram respondió ${res.status}${body?.description ? `: ${body.description}` : ''}`;
        return false;
      }
      this.sent += 1;
      this.lastError = null;
      return true;
    } catch (err) {
      this.lastError = `No se pudo contactar con Telegram: ${(err as Error).message}`;
      return false;
    }
  }

  /**
   * Busca el chat del bot: el administrador escribe cualquier cosa al bot en
   * Telegram y aquí se lee el último mensaje recibido.
   */
  async detectChat(botToken: string): Promise<{ chatId: string; name: string } | null> {
    const res = await this.fetchFn(`https://api.telegram.org/bot${botToken}/getUpdates?limit=20`, { signal: AbortSignal.timeout(10_000) });
    const body = (await res.json().catch(() => null)) as { ok?: boolean; description?: string; result?: { message?: { chat: { id: number; first_name?: string; title?: string; username?: string } } }[] } | null;
    if (!res.ok || !body?.ok) throw new Error(body?.description ?? `Telegram respondió ${res.status}`);
    const msg = [...(body.result ?? [])].reverse().find((u) => u.message)?.message;
    if (!msg) return null;
    const c = msg.chat;
    return { chatId: String(c.id), name: c.title ?? c.first_name ?? c.username ?? String(c.id) };
  }

  startHeartbeat(intervalMs = 5 * 60_000): void {
    const beat = async (): Promise<void> => {
      const url = this.heartbeatUrl();
      if (!url) return;
      try {
        await this.fetchFn(url, { signal: AbortSignal.timeout(10_000) });
      } catch (err) {
        logger.warn('No se pudo enviar el latido', { error: (err as Error).message });
      }
    };
    void beat();
    this.heartbeatTimer = setInterval(() => void beat(), intervalMs);
    this.heartbeatTimer.unref();
  }

  stop(): void {
    if (this.heartbeatTimer) clearInterval(this.heartbeatTimer);
  }
}

const escapeHtml = (s: string): string => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
