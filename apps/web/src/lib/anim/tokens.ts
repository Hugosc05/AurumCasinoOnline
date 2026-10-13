/**
 * Guía de animación de Aurum (fuente única para todos los juegos).
 *
 * Duraciones en milisegundos para el nivel "completo"; el nivel "reducido"
 * las multiplica por REDUCED_FACTOR y elimina desplazamientos grandes, y el
 * nivel "sin animaciones" las lleva a 0 (el estado final se muestra al instante).
 */
export const DURATION = {
  micro: 120, // pulsación de botón, hover
  quick: 220, // aparición de fichas, chips seleccionados
  card: 520, // vuelo de una carta del zapato a la mesa
  cardGap: 170, // pausa entre cartas consecutivas
  flip: 420, // giro de una carta
  chip: 480, // ficha que viaja hasta la mesa o el bote
  street: 380, // pausa entre cartas comunitarias del flop
  shuffle: 2100, // secuencia completa de barajado (saltable)
  rouletteSpin: 7600, // giro completo de ruleta (saltable)
  reelSpin: 1400, // giro base de un rodillo antes de frenar
  reelStagger: 260, // retardo entre paradas de rodillos
  winSmall: 900,
  winMedium: 1600,
  winBig: 2600,
  page: 320, // transición entre pantallas
} as const;

/** Curvas (cubic-bezier) compartidas. */
export const EASE = {
  /** Salida suave con frenado largo: cartas, fichas, paneles. */
  out: [0.22, 1, 0.36, 1] as const,
  /** Anticipación: ligero retroceso antes de arrancar. */
  anticipate: [0.36, 0, 0.66, -0.56] as const,
  /** Entrada/salida simétrica para giros de cartas. */
  inOut: [0.65, 0, 0.35, 1] as const,
  /** Aterrizaje con un pequeño asentamiento. */
  settle: [0.34, 1.36, 0.64, 1] as const,
};

/** Profundidad: altura aparente → sombra. */
export function shadowForLift(lift: number): string {
  const l = Math.max(0, Math.min(1, lift));
  const blur = 6 + l * 26;
  const y = 3 + l * 18;
  const a = 0.55 - l * 0.25;
  return `0 ${y.toFixed(1)}px ${blur.toFixed(1)}px rgba(0,0,0,${a.toFixed(2)})`;
}

export const REDUCED_FACTOR = 0.35;

export type MotionLevel = 'full' | 'reduced' | 'off';

export function speedFor(level: MotionLevel): number {
  return level === 'full' ? 1 : level === 'reduced' ? REDUCED_FACTOR : 0;
}
