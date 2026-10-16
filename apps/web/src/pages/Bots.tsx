import { Bot } from 'lucide-react';
import { useEffect, useState } from 'react';
import { BotAvatar, type AvatarSpec } from '../components/BotAvatar';
import { Badge, ErrorBox, Spinner } from '../components/ui';
import { api } from '../lib/api';
import { cx } from '../lib/format';

interface BotProfileView {
  name: string;
  avatar: AvatarSpec | null;
  profile: string;
  difficulty: 'easy' | 'normal' | 'hard';
  experience: 'novato' | 'regular' | 'veterano';
  betStyle: 'minimum' | 'steady' | 'varied';
  blackjackStrategy: string;
  tagline: string;
  playingNow: 'poker' | 'blackjack' | null;
  stats: { pokerHands: number; pokerWins: number; blackjackRounds: number; blackjackWins: number };
}

const DIFFICULTY = { easy: 'Fácil', normal: 'Normal', hard: 'Difícil' };
const EXPERIENCE = { novato: 'Novato', regular: 'Habitual', veterano: 'Veterano' };
const BET_STYLE = { minimum: 'Apuesta mínima', steady: 'Apuesta constante', varied: 'Apuesta variable' };

const pct = (w: number, n: number): string => (n > 0 ? `${Math.round((w / n) * 100)} %` : '—');

/** Directorio de bots: quiénes son, cómo juegan y sus estadísticas reales en este servidor. */
export default function BotsPage() {
  const [data, setData] = useState<{ bots: BotProfileView[]; notice: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const load = (): void => {
    setError(null);
    api.get<{ bots: BotProfileView[]; notice: string }>('/api/bots').then(setData).catch(() => setError('No se pudieron cargar los bots.'));
  };
  useEffect(load, []);

  return (
    <div className="mx-auto max-w-6xl px-4 py-8 sm:px-6">
      <h1 className="text-4xl text-marfil sm:text-5xl">Bots del casino</h1>
      <p className="mt-2 flex max-w-3xl items-start gap-2 text-sm text-niebla">
        <Bot className="mt-0.5 h-4 w-4 shrink-0" />
        Son jugadores automatizados que ocupan asientos libres en las mesas de demostración. No son personas ni representan a nadie real. Sus estadísticas salen únicamente de las partidas que han jugado en este servidor.
      </p>
      {error && <div className="mt-6"><ErrorBox message={error} onRetry={load} /></div>}
      {!data && !error ? (
        <Spinner />
      ) : data && (
        <ul className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {data.bots.map((b) => (
            <li key={b.name} className="panel flex gap-4 p-4" data-testid="bot-card">
              {b.avatar ? <BotAvatar spec={b.avatar} size={72} title={`Avatar de ${b.name}`} /> : <div className="grid h-[72px] w-[72px] place-items-center rounded-full bg-white/5"><Bot /></div>}
              <div className="min-w-0 flex-1">
                <p className="flex items-center gap-2 text-lg text-marfil">
                  <span className="truncate">{b.name}</span>
                  <span className="rounded bg-white/10 px-1.5 text-[10px] text-niebla">BOT</span>
                </p>
                <p className="text-xs italic text-niebla">{b.tagline}</p>
                <div className="mt-2 flex flex-wrap gap-1.5">
                  <Badge tone="muted">{EXPERIENCE[b.experience]}</Badge>
                  <Badge tone="muted">Póker: {b.profile} · {DIFFICULTY[b.difficulty]}</Badge>
                  <Badge tone="muted">Blackjack: {b.blackjackStrategy}</Badge>
                  <Badge tone="muted">{BET_STYLE[b.betStyle]}</Badge>
                </div>
                <dl className="mt-3 grid grid-cols-2 gap-x-3 text-xs text-niebla">
                  <dt>Manos de póker</dt><dd className="text-right text-marfil tabular-nums">{b.stats.pokerHands}</dd>
                  <dt>Ganadas</dt><dd className="text-right text-marfil tabular-nums">{pct(b.stats.pokerWins, b.stats.pokerHands)}</dd>
                  <dt>Rondas de blackjack</dt><dd className="text-right text-marfil tabular-nums">{b.stats.blackjackRounds}</dd>
                  <dt>Ganadas</dt><dd className="text-right text-marfil tabular-nums">{pct(b.stats.blackjackWins, b.stats.blackjackRounds)}</dd>
                </dl>
                <p className={cx('mt-2 text-xs', b.playingNow ? 'text-exito' : 'text-niebla')}>
                  {b.playingNow === 'poker' ? 'Ahora en una mesa de póker' : b.playingNow === 'blackjack' ? 'Ahora en una mesa de blackjack' : 'Sin mesa ahora mismo'}
                </p>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
