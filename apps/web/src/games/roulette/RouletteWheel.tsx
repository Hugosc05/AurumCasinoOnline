import { WHEEL_ORDER, numberColor } from '@aurum/engine';
import { forwardRef, memo, useEffect, useImperativeHandle, useRef } from 'react';
import { audio, type LoopHandle } from '../../lib/audio';
import { POCKET_DEG, planSpin, type SpinPlan } from './rouletteAnim';

export interface WheelHandle {
  /** Gira hasta el bolsillo indicado. Resuelve al asentarse la bola. */
  spin(pocketIndex: number, durationMs: number, bounces: boolean): Promise<void>;
  skip(): void;
  busy(): boolean;
}

const SIZE = 600;
const C = SIZE / 2;
const R_OUT = 292; // madera exterior
const R_TRACK = 262; // pista de la bola
const R_POCKET_OUT = 214;
const R_POCKET_IN = 168;
const R_NUM = 204;
const R_NUM_IN = 194;
const R_BALL_SEAT = 181;
const R_CONE = 150;

const COLORS = { red: '#a3202f', black: '#10151f', green: '#0f6b47' } as const;

function polar(r: number, deg: number): [number, number] {
  const a = ((deg - 90) * Math.PI) / 180;
  return [C + r * Math.cos(a), C + r * Math.sin(a)];
}

function sector(r1: number, r2: number, a1: number, a2: number): string {
  const [x1, y1] = polar(r2, a1);
  const [x2, y2] = polar(r2, a2);
  const [x3, y3] = polar(r1, a2);
  const [x4, y4] = polar(r1, a1);
  return `M${x1} ${y1} A${r2} ${r2} 0 0 1 ${x2} ${y2} L${x3} ${y3} A${r1} ${r1} 0 0 0 ${x4} ${y4} Z`;
}

/** Rueda estática (se dibuja una vez; se rota con transform). */
const WheelFace = memo(function WheelFace({ highlight }: { highlight: number | null }) {
  return (
    <>
      {WHEEL_ORDER.map((n, i) => {
        const a1 = i * POCKET_DEG - POCKET_DEG / 2;
        const a2 = a1 + POCKET_DEG;
        const [tx, ty] = polar(R_NUM, i * POCKET_DEG);
        const col = numberColor(n);
        return (
          <g key={n}>
            <path d={sector(R_NUM_IN, R_POCKET_OUT, a1, a2)} fill={COLORS[col]} stroke="#c9a85f" strokeWidth="1.2" />
            <path d={sector(R_POCKET_IN, R_NUM_IN, a1, a2)} fill={COLORS[col]} stroke="#d8bb74" strokeWidth="1.6" />
            <path d={sector(R_POCKET_IN, R_NUM_IN, a1, a2)} fill="rgba(0,0,0,0.42)" />
            {highlight === i && <path d={sector(R_POCKET_IN, R_POCKET_OUT, a1, a2)} fill="rgba(255,236,180,0.35)" stroke="#fff3cf" strokeWidth="2.5" />}
            <text
              x={tx}
              y={ty}
              fill="#f6efe0"
              fontSize="15"
              fontWeight="600"
              fontFamily="'Bodoni Moda Variable', Georgia, serif"
              textAnchor="middle"
              dominantBaseline="central"
              transform={`rotate(${i * POCKET_DEG} ${tx} ${ty})`}
            >
              {n}
            </text>
          </g>
        );
      })}
      {/* Cono central y torreta */}
      <circle cx={C} cy={C} r={R_POCKET_IN} fill="url(#coneGrad)" stroke="#c9a85f" strokeWidth="2" />
      {Array.from({ length: 8 }, (_, i) => (
        <path key={i} d={sector(R_CONE - 40, R_CONE, i * 45 - 8, i * 45 + 8)} fill="rgba(207,174,107,0.08)" />
      ))}
      <circle cx={C} cy={C} r={R_CONE - 48} fill="url(#woodInner)" stroke="#8e7340" strokeWidth="1.5" />
      {[0, 90, 180, 270].map((a) => {
        const [x, y] = polar(70, a);
        return (
          <g key={a}>
            <line x1={C} y1={C} x2={x} y2={y} stroke="url(#gold)" strokeWidth="9" strokeLinecap="round" />
            <circle cx={x} cy={y} r="9" fill="url(#gold)" stroke="#6b5326" strokeWidth="1" />
          </g>
        );
      })}
      <circle cx={C} cy={C} r="22" fill="url(#gold)" stroke="#6b5326" strokeWidth="1.5" />
      <circle cx={C - 6} cy={C - 7} r="6" fill="rgba(255,255,255,0.55)" />
    </>
  );
});

