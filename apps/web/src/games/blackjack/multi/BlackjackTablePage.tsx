import { AnimatePresence, motion } from 'motion/react';
import { ArrowLeft, Bot, Eraser, Hand, LogOut, PlusCircle, Repeat2, Split, Square, Wifi, WifiOff } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { BotAvatar } from '../../../components/BotAvatar';
import { Celebration, type CelebrationHandle } from '../../../components/Celebration';
import { ChipStack } from '../../../components/Chip';
import { ChipRack, OddsNote, SkipButton } from '../../../components/GameKit';
import { CardBack } from '../../../components/PlayingCard';
import { ShuffleAnimation } from '../../../components/ShuffleAnimation';
import { Stage } from '../../../components/Stage';
import { TableFelt } from './TableFelt';
import { TableCard } from '../../../components/TableCard';
import { Badge, Button, Spinner } from '../../../components/ui';
import { Sequencer, type SequenceStep } from '../../../lib/anim/sequencer';
import { audio } from '../../../lib/audio';
import { credits, cx } from '../../../lib/format';
import { socket } from '../../../lib/ws';
import { useNotify } from '../../../state/notify';
import { useSession } from '../../../state/session';
import { Dealer, type DealerPose } from '../Dealer';
import { MODE_INFO } from './BlackjackLobby';
import {
  EMPTY_MULTI, MULTI_LANDSCAPE, MULTI_PORTRAIT, OUTCOME_LABEL, applyMultiEvent, dealerHand, handAnchor, multiCardPos, reachTo, seatSpots,
  visFromSnapshot, visibleTotal, type MultiEvent, type MultiGeometry, type MultiSeat, type MultiSnapshot, type MultiUpdate, type MultiVis,
} from './model';

type Action = 'hit' | 'stand' | 'double' | 'split';
const ACTION_LABEL: Record<Action, string> = { hit: 'Pedir', stand: 'Plantarse', double: 'Doblar', split: 'Dividir' };
const ACTION_KEY: Record<Action, string> = { hit: 'h', stand: 's', double: 'd', split: 'p' };
const ACTION_ICON = { hit: PlusCircle, stand: Hand, double: Square, split: Split };

/** Duración de cada evento en el cliente (ms a velocidad 1). El servidor espera algo más antes de seguir. */
const STEP_MS: Partial<Record<MultiEvent['type'], number>> = {
  betting: 520, bet: 220, shuffle: 1250, deal: 400, split: 440, double: 300, stand: 160, bust: 420, turn: 100, reveal: 700, settle: 1350,
};

function useNarrow(): boolean {
  const q = '(max-width: 700px)';
  const [n, setN] = useState(() => window.matchMedia(q).matches);
  useEffect(() => {
    const mq = window.matchMedia(q);
    const on = (): void => setN(mq.matches);
    mq.addEventListener('change', on);
    return () => mq.removeEventListener('change', on);
  }, []);
  return n;
}

function useCountdown(deadline: number | null, offset: number): number | null {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    if (!deadline) return;
    const t = window.setInterval(() => setNow(Date.now()), 250);
    return () => clearInterval(t);
  }, [deadline]);
  return deadline ? Math.max(0, Math.ceil((deadline - (now + offset)) / 1000)) : null;
}

