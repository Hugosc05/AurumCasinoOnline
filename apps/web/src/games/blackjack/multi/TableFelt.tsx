import { memo } from 'react';
import { seatSpots, type MultiGeometry } from './model';

/**
 * Mesa de blackjack de casino vista desde arriba: borde recto del lado del
 * crupier, semicírculo de los jugadores con baranda acolchada de cuero,
 * tapete con las leyendas impresas en arco, bandeja de fichas del crupier y una
 * casilla de apuesta por asiento. Es una capa estática (se dibuja una vez).
 */

/** Contorno de la mesa a una fracción `k` de la elipse de los asientos. */
export function tableOutline(g: MultiGeometry, k: number): string {
  const rx = g.rx * k;
  const ry = g.ry * k;
  const top = g.tableTop;
  if (top >= g.cy) {
    const u = Math.min(0.999, (top - g.cy) / ry);
    const dx = rx * Math.sqrt(1 - u * u);
    return `M ${g.cx - dx} ${top} L ${g.cx + dx} ${top} A ${rx} ${ry} 0 1 1 ${g.cx - dx} ${top} Z`;
  }
  return `M ${g.cx - rx} ${top} L ${g.cx + rx} ${top} L ${g.cx + rx} ${g.cy} A ${rx} ${ry} 0 0 1 ${g.cx - rx} ${g.cy} Z`;
}

/** Arco abierto (para el texto impreso) a una fracción `k`, de `a0` a `a1` grados (0 = derecha, 90 = abajo). */
function arcPath(g: MultiGeometry, k: number, a0: number, a1: number): string {
  const p = (a: number): [number, number] => [g.cx + g.rx * k * Math.cos((a * Math.PI) / 180), g.cy + g.ry * k * Math.sin((a * Math.PI) / 180)];
  const [x0, y0] = p(a0);
  const [x1, y1] = p(a1);
  // De izquierda a derecha por abajo, para que el texto se lea derecho.
  return `M ${x1} ${y1} A ${g.rx * k} ${g.ry * k} 0 0 0 ${x0} ${y0}`;
}

const CHIP_COLS = ['#f4efe2', '#b8202f', '#14794f', '#1f2b44', '#6b2fb3', '#d1a64c', '#f4efe2', '#b8202f'];

