import { Copy, ExternalLink, Link2, RefreshCw, Unplug } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Badge, Button, Field, Segmented } from '../components/ui';
import { api } from '../lib/api';
import { credits } from '../lib/format';
import { useNotify } from '../state/notify';
import { Card, Loadable, MiniChart, PageTitle, Stat, act, ago, euros, shortDay, td, th, useLoad } from './shared';

interface Revenue {
  adsense: { configured: boolean; connected: boolean; clientId: string | null; clientSecret: string | null; account: string | null; accountName: string | null; lastError: string | null; redirectUri: string };
  display: { enabled: boolean; publisherId: string; slots: { home: string; lobby: string; rewards: string } };
  report: null | {
    currency: string;
    days: { date: string; earnings: number; pageViews: number; impressions: number; clicks: number; rpm: number }[];
    totals: { today: number; yesterday: number; last7: number; last30: number; thisMonth: number };
    fetchedAt: string;
  };
  error: string | null;
}

function Copyable({ text }: { text: string }) {
  return (
    <span className="inline-flex max-w-full items-center gap-1.5 rounded-md bg-noche px-2 py-1 font-mono text-xs text-marfil">
      <span className="truncate">{text}</span>
      <button type="button" onClick={() => void navigator.clipboard?.writeText(text)} className="shrink-0 text-niebla hover:text-marfil" aria-label="Copiar"><Copy className="h-3.5 w-3.5" /></button>
    </span>
  );
}

function ConnectCard({ r, reload }: { r: Revenue; reload: () => void }) {
  const { notify } = useNotify();
  const [clientId, setClientId] = useState(r.adsense.clientId ?? '');
  const [clientSecret, setClientSecret] = useState('');
  return (
    <Card title="Conectar AdSense">
      <ol className="list-decimal space-y-2 pl-5 text-sm text-niebla">
        <li>Entra en <a className="text-oro-claro hover:underline" href="https://console.cloud.google.com/projectcreate" target="_blank" rel="noreferrer">Google Cloud <ExternalLink className="inline h-3 w-3" /></a> con la misma cuenta de Google que AdSense y crea un proyecto (gratis, sin tarjeta).</li>
        <li>En <a className="text-oro-claro hover:underline" href="https://console.cloud.google.com/apis/library/adsense.googleapis.com" target="_blank" rel="noreferrer">la biblioteca de APIs <ExternalLink className="inline h-3 w-3" /></a>, activa <strong className="text-marfil">AdSense Management API</strong>.</li>
        <li>En <em>Google Auth Platform → Branding</em> rellena el nombre de la app y tu correo; en <em>Audience</em> elige <strong className="text-marfil">External</strong> y pulsa <strong className="text-marfil">Publish app</strong> (si se queda en «Testing», el permiso caduca a los 7 días).</li>
        <li>En <em>Clients → Create client</em>: tipo <strong className="text-marfil">Web application</strong> y, en <em>Authorized redirect URIs</em>, pega exactamente: <Copyable text={r.adsense.redirectUri} /></li>
        <li>Copia aquí el ID y el secreto del cliente, guarda y pulsa <strong className="text-marfil">Conectar</strong>. Google avisará de que la app no está verificada: es la tuya, pulsa «Avanzado → Ir a…».</li>
      </ol>
      <form className="mt-5 grid gap-3 sm:grid-cols-2" onSubmit={async (e) => {
        e.preventDefault();
        if (await act(() => api.put('/api/admin/revenue/client', { clientId: clientId.trim(), clientSecret: clientSecret.trim() }), notify, 'Cliente guardado')) {
          setClientSecret('');
          reload();
        }
      }}>
        <Field label="ID de cliente" value={clientId} onChange={(e) => setClientId(e.target.value)} placeholder="1234-abcd.apps.googleusercontent.com" />
        <Field label="Secreto de cliente" type="password" value={clientSecret} onChange={(e) => setClientSecret(e.target.value)} placeholder={r.adsense.clientSecret ?? 'GOCSPX-…'} autoComplete="off" />
        <div className="flex flex-wrap gap-2 sm:col-span-2">
          <Button type="submit" variant="outline" disabled={!clientId}>Guardar</Button>
          <Button type="button" disabled={!r.adsense.configured} onClick={async () => {
            const res = await act(() => api.post<{ url: string }>('/api/admin/revenue/connect'), notify);
            if (res) window.location.href = res.url;
          }}><Link2 className="h-4 w-4" /> Conectar con Google</Button>
        </div>
      </form>
      {r.adsense.lastError && <p className="mt-3 text-sm text-[#f1a3ad]">{r.adsense.lastError}</p>}
    </Card>
  );
}

