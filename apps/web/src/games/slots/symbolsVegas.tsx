import type { ReactElement } from 'react';

/**
 * Símbolos originales de Vegas Nights (SVG, viewBox 100×100). Estética de
 * sala de los años 50: dorados, rojo lacado y neón. La showgirl es una
 * ilustración pin-up elegante (retrato con tocado de plumas), sin desnudos.
 */

const gold = (id: string) => (
  <linearGradient id={id} x1="0" y1="0" x2="0" y2="1">
    <stop offset="0" stopColor="#fff3c8" />
    <stop offset="0.5" stopColor="#e2b44d" />
    <stop offset="1" stopColor="#8a5f18" />
  </linearGradient>
);

export const VEGAS_SYMBOLS: Record<string, () => ReactElement> = {
  chip: () => (
    <g>
      <defs>
        <radialGradient id="vg-chip" cx="40%" cy="35%" r="70%"><stop offset="0" stopColor="#ff6b6b" /><stop offset="1" stopColor="#8e1020" /></radialGradient>
      </defs>
      <circle cx="50" cy="52" r="38" fill="#3a060c" />
      <circle cx="50" cy="48" r="38" fill="url(#vg-chip)" stroke="#2a0408" strokeWidth="2.5" />
      {Array.from({ length: 8 }, (_, i) => (
        <rect key={i} x="45" y="11" width="10" height="13" rx="2" fill="#fff6e6" transform={`rotate(${i * 45} 50 48)`} />
      ))}
      <circle cx="50" cy="48" r="23" fill="none" stroke="#fff6e6" strokeWidth="2" strokeDasharray="4 3" />
      <circle cx="50" cy="48" r="18" fill="#a5131f" stroke="#ffd98a" strokeWidth="2" />
      <text x="50" y="55" textAnchor="middle" fontSize="17" fontWeight="800" fontFamily="system-ui, sans-serif" fill="#ffe6a6">$</text>
    </g>
  ),
  dice: () => (
    <g>
      <defs>
        <linearGradient id="vg-die" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stopColor="#fdfdfd" /><stop offset="1" stopColor="#c9ccd6" /></linearGradient>
      </defs>
      <g transform="rotate(-12 38 58)">
        <rect x="14" y="36" width="44" height="44" rx="9" fill="url(#vg-die)" stroke="#2b2f3a" strokeWidth="2.5" />
        {[[26, 48], [46, 68], [36, 58]].map(([x, y]) => <circle key={`${x}${y}`} cx={x} cy={y} r="4.2" fill="#b0101c" />)}
      </g>
      <g transform="rotate(14 66 40)">
        <rect x="44" y="18" width="40" height="40" rx="8" fill="url(#vg-die)" stroke="#2b2f3a" strokeWidth="2.5" />
        {[[54, 28], [74, 28], [54, 48], [74, 48], [64, 38]].map(([x, y]) => <circle key={`${x}${y}`} cx={x} cy={y} r="3.8" fill="#14161e" />)}
      </g>
    </g>
  ),
  cards: () => (
    <g>
      <g transform="rotate(-14 40 60)">
        <rect x="18" y="22" width="40" height="58" rx="5" fill="#fbf8ef" stroke="#1d2230" strokeWidth="2.2" />
        <text x="24" y="38" fontSize="14" fontWeight="800" fontFamily="Georgia, serif" fill="#14161e">A</text>
        <path d="M38 48 C 30 56 30 64 38 64 C 40 64 41 63 42 61 L 40 70 H 46 L 44 61 C 45 63 46 64 48 64 C 56 64 56 56 48 48 L 43 42 Z" fill="#14161e" transform="translate(-5 0)" />
      </g>
      <g transform="rotate(12 62 58)">
        <rect x="42" y="20" width="40" height="58" rx="5" fill="#fffdf6" stroke="#1d2230" strokeWidth="2.2" />
        <text x="48" y="36" fontSize="14" fontWeight="800" fontFamily="Georgia, serif" fill="#b0101c">A</text>
        <path d="M62 66 C 50 56 48 48 54 44 C 58 42 61 44 62 47 C 63 44 66 42 70 44 C 76 48 74 56 62 66 Z" fill="#c4121f" />
      </g>
    </g>
  ),
  whisky: () => (
    <g>
      <defs>
        <linearGradient id="vg-whisky" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="#ffcf6b" /><stop offset="1" stopColor="#a5520c" /></linearGradient>
        <linearGradient id="vg-glass" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stopColor="#ffffff" stopOpacity="0.55" /><stop offset="0.5" stopColor="#ffffff" stopOpacity="0.12" /><stop offset="1" stopColor="#ffffff" stopOpacity="0.45" /></linearGradient>
      </defs>
      <path d="M24 30 L 30 84 Q 30 88 34 88 H 66 Q 70 88 70 84 L 76 30 Z" fill="#dfe8f2" fillOpacity="0.25" stroke="#e9eef6" strokeWidth="2.5" />
      <path d="M27 52 L 30.6 84 Q 31 86 34 86 H 66 Q 69 86 69.4 84 L 73 52 Z" fill="url(#vg-whisky)" />
      <rect x="36" y="40" width="18" height="16" rx="3" fill="#eaf8ff" fillOpacity="0.85" stroke="#b9d9e8" strokeWidth="1.5" transform="rotate(-12 45 48)" />
      <rect x="50" y="46" width="15" height="13" rx="3" fill="#eaf8ff" fillOpacity="0.8" stroke="#b9d9e8" strokeWidth="1.5" transform="rotate(10 57 52)" />
      <path d="M24 30 L 30 84 Q 30 88 34 88 H 66 Q 70 88 70 84 L 76 30" fill="url(#vg-glass)" />
      <path d="M33 36 L 36 78" stroke="#ffffff" strokeOpacity="0.7" strokeWidth="3" strokeLinecap="round" />
    </g>
  ),
  cigar: () => (
    <g>
      <defs>
        <linearGradient id="vg-cigar" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="#a8693a" /><stop offset="0.5" stopColor="#6b3a17" /><stop offset="1" stopColor="#3b1e09" /></linearGradient>
        {gold('vg-band')}
      </defs>
      <path d="M30 42 C 38 26 44 20 46 14" stroke="#cfd5de" strokeOpacity="0.55" strokeWidth="3" fill="none" strokeLinecap="round" />
      <path d="M38 40 C 44 30 40 24 46 18" stroke="#cfd5de" strokeOpacity="0.35" strokeWidth="2.5" fill="none" strokeLinecap="round" />
      <g transform="rotate(-24 50 62)">
        <rect x="10" y="52" width="80" height="18" rx="9" fill="url(#vg-cigar)" stroke="#24110a" strokeWidth="2" />
        <rect x="10" y="52" width="10" height="18" rx="5" fill="#8f8f8f" />
        <circle cx="13" cy="61" r="3" fill="#ff7a2a" />
        <rect x="56" y="51" width="14" height="20" fill="url(#vg-band)" stroke="#6e4a12" strokeWidth="1.5" />
        <text x="63" y="65" textAnchor="middle" fontSize="7" fontWeight="800" fontFamily="Georgia, serif" fill="#7a1018">V</text>
      </g>
    </g>
  ),
  bills: () => (
    <g>
      <defs>
        <linearGradient id="vg-bill" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stopColor="#d7f2c8" /><stop offset="1" stopColor="#6fae66" /></linearGradient>
      </defs>
      {[0, 1, 2].map((i) => (
        <g key={i} transform={`translate(${i * 3 - 3} ${-i * 6 + 6}) rotate(${-8 + i * 6} 50 54)`}>
          <rect x="12" y="34" width="76" height="38" rx="4" fill="url(#vg-bill)" stroke="#23482a" strokeWidth="2" />
          <rect x="17" y="39" width="66" height="28" rx="3" fill="none" stroke="#23482a" strokeOpacity="0.55" strokeWidth="1.5" />
          <circle cx="50" cy="53" r="10" fill="#bfe3b3" stroke="#23482a" strokeWidth="1.5" />
          <text x="50" y="58" textAnchor="middle" fontSize="14" fontWeight="800" fontFamily="Georgia, serif" fill="#23482a">$</text>
          <text x="24" y="49" fontSize="8" fontWeight="800" fontFamily="Georgia, serif" fill="#23482a">100</text>
        </g>
      ))}
      <rect x="40" y="30" width="14" height="44" fill="#c4121f" stroke="#5e0a10" strokeWidth="1.5" transform="rotate(-2 47 52)" />
    </g>
  ),
  showgirl: () => (
    <g>
      <defs>
        <radialGradient id="vg-skin" cx="45%" cy="40%" r="60%"><stop offset="0" stopColor="#ffe0c8" /><stop offset="1" stopColor="#e8a988" /></radialGradient>
        <linearGradient id="vg-plume" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="#ffd6ec" /><stop offset="1" stopColor="#e0337f" /></linearGradient>
        <linearGradient id="vg-hair" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="#3a1406" /><stop offset="1" stopColor="#140502" /></linearGradient>
        {gold('vg-gem')}
        <clipPath id="vg-sg"><circle cx="50" cy="50" r="46" /></clipPath>
      </defs>
      <circle cx="50" cy="50" r="46" fill="#2a0a26" stroke="#f4d27a" strokeWidth="3" />
      <g clipPath="url(#vg-sg)">
        {/* Plumas del tocado */}
        {[-38, -20, 0, 20, 38].map((a) => (
          <path key={a} d="M50 34 C 40 20 42 2 50 -6 C 58 2 60 20 50 34 Z" fill="url(#vg-plume)" stroke="#a3195a" strokeWidth="1" transform={`rotate(${a} 50 34)`} />
        ))}
        {/* Pelo */}
        <path d="M30 54 C 26 32 40 24 50 24 C 62 24 74 32 70 56 C 66 48 64 42 60 40 C 54 46 40 46 36 40 C 34 44 32 48 30 54 Z" fill="url(#vg-hair)" />
        {/* Cuello y hombros con vestido de lentejuelas */}
        <path d="M44 62 H 56 V 72 H 44 Z" fill="url(#vg-skin)" />
        <path d="M14 100 C 16 80 30 72 44 70 H 56 C 70 72 84 80 86 100 Z" fill="#b0101c" />
        <path d="M14 100 C 16 80 30 72 44 70 H 56 C 70 72 84 80 86 100" fill="none" stroke="#ffd98a" strokeWidth="1.5" strokeDasharray="1.5 3" />
        <path d="M38 72 Q 50 82 62 72" fill="none" stroke="#fff6e6" strokeWidth="2.5" strokeDasharray="0.1 4.2" strokeLinecap="round" />
        {/* Cara */}
        <ellipse cx="50" cy="48" rx="14" ry="17" fill="url(#vg-skin)" />
        <path d="M40 44 Q 44 41 47 44" stroke="#2a0d05" strokeWidth="1.8" fill="none" strokeLinecap="round" />
        <path d="M53 44 Q 56 41 60 44" stroke="#2a0d05" strokeWidth="1.8" fill="none" strokeLinecap="round" />
        <path d="M41 42 L 39 40 M 59 42 L 61 40" stroke="#2a0d05" strokeWidth="1.2" />
        <circle cx="44" cy="52" r="2.4" fill="#ff8aa0" opacity="0.45" />
        <circle cx="57" cy="52" r="2.4" fill="#ff8aa0" opacity="0.45" />
        <path d="M45 57 Q 50 55 55 57 Q 50 61 45 57 Z" fill="#c4121f" />
        <circle cx="58" cy="54" r="0.9" fill="#3a1406" />
        {/* Diadema con joya */}
        <path d="M36 32 Q 50 24 64 32" stroke="url(#vg-gem)" strokeWidth="3.5" fill="none" />
        <path d="M50 22 L 55 29 L 50 35 L 45 29 Z" fill="#7fd8ff" stroke="#fff3c8" strokeWidth="1.5" />
        {/* Collar de perlas */}
        <path d="M42 66 Q 50 72 58 66" fill="none" stroke="#fffaf0" strokeWidth="3" strokeDasharray="0.1 3.4" strokeLinecap="round" />
      </g>
      <circle cx="50" cy="50" r="46" fill="none" stroke="#f4d27a" strokeWidth="3" />
    </g>
  ),
  neon: () => (
    <g>
      <defs>
        <linearGradient id="vg-neon-bg" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="#2b0f3d" /><stop offset="1" stopColor="#0c0516" /></linearGradient>
      </defs>
      <rect x="8" y="22" width="84" height="56" rx="10" fill="url(#vg-neon-bg)" stroke="#f4d27a" strokeWidth="3" />
      {Array.from({ length: 10 }, (_, i) => <circle key={i} cx={14 + i * 8} cy="27" r="1.8" fill="#fff3c8" />)}
      {Array.from({ length: 10 }, (_, i) => <circle key={`b${i}`} cx={14 + i * 8} cy="73" r="1.8" fill="#fff3c8" />)}
      <text x="50" y="59" textAnchor="middle" fontSize="23" fontWeight="900" fontFamily="system-ui, sans-serif" fill="none" stroke="#ff4fd8" strokeOpacity="0.45" strokeWidth="6" letterSpacing="1">VEGAS</text>
      <text x="50" y="59" textAnchor="middle" fontSize="23" fontWeight="900" fontFamily="system-ui, sans-serif" fill="#ffe8fb" stroke="#ff4fd8" strokeWidth="1.6" letterSpacing="1">VEGAS</text>
      <text x="50" y="18" textAnchor="middle" fontSize="11" fontWeight="800" fontFamily="system-ui, sans-serif" fill="#f4d27a" stroke="#0c0516" strokeWidth="3" paintOrder="stroke">WILD</text>
    </g>
  ),
  wheel: () => (
    <g>
      <defs>{gold('vg-wheel-rim')}</defs>
      <circle cx="50" cy="52" r="40" fill="url(#vg-wheel-rim)" stroke="#5a3d0d" strokeWidth="2" />
      {Array.from({ length: 12 }, (_, i) => {
        const a0 = (i * 30 * Math.PI) / 180;
        const a1 = ((i + 1) * 30 * Math.PI) / 180;
        const r = 34;
        return <path key={i} d={`M50 52 L ${50 + r * Math.cos(a0)} ${52 + r * Math.sin(a0)} A ${r} ${r} 0 0 1 ${50 + r * Math.cos(a1)} ${52 + r * Math.sin(a1)} Z`} fill={['#c4121f', '#1b1f2e', '#0f6b47', '#5b2a86'][i % 4]} stroke="#f4d27a" strokeWidth="1" />;
      })}
      <circle cx="50" cy="52" r="9" fill="url(#vg-wheel-rim)" stroke="#5a3d0d" strokeWidth="1.5" />
      <path d="M50 4 L 58 16 H 42 Z" fill="#fff3c8" stroke="#5a3d0d" strokeWidth="1.5" />
    </g>
  ),
  safe: () => (
    <g>
      <defs>
        <linearGradient id="vg-steel" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stopColor="#d9dde6" /><stop offset="0.5" stopColor="#7d8696" /><stop offset="1" stopColor="#3b4250" /></linearGradient>
        {gold('vg-dial')}
      </defs>
      <rect x="14" y="16" width="72" height="70" rx="8" fill="url(#vg-steel)" stroke="#1e232d" strokeWidth="2.5" />
      <rect x="22" y="24" width="56" height="54" rx="5" fill="none" stroke="#1e232d" strokeOpacity="0.6" strokeWidth="2" />
      <circle cx="50" cy="51" r="17" fill="url(#vg-dial)" stroke="#5a3d0d" strokeWidth="2" />
      {Array.from({ length: 12 }, (_, i) => <path key={i} d="M50 36 v4" stroke="#5a3d0d" strokeWidth="1.6" transform={`rotate(${i * 30} 50 51)`} />)}
      <circle cx="50" cy="51" r="6" fill="#3b4250" />
      <path d="M50 51 L 60 43" stroke="#3b4250" strokeWidth="3" strokeLinecap="round" />
      <rect x="20" y="86" width="12" height="5" rx="1" fill="#1e232d" />
      <rect x="68" y="86" width="12" height="5" rx="1" fill="#1e232d" />
    </g>
  ),
  cash: () => (
    <g>
      <defs>{gold('vg-coin')}</defs>
      <circle cx="50" cy="50" r="40" fill="url(#vg-coin)" stroke="#5a3d0d" strokeWidth="2.5" />
      <circle cx="50" cy="50" r="32" fill="none" stroke="#fff3c8" strokeWidth="2" strokeDasharray="2 3" />
      <rect x="26" y="36" width="48" height="28" rx="3" fill="#a8e29a" stroke="#23482a" strokeWidth="2" transform="rotate(-6 50 50)" />
      <text x="50" y="57" textAnchor="middle" fontSize="18" fontWeight="900" fontFamily="Georgia, serif" fill="#23482a" transform="rotate(-6 50 50)">$</text>
    </g>
  ),
};
