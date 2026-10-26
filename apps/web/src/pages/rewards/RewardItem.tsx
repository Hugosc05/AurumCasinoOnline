import { memo } from 'react';
import { COSMETIC_BY_ID, RARITY_INFO, type CaseDrop } from '@aurum/engine';
import { CARD_BACKS, frameClass, nameClass } from '../../lib/cosmetics';
import { cx } from '../../lib/format';

/** Dorso en miniatura con la paleta del cosmético. */
export function MiniBack({ id, size = 46 }: { id: string; size?: number }) {
  const b = CARD_BACKS[id] ?? CARD_BACKS.default!;
  return (
    <svg viewBox="0 0 50 70" width={size} height={size * 1.4} aria-hidden>
      <defs>
        <radialGradient id={`mb-${id}`} cx="50%" cy="45%" r="62%"><stop offset="0" stopColor={b.bg1} /><stop offset="1" stopColor={b.bg2} /></radialGradient>
      </defs>
      <rect x="1" y="1" width="48" height="68" rx="5" fill={`url(#mb-${id})`} stroke={b.line} strokeWidth="1.2" />
      <rect x="5" y="5" width="40" height="60" rx="3" fill="none" stroke={b.line} strokeOpacity="0.6" />
      <circle cx="25" cy="35" r="9" fill={b.bg2} stroke={b.line} />
      <circle cx="25" cy="35" r="3.5" fill={b.accent} />
    </svg>
  );
}

/** Icono del premio: monedas, dorso, marco o color de nombre. */
export const DropIcon = memo(function DropIcon({ drop, size = 56 }: { drop: CaseDrop; size?: number }) {
  if (drop.kind === 'credits') {
    const n = drop.amount >= 25000 ? 5 : drop.amount >= 2500 ? 4 : drop.amount >= 500 ? 3 : 2;
    return (
      <svg viewBox="0 0 60 60" width={size} height={size} aria-hidden>
        <defs>
          <radialGradient id="coin-g" cx="35%" cy="30%" r="70%"><stop offset="0" stopColor="#fff3c8" /><stop offset="0.55" stopColor="#e2b44d" /><stop offset="1" stopColor="#8a5f18" /></radialGradient>
        </defs>
        {Array.from({ length: n }, (_, i) => (
          <g key={i} transform={`translate(${8 + (i % 3) * 14} ${36 - Math.floor(i / 3) * 8 - (i % 2) * 6})`}>
            <ellipse cx="11" cy="6" rx="11" ry="5" fill="#6e4a12" />
            <ellipse cx="11" cy="3" rx="11" ry="5" fill="url(#coin-g)" stroke="#6e4a12" strokeWidth="0.8" />
          </g>
        ))}
      </svg>
    );
  }
  const item = COSMETIC_BY_ID[drop.id];
  if (!item) return null;
  if (item.kind === 'cardBack') return <MiniBack id={item.id} size={size * 0.7} />;
  if (item.kind === 'frame') {
    return (
      <span className={cx('relative block rounded-full', frameClass(item.id))} style={{ width: size * 0.78, height: size * 0.78 }}>
        <span className="grid h-full w-full place-items-center rounded-full bg-gradient-to-b from-[#2a2238] to-[#120d1c] font-display text-xl text-marfil">A</span>
      </span>
    );
  }
  return <span className={cx('font-display text-3xl font-bold', nameClass(item.id))}>Aa</span>;
});

export const dropTitle = (d: CaseDrop): string => (d.kind === 'credits' ? `${d.amount.toLocaleString('es-ES')} créditos` : COSMETIC_BY_ID[d.id]?.name ?? d.id);

/** Casilla de premio con el color de su rareza (como en las cajas de CS:GO). */
export const RewardTile = memo(function RewardTile({ drop, width = 128, highlight = false }: { drop: CaseDrop; width?: number; highlight?: boolean }) {
  const r = RARITY_INFO[drop.rarity];
  return (
    <div
      className={cx('relative flex shrink-0 flex-col items-center justify-end overflow-hidden rounded-md border border-white/10 bg-gradient-to-b from-[#1b2030] to-[#0b0e16] pb-2 pt-3', highlight && 'case-win')}
      style={{ width, height: width * 0.92, ['--rarity' as string]: r.color }}
    >
      <div className="absolute inset-x-0 top-0 h-full opacity-30" style={{ background: `radial-gradient(ellipse at 50% 85%, ${r.color}, transparent 65%)` }} />
      <div className="relative grid flex-1 place-items-center"><DropIcon drop={drop} size={width * 0.46} /></div>
      <p className="relative w-full truncate px-1.5 text-center text-[11px] font-semibold text-marfil">{dropTitle(drop)}</p>
      <div className="absolute inset-x-0 bottom-0 h-1" style={{ background: r.color }} />
    </div>
  );
});
