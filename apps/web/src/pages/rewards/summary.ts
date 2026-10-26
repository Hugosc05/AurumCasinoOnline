import { useEffect, useState } from 'react';
import { api } from '../../lib/api';

/** Contadores de recompensas pendientes (para el aviso del menú). */
const listeners = new Set<() => void>();
export function emitRewardsChanged(): void {
  for (const l of listeners) l();
}

export function useRewardsSummary(enabled: boolean): { claimable: number; unopened: number } {
  const [s, setS] = useState({ claimable: 0, unopened: 0 });
  useEffect(() => {
    if (!enabled) return;
    const load = (): void => {
      api.get<{ claimable: number; unopened: number }>('/api/rewards/summary').then(setS).catch(() => {});
    };
    load();
    listeners.add(load);
    const id = window.setInterval(load, 60_000);
    return () => {
      listeners.delete(load);
      window.clearInterval(id);
    };
  }, [enabled]);
  return s;
}
