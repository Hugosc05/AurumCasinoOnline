import { DEFAULT_BLACKJACK_RULES, type BjAction, type BjEvent, type BjOutcome, type BjPublicState } from '@aurum/engine';
import { AnimatePresence, motion } from 'motion/react';
import { Eraser, Hand, Layers, PlusCircle, Repeat2, Split, Square } from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ChipStack } from '../../components/Chip';
import { ChipRack, GameHeader, OddsNote, SkipButton } from '../../components/GameKit';
import { useFlyingChips } from '../../components/FlyingChips';
import { CardBack } from '../../components/PlayingCard';
import { Celebration, type CelebrationHandle } from '../../components/Celebration';
import { ShuffleAnimation } from '../../components/ShuffleAnimation';
import { Stage } from '../../components/Stage';
import { TableCard } from '../../components/TableCard';
import { Button, Spinner } from '../../components/ui';
import { ApiError, api, newKey } from '../../lib/api';
import { Sequencer, type SequenceStep } from '../../lib/anim/sequencer';
import { DURATION } from '../../lib/anim/tokens';
import { audio } from '../../lib/audio';
import { credits, cx } from '../../lib/format';
import { useNotify } from '../../state/notify';
import { useSession } from '../../state/session';
import type { Achievement, Balance } from '../../state/types';
import { Dealer, type DealerPose } from './Dealer';
import { CARD_W, EMPTY_VIEW, LANDSCAPE, PORTRAIT, applyEvent, cardPosition, displayValue, handCenter, viewFromState, type TableView } from './model';

interface RoundResponse {
  roundId: string;
  seq: number;
  state: BjPublicState;
  events: BjEvent[];
  balance: Balance;
  achievements: Achievement[];
}

type Phase = 'loading' | 'betting' | 'animating' | 'player' | 'settled';

const OUTCOME_TEXT: Record<BjOutcome, string> = { blackjack: 'Blackjack', win: 'Gana', push: 'Empate', lose: 'Pierde', bust: 'Se pasa' };
/** Ángulo del brazo del crupier hacia un punto (hombro derecho del avatar en coordenadas del escenario). */
const reachFrom = (shoulder: { x: number; y: number }) => (x: number, y: number): number =>
  Math.max(-70, Math.min(55, (-Math.atan2(x - shoulder.x, y - shoulder.y) * 180) / Math.PI));

function useNarrow(): boolean {
  const q = '(max-width: 640px)';
  const [n, setN] = useState(() => window.matchMedia(q).matches);
  useEffect(() => {
    const mq = window.matchMedia(q);
    const on = (): void => setN(mq.matches);
    mq.addEventListener('change', on);
    return () => mq.removeEventListener('change', on);
  }, []);
  return n;
}

const ACTION_LABEL: Record<BjAction, string> = { hit: 'Pedir', stand: 'Plantarse', double: 'Doblar', split: 'Dividir' };
const ACTION_KEY: Record<BjAction, string> = { hit: 'h', stand: 's', double: 'd', split: 'p' };

