import { useEffect, useSyncExternalStore } from 'react';
import { api } from './api';

/**
 * Aspecto público de los jugadores (foto, marco y color del nombre) por
 * nombre de usuario. Se piden en lote y se guardan 2 minutos; los cambios
 * propios invalidan la caché al momento.
 */
export interface Look {
  username: string;
  avatarUrl: string | null;
  frame: string | null;
  nameColor: string | null;
  cardBack?: string | null;
}

const cache = new Map<string, { look: Look | null; at: number }>();
const pending = new Set<string>();
const listeners = new Set<() => void>();
let timer: number | null = null;
let version = 0;
const TTL = 120_000;

const emit = (): void => {
  version += 1;
  for (const l of listeners) l();
};

function flush(): void {
  timer = null;
  const names = [...pending].slice(0, 40);
  names.forEach((n) => pending.delete(n));
  if (names.length === 0) return;
  api
    .get<{ looks: Record<string, Look | null> }>(`/api/looks?names=${encodeURIComponent(names.join(','))}`)
    .then((r) => {
      const now = Date.now();
      for (const n of names) cache.set(n.toLowerCase(), { look: r.looks[n] ?? null, at: now });
      emit();
    })
    .catch(() => {});
  if (pending.size > 0) timer = window.setTimeout(flush, 50);
}

function request(name: string): void {
  const hit = cache.get(name.toLowerCase());
  if (hit && Date.now() - hit.at < TTL) return;
  pending.add(name);
  if (timer === null) timer = window.setTimeout(flush, 30);
}

export function invalidateLook(name: string): void {
  cache.delete(name.toLowerCase());
  request(name);
}

export function peekLook(name: string): Look | null {
  return cache.get(name.toLowerCase())?.look ?? null;
}

const subscribe = (fn: () => void): (() => void) => {
  listeners.add(fn);
  return () => listeners.delete(fn);
};

/** Aspecto de un jugador (null mientras llega o si es un bot). */
export function useLook(name: string | null | undefined, enabled = true): Look | null {
  useSyncExternalStore(subscribe, () => version, () => 0);
  useEffect(() => {
    if (name && enabled) request(name);
  }, [name, enabled]);
  return name && enabled ? peekLook(name) : null;
}
