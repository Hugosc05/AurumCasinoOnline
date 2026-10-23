import { memo, type ReactNode } from 'react';
import { cx } from '../../lib/format';
import { SlotSymbolArt } from './symbols';

/**
 * Pantalla superior de la máquina (como en los muebles de sala de dos
 * pantallas): arte de la temática, nombre en neón y, encima, el contador de
 * premio o los botes. Todo es SVG/CSS estático: no cuesta nada al girar.
 */

/** Showgirl de cuerpo medio con vestido de lentejuelas y tocado de plumas (ilustración original, sin desnudos). */
function Showgirl({ dress, flip = false }: { dress: string; flip?: boolean }) {
  return (
    <svg viewBox="0 0 120 200" className="h-full w-auto drop-shadow-[0_10px_18px_rgba(0,0,0,0.6)]" style={flip ? { transform: 'scaleX(-1)' } : undefined} aria-hidden>
      <defs>
        <radialGradient id={`sg-skin-${dress}`} cx="45%" cy="35%" r="70%"><stop offset="0" stopColor="#ffe3cc" /><stop offset="1" stopColor="#d9906d" /></radialGradient>
        <linearGradient id={`sg-dress-${dress}`} x1="0" y1="0" x2="1" y2="1"><stop offset="0" stopColor="#ffffff" stopOpacity="0.9" /><stop offset="0.15" stopColor={dress} /><stop offset="0.6" stopColor={dress} /><stop offset="1" stopColor="#000" stopOpacity="0.6" /></linearGradient>
        <pattern id={`sg-seq-${dress}`} width="5" height="5" patternUnits="userSpaceOnUse"><circle cx="2.5" cy="2.5" r="1.3" fill="#ffffff" opacity="0.55" /></pattern>
        <linearGradient id="sg-hair" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="#f8dc9a" /><stop offset="1" stopColor="#b07a2c" /></linearGradient>
        <linearGradient id="sg-plume" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="#fff0fb" /><stop offset="1" stopColor="#ff4fb8" /></linearGradient>
      </defs>
      {/* Plumas */}
      {[-40, -22, -6, 10, 26, 42].map((a) => (
        <path key={a} d="M60 40 C 50 22 52 4 60 -8 C 68 4 70 22 60 40 Z" fill="url(#sg-plume)" opacity="0.95" transform={`rotate(${a} 60 42)`} />
      ))}
      {/* Melena */}
      <path d="M34 66 C 28 38 44 26 60 26 C 78 26 92 38 86 68 C 92 92 84 104 80 110 C 74 96 76 82 72 72 C 66 78 52 78 46 72 C 44 84 46 98 40 110 C 34 100 28 88 34 66 Z" fill="url(#sg-hair)" />
      {/* Cuello y hombros */}
      <path d="M53 78 H 67 V 92 H 53 Z" fill={`url(#sg-skin-${dress})`} />
      <path d="M30 104 C 34 94 44 90 53 90 H 67 C 76 90 86 94 90 104 L 88 116 H 32 Z" fill={`url(#sg-skin-${dress})`} />
      {/* Vestido de lentejuelas: cuello alto, ajustado, con brillo */}
      <path d="M36 108 C 44 100 52 98 60 98 C 68 98 76 100 84 108 L 80 140 C 82 160 88 180 92 200 H 28 C 32 180 38 160 40 140 Z" fill={`url(#sg-dress-${dress})`} />
      <path d="M36 108 C 44 100 52 98 60 98 C 68 98 76 100 84 108 L 80 140 C 82 160 88 180 92 200 H 28 C 32 180 38 160 40 140 Z" fill={`url(#sg-seq-${dress})`} />
      <path d="M44 112 C 48 140 46 170 40 196" stroke="#ffffff" strokeOpacity="0.45" strokeWidth="3" fill="none" strokeLinecap="round" />
      {/* Brazo en jarra y guante */}
      <path d="M84 108 C 98 116 102 132 92 146 C 88 150 82 148 80 142" fill="none" stroke={`url(#sg-skin-${dress})`} strokeWidth="9" strokeLinecap="round" />
      <path d="M36 108 C 26 122 26 140 34 156" fill="none" stroke={`url(#sg-skin-${dress})`} strokeWidth="9" strokeLinecap="round" />
      <circle cx="35" cy="158" r="6" fill={`url(#sg-skin-${dress})`} />
      {/* Cara */}
      <ellipse cx="60" cy="58" rx="15" ry="19" fill={`url(#sg-skin-${dress})`} />
      <path d="M50 54 Q 54 51 57 54" stroke="#3a1406" strokeWidth="1.8" fill="none" strokeLinecap="round" />
      <path d="M63 54 Q 66 51 70 54" stroke="#3a1406" strokeWidth="1.8" fill="none" strokeLinecap="round" />
      <path d="M49 52 l -2 -2 M 71 52 l 2 -2" stroke="#3a1406" strokeWidth="1.2" />
      <circle cx="53" cy="62" r="3" fill="#ff8aa0" opacity="0.45" />
      <circle cx="67" cy="62" r="3" fill="#ff8aa0" opacity="0.45" />
      <path d="M54 67 Q 60 65 66 67 Q 60 72 54 67 Z" fill="#d1122a" />
      {/* Diadema y pendientes */}
      <path d="M44 40 Q 60 30 76 40" stroke="#f4d27a" strokeWidth="4" fill="none" />
      <path d="M60 28 L 66 36 L 60 43 L 54 36 Z" fill="#9fe6ff" stroke="#fff3c8" strokeWidth="1.5" />
      <circle cx="45" cy="66" r="2.5" fill="#fffaf0" />
      <circle cx="75" cy="66" r="2.5" fill="#fffaf0" />
    </svg>
  );
}

