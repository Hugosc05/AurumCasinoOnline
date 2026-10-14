import type { SlotSymbol } from '@aurum/engine';
import { animate, type AnimationPlaybackControls } from 'motion/react';
import { forwardRef, memo, useImperativeHandle, useRef, useState } from 'react';
import { cx } from '../../lib/format';
import { SlotSymbolArt } from './symbols';

export interface ReelHandle {
  /** Recorre `path` (de abajo arriba visualmente: los símbolos bajan) y se asienta en la ventana final. */
  spin(path: SlotSymbol[], durationMs: number, delayMs: number, onStop: () => void): Promise<void>;
  skip(): void;
}

interface Props {
  visible: SlotSymbol[];
  cell: number;
  highlight: Set<number>;
  dimOthers: boolean;
  anticipation: boolean;
}

const Cell = memo(function Cell({ symbol, size, lit, dim }: { symbol: SlotSymbol; size: number; lit: boolean; dim: boolean }) {
  return (
    <div className={cx('relative flex items-center justify-center transition-[opacity,filter] duration-300', dim && 'opacity-60 saturate-[.7]')} style={{ height: size }}>
      <div className={cx(lit && 'motion-safe:animate-[pulse_0.9s_ease-in-out_infinite]')} style={{ transform: lit ? 'scale(1.08)' : undefined, transition: 'transform 300ms' }}>
        <SlotSymbolArt symbol={symbol} size={size * 0.78} />
      </div>
      {lit && <div className="pointer-events-none absolute inset-1 rounded-xl ring-2 ring-oro-claro/90 shadow-[0_0_24px_rgba(235,217,166,0.45)_inset]" />}
    </div>
  );
});

export const Reel = forwardRef<ReelHandle, Props>(function Reel({ visible, cell, highlight, dimOthers, anticipation }, ref) {
  const stripRef = useRef<HTMLDivElement>(null);
  const [path, setPath] = useState<SlotSymbol[] | null>(null);
  const [blur, setBlur] = useState(false);
  const ctl = useRef<AnimationPlaybackControls | null>(null);
  const blurTimers = useRef<number[]>([]);

  useImperativeHandle(ref, () => ({
    async spin(p, durationMs, delayMs, onStop) {
      setPath(p);
      await new Promise((r) => requestAnimationFrame(() => r(null)));
      const el = stripRef.current;
      if (!el) return;
      const y0 = -(p.length - 3) * cell;
      el.style.transform = `translateY(${y0}px)`;
      if (durationMs <= 0) {
        el.style.transform = 'translateY(0px)';
        setPath(null);
        onStop();
        return;
      }
      blurTimers.current.forEach(clearTimeout);
      blurTimers.current = [
        window.setTimeout(() => setBlur(true), delayMs + durationMs * 0.12),
        window.setTimeout(() => setBlur(false), delayMs + durationMs * 0.82),
      ];
      const settle = Math.min(14, cell * 0.12);
      ctl.current = animate(
        el,
        { y: [y0, y0 - settle, settle, 0] },
        {
          duration: durationMs / 1000,
          delay: delayMs / 1000,
          times: [0, 0.07, 0.95, 1],
          ease: ['easeOut', [0.45, 0.02, 0.15, 1], 'easeOut'],
        },
      );
      await ctl.current;
      ctl.current = null;
      blurTimers.current.forEach(clearTimeout);
      setBlur(false);
      setPath(null);
      el.style.transform = 'translateY(0px)';
      onStop();
    },
    skip() {
      ctl.current?.complete();
    },
  }));

  const list = path ?? visible;
  return (
    <div className={cx('relative overflow-hidden rounded-xl bg-gradient-to-b from-[#fdfaf3] via-[#f3ecdc] to-[#e2d6bc] transition-shadow duration-300', anticipation && 'shadow-[0_0_0_2px_#ebd9a6,0_0_30px_rgba(235,217,166,0.6)]')} style={{ height: cell * 3, width: cell }}>
      <div ref={stripRef} className={cx('will-change-transform', blur && 'blur-[1.5px]')}>
        {list.map((s, i) => (
          <Cell key={path ? `p${i}` : `w${i}`} symbol={s} size={cell} lit={!path && highlight.has(i)} dim={!path && dimOthers && !highlight.has(i)} />
        ))}
      </div>
      <div className="pointer-events-none absolute inset-0 bg-[linear-gradient(180deg,rgba(0,0,0,0.35),transparent_22%,transparent_78%,rgba(0,0,0,0.35))]" />
    </div>
  );
});
