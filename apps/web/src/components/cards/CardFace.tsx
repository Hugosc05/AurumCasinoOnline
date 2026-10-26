import { useCardBack } from '../../lib/cosmetics';
import { memo, useId } from 'react';
import {
  PIP_LAYOUT,
  RANK_PIPS,
  RANK_STROKES,
  SUIT_PATHS,
  isRed,
  parseCard,
  suitColor,
  type RankChar,
  type SuitChar,
} from './glyphs';

/* -------------------------------------------------------------------------- */
/* Piezas básicas                                                              */
/* -------------------------------------------------------------------------- */

/** Palo centrado en (x, y) con un ancho `size` (unidades de la carta). */
export function Pip({ suit, x, y, size, flip = false, ...rest }: { suit: SuitChar; x: number; y: number; size: number; flip?: boolean; 'data-pip'?: boolean }) {
  const s = size / 100;
  return (
    <path
      {...rest}
      d={SUIT_PATHS[suit]}
      fill={suitColor(suit)}
      transform={`translate(${x - size / 2} ${y - size / 2}) scale(${s})${flip ? ' rotate(180 50 50)' : ''}`}
    />
  );
}

/** Rango dibujado con trazos (sin fuente). `height` en unidades de la carta; centrado en `cx`. */
export function RankGlyph({ rank, cx, top, height, color, strokeWidth = 2.1 }: { rank: RankChar; cx: number; top: number; height: number; color: string; strokeWidth?: number }) {
  const g = RANK_STROKES[rank];
  const scale = height / 14;
  const w = g.width * scale;
  return (
    <path
      d={g.d}
      fill="none"
      stroke={color}
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      vectorEffect="none"
      transform={`translate(${cx - w / 2} ${top}) scale(${scale})`}
      data-rank-glyph={rank}
    />
  );
}

/** Índice de esquina: rango + palo. Se dibuja arriba a la izquierda y, girado 180°, abajo a la derecha. */
function CornerIndex({ rank, suit }: { rank: RankChar; suit: SuitChar }) {
  const color = suitColor(suit);
  const glyphH = 20;
  return (
    <g data-corner>
      <RankGlyph rank={rank} cx={11.5} top={5.5} height={glyphH} color={color} />
      <Pip suit={suit} x={11.5} y={34.5} size={12.5} />
    </g>
  );
}

/* -------------------------------------------------------------------------- */
/* Figuras J, Q, K (ilustraciones vectoriales originales)                      */
/* -------------------------------------------------------------------------- */

const GOLD = '#D2A443';
const GOLD_DARK = '#7A5718';
const SKIN = '#F2D3B6';
const SKIN_LINE = '#9A6A49';

