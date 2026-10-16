import { describeHand, type HandInsight } from '@aurum/engine';

export type AssistMode = 'beginner' | 'standard' | 'advanced';

/**
 * Calcula la mano del jugador a partir de lo que puede ver: sus dos cartas y
 * las comunitarias. Devuelve null si no tiene cartas (mirando, retirado o
 * tablero en un estado intermedio).
 */
export function heroInsight(hole: readonly (string | null)[] | undefined, board: readonly string[], mode: AssistMode): HandInsight | null {
  if (!hole || hole.length !== 2 || hole.some((c) => !c)) return null;
  if (![0, 3, 4, 5].includes(board.length)) return null;
  // En el modo avanzado no se calculan las probabilidades de mejora.
  return describeHand(hole as string[], board, { odds: mode !== 'advanced' });
}

export type CardEmphasis = 'highlight' | 'soft' | 'none';

/**
 * Énfasis visual de cada carta según la combinación actual:
 * - las cartas de la combinación se iluminan;
 * - las demás cartas propias y comunitarias se atenúan ligeramente;
 * - con «carta alta» no hay combinación: no se resalta nada.
 * Las cartas de los rivales nunca se tocan.
 */
export function cardEmphasis(insight: HandInsight | null, card: string, isHeroOrBoard: boolean): CardEmphasis {
  if (!insight || !isHeroOrBoard || insight.category === 0) return 'none';
  return insight.core.includes(card) ? 'highlight' : 'soft';
}
