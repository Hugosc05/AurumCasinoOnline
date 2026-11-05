import { BellRing, ExternalLink, RefreshCw, ScanSearch, ShieldCheck } from 'lucide-react';
import { useState } from 'react';
import { Badge, Button, Field, Modal, Segmented } from '../components/ui';
import { api } from '../lib/api';
import { credits, cx, dateTime } from '../lib/format';
import { useNotify } from '../state/notify';
import { MfaSetup, type MfaStatus } from './Mfa';
import { Card, Loadable, PageTitle, StatusMark, act, ago, td, th, useLoad } from './shared';

interface Check {
  id: string;
  group: string;
  label: string;
  status: 'ok' | 'warn' | 'fail' | 'info';
  detail: string;
  fix?: string;
}

interface Security {
  checks: Check[];
  counts: { kind: string; label: string; n: number }[];
  topIps: { ip: string; n: number; kind: string }[];
  multiAccounts: { ip: string; accounts: number; names: string[] }[];
  audit: null | { at: string; counts: Record<string, number>; dependencies: number; packages: { name: string; severity: string; title: string; direct: boolean; fix: boolean }[] };
  auditRunning: boolean;
  auditError: string | null;
  ledger: null | { at: string; checked: number; problems: { id: string; username: string; balance: number; ledgerBalance: number | null }[] };
  suppressed: number;
}

interface Alerts {
  telegram: { configured: boolean; chatId: string | null };
  heartbeat: { configured: boolean };
  sent: number;
  lastError: string | null;
  recent: { at: string; level: string; text: string; delivered: boolean }[];
  bigWin: number;
}

interface SecEvent {
  id: number;
  kind: string;
  label: string;
  severity: 'info' | 'warn' | 'high';
  ip: string | null;
  detail: string | null;
  createdAt: string;
  username: string | null;
}

const SEV_TONE = { info: 'muted', warn: 'gold', high: 'red' } as const;
const SEV_LABEL = { info: 'info', warn: 'aviso', high: 'grave' } as const;

