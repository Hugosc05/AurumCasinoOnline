import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Client, createAdmin, openWs, registerUser, startServer, type TestServer } from './helpers';
import { base32Decode, base32Encode, hotp, totp, verifyTotp } from '../src/auth/totp';
import { Alerter } from '../src/admin/alerts';
import { AdsenseClient } from '../src/admin/adsense';
import { parseAudit } from '../src/admin/checks';
import { isProbePath } from '../src/admin/security';
import { normalizePath } from '../src/admin/activity';
import { describeUa } from '../src/routes/adminPanel';

/** Secretos en memoria para probar Alerter y AdsenseClient sin base de datos. */
class MemSecrets {
  data = new Map<string, unknown>();
  get<T>(k: string): T | null {
    return (this.data.get(k) as T) ?? null;
  }
  set(k: string, v: unknown): void {
    this.data.set(k, v);
  }
  delete(k: string): void {
    this.data.delete(k);
  }
}

const json = (body: unknown, status = 200): Response => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

describe('TOTP (RFC 6238 / RFC 4226)', () => {
  it('coincide con los vectores de prueba oficiales', () => {
    const key = Buffer.from('12345678901234567890');
    // RFC 4226, apéndice D
    expect([0, 1, 2, 9].map((c) => hotp(key, c))).toEqual(['755224', '287082', '359152', '520489']);
    // RFC 6238, apéndice B (SHA-1, 8 dígitos)
    const b32 = base32Encode(key);
    expect(totp(b32, 59_000, 8)).toBe('94287082');
    expect(totp(b32, 1_111_111_109_000, 8)).toBe('07081804');
    expect(totp(b32, 2_000_000_000_000, 8)).toBe('69279037');
    expect(base32Decode(b32).equals(key)).toBe(true);
  });

  it('admite ±30 s de desfase, rechaza códigos ya usados y basura', () => {
    const secret = base32Encode(Buffer.from('abcdefghijabcdefghij'));
    const t = 1_700_000_000_000;
    const code = totp(secret, t);
    const step = verifyTotp(secret, code, 0, t)!;
    expect(step).toBeGreaterThan(0);
    expect(verifyTotp(secret, code, 0, t + 30_000)).toBe(step);
    expect(verifyTotp(secret, code, 0, t + 95_000)).toBeNull();
    expect(verifyTotp(secret, code, step, t)).toBeNull();
    expect(verifyTotp(secret, '12345', 0, t)).toBeNull();
    expect(verifyTotp(secret, 'abcdef', 0, t)).toBeNull();
  });
});

describe('utilidades del panel', () => {
  it('detecta rutas de escáneres sin tocar las de la web', () => {
    for (const p of ['/.env', '/wp-login.php', '/wp-admin/', '/.git/config', '/phpmyadmin/index.php', '/backup.sql', '/config.json']) expect(isProbePath(p), p).toBe(true);
    for (const p of ['/', '/poker/zafiro', '/assets/index-abc.js', '/api/health', '/perfil', '/plinko', '/admin/seguridad']) expect(isProbePath(p), p).toBe(false);
  });

  it('agrupa las visitas por sección sin identificadores ni panel', () => {
    expect(normalizePath('/poker/zafiro')).toBe('/poker');
    expect(normalizePath('/salas/abc?x=1')).toBe('/salas');
    expect(normalizePath('/')).toBe('/');
    expect(normalizePath('/admin/usuarios')).toBeNull();
    expect(normalizePath('https://otro.com')).toBeNull();
  });

  it('resume el navegador', () => {
    expect(describeUa('Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1')).toBe('Safari · iOS · móvil');
    expect(describeUa('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36 Edg/130.0')).toBe('Edge · Windows');
    expect(describeUa(null)).toBe('Desconocido');
  });

  it('interpreta la salida de npm audit', () => {
    const r = parseAudit(JSON.stringify({
      vulnerabilities: {
        express: { name: 'express', severity: 'high', isDirect: true, via: [{ title: 'Open redirect' }], fixAvailable: true },
        debug: { name: 'debug', severity: 'low', isDirect: false, via: ['express'], fixAvailable: false },
      },
      metadata: { vulnerabilities: { info: 0, low: 1, moderate: 0, high: 1, critical: 0, total: 2 }, dependencies: { prod: 120 } },
    }));
    expect(r.counts).toMatchObject({ high: 1, low: 1, total: 2 });
    expect(r.packages[0]).toMatchObject({ name: 'express', severity: 'high', title: 'Open redirect', direct: true, fix: true });
    expect(r.dependencies).toBe(120);
    expect(() => parseAudit(JSON.stringify({ error: { summary: 'sin red' } }))).toThrow('sin red');
  });
});

