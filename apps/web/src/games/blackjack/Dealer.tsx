import { motion } from 'motion/react';
import { memo } from 'react';

export type DealerPose = 'idle' | 'shuffle' | 'deal' | 'reveal' | 'collect' | 'pay' | 'nod';

interface Props {
  pose: DealerPose;
  /** Ángulo del brazo derecho al repartir (grados; negativo = hacia su izquierda/nuestra derecha). */
  reach: number;
  speed: number;
  breathing: boolean;
}

/**
 * Crupier estilizado en 2D (SVG). Figura art déco sin rasgos realistas:
 * poses y transiciones suaves en lugar de un modelo humano que pueda resultar artificial.
 * Las poses están sincronizadas con los eventos de la partida.
 */
export const Dealer = memo(function Dealer({ pose, reach, speed, breathing }: Props) {
  const t = (d: number) => ({ duration: Math.max(0.05, d * Math.max(speed, 0.25)), ease: [0.22, 1, 0.36, 1] as const });
  // Brazo derecho del crupier (a nuestra izquierda en pantalla): reparte y voltea cartas.
  const rightArm = {
    idle: { rotate: 8, x: 0, y: 0 },
    shuffle: { rotate: -22, x: 4, y: 6 },
    deal: { rotate: reach, x: 0, y: 6 },
    reveal: { rotate: -30, x: 3, y: 6 },
    collect: { rotate: -40, x: 2, y: 8 },
    pay: { rotate: reach, x: 0, y: 10 },
    nod: { rotate: 4, x: 0, y: 0 },
  }[pose];
  const leftArm = {
    idle: { rotate: -8, x: 0, y: 0 },
    shuffle: { rotate: 22, x: -4, y: 6 },
    deal: { rotate: -14, x: 0, y: 4 },
    reveal: { rotate: 22, x: -3, y: 6 },
    collect: { rotate: 38, x: -2, y: 8 },
    pay: { rotate: -10, x: 0, y: 4 },
    nod: { rotate: -4, x: 0, y: 0 },
  }[pose];
  const head = pose === 'nod' ? { rotate: 0, y: 5 } : pose === 'deal' || pose === 'pay' ? { rotate: reach * -0.12, y: 2 } : pose === 'reveal' ? { rotate: 0, y: 4 } : { rotate: 0, y: 0 };

  return (
    <svg viewBox="0 0 260 200" className="h-full w-full overflow-visible" aria-hidden>
      <defs>
        <linearGradient id="vest" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#1a2033" />
          <stop offset="1" stopColor="#0b0f1a" />
        </linearGradient>
        <linearGradient id="shirt" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#f6f1e6" />
          <stop offset="1" stopColor="#d9cfbb" />
        </linearGradient>
        <radialGradient id="skin" cx="45%" cy="35%" r="70%">
          <stop offset="0" stopColor="#e9c4a3" />
          <stop offset="1" stopColor="#b98a66" />
        </radialGradient>
        <linearGradient id="hair" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#2b2420" />
          <stop offset="1" stopColor="#151110" />
        </linearGradient>
      </defs>

      <motion.g animate={breathing && pose === 'idle' ? { scaleY: [1, 1.012, 1] } : { scaleY: 1 }} transition={breathing ? { duration: 4.2, repeat: Infinity, ease: 'easeInOut' } : t(0.3)} style={{ originX: '130px', originY: '200px' }}>
        {/* Brazo izquierdo del crupier (a nuestra derecha) */}
        <motion.g animate={leftArm} transition={t(0.35)} style={{ originX: '176px', originY: '120px' }}>
          <path d="M170 114 C 200 118 214 150 210 176 L 190 180 C 192 156 184 138 168 132 Z" fill="url(#shirt)" stroke="#bfb39b" strokeWidth="1" />
          <rect x="188" y="168" width="24" height="10" rx="3" fill="#cfae6b" />
          <ellipse cx="200" cy="186" rx="11" ry="9" fill="url(#skin)" />
        </motion.g>
        {/* Torso */}
        <path d="M76 200 C 74 150 86 118 130 110 C 174 118 186 150 184 200 Z" fill="url(#shirt)" />
        <path d="M86 200 C 86 160 98 128 118 116 L 130 168 L 142 116 C 162 128 174 160 174 200 Z" fill="url(#vest)" />
        <path d="M118 116 L130 168 L142 116" fill="none" stroke="#cfae6b" strokeWidth="1.4" />
        {[176, 188].map((y) => (
          <circle key={y} cx="130" cy={y} r="2.6" fill="#cfae6b" />
        ))}
        {/* Pajarita */}
        <path d="M130 118 L116 111 L116 125 Z M130 118 L144 111 L144 125 Z" fill="#7d1624" />
        <circle cx="130" cy="118" r="3.2" fill="#9b2032" />
        {/* Cuello y cabeza */}
        <rect x="122" y="92" width="16" height="22" rx="6" fill="url(#skin)" />
        <motion.g animate={head} transition={t(0.35)} style={{ originX: '130px', originY: '100px' }}>
          <ellipse cx="130" cy="70" rx="25" ry="30" fill="url(#skin)" />
          <path d="M104 66 C 102 40 120 30 134 31 C 152 32 160 46 156 66 C 152 52 142 46 128 47 C 116 48 108 56 104 66 Z" fill="url(#hair)" />
          {/* Rasgos mínimos y estilizados */}
          <path d="M117 72 q4 -3 8 0" stroke="#3a2a20" strokeWidth="1.8" fill="none" strokeLinecap="round" />
          <path d="M135 72 q4 -3 8 0" stroke="#3a2a20" strokeWidth="1.8" fill="none" strokeLinecap="round" />
          <motion.path d="M124 87 q6 2 12 0" initial={false} animate={{ d: pose === 'nod' || pose === 'pay' ? 'M123 86 q7 5 14 0' : 'M124 87 q6 2 12 0' }} transition={t(0.3)} stroke="#8a4f3b" strokeWidth="1.8" fill="none" strokeLinecap="round" />
        </motion.g>
        {/* Brazo derecho del crupier (a nuestra izquierda): el que reparte */}
        <motion.g animate={rightArm} transition={t(0.32)} style={{ originX: '84px', originY: '120px' }}>
          <path d="M90 114 C 60 118 46 150 50 176 L 70 180 C 68 156 76 138 92 132 Z" fill="url(#shirt)" stroke="#bfb39b" strokeWidth="1" />
          <rect x="48" y="168" width="24" height="10" rx="3" fill="#cfae6b" />
          <ellipse cx="60" cy="186" rx="11" ry="9" fill="url(#skin)" />
        </motion.g>
      </motion.g>
    </svg>
  );
});
