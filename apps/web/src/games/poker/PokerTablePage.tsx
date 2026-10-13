import type { PokerEvent } from '@aurum/engine';
import { AnimatePresence, motion } from 'motion/react';
import { ArrowLeft, Bot, LogOut, Wifi, WifiOff } from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { ChipStack } from '../../components/Chip';
import { OddsNote, SkipButton } from '../../components/GameKit';
import { CardBack } from '../../components/PlayingCard';
import { ShuffleAnimation } from '../../components/ShuffleAnimation';
import { Stage } from '../../components/Stage';
import { TableCard } from '../../components/TableCard';
import { Button, Modal, Spinner } from '../../components/ui';
import { Sequencer, type SequenceStep } from '../../lib/anim/sequencer';
import { audio } from '../../lib/audio';
import { credits, cx } from '../../lib/format';
import { socket } from '../../lib/ws';
import { useNotify } from '../../state/notify';
import { useSession } from '../../state/session';
import { EMPTY_VIS, POKER_LANDSCAPE, POKER_PORTRAIT, applyPokerEvent, boardSlot, seatPosition, towardCenter, visFromSnapshot, type PokerVis } from './model';
import type { SeatView, Snapshot, UpdateMsg } from './types';

const STEP_MS: Partial<Record<PokerEvent['type'], number>> = {
  hand_start: 1150, blind: 260, deal_hole: 140, action: 420, collect: 460, return: 350, showdown: 1500, award: 1300,
};

interface Flight {
  id: number;
  from: { x: number; y: number };
  to: { x: number; y: number };
  amount: number;
}