describe('avisos por Telegram', () => {
  it('envía, no repite el mismo aviso dentro de su ventana y escapa el HTML', async () => {
    const secrets = new MemSecrets();
    secrets.set('telegram', { botToken: '123:abc', chatId: '42' });
    const calls: { url: string; body: any }[] = [];
    let now = 1_000_000;
    const alerter = new Alerter(secrets as never, (async (url: string, init?: RequestInit) => {
      calls.push({ url, body: JSON.parse(String(init?.body)) });
      return json({ ok: true });
    }) as typeof fetch, () => now);
    expect(await alerter.notify('k', 'warn', 'Ataque <script>', 60_000)).toBe(true);
    expect(await alerter.notify('k', 'warn', 'otra vez', 60_000)).toBe(false);
    now += 61_000;
    expect(await alerter.notify('k', 'warn', 'pasada la ventana', 60_000)).toBe(true);
    expect(calls).toHaveLength(2);
    expect(calls[0]!.url).toBe('https://api.telegram.org/bot123:abc/sendMessage');
    expect(calls[0]!.body).toMatchObject({ chat_id: '42', parse_mode: 'HTML' });
    expect(calls[0]!.body.text).toContain('Ataque &lt;script&gt;');
    expect(alerter.status().sent).toBe(2);
  });

  it('sin configurar no llama a nadie; un fallo de Telegram no lanza', async () => {
    const secrets = new MemSecrets();
    let called = 0;
    const alerter = new Alerter(secrets as never, (async () => {
      called += 1;
      throw new Error('sin red');
    }) as typeof fetch);
    expect(await alerter.notify('a', 'info', 'hola')).toBe(false);
    expect(called).toBe(0);
    secrets.set('telegram', { botToken: '1:x', chatId: '1' });
    expect(await alerter.notify('b', 'info', 'hola')).toBe(false);
    expect(alerter.status().lastError).toContain('sin red');
  });

  it('detecta el chat con el último mensaje recibido por el bot', async () => {
    const alerter = new Alerter(new MemSecrets() as never, (async () => json({ ok: true, result: [{ message: { chat: { id: 7, first_name: 'Hugo' } } }, { message: { chat: { id: 99, first_name: 'Hugo' } } }] })) as typeof fetch);
    expect(await alerter.detectChat('t')).toEqual({ chatId: '99', name: 'Hugo' });
  });
});

