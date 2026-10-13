import { createContext, useContext, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { cx } from '../lib/format';

const StageContext = createContext(1);
export const useStageScale = (): number => useContext(StageContext);

/**
 * Escenario con resolución de diseño fija que se escala al ancho disponible.
 * Todas las posiciones de cartas y fichas se calculan en coordenadas del
 * escenario, así que el reparto llega al mismo sitio en móvil y en escritorio.
 */
export function Stage({ width, height, children, className, maxHeightVh = 78 }: { width: number; height: number; children: ReactNode; className?: string; maxHeightVh?: number }) {
  const wrap = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState(1);
  useLayoutEffect(() => {
    const el = wrap.current;
    if (!el) return;
    const update = (): void => {
      const w = el.clientWidth;
      const maxH = (window.innerHeight * maxHeightVh) / 100;
      setScale(Math.min(w / width, maxH / height, 1.4));
    };
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    window.addEventListener('resize', update);
    return () => {
      ro.disconnect();
      window.removeEventListener('resize', update);
    };
  }, [width, height, maxHeightVh]);
  return (
    <div ref={wrap} className={cx('relative w-full', className)} style={{ height: height * scale }}>
      <div className="absolute left-1/2 top-0 origin-top" style={{ width, height, transform: `translateX(-50%) scale(${scale})` }}>
        <StageContext.Provider value={scale}>{children}</StageContext.Provider>
      </div>
    </div>
  );
}
