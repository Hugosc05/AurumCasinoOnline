import type { ReactElement } from 'react';

/**
 * Símbolos clásicos de tragaperras (Aurum Royale): frutas, BAR, campana,
 * diamante y siete, dibujados con volumen (degradados de luz, brillos y
 * sombra propia). Se combinan con el filtro de relieve de `SlotSymbolArt`.
 */

const leaf = (x: number, y: number, rot: number) => (
  <path d="M0 0 C 8 -10 22 -10 28 -2 C 20 6 8 6 0 0 Z" fill="url(#cl-leaf)" stroke="#0e4a1d" strokeWidth="1.5" transform={`translate(${x} ${y}) rotate(${rot})`} />
);

const gloss = (cx: number, cy: number, rx: number, ry: number, rot = -30) => (
  <ellipse cx={cx} cy={cy} rx={rx} ry={ry} fill="#ffffff" opacity="0.75" transform={`rotate(${rot} ${cx} ${cy})`} />
);

export const CLASSIC_SYMBOLS: Record<string, () => ReactElement> = {
  jack: () => (
    <g>
      <defs>
        <radialGradient id="cl-cherry" cx="35%" cy="30%" r="70%"><stop offset="0" stopColor="#ff7b86" /><stop offset="0.45" stopColor="#d3112a" /><stop offset="1" stopColor="#5c0410" /></radialGradient>
        <linearGradient id="cl-leaf" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stopColor="#9be86a" /><stop offset="1" stopColor="#1f7a2c" /></linearGradient>
      </defs>
      <path d="M34 62 C 40 40 52 24 66 14 M 68 60 C 66 40 66 26 66 14" stroke="#4a2a0e" strokeWidth="3.5" fill="none" strokeLinecap="round" />
      {leaf(64, 16, -20)}
      <circle cx="32" cy="68" r="19" fill="url(#cl-cherry)" stroke="#3d020a" strokeWidth="2" />
      <circle cx="69" cy="66" r="19" fill="url(#cl-cherry)" stroke="#3d020a" strokeWidth="2" />
      {gloss(25, 60, 6, 3.5)}
      {gloss(62, 58, 6, 3.5)}
    </g>
  ),
  queen: () => (
    <g>
      <defs>
        <radialGradient id="cl-lemon" cx="35%" cy="30%" r="75%"><stop offset="0" stopColor="#fffbc4" /><stop offset="0.45" stopColor="#f7d81f" /><stop offset="1" stopColor="#a8820a" /></radialGradient>
        <linearGradient id="cl-leaf" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stopColor="#9be86a" /><stop offset="1" stopColor="#1f7a2c" /></linearGradient>
      </defs>
      <path d="M12 52 C 14 30 34 20 52 20 C 72 20 88 34 88 52 C 88 70 70 82 50 82 C 30 82 12 72 12 52 Z" fill="url(#cl-lemon)" stroke="#6e5304" strokeWidth="2.2" transform="rotate(-18 50 52)" />
      <path d="M8 46 l -6 -2 l 4 6 Z M 92 58 l 6 2 l -4 -6 Z" fill="#c9a20e" transform="rotate(-18 50 52)" />
      {leaf(52, 22, -60)}
      {gloss(34, 38, 12, 5)}
      {Array.from({ length: 14 }, (_, i) => <circle key={i} cx={30 + (i % 7) * 7} cy={52 + Math.floor(i / 7) * 10} r="0.9" fill="#a8820a" opacity="0.45" />)}
    </g>
  ),
  king: () => (
    <g>
      <defs>
        <radialGradient id="cl-orange" cx="35%" cy="30%" r="72%"><stop offset="0" stopColor="#ffd59a" /><stop offset="0.45" stopColor="#ff8a12" /><stop offset="1" stopColor="#a1430a" /></radialGradient>
        <linearGradient id="cl-leaf" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stopColor="#9be86a" /><stop offset="1" stopColor="#1f7a2c" /></linearGradient>
      </defs>
      <circle cx="50" cy="55" r="34" fill="url(#cl-orange)" stroke="#6b2c05" strokeWidth="2.2" />
      <path d="M50 22 v -6" stroke="#4a2a0e" strokeWidth="3.5" strokeLinecap="round" />
      {leaf(51, 18, -35)}
      {gloss(36, 40, 11, 6)}
      {Array.from({ length: 22 }, (_, i) => <circle key={i} cx={30 + (i * 37) % 44} cy={42 + ((i * 17) % 34)} r="0.9" fill="#a1430a" opacity="0.45" />)}
    </g>
  ),
  ace: () => (
    <g>
      <defs>
        <radialGradient id="cl-plum" cx="35%" cy="30%" r="72%"><stop offset="0" stopColor="#d9a6ff" /><stop offset="0.45" stopColor="#7b2fc4" /><stop offset="1" stopColor="#2c0b4d" /></radialGradient>
        <linearGradient id="cl-leaf" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stopColor="#9be86a" /><stop offset="1" stopColor="#1f7a2c" /></linearGradient>
      </defs>
      {/* Racimo de uvas */}
      {[[50, 32], [38, 42], [62, 42], [28, 54], [50, 52], [72, 54], [40, 64], [60, 64], [50, 76]].map(([x, y], i) => (
        <g key={i}>
          <circle cx={x} cy={y} r="11.5" fill="url(#cl-plum)" stroke="#1d0634" strokeWidth="1.6" />
          {gloss(x! - 4, y! - 4, 3.2, 1.8)}
        </g>
      ))}
      <path d="M50 22 C 50 14 54 10 60 8" stroke="#4a2a0e" strokeWidth="3.5" fill="none" strokeLinecap="round" />
      {leaf(54, 14, 10)}
    </g>
  ),
  clover: () => (
    <g>
      <defs>
        <linearGradient id="cl-rind" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="#7ed957" /><stop offset="1" stopColor="#1d6b25" /></linearGradient>
        <linearGradient id="cl-flesh" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="#ff6f7d" /><stop offset="1" stopColor="#d61a33" /></linearGradient>
      </defs>
      {/* Tajada de sandía */}
      <path d="M8 40 A 42 42 0 0 0 92 40 Z" fill="url(#cl-rind)" stroke="#0f4416" strokeWidth="2.2" transform="translate(0 12)" />
      <path d="M14 40 A 36 36 0 0 0 86 40 Z" fill="#f2ffe0" transform="translate(0 12)" />
      <path d="M18 40 A 32 32 0 0 0 82 40 Z" fill="url(#cl-flesh)" transform="translate(0 12)" />
      {[[30, 60], [42, 66], [50, 58], [58, 66], [70, 60], [50, 72], [38, 56], [62, 56]].map(([x, y], i) => (
        <ellipse key={i} cx={x} cy={y} rx="2.2" ry="3.4" fill="#1b0b06" transform={`rotate(${(x! - 50) * 0.8} ${x} ${y})`} />
      ))}
      <path d="M20 54 Q 34 58 44 52" stroke="#ffffff" strokeOpacity="0.55" strokeWidth="3" fill="none" strokeLinecap="round" />
    </g>
  ),
  crown: () => (
    <g>
      <defs>
        <linearGradient id="cl-bar" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="#4b4f5c" /><stop offset="0.5" stopColor="#14161e" /><stop offset="1" stopColor="#000" /></linearGradient>
        <linearGradient id="cl-bar-text" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="#fff6d6" /><stop offset="0.5" stopColor="#f4c64a" /><stop offset="1" stopColor="#9a6b12" /></linearGradient>
      </defs>
      {[24, 50, 76].map((y, i) => (
        <g key={i} transform={`translate(0 ${y - 50})`}>
          <rect x="12" y="40" width="76" height="20" rx="4" fill="url(#cl-bar)" stroke="#d9b46a" strokeWidth="2" />
          <text x="50" y="56" textAnchor="middle" fontSize="16" fontWeight="900" fontFamily="Impact, 'Arial Black', system-ui, sans-serif" fill="url(#cl-bar-text)" letterSpacing="3">BAR</text>
        </g>
      ))}
    </g>
  ),
  seven: () => (
    <g>
      <defs>
        <linearGradient id="cl-seven" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="#ff8a8a" /><stop offset="0.35" stopColor="#e3122a" /><stop offset="1" stopColor="#6e0612" /></linearGradient>
        <linearGradient id="cl-seven-edge" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stopColor="#fff3c8" /><stop offset="0.5" stopColor="#e2b44d" /><stop offset="1" stopColor="#8a5f18" /></linearGradient>
      </defs>
      <path d="M18 14 H 84 V 30 C 66 46 56 64 52 88 H 30 C 34 64 46 44 60 32 H 18 Z" fill="url(#cl-seven-edge)" transform="translate(2 2)" opacity="0.9" />
      <path d="M18 14 H 84 V 30 C 66 46 56 64 52 88 H 30 C 34 64 46 44 60 32 H 18 Z" fill="url(#cl-seven)" stroke="#fff3c8" strokeWidth="3" strokeLinejoin="round" />
      <path d="M22 18 H 78" stroke="#ffffff" strokeOpacity="0.6" strokeWidth="3" strokeLinecap="round" />
    </g>
  ),
};