function DisplayCard({ r, reload }: { r: Revenue; reload: () => void }) {
  const { notify } = useNotify();
  const [f, setF] = useState(r.display);
  const host = typeof window !== 'undefined' ? window.location.hostname : '';
  const sharedDomain = /\.(ts\.net|onrender\.com|vercel\.app|netlify\.app|trycloudflare\.com)$/.test(host);
  return (
    <Card title="Anuncios en la web">
      {sharedDomain && (
        <p className="mb-4 rounded-xl border border-oro/40 bg-oro/5 p-3 text-sm text-marfil">
          Esta web está en <span className="font-mono">{host}</span>, un dominio compartido. AdSense solo aprueba sitios con <strong>dominio propio</strong> (≈10 €/año); cuando lo tengas, añádelo en AdSense y rellena esto.
        </p>
      )}
      <form className="grid gap-3 sm:grid-cols-2" onSubmit={async (e) => {
        e.preventDefault();
        if (await act(() => api.put('/api/admin/revenue/display', f), notify, 'Anuncios guardados')) reload();
      }}>
        <div className="sm:col-span-2">
          <Segmented label="Estado de los anuncios" value={f.enabled ? 'on' : 'off'} onChange={(v) => setF({ ...f, enabled: v === 'on' })} options={[{ value: 'off', label: 'Desactivados' }, { value: 'on', label: 'Activados' }]} />
        </div>
        <Field className="sm:col-span-2" label="ID de editor de AdSense" value={f.publisherId} onChange={(e) => setF({ ...f, publisherId: e.target.value.trim() })} placeholder="ca-pub-1234567890123456" hint="AdSense → Cuenta → Información de la cuenta." />
        <Field label="Bloque: portada" value={f.slots.home} onChange={(e) => setF({ ...f, slots: { ...f.slots, home: e.target.value.trim() } })} inputMode="numeric" placeholder="1234567890" />
        <Field label="Bloque: vestíbulos de juegos" value={f.slots.lobby} onChange={(e) => setF({ ...f, slots: { ...f.slots, lobby: e.target.value.trim() } })} inputMode="numeric" />
        <Field label="Bloque: recompensas" value={f.slots.rewards} onChange={(e) => setF({ ...f, slots: { ...f.slots, rewards: e.target.value.trim() } })} inputMode="numeric" />
        <div className="flex items-end"><Button type="submit">Guardar</Button></div>
      </form>
      <ul className="mt-4 space-y-1 text-xs text-niebla">
        <li>Los anuncios solo aparecen en la portada, los vestíbulos y recompensas, nunca dentro de una mesa o partida (AdSense penaliza los clics accidentales).</li>
        <li>Con el ID de editor, la web publica sola <a className="text-oro-claro hover:underline" href="/ads.txt" target="_blank" rel="noreferrer">/ads.txt</a>, que AdSense exige para pagar.</li>
        <li>En la UE hace falta el aviso de cookies: actívalo gratis en AdSense → <em>Privacidad y mensajes → RGPD</em>.</li>
      </ul>
    </Card>
  );
}

