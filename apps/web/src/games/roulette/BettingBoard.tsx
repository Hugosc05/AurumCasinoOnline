import { RED_NUMBERS, type RouletteBetSpec } from '@aurum/engine';
import { memo, useMemo } from 'react';
import { denomFor } from '../../components/Chip';
import { cx } from '../../lib/format';
import { BOARD_H, BOARD_W, CELL_H, CELL_W, OUT_H, ZERO_W, buildZones, cellX, cellY, numberAt, type Zone } from './board';

export interface PlacedBet {
  bet: RouletteBetSpec;
  amount: number;
}

const ZONES = buildZones();

function shortAmount(v: number): string {
  if (v >= 1000) return `${Math.round(v / 100) / 10}K`;
  return String(v);
}

/** Ficha dibujada sobre el tapete. */
function BoardChip({ x, y, amount, rotateLabel, state }: { x: number; y: number; amount: number; rotateLabel: boolean; state: 'idle' | 'won' | 'lost' }) {
  const d = denomFor(amount);
  return (
    <g transform={`translate(${x} ${y})`} className={cx('transition-opacity duration-700', state === 'lost' && 'opacity-0')} pointerEvents="none">
      {state === 'won' && <circle r="22" fill="none" stroke="#ebd9a6" strokeWidth="2.5" className="motion-safe-only" style={{ animation: 'marquee-glow 0.9s ease-in-out infinite' }} />}
      <circle r="16" cy="2.5" fill="rgba(0,0,0,0.45)" />
      <circle r="16" fill={d.body} stroke={d.edge} strokeWidth="3" strokeDasharray="5 4.5" />
      <circle r="11" fill={d.body} stroke="rgba(0,0,0,0.3)" strokeWidth="0.8" />
      <text fontSize={amount >= 1000 ? 9 : 10.5} fontWeight="800" fill={d.ink} textAnchor="middle" dominantBaseline="central" fontFamily="'Manrope Variable', sans-serif" transform={rotateLabel ? 'rotate(-90)' : undefined}>
        {shortAmount(amount)}
      </text>
    </g>
  );
}

interface Props {
  bets: Map<string, PlacedBet>;
  onPlace: (zone: Zone, el: Element) => void;
  onRemove: (key: string) => void;
  locked: boolean;
  winning: number | null;
  wonKeys: Set<string> | null;
  vertical: boolean;
  hoverKey: string | null;
  onHover: (key: string | null) => void;
}