describe('AdSense', () => {
  it('conecta con OAuth (state de un solo uso) y resume el informe', async () => {
    const secrets = new MemSecrets();
    const requests: string[] = [];
    const fetchFn = (async (url: string, init?: RequestInit) => {
      requests.push(url);
      if (url.startsWith('https://oauth2.googleapis.com/token')) {
        const p = new URLSearchParams(String(init?.body));
        return json(p.get('grant_type') === 'authorization_code'
          ? { access_token: 'at1', expires_in: 3600, refresh_token: 'rt1' }
          : { access_token: 'at2', expires_in: 3600 });
      }
      if (url.endsWith('/v2/accounts')) return json({ accounts: [{ name: 'accounts/pub-123', displayName: 'Aurum' }] });
      if (url.includes('reports:generate')) {
        expect(url).toContain('metrics=ESTIMATED_EARNINGS');
        return json({
          headers: [{ name: 'DATE' }, { name: 'ESTIMATED_EARNINGS', currencyCode: 'EUR' }, { name: 'PAGE_VIEWS' }, { name: 'IMPRESSIONS' }, { name: 'CLICKS' }, { name: 'PAGE_VIEWS_RPM' }],
          rows: [
            { cells: [{ value: '2026-11-01' }, { value: '1.50' }, { value: '300' }, { value: '900' }, { value: '3' }, { value: '5.00' }] },
            { cells: [{ value: '2026-11-02' }, { value: '2.25' }, { value: '400' }, { value: '1200' }, { value: '4' }, { value: '5.62' }] },
          ],
        });
      }
      return json({}, 404);
    }) as typeof fetch;
    const ads = new AdsenseClient(secrets as never, fetchFn);
    expect(() => ads.authUrl('https://x/api/adsense/callback')).toThrow();
    ads.saveClient('abc.apps.googleusercontent.com', 'sec');
    const url = new URL(ads.authUrl('https://casino.ts.net/api/adsense/callback'));
    expect(url.searchParams.get('scope')).toBe('https://www.googleapis.com/auth/adsense.readonly');
    expect(url.searchParams.get('access_type')).toBe('offline');
    const state = url.searchParams.get('state')!;
    await expect(ads.callback('estado-falso', 'code')).rejects.toThrow('caducado');
    await ads.callback(state, 'code');
    await expect(ads.callback(state, 'code')).rejects.toThrow('caducado'); // un solo uso
    expect(ads.status()).toMatchObject({ connected: true, account: 'accounts/pub-123', clientSecret: '••••sec' });
    const report = await ads.report(true, new Date('2026-11-02T12:00:00Z'));
    expect(report.totals).toMatchObject({ today: 2.25, yesterday: 1.5, last7: 3.75, thisMonth: 3.75 });
    expect(report.days[1]).toMatchObject({ pageViews: 400, clicks: 4 });
    ads.disconnect();
    expect(ads.status().connected).toBe(false);
  });
});

