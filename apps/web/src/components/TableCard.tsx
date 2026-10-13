import { motion, useAnimate } from 'motion/react';
import { memo, useEffect, useRef, useState } from 'react';
import { audio } from '../lib/audio';
import { DURATION, EASE } from '../lib/anim/tokens';
import { PlayingCard } from './PlayingCard';

export interface Point {
  x: number;
  y: number;
}

interface Props {
  card: string | null;
  faceUp: boolean;
  /** Centro de destino (coordenadas del escenario). */
  x: number;
  y: number;
  rotate?: number;
  z: number;
  /** Origen del vuelo (zapato o mano del crupier). Si se omite, la carta aparece en su sitio (recuperación de partida). */
  from?: Point | null;
  width: number;
  speed: number;
  highlight?: boolean;
  dim?: boolean;
  /** Retardo antes de girar al aterrizar (ms). */
  flipDelay?: number;
  sound?: boolean;
}

/**
 * Carta sobre la mesa: sale del zapato, recorre un arco con aceleración y
 * frenado, gira ligeramente, su sombra crece con la altura aparente, aterriza
 * con un pequeño asentamiento y después se voltea.
 */
export const TableCard = memo(function TableCard({ card, faceUp, x, y, rotate = 0, z, from, width, speed, highlight, dim, flipDelay = 60, sound = true }: Props) {
  const [scope, animate] = useAnimate();
  const [landed, setLanded] = useState(!from || speed === 0);
  const first = useRef(true);
  const h = width * 1.4;

  useEffect(() => {
    const el = scope.current as HTMLElement | null;
    if (!el) return;
    const left = x - width / 2;
    const top = y - h / 2;
    if (first.current) {
      first.current = false;
      if (!from || speed === 0) {
        el.style.transform = `translate(${left}px, ${top}px) rotate(${rotate}deg)`;
        return;
      }
      const sx = from.x - width / 2;
      const sy = from.y - h / 2;
      const mx = (sx + left) / 2;
      const my = Math.min(sy, top) - 40;
      const dur = (DURATION.card / 1000) * speed;
      if (sound) audio.play('cardSlide');
      const shadow = el.querySelector('[data-shadow]');
      const body = el.querySelector('[data-body]');
      void animate(el, { x: [sx, mx, left], y: [sy, my, top], rotate: [-28, -10, rotate] }, { duration: dur, ease: EASE.out, times: [0, 0.45, 1] });
      if (shadow) void animate(shadow, { opacity: [0.2, 0.55, 0.85], scale: [0.85, 1.25, 1], x: [4, 18, 3], y: [6, 26, 4] }, { duration: dur, ease: EASE.out, times: [0, 0.45, 1] });
      if (body) void animate(body, { scale: [0.9, 1.12, 0.98, 1] }, { duration: dur * 1.12, ease: EASE.out, times: [0, 0.45, 0.88, 1] });
      const t = window.setTimeout(() => {
        if (sound) audio.play('cardLand');
        setLanded(true);
      }, dur * 1000 + flipDelay * speed);
      return () => clearTimeout(t);
    }
    // Recolocación (p. ej., al dividir): deslizamiento suave.
    void animate(el, { x: left, y: top, rotate }, { type: 'spring', stiffness: 260, damping: 28 });
    return undefined;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [x, y, rotate]);

  // Volteo de la carta tapada del crupier (o cualquier giro posterior).
  const prevFace = useRef(faceUp);
  useEffect(() => {
    if (landed && faceUp && !prevFace.current && sound) audio.play('cardFlip');
    prevFace.current = faceUp;
  }, [faceUp, landed, sound]);
  useEffect(() => {
    if (landed && faceUp && from && sound) audio.play('cardFlip');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [landed]);

  return (
    <div ref={scope} className="absolute left-0 top-0" style={{ zIndex: z, width, height: h, willChange: 'transform' }}>
      <motion.div data-shadow className="absolute inset-0 rounded-[10px] bg-black/70 blur-[6px]" style={{ opacity: 0.85, x: 3, y: 4 }} />
      <div data-body className="relative">
        <PlayingCard card={card} faceUp={landed && faceUp} width={width} highlight={highlight} dim={dim} flipDuration={DURATION.flip * Math.max(speed, 0.3)} />
      </div>
    </div>
  );
});
