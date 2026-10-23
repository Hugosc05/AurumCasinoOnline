import { AnimatePresence, animate, motion, useMotionValue } from 'motion/react';
import { memo, useEffect, useRef, useState } from 'react';
import type { CashValue, JackpotTier } from '@aurum/engine';
import { Celebration, type CelebrationHandle } from '../../components/Celebration';
import { Button } from '../../components/ui';
import { ApiError, api } from '../../lib/api';
import { audio } from '../../lib/audio';
import { credits, cx } from '../../lib/format';
import { useNotify } from '../../state/notify';
import { useSession } from '../../state/session';
import type { Achievement, Balance } from '../../state/types';
import { SlotSymbolArt } from './symbols';

/* ------------------------------- Tipos ------------------------------- */

export type Jackpots = Record<JackpotTier, number>;
type Prize = { kind: 'credit'; mult: number } | { kind: 'jackpot'; tier: JackpotTier };

export type ExtraView =
  | { kind: 'wheel'; totalBet: number; segments: Prize[]; segment: number | null; done: boolean; jackpots: Jackpots }
  | { kind: 'safe'; totalBet: number; count: number; opened: { index: number; tier: JackpotTier }[]; revealed: JackpotTier[] | null; winner: JackpotTier | null; done: boolean; jackpots: Jackpots }
  | { kind: 'holdwin'; totalBet: number; cells: (CashValue | null)[]; respinsLeft: number; last: number[]; respinsPlayed: number; done: boolean; full: boolean; won: number; jackpots: Jackpots };

export interface JackpotInfo {
  mini: number;
  minor: number;
  major: number;
  grandPool: number;
  grandRefBet: number;
}

interface ActResponse {
  reveal: unknown;
  feature: ExtraView;
  finished: { won: number; jackpots: JackpotTier[]; grand: number } | null;
  balance: Balance;
  achievements: Achievement[];
  state: { extra: ExtraView | null; pending: string[]; jackpots: JackpotInfo | null };
}

export const TIER_LABEL: Record<JackpotTier, string> = { mini: 'Mini', minor: 'Menor', major: 'Mayor', grand: 'Grand' };
const TIER_STYLE: Record<JackpotTier, { bg: string; text: string; ring: string }> = {
  mini: { bg: 'from-[#2b7de9] to-[#123c7a]', text: 'text-[#d8ecff]', ring: 'ring-[#7fb8ff]' },
  minor: { bg: 'from-[#2fbf71] to-[#0f5a33]', text: 'text-[#dcffe9]', ring: 'ring-[#8ff0b8]' },
  major: { bg: 'from-[#c4121f] to-[#5e0a10]', text: 'text-[#ffe0e3]', ring: 'ring-[#ff8a95]' },
  grand: { bg: 'from-[#f4d27a] to-[#8a5f18]', text: 'text-[#2a1a05]', ring: 'ring-[#fff3c8]' },
};

/** Importe de cada bote para una apuesta total (el Grand, en proporción a la apuesta). */
export function jackpotsFor(info: JackpotInfo, totalBet: number): Jackpots {
  return {
    mini: info.mini * totalBet,
    minor: info.minor * totalBet,
    major: info.major * totalBet,
    grand: Math.floor(info.grandPool * Math.min(1, totalBet / info.grandRefBet)),
  };
}

export function cashLabel(v: CashValue, totalBet: number, jackpots?: Jackpots): string {
  if (v.kind === 'credit') return credits(v.mult * totalBet);
  return jackpots ? `${TIER_LABEL[v.tier]}` : TIER_LABEL[v.tier];
}

/* ------------------------------ Botes ------------------------------ */

/** Marcadores de los cuatro botes (importes reales para la apuesta actual; nada de contadores inventados). */
export const JackpotBar = memo(function JackpotBar({ jackpots, flash }: { jackpots: Jackpots; flash?: JackpotTier | null }) {
  return (
    <div className="mb-3 grid grid-cols-4 gap-1.5 sm:gap-2" aria-label="Botes" data-testid="jackpots">
      {(['grand', 'major', 'minor', 'mini'] as const).map((t) => (
        <div
          key={t}
          className={cx('relative overflow-hidden rounded-xl bg-gradient-to-b px-1.5 py-1.5 text-center shadow-[inset_0_1px_0_rgba(255,255,255,0.35),0_6px_14px_-6px_rgba(0,0,0,0.8)]', TIER_STYLE[t].bg, flash === t && 'animate-[marquee-glow_0.5s_ease-in-out_infinite] ring-2', flash === t && TIER_STYLE[t].ring)}
          data-testid={`jackpot-${t}`}
        >
          <p className={cx('text-[10px] font-semibold uppercase tracking-[0.18em] opacity-90', TIER_STYLE[t].text)}>{TIER_LABEL[t]}</p>
          <p className={cx('font-display text-[clamp(0.85rem,2.2vw,1.35rem)] leading-tight tabular-nums', TIER_STYLE[t].text)}>{credits(jackpots[t])}</p>
        </div>
      ))}
    </div>
  );
});