interface Props {
  highlight?: number | null;
  /** Rotación lenta en reposo (portada). */
  idle?: boolean;
  initialPocket?: number;
  className?: string;
  label?: string;
}

/**
 * Ruleta europea 2.5D en SVG: madera, pista metálica, deflectores, 37
 * bolsillos en el orden real y bola con trayectoria física.
 * La animación corre en requestAnimationFrame actualizando atributos del
 * DOM directamente (sin re-render de React) para mantener 60 FPS.
 */
export const RouletteWheel = forwardRef<WheelHandle, Props>(function RouletteWheel({ highlight = null, idle = false, initialPocket = 0, className, label }, ref) {
  const wheelRef = useRef<SVGGElement>(null);
  const ballRef = useRef<SVGGElement>(null);
  const state = useRef({ wheel: 0, ballRel: initialPocket * POCKET_DEG, radius: 0 });
  const raf = useRef<number | null>(null);
  const running = useRef<{ plan: SpinPlan; start: number; resolve: () => void; skip: boolean; loop: LoopHandle; lastTickPocket: number; dropped: boolean } | null>(null);

  const draw = (): void => {
    const s = state.current;
    wheelRef.current?.setAttribute('transform', `rotate(${s.wheel} ${C} ${C})`);
    const r = R_BALL_SEAT + (R_TRACK - R_BALL_SEAT) * s.radius;
    const [x, y] = polar(r, s.wheel + s.ballRel);
    ballRef.current?.setAttribute('transform', `translate(${x} ${y})`);
  };

  useEffect(() => {
    draw();
    return () => {
      if (raf.current) cancelAnimationFrame(raf.current);
      running.current?.loop.stop(50);
      running.current?.resolve();
      running.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Rotación de reposo para la portada.
  useEffect(() => {
    if (!idle) return;
    let last = performance.now();
    let id = 0;
    const step = (now: number): void => {
      const dt = now - last;
      last = now;
      if (!running.current) {
        state.current.wheel += dt * 0.006;
        draw();
      }
      id = requestAnimationFrame(step);
    };
    id = requestAnimationFrame(step);
    return () => cancelAnimationFrame(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [idle]);

  const tick = (now: number): void => {
    const run = running.current;
    if (!run) return;
    const t = run.skip ? run.plan.duration : now - run.start;
    const f = run.plan.frame(t);
    state.current = { wheel: f.wheel, ballRel: f.ballRel, radius: f.radius };
    draw();
    run.loop.setIntensity(f.phase === 'seated' ? 0 : 0.25 + f.speed * 0.75);
    if (f.phase === 'drop') {
      const pocket = Math.floor((((f.ballRel % 360) + 360) % 360) / POCKET_DEG);
      if (pocket !== run.lastTickPocket && f.radius < 0.55) {
        run.lastTickPocket = pocket;
        audio.play('ballTick');
      }
    }
    if (f.phase === 'seated' && !run.dropped) {
      run.dropped = true;
      audio.play('ballDrop');
    }
    if (t >= run.plan.duration) {
      run.loop.stop(300);
      running.current = null;
      raf.current = null;
      run.resolve();
      return;
    }
    raf.current = requestAnimationFrame(tick);
  };

  useImperativeHandle(ref, () => ({
    spin(pocketIndex, durationMs, bounces) {
      return new Promise<void>((resolve) => {
        if (raf.current) cancelAnimationFrame(raf.current);
        running.current?.resolve();
        const plan = planSpin({
          pocketIndex,
          wheelAngle: state.current.wheel % 360,
          ballRelAngle: state.current.ballRel % 360,
          duration: durationMs,
          bounces,
          variation: Math.random(),
        });
        if (durationMs <= 0) {
          const f = plan.final;
          state.current = { wheel: f.wheel, ballRel: f.ballRel, radius: 0 };
          draw();
          resolve();
          return;
        }
        running.current = { plan, start: performance.now(), resolve, skip: false, loop: audio.loop('roll'), lastTickPocket: -1, dropped: false };
        raf.current = requestAnimationFrame(tick);
      });
    },
    skip() {
      if (running.current) running.current.skip = true;
    },
    busy() {
      return running.current !== null;
    },
  }));

  // Marcas de los deflectores (rombos metálicos) en la pista.
  const diamonds = Array.from({ length: 8 }, (_, i) => i * 45 + 22.5);

  return (
    <svg viewBox={`0 0 ${SIZE} ${SIZE}`} className={className} role="img" aria-label={label ?? 'Ruleta europea'}>
      <defs>
        <radialGradient id="woodOuter" cx="50%" cy="45%" r="55%">
          <stop offset="0.82" stopColor="#4a2c17" />
          <stop offset="0.92" stopColor="#2a170b" />
          <stop offset="1" stopColor="#140a04" />
        </radialGradient>
        <radialGradient id="woodInner" cx="45%" cy="40%" r="70%">
          <stop offset="0" stopColor="#6b4325" />
          <stop offset="1" stopColor="#2b190c" />
        </radialGradient>
        <radialGradient id="trackGrad" cx="50%" cy="50%" r="50%">
          <stop offset="0.75" stopColor="#1c140e" />
          <stop offset="0.86" stopColor="#3a2a1b" />
          <stop offset="0.92" stopColor="#5c452c" />
          <stop offset="1" stopColor="#2a1c10" />
        </radialGradient>
        <radialGradient id="coneGrad" cx="45%" cy="40%" r="65%">
          <stop offset="0" stopColor="#7a5230" />
          <stop offset="0.7" stopColor="#3b2412" />
          <stop offset="1" stopColor="#24160a" />
        </radialGradient>
        <linearGradient id="gold" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#fff1c8" />
          <stop offset="0.45" stopColor="#d6b46c" />
          <stop offset="1" stopColor="#7b5d2a" />
        </linearGradient>
        <radialGradient id="ballGrad" cx="35%" cy="30%" r="70%">
          <stop offset="0" stopColor="#ffffff" />
          <stop offset="0.5" stopColor="#e8e8ea" />
          <stop offset="1" stopColor="#8d8f96" />
        </radialGradient>
        <radialGradient id="sheen" cx="35%" cy="25%" r="75%">
          <stop offset="0" stopColor="#fff" stopOpacity="0.16" />
          <stop offset="0.5" stopColor="#fff" stopOpacity="0" />
        </radialGradient>
      </defs>
      {/* Cuenco fijo */}
      <circle cx={C} cy={C} r={R_OUT + 6} fill="#0a0603" />
      <circle cx={C} cy={C} r={R_OUT} fill="url(#woodOuter)" stroke="#8e7340" strokeWidth="2" />
      <circle cx={C} cy={C} r={R_TRACK + 14} fill="url(#trackGrad)" stroke="#a88a4e" strokeWidth="1.2" />
      <circle cx={C} cy={C} r={R_POCKET_OUT + 18} fill="#1a110a" stroke="#6b5326" strokeWidth="1" />
      {diamonds.map((a) => {
        const [x, y] = polar(R_POCKET_OUT + 30, a);
        return <rect key={a} x={x - 5} y={y - 9} width="10" height="18" rx="2" fill="url(#gold)" transform={`rotate(${a} ${x} ${y})`} />;
      })}
      {/* Rueda giratoria */}
      <g ref={wheelRef}>
        <WheelFace highlight={highlight} />
      </g>
      {/* Bola */}
      <g ref={ballRef}>
        <circle r="10" cy="3" fill="rgba(0,0,0,0.45)" />
        <circle r="9" fill="url(#ballGrad)" />
      </g>
      <circle cx={C} cy={C} r={R_OUT} fill="url(#sheen)" pointerEvents="none" />
      {/* Indicador fijo */}
      <path d={`M${C} ${C - R_TRACK - 8} l-9 -17 h18 Z`} fill="url(#gold)" stroke="#6b5326" />
    </svg>
  );
});
