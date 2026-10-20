import { Bot, Copy, Crown, LogOut, RefreshCw, Send, Wifi, WifiOff, X } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { Badge, Button, Modal, Spinner } from '../components/ui';
import BlackjackTablePage from '../games/blackjack/multi/BlackjackTablePage';
import PokerTablePage from '../games/poker/PokerTablePage';
import { ApiError, api } from '../lib/api';
import { credits, cx } from '../lib/format';
import { socket } from '../lib/ws';
import { useNotify } from '../state/notify';
import { useFriends } from '../social/useSocial';

interface Member {
  id: string;
  username: string;
  isHost: boolean;
  isYou: boolean;
  connected: boolean;
  seated: boolean;
}
interface RoomView {
  id: string;
  name: string;
  game: 'poker' | 'blackjack';
  status: 'open' | 'closed';
  closeReason: string | null;
  privacy: 'code' | 'friends';
  maxSeats: number;
  allowBots: boolean;
  chipMode: 'wallet' | 'room';
  settings: Record<string, number>;
  host: Member | null;
  isHost: boolean;
  code: string | null;
  codeExpiresAt: string;
  codeExpired: boolean;
  tableId: string;
  members: Member[];
  table: { humans: number; bots: number; free: number; maxSeats: number; inProgress: boolean } | null;
}

const CLOSE_TEXT: Record<string, string> = { host: 'El anfitrión ha cerrado la sala.', empty: 'Todos los miembros se han ido.', inactive: 'La sala se cerró por inactividad.' };

