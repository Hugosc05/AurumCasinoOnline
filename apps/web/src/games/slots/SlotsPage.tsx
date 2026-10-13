import { DEFAULT_SLOT_LIMITS, PAYLINES, SLOT_SYMBOL_LABELS, REEL_STRIPS, gridFromStops, type SlotSpinResult, type SlotSymbol, type WinTier } from '@aurum/engine';
import { AnimatePresence, animate, motion } from 'motion/react';
import { Minus, Play, Plus, Repeat, Square } from 'lucide-react';
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { GameHeader, OddsNote, SkipButton } from '../../components/GameKit';
import { Button, Segmented } from '../../components/ui';
import { ApiError, api, newKey } from '../../lib/api';
import { DURATION } from '../../lib/anim/tokens';
import { audio, type LoopHandle } from '../../lib/audio';
import { credits, cx } from '../../lib/format';
import { useNotify } from '../../state/notify';
import { useSession } from '../../state/session';
import type { Achievement, Balance } from '../../state/types';
import { Reel, type ReelHandle } from './Reel';
import { reelPath } from './reelPlan';

interface SpinResponse {
  roundId: string;
  result: SlotSpinResult;
  balance: Balance;
  achievements: Achievement[];
}

const BET_STEPS = [1, 2, 5, 10, 20, 50, 100];
const LINE_COLORS = ['#ebd9a6', '#7fd3ff', '#ff8a96', '#9be8a6', '#d2a8ff', '#ffc66b', '#7ff0d8', '#ffa3d7', '#a7b8ff', '#f5f08a'];
const TIER_TEXT: Record<WinTier, string> = { none: '', small: 'Premio', medium: 'Buen premio', big: 'Gran premio', mega: 'Premio extraordinario' };
const TIER_MS: Record<WinTier, number> = { none: 0, small: DURATION.winSmall, medium: DURATION.winMedium, big: DURATION.winBig, mega: DURATION.winBig + 1200 };

type Phase = 'idle' | 'spinning' | 'presenting';

function useCellSize(ref: React.RefObject<HTMLDivElement | null>): number {
  const [cell, setCell] = useState(110);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const update = (): void => {
      const w = el.clientWidth;
      setCell(Math.max(52, Math.min(124, Math.floor((w - 4 * 8) / 5), Math.floor((window.innerHeight * 0.4) / 3))));
    };
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
  }, [ref]);
  return cell;
}

