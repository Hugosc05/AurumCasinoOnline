import { DoorOpen, Users } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Button } from '../../components/ui';
import { credits, cx } from '../../lib/format';
import { socket } from '../../lib/ws';
import { Ball } from './BingoBall';

interface RoomSummary {
  id: string;
  name: string;
  cardPrice: number;
  maxSeats: number;
  humans: number;
  bots: number;
  phase: 'waiting' | 'countdown' | 'playing' | 'finished';
  cardsSold: number;
  balls: number;
  watchers: number;
}

const PHASE: Record<RoomSummary['phase'], string> = { waiting: 'Esperando jugadores', countdown: 'A punto de empezar', playing: 'Partida en juego', finished: 'Entregando premios' };
const DECOR = { 'bingo-sol': [7, 23, 41, 58, 86], 'bingo-luna': [3, 19, 35, 62, 77], 'bingo-diamante': [11, 29, 50, 66, 90] } as Record<string, number[]>;

/** Salón de bingo: salas públicas en directo y acceso a las privadas. */
export default function BingoLobby() {
  const nav = useNavigate();
  const [rooms, setRooms] = useState<RoomSummary[] | null>(null);
  useEffect(() => {
    const offs = [
      socket.onOpen(() => socket.send({ t: 'bingo.lobby' })),
      socket.on('bingo.lobby', (m) => setRooms(m.rooms as RoomSummary[])),
    ];
    return () => offs.forEach((o) => o());
  }, []);

  return (
    <div className="mx-auto max-w-7xl px-4 pb-16 pt-8 sm:px-6">
      <h1 className="text-5xl text-marfil">Bingo</h1>
      <p className="mt-2 max-w-2xl text-niebla">Bingo de 90 bolas con bombo en 3D. Salas de hasta 20 jugadores, hasta 6 cartones por persona. Línea: 20 % del bote; bingo: 70 %.</p>
      <div className="mt-8 grid gap-6 md:grid-cols-3">
        {(rooms ?? []).map((r) => (
          <article key={r.id} className="bingo-hall relative flex flex-col overflow-hidden rounded-[28px] border border-oro/25 p-6" data-testid={`bingo-room-${r.id}`}>
            <div className="mb-4 flex -space-x-2">{(DECOR[r.id] ?? [1, 2, 3]).map((n) => <Ball key={n} n={n} size={40} />)}</div>
            <h2 className="text-3xl text-marfil">{r.name}</h2>
            <p className="text-sm text-niebla">Cartón a <span className="font-display text-lg text-oro-claro">{credits(r.cardPrice)}</span></p>
            <div className="mt-4 flex items-center gap-3 text-sm">
              <span className="flex items-center gap-1 text-marfil"><Users className="h-4 w-4 text-oro" /> {r.humans}/{r.maxSeats}</span>
              <span className={cx('rounded-full px-2 py-0.5 text-xs', r.phase === 'playing' ? 'bg-exito/20 text-exito' : r.phase === 'countdown' ? 'bg-oro/20 text-oro-claro' : 'bg-white/5 text-niebla')}>
                {PHASE[r.phase]}{r.phase === 'playing' ? ` · bola ${r.balls}` : ''}
              </span>
            </div>
            <Button className="mt-6" onClick={() => nav(`/bingo/${r.id}`)}>Entrar en la sala</Button>
          </article>
        ))}
        {rooms === null && <p className="text-niebla">Cargando salas…</p>}
      </div>
      <div className="panel mt-8 flex flex-wrap items-center justify-between gap-4 p-6">
        <div className="flex items-center gap-4">
          <DoorOpen className="h-8 w-8 text-oro" />
          <div>
            <h2 className="text-2xl text-marfil">Bingo privado</h2>
            <p className="text-sm text-niebla">Crea una sala con código para jugar con tus amigos (hasta 20), con el precio de cartón que queráis.</p>
          </div>
        </div>
        <Link to="/salas?crear=bingo"><Button variant="outline">Crear sala de bingo</Button></Link>
      </div>
    </div>
  );
}
