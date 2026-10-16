import { Bot, Eye, Users } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { GameHeader } from '../../components/GameKit';
import { Badge, Button, EmptyState, Spinner } from '../../components/ui';
import { MODE_INFO } from '../blackjack/multi/BlackjackLobby';
import { api } from '../../lib/api';
import { credits, cx } from '../../lib/format';
import { socket } from '../../lib/ws';

interface TableSummary {
  id: string;
  name: string;
  smallBlind: number;
  bigBlind: number;
  minBuyIn: number;
  maxBuyIn: number;
  maxSeats: number;
  humans: number;
  bots: number;
  watchers: number;
  handInProgress: boolean;
  handsPlayed: number;
  free: number;
  mode: 'bots' | 'public';
}

export default function PokerLobby() {
  const nav = useNavigate();
  const [tables, setTables] = useState<TableSummary[] | null>(null);
  const [enabled, setEnabled] = useState(true);

  useEffect(() => {
    api.get<{ tables: TableSummary[]; games: Record<string, boolean> }>('/api/lobby').then((l) => {
      setTables(l.tables);
      setEnabled(l.games.poker !== false);
    }).catch(() => setTables([]));
    const off = socket.on('lobby', (m) => setTables(m.tables as TableSummary[]));
    const off2 = socket.onOpen(() => socket.send({ t: 'lobby.subscribe' }));
    return () => {
      off();
      off2();
    };
  }, []);

  return (
    <div className="mx-auto max-w-6xl px-4 py-8 sm:px-6">
      <GameHeader title="Texas Hold'em" subtitle="Mesas en tiempo real. Si faltan jugadores, se sientan bots identificados como tales." />
      {!enabled && <p className="mb-4 rounded-xl border border-aviso/40 bg-aviso/10 p-3 text-sm text-aviso">El póker está desactivado temporalmente por la administración.</p>}
      {!tables ? (
        <Spinner />
      ) : tables.length === 0 ? (
        <EmptyState title="No hay mesas abiertas">Vuelve más tarde.</EmptyState>
      ) : (
        <div className="grid gap-5 md:grid-cols-2 lg:grid-cols-4">
          {tables.map((t) => (
            <article key={t.id} className="panel relative flex flex-col overflow-hidden p-6">
              <div className="felt absolute inset-x-6 top-6 h-24 rounded-[999px] border-4 border-[#2a1a0e] opacity-80" aria-hidden />
              <div className="relative mt-28">
                <Badge tone={MODE_INFO[t.mode].tone}>{MODE_INFO[t.mode].label}</Badge>
                <h2 className="mt-2 text-2xl text-marfil">{t.name}</h2>
                <p className="mt-1 text-sm text-niebla">Ciegas {credits(t.smallBlind)} / {credits(t.bigBlind)}</p>
                <p className="text-sm text-niebla">Entrada de {credits(t.minBuyIn)} a {credits(t.maxBuyIn)}</p>
                <div className="mt-4 flex items-center gap-4 text-sm">
                  <span className="flex items-center gap-1.5 text-marfil" title="Humanos"><Users className="h-4 w-4 text-oro" /> {t.humans}</span>
                  <span className="flex items-center gap-1.5 text-niebla" title="Bots"><Bot className="h-4 w-4" /> {t.bots}</span>
                  <span className="flex items-center gap-1.5 text-niebla" title="Observando"><Eye className="h-4 w-4" /> {t.watchers}</span>
                  <span className="ml-auto text-xs text-niebla" title="Asientos libres">{t.free} libres de {t.maxSeats}</span>
                </div>
                <p className={cx('mt-2 text-xs', t.handInProgress ? 'text-exito' : 'text-niebla')}>{t.handInProgress ? 'Mano en juego' : 'En reposo: empieza cuando alguien entra'}</p>
                <Button className="mt-5 w-full" onClick={() => nav(`/poker/${t.id}`)} disabled={!enabled}>{t.free > 0 ? 'Unirse a la mesa' : 'Observar'}</Button>
              </div>
            </article>
          ))}
        </div>
      )}
      <p className="mt-8 max-w-3xl text-sm text-niebla">
        Los bots son jugadores automatizados del casino, no personas: llevan siempre la etiqueta BOT. Juegan con estrategias propias (conservador, agresivo, equilibrado o analítico), usan solo sus cartas y la información pública, y no son invencibles. Las mesas «solo personas» no tienen bots. <Link to="/bots" className="text-oro-claro underline-offset-2 hover:underline">Ver los perfiles de los bots</Link>.
      </p>
    </div>
  );
}
