import { Minus, Plus } from 'lucide-react';
import { useEffect, useRef } from 'react';
import { audio } from '../lib/audio';
import { credits, cx } from '../lib/format';

/**
 * Selector de importe pensado para el dedo:
 * - Escala progresiva: la primera mitad del recorrido cubre las cantidades
 *   pequeñas (las más usadas) y el final las grandes; con una barra lineal un
 *   milímetro en el móvil saltaba decenas de ciegas.
 * - Saltos fijos de `step` (p. ej., la ciega grande).
 * - Botones − y + (mantener pulsado repite) y pulgar grande.
 */
const RES = 1000;

export function BetSlider({ min, max, step, value, onChange, label, className }: {
  min: number;
  max: number;
  step: number;
  value: number;
  onChange: (v: number) => void;
  label: string;
  className?: string;
}) {
  const span = Math.max(0, max - min);
  const snap = (v: number): number => {
    if (v >= max) return max;
    const s = min + Math.round((v - min) / step) * step;
    return Math.max(min, Math.min(max, s));
  };
  // Posición ↔ importe con curva cuadrática.
  const toValue = (pos: number): number => snap(min + span * (pos / RES) ** 2);
  const toPos = (v: number): number => (span === 0 ? 0 : Math.round(Math.sqrt((v - min) / span) * RES));

  const repeat = useRef<number | null>(null);
  const stop = (): void => {
    if (repeat.current !== null) window.clearInterval(repeat.current);
    repeat.current = null;
  };
  useEffect(() => stop, []);
  const valueRef = useRef(value);
  valueRef.current = value;
  const nudge = (dir: 1 | -1): void => {
    const next = snap(valueRef.current + dir * step);
    if (next !== valueRef.current) {
      audio.play('chip');
      onChange(next);
    }
  };
  const press = (dir: 1 | -1) => (e: React.PointerEvent): void => {
    e.preventDefault();
    nudge(dir);
    stop();
    let n = 0;
    repeat.current = window.setInterval(() => {
      n += 1;
      if (n > 3) nudge(dir); // retardo inicial antes de repetir
    }, 110);
  };

  const btn = 'grid h-10 w-10 shrink-0 place-items-center rounded-full border border-linea text-marfil active:scale-95 disabled:opacity-40 sm:h-9 sm:w-9';
  return (
    <div className={cx('flex items-center gap-2', className)}>
      <button type="button" className={btn} aria-label={`Bajar ${label}`} disabled={value <= min} onPointerDown={press(-1)} onPointerUp={stop} onPointerLeave={stop} onPointerCancel={stop}>
        <Minus className="h-4 w-4" />
      </button>
      <input
        type="range"
        min={0}
        max={RES}
        step={1}
        value={toPos(value)}
        onChange={(e) => onChange(toValue(Number(e.target.value)))}
        className="bet-slider min-w-[110px] flex-1"
        aria-label={label}
        aria-valuetext={credits(value)}
      />
      <button type="button" className={btn} aria-label={`Subir ${label}`} disabled={value >= max} onPointerDown={press(1)} onPointerUp={stop} onPointerLeave={stop} onPointerCancel={stop}>
        <Plus className="h-4 w-4" />
      </button>
    </div>
  );
}
