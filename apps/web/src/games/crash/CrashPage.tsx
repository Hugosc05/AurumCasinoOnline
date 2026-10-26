import { AnimatePresence, motion } from 'motion/react';
import { Bot, ShieldCheck } from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { CRASH_LIMITS, CRASH_MAX, crashPayout, crashPointFromHex, formatMultiplier } from '@aurum/engine';
import { GameHeader, OddsNote } from '../../components/GameKit';
import { ChatProvider, TableChat } from '../../components/chat/TableChat';
import { PlayerName } from '../../components/social/PlayerAvatar';
import { usePlayerCard } from '../../components/social/PlayerCard';
import { Button } from '../../components/ui';
import { audio, type LoopHandle } from '../../lib/audio';
import { credits, cx } from '../../lib/format';
import { socket } from '../../lib/ws';
import { useNotify } from '../../state/notify';
import { useSession } from '../../state/session';

/**
 * Cohete. Todos ven la misma ronda: el servidor fija el punto de choque antes
 * de abrir las apuestas (publica el hash de la semilla) y calcula cada cobro
 * con su reloj. Aquí solo se dibuja el vuelo con el reloj sincronizado.
 */

interface CrashBet { name: string; bot: boolean; you: boolean; amount: number; cashedAt: number | null; payout: number }
interface CrashState {
  roundNo: number;
  phase: 'idle' | 'betting' | 'running' | 'crashed';
  seedHash: string;
  bettingEndsAt: number;
  startedAt: number;
  serverTime: number;
  rate: number;
  crash: number | null;
  seed: string | null;
  bets: CrashBet[];
  you: { amount: number; auto: number | null; cashedAt: number | null; payout: number } | null;
  history: { roundNo: number; crash: number; seed: string; seedHash: string }[];
}

const chipColor = (c: number): string => (c < 200 ? 'bg-rubi/25 text-[#ffb3bb]' : c < 1000 ? 'bg-oro/20 text-oro-claro' : 'bg-exito/20 text-exito');

