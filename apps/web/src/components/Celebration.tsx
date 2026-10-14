import { forwardRef, useEffect, useImperativeHandle, useRef } from 'react';

/**
 * Efectos de partículas en Canvas 2D (ligero, sin dependencias).
 *
 * - `sparkle`: destellos alrededor de unos puntos (premio normal).
 * - `burst`: estallido de chispas y monedas doradas (premio destacado).
 * - `fireworks`: cohetes que estallan en el cielo de la máquina + lluvia dorada (premio excepcional).
 *
 * Es solo representación: se dispara DESPUÉS de conocer el resultado real.
 * El bucle se detiene solo cuando no quedan partículas y se limpia al desmontar.
 */
export type EffectKind = 'sparkle' | 'burst' | 'fireworks';
export type EffectsLevel = 'full' | 'reduced' | 'off';

export interface CelebrationHandle {
  /** Puntos en coordenadas relativas (0..1) del lienzo. */
  play(kind: EffectKind, points?: { x: number; y: number }[]): void;
  clear(): void;
}

interface Particle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number;
  max: number;
  size: number;
  color: string;
  kind: 'spark' | 'coin' | 'rocket' | 'glow';
  spin: number;
  drag: number;
  gravity: number;
  /** Para cohetes: color del estallido. */
  burstColor?: string;
}

const GOLDS = ['#FFF3C4', '#F4D27A', '#E2B24C', '#C9952F', '#FFFFFF'];
const FIREWORK_COLORS = ['#F4D27A', '#FFF3C4', '#F08A9A', '#8FD3FF', '#B9F6C8'];
const pick = <T,>(a: readonly T[]): T => a[Math.floor(Math.random() * a.length)]!;

