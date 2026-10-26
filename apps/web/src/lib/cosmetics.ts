import { useSyncExternalStore } from 'react';

/**
 * Cosméticos en el navegador: clases CSS de marcos y colores de nombre y el
 * dorso de cartas equipado (se aplica a todas las cartas boca abajo).
 */

export const frameClass = (frame: string | null | undefined): string => (frame ? `pf-frame pf-${frame.replace('frame:', '')}` : '');
export const nameClass = (color: string | null | undefined): string => (color ? `pn-${color.replace('name:', '')}` : '');

export interface BackPalette {
  bg1: string;
  bg2: string;
  line: string;
  accent: string;
  /** Dibujo central: monograma A, dragón, estrella… */
  motif: 'a' | 'dragon' | 'star' | 'diamond';
}

export const CARD_BACKS: Record<string, BackPalette> = {
  default: { bg1: '#22356A', bg2: '#0A1124', line: '#D2A443', accent: '#E6CA8E', motif: 'a' },
  'back:rubi': { bg1: '#7a1022', bg2: '#2a0309', line: '#f0c27a', accent: '#ffd8a8', motif: 'a' },
  'back:esmeralda': { bg1: '#0f6b47', bg2: '#032417', line: '#d9c27a', accent: '#f1e2b2', motif: 'a' },
  'back:zafiro': { bg1: '#1f5fb8', bg2: '#071a3d', line: '#cfe3ff', accent: '#ffffff', motif: 'diamond' },
  'back:carbono': { bg1: '#2b2f38', bg2: '#0b0c10', line: '#8a93a6', accent: '#e9eef6', motif: 'diamond' },
  'back:neon': { bg1: '#3a0f4f', bg2: '#0c0216', line: '#ff4fd8', accent: '#7ff0ff', motif: 'star' },
  'back:dragon': { bg1: '#6b0f0f', bg2: '#140202', line: '#f4c04a', accent: '#ffdf7a', motif: 'dragon' },
  'back:galaxia': { bg1: '#2a1b6e', bg2: '#05030f', line: '#b9a8ff', accent: '#ffffff', motif: 'star' },
  'back:oro': { bg1: '#f4d27a', bg2: '#8a5f18', line: '#fff6d6', accent: '#3a2608', motif: 'a' },
};

let currentBack = 'default';
const listeners = new Set<() => void>();
export function setCardBack(id: string | null): void {
  const next = id && CARD_BACKS[id] ? id : 'default';
  if (next === currentBack) return;
  currentBack = next;
  for (const l of listeners) l();
}
export function useCardBack(): BackPalette {
  const id = useSyncExternalStore(
    (fn) => {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
    () => currentBack,
  );
  return CARD_BACKS[id] ?? CARD_BACKS.default!;
}
