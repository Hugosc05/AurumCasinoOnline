import { motion, useSpring, type MotionValue } from 'motion/react';
import { memo, useEffect, useRef, useState, type ReactNode } from 'react';

export type DealerPose = 'idle' | 'welcome' | 'shuffle' | 'deal' | 'reveal' | 'collect' | 'pay' | 'nod' | 'think';

interface Props {
  pose: DealerPose;
  /** Dirección del reparto (grados; negativo = hacia nuestra derecha, positivo = hacia nuestra izquierda). */
  reach: number;
  speed: number;
  breathing: boolean;
  /** Muestra una carta en la mano que reparte (las cartas salen de su mano). */
  holdingCard?: boolean;
}

type SpringCfg = { stiffness: number; damping: number; mass: number };

/** Valor numérico que sigue a su objetivo con un muelle (las poses nunca saltan). */
function useSpringTo(target: number, cfg: SpringCfg): MotionValue<number> {
  const mv = useSpring(target, cfg);
  useEffect(() => {
    mv.set(target);
  }, [mv, target]);
  return mv;
}

/**
 * Giro alrededor de un punto fijo del dibujo. Se usa el atributo `transform`
 * de SVG con el pivote explícito: así los grupos anidados (hombro → codo)
 * giran siempre sobre su articulación, sin depender de cajas de referencia.
 */