describe('panel de administración', () => {
  let s: TestServer;
  beforeAll(async () => {
    s = await startServer(undefined, { ADMIN_MFA_REQUIRED: 'true' });
  });
  afterAll(async () => {
    await s.stop();
  });

  it('2FA obligatoria: configurar, verificar, códigos de recuperación y desactivar', async () => {
    const admin = await createAdmin(s);
    const blocked = await admin.client.get('/api/admin/overview');
    expect(blocked.status).toBe(403);
    expect(blocked.body.error.code).toBe('MFA_SETUP_REQUIRED');
    expect((await admin.client.get('/api/admin/mfa')).body).toMatchObject({ enabled: false, required: true });

    expect((await admin.client.post('/api/admin/mfa/setup', { password: 'mala' })).body.error.code).toBe('INVALID_PASSWORD');
    const setup = await admin.client.post('/api/admin/mfa/setup', { password: 'AdminPass123' });
    expect(setup.status).toBe(200);
    expect(setup.body.uri).toMatch(/^otpauth:\/\/totp\/Aurum%20Casino/);
    expect(setup.body.qr).toMatch(/^data:image\/svg\+xml;base64,/);
    const secret = setup.body.secret as string;
    expect((await admin.client.post('/api/admin/mfa/enable', { code: '000000' })).status).toBe(400);
    const enabled = await admin.client.post('/api/admin/mfa/enable', { code: totp(secret) });
    expect(enabled.status).toBe(200);
    expect(enabled.body.recoveryCodes).toHaveLength(8);
    // La sesión que la activó ya puede usar el panel.
    expect((await admin.client.get('/api/admin/overview')).status).toBe(200);

    // Una sesión nueva tiene que superar el código.
    const other = new Client(s.base);
    await other.post('/api/auth/login', { identifier: admin.username, password: 'AdminPass123' });
    const need = await other.get('/api/admin/overview');
    expect(need.body.error.code).toBe('MFA_REQUIRED');
    expect((await other.post('/api/admin/mfa/verify', { code: '123456' })).status).toBe(400);
    // Código de recuperación: vale una vez.
    const rec = enabled.body.recoveryCodes[0] as string;
    const v = await other.post('/api/admin/mfa/verify', { code: rec.toLowerCase() });
    expect(v.body).toMatchObject({ ok: true, usedRecovery: true, recoveryLeft: 7 });
    expect((await other.get('/api/admin/overview')).status).toBe(200);
    const third = new Client(s.base);
    await third.post('/api/auth/login', { identifier: admin.username, password: 'AdminPass123' });
    expect((await third.post('/api/admin/mfa/verify', { code: rec })).status).toBe(400);

    // Quedan registrados los fallos.
    const ev = s.app.ctx.db.all<{ kind: string }>(`SELECT kind FROM security_events WHERE user_id = ?`, admin.id).map((e) => e.kind);
    expect(ev).toEqual(expect.arrayContaining(['mfa_enabled', 'mfa_failed', 'mfa_recovery_used', 'admin_login']));

    // Desactivar exige contraseña y un código válido.
    expect((await admin.client.post('/api/admin/mfa/disable', { password: 'AdminPass123', code: '111111' })).status).toBe(400);
    const off = await admin.client.post('/api/admin/mfa/disable', { password: 'AdminPass123', code: enabled.body.recoveryCodes[1] });
    expect(off.status).toBe(200);
    expect((await admin.client.get('/api/admin/overview')).body.error.code).toBe('MFA_SETUP_REQUIRED');
  });

  it('un jugador no puede usar el panel ni las rutas de 2FA', async () => {
    const p = await registerUser(s.base);
    expect((await p.client.get('/api/admin/mfa')).status).toBe(403);
    expect((await p.client.post('/api/admin/mfa/setup', { password: p.password })).status).toBe(403);
    expect((await p.client.get('/api/admin/live')).status).toBe(403);
  });

  /** Administrador con 2FA ya superada (para el resto de pruebas). */
  async function verifiedAdmin() {
    const admin = await createAdmin(s);
    const setup = await admin.client.post('/api/admin/mfa/setup', { password: 'AdminPass123' });
    await admin.client.post('/api/admin/mfa/enable', { code: totp(setup.body.secret) });
    return admin;
  }

  it('registra intentos fallidos, sondeos y peticiones CSRF', async () => {
    const admin = await verifiedAdmin();
    const p = await registerUser(s.base);
    const anon = new Client(s.base);
    expect((await anon.post('/api/auth/login', { identifier: p.username, password: 'incorrecta1' })).status).toBe(401);
    const probe = await fetch(`${s.base}/.env`);
    expect(probe.status).toBe(404);
    expect(await probe.text()).toBe('Not found');
    expect((await p.client.post('/api/me/promotions/daily-bonus', {}, { csrf: false })).status).toBe(403);
    const sec = await admin.client.get('/api/admin/security');
    expect(sec.status).toBe(200);
    const kinds = sec.body.counts.map((c: { kind: string }) => c.kind);
    expect(kinds).toEqual(expect.arrayContaining(['login_failed', 'probe', 'csrf_blocked']));
    const ids = sec.body.checks.map((c: { id: string }) => c.id);
    expect(ids).toEqual(expect.arrayContaining(['env', 'cookies', 'mfa', 'backup', 'audit', 'telegram', ...(s.app.ctx.db.dialect === 'sqlite' ? ['integrity'] : [])]));
    const events = await admin.client.get('/api/admin/security/events?severity=warn');
    expect(events.body.items.length).toBeGreaterThan(0);
    expect(events.body.items.every((e: { severity: string }) => e.severity === 'warn')).toBe(true);
  });

  it('en directo: quién está conectado y en qué página, y expulsar', async () => {
    const admin = await verifiedAdmin();
    const p = await registerUser(s.base);
    const conn = await openWs(s, p.client.cookie);
    await conn.next((m) => m.t === 'hello');
    conn.ws.send(JSON.stringify({ t: 'nav', path: '/poker/zafiro' }));
    conn.ws.send(JSON.stringify({ t: 'nav', path: 'javascript:alert(1)' }));
    await new Promise((r) => setTimeout(r, 150));
    const live = await admin.client.get('/api/admin/live');
    const me = live.body.users.find((u: { username: string }) => u.username === p.username);
    expect(me).toMatchObject({ path: '/poker/zafiro', tabs: 1, role: 'player', balance: expect.any(Number) });
    expect(me.ip).toBeTruthy();
    const kicked = await admin.client.post(`/api/admin/live/${p.user.id}/kick`);
    expect(kicked.status).toBe(200);
    await new Promise((r) => setTimeout(r, 150));
    expect(conn.ws.readyState).toBeGreaterThanOrEqual(2);
    expect((await p.client.get('/api/auth/session')).status).toBe(401);
    conn.ws.close();
  });

  it('actividad y economía: activos, visitas, juegos y beneficio de la casa', async () => {
    const admin = await verifiedAdmin();
    const p = await registerUser(s.base);
    const conn = await openWs(s, p.client.cookie);
    conn.ws.send(JSON.stringify({ t: 'nav', path: '/plinko' }));
    await new Promise((r) => setTimeout(r, 100));
    await p.client.post('/api/games/plinko/drop', { rows: 12, risk: 'low', bet: 10, count: 3, idempotencyKey: `k${Date.now()}` });
    const act = await admin.client.get('/api/admin/activity?days=7');
    expect(act.status).toBe(200);
    const today = act.body.days.at(-1);
    expect(today.active).toBeGreaterThanOrEqual(1);
    expect(today.views).toBeGreaterThanOrEqual(1);
    expect(today.visitors).toBeGreaterThanOrEqual(1);
    expect(act.body.sections.find((x: { path: string }) => x.path === '/plinko')).toBeTruthy();
    const plinko = act.body.games.find((g: { game: string }) => g.game === 'plinko');
    expect(plinko).toMatchObject({ rounds: expect.any(Number), players: expect.any(Number) });
    expect(plinko.houseProfit).toBe(plinko.bet - plinko.payout);
    expect(act.body.economy.flows.find((f: { reason: string }) => f.reason === 'signup_bonus')).toBeTruthy();
    expect(act.body.users.mau).toBeGreaterThanOrEqual(1);
    conn.ws.close();
  });

  it('servidor, avisos e ingresos', async () => {
    const admin = await verifiedAdmin();
    const srv = await admin.client.get('/api/admin/server');
    expect(srv.status).toBe(200);
    expect(srv.body.system.cpus).toBeGreaterThan(0);
    expect(srv.body.current).toHaveProperty('memUsedPct');

    expect((await admin.client.req('PUT', '/api/admin/alerts/telegram', { botToken: 'malo', chatId: '1' })).status).toBe(400);
    const tg = await admin.client.req('PUT', '/api/admin/alerts/telegram', { botToken: '123456789:AAHdqTcvCH1vGWJxfSeofSAs0K5PALDsaw1', chatId: '987654' });
    expect(tg.status).toBe(200);
    const st = await admin.client.get('/api/admin/alerts');
    expect(st.body.telegram).toEqual({ configured: true, chatId: '987654' });
    // Guardado cifrado: el token no aparece en claro en la base de datos.
    const stored = s.app.ctx.db.get<{ value: string }>(`SELECT value FROM app_secrets WHERE key = 'telegram'`)!.value;
    expect(stored).toMatch(/^v1:/);
    expect(stored).not.toContain('AAHdqTcv');
    await admin.client.req('DELETE', '/api/admin/alerts/telegram');
    expect((await admin.client.get('/api/admin/alerts')).body.telegram.configured).toBe(false);
    expect((await admin.client.req('PUT', '/api/admin/alerts/heartbeat', { url: 'http://inseguro.com' })).status).toBe(400);
    expect((await admin.client.req('PUT', '/api/admin/alerts/big-win', { amount: 500000 })).status).toBe(200);

    const rev = await admin.client.get('/api/admin/revenue');
    expect(rev.body.adsense).toMatchObject({ configured: false, connected: false });
    expect(rev.body.adsense.redirectUri).toBe(`${s.base}/api/adsense/callback`);
    expect((await admin.client.req('PUT', '/api/admin/revenue/client', { clientId: 'x', clientSecret: 'y' })).status).toBe(400);
    expect((await admin.client.req('PUT', '/api/admin/revenue/client', { clientId: '12-ab.apps.googleusercontent.com', clientSecret: 'GOCSPX-abc' })).status).toBe(200);
    const connect = await admin.client.post('/api/admin/revenue/connect');
    expect(connect.body.url).toMatch(/^https:\/\/accounts\.google\.com\/o\/oauth2\/v2\/auth\?/);
    // La vuelta de Google con un state inventado no conecta nada.
    const back = await fetch(`${s.base}/api/adsense/callback?state=falso&code=x`, { redirect: 'manual' });
    expect(back.status).toBe(302);
    expect(back.headers.get('location')).toBe('/admin/ingresos?adsense=error');
  });

  it('anuncios en la web: desactivados por defecto; ads.txt y CSP al activarlos', async () => {
    const admin = await verifiedAdmin();
    expect((await (await fetch(`${s.base}/api/ads-display`)).json())).toEqual({ enabled: false });
    expect((await fetch(`${s.base}/ads.txt`)).status).toBe(404);
    expect((await fetch(`${s.base}/api/health`)).headers.get('content-security-policy')).not.toContain('googlesyndication');
    expect((await admin.client.req('PUT', '/api/admin/revenue/display', { enabled: true, publisherId: '', slots: { home: '', lobby: '', rewards: '' } })).status).toBe(400);
    const ok = await admin.client.req('PUT', '/api/admin/revenue/display', { enabled: true, publisherId: 'ca-pub-1234567890123456', slots: { home: '111111', lobby: '', rewards: '' } });
    expect(ok.status).toBe(200);
    expect(await (await fetch(`${s.base}/api/ads-display`)).json()).toEqual({ enabled: true, publisherId: 'ca-pub-1234567890123456', slots: { home: '111111', lobby: '', rewards: '' } });
    expect(await (await fetch(`${s.base}/ads.txt`)).text()).toBe('google.com, pub-1234567890123456, DIRECT, f08c47fec0942fa0\n');
    await admin.client.req('PUT', '/api/admin/revenue/display', { enabled: false, publisherId: 'ca-pub-1234567890123456', slots: { home: '', lobby: '', rewards: '' } });
    expect(await (await fetch(`${s.base}/api/ads-display`)).json()).toEqual({ enabled: false });
  });
});

describe('CSP con anuncios activados', () => {
  it('abre solo los dominios de AdSense', async () => {
    const s = await startServer();
    try {
      const { setSetting } = await import('../src/db/seed');
      setSetting(s.app.ctx.db, 'adsDisplay', { enabled: true, publisherId: 'ca-pub-1234567890123456', slots: { home: '', lobby: '', rewards: '' } });
      const csp = (await fetch(`${s.base}/api/health`)).headers.get('content-security-policy')!;
      expect(csp).toContain('https://pagead2.googlesyndication.com');
      expect(csp).toMatch(/frame-src 'self' https:\/\/googleads\.g\.doubleclick\.net/);
      expect(csp).not.toContain("'unsafe-eval'");
    } finally {
      await s.stop();
    }
  });
});
