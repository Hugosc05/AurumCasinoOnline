import { motion } from 'motion/react';
import { useEffect, useMemo } from 'react';
import { audio } from '../lib/audio';
import { DURATION } from '../lib/anim/tokens';
import { CardBack } from './PlayingCard';

interface Props {
  /** Centro del barajado (coordenadas del escenario). */
  x: number;
  y: number;
  /** Destino final del mazo (zapato). */
  to: { x: number; y: number };
  width: number;
  speed: number;
  onDone: () => void;
}

const N = 24; // cartas representadas (el barajado real ocurre en el servidor)

/**
 * Barajado americano ("riffle") en cinco tiempos:
 *  1. las cartas se agrupan,  2. se dividen en dos mitades,
 *  3. se intercalan cayendo alternativamente,  4. corte del mazo,
 *  5. el mazo se recompone y vuelve al zapato.
 * Es una representación visual: la aleatoriedad la genera el servidor con un CSPRNG.
 */
export function ShuffleAnimation({ x, y, to, width, speed, onDone }: Props) {
  const h = width * 1.4;
  const s = Math.max(speed, 0.05);
  const total = DURATION.shuffle * s;
  // Línea temporal relativa (0..1) de cada fase.
  const T = { gather: 0.12, split: 0.24, riffleEnd: 0.68, cut: 0.84, home: 1 };

  const cards = useMemo(
    () =>
      Array.from({ length: N }, (_, i) => {
        const half = i % 2; // intercalado: pares izquierda, impares derecha
        const order = i; // orden de caída en el riffle
        const stackIndex = Math.floor(i / 2);
        return { i, half, order, stackIndex };
      }),
    [],
  );

  useEffect(() => {
    audio.riffle(total * (T.riffleEnd - T.split), total * T.split);
    audio.play('cardSlide', total * T.cut);
    audio.play('cardLand', total * 0.97);
    const t = window.setTimeout(onDone, total);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="pointer-events-none absolute left-0 top-0" style={{ zIndex: 500 }} aria-hidden>
      {cards.map((c) => {
        const sideX = c.half === 0 ? -width * 0.72 : width * 0.72;
        const splitY = -c.stackIndex * 1.2;
        const fallStart = T.split + ((T.riffleEnd - T.split) * c.order) / N;
        const fallEnd = Math.min(T.riffleEnd, fallStart + 0.06);
        const pileY = -c.order * 0.9;
        const cutShift = c.order >= N / 2 ? width * 0.9 : 0; // mitad superior sale a la derecha
        const cutY = c.order >= N / 2 ? pileY + (N / 2) * 0.9 : pileY - (N / 2) * 0.9;
        const times = [0, T.gather, T.split, fallStart, fallEnd, T.cut - 0.06, T.cut, 0.94, 1];
        const xs = [x - width / 2 + (c.i % 5) * 3 - 6, x - width / 2, x - width / 2 + sideX, x - width / 2 + sideX, x - width / 2, x - width / 2 + cutShift, x - width / 2, x - width / 2, to.x - width / 2];
        const ys = [y - h / 2 - 30, y - h / 2 + c.i * -0.6, y - h / 2 + splitY, y - h / 2 + splitY - 6, y - h / 2 + pileY, y - h / 2 + pileY, y - h / 2 + cutY, y - h / 2 + cutY, to.y - h / 2];
        const rot = [0, 0, c.half === 0 ? -9 : 9, c.half === 0 ? -14 : 14, 0, 0, 0, 0, 0];
        const zs = c.order >= N / 2 ? 100 + c.order - N : 100 + c.order;
        return (
          <motion.div
            key={c.i}
            className="absolute left-0 top-0"
            style={{ width, height: h, zIndex: zs }}
            initial={{ x: xs[0], y: ys[0], rotate: 0, opacity: 0 }}
            animate={{ x: xs, y: ys, rotate: rot, opacity: [0, 1, 1, 1, 1, 1, 1, 1, 1] }}
            transition={{ duration: total / 1000, times, ease: 'easeInOut' }}
          >
            <div className="h-full w-full drop-shadow-[0_2px_2px_rgba(0,0,0,0.5)]">
              <CardBack />
            </div>
          </motion.div>
        );
      })}
    </div>
  );
}