function CourtHalf({ rank, suit }: { rank: 'J' | 'Q' | 'K'; suit: SuitChar }) {
  const red = isRed(suit);
  const robe = red ? '#B3172E' : '#1E2B4C';
  const accent = red ? '#1E3A6E' : '#B3172E';
  const hair = rank === 'K' ? '#E9E3D3' : rank === 'Q' ? '#6B3A1E' : '#3A2716';
  return (
    <g>
      {/* Atributo de cada figura */}
      {rank === 'K' && (
        <g>
          <path d="M67 18 V60" stroke="#C9CED8" strokeWidth="2.2" strokeLinecap="round" />
          <path d="M67 18 L65.6 21 H68.4 Z" fill="#E8ECF2" />
          <path d="M62.5 52 H71.5" stroke={GOLD} strokeWidth="2.4" strokeLinecap="round" />
          <circle cx="67" cy="56.5" r="1.8" fill={GOLD} />
        </g>
      )}
      {rank === 'J' && (
        <g>
          <path d="M33 17 V66" stroke="#7A4A22" strokeWidth="1.8" strokeLinecap="round" />
          <path d="M33 19 C27 21 26 27 27.5 31 L33 28 Z" fill="#C9CED8" stroke="#6E7584" strokeWidth="0.6" />
          <path d="M33 14 L34.6 19 H31.4 Z" fill="#C9CED8" />
        </g>
      )}
      {rank === 'Q' && (
        <g>
          <path d="M34 66 C34 60 33 56 31 52" stroke="#2E7A3E" strokeWidth="1.4" fill="none" strokeLinecap="round" />
          <path d="M33 56 C30 55 28.5 53.5 28.5 51.5 C31 51.5 32.6 53 33 56 Z" fill="#2E7A3E" />
          {[0, 72, 144, 216, 288].map((a) => (
            <ellipse key={a} cx="31" cy="46.5" rx="2.2" ry="3.6" fill={red ? '#E14B5E' : '#D9475A'} transform={`rotate(${a} 31 49.5)`} />
          ))}
          <circle cx="31" cy="49.5" r="1.7" fill={GOLD} />
        </g>
      )}

      {/* Cuerpo y túnica */}
      <path d="M27 70 C27 60.5 32.5 54.5 40.5 52.2 L50 56.5 L59.5 52.2 C67.5 54.5 73 60.5 73 70 Z" fill={robe} stroke="#2A1A10" strokeWidth="0.7" />
      <path d="M37.5 55.6 L41.2 70 M62.5 55.6 L58.8 70" stroke={GOLD} strokeWidth="1.8" />
      <path d="M44 70 L46 60 H54 L56 70 Z" fill={accent} opacity="0.9" />
      {[61, 65, 69].map((y) => (
        <circle key={y} cx="50" cy={y} r="0.9" fill={GOLD} />
      ))}
      <path d="M40.5 52.2 L50 61 L59.5 52.2 L56.4 51 L50 56 L43.6 51 Z" fill="#FBF6EA" stroke="#2A1A10" strokeWidth="0.5" />
      {/* Cuello y cabeza */}
      <rect x="46.6" y="45" width="6.8" height="7.5" rx="2" fill={SKIN} stroke={SKIN_LINE} strokeWidth="0.4" />
      {rank === 'Q' && (
        <path d="M41.4 36 C40 28 44.6 25 50 25 C55.4 25 60 28 58.6 36 C60.8 42 60.8 48 59 53 L55.8 51.6 C56.8 46 56.6 41.5 55.6 38 C53.6 34.6 46.4 34.6 44.4 38 C43.4 41.5 43.2 46 44.2 51.6 L41 53 C39.2 48 39.2 42 41.4 36 Z" fill={hair} />
      )}
      <ellipse cx="50" cy="39.5" rx="8" ry="9.2" fill={SKIN} stroke={SKIN_LINE} strokeWidth="0.5" />
      <path d="M45.6 38.6 q1.4 -1 2.8 0 M51.6 38.6 q1.4 -1 2.8 0" stroke="#3A2A20" strokeWidth="0.75" fill="none" strokeLinecap="round" />
      <path d="M50 40 L49.2 43.2 H50.6" stroke={SKIN_LINE} strokeWidth="0.5" fill="none" />
      <path d="M47.8 45.2 Q50 46.6 52.2 45.2" stroke="#A3473D" strokeWidth="0.8" fill="none" strokeLinecap="round" />
      {rank === 'K' && (
        <>
          <path d="M42.2 41 C42.4 49 46 53.4 50 53.4 C54 53.4 57.6 49 57.8 41 C56 45 53.4 46.6 50 46.6 C46.6 46.6 44 45 42.2 41 Z" fill={hair} stroke="#B9B2A2" strokeWidth="0.4" />
          <path d="M46.6 44.4 Q50 43 53.4 44.4" stroke={hair} strokeWidth="1.4" fill="none" />
          <path d="M41.6 33 L42.2 21.5 L46 27 L50 18.5 L54 27 L57.8 21.5 L58.4 33 Z" fill={GOLD} stroke={GOLD_DARK} strokeWidth="0.6" strokeLinejoin="round" />
          <rect x="41.4" y="31.2" width="17.2" height="3" rx="0.8" fill="#E0B95C" stroke={GOLD_DARK} strokeWidth="0.5" />
          <circle cx="50" cy="28" r="1.5" fill={accent} />
          <circle cx="44.6" cy="29.6" r="1" fill="#2B8A57" />
          <circle cx="55.4" cy="29.6" r="1" fill="#2B8A57" />
        </>
      )}
      {rank === 'Q' && (
        <>
          <path d="M43 32.4 L44.6 26.6 L47.2 30 L50 24.6 L52.8 30 L55.4 26.6 L57 32.4 Z" fill={GOLD} stroke={GOLD_DARK} strokeWidth="0.55" strokeLinejoin="round" />
          <circle cx="50" cy="29.4" r="1.1" fill={accent} />
          <path d="M41.6 33.4 C44 31.8 56 31.8 58.4 33.4 C55 34.6 45 34.6 41.6 33.4 Z" fill={hair} />
        </>
      )}
      {rank === 'J' && (
        <>
          <path d="M41.8 38.6 C41.2 31.6 45 28.4 50 28.4 C55 28.4 58.8 31.6 58.2 38.6 C56.2 34.4 43.8 34.4 41.8 38.6 Z" fill={hair} />
          <path d="M39.6 33.2 C40.4 25.4 45.6 22.2 51.4 22.2 C57.6 22.2 61.6 25.8 61.4 31.2 Z" fill={accent} stroke="#2A1A10" strokeWidth="0.6" />
          <path d="M39.6 33.2 L61.4 31.2" stroke={GOLD} strokeWidth="1.4" />
          <path d="M59 27 C64 21.5 68.5 17.5 72.5 15.6 C69 20.6 66 24.4 60.8 29.6 Z" fill={GOLD} stroke={GOLD_DARK} strokeWidth="0.4" />
        </>
      )}
      {/* Palo pequeño junto a la figura */}
      <Pip suit={suit} x={rank === 'J' ? 72 : 28.5} y={rank === 'J' ? 42 : 24} size={8.5} />
    </g>
  );
}

