import { forwardRef, memo, useImperativeHandle, useLayoutEffect, useMemo, useRef } from 'react';
import { cx } from '../../lib/format';
import type { ReelHandle } from './Reel';
import { SlotSymbolArt } from './symbols';

/**
 * Rodillo en 3D: un cilindro real (CSS 3D) en lugar de una tira plana.
 *
 * Solo hay 7 caras en el DOM, colocadas sobre el cilindro con
 * `rotateX` + `translateZ`; al girar, cada cara cambia de símbolo cuando pasa
 * por detrás (cambiar la imagen de un <img> ya cargado es inmediato). Así los
 * símbolos de arriba y de abajo se ven inclinados y más pequeños, como en una
 * máquina de sala, y el movimiento sigue siendo solo `transform` (fluido).
 *
 * Mismas props e interfaz que `Reel`, de modo que la máquina puede usar uno u
 * otro sin cambiar nada más.
 */

/* ------------------------- Imágenes de los símbolos ------------------------- */

const urlCache = new Map<string, string>();

/** Imagen (URL de blob) de un símbolo ya preparado por `SymbolSprites`. */
export function symbolImage(symbol: string): string {
  return urlCache.get(symbol) ?? '';
}

export function symbolsReady(symbols: readonly string[]): boolean {
  return symbols.every((s) => urlCache.has(s));
}

/**
 * Dibuja una vez los símbolos (ocultos), los convierte en imágenes SVG y avisa
 * cuando están listas. Se usa el propio DOM del navegador en lugar de un
 * renderizador de servidor para no añadir peso a la página.
 */
export function SymbolSprites({ symbols, onReady }: { symbols: readonly string[]; onReady: () => void }) {
  const host = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const el = host.current;
    if (!el) return;
    const pending: Promise<void>[] = [];
    el.querySelectorAll<HTMLElement>('[data-sym]').forEach((node) => {
      const sym = node.dataset.sym!;
      if (urlCache.has(sym)) return;
      const svg = node.querySelector('svg');
      if (!svg) return;
      svg.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
      const url = URL.createObjectURL(new Blob([svg.outerHTML], { type: 'image/svg+xml' }));
      urlCache.set(sym, url);
      const img = new Image();
      img.src = url;
      pending.push(img.decode().catch(() => undefined));
    });
    void Promise.all(pending).then(onReady);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [symbols]);
  return (
    <div ref={host} aria-hidden style={{ position: 'absolute', width: 0, height: 0, overflow: 'hidden', visibility: 'hidden' }}>
      {symbols.map((s) => <div key={s} data-sym={s}><SlotSymbolArt symbol={s} size={256} /></div>)}
    </div>
  );
}

/* -------------------------------- Cilindro -------------------------------- */

const FACES = 7; // caras: 1 por encima, 3 visibles, 3 por debajo (para el borde y el giro)
const RADIUS_K = 1.55; // radio del cilindro en múltiplos de la altura de celda
const BLUR_PX = [0, 0, 2.2] as const;

interface Props {
  strip: readonly string[];
  special?: ReadonlySet<string>;
  bg?: string;
  stop: number;
  cell: number;
  highlight: ReadonlySet<number>;
  dimOthers: boolean;
  anticipation: boolean;
  winKey: number;
}

const mod = (a: number, n: number): number => ((a % n) + n) % n;