export const Celebration = forwardRef<CelebrationHandle, { level: EffectsLevel; className?: string }>(function Celebration({ level, className }, ref) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const parts = useRef<Particle[]>([]);
  const raf = useRef<number | null>(null);
  const queue = useRef<{ at: number; fn: () => void }[]>([]);
  const levelRef = useRef(level);
  levelRef.current = level;

  const size = (): { w: number; h: number; dpr: number } => {
    const c = canvas.current!;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const w = c.clientWidth;
    const h = c.clientHeight;
    if (c.width !== Math.round(w * dpr) || c.height !== Math.round(h * dpr)) {
      c.width = Math.round(w * dpr);
      c.height = Math.round(h * dpr);
    }
    return { w, h, dpr };
  };

  const tick = (now: number, last: number): void => {
    const c = canvas.current;
    if (!c) return;
    const ctx = c.getContext('2d');
    if (!ctx) return;
    const { w, h, dpr } = size();
    const dt = Math.min(0.05, (now - last) / 1000);
    for (const q of queue.current.splice(0).filter((q) => (q.at <= now ? (q.fn(), false) : true))) queue.current.push(q);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);
    ctx.globalCompositeOperation = 'lighter';
    const next: Particle[] = [];
    for (const p of parts.current) {
      p.life += dt;
      if (p.life >= p.max) {
        if (p.kind === 'rocket') explode(p.x, p.y, p.burstColor ?? '#F4D27A');
        continue;
      }
      p.vx *= 1 - p.drag * dt;
      p.vy = p.vy * (1 - p.drag * dt) + p.gravity * dt;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.spin += dt * 8;
      const k = 1 - p.life / p.max;
      if (p.kind === 'coin') {
        ctx.globalCompositeOperation = 'source-over';
        const sx = Math.abs(Math.cos(p.spin)) * p.size + 0.6;
        ctx.fillStyle = '#C9952F';
        ctx.beginPath();
        ctx.ellipse(p.x, p.y, sx, p.size, 0, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = '#F4D27A';
        ctx.beginPath();
        ctx.ellipse(p.x - sx * 0.15, p.y - p.size * 0.15, sx * 0.7, p.size * 0.7, 0, 0, Math.PI * 2);
        ctx.fill();
        ctx.globalCompositeOperation = 'lighter';
      } else if (p.kind === 'glow') {
        const r = p.size * (1 + (1 - k) * 2);
        const g = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, r);
        g.addColorStop(0, `rgba(255,236,180,${0.35 * k})`);
        g.addColorStop(1, 'rgba(255,236,180,0)');
        ctx.fillStyle = g;
        ctx.fillRect(p.x - r, p.y - r, r * 2, r * 2);
      } else {
        ctx.globalAlpha = Math.max(0, k);
        ctx.fillStyle = p.color;
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.size * (p.kind === 'rocket' ? 1 : 0.6 + k * 0.4), 0, Math.PI * 2);
        ctx.fill();
        // Estela corta
        ctx.globalAlpha = Math.max(0, k * 0.35);
        ctx.beginPath();
        ctx.arc(p.x - p.vx * 0.02, p.y - p.vy * 0.02, p.size * 0.7, 0, Math.PI * 2);
        ctx.fill();
        ctx.globalAlpha = 1;
      }
      if (p.y < h + 40 && p.x > -40 && p.x < w + 40) next.push(p);
    }
    parts.current = next.concat(pending.current.splice(0));
    if (parts.current.length > 0 || queue.current.length > 0) {
      raf.current = requestAnimationFrame((t) => tick(t, now));
    } else {
      ctx.clearRect(0, 0, w, h);
      raf.current = null;
    }
  };

  const pending = useRef<Particle[]>([]);
  const add = (p: Particle): void => {
    if (parts.current.length + pending.current.length > 650) return;
    pending.current.push(p);
  };

  function explode(x: number, y: number, color: string): void {
    const n = 46;
    for (let i = 0; i < n; i += 1) {
      const a = (i / n) * Math.PI * 2 + Math.random() * 0.1;
      const s = 120 + Math.random() * 130;
      add({ x, y, vx: Math.cos(a) * s, vy: Math.sin(a) * s, life: 0, max: 1 + Math.random() * 0.6, size: 2.2, color: Math.random() < 0.25 ? '#FFFFFF' : color, kind: 'spark', spin: 0, drag: 1.6, gravity: 90 });
    }
    add({ x, y, vx: 0, vy: 0, life: 0, max: 0.6, size: 40, color, kind: 'glow', spin: 0, drag: 0, gravity: 0 });
  }

  const start = (): void => {
    if (raf.current === null) {
      const t0 = performance.now();
      raf.current = requestAnimationFrame((t) => tick(t, t0));
    }
  };

  useImperativeHandle(ref, () => ({
    play(kind, points = [{ x: 0.5, y: 0.5 }]) {
      const lv = levelRef.current;
      if (lv === 'off' || !canvas.current || document.hidden) return;
      const { w, h } = size();
      const reduced = lv === 'reduced';
      const abs = points.map((p) => ({ x: p.x * w, y: p.y * h }));
      if (kind === 'sparkle' || reduced) {
        for (const p of abs) {
          add({ x: p.x, y: p.y, vx: 0, vy: 0, life: 0, max: 0.7, size: 26, color: '#fff', kind: 'glow', spin: 0, drag: 0, gravity: 0 });
          if (reduced) continue;
          for (let i = 0; i < 7; i += 1) {
            const a = Math.random() * Math.PI * 2;
            const s = 30 + Math.random() * 60;
            add({ x: p.x, y: p.y, vx: Math.cos(a) * s, vy: Math.sin(a) * s - 20, life: 0, max: 0.5 + Math.random() * 0.4, size: 1.8, color: pick(GOLDS), kind: 'spark', spin: 0, drag: 2.5, gravity: 40 });
          }
        }
      } else if (kind === 'burst') {
        for (const p of abs) {
          add({ x: p.x, y: p.y, vx: 0, vy: 0, life: 0, max: 0.8, size: 46, color: '#fff', kind: 'glow', spin: 0, drag: 0, gravity: 0 });
          for (let i = 0; i < 22; i += 1) {
            const a = Math.random() * Math.PI * 2;
            const s = 90 + Math.random() * 160;
            add({ x: p.x, y: p.y, vx: Math.cos(a) * s, vy: Math.sin(a) * s - 60, life: 0, max: 0.8 + Math.random() * 0.6, size: 2.2, color: pick(GOLDS), kind: 'spark', spin: 0, drag: 1.8, gravity: 160 });
          }
        }
        for (let i = 0; i < 26; i += 1) {
          add({ x: w * (0.15 + Math.random() * 0.7), y: -10 - Math.random() * 60, vx: (Math.random() - 0.5) * 40, vy: 60 + Math.random() * 80, life: 0, max: 2.4, size: 4 + Math.random() * 2.5, color: '#F4D27A', kind: 'coin', spin: Math.random() * 6, drag: 0.2, gravity: 220 });
        }
      } else {
        // Fuegos artificiales: varios cohetes escalonados + lluvia de monedas.
        const rockets = 7;
        for (let i = 0; i < rockets; i += 1) {
          queue.current.push({
            at: performance.now() + i * 320,
            fn: () => {
              const x = w * (0.15 + Math.random() * 0.7);
              add({ x, y: h + 5, vx: (Math.random() - 0.5) * 60, vy: -(h * 1.15 + Math.random() * h * 0.35), life: 0, max: 0.75 + Math.random() * 0.2, size: 2.6, color: '#FFF3C4', kind: 'rocket', spin: 0, drag: 1.2, gravity: 260, burstColor: pick(FIREWORK_COLORS) });
            },
          });
        }
        for (let i = 0; i < 60; i += 1) {
          queue.current.push({
            at: performance.now() + 400 + i * 45,
            fn: () => add({ x: w * Math.random(), y: -12, vx: (Math.random() - 0.5) * 50, vy: 70 + Math.random() * 90, life: 0, max: 2.8, size: 4 + Math.random() * 3, color: '#F4D27A', kind: 'coin', spin: Math.random() * 6, drag: 0.2, gravity: 200 }),
          });
        }
        for (const p of abs) add({ x: p.x, y: p.y, vx: 0, vy: 0, life: 0, max: 1, size: 60, color: '#fff', kind: 'glow', spin: 0, drag: 0, gravity: 0 });
      }
      start();
    },
    clear() {
      parts.current = [];
      pending.current = [];
      queue.current = [];
    },
  }));

  useEffect(
    () => () => {
      if (raf.current !== null) cancelAnimationFrame(raf.current);
      raf.current = null;
      queue.current = [];
      parts.current = [];
    },
    [],
  );

  return <canvas ref={canvas} className={className ?? 'pointer-events-none absolute inset-0 h-full w-full'} aria-hidden />;
});
