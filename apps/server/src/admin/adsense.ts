import { randomBytes } from 'node:crypto';
import { AppError } from '../lib/errors';
import { maskSecret, type SecretStore } from './secrets';

type FetchFn = typeof fetch;

export interface AdsenseCredentials {
  clientId: string;
  clientSecret: string;
  refreshToken?: string;
  account?: string;
  accountName?: string;
  redirectUri?: string;
}

export interface RevenueDay {
  date: string;
  earnings: number;
  pageViews: number;
  impressions: number;
  clicks: number;
  rpm: number;
}

export interface RevenueReport {
  currency: string;
  days: RevenueDay[];
  totals: { today: number; yesterday: number; last7: number; last30: number; thisMonth: number };
  fetchedAt: string;
}

const SCOPE = 'https://www.googleapis.com/auth/adsense.readonly';
const TOKEN_URL = 'https://oauth2.googleapis.com/token';
const API = 'https://adsense.googleapis.com/v2';

/**
 * Conexión con la API de AdSense (solo lectura) para ver en el panel lo que
 * generan los anuncios. OAuth 2.0 con un cliente propio de Google Cloud:
 * el administrador pega el ID y el secreto del cliente, pulsa «Conectar»,
 * acepta en Google y el servidor guarda el refresh token cifrado.
 */
export class AdsenseClient {
  private pending = new Map<string, { redirectUri: string; at: number }>();
  private access: { token: string; until: number } | null = null;
  private cache: { report: RevenueReport; at: number } | null = null;
  lastError: string | null = null;

  constructor(
    private readonly secrets: SecretStore,
    private readonly fetchFn: FetchFn = fetch,
    private readonly clock: () => number = Date.now,
  ) {}

  private creds(): AdsenseCredentials | null {
    return this.secrets.get<AdsenseCredentials>('adsense');
  }

  status() {
    const c = this.creds();
    return {
      configured: !!c,
      connected: !!c?.refreshToken,
      clientId: c?.clientId ?? null,
      clientSecret: maskSecret(c?.clientSecret),
      account: c?.account ?? null,
      accountName: c?.accountName ?? null,
      lastError: this.lastError,
    };
  }

  saveClient(clientId: string, clientSecret: string): void {
    const prev = this.creds();
    // Si cambia el cliente, la conexión anterior deja de valer.
    const same = prev?.clientId === clientId;
    this.secrets.set('adsense', { clientId, clientSecret: clientSecret || prev?.clientSecret || '', ...(same ? { refreshToken: prev?.refreshToken, account: prev?.account, accountName: prev?.accountName } : {}) });
    this.access = null;
    this.cache = null;
  }

  disconnect(): void {
    this.secrets.delete('adsense');
    this.access = null;
    this.cache = null;
    this.lastError = null;
  }

  /** URL de Google a la que se envía al administrador para dar permiso. */
  authUrl(redirectUri: string): string {
    const c = this.creds();
    if (!c?.clientId || !c.clientSecret) throw new AppError(400, 'ADSENSE_NOT_CONFIGURED', 'Primero guarda el ID y el secreto del cliente de Google');
    const state = randomBytes(24).toString('base64url');
    const now = this.clock();
    for (const [k, v] of this.pending) if (now - v.at > 15 * 60_000) this.pending.delete(k);
    this.pending.set(state, { redirectUri, at: now });
    const q = new URLSearchParams({
      client_id: c.clientId,
      redirect_uri: redirectUri,
      response_type: 'code',
      scope: SCOPE,
      access_type: 'offline',
      prompt: 'consent',
      include_granted_scopes: 'true',
      state,
    });
    return `https://accounts.google.com/o/oauth2/v2/auth?${q}`;
  }

  /**
   * Vuelta desde Google. No depende de la cookie (SameSite=Strict no viaja en
   * una redirección desde otro sitio): la autoriza el `state` de un solo uso,
   * creado por un administrador en los últimos 15 minutos.
   */
  async callback(state: string, code: string): Promise<void> {
    const p = this.pending.get(state);
    this.pending.delete(state);
    if (!p || this.clock() - p.at > 15 * 60_000) throw new AppError(400, 'ADSENSE_STATE', 'El enlace de conexión ha caducado. Vuelve a pulsar «Conectar».');
    const c = this.creds();
    if (!c) throw new AppError(400, 'ADSENSE_NOT_CONFIGURED', 'Falta el cliente de Google');
    const tok = await this.token({ grant_type: 'authorization_code', code, redirect_uri: p.redirectUri, client_id: c.clientId, client_secret: c.clientSecret });
    if (!tok.refresh_token) throw new AppError(400, 'ADSENSE_NO_REFRESH', 'Google no devolvió un permiso permanente. Quita el acceso de la app en tu cuenta de Google y vuelve a conectar.');
    this.access = { token: tok.access_token, until: this.clock() + (tok.expires_in - 60) * 1000 };
    const accounts = await this.api<{ accounts?: { name: string; displayName?: string }[] }>('/accounts');
    const acc = accounts.accounts?.[0];
    this.secrets.set('adsense', { ...c, refreshToken: tok.refresh_token, redirectUri: p.redirectUri, account: acc?.name, accountName: acc?.displayName ?? acc?.name });
    this.cache = null;
    this.lastError = acc ? null : 'Conectado, pero esa cuenta de Google no tiene ninguna cuenta de AdSense.';
  }

