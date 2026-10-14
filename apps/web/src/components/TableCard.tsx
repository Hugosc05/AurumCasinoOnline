import { motion, useAnimate } from 'motion/react';
import { memo, useEffect, useRef, useState } from 'react';
import { audio } from '../lib/audio';
import { DURATION, EASE } from '../lib/anim/tokens';
import { PlayingCard } from './PlayingCard';
import { useStageScale } from './Stage';

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
  /** Origen del vuelo (zapato o bandeja del crupier). Sin origen, la carta aparece en su sitio (recuperación de partida). */
  from?: Point | null;
  /** Dirección por la que la carta sale del zapato antes de volar (px del escenario). */
  extractVector?: Point;
  /** Si se indica, la carta se recoge: vuelve boca abajo a este punto y desaparece. */
  collectTo?: Point | null;
  width: number;
  speed: number;
  highlight?: boolean;
  dim?: boolean;
  /** Revelado destacado. */
  dramatic?: boolean;
  /** Pequeña sacudida (p. ej., al pasarse de 21). */
  shake?: boolean;
  /** Retardo antes de girar al aterrizar (ms). */
  flipDelay?: number;
  sound?: boolean;
  /** Se llama cuando la cara ya es visible (mitad del giro), para actualizar totales sin adelantarse. */
  onFaceShown?: () => void;
}

/**
 * Carta sobre la mesa.
 *
 * 1. Se extrae del zapato (un pequeño deslizamiento por la boca del zapato).
 * 2. Vuela en arco hacia su posición, por encima del resto de cartas, con
 *    aceleración, frenado y una ligera rotación; la sombra crece con la altura.
 * 3. Aterriza con un leve asentamiento y, si corresponde, se voltea.
 * La duración se adapta a la distancia para que todas las cartas parezcan
 * repartidas por la misma mano.
 */
export const TableCard = memo(function TableCard({
  card,
  faceUp,
  x,
  y,
  rotate = 0,
  z,
  from,
  extractVector = { x: -34, y: 10 },
  collectTo,
  width,
  speed,
  highlight,
  dim,
  dramatic,
  shake,
  flipDelay = 60,
  sound = true,
  onFaceShown,
}: Props) {
  const [scope, animate] = useAnimate();
  const stageScale = useStageScale();
  const [landed, setLanded] = useState(!from || speed === 0);
  const [flying, setFlying] = useState(!!from && speed > 0);
  const first = useRef(true);
  const h = width * 1.4;

  useEffect(() => {
    const el = scope.current as HTMLElement | null;
    if (!el || collectTo) return;
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
      const ex = sx + extractVector.x;
      const ey = sy + extractVector.y;
      const dist = Math.hypot(left - ex, top - ey);
      const flight = (DURATION.card / 1000) * speed * Math.min(1.25, Math.max(0.75, dist / 480));
      const extract = 0.16 * speed;
      const total = extract + flight;
      const mx = (ex + left) / 2;
      const my = Math.min(ey, top) - Math.min(70, 20 + dist * 0.08);
      const t1 = extract / total;
      const tMid = t1 + (1 - t1) * 0.45;
      if (sound) audio.play('cardSlide');
      const shadow = el.querySelector('[data-shadow]');
      const body = el.querySelector('[data-body]');
      void animate(
        el,
        { x: [sx, ex, mx, left], y: [sy, ey, my, top], rotate: [-8, -14, -6, rotate] },
        { duration: total, ease: [EASE.out, EASE.out, [0.3, 0.7, 0.4, 1]], times: [0, t1, tMid, 1] },
      );
      if (shadow) void animate(shadow, { opacity: [0.25, 0.3, 0.45, 0.6], scale: [0.95, 1, 1.25, 1], x: [2, 3, 18, 3], y: [3, 4, 26, 4] }, { duration: total, times: [0, t1, tMid, 1] });
      if (body) void animate(body, { scale: [1, 1, 1.1, 0.98, 1] }, { duration: total * 1.1, ease: EASE.out, times: [0, t1, tMid, 0.9, 1] });
      const t = window.setTimeout(() => {
        if (sound) audio.play('cardLand');
        setFlying(false);
        setLanded(true);
      }, total * 1000 + flipDelay * speed);
      return () => clearTimeout(t);
    }
    // Recolocación (p. ej., al dividir): deslizamiento suave.
    void animate(el, { x: left, y: top, rotate }, { type: 'spring', stiffness: 260, damping: 28 });
    return undefined;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [x, y, rotate]);

  // Recogida al terminar la mano: la carta se desliza hacia la bandeja boca abajo.
  useEffect(() => {
    const el = scope.current as HTMLElement | null;
    if (!el || !collectTo) return;
    const dur = Math.max(0.01, 0.45 * speed);
    setFlying(true);
    void animate(el, { x: collectTo.x - width / 2, y: collectTo.y - h / 2, rotate: 90, opacity: [1, 1, 0] }, { duration: dur, ease: EASE.inOut, times: [0, 0.8, 1] });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [collectTo]);

  // Sacudida breve (pasarse de 21).
  useEffect(() => {
    const body = (scope.current as HTMLElement | null)?.querySelector('[data-body]');
    if (!shake || !body || speed === 0) return;
    void animate(body, { x: [0, -5, 5, -3, 3, 0] }, { duration: 0.45 * Math.max(speed, 0.5) });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [shake]);

  // Sonido de giro cuando una carta pasa a boca arriba ya en la mesa.
  const prevFace = useRef(faceUp && landed);
  const onFaceShownRef = useRef(onFaceShown);
  onFaceShownRef.current = onFaceShown;
  useEffect(() => {
    if (prevFace.current) onFaceShownRef.current?.(); // ya boca arriba al montar (recuperación)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  useEffect(() => {
    const now = faceUp && landed;
    const changed = now && !prevFace.current;
    prevFace.current = now;
    if (!changed) return;
    if (sound) audio.play('cardFlip');
    const half = DURATION.flip * Math.max(speed, 0.3) * (dramatic ? 1.35 : 1) * 0.5;
    const t = window.setTimeout(() => onFaceShownRef.current?.(), speed === 0 ? 0 : half);
    return () => window.clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [faceUp, landed, sound]);

  return (
    <div ref={scope} className="absolute left-0 top-0" style={{ zIndex: flying ? 400 + z : z, width, height: h, willChange: 'transform' }}>
      <motion.div data-shadow className="absolute inset-[3px] rounded-[12px] bg-black/60 blur-[8px]" style={{ opacity: 0.6, x: 3, y: 4 }} />
      <div data-body className="relative">
        <PlayingCard
          card={card}
          faceUp={landed && faceUp && !collectTo}
          width={width}
          screenScale={stageScale}
          highlight={highlight}
          dim={dim}
          dramatic={dramatic}
          flipDuration={DURATION.flip * Math.max(speed, 0.3)}
        />
      </div>
    </div>
  );
});