async function sha256Hex(text: string): Promise<string> {
  const d = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return Array.from(new Uint8Array(d), (b) => b.toString(16).padStart(2, '0')).join('');
}
async function hmacHex(key: string, msg: string): Promise<string> {
  const k = await crypto.subtle.importKey('raw', new TextEncoder().encode(key), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const sig = await crypto.subtle.sign('HMAC', k, new TextEncoder().encode(msg));
  return Array.from(new Uint8Array(sig), (b) => b.toString(16).padStart(2, '0')).join('');
}

/* ------------------------------ Escenario ------------------------------ */

interface Star { x: number; y: number; z: number }

function useStage(state: CrashState | null, offset: React.MutableRefObject<number>, level: string) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const rocketRef = useRef<HTMLDivElement>(null);
  const multRef = useRef<HTMLParagraphElement>(null);
  const stars = useRef<Star[]>([]);
  const stateRef = useRef(state);
  stateRef.current = state;
  const size = useRef({ w: 800, h: 450, dpr: 1 });
  const explosion = useRef<{ x: number; y: number; at: number; parts: { vx: number; vy: number; r: number; hue: number }[] } | null>(null);
  const tip = useRef({ x: 0, y: 0, angle: 0 });
  const lastT = useRef(performance.now());

  useEffect(() => {
    stars.current = Array.from({ length: 140 }, () => ({ x: Math.random(), y: Math.random(), z: 0.2 + Math.random() * 0.8 }));
    const wrap = wrapRef.current!;
    const canvas = canvasRef.current!;
    const resize = (): void => {
      const w = wrap.clientWidth;
      const h = wrap.clientHeight;
      const dpr = Math.min(2, window.devicePixelRatio || 1);
      size.current = { w, h, dpr };
      canvas.width = Math.round(w * dpr);
      canvas.height = Math.round(h * dpr);
    };
    resize();
    const ro = new ResizeObserver(resize);
    ro.observe(wrap);
    let raf = 0;
    const loop = (now: number): void => {
      const dt = Math.min(0.05, (now - lastT.current) / 1000);
      lastT.current = now;
      const st = stateRef.current;
      const { w, h, dpr } = size.current;
      const ctx = canvas.getContext('2d')!;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, w, h);
      const serverNow = Date.now() + offset.current;
      let elapsed = 0;
      let mult = 100;
      if (st?.phase === 'running') {
        elapsed = Math.max(0, serverNow - st.startedAt);
        mult = Math.min(CRASH_MAX, Math.floor(100 * Math.exp(st.rate * elapsed)));
      } else if (st?.phase === 'crashed' && st.crash) {
        mult = st.crash;
        elapsed = Math.log(st.crash / 100) / st.rate;
      }
      // Estrellas: viajan más rápido cuanto más alto va el cohete.
      const speed = st?.phase === 'running' ? 0.04 + Math.min(1.4, Math.log(mult / 100) * 0.5) : 0.01;
      ctx.fillStyle = '#ffffff';
      for (const s of stars.current) {
        if (level === 'full') {
          s.x -= speed * dt * s.z * 0.6;
          s.y += speed * dt * s.z * 0.9;
          if (s.x < 0) s.x += 1;
          if (s.y > 1) s.y -= 1;
        }
        ctx.globalAlpha = 0.25 + s.z * 0.6;
        const len = st?.phase === 'running' ? 1 + speed * 14 * s.z : 1;
        ctx.fillRect(s.x * w, s.y * h, Math.max(1, s.z * 1.6), Math.max(1, s.z * 1.6 * len * 0.4));
      }
      ctx.globalAlpha = 1;
      // Ejes: el tiempo y el multiplicador se reescalan para que la curva siempre quepa.
      const padL = 46;
      const padB = 30;
      const gw = w - padL - 24;
      const gh = h - padB - 40;
      const tMax = Math.max(10_000, elapsed * 1.15);
      const mMax = Math.max(2, (mult / 100) * 1.25);
      const X = (t: number): number => padL + (t / tMax) * gw;
      const Y = (m: number): number => h - padB - ((m - 1) / (mMax - 1)) * gh;
      ctx.strokeStyle = 'rgba(255,255,255,0.08)';
      ctx.fillStyle = 'rgba(255,255,255,0.45)';
      ctx.font = '11px Manrope, system-ui, sans-serif';
      ctx.lineWidth = 1;
      const stepM = mMax <= 3 ? 0.5 : mMax <= 6 ? 1 : mMax <= 15 ? 2 : mMax <= 40 ? 5 : mMax <= 120 ? 20 : 100;
      for (let m = 1; m <= mMax; m += stepM) {
        ctx.beginPath();
        ctx.moveTo(padL, Y(m));
        ctx.lineTo(w - 20, Y(m));
        ctx.stroke();
        ctx.fillText(`${m.toFixed(m < 10 && stepM < 1 ? 1 : 0)}×`, 8, Y(m) + 4);
      }
      const stepT = tMax <= 20_000 ? 2000 : tMax <= 60_000 ? 10_000 : 20_000;
      for (let t = 0; t <= tMax; t += stepT) ctx.fillText(`${Math.round(t / 1000)} s`, X(t) - 8, h - 10);
      // Curva con relleno degradado.
      if (st && (st.phase === 'running' || st.phase === 'crashed')) {
        const crashed = st.phase === 'crashed';
        const pts: [number, number][] = [];
        const n = 90;
        for (let i = 0; i <= n; i += 1) {
          const t = (elapsed * i) / n;
          pts.push([X(t), Y(Math.exp(st.rate * t))]);
        }
        const grad = ctx.createLinearGradient(0, h, 0, Y(mult / 100));
        grad.addColorStop(0, crashed ? 'rgba(220,40,60,0.02)' : 'rgba(255,79,184,0.02)');
        grad.addColorStop(1, crashed ? 'rgba(220,40,60,0.35)' : 'rgba(255,170,60,0.38)');
        ctx.beginPath();
        ctx.moveTo(X(0), h - padB);
        for (const [x, y] of pts) ctx.lineTo(x, y);
        ctx.lineTo(pts.at(-1)![0], h - padB);
        ctx.closePath();
        ctx.fillStyle = grad;
        ctx.fill();
        ctx.beginPath();
        pts.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)));
        ctx.strokeStyle = crashed ? '#ff4b5c' : '#ffcf5a';
        ctx.lineWidth = 3.5;
        ctx.shadowColor = crashed ? '#ff4b5c' : '#ffb347';
        ctx.shadowBlur = 14;
        ctx.stroke();
        ctx.shadowBlur = 0;
        const [x1, y1] = pts.at(-1)!;
        const [x0, y0] = pts.at(-4) ?? [x1 - 1, y1];
        tip.current = { x: x1, y: y1, angle: Math.atan2(y1 - y0, x1 - x0) };
      } else {
        tip.current = { x: X(0) + 10, y: h - padB - 8, angle: -Math.PI / 4 };
      }
      // Explosión.
      const ex = explosion.current;
      if (ex) {
        const age = (now - ex.at) / 1000;
        if (age > 1.6) explosion.current = null;
        else {
          for (const p of ex.parts) {
            const px = ex.x + p.vx * age * 160;
            const py = ex.y + p.vy * age * 160 + 90 * age * age;
            ctx.globalAlpha = Math.max(0, 1 - age / 1.6);
            ctx.fillStyle = `hsl(${p.hue} 100% ${60 - age * 20}%)`;
            ctx.beginPath();
            ctx.arc(px, py, p.r * (1 - age / 2), 0, Math.PI * 2);
            ctx.fill();
          }
          ctx.globalAlpha = 1;
        }
      }
      // Cohete (DOM, para el SVG con llama animada) y multiplicador.
      const rk = rocketRef.current;
      if (rk) {
        const crashed = st?.phase === 'crashed';
        rk.style.transform = `translate3d(${tip.current.x - 28}px, ${tip.current.y - 28}px, 0) rotate(${(tip.current.angle * 180) / Math.PI + 90}deg)`;
        rk.style.opacity = crashed ? '0' : '1';
        rk.dataset.flying = st?.phase === 'running' ? '1' : '0';
      }
      if (multRef.current && st) {
        multRef.current.textContent = st.phase === 'betting' ? '' : formatMultiplier(mult);
        const hue = st.phase === 'crashed' ? 355 : Math.max(20, 55 - Math.log(mult / 100) * 12);
        multRef.current.style.color = st.phase === 'crashed' ? '#ff5468' : mult < 120 ? '#f8f4ea' : `hsl(${hue} 100% 65%)`;
      }
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
    };
  }, [level, offset]);

  const explode = useCallback(() => {
    const parts = Array.from({ length: 46 }, () => {
      const a = Math.random() * Math.PI * 2;
      const v = 0.3 + Math.random() * 1.2;
      return { vx: Math.cos(a) * v, vy: Math.sin(a) * v - 0.4, r: 2 + Math.random() * 5, hue: 10 + Math.random() * 40 };
    });
    explosion.current = { x: tip.current.x, y: tip.current.y, at: performance.now(), parts };
  }, []);

  return { canvasRef, wrapRef, rocketRef, multRef, explode };
}

