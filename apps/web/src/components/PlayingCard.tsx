import { motion, useAnimate } from 'motion/react';
import { memo, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { DURATION } from '../lib/anim/tokens';
import { cx } from '../lib/format';
import { CardBackFace, CardFace, type CardVariant } from './cards/CardFace';
import { cardName } from './cards/glyphs';

export { cardName as cardLabel };

/** Reverso independiente (barajados, zapato, bandeja). */
export const CardBack = CardBackFace;

/** Por debajo de este ancho en píxeles reales se usa la variante compacta (rango y palo grandes). */
export const COMPACT_BELOW = 64;

export interface PlayingCardProps {
  /** Carta en formato del motor ("As", "Td"…) o null si es desconocida (oculta). */
  card: string | null;
  /** Boca arriba. Si no hay carta, siempre se muestra el reverso. */
  faceUp?: boolean;
  /** Ancho en unidades CSS del contenedor. La altura es 1,4 × ancho. */
  width?: number;
  /** Escala real en pantalla (p. ej. la del escenario) para elegir la variante legible. */
  screenScale?: number;
  variant?: CardVariant | 'auto';
  className?: string;
  highlight?: boolean;
  dim?: boolean;
  /** Carta seleccionada: se eleva ligeramente. */
  selected?: boolean;
  /** Revelado destacado (carta oculta del crupier). */
  dramatic?: boolean;
  flipDuration?: number;
}

/**
 * Carta de casino reutilizable (blackjack y póker).
 *
 * - Geometría 100 % vectorial: no depende de fuentes ni imágenes.
 * - Giro 3D en dos fases: la carta gira hasta quedar de canto (90°), se cambia
 *   el lado visible y termina el giro. Así nunca hay cara y reverso a la vez,
 *   no depende de `backface-visibility` (frágil en algunos navegadores y GPUs)
 *   y el texto nunca se ve reflejado.
 * - Mientras está boca abajo, el DOM solo contiene el reverso: una carta oculta
 *   no expone ningún dato de la carta real.
 */
export const PlayingCard = memo(function PlayingCard({
  card,
  faceUp = true,
  width = 84,
  screenScale = 1,
  variant = 'auto',
  className,
  highlight,
  dim,
  selected,
  dramatic,
  flipDuration = DURATION.flip,
}: PlayingCardProps) {
  const wantFace = faceUp && !!card;
  const resolved: CardVariant = variant === 'auto' ? (width * screenScale < COMPACT_BELOW ? 'compact' : 'full') : variant;
  const [shownFace, setShownFace] = useState(wantFace);
  const [scope, animate] = useAnimate();
  const token = useRef(0);
  const mounted = useRef(false);

  useLayoutEffect(() => {
    if (!mounted.current) {
      mounted.current = true;
      return;
    }
    if (wantFace === shownFace) return;
    const my = ++token.current;
    const el = scope.current as HTMLElement | null;
    const secs = (flipDuration / 1000) * (dramatic ? 1.35 : 1);
    if (!el || secs <= 0) {
      setShownFace(wantFace);
      return;
    }
    const lift = dramatic ? -width * 0.22 : -width * 0.06;
    const peak = dramatic ? 1.16 : 1.05;
    void (async () => {
      // Fase 1: de frente a canto (aún se ve el lado anterior).
      await animate(el, { rotateY: 90, scale: peak, y: lift }, { duration: secs * 0.5, ease: [0.55, 0, 0.9, 0.45] });
      if (token.current !== my) return;
      setShownFace(wantFace);
      // Fase 2: de canto a frente, ya con el nuevo lado.
      await animate(el, { rotateY: [-90, 0], scale: 1, y: 0 }, { duration: secs * 0.5, ease: [0.1, 0.55, 0.45, 1] });
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [wantFace]);

  // Si la carta pasa de oculta a conocida sin giro (recuperación), se sincroniza.
  useEffect(() => {
    if (!card && shownFace) setShownFace(false);
  }, [card, shownFace]);

  const radius = 'rounded-[7.5%/5.4%]';
  return (
    <motion.div
      className={cx('relative select-none', className)}
      style={{ width, height: width * 1.4, perspective: width * 6 }}
      role="img"
      aria-label={wantFace ? cardName(card!) : 'Carta boca abajo'}
      animate={{ y: selected ? -width * 0.14 : 0 }}
      transition={{ type: 'spring', stiffness: 420, damping: 28 }}
      data-face={shownFace && card ? 'up' : 'down'}
    >
      <div ref={scope} className="absolute inset-0" style={{ willChange: 'transform' }}>
        <div className={cx('absolute inset-0 overflow-hidden', radius)}>
          {shownFace && card ? <CardFace card={card} variant={resolved} /> : <CardBackFace />}
        </div>
      </div>
      <div
        className={cx(
          'pointer-events-none absolute inset-0 transition-[box-shadow,background-color] duration-300',
          radius,
          highlight && 'shadow-[0_0_0_2px_#EBD9A6,0_0_22px_rgba(235,217,166,0.6)]',
          dramatic && shownFace && 'shadow-[0_0_0_2px_#EBD9A6,0_0_34px_rgba(235,217,166,0.75)]',
          selected && 'shadow-[0_0_0_2px_#EBD9A6,0_14px_24px_-8px_rgba(0,0,0,0.7)]',
          dim && 'bg-black/40',
        )}
      />
    </motion.div>
  );
});
