import { DEFAULT_SLOT_LIMITS, PAYLINES, REEL_STRIPS, SLOT_SYMBOL_LABELS, gridFromStops, type SlotSpinResult, type SlotSymbol, type WinTier } from '@aurum/engine';
import { AnimatePresence, animate, motion } from 'motion/react';
import { Minus, Play, Plus, Repeat, Sparkles, Square, Volume2, VolumeX } from 'lucide-react';
import { memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { AnimationPlaybackControls } from 'motion/react';
import { Celebration, type CelebrationHandle } from '../../components/Celebration';
import { GameHeader, OddsNote, SkipButton } from '../../components/GameKit';
import { Button, Segmented } from '../../components/ui';
import { ApiError, api, newKey } from '../../lib/api';
import { DURATION } from '../../lib/anim/tokens';
import { audio, type LoopHandle } from '../../lib/audio';
import { credits, cx } from '../../lib/format';
import { useNotify } from '../../state/notify';
import { useSession } from '../../state/session';
import type { Achievement, Balance } from '../../state/types';
import { planSlotPresentation, lineColor, type SlotPresentation } from './presentation';
import { Reel, type ReelHandle } from './Reel';
import { REEL_FULL, REEL_REDUCED, blurLevel, createReel, mod, requestStop, slamStop, snapTo, startSpin, step, type ReelState } from './reelMotion';

interface SpinResponse {
  roundId: string;
  result: SlotSpinResult;
  balance: Balance;
  achievements: Achievement[];
}

const BET_STEPS = [1, 2, 5, 10, 20, 50, 100];
const TIER_TEXT: Record<WinTier, string> = { none: '', small: 'Premio', medium: 'Buen premio', big: 'Gran premio', mega: 'Premio extraordinario' };
const TIER_MS: Record<WinTier, number> = { none: 0, small: DURATION.winSmall, medium: DURATION.winMedium, big: DURATION.winBig, mega: DURATION.winBig + 1200 };
const GAP = 8;
const LEVER_W = 56;
const NO_LINES: ReadonlySet<number> = new Set();
const NO_HIGHLIGHTS: ReadonlySet<number>[] = Array.from({ length: 5 }, () => NO_LINES);
/** Tiempos de la máquina (ms): giro mínimo antes de la primera parada y separación entre paradas. */
const SPIN_MIN = { full: 620, reduced: 300 } as const;
const STOP_GAP = { full: 230, reduced: 120 } as const;
const ANTICIPATION_MS = 900;

type Phase = 'idle' | 'spinning' | 'presenting';
/** Fase de la presentación de líneas: todas a la vez y después una a una. */
type LineStage = 'overview' | 'cycle';

function useCellSize(ref: React.RefObject<HTMLDivElement | null>): number {
  const [cell, setCell] = useState(110);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const update = (): void => {
      const w = el.clientWidth - 44 - (window.innerWidth >= 1024 ? LEVER_W : 0); // marcadores de línea y palanca
      setCell(Math.max(52, Math.min(124, Math.floor((w - 4 * GAP) / 5), Math.floor((window.innerHeight * 0.4) / 3))));
    };
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
  }, [ref]);
  return cell;
}

/** Marcadores numerados de las líneas a ambos lados de los rodillos (como en una máquina real). */
const LineMarkers = memo(function LineMarkers({ side, cell, lines, winning, active }: { side: 'left' | 'right'; cell: number; lines: number; winning: ReadonlySet<number>; active: number | null }) {
  const byRow: number[][] = [[], [], []];
  PAYLINES.forEach((rows, i) => byRow[rows[side === 'left' ? 0 : 4]!]!.push(i));
  return (
    <div className="relative w-5 shrink-0" style={{ height: cell * 3 }} aria-hidden>
      {byRow.map((ids, row) =>
        ids.map((id, k) => {
          const y = row * cell + ((k + 0.5) * cell) / ids.length;
          const on = id < lines;
          const win = winning.has(id);
          return (
            <span
              key={id}
              className={cx('absolute left-0 grid h-[13px] w-5 -translate-y-1/2 place-items-center rounded-[3px] text-[9px] font-bold leading-none transition-all duration-300', side === 'left' ? 'rounded-r-none' : 'rounded-l-none', !on && 'opacity-20')}
              style={{
                top: y,
                background: win ? lineColor(id) : on ? 'rgba(235,217,166,0.18)' : 'rgba(255,255,255,0.05)',
                color: win ? '#0b0f1a' : '#ebd9a6',
                boxShadow: active === id ? `0 0 10px ${lineColor(id)}` : undefined,
                transform: `translateY(-50%) scale(${active === id ? 1.25 : 1})`,
              }}
            >
              {id + 1}
            </span>
          );
        }),
      )}
    </div>
  );
});