function Rocket() {
  return (
    <svg viewBox="0 0 56 56" width="56" height="56" className="overflow-visible drop-shadow-[0_6px_10px_rgba(0,0,0,0.6)]" aria-hidden>
      <defs>
        <linearGradient id="rk-body" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stopColor="#9aa3b5" /><stop offset="0.45" stopColor="#ffffff" /><stop offset="1" stopColor="#6d778b" /></linearGradient>
        <linearGradient id="rk-red" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stopColor="#8e1020" /><stop offset="0.5" stopColor="#ff4a5c" /><stop offset="1" stopColor="#7a0c18" /></linearGradient>
        <radialGradient id="rk-flame" cx="50%" cy="20%" r="80%"><stop offset="0" stopColor="#fffbe0" /><stop offset="0.35" stopColor="#ffd34d" /><stop offset="0.7" stopColor="#ff7a1a" /><stop offset="1" stopColor="#ff2d00" stopOpacity="0" /></radialGradient>
      </defs>
      {/* Llama (apunta hacia abajo; el conjunto se gira 45° para seguir la curva) */}
      <g className="rocket-flame" transform="translate(28 44)">
        <path d="M-6 0 Q 0 26 6 0 Z" fill="url(#rk-flame)" />
        <path d="M-3 0 Q 0 14 3 0 Z" fill="#fffbe0" />
      </g>
      <path d="M28 4 C 38 14 38 30 35 42 H 21 C 18 30 18 14 28 4 Z" fill="url(#rk-body)" stroke="#2b3140" strokeWidth="1.2" />
      <path d="M28 4 C 33 9 35 13 36 18 H 20 C 21 13 23 9 28 4 Z" fill="url(#rk-red)" />
      <circle cx="28" cy="25" r="4.5" fill="#1d4f8f" stroke="#e9eef6" strokeWidth="1.6" />
      <circle cx="26.6" cy="23.6" r="1.4" fill="#ffffff" opacity="0.8" />
      <path d="M21 32 L 12 44 L 21 41 Z M35 32 L 44 44 L 35 41 Z" fill="url(#rk-red)" stroke="#5c0a12" strokeWidth="1" />
      <rect x="24" y="41" width="8" height="4" rx="1" fill="#3b4250" />
    </svg>
  );
}

