import { Check, Clock, UserPlus, Users, VolumeX, Volume2 } from 'lucide-react';
import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react';
import { ApiError, api } from '../../lib/api';
import { frameClass, nameClass } from '../../lib/cosmetics';
import { credits, cx } from '../../lib/format';
import { useNotify } from '../../state/notify';
import { useSession } from '../../state/session';
import { isMuted, toggleMute, useMutes } from '../chat/mutes';
import { Button, Modal } from '../ui';

interface Card {
  username: string;
  avatarUrl: string | null;
  frame: string | null;
  nameColor: string | null;
  memberSince: string;
  stats: { rounds: number; wins: number; biggestWin: number; bestStreak: number };
  relation: 'self' | 'friend' | 'outgoing' | 'incoming' | 'none';
  requestId: string | null;
}

const Ctx = createContext<(name: string) => void>(() => {});
export const usePlayerCard = (): ((name: string) => void) => useContext(Ctx);

/** Tarjeta de jugador: se abre al tocar a alguien en una mesa, en el chat o en una lista. */
export function PlayerCardProvider({ children }: { children: ReactNode }) {
  const [name, setName] = useState<string | null>(null);
  const open = useCallback((n: string) => setName(n), []);
  return (
    <Ctx.Provider value={open}>
      {children}
      {name && <PlayerCardModal name={name} onClose={() => setName(null)} />}
    </Ctx.Provider>
  );
}

function PlayerCardModal({ name, onClose }: { name: string; onClose: () => void }) {
  const { user } = useSession();
  const { notify } = useNotify();
  const [card, setCard] = useState<Card | null>(null);
  const [busy, setBusy] = useState(false);
  useMutes();

  useEffect(() => {
    const ctl = new AbortController();
    api.get<Card>(`/api/players/${encodeURIComponent(name)}`, ctl.signal).then(setCard).catch(() => setCard(null));
    return () => ctl.abort();
  }, [name]);

  const add = async (): Promise<void> => {
    if (!card) return;
    setBusy(true);
    try {
      if (card.relation === 'incoming' && card.requestId) {
        await api.post(`/api/social/friends/requests/${card.requestId}/accept`);
        setCard({ ...card, relation: 'friend' });
        notify('success', `Ahora ${card.username} y tú sois amigos.`);
      } else {
        const r = await api.post<{ accepted: boolean }>('/api/social/friends/requests', { username: card.username });
        setCard({ ...card, relation: r.accepted ? 'friend' : 'outgoing' });
        notify('success', r.accepted ? `Ahora ${card.username} y tú sois amigos.` : `Solicitud enviada a ${card.username}.`);
      }
    } catch (err) {
      notify('error', err instanceof ApiError ? err.message : 'No se pudo enviar la solicitud.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal open onClose={onClose} title="Perfil del jugador">
      {!card ? (
        <p className="py-6 text-center text-niebla">Cargando…</p>
      ) : (
        <div className="text-center" data-testid="player-card">
          <div className={cx('relative mx-auto h-24 w-24 rounded-full', frameClass(card.frame))}>
            {card.avatarUrl ? <img src={card.avatarUrl} alt="" className="h-full w-full rounded-full object-cover" /> : (
              <span className="grid h-full w-full place-items-center rounded-full bg-gradient-to-b from-[#2a2238] to-[#120d1c] font-display text-4xl text-marfil">{card.username[0]?.toUpperCase()}</span>
            )}
          </div>
          <h3 className={cx('mt-3 font-display text-3xl text-marfil', nameClass(card.nameColor))}>{card.username}</h3>
          <p className="text-xs text-niebla">En Aurum desde {new Date(card.memberSince).toLocaleDateString('es-ES', { month: 'long', year: 'numeric' })}</p>
          <dl className="mt-4 grid grid-cols-4 gap-2 text-xs">
            {[['Partidas', card.stats.rounds], ['Ganadas', card.stats.wins], ['Mayor premio', credits(card.stats.biggestWin)], ['Mejor racha', card.stats.bestStreak]].map(([k, v]) => (
              <div key={String(k)} className="rounded-xl bg-white/5 px-1 py-2"><dt className="text-niebla">{k}</dt><dd className="font-display text-lg text-marfil">{v}</dd></div>
            ))}
          </dl>
          {user && card.relation !== 'self' && (
            <div className="mt-5 flex flex-wrap justify-center gap-2">
              {card.relation === 'friend' ? (
                <span className="inline-flex items-center gap-1.5 rounded-full bg-exito/15 px-3 py-2 text-sm text-exito"><Users className="h-4 w-4" /> Sois amigos</span>
              ) : card.relation === 'outgoing' ? (
                <span className="inline-flex items-center gap-1.5 rounded-full bg-white/5 px-3 py-2 text-sm text-niebla"><Clock className="h-4 w-4" /> Solicitud enviada</span>
              ) : (
                <Button onClick={() => void add()} loading={busy} data-testid="player-add-friend">
                  {card.relation === 'incoming' ? <><Check className="h-4 w-4" /> Aceptar su solicitud</> : <><UserPlus className="h-4 w-4" /> Añadir amigo</>}
                </Button>
              )}
              <Button variant="ghost" onClick={() => toggleMute(card.username)}>
                {isMuted(card.username) ? <><Volume2 className="h-4 w-4" /> Dejar de silenciar</> : <><VolumeX className="h-4 w-4" /> Silenciar en el chat</>}
              </Button>
            </div>
          )}
          {!user && <p className="mt-4 text-sm text-niebla">Inicia sesión para añadir amigos.</p>}
        </div>
      )}
    </Modal>
  );
}