function SeatBadge({ seat, pos, vis, isTurn, deadline, clockOffset, onSit, canSit }: {
  seat: SeatView | null;
  index: number;
  pos: { x: number; y: number };
  vis: PokerVis;
  isTurn: boolean;
  deadline: number | null;
  clockOffset: number;
  onSit: () => void;
  canSit: boolean;
}) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    if (!isTurn || !deadline) return;
    const t = window.setInterval(() => setNow(Date.now()), 250);
    return () => clearInterval(t);
  }, [isTurn, deadline]);
  if (!seat) {
    return (
      <div className="absolute -translate-x-1/2 -translate-y-1/2" style={{ left: pos.x, top: pos.y }}>
        <button
          onClick={onSit}
          disabled={!canSit}
          className="grid h-20 w-20 place-items-center rounded-full border-2 border-dashed border-[#e8d9b0]/35 text-xs text-[#e8d9b0]/60 transition-colors enabled:hover:border-oro enabled:hover:text-oro-claro disabled:cursor-default"
          aria-label="Asiento libre"
        >
          {canSit ? 'Sentarse' : 'Libre'}
        </button>
      </div>
    );
  }
  const stack = vis.stacks[seat.seat] ?? seat.stack;
  const won = vis.winners[seat.seat];
  const folded = vis.folded[seat.seat];
  const remaining = isTurn && deadline ? Math.max(0, deadline - (now + clockOffset)) : null;
  const pct = remaining !== null ? Math.min(1, remaining / 25000) : 0;
  const action = vis.lastAction[seat.seat];
  return (
    <div className="absolute -translate-x-1/2 -translate-y-1/2" style={{ left: pos.x, top: pos.y, zIndex: 60 }}>
      <div className={cx('relative flex w-[150px] flex-col items-center transition-opacity duration-300', folded && 'opacity-55')}>
        <div className={cx('relative grid h-16 w-16 place-items-center rounded-full border-2 bg-gradient-to-b shadow-hondo', seat.isYou ? 'border-oro-claro from-marino to-abismo' : 'border-white/20 from-[#1f2a44] to-[#0c1222]', isTurn && 'turn-ring', won !== undefined && 'shadow-[0_0_0_3px_#ebd9a6,0_0_30px_rgba(235,217,166,0.6)]')}>
          {seat.isBot ? <Bot className="h-7 w-7 text-niebla" /> : <span className="font-display text-2xl text-marfil">{seat.name[0]!.toUpperCase()}</span>}
          {remaining !== null && (
            <svg className="absolute -inset-1.5" viewBox="0 0 100 100" aria-hidden>
              <circle cx="50" cy="50" r="47" fill="none" stroke={pct < 0.25 ? '#e0a84b' : '#ebd9a6'} strokeWidth="4" strokeDasharray={`${pct * 295} 295`} transform="rotate(-90 50 50)" strokeLinecap="round" />
            </svg>
          )}
          {!seat.connected && !seat.isBot && <WifiOff className="absolute -right-1 -top-1 h-4 w-4 rounded-full bg-noche p-0.5 text-aviso" aria-label="Desconectado" />}
        </div>
        <div className="mt-1 w-full rounded-xl border border-white/10 bg-black/65 px-2 py-1 text-center backdrop-blur">
          <p className="flex items-center justify-center gap-1 truncate text-[13px] text-marfil">
            {seat.name}
            {seat.isBot && <span className="rounded bg-white/10 px-1 text-[9px] text-niebla" title={`Bot ${seat.profile ?? ''} (${seat.difficulty ?? ''})`}>BOT</span>}
            {seat.isYou && <span className="rounded bg-oro/20 px-1 text-[9px] text-oro-claro">TÚ</span>}
          </p>
          <p className="font-display text-base text-oro-claro tabular-nums">{credits(stack)}</p>
          {seat.isBot && seat.profile && <p className="text-[10px] text-niebla">{seat.profile}</p>}
        </div>
        <AnimatePresence>
          {action && (
            <motion.span
              key={action}
              initial={{ opacity: 0, y: 6, scale: 0.9 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0 }}
              className={cx('absolute -top-7 whitespace-nowrap rounded-full px-2.5 py-0.5 text-xs font-semibold shadow', action === 'No va' ? 'bg-white/15 text-niebla' : action === 'All-in' ? 'bg-rubi text-marfil' : 'bg-oro text-noche')}
            >
              {action}
            </motion.span>
          )}
          {isTurn && seat.isBot && !action && (
            <motion.span key="think" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="absolute -top-7 flex gap-1 rounded-full bg-black/60 px-2.5 py-1.5" aria-label="Pensando">
              {[0, 1, 2].map((i) => (
                <motion.span key={i} className="h-1.5 w-1.5 rounded-full bg-marfil" animate={{ opacity: [0.3, 1, 0.3] }} transition={{ duration: 1, repeat: Infinity, delay: i * 0.2 }} />
              ))}
            </motion.span>
          )}
          {won !== undefined && (
            <motion.span key="won" initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} className="absolute -bottom-7 whitespace-nowrap rounded-full bg-exito/90 px-2.5 py-0.5 text-xs font-semibold text-noche">
              +{credits(won)}
            </motion.span>
          )}
        </AnimatePresence>
      </div>
    </div>
  );
}