function CourtArt({ rank, suit, uid }: { rank: 'J' | 'Q' | 'K'; suit: SuitChar; uid: string }) {
  const frame = suitColor(suit);
  const clip = `${uid}-half`;
  return (
    <g data-court={rank}>
      <defs>
        <clipPath id={clip}>
          <rect x="20" y="16" width="60" height="54" />
        </clipPath>
      </defs>
      <rect x="20" y="16" width="60" height="108" rx="4" fill={isRed(suit) ? '#FBEFE6' : '#EEF1F7'} stroke={frame} strokeWidth="1.1" />
      <g clipPath={`url(#${clip})`}>
        <CourtHalf rank={rank} suit={suit} />
      </g>
      <g clipPath={`url(#${clip})`} transform="rotate(180 50 70)">
        <CourtHalf rank={rank} suit={suit} />
      </g>
      <path d="M20 70 H80" stroke={GOLD} strokeWidth="1" />
      <path d="M50 67.4 L52.6 70 L50 72.6 L47.4 70 Z" fill={GOLD} />
      <rect x="22.2" y="18.2" width="55.6" height="103.6" rx="3" fill="none" stroke={GOLD} strokeWidth="0.6" opacity="0.8" />
    </g>
  );
}

/* -------------------------------------------------------------------------- */
/* Cara completa                                                               */
/* -------------------------------------------------------------------------- */

export type CardVariant = 'full' | 'compact';

/**
 * Cara de una carta de baraja francesa (100 × 140 unidades).
 * - `full`: índices en dos esquinas opuestas, símbolos contables, figuras ilustradas.
 * - `compact`: para tamaños pequeños (cartas rivales, móvil); rango y palo grandes.
 */
export const CardFace = memo(function CardFace({ card, variant = 'full' }: { card: string; variant?: CardVariant }) {
  const { rank, suit } = parseCard(card);
  const uid = useId().replace(/:/g, '');
  const paper = `${uid}-paper`;
  const color = suitColor(suit);
  const pips = RANK_PIPS[rank];
  return (
    <svg viewBox="0 0 100 140" className="block h-full w-full" aria-hidden data-card={card} data-rank={rank} data-suit={suit} data-color={isRed(suit) ? 'red' : 'black'} data-variant={variant}>
      <defs>
        <linearGradient id={paper} x1="0" y1="0" x2="0.35" y2="1">
          <stop offset="0" stopColor="#FFFDF8" />
          <stop offset="0.6" stopColor="#F8F2E6" />
          <stop offset="1" stopColor="#EFE6D3" />
        </linearGradient>
      </defs>
      <rect x="0.6" y="0.6" width="98.8" height="138.8" rx="7.5" fill={`url(#${paper})`} stroke="#C9BC9C" strokeWidth="1.2" />
      {variant === 'compact' ? (
        <g data-compact>
          <RankGlyph rank={rank} cx={rank === 'T' ? 26 : 23} top={8} height={40} color={color} />
          <Pip suit={suit} x={23} y={70} size={30} />
          <Pip suit={suit} x={64} y={106} size={50} />
        </g>
      ) : (
        <>
          <CornerIndex rank={rank} suit={suit} />
          <g transform="rotate(180 50 70)">
            <CornerIndex rank={rank} suit={suit} />
          </g>
          {pips !== undefined &&
            PIP_LAYOUT[pips]!.map(([x, y], i) => <Pip key={i} data-pip suit={suit} x={x} y={y} size={pips >= 9 ? 17 : 19} flip={y > 70} />)}
          {rank === 'A' && (
            <g data-ace>
              {suit === 's' && (
                <>
                  <circle cx="50" cy="70" r="31" fill="none" stroke={GOLD} strokeWidth="0.9" />
                  <circle cx="50" cy="70" r="28" fill="none" stroke={GOLD} strokeWidth="0.4" strokeDasharray="1.5 2" />
                </>
              )}
              <Pip data-pip suit={suit} x={50} y={70} size={suit === 's' ? 42 : 46} />
            </g>
          )}
          {(rank === 'J' || rank === 'Q' || rank === 'K') && <CourtArt rank={rank} suit={suit} uid={uid} />}
        </>
      )}
    </svg>
  );
});

