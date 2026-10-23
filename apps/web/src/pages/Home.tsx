import { motion } from 'motion/react';
import { Bot, Flame, Users } from 'lucide-react';
import { useEffect, useState, type ReactNode } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { ChipStack } from '../components/Chip';
import { PlayingCard } from '../components/PlayingCard';
import { Button, EmptyState } from '../components/ui';
import { HeroWheel } from '../games/roulette/HeroWheel';
import { SlotSymbolArt } from '../games/slots/symbols';
import { Ball } from '../games/bingo/BingoBall';
import { api } from '../lib/api';
import { GAME_NAMES, credits, cx, relativeTime, signed } from '../lib/format';
import { socket } from '../lib/ws';
import { useSession } from '../state/session';

interface LobbyTable {
  id: string;
  name: string;
  smallBlind: number;
  bigBlind: number;
  minBuyIn: number;
  maxBuyIn: number;
  maxSeats: number;
  humans: number;
  bots: number;
  handInProgress: boolean;
}
interface Lobby {
  games: Record<string, boolean>;
  tables: LobbyTable[];
  online: number;
  registeredPlayers: number;
  maintenanceMessage: string;
}
interface Activity {
  player: string;
  game: string;
  net: number;
  at: string;
}

function GameArch({ to, title, line, art, disabled }: { to: string; title: string; line: string; art: ReactNode; disabled?: boolean }) {
  return (
    <Link
      to={disabled ? '#' : to}
      aria-disabled={disabled}
      onClick={(e) => disabled && e.preventDefault()}
      className={cx(
        'group relative flex flex-col items-center overflow-hidden border border-oro/25 bg-gradient-to-b from-marino/70 via-abismo to-noche px-5 pb-6 pt-10 text-center transition-[border-color,transform] duration-500 ease-casino arch',
        disabled ? 'opacity-50' : 'hover:-translate-y-1 hover:border-oro/60',
      )}
    >
      <div className="pointer-events-none absolute inset-x-6 top-3 h-[calc(100%-1.5rem)] rounded-t-full border border-oro/15 arch" />
      <div className="relative mb-6 flex h-36 items-center justify-center">{art}</div>
      <h3 className="text-3xl text-marfil">{title}</h3>
      <p className="mt-2 max-w-[22ch] text-sm leading-relaxed text-niebla">{line}</p>
      <span className="mt-5 text-sm font-semibold text-oro-claro underline-offset-4 group-hover:underline">{disabled ? 'En mantenimiento' : 'Jugar'}</span>
    </Link>
  );
}