/* ------------------------------ Contenedor ------------------------------ */

export function VegasFeature({ machine, extra, onUpdate, onFinished, onClose }: {
  machine: string;
  extra: ExtraView;
  onUpdate: (state: ActResponse['state']) => void;
  onFinished: (won: number, kind: ExtraView['kind'], jackpots: JackpotTier[]) => void;
  onClose: () => void;
}) {
  const { setBalance, effects } = useSession();
  const { notify, celebrate } = useNotify();
  const fx = useRef<CelebrationHandle>(null);
  const [view, setView] = useState<ExtraView>(extra);
  const [result, setResult] = useState<ActResponse['finished']>(null);
  const [busy, setBusy] = useState(false);
  const pendingState = useRef<ActResponse['state'] | null>(null);

  useEffect(() => setView(extra), [extra]);

  const act = async (action: 'spin' | 'pick' | 'respin', index?: number): Promise<ActResponse | null> => {
    if (busy) return null;
    setBusy(true);
    try {
      const r = await api.post<ActResponse>('/api/games/slots/feature', { machine, action, index });
      setView(r.feature);
      pendingState.current = r.state;
      return r;
    } catch (err) {
      notify('error', err instanceof ApiError ? err.message : 'No se pudo completar la jugada.');
      return null;
    } finally {
      setBusy(false);
    }
  };

  const finish = (r: ActResponse): void => {
    if (!r.finished) return;
    setBalance(r.balance);
    celebrate(r.achievements);
    setResult(r.finished);
    onFinished(r.finished.won, r.feature.kind, r.finished.jackpots);
    const big = r.finished.won >= r.feature.totalBet * 20 || r.finished.jackpots.length > 0;
    audio.play(big ? 'winBig' : 'winMedium', 200);
    fx.current?.play(r.finished.jackpots.includes('grand') || r.finished.won >= r.feature.totalBet * 50 ? 'fireworks' : big ? 'burst' : 'sparkle', [{ x: 0.5, y: 0.45 }]);
  };

  const close = (): void => {
    if (pendingState.current) onUpdate(pendingState.current);
    onClose();
  };

  const title = view.kind === 'wheel' ? 'La gran rueda' : view.kind === 'safe' ? 'La caja fuerte' : 'Hold & Win';
  return (
    <div className="absolute inset-0 z-40 flex flex-col items-center overflow-y-auto rounded-[36px] bg-[radial-gradient(ellipse_at_50%_30%,rgba(70,16,74,0.96),rgba(8,3,12,0.985))] p-3 sm:p-5" role="dialog" aria-label={title} data-testid={`feature-${view.kind}`}>
      <Celebration ref={fx} level={effects} />
      <p className="text-[11px] uppercase tracking-[0.35em] text-[#ff8be6]">Minijuego</p>
      <h2 className="slot-topper-title font-display text-[clamp(1.8rem,5vw,2.8rem)] leading-none text-[#ffd6f6]">{title}</h2>
      <div className="mt-2 w-full max-w-xl"><JackpotBar jackpots={view.jackpots} flash={result?.jackpots[0] ?? null} /></div>
      {view.kind === 'wheel' && <WheelGame view={view} busy={busy} onSpin={async () => { const r = await act('spin'); return r; }} onDone={finish} />}
      {view.kind === 'safe' && <SafeGame view={view} busy={busy} onPick={async (i) => { const r = await act('pick', i); if (r?.finished) window.setTimeout(() => finish(r), 500); return r; }} />}
      {view.kind === 'holdwin' && <HoldWinGame view={view} busy={busy} onRespin={async () => { const r = await act('respin'); if (r?.finished) window.setTimeout(() => finish(r), 700); return r; }} />}
      <AnimatePresence>
        {result && (
          <motion.div className="mt-4 text-center" initial={{ opacity: 0, scale: 0.8 }} animate={{ opacity: 1, scale: 1 }} transition={{ type: 'spring', stiffness: 260, damping: 18 }}>
            {result.jackpots.length > 0 && <p className="font-display text-2xl gold-text">{view.kind === 'holdwin' ? 'Incluye ' : ''}{result.jackpots.map((j) => `bote ${TIER_LABEL[j]}`).join(' + ').replace(/^b/, view.kind === 'holdwin' ? 'b' : 'B')}</p>}
            <p className="font-display text-5xl tabular-nums text-marfil drop-shadow-[0_4px_10px_rgba(0,0,0,0.8)]" data-testid="feature-won">{credits(result.won)}</p>
            <p className="text-sm text-niebla">{(result.won / view.totalBet).toFixed(1).replace('.', ',')} veces la apuesta</p>
            <Button className="mt-3" onClick={close} data-testid="feature-collect">Cobrar y continuar</Button>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

/* ------------------------------ Rueda ------------------------------ */

const WHEEL_COLORS = ['#c4121f', '#1b1f2e', '#5b2a86', '#0f6b47'];
const prizeText = (p: Prize, totalBet: number): string => (p.kind === 'credit' ? credits(p.mult * totalBet) : TIER_LABEL[p.tier].toUpperCase());

function WheelGame({ view, busy, onSpin, onDone }: { view: Extract<ExtraView, { kind: 'wheel' }>; busy: boolean; onSpin: () => Promise<ActResponse | null>; onDone: (r: ActResponse) => void }) {
  const n = view.segments.length;
  const step = 360 / n;
  const rot = useMotionValue(0);
  const [spinning, setSpinning] = useState(false);
  const [landed, setLanded] = useState<number | null>(view.segment);
  const { motion: level } = useSession();

  const go = async (): Promise<void> => {
    if (spinning || view.done) return;
    setSpinning(true);
    audio.play('spinStart');
    const r = await onSpin();
    const seg = (r?.reveal as { segment?: number } | null)?.segment;
    if (!r || seg === undefined) {
      setSpinning(false);
      return;
    }
    // El sector lo fijó el servidor al activarse el minijuego; la rueda solo frena hasta él.
    const jitter = (Math.random() - 0.5) * step * 0.6;
    const target = 360 * (level === 'off' ? 0 : 7) + (360 - (seg * step + step / 2)) + jitter;
    let lastTick = 0;
    await animate(rot, target, {
      duration: level === 'off' ? 0 : level === 'reduced' ? 2.5 : 6.2,
      ease: [0.12, 0.85, 0.22, 1],
      onUpdate: (v) => {
        const t = Math.floor(v / step);
        if (t !== lastTick) {
          lastTick = t;
          audio.play('ballTick');
        }
      },
    });
    setLanded(seg);
    setSpinning(false);
    onDone(r);
  };

  return (
    <div className="mt-3 flex flex-col items-center">
      <div className="relative" style={{ width: 'min(78vw, 360px)', aspectRatio: '1' }}>
        <motion.svg viewBox="-110 -110 220 220" className="h-full w-full drop-shadow-[0_20px_40px_rgba(0,0,0,0.7)]" style={{ rotate: rot }}>
          <defs>
            <linearGradient id="wf-rim" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stopColor="#fff3c8" /><stop offset="0.5" stopColor="#d9a845" /><stop offset="1" stopColor="#7a5216" /></linearGradient>
          </defs>
          <circle r="106" fill="url(#wf-rim)" stroke="#3a2608" strokeWidth="2" />
          {view.segments.map((p, i) => {
            const a0 = ((i * step - 90) * Math.PI) / 180;
            const a1 = (((i + 1) * step - 90) * Math.PI) / 180;
            const r = 96;
            const mid = i * step + step / 2;
            const isJp = p.kind === 'jackpot';
            return (
              <g key={i}>
                <path d={`M0 0 L ${r * Math.cos(a0)} ${r * Math.sin(a0)} A ${r} ${r} 0 0 1 ${r * Math.cos(a1)} ${r * Math.sin(a1)} Z`} fill={isJp ? (p.tier === 'grand' ? '#e9b949' : p.tier === 'major' ? '#9e0f1a' : p.tier === 'minor' ? '#1f8f52' : '#1f5fb8') : WHEEL_COLORS[i % 4]} stroke="#f4d27a" strokeWidth="1.2" opacity={landed !== null && landed !== i ? 0.75 : 1} />
                <text transform={`rotate(${mid}) translate(0 -64) rotate(90)`} textAnchor="middle" dominantBaseline="central" fontSize={isJp ? 10 : 11} fontWeight="800" fontFamily="system-ui, sans-serif" fill={isJp && p.tier === 'grand' ? '#2a1a05' : '#fff6e6'} letterSpacing="0.5">
                  {prizeText(p, view.totalBet)}
                </text>
              </g>
            );
          })}
          {Array.from({ length: n }, (_, i) => {
            const a = ((i * step - 90) * Math.PI) / 180;
            return <circle key={`p${i}`} cx={101 * Math.cos(a)} cy={101 * Math.sin(a)} r="3" fill="#fff8e1" stroke="#7a5216" strokeWidth="1" />;
          })}
          <circle r="18" fill="url(#wf-rim)" stroke="#3a2608" strokeWidth="2" />
          <text textAnchor="middle" dominantBaseline="central" fontSize="9" fontWeight="900" fill="#3a2608">VEGAS</text>
        </motion.svg>
        {/* Puntero fijo */}
        <svg viewBox="0 0 40 50" className="absolute left-1/2 top-[-14px] h-[54px] w-[44px] -translate-x-1/2 drop-shadow-[0_4px_6px_rgba(0,0,0,0.7)]" aria-hidden>
          <path d="M20 48 L 4 10 Q 20 -4 36 10 Z" fill="#fff3c8" stroke="#7a5216" strokeWidth="2.5" />
          <circle cx="20" cy="14" r="5" fill="#c4121f" />
        </svg>
      </div>
      {!view.done && (
        <Button className="mt-4" onClick={() => void go()} loading={busy || spinning} disabled={spinning} data-testid="wheel-spin">
          Girar la rueda
        </Button>
      )}
      {!view.done && <p className="mt-2 text-xs text-niebla">El premio ya está decidido; la rueda solo lo muestra.</p>}
    </div>
  );
}

/* ------------------------------ Caja fuerte ------------------------------ */

function SafeGame({ view, busy, onPick }: { view: Extract<ExtraView, { kind: 'safe' }>; busy: boolean; onPick: (i: number) => Promise<ActResponse | null> }) {
  const opened = new Map(view.opened.map((o) => [o.index, o.tier]));
  const counts: Record<JackpotTier, number> = { mini: 0, minor: 0, major: 0, grand: 0 };
  for (const o of view.opened) counts[o.tier] += 1;
  return (
    <div className="mt-2 w-full max-w-xl">
      <p className="text-center text-sm text-niebla">{view.done ? 'Estas eran todas las cajas.' : 'Abre cajas hasta encontrar tres iguales: ganas ese bote.'}</p>
      <div className="mt-3 grid grid-cols-4 gap-2 text-center">
        {(['grand', 'major', 'minor', 'mini'] as const).map((t) => (
          <div key={t} className="flex flex-col items-center gap-1">
            <span className={cx('text-[11px] font-semibold uppercase tracking-wider', TIER_STYLE[t].text === 'text-[#2a1a05]' ? 'text-oro-claro' : 'text-niebla')}>{TIER_LABEL[t]}</span>
            <div className="flex gap-1">{[0, 1, 2].map((k) => <span key={k} className={cx('h-3 w-3 rounded-full border border-white/30', k < counts[t] && cx('bg-gradient-to-b', TIER_STYLE[t].bg))} />)}</div>
          </div>
        ))}
      </div>
      <div className="mx-auto mt-4 grid max-w-md grid-cols-5 gap-2">
        {Array.from({ length: view.count }, (_, i) => {
          const tier = opened.get(i) ?? (view.revealed ? view.revealed[i]! : null);
          const mine = opened.has(i);
          const win = view.winner !== null && tier === view.winner && mine;
          return (
            <motion.button
              key={i}
              type="button"
              disabled={busy || view.done || mine}
              onClick={() => { audio.play('click'); void onPick(i); }}
              whileHover={!mine && !view.done ? { y: -3, scale: 1.05 } : undefined}
              whileTap={!mine ? { scale: 0.94 } : undefined}
              className={cx('relative grid aspect-square place-items-center rounded-xl border bg-black/30', win ? 'border-oro-claro shadow-[0_0_20px_rgba(244,210,122,0.6)]' : mine ? 'border-white/30' : view.done ? 'border-white/5 opacity-55' : 'border-[#ff8be6]/30 hover:border-[#ff8be6]')}
              aria-label={tier ? `Caja ${i + 1}: ${TIER_LABEL[tier]}` : `Abrir caja ${i + 1}`}
              data-testid={`safe-${i}`}
            >
              <AnimatePresence mode="wait">
                {tier ? (
                  <motion.span key="t" initial={{ rotateY: 90, scale: 0.5 }} animate={{ rotateY: 0, scale: 1 }} transition={{ type: 'spring', stiffness: 300, damping: 18 }} className={cx('rounded-md bg-gradient-to-b px-1 py-0.5 text-[10px] font-extrabold uppercase sm:text-xs', TIER_STYLE[tier].bg, TIER_STYLE[tier].text, !mine && 'opacity-70')}>
                    {TIER_LABEL[tier]}
                  </motion.span>
                ) : (
                  <motion.span key="c" exit={{ scale: 0.6, opacity: 0 }}><SlotSymbolArt symbol="safe" size={46} /></motion.span>
                )}
              </AnimatePresence>
            </motion.button>
          );
        })}
      </div>
    </div>
  );
}

/* ------------------------------ Hold & Win ------------------------------ */

function HoldWinGame({ view, busy, onRespin }: { view: Extract<ExtraView, { kind: 'holdwin' }>; busy: boolean; onRespin: () => Promise<ActResponse | null> }) {
  const [rolling, setRolling] = useState(false);
  const [fresh, setFresh] = useState<number[]>(view.last);
  const { motion: level } = useSession();

  const respin = async (): Promise<void> => {
    if (rolling || view.done) return;
    setRolling(true);
    setFresh([]);
    audio.play('spinStart');
    const started = performance.now();
    const r = await onRespin();
    // Breve giro de las casillas vacías antes de mostrar lo que ha caído (ya decidido por el servidor).
    const wait = Math.max(0, (level === 'off' ? 0 : level === 'reduced' ? 350 : 850) - (performance.now() - started));
    window.setTimeout(() => {
      setRolling(false);
      const landed = (r?.reveal as { landed?: number[] } | null)?.landed ?? [];
      setFresh(landed);
      if (landed.length) audio.play('coins');
    }, wait);
  };

  return (
    <div className="mt-2 w-full max-w-xl">
      <div className="flex items-center justify-center gap-3 text-sm text-marfil">
        <span>Re-giros</span>
        <div className="flex gap-1.5" data-testid="respins">
          {[0, 1, 2].map((k) => <span key={k} className={cx('h-3.5 w-3.5 rounded-full border border-[#ff8be6]/60', k < view.respinsLeft && 'bg-[#ff8be6] shadow-[0_0_10px_#ff8be6]')} />)}
        </div>
        <span className="text-niebla">· Llena las 15 casillas para el Grand</span>
      </div>
      <div className="mx-auto mt-3 grid max-w-lg grid-cols-5 gap-1.5 rounded-2xl border-4 border-[#3a2c12] bg-[#12051a] p-1.5" data-testid="holdwin-board">
        {/* Celdas por filas: la celda (rodillo r, fila f) es r·3 + f. */}
        {[0, 1, 2].flatMap((row) => [0, 1, 2, 3, 4].map((reel) => {
          const i = reel * 3 + row;
          const v = view.cells[i];
          const isNew = fresh.includes(i);
          return (
            <div key={i} className={cx('relative grid aspect-square place-items-center overflow-hidden rounded-lg', v ? 'bg-gradient-to-b from-[#3a1446] to-[#16061c]' : 'bg-black/50')}>
              {v ? (
                <motion.div className="flex flex-col items-center" initial={isNew ? { scale: 0.2, rotate: -40, opacity: 0 } : false} animate={{ scale: 1, rotate: 0, opacity: 1 }} transition={{ type: 'spring', stiffness: 320, damping: 16 }}>
                  <SlotSymbolArt symbol="cash" size={40} />
                  <span className={cx('-mt-1 rounded px-1 text-[10px] font-extrabold tabular-nums sm:text-xs', v.kind === 'jackpot' ? cx('bg-gradient-to-b', TIER_STYLE[v.tier].bg, TIER_STYLE[v.tier].text) : 'text-oro-claro')}>
                    {v.kind === 'credit' ? credits(v.mult * view.totalBet) : TIER_LABEL[v.tier]}
                  </span>
                </motion.div>
              ) : rolling ? (
                <motion.div className="h-full w-full bg-[repeating-linear-gradient(180deg,rgba(255,139,230,0.18)_0_6px,transparent_6px_14px)]" animate={{ backgroundPositionY: ['0px', '28px'] }} transition={{ duration: 0.18, repeat: Infinity, ease: 'linear' }} />
              ) : null}
              {isNew && <span className="pointer-events-none absolute inset-0 rounded-lg ring-2 ring-oro-claro" />}
            </div>
          );
        }))}
      </div>
      <p className="mt-3 text-center text-sm text-niebla">Acumulado: <span className="font-display text-xl text-oro-claro tabular-nums">{credits(view.won)}</span></p>
      {!view.done && (
        <div className="mt-2 flex justify-center">
          <Button onClick={() => void respin()} loading={busy || rolling} disabled={rolling} data-testid="holdwin-respin">Re-girar</Button>
        </div>
      )}
    </div>
  );
}
