import { memo, type ReactElement } from 'react';
import { VEGAS_SYMBOLS } from './symbolsVegas';
import { CLASSIC_SYMBOLS } from './symbolsClassic';

/** Símbolos originales dibujados en SVG (Aurum Royale y Tesoro del Arrecife). */

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

const SYMBOLS: Record<string, () => ReactElement> = {
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


/* ------------------------------ Tesoro del Arrecife ------------------------------ */
const REEF: Record<string, () => ReactElement> = {
  shell: () => (
    <g>
      <defs>
        <linearGradient id="rf-shell" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="#ffd9c7" /><stop offset="1" stopColor="#e2876b" /></linearGradient>
      </defs>
      <path d="M50 16 C 76 16 88 40 86 62 L 58 84 L 42 84 L 14 62 C 12 40 24 16 50 16 Z" fill="url(#rf-shell)" stroke="#7a3624" strokeWidth="2.5" strokeLinejoin="round" />
      {[-30, -15, 0, 15, 30].map((a) => <path key={a} d="M50 82 L 50 22" stroke="#b8573d" strokeWidth="2" transform={`rotate(${a} 50 82)`} />)}
      <path d="M40 84 h20 v6 h-20 z" fill="#c96c50" stroke="#7a3624" strokeWidth="2" />
    </g>
  ),
  starfish: () => (
    <g>
      <defs>
        <radialGradient id="rf-star" cx="45%" cy="40%" r="65%"><stop offset="0" stopColor="#ffe08a" /><stop offset="1" stopColor="#e8862e" /></radialGradient>
      </defs>
      <path d="M50 12 C 55 30 58 34 86 38 C 66 50 64 56 72 84 C 56 70 44 70 28 84 C 36 56 34 50 14 38 C 42 34 45 30 50 12 Z" fill="url(#rf-star)" stroke="#8a4410" strokeWidth="2.5" strokeLinejoin="round" />
      {[[50, 30], [66, 44], [60, 64], [40, 64], [34, 44], [50, 48]].map(([x, y], i) => <circle key={i} cx={x} cy={y} r="2.6" fill="#fff3c4" />)}
    </g>
  ),
  crab: () => (
    <g>
      <defs>
        <radialGradient id="rf-crab" cx="45%" cy="35%" r="70%"><stop offset="0" stopColor="#ff8f7a" /><stop offset="1" stopColor="#b3261e" /></radialGradient>
      </defs>
      {[-1, 1].map((d) => (
        <g key={d}>
          <path d={`M${50 + d * 22} 56 l${d * 14} 10 M${50 + d * 22} 62 l${d * 12} 14 M${50 + d * 18} 66 l${d * 6} 16`} stroke="#8f1d17" strokeWidth="4" strokeLinecap="round" />
          <path d={`M${50 + d * 20} 46 C ${50 + d * 30} 34 ${50 + d * 34} 30 ${50 + d * 34} 22`} stroke="#b3261e" strokeWidth="6" fill="none" strokeLinecap="round" />
          <path d={`M${50 + d * 34} 22 c ${d * -6} -10 ${d * 8} -14 ${d * 10} -4 c ${d * -4} 0 ${d * -6} 2 ${d * -6} 6 z`} fill="url(#rf-crab)" stroke="#6b1410" strokeWidth="2" />
        </g>
      ))}
      <ellipse cx="50" cy="56" rx="26" ry="18" fill="url(#rf-crab)" stroke="#6b1410" strokeWidth="2.5" />
      <path d="M43 40 v-8 M57 40 v-8" stroke="#6b1410" strokeWidth="2.5" />
      <circle cx="43" cy="30" r="4" fill="#fff" stroke="#6b1410" strokeWidth="1.5" /><circle cx="43.6" cy="30" r="1.8" fill="#111" />
      <circle cx="57" cy="30" r="4" fill="#fff" stroke="#6b1410" strokeWidth="1.5" /><circle cx="57.6" cy="30" r="1.8" fill="#111" />
      <path d="M44 60 q6 5 12 0" stroke="#6b1410" strokeWidth="2" fill="none" strokeLinecap="round" />
    </g>
  ),
  seahorse: () => (
    <g>
      <defs>
        <linearGradient id="rf-hrs" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stopColor="#b9f3ff" /><stop offset="1" stopColor="#2b8fb3" /></linearGradient>
      </defs>
      <path d="M58 14 C 72 14 76 26 70 32 L 82 34 L 70 40 C 66 50 70 58 66 68 C 62 80 46 88 40 78 C 36 70 46 66 50 70 C 54 64 46 58 48 48 C 50 38 44 32 46 24 C 48 18 52 14 58 14 Z" fill="url(#rf-hrs)" stroke="#155a73" strokeWidth="2.5" strokeLinejoin="round" />
      <path d="M46 30 l-10 -4 l6 8 l-8 2 l9 4" fill="#7fd3ea" stroke="#155a73" strokeWidth="1.8" strokeLinejoin="round" />
      <circle cx="62" cy="24" r="3" fill="#0b2a36" /><circle cx="63" cy="23" r="1" fill="#fff" />
      {[44, 52, 60].map((y) => <path key={y} d={`M${y < 50 ? 56 : 58} ${y} q 6 2 10 0`} stroke="#155a73" strokeWidth="1.5" fill="none" />)}
    </g>
  ),
  turtle: () => (
    <g>
      <defs>
        <radialGradient id="rf-tur" cx="45%" cy="40%" r="65%"><stop offset="0" stopColor="#b8e37c" /><stop offset="1" stopColor="#3f7a25" /></radialGradient>
      </defs>
      <ellipse cx="50" cy="22" rx="9" ry="8" fill="#8fc46a" stroke="#2c5419" strokeWidth="2" />
      {[[-1, 1], [1, 1], [-1, -1], [1, -1]].map(([dx, dy], i) => <ellipse key={i} cx={50 + dx! * 26} cy={50 + dy! * 18} rx="11" ry="6" fill="#8fc46a" stroke="#2c5419" strokeWidth="2" transform={`rotate(${dx! * dy! * 30} ${50 + dx! * 26} ${50 + dy! * 18})`} />)}
      <ellipse cx="50" cy="52" rx="26" ry="28" fill="url(#rf-tur)" stroke="#2c5419" strokeWidth="2.5" />
      <path d="M50 30 L 62 42 L 58 60 L 42 60 L 38 42 Z" fill="none" stroke="#2c5419" strokeWidth="2" />
      <path d="M50 30 V 24 M62 42 L 74 38 M58 60 L 66 72 M42 60 L 34 72 M38 42 L 26 38 M50 60 V 80" stroke="#2c5419" strokeWidth="2" />
    </g>
  ),
  dolphin: () => (
    <g>
      <defs>
        <linearGradient id="rf-dol" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="#9fc3ff" /><stop offset="1" stopColor="#2f5fb3" /></linearGradient>
      </defs>
      <path d="M16 62 C 22 36 50 22 74 30 C 80 22 86 22 90 24 C 86 28 84 32 84 36 C 88 44 86 54 78 58 L 70 56 C 64 64 54 66 46 64 L 40 76 L 34 64 C 28 64 22 64 16 62 Z" fill="url(#rf-dol)" stroke="#173a73" strokeWidth="2.5" strokeLinejoin="round" />
      <path d="M50 30 C 54 22 60 20 64 22 C 60 26 58 30 58 32" fill="#5c86d6" stroke="#173a73" strokeWidth="2" />
      <path d="M26 58 C 40 60 60 58 76 52" stroke="#e6efff" strokeWidth="2.5" fill="none" strokeLinecap="round" opacity="0.8" />
      <circle cx="72" cy="40" r="2.6" fill="#0b1a33" />
    </g>
  ),
  pearl: () => (
    <g>
      <defs>
        <radialGradient id="rf-prl" cx="38%" cy="32%" r="70%"><stop offset="0" stopColor="#ffffff" /><stop offset="0.55" stopColor="#f1e6f7" /><stop offset="1" stopColor="#a993c2" /></radialGradient>
        <linearGradient id="rf-oys" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="#7a6c8f" /><stop offset="1" stopColor="#3b2f4f" /></linearGradient>
      </defs>
      <path d="M12 66 C 20 86 80 86 88 66 C 70 74 30 74 12 66 Z" fill="url(#rf-oys)" stroke="#231a33" strokeWidth="2.5" />
      <path d="M14 60 C 22 30 78 30 86 60 C 70 52 30 52 14 60 Z" fill="url(#rf-oys)" stroke="#231a33" strokeWidth="2.5" />
      <circle cx="50" cy="62" r="17" fill="url(#rf-prl)" stroke="#6e5a8a" strokeWidth="1.5" />
      <circle cx="44" cy="56" r="4" fill="#fff" opacity="0.9" />
    </g>
  ),
  wave: () => (
    <g>
      <defs>
        <linearGradient id="rf-wave" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="#7ff0e4" /><stop offset="1" stopColor="#0b6f8f" /></linearGradient>
      </defs>
      <circle cx="50" cy="50" r="42" fill="#06283a" stroke="#f4d27a" strokeWidth="3" />
      <path d="M14 64 C 24 30 58 22 72 40 C 62 34 50 40 54 50 C 58 58 72 56 76 48 C 84 62 74 82 50 84 C 32 86 18 78 14 64 Z" fill="url(#rf-wave)" stroke="#e8fbff" strokeWidth="2" strokeLinejoin="round" />
      <text x="50" y="32" textAnchor="middle" fontSize="15" fontWeight="800" fontFamily="system-ui, sans-serif" fill="#f4d27a" stroke="#06283a" strokeWidth="3" paintOrder="stroke">×2</text>
    </g>
  ),
  chest: () => (
    <g>
      <defs>
        <linearGradient id="rf-wood" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="#a0612e" /><stop offset="1" stopColor="#5a3214" /></linearGradient>
        <linearGradient id="rf-gold" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="#fff0b8" /><stop offset="1" stopColor="#c8962e" /></linearGradient>
      </defs>
      <path d="M16 46 C 16 24 84 24 84 46 Z" fill="url(#rf-wood)" stroke="#2e1a08" strokeWidth="2.5" />
      <rect x="16" y="46" width="68" height="36" rx="3" fill="url(#rf-wood)" stroke="#2e1a08" strokeWidth="2.5" />
      <path d="M16 46 h68" stroke="url(#rf-gold)" strokeWidth="5" />
      {[22, 78].map((x) => <path key={x} d={`M${x} 30 V 82`} stroke="url(#rf-gold)" strokeWidth="4" />)}
      <rect x="42" y="42" width="16" height="18" rx="3" fill="url(#rf-gold)" stroke="#6e4a12" strokeWidth="1.8" />
      <circle cx="50" cy="50" r="2.5" fill="#2e1a08" /><path d="M50 52 v4" stroke="#2e1a08" strokeWidth="2" />
      <circle cx="30" cy="20" r="2.4" fill="#fff6d6" /><circle cx="72" cy="16" r="1.8" fill="#fff6d6" />
    </g>
  ),
};
Object.assign(SYMBOLS, REEF, VEGAS_SYMBOLS, CLASSIC_SYMBOLS);

/**
 * Relieve de sala: la silueta del símbolo se usa como mapa de alturas para una
 * luz especular y una luz difusa (bisel, brillo y sombras propias) y una
 * sombra proyectada. En los rodillos 3D se calcula una sola vez al crear la
 * imagen del símbolo, así que no cuesta nada al girar.
 */
function Relief({ id }: { id: string }) {
  return (
    <filter id={id} x="-20%" y="-20%" width="140%" height="140%" colorInterpolationFilters="sRGB">
      <feGaussianBlur in="SourceAlpha" stdDeviation="2.4" result="bump" />
      <feDiffuseLighting in="bump" surfaceScale="3" diffuseConstant="1.3" lightingColor="#ffffff" result="diffuse">
        <feDistantLight azimuth="235" elevation="62" />
      </feDiffuseLighting>
      <feComposite in="diffuse" in2="SourceAlpha" operator="in" result="diffuseIn" />
      <feColorMatrix in="SourceGraphic" type="saturate" values="1.2" result="vivid" />
      <feBlend in="vivid" in2="diffuseIn" mode="multiply" result="shaded" />
      <feSpecularLighting in="bump" surfaceScale="4" specularConstant="0.95" specularExponent="24" lightingColor="#ffffff" result="spec">
        <fePointLight x="20" y="-10" z="90" />
      </feSpecularLighting>
      <feComposite in="spec" in2="SourceAlpha" operator="in" result="specIn" />
      <feComposite in="shaded" in2="specIn" operator="arithmetic" k1="0" k2="1.12" k3="0.6" k4="0" result="lit" />
      <feGaussianBlur in="SourceAlpha" stdDeviation="2.2" result="shadowBlur" />
      <feOffset in="shadowBlur" dx="1.5" dy="3.5" result="shadowOff" />
      <feFlood floodColor="#000000" floodOpacity="0.42" />
      <feComposite in2="shadowOff" operator="in" result="shadow" />
      <feMerge>
        <feMergeNode in="shadow" />
        <feMergeNode in="lit" />
      </feMerge>
    </filter>
  );
}

export const SlotSymbolArt = memo(function SlotSymbolArt({ symbol, size = 100, flat = false }: { symbol: string; size?: number; flat?: boolean }) {
  const Art = SYMBOLS[symbol] ?? SYMBOLS.jack!;
  const fid = `relief-${symbol}`;
  return (
    <svg viewBox="0 0 100 100" width={size} height={size} aria-hidden>
      {flat ? (
        <Art />
      ) : (
        <>
          <defs><Relief id={fid} /></defs>
          <g filter={`url(#${fid})`}><Art /></g>
        </>
      )}
    </svg>
  );
});