function Pivot({ angle, x, y, dy, scaleY, children }: { angle: MotionValue<number>; x: number; y: number; dy?: MotionValue<number>; scaleY?: MotionValue<number>; children: ReactNode }) {
  const ref = useRef<SVGGElement>(null);
  const compute = (): string =>
    `translate(0 ${dy?.get() ?? 0}) rotate(${angle.get()} ${x} ${y}) translate(${x} ${y}) scale(1 ${scaleY?.get() ?? 1}) translate(${-x} ${-y})`;
  useEffect(() => {
    const update = (): void => ref.current?.setAttribute('transform', compute());
    update();
    const offs = [angle, dy, scaleY].filter((m): m is MotionValue<number> => !!m).map((m) => m.on('change', update));
    return () => offs.forEach((o) => o());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [angle, dy, scaleY, x, y]);
  return <g ref={ref} transform={compute()}>{children}</g>;
}

/** Desplazamiento (mirada) controlado por dos muelles. */
function Shift({ x, y, children }: { x: MotionValue<number>; y: MotionValue<number>; children: ReactNode }) {
  const ref = useRef<SVGGElement>(null);
  useEffect(() => {
    const update = (): void => ref.current?.setAttribute('transform', `translate(${x.get()} ${y.get()})`);
    update();
    const offs = [x.on('change', update), y.on('change', update)];
    return () => offs.forEach((o) => o());
  }, [x, y]);
  return <g ref={ref}>{children}</g>;
}

/**
 * Crupier ilustrado en 2,5D (SVG por capas).
 *
 * - Brazos articulados en dos segmentos (hombro → codo → mano): el reparto
 *   extiende el antebrazo hacia el asiento y lo acorta en perspectiva.
 * - Respiración, parpadeo con intervalos irregulares y mirada que sigue la
 *   carta que se reparte.
 * - Poses: reposo, bienvenida (inicio de ronda), barajar, repartir, revelar,
 *   recoger, pagar, asentir (final) y pensar (turno del crupier).
 * Las transiciones se encadenan con muelles suaves para evitar saltos.
 */
export const Dealer = memo(function Dealer({ pose, reach, speed, breathing, holdingCard = false }: Props) {
  const k = Math.max(speed, 0.25);
  const cfg: SpringCfg = { stiffness: 170 / k, damping: 19, mass: 0.9 };
  const r = Math.max(-70, Math.min(60, reach));

  // Brazo que reparte: el derecho del crupier (a nuestra izquierda). Ángulos en grados.
  // upper: giro en el hombro; fore: giro del antebrazo en el codo; stretch: escorzo del antebrazo.
  // Hacia los asientos de nuestra derecha reparte con la otra mano (no cruza el cuerpo).
  const leftDeals = (pose === 'deal' || pose === 'pay') && r < -15;
  const restR = { upper: 8, fore: -40, stretch: 1 };
  const restL = { upper: -8, fore: 40, stretch: 1 };
  const reachArm = (sign: 1 | -1) => ({ upper: r * 0.55 - sign * 4, fore: r * 0.55 - sign * 10, stretch: 1.25 });
  const right = {
    idle: { upper: 12, fore: -30, stretch: 1 },
    welcome: { upper: 26, fore: 22, stretch: 1 },
    shuffle: { upper: -10, fore: -74, stretch: 1 },
    deal: leftDeals ? restR : reachArm(1),
    reveal: { upper: -18, fore: -62, stretch: 1.12 },
    collect: { upper: -26, fore: -54, stretch: 1.2 },
    pay: leftDeals ? restR : reachArm(1),
    nod: { upper: 10, fore: -44, stretch: 1 },
    think: { upper: 6, fore: -56, stretch: 1 },
  }[pose];
  const left = {
    idle: { upper: -12, fore: 30, stretch: 1 },
    welcome: { upper: -26, fore: -22, stretch: 1 },
    shuffle: { upper: 10, fore: 74, stretch: 1 },
    deal: leftDeals ? reachArm(-1) : { upper: -6, fore: 52, stretch: 1 }, // si no reparte, sujeta el mazo
    reveal: { upper: 14, fore: 50, stretch: 1.05 },
    collect: { upper: 26, fore: 54, stretch: 1.2 },
    pay: leftDeals ? reachArm(-1) : restL,
    nod: { upper: -10, fore: 44, stretch: 1 },
    think: { upper: -6, fore: 56, stretch: 1 },
  }[pose];
  const headT =
    pose === 'nod' ? { rotate: 0, y: 4 }
      : pose === 'deal' || pose === 'pay' ? { rotate: r * -0.1, y: 2 }
        : pose === 'reveal' || pose === 'collect' ? { rotate: 0, y: 4 }
          : pose === 'think' ? { rotate: -5, y: 1 }
            : pose === 'welcome' ? { rotate: 3, y: -1 }
              : { rotate: 0, y: 0 };
  const torsoT = pose === 'deal' || pose === 'collect' || pose === 'pay' ? { y: 3, rotate: r * -0.03 } : pose === 'welcome' ? { y: -1, rotate: 0 } : { y: 0, rotate: 0 };
  // Mirada: las pupilas siguen la dirección del reparto.
  const gazeT = pose === 'deal' || pose === 'pay' ? { x: Math.max(-2.2, Math.min(2.2, -r / 25)), y: 1.4 } : pose === 'reveal' || pose === 'collect' ? { x: 0, y: 1.8 } : pose === 'think' ? { x: -1.4, y: -0.8 } : { x: 0, y: 0 };
  const smile = pose === 'welcome' || pose === 'pay' || pose === 'nod';

  const rU = useSpringTo(right.upper, cfg);
  const rF = useSpringTo(right.fore, cfg);
  const rS = useSpringTo(right.stretch, cfg);
  const lU = useSpringTo(left.upper, cfg);
  const lF = useSpringTo(left.fore, cfg);
  const lS = useSpringTo(left.stretch, cfg);
  const hR = useSpringTo(headT.rotate, cfg);
  const hY = useSpringTo(headT.y, cfg);
  const tR = useSpringTo(torsoT.rotate, cfg);
  const tY = useSpringTo(torsoT.y, cfg);
  const gX = useSpringTo(gazeT.x, cfg);
  const gY = useSpringTo(gazeT.y, cfg);

  // Parpadeo con intervalos irregulares (no sincronizado con nada).
  const [blink, setBlink] = useState(false);
  useEffect(() => {
    if (!breathing) return;
    let t: number;
    let u: number;
    const loop = (): void => {
      t = window.setTimeout(() => {
        setBlink(true);
        u = window.setTimeout(() => setBlink(false), 120);
        loop();
      }, 2200 + Math.random() * 3600);
    };
    loop();
    return () => {
      window.clearTimeout(t);
      window.clearTimeout(u);
    };
  }, [breathing]);

  const browD = pose === 'think' ? 'M114 61 q6 -4 12 -1 M135 59 q6 -2 12 2' : 'M114 61 q6 -3 12 0 M134 61 q6 -3 12 0';
  const mouthD = smile ? 'M121 89 q9 7 18 0' : pose === 'think' ? 'M123 90 q7 0 14 -1' : 'M122 90 q8 3 16 0';

  return (
    <svg viewBox="0 0 260 210" className="h-full w-full overflow-visible" aria-hidden>
      <defs>
        <linearGradient id="dl-vest" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#262d45" />
          <stop offset="0.55" stopColor="#141a2b" />
          <stop offset="1" stopColor="#0a0d17" />
        </linearGradient>
        <linearGradient id="dl-sheen" x1="0" y1="0" x2="1" y2="0">
          <stop offset="0" stopColor="#ffffff" stopOpacity="0" />
          <stop offset="0.5" stopColor="#ffffff" stopOpacity="0.09" />
          <stop offset="1" stopColor="#ffffff" stopOpacity="0" />
        </linearGradient>
        <linearGradient id="dl-shirt" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#fbf8f1" />
          <stop offset="1" stopColor="#d6cbb4" />
        </linearGradient>
        <linearGradient id="dl-sleeve" x1="0" y1="0" x2="1" y2="0">
          <stop offset="0" stopColor="#d2c7af" />
          <stop offset="0.45" stopColor="#f8f4ea" />
          <stop offset="1" stopColor="#cfc3aa" />
        </linearGradient>
        <radialGradient id="dl-skin" cx="42%" cy="34%" r="72%">
          <stop offset="0" stopColor="#f0cfb0" />
          <stop offset="0.7" stopColor="#d4a582" />
          <stop offset="1" stopColor="#b5845f" />
        </radialGradient>
        <radialGradient id="dl-hand" cx="40%" cy="35%" r="70%">
          <stop offset="0" stopColor="#efcaa8" />
          <stop offset="1" stopColor="#bf8e69" />
        </radialGradient>
        <linearGradient id="dl-hair" x1="0" y1="0" x2="0.4" y2="1">
          <stop offset="0" stopColor="#3a2e27" />
          <stop offset="1" stopColor="#14100d" />
        </linearGradient>
        <linearGradient id="dl-gold" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#f1d690" />
          <stop offset="1" stopColor="#a8822f" />
        </linearGradient>
        <filter id="dl-soft" x="-20%" y="-20%" width="140%" height="140%">
          <feGaussianBlur stdDeviation="3" />
        </filter>
      </defs>

      <style>{`@keyframes dl-breathe { 0%, 100% { transform: scaleY(1); } 50% { transform: scaleY(1.013); } } .dl-breathe { transform-box: view-box; transform-origin: 130px 210px; animation: dl-breathe 4.4s ease-in-out infinite; }`}</style>

      {/* Sombra proyectada sobre el tapete */}
      <ellipse cx="130" cy="208" rx="92" ry="10" fill="#000" opacity="0.35" filter="url(#dl-soft)" />

      <g className={breathing && (pose === 'idle' || pose === 'think') ? 'dl-breathe' : undefined}>
        <Pivot angle={tR} x={130} y={200} dy={tY}>
          {/* Brazo izquierdo del crupier (a nuestra derecha), por detrás del torso */}
          <Arm side="left" shoulder={{ x: 170, y: 126 }} upper={lU} fore={lF} stretch={lS} holdingCard={holdingCard && leftDeals} />

          {/* Torso: camisa, chaleco satinado, botones dorados, placa con nombre */}
          <path d="M70 210 C 68 160 82 124 130 114 C 178 124 192 160 190 210 Z" fill="url(#dl-shirt)" />
          <path d="M82 210 C 82 166 96 132 117 119 L 130 172 L 143 119 C 164 132 178 166 178 210 Z" fill="url(#dl-vest)" />
          <path d="M82 210 C 82 166 96 132 117 119 L 130 172 L 143 119 C 164 132 178 166 178 210 Z" fill="url(#dl-sheen)" />
          <path d="M117 119 L130 172 L143 119" fill="none" stroke="url(#dl-gold)" strokeWidth="1.5" />
          <path d="M96 150 C 104 156 110 168 112 184" stroke="#000" strokeOpacity="0.25" strokeWidth="2" fill="none" />
          <path d="M164 150 C 156 156 150 168 148 184" stroke="#000" strokeOpacity="0.25" strokeWidth="2" fill="none" />
          {[180, 193, 206].map((y) => (
            <g key={y}>
              <circle cx="130" cy={y} r="2.9" fill="url(#dl-gold)" />
              <circle cx="129.2" cy={y - 0.8} r="0.9" fill="#fff6d8" />
            </g>
          ))}
          <rect x="146" y="150" width="22" height="8" rx="2" fill="url(#dl-gold)" />
          <text x="157" y="156.4" textAnchor="middle" fontSize="5" fontFamily="'Bodoni Moda Variable', serif" fill="#2a1d08" letterSpacing="0.6">AURUM</text>

          {/* Pajarita */}
          <path d="M130 122 L114 114 Q112 122 114 130 Z M130 122 L146 114 Q148 122 146 130 Z" fill="#7d1624" />
          <path d="M116 116 L124 120 M144 116 L136 120" stroke="#b33a4c" strokeWidth="1" opacity="0.7" />
          <rect x="126.5" y="118.5" width="7" height="7" rx="2" fill="#9b2032" />

          {/* Cuello con sombra de la barbilla */}
          <path d="M121 94 h18 v22 c-5 4 -13 4 -18 0 z" fill="url(#dl-skin)" />
          <path d="M121 100 c6 6 12 6 18 0 v4 c-6 5 -12 5 -18 0 z" fill="#8a5d3f" opacity="0.35" />

          {/* Cabeza */}
          <Pivot angle={hR} x={130} y={104} dy={hY}>
            <ellipse cx="104.5" cy="74" rx="5" ry="8" fill="#c99573" />
            <ellipse cx="155.5" cy="74" rx="5" ry="8" fill="#c99573" />
            <ellipse cx="130" cy="70" rx="26" ry="31" fill="url(#dl-skin)" />
            {/* Pelo peinado hacia atrás con brillo */}
            <path d="M103 68 C 99 40 117 29 133 30 C 153 31 163 46 157 68 C 155 52 145 44 131 44 C 118 44 108 52 103 68 Z" fill="url(#dl-hair)" />
            <path d="M115 38 C 125 33 140 33 150 40" stroke="#6e5a4c" strokeWidth="2" fill="none" strokeLinecap="round" opacity="0.6" />
            <path d="M104 66 C 104 60 106 56 108 53" stroke="#14100d" strokeWidth="3" strokeLinecap="round" />
            <path d="M156 66 C 156 60 154 56 152 53" stroke="#14100d" strokeWidth="3" strokeLinecap="round" />
            {/* Cejas */}
            <motion.path d={browD} initial={false} animate={{ d: browD }} transition={{ duration: 0.25 * k }} stroke="#2d221b" strokeWidth="2.2" fill="none" strokeLinecap="round" />
            {/* Ojos con parpadeo y mirada */}
            <g transform={blink ? 'translate(0 70) scale(1 0.1) translate(0 -70)' : undefined}>
              <ellipse cx="120" cy="70" rx="5.2" ry="3.6" fill="#fbf7ef" />
              <ellipse cx="140" cy="70" rx="5.2" ry="3.6" fill="#fbf7ef" />
              <Shift x={gX} y={gY}>
                <circle cx="120" cy="70" r="2.6" fill="#3f2c1f" />
                <circle cx="140" cy="70" r="2.6" fill="#3f2c1f" />
                <circle cx="120.9" cy="69.1" r="0.8" fill="#fff" />
                <circle cx="140.9" cy="69.1" r="0.8" fill="#fff" />
              </Shift>
              <path d="M114.6 68.4 q5.4 -3.6 10.8 0 M134.6 68.4 q5.4 -3.6 10.8 0" stroke="#5a3f2e" strokeWidth="1.2" fill="none" />
            </g>
            {/* Nariz y mejillas */}
            <path d="M130 72 q-3 9 0 11 q2 1 4 -0.5" stroke="#a3714f" strokeWidth="1.6" fill="none" strokeLinecap="round" />
            <circle cx="113" cy="82" r="4.5" fill="#e07a6a" opacity="0.12" />
            <circle cx="147" cy="82" r="4.5" fill="#e07a6a" opacity="0.12" />
            {/* Boca */}
            <motion.path d={mouthD} initial={false} animate={{ d: mouthD }} transition={{ duration: 0.25 * k }} stroke="#8a4635" strokeWidth="2" fill="none" strokeLinecap="round" />
          </Pivot>

          {/* Brazo derecho del crupier (a nuestra izquierda): el que reparte, por delante */}
          <Arm side="right" shoulder={{ x: 90, y: 126 }} upper={rU} fore={rF} stretch={rS} holdingCard={holdingCard && (pose === 'deal' || pose === 'pay') && !leftDeals} />
        </Pivot>
      </g>
    </svg>
  );
});

/**
 * Brazo en dos segmentos. El dibujo base cuelga hacia abajo desde el hombro;
 * `upper` gira en el hombro, `fore` gira en el codo y `stretch` alarga el
 * antebrazo (escorzo: la mano se acerca al jugador).
 */
function Arm({ side, shoulder, upper, fore, stretch, holdingCard = false }: {
  side: 'left' | 'right';
  shoulder: { x: number; y: number };
  upper: MotionValue<number>;
  fore: MotionValue<number>;
  stretch: MotionValue<number>;
  holdingCard?: boolean;
}) {
  const s = side === 'right' ? -1 : 1; // hacia fuera del cuerpo
  const { x, y } = shoulder;
  const elbow = { x: x + s * 12, y: y + 36 };
  return (
    <Pivot angle={upper} x={x} y={y}>
      {/* Brazo: manga con pliegues y liga dorada */}
      <path
        d={`M${x - 11} ${y - 4} C ${x - 14 + s * 6} ${y + 14} ${elbow.x - 12} ${elbow.y - 6} ${elbow.x - 10} ${elbow.y + 4} L ${elbow.x + 10} ${elbow.y + 4} C ${elbow.x + 12} ${elbow.y - 8} ${x + 14 + s * 6} ${y + 12} ${x + 11} ${y - 4} Z`}
        fill="url(#dl-sleeve)" stroke="#b6a989" strokeWidth="0.8"
      />
      <path d={`M${x - 8 + s * 2} ${y + 16} q 8 4 16 0`} stroke="url(#dl-gold)" strokeWidth="3.4" fill="none" strokeLinecap="round" />
      {/* Antebrazo y mano */}
      <Pivot angle={fore} x={elbow.x} y={elbow.y} scaleY={stretch}>
        <circle cx={elbow.x} cy={elbow.y + 1} r="10.5" fill="url(#dl-sleeve)" />
        <path
          d={`M${elbow.x - 10} ${elbow.y} C ${elbow.x - 10} ${elbow.y + 14} ${elbow.x - 8} ${elbow.y + 26} ${elbow.x - 7} ${elbow.y + 32} L ${elbow.x + 7} ${elbow.y + 32} C ${elbow.x + 8} ${elbow.y + 26} ${elbow.x + 10} ${elbow.y + 14} ${elbow.x + 10} ${elbow.y} Z`}
          fill="url(#dl-sleeve)" stroke="#b6a989" strokeWidth="0.8"
        />
        <path d={`M${elbow.x - 6} ${elbow.y + 6} q 6 3 12 0`} stroke="#b6a989" strokeWidth="0.9" fill="none" opacity="0.8" />
        <rect x={elbow.x - 8.5} y={elbow.y + 28} width="17" height="6" rx="2" fill="#f4efe3" stroke="#b6a989" strokeWidth="0.6" />
        <circle cx={elbow.x} cy={elbow.y + 31} r="1.2" fill="url(#dl-gold)" />
        {/* Mano: palma, pulgar y dedos */}
        <path d={`M${elbow.x - 7.5} ${elbow.y + 34} C ${elbow.x - 9} ${elbow.y + 44} ${elbow.x - 5} ${elbow.y + 50} ${elbow.x} ${elbow.y + 50} C ${elbow.x + 5} ${elbow.y + 50} ${elbow.x + 9} ${elbow.y + 44} ${elbow.x + 7.5} ${elbow.y + 34} Z`} fill="url(#dl-hand)" />
        <path d={`M${elbow.x - s * 7} ${elbow.y + 37} q ${-s * 5} 3 ${-s * 4} 9`} stroke="#c8936d" strokeWidth="4" strokeLinecap="round" fill="none" />
        {[-4, -1.3, 1.3, 4].map((dx) => (
          <path key={dx} d={`M${elbow.x + dx} ${elbow.y + 47} v 4`} stroke="#c8936d" strokeWidth="2.6" strokeLinecap="round" />
        ))}
        {holdingCard && (
          <g>
            <rect x={elbow.x - 9} y={elbow.y + 42} width="18" height="25" rx="2.5" fill="#7d1624" stroke="#f1d690" strokeWidth="1" />
            <rect x={elbow.x - 6} y={elbow.y + 45} width="12" height="19" rx="1.5" fill="none" stroke="#f1d690" strokeWidth="0.6" opacity="0.8" />
          </g>
        )}
      </Pivot>
    </Pivot>
  );
}