  private async token(params: Record<string, string>): Promise<{ access_token: string; expires_in: number; refresh_token?: string }> {
    const res = await this.fetchFn(TOKEN_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams(params).toString(),
      signal: AbortSignal.timeout(15_000),
    });
    const body = (await res.json().catch(() => ({}))) as { access_token?: string; expires_in?: number; refresh_token?: string; error?: string; error_description?: string };
    if (!res.ok || !body.access_token) {
      const msg = body.error === 'invalid_grant'
        ? 'Google ha retirado el permiso (o la app de Google Cloud está en modo «Prueba» y caducó a los 7 días). Vuelve a conectar.'
        : `Google rechazó la autorización: ${body.error_description ?? body.error ?? res.status}`;
      throw new AppError(502, 'ADSENSE_TOKEN', msg);
    }
    return { access_token: body.access_token, expires_in: body.expires_in ?? 3600, refresh_token: body.refresh_token };
  }

  private async accessToken(): Promise<string> {
    if (this.access && this.access.until > this.clock()) return this.access.token;
    const c = this.creds();
    if (!c?.refreshToken) throw new AppError(400, 'ADSENSE_NOT_CONNECTED', 'AdSense no está conectado');
    const tok = await this.token({ grant_type: 'refresh_token', refresh_token: c.refreshToken, client_id: c.clientId, client_secret: c.clientSecret });
    this.access = { token: tok.access_token, until: this.clock() + (tok.expires_in - 60) * 1000 };
    return this.access.token;
  }

  private async api<T>(pathAndQuery: string): Promise<T> {
    const res = await this.fetchFn(`${API}${pathAndQuery}`, { headers: { Authorization: `Bearer ${await this.accessToken()}` }, signal: AbortSignal.timeout(20_000) });
    const body = (await res.json().catch(() => ({}))) as T & { error?: { message?: string } };
    if (!res.ok) throw new AppError(502, 'ADSENSE_API', `AdSense respondió ${res.status}: ${body.error?.message ?? 'error'}`);
    return body;
  }

  /** Informe de los últimos 31 días (incluido hoy), por día. Se guarda 30 minutos. */
  async report(force = false, today = new Date(this.clock())): Promise<RevenueReport> {
    if (!force && this.cache && this.clock() - this.cache.at < 30 * 60_000) return this.cache.report;
    const c = this.creds();
    if (!c?.account) throw new AppError(400, 'ADSENSE_NOT_CONNECTED', 'AdSense no está conectado');
    const start = new Date(today.getTime() - 30 * 86_400_000);
    const q = new URLSearchParams({
      dateRange: 'CUSTOM',
      'startDate.year': String(start.getUTCFullYear()),
      'startDate.month': String(start.getUTCMonth() + 1),
      'startDate.day': String(start.getUTCDate()),
      'endDate.year': String(today.getUTCFullYear()),
      'endDate.month': String(today.getUTCMonth() + 1),
      'endDate.day': String(today.getUTCDate()),
      dimensions: 'DATE',
      currencyCode: 'EUR',
      reportingTimeZone: 'ACCOUNT_TIME_ZONE',
    });
    for (const m of ['ESTIMATED_EARNINGS', 'PAGE_VIEWS', 'IMPRESSIONS', 'CLICKS', 'PAGE_VIEWS_RPM']) q.append('metrics', m);
    try {
      const r = await this.api<{ headers?: { name: string; currencyCode?: string }[]; rows?: { cells: { value: string }[] }[] }>(`/${c.account}/reports:generate?${q}`);
      const idx = (name: string): number => r.headers?.findIndex((h) => h.name === name) ?? -1;
      const cell = (row: { cells: { value: string }[] }, name: string): string => row.cells[idx(name)]?.value ?? '0';
      const days: RevenueDay[] = (r.rows ?? []).map((row) => ({
        date: cell(row, 'DATE'),
        earnings: Number(cell(row, 'ESTIMATED_EARNINGS')),
        pageViews: Number(cell(row, 'PAGE_VIEWS')),
        impressions: Number(cell(row, 'IMPRESSIONS')),
        clicks: Number(cell(row, 'CLICKS')),
        rpm: Number(cell(row, 'PAGE_VIEWS_RPM')),
      })).sort((a, b) => a.date.localeCompare(b.date));
      const sum = (list: RevenueDay[]): number => Math.round(list.reduce((s, d) => s + d.earnings, 0) * 100) / 100;
      const todayKey = days.at(-1)?.date ?? '';
      const month = todayKey.slice(0, 7);
      const report: RevenueReport = {
        currency: r.headers?.find((h) => h.currencyCode)?.currencyCode ?? 'EUR',
        days,
        totals: {
          today: sum(days.slice(-1)),
          yesterday: sum(days.slice(-2, -1)),
          last7: sum(days.slice(-7)),
          last30: sum(days.slice(-30)),
          thisMonth: sum(days.filter((d) => d.date.startsWith(month))),
        },
        fetchedAt: new Date(this.clock()).toISOString(),
      };
      this.cache = { report, at: this.clock() };
      this.lastError = null;
      return report;
    } catch (err) {
      this.lastError = (err as Error).message;
      throw err;
    }
  }
}