/** Palanca lateral: se baja al girar (y también sirve para girar). */
function Lever({ pulls, onPull, disabled }: { pulls: number; onPull: () => void; disabled: boolean }) {
  return (
    <button type="button" onClick={onPull} disabled={disabled} className="group relative hidden h-[220px] shrink-0 cursor-pointer disabled:cursor-not-allowed lg:block" style={{ width: LEVER_W }} aria-label="Tirar de la palanca para girar">
      {/* Soporte */}
      <span className="absolute bottom-6 left-1/2 h-16 w-7 -translate-x-1/2 rounded-lg border border-oro/40 bg-gradient-to-b from-[#3a2c12] to-[#1a1408] shadow-[inset_0_2px_6px_rgba(0,0,0,0.6)]" />
      <motion.span
        key={pulls}
        className="absolute bottom-[64px] left-1/2 block w-3 origin-bottom -translate-x-1/2"
        style={{ height: 130 }}
        initial={{ scaleY: 1 }}
        animate={pulls > 0 ? { scaleY: [1, -0.55, -0.62, 1.04, 1] } : { scaleY: 1 }}
        transition={{ duration: 0.75, times: [0, 0.28, 0.4, 0.82, 1], ease: 'easeInOut' }}
      >
        <span className="absolute inset-x-0 bottom-0 top-3 rounded-full bg-gradient-to-r from-[#8c8c94] via-[#f2f2f5] to-[#7a7a82]" />
        <span className="absolute -left-[10px] -top-[14px] h-8 w-8 rounded-full bg-[radial-gradient(circle_at_35%_30%,#ff9aa5,#c3142d_55%,#5e0614)] shadow-[0_6px_14px_rgba(0,0,0,0.55)] transition-transform group-hover:scale-110" />
      </motion.span>
    </button>
  );
}

/** Fila de bombillas del marco (se encienden en secuencia al girar y al ganar). */
const Bulbs = memo(function Bulbs({ count, mode, reverse }: { count: number; mode: 'off' | 'chase' | 'win'; reverse?: boolean }) {
  return (
    <div className={cx('flex justify-between px-3', mode === 'chase' && 'bulbs-chase', mode === 'win' && 'bulbs-win')} aria-hidden>
      {Array.from({ length: count }, (_, i) => (
        <span key={i} className="bulb h-2.5 w-2.5 rounded-full" style={{ animationDelay: `${((reverse ? count - i : i) * (mode === 'win' ? 0.42 : 0.9)) / count}s` }} />
      ))}
    </div>
  );
});

