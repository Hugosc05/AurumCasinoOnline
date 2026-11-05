import { LogOut, Users } from 'lucide-react';
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { Badge, Button, Modal } from '../components/ui';
import { api } from '../lib/api';
import { credits } from '../lib/format';
import { useNotify } from '../state/notify';
import { Card, Loadable, PageTitle, Stat, act, duration, td, th, useLoad } from './shared';

interface LiveUser {
  userId: string;
  username: string | null;
  role: 'player' | 'admin' | null;
  balance: number | null;
  newAccount: boolean;
  path: string | null;
  pathSinceSec: number;
  connectedSec: number;
  tabs: number;
  seat: string | null;
  ip: string | null;
  device: string;
}

interface Live {
  online: number;
  guests: number;
  connections: number;
  users: LiveUser[];
  guestsList: { path: string | null; connectedSec: number; ip: string | null; device: string }[];
  sections: { path: string; n: number }[];
  sharedIps: { ip: string; users: string[] }[];
}

/** Nombre legible de cada sección de la web. */
export const SECTION: Record<string, string> = {
  '/': 'Portada',
  '/poker': 'Póker',
  '/blackjack': 'Blackjack',
  '/ruleta': 'Ruleta',
  '/slots': 'Tragaperras',
  '/plinko': 'Plinko',
  '/cohete': 'Cohete',
  '/bingo': 'Bingo',
  '/salas': 'Salas privadas',
  '/recompensas': 'Recompensas',
  '/perfil': 'Perfil',
  '/clasificacion': 'Clasificación',
  '/promociones': 'Promociones',
  '/amigos': 'Amigos',
  '/entrar': 'Inicio de sesión',
  '/registro': 'Registro',
  '/ayuda': 'Ayuda',
  '/reglas': 'Reglas',
  '/bots': 'Bots',
  '/sin-saldo': 'Sin saldo',
  '/privacidad': 'Privacidad',
  '/terminos': 'Términos',
  '/juego-responsable': 'Juego responsable',
  '/admin': 'Panel de administración',
};

export const sectionName = (path: string | null): string => {
  if (!path) return 'Cargando…';
  const first = `/${path.split('/')[1] ?? ''}`;
  const name = SECTION[first] ?? first;
  const rest = path.split('/').slice(2).join('/');
  return rest && first !== '/admin' ? `${name} · ${rest}` : name;
};

export default function LivePage() {
  const { notify } = useNotify();
  const live = useLoad<Live>('/api/admin/live', 5000);
  const [kick, setKick] = useState<LiveUser | null>(null);
  return (
    <div className="space-y-5">
      <PageTitle title="En directo">
        <p className="flex items-center gap-2 text-xs text-niebla"><span className="h-2 w-2 animate-pulse rounded-full bg-exito" aria-hidden /> Se actualiza cada 5 s</p>
      </PageTitle>
      <Loadable state={live}>
        {(d) => (
          <>
            <div className="grid gap-4 sm:grid-cols-3">
              <Stat label="Jugadores conectados" value={d.online} sub={`${d.users.reduce((s, u) => s + u.tabs, 0)} pestañas abiertas`} />
              <Stat label="Visitantes sin cuenta" value={d.guests} sub="Mirando la web sin iniciar sesión" />
              <Stat label="Conexiones en tiempo real" value={d.connections} sub="Una por pestaña abierta" />
            </div>
            {d.sharedIps.length > 0 && (
              <div className="rounded-2xl border border-oro/40 bg-oro/5 p-4 text-sm text-marfil" role="status">
                <p className="font-semibold text-oro-claro">Varias cuentas desde la misma conexión</p>
                {d.sharedIps.map((s) => <p key={s.ip} className="mt-1 text-niebla"><span className="font-mono text-marfil">{s.ip}</span>: {s.users.join(', ')}</p>)}
                <p className="mt-1 text-xs text-niebla">Puede ser una familia o un piso compartido, o alguien con varias cuentas para acumular créditos.</p>
              </div>
            )}
            <div className="grid gap-5 xl:grid-cols-[1fr_280px]">
              <Card title="Quién está conectado">
                {d.users.length === 0 ? (
                  <p className="flex items-center gap-2 py-6 text-sm text-niebla"><Users className="h-4 w-4" /> No hay nadie conectado con cuenta ahora mismo.</p>
                ) : (
                  <div className="overflow-x-auto">
                    <table className="w-full min-w-[720px] text-sm" data-testid="live-table">
                      <thead><tr><th className={th}>Jugador</th><th className={th}>Dónde está</th><th className={th}>Conectado</th><th className={th}>Saldo</th><th className={th}>Dispositivo e IP</th><th className={th}><span className="sr-only">Acciones</span></th></tr></thead>
                      <tbody>
                        {d.users.map((u) => (
                          <tr key={u.userId}>
                            <td className={td}>
                              <Link to={`/admin/usuarios/${u.userId}`} className="text-marfil hover:text-oro-claro">{u.username}</Link>
                              <span className="ml-1.5 inline-flex gap-1 align-middle">
                                {u.role === 'admin' && <Badge>admin</Badge>}
                                {u.newAccount && <Badge tone="green">nuevo</Badge>}
                                {u.tabs > 1 && <Badge tone="muted">{u.tabs} pestañas</Badge>}
                              </span>
                            </td>
                            <td className={td}>
                              <p className="text-marfil">{u.seat ?? sectionName(u.path)}</p>
                              <p className="text-xs text-niebla">desde hace {duration(u.pathSinceSec)}</p>
                            </td>
                            <td className={td}>{duration(u.connectedSec)}</td>
                            <td className={td}>{u.balance === null ? '∞' : credits(u.balance)}</td>
                            <td className={td}>
                              <p className="text-marfil">{u.device}</p>
                              <p className="font-mono text-xs text-niebla">{u.ip ?? '—'}</p>
                            </td>
                            <td className={`${td} text-right`}>
                              {u.role !== 'admin' && <Button size="sm" variant="outline" onClick={() => setKick(u)}><LogOut className="h-3.5 w-3.5" /> Expulsar</Button>}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </Card>
              <Card title="Por sección">
                {d.sections.length === 0 ? <p className="text-sm text-niebla">Nadie conectado.</p> : (
                  <ul className="space-y-2 text-sm">
                    {d.sections.map((s) => (
                      <li key={s.path} className="flex items-center justify-between gap-3">
                        <span className="truncate text-marfil">{sectionName(s.path)}</span>
                        <span className="text-niebla">{s.n}</span>
                      </li>
                    ))}
                  </ul>
                )}
                <p className="mt-4 text-xs text-niebla">Incluye visitantes sin cuenta. Cuenta pestañas, no personas.</p>
              </Card>
            </div>
          </>
        )}
      </Loadable>
      <Modal open={!!kick} onClose={() => setKick(null)} title={`Expulsar a ${kick?.username ?? ''}`}>
        <p className="text-sm text-niebla">Se cerrarán todas sus sesiones y conexiones ahora mismo. Podrá volver a entrar con su contraseña; para impedírselo, suspende la cuenta en Usuarios.</p>
        <div className="mt-5 flex justify-end gap-2">
          <Button variant="outline" onClick={() => setKick(null)}>Cancelar</Button>
          <Button onClick={async () => {
            const u = kick!;
            setKick(null);
            if (await act(() => api.post(`/api/admin/live/${u.userId}/kick`), notify, `${u.username} expulsado`)) live.reload();
          }}>Expulsar</Button>
        </div>
      </Modal>
    </div>
  );
}
