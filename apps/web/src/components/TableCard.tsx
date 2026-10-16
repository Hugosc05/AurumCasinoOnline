import { motion, useAnimate } from 'motion/react';
import { memo, useEffect, useLayoutEffect, useRef, useState } from 'react';
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
  dim?: boolean | 'soft';
  /** Revelado destacado. */
  dramatic?: boolean;
  /** Pequeña sacudida (p. ej., al pasarse de 21). */
  shake?: boolean;
  /** Retardo antes de girar al aterrizar (ms). */
  flipDelay?: number;
  sound?: boolean;
  /** Identificador que se devuelve en `onFaceShown` (permite pasar un callback estable). */
  cardId?: string;
  /** Se llama cuando la cara ya es visible (mitad del giro), para actualizar totales sin adelantarse. */
  onFaceShown?: (cardId: string) => void;
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
  cardId = '',
  onFaceShown,
}: Props) {
  const [scope, animate] = useAnimate();
  const stageScale = useStageScale();
  const [landed, setLanded] = useState(!from || speed === 0);
  const [flying, setFlying] = useState(!!from && speed > 0);
  const h = width * 1.4;
  /** Última posición pedida (la del vuelo puede quedar desfasada si cambia durante el trayecto). */
  const target = useRef({ x, y, rotate });
  target.current = { x, y, rotate };
  /** La carta ya está en la mesa (tras el vuelo o colocada sin animación). */
  const placed = useRef(false);

  // Vuelo inicial. Se escribe para ser idempotente: en desarrollo, React (StrictMode)
  // monta, desmonta y vuelve a montar; la limpieza detiene el vuelo y el segundo
  // montaje lo repite desde el principio, así que la carta siempre llega a aterrizar.
  useLayoutEffect(() => {
    const el = scope.current as HTMLElement | null;
    if (!el || placed.current) return;
    const { x: tx, y: ty, rotate: tr } = target.current;
    const left = tx - width / 2;
    const top = ty - h / 2;
    if (!from || speed === 0) {
      el.style.transform = `translate(${left}px, ${top}px) rotate(${tr}deg)`;
      placed.current = true;
      setLanded(true);
      setFlying(false);
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
    const controls = [
      animate(
        el,
        { x: [sx, ex, mx, left], y: [sy, ey, my, top], rotate: [-8, -14, -6, tr] },
        { duration: total, ease: [EASE.out, EASE.out, [0.3, 0.7, 0.4, 1]], times: [0, t1, tMid, 1] },
      ),
    ];
    if (shadow) controls.push(animate(shadow, { opacity: [0.25, 0.3, 0.45, 0.6], scale: [0.95, 1, 1.25, 1], x: [2, 3, 18, 3], y: [3, 4, 26, 4] }, { duration: total, times: [0, t1, tMid, 1] }));
    if (body) controls.push(animate(body, { scale: [1, 1, 1.1, 0.98, 1] }, { duration: total * 1.1, ease: EASE.out, times: [0, t1, tMid, 0.9, 1] }));
    const t = window.setTimeout(() => {
      placed.current = true;
      if (sound) audio.play('cardLand');
      setFlying(false);
      setLanded(true);
      // Si el destino cambió durante el vuelo (otra carta abrió la mano), se recoloca.
      const now = target.current;
      if (now.x !== tx || now.y !== ty || now.rotate !== tr) {
        void animate(el, { x: now.x - width / 2, y: now.y - h / 2, rotate: now.rotate }, { type: 'spring', stiffness: 260, damping: 28 });
      }
    }, total * 1000 + flipDelay * speed);
    return () => {
      window.clearTimeout(t);
      if (!placed.current) controls.forEach((c) => c.stop());
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Recolocación posterior (p. ej., al dividir o al abrirse la mano): deslizamiento suave.
  useEffect(() => {
    const el = scope.current as HTMLElement | null;
    if (!el || collectTo || !placed.current) return;
    void animate(el, { x: x - width / 2, y: y - h / 2, rotate }, { type: 'spring', stiffness: 260, damping: 28 });
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
    if (prevFace.current) onFaceShownRef.current?.(cardId); // ya boca arriba al montar (recuperación)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  useEffect(() => {
    const now = faceUp && landed;
    const changed = now && !prevFace.current;
    prevFace.current = now;
    if (!changed) return;
    if (sound) audio.play('cardFlip');
    const half = DURATION.flip * Math.max(speed, 0.3) * (dramatic ? 1.35 : 1) * 0.5;
    const t = window.setTimeout(() => onFaceShownRef.current?.(cardId), speed === 0 ? 0 : half);
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