export default function BlackjackPage() {
  const { user, setBalance, speed, motion: level, effects } = useSession();
  const { notify, celebrate } = useNotify();
  const { layer, fly } = useFlyingChips(speed);
  const narrow = useNarrow();
  const g = narrow ? PORTRAIT : LANDSCAPE;
  const geomRef = useRef(g);
  geomRef.current = g;
  const SHOE = g.shoe;
  const BET_SPOT = g.betSpot;
  const DEALER_ROW = g.dealerRow;
  const STAGE = g.stage;
  const rackRef = useRef<HTMLDivElement>(null);
  const betSpotRef = useRef<HTMLDivElement>(null);

  const [phase, setPhase] = useState<Phase>('loading');
  const [view, setView] = useState<TableView>(EMPTY_VIEW);
  // Los totales solo cuentan cartas cuya cara ya se ve (no mientras vuelan o giran).
  const [shownIds, setShownIds] = useState<ReadonlySet<string>>(() => new Set());
  const [round, setRound] = useState<{ id: string; seq: number; state: BjPublicState } | null>(null);
  const [bet, setBet] = useState(0);
  const [lastBet, setLastBet] = useState(0);
  const [chip, setChip] = useState(25);
  const [pose, setPose] = useState<{ pose: DealerPose; reach: number }>({ pose: 'idle', reach: 0 });
  const [shuffling, setShuffling] = useState(false);
  const [pending, setPending] = useState<BjAction | 'deal' | null>(null);
  const [shoe, setShoe] = useState<{ remaining: number; size: number } | null>(null);
  const [skippable, setSkippable] = useState(false);
  /** Cartas en proceso de recogida hacia la bandeja de descartes. */
  const [collecting, setCollecting] = useState(false);
  const [discarded, setDiscarded] = useState(0);
  /** La carta oculta del crupier se revela con un giro destacado. */
  const [dramaticReveal, setDramaticReveal] = useState(false);
  /** Estado narrado de la mano (turno del crupier, te plantas…). */
  const [status, setStatus] = useState<string | null>(null);
  const fx = useRef<CelebrationHandle>(null);
  const viewRef = useRef(view);
  viewRef.current = view;
  const seq = useRef<Sequencer | null>(null);
  if (!seq.current) seq.current = new Sequencer(speed);
  seq.current.setSpeed(speed);

  useEffect(() => () => seq.current?.cancel(), []);
  // Se olvidan las cartas que ya no están en la mesa (o que vuelven a estar boca abajo).
  useEffect(() => {
    setShownIds((prev) => {
      const keep = new Set(view.cards.filter((c) => c.faceUp && prev.has(c.id)).map((c) => c.id));
      return keep.size === prev.size ? prev : keep;
    });
  }, [view]);
  const markShown = useCallback((id: string) => setShownIds((prev) => (prev.has(id) ? prev : new Set(prev).add(id))), []);
  const valueView = useMemo<TableView>(() => ({ ...view, cards: view.cards.filter((c) => shownIds.has(c.id)) }), [view, shownIds]);

  // Recuperación de una mano en curso (recarga de página o reconexión).
  useEffect(() => {
    api.get<{ round: { roundId: string; seq: number; state: BjPublicState } | null; shoe: { remaining: number; size: number } | null }>('/api/games/blackjack/current')
      .then((r) => {
        setShoe(r.shoe);
        if (r.round) {
          setRound({ id: r.round.roundId, seq: r.round.seq, state: r.round.state });
          setView(viewFromState(r.round.state));
          setBet(r.round.state.hands[0]?.bet ?? 0);
          setPhase('player');
        } else {
          setPhase('betting');
        }
      })
      .catch(() => setPhase('betting'));
  }, []);

  /** Convierte los eventos del servidor en una secuencia de animación. */
  const play = useCallback(
    async (res: RoundResponse) => {
      setPhase('animating');
      setSkippable(true);
      const steps: SequenceStep[] = [];
      for (const e of res.events) {
        switch (e.type) {
          case 'shuffle':
            steps.push({ name: 'barajar', duration: DURATION.shuffle, run: () => { setPose({ pose: 'shuffle', reach: 0 }); setShuffling(true); setDiscarded(0); setStatus('Barajando el zapato'); } });
            steps.push({ name: 'fin-barajar', duration: 120, run: () => { setShuffling(false); setPose({ pose: 'idle', reach: 0 }); setStatus(null); } });
            break;
          case 'deal':
            steps.push({
              name: 'repartir',
              duration: DURATION.card + DURATION.cardGap,
              run: () =>
                setView((v) => {
                  const next = applyEvent(v, e);
                  const c = next.cards[next.cards.length - 1]!;
                  const geo = geomRef.current;
                  const p = cardPosition(c, next, geo);
                  setPose({ pose: 'deal', reach: reachFrom({ x: geo.dealerBox.left + 84, y: 112 })(p.x, p.y) });
                  return next;
                }),
            });
            break;
          case 'split':
            steps.push({ name: 'dividir', duration: 520, run: () => { audio.play('chips'); setView((v) => applyEvent(v, e)); } });
            break;
          case 'double':
            steps.push({ name: 'doblar', duration: 380, run: () => { audio.play('chips'); setView((v) => applyEvent(v, e)); } });
            break;
          case 'reveal':
            steps.push({ name: 'turno-crupier', duration: 420, run: () => { setPose({ pose: 'reveal', reach: -30 }); setStatus('Turno del crupier'); setDramaticReveal(true); } });
            steps.push({ name: 'revelar', duration: DURATION.flip * 1.35 + 420, run: () => setView((v) => applyEvent(v, e)) });
            steps.push({ name: 'fin-revelado', duration: 0, run: () => setDramaticReveal(false) });
            break;
          case 'active':
            steps.push({ name: 'turno', duration: 0, run: () => setView((v) => applyEvent(v, e)) });
            break;
          case 'settle':
            steps.push({
              name: 'liquidar',
              duration: 700,
              skippable: false,
              run: () => {
                setView((v) => ({ ...applyEvent(v, e), hands: res.state.hands.map((h) => ({ bet: h.bet, doubled: h.doubled, outcome: h.outcome, payout: h.payout })) }));
                const anyWin = res.state.hands.some((h) => h.outcome === 'win' || h.outcome === 'blackjack');
                setPose({ pose: anyWin ? 'pay' : 'collect', reach: -20 });
              },
            });
            break;
        }
      }
      steps.push({ name: 'reposo', duration: 250, run: () => setPose((p) => (p.pose === 'pay' || p.pose === 'collect' ? { pose: 'nod', reach: 0 } : { pose: 'idle', reach: 0 })) });
      await seq.current!.play(steps);
      setSkippable(false);
      setStatus(null);
      setDramaticReveal(false);
      setShoe({ remaining: res.state.shoeRemaining, size: res.state.shoeSize });
      setRound({ id: res.roundId, seq: res.seq, state: res.state });
      if (res.state.phase === 'settled') {
        setBalance(res.balance);
        celebrate(res.achievements);
        const outcomes = res.state.hands.map((h) => h.outcome);
        if (outcomes.includes('blackjack')) audio.play('winBig');
        else if (outcomes.includes('win')) audio.play('winMedium');
        else if (outcomes.every((o) => o === 'push')) audio.play('push');
        else audio.play('lose');
        // Efectos proporcionados al resultado real de cada mano.
        const geo = geomRef.current;
        res.state.hands.forEach((h, i) => {
          const c = handCenter(i, res.state.hands.length, geo);
          const pt = { x: c.x / geo.stage.w, y: c.y / geo.stage.h };
          if (h.outcome === 'blackjack') {
            fx.current?.play('burst', [pt]);
            audio.play('coins', 250);
          } else if (h.outcome === 'win') fx.current?.play('sparkle', [pt]);
        });
        setPhase('settled');
        window.setTimeout(() => setPose({ pose: 'idle', reach: 0 }), 1200);
      } else {
        setPose({ pose: 'idle', reach: 0 });
        setPhase('player');
      }
    },
    [setBalance, celebrate],
  );

  const addChip = (chipValue: number): void => {
    if (phase !== 'betting' && phase !== 'settled') return;
    const base = phase === 'settled' ? 0 : bet;
    const next = Math.min(DEFAULT_BLACKJACK_RULES.maxBet, base + chipValue);
    const available = user?.unlimited ? Infinity : user?.balance ?? 0;
    if (next > available) {
      notify('error', 'No tienes saldo suficiente para esa ficha.');
      return;
    }
    if (next === base) {
      notify('info', `Apuesta máxima: ${credits(DEFAULT_BLACKJACK_RULES.maxBet)}`);
      return;
    }
    if (phase === 'settled') newHand(false);
    audio.play('chip', DURATION.chip * speed * 0.85);
    const from = rackRef.current?.querySelector(`[data-chip="${chipValue}"]`) ?? null;
    window.setTimeout(() => void fly(from, betSpotRef.current, chipValue, 40), 0);
    setBet(next);
  };

  /** Recoge las cartas de la mano anterior hacia la bandeja de descartes (boca abajo). */
  const collectCards = async (): Promise<void> => {
    const n = viewRef.current.cards.length;
    if (n === 0) return;
    setCollecting(true);
    setPose({ pose: 'collect', reach: 0 });
    audio.play('cardSlide');
    await new Promise((r) => window.setTimeout(r, Math.max(30, 520 * speed)));
    setDiscarded((d) => d + n);
    setView(EMPTY_VIEW);
    setCollecting(false);
    setPose({ pose: 'idle', reach: 0 });
  };

  const newHand = (keepBet: boolean): void => {
    void collectCards();
    setRound(null);
    setPhase('betting');
    if (!keepBet) setBet(0);
  };

  const deal = async (amount = bet): Promise<void> => {
    if (pending || seq.current?.busy) return;
    if (amount < DEFAULT_BLACKJACK_RULES.minBet) {
      notify('info', `Apuesta mínima: ${DEFAULT_BLACKJACK_RULES.minBet}`);
      return;
    }
    setPending('deal');
    if (user && !user.unlimited && user.balance !== null) setBalance({ balance: user.balance - amount, unlimited: false });
    try {
      // La petición y la recogida de la mano anterior van en paralelo.
      const request = api.post<RoundResponse>('/api/games/blackjack/start', { bet: amount, idempotencyKey: newKey() });
      if (phase === 'settled') {
        setBet(amount);
        await collectCards();
      }
      const res = await request;
      setLastBet(amount);
      setView({ ...EMPTY_VIEW, hands: [{ bet: amount, doubled: false }] });
      setPending(null);
      await play(res);
    } catch (err) {
      setPending(null);
      if (user) setBalance({ balance: user.balance, unlimited: user.unlimited });
      setPhase('betting');
      notify('error', err instanceof ApiError ? err.message : 'No se pudo repartir.');
    }
  };

  const act = async (action: BjAction): Promise<void> => {
    if (!round || pending || seq.current?.busy || phase !== 'player') return;
    if (!round.state.legalActions.includes(action)) return;
    setPending(action);
    setStatus(action === 'stand' ? 'Te plantas' : action === 'double' ? 'Doblas la apuesta: una sola carta' : action === 'split' ? 'Divides la pareja' : null);
    const extra = action === 'double' || action === 'split' ? round.state.hands[round.state.active]!.bet : 0;
    if (extra && user && !user.unlimited && user.balance !== null) setBalance({ balance: user.balance - extra, unlimited: false });
    try {
      const res = await api.post<RoundResponse>('/api/games/blackjack/action', { roundId: round.id, action, seq: round.seq });
      setPending(null);
      await play(res);
    } catch (err) {
      setPending(null);
      if (user) setBalance({ balance: user.balance, unlimited: user.unlimited });
      const e = err as ApiError;
      notify('error', e.message ?? 'Acción rechazada');
      if (e.code === 'STALE_ACTION' || e.code === 'ROUND_CLOSED') {
        // Resincronización con el servidor (autoridad sobre la mano).
        const cur = await api.get<{ round: { roundId: string; seq: number; state: BjPublicState } | null }>('/api/games/blackjack/current');
        if (cur.round) {
          setRound({ id: cur.round.roundId, seq: cur.round.seq, state: cur.round.state });
          setView(viewFromState(cur.round.state));
        } else newHand(true);
      }
    }
  };

  // Atajos de teclado.
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.target instanceof HTMLInputElement || e.metaKey || e.ctrlKey) return;
      const k = e.key.toLowerCase();
      if (phase === 'player') {
        const a = (Object.keys(ACTION_KEY) as BjAction[]).find((x) => ACTION_KEY[x] === k);
        if (a) void act(a);
      } else if ((phase === 'betting' || phase === 'settled') && k === 'enter') {
        void deal(phase === 'settled' ? lastBet : bet);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  if (phase === 'loading') return <Spinner label="Preparando la mesa…" />;

  const handCount = Math.max(1, view.hands.length);
  const legal = phase === 'player' && round ? round.state.legalActions : [];
  const dealerValue = displayValue(valueView, 'dealer');
  const showBetSpot = view.hands.length === 0;

  return (
    <div className="mx-auto max-w-6xl px-3 py-8 sm:px-6">
      {layer}
      <GameHeader title="Blackjack" subtitle="Seis barajas, el crupier se planta en 17, blackjack 3 a 2." />
      <div className="rail relative rounded-[44px] p-2.5 sm:rounded-[64px] sm:p-3.5">
       <div className="felt relative overflow-hidden rounded-[36px] shadow-[inset_0_0_80px_rgba(0,0,0,0.55)] sm:rounded-[54px]">
        <Stage width={STAGE.w} height={STAGE.h} maxHeightVh={72}>
          {/* Leyendas del tapete */}
          <svg className="pointer-events-none absolute inset-0" width={STAGE.w} height={STAGE.h} aria-hidden>
            <path id="arcText" d={g.arc} fill="none" />
            <text fill="#e8d9b0" fillOpacity="0.5" fontSize={narrow ? 15 : 19} fontFamily="'Bodoni Moda Variable', serif" letterSpacing="2">
              <textPath href="#arcText" startOffset="50%" textAnchor="middle">Blackjack paga 3 a 2, el crupier se planta en 17</textPath>
            </text>
            <circle cx={BET_SPOT.x} cy={BET_SPOT.y} r="44" fill="none" stroke="#e8d9b0" strokeOpacity="0.45" strokeWidth="2" strokeDasharray="6 6" />
          </svg>

          {/* Crupier */}
          <div className="absolute" style={{ left: g.dealerBox.left, top: g.dealerBox.top, width: 260, height: 200 }}>
            <Dealer pose={pose.pose} reach={pose.reach} speed={speed} breathing={level === 'full'} />
          </div>

          {/* Zapato */}
          <div className="absolute" style={{ left: SHOE.x - 70, top: SHOE.y - 78 }} aria-label={shoe ? `Zapato: quedan ${shoe.remaining} cartas de ${shoe.size}` : 'Zapato'}>
            <div className="relative h-[150px] w-[140px]">
              <div className="absolute left-[24px] top-[18px] h-[129px] w-[92px] rotate-[-8deg]"><CardBack /></div>
              <div className="absolute inset-x-0 bottom-0 h-[86px] rounded-b-2xl rounded-t-md border border-black/40 bg-gradient-to-b from-[#3d2817] to-[#1a0f07] shadow-[inset_0_2px_0_rgba(255,220,170,0.2)]" />
              <div className="absolute bottom-3 left-4 right-4 h-1.5 overflow-hidden rounded-full bg-black/50">
                <div className="h-full rounded-full bg-oro/80" style={{ width: `${shoe ? (shoe.remaining / shoe.size) * 100 : 100}%` }} />
              </div>
            </div>
          </div>

          {/* Valor del crupier */}
          <AnimatePresence>
            {dealerValue && (
              <motion.div key="dv" initial={{ opacity: 0, scale: 0.8 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0 }} className="absolute rounded-full border border-white/15 bg-black/55 px-3 py-1 font-display text-lg text-marfil" style={{ left: DEALER_ROW.x - (narrow ? 140 : 190), top: DEALER_ROW.y - 18 }}>
                {dealerValue}
              </motion.div>
            )}
          </AnimatePresence>

          {/* Bandeja de descartes */}
          <div className="absolute" style={{ left: g.discard.x - 58, top: g.discard.y - 70 }} aria-label={`Descartes: ${discarded} cartas`}>
            <div className="relative h-[140px] w-[116px] rounded-xl border border-black/40 bg-gradient-to-b from-[#2d1d10]/80 to-[#140b05]/80 shadow-[inset_0_2px_0_rgba(255,220,170,0.15)]">
              {Array.from({ length: Math.min(6, Math.ceil(discarded / 4)) }, (_, i) => (
                <div key={i} className="absolute left-[12px] h-[92px] w-[92px] rotate-90" style={{ top: 22 - i * 2 }}>
                  <div className="h-[92px] w-[66px] translate-x-[13px]"><CardBack /></div>
                </div>
              ))}
            </div>
          </div>

          {/* Estado narrado de la mano */}
          <AnimatePresence>
            {status && (
              <motion.div key={status} initial={{ opacity: 0, y: -6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} className="absolute -translate-x-1/2 rounded-full border border-oro/40 bg-black/65 px-4 py-1.5 text-sm text-oro-claro" style={{ left: DEALER_ROW.x, top: DEALER_ROW.y + 82 }} role="status">
                {status}
              </motion.div>
            )}
          </AnimatePresence>

          {/* Cartas */}
          {view.cards.map((c) => {
            const p = cardPosition(c, view, g);
            const isActive = view.active !== null && c.owner === view.active && handCount > 1;
            const outcome = c.owner === 'dealer' ? undefined : view.hands[c.owner]?.outcome;
            return (
              <TableCard
                key={c.id}
                card={c.card}
                faceUp={c.faceUp}
                x={p.x}
                y={p.y}
                rotate={p.rotate}
                z={(c.owner === 'dealer' ? 10 : 30) + c.index}
                from={c.fromShoe ? SHOE : null}
                collectTo={collecting ? g.discard : null}
                width={CARD_W}
                speed={speed}
                highlight={isActive || (outcome !== undefined && (outcome === 'win' || outcome === 'blackjack'))}
                dim={outcome === 'lose' || outcome === 'bust'}
                shake={outcome === 'bust'}
                dramatic={dramaticReveal && c.owner === 'dealer' && c.index === 1}
                onFaceShown={() => markShown(c.id)}
              />
            );
          })}

          {/* Manos del jugador: valor, apuesta y resultado */}
          {view.hands.map((h, i) => {
            const c = handCenter(i, handCount, g);
            const value = displayValue(valueView, i as 0 | 1);
            const outcomeGood = h.outcome === 'win' || h.outcome === 'blackjack';
            const centerX = STAGE.w / 2;
            // El total se coloca a la izquierda de la carta más a la izquierda (sin taparse con ella).
            const first = view.cards.find((vc) => vc.owner === i && vc.index === 0);
            const leftEdge = first ? cardPosition(first, view, g).x - CARD_W / 2 : c.x - CARD_W / 2;
            return (
              <div key={i}>
                {value && (
                  <div className={cx('absolute rounded-full border px-3 py-1 font-display text-lg', view.active === i ? 'border-oro-claro bg-black/70 text-oro-claro' : 'border-white/15 bg-black/55 text-marfil')} style={{ left: leftEdge - 10, top: c.y + 40, transform: 'translateX(-100%)', whiteSpace: 'nowrap' }}>
                    {value}
                  </div>
                )}
                <div className="absolute" style={{ left: c.x - 20, top: c.y + 82 }}>
                  <AnimatePresence>
                    <motion.div
                      key={`b${i}-${h.bet}`}
                      initial={{ opacity: 0, y: 12 }}
                      animate={h.outcome && !outcomeGood && h.outcome !== 'push' ? { opacity: 0, y: -260, x: centerX - c.x } : { opacity: 1, y: 0, x: 0 }}
                      transition={{ duration: 0.7 * Math.max(speed, 0.3), ease: [0.22, 1, 0.36, 1] }}
                    >
                      <ChipStack amount={h.bet} size={40} />
                    </motion.div>
                  </AnimatePresence>
                  {outcomeGood && h.payout !== undefined && (
                    <motion.div className="absolute left-12 top-0" initial={{ opacity: 0, y: -260, x: centerX - c.x - 48 }} animate={{ opacity: 1, y: 0, x: 0 }} transition={{ duration: 0.75 * Math.max(speed, 0.3), ease: [0.22, 1, 0.36, 1] }}>
                      <ChipStack amount={h.payout - h.bet} size={40} />
                    </motion.div>
                  )}
                </div>
                <AnimatePresence>
                  {h.outcome && (
                    <motion.div
                      key={h.outcome}
                      initial={{ opacity: 0, scale: 0.7, y: 10 }}
                      animate={{ opacity: 1, scale: 1, y: 0 }}
                      transition={{ type: 'spring', stiffness: 380, damping: 22, delay: 0.15 }}
                      className={cx(
                        'absolute -translate-x-1/2 whitespace-nowrap rounded-2xl border px-4 py-1.5 text-center shadow-hondo',
                        outcomeGood ? 'border-oro/70 bg-noche/85' : h.outcome === 'push' ? 'border-white/25 bg-noche/80' : 'border-rubi/60 bg-noche/80',
                      )}
                      style={{ left: c.x + (handCount > 1 ? 0 : narrow ? 0 : 230), top: handCount > 1 || narrow ? c.y - 112 : c.y - 24 }}
                      role="status"
                    >
                      <span className={cx('font-display text-2xl', outcomeGood ? 'gold-text' : h.outcome === 'push' ? 'text-marfil' : 'text-[#f1a3ad]')}>{OUTCOME_TEXT[h.outcome]}</span>
                      {h.payout !== undefined && h.payout - h.bet !== 0 && (
                        <span className="ml-2 text-sm text-marfil">{h.payout - h.bet > 0 ? '+' : ''}{credits(h.payout - h.bet)}</span>
                      )}
                    </motion.div>
                  )}
                </AnimatePresence>
              </div>
            );
          })}

          {/* Casilla de apuesta antes de repartir */}
          {showBetSpot && (
            <div ref={betSpotRef} className="absolute grid place-items-center" style={{ left: BET_SPOT.x - 44, top: BET_SPOT.y - 44, width: 88, height: 88 }}>
              {bet > 0 ? (
                <div className="-mt-6"><ChipStack amount={bet} size={46} /></div>
              ) : (
                <span className="text-center text-xs text-[#e8d9b0]/60">Tu<br />apuesta</span>
              )}
            </div>
          )}

          <Celebration ref={fx} level={effects} />
          {shuffling && (
            <ShuffleAnimation x={g.shuffleAt.x} y={g.shuffleAt.y} to={SHOE} width={CARD_W} speed={speed} onDone={() => setShuffling(false)} />
          )}
          <div className="absolute right-6 top-[300px]">
            <SkipButton visible={skippable && phase === 'animating'} onSkip={() => seq.current?.skip()} />
          </div>
        </Stage>
       </div>
      </div>

      {/* Controles */}
      <div className="panel mt-5 flex flex-col gap-4 p-4 sm:p-5" aria-live="polite">
        {(phase === 'betting' || phase === 'settled') && (
          <div className="flex flex-wrap items-center justify-between gap-4">
            <div ref={rackRef}>
              <ChipRack value={chip} onChange={(v) => { setChip(v); addChip(v); }} values={[5, 25, 100, 500, 1000]} />
            </div>
            <div className="flex flex-wrap items-center gap-2">
              {phase === 'betting' && (
                <>
                  <span className="mr-2 text-sm text-niebla">Apuesta <span className="font-display text-xl text-marfil">{credits(bet)}</span></span>
                  <Button variant="ghost" size="sm" onClick={() => setBet(0)} disabled={bet === 0 || !!pending}><Eraser className="h-4 w-4" /> Retirar</Button>
                  <Button size="lg" onClick={() => void deal()} loading={pending === 'deal'} disabled={bet < DEFAULT_BLACKJACK_RULES.minBet} disabledReason={`Apuesta mínima: ${DEFAULT_BLACKJACK_RULES.minBet}`}>
                    <Layers className="h-4 w-4" /> Repartir
                  </Button>
                </>
              )}
              {phase === 'settled' && (
                <>
                  <Button variant="outline" onClick={() => newHand(false)}>Cambiar apuesta</Button>
                  <Button size="lg" onClick={() => void deal(lastBet)} loading={pending === 'deal'} disabled={!user?.unlimited && (user?.balance ?? 0) < lastBet} disabledReason="Saldo insuficiente para repetir la apuesta">
                    <Repeat2 className="h-4 w-4" /> Repetir {credits(lastBet)}
                  </Button>
                </>
              )}
            </div>
          </div>
        )}
        {(phase === 'player' || phase === 'animating') && (
          <div className="flex flex-wrap items-center justify-center gap-3">
            {(['hit', 'stand', 'double', 'split'] as BjAction[]).map((a) => {
              const allowed = legal.includes(a);
              const reason = phase === 'animating' ? 'Espera a que termine el reparto' : !allowed ? (a === 'double' ? 'Solo con tus dos primeras cartas' : a === 'split' ? 'Solo con una pareja y una vez por mano' : 'No disponible') : null;
              const icons = { hit: PlusCircle, stand: Hand, double: Square, split: Split };
              const Icon = icons[a];
              return (
                <Button
                  key={a}
                  variant={a === 'hit' || a === 'stand' ? 'gold' : 'outline'}
                  size="lg"
                  className="min-w-[132px]"
                  onClick={() => void act(a)}
                  loading={pending === a}
                  disabled={!allowed || phase !== 'player' || !!pending}
                  disabledReason={reason}
                  aria-keyshortcuts={ACTION_KEY[a]}
                >
                  <Icon className="h-4 w-4" /> {ACTION_LABEL[a]}
                  <kbd className="ml-1 hidden rounded border border-current/30 px-1 text-[10px] opacity-60 sm:inline">{ACTION_KEY[a].toUpperCase()}</kbd>
                </Button>
              );
            })}
          </div>
        )}
        <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-niebla">
          <span>Atajos: H pedir, S plantarse, D doblar, P dividir, Enter repartir.</span>
          <OddsNote />
        </div>
      </div>
    </div>
  );
}