export default function PokerTablePage() {
  const { tableId = '' } = useParams();
  const nav = useNavigate();
  const { user, speed } = useSession();
  const { notify } = useNotify();
  const [snap, setSnap] = useState<Snapshot | null>(null);
  const [vis, setVis] = useState<PokerVis>(EMPTY_VIS);
  const [connected, setConnected] = useState(socket.status === 'open');
  const [flights, setFlights] = useState<Flight[]>([]);
  const [shuffling, setShuffling] = useState(false);
  const [pending, setPending] = useState(false);
  const [sitOpen, setSitOpen] = useState(false);
  const [buyIn, setBuyIn] = useState(0);
  const [raiseTo, setRaiseTo] = useState(0);
  const [animating, setAnimating] = useState(false);
  const [clockOffset, setClockOffset] = useState(0);
  const [bestCards, setBestCards] = useState<string[]>([]);
  const queue = useRef<UpdateMsg[]>([]);
  const seq = useRef(new Sequencer(speed));
  const processing = useRef(false);
  const latest = useRef<Snapshot | null>(null);
  const flightId = useRef(1);
  seq.current.setSpeed(speed);

  const [narrow, setNarrow] = useState(() => window.matchMedia('(max-width: 640px)').matches);
  useEffect(() => {
    const mq = window.matchMedia('(max-width: 640px)');
    const on = (): void => setNarrow(mq.matches);
    mq.addEventListener('change', on);
    return () => mq.removeEventListener('change', on);
  }, []);
  const g = narrow ? POKER_PORTRAIT : POKER_LANDSCAPE;
  const geomRef = useRef(g);
  geomRef.current = g;
  const DEALER_POS = g.dealer;
  const POT_POS = g.pot;
  const heroSeat = snap?.you.seat ?? null;
  const n = snap?.table.maxSeats ?? 6;
  const displayIndex = useCallback((seat: number) => (heroSeat === null ? seat : (seat - heroSeat + n) % n), [heroSeat, n]);
  const posOf = useCallback((seat: number) => seatPosition(displayIndex(seat), n, g), [displayIndex, n, g]);

  const applySnapshot = useCallback((s: Snapshot) => {
    latest.current = s;
    setSnap(s);
    setVis(visFromSnapshot(s));
    setClockOffset(s.serverTime - Date.now());
    setPending(false);
  }, []);

  const addFlight = (from: { x: number; y: number }, to: { x: number; y: number }, amount: number): void => {
    if (speed === 0 || amount <= 0) return;
    const id = flightId.current++;
    setFlights((f) => [...f, { id, from, to, amount }]);
    window.setTimeout(() => setFlights((f) => f.filter((x) => x.id !== id)), 520 * speed + 50);
  };

  /** Procesa la cola de actualizaciones: anima los eventos y después aplica la instantánea autoritativa. */
  const pump = useCallback(async () => {
    if (processing.current) return;
    processing.current = true;
    while (queue.current.length > 0) {
      const msg = queue.current.shift()!;
      // Asientos, historial y mesa se actualizan al instante; las fichas y cartas se animan.
      latest.current = msg.snapshot;
      setSnap(msg.snapshot);
      // Si se acumulan muchas actualizaciones (pestaña oculta, red lenta), se salta la animación.
      const fast = queue.current.length > 2 || document.hidden || speed === 0;
      if (!fast) {
        setAnimating(true);
        const own = msg.snapshot.you.seat;
        const ownCards = own !== null ? (msg.snapshot.hand?.players.find((p) => p.seat === own)?.hole.filter(Boolean) as string[] | undefined) ?? null : null;
        const steps: SequenceStep[] = msg.events.map((e) => ({
          name: e.type,
          duration: e.type === 'street' ? (e.street === 'flop' ? 1100 : 700) : STEP_MS[e.type] ?? 0,
          run: () => {
            setVis((v) => {
              const geo = geomRef.current;
              const posFor = (seat: number) => seatPosition(own === null ? seat : (seat - own + n) % n, n, geo);
              if (e.type === 'blind' || (e.type === 'action' && e.added > 0)) {
                addFlight(posFor(e.seat), towardCenter(posFor(e.seat), 0.57, geo), e.type === 'blind' ? e.amount : e.added);
                audio.play('chips');
              } else if (e.type === 'action') {
                audio.play(e.action === 'fold' ? 'cardSlide' : 'click');
              }
              if (e.type === 'collect') audio.play('chips');
              if (e.type === 'award') {
                for (const w of e.winners) addFlight(geo.pot, posFor(w.seat), w.amount);
                audio.play(e.winners.some((w) => w.seat === own) ? 'winMedium' : 'chips');
              }
              if (e.type === 'return') addFlight(towardCenter(posFor(e.seat), 0.57, geo), posFor(e.seat), e.amount);
              if (e.type === 'hand_start') {
                setShuffling(true);
                setBestCards([]);
              }
              if (e.type === 'showdown') {
                const best = e.hands.flatMap((h) => h.best);
                setBestCards(best);
              }
              return applyPokerEvent(v, e, own, ownCards);
            });
          },
        }));
        await seq.current.play(steps);
        setShuffling(false);
      }
      applySnapshot(msg.snapshot);
    }
    setAnimating(false);
    processing.current = false;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [applySnapshot, n, speed]);

  useEffect(() => {
    const offs = [
      socket.onStatus((s) => setConnected(s === 'open')),
      socket.onOpen(() => socket.send({ t: 'poker.watch', tableId })),
      socket.on('poker.snapshot', (m) => {
        if (m.tableId !== tableId) return;
        // Una instantánea completa sustituye a lo pendiente (reconexión o cambio de asientos).
        if (!processing.current) applySnapshot(m.snapshot as Snapshot);
        else queue.current.push({ t: 'poker.update', tableId, seq: m.snapshot.seq, events: [], snapshot: m.snapshot as Snapshot });
      }),
      socket.on('poker.update', (m) => {
        if (m.tableId !== tableId) return;
        queue.current.push(m as unknown as UpdateMsg);
        void pump();
      }),
      socket.on('poker.left', (m) => {
        if (m.tableId === tableId && Number(m.cashOut) > 0) notify('success', `Te has levantado. Vuelven a tu saldo ${credits(Number(m.cashOut))} créditos.`);
      }),
      socket.on('error', (m) => {
        if (String(m.ref ?? '').startsWith('poker')) {
          setPending(false);
          notify('error', String(m.message));
        }
      }),
    ];
    return () => {
      offs.forEach((o) => o());
      socket.send({ t: 'poker.unwatch' });
      seq.current.cancel();
    };
  }, [tableId, applySnapshot, pump, notify]);

  const legal = !animating && snap?.you.legal ? snap.you.legal : null;
  useEffect(() => {
    if (legal) setRaiseTo(legal.minRaiseTo);
  }, [legal?.minRaiseTo, legal]);

  const send = (action: string, amount?: number): void => {
    if (!snap?.hand || pending) return;
    setPending(true);
    const ok = socket.send({ t: 'poker.act', tableId, handId: snap.hand.handId, actionCount: snap.actionCount, action, ...(amount !== undefined ? { amount } : {}) });
    if (!ok) {
      setPending(false);
      notify('error', 'Sin conexión: reconectando…');
    }
  };

  const openSit = (): void => {
    if (!user) {
      nav('/entrar', { state: { from: `/poker/${tableId}` } });
      return;
    }
    if (!snap) return;
    const cap = user.unlimited ? snap.table.maxBuyIn : Math.min(snap.table.maxBuyIn, user.balance ?? 0);
    if (cap < snap.table.minBuyIn) {
      notify('error', `Necesitas al menos ${credits(snap.table.minBuyIn)} créditos para sentarte aquí.`);
      return;
    }
    setBuyIn(Math.min(cap, Math.max(snap.table.minBuyIn, snap.table.bigBlind * 100)));
    setSitOpen(true);
  };

  const holeCardPos = (seat: number, i: number) => {
    const p = towardCenter(posOf(seat), seat === heroSeat ? 0.34 : 0.37, g);
    return { x: p.x + (i === 0 ? -17 : 17), y: p.y - 6, rotate: i === 0 ? -6 : 6 };
  };

  const potShown = vis.pot;
  const hand = snap?.hand ?? null;
  const preset = useMemo(() => {
    if (!legal) return [];
    const pot = legal.pot + legal.callAmount;
    const mk = (f: number): number => Math.max(legal.minRaiseTo, Math.min(legal.maxRaiseTo, Math.round(legal.currentBet + pot * f)));
    return [
      { label: '½ bote', v: mk(0.5) },
      { label: '¾ bote', v: mk(0.75) },
      { label: 'Bote', v: mk(1) },
    ];
  }, [legal]);

  if (!snap) return <Spinner label="Conectando con la mesa…" />;

  return (
    <div className="mx-auto max-w-6xl px-3 py-6 sm:px-6">
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <Link to="/poker" className="inline-flex items-center gap-1.5 text-sm text-niebla hover:text-marfil"><ArrowLeft className="h-4 w-4" /> Mesas</Link>
        <h1 className="text-3xl text-marfil sm:text-4xl">{snap.table.name}</h1>
        <span className="text-sm text-niebla">Ciegas {credits(snap.table.smallBlind)}/{credits(snap.table.bigBlind)}</span>
        <span className={cx('ml-auto inline-flex items-center gap-1.5 text-xs', connected ? 'text-exito' : 'text-aviso')}>
          {connected ? <Wifi className="h-3.5 w-3.5" /> : <WifiOff className="h-3.5 w-3.5" />} {connected ? 'En directo' : 'Reconectando…'}
        </span>
        {heroSeat !== null ? (
          <Button variant="danger" size="sm" onClick={() => socket.send({ t: 'poker.leave', tableId })}><LogOut className="h-4 w-4" /> Levantarse</Button>
        ) : (
          <Button size="sm" onClick={openSit}>Sentarse</Button>
        )}
      </div>
      {snap.demo && (
        <p className="mb-3 rounded-xl border border-linea bg-abismo/70 px-4 py-2 text-sm text-niebla">
          Mesa de demostración: ahora mismo solo juegan bots. Siéntate para jugar contra ellos.
        </p>
      )}

      <div className="relative rounded-[50%/40%] p-2">
        <Stage width={g.w} height={g.h} maxHeightVh={narrow ? 92 : 70}>
          {/* Mesa ovalada */}
          <div className="rail absolute rounded-[50%]" style={{ left: g.cx - g.rx + 20, top: g.cy - g.ry + 60, width: (g.rx - 20) * 2, height: (g.ry - 60) * 2 }} />
          <div className="felt absolute rounded-[50%] shadow-[inset_0_0_60px_rgba(0,0,0,0.6)]" style={{ left: g.cx - g.rx + 44, top: g.cy - g.ry + 84, width: (g.rx - 44) * 2, height: (g.ry - 84) * 2 }} />
          <div className="absolute rounded-[50%] border border-[#e8d9b0]/20" style={{ left: g.cx - g.rx + 80, top: g.cy - g.ry + 115, width: (g.rx - 80) * 2, height: (g.ry - 115) * 2 }} />
          {/* Bandeja del crupier */}
          <div className="absolute flex items-center gap-1" style={{ left: DEALER_POS.x - 40, top: DEALER_POS.y - 26 }} aria-hidden>
            <div className="h-[52px] w-[38px] rotate-[-4deg] drop-shadow"><CardBack /></div>
            <div className="h-[52px] w-[38px] rotate-[3deg] drop-shadow"><CardBack /></div>
          </div>

          {/* Bote */}
          <div className="absolute flex -translate-x-1/2 flex-col items-center" style={{ left: POT_POS.x, top: POT_POS.y - 10 }}>
            <AnimatePresence>
              {potShown > 0 && (
                <motion.div key="pot" initial={{ opacity: 0, scale: 0.8 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0 }} className="flex flex-col items-center">
                  <ChipStack amount={potShown} size={34} />
                  <span className="mt-1 rounded-full bg-black/60 px-3 py-0.5 font-display text-base text-oro-claro">Bote {credits(potShown)}</span>
                </motion.div>
              )}
            </AnimatePresence>
          </div>
          {vis.winningHand && (
            <div className="absolute -translate-x-1/2 rounded-full border border-oro/50 bg-black/70 px-4 py-1 font-display text-lg text-oro-claro" style={{ left: g.cx, top: g.boardY - 88 }}>
              {vis.winningHand}
            </div>
          )}

          {/* Cartas comunitarias */}
          {vis.board.map((c, i) => {
            const p = boardSlot(i, g);
            return <TableCard key={`${vis.handId}-b${i}`} card={c} faceUp x={p.x} y={p.y} z={40 + i} from={DEALER_POS} width={66} speed={speed} highlight={bestCards.includes(c)} dim={bestCards.length > 0 && !bestCards.includes(c)} />;
          })}

          {/* Cartas privadas */}
          {Object.entries(vis.dealt).flatMap(([s, count]) => {
            const seat = Number(s);
            if (vis.folded[seat] && !vis.revealed[seat]) return [];
            return Array.from({ length: count }, (_, i) => {
              const p = holeCardPos(seat, i);
              const card = vis.revealed[seat]?.[i] ?? null;
              return (
                <TableCard
                  key={`${vis.handId}-${seat}-${i}`}
                  card={card}
                  faceUp={card !== null}
                  x={p.x}
                  y={p.y}
                  rotate={p.rotate}
                  z={50 + i}
                  from={DEALER_POS}
                  width={seat === heroSeat ? 62 : 50}
                  speed={speed}
                  highlight={!!card && bestCards.includes(card)}
                  sound={i === 0 && seat === heroSeat}
                />
              );
            });
          })}

          {/* Apuestas frente a cada asiento */}
          {Object.entries(vis.bets).map(([s, amount]) => {
            const p = towardCenter(posOf(Number(s)), 0.57, g);
            return (
              <motion.div key={`bet-${s}`} className="absolute flex -translate-x-1/2 -translate-y-1/2 flex-col items-center" style={{ left: p.x, top: p.y, zIndex: 45 }} initial={{ opacity: 0 }} animate={{ opacity: 1 }}>
                <ChipStack amount={amount} size={28} max={6} />
                <span className="mt-0.5 rounded bg-black/60 px-1.5 text-[11px] text-marfil">{credits(amount)}</span>
              </motion.div>
            );
          })}

          {/* Fichas en vuelo */}
          {flights.map((f) => (
            <motion.div key={f.id} className="absolute left-0 top-0" style={{ zIndex: 70 }} initial={{ x: f.from.x - 14, y: f.from.y - 14, opacity: 1 }} animate={{ x: f.to.x - 14, y: f.to.y - 14 }} transition={{ duration: 0.5 * speed, ease: [0.22, 1, 0.36, 1] }}>
              <ChipStack amount={f.amount} size={28} max={4} />
            </motion.div>
          ))}

          {/* Botón de dealer y ciegas */}
          {vis.button >= 0 && (
            <motion.div className="absolute grid h-7 w-7 place-items-center rounded-full border border-black/30 bg-gradient-to-b from-white to-[#d8d2c2] text-xs font-extrabold text-noche shadow" style={{ zIndex: 55 }} animate={(() => { const p = towardCenter(posOf(vis.button), 0.3, g); return { left: p.x + 44, top: p.y - 14 }; })()} transition={{ type: 'spring', stiffness: 200, damping: 26 }} aria-label="Botón de dealer">
              D
            </motion.div>
          )}

          {/* Asientos */}
          {snap.seats.map((seat, i) => (
            <SeatBadge
              key={i}
              seat={seat}
              index={i}
              pos={posOf(i)}
              vis={vis}
              isTurn={vis.toAct === i}
              deadline={vis.toAct === i ? snap.deadline : null}
              clockOffset={clockOffset}
              canSit={heroSeat === null && !!user}
              onSit={openSit}
            />
          ))}

          {shuffling && <ShuffleAnimation x={DEALER_POS.x} y={DEALER_POS.y + 40} to={DEALER_POS} width={40} speed={speed * 0.55} onDone={() => setShuffling(false)} />}
          <div className="absolute right-4 top-4">
            <SkipButton visible={animating && queue.current.length === 0 && seq.current.busy} onSkip={() => seq.current.skip()} />
          </div>
        </Stage>
      </div>

      {/* Controles del jugador */}
      <div className="panel mt-4 p-4 sm:p-5">
        {heroSeat === null ? (
          <div className="flex flex-wrap items-center justify-between gap-3 text-sm text-niebla">
            <span>Estás mirando la mesa. Siéntate en un asiento libre para jugar.</span>
            <Button onClick={openSit}>Sentarse</Button>
          </div>
        ) : legal ? (
          <div className="flex flex-col gap-4">
            <div className="flex flex-wrap items-center gap-2">
              {legal.canFold && <Button variant="danger" onClick={() => send('fold')} disabled={pending}>No ir</Button>}
              {legal.canCheck ? (
                <Button variant="outline" onClick={() => send('check')} disabled={pending}>Pasar</Button>
              ) : (
                <Button variant="outline" onClick={() => send('call')} disabled={pending}>Igualar {credits(legal.callAmount)}</Button>
              )}
              {legal.canRaise && (
                <>
                  <Button onClick={() => send(raiseTo >= legal.maxRaiseTo ? 'allin' : legal.isBet ? 'bet' : 'raise', raiseTo >= legal.maxRaiseTo ? undefined : raiseTo)} disabled={pending}>
                    {raiseTo >= legal.maxRaiseTo ? 'All-in' : legal.isBet ? `Apostar ${credits(raiseTo)}` : `Subir a ${credits(raiseTo)}`}
                  </Button>
                  <div className="flex flex-1 items-center gap-3">
                    <input
                      type="range"
                      min={legal.minRaiseTo}
                      max={legal.maxRaiseTo}
                      step={Math.max(1, Math.round(snap.table.bigBlind / 2))}
                      value={raiseTo}
                      onChange={(e) => setRaiseTo(Number(e.target.value))}
                      className="min-w-[140px] flex-1 accent-[#cfae6b]"
                      aria-label="Importe de la apuesta"
                    />
                    <div className="flex gap-1">
                      {preset.map((p) => (
                        <button key={p.label} onClick={() => setRaiseTo(p.v)} className="rounded-full border border-linea px-2.5 py-1 text-xs text-niebla hover:border-oro/60 hover:text-marfil">{p.label}</button>
                      ))}
                      <button onClick={() => setRaiseTo(legal.maxRaiseTo)} className="rounded-full border border-rubi/50 px-2.5 py-1 text-xs text-[#f1a3ad] hover:bg-rubi/15">All-in</button>
                    </div>
                  </div>
                </>
              )}
              {!legal.canRaise && !legal.canCheck && legal.callAmount < legal.maxRaiseTo && <span className="text-xs text-niebla">No puedes volver a subir: la última subida fue incompleta.</span>}
            </div>
            <p className="text-xs text-niebla">Es tu turno. Si se agota el tiempo, pasarás si es posible o te retirarás.</p>
          </div>
        ) : (
          <div className="flex flex-wrap items-center justify-between gap-2 text-sm text-niebla">
            <span>{hand && hand.toAct !== null && hand.toAct !== heroSeat ? `Turno de ${snap.seats[hand.toAct]?.name ?? '…'}` : hand ? 'Esperando…' : 'La siguiente mano empieza en breve.'}</span>
            <OddsNote />
          </div>
        )}
      </div>

      {/* Historial de manos */}
      <div className="panel mt-4 p-5">
        <h2 className="mb-3 text-xl text-marfil">Últimas manos</h2>
        {snap.history.length === 0 ? (
          <p className="text-sm text-niebla">Aún no se ha jugado ninguna mano en esta sesión de la mesa.</p>
        ) : (
          <ul className="space-y-2 text-sm">
            {snap.history.map((h) => (
              <li key={h.handId} className="flex flex-wrap items-center gap-x-4 gap-y-1 border-b border-linea/40 pb-2">
                <span className="text-marfil">{h.winners.map((w) => `${w.name}${w.isBot ? ' (bot)' : ''}`).join(', ')}</span>
                <span className="text-oro-claro">+{credits(h.winners.reduce((a, w) => a + w.amount, 0))}</span>
                <span className="text-niebla">{h.winners[0]?.handName ?? 'sin showdown'}</span>
                <span className="ml-auto font-mono text-xs text-niebla">{h.board.join(' ')}</span>
              </li>
            ))}
          </ul>
        )}
      </div>

      <Modal open={sitOpen} onClose={() => setSitOpen(false)} title={`Sentarse en ${snap.table.name}`}>
        <p className="text-sm text-niebla">Elige con cuántos créditos entras. Al levantarte, las fichas que tengas vuelven a tu saldo.</p>
        <div className="mt-6 text-center font-display text-4xl text-oro-claro">{credits(buyIn)}</div>
        <input
          type="range"
          className="mt-4 w-full accent-[#cfae6b]"
          min={snap.table.minBuyIn}
          max={user?.unlimited ? snap.table.maxBuyIn : Math.min(snap.table.maxBuyIn, user?.balance ?? 0)}
          step={snap.table.bigBlind}
          value={buyIn}
          onChange={(e) => setBuyIn(Number(e.target.value))}
          aria-label="Entrada"
        />
        <div className="mt-1 flex justify-between text-xs text-niebla"><span>{credits(snap.table.minBuyIn)}</span><span>{credits(snap.table.maxBuyIn)}</span></div>
        <div className="mt-6 flex justify-end gap-2">
          <Button variant="ghost" onClick={() => setSitOpen(false)}>Cancelar</Button>
          <Button
            onClick={() => {
              socket.send({ t: 'poker.sit', tableId, buyIn });
              setSitOpen(false);
            }}
          >
            Sentarme con {credits(buyIn)}
          </Button>
        </div>
      </Modal>
    </div>
  );
}