/** Reverso propio de Aurum (no revela información). */
export const CardBackFace = memo(function CardBackFace({ owner }: { owner?: string | null }) {
  const uid = useId().replace(/:/g, '');
  // Dorso que tiene equipado el dueño de la carta (recompensa de las cajas); por defecto, el azul y oro de Aurum.
  const b = useCardBack(owner);
  return (
    <svg viewBox="0 0 100 140" className="block h-full w-full" aria-hidden data-back>
      <defs>
        <pattern id={`${uid}-deco`} width="9" height="9" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
          <rect width="9" height="9" fill={b.bg1} opacity="0.85" />
          <path d="M0 4.5 H9 M4.5 0 V9" stroke={b.line} strokeOpacity="0.32" strokeWidth="0.7" />
          <circle cx="4.5" cy="4.5" r="0.9" fill={b.line} fillOpacity="0.45" />
        </pattern>
        <radialGradient id={`${uid}-glow`} cx="50%" cy="45%" r="62%">
          <stop offset="0" stopColor={b.bg1} />
          <stop offset="1" stopColor={b.bg2} />
        </radialGradient>
      </defs>
      <rect x="0.6" y="0.6" width="98.8" height="138.8" rx="7.5" fill={`url(#${uid}-glow)`} stroke={b.line} strokeOpacity="0.75" strokeWidth="1.2" />
      <rect x="6.5" y="6.5" width="87" height="127" rx="4.5" fill={`url(#${uid}-deco)`} stroke={b.line} strokeOpacity="0.8" strokeWidth="0.9" />
      <rect x="10" y="10" width="80" height="120" rx="3" fill="none" stroke={b.line} strokeOpacity="0.35" strokeWidth="0.5" />
      <circle cx="50" cy="70" r="19" fill={b.bg2} stroke={b.line} strokeWidth="1.2" />
      <circle cx="50" cy="70" r="15.5" fill="none" stroke={b.line} strokeOpacity="0.45" strokeWidth="0.6" />
      {b.motif === 'a' && <path d="M50 57.5 L59.6 81.5 H55.2 L53 75.8 H47 L44.8 81.5 H40.4 Z M48.3 72.4 H51.7 L50 67.6 Z" fill={b.accent} />}
      {b.motif === 'diamond' && <path d="M50 56 L61 70 L50 84 L39 70 Z M50 61 L56 70 L50 79 L44 70 Z" fill={b.accent} fillRule="evenodd" />}
      {b.motif === 'star' && <path d="M50 55 L53.8 65.6 L65 66 L56.2 72.8 L59.4 83.6 L50 77.2 L40.6 83.6 L43.8 72.8 L35 66 L46.2 65.6 Z" fill={b.accent} />}
      {b.motif === 'dragon' && (
        <g fill="none" stroke={b.accent} strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M38 78 C 40 64 52 60 58 63 C 64 66 62 74 56 74 C 51 74 50 68 54 67" />
          <path d="M58 63 L 62 57 L 60 64 M 58 63 L 64 61" />
          <path d="M40 76 C 44 80 50 81 55 79" />
        </g>
      )}
    </svg>
  );
});
