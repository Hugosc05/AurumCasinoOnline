import { AnimatePresence, motion } from 'motion/react';
import { useCallback, useRef, useState, type ReactNode } from 'react';
import { DURATION, EASE } from '../lib/anim/tokens';
import { Chip } from './Chip';

interface Flight {
  id: number;
  value: number;
  from: { x: number; y: number };
  to: { x: number; y: number };
  size: number;
  duration: number;
}

const center = (r: DOMRect): { x: number; y: number } => ({ x: r.left + r.width / 2, y: r.top + r.height / 2 });

/**
 * Capa de fichas "en vuelo": una ficha sale de un elemento (el selector o la
 * posición de un jugador) y viaja en arco hasta su destino. Es solo
 * representación: el importe real ya lo ha validado el servidor o el estado local.
 */
export function useFlyingChips(speed: number): { layer: ReactNode; fly: (from: Element | DOMRect | null, to: Element | DOMRect | null, value: number, size?: number) => Promise<void> } {
  const [flights, setFlights] = useState<Flight[]>([]);
  const idRef = useRef(1);
  const fly = useCallback(
    (from: Element | DOMRect | null, to: Element | DOMRect | null, value: number, size = 34) => {
      if (!from || !to || speed === 0) return Promise.resolve();
      const fr = from instanceof DOMRect ? from : from.getBoundingClientRect();
      const tr = to instanceof DOMRect ? to : to.getBoundingClientRect();
      const id = idRef.current++;
      const duration = DURATION.chip * speed;
      setFlights((f) => [...f, { id, value, from: center(fr), to: center(tr), size, duration }]);
      return new Promise<void>((resolve) => {
        window.setTimeout(() => {
          setFlights((f) => f.filter((x) => x.id !== id));
          resolve();
        }, duration);
      });
    },
    [speed],
  );
  const layer = (
    <div className="pointer-events-none fixed inset-0 z-40" aria-hidden>
      <AnimatePresence>
        {flights.map((f) => {
          const midX = (f.from.x + f.to.x) / 2;
          const midY = Math.min(f.from.y, f.to.y) - 60;
          return (
            <motion.div
              key={f.id}
              className="absolute left-0 top-0"
              initial={{ x: f.from.x - f.size / 2, y: f.from.y - f.size / 2, scale: 1, rotate: 0 }}
              animate={{
                x: [f.from.x - f.size / 2, midX - f.size / 2, f.to.x - f.size / 2],
                y: [f.from.y - f.size / 2, midY - f.size / 2, f.to.y - f.size / 2],
                scale: [1, 1.18, 1],
                rotate: [0, 160, 340],
              }}
              exit={{ opacity: 0 }}
              transition={{ duration: f.duration / 1000, ease: EASE.out, times: [0, 0.45, 1] }}
              style={{ filter: 'drop-shadow(0 10px 8px rgba(0,0,0,0.5))' }}
            >
              <Chip value={f.value} size={f.size} />
            </motion.div>
          );
        })}
      </AnimatePresence>
    </div>
  );
  return { layer, fly };
}
