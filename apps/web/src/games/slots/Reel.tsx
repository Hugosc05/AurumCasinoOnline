import { forwardRef, memo, useImperativeHandle, useLayoutEffect, useMemo, useRef } from 'react';
import { cx } from '../../lib/format';
import { SlotSymbolArt } from './symbols';

export interface ReelHandle {
  /**
   * Coloca el rodillo (llamado en cada fotograma por el bucle de la máquina).
   * `pos` es la posición envuelta en [0, L): símbolo de la fila superior.
   * `blur` es el nivel de desenfoque de movimiento (0, 1, 2).
   */
  place(pos: number, blur: 0 | 1 | 2): void;
  /** Destello breve al detenerse (directo sobre el DOM, sin volver a renderizar). */
  thud(): void;
}

interface Props {
  strip: readonly string[];
  /** Símbolos especiales (comodín, scatter, bono): brillan suavemente y destacan al aparecer. */
  special?: ReadonlySet<string>;
  /** Degradado del fondo de los rodillos (temática de la máquina). */
  bg?: string;
  /** Parada en reposo (para la colocación inicial y para situar los resaltados). */
  stop: number;
  cell: number;
  /** Filas (0..2) de la ventana que forman parte de un premio. */
  highlight: ReadonlySet<number>;
  dimOthers: boolean;
  anticipation: boolean;
  /** Fila resaltada como premio principal (línea en curso): animación más marcada. */
  winKey: number;
}

/** Desenfoque de movimiento: dos niveles (cambiar el filtro tiene coste; se cambia pocas veces). */
const BLUR_PX = [0, 0, 2.2] as const;

const Cell = memo(function Cell({ symbol, size, lit, dim, winKey, special }: { symbol: string; size: number; lit: boolean; dim: boolean; winKey: number; special: boolean }) {
  return (
    <div className="relative flex items-center justify-center" style={{ height: size }}>
      {lit && <div key={`g${winKey}`} className="slot-win-glow pointer-events-none absolute inset-1 rounded-xl" aria-hidden />}
      {special && !dim && <div className="slot-special-aura pointer-events-none absolute inset-2 rounded-full" aria-hidden />}
      <div key={lit ? `w${winKey}` : 'n'} className={cx('relative transition-[opacity,filter] duration-300', lit && (special ? 'slot-special-pop' : 'slot-win-pop'), dim && 'opacity-65 saturate-[.7]')}>
        <SlotSymbolArt symbol={symbol} size={size * 0.78} />
      </div>
      {lit && <div className="pointer-events-none absolute inset-1 rounded-xl ring-2 ring-oro-claro/90" aria-hidden />}
    </div>
  );
});

/**
 * Rodillo con la tira completa dibujada una sola vez. Durante el giro solo cambia
 * un `transform` (sin renderizar React en cada fotograma), así que el movimiento
 * es fluido incluso en equipos modestos.
 *
 * La tira se dibuja con un símbolo de margen arriba y tres abajo para envolver
 * sin cortes: índice DOM = índice de la tira + 1.
 */
export const Reel = memo(
  forwardRef<ReelHandle, Props>(function Reel({ strip, stop, cell, highlight, dimOthers, anticipation, winKey, special, bg = 'from-[#fdfaf3] via-[#f3ecdc] to-[#e2d6bc]' }, ref) {
    const L = strip.length;
    const stripRef = useRef<HTMLDivElement>(null);
    const blurRef = useRef<HTMLDivElement>(null);
    const lastBlur = useRef<0 | 1 | 2>(0);
    const pos = useRef(stop);

    const cells = useMemo(() => [strip[L - 1]!, ...strip, strip[0]!, strip[1]!, strip[2]!], [strip, L]);

    const apply = (p: number, blur: 0 | 1 | 2): void => {
      const el = stripRef.current;
      if (!el) return;
      pos.current = p;
      el.style.transform = `translate3d(0, ${-(p + 1) * cell}px, 0)`;
      const px = BLUR_PX[blur];
      if (px !== BLUR_PX[lastBlur.current] && blurRef.current) {
        // El filtro se aplica a la ventana (3 celdas), no a la tira entera: el navegador
        // solo vuelve a dibujar un área pequeña al activarlo o quitarlo.
        blurRef.current.style.filter = px ? `blur(${px}px)` : '';
      }
      lastBlur.current = blur;
    };

    const rootRef = useRef<HTMLDivElement>(null);
    useImperativeHandle(ref, () => ({
      place: apply,
      thud: () => {
        const el = rootRef.current;
        if (!el) return;
        el.classList.remove('reel-thud');
        void el.offsetWidth; // reinicia la animación CSS
        el.classList.add('reel-thud');
      },
    }));

    // Colocación en reposo y al cambiar el tamaño de celda.
    useLayoutEffect(() => {
      apply(stop, 0);
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [stop, cell]);

    return (
      <div
        ref={rootRef}
        className={cx(
          'reel relative overflow-hidden rounded-xl bg-gradient-to-b transition-shadow duration-300',
          bg,
          anticipation && 'reel-anticipation',
        )}
        style={{ height: cell * 3, width: cell }}
      >
        <div ref={blurRef} className="absolute inset-0 overflow-hidden">
        <div ref={stripRef} className="will-change-transform" style={{ transform: `translate3d(0, ${-(stop + 1) * cell}px, 0)` }}>
          {cells.map((s, i) => {
            const row = i - 1 - stop;
            const inWindow = row >= 0 && row < 3;
            const lit = inWindow && highlight.has(row);
            return <Cell key={i} symbol={s} size={cell} lit={lit} dim={inWindow && dimOthers && !lit} winKey={lit ? winKey : -1} special={!!special?.has(s)} />;
          })}
        </div>
        </div>
        {/* Curvatura del cilindro: sombra arriba y abajo, brillo central */}
        <div className="pointer-events-none absolute inset-0 bg-[linear-gradient(180deg,rgba(0,0,0,0.42),rgba(0,0,0,0.06)_20%,rgba(255,255,255,0.08)_48%,rgba(0,0,0,0.04)_78%,rgba(0,0,0,0.42))]" />
      </div>
    );
  }),
);
