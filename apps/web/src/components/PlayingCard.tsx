import { motion } from 'motion/react';
import { memo } from 'react';
import { DURATION, EASE } from '../lib/anim/tokens';
import { cx } from '../lib/format';

export type SuitChar = 's' | 'h' | 'd' | 'c';

const SUIT_PATHS: Record<SuitChar, string> = {
  h: 'M50 88 C 22 64 4 46 14 26 C 22 10 44 10 50 28 C 56 10 78 10 86 26 C 96 46 78 64 50 88 Z',
  d: 'M50 6 Q 64 30 84 50 Q 64 70 50 94 Q 36 70 16 50 Q 36 30 50 6 Z',
  s: 'M50 6 C 34 30 8 42 10 62 C 12 78 34 82 45 69 C 44 80 40 88 31 94 L 69 94 C 60 88 56 80 55 69 C 66 82 88 78 90 62 C 92 42 66 30 50 6 Z',
  c: 'M50 10 A 17 17 0 0 1 64 37 A 17 17 0 1 1 55 66 C 56 80 60 88 68 94 L 32 94 C 40 88 44 80 45 66 A 17 17 0 1 1 36 37 A 17 17 0 0 1 50 10 Z',
};

export const SUIT_COLOR: Record<SuitChar, string> = { h: '#B02A3C', d: '#B02A3C', s: '#141a28', c: '#141a28' };

export function SuitGlyph({ suit, x, y, size, flip = false }: { suit: SuitChar; x: number; y: number; size: number; flip?: boolean }) {
  return (
    <g transform={`translate(${x - size / 2} ${y - size / 2}) ${flip ? `rotate(180 ${size / 2} ${size / 2})` : ''} scale(${size / 100})`}>
      <path d={SUIT_PATHS[suit]} fill={SUIT_COLOR[suit]} />
    </g>
  );
}

const PIPS: Record<number, [number, number][]> = {
  2: [[50, 28], [50, 112]],
  3: [[50, 28], [50, 70], [50, 112]],
  4: [[32, 28], [68, 28], [32, 112], [68, 112]],
  5: [[32, 28], [68, 28], [50, 70], [32, 112], [68, 112]],
  6: [[32, 28], [68, 28], [32, 70], [68, 70], [32, 112], [68, 112]],
  7: [[32, 28], [68, 28], [50, 49], [32, 70], [68, 70], [32, 112], [68, 112]],
  8: [[32, 28], [68, 28], [50, 49], [32, 70], [68, 70], [50, 91], [32, 112], [68, 112]],
  9: [[32, 28], [68, 28], [32, 56], [68, 56], [50, 70], [32, 84], [68, 84], [32, 112], [68, 112]],
  10: [[32, 28], [68, 28], [50, 42], [32, 56], [68, 56], [32, 84], [68, 84], [50, 98], [32, 112], [68, 112]],
};

const RANK_LABEL: Record<string, string> = { T: '10', J: 'J', Q: 'Q', K: 'K', A: 'A' };
const RANK_NUM: Record<string, number> = { '2': 2, '3': 3, '4': 4, '5': 5, '6': 6, '7': 7, '8': 8, '9': 9, T: 10 };
const FACE_NAME: Record<string, string> = { J: 'Jota', Q: 'Reina', K: 'Rey', A: 'As' };
const SUIT_NAME: Record<SuitChar, string> = { s: 'picas', h: 'corazones', d: 'diamantes', c: 'tréboles' };

export function cardLabel(card: string): string {
  const r = card[0]!;
  const s = card[1] as SuitChar;
  return `${FACE_NAME[r] ?? RANK_LABEL[r] ?? r} de ${SUIT_NAME[s]}`;
}