export function HomePage() {
  const { user, motion: level } = useSession();
  const nav = useNavigate();
  const [lobby, setLobby] = useState<Lobby | null>(null);
  const [activity, setActivity] = useState<Activity[] | null>(null);
  const [online, setOnline] = useState<number | null>(null);

  useEffect(() => {
    const ctl = new AbortController();
    api.get<Lobby>('/api/lobby', ctl.signal).then((l) => {
      setLobby(l);
      setOnline(l.online);
    }).catch(() => {});
    api.get<{ items: Activity[] }>('/api/activity', ctl.signal).then((a) => setActivity(a.items)).catch(() => setActivity([]));
    const off1 = socket.on('presence', (m) => setOnline(Number(m.online)));
    const off2 = socket.on('lobby', (m) => {
      setOnline(Number(m.online));
      setLobby((l) => (l ? { ...l, tables: m.tables as LobbyTable[] } : l));
    });
    const off3 = socket.onOpen(() => socket.send({ t: 'lobby.subscribe' }));
    return () => {
      ctl.abort();
      off1();
      off2();
      off3();
    };
  }, []);

  const g = lobby?.games ?? { blackjack: true, roulette: true, slots: true, poker: true, bingo: true, crash: true, plinko: true };

  return (
    <div>
      {lobby?.maintenanceMessage && (
        <div className="border-b border-aviso/30 bg-aviso/10 px-4 py-2 text-center text-sm text-aviso">{lobby.maintenanceMessage}</div>
      )}
      {/* Portada: la ruleta en reposo es lo primero que se ve. */}
      <section className="relative mx-auto grid max-w-7xl items-center gap-10 px-4 pb-10 pt-12 sm:px-6 lg:grid-cols-[1.05fr_1fr] lg:pt-20">
        <div className="relative z-10">
          <h1 className="text-[clamp(2.5rem,5.2vw,4.4rem)] leading-[1.02] text-marfil">
            El salón está abierto.
            <span className="mt-2 block gold-text">Las fichas, en tu mano.</span>
          </h1>
          <p className="mt-6 max-w-[46ch] text-lg leading-relaxed text-niebla">
            Blackjack con crupier, Texas Hold'em contra bots que piensan cada mano, ruleta europea, slots, bingo, cohete y plinko. Todo con créditos virtuales: aquí no entra ni sale dinero real.
          </p>
          <div className="mt-9 flex flex-wrap items-center gap-3">
            {user ? (
              <>
                <Button size="lg" onClick={() => nav('/ruleta')}>Ir a la ruleta</Button>
                <Button size="lg" variant="outline" onClick={() => nav('/poker')}>Sentarme al póker</Button>
              </>
            ) : (
              <>
                <Button size="lg" onClick={() => nav('/registro')}>Crear cuenta con 10.000 créditos</Button>
                <Button size="lg" variant="ghost" onClick={() => nav('/entrar')}>Ya tengo cuenta</Button>
              </>
            )}
          </div>
          <dl className="mt-10 flex flex-wrap gap-x-10 gap-y-4 text-sm">
            <div>
              <dt className="text-niebla">Conectados ahora</dt>
              <dd className="font-display text-2xl text-marfil">{online ?? '—'}</dd>
            </div>
            <div>
              <dt className="text-niebla">Jugadores registrados</dt>
              <dd className="font-display text-2xl text-marfil">{lobby ? credits(lobby.registeredPlayers) : '—'}</dd>
            </div>
            <div>
              <dt className="text-niebla">Mesas de póker</dt>
              <dd className="font-display text-2xl text-marfil">{lobby ? lobby.tables.length : '—'}</dd>
            </div>
          </dl>
        </div>
        <div className="relative mx-auto w-full max-w-[560px]">
          <div className="absolute inset-[8%] rounded-full bg-oro/10 blur-3xl" aria-hidden />
          <motion.div initial={level === 'off' ? false : { opacity: 0, y: 30, scale: 0.96 }} animate={{ opacity: 1, y: 0, scale: 1 }} transition={{ duration: 1.2, ease: [0.22, 1, 0.36, 1] }}>
            <HeroWheel className="w-full drop-shadow-[0_40px_50px_rgba(0,0,0,0.75)]" />
          </motion.div>
        </div>
      </section>

      <div className="hairline mx-auto max-w-5xl" />

      {/* Los cuatro juegos */}
      <section className="mx-auto max-w-7xl px-4 py-16 sm:px-6" aria-labelledby="juegos">
        <h2 id="juegos" className="mb-10 text-center text-4xl text-marfil">Elige juego</h2>
        <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-4">
          <GameArch
            to="/blackjack"
            title="Blackjack"
            line="Seis barajas, el crupier se planta en 17 y el blackjack paga 3 a 2."
            disabled={!g.blackjack}
            art={
              <div className="relative h-32 w-36">
                <div className="absolute left-3 top-2 -rotate-12"><PlayingCard card="As" width={66} /></div>
                <div className="absolute left-14 top-3 rotate-6"><PlayingCard card="Kh" width={66} /></div>
              </div>
            }
          />
          <GameArch
            to="/poker"
            title="Póker"
            line="Texas Hold'em con ciegas, botes secundarios y bots con cuatro estilos."
            disabled={!g.poker}
            art={
              <div className="relative flex items-end gap-1">
                <div className="-rotate-6"><PlayingCard card={null} faceUp={false} width={54} /></div>
                <div className="rotate-6"><PlayingCard card={null} faceUp={false} width={54} /></div>
                <div className="ml-3"><ChipStack amount={235} size={44} /></div>
              </div>
            }
          />
          <GameArch
            to="/ruleta"
            title="Ruleta"
            line="Europea, con un solo cero. Plenos, caballos, cuadros y apuestas exteriores."
            disabled={!g.roulette}
            art={
              <svg width="130" height="130" viewBox="0 0 100 100" aria-hidden>
                <circle cx="50" cy="50" r="46" fill="#2a170b" stroke="#cfae6b" strokeWidth="1.5" />
                {Array.from({ length: 37 }, (_, i) => (
                  <path key={i} d="M50 50 L50 10 A40 40 0 0 1 56.8 10.6 Z" fill={i === 0 ? '#0f6b47' : i % 2 ? '#a3202f' : '#10151f'} transform={`rotate(${(i * 360) / 37} 50 50)`} />
                ))}
                <circle cx="50" cy="50" r="24" fill="#3b2412" stroke="#cfae6b" />
                <circle cx="50" cy="50" r="6" fill="#e2c78c" />
                <circle cx="62" cy="17" r="3.2" fill="#f4f4f6" />
              </svg>
            }
          />
          <GameArch
            to="/slots"
            title="Slots"
            line="Aurum Royale: cinco rodillos, veinte líneas, comodín y estrellas."
            disabled={!g.slots}
            art={
              <div className="flex gap-1.5 rounded-xl border border-oro/30 bg-noche/80 p-2">
                {(['seven', 'crown', 'seven'] as const).map((s, i) => (
                  <div key={i} className="rounded-md bg-gradient-to-b from-[#fbf8f1] to-[#e2d8c2] p-1">
                    <SlotSymbolArt symbol={s} size={40} />
                  </div>
                ))}
              </div>
            }
          />
          <GameArch
            to="/bingo"
            title="Bingo"
            line="90 bolas, bombo en 3D, salas de hasta 20 personas y salas privadas."
            disabled={g.bingo === false}
            art={
              <div className="flex -space-x-3">
                {[7, 42, 68, 90].map((n, i) => <div key={n} style={{ transform: `translateY(${i % 2 ? 10 : 0}px)` }}><Ball n={n} size={52} /></div>)}
              </div>
            }
          />
          <GameArch
            to="/cohete"
            title="Cohete"
            line="El multiplicador sube hasta que el cohete se estrella. Cobra a tiempo."
            disabled={g.crash === false}
            art={
              <svg width="150" height="120" viewBox="0 0 150 120" aria-hidden>
                <defs><linearGradient id="home-curve" x1="0" y1="1" x2="1" y2="0"><stop offset="0" stopColor="#ff4fb8" /><stop offset="1" stopColor="#ffcf5a" /></linearGradient></defs>
                <path d="M10 110 C 60 105 100 80 128 26" fill="none" stroke="url(#home-curve)" strokeWidth="4" strokeLinecap="round" />
                <g transform="translate(128 26) rotate(28)">
                  <path d="M0 -16 C 7 -9 7 4 5 10 H -5 C -7 4 -7 -9 0 -16 Z" fill="#eef1f6" />
                  <path d="M0 -16 C 4 -12 5 -9 6 -6 H -6 C -5 -9 -4 -12 0 -16 Z" fill="#e23b4e" />
                  <circle cy="-3" r="2.5" fill="#1d4f8f" />
                  <path d="M-4 10 Q 0 24 4 10 Z" fill="#ffb347" />
                </g>
                <text x="12" y="30" fontSize="22" fontWeight="800" fill="#ffcf5a" fontFamily="Manrope, system-ui">2,47×</text>
              </svg>
            }
          />
          <GameArch
            to="/plinko"
            title="Plinko"
            line="Bolas que rebotan entre clavos y dibujan la campana de Gauss."
            disabled={g.plinko === false}
            art={
              <svg width="140" height="120" viewBox="0 0 140 120" aria-hidden>
                {Array.from({ length: 6 }, (_, r) => Array.from({ length: r + 3 }, (_, j) => <circle key={`${r}-${j}`} cx={70 + (j - (r + 2) / 2) * 16} cy={14 + r * 15} r="2.6" fill="#d8dce6" />))}
                <circle cx="78" cy="52" r="5.5" fill="#ff5fc0" />
                {[0, 1, 2, 3, 4, 5, 6, 7].map((k) => <rect key={k} x={6 + k * 16} y="104" width="14" height="10" rx="2" fill={`hsl(${48 - Math.abs(k - 3.5) * 13} 85% 55%)`} />)}
              </svg>
            }
          />
        </div>
      </section>

      {/* Mesas y actividad: solo datos reales del servidor */}
      <section className="mx-auto grid max-w-7xl gap-6 px-4 sm:px-6 lg:grid-cols-[1.3fr_1fr]">
        <div className="panel p-6">
          <div className="mb-5 flex items-baseline justify-between gap-4">
            <h2 className="text-2xl text-marfil">Mesas de póker</h2>
            <Link to="/poker" className="text-sm text-oro-claro hover:underline">Ver todas</Link>
          </div>
          {!lobby ? (
            <p className="text-sm text-niebla">Cargando mesas…</p>
          ) : lobby.tables.length === 0 ? (
            <EmptyState title="No hay mesas abiertas">El administrador puede habilitarlas desde el panel.</EmptyState>
          ) : (
            <ul className="divide-y divide-linea/60">
              {lobby.tables.map((t) => (
                <li key={t.id} className="flex flex-wrap items-center gap-x-6 gap-y-2 py-3.5">
                  <div className="min-w-[10rem] flex-1">
                    <p className="font-display text-lg text-marfil">{t.name}</p>
                    <p className="text-xs text-niebla">Ciegas {credits(t.smallBlind)}/{credits(t.bigBlind)}, entrada {credits(t.minBuyIn)}–{credits(t.maxBuyIn)}</p>
                  </div>
                  <span className="flex items-center gap-1.5 text-sm text-marfil" title="Jugadores humanos sentados">
                    <Users className="h-4 w-4 text-oro" /> {t.humans}
                  </span>
                  <span className="flex items-center gap-1.5 text-sm text-niebla" title="Bots de demostración sentados">
                    <Bot className="h-4 w-4" /> {t.bots}
                  </span>
                  <span className={cx('text-xs', t.handInProgress ? 'text-exito' : 'text-niebla')}>{t.handInProgress ? 'Mano en juego' : 'En espera'}</span>
                  <Button size="sm" variant="outline" onClick={() => nav(`/poker/${t.id}`)}>Abrir</Button>
                </li>
              ))}
            </ul>
          )}
          <p className="mt-4 text-xs text-niebla">Los bots están marcados como tales y solo se sientan para que siempre haya partida.</p>
        </div>
        <div className="panel p-6">
          <h2 className="mb-5 text-2xl text-marfil">Últimos premios</h2>
          {activity === null ? (
            <p className="text-sm text-niebla">Cargando…</p>
          ) : activity.length === 0 ? (
            <EmptyState title="Todavía no hay premios">Cuando los jugadores ganen, aparecerán aquí con el nombre anonimizado.</EmptyState>
          ) : (
            <ul className="space-y-3">
              {activity.map((a, i) => (
                <li key={i} className="flex items-center justify-between gap-3 text-sm">
                  <span className="text-marfil">{a.player}</span>
                  <span className="text-niebla">{GAME_NAMES[a.game]}</span>
                  <span className="font-display text-base text-exito">{signed(a.net)}</span>
                  <span className="w-20 text-right text-xs text-niebla">{relativeTime(a.at)}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
      </section>

      {user && <YourStats />}
    </div>
  );
}

function YourStats() {
  const [data, setData] = useState<{ stats: Record<string, number>; recent: { outcome: string; game: string }[] } | null>(null);
  useEffect(() => {
    api.get<typeof data>('/api/me/stats').then(setData).catch(() => {});
  }, []);
  if (!data) return null;
  const s = data.stats;
  return (
    <section className="mx-auto mt-6 max-w-7xl px-4 sm:px-6">
      <div className="panel flex flex-wrap items-center gap-8 p-6">
        <div>
          <p className="text-sm text-niebla">Tu resultado acumulado</p>
          <p className={cx('font-display text-3xl', (s.net ?? 0) >= 0 ? 'text-exito' : 'text-[#f1a3ad]')}>{signed(s.net ?? 0)}</p>
        </div>
        <div>
          <p className="text-sm text-niebla">Partidas</p>
          <p className="font-display text-3xl text-marfil">{s.rounds ?? 0}</p>
        </div>
        <div>
          <p className="flex items-center gap-1 text-sm text-niebla"><Flame className="h-4 w-4 text-oro" /> Racha actual</p>
          <p className="font-display text-3xl text-marfil">{s.currentStreak ?? 0}</p>
        </div>
        <div className="min-w-[200px] flex-1">
          <p className="mb-2 text-sm text-niebla">Últimas partidas (izquierda, la más reciente)</p>
          <div className="flex gap-1" aria-label="Línea temporal de resultados">
            {data.recent.length === 0 && <span className="text-sm text-niebla">Aún no has jugado.</span>}
            {data.recent.map((r, i) => (
              <span
                key={i}
                title={`${GAME_NAMES[r.game]}: ${r.outcome === 'win' ? 'ganada' : r.outcome === 'loss' ? 'perdida' : 'empate'}`}
                className={cx('h-6 w-2.5 rounded-full', r.outcome === 'win' ? 'bg-exito' : r.outcome === 'loss' ? 'bg-rubi/80' : 'bg-niebla/50')}
              />
            ))}
          </div>
        </div>
        <Link to="/perfil" className="text-sm text-oro-claro hover:underline">Perfil completo</Link>
      </div>
    </section>
  );
}
