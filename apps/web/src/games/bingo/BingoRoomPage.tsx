import { AnimatePresence, motion } from 'motion/react';
import { ArrowLeft, Bot, Mic, MicOff, Users } from 'lucide-react';
import { Suspense, lazy, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { bingoMissing, type BingoCard } from '@aurum/engine';
import { OddsNote } from '../../components/GameKit';
import { ChatProvider, TableChat } from '../../components/chat/TableChat';
import { PlayerName } from '../../components/social/PlayerAvatar';
import { usePlayerCard } from '../../components/social/PlayerCard';
import { Button } from '../../components/ui';
import { audio } from '../../lib/audio';
import { credits, cx } from '../../lib/format';
import { socket } from '../../lib/ws';
import { useNotify } from '../../state/notify';
import { useSession } from '../../state/session';
import { webglAvailable } from '../roulette/webgl';
import type { CageHandle } from './BingoCage3D';
import { ballColor } from './ballColors';
import { Ball } from './BingoBall';

export { Ball };

const BingoCage3D = lazy(() => import('./BingoCage3D').then((m) => ({ default: m.BingoCage3D })));

interface Winner { name: string; house: boolean; cardId: string; amount: number; you: boolean }
export interface BingoState {
  roomId: string;
  name: string;
  privateRoom: string | null;
  cardPrice: number;
  maxPlayers: number;
  maxCards: number;
  house: boolean;
  phase: 'waiting' | 'countdown' | 'playing' | 'finished';
  gameNo: number;
  countdownEndsAt: number;
  nextDrawAt: number;
  drawMs: number;
  serverTime: number;
  drawn: number[];
  players: { name: string; cards: number; you: boolean }[];
  houseCards: number;
  cardsTotal: number;
  pot: number;
  prizes: { line: number; bingo: number };
  lineWinners: Winner[];
  bingoWinners: Winner[];
  you: { cards: { id: string; grid: BingoCard }[]; spent: number; won: number } | null;
}

/* ------------------------------ Piezas visuales ------------------------------ */

function NumberBoard({ drawn, last }: { drawn: ReadonlySet<number>; last: number | null }) {
  return (
    <div className="grid grid-cols-10 gap-1 rounded-2xl border border-oro/20 bg-black/40 p-2" aria-label="Panel de números" data-testid="bingo-board">
      {Array.from({ length: 90 }, (_, i) => i + 1).map((n) => {
        const on = drawn.has(n);
        return (
          <span
            key={n}
            className={cx(
              'grid aspect-square place-items-center rounded-md text-[11px] font-bold tabular-nums transition-[background-color,color,box-shadow] duration-500 sm:text-xs',
              on ? 'text-[#1b0d05]' : 'bg-white/[0.04] text-niebla/60',
              n === last && 'ring-2 ring-white',
            )}
            style={on ? { background: `radial-gradient(circle at 35% 30%, #fff8dd, ${ballColor(n)} 70%)`, boxShadow: `0 0 10px ${ballColor(n)}88` } : undefined}
            aria-label={on ? `${n}, ha salido` : String(n)}
          >
            {n}
          </span>
        );
      })}
    </div>
  );
}

function CardView({ card, id, drawn, winner, index }: { card: BingoCard; id: string; drawn: ReadonlySet<number>; winner: 'line' | 'bingo' | null; index: number }) {
  const miss = bingoMissing(card, drawn);
  const close = miss.bingo === 1 ? 'Falta 1 para bingo' : miss.line === 1 && !winner ? 'Falta 1 para línea' : null;
  return (
    <div className={cx('bingo-card relative rounded-2xl p-2 sm:p-2.5', winner === 'bingo' ? 'ring-4 ring-oro-claro' : winner === 'line' ? 'ring-2 ring-exito' : close ? 'ring-2 ring-[#ff8be6]/70' : '')} data-testid="bingo-card">
      <div className="mb-1 flex items-center justify-between px-1 text-[10px] font-semibold uppercase tracking-widest text-[#7a5a1c]">
        <span>Cartón {index + 1}</span>
        <span className="font-mono normal-case tracking-normal opacity-70">#{id}</span>
      </div>
      <div className="grid grid-cols-9 gap-[3px]">
        {card.flatMap((row, r) =>
          row.map((n, c) => {
            const hit = n !== null && drawn.has(n);
            return (
              <div key={`${r}-${c}`} className={cx('relative grid aspect-[1/1.05] place-items-center rounded-[5px] text-sm font-extrabold tabular-nums sm:text-base', n === null ? 'bg-[#e9dcc0]/60' : 'bg-[#fffaf0] text-[#1d1a14]')}>
                {n}
                <AnimatePresence>
                  {hit && (
                    <motion.span
                      initial={{ scale: 1.8, opacity: 0 }}
                      animate={{ scale: 1, opacity: 1 }}
                      transition={{ type: 'spring', stiffness: 420, damping: 18 }}
                      className="bingo-daub pointer-events-none absolute inset-[8%] rounded-full"
                      aria-hidden
                    />
                  )}
                </AnimatePresence>
              </div>
            );
          }),
        )}
      </div>
      {(winner || close) && (
        <span className={cx('absolute -top-2 right-3 rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider shadow', winner === 'bingo' ? 'bg-oro text-noche' : winner === 'line' ? 'bg-exito text-noche' : 'bg-[#ff8be6] text-noche')}>
          {winner === 'bingo' ? '¡Bingo!' : winner === 'line' ? '¡Línea!' : close}
        </span>
      )}
    </div>
  );
}

/* ---------------------------------- Página ---------------------------------- */

function BingoRoomInner({ roomId: forcedId, embedded = false }: { roomId?: string; embedded?: boolean }) {
  const params = useParams();
  const roomId = forcedId ?? params.roomId ?? 'bingo-sol';
  const openCard = usePlayerCard();
  const { user, motion: level, prefs } = useSession();
  const { notify } = useNotify();
  const [view, setView] = useState<BingoState | null>(null);
  const [count, setCount] = useState(2);
  const [now, setNow] = useState(Date.now());
  const [voice, setVoice] = useState(() => {
    try {
      return localStorage.getItem('aurum.bingo.voice') === '1';
    } catch {
      return false;
    }
  });
  const [banner, setBanner] = useState<{ kind: 'line' | 'bingo'; winners: Winner[]; key: number } | null>(null);
  const [has3d] = useState(() => typeof document !== 'undefined' && webglAvailable());
  const cage = useRef<CageHandle>(null);
  const queue = useRef<BingoState[]>([]);
  const busy = useRef(false);
  const shown = useRef<BingoState | null>(null);
  const offset = useRef(0);
  const use3d = has3d && level !== 'off';

  const speak = useCallback((text: string) => {
    if (!voice || !prefs.sound || typeof speechSynthesis === 'undefined') return;
    const u = new SpeechSynthesisUtterance(text);
    u.lang = 'es-ES';
    u.rate = 1.05;
    speechSynthesis.cancel();
    speechSynthesis.speak(u);
  }, [voice, prefs.sound]);

  /** Aplica los estados en orden: cada bola nueva se anima antes de marcarse en cartones y panel. */
  const pump = useCallback(async () => {
    if (busy.current) return;
    busy.current = true;
    while (queue.current.length > 0) {
      const next = queue.current.shift()!;
      const prev = shown.current;
      const sameGame = prev && prev.gameNo === next.gameNo && prev.roomId === next.roomId;
      if (!sameGame || next.drawn.length < (prev?.drawn.length ?? 0)) {
        if (next.drawn.length === 0) cage.current?.reset();
        else cage.current?.sync(next.drawn);
      } else if (next.drawn.length > prev.drawn.length) {
        const fresh = next.drawn.slice(prev.drawn.length);
        // Si llegan muchas de golpe (pestaña en segundo plano), solo se anima la última.
        if (fresh.length > 2) cage.current?.sync(next.drawn.slice(0, -1));
        const last = fresh.at(-1)!;
        if (use3d && document.visibilityState === 'visible') await cage.current?.draw(last, level === 'reduced');
        speak(String(last));
      }
      if (prev && sameGame) {
        if (next.lineWinners.length > 0 && prev.lineWinners.length === 0) {
          setBanner({ kind: 'line', winners: next.lineWinners, key: Date.now() });
          audio.play(next.lineWinners.some((w) => w.you) ? 'winMedium' : 'lineWin');
          speak('¡Línea!');
        }
        if (next.bingoWinners.length > 0 && prev.bingoWinners.length === 0) {
          setBanner({ kind: 'bingo', winners: next.bingoWinners, key: Date.now() });
          audio.play(next.bingoWinners.some((w) => w.you) ? 'winBig' : 'winMedium');
          speak('¡Bingo!');
        }
      }
      cage.current?.setSpinning(next.phase === 'playing');
      shown.current = next;
      setView(next);
    }
    busy.current = false;
  }, [level, speak, use3d]);

  useEffect(() => {
    shown.current = null;
    queue.current = [];
    setView(null);
    const offs = [
      socket.onOpen(() => socket.send({ t: 'bingo.watch', roomId })),
      socket.on('bingo.state', (m) => {
        if (m.roomId !== roomId) return;
        const st = m.state as BingoState;
        offset.current = st.serverTime - Date.now();
        queue.current.push(st);
        void pump();
      }),
      socket.on('error', (m) => {
        if (String(m.ref ?? '').startsWith('bingo.')) {
          audio.play('error');
          notify('error', String(m.message));
        }
      }),
    ];
    return () => {
      offs.forEach((o) => o());
      socket.send({ t: 'bingo.unwatch' });
      if (typeof speechSynthesis !== 'undefined') speechSynthesis.cancel();
    };
  }, [notify, pump, roomId]);

  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), 250);
    return () => window.clearInterval(id);
  }, []);

  useEffect(() => {
    if (!banner) return;
    const id = window.setTimeout(() => setBanner(null), banner.kind === 'bingo' ? 6000 : 3500);
    return () => window.clearTimeout(id);
  }, [banner]);

  const drawnSet = useMemo(() => new Set(view?.drawn ?? []), [view?.drawn]);
  const last = view?.drawn.at(-1) ?? null;
  const you = view?.you ?? null;
  const canBuy = !!user && !!view && (view.phase === 'waiting' || view.phase === 'countdown');
  const haveCards = you?.cards.length ?? 0;
  const maxMore = view ? view.maxCards - haveCards : 0;
  const countdown = view?.phase === 'countdown' ? Math.max(0, Math.ceil((view.countdownEndsAt - (now + offset.current)) / 1000)) : null;

  const buy = (): void => {
    if (!view) return;
    audio.play('chips');
    socket.send({ t: 'bingo.buy', roomId, gameNo: view.gameNo, count: Math.min(count, maxMore) });
  };

  const winnerOf = (cardId: string): 'line' | 'bingo' | null =>
    view?.bingoWinners.some((w) => w.cardId === cardId) ? 'bingo' : view?.lineWinners.some((w) => w.cardId === cardId) ? 'line' : null;

  const status = !view
    ? 'Conectando…'
    : view.phase === 'waiting'
      ? 'Compra cartones: la cuenta atrás empieza con la primera compra.'
      : view.phase === 'countdown'
        ? `La partida empieza en ${countdown} s`
        : view.phase === 'playing'
          ? `Bola ${view.drawn.length} de 90`
          : 'Partida terminada';

  return (
    <div className={cx(!embedded && 'mx-auto max-w-7xl px-4 pb-16 pt-6 sm:px-6')}>
      {!embedded && (
        <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
          <div>
            <Link to="/bingo" className="mb-1 inline-flex items-center gap-1 text-sm text-niebla hover:text-marfil"><ArrowLeft className="h-4 w-4" /> Salas de bingo</Link>
            <h1 className="text-4xl text-marfil sm:text-5xl">{view?.name ?? 'Bingo'}</h1>
            <p className="mt-1 text-sm text-niebla">Bingo de 90 bolas · cartón a {credits(view?.cardPrice ?? 0)} · hasta {view?.maxPlayers ?? 20} jugadores</p>
          </div>
          <button type="button" onClick={() => setVoice((v) => { const n = !v; try { localStorage.setItem('aurum.bingo.voice', n ? '1' : '0'); } catch { /* sin almacenamiento */ } return n; })}
            className="inline-flex items-center gap-1.5 rounded-full border border-linea px-3 py-1.5 text-sm text-niebla hover:text-marfil" aria-pressed={voice}>
            {voice ? <Mic className="h-4 w-4 text-oro" /> : <MicOff className="h-4 w-4" />} Cantar números
          </button>
        </div>
      )}

      <div className="grid gap-5 lg:grid-cols-[1.25fr_1fr]">
        {/* Bombo y última bola */}
        <div className="space-y-4">
        <div className="bingo-hall relative overflow-hidden rounded-[28px] border border-oro/25 p-3 sm:p-4">
          <div className="relative">
            {use3d ? (
              <Suspense fallback={<div className="grid aspect-[1.25/1] place-items-center text-niebla">Preparando el bombo…</div>}>
                <BingoCage3D ref={(h) => { cage.current = h; if (h && shown.current) { h.sync(shown.current.drawn); h.setSpinning(shown.current.phase === 'playing'); } }} className="w-full" reduced={level === 'reduced'} />
              </Suspense>
            ) : (
              <div className="grid aspect-[1.25/1] place-items-center">{last ? <Ball n={last} size={140} /> : <p className="text-niebla">Esperando la primera bola</p>}</div>
            )}
            {/* Última bola en grande */}
            <div className="pointer-events-none absolute left-2 top-2 flex flex-col items-center gap-1 sm:left-3 sm:top-3" aria-live="polite">
              <span className="text-[10px] uppercase tracking-[0.3em] text-niebla">Última</span>
              {last ? (
                <motion.div key={last} initial={{ scale: 0.3, rotate: -90, opacity: 0 }} animate={{ scale: 1, rotate: 0, opacity: 1 }} transition={{ type: 'spring', stiffness: 260, damping: 16 }}>
                  <Ball n={last} size={72} />
                </motion.div>
              ) : (
                <span className="grid h-[72px] w-[72px] place-items-center rounded-full border border-dashed border-white/20 text-niebla">—</span>
              )}
            </div>
          </div>
          <p className="mt-2 text-center text-sm text-marfil" data-testid="bingo-status">{status}</p>
          {/* Las últimas bolas, de la más reciente a la más antigua */}
          <div className="mt-3 flex flex-wrap justify-center gap-1.5" aria-label="Bolas anteriores">
            {(view?.drawn ?? []).slice(-13, -1).reverse().map((n, i) => (
              <motion.span key={n} layout initial={{ opacity: 0, scale: 0.4 }} animate={{ opacity: 1 - i * 0.05, scale: 1 }}>
                <Ball n={n} size={i === 0 ? 40 : 34} />
              </motion.span>
            ))}
          </div>
          {/* Aviso de premio */}
          <AnimatePresence>
            {banner && (
              <motion.div key={banner.key} className="pointer-events-none absolute inset-0 z-20 grid place-items-center bg-black/45" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
                <motion.div initial={{ scale: 0.5, y: 30 }} animate={{ scale: 1, y: 0 }} transition={{ type: 'spring', stiffness: 260, damping: 14 }} className="text-center">
                  <p className={cx('mega-text font-display uppercase leading-none', banner.kind === 'bingo' ? 'text-[clamp(3.5rem,10vw,6.5rem)]' : 'text-[clamp(2.8rem,8vw,5rem)]')}>{banner.kind === 'bingo' ? '¡Bingo!' : '¡Línea!'}</p>
                  <ul className="mt-3 space-y-1 text-lg text-marfil">
                    {banner.winners.slice(0, 4).map((w, i) => (
                      <li key={i}>{w.you ? 'Tú' : w.name}{w.house ? ' (cartón de la casa)' : ''} · <span className="font-display text-oro-claro">{credits(w.amount)}</span></li>
                    ))}
                    {banner.winners.length > 4 && <li className="text-sm text-niebla">y {banner.winners.length - 4} cartones más</li>}
                  </ul>
                </motion.div>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
          {canBuy && (
            <div className="panel p-4" data-testid="bingo-buy">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <p className="text-sm text-marfil">{haveCards > 0 ? `Tienes ${haveCards} ${haveCards === 1 ? 'cartón' : 'cartones'}` : 'Compra tus cartones'}</p>
                  <p className="text-xs text-niebla">Hasta {view!.maxCards} por partida · {credits(view!.cardPrice)} cada uno</p>
                </div>
                {maxMore > 0 ? (
                  <div className="flex items-center gap-2">
                    <div className="flex items-center rounded-full border border-linea">
                      <button type="button" className="h-9 w-9 text-marfil disabled:opacity-40" disabled={count <= 1} onClick={() => setCount((c) => c - 1)} aria-label="Menos">−</button>
                      <span className="w-6 text-center font-display text-lg text-marfil" data-testid="bingo-count">{Math.min(count, maxMore)}</span>
                      <button type="button" className="h-9 w-9 text-marfil disabled:opacity-40" disabled={count >= maxMore} onClick={() => setCount((c) => c + 1)} aria-label="Más">+</button>
                    </div>
                    <Button onClick={buy} data-testid="bingo-buy-button">Comprar · {credits(Math.min(count, maxMore) * view!.cardPrice)}</Button>
                  </div>
                ) : <p className="text-sm text-niebla">Ya tienes el máximo de cartones.</p>}
              </div>
            </div>
          )}
          <div className="panel p-4 text-sm">
            <div className="mb-2 flex items-center justify-between">
              <h2 className="flex items-center gap-1.5 text-lg text-marfil"><Users className="h-4 w-4 text-oro" /> Jugadores ({view?.players.length ?? 0}/{view?.maxPlayers ?? 20})</h2>
              <span className="text-xs text-niebla">{view?.cardsTotal ?? 0} cartones</span>
            </div>
            <ul className="flex flex-wrap gap-1.5">
              {(view?.players ?? []).map((p, i) => (
                <li key={i}>
                  <button type="button" onClick={() => openCard(p.name)} className={cx('rounded-full px-2.5 py-1 text-xs hover:ring-1 hover:ring-oro/60', p.you ? 'bg-oro/20 text-oro-claro' : 'bg-white/5 text-marfil')}>
                    {p.you ? 'Tú' : <PlayerName name={p.name} />} · {p.cards}
                  </button>
                </li>
              ))}
              {view && view.houseCards > 0 && <li className="flex items-center gap-1 rounded-full bg-white/5 px-2.5 py-1 text-xs text-niebla"><Bot className="h-3 w-3" /> Casa · {view.houseCards}</li>}
              {view && view.players.length === 0 && <li className="text-niebla">Nadie ha comprado todavía.</li>}
            </ul>
            {view?.house && <p className="mt-2 text-[11px] text-niebla">Los cartones de la casa completan la partida; lo que ganen no se paga a nadie. Cada cartón tiene las mismas opciones.</p>}
          </div>
        </div>

        {/* Panel de números, premios y compra */}
        <div className="space-y-4">
          <div className="grid grid-cols-3 gap-2 text-center">
            <div className="panel px-2 py-2"><p className="text-[11px] text-niebla">Bote</p><p className="font-display text-xl text-marfil">{credits(view?.pot ?? 0)}</p></div>
            <div className="panel px-2 py-2"><p className="text-[11px] text-niebla">Línea</p><p className="font-display text-xl text-exito">{credits(view?.prizes.line ?? 0)}</p></div>
            <div className="panel px-2 py-2"><p className="text-[11px] text-niebla">Bingo</p><p className="font-display text-xl text-oro-claro">{credits(view?.prizes.bingo ?? 0)}</p></div>
          </div>
          <NumberBoard drawn={drawnSet} last={last} />
        </div>
      </div>

      {/* Tus cartones */}
      <section className="mt-6" aria-label="Tus cartones">
        <div className="mb-3 flex items-baseline justify-between">
          <h2 className="text-2xl text-marfil">Tus cartones</h2>
          {you && <p className="text-sm text-niebla">Apostado {credits(you.spent)} · Ganado <span className={you.won > 0 ? 'text-exito' : ''}>{credits(you.won)}</span></p>}
        </div>
        {you && you.cards.length > 0 ? (
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
            {you.cards.map((c, i) => <CardView key={c.id} card={c.grid} id={c.id} index={i} drawn={drawnSet} winner={winnerOf(c.id)} />)}
          </div>
        ) : (
          <p className="text-sm text-niebla">{user ? 'No juegas en esta partida. Compra cartones antes de que empiece.' : 'Inicia sesión para jugar.'}</p>
        )}
        <p className="mt-3 text-xs text-niebla">Los números se marcan solos y el servidor comprueba la línea y el bingo. Línea: 20 % del bote; bingo: 70 %. Si cantan varios cartones en la misma bola, se reparte.</p>
        <OddsNote />
      </section>
    </div>
  );
}

/** Sala de bingo con su chat. */
export default function BingoRoomPage(props: { roomId?: string; embedded?: boolean }) {
  const params = useParams();
  const id = props.roomId ?? params.roomId ?? 'bingo-sol';
  return (
    <ChatProvider channel={`bingo:${id}`}>
      <BingoRoomInner {...props} />
      <TableChat />
    </ChatProvider>
  );
}