function SeatPlate({ seat, index, n, g, isTurn, onSit, canSit }: {
  seat: MultiSeat | null; index: number; n: number; g: MultiGeometry; isTurn: boolean; onSit: () => void; canSit: boolean;
}) {
  const p = seatSpots(index, n, g).plate;
  if (!seat) {
    return (
      <div className="absolute" style={{ left: p.x, top: p.y, transform: `translate(-50%, -50%) scale(${g.plateScale})` }}>
        <button
          onClick={onSit}
          disabled={!canSit}
          data-testid={`sit-${index}`}
          className="grid h-[72px] w-[72px] place-items-center rounded-full border-2 border-dashed border-[#e8d9b0]/35 bg-black/15 text-xs text-[#e8d9b0]/70 transition-colors enabled:hover:border-oro enabled:hover:text-oro-claro disabled:cursor-default"
          aria-label={`Asiento ${index + 1} libre`}
        >
          {canSit ? 'Sentarse' : 'Libre'}
        </button>
      </div>
    );
  }
  return (
    <div className="absolute" style={{ left: p.x, top: p.y, zIndex: 60, transform: `translate(-50%, -50%) scale(${g.plateScale})` }} data-testid={`seat-${index}`}>
      <div className={cx('flex flex-col items-center transition-opacity', g.layout === 'stacked' ? 'w-[120px]' : 'w-[136px]', seat.leaving && 'opacity-60')}>
        <div className={cx('relative rounded-full border-2 shadow-hondo', seat.isYou ? 'border-oro-claro' : 'border-white/20', isTurn && 'turn-ring')}>
          {seat.isBot && seat.bot?.avatar ? (
            <BotAvatar spec={seat.bot.avatar} size={56} title={`Avatar de ${seat.name} (bot)`} />
          ) : seat.isBot ? (
            <div className="grid h-14 w-14 place-items-center rounded-full bg-[#1f2a44]"><Bot className="h-6 w-6 text-niebla" /></div>
          ) : (
            <div className={cx('grid h-14 w-14 place-items-center rounded-full bg-gradient-to-b', seat.isYou ? 'from-marino to-abismo' : 'from-[#2a2238] to-[#120d1c]')}>
              <span className="font-display text-2xl text-marfil">{seat.name[0]!.toUpperCase()}</span>
            </div>
          )}
          {!seat.connected && !seat.isBot && <WifiOff className="absolute -right-1 -top-1 h-4 w-4 rounded-full bg-noche p-0.5 text-aviso" aria-label="Desconectado" />}
        </div>
        <div className="mt-1 w-full rounded-xl border border-white/10 bg-[#070b14]/90 px-2 py-1 text-center" title={seat.bot ? `${seat.bot.tagline} · ${seat.bot.strategy} · ${seat.bot.experience}` : undefined}>
          <p className="flex items-center justify-center gap-1 truncate text-[13px] text-marfil">
            <span className="truncate">{seat.name}</span>
            {seat.isBot && <span className="rounded bg-white/10 px-1 text-[9px] text-niebla">BOT</span>}
            {seat.isYou && <span className="rounded bg-oro/20 px-1 text-[9px] text-oro-claro">TÚ</span>}
          </p>
          <p className="text-[10px] text-niebla">
            {seat.leaving ? 'Saliendo…' : seat.isBot ? `${seat.bot?.strategy ?? 'Bot'} · ${credits(seat.stack ?? 0)}` : seat.isYou ? 'Tu asiento' : 'Jugador'}
          </p>
        </div>
        <AnimatePresence>
          {isTurn && seat.isBot && (
            <motion.span key="think" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="absolute -top-6 flex gap-1 rounded-full bg-black/60 px-2.5 py-1.5" aria-label="Pensando">
              {[0, 1, 2].map((i) => (
                <motion.span key={i} className="h-1.5 w-1.5 rounded-full bg-marfil" animate={{ opacity: [0.3, 1, 0.3] }} transition={{ duration: 1, repeat: Infinity, delay: i * 0.2 }} />
              ))}
            </motion.span>
          )}
        </AnimatePresence>
      </div>
    </div>
  );
}