function ChecksCard({ checks }: { checks: Check[] }) {
  const groups = [...new Set(checks.map((c) => c.group))];
  const fails = checks.filter((c) => c.status === 'fail').length;
  const warns = checks.filter((c) => c.status === 'warn').length;
  return (
    <Card title="Comprobaciones" action={
      <p className="flex items-center gap-2 text-sm">
        {fails === 0 && warns === 0 ? <><StatusMark status="ok" /> <span className="text-exito">Todo en orden</span></> : <span className="text-niebla">{fails > 0 && <span className="text-[#f1a3ad]">{fails} por arreglar</span>}{fails > 0 && warns > 0 && ' · '}{warns > 0 && <span className="text-oro-claro">{warns} a revisar</span>}</span>}
      </p>
    }>
      <div className="grid gap-5 lg:grid-cols-2">
        {groups.map((g) => (
          <div key={g}>
            <h3 className="mb-2 text-xs uppercase tracking-wider text-niebla">{g}</h3>
            <ul className="space-y-2">
              {checks.filter((c) => c.group === g).map((c) => (
                <li key={c.id} className="flex gap-2.5 text-sm" data-testid={`check-${c.id}`}>
                  <span className="mt-0.5"><StatusMark status={c.status} /></span>
                  <div className="min-w-0">
                    <p className="text-marfil">{c.label}</p>
                    <p className="break-words text-xs text-niebla">{c.detail}</p>
                    {c.fix && c.status !== 'ok' && <p className="mt-0.5 text-xs text-oro-claro">→ {c.fix}</p>}
                  </div>
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>
    </Card>
  );
}

function MfaCard({ mfa, onChange }: { mfa: MfaStatus; onChange: () => void }) {
  const { notify } = useNotify();
  const [setup, setSetup] = useState(false);
  const [off, setOff] = useState(false);
  const [password, setPassword] = useState('');
  const [code, setCode] = useState('');
  return (
    <Card title="Verificación en dos pasos">
      {mfa.enabled ? (
        <>
          <p className="flex items-center gap-2 text-sm text-exito"><ShieldCheck className="h-4 w-4" /> Activada en tu cuenta</p>
          <p className="mt-1 text-sm text-niebla">Te quedan {mfa.recoveryLeft} códigos de recuperación. {mfa.required ? 'Es obligatoria para todos los administradores.' : ''}</p>
          <p className="mt-1 text-xs text-niebla">¿Perdiste el móvil y los códigos? En el servidor: <span className="font-mono">npm run admin:reset-2fa -w @aurum/server -- --username TU_NOMBRE</span></p>
          <Button className="mt-4" size="sm" variant="outline" onClick={() => setOff(true)}>Desactivar…</Button>
        </>
      ) : setup ? (
        <MfaSetup compact onDone={() => { setSetup(false); onChange(); }} />
      ) : (
        <>
          <p className="text-sm text-[#f1a3ad]">No está activada en tu cuenta.</p>
          <p className="mt-1 text-sm text-niebla">Con tu contraseña sola, quien la consiga controla el casino. Actívala: tarda un minuto.</p>
          <Button className="mt-4" onClick={() => setSetup(true)}><ShieldCheck className="h-4 w-4" /> Activar</Button>
        </>
      )}
      <Modal open={off} onClose={() => setOff(false)} title="Desactivar la verificación en dos pasos">
        <form className="space-y-4" onSubmit={async (e) => {
          e.preventDefault();
          if (await act(() => api.post('/api/admin/mfa/disable', { password, code }), notify, 'Verificación en dos pasos desactivada')) {
            setOff(false);
            setPassword('');
            setCode('');
            onChange();
          }
        }}>
          <p className="text-sm text-niebla">{mfa.required ? 'Es obligatoria: tendrás que volver a configurarla para seguir usando el panel.' : 'El panel quedará protegido solo por la contraseña.'} Se enviará un aviso al móvil.</p>
          <Field label="Contraseña" type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="current-password" />
          <Field label="Código actual o de recuperación" value={code} onChange={(e) => setCode(e.target.value)} autoComplete="one-time-code" />
          <div className="flex justify-end gap-2"><Button type="button" variant="outline" onClick={() => setOff(false)}>Cancelar</Button><Button type="submit" disabled={!password || code.length < 6}>Desactivar</Button></div>
        </form>
      </Modal>
    </Card>
  );
}

function AlertsCard() {
  const { notify } = useNotify();
  const st = useLoad<Alerts>('/api/admin/alerts');
  const [token, setToken] = useState('');
  const [chat, setChat] = useState<{ chatId: string; name: string } | null>(null);
  const [hb, setHb] = useState('');
  const [bigWin, setBigWin] = useState<string | null>(null);
  return (
    <Card title="Avisos al móvil">
      <Loadable state={st}>
        {(a) => (
          <div className="space-y-6">
            <div>
              <h3 className="mb-1 flex items-center gap-2 text-sm text-marfil"><BellRing className="h-4 w-4 text-oro" /> Telegram {a.telegram.configured ? <Badge tone="green">configurado</Badge> : <Badge tone="muted">sin configurar</Badge>}</h3>
              <p className="text-xs text-niebla">Te avisa de ataques, fallos, copias que no se hacen, premios grandes y entradas de administrador desde sitios nuevos.</p>
              {a.lastError && <p className="mt-1 text-xs text-[#f1a3ad]">{a.lastError}</p>}
              {a.telegram.configured ? (
                <div className="mt-3 flex flex-wrap gap-2">
                  <Button size="sm" onClick={() => void act(() => api.post('/api/admin/alerts/test'), notify, 'Mensaje de prueba enviado')}>Enviar prueba</Button>
                  <Button size="sm" variant="outline" onClick={async () => { if (await act(() => api.del('/api/admin/alerts/telegram'), notify, 'Telegram desconectado')) st.reload(); }}>Quitar</Button>
                </div>
              ) : (
                <ol className="mt-3 list-decimal space-y-2 pl-5 text-sm text-niebla">
                  <li>En Telegram, abre <a className="text-oro-claro hover:underline" href="https://t.me/BotFather" target="_blank" rel="noreferrer">@BotFather <ExternalLink className="inline h-3 w-3" /></a>, envía <span className="font-mono text-marfil">/newbot</span> y elige un nombre. Te dará un token.</li>
                  <li>
                    <Field label="Token del bot" value={token} onChange={(e) => { setToken(e.target.value.trim()); setChat(null); }} placeholder="123456789:AA…" autoComplete="off" />
                  </li>
                  <li>Abre tu bot (el enlace t.me/… que te dio BotFather), pulsa <strong className="text-marfil">Iniciar</strong> y luego:
                    <div className="mt-2 flex flex-wrap items-center gap-2">
                      <Button size="sm" variant="outline" disabled={token.length < 20} onClick={async () => setChat(await act(() => api.post<{ chatId: string; name: string }>('/api/admin/alerts/telegram/detect', { botToken: token }), notify))}>Buscar mi chat</Button>
                      {chat && <span className="text-xs text-exito">Encontrado: {chat.name}</span>}
                    </div>
                  </li>
                  <li>
                    <Button size="sm" disabled={!chat} onClick={async () => {
                      if (await act(() => api.put('/api/admin/alerts/telegram', { botToken: token, chatId: chat!.chatId }), notify, 'Telegram configurado')) {
                        setToken('');
                        st.reload();
                        void act(() => api.post('/api/admin/alerts/test'), notify);
                      }
                    }}>Guardar y enviar prueba</Button>
                  </li>
                </ol>
              )}
            </div>
            <div>
              <h3 className="mb-1 text-sm text-marfil">Aviso si el servidor se cae {a.heartbeat.configured ? <Badge tone="green">configurado</Badge> : <Badge tone="muted">sin configurar</Badge>}</h3>
              <p className="text-xs text-niebla">Un servidor caído no puede avisar de nada. Crea un «check» gratuito en <a className="text-oro-claro hover:underline" href="https://healthchecks.io" target="_blank" rel="noreferrer">healthchecks.io</a> (periodo 5 min, margen 5 min), conéctale tu Telegram en <em>Integrations</em> y pega aquí su URL de ping: si deja de recibir señal, te avisa.</p>
              <form className="mt-2 flex flex-wrap items-end gap-2" onSubmit={async (e) => { e.preventDefault(); if (await act(() => api.put('/api/admin/alerts/heartbeat', { url: hb.trim() }), notify, hb ? 'Latido guardado' : 'Latido quitado')) { setHb(''); st.reload(); } }}>
                <Field className="min-w-[240px] flex-1" label="URL de ping" value={hb} onChange={(e) => setHb(e.target.value)} placeholder={a.heartbeat.configured ? '(guardada; escribe otra para cambiarla o déjalo vacío y guarda para quitarla)' : 'https://hc-ping.com/…'} />
                <Button type="submit" size="sm" variant="outline">Guardar</Button>
              </form>
            </div>
            <div>
              <h3 className="mb-1 text-sm text-marfil">Premios grandes</h3>
              <form className="flex flex-wrap items-end gap-2" onSubmit={async (e) => { e.preventDefault(); if (await act(() => api.put('/api/admin/alerts/big-win', { amount: Number(bigWin ?? a.bigWin) }), notify, 'Umbral guardado')) st.reload(); }}>
                <Field className="w-56" label="Avisar si alguien gana de una vez (neto)" type="number" min={0} value={bigWin ?? String(a.bigWin)} onChange={(e) => setBigWin(e.target.value)} hint="0 = sin aviso" />
                <Button type="submit" size="sm" variant="outline">Guardar</Button>
              </form>
            </div>
            {a.recent.length > 0 && (
              <div>
                <h3 className="mb-2 text-sm text-marfil">Últimos avisos</h3>
                <ul className="max-h-48 space-y-1.5 overflow-y-auto text-xs">
                  {a.recent.map((r, i) => (
                    <li key={i} className="flex gap-2"><span className="shrink-0 text-niebla">{dateTime(r.at)}</span><span className={cx('text-marfil', !r.delivered && 'opacity-60')}>{r.text}{!r.delivered && ' (no enviado)'}</span></li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        )}
      </Loadable>
    </Card>
  );
}

function EventsCard() {
  const [sev, setSev] = useState<'all' | 'warn' | 'high'>('all');
  const [ip, setIp] = useState<string | null>(null);
  const [page, setPage] = useState(1);
  const q = new URLSearchParams({ page: String(page) });
  if (sev !== 'all') q.set('severity', sev);
  if (ip) q.set('ip', ip);
  const st = useLoad<{ items: SecEvent[] }>(`/api/admin/security/events?${q}`, 15_000);
  return (
    <Card title="Registro de eventos" action={
      <div className="flex flex-wrap items-center gap-2">
        {ip && <button type="button" className="rounded-full border border-linea px-2.5 py-1 text-xs text-marfil hover:border-oro" onClick={() => { setIp(null); setPage(1); }}>IP {ip} ✕</button>}
        <Segmented label="Gravedad" value={sev} onChange={(v) => { setSev(v); setPage(1); }} options={[{ value: 'all', label: 'Todos' }, { value: 'warn', label: 'Avisos' }, { value: 'high', label: 'Graves' }]} />
      </div>
    }>
      <Loadable state={st}>
        {(d) => d.items.length === 0 ? <p className="text-sm text-niebla">Sin eventos.</p> : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[640px] text-sm" data-testid="security-events">
              <thead><tr><th className={th}>Cuándo</th><th className={th}>Qué</th><th className={th}>IP</th><th className={th}>Detalle</th></tr></thead>
              <tbody>
                {d.items.map((e) => (
                  <tr key={e.id}>
                    <td className={`${td} whitespace-nowrap text-niebla`}>{dateTime(e.createdAt)}</td>
                    <td className={td}><Badge tone={SEV_TONE[e.severity]}>{SEV_LABEL[e.severity]}</Badge> <span className="text-marfil">{e.label}</span></td>
                    <td className={td}>{e.ip ? <button type="button" className="font-mono text-xs text-niebla hover:text-oro-claro" onClick={() => { setIp(e.ip); setPage(1); }}>{e.ip}</button> : '—'}</td>
                    <td className={`${td} max-w-[280px] truncate text-niebla`} title={e.detail ?? ''}>{[e.username, e.detail].filter(Boolean).join(' · ') || '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <div className="mt-3 flex justify-between">
              <Button size="sm" variant="outline" disabled={page === 1} onClick={() => setPage(page - 1)}>Más recientes</Button>
              <Button size="sm" variant="outline" disabled={d.items.length < 50} onClick={() => setPage(page + 1)}>Anteriores</Button>
            </div>
          </div>
        )}
      </Loadable>
    </Card>
  );
}

export default function SecurityPage({ mfa, onMfaChange }: { mfa: MfaStatus; onMfaChange: () => void }) {
  const { notify } = useNotify();
  const st = useLoad<Security>('/api/admin/security', 30_000);
  const [auditing, setAuditing] = useState(false);
  return (
    <div className="space-y-5">
      <PageTitle title="Seguridad" />
      <Loadable state={st}>
        {(s) => (
          <>
            <ChecksCard checks={s.checks} />
            <div className="grid items-start gap-5 xl:grid-cols-2">
              <MfaCard mfa={mfa} onChange={() => { onMfaChange(); st.reload(); }} />
              <AlertsCard />
            </div>
            <div className="grid gap-5 xl:grid-cols-3">
              <Card title="Últimas 24 horas">
                {s.counts.length === 0 ? <p className="text-sm text-niebla">Nada que destacar.</p> : (
                  <ul className="space-y-1.5 text-sm">{s.counts.sort((a, b) => b.n - a.n).map((c) => <li key={c.kind} className="flex justify-between gap-3"><span className="text-marfil">{c.label}</span><span className="text-niebla">{credits(c.n)}</span></li>)}</ul>
                )}
                {s.suppressed > 0 && <p className="mt-3 text-xs text-niebla">Además, {credits(s.suppressed)} eventos repetidos se contaron sin guardarse (para no llenar la base de datos durante un ataque).</p>}
              </Card>
              <Card title="IP con más incidencias (7 días)">
                {s.topIps.length === 0 ? <p className="text-sm text-niebla">Ninguna.</p> : (
                  <ul className="space-y-1.5 text-sm">{s.topIps.map((x) => <li key={x.ip} className="flex justify-between gap-3"><span className="font-mono text-xs text-marfil">{x.ip}</span><span className="text-niebla">{x.n} · {x.kind}</span></li>)}</ul>
                )}
                <p className="mt-3 text-xs text-niebla">Los límites ya frenan los ataques por fuerza bruta: 30 intentos por IP cada 15 min y bloqueo de la cuenta tras 5 fallos.</p>
              </Card>
              <Card title="Posibles multicuentas (7 días)">
                {s.multiAccounts.length === 0 ? <p className="text-sm text-niebla">Ninguna IP con 3 o más cuentas.</p> : (
                  <ul className="space-y-2 text-sm">{s.multiAccounts.map((m) => <li key={m.ip}><p className="flex justify-between gap-3"><span className="font-mono text-xs text-marfil">{m.ip}</span><span className="text-niebla">{m.accounts} cuentas</span></p><p className="truncate text-xs text-niebla">{m.names.join(', ')}</p></li>)}</ul>
                )}
              </Card>
            </div>
            <EventsCard />
            <div className="grid gap-5 xl:grid-cols-2">
              <Card title="Dependencias (npm audit)" action={
                <Button size="sm" variant="outline" loading={auditing || s.auditRunning} onClick={async () => { setAuditing(true); await act(() => api.post('/api/admin/security/audit'), notify, 'Análisis terminado'); setAuditing(false); st.reload(); }}><ScanSearch className="h-4 w-4" /> Analizar ahora</Button>
              }>
                {!s.audit ? <p className="text-sm text-niebla">{s.auditError ? `No se pudo analizar: ${s.auditError}` : 'Se analiza solo al arrancar y una vez al día.'}</p> : (
                  <>
                    <p className="text-sm text-niebla">{s.audit.dependencies} paquetes revisados {ago(s.audit.at)} contra la base de datos pública de vulnerabilidades.</p>
                    {s.audit.packages.length === 0 ? <p className="mt-2 flex items-center gap-2 text-sm text-exito"><StatusMark status="ok" /> Sin vulnerabilidades conocidas.</p> : (
                      <ul className="mt-3 space-y-2 text-sm">
                        {s.audit.packages.map((p) => (
                          <li key={p.name}>
                            <p><Badge tone={p.severity === 'critical' || p.severity === 'high' ? 'red' : p.severity === 'moderate' ? 'gold' : 'muted'}>{p.severity}</Badge> <span className="font-mono text-marfil">{p.name}</span>{p.direct ? '' : <span className="text-xs text-niebla"> (indirecta)</span>}{p.fix && <span className="text-xs text-exito"> · tiene arreglo</span>}</p>
                            {p.title && <p className="text-xs text-niebla">{p.title}</p>}
                          </li>
                        ))}
                      </ul>
                    )}
                  </>
                )}
              </Card>
              <Card title="Libro mayor" action={
                <Button size="sm" variant="outline" onClick={async () => { await act(() => api.post('/api/admin/security/ledger'), notify, 'Comprobación terminada'); st.reload(); }}><RefreshCw className="h-4 w-4" /> Comprobar ahora</Button>
              }>
                <p className="text-sm text-niebla">Comprueba que el saldo de cada jugador coincide con la suma de sus movimientos (detecta manipulaciones o errores). Se hace solo una vez al día.</p>
                {s.ledger && (
                  <p className={cx('mt-3 text-sm', s.ledger.problems.length ? 'text-[#f1a3ad]' : 'text-exito')}>
                    {s.ledger.checked} jugadores revisados {ago(s.ledger.at)}: {s.ledger.problems.length ? `${s.ledger.problems.length} con diferencias (${s.ledger.problems.map((p) => p.username).join(', ')})` : 'todo cuadra'}.
                  </p>
                )}
              </Card>
            </div>
          </>
        )}
      </Loadable>
    </div>
  );
}
