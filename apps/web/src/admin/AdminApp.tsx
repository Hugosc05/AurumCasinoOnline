import { Activity, ArrowLeft, Bot, Gauge, LayoutDashboard, ScrollText, Settings, Table2, Users } from 'lucide-react';
import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { Link, NavLink, Route, Routes, useParams } from 'react-router-dom';
import { Logo } from '../components/Layout';
import { Badge, Button, EmptyState, ErrorBox, Field, Modal, Spinner } from '../components/ui';
import { ApiError, api } from '../lib/api';
import { GAME_NAMES, credits, cx, dateTime, signed } from '../lib/format';
import { useNotify } from '../state/notify';

function useLoad<T>(url: string): { data: T | null; error: string | null; reload: () => void } {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const reload = useCallback(() => {
    setError(null);
    api.get<T>(url).then(setData).catch((e: ApiError) => setError(e.message));
  }, [url]);
  useEffect(reload, [reload]);
  return { data, error, reload };
}

function Loadable<T>({ state, children }: { state: { data: T | null; error: string | null; reload: () => void }; children: (d: T) => ReactNode }) {
  if (state.error) return <ErrorBox message={state.error} onRetry={state.reload} />;
  if (!state.data) return <Spinner />;
  return <>{children(state.data)}</>;
}

function Card({ title, children, action }: { title: string; children: ReactNode; action?: ReactNode }) {
  return (
    <section className="rounded-2xl border border-linea bg-abismo p-5">
      <div className="mb-4 flex items-center justify-between gap-3">
        <h2 className="font-display text-xl text-marfil">{title}</h2>
        {action}
      </div>
      {children}
    </section>
  );
}

const th = 'pb-2 text-left font-normal text-niebla';
const td = 'border-t border-linea/50 py-2 pr-3';

/* --------------------------------- Resumen --------------------------------- */
interface Overview {
  users: Record<string, number>;
  games: { game: string; rounds: number; totalBet: number; totalPayout: number; rounds24h: number }[];
  daily: { day: string; rounds: number; bet: number; payout: number }[];
  openRounds: number;
  errors24h: number;
  circulating: number;
  online: number;
  connections: number;
  tables: { id: string; name: string; humans: number; bots: number; handInProgress: boolean; handsPlayed: number }[];
}