export const BettingBoard = memo(function BettingBoard({ bets, onPlace, onRemove, locked, winning, wonKeys, vertical, hoverKey, onHover }: Props) {
  const hovered = useMemo(() => {
    if (!hoverKey) return new Set<number>();
    const z = ZONES.find((x) => x.key === hoverKey);
    if (!z) return new Set<number>();
    if ('numbers' in z.bet) return new Set(z.bet.numbers);
    const all = Array.from({ length: 36 }, (_, i) => i + 1);
    const b = z.bet;
    const pick: Record<string, (n: number) => boolean> = {
      red: (n) => RED_NUMBERS.has(n),
      black: (n) => !RED_NUMBERS.has(n),
      even: (n) => n % 2 === 0,
      odd: (n) => n % 2 === 1,
      low: (n) => n <= 18,
      high: (n) => n >= 19,
      dozen: (n) => 'index' in b && Math.ceil(n / 12) === b.index,
      column: (n) => 'index' in b && ((n - 1) % 3) + 1 === b.index,
    };
    return new Set(all.filter(pick[b.kind] ?? (() => false)));
  }, [hoverKey]);

  const t = (x: number, y: number) => (vertical ? `rotate(-90 ${x} ${y})` : undefined);
  const numbersH = 3 * CELL_H;
  const textColor = '#f4ecd9';
  const cellFill = (n: number): string => (n === 0 ? '#0f6b47' : RED_NUMBERS.has(n) ? '#9d1f2e' : '#131925');

  return (
    <svg
      viewBox={vertical ? `-6 -6 ${BOARD_H + 12} ${BOARD_W + 12}` : `-6 -6 ${BOARD_W + 12} ${BOARD_H + 12}`}
      className="w-full select-none"
      role="group"
      aria-label="Tapete de apuestas de la ruleta"
      onContextMenu={(e) => e.preventDefault()}
    >
      <g transform={vertical ? `translate(${BOARD_H} 0) rotate(90)` : undefined}>
        {/* Fondo y líneas del tapete */}
        <rect x="0" y="0" width={BOARD_W} height={BOARD_H} rx="10" fill="#0c4430" stroke="#e8d9b0" strokeOpacity="0.85" strokeWidth="2" />
        <path d={`M${ZERO_W} 0 L0 ${numbersH / 2} L${ZERO_W} ${numbersH}`} fill="none" stroke="#e8d9b0" strokeOpacity="0.6" strokeWidth="1.5" />
        <rect x="2" y="2" width={ZERO_W - 4} height={numbersH - 4} rx="8" fill={cellFill(0)} opacity={hovered.has(0) ? 1 : 0.85} />
        <text x={ZERO_W / 2} y={numbersH / 2} fill={textColor} fontSize="24" fontFamily="'Bodoni Moda Variable', serif" textAnchor="middle" dominantBaseline="central" transform={t(ZERO_W / 2, numbersH / 2)}>
          0
        </text>
        {Array.from({ length: 12 }, (_, c) =>
          Array.from({ length: 3 }, (_, r) => {
            const n = numberAt(c, r);
            const x = cellX(c);
            const y = cellY(r);
            const isWin = winning === n;
            return (
              <g key={n}>
                <rect x={x} y={y} width={CELL_W} height={CELL_H} fill="transparent" stroke="#e8d9b0" strokeOpacity="0.6" />
                <ellipse cx={x + CELL_W / 2} cy={y + CELL_H / 2} rx={vertical ? 22 : 19} ry={vertical ? 19 : 22} fill={cellFill(n)} opacity={hovered.has(n) || isWin ? 1 : 0.88} />
                {(hovered.has(n) || isWin) && <rect x={x + 1} y={y + 1} width={CELL_W - 2} height={CELL_H - 2} fill={isWin ? 'rgba(255,236,180,0.28)' : 'rgba(255,236,180,0.12)'} />}
                <text x={x + CELL_W / 2} y={y + CELL_H / 2} fill={textColor} fontSize="19" fontFamily="'Bodoni Moda Variable', serif" textAnchor="middle" dominantBaseline="central" transform={t(x + CELL_W / 2, y + CELL_H / 2)}>
                  {n}
                </text>
              </g>
            );
          }),
        )}
        {[0, 1, 2].map((r) => (
          <g key={r}>
            <rect x={cellX(12)} y={cellY(r)} width={CELL_W} height={CELL_H} fill={hoverKey === `column:${3 - r}` ? 'rgba(255,236,180,0.12)' : 'transparent'} stroke="#e8d9b0" strokeOpacity="0.6" />
            <text x={cellX(12) + CELL_W / 2} y={cellY(r) + CELL_H / 2} fill={textColor} fontSize="13" textAnchor="middle" dominantBaseline="central" transform={t(cellX(12) + CELL_W / 2, cellY(r) + CELL_H / 2)}>
              2 a 1
            </text>
          </g>
        ))}
        {[0, 1, 2].map((d) => (
          <g key={d}>
            <rect x={cellX(d * 4)} y={numbersH} width={CELL_W * 4} height={OUT_H} fill={hoverKey === `dozen:${d + 1}` ? 'rgba(255,236,180,0.12)' : 'transparent'} stroke="#e8d9b0" strokeOpacity="0.6" />
            <text x={cellX(d * 4) + CELL_W * 2} y={numbersH + OUT_H / 2} fill={textColor} fontSize="15" textAnchor="middle" dominantBaseline="central">
              {['1ª docena', '2ª docena', '3ª docena'][d]}
            </text>
          </g>
        ))}
        {['1 a 18', 'Par', 'Rojo', 'Negro', 'Impar', '19 a 36'].map((label, i) => {
          const x = cellX(i * 2);
          const y = numbersH + OUT_H;
          const keyMap = ['low', 'even', 'red', 'black', 'odd', 'high'];
          return (
            <g key={label}>
              <rect x={x} y={y} width={CELL_W * 2} height={OUT_H} fill={hoverKey === keyMap[i] ? 'rgba(255,236,180,0.12)' : 'transparent'} stroke="#e8d9b0" strokeOpacity="0.6" />
              {label === 'Rojo' || label === 'Negro' ? (
                <path d={`M${x + CELL_W} ${y + 10} l18 ${OUT_H / 2 - 10} l-18 ${OUT_H / 2 - 10} l-18 ${-(OUT_H / 2 - 10)} Z`} fill={label === 'Rojo' ? '#b02a3c' : '#0a0e16'} stroke="#e8d9b0" strokeOpacity="0.6" />
              ) : (
                <text x={x + CELL_W} y={y + OUT_H / 2} fill={textColor} fontSize="15" textAnchor="middle" dominantBaseline="central">
                  {label}
                </text>
              )}
            </g>
          );
        })}

        {/* Zonas interactivas */}
        {ZONES.map((z) => (
          <rect
            key={z.key}
            data-zone={z.key}
            x={z.x}
            y={z.y}
            width={z.w}
            height={z.h}
            fill="transparent"
            className={cx(!locked && 'cursor-pointer', 'outline-none focus-visible:stroke-oro-claro')}
            strokeWidth="2"
            role="button"
            tabIndex={z.focusable && !locked ? 0 : -1}
            aria-label={`${z.label}${bets.get(z.key) ? `, apostado ${bets.get(z.key)!.amount}` : ''}`}
            aria-disabled={locked}
            onPointerEnter={() => onHover(z.key)}
            onPointerLeave={() => onHover(null)}
            onFocus={() => onHover(z.key)}
            onBlur={() => onHover(null)}
            onClick={(e) => {
              if (locked) return;
              if (e.altKey || e.shiftKey) onRemove(z.key);
              else onPlace(z, e.currentTarget);
            }}
            onContextMenu={(e) => {
              e.preventDefault();
              if (!locked) onRemove(z.key);
            }}
            onKeyDown={(e) => {
              if (locked) return;
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                onPlace(z, e.currentTarget);
              } else if (e.key === 'Backspace' || e.key === 'Delete') {
                onRemove(z.key);
              }
            }}
          />
        ))}

        {/* Fichas colocadas */}
        {ZONES.filter((z) => bets.has(z.key)).map((z) => (
          <BoardChip
            key={z.key}
            x={z.cx}
            y={z.cy}
            amount={bets.get(z.key)!.amount}
            rotateLabel={vertical}
            state={wonKeys ? (wonKeys.has(z.key) ? 'won' : 'lost') : 'idle'}
          />
        ))}
      </g>
    </svg>
  );
});

export { ZONES };