export default function SlotsPage() {
  const { user, setBalance, speed, motion: level } = useSession();
  const { notify, celebrate } = useNotify();
  const reels = useRef<(ReelHandle | null)[]>([]);
  const windowRef = useRef<HTMLDivElement>(null);
  const cell = useCellSize(windowRef);
  const counterRef = useRef<HTMLSpanElement>(null);

  const [stops, setStops] = useState<number[]>([0, 7, 14, 21, 28]);
  const [grid, setGrid] = useState<SlotSymbol[][]>(() => gridFromStops([0, 7, 14, 21, 28]));
  const [lines, setLines] = useState(20);
  const [betPerLine, setBetPerLine] = useState(1);
  const [phase, setPhase] = useState<Phase>('idle');
  const [result, setResult] = useState<SlotSpinResult | null>(null);
  const [activeLine, setActiveLine] = useState<number | null>(null);
  const [anticip, setAnticip] = useState<Set<number>>(new Set());
  const [auto, setAuto] = useState(0);
  const [history, setHistory] = useState<{ bet: number; win: number }[]>([]);
  const busy = useRef(false);
  const autoRef = useRef(0);
  autoRef.current = auto;
  const loop = useRef<LoopHandle | null>(null);
  const totalBet = betPerLine * lines;
  const canAfford = user?.unlimited || (user?.balance ?? 0) >= totalBet;

  useEffect(() => () => loop.current?.stop(50), []);

  // Recorrido de líneas ganadoras durante la presentación.
  useEffect(() => {
    if (phase !== 'presenting' || !result || result.lineWins.length === 0) {
      setActiveLine(null);
      return;
    }
    let i = 0;
    setActiveLine(0);
    const t = window.setInterval(() => {
      i = (i + 1) % result.lineWins.length;
      setActiveLine(i);
    }, Math.max(700, 1100 * Math.max(speed, 0.5)));
    return () => clearInterval(t);
  }, [phase, result, speed]);

  const highlightFor = (reel: number): Set<number> => {
    if (!result || phase !== 'presenting') return new Set();
    const set = new Set<number>();
    const wins = activeLine !== null && result.lineWins[activeLine] ? [result.lineWins[activeLine]!] : result.lineWins;
    for (const w of wins) for (const [r, row] of w.cells) if (r === reel) set.add(row);
    if (result.scatterWin) for (const [r, row] of result.scatterWin.cells) if (r === reel) set.add(row);
    return set;
  };

  const spin = useCallback(async (): Promise<void> => {
    if (busy.current) return;
    if (!canAfford) {
      notify('error', 'Saldo insuficiente para esta apuesta.');
      setAuto(0);
      return;
    }
    busy.current = true;
    setPhase('spinning');
    setResult(null);
    setAnticip(new Set());
    if (counterRef.current) counterRef.current.textContent = '0';
    if (user && !user.unlimited && user.balance !== null) setBalance({ balance: user.balance - totalBet, unlimited: false });
    loop.current = audio.loop('reels');
    let res: SpinResponse;
    try {
      res = await api.post<SpinResponse>('/api/games/slots/spin', { betPerLine, lines, idempotencyKey: newKey() });
    } catch (err) {
      loop.current?.stop();
      busy.current = false;
      setPhase('idle');
      setAuto(0);
      if (user) setBalance({ balance: user.balance, unlimited: user.unlimited });
      notify('error', err instanceof ApiError ? err.message : 'No se pudo girar.');
      return;
    }
    const r = res.result;
    // Anticipación honesta: si ya hay 2 estrellas visibles, los rodillos restantes tardan un poco más.
    const scattersBefore = (reel: number): number => r.grid.slice(0, reel).flat().filter((s) => s === 'scatter').length;
    const base = level === 'off' ? 0 : DURATION.reelSpin * (level === 'reduced' ? 0.45 : 1);
    const stagger = level === 'off' ? 0 : DURATION.reelStagger * (level === 'reduced' ? 0.5 : 1);
    let extra = 0;
    const plans = r.stops.map((stop, i) => {
      if (level === 'full' && i >= 2 && scattersBefore(i) >= 2) extra += 650;
      return { path: reelPath(REEL_STRIPS[i]!, stops[i]!, stop, level === 'full' ? 1 + Math.floor(i / 2) : 0), duration: base + i * stagger + extra };
    });
    let stopped = 0;
    await Promise.all(
      plans.map((p, i) =>
        reels.current[i]?.spin(p.path, p.duration, 0, () => {
          audio.play('reelStop');
          stopped += 1;
          loop.current?.setIntensity(1 - stopped / 5);
          setGrid((g) => g.map((col, ci) => (ci === i ? r.grid[i]! : col)));
          if (level === 'full' && i >= 1 && i < 4 && scattersBefore(i + 1) >= 2) setAnticip(new Set(Array.from({ length: 4 - i }, (_, k) => i + 1 + k)));
        }),
      ),
    );
    loop.current?.stop();
    setAnticip(new Set());
    setStops(r.stops);
    setGrid(r.grid);
    setResult(r);
    setBalance(res.balance);
    setHistory((h) => [{ bet: r.totalBet, win: r.totalWin }, ...h].slice(0, 12));
    celebrate(res.achievements);
    if (r.totalWin > 0) {
      setPhase('presenting');
      audio.play(r.tier === 'big' || r.tier === 'mega' ? 'winBig' : r.tier === 'medium' ? 'winMedium' : 'winSmall');
      const dur = (TIER_MS[r.tier] / 1000) * Math.max(speed, 0.2);
      if (counterRef.current) {
        const el = counterRef.current;
        await animate(0, r.totalWin, { duration: speed === 0 ? 0 : dur, ease: 'easeOut', onUpdate: (v) => (el.textContent = credits(Math.round(v))) });
      }
    } else {
      setPhase('presenting');
    }
    busy.current = false;
    if (autoRef.current > 0) {
      const pause = r.totalWin > 0 ? Math.max(500, TIER_MS[r.tier] * speed * 0.6) : 350;
      window.setTimeout(() => {
        if (autoRef.current > 0) {
          setAuto((a) => a - 1);
          void spinRef.current();
        }
      }, pause);
    }
  }, [canAfford, notify, user, setBalance, totalBet, betPerLine, lines, level, stops, speed, celebrate]);

  const spinRef = useRef(spin);
  spinRef.current = spin;

  // Atajo: barra espaciadora para girar (o saltar si está girando).
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.code !== 'Space' || e.target instanceof HTMLInputElement || e.target instanceof HTMLButtonElement) return;
      e.preventDefault();
      if (busy.current) reels.current.forEach((r) => r?.skip());
      else void spinRef.current();
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
    const next = BET_STEPS[Math.max(0, Math.min(BET_STEPS.length - 1, i + dir))]!;
    setBetPerLine(next);
  };

  const gap = 8;
  const winW = cell * 5 + gap * 4;
  const winH = cell * 3;
  const linePoints = (li: number): string =>
    PAYLINES[li]!.map((row, reel) => `${reel * (cell + gap) + cell / 2},${row * cell + cell / 2}`).join(' ');
  const tierClass = result?.tier && result.tier !== 'none' ? result.tier : null;

  return (
    <div className="mx-auto max-w-6xl px-4 py-8 sm:px-6">
      <GameHeader title="Aurum Royale" subtitle="Cinco rodillos, veinte líneas. El servidor decide las paradas antes de que empiecen a girar." />
      <div className="grid gap-6 lg:grid-cols-[1fr_260px]">
        {/* Máquina */}
        <div
          className={cx(
            'relative rounded-[36px] border border-oro/40 bg-gradient-to-b from-[#1c2747] via-abismo to-[#070b16] p-4 shadow-hondo transition-shadow duration-700 sm:p-6',
            tierClass === 'big' || tierClass === 'mega' ? 'shadow-[0_0_0_1px_rgba(235,217,166,0.6),0_0_80px_-10px_rgba(235,217,166,0.55)]' : tierClass === 'medium' ? 'shadow-[0_0_50px_-15px_rgba(235,217,166,0.45)]' : '',
          )}
        >
          {/* Marquesina con luces */}
          <div className="relative mb-4 flex items-center justify-between rounded-2xl border border-oro/30 bg-noche/80 px-4 py-3">
            <div className="flex gap-1.5" aria-hidden>
              {Array.from({ length: 6 }, (_, i) => (
                <span key={i} className={cx('h-2 w-2 rounded-full bg-oro-claro', phase === 'presenting' && result?.totalWin ? 'animate-[marquee-glow_0.8s_ease-in-out_infinite]' : 'opacity-40')} style={{ animationDelay: `${i * 0.12}s` }} />
              ))}
            </div>
            <div className="text-center" aria-live="polite">
              <p className="text-xs text-niebla">{phase === 'presenting' && result && result.totalWin > 0 ? TIER_TEXT[result.tier] : 'Premio'}</p>
              <p className="font-display text-3xl text-oro-claro tabular-nums">
                <span ref={counterRef}>0</span>
              </p>
            </div>
            <div className="flex gap-1.5" aria-hidden>
              {Array.from({ length: 6 }, (_, i) => (
                <span key={i} className={cx('h-2 w-2 rounded-full bg-oro-claro', phase === 'presenting' && result?.totalWin ? 'animate-[marquee-glow_0.8s_ease-in-out_infinite]' : 'opacity-40')} style={{ animationDelay: `${(5 - i) * 0.12}s` }} />
              ))}
            </div>
          </div>

          {/* Ventana de rodillos */}
          <div ref={windowRef} className="relative mx-auto w-full">
            <div className="relative mx-auto rounded-2xl border-4 border-[#3a2c12] bg-[#120d05] p-0 shadow-[inset_0_6px_20px_rgba(0,0,0,0.8)]" style={{ width: winW + 8 }}>
              <div className="flex" style={{ gap }}>
                {grid.map((col, i) => (
                  <Reel
                    key={i}
                    ref={(el) => {
                      reels.current[i] = el;
                    }}
                    visible={col}
                    cell={cell}
                    highlight={highlightFor(i)}
                    dimOthers={phase === 'presenting' && !!result && result.totalWin > 0}
                    anticipation={anticip.has(i)}
                  />
                ))}
              </div>
              {/* Líneas de pago */}
              <svg className="pointer-events-none absolute left-1 top-1" width={winW} height={winH} aria-hidden>
                <AnimatePresence>
                  {phase === 'presenting' && result && activeLine !== null && result.lineWins[activeLine] && (
                    <motion.polyline
                      key={`${result.lineWins[activeLine]!.line}-${activeLine}`}
                      points={linePoints(result.lineWins[activeLine]!.line)}
                      fill="none"
                      stroke={LINE_COLORS[result.lineWins[activeLine]!.line % LINE_COLORS.length]}
                      strokeWidth={4}
                      strokeLinejoin="round"
                      strokeLinecap="round"
                      initial={{ pathLength: 0, opacity: 0.2 }}
                      animate={{ pathLength: 1, opacity: 0.95 }}
                      exit={{ opacity: 0 }}
                      transition={{ duration: 0.45 * Math.max(speed, 0.3) }}
                      style={{ filter: 'drop-shadow(0 0 6px rgba(0,0,0,0.8))' }}
                    />
                  )}
                </AnimatePresence>
              </svg>
            </div>
            <div className="mt-3 flex min-h-[28px] items-center justify-center gap-3 text-sm">
              <SkipButton visible={phase === 'spinning'} onSkip={() => reels.current.forEach((r) => r?.skip())} />
              {phase === 'presenting' && result && activeLine !== null && result.lineWins[activeLine] && (
                <span className="text-marfil">
                  Línea {result.lineWins[activeLine]!.line + 1}: {result.lineWins[activeLine]!.count} × {SLOT_SYMBOL_LABELS[result.lineWins[activeLine]!.symbol]} ={' '}
                  <span className="text-oro-claro">{credits(result.lineWins[activeLine]!.payout)}</span>
                </span>
              )}
              {phase === 'presenting' && result?.scatterWin && <span className="text-oro-claro">{result.scatterWin.count} estrellas: {credits(result.scatterWin.payout)}</span>}
              {phase === 'presenting' && result && result.totalWin === 0 && <span className="text-niebla">Sin premio esta vez.</span>}
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
                <span className="w-10 text-center font-display text-xl text-marfil">{betPerLine}</span>
                <button className="grid h-8 w-8 place-items-center rounded-full border border-linea text-marfil hover:border-oro/60 disabled:opacity-40" onClick={() => stepBet(1)} disabled={phase === 'spinning' || betPerLine === BET_STEPS[BET_STEPS.length - 1]} aria-label="Subir apuesta por línea">
                  <Plus className="h-4 w-4" />
                </button>
              </div>
            </div>

            {/* Botón de giro con anillo de progreso */}
            <div className="flex flex-col items-center gap-1.5">
              <motion.button
                onClick={() => {
                  audio.play('click');
                  if (phase === 'spinning') reels.current.forEach((r) => r?.skip());
                  else void spin();
                }}
                disabled={!canAfford && phase !== 'spinning'}
                title={!canAfford ? 'Saldo insuficiente para esta apuesta' : undefined}
                whileHover={{ scale: 1.04 }}
                whileTap={{ scale: 0.93 }}
                aria-label={phase === 'spinning' ? 'Detener rodillos' : `Girar por ${totalBet} créditos`}
                className="relative grid h-28 w-28 place-items-center rounded-full disabled:cursor-not-allowed disabled:opacity-40"
              >
                <svg className="absolute inset-0" viewBox="0 0 100 100" aria-hidden>
                  <circle cx="50" cy="50" r="47" fill="none" stroke="#24324F" strokeWidth="4" />
                  {phase === 'spinning' && (
                    <motion.circle
                      cx="50" cy="50" r="47" fill="none" stroke="#ebd9a6" strokeWidth="4" strokeLinecap="round" transform="rotate(-90 50 50)"
                      initial={{ pathLength: 0 }}
                      animate={{ pathLength: 1 }}
                      transition={{ duration: ((DURATION.reelSpin + DURATION.reelStagger * 4) / 1000) * Math.max(speed, 0.2), ease: 'linear' }}
                    />
                  )}
                </svg>
                <span className={cx('grid h-[88px] w-[88px] place-items-center rounded-full bg-gradient-to-b from-oro-claro via-oro to-oro-oscuro text-noche shadow-[0_2px_0_rgba(255,255,255,0.5)_inset,0_14px_30px_-10px_rgba(207,174,107,0.9)]', phase === 'presenting' && result?.totalWin ? 'turn-ring' : '')}>
                  {phase === 'spinning' ? <Square className="h-7 w-7" /> : <Play className="ml-1 h-9 w-9" />}
                </span>
              </motion.button>
              <p className="text-xs text-niebla">Apuesta total <span className="font-display text-base text-marfil">{credits(totalBet)}</span></p>
            </div>

            <div className="flex flex-col items-end gap-2">
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
            <p className="mt-2">RTP teórico exacto: 95,26 %.</p>
            <div className="mt-3"><OddsNote /></div>
          </div>
        </aside>
      </div>
    </div>
  );
}
