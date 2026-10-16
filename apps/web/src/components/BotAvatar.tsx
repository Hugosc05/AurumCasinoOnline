import { memo, useId } from 'react';

/** Descripción del avatar que envía el servidor (catálogo de bots). */
export interface AvatarSpec {
  bg: [string, string];
  skin: string;
  hair: { style: 'short' | 'long' | 'bun' | 'curly' | 'shaved' | 'wavy' | 'bob'; color: string };
  outfit: string;
  accessory: 'none' | 'glasses' | 'shades' | 'earring' | 'cap' | 'headphones' | 'visor';
  pattern: 'none' | 'dots' | 'stripes' | 'rays';
}

const shade = (hex: string, f: number): string => {
  const n = parseInt(hex.slice(1), 16);
  const ch = (v: number) => Math.max(0, Math.min(255, Math.round(f < 0 ? v * (1 + f) : v + (255 - v) * f)));
  return `#${[(n >> 16) & 255, (n >> 8) & 255, n & 255].map((v) => ch(v).toString(16).padStart(2, '0')).join('')}`;
};

/** Pelo detrás de la cabeza (melenas). */
function HairBack({ style, color }: AvatarSpec['hair']) {
  if (style === 'long') return <path d="M28 44 C 26 70 30 86 36 92 L 64 92 C 70 86 74 70 72 44 Z" fill={shade(color, -0.15)} />;
  if (style === 'wavy') return <path d="M27 46 C 22 62 30 70 26 84 C 34 90 42 86 50 88 C 58 86 66 90 74 84 C 70 70 78 62 73 46 Z" fill={shade(color, -0.15)} />;
  if (style === 'bob') return <path d="M27 42 C 25 58 28 70 34 74 L 66 74 C 72 70 75 58 73 42 Z" fill={shade(color, -0.15)} />;
  return null;
}

/** Pelo por delante (flequillos, peinados). */
function HairFront({ style, color }: AvatarSpec['hair']) {
  const hi = shade(color, 0.25);
  switch (style) {
    case 'short':
      return (
        <g>
          <path d="M31 42 C 30 26 42 19 52 20 C 63 21 71 28 69 42 C 64 34 56 31 47 32 C 40 33 34 37 31 42 Z" fill={color} />
          <path d="M44 23 C 52 21 60 24 64 30" stroke={hi} strokeWidth="1.6" fill="none" strokeLinecap="round" opacity="0.6" />
        </g>
      );
    case 'shaved':
      return <path d="M32 38 C 33 26 42 21 50 21 C 59 21 67 26 68 38 C 62 32 56 30 50 30 C 44 30 37 32 32 38 Z" fill={color} opacity="0.55" />;
    case 'curly':
      return (
        <g fill={color}>
          {[[34, 34], [40, 26], [48, 22], [57, 23], [64, 29], [67, 37], [31, 41], [69, 43]].map(([x, y], i) => (
            <circle key={i} cx={x} cy={y} r={7.2} />
          ))}
          <circle cx="45" cy="25" r="2" fill={hi} opacity="0.5" />
        </g>
      );
    case 'bun':
      return (
        <g>
          <circle cx="50" cy="15" r="8.5" fill={color} />
          <path d="M31 43 C 30 27 41 20 50 20 C 60 20 70 27 69 43 C 62 33 55 30 50 30 C 44 30 37 33 31 43 Z" fill={color} />
          <path d="M45 13 q5 -3 10 0" stroke={hi} strokeWidth="1.4" fill="none" opacity="0.6" />
        </g>
      );
    case 'bob':
      return <path d="M29 50 C 26 28 39 19 50 19 C 62 19 74 28 71 50 C 68 38 62 30 50 30 C 40 30 33 36 29 50 Z" fill={color} />;
    case 'long':
    case 'wavy':
      return (
        <g>
          <path d="M29 52 C 27 28 39 19 50 19 C 61 19 73 28 71 52 C 67 40 62 33 54 31 C 46 33 36 38 29 52 Z" fill={color} />
          <path d="M40 24 C 47 21 55 21 61 25" stroke={hi} strokeWidth="1.6" fill="none" strokeLinecap="round" opacity="0.55" />
        </g>
      );
  }
}

function Accessory({ kind, outfit }: { kind: AvatarSpec['accessory']; outfit: string }) {
  switch (kind) {
    case 'glasses':
      return (
        <g fill="none" stroke="#1d1a17" strokeWidth="1.6">
          <rect x="35.5" y="43" width="11" height="8" rx="3" fill="#ffffff" fillOpacity="0.12" />
          <rect x="53.5" y="43" width="11" height="8" rx="3" fill="#ffffff" fillOpacity="0.12" />
          <path d="M46.5 46 h7" />
        </g>
      );
    case 'shades':
      return (
        <g>
          <path d="M34 43 h32 v3 c0 5 -4 7 -8 7 c-4 0 -6 -3 -7 -6 h-2 c-1 3 -3 6 -7 6 c-4 0 -8 -2 -8 -7 z" fill="#111318" />
          <path d="M37 45 l5 0" stroke="#7ea6ff" strokeWidth="1.2" opacity="0.7" />
        </g>
      );
    case 'earring':
      return <circle cx="31" cy="55" r="2.2" fill="#e8c770" stroke="#a8862e" strokeWidth="0.6" />;
    case 'cap':
      return (
        <g>
          <path d="M30 36 C 31 22 41 17 50 17 C 60 17 69 22 70 36 Z" fill={outfit} />
          <path d="M50 36 C 62 35 74 37 80 40 C 72 42 60 41 50 39 Z" fill={shade(outfit, -0.3)} />
          <circle cx="50" cy="18" r="1.8" fill={shade(outfit, 0.3)} />
        </g>
      );
    case 'headphones':
      return (
        <g>
          <path d="M29 46 C 27 24 73 24 71 46" fill="none" stroke="#24262e" strokeWidth="3.4" />
          <rect x="25" y="42" width="7" height="13" rx="3" fill="#2d3038" />
          <rect x="68" y="42" width="7" height="13" rx="3" fill="#2d3038" />
          <rect x="26.5" y="45" width="2" height="7" rx="1" fill={outfit} />
        </g>
      );
    case 'visor':
      return <path d="M31 37 C 40 33 60 33 69 37 L 72 41 C 60 38 40 38 28 41 Z" fill={outfit} opacity="0.95" />;
    default:
      return null;
  }
}