export default function BlackjackTablePage({ tableId: tableIdProp, embedded = false }: { tableId?: string; embedded?: boolean } = {}) {
  const params = useParams();
  const tableId = tableIdProp ?? params.tableId ?? '';
  const nav = useNavigate();
  const { user, speed, effects, motion: level } = useSession();
  const { notify } = useNotify();
  const narrow = useNarrow();
  const g = narrow ? MULTI_PORTRAIT : MULTI_LANDSCAPE;
  const geomRef = useRef(g);
  geomRef.current = g;

  const [snap, setSnap] = useState<MultiSnapshot | null>(null);
  const [vis, setVis] = useState<MultiVis>(EMPTY_MULTI);
  const visRef = useRef<MultiVis>(EMPTY_MULTI);
  const [connected, setConnected] = useState(socket.status === 'open');
  const [animating, setAnimating] = useState(false);
  const [pose, setPose] = useState<{ pose: DealerPose; reach: number; card: boolean }>({ pose: 'idle', reach: 0, card: false });
  const [shuffling, setShuffling] = useState(false);
  const [collecting, setCollecting] = useState(false);
  const [discarded, setDiscarded] = useState(0);
  const [clockOffset, setClockOffset] = useState(0);
  const [pending, setPending] = useState(false);
  const [bet, setBet] = useState(0);
  const [chip, setChip] = useState(25);
  const [lastBet, setLastBet] = useState(0);
  const [dramatic, setDramatic] = useState(false);
  const fx = useRef<CelebrationHandle>(null);
  const queue = useRef<MultiUpdate[]>([]);
  const processing = useRef(false);
  const seq = useRef(new Sequencer(speed));
  seq.current.setSpeed(speed);

  const n = snap?.table.maxSeats ?? 5;
  const yourSeat = snap?.you.seat ?? null;

  const applySnapshot = useCallback((s: MultiSnapshot) => {
    setSnap(s);
    const fresh = visFromSnapshot(s);
    visRef.current = fresh;
    setVis(fresh);
    setClockOffset(s.serverTime - Date.now());
    setPending(false);
  }, []);

  /** Cola de actualizaciones: se animan los eventos y después se aplica la instantánea autoritativa. */
  const pump = useCallback(async () => {
    if (processing.current) return;
    processing.current = true;
    while (queue.current.length > 0) {
      const msg = queue.current.shift()!;
      setSnap(msg.snapshot);
      const fast = queue.current.length > 3 || document.hidden || speed === 0 || msg.events.length === 0;
      if (!fast) {
        setAnimating(true);
        const own = msg.snapshot.you.seat;
        const steps: SequenceStep[] = [];
        for (const e of msg.events) {
          if (e.type === 'betting' && visRef.current.cards.length > 0) {
            steps.push({ name: 'recoger', duration: 560, run: () => { setCollecting(true); setPose({ pose: 'collect', reach: 0, card: false }); audio.play('cardSlide'); } });
          }
          steps.push({
            name: e.type,
            duration: STEP_MS[e.type] ?? 0,
            run: () => {
              const geo = geomRef.current;
              const before = visRef.current;
              if (e.type === 'betting') {
                setDiscarded((d) => d + before.cards.length);
                setCollecting(false);
                setPose({ pose: 'welcome', reach: 0, card: false });
              } else if (e.type === 'bet') {
                audio.play('chips');
              } else if (e.type === 'shuffle') {
                setShuffling(true);
                setDiscarded(0);
                setPose({ pose: 'shuffle', reach: 0, card: false });
                audio.riffle(700 * speed, 150);
              } else if (e.type === 'deal') {
                const target = e.to === 'dealer' ? geo.dealerRow : handAnchor(e.seat, e.hand, before.hands[e.seat]?.length ?? 1, n, geo);
                setShuffling(false);
                setPose({ pose: 'deal', reach: reachTo(target, geo), card: true });
              } else if (e.type === 'split' || e.type === 'double') {
                audio.play('chips');
              } else if (e.type === 'reveal') {
                setDramatic(true);
                setPose({ pose: 'reveal', reach: -20, card: false });
              } else if (e.type === 'turn') {
                setPose({ pose: 'idle', reach: 0, card: false });
              } else if (e.type === 'settle') {
                const mine = e.results.filter((r) => r.seat === own);
                const anyWin = e.results.some((r) => r.payout > r.bet);
                setPose({ pose: anyWin ? 'pay' : 'collect', reach: -10, card: false });
                if (mine.length > 0) {
                  const net = mine.reduce((a, r) => a + r.payout - r.bet, 0);
                  const bj = mine.some((r) => r.outcome === 'blackjack');
                  audio.play(bj ? 'winBig' : net > 0 ? 'winMedium' : net === 0 ? 'push' : 'lose');
                  const p = seatSpots(own!, n, geo).cards;
                  if (bj) fx.current?.play('burst', [{ x: p.x / geo.w, y: p.y / geo.h }]);
                  else if (net > 0) fx.current?.play('sparkle', [{ x: p.x / geo.w, y: p.y / geo.h }]);
                }
              }
              const next = applyMultiEvent(before, e);
              visRef.current = next;
              setVis(next);
            },
          });
          if (e.type === 'reveal') steps.push({ name: 'fin-revelado', duration: 0, run: () => setDramatic(false) });
        }
        steps.push({ name: 'reposo', duration: 120, run: () => setPose((p) => (p.pose === 'pay' || p.pose === 'collect' ? { pose: 'nod', reach: 0, card: false } : { ...p, card: false, pose: p.pose === 'deal' ? 'idle' : p.pose })) });
        await seq.current.play(steps);
        setShuffling(false);
        setCollecting(false);
      }
      applySnapshot(msg.snapshot);
    }
    setAnimating(false);
    processing.current = false;
  }, [applySnapshot, n, speed]);

  useEffect(() => {
    setConnected(socket.status === 'open');
    const offs = [
      socket.onStatus((s) => setConnected(s === 'open')),
      socket.onOpen(() => socket.send({ t: 'bj.watch', tableId })),
      socket.on('bj.snapshot', (m) => {
        if (m.tableId !== tableId) return;
        if (!processing.current) applySnapshot(m.snapshot as MultiSnapshot);
        else queue.current.push({ t: 'bj.update', tableId, seq: m.snapshot.seq, events: [], snapshot: m.snapshot as MultiSnapshot });
      }),
      socket.on('bj.update', (m) => {
        if (m.tableId !== tableId) return;
        queue.current.push(m as unknown as MultiUpdate);
        void pump();
      }),
      socket.on('bj.left', (m) => {
        if (m.tableId === tableId) notify('info', 'Te has levantado de la mesa.');
      }),
      socket.on('error', (m) => {
        if (String(m.ref ?? '').startsWith('bj.')) {
          setPending(false);
          notify('error', String(m.message));
        }
      }),
    ];
    return () => {
      offs.forEach((o) => o());
      socket.send({ t: 'bj.unwatch' });
      seq.current.cancel();
    };
  }, [tableId, applySnapshot, pump, notify]);

  // Una apuesta nueva por ronda; se recuerda la última para repetirla.
  useEffect(() => {
    setBet(0);
  }, [snap?.roundNo]);

  const countdown = useCountdown(snap?.deadline ?? null, clockOffset);
  const legal: Action[] = !animating && snap ? snap.you.legal : [];
  const canBet = !!snap?.you.canBet && !pending;
  const myBet = yourSeat !== null ? snap?.seats[yourSeat]?.bet ?? null : null;

  const sit = (seat: number): void => {
    if (!user) {
      nav('/entrar', { state: { from: `/blackjack/mesa/${tableId}` } });
      return;
    }
    if (!user.unlimited && (user.balance ?? 0) < (snap?.table.minBet ?? 0)) {
      notify('error', `Necesitas al menos ${credits(snap!.table.minBet)} créditos para sentarte.`);
      return;
    }
    socket.send({ t: 'bj.sit', tableId, seat });
  };

  const addChip = (v: number): void => {
    if (!snap || !canBet) return;
    const next = Math.min(snap.table.maxBet, bet + v);
    const available = user?.unlimited ? Infinity : user?.balance ?? 0;
    if (next > available) {
      notify('error', 'No tienes saldo suficiente para esa ficha.');
      return;
    }
    audio.play('chip');
    setBet(next);
  };

  const confirmBet = (amount = bet): void => {
    if (!snap || !canBet) return;
    if (amount < snap.table.minBet) {
      notify('info', `Apuesta mínima: ${credits(snap.table.minBet)}`);
      return;
    }
    setPending(true);
    setLastBet(amount);
    if (!socket.send({ t: 'bj.bet', tableId, roundNo: snap.roundNo, amount })) {
      setPending(false);
      notify('error', 'Sin conexión: reconectando…');
    }
  };

  const act = (a: Action): void => {
    if (!snap || pending || !legal.includes(a)) return;
    setPending(true);
    if (!socket.send({ t: 'bj.act', tableId, roundNo: snap.roundNo, actionCount: snap.actionCount, action: a })) {
      setPending(false);
      notify('error', 'Sin conexión: reconectando…');
    }
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.target instanceof HTMLInputElement || e.metaKey || e.ctrlKey) return;
      const k = e.key.toLowerCase();
      const a = (Object.keys(ACTION_KEY) as Action[]).find((x) => ACTION_KEY[x] === k);
      if (a) act(a);
      else if (k === 'enter' && canBet) confirmBet();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  const dealerCards = vis.cards.filter((c) => c.owner === 'dealer');
  const dealerTotal = visibleTotal(dealerCards);
  const turn = vis.turn;
  const turnSeat = turn ? snap?.seats[turn.seat] ?? null : null;

  if (!snap) return <Spinner label="Conectando con la mesa…" />;
  const mode = MODE_INFO[snap.table.mode];

  let status: string;
  if (snap.phase === 'idle') status = snap.seats.some(Boolean) ? 'Esperando apuestas para la próxima ronda' : 'Mesa en reposo: siéntate para empezar';
  else if (snap.phase === 'betting') status = `Apuestas abiertas${countdown !== null ? ` · ${countdown} s` : ''}`;
  // Durante la animación manda el estado visual: el resultado no se anuncia antes de verse.
  else if (vis.settled) status = 'Ronda terminada';
  else if (turn && turn.seat === yourSeat) status = animating ? 'Tu turno' : `Tu turno${countdown !== null ? ` · ${countdown} s` : ''}`;
  else if (turnSeat) status = `Turno de ${turnSeat.name}${turnSeat.isBot ? ' (bot)' : ''}`;
  else if (!vis.dealerRevealed) status = 'Repartiendo';
  else status = 'Turno del crupier';

  return (
    <div className={embedded ? '' : 'mx-auto max-w-6xl px-3 py-6 sm:px-6'}>
      <div className="mb-4 flex flex-wrap items-center gap-3">
        {!embedded && <Link to="/blackjack" className="inline-flex items-center gap-1.5 text-sm text-niebla hover:text-marfil"><ArrowLeft className="h-4 w-4" /> Mesas</Link>}
        {embedded ? <h2 className="text-2xl text-marfil">Mesa</h2> : <h1 className="text-3xl text-marfil sm:text-4xl">{snap.table.name}</h1>}
        <Badge tone={mode.tone}>{mode.label}</Badge>
        <span className="text-sm text-niebla">Apuesta {credits(snap.table.minBet)} – {credits(snap.table.maxBet)}</span>
        <span className={cx('ml-auto inline-flex items-center gap-1.5 text-xs', connected ? 'text-exito' : 'text-aviso')} role="status">
          {connected ? <Wifi className="h-4 w-4" /> : <WifiOff className="h-4 w-4" />}{connected ? 'Conectado' : 'Reconectando…'}
        </span>
      </div>

      <div className="relative">
        <div className="relative">
          <Stage width={g.w} height={g.h} maxHeightVh={narrow ? 80 : 66}>
            <TableFelt g={g} n={n} occupied={snap.seats.map((x) => x !== null)} yourSeat={yourSeat} />

            {/* Crupier */}
            <div className="absolute" style={{ left: g.dealerBox.left, top: g.dealerBox.top, width: g.dealerBox.w, height: g.dealerBox.h }}>
              <Dealer pose={pose.pose} reach={pose.reach} speed={speed} breathing={level === 'full'} holdingCard={pose.card} />
            </div>

            {/* Zapato */}
            <div className="absolute" style={{ left: g.shoe.x - 60, top: g.shoe.y - 64 }} aria-label={snap.round ? `Zapato: quedan ${snap.round.shoeRemaining} cartas` : 'Zapato'}>
              <div className="relative h-[128px] w-[120px]">
                <div className="absolute left-[22px] top-[14px] h-[108px] w-[77px] rotate-[-8deg]"><CardBack /></div>
                <div className="absolute inset-x-0 bottom-0 h-[72px] rounded-b-2xl rounded-t-md border border-black/40 bg-gradient-to-b from-[#3d2817] to-[#1a0f07] shadow-[inset_0_2px_0_rgba(255,220,170,0.2)]" />
              </div>
            </div>

            {/* Descartes */}
            <div className="absolute" style={{ left: g.discard.x - 50, top: g.discard.y - 60 }} aria-label={`Descartes: ${discarded} cartas`}>
              <div className="relative h-[120px] w-[100px] rounded-xl border border-black/40 bg-gradient-to-b from-[#2d1d10]/80 to-[#140b05]/80">
                {Array.from({ length: Math.min(6, Math.ceil(discarded / 5)) }, (_, i) => (
                  <div key={i} className="absolute left-[16px] h-[68px] w-[68px] rotate-90" style={{ top: 26 - i * 2 }}>
                    <div className="h-[68px] w-[48px] translate-x-[10px]"><CardBack /></div>
                  </div>
                ))}
              </div>
            </div>

            {/* Total del crupier */}
            <AnimatePresence>
              {dealerTotal && (
                <motion.div key="dt" initial={{ opacity: 0, scale: 0.8 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0 }} className="absolute -translate-x-full -translate-y-1/2 rounded-full border border-white/15 bg-black/60 px-3 py-0.5 font-display text-lg text-marfil" style={{ left: g.dealerRow.x - Math.max(2, dealerCards.length) * g.dealerCardW * 0.42 - g.dealerCardW / 2 - 14, top: g.dealerRow.y }} data-testid="dealer-total">
                  {dealerTotal}
                </motion.div>
              )}
            </AnimatePresence>

            {/* Asientos */}
            {snap.seats.map((s, i) => (
              <SeatPlate key={i} seat={s} index={i} n={n} g={g} isTurn={turn?.seat === i} onSit={() => sit(i)} canSit={yourSeat === null && !!snap.table.enabled} />
            ))}

            {/* Apuestas antes de repartir y durante la ronda */}
            {Array.from({ length: n }, (_, i) => {
              const hands = vis.hands[i];
              const placed = vis.bets[i];
              const total = hands ? hands.reduce((a, h) => a + h.bet, 0) : placed;
              if (!total) return null;
              const b = seatSpots(i, n, g).bet;
              const res = hands?.every((h) => h.outcome) ? hands : null;
              const net = res ? res.reduce((a, h) => a + (h.payout ?? 0) - h.bet, 0) : null;
              return (
                <div key={`bet${i}`} className="absolute" style={{ left: b.x - 18, top: b.y - 26, zIndex: 50 }}>
                  <motion.div
                    key={`${snap.roundNo}-${total}`}
                    initial={{ opacity: 0, y: 30, scale: 0.8 }}
                    animate={net !== null && net < 0 ? { opacity: 0, x: g.cx - b.x, y: g.dealerRow.y - b.y } : { opacity: 1, y: 0, scale: 1, x: 0 }}
                    transition={{ duration: 0.6 * Math.max(speed, 0.3), ease: [0.22, 1, 0.36, 1], delay: net !== null && net < 0 ? 0.4 : 0 }}
                  >
                    <ChipStack amount={total} size={36} max={8} />
                  </motion.div>
                  {net !== null && net > 0 && (
                    <motion.div className="absolute left-9 top-0" initial={{ opacity: 0, x: g.cx - b.x - 36, y: g.dealerRow.y - b.y }} animate={{ opacity: 1, x: 0, y: 0 }} transition={{ duration: 0.7 * Math.max(speed, 0.3), ease: [0.22, 1, 0.36, 1] }}>
                      <ChipStack amount={net} size={36} max={8} />
                    </motion.div>
                  )}
                </div>
              );
            })}

            {/* Cartas */}
            {vis.cards.map((c) => {
              const p = multiCardPos(c, vis, n, g);
              const own = c.owner !== 'dealer' ? vis.hands[c.owner.seat]?.[c.owner.hand] : undefined;
              const active = c.owner !== 'dealer' && turn !== null && c.owner.seat === turn.seat && c.owner.hand === turn.hand;
              const good = own?.outcome === 'win' || own?.outcome === 'blackjack';
              const bad = own?.outcome === 'lose' || own?.outcome === 'bust';
              return (
                <TableCard
                  key={c.id}
                  card={c.card}
                  faceUp={c.faceUp}
                  x={p.x}
                  y={p.y}
                  rotate={p.rotate}
                  z={(c.owner === 'dealer' ? 10 : 30) + c.index}
                  from={c.fromShoe ? dealerHand(g, reachTo(p, g)) : null}
                  extractVector={{ x: 0, y: 8 }}
                  collectTo={collecting ? g.discard : null}
                  width={c.owner === 'dealer' ? g.dealerCardW : g.cardW}
                  speed={speed}
                  highlight={active || good}
                  dim={bad ? 'soft' : undefined}
                  shake={own?.bust && !own.outcome}
                  dramatic={dramatic && c.owner === 'dealer' && c.index === 1}
                />
              );
            })}

            {/* Total y resultado de cada mano */}
            {Object.entries(vis.hands).map(([seatStr, hands]) =>
              hands.map((h, hi) => {
                const seat = Number(seatStr);
                const cards = vis.cards.filter((c) => c.owner !== 'dealer' && c.owner.seat === seat && c.owner.hand === hi);
                if (cards.length === 0) return null;
                const total = visibleTotal(cards);
                const good = h.outcome === 'win' || h.outcome === 'blackjack';
                const isTurn = turn?.seat === seat && turn.hand === hi;
                // A un lado de la mano (hacia fuera de la mesa), nunca encima de las cartas del crupier.
                const xs = cards.map((c) => multiCardPos(c, vis, n, g).x);
                const a = handAnchor(seat, hi, hands.length, n, g);
                // Asientos laterales: encima de sus cartas. Centrales: a un lado (encima chocarían con el crupier).
                const above = (g.layout === 'stacked' || Math.abs(a.x - g.cx) > g.rx * 0.6) && hands.length === 1;
                const rightSide = hands.length > 1 ? hi === 1 : a.x > g.cx + 4;
                const edge = above ? a.x : rightSide ? Math.max(...xs) + g.cardW / 2 + 10 : Math.min(...xs) - g.cardW / 2 - 10;
                const top = above ? a.y - g.cardW * 1.05 - (cards.length - 1) * g.cardW * 0.12 : a.y + g.cardW * 0.25;
                return (
                  <div key={`v${seat}-${hi}`} className={cx('absolute -translate-y-1/2', above ? '-translate-x-1/2' : !rightSide && '-translate-x-full')} style={{ left: edge, top, zIndex: 120 }}>
                    <AnimatePresence mode="wait">
                      {h.outcome ? (
                        <motion.div key="o" initial={{ opacity: 0, scale: 0.7, y: 6 }} animate={{ opacity: 1, scale: 1, y: 0 }} transition={{ type: 'spring', stiffness: 380, damping: 22 }}
                          className={cx('whitespace-nowrap rounded-full border px-2.5 py-0.5 text-sm font-semibold shadow', good ? 'border-oro/70 bg-noche/90 text-oro-claro' : h.outcome === 'push' ? 'border-white/25 bg-noche/85 text-marfil' : 'border-rubi/60 bg-noche/85 text-[#f1a3ad]')}
                          role="status"
                        >
                          {OUTCOME_LABEL[h.outcome]}{h.payout !== undefined && h.payout - h.bet !== 0 ? ` ${h.payout - h.bet > 0 ? '+' : ''}${credits(h.payout - h.bet)}` : ''}
                        </motion.div>
                      ) : total ? (
                        <motion.div key="t" initial={{ opacity: 0 }} animate={{ opacity: 1 }} className={cx('rounded-full border px-2.5 py-0.5 font-display text-base tabular-nums', isTurn ? 'border-oro-claro bg-black/75 text-oro-claro' : 'border-white/15 bg-black/60 text-marfil', h.bust && 'text-[#f1a3ad]')}>
                          {h.bust ? `${total} · se pasa` : total}
                        </motion.div>
                      ) : null}
                    </AnimatePresence>
                  </div>
                );
              }),
            )}

            {/* Estado de la ronda */}
            <div className="absolute -translate-x-1/2 rounded-full border border-oro/40 bg-black/65 px-4 py-1.5 text-sm text-oro-claro" style={{ left: g.cx, top: g.h - 46, zIndex: 130 }} role="status" data-testid="bj-status">
              {status}
            </div>

            <Celebration ref={fx} level={effects} />
            {shuffling && <ShuffleAnimation x={g.dealerRow.x} y={g.dealerRow.y + 30} to={g.shoe} width={g.cardW} speed={speed} onDone={() => setShuffling(false)} />}
            <div className="absolute bottom-5 right-6" style={{ zIndex: 140 }}>
              <SkipButton visible={animating && queue.current.length === 0} onSkip={() => seq.current.skip()} />
            </div>
          </Stage>
        </div>
      </div>

      {/* Controles */}
      <div className="panel sticky bottom-2 z-30 mt-3 flex flex-col gap-3 border-white/10 bg-[#0b1220]/95 p-3 shadow-[0_-12px_40px_rgba(0,0,0,0.55)] backdrop-blur-sm sm:p-4" aria-live="polite">
        {yourSeat === null ? (
          <div className="flex flex-wrap items-center justify-between gap-3">
            <p className="text-sm text-niebla">{user ? 'Elige un asiento libre en la mesa para jugar. Mientras tanto, estás observando.' : 'Inicia sesión para sentarte. Puedes observar la partida.'}</p>
            {!user && <Button onClick={() => nav('/entrar', { state: { from: `/blackjack/mesa/${tableId}` } })}>Entrar</Button>}
          </div>
        ) : (
          <>
            {snap.phase === 'betting' && myBet === null && (
              <div className="flex flex-wrap items-center justify-between gap-4">
                <ChipRack value={chip} onChange={(v) => { setChip(v); addChip(v); }} values={[5, 25, 100, 500, 1000].filter((v) => v <= snap.table.maxBet)} disabled={!canBet} />
                <div className="flex flex-wrap items-center gap-2">
                  <span className="mr-2 text-sm text-niebla">Apuesta <span className="font-display text-xl text-marfil" data-testid="pending-bet">{credits(bet)}</span></span>
                  <Button variant="ghost" size="sm" onClick={() => setBet(0)} disabled={bet === 0 || !canBet}><Eraser className="h-4 w-4" /> Retirar</Button>
                  {lastBet > 0 && bet === 0 && (
                    <Button variant="outline" onClick={() => confirmBet(lastBet)} disabled={!canBet || (!user?.unlimited && (user?.balance ?? 0) < lastBet)}><Repeat2 className="h-4 w-4" /> Repetir {credits(lastBet)}</Button>
                  )}
                  <Button size="lg" onClick={() => confirmBet()} loading={pending} disabled={!canBet || bet < snap.table.minBet} disabledReason={`Apuesta mínima: ${credits(snap.table.minBet)}`} data-testid="confirm-bet">
                    Confirmar apuesta
                  </Button>
                </div>
              </div>
            )}
            {snap.phase === 'betting' && myBet !== null && (
              <p className="text-center text-sm text-niebla">Apuesta confirmada: <span className="text-marfil">{credits(myBet)}</span>. Esperando al resto de la mesa…</p>
            )}
            {(snap.phase === 'playing' || snap.phase === 'settled' || snap.phase === 'idle') && (
              <div className="flex flex-wrap items-center justify-center gap-3">
                {(['hit', 'stand', 'double', 'split'] as Action[]).map((a) => {
                  const Icon = ACTION_ICON[a];
                  const allowed = legal.includes(a);
                  return (
                    <Button key={a} variant={a === 'hit' || a === 'stand' ? 'gold' : 'outline'} size="lg" className="min-w-[124px]" onClick={() => act(a)} loading={pending && allowed} disabled={!allowed || pending}
                      disabledReason={turn?.seat !== yourSeat ? 'Espera a tu turno' : a === 'double' ? 'Solo con dos cartas y saldo suficiente' : a === 'split' ? 'Solo con una pareja' : 'No disponible'}
                      aria-keyshortcuts={ACTION_KEY[a]}
                    >
                      <Icon className="h-4 w-4" /> {ACTION_LABEL[a]}
                      <kbd className="ml-1 hidden rounded border border-current/30 px-1 text-[10px] opacity-60 sm:inline">{ACTION_KEY[a].toUpperCase()}</kbd>
                    </Button>
                  );
                })}
              </div>
            )}
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span className="hidden text-xs text-niebla sm:inline">Si se agota tu tiempo de turno, te plantas automáticamente. Atajos: H, S, D, P y Enter para apostar.</span>
              <Button variant="ghost" size="sm" onClick={() => socket.send({ t: 'bj.leave', tableId })}><LogOut className="h-4 w-4" /> Levantarse</Button>
            </div>
          </>
        )}
      </div>
      {/* Información (fuera de la barra fija, para que no tape la mesa en el móvil) */}
      <div className="mt-3 flex flex-wrap items-center justify-between gap-2 px-1 text-xs text-niebla">
        {yourSeat !== null && <span className="sm:hidden">Si se agota tu tiempo de turno, te plantas automáticamente.</span>}
        <span>{mode.text}</span>
        <OddsNote />
      </div>

      {snap.history.length > 0 && (
        <section className="panel mt-5 p-4 sm:p-5">
          <h2 className="mb-3 text-lg text-marfil">Últimas rondas</h2>
          <ul className="space-y-1.5 text-sm">
            {snap.history.slice(0, 6).map((h) => (
              <li key={h.roundNo} className="flex flex-wrap items-center gap-x-3 gap-y-1 text-niebla">
                <span className="w-16 text-xs">Ronda {h.roundNo}</span>
                <span className="text-xs">Crupier {h.dealer.length} cartas</span>
                {h.results.map((r) => (
                  <span key={r.seat} className={cx('rounded-full border px-2 py-0.5 text-xs', r.payout > r.bet ? 'border-exito/40 text-exito' : r.payout === r.bet ? 'border-white/15 text-marfil' : 'border-white/10')}>
                    {r.name}{r.isBot ? ' (bot)' : ''}: {r.payout - r.bet > 0 ? '+' : ''}{credits(r.payout - r.bet)}
                  </span>
                ))}
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
