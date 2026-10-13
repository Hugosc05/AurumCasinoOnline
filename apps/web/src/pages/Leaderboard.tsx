import { useEffect, useState } from 'react';
import { EmptyState, Segmented, Spinner } from '../components/ui';
import { api } from '../lib/api';
import { credits, cx, signed } from '../lib/format';
import { useSession } from '../state/session';

type By = 'net' | 'balance' | 'biggest' | 'streak';
interface Row {
  rank: number;
  username: string;
  balance: number;
  rounds: number;
  wins: number;
  net: number;
  biggestWin: number;
  bestStreak: number;
}

export default function LeaderboardPage() {
  const { user } = useSession();
  const [by, setBy] = useState<By>('net');
  const [rows, setRows] = useState<Row[] | null>(null);
  useEffect(() => {
    setRows(null);
    api.get<{ items: Row[] }>(`/api/leaderboard?by=${by}`).then((r) => setRows(r.items)).catch(() => setRows([]));
  }, [by]);
  const metric = (r: Row): string => (by === 'net' ? signed(r.net) : by === 'balance' ? credits(r.balance) : by === 'biggest' ? credits(r.biggestWin) : String(r.bestStreak));
  return (
    <div className="mx-auto max-w-4xl px-4 py-10 sm:px-6">
      <h1 className="text-5xl text-marfil">Clasificación</h1>
      <p className="mt-2 text-niebla">Solo jugadores registrados que han jugado al menos una partida. Los bots y los administradores no aparecen.</p>
      <div className="mt-6">
        <Segmented<By> label="Ordenar por" value={by} onChange={setBy} options={[{ value: 'net', label: 'Resultado neto' }, { value: 'balance', label: 'Saldo' }, { value: 'biggest', label: 'Mayor premio' }, { value: 'streak', label: 'Mejor racha' }]} />
      </div>
      <div className="panel mt-6 overflow-hidden">
        {!rows ? <Spinner /> : rows.length === 0 ? (
          <div className="p-6"><EmptyState title="La clasificación está vacía">Juega una partida y aparecerás aquí.</EmptyState></div>
        ) : (
          <ol>
            {rows.map((r) => (
              <li key={r.username} className={cx('flex items-center gap-4 border-b border-linea/50 px-5 py-3.5 last:border-0', user?.username === r.username && 'bg-oro/5')}>
                <span className={cx('w-8 text-center font-display text-2xl', r.rank === 1 ? 'gold-text' : r.rank <= 3 ? 'text-oro-claro' : 'text-niebla')}>{r.rank}</span>
                <span className="flex-1 truncate text-marfil">{r.username}{user?.username === r.username && <span className="ml-2 text-xs text-oro-claro">tú</span>}</span>
                <span className="hidden text-sm text-niebla sm:inline">{r.rounds} partidas</span>
                <span className={cx('w-28 text-right font-display text-xl', by === 'net' && r.net < 0 ? 'text-[#f1a3ad]' : 'text-marfil')}>{metric(r)}</span>
              </li>
            ))}
          </ol>
        )}
      </div>
    </div>
  );
}
