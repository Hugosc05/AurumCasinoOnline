import { memo } from 'react';

export interface ChipDenom {
  value: number;
  body: string;
  edge: string;
  ink: string;
}

/** Denominaciones con colores diferenciados (convención de casino). */
export const CHIP_DENOMS: readonly ChipDenom[] = [
  { value: 1, body: '#ece6d6', edge: '#2f6fb0', ink: '#1d2a44' },
  { value: 5, body: '#b02a3c', edge: '#f2e9d8', ink: '#fff6e8' },
  { value: 25, body: '#1f7a55', edge: '#f2e9d8', ink: '#f4fff8' },
  { value: 100, body: '#161b26', edge: '#cfae6b', ink: '#ebd9a6' },
  { value: 500, body: '#5b2b86', edge: '#f2e9d8', ink: '#f6ecff' },
  { value: 1000, body: '#c79a3c', edge: '#2a1c08', ink: '#1f1405' },
  { value: 5000, body: '#d0612b', edge: '#1a1a1a', ink: '#1a0d05' },
];

export function denomFor(value: number): ChipDenom {
  return [...CHIP_DENOMS].reverse().find((d) => d.value <= value) ?? CHIP_DENOMS[0]!;
}

/** Descomposición voraz de una cantidad en fichas (para dibujar pilas). */
export function chipsFor(amount: number, max = 12): ChipDenom[] {
  const out: ChipDenom[] = [];
  let rest = amount;
  for (const d of [...CHIP_DENOMS].reverse()) {
    while (rest >= d.value && out.length < max) {
      out.push(d);
      rest -= d.value;
    }
  }
  return out.reverse();
}

const fmt = (v: number): string => (v >= 1000 ? `${v / 1000}K` : String(v));

export const Chip = memo(function Chip({ value, size = 48, label = true }: { value: number; size?: number; label?: boolean }) {
  const d = denomFor(value);
  const stripes = Array.from({ length: 8 }, (_, i) => i * 45);
  return (
    <svg width={size} height={size} viewBox="0 0 100 100" aria-hidden className="drop-shadow-[0_3px_3px_rgba(0,0,0,0.55)]">
      <circle cx="50" cy="50" r="48" fill={d.body} />
      {stripes.map((a) => (
        <rect key={a} x="45" y="2" width="10" height="16" rx="2" fill={d.edge} transform={`rotate(${a} 50 50)`} />
      ))}
      <circle cx="50" cy="50" r="34" fill="none" stroke={d.edge} strokeWidth="2" strokeDasharray="4 4" opacity="0.9" />
      <circle cx="50" cy="50" r="29" fill={d.body} stroke="rgba(0,0,0,0.25)" strokeWidth="1" />
      <circle cx="50" cy="50" r="48" fill="url(#chipShine)" />
      <defs>
        <radialGradient id="chipShine" cx="35%" cy="30%" r="70%">
          <stop offset="0" stopColor="#fff" stopOpacity="0.28" />
          <stop offset="0.5" stopColor="#fff" stopOpacity="0" />
          <stop offset="1" stopColor="#000" stopOpacity="0.25" />
        </radialGradient>
      </defs>
      {label && (
        <text x="50" y="58" textAnchor="middle" fontSize={value >= 1000 ? 22 : 26} fontWeight="800" fontFamily="'Manrope Variable', sans-serif" fill={d.ink}>
          {fmt(value)}
        </text>
      )}
    </svg>
  );
});

/** Pila de fichas vista en perspectiva (cada ficha desplazada hacia arriba). */
export const ChipStack = memo(function ChipStack({ amount, size = 34, max = 10 }: { amount: number; size?: number; max?: number }) {
  if (amount <= 0) return null;
  const chips = chipsFor(amount, max);
  return (
    <div className="relative" style={{ width: size, height: size + chips.length * (size * 0.12) }} aria-hidden>
      {chips.map((c, i) => (
        <div key={i} className="absolute left-0" style={{ bottom: i * size * 0.12 }}>
          <Chip value={c.value} size={size} label={i === chips.length - 1} />
        </div>
      ))}
    </div>
  );
});