export default function SlotsPage() {
  const { user, setBalance, speed, motion: level, effects, prefs, updatePrefs } = useSession();
  const { notify, celebrate } = useNotify();
  const reels = useRef<(ReelHandle | null)[]>([]);
  const windowRef = useRef<HTMLDivElement>(null);
  const cell = useCellSize(windowRef);
  const counterRef = useRef<HTMLSpanElement>(null);
  const counterAnim = useRef<AnimationPlaybackControls | null>(null);
  const fx = useRef<CelebrationHandle>(null);
  const machineFx = useRef<CelebrationHandle>(null);

  const INITIAL_STOPS = [0, 7, 14, 21, 28];
  const [stops, setStops] = useState<number[]>(INITIAL_STOPS);
  const [lines, setLines] = useState(20);
  const [betPerLine, setBetPerLine] = useState(1);
  const [phase, setPhase] = useState<Phase>('idle');
  const [result, setResult] = useState<SlotSpinResult | null>(null);
  const [plan, setPlan] = useState<SlotPresentation | null>(null);
  const [lineStage, setLineStage] = useState<LineStage>('overview');
  const [activeLine, setActiveLine] = useState<number | null>(null);
  const [anticip, setAnticip] = useState<Set<number>>(new Set());
  const [bigWin, setBigWin] = useState<{ tier: WinTier; amount: number; multiplier: number } | null>(null);
  const [auto, setAuto] = useState(0);
  const [pulls, setPulls] = useState(0);
  const [history, setHistory] = useState<{ bet: number; win: number }[]>([]);
  const autoRef = useRef(0);
  autoRef.current = auto;
  const loop = useRef<LoopHandle | null>(null);
  const presentToken = useRef(0);
  const totalBet = betPerLine * lines;
  const canAfford = user?.unlimited || (user?.balance ?? 0) >= totalBet;

  // ── Motor de los rodillos: un único bucle rAF para los cinco ──
  // Callbacks de referencia estables: no rompen la memoización de los rodillos.
  const reelRefs = useMemo(() => Array.from({ length: 5 }, (_, i) => (el: ReelHandle | null) => void (reels.current[i] = el)), []);
  const motions = useRef<ReelState[]>(REEL_STRIPS.map((strip, i) => createReel(strip.length, INITIAL_STOPS[i]!)));
  const raf = useRef<number | null>(null);
  const spinning = useRef(false);
  const slamRequested = useRef(false);
  const stopWaiters = useRef<(() => void)[]>([]);
  const onLand = useRef<(i: number) => void>(() => undefined);
  const levelRef = useRef(level);
  levelRef.current = level;

  const frame = useCallback((now: number) => {
    let active = false;
    motions.current.forEach((m, i) => {
      const r = step(m, now);
      reels.current[i]?.place(mod(m.pos, m.L), levelRef.current === 'full' ? blurLevel(m) : 0);
      if (r.landed || (r.stopped && m.cfg.settleMs === 0)) onLand.current(i);
      if (r.stopped) {
        stopWaiters.current[i]?.();
      }
      if (m.phase !== 'idle') active = true;
    });
    raf.current = active ? requestAnimationFrame(frame) : null;
  }, []);
  const kick = useCallback(() => {
    if (raf.current === null) raf.current = requestAnimationFrame(frame);
  }, [frame]);

  useEffect(
    () => () => {
      if (raf.current !== null) cancelAnimationFrame(raf.current);
      raf.current = null;
      loop.current?.stop(50);
      counterAnim.current?.stop();
      presentToken.current += 1;
      autoRef.current = 0;
    },
    [],
  );

  // Recorrido ordenado de las líneas ganadoras (después de la vista general).
  useEffect(() => {
    if (phase !== 'presenting' || !plan || plan.lines.length === 0 || lineStage !== 'cycle') {
      if (lineStage !== 'cycle') setActiveLine(null);
      return;
    }
    let i = 0;
    setActiveLine(0);
    const t = window.setInterval(() => {
      i = (i + 1) % plan.lines.length;
      setActiveLine(i);
    }, Math.max(900, 1300 * Math.max(speed, 0.5)));
    return () => clearInterval(t);
  }, [phase, plan, lineStage, speed]);

  const current = plan && activeLine !== null ? plan.lines[activeLine] ?? null : null;

  // Resaltados por rodillo, memorizados: los rodillos solo se vuelven a dibujar si cambian.
  const highlights = useMemo((): ReadonlySet<number>[] => {
    if (!plan || phase !== 'presenting' || plan.total === 0) return NO_HIGHLIGHTS;
    const sets = Array.from({ length: 5 }, () => new Set<number>());
    const wins = current ? [current] : plan.lines;
    for (const w of wins) for (const [r, row] of w.cells) sets[r]!.add(row);
    if (plan.scatter && !current) for (const [r, row] of plan.scatter.cells) sets[r]!.add(row);
    return sets;
  }, [plan, phase, current]);

  const cellCenter = (reel: number, row: number): { x: number; y: number } => ({ x: reel * (cell + GAP) + cell / 2, y: row * cell + cell / 2 });

  /** Corta cualquier presentación en curso (al volver a girar no se espera a nada). */
  const stopPresentation = (): void => {
    presentToken.current += 1;
    counterAnim.current?.stop();
    counterAnim.current = null;
    fx.current?.clear();
    machineFx.current?.clear();
    setPlan(null);
    setResult(null);
    setBigWin(null);
    setActiveLine(null);
    setLineStage('overview');
    if (counterRef.current) counterRef.current.textContent = '0';
  };

  /** Presentación de un resultado ya liquidado. No bloquea: se puede volver a girar en cualquier momento. */
  const present = (r: SlotSpinResult, p: SlotPresentation): void => {
    const token = ++presentToken.current;
    const alive = (): boolean => token === presentToken.current;
    setPlan(p);
    setPhase('presenting');
    if (p.total === 0) return;
    setLineStage('overview');
    p.lines.slice(0, 5).forEach((_, i) => audio.play('lineWin', i * 140, { rate: 1 + i * 0.125, pan: (i - 2) * 0.3 }));
    const winW = cell * 5 + GAP * 4;
    const winH = cell * 3;
    const points = [...p.lines.flatMap((l) => l.cells), ...(p.scatter?.cells ?? [])].map(([reel, row]) => {
      const c = cellCenter(reel, row);
      return { x: c.x / winW, y: c.y / winH };
    });
    if (p.celebration === 'sparkle') fx.current?.play('sparkle', points.slice(0, 8));
    if (p.celebration === 'burst') {
      fx.current?.play('sparkle', points.slice(0, 8));
      machineFx.current?.play('burst', [{ x: 0.5, y: 0.45 }]);
      audio.play('coins', 200);
    }
    if (p.celebration === 'fireworks') {
      machineFx.current?.play('fireworks', [{ x: 0.5, y: 0.45 }]);
      for (let i = 0; i < 5; i += 1) audio.play('firework', 450 + i * 330);
      audio.play('coins', 500);
    }
    if (r.tier === 'big' || r.tier === 'mega') setBigWin({ tier: r.tier, amount: r.totalWin, multiplier: r.totalWin / r.totalBet });
    audio.play(r.tier === 'big' || r.tier === 'mega' ? 'winBig' : r.tier === 'medium' ? 'winMedium' : 'winSmall', 80);
    const dur = (TIER_MS[r.tier] / 1000) * Math.max(speed, 0.2);
    const el = counterRef.current;
    if (el) {
      if (speed === 0) el.textContent = credits(r.totalWin);
      else {
        audio.countUp(dur * 1000);
        const ctl = animate(0, r.totalWin, { duration: dur, ease: 'easeOut', onUpdate: (v) => (el.textContent = credits(Math.round(v))) });
        counterAnim.current = ctl;
        void ctl.then(() => {
          if (!alive()) return;
          el.textContent = credits(r.totalWin);
        });
      }
    }
    window.setTimeout(() => alive() && setLineStage('cycle'), speed === 0 ? 0 : Math.max(900, dur * 1000 * 0.6));
    if (r.tier === 'big' || r.tier === 'mega') window.setTimeout(() => alive() && setBigWin(null), Math.max(1500, 2800 * Math.max(speed, 0.4)));
  };

  const slam = (): void => {
    if (!spinning.current) return;
    slamRequested.current = true;
    const now = performance.now();
    motions.current.forEach((m, i) => slamStop(m, now, i * 70));
    setAnticip(new Set());
  };

  const spin = useCallback(async (): Promise<void> => {
    if (spinning.current) {
      slam();
      return;
    }
    if (!canAfford) {
      notify('error', 'Saldo insuficiente para esta apuesta.');
      setAuto(0);
      return;
    }
    spinning.current = true;
    slamRequested.current = false;
    stopPresentation();
    setPhase('spinning');
    setAnticip(new Set());
    setPulls((n) => n + 1);
    if (user && !user.unlimited && user.balance !== null) setBalance({ balance: user.balance - totalBet, unlimited: false });

    const lvl = levelRef.current;
    const animated = lvl !== 'off';
    const cfg = lvl === 'full' ? REEL_FULL : REEL_REDUCED;
    const t0 = performance.now();
    const prevStops = motions.current.map((m) => mod(m.pos, m.L));
    const done = motions.current.map((_, i) => new Promise<void>((res) => (stopWaiters.current[i] = res)));
    let landedCount = 0;
    let grid: SlotSymbol[][] | null = null;

    onLand.current = (i: number) => {
      landedCount += 1;
      audio.play('reelStop', 0, { pan: (i - 2) * 0.35 });
      loop.current?.setIntensity(Math.max(0, 1 - landedCount / 5));
      reels.current[i]?.thud();
      // Anticipación honesta: con 2 estrellas ya visibles, los rodillos restantes se iluminan.
      if (grid && lvl === 'full' && !slamRequested.current) {
        const scatters = grid.slice(0, i + 1).flat().filter((x) => x === 'scatter').length;
        if (scatters >= 2 && i < 4) {
          setAnticip(new Set(Array.from({ length: 4 - i }, (_, k) => i + 1 + k)));
          audio.play('anticipation');
        } else setAnticip((a) => (a.has(i) ? new Set([...a].filter((x) => x !== i)) : a));
      }
    };

    if (animated) {
      audio.play('spinStart');
      loop.current?.stop(30);
      loop.current = audio.loop('reels');
      motions.current.forEach((m, i) => startSpin(m, t0, i * 45, cfg));
      kick();
    }

    let res: SpinResponse;
    try {
      res = await api.post<SpinResponse>('/api/games/slots/spin', { betPerLine, lines, idempotencyKey: newKey() });
    } catch (err) {
      // Sin resultado: los rodillos vuelven a la ventana anterior y no se cobra nada.
      if (animated) {
        const now = performance.now();
        motions.current.forEach((m, i) => requestStop(m, prevStops[i]!, now + i * 90, true));
        await Promise.all(done);
      }
      loop.current?.stop();
      spinning.current = false;
      setPhase('idle');
      setAuto(0);
      if (user) setBalance({ balance: user.balance, unlimited: user.unlimited });
      notify('error', err instanceof ApiError ? err.message : 'No se pudo girar.');
      return;
    }
    const r = res.result;
    grid = r.grid;

    if (animated) {
      const now = performance.now();
      const slamNow = slamRequested.current;
      const base = slamNow ? now : Math.max(now, t0 + SPIN_MIN[lvl]);
      const gap = slamNow ? 70 : STOP_GAP[lvl];
      let extra = 0;
      r.stops.forEach((stop, i) => {
        const scattersBefore = r.grid.slice(0, i).flat().filter((x) => x === 'scatter').length;
        if (lvl === 'full' && !slamNow && i >= 2 && scattersBefore >= 2) extra += ANTICIPATION_MS;
        requestStop(motions.current[i]!, stop, base + i * gap + extra, slamNow);
      });
      kick();
      await Promise.all(done);
    } else {
      motions.current.forEach((m, i) => {
        snapTo(m, r.stops[i]!);
        reels.current[i]?.place(r.stops[i]!, 0);
      });
      audio.play('reelStop');
    }

    // REELS_STOPPED: la ventana visible es exactamente la del servidor.
    loop.current?.stop(120);
    loop.current = null;
    spinning.current = false;
    setAnticip(new Set());
    setStops(r.stops);
    setResult(r);
    setBalance(res.balance);
    setHistory((h) => [{ bet: r.totalBet, win: r.totalWin }, ...h].slice(0, 12));
    celebrate(res.achievements);
    present(r, planSlotPresentation(r));

    if (autoRef.current > 0) {
      const pause = r.totalWin === 0 ? 350 : r.tier === 'big' || r.tier === 'mega' ? 2600 : 1100;
      window.setTimeout(() => {
        if (autoRef.current > 0 && !spinning.current) {
          setAuto((a) => a - 1);
          void spinRef.current();
        }
      }, pause * Math.max(speed, 0.4));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [canAfford, notify, user, setBalance, totalBet, betPerLine, lines, speed, celebrate, cell, kick]);

  const spinRef = useRef(spin);
  spinRef.current = spin;

  // Atajo: barra espaciadora para girar (o frenar si está girando).
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.code !== 'Space' || e.target instanceof HTMLInputElement || e.target instanceof HTMLButtonElement) return;
      e.preventDefault();
      void spinRef.current();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const startAuto = (n: number): void => {
    setAuto(n - 1);
    void spin();
  };

  const stepBet = (dir: 1 | -1): void => {
    const i = BET_STEPS.indexOf(betPerLine);
    setBetPerLine(BET_STEPS[Math.max(0, Math.min(BET_STEPS.length - 1, i + dir))]!);
  };

  const winW = cell * 5 + GAP * 4;
  const winH = cell * 3;
  const linePoints = (rows: readonly number[]): string => rows.map((row, reel) => `${cellCenter(reel, row).x},${cellCenter(reel, row).y}`).join(' ');
  const winningSet = useMemo(() => new Set(plan?.lines.map((l) => l.line) ?? []), [plan]);
  const tier = phase === 'presenting' && result && result.totalWin > 0 ? result.tier : null;
  const presenting = phase === 'presenting' && plan && plan.total > 0;
  const shownLines = presenting ? (lineStage === 'overview' ? plan.lines : current ? [current] : []) : [];
  const bulbMode: 'off' | 'chase' | 'win' = level === 'off' ? 'off' : phase === 'spinning' ? 'chase' : tier ? 'win' : 'off';
  const balanceAfter = user && !user.unlimited && user.balance !== null ? user.balance - totalBet : null;

  return (
    <div className="mx-auto max-w-6xl px-4 py-8 sm:px-6">
      <GameHeader title="Aurum Royale" subtitle="Cinco rodillos, veinte líneas. El servidor decide las paradas antes de que empiecen a girar." />
      <div className="grid gap-6 lg:grid-cols-[1fr_260px]">
        {/* Máquina */}
        <div
          className={cx(
            level === 'off' && 'motion-off',
            'relative overflow-hidden rounded-[36px] border border-oro/40 bg-gradient-to-b from-[#1c2747] via-abismo to-[#070b16] p-4 shadow-hondo transition-shadow duration-700 sm:p-6',
            tier === 'mega' ? 'shadow-[0_0_0_2px_rgba(235,217,166,0.8),0_0_120px_-10px_rgba(235,217,166,0.75)]' : tier === 'big' ? 'shadow-[0_0_0_1px_rgba(235,217,166,0.6),0_0_80px_-10px_rgba(235,217,166,0.55)]' : tier === 'medium' ? 'shadow-[0_0_50px_-15px_rgba(235,217,166,0.45)]' : '',
          )}
        >
          {/* Brillo ambiental proporcional al premio */}
          <AnimatePresence>
            {tier && tier !== 'small' && (
              <motion.div
                key={tier}
                className="pointer-events-none absolute inset-0"
                initial={{ opacity: 0 }}
                animate={{ opacity: tier === 'mega' ? 1 : 0.6 }}
                exit={{ opacity: 0 }}
                transition={{ duration: 0.6 }}
                style={{ background: 'radial-gradient(ellipse at 50% 45%, rgba(244,210,122,0.22), transparent 65%)' }}
              />
            )}
          </AnimatePresence>
          <Celebration ref={machineFx} level={effects} className="pointer-events-none absolute inset-0 z-20 h-full w-full" />

          {/* Marquesina con luces */}
          <div className="relative mb-4 flex items-center justify-between rounded-2xl border border-oro/30 bg-noche/80 px-4 py-3">
            <div className="flex gap-1.5" aria-hidden>
              {Array.from({ length: 6 }, (_, i) => (
                <span key={i} className={cx('h-2 w-2 rounded-full bg-oro-claro', tier ? 'animate-[marquee-glow_0.8s_ease-in-out_infinite]' : 'opacity-40')} style={{ animationDelay: `${i * 0.12}s` }} />
              ))}
            </div>
            <div className="text-center" aria-live="polite">
              <p className="text-xs text-niebla">{tier ? TIER_TEXT[tier] : phase === 'spinning' ? 'Girando…' : 'Premio'}</p>
              <p className="font-display text-3xl text-oro-claro tabular-nums">
                <span ref={counterRef}>0</span>
              </p>
            </div>
            <div className="flex gap-1.5" aria-hidden>
              {Array.from({ length: 6 }, (_, i) => (
                <span key={i} className={cx('h-2 w-2 rounded-full bg-oro-claro', tier ? 'animate-[marquee-glow_0.8s_ease-in-out_infinite]' : 'opacity-40')} style={{ animationDelay: `${(5 - i) * 0.12}s` }} />
              ))}
            </div>
          </div>

          {/* Ventana de rodillos */}
          <div ref={windowRef} className="relative mx-auto w-full">
            <div className="mx-auto flex items-center justify-center gap-0.5">
              {cell >= 80 && <LineMarkers side="left" cell={cell} lines={lines} winning={presenting ? winningSet : NO_LINES} active={current?.line ?? null} />}
              <div className="flex flex-col gap-1.5">
              <Bulbs count={Math.round(winW / 34)} mode={bulbMode} />
              <div className="relative rounded-2xl border-4 border-[#3a2c12] bg-[#120d05] shadow-[inset_0_6px_20px_rgba(0,0,0,0.8),0_0_0_1px_rgba(235,217,166,0.25)]" style={{ width: winW + 8 }}>
                <div className="flex" style={{ gap: GAP }}>
                  {REEL_STRIPS.map((strip, i) => (
                    <Reel
                      key={i}
                      ref={reelRefs[i]}
                      strip={strip}
                      stop={stops[i]!}
                      cell={cell}
                      highlight={highlights[i]!}
                      dimOthers={!!presenting}
                      anticipation={anticip.has(i)}
                      winKey={highlights[i]!.size > 0 ? activeLine ?? -1 : -1}
                    />
                  ))}
                </div>
                {/* Cristal de la ventana: reflejo diagonal */}
                <div className="pointer-events-none absolute inset-1 rounded-xl bg-[linear-gradient(115deg,rgba(255,255,255,0.10),rgba(255,255,255,0)_32%,rgba(255,255,255,0)_70%,rgba(255,255,255,0.06))]" />
                {/* Líneas de pago: siguen exactamente las celdas de cada línea del motor */}
                <svg className="pointer-events-none absolute left-1 top-1" width={winW} height={winH} aria-hidden>
                  <AnimatePresence>
                    {shownLines.map((l) => (
                      <motion.g key={`${lineStage}-${l.line}`} initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.2 }}>
                        {/* Cajas de las celdas participantes */}
                        {l.cells.map(([reel, row]) => (
                          <rect key={`${reel}-${row}`} x={reel * (cell + GAP) + 3} y={row * cell + 3} width={cell - 6} height={cell - 6} rx={10} fill="none" stroke={l.color} strokeWidth={lineStage === 'cycle' ? 3 : 2} opacity={0.9} />
                        ))}
                        {/* Halo y contorno con trazos anchos semitransparentes (sin filtros: más fluido) */}
                        {[{ w: 14, c: l.color, o: 0.22 }, { w: 7, c: '#05070d', o: 0.55 }, { w: lineStage === 'cycle' ? 5 : 3.5, c: l.color, o: 1 }].map((t, k) => (
                          <motion.polyline
                            key={k}
                            points={linePoints(l.rows)}
                            fill="none"
                            stroke={t.c}
                            strokeOpacity={t.o}
                            strokeWidth={t.w}
                            strokeLinejoin="round"
                            strokeLinecap="round"
                            initial={{ pathLength: 0 }}
                            animate={{ pathLength: 1 }}
                            transition={{ duration: 0.5 * Math.max(speed, 0.3), ease: 'easeOut' }}
                          />
                        ))}
                      </motion.g>
                    ))}
                  </AnimatePresence>
                </svg>
                <Celebration ref={fx} level={effects} />
                {/* Presentación especial de premios grandes */}
                <AnimatePresence>
                  {bigWin && (
                    <motion.button
                      type="button"
                      onClick={() => setBigWin(null)}
                      className="absolute inset-0 z-30 grid place-items-center overflow-hidden rounded-xl bg-black/45"
                      initial={{ opacity: 0 }}
                      animate={{ opacity: 1 }}
                      exit={{ opacity: 0 }}
                      aria-label="Cerrar presentación del premio"
                    >
                      {bigWin.tier === 'mega' && effects !== 'off' && (
                        <motion.div
                          className="absolute h-[220%] w-[220%]"
                          style={{ background: 'repeating-conic-gradient(rgba(244,210,122,0.18) 0deg 10deg, transparent 10deg 20deg)' }}
                          animate={{ rotate: effects === 'full' ? 360 : 0 }}
                          transition={{ duration: 14, repeat: Infinity, ease: 'linear' }}
                        />
                      )}
                      <motion.div className="relative text-center" initial={{ scale: 0.6, y: 10 }} animate={{ scale: 1, y: 0 }} transition={{ type: 'spring', stiffness: 260, damping: 18 }}>
                        <p className="font-display text-[clamp(1.8rem,5vw,3.4rem)] leading-none gold-text drop-shadow-[0_4px_10px_rgba(0,0,0,0.8)]">{TIER_TEXT[bigWin.tier]}</p>
                        <p className="mt-2 font-display text-[clamp(2.2rem,6vw,4rem)] leading-none text-marfil drop-shadow-[0_4px_10px_rgba(0,0,0,0.8)]">{credits(bigWin.amount)}</p>
                        <p className="mt-1 text-sm text-oro-claro">{bigWin.multiplier.toFixed(0)} veces la apuesta</p>
                      </motion.div>
                    </motion.button>
                  )}
                </AnimatePresence>
              </div>
              <Bulbs count={Math.round(winW / 34)} mode={bulbMode} reverse />
              </div>
              {cell >= 80 && <LineMarkers side="right" cell={cell} lines={lines} winning={presenting ? winningSet : NO_LINES} active={current?.line ?? null} />}
              <Lever pulls={pulls} onPull={() => void spin()} disabled={!canAfford && phase !== 'spinning'} />
            </div>
            <div className="mt-3 flex min-h-[28px] flex-wrap items-center justify-center gap-3 text-sm" aria-live="polite">
              <SkipButton visible={phase === 'spinning'} onSkip={slam} />
              {presenting && lineStage === 'overview' && (
                <span className="text-marfil">
                  {plan.lines.length > 0 && `${plan.lines.length} línea${plan.lines.length > 1 ? 's' : ''} premiada${plan.lines.length > 1 ? 's' : ''}`}
                  {plan.lines.length > 0 && plan.scatter && ' y '}
                  {plan.scatter && `${plan.scatter.count} estrellas`}
                  {' '}— total <span className="text-oro-claro">{credits(plan.total)}</span>
                </span>
              )}
              {presenting && lineStage === 'cycle' && current && (
                <span className="flex items-center gap-2 text-marfil">
                  <span className="inline-block h-2.5 w-2.5 rounded-full" style={{ background: current.color }} />
                  Línea {current.line + 1}: {current.count} × {SLOT_SYMBOL_LABELS[current.symbol]} = <span className="text-oro-claro">{credits(current.payout)}</span>
                  <span className="text-niebla">({(activeLine ?? 0) + 1} de {plan.lines.length}{plan.scatter ? `, estrellas ${credits(plan.scatter.payout)}` : ''})</span>
                </span>
              )}
              {presenting && lineStage === 'cycle' && !current && plan.scatter && (
                <span className="text-oro-claro">{plan.scatter.count} estrellas: {credits(plan.scatter.payout)}</span>
              )}
              {phase === 'presenting' && plan && plan.total === 0 && <span className="text-niebla">Sin premio esta vez.</span>}
            </div>
          </div>

          {/* Consola */}
          <div className="mt-4 grid items-center gap-4 rounded-2xl border border-linea bg-noche/70 p-4 sm:grid-cols-[1fr_auto_1fr]">
            <div className="flex flex-col gap-3">
              <div>
                <p className="mb-1.5 text-xs text-niebla">Líneas activas</p>
                <Segmented label="Líneas activas" value={String(lines)} options={DEFAULT_SLOT_LIMITS.allowedLines.map((l) => ({ value: String(l), label: String(l) }))} onChange={(v) => phase !== 'spinning' && setLines(Number(v))} />
              </div>
              <div className="flex items-center gap-3">
                <span className="text-xs text-niebla">Por línea</span>
                <button className="grid h-8 w-8 place-items-center rounded-full border border-linea text-marfil hover:border-oro/60 disabled:opacity-40" onClick={() => stepBet(-1)} disabled={phase === 'spinning' || betPerLine === BET_STEPS[0]} aria-label="Bajar apuesta por línea">
                  <Minus className="h-4 w-4" />
                </button>
                <span className="w-10 text-center font-display text-xl text-marfil" aria-live="polite">{betPerLine}</span>
                <button className="grid h-8 w-8 place-items-center rounded-full border border-linea text-marfil hover:border-oro/60 disabled:opacity-40" onClick={() => stepBet(1)} disabled={phase === 'spinning' || betPerLine === BET_STEPS[BET_STEPS.length - 1]} aria-label="Subir apuesta por línea">
                  <Plus className="h-4 w-4" />
                </button>
              </div>
              <p className="text-xs text-niebla">
                {betPerLine} × {lines} líneas = <span className="text-marfil">{credits(totalBet)}</span>
                {balanceAfter !== null && <> · saldo tras girar: <span className={balanceAfter < 0 ? 'text-[#f1a3ad]' : 'text-marfil'}>{credits(Math.max(0, balanceAfter))}</span></>}
              </p>
            </div>

            {/* Botón de giro con anillo de progreso */}
            <div className="flex flex-col items-center gap-1.5">
              <motion.button
                onClick={() => void spin()}
                disabled={!canAfford && phase !== 'spinning'}
                title={!canAfford ? 'Saldo insuficiente para esta apuesta' : undefined}
                whileHover={{ scale: 1.05, filter: 'brightness(1.08)' }}
                whileTap={{ scale: 0.92 }}
                aria-label={phase === 'spinning' ? 'Frenar los rodillos' : `Girar por ${totalBet} créditos`}
                className="group relative grid h-28 w-28 place-items-center rounded-full disabled:cursor-not-allowed disabled:opacity-40"
              >
                <span className="absolute inset-1 rounded-full bg-oro/30 opacity-0 blur-md transition-opacity duration-300 group-hover:opacity-100" aria-hidden />
                <svg className="absolute inset-0" viewBox="0 0 100 100" aria-hidden>
                  <circle cx="50" cy="50" r="47" fill="none" stroke="#24324F" strokeWidth="4" />
                </svg>
                {phase === 'spinning' && (
                  <svg className="absolute inset-0 animate-spin [animation-duration:0.9s]" viewBox="0 0 100 100" aria-hidden>
                    <circle cx="50" cy="50" r="47" fill="none" stroke="#ebd9a6" strokeWidth="4" strokeLinecap="round" strokeDasharray="70 225" />
                  </svg>
                )}
                <span className={cx('relative grid h-[88px] w-[88px] place-items-center rounded-full bg-gradient-to-b from-oro-claro via-oro to-oro-oscuro text-noche shadow-[0_2px_0_rgba(255,255,255,0.5)_inset,0_14px_30px_-10px_rgba(207,174,107,0.9)]', tier ? 'turn-ring' : '')}>
                  {phase === 'spinning' ? <Square className="h-7 w-7" /> : <Play className="ml-1 h-9 w-9" />}
                </span>
              </motion.button>
              <p className="text-xs text-niebla">
                {phase === 'spinning' ? 'Pulsa para frenar' : phase === 'presenting' && plan ? (plan.total > 0 ? `Ganas ${credits(plan.total)}` : 'Sin premio') : `Girar por ${credits(totalBet)}`}
              </p>
            </div>

            <div className="flex flex-col items-end gap-2">
              <div className="flex items-center gap-1.5">
                <button
                  onClick={() => void updatePrefs({ sound: !prefs.sound })}
                  className="grid h-9 w-9 place-items-center rounded-full border border-linea text-niebla hover:border-oro/60 hover:text-marfil"
                  aria-label={prefs.sound ? 'Silenciar sonidos' : 'Activar sonidos'}
                  aria-pressed={!prefs.sound}
                  title={prefs.sound ? 'Silenciar' : 'Activar sonido'}
                >
                  {prefs.sound ? <Volume2 className="h-4 w-4" /> : <VolumeX className="h-4 w-4" />}
                </button>
                <button
                  onClick={() => void updatePrefs({ effects: prefs.effects === 'full' ? 'reduced' : prefs.effects === 'reduced' ? 'off' : 'full' })}
                  className="flex h-9 items-center gap-1.5 rounded-full border border-linea px-3 text-xs text-niebla hover:border-oro/60 hover:text-marfil"
                  title="Efectos visuales de celebración"
                  aria-label={`Efectos visuales: ${prefs.effects === 'full' ? 'completos' : prefs.effects === 'reduced' ? 'reducidos' : 'desactivados'}. Pulsa para cambiar.`}
                >
                  <Sparkles className="h-3.5 w-3.5" /> {prefs.effects === 'full' ? 'Efectos' : prefs.effects === 'reduced' ? 'Efectos reducidos' : 'Sin efectos'}
                </button>
              </div>
              <p className="text-xs text-niebla">Giro automático</p>
              {auto > 0 ? (
                <Button variant="danger" size="sm" onClick={() => setAuto(0)}>
                  <Square className="h-3.5 w-3.5" /> Detener ({auto} restantes)
                </Button>
              ) : (
                <div className="flex gap-1.5">
                  {[10, 25, 50].map((n) => (
                    <Button key={n} variant="outline" size="sm" onClick={() => startAuto(n)} disabled={phase === 'spinning' || !canAfford}>
                      <Repeat className="h-3.5 w-3.5" /> {n}
                    </Button>
                  ))}
                </div>
              )}
              <p className="max-w-[220px] text-right text-[11px] leading-snug text-niebla">Cada giro automático cobra {credits(totalBet)} y se detiene si no hay saldo.</p>
            </div>
          </div>
        </div>

        {/* Panel lateral */}
        <aside className="flex flex-col gap-4">
          <div className="panel p-5">
            <h2 className="mb-3 text-xl text-marfil">Últimas tiradas</h2>
            {history.length === 0 ? (
              <p className="text-sm text-niebla">Tus tiradas de esta sesión aparecerán aquí.</p>
            ) : (
              <ul className="space-y-1.5 text-sm">
                {history.map((h, i) => (
                  <li key={history.length - i} className="flex justify-between">
                    <span className="text-niebla">Apuesta {credits(h.bet)}</span>
                    <span className={h.win > 0 ? 'text-exito' : 'text-niebla'}>{h.win > 0 ? `+${credits(h.win)}` : '—'}</span>
                  </li>
                ))}
              </ul>
            )}
          </div>
          <div className="panel p-5 text-sm text-niebla">
            <h2 className="mb-2 text-xl text-marfil">Cómo se paga</h2>
            <p>Tres o más símbolos iguales seguidos desde el primer rodillo en una línea activa. El comodín sustituye a todos menos a la estrella. Tres estrellas en cualquier posición pagan sobre la apuesta total.</p>
            <p className="mt-2">Las celebraciones dependen del premio obtenido en esta tirada y no anticipan las siguientes. RTP teórico exacto: 95,26 %.</p>
            <div className="mt-3"><OddsNote /></div>
          </div>
        </aside>
      </div>
    </div>
  );
}
