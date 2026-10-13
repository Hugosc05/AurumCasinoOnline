import { Bot, Eye, Users } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { GameHeader } from '../../components/GameKit';
import { Button, EmptyState, Spinner } from '../../components/ui';
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
        <div className="grid gap-5 md:grid-cols-3">
          {tables.map((t) => (
            <article key={t.id} className="panel relative flex flex-col overflow-hidden p-6">
              <div className="felt absolute inset-x-6 top-6 h-24 rounded-[999px] border-4 border-[#2a1a0e] opacity-80" aria-hidden />
              <div className="relative mt-28">
                <h2 className="text-2xl text-marfil">{t.name}</h2>
                <p className="mt-1 text-sm text-niebla">Ciegas {credits(t.smallBlind)} / {credits(t.bigBlind)}</p>
                <p className="text-sm text-niebla">Entrada de {credits(t.minBuyIn)} a {credits(t.maxBuyIn)}</p>
                <div className="mt-4 flex items-center gap-4 text-sm">
                  <span className="flex items-center gap-1.5 text-marfil" title="Humanos"><Users className="h-4 w-4 text-oro" /> {t.humans}</span>
                  <span className="flex items-center gap-1.5 text-niebla" title="Bots"><Bot className="h-4 w-4" /> {t.bots}</span>
                  <span className="flex items-center gap-1.5 text-niebla" title="Observando"><Eye className="h-4 w-4" /> {t.watchers}</span>
                  <span className="ml-auto text-xs text-niebla">{t.humans + t.bots}/{t.maxSeats}</span>
                </div>
                <p className={cx('mt-2 text-xs', t.handInProgress ? 'text-exito' : 'text-niebla')}>{t.handInProgress ? 'Mano en juego' : 'En reposo: empieza cuando alguien entra'}</p>
                <Button className="mt-5 w-full" onClick={() => nav(`/poker/${t.id}`)} disabled={!enabled}>Entrar a la mesa</Button>
              </div>
            </article>
          ))}
        </div>
      )}
      <p className="mt-8 max-w-3xl text-sm text-niebla">
        Los bots juegan con estrategias propias (conservador, agresivo, equilibrado o analítico), usan solo sus cartas y la información pública, y no son invencibles. Las mesas están preparadas para varios jugadores humanos a la vez.
      </p>
    </div>
  );
}