const CardFace = memo(function CardFace({ card }: { card: string }) {
  const r = card[0]!;
  const s = card[1] as SuitChar;
  const color = SUIT_COLOR[s];
  const label = RANK_LABEL[r] ?? r;
  const n = RANK_NUM[r];
  const face = r === 'J' || r === 'Q' || r === 'K';
  return (
    <svg viewBox="0 0 100 140" className="h-full w-full" aria-hidden>
      <defs>
        <linearGradient id="paper" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#fbf8f1" />
          <stop offset="1" stopColor="#ece4d2" />
        </linearGradient>
      </defs>
      <rect x="0.5" y="0.5" width="99" height="139" rx="8" fill="url(#paper)" stroke="#cdbf9f" strokeWidth="1" />
      {/* Índices de esquina */}
      <text x="9" y="21" fontFamily="'Bodoni Moda Variable', Georgia, serif" fontWeight="700" fontSize={label.length > 1 ? 15 : 18} fill={color} textAnchor="middle" transform={label.length > 1 ? 'translate(1 0)' : undefined}>
        {label}
      </text>
      <SuitGlyph suit={s} x={10} y={31} size={10} />
      <g transform="rotate(180 50 70)">
        <text x="9" y="21" fontFamily="'Bodoni Moda Variable', Georgia, serif" fontWeight="700" fontSize={label.length > 1 ? 15 : 18} fill={color} textAnchor="middle" transform={label.length > 1 ? 'translate(1 0)' : undefined}>
          {label}
        </text>
        <SuitGlyph suit={s} x={10} y={31} size={10} />
      </g>
      {n && PIPS[n]!.map(([x, y], i) => <SuitGlyph key={i} suit={s} x={x} y={y} size={n >= 9 ? 17 : 19} flip={y > 70} />)}
      {r === 'A' && <SuitGlyph suit={s} x={50} y={70} size={s === 's' ? 46 : 38} />}
      {face && (
        <g>
          <rect x="20" y="22" width="60" height="96" rx="4" fill="none" stroke={color} strokeOpacity="0.55" strokeWidth="1.2" />
          <rect x="23" y="25" width="54" height="90" rx="3" fill={s === 'h' || s === 'd' ? '#f6e3df' : '#e4e8f0'} />
          <path d="M23 70 H77" stroke={color} strokeOpacity="0.25" strokeWidth="0.8" />
          <text x="50" y="62" fontFamily="'Bodoni Moda Variable', Georgia, serif" fontWeight="600" fontSize="34" fill={color} textAnchor="middle">
            {r}
          </text>
          <g transform="rotate(180 50 70)">
            <text x="50" y="62" fontFamily="'Bodoni Moda Variable', Georgia, serif" fontWeight="600" fontSize="34" fill={color} textAnchor="middle" opacity="0.85">
              {r}
            </text>
          </g>
          <SuitGlyph suit={s} x={50} y={70} size={13} />
          <path d="M38 36 L44 30 L50 36 L56 30 L62 36" stroke="#b8963f" strokeWidth="1.6" fill="none" />
        </g>
      )}
    </svg>
  );
});

export const CardBack = memo(function CardBack() {
  return (
    <svg viewBox="0 0 100 140" className="h-full w-full" aria-hidden>
      <defs>
        <pattern id="deco" width="10" height="10" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
          <rect width="10" height="10" fill="#101b33" />
          <path d="M0 5 H10 M5 0 V10" stroke="#cfae6b" strokeOpacity="0.28" strokeWidth="0.7" />
        </pattern>
        <radialGradient id="backglow" cx="50%" cy="45%" r="60%">
          <stop offset="0" stopColor="#1d2c52" />
          <stop offset="1" stopColor="#0a1122" />
        </radialGradient>
      </defs>
      <rect x="0.5" y="0.5" width="99" height="139" rx="8" fill="url(#backglow)" stroke="#cfae6b" strokeOpacity="0.6" />
      <rect x="7" y="7" width="86" height="126" rx="5" fill="url(#deco)" stroke="#cfae6b" strokeOpacity="0.7" strokeWidth="0.8" />
      <circle cx="50" cy="70" r="20" fill="#0a1122" stroke="#cfae6b" strokeWidth="1.2" />
      <circle cx="50" cy="70" r="16" fill="none" stroke="#cfae6b" strokeOpacity="0.4" strokeWidth="0.6" />
      <path d="M50 57 L60 82 H55.5 L53.2 76 H46.8 L44.5 82 H40 Z M48.2 72.5 H51.8 L50 67.5 Z" fill="#e2c78c" />
    </svg>
  );
});

export interface PlayingCardProps {
  card: string | null;
  faceUp?: boolean;
  width?: number;
  className?: string;
  highlight?: boolean;
  dim?: boolean;
  flipDuration?: number;
}

/** Carta con reverso y giro 3D. `faceUp` controla el giro; si no hay carta se muestra siempre el reverso. */
export function PlayingCard({ card, faceUp = true, width = 84, className, highlight, dim, flipDuration = DURATION.flip }: PlayingCardProps) {
  const showFace = faceUp && !!card;
  return (
    <div
      className={cx('relative', className)}
      style={{ width, height: width * 1.4, perspective: width * 8 }}
      role="img"
      aria-label={showFace ? cardLabel(card!) : 'Carta boca abajo'}
    >
      <motion.div
        className="absolute inset-0"
        style={{ transformStyle: 'preserve-3d' }}
        initial={false}
        animate={{ rotateY: showFace ? 0 : 180 }}
        transition={{ duration: flipDuration / 1000, ease: EASE.inOut }}
      >
        <div className="absolute inset-0" style={{ backfaceVisibility: 'hidden', WebkitBackfaceVisibility: 'hidden' }}>
          {card ? <CardFace card={card} /> : <CardBack />}
        </div>
        <div className="absolute inset-0" style={{ backfaceVisibility: 'hidden', WebkitBackfaceVisibility: 'hidden', transform: 'rotateY(180deg)' }}>
          <CardBack />
        </div>
      </motion.div>
      <div
        className={cx(
          'pointer-events-none absolute inset-0 rounded-[8%] transition-[box-shadow,opacity] duration-300',
          highlight && 'shadow-[0_0_0_2px_#ebd9a6,0_0_22px_rgba(235,217,166,0.55)]',
          dim && 'bg-black/45',
        )}
      />
    </div>
  );
}