function Dashboard() {
  const st = useLoad<Overview>('/api/admin/overview');
  return (
    <Loadable state={st}>
      {(o) => {
        const maxRounds = Math.max(1, ...o.daily.map((d) => d.rounds));
        return (
          <div className="space-y-5">
            <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
              {[
                ['Usuarios', credits(o.users.total ?? 0), `${o.users.new24h ?? 0} nuevos en 24 h`],
                ['Conectados', String(o.online), `${o.connections} conexiones WebSocket`],
                ['Créditos en circulación', credits(o.circulating), 'Suma de saldos de jugadores'],
                ['Errores en 24 h', String(o.errors24h), `${o.openRounds} rondas abiertas`],
              ].map(([k, v, sub]) => (
                <div key={k} className="rounded-2xl border border-linea bg-abismo p-5">
                  <p className="text-sm text-niebla">{k}</p>
                  <p className="font-display text-3xl text-marfil">{v}</p>
                  <p className="text-xs text-niebla">{sub}</p>
                </div>
              ))}
            </div>
            <div className="grid gap-5 xl:grid-cols-[1.4fr_1fr]">
              <Card title="Partidas por día (14 días)">
                {o.daily.length === 0 ? <p className="text-sm text-niebla">Sin partidas aún.</p> : (
                  <div className="flex h-44 items-end gap-1.5" role="img" aria-label="Gráfico de partidas por día">
                    {o.daily.map((d) => (
                      <div key={d.day} className="group relative flex h-full flex-1 flex-col items-center justify-end">
                        <div className="w-full rounded-t bg-oro/70 transition-colors group-hover:bg-oro-claro" style={{ height: `${(d.rounds / maxRounds) * 100}%` }} />
                        <span className="mt-1 text-[10px] text-niebla">{d.day.slice(8)}</span>
                        <span className="pointer-events-none absolute -top-8 hidden whitespace-nowrap rounded bg-black/80 px-2 py-1 text-xs text-marfil group-hover:block">{d.rounds} partidas, neto casa {signed(d.bet - d.payout)}</span>
                      </div>
                    ))}
                  </div>
                )}
              </Card>
              <Card title="Juegos">
                <table className="w-full text-sm">
                  <thead><tr><th className={th}>Juego</th><th className={th}>Partidas</th><th className={th}>Retorno</th></tr></thead>
                  <tbody>
                    {o.games.map((g) => (
                      <tr key={g.game}>
                        <td className={td}>{GAME_NAMES[g.game]}</td>
                        <td className={td}>{credits(g.rounds)} <span className="text-xs text-niebla">({g.rounds24h} hoy)</span></td>
                        <td className={td}>{g.totalBet ? `${((g.totalPayout / g.totalBet) * 100).toFixed(1)} %` : '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                <p className="mt-3 text-xs text-niebla">Retorno observado = premios / apuestas. En muestras pequeñas difiere mucho del teórico.</p>
              </Card>
            </div>
            <Card title="Mesas de póker">
              <div className="grid gap-3 sm:grid-cols-3">
                {o.tables.map((t) => (
                  <div key={t.id} className="rounded-xl border border-linea p-3 text-sm">
                    <p className="text-marfil">{t.name}</p>
                    <p className="text-niebla">{t.humans} humanos, {t.bots} bots, {t.handsPlayed} manos</p>
                    <p className={t.handInProgress ? 'text-exito' : 'text-niebla'}>{t.handInProgress ? 'En juego' : 'En reposo'}</p>
                  </div>
                ))}
              </div>
            </Card>
          </div>
        );
      }}
    </Loadable>
  );
}

/* --------------------------------- Usuarios -------------------------------- */
interface UserRow {
  id: string;
  username: string;
  email: string;
  role: string;
  status: string;
  balance: number;
  createdAt: string;
  rounds: number;
  net: number;
}

function UsersPage() {
  const [q, setQ] = useState('');
  const [query, setQuery] = useState('');
  const st = useLoad<{ items: UserRow[]; total: number }>(`/api/admin/users?q=${encodeURIComponent(query)}&pageSize=50`);
  return (
    <Card title="Usuarios" action={
      <form onSubmit={(e) => { e.preventDefault(); setQuery(q); }} className="flex gap-2">
        <input className="input h-9 py-1 text-sm" placeholder="Buscar nombre o correo" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Buscar usuarios" />
        <Button size="sm" type="submit">Buscar</Button>
      </form>
    }>
      <Loadable state={st}>
        {(d) => d.items.length === 0 ? <EmptyState title="Sin resultados" /> : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[720px] text-sm">
              <thead><tr><th className={th}>Usuario</th><th className={th}>Rol</th><th className={th}>Estado</th><th className={th}>Saldo</th><th className={th}>Partidas</th><th className={th}>Neto</th><th className={th}>Alta</th></tr></thead>
              <tbody>
                {d.items.map((u) => (
                  <tr key={u.id}>
                    <td className={td}><Link className="text-oro-claro hover:underline" to={`/admin/usuarios/${u.id}`}>{u.username}</Link><p className="text-xs text-niebla">{u.email}</p></td>
                    <td className={td}>{u.role === 'admin' ? <Badge>admin</Badge> : 'jugador'}</td>
                    <td className={td}>{u.status === 'active' ? <Badge tone="green">activo</Badge> : <Badge tone="red">suspendido</Badge>}</td>
                    <td className={td}>{u.role === 'admin' ? '∞' : credits(u.balance)}</td>
                    <td className={td}>{u.rounds}</td>
                    <td className={cx(td, u.net >= 0 ? 'text-exito' : 'text-[#f1a3ad]')}>{signed(u.net)}</td>
                    <td className={cx(td, 'text-niebla')}>{dateTime(u.createdAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <p className="mt-3 text-xs text-niebla">{d.total} usuarios en total.</p>
          </div>
        )}
      </Loadable>
    </Card>
  );
}

function UserDetail() {
  const { id = '' } = useParams();
  const { notify } = useNotify();
  const st = useLoad<{ user: Record<string, string | number>; stats: Record<string, number> | null; transactions: { id: number; amount: number; balanceBefore: number; balanceAfter: number; reason: string; createdAt: string; meta: string | null }[]; rounds: { id: string; game: string; status: string; bet: number; payout: number; createdAt: string }[]; ledger: { ok: boolean } }>(`/api/admin/users/${id}`);
  const [adjust, setAdjust] = useState(false);
  const [amount, setAmount] = useState('');
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const submit = async (): Promise<void> => {
    setBusy(true);
    try {
      await api.post(`/api/admin/users/${id}/adjust`, { amount: Number(amount), reason });
      notify('success', 'Saldo ajustado y registrado en auditoría.');
      setAdjust(false);
      setAmount('');
      setReason('');
      st.reload();
    } catch (e) {
      notify('error', (e as ApiError).message);
    } finally {
      setBusy(false);
    }
  };
  const setStatus = async (status: string): Promise<void> => {
    try {
      await api.patch(`/api/admin/users/${id}`, { status });
      notify('success', status === 'banned' ? 'Cuenta suspendida y sesiones cerradas.' : 'Cuenta reactivada.');
      st.reload();
    } catch (e) {
      notify('error', (e as ApiError).message);
    }
  };
  return (
    <Loadable state={st}>
      {(d) => (
        <div className="space-y-5">
          <Link to="/admin/usuarios" className="inline-flex items-center gap-1.5 text-sm text-niebla hover:text-marfil"><ArrowLeft className="h-4 w-4" /> Usuarios</Link>
          <Card title={String(d.user.username)} action={
            <div className="flex gap-2">
              {d.user.role !== 'admin' && <Button size="sm" variant="outline" onClick={() => setAdjust(true)}>Ajustar saldo</Button>}
              {d.user.role !== 'admin' && (d.user.status === 'active' ? <Button size="sm" variant="danger" onClick={() => void setStatus('banned')}>Suspender</Button> : <Button size="sm" onClick={() => void setStatus('active')}>Reactivar</Button>)}
            </div>
          }>
            <div className="grid gap-4 text-sm sm:grid-cols-4">
              <div><p className="text-niebla">Correo</p><p className="text-marfil">{d.user.email}</p></div>
              <div><p className="text-niebla">Saldo</p><p className="font-display text-2xl text-marfil">{d.user.role === 'admin' ? '∞' : credits(Number(d.user.balance))}</p></div>
              <div><p className="text-niebla">Partidas</p><p className="text-marfil">{d.stats?.rounds ?? 0}</p></div>
              <div><p className="text-niebla">Libro mayor</p>{d.ledger.ok || d.user.role === 'admin' ? <Badge tone="green">cuadra</Badge> : <Badge tone="red">descuadre</Badge>}</div>
            </div>
          </Card>
          <div className="grid gap-5 xl:grid-cols-2">
            <Card title="Movimientos recientes">
              <div className="max-h-96 overflow-y-auto">
                <table className="w-full text-sm">
                  <thead><tr><th className={th}>Fecha</th><th className={th}>Motivo</th><th className={th}>Importe</th><th className={th}>Antes → después</th></tr></thead>
                  <tbody>
                    {d.transactions.map((t) => (
                      <tr key={t.id}>
                        <td className={cx(td, 'text-niebla')}>{dateTime(t.createdAt)}</td>
                        <td className={td}>{t.reason}{t.meta && t.reason === 'admin_adjustment' ? <p className="text-xs text-niebla">{(JSON.parse(t.meta) as { reason?: string }).reason}</p> : null}</td>
                        <td className={cx(td, t.amount >= 0 ? 'text-exito' : 'text-[#f1a3ad]')}>{signed(t.amount)}</td>
                        <td className={cx(td, 'text-niebla')}>{credits(t.balanceBefore)} → {credits(t.balanceAfter)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </Card>
            <Card title="Partidas recientes">
              <div className="max-h-96 overflow-y-auto">
                <table className="w-full text-sm">
                  <thead><tr><th className={th}>Fecha</th><th className={th}>Juego</th><th className={th}>Estado</th><th className={th}>Apuesta</th><th className={th}>Premio</th></tr></thead>
                  <tbody>
                    {d.rounds.map((r) => (
                      <tr key={r.id}>
                        <td className={cx(td, 'text-niebla')}>{dateTime(r.createdAt)}</td>
                        <td className={td}>{GAME_NAMES[r.game]}</td>
                        <td className={td}>{r.status}</td>
                        <td className={td}>{credits(r.bet)}</td>
                        <td className={td}>{credits(r.payout)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </Card>
          </div>
          <Modal open={adjust} onClose={() => setAdjust(false)} title="Ajustar saldo">
            <div className="space-y-4">
              <Field label="Importe (negativo para restar)" type="number" value={amount} onChange={(e) => setAmount(e.target.value)} />
              <Field label="Motivo (queda registrado)" value={reason} onChange={(e) => setReason(e.target.value)} />
              <div className="flex justify-end gap-2">
                <Button variant="ghost" onClick={() => setAdjust(false)}>Cancelar</Button>
                <Button onClick={() => void submit()} loading={busy} disabled={!amount || Number(amount) === 0 || reason.trim().length < 3}>Aplicar ajuste</Button>
              </div>
            </div>
          </Modal>
        </div>
      )}
    </Loadable>
  );
}

/* --------------------------------- Partidas -------------------------------- */
function RoundsPage() {
  const [game, setGame] = useState('');
  const st = useLoad<{ items: { id: string; game: string; status: string; bet: number; payout: number; createdAt: string; username: string; userId: string }[]; total: number }>(`/api/admin/rounds?pageSize=100${game ? `&game=${game}` : ''}`);
  return (
    <Card title="Partidas" action={
      <select className="input h-9 w-40 py-1 text-sm" value={game} onChange={(e) => setGame(e.target.value)} aria-label="Filtrar juego">
        <option value="">Todos los juegos</option>
        {Object.entries(GAME_NAMES).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
      </select>
    }>
      <Loadable state={st}>
        {(d) => (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[640px] text-sm">
              <thead><tr><th className={th}>Fecha</th><th className={th}>Usuario</th><th className={th}>Juego</th><th className={th}>Estado</th><th className={th}>Apuesta</th><th className={th}>Premio</th></tr></thead>
              <tbody>
                {d.items.map((r) => (
                  <tr key={r.id}>
                    <td className={cx(td, 'text-niebla')}>{dateTime(r.createdAt)}</td>
                    <td className={td}><Link className="text-oro-claro hover:underline" to={`/admin/usuarios/${r.userId}`}>{r.username}</Link></td>
                    <td className={td}>{GAME_NAMES[r.game]}</td>
                    <td className={td}>{r.status === 'open' ? <Badge tone="gold">abierta</Badge> : r.status}</td>
                    <td className={td}>{credits(r.bet)}</td>
                    <td className={td}>{credits(r.payout)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <p className="mt-3 text-xs text-niebla">{d.total} partidas registradas.</p>
          </div>
        )}
      </Loadable>
    </Card>
  );
}

/* ----------------------------------- Bots ---------------------------------- */
function BotsPage() {
  const { notify } = useNotify();
  const st = useLoad<{ items: { id: string; name: string; profile: string; difficulty: string; enabled: number; bankroll: number; handsPlayed: number; netResult: number; bjRounds: number; bjNet: number; bjStrategy: string; seatedAt: string | null }[] }>('/api/admin/bots');
  const patch = async (id: string, body: Record<string, unknown>): Promise<void> => {
    try {
      await api.patch(`/api/admin/bots/${id}`, body);
      st.reload();
    } catch (e) {
      notify('error', (e as ApiError).message);
    }
  };
  return (
    <Card title="Bots de demostración">
      <p className="mb-4 text-sm text-niebla">Los cambios de perfil o dificultad se aplican cuando el bot vuelve a sentarse. Un bot desactivado termina su mano y no vuelve a entrar.</p>
      <Loadable state={st}>
        {(d) => (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[900px] text-sm">
              <thead><tr><th className={th}>Nombre</th><th className={th}>Perfil</th><th className={th}>Dificultad</th><th className={th}>Manos póker</th><th className={th}>Resultado</th><th className={th}>Rondas BJ</th><th className={th}>Resultado BJ</th><th className={th}>Mesa</th><th className={th}>Activo</th></tr></thead>
              <tbody>
                {d.items.map((b) => (
                  <tr key={b.id}>
                    <td className={td}>{b.name}</td>
                    <td className={td}>
                      <select className="rounded-lg border border-linea bg-noche px-2 py-1" value={b.profile} onChange={(e) => void patch(b.id, { profile: e.target.value })} aria-label={`Perfil de ${b.name}`}>
                        <option value="conservative">Conservador</option><option value="aggressive">Agresivo</option><option value="balanced">Equilibrado</option><option value="analytical">Analítico</option>
                      </select>
                    </td>
                    <td className={td}>
                      <select className="rounded-lg border border-linea bg-noche px-2 py-1" value={b.difficulty} onChange={(e) => void patch(b.id, { difficulty: e.target.value })} aria-label={`Dificultad de ${b.name}`}>
                        <option value="easy">Fácil</option><option value="normal">Normal</option><option value="hard">Difícil</option>
                      </select>
                    </td>
                    <td className={td}>{b.handsPlayed}</td>
                    <td className={cx(td, b.netResult >= 0 ? 'text-exito' : 'text-[#f1a3ad]')}>{signed(b.netResult)}</td>
                    <td className={td}>{b.bjRounds}</td>
                    <td className={cx(td, b.bjNet >= 0 ? 'text-exito' : 'text-[#f1a3ad]')}>{signed(b.bjNet)}</td>
                    <td className={cx(td, 'text-niebla')}>{b.seatedAt ?? '—'}</td>
                    <td className={td}>
                      <input type="checkbox" className="h-4 w-4 accent-[#cfae6b]" checked={b.enabled === 1} onChange={(e) => void patch(b.id, { enabled: e.target.checked })} aria-label={`Activar ${b.name}`} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Loadable>
    </Card>
  );
}

/* ---------------------------------- Mesas ---------------------------------- */
interface TableRow {
  id: string;
  name: string;
  small_blind: number;
  big_blind: number;
  min_buy_in: number;
  max_buy_in: number;
  max_seats: number;
  max_bots: number;
  target_players: number;
  enabled: number;
}

function TablesPage() {
  const { notify } = useNotify();
  const st = useLoad<{ items: TableRow[] }>('/api/admin/tables');
  const [edit, setEdit] = useState<TableRow | null>(null);
  const save = async (): Promise<void> => {
    if (!edit) return;
    try {
      const r = await api.patch<{ note: string }>(`/api/admin/tables/${edit.id}`, {
        name: edit.name, smallBlind: Number(edit.small_blind), bigBlind: Number(edit.big_blind), minBuyIn: Number(edit.min_buy_in), maxBuyIn: Number(edit.max_buy_in),
        maxBots: Number(edit.max_bots), targetPlayers: Number(edit.target_players), enabled: edit.enabled === 1,
      });
      notify('success', r.note);
      setEdit(null);
      st.reload();
    } catch (e) {
      notify('error', (e as ApiError).message);
    }
  };
  const f = (k: keyof TableRow) => (e: React.ChangeEvent<HTMLInputElement>) => setEdit((x) => (x ? { ...x, [k]: e.target.value } : x));
  return (
    <Card title="Mesas de póker">
      <Loadable state={st}>
        {(d) => (
          <table className="w-full text-sm">
            <thead><tr><th className={th}>Mesa</th><th className={th}>Ciegas</th><th className={th}>Entrada</th><th className={th}>Bots máx.</th><th className={th}>Objetivo</th><th className={th}>Estado</th><th className={th} /></tr></thead>
            <tbody>
              {d.items.map((t) => (
                <tr key={t.id}>
                  <td className={td}>{t.name}</td>
                  <td className={td}>{t.small_blind}/{t.big_blind}</td>
                  <td className={td}>{credits(t.min_buy_in)}–{credits(t.max_buy_in)}</td>
                  <td className={td}>{t.max_bots}</td>
                  <td className={td}>{t.target_players} jugadores</td>
                  <td className={td}>{t.enabled ? <Badge tone="green">abierta</Badge> : <Badge tone="muted">cerrada</Badge>}</td>
                  <td className={td}><Button size="sm" variant="outline" onClick={() => setEdit(t)}>Editar</Button></td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Loadable>
      <Modal open={!!edit} onClose={() => setEdit(null)} title={`Editar ${edit?.name ?? ''}`}>
        {edit && (
          <div className="grid gap-4 sm:grid-cols-2">
            <Field className="sm:col-span-2" label="Nombre" value={edit.name} onChange={f('name')} />
            <Field label="Ciega pequeña" type="number" value={edit.small_blind} onChange={f('small_blind')} />
            <Field label="Ciega grande" type="number" value={edit.big_blind} onChange={f('big_blind')} />
            <Field label="Entrada mínima" type="number" value={edit.min_buy_in} onChange={f('min_buy_in')} />
            <Field label="Entrada máxima" type="number" value={edit.max_buy_in} onChange={f('max_buy_in')} />
            <Field label="Bots máximos" type="number" value={edit.max_bots} onChange={f('max_bots')} />
            <Field label="Jugadores objetivo" type="number" value={edit.target_players} onChange={f('target_players')} hint="Los bots rellenan hasta este número." />
            <label className="flex items-center gap-2 text-sm text-marfil sm:col-span-2">
              <input type="checkbox" className="h-4 w-4 accent-[#cfae6b]" checked={edit.enabled === 1} onChange={(e) => setEdit({ ...edit, enabled: e.target.checked ? 1 : 0 })} /> Mesa abierta
            </label>
            <div className="flex justify-end gap-2 sm:col-span-2">
              <Button variant="ghost" onClick={() => setEdit(null)}>Cancelar</Button>
              <Button onClick={() => void save()}>Guardar</Button>
            </div>
          </div>
        )}
      </Modal>
    </Card>
  );
}

/* --------------------------- Mesas de blackjack ---------------------------- */
interface BjTableRow {
  id: string;
  name: string;
  min_bet: number;
  max_bet: number;
  max_seats: number;
  max_bots: number;
  target_players: number;
  enabled: number;
}

function BlackjackTablesCard() {
  const { notify } = useNotify();
  const st = useLoad<{ items: BjTableRow[] }>('/api/admin/blackjack-tables');
  const [edit, setEdit] = useState<BjTableRow | null>(null);
  const save = async (): Promise<void> => {
    if (!edit) return;
    try {
      const r = await api.patch<{ note: string }>(`/api/admin/blackjack-tables/${edit.id}`, {
        name: edit.name, minBet: Number(edit.min_bet), maxBet: Number(edit.max_bet), maxSeats: Number(edit.max_seats),
        maxBots: Number(edit.max_bots), targetPlayers: Number(edit.target_players), enabled: edit.enabled === 1,
      });
      notify('success', r.note);
      setEdit(null);
      st.reload();
    } catch (e) {
      notify('error', (e as ApiError).message);
    }
  };
  const f = (k: keyof BjTableRow) => (e: React.ChangeEvent<HTMLInputElement>) => setEdit((x) => (x ? { ...x, [k]: e.target.value } : x));
  return (
    <Card title="Mesas de blackjack">
      <Loadable state={st}>
        {(d) => (
          <table className="w-full text-sm">
            <thead><tr><th className={th}>Mesa</th><th className={th}>Apuesta</th><th className={th}>Asientos</th><th className={th}>Bots máx.</th><th className={th}>Modo</th><th className={th}>Estado</th><th className={th} /></tr></thead>
            <tbody>
              {d.items.map((t) => (
                <tr key={t.id}>
                  <td className={td}>{t.name}</td>
                  <td className={td}>{credits(t.min_bet)}–{credits(t.max_bet)}</td>
                  <td className={td}>{t.max_seats}</td>
                  <td className={td}>{t.max_bots}</td>
                  <td className={td}>{t.max_bots > 0 ? 'Demo con bots' : 'Solo personas'}</td>
                  <td className={td}>{t.enabled ? <Badge tone="green">abierta</Badge> : <Badge tone="muted">cerrada</Badge>}</td>
                  <td className={td}><Button size="sm" variant="outline" onClick={() => setEdit(t)}>Editar</Button></td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Loadable>
      <Modal open={!!edit} onClose={() => setEdit(null)} title={`Editar ${edit?.name ?? ''}`}>
        {edit && (
          <div className="grid gap-4 sm:grid-cols-2">
            <Field className="sm:col-span-2" label="Nombre" value={edit.name} onChange={f('name')} />
            <Field label="Apuesta mínima" type="number" value={edit.min_bet} onChange={f('min_bet')} />
            <Field label="Apuesta máxima" type="number" value={edit.max_bet} onChange={f('max_bet')} />
            <Field label="Asientos (1–7)" type="number" value={edit.max_seats} onChange={f('max_seats')} hint="Se aplica con la mesa en reposo." />
            <Field label="Bots máximos" type="number" value={edit.max_bots} onChange={f('max_bots')} hint="0 = mesa solo para personas." />
            <Field label="Jugadores objetivo" type="number" value={edit.target_players} onChange={f('target_players')} hint="Los bots rellenan hasta este número." />
            <label className="flex items-center gap-2 text-sm text-marfil sm:col-span-2">
              <input type="checkbox" className="h-4 w-4 accent-[#cfae6b]" checked={edit.enabled === 1} onChange={(e) => setEdit({ ...edit, enabled: e.target.checked ? 1 : 0 })} /> Mesa abierta
            </label>
            <p className="text-xs text-niebla sm:col-span-2">Las reglas no cambian a mitad de ronda: los nuevos límites se aplican al abrir la siguiente ronda de apuestas.</p>
            <div className="flex justify-end gap-2 sm:col-span-2">
              <Button variant="ghost" onClick={() => setEdit(null)}>Cancelar</Button>
              <Button onClick={() => void save()}>Guardar</Button>
            </div>
          </div>
        )}
      </Modal>
    </Card>
  );
}

/* --------------------------------- Ajustes --------------------------------- */
interface SettingsShape {
  gamesEnabled: Record<'blackjack' | 'roulette' | 'slots' | 'poker', boolean>;
  dailyBonus: number;
  demoRefillAmount: number;
  demoRefillThreshold: number;
  startingBalance: number | null;
  dailyTimezone: string;
  dailyStreakEnabled: boolean;
  dailyStreakStep: number;
  dailyStreakMaxSteps: number;
  adsRewardAmount: number;
  adsDailyLimit: number;
  adsMinWatchSeconds: number;
  maintenanceMessage: string;
}

function SettingsPage() {
  const { notify } = useNotify();
  const st = useLoad<{ settings: SettingsShape }>('/api/admin/settings');
  const [form, setForm] = useState<SettingsShape | null>(null);
  useEffect(() => {
    if (st.data) setForm(st.data.settings);
  }, [st.data]);
  const save = async (): Promise<void> => {
    if (!form) return;
    try {
      await api.patch('/api/admin/settings', form);
      notify('success', 'Ajustes guardados.');
      st.reload();
    } catch (e) {
      notify('error', (e as ApiError).message);
    }
  };
  if (!form) return <Spinner />;
  return (
    <Card title="Juegos y economía virtual">
      <div className="space-y-6">
        <div>
          <p className="mb-2 text-sm text-niebla">Juegos habilitados</p>
          <div className="flex flex-wrap gap-4">
            {(Object.keys(form.gamesEnabled) as (keyof SettingsShape['gamesEnabled'])[]).map((g) => (
              <label key={g} className="flex items-center gap-2 text-marfil">
                <input type="checkbox" className="h-4 w-4 accent-[#cfae6b]" checked={form.gamesEnabled[g]} onChange={(e) => setForm({ ...form, gamesEnabled: { ...form.gamesEnabled, [g]: e.target.checked } })} />
                {GAME_NAMES[g]}
              </label>
            ))}
          </div>
        </div>
        <div className="grid gap-4 sm:grid-cols-3">
          <Field label="Bono diario" type="number" value={form.dailyBonus} onChange={(e) => setForm({ ...form, dailyBonus: Number(e.target.value) })} />
          <Field label="Recarga de demostración" type="number" value={form.demoRefillAmount} onChange={(e) => setForm({ ...form, demoRefillAmount: Number(e.target.value) })} />
          <Field label="Umbral de recarga" type="number" value={form.demoRefillThreshold} onChange={(e) => setForm({ ...form, demoRefillThreshold: Number(e.target.value) })} />
        </div>
        <div className="grid gap-4 sm:grid-cols-3">
          <Field label="Saldo inicial (cuentas nuevas)" type="number" value={form.startingBalance ?? ''} onChange={(e) => setForm({ ...form, startingBalance: e.target.value === '' ? null : Number(e.target.value) })} hint="Vacío: valor de STARTING_BALANCE. Se concede una sola vez." />
          <Field label="Zona horaria del día" value={form.dailyTimezone} onChange={(e) => setForm({ ...form, dailyTimezone: e.target.value })} hint="Por ejemplo, Europe/Madrid." />
          <label className="flex items-center gap-2 self-center text-sm text-marfil">
            <input type="checkbox" className="h-4 w-4 accent-[#cfae6b]" checked={form.dailyStreakEnabled} onChange={(e) => setForm({ ...form, dailyStreakEnabled: e.target.checked })} /> Racha de días (sin castigo)
          </label>
          <Field label="Extra por día de racha" type="number" value={form.dailyStreakStep} onChange={(e) => setForm({ ...form, dailyStreakStep: Number(e.target.value) })} />
          <Field label="Días de racha máximos" type="number" value={form.dailyStreakMaxSteps} onChange={(e) => setForm({ ...form, dailyStreakMaxSteps: Number(e.target.value) })} />
        </div>
        <div className="grid gap-4 sm:grid-cols-3">
          <Field label="Créditos por anuncio" type="number" value={form.adsRewardAmount} onChange={(e) => setForm({ ...form, adsRewardAmount: Number(e.target.value) })} />
          <Field label="Anuncios al día por usuario" type="number" value={form.adsDailyLimit} onChange={(e) => setForm({ ...form, adsDailyLimit: Number(e.target.value) })} />
          <Field label="Duración mínima (s)" type="number" value={form.adsMinWatchSeconds} onChange={(e) => setForm({ ...form, adsMinWatchSeconds: Number(e.target.value) })} />
        </div>
        <p className="text-xs text-niebla">El proveedor de anuncios se configura en el servidor (ADS_PROVIDER). Sin proveedor, la interfaz indica que no están disponibles.</p>
        <Field label="Aviso en portada (vacío para ocultar)" value={form.maintenanceMessage} onChange={(e) => setForm({ ...form, maintenanceMessage: e.target.value })} />
        <Button onClick={() => void save()}>Guardar ajustes</Button>
      </div>
    </Card>
  );
}

/* ------------------------------- Diagnóstico ------------------------------- */
function DiagnosticsPage() {
  const { notify } = useNotify();
  const diag = useLoad<Record<string, any>>('/api/admin/diagnostics');
  const errors = useLoad<{ items: { id: number; level: string; message: string; context: string | null; createdAt: string }[] }>('/api/admin/errors?pageSize=50');
  const audit = useLoad<{ items: { id: number; action: string; target: string | null; details: string | null; actor: string | null; createdAt: string }[] }>('/api/admin/audit?pageSize=50');
  const [ledger, setLedger] = useState<{ checked: number; problems: unknown[] } | null>(null);
  return (
    <div className="space-y-5">
      <Card title="Sistema" action={<Button size="sm" variant="outline" onClick={() => { diag.reload(); errors.reload(); audit.reload(); }}>Actualizar</Button>}>
        <Loadable state={diag}>
          {(d) => (
            <div className="grid gap-4 text-sm sm:grid-cols-3">
              <div><p className="text-niebla">Node.js</p><p className="text-marfil">{d.node} ({d.platform})</p></div>
              <div><p className="text-niebla">Activo desde hace</p><p className="text-marfil">{Math.round(d.uptimeSec / 60)} min</p></div>
              <div><p className="text-niebla">Memoria</p><p className="text-marfil">{d.memoryMb.rss} MB (heap {d.memoryMb.heapUsed} MB)</p></div>
              <div><p className="text-niebla">Base de datos</p><p className="truncate text-marfil" title={d.database.file}>{d.database.sizeBytes ? `${(d.database.sizeBytes / 1e6).toFixed(2)} MB` : 'memoria'}</p></div>
              <div><p className="text-niebla">Integridad SQLite</p><p className="text-marfil">{d.database.integrity}</p></div>
              <div><p className="text-niebla">Migraciones</p><p className="text-marfil">{d.database.migrations.map((m: { name: string }) => m.name).join(', ')}</p></div>
              <div className="sm:col-span-3">
                <p className="mb-1 text-niebla">Mesas en memoria</p>
                {d.poker.map((t: { id: string; name: string; idle: boolean; lastError: string | null; seats: ({ kind: string; name: string; stack: number } | null)[] }) => (
                  <p key={t.id} className="text-marfil">{t.name}: {t.idle ? 'en reposo' : 'activa'}{t.lastError ? `, último error: ${t.lastError}` : ''}. Asientos: {t.seats.filter(Boolean).map((s) => `${s!.name} (${s!.kind === 'bot' ? 'bot' : 'humano'}, ${s!.stack})`).join(', ') || 'vacía'}</p>
                ))}
              </div>
            </div>
          )}
        </Loadable>
        <div className="mt-4 flex flex-wrap items-center gap-3">
          <Button size="sm" onClick={async () => {
            try {
              setLedger(await api.post('/api/admin/diagnostics/ledger-check'));
            } catch (e) {
              notify('error', (e as ApiError).message);
            }
          }}>Comprobar libro mayor</Button>
          {ledger && <span className="text-sm text-niebla">{ledger.checked} cuentas revisadas: {ledger.problems.length === 0 ? 'todo cuadra.' : `${ledger.problems.length} con descuadre.`}</span>}
        </div>
      </Card>
      <div className="grid gap-5 xl:grid-cols-2">
        <Card title="Errores y avisos">
          <Loadable state={errors}>
            {(d) => d.items.length === 0 ? <p className="text-sm text-niebla">Sin errores registrados.</p> : (
              <ul className="max-h-96 space-y-2 overflow-y-auto text-sm">
                {d.items.map((e) => (
                  <li key={e.id} className="rounded-lg border border-linea/60 p-2">
                    <p className="flex gap-2"><Badge tone={e.level === 'error' ? 'red' : 'gold'}>{e.level}</Badge><span className="text-niebla">{dateTime(e.createdAt)}</span></p>
                    <p className="mt-1 text-marfil">{e.message}</p>
                    {e.context && <p className="mt-1 break-all font-mono text-xs text-niebla">{e.context}</p>}
                  </li>
                ))}
              </ul>
            )}
          </Loadable>
        </Card>
        <Card title="Auditoría administrativa">
          <Loadable state={audit}>
            {(d) => d.items.length === 0 ? <p className="text-sm text-niebla">Sin acciones registradas.</p> : (
              <ul className="max-h-96 space-y-2 overflow-y-auto text-sm">
                {d.items.map((a) => (
                  <li key={a.id} className="border-b border-linea/40 pb-2">
                    <p className="text-marfil">{a.action} <span className="text-niebla">por {a.actor ?? 'CLI'}</span></p>
                    <p className="text-xs text-niebla">{dateTime(a.createdAt)} {a.details && a.details !== 'null' ? a.details : ''}</p>
                  </li>
                ))}
              </ul>
            )}
          </Loadable>
        </Card>
      </div>
    </div>
  );
}

const NAV = [
  { to: '/admin', label: 'Resumen', icon: LayoutDashboard, end: true },
  { to: '/admin/usuarios', label: 'Usuarios', icon: Users },
  { to: '/admin/partidas', label: 'Partidas', icon: Activity },
  { to: '/admin/bots', label: 'Bots', icon: Bot },
  { to: '/admin/mesas', label: 'Mesas', icon: Table2 },
  { to: '/admin/ajustes', label: 'Ajustes', icon: Settings },
  { to: '/admin/diagnostico', label: 'Diagnóstico', icon: Gauge },
];

export default function AdminApp() {
  return (
    <div className="min-h-screen bg-[#070b14] lg:grid lg:grid-cols-[230px_1fr]">
      <aside className="border-b border-linea bg-abismo p-4 lg:min-h-screen lg:border-b-0 lg:border-r">
        <div className="mb-6 flex items-center justify-between">
          <Logo />
          <span className="text-xs text-oro-claro">Admin</span>
        </div>
        <nav className="flex gap-1 overflow-x-auto lg:flex-col" aria-label="Administración">
          {NAV.map((n) => (
            <NavLink key={n.to} to={n.to} end={n.end} className={({ isActive }) => cx('flex shrink-0 items-center gap-2 rounded-lg px-3 py-2 text-sm', isActive ? 'bg-oro/15 text-oro-claro' : 'text-niebla hover:bg-white/5 hover:text-marfil')}>
              <n.icon className="h-4 w-4" /> {n.label}
            </NavLink>
          ))}
        </nav>
        <Link to="/" className="mt-6 hidden items-center gap-1.5 text-sm text-niebla hover:text-marfil lg:flex"><ScrollText className="h-4 w-4" /> Volver al casino</Link>
      </aside>
      <main className="p-4 sm:p-6">
        <Routes>
          <Route index element={<Dashboard />} />
          <Route path="usuarios" element={<UsersPage />} />
          <Route path="usuarios/:id" element={<UserDetail />} />
          <Route path="partidas" element={<RoundsPage />} />
          <Route path="bots" element={<BotsPage />} />
          <Route path="mesas" element={<div className="space-y-6"><TablesPage /><BlackjackTablesCard /></div>} />
          <Route path="ajustes" element={<SettingsPage />} />
          <Route path="diagnostico" element={<DiagnosticsPage />} />
        </Routes>
      </main>
    </div>
  );
}