export const TableFelt = memo(function TableFelt({ g, n, occupied, yourSeat }: { g: MultiGeometry; n: number; occupied: boolean[]; yourSeat: number | null }) {
  const stacked = g.layout === 'stacked';
  const outer = tableOutline(g, stacked ? 1.06 : 1.04);
  const felt = tableOutline(g, stacked ? 0.97 : 0.955);
  // Texto impreso: entre las cartas del crupier y las de los jugadores.
  const textK = stacked ? 0.22 : 0.53;
  const span = stacked ? 70 : 40;
  const tray = { w: stacked ? 170 : 230, h: stacked ? 30 : 36, x: g.cx, y: g.tableTop + (stacked ? 8 : 10) };
  return (
    <>
      {/* Tapete con su textura (recortado a la forma de la mesa) */}
      <div className="felt absolute inset-0" style={{ clipPath: `path('${felt}')` }} aria-hidden />
      <svg className="pointer-events-none absolute inset-0" width={g.w} height={g.h} aria-hidden>
        <defs>
          <linearGradient id="bjRail" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor="#4a2d18" />
            <stop offset="0.45" stopColor="#2a170b" />
            <stop offset="1" stopColor="#120904" />
          </linearGradient>
          <radialGradient id="bjVignette" cx="50%" cy="30%" r="75%">
            <stop offset="0.55" stopColor="#000" stopOpacity="0" />
            <stop offset="1" stopColor="#000" stopOpacity="0.5" />
          </radialGradient>
          <linearGradient id="bjWood" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor="#6a4426" />
            <stop offset="1" stopColor="#2c1a0c" />
          </linearGradient>
          <path id="bjArc1" d={arcPath(g, textK, 90 - span, 90 + span)} />
          <path id="bjArc2" d={arcPath(g, textK - 0.065, 90 - span * 1.5, 90 + span * 1.5)} />
        </defs>
        {/* Baranda acolchada: banda gruesa entre el contorno exterior y el tapete */}
        <path d={`${outer} ${felt}`} fill="url(#bjRail)" fillRule="evenodd" />
        <path d={outer} fill="none" stroke="rgba(255,214,160,0.18)" strokeWidth="2" />
        <path d={felt} fill="url(#bjVignette)" />
        <path d={felt} fill="none" stroke="#d9b46a" strokeOpacity="0.55" strokeWidth="2.5" />
        {/* Borde recto de madera del lado del crupier */}
        <rect x={0} y={g.tableTop - 14} width={g.w} height="16" fill="url(#bjWood)" clipPath={`path('${outer}')`} />
        <path d={`M 0 ${g.tableTop + 2} H ${g.w}`} stroke="#d9b46a" strokeOpacity="0.5" strokeWidth="1.5" clipPath={`path('${outer}')`} />

        {/* Leyendas impresas en el tapete */}
        {stacked ? (
          // En vertical el arco sería demasiado corto: leyenda recta en el centro del tapete.
          <text x={g.cx} y={g.cy + g.ry * 0.2} fill="#e8cf8f" fillOpacity="0.8" fontFamily="'Bodoni Moda Variable', Georgia, serif" fontSize="15" letterSpacing="2" textAnchor="middle">
            BLACKJACK PAGA 3 A 2
          </text>
        ) : (
          <text fill="#e8cf8f" fillOpacity="0.85" fontFamily="'Bodoni Moda Variable', Georgia, serif" fontSize="22" letterSpacing="4">
            <textPath href="#bjArc1" startOffset="50%" textAnchor="middle">BLACKJACK PAGA 3 A 2</textPath>
          </text>
        )}
        {!stacked && <text fill="#f3ead6" fillOpacity="0.45" fontFamily="Manrope Variable, system-ui, sans-serif" fontSize={stacked ? 10 : 11.5} letterSpacing="1.2">
          <textPath href="#bjArc2" startOffset="50%" textAnchor="middle">EL CRUPIER SE PLANTA EN TODOS LOS 17 · PIDE CON 16</textPath>
        </text>}

        {/* Bandeja de fichas del crupier */}
        <g transform={`translate(${tray.x - tray.w / 2} ${tray.y})`}>
          <rect width={tray.w} height={tray.h} rx="6" fill="#120b06" stroke="#6b5326" strokeWidth="1.5" />
          {CHIP_COLS.map((c, i) => {
            const cw = (tray.w - 16) / CHIP_COLS.length;
            return (
              <g key={i} transform={`translate(${8 + i * cw} 4)`}>
                <rect width={cw - 4} height={tray.h - 8} rx="3" fill={c} />
                {Array.from({ length: 4 }, (_, j) => (
                  <line key={j} x1="1" x2={cw - 5} y1={4 + j * ((tray.h - 12) / 4)} y2={4 + j * ((tray.h - 12) / 4)} stroke="rgba(0,0,0,0.35)" strokeWidth="1" />
                ))}
                <rect width={cw - 4} height={tray.h - 8} rx="3" fill="url(#bjVignette)" opacity="0.6" />
              </g>
            );
          })}
        </g>

        {/* Casillas de apuesta: una por asiento; la tuya resaltada */}
        {Array.from({ length: n }, (_, i) => {
          const b = seatSpots(i, n, g).bet;
          const mine = i === yourSeat;
          const r = stacked ? 22 : 27;
          return (
            <g key={i}>
              <circle cx={b.x} cy={b.y} r={r} fill="rgba(0,0,0,0.12)" stroke="#e8cf8f" strokeOpacity={mine ? 0.9 : occupied[i] ? 0.5 : 0.28} strokeWidth={mine ? 2.5 : 1.8} />
              <circle cx={b.x} cy={b.y} r={r - 5} fill="none" stroke="#e8cf8f" strokeOpacity={mine ? 0.4 : 0.15} strokeWidth="1" />
            </g>
          );
        })}
      </svg>
    </>
  );
});
