import { useSyncExternalStore } from 'react';

/** Jugadores silenciados en el chat (solo en este navegador). */
const KEY = 'aurum.chat.muted';
let muted = new Set<string>();
try {
  muted = new Set(JSON.parse(localStorage.getItem(KEY) ?? '[]') as string[]);
} catch {
  /* sin almacenamiento */
}
const listeners = new Set<() => void>();
let version = 0;

export const isMuted = (name: string): boolean => muted.has(name.toLowerCase());
export function toggleMute(name: string): void {
  const k = name.toLowerCase();
  if (muted.has(k)) muted.delete(k);
  else muted.add(k);
  try {
    localStorage.setItem(KEY, JSON.stringify([...muted]));
  } catch {
    /* sin almacenamiento */
  }
  version += 1;
  for (const l of listeners) l();
}
export function useMutes(): number {
  return useSyncExternalStore(
    (fn) => {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
    () => version,
    () => 0,
  );
}