/* -------------------------------- Página -------------------------------- */

function CrashInner() {
  const openCard = usePlayerCard();
  const { user, motion: level } = useSession();
  const { notify } = useNotify();
  const [state, setState] = useState<CrashState | null>(null);
  const [connected, setConnected] = useState(socket.status === 'open');
  const [amount, setAmount] = useState(20);
  const [autoOn, setAutoOn] = useState(false);
  const [auto, setAuto] = useState('2.00');
  const [now, setNow] = useState(Date.now());
  const [verify, setVerify] = useState<Record<number, 'ok' | 'bad' | 'pending' | 'na'>>({});
  const offset = useRef(0);
  const prevPhase = useRef<CrashState['phase'] | null>(null);
  const engine = useRef<LoopHandle | null>(null);
  const stage = useStage(state, offset, level);

  useEffect(() => {
    const offs = [
      socket.onStatus((s) => setConnected(s === 'open')),
      socket.onOpen(() => socket.send({ t: 'crash.watch' })),
      socket.on('crash.state', (m) => {
        const st = m.state as CrashState;
        offset.current = st.serverTime - Date.now();
        setState(st);
      }),
      socket.on('error', (m) => {
        if (String(m.ref ?? '').startsWith('crash.')) {
          audio.play('error');
          notify('error', String(m.message));
        }
      }),
    ];
    return () => {
      offs.forEach((o) => o());
      socket.send({ t: 'crash.unwatch' });
      engine.current?.stop(100);
    };
  }, [notify]);

  // Sonido y explosión al cambiar de fase.
  useEffect(() => {
    if (!state) return;
    const prev = prevPhase.current;
    prevPhase.current = state.phase;
    if (prev === state.phase) return;
    if (state.phase === 'running') {
      audio.play('spinStart');
      engine.current?.stop(50);
      engine.current = audio.loop('rocket');
    } else {
      engine.current?.stop(200);
      engine.current = null;
    }
    if (state.phase === 'crashed' && prev === 'running') {
      audio.play('crash');
      if (level !== 'off') stage.explode();
    }
  }, [state, level, stage]);

  // Intensidad del motor y reloj de la cuenta atrás.
  useEffect(() => {
    const id = window.setInterval(() => {
      setNow(Date.now());
      const st = state;
      if (st?.phase === 'running' && engine.current) {
        const m = Math.exp(st.rate * (Date.now() + offset.current - st.startedAt));
        engine.current.setIntensity(Math.min(1, 0.2 + Math.log(m) / 3));
      }
    }, 100);
    return () => window.clearInterval(id);
  }, [state]);

  // Aviso al cobrar.
  const lastCash = useRef<number | null>(null);
  useEffect(() => {
    const c = state?.you?.cashedAt ?? null;
    if (c !== null && lastCash.current === null) audio.play('cashout');
    lastCash.current = c;
  }, [state?.you?.cashedAt]);

  const autoCents = Math.round(Number(auto.replace(',', '.')) * 100);
  const autoValid = Number.isFinite(autoCents) && autoCents >= CRASH_LIMITS.minAuto && autoCents <= CRASH_LIMITS.maxAuto;

  const act = useCallback(() => {
    if (!state || !user) return;
    if (state.phase === 'betting') {
      if (state.you) socket.send({ t: 'crash.cancel', roundNo: state.roundNo });
      else {
        if (autoOn && !autoValid) {
          notify('error', 'El cobro automático debe estar entre 1,01× y 1.000×.');
          return;
        }
        audio.play('chips');
        socket.send({ t: 'crash.bet', roundNo: state.roundNo, amount, auto: autoOn ? autoCents : null });
      }
    } else if (state.phase === 'running' && state.you && state.you.cashedAt === null) {
      socket.send({ t: 'crash.cashout', roundNo: state.roundNo });
    }
  }, [amount, auto, autoCents, autoOn, autoValid, notify, state, user]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.code !== 'Space' || e.target instanceof HTMLInputElement || e.repeat) return;
      e.preventDefault();
      act();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [act]);

  const verifyRound = async (h: CrashState['history'][number]): Promise<void> => {
    if (typeof crypto === 'undefined' || !crypto.subtle) {
      // El navegador solo ofrece criptografía en conexiones seguras (HTTPS o localhost).
      setVerify((v) => ({ ...v, [h.roundNo]: 'na' }));
      return;
    }
    setVerify((v) => ({ ...v, [h.roundNo]: 'pending' }));
    try {
      const okHash = (await sha256Hex(h.seed)) === h.seedHash;
      const okCrash = crashPointFromHex(await hmacHex(h.seed, `aurum-crash:${h.roundNo}`)) === h.crash;
      setVerify((v) => ({ ...v, [h.roundNo]: okHash && okCrash ? 'ok' : 'bad' }));
    } catch {
      setVerify((v) => ({ ...v, [h.roundNo]: 'bad' }));
    }
  };

  const serverNow = now + offset.current;
  const countdown = state?.phase === 'betting' ? Math.max(0, (state.bettingEndsAt - serverNow) / 1000) : 0;
  const liveMult = state?.phase === 'running' ? Math.floor(100 * Math.exp(state.rate * Math.max(0, serverNow - state.startedAt))) : 100;
  const you = state?.you ?? null;

  const button = useMemo(() => {
    if (!user) return { label: 'Inicia sesión para jugar', disabled: true, tone: 'gold' as const };
    if (!state || state.phase === 'idle') return { label: 'Conectando…', disabled: true, tone: 'gold' as const };
    if (state.phase === 'betting') return you ? { label: 'Retirar apuesta', disabled: false, tone: 'outline' as const } : { label: `Apostar ${credits(amount)}`, disabled: false, tone: 'gold' as const };
    if (state.phase === 'running' && you && you.cashedAt === null) return { label: `Cobrar ${formatMultiplier(liveMult)} · ${credits(crashPayout(you.amount, liveMult))}`, disabled: false, tone: 'cash' as const };
    if (you?.cashedAt) return { label: `Cobrado a ${formatMultiplier(you.cashedAt)} · ${credits(you.payout)}`, disabled: true, tone: 'gold' as const };
    return { label: state.phase === 'crashed' ? 'Siguiente ronda en un momento…' : 'Espera a la siguiente ronda', disabled: true, tone: 'gold' as const };
  }, [amount, liveMult, state, user, you]);

  return (
    <div className="mx-auto max-w-7xl px-4 pb-16 pt-8 sm:px-6">
      <GameHeader title="Cohete" subtitle="El multiplicador sube hasta que el cohete se estrella. Cobra antes y te llevas tu apuesta por el multiplicador." />
      {/* Historial de choques */}
      <div className="mb-3 flex gap-1.5 overflow-x-auto pb-1" aria-label="Últimos choques" data-testid="crash-history">
        <AnimatePresence initial={false}>
          {(state?.history ?? []).map((h) => (
            <motion.span key={h.roundNo} layout initial={{ opacity: 0, scale: 0.5 }} animate={{ opacity: 1, scale: 1 }} className={cx('shrink-0 rounded-full px-2.5 py-1 text-xs font-bold tabular-nums', chipColor(h.crash))}>
              {formatMultiplier(h.crash)}
            </motion.span>
          ))}
        </AnimatePresence>
      </div>
      <div className="grid gap-6 lg:grid-cols-[1fr_320px]">
        <div>
          <div ref={stage.wrapRef} className="crash-stage relative aspect-[16/10] w-full overflow-hidden rounded-[28px] border border-white/10 sm:aspect-[16/9]" data-testid="crash-stage">
            <canvas ref={stage.canvasRef} className="absolute inset-0 h-full w-full" aria-hidden />
            <div ref={stage.rocketRef} className="rocket pointer-events-none absolute left-0 top-0 will-change-transform"><Rocket /></div>
            <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center text-center" aria-live="polite">
              {state?.phase === 'betting' && (
                <div>
                  <p className="text-sm uppercase tracking-[0.3em] text-niebla">Despegue en</p>
                  <p className="font-display text-6xl tabular-nums text-marfil">{countdown.toFixed(1).replace('.', ',')} s</p>
                  <div className="mx-auto mt-3 h-1.5 w-56 overflow-hidden rounded-full bg-white/10">
                    <div className="h-full rounded-full bg-gradient-to-r from-[#ff4fb8] to-oro transition-[width] duration-100 ease-linear" style={{ width: `${(countdown / 7) * 100}%` }} />
                  </div>
                </div>
              )}
              <p ref={stage.multRef} className="crash-mult font-display text-[clamp(3rem,10vw,7rem)] leading-none tabular-nums" data-testid="crash-multiplier" />
              {state?.phase === 'crashed' && <p className="mt-2 text-lg font-semibold uppercase tracking-[0.25em] text-[#ff8a96]">¡Se ha estrellado!</p>}
              {you?.cashedAt && <p className="mt-2 rounded-full bg-exito/20 px-4 py-1 text-sm font-semibold text-exito">Has cobrado {credits(you.payout)} a {formatMultiplier(you.cashedAt)}</p>}
            </div>
            {!connected && <div className="absolute inset-x-0 top-3 text-center text-xs text-aviso">Sin conexión en tiempo real. Reintentando…</div>}
          </div>

          {/* Apuesta */}
          <div className="panel mt-4 grid gap-4 p-4 sm:grid-cols-[1fr_1fr_1.3fr] sm:items-end" data-testid="crash-controls">
            <label className="block">
              <span className="mb-1.5 block text-sm text-niebla">Apuesta</span>
              <div className="flex items-center gap-2">
                <button type="button" className="h-10 w-10 shrink-0 rounded-full border border-linea text-marfil" onClick={() => setAmount((a) => Math.max(CRASH_LIMITS.minBet, Math.floor(a / 2)))} aria-label="Mitad">½</button>
                <input type="number" inputMode="numeric" value={amount} min={CRASH_LIMITS.minBet} max={CRASH_LIMITS.maxBet} disabled={!!you}
                  onChange={(e) => setAmount(Math.max(CRASH_LIMITS.minBet, Math.min(CRASH_LIMITS.maxBet, Math.floor(Number(e.target.value) || 0))))}
                  className="h-10 w-full min-w-0 rounded-xl border border-linea bg-noche px-3 text-center font-display text-xl text-marfil disabled:opacity-60" aria-label="Apuesta" data-testid="crash-amount" />
                <button type="button" className="h-10 w-10 shrink-0 rounded-full border border-linea text-marfil" onClick={() => setAmount((a) => Math.min(CRASH_LIMITS.maxBet, a * 2))} aria-label="Doble">×2</button>
              </div>
            </label>
            <div>
              <label className="mb-1.5 flex items-center gap-2 text-sm text-niebla">
                <input type="checkbox" className="h-4 w-4 accent-[#cfae6b]" checked={autoOn} disabled={!!you} onChange={(e) => setAutoOn(e.target.checked)} data-testid="crash-auto-toggle" /> Cobro automático
              </label>
              <div className="relative">
                <input value={auto} onChange={(e) => setAuto(e.target.value)} disabled={!autoOn || !!you} inputMode="decimal"
                  className={cx('h-10 w-full rounded-xl border bg-noche px-3 pr-8 text-center font-display text-xl text-marfil disabled:opacity-50', autoOn && !autoValid ? 'border-rubi' : 'border-linea')} aria-label="Cobrar automáticamente a" />
                <span className="absolute right-3 top-1/2 -translate-y-1/2 text-niebla">×</span>
              </div>
            </div>
            <Button size="lg" variant={button.tone === 'outline' ? 'outline' : 'gold'} disabled={button.disabled} onClick={act}
              className={cx('w-full', button.tone === 'cash' && 'cash-button')} data-testid="crash-action">
              {button.label}
            </Button>
          </div>
          <p className="mt-2 text-xs text-niebla">Barra espaciadora: apostar o cobrar. Cada ronda empieza sola, pero solo juegas si apuestas en ella.</p>
        </div>

        {/* Jugadores y verificación */}
        <div className="space-y-4">
          <div className="panel p-4">
            <div className="mb-2 flex items-baseline justify-between">
              <h2 className="text-xl text-marfil">Ronda {state?.roundNo ?? '—'}</h2>
              <span className="text-xs text-niebla">{state?.bets.length ?? 0} apuestas</span>
            </div>
            <ul className="max-h-[340px] space-y-1 overflow-y-auto pr-1 text-sm" data-testid="crash-bets">
              {(state?.bets ?? []).map((b, i) => (
                <li key={`${b.name}-${i}`} className={cx('flex items-center justify-between gap-2 rounded-lg px-2 py-1.5', b.you ? 'bg-oro/10' : b.cashedAt ? 'bg-exito/10' : '')}>
                  <span className="flex min-w-0 items-center gap-1.5 truncate text-marfil">
                    {b.bot && <Bot className="h-3.5 w-3.5 shrink-0 text-niebla" aria-label="Bot" />}
                    {b.you || b.bot ? <span className="truncate">{b.you ? 'Tú' : b.name}</span> : (
                      <button type="button" className="truncate hover:underline" onClick={() => openCard(b.name)}><PlayerName name={b.name} /></button>
                    )}
                  </span>
                  <span className="tabular-nums text-niebla">{credits(b.amount)}</span>
                  <span className={cx('w-20 text-right tabular-nums', b.cashedAt ? 'text-exito' : state?.phase === 'crashed' ? 'text-[#f1a3ad]' : 'text-niebla')}>
                    {b.cashedAt ? `${formatMultiplier(b.cashedAt)}` : state?.phase === 'crashed' ? '—' : '…'}
                  </span>
                </li>
              ))}
              {state && state.bets.length === 0 && <li className="py-3 text-center text-niebla">Nadie ha apostado todavía.</li>}
            </ul>
            <p className="mt-2 text-[11px] text-niebla">Los bots están marcados y no juegan con créditos de nadie.</p>
          </div>
          <div className="panel p-4 text-sm">
            <h2 className="mb-1 flex items-center gap-1.5 text-lg text-marfil"><ShieldCheck className="h-4 w-4 text-oro" /> Ronda verificable</h2>
            <p className="text-xs text-niebla">Antes de apostar se publica el hash SHA-256 de la semilla. Al estrellarse se revela la semilla: el choque es HMAC-SHA256(semilla, «aurum-crash:ronda»).</p>
            <p className="mt-2 break-all font-mono text-[10px] text-niebla/80" title="Hash de la semilla de esta ronda">{state?.seedHash ?? ''}</p>
            <ul className="mt-2 max-h-40 space-y-1 overflow-y-auto">
              {(state?.history ?? []).slice(0, 6).map((h) => (
                <li key={h.roundNo} className="flex items-center justify-between gap-2 text-xs">
                  <span className="text-niebla">#{h.roundNo} · {formatMultiplier(h.crash)}</span>
                  <button type="button" className="text-oro-claro hover:underline" onClick={() => void verifyRound(h)}>
                    {verify[h.roundNo] === 'ok' ? '✓ Correcta' : verify[h.roundNo] === 'bad' ? '✗ No cuadra' : verify[h.roundNo] === 'na' ? 'Requiere HTTPS' : verify[h.roundNo] === 'pending' ? 'Comprobando…' : 'Verificar'}
                  </button>
                </li>
              ))}
            </ul>
            <p className="mt-2 text-[11px] text-niebla">Devolución teórica: 99 % (P(llegar a m) = 0,99 / m).</p>
          </div>
          <OddsNote />
        </div>
      </div>
    </div>
  );
}

/** Cohete con su chat. */
export default function CrashPage() {
  return (
    <ChatProvider channel="crash">
      <CrashInner />
      <TableChat />
    </ChatProvider>
  );
}
