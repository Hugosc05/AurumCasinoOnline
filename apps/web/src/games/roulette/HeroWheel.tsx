import { Suspense, lazy, useEffect, useRef, useState } from 'react';
import { WHEEL_ORDER } from '@aurum/engine';
import { webglAvailable } from './webgl';
import { useSession } from '../../state/session';
import type { WheelHandle } from './RouletteWheel';
import { RouletteWheel } from './RouletteWheel';

const RouletteWheel3D = lazy(() => import('./RouletteWheel3D').then((m) => ({ default: m.RouletteWheel3D })));

/**
 * Ruleta de la portada: la misma ruleta 3D de la mesa, en silencio, lanzando
 * una bola de exhibición cada cierto tiempo (no es una jugada ni se apuesta
 * nada). Solo gira mientras está a la vista y con las animaciones completas.
 */
export function HeroWheel({ className }: { className?: string }) {
  const { motion: level } = useSession();
  const [has3d] = useState(() => typeof document !== 'undefined' && webglAvailable());
  const wheel = useRef<WheelHandle>(null);
  const box = useRef<HTMLDivElement>(null);
  const [highlight, setHighlight] = useState<number | null>(null);
  const [number, setNumber] = useState<number | null>(null);
  const use3d = has3d && level !== 'off';

  useEffect(() => {
    if (!use3d || level !== 'full') return;
    let alive = true;
    let visible = true;
    const io = new IntersectionObserver(([e]) => (visible = !!e?.isIntersecting));
    if (box.current) io.observe(box.current);
    const cycle = async (): Promise<void> => {
      await new Promise((r) => setTimeout(r, 2500));
      while (alive) {
        const w = wheel.current;
        if (w && visible && document.visibilityState === 'visible') {
          const pocket = Math.floor(Math.random() * 37);
          setHighlight(null);
          setNumber(null);
          await w.spin(pocket, 9000, true);
          if (!alive) return;
          setHighlight(pocket);
          setNumber(WHEEL_ORDER[pocket]!);
          await new Promise((r) => setTimeout(r, 6000));
        } else await new Promise((r) => setTimeout(r, 1000));
      }
    };
    void cycle();
    return () => {
      alive = false;
      io.disconnect();
    };
  }, [use3d, level]);

  if (!use3d) {
    return <RouletteWheel idle={level === 'full'} initialPocket={17} className={className} label="Ruleta europea decorativa en reposo" />;
  }
  return (
    <div ref={box} className="relative">
      <Suspense fallback={<RouletteWheel idle={false} initialPocket={17} className={className} label="Ruleta europea decorativa" />}>
        <RouletteWheel3D ref={wheel} muted highlight={highlight} className={className} label="Ruleta europea 3D decorativa: lanza bolas de exhibición" />
      </Suspense>
      {number !== null && (
        <span className="pointer-events-none absolute bottom-[6%] left-1/2 -translate-x-1/2 rounded-full border border-oro/40 bg-noche/80 px-3 py-1 text-xs text-niebla">
          Bola de exhibición: <span className="font-display text-base text-marfil">{number}</span>
        </span>
      )}
    </div>
  );
}
