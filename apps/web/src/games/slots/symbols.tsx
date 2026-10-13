import type { SlotSymbol } from '@aurum/engine';
import { memo, type ReactElement } from 'react';

/** Símbolos originales dibujados en SVG para la máquina Aurum Royale. */

function Letter({ ch, from, to }: { ch: string; from: string; to: string }) {
  const id = `lg-${ch}`;
  return (
    <>
      <defs>
        <linearGradient id={id} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor={from} />
          <stop offset="1" stopColor={to} />
        </linearGradient>
      </defs>
      <text x="50" y="72" textAnchor="middle" fontSize="64" fontWeight="700" fontFamily="'Bodoni Moda Variable', Georgia, serif" fill={`url(#${id})`} stroke="#0b0f1a" strokeWidth="2.5" paintOrder="stroke">
        {ch}
      </text>
    </>
  );
}

const SYMBOLS: Record<SlotSymbol, () => ReactElement> = {
  jack: () => <Letter ch="J" from="#9fe3d6" to="#2a8f7d" />,
  queen: () => <Letter ch="Q" from="#e2b8ff" to="#7b3fb3" />,
  king: () => <Letter ch="K" from="#a9c9ff" to="#2f5fb3" />,
  ace: () => <Letter ch="A" from="#ffb3b9" to="#b02a3c" />,
  clover: () => (
    <g>
      <defs>
        <radialGradient id="clv" cx="40%" cy="35%" r="70%">
          <stop offset="0" stopColor="#9be8a6" />
          <stop offset="1" stopColor="#16733c" />
        </radialGradient>
      </defs>
      {[0, 90, 180, 270].map((a) => (
        <path key={a} d="M50 50 C 34 40 30 18 44 16 C 50 15 52 22 50 26 C 48 22 50 15 56 16 C 70 18 66 40 50 50 Z" fill="url(#clv)" stroke="#0b3d1f" strokeWidth="2" transform={`rotate(${a} 50 50)`} />
      ))}
      <path d="M50 52 Q 56 72 66 86" stroke="#0f5a2c" strokeWidth="5" fill="none" strokeLinecap="round" />
    </g>
  ),
  bell: () => (
    <g>
      <defs>
        <linearGradient id="bell" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#fff2c4" />
          <stop offset="0.5" stopColor="#e2b44d" />
          <stop offset="1" stopColor="#8a5f18" />
        </linearGradient>
      </defs>
      <path d="M50 14 C 30 14 26 34 26 50 C 26 62 20 68 14 74 H 86 C 80 68 74 62 74 50 C 74 34 70 14 50 14 Z" fill="url(#bell)" stroke="#5a3d0d" strokeWidth="2.5" />
      <circle cx="50" cy="12" r="5" fill="#e2b44d" stroke="#5a3d0d" strokeWidth="2" />
      <circle cx="50" cy="82" r="8" fill="#c9962f" stroke="#5a3d0d" strokeWidth="2" />
      <path d="M36 30 Q 34 44 36 56" stroke="#fff6dc" strokeWidth="4" strokeLinecap="round" fill="none" opacity="0.7" />
    </g>
  ),
  diamond: () => (
    <g>
      <path d="M22 36 L36 18 H64 L78 36 L50 86 Z" fill="#59d2f0" stroke="#0b3f55" strokeWidth="2.5" />
      <path d="M22 36 H78 M36 18 L44 36 L50 86 M64 18 L56 36 L50 86 M44 36 L50 18 L56 36" stroke="#0b3f55" strokeWidth="1.6" fill="none" />
      <path d="M36 18 L44 36 H22 Z" fill="#b8f1ff" />
      <path d="M56 36 L64 18 L78 36 Z" fill="#2fa6cc" />
      <path d="M44 36 L50 86 L22 36 Z" fill="#3cbde0" opacity="0.8" />
    </g>
  ),
  crown: () => (
    <g>
      <defs>
        <linearGradient id="crown" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#fff0bd" />
          <stop offset="0.55" stopColor="#d9a73f" />
          <stop offset="1" stopColor="#8a5c12" />
        </linearGradient>
      </defs>
      <path d="M16 34 L32 54 L50 22 L68 54 L84 34 L78 76 H22 Z" fill="url(#crown)" stroke="#4d3207" strokeWidth="2.5" strokeLinejoin="round" />
      <rect x="20" y="74" width="60" height="10" rx="3" fill="#b8862a" stroke="#4d3207" strokeWidth="2" />
      <circle cx="50" cy="60" r="6" fill="#c22b3d" stroke="#4d3207" strokeWidth="1.5" />
      <circle cx="33" cy="66" r="4" fill="#2e7fd1" stroke="#4d3207" strokeWidth="1.2" />
      <circle cx="67" cy="66" r="4" fill="#2e7fd1" stroke="#4d3207" strokeWidth="1.2" />
      {[16, 50, 84].map((x, i) => (
        <circle key={x} cx={x} cy={i === 1 ? 20 : 32} r="5" fill="#fff0bd" stroke="#4d3207" strokeWidth="1.5" />
      ))}
    </g>
  ),
  seven: () => (
    <g>
      <defs>
        <linearGradient id="seven" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#ff7a86" />
          <stop offset="1" stopColor="#8f1222" />
        </linearGradient>
      </defs>
      <path d="M22 16 H80 V30 C 62 48 52 64 48 88 H30 C 34 64 46 46 60 32 H22 Z" fill="url(#seven)" stroke="#f2d08a" strokeWidth="4" strokeLinejoin="round" />
      <path d="M22 16 H80 V30 C 62 48 52 64 48 88 H30 C 34 64 46 46 60 32 H22 Z" fill="none" stroke="#3b0710" strokeWidth="1.5" strokeLinejoin="round" />
    </g>
  ),
  wild: () => (
    <g>
      <defs>
        <radialGradient id="wild" cx="40%" cy="35%" r="70%">
          <stop offset="0" stopColor="#fff4cf" />
          <stop offset="0.6" stopColor="#d4a548" />
          <stop offset="1" stopColor="#6e4a12" />
        </radialGradient>
      </defs>
      {Array.from({ length: 16 }, (_, i) => (
        <path key={i} d="M50 50 L47 6 L53 6 Z" fill="#e8c56f" opacity="0.55" transform={`rotate(${i * 22.5} 50 50)`} />
      ))}
      <circle cx="50" cy="50" r="31" fill="url(#wild)" stroke="#3e2a08" strokeWidth="2.5" />
      <circle cx="50" cy="50" r="25" fill="none" stroke="#3e2a08" strokeWidth="1" strokeDasharray="2 3" />
      <text x="50" y="59" textAnchor="middle" fontSize="26" fontWeight="800" fontFamily="'Manrope Variable', sans-serif" fill="#2a1c05" letterSpacing="0.5">
        WILD
      </text>
    </g>
  ),
  scatter: () => (
    <g>
      <defs>
        <radialGradient id="scat" cx="50%" cy="45%" r="60%">
          <stop offset="0" stopColor="#2a3f78" />
          <stop offset="1" stopColor="#0b1328" />
        </radialGradient>
        <linearGradient id="star" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#fff6d6" />
          <stop offset="1" stopColor="#d4a548" />
        </linearGradient>
      </defs>
      <circle cx="50" cy="50" r="40" fill="url(#scat)" stroke="#d4a548" strokeWidth="3" />
      <path d="M50 18 L58.8 39.6 L82 41.2 L64 56.2 L69.8 79 L50 66.6 L30.2 79 L36 56.2 L18 41.2 L41.2 39.6 Z" fill="url(#star)" stroke="#6e4a12" strokeWidth="2" strokeLinejoin="round" />
      <circle cx="74" cy="24" r="2.5" fill="#fff6d6" />
      <circle cx="24" cy="70" r="2" fill="#fff6d6" />
    </g>
  ),
};

export const SlotSymbolArt = memo(function SlotSymbolArt({ symbol, size = 100 }: { symbol: SlotSymbol; size?: number }) {
  const Art = SYMBOLS[symbol];
  return (
    <svg viewBox="0 0 100 100" width={size} height={size} aria-hidden>
      <Art />
    </svg>
  );
});