export const ReelCylinder = memo(
  forwardRef<ReelHandle, Props>(function ReelCylinder({ strip, stop, cell, highlight, dimOthers, anticipation, winKey, special, bg = 'from-[#fdfaf3] via-[#f3ecdc] to-[#e2d6bc]' }, ref) {
    const L = strip.length;
    const R = cell * RADIUS_K;
    // Ángulo entre símbolos: la cara central y sus vecinas quedan a una celda de distancia en pantalla.
    const theta = Math.asin(Math.min(0.999, 1 / RADIUS_K));
    const faces = useRef<(HTMLDivElement | null)[]>([]);
    const imgs = useRef<(HTMLImageElement | null)[]>([]);
    const shades = useRef<(HTMLDivElement | null)[]>([]);
    const shown = useRef<string[]>([]);
    const blurRef = useRef<HTMLDivElement>(null);
    const rootRef = useRef<HTMLDivElement>(null);
    const lastBlur = useRef<0 | 1 | 2>(0);
    const resting = useRef(true);
    const urls = useMemo(() => new Map(strip.map((s) => [s, symbolImage(s)])), [strip]);

    const apply = (p: number, blur: 0 | 1 | 2): void => {
      const base = Math.floor(p);
      const frac = p - base;
      for (let k = 0; k < FACES; k += 1) {
        const el = faces.current[k];
        const img = imgs.current[k];
        if (!el || !img) continue;
        // Cara k muestra el símbolo de la tira base-1+k; d = filas respecto a la fila central.
        const j = base - 1 + k;
        const d = j - (p + 1);
        const sym = strip[mod(j, L)]!;
        if (shown.current[k] !== sym) {
          shown.current[k] = sym;
          img.src = urls.get(sym)!;
        }
        const a = d * theta;
        el.style.transform = `translateZ(${-R}px) rotateX(${(-a * 180) / Math.PI}deg) translateZ(${R}px)`;
        // Más oscuro cuanto más inclinado (la luz viene de frente). Opacidad de una capa: solo composición.
        const shade = shades.current[k];
        if (shade) shade.style.opacity = (0.5 * (1 - Math.max(0, Math.cos(a)))).toFixed(3);
        el.style.visibility = Math.abs(a) < Math.PI / 2 ? 'visible' : 'hidden';
      }
      resting.current = frac === 0;
      const px = BLUR_PX[blur];
      if (px !== BLUR_PX[lastBlur.current] && blurRef.current) blurRef.current.style.filter = px ? `blur(${px}px)` : '';
      lastBlur.current = blur;
    };

    useImperativeHandle(ref, () => ({
      place: apply,
      thud: () => {
        const el = rootRef.current;
        if (!el) return;
        el.classList.remove('reel-thud');
        void el.offsetWidth;
        el.classList.add('reel-thud');
      },
    }));

    useLayoutEffect(() => {
      apply(stop, 0);
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [stop, cell, strip]);

    return (
      <div
        ref={rootRef}
        className={cx('reel relative overflow-hidden rounded-xl bg-gradient-to-b transition-shadow duration-300', bg, anticipation && 'reel-anticipation')}
        style={{ height: cell * 3, width: cell }}
      >
        <div ref={blurRef} className="absolute inset-0" style={{ perspective: `${cell * 6}px`, perspectiveOrigin: '50% 50%' }}>
          <div className="absolute inset-0" style={{ transformStyle: 'preserve-3d' }}>
            {Array.from({ length: FACES }, (_, k) => {
              // En reposo las caras 1..3 son las filas 0..2 de la ventana.
              const row = k - 1;
              const inWindow = row >= 0 && row < 3;
              const lit = inWindow && highlight.has(row);
              const sym = strip[mod(stop - 1 + k, L)]!;
              const isSpecial = !!special?.has(sym);
              return (
                <div
                  key={k}
                  ref={(el) => void (faces.current[k] = el)}
                  className="absolute left-0 flex items-center justify-center will-change-transform"
                  style={{ top: cell, height: cell, width: cell, backfaceVisibility: 'hidden' }}
                >
                  {lit && <div key={`g${winKey}`} className="slot-win-glow pointer-events-none absolute inset-1 rounded-xl" aria-hidden />}
                  {isSpecial && inWindow && !dimOthers && <div className="slot-special-aura pointer-events-none absolute inset-2 rounded-full" aria-hidden />}
                  <img
                    key={lit ? `w${winKey}` : 'n'}
                    ref={(el) => void (imgs.current[k] = el)}
                    src={urls.get(sym)}
                    alt=""
                    draggable={false}
                    width={cell * 0.78}
                    height={cell * 0.78}
                    className={cx('relative select-none transition-[opacity,filter] duration-300', lit && (isSpecial ? 'slot-special-pop' : 'slot-win-pop'), inWindow && dimOthers && !lit && 'opacity-65 saturate-[.7]')}
                  />
                  {lit && <div className="pointer-events-none absolute inset-1 rounded-xl ring-2 ring-oro-claro/90" aria-hidden />}
                  <div ref={(el) => void (shades.current[k] = el)} className="pointer-events-none absolute inset-0 bg-black" style={{ opacity: 0 }} aria-hidden />
                </div>
              );
            })}
          </div>
        </div>
        {/* Sombra en los bordes del cilindro y brillo especular fijo (la luz no gira con el rodillo) */}
        <div className="pointer-events-none absolute inset-0 bg-[linear-gradient(180deg,rgba(0,0,0,0.55),rgba(0,0,0,0.12)_18%,rgba(0,0,0,0)_34%,rgba(0,0,0,0)_66%,rgba(0,0,0,0.12)_82%,rgba(0,0,0,0.55))]" />
        <div className="pointer-events-none absolute inset-x-0 top-[38%] h-[12%] bg-[linear-gradient(180deg,rgba(255,255,255,0),rgba(255,255,255,0.16),rgba(255,255,255,0))]" />
      </div>
    );
  }),
);
