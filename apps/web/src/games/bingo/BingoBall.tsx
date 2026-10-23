import { cx } from '../../lib/format';
import { ballColor } from './ballColors';

/** Bola 2D (para el panel y la última extraída). */
export function Ball({ n, size = 44, className }: { n: number; size?: number; className?: string }) {
  return (
    <span
      className={cx('bingo-ball relative inline-grid shrink-0 place-items-center rounded-full font-extrabold tabular-nums', className)}
      style={{ width: size, height: size, ['--ball' as string]: ballColor(n), fontSize: size * 0.4 }}
    >
      <span className="relative z-10 grid place-items-center rounded-full bg-white text-[#111]" style={{ width: size * 0.62, height: size * 0.62 }}>{n}</span>
    </span>
  );
}

