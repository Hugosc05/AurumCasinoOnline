import { Check, Search, UserMinus, UserPlus, X } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Button, EmptyState, Modal, Spinner } from '../components/ui';
import { ApiError, api } from '../lib/api';
import { cx } from '../lib/format';
import { useNotify } from '../state/notify';
import { useSession } from '../state/session';
import { PRESENCE_DOT, presenceText, useFriends, type Person } from '../social/useSocial';

interface SearchHit extends Person {
  relation: 'none' | 'friend' | 'outgoing' | 'incoming';
  requestId: string | null;
}

/** Sección social: buscar personas, solicitudes y lista de amigos con presencia real. */
export default function FriendsPage() {
  const { prefs, updatePrefs } = useSession();
  const { notify } = useNotify();
  const { data, reload } = useFriends();
  const [q, setQ] = useState('');
  const [hits, setHits] = useState<SearchHit[] | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [removing, setRemoving] = useState<Person | null>(null);

  useEffect(() => {
    if (q.trim().length < 2) {
      setHits(null);
      return;
    }
    const t = window.setTimeout(() => {
      api.get<{ items: SearchHit[] }>(`/api/social/friends/search?q=${encodeURIComponent(q.trim())}`).then((r) => setHits(r.items)).catch(() => setHits([]));
    }, 250);
    return () => clearTimeout(t);
  }, [q, data]);

  const act = async (key: string, fn: () => Promise<unknown>, ok?: string): Promise<void> => {
    setBusy(key);
    try {
      await fn();
      if (ok) notify('success', ok);
      reload();
    } catch (err) {
      notify('error', err instanceof ApiError ? err.message : 'No se pudo completar.');
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="mx-auto max-w-5xl px-4 py-10 sm:px-6">
      <h1 className="text-4xl text-marfil sm:text-5xl">Amigos</h1>
      <p className="mt-2 max-w-2xl text-niebla">Encuentra a otras personas por su nombre de usuario e invítalas a tus salas privadas. Nadie ve tu correo ni tu saldo.</p>

      <div className="mt-8 grid gap-6 lg:grid-cols-[1fr_320px]">
        <div className="space-y-6">
          <section className="panel p-5" aria-label="Buscar personas">
            <label className="relative block">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-niebla" />
              <input
                value={q}
                onChange={(e) => setQ(e.target.value)}
                placeholder="Buscar por nombre de usuario"
                className="w-full rounded-full border border-linea bg-noche py-2.5 pl-9 pr-4 text-marfil placeholder:text-niebla focus:border-oro/60 focus:outline-none"
                aria-label="Buscar por nombre de usuario"
                data-testid="friend-search"
              />
            </label>
            {hits && (
              <ul className="mt-3 divide-y divide-linea/50" data-testid="search-results">
                {hits.length === 0 && <li className="py-3 text-sm text-niebla">No hay nadie con ese nombre. Los bots no aparecen: no son personas.</li>}
                {hits.map((h) => (
                  <li key={h.id} className="flex items-center gap-3 py-2">
                    <span className="grid h-9 w-9 place-items-center rounded-full bg-marino font-display text-marfil">{h.username[0]!.toUpperCase()}</span>
                    <span className="flex-1 text-marfil">{h.username}</span>
                    {h.relation === 'none' && <Button size="sm" loading={busy === h.id} onClick={() => void act(h.id, () => api.post('/api/social/friends/requests', { username: h.username }), `Solicitud enviada a ${h.username}.`)}><UserPlus className="h-4 w-4" /> Añadir</Button>}
                    {h.relation === 'outgoing' && <span className="text-xs text-niebla">Solicitud enviada</span>}
                    {h.relation === 'incoming' && h.requestId && <Button size="sm" onClick={() => void act(h.id, () => api.post(`/api/social/friends/requests/${h.requestId}/accept`), `Ahora eres amigo de ${h.username}.`)}><Check className="h-4 w-4" /> Aceptar</Button>}
                    {h.relation === 'friend' && <span className="text-xs text-exito">Amigos</span>}
                  </li>
                ))}
              </ul>
            )}
          </section>

          <section className="panel p-5" aria-label="Lista de amigos">
            <h2 className="mb-3 text-xl text-marfil">Tus amigos</h2>
            {!data ? <Spinner /> : data.friends.length === 0 ? (
              <EmptyState title="Todavía no tienes amigos añadidos">Busca a alguien por su nombre de usuario para enviarle una solicitud.</EmptyState>
            ) : (
              <ul className="divide-y divide-linea/50" data-testid="friend-list">
                {data.friends.map((f) => (
                  <li key={f.id} className="flex items-center gap-3 py-2.5">
                    <span className="relative grid h-10 w-10 place-items-center rounded-full bg-marino font-display text-marfil">
                      {f.username[0]!.toUpperCase()}
                      <span className={cx('absolute -bottom-0.5 -right-0.5 h-3 w-3 rounded-full border-2 border-abismo', PRESENCE_DOT[f.presence.status])} aria-hidden />
                    </span>
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-marfil">{f.username}</p>
                      <p className="text-xs text-niebla" data-testid="presence">{presenceText(f.presence)}</p>
                    </div>
                    <Link to={`/salas?invitar=${encodeURIComponent(f.username)}`} className="text-sm text-oro-claro hover:underline">Invitar a una sala</Link>
                    <Button size="sm" variant="ghost" aria-label={`Eliminar a ${f.username}`} onClick={() => setRemoving(f)}><UserMinus className="h-4 w-4" /></Button>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </div>

        <aside className="space-y-6">
          <section className="panel p-5" aria-label="Solicitudes recibidas">
            <h2 className="mb-3 text-lg text-marfil">Solicitudes recibidas</h2>
            {!data || data.incoming.length === 0 ? <p className="text-sm text-niebla">No tienes solicitudes pendientes.</p> : (
              <ul className="space-y-2" data-testid="incoming">
                {data.incoming.map((r) => (
                  <li key={r.requestId} className="flex items-center gap-2">
                    <span className="flex-1 truncate text-marfil">{r.from.username}</span>
                    <Button size="sm" aria-label={`Aceptar a ${r.from.username}`} loading={busy === r.requestId} onClick={() => void act(r.requestId, () => api.post(`/api/social/friends/requests/${r.requestId}/accept`), `Ahora eres amigo de ${r.from.username}.`)}><Check className="h-4 w-4" /></Button>
                    <Button size="sm" variant="ghost" aria-label={`Rechazar a ${r.from.username}`} onClick={() => void act(r.requestId, () => api.post(`/api/social/friends/requests/${r.requestId}/reject`))}><X className="h-4 w-4" /></Button>
                  </li>
                ))}
              </ul>
            )}
          </section>
          <section className="panel p-5" aria-label="Solicitudes enviadas">
            <h2 className="mb-3 text-lg text-marfil">Solicitudes enviadas</h2>
            {!data || data.outgoing.length === 0 ? <p className="text-sm text-niebla">No tienes solicitudes enviadas pendientes.</p> : (
              <ul className="space-y-2" data-testid="outgoing">
                {data.outgoing.map((r) => (
                  <li key={r.requestId} className="flex items-center gap-2">
                    <span className="flex-1 truncate text-marfil">{r.to.username}</span>
                    <Button size="sm" variant="ghost" onClick={() => void act(r.requestId, () => api.del(`/api/social/friends/requests/${r.requestId}`), 'Solicitud cancelada.')}>Cancelar</Button>
                  </li>
                ))}
              </ul>
            )}
          </section>
          <section className="panel p-5" aria-label="Privacidad">
            <h2 className="mb-2 text-lg text-marfil">Privacidad</h2>
            <label className="flex items-start gap-3 text-sm text-niebla">
              <input type="checkbox" className="mt-0.5 h-4 w-4 accent-[#cfae6b]" checked={prefs.invisible} onChange={(e) => void updatePrefs({ invisible: e.target.checked })} data-testid="invisible-toggle" />
              <span><span className="text-marfil">Modo invisible.</span> Tus amigos te verán siempre como desconectado y no sabrán si estás jugando.</span>
            </label>
          </section>
        </aside>
      </div>

      <Modal open={!!removing} onClose={() => setRemoving(null)} title="Eliminar amigo">
        <p className="text-niebla">¿Eliminar a {removing?.username} de tus amigos? No se le avisará.</p>
        <div className="mt-4 flex justify-end gap-2">
          <Button variant="ghost" onClick={() => setRemoving(null)}>Cancelar</Button>
          <Button variant="danger" onClick={() => { const p = removing!; setRemoving(null); void act(p.id, () => api.del(`/api/social/friends/${p.id}`), `${p.username} ya no está en tus amigos.`); }}>Eliminar</Button>
        </div>
      </Modal>
    </div>
  );
}
