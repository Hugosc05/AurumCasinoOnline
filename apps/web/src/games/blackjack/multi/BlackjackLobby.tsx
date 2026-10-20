import { Bot, Eye, Lock, User, Users } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { GameHeader } from '../../../components/GameKit';
import { Badge, Button, EmptyState, Spinner } from '../../../components/ui';
import { api } from '../../../lib/api';
import { credits, cx } from '../../../lib/format';
import { socket } from '../../../lib/ws';
import type { LobbyTable } from './model';

export const MODE_INFO = {
  bots: { label: 'Demo con bots', tone: 'muted' as const, text: 'Bots automatizados ocupan asientos libres. Puedes sentarte en cualquier momento.' },
  public: { label: 'Pública · solo personas', tone: 'green' as const, text: 'Sin bots: solo juegan las personas que se sienten.' },
  private: { label: 'Sala privada', tone: 'gold' as const, text: 'Solo entran los miembros de la sala, con código o invitación.' },
};

const PHASE_TEXT: Record<LobbyTable['phase'], string> = {
  idle: 'En reposo: empieza cuando alguien entra',
  betting: 'Apuestas abiertas',
  playing: 'Ronda en juego',
  settled: 'Pagando la ronda',
};

/** Selección de mesa de blackjack: mesa individual o mesas con varios asientos. */
export default function BlackjackLobby() {
  const nav = useNavigate();
  const [tables, setTables] = useState<LobbyTable[] | null>(null);
  const [enabled, setEnabled] = useState(true);

  useEffect(() => {
    api.get<{ blackjackTables: LobbyTable[]; games: Record<string, boolean> }>('/api/lobby').then((l) => {
      setTables(l.blackjackTables ?? []);
      setEnabled(l.games.blackjack !== false);
    }).catch(() => setTables([]));
    const off = socket.on('bj.lobby', (m) => setTables(m.tables as LobbyTable[]));
    const off2 = socket.onOpen(() => socket.send({ t: 'bj.lobby' }));
    return () => {
      off();
      off2();
    };
  }, []);

  return (
    <div className="mx-auto max-w-6xl px-4 py-8 sm:px-6">
      <GameHeader title="Blackjack" subtitle="Seis barajas, el crupier se planta en 17, blackjack 3 a 2. Mismas reglas en todas las mesas.">
        <Button variant="outline" size="sm" onClick={() => nav('/salas?crear=blackjack')}>Crear sala privada</Button>
      </GameHeader>
      {!enabled && <p className="mb-4 rounded-xl border border-aviso/40 bg-aviso/10 p-3 text-sm text-aviso">El blackjack está desactivado temporalmente por la administración.</p>}

      <div className="grid gap-5 md:grid-cols-2 lg:grid-cols-4">
        <article className="panel relative flex flex-col overflow-hidden p-6">
          <div className="felt absolute inset-x-6 top-6 h-24 rounded-b-[999px] border-4 border-t-0 border-[#2a1a0e] opacity-80" aria-hidden />
          <div className="relative mt-28 flex flex-1 flex-col">
            <div className="flex items-center gap-2"><Badge tone="gold">Individual</Badge></div>
            <h2 className="mt-2 text-2xl text-marfil">Mesa individual</h2>
            <p className="mt-1 text-sm text-niebla">Tú solo contra el crupier, a tu ritmo. Apuesta de 10 a 5.000.</p>
            <p className="mt-2 flex items-center gap-1.5 text-sm text-niebla"><User className="h-4 w-4 text-oro" /> 1 asiento</p>
            <Button className="mt-auto w-full pt-2" onClick={() => nav('/blackjack/individual')} disabled={!enabled}>Jugar</Button>
          </div>
        </article>

        {!tables ? (
          <div className="md:col-span-1 lg:col-span-3"><Spinner /></div>
        ) : tables.length === 0 ? (
          <div className="lg:col-span-3"><EmptyState title="No hay mesas multijugador abiertas">Vuelve más tarde.</EmptyState></div>
        ) : (
          tables.map((t) => {
            const mode = MODE_INFO[t.mode];
            return (
              <article key={t.id} className="panel relative flex flex-col overflow-hidden p-6" data-testid={`bj-table-${t.id}`}>
                <div className="felt absolute inset-x-6 top-6 h-24 rounded-b-[999px] border-4 border-t-0 border-[#2a1a0e] opacity-80" aria-hidden>
                  <div className="absolute inset-x-6 bottom-3 flex justify-between">
                    {Array.from({ length: t.maxSeats }, (_, i) => {
                      const occupied = i < t.maxSeats - t.free;
                      return <span key={i} className={cx('h-3 w-3 rounded-full border', occupied ? 'border-oro bg-oro/70' : 'border-[#e8d9b0]/40')} />;
                    })}
                  </div>
                </div>
                <div className="relative mt-28 flex flex-1 flex-col">
                  <div className="flex items-center gap-2"><Badge tone={mode.tone}>{mode.label}</Badge></div>
                  <h2 className="mt-2 text-2xl text-marfil">{t.name}</h2>
                  <p className="mt-1 text-sm text-niebla">Apuesta de {credits(t.minBet)} a {credits(t.maxBet)}</p>
                  <div className="mt-3 flex items-center gap-4 text-sm">
                    <span className="flex items-center gap-1.5 text-marfil" title="Personas sentadas"><Users className="h-4 w-4 text-oro" /> {t.humans}</span>
                    <span className="flex items-center gap-1.5 text-niebla" title="Bots sentados"><Bot className="h-4 w-4" /> {t.bots}</span>
                    <span className="flex items-center gap-1.5 text-niebla" title="Observando"><Eye className="h-4 w-4" /> {t.watchers}</span>
                    <span className="ml-auto text-xs text-niebla" title="Asientos libres">{t.free} libres de {t.maxSeats}</span>
                  </div>
                  <p className={cx('mt-2 text-xs', t.phase === 'idle' ? 'text-niebla' : 'text-exito')}>{PHASE_TEXT[t.phase]}</p>
                  <Button className="mt-4 w-full" onClick={() => nav(`/blackjack/mesa/${t.id}`)} disabled={!enabled}>
                    {t.free > 0 ? 'Unirse a la mesa' : 'Observar'}
                  </Button>
                </div>
              </article>
            );
          })
        )}
      </div>

      <div className="mt-8 grid gap-3 text-sm text-niebla md:grid-cols-2">
        <p className="flex gap-2"><Bot className="mt-0.5 h-4 w-4 shrink-0" /> Los bots son jugadores automatizados del casino, no personas. Llevan siempre la etiqueta BOT, apuestan dentro de los límites y juegan con estrategias legales. No ven las cartas ocultas y no influyen en las reglas del crupier.</p>
        <p className="flex gap-2"><Lock className="mt-0.5 h-4 w-4 shrink-0" /> <span>¿Con amigos? <Link to="/salas?crear=blackjack" className="text-oro-claro hover:underline">Crea una sala privada</Link> y comparte el código.</span></p>
      </div>
    </div>
  );
}
