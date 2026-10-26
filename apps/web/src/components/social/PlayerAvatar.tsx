import { memo } from 'react';
import { frameClass, nameClass } from '../../lib/cosmetics';
import { cx } from '../../lib/format';
import { useLook } from '../../lib/looks';
import { usePlayerCard } from './PlayerCard';

/** Foto (o inicial) de un jugador humano con su marco; al tocarla se abre su tarjeta. */
export const PlayerAvatar = memo(function PlayerAvatar({ name, size = 56, className, interactive = true, fallbackClassName }: {
  name: string;
  size?: number;
  className?: string;
  interactive?: boolean;
  fallbackClassName?: string;
}) {
  const look = useLook(name);
  const open = usePlayerCard();
  const inner = look?.avatarUrl ? (
    <img src={look.avatarUrl} alt="" width={size} height={size} className="h-full w-full rounded-full object-cover" loading="lazy" decoding="async" draggable={false} />
  ) : (
    <span className={cx('grid h-full w-full place-items-center rounded-full bg-gradient-to-b from-[#2a2238] to-[#120d1c] font-display text-marfil', fallbackClassName)} style={{ fontSize: size * 0.42 }}>
      {name[0]?.toUpperCase()}
    </span>
  );
  const cls = cx('relative block shrink-0 rounded-full', frameClass(look?.frame), className);
  if (!interactive) return <span className={cls} style={{ width: size, height: size }}>{inner}</span>;
  return (
    <button type="button" className={cx(cls, 'cursor-pointer transition-transform hover:scale-[1.04] focus-visible:outline focus-visible:outline-2 focus-visible:outline-oro')} style={{ width: size, height: size }}
      onClick={(e) => { e.stopPropagation(); open(name); }} aria-label={`Ver perfil de ${name}`} data-testid={`player-${name}`}>
      {inner}
    </button>
  );
});

/** Nombre con el color equipado por el jugador. */
export const PlayerName = memo(function PlayerName({ name, className }: { name: string; className?: string }) {
  const look = useLook(name);
  return <span className={cx(nameClass(look?.nameColor), className)}>{name}</span>;
});