function CoinsAndCash() {
  return (
    <svg viewBox="0 0 400 60" className="absolute inset-x-0 bottom-0 h-[34%] w-full" preserveAspectRatio="xMidYMax slice" aria-hidden>
      <defs>
        <radialGradient id="ca-coin" cx="35%" cy="30%" r="70%"><stop offset="0" stopColor="#fff3c8" /><stop offset="0.5" stopColor="#e2b44d" /><stop offset="1" stopColor="#8a5f18" /></radialGradient>
        <linearGradient id="ca-bill" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stopColor="#d7f2c8" /><stop offset="1" stopColor="#5f9e57" /></linearGradient>
      </defs>
      {Array.from({ length: 34 }, (_, i) => {
        const x = (i * 53) % 400;
        const y = 34 + ((i * 29) % 22);
        return <ellipse key={i} cx={x} cy={y} rx="11" ry="6" fill="url(#ca-coin)" stroke="#6e4a12" strokeWidth="1" />;
      })}
      {[60, 150, 250, 330].map((x, i) => (
        <g key={x} transform={`translate(${x} ${30 + (i % 2) * 6}) rotate(${i % 2 ? 8 : -10})`}>
          {[0, 1, 2].map((k) => <rect key={k} x={-24} y={-k * 4} width="48" height="16" rx="2" fill="url(#ca-bill)" stroke="#23482a" strokeWidth="1" />)}
          <rect x="-4" y="-10" width="8" height="18" fill="#c4121f" />
        </g>
      ))}
    </svg>
  );
}

const ART: Record<string, { bg: string; left: ReactNode; right: ReactNode; floor?: ReactNode }> = {
  'vegas-nights': {
    bg: 'bg-[radial-gradient(ellipse_at_50%_20%,#ff5fd2_0%,#7b1fa2_35%,#2a0845_70%,#12031f_100%)]',
    left: <Showgirl dress="#2c6bff" />,
    right: <Showgirl dress="#ff2d8a" flip />,
    floor: <CoinsAndCash />,
  },
  'aurum-royale': {
    bg: 'bg-[radial-gradient(ellipse_at_50%_25%,#ffd36b_0%,#b8321f_38%,#3d0a14_72%,#14040a_100%)]',
    left: <div className="flex h-full items-end gap-1 pb-2"><SlotSymbolArt symbol="seven" size={58} /><SlotSymbolArt symbol="jack" size={48} /></div>,
    right: <div className="flex h-full items-end gap-1 pb-2"><SlotSymbolArt symbol="crown" size={50} /><SlotSymbolArt symbol="seven" size={58} /></div>,
    floor: <CoinsAndCash />,
  },
  'tesoro-arrecife': {
    bg: 'bg-[radial-gradient(ellipse_at_50%_15%,#7ff0e4_0%,#0b6f8f_40%,#062a3a_75%,#020c14_100%)]',
    left: <div className="flex h-full items-end gap-1 pb-2"><SlotSymbolArt symbol="dolphin" size={60} /><SlotSymbolArt symbol="pearl" size={44} /></div>,
    right: <div className="flex h-full items-end gap-1 pb-2"><SlotSymbolArt symbol="turtle" size={52} /><SlotSymbolArt symbol="chest" size={56} /></div>,
  },
};

export const TopScreen = memo(function TopScreen({ machine, title, accent, children }: { machine: string; title: string; accent: string; children: ReactNode }) {
  const art = ART[machine] ?? ART['aurum-royale']!;
  return (
    <div className={cx('slot-screen relative mb-3 overflow-hidden rounded-2xl', art.bg)} style={{ minHeight: 'clamp(150px, 22vw, 210px)' }}>
      {/* Haces de luz giratorios de fondo (estáticos: sin coste) */}
      <div className="pointer-events-none absolute inset-0 opacity-30 [background:repeating-conic-gradient(from_0deg_at_50%_110%,rgba(255,255,255,0.35)_0deg_6deg,transparent_6deg_16deg)]" aria-hidden />
      {art.floor}
      <div className="absolute bottom-0 left-1 top-2 hidden sm:block" aria-hidden>{art.left}</div>
      <div className="absolute bottom-0 right-1 top-2 hidden sm:block" aria-hidden>{art.right}</div>
      <div className="relative z-10 flex flex-col items-center px-4 pb-3 pt-3 text-center sm:px-[24%]">
        <p className={cx('slot-topper-title font-display text-[clamp(1.6rem,4.2vw,2.8rem)] leading-none tracking-wide', accent)}>{title}</p>
        <div className="mt-2 w-full">{children}</div>
      </div>
      {/* Cristal de la pantalla */}
      <div className="pointer-events-none absolute inset-0 rounded-2xl bg-[linear-gradient(120deg,rgba(255,255,255,0.12),transparent_30%,transparent_75%,rgba(255,255,255,0.06))]" aria-hidden />
    </div>
  );
});