/** Vista de una sala privada: miembros, código, invitaciones y la mesa. */
export default function RoomPage() {
  const { roomId = '' } = useParams();
  const [params] = useSearchParams();
  const nav = useNavigate();
  const { notify } = useNotify();
  const [room, setRoom] = useState<RoomView | null>(null);
  const [state, setState] = useState<'loading' | 'ok' | 'forbidden' | 'missing'>('loading');
  const [inviteOpen, setInviteOpen] = useState(!!params.get('invitar'));
  const [confirmClose, setConfirmClose] = useState(false);
  const { data: friends } = useFriends();

  const load = useCallback(() => {
    api.get<RoomView>(`/api/rooms/${roomId}`).then((r) => {
      setRoom(r);
      setState('ok');
    }).catch((err) => setState(err instanceof ApiError && err.status === 403 ? 'forbidden' : 'missing'));
  }, [roomId]);
  useEffect(() => {
    load();
    const offs = [
      socket.on('room.changed', (m) => m.roomId === roomId && load()),
      socket.on('room.closed', (m) => m.roomId === roomId && load()),
      socket.on('room.host', (m) => {
        if (m.roomId === roomId) {
          notify('info', 'Ahora eres el anfitrión de la sala.');
          load();
        }
      }),
    ];
    const t = window.setInterval(load, 8_000);
    return () => {
      offs.forEach((o) => o());
      clearInterval(t);
    };
  }, [load, roomId, notify]);

  const act = async (fn: () => Promise<unknown>, ok?: string): Promise<void> => {
    try {
      await fn();
      if (ok) notify('success', ok);
      load();
    } catch (err) {
      notify('error', err instanceof ApiError ? err.message : 'No se pudo completar.');
    }
  };

  if (state === 'loading') return <Spinner label="Abriendo la sala…" />;
  if (state === 'forbidden') {
    return (
      <div className="mx-auto max-w-lg px-4 py-16 text-center">
        <h1 className="text-3xl text-marfil">Sala privada</h1>
        <p className="mt-3 text-niebla">No perteneces a esta sala. Si te han invitado, acepta la invitación; si no, pide el código al anfitrión.</p>
        <div className="mt-6 flex justify-center gap-2">
          <Button onClick={() => void api.post(`/api/rooms/${roomId}/accept-invite`).then(() => load()).catch((e) => notify('error', e instanceof ApiError ? e.message : 'No se pudo entrar.'))} data-testid="accept-invite">Aceptar invitación</Button>
          <Button variant="ghost" onClick={() => nav('/salas')}>Entrar con código</Button>
        </div>
      </div>
    );
  }
  if (state === 'missing' || !room) return <div className="mx-auto max-w-lg px-4 py-16 text-center text-niebla">Sala no encontrada. <Link to="/salas" className="text-oro-claro">Volver a las salas</Link></div>;

  const closed = room.status === 'closed';
  const invitable = (friends?.friends ?? []).filter((f) => !room.members.some((m) => m.id === f.id));
  const people = room.members.length;

  return (
    <div className="mx-auto max-w-7xl px-3 py-6 sm:px-6">
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <Link to="/salas" className="text-sm text-niebla hover:text-marfil">← Salas</Link>
        <h1 className="text-3xl text-marfil sm:text-4xl">{room.name}</h1>
        <Badge tone="gold">Sala privada</Badge>
        <Badge tone="muted">{room.game === 'poker' ? "Texas Hold'em" : 'Blackjack'}</Badge>
        {room.allowBots && <Badge tone="muted">Con bots</Badge>}
        {room.chipMode === 'room' && <Badge tone="muted">Fichas de sala</Badge>}
      </div>

      {closed ? (
        <div className="panel p-6 text-center" role="status" data-testid="room-closed">
          <p className="text-xl text-marfil">Sala cerrada</p>
          <p className="mt-1 text-niebla">{CLOSE_TEXT[room.closeReason ?? ''] ?? 'Esta sala ya no está abierta.'} Las fichas de la mesa se devolvieron a cada saldo.</p>
          <Button className="mt-4" onClick={() => nav('/salas')}>Volver a las salas</Button>
        </div>
      ) : (
        <div className="grid gap-6 lg:grid-cols-[300px_1fr]">
          <aside className="space-y-4">
            <section className="panel p-4" aria-label="Código de invitación">
              <p className="text-xs text-niebla">Código de invitación</p>
              <div className="mt-1 flex items-center gap-2">
                <span className={cx('font-mono text-2xl tracking-widest', room.codeExpired ? 'text-niebla line-through' : 'text-oro-claro')} data-testid="room-code">{room.code}</span>
                <Button size="sm" variant="ghost" aria-label="Copiar código" onClick={() => void navigator.clipboard?.writeText(room.code ?? '').then(() => notify('success', 'Código copiado.'), () => notify('info', `Código: ${room.code}`))}><Copy className="h-4 w-4" /></Button>
              </div>
              <p className="text-xs text-niebla">{room.codeExpired ? 'Caducado: genera uno nuevo para invitar.' : `Caduca el ${new Date(room.codeExpiresAt).toLocaleString('es-ES')}.`}</p>
              {room.privacy === 'friends' && <p className="mt-1 text-xs text-niebla">Solo pueden entrar amigos del anfitrión o invitados.</p>}
              {room.isHost && <Button className="mt-2" size="sm" variant="outline" onClick={() => void act(() => api.post(`/api/rooms/${room.id}/code`), 'Código renovado. El anterior ya no sirve.')}><RefreshCw className="h-4 w-4" /> Nuevo código</Button>}
            </section>

            <section className="panel p-4" aria-label="Miembros">
              <div className="mb-2 flex items-center justify-between">
                <h2 className="text-lg text-marfil">Personas ({people}/{room.maxSeats})</h2>
                <Button size="sm" variant="outline" onClick={() => setInviteOpen(true)}><Send className="h-4 w-4" /> Invitar</Button>
              </div>
              <ul className="space-y-1.5" data-testid="room-members">
                {room.members.map((m) => (
                  <li key={m.id} className="flex items-center gap-2 text-sm">
                    {m.connected ? <Wifi className="h-3.5 w-3.5 text-exito" aria-label="Conectado" /> : <WifiOff className="h-3.5 w-3.5 text-niebla" aria-label="Desconectado" />}
                    <span className={cx('flex-1 truncate', m.isYou ? 'text-oro-claro' : 'text-marfil')}>{m.username}{m.isYou ? ' (tú)' : ''}</span>
                    {m.isHost && <Crown className="h-4 w-4 text-oro" aria-label="Anfitrión" />}
                    {m.seated && <span className="text-[10px] text-niebla">en la mesa</span>}
                  </li>
                ))}
              </ul>
              {room.table && (
                <p className="mt-3 text-xs text-niebla">
                  Mesa: {room.table.humans} {room.table.humans === 1 ? 'persona' : 'personas'}{room.table.bots > 0 && <> · <Bot className="inline h-3 w-3" /> {room.table.bots} bots</>} · {room.table.free} asientos libres · {room.table.inProgress ? 'partida en juego' : 'en espera'}
                </p>
              )}
              <p className="mt-2 text-[11px] leading-snug text-niebla">Si el anfitrión se desconecta, la sala pasa a otra persona conectada. Sin nadie, se cierra sola y se devuelven las fichas.</p>
            </section>

            <section className="panel p-4 text-sm text-niebla" aria-label="Reglas de la sala">
              <h2 className="mb-1 text-lg text-marfil">Reglas</h2>
              {room.game === 'poker'
                ? <p>Ciegas {credits(room.settings.smallBlind!)}/{credits(room.settings.bigBlind!)}. {room.chipMode === 'room' ? `Fichas de sala: ${credits(room.settings.startingChips!)} por persona.` : `Entrada de ${credits(room.settings.minBuyIn!)} a ${credits(room.settings.maxBuyIn!)} de tu saldo.`}</p>
                : <p>Apuesta de {credits(room.settings.minBet!)} a {credits(room.settings.maxBet!)}. Cada persona juega su mano contra el crupier común.</p>}
              <p className="mt-1 text-xs">Los cambios de límites se aplican desde la siguiente mano: nunca alteran la que está en juego.</p>
            </section>

            <div className="flex flex-wrap gap-2">
              <Button variant="ghost" onClick={() => void act(async () => { await api.post(`/api/rooms/${room.id}/leave`); nav('/salas'); })}><LogOut className="h-4 w-4" /> Abandonar la sala</Button>
              {room.isHost && <Button variant="danger" onClick={() => setConfirmClose(true)} data-testid="close-room"><X className="h-4 w-4" /> Cerrar sala</Button>}
            </div>
          </aside>

          <div className="min-w-0">
            {room.game === 'poker' ? <PokerTablePage tableId={room.tableId} embedded /> : <BlackjackTablePage tableId={room.tableId} embedded />}
          </div>
        </div>
      )}

      <Modal open={inviteOpen} onClose={() => setInviteOpen(false)} title="Invitar a amigos">
        <p className="text-sm text-niebla">Recibirán una notificación y podrán entrar sin escribir el código. También puedes compartir el código <span className="font-mono text-marfil">{room.code}</span>.</p>
        {invitable.length === 0 ? (
          <p className="mt-4 text-sm text-niebla">No tienes amigos a los que invitar. <Link to="/amigos" className="text-oro-claro">Añade amigos</Link>.</p>
        ) : (
          <ul className="mt-4 space-y-2" data-testid="invite-list">
            {invitable.map((f) => (
              <li key={f.id} className="flex items-center gap-2">
                <span className="flex-1 text-marfil">{f.username}</span>
                <Button size="sm" onClick={() => void act(() => api.post(`/api/rooms/${room.id}/invite`, { username: f.username }), `Invitación enviada a ${f.username}.`)}>Invitar</Button>
              </li>
            ))}
          </ul>
        )}
      </Modal>
      <Modal open={confirmClose} onClose={() => setConfirmClose(false)} title="Cerrar la sala">
        <p className="text-niebla">Se terminará la mesa y las fichas en juego volverán al saldo de cada persona. El código dejará de funcionar.</p>
        <div className="mt-4 flex justify-end gap-2">
          <Button variant="ghost" onClick={() => setConfirmClose(false)}>Cancelar</Button>
          <Button variant="danger" onClick={() => { setConfirmClose(false); void act(() => api.post(`/api/rooms/${room.id}/close`), 'Sala cerrada.'); }}>Cerrar sala</Button>
        </div>
      </Modal>
    </div>
  );
}
