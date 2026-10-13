import type { SlotSymbol } from '@aurum/engine';

/**
 * Tira que recorre visualmente un rodillo desde la parada actual hasta la
 * parada final decidida por el servidor. Se usan los símbolos REALES de la
 * tira del rodillo, en su orden, de modo que durante el giro nunca aparece
 * una secuencia imposible y la ventana final coincide con el resultado.
 *
 * Devuelve la lista de arriba a abajo: las 3 primeras posiciones son la
 * ventana final y las 3 últimas la ventana actual.
 */
export function reelPath(strip: readonly SlotSymbol[], currentStop: number, finalStop: number, extraTurns: number): SlotSymbol[] {
  const L = strip.length;
  const distance = (((currentStop - finalStop) % L) + L) % L;
  const count = distance + extraTurns * L + 3;
  return Array.from({ length: count }, (_, k) => strip[(finalStop + k) % L]!);
}