function Pattern({ kind, color, id }: { kind: AvatarSpec['pattern']; color: string; id: string }) {
  if (kind === 'none') return null;
  return (
    <g clipPath={`url(#${id}-clip)`} opacity="0.16" fill={color} stroke={color}>
      {kind === 'dots' && Array.from({ length: 36 }, (_, i) => <circle key={i} cx={(i % 6) * 18 + 6} cy={Math.floor(i / 6) * 18 + 6} r="2.2" stroke="none" />)}
      {kind === 'stripes' && Array.from({ length: 10 }, (_, i) => <path key={i} d={`M${i * 14 - 40} 0 l60 100`} strokeWidth="5" fill="none" />)}
      {kind === 'rays' && Array.from({ length: 12 }, (_, i) => <path key={i} d="M50 110 L 46 -10 L 54 -10 Z" transform={`rotate(${i * 30 - 165} 50 110)`} stroke="none" />)}
    </g>
  );
}

/**
 * Avatar original de un bot, dibujado en SVG a partir de su descripción.
 * No representa a ninguna persona real.
 */
export const BotAvatar = memo(function BotAvatar({ spec, size = 64, title }: { spec: AvatarSpec; size?: number; title?: string }) {
  const id = `av${useId().replace(/:/g, '')}`;
  const skinHi = shade(spec.skin, 0.18);
  const skinLo = shade(spec.skin, -0.18);
  return (
    <svg viewBox="0 0 100 100" width={size} height={size} role="img" aria-label={title ?? 'Avatar de bot'}>
      <defs>
        <clipPath id={`${id}-clip`}><circle cx="50" cy="50" r="50" /></clipPath>
        <radialGradient id={`${id}-bg`} cx="35%" cy="30%" r="80%">
          <stop offset="0" stopColor={spec.bg[0]} />
          <stop offset="1" stopColor={spec.bg[1]} />
        </radialGradient>
        <radialGradient id={`${id}-skin`} cx="40%" cy="35%" r="70%">
          <stop offset="0" stopColor={skinHi} />
          <stop offset="1" stopColor={skinLo} />
        </radialGradient>
        <linearGradient id={`${id}-cloth`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor={shade(spec.outfit, 0.12)} />
          <stop offset="1" stopColor={shade(spec.outfit, -0.3)} />
        </linearGradient>
      </defs>
      <circle cx="50" cy="50" r="50" fill={`url(#${id}-bg)`} />
      <Pattern kind={spec.pattern} color="#ffffff" id={id} />
      <g clipPath={`url(#${id}-clip)`}>
        <HairBack {...spec.hair} />
        {/* Hombros y ropa */}
        <path d="M14 104 C 16 80 30 72 50 72 C 70 72 84 80 86 104 Z" fill={`url(#${id}-cloth)`} />
        <path d="M41 72 L 50 84 L 59 72" fill={skinLo} opacity="0.9" />
        <path d="M40 72 L 50 86 L 60 72" fill="none" stroke={shade(spec.outfit, 0.35)} strokeWidth="1.4" />
        {/* Cuello */}
        <path d="M43 60 h14 v14 c-4 3 -10 3 -14 0 z" fill={skinLo} />
        {/* Cabeza */}
        <ellipse cx="31.5" cy="49" rx="3.6" ry="5" fill={skinLo} />
        <ellipse cx="68.5" cy="49" rx="3.6" ry="5" fill={skinLo} />
        <ellipse cx="50" cy="45" rx="19" ry="22" fill={`url(#${id}-skin)`} />
        <HairFront {...spec.hair} />
        {/* Rasgos sencillos y amables */}
        <path d="M38 41.5 q3.5 -2 7 0 M55 41.5 q3.5 -2 7 0" stroke={shade(spec.hair.color, -0.1)} strokeWidth="1.5" fill="none" strokeLinecap="round" />
        <ellipse cx="41.5" cy="47" rx="2" ry="2.4" fill="#231a14" />
        <ellipse cx="58.5" cy="47" rx="2" ry="2.4" fill="#231a14" />
        <circle cx="42.2" cy="46.2" r="0.7" fill="#fff" />
        <circle cx="59.2" cy="46.2" r="0.7" fill="#fff" />
        <path d="M50 49 q-2 5 0 6.5" stroke={skinLo} strokeWidth="1.4" fill="none" strokeLinecap="round" />
        <path d="M44 59 q6 4 12 0" stroke="#7d3c30" strokeWidth="1.6" fill="none" strokeLinecap="round" />
        <circle cx="38" cy="55" r="3" fill="#e0756a" opacity="0.18" />
        <circle cx="62" cy="55" r="3" fill="#e0756a" opacity="0.18" />
        <Accessory kind={spec.accessory} outfit={spec.outfit} />
      </g>
      <circle cx="50" cy="50" r="49" fill="none" stroke="#ffffff" strokeOpacity="0.14" strokeWidth="2" />
    </svg>
  );
});