export default function RevenuePage() {
  const { notify } = useNotify();
  const [params, setParams] = useSearchParams();
  const st = useLoad<Revenue>('/api/admin/revenue');
  const [metric, setMetric] = useState<'earnings' | 'pageViews' | 'rpm'>('earnings');
  useEffect(() => {
    const s = params.get('adsense');
    if (!s) return;
    if (s === 'ok') notify('success', 'AdSense conectado');
    else if (s === 'denied') notify('error', 'Has cancelado el permiso en Google');
    else notify('error', 'No se pudo conectar AdSense. Revisa el ID, el secreto y la dirección de vuelta.');
    setParams({}, { replace: true });
  }, [params, setParams, notify]);
  return (
    <div className="space-y-5">
      <PageTitle title="Ingresos">
        {st.data?.adsense.connected && (
          <Button size="sm" variant="outline" onClick={async () => { await act(() => api.get('/api/admin/revenue?refresh=1'), notify); st.reload(); }}><RefreshCw className="h-4 w-4" /> Actualizar</Button>
        )}
      </PageTitle>
      <Loadable state={st}>
        {(r) => (
          <>
            {r.adsense.connected && (
              <>
                <div className="flex flex-wrap items-center gap-2 text-sm text-niebla">
                  <Badge tone="green">Conectado</Badge>
                  <span>{r.adsense.accountName ?? r.adsense.account}</span>
                  {r.report && <span>· datos {ago(r.report.fetchedAt)} (AdSense actualiza con unas horas de retraso)</span>}
                </div>
                {r.error && <p className="rounded-xl border border-rubi/50 bg-rubi/10 p-3 text-sm text-[#f1a3ad]">{r.error}</p>}
                {r.report && (
                  <>
                    <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
                      <Stat label="Hoy (estimado)" value={euros(r.report.totals.today)} sub={`Ayer: ${euros(r.report.totals.yesterday)}`} />
                      <Stat label="Últimos 7 días" value={euros(r.report.totals.last7)} />
                      <Stat label="Este mes" value={euros(r.report.totals.thisMonth)} sub="AdSense paga a partir de 70 €" />
                      <Stat label="Últimos 30 días" value={euros(r.report.totals.last30)} sub={`${credits(r.report.days.reduce((s, d) => s + d.pageViews, 0))} páginas vistas`} />
                    </div>
                    <Card title="Por día" action={<Segmented label="Dato" value={metric} onChange={setMetric} options={[{ value: 'earnings', label: 'Ingresos' }, { value: 'pageViews', label: 'Páginas vistas' }, { value: 'rpm', label: 'RPM' }]} />}>
                      <MiniChart
                        name={metric === 'earnings' ? 'Ingresos' : metric === 'pageViews' ? 'Páginas vistas' : 'RPM'}
                        kind={metric === 'pageViews' ? 'line' : 'bar'}
                        data={r.report.days.map((d) => ({ label: shortDay(d.date), value: d[metric] }))}
                        format={metric === 'pageViews' ? credits : euros}
                        height={180}
                      />
                      <p className="mt-2 text-xs text-niebla">RPM = ingresos por cada 1.000 páginas vistas.</p>
                    </Card>
                    <Card title="Detalle">
                      <div className="max-h-80 overflow-auto">
                        <table className="w-full min-w-[520px] text-sm">
                          <thead><tr><th className={th}>Día</th><th className={th}>Ingresos</th><th className={th}>Páginas</th><th className={th}>Impresiones</th><th className={th}>Clics</th><th className={th}>RPM</th></tr></thead>
                          <tbody>
                            {[...r.report.days].reverse().map((d) => (
                              <tr key={d.date}><td className={td}>{d.date}</td><td className={td}>{euros(d.earnings)}</td><td className={td}>{credits(d.pageViews)}</td><td className={td}>{credits(d.impressions)}</td><td className={td}>{d.clicks}</td><td className={td}>{euros(d.rpm)}</td></tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    </Card>
                  </>
                )}
                <div>
                  <Button size="sm" variant="outline" onClick={async () => { if (await act(() => api.del('/api/admin/revenue/connection'), notify, 'AdSense desconectado')) st.reload(); }}><Unplug className="h-4 w-4" /> Desconectar AdSense</Button>
                </div>
              </>
            )}
            {!r.adsense.connected && <ConnectCard r={r} reload={st.reload} />}
            <DisplayCard r={r} reload={st.reload} />
          </>
        )}
      </Loadable>
    </div>
  );
}
