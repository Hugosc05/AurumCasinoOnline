import { useCallback, useEffect, useState } from 'react';
import { api } from '../lib/api';
import { socket } from '../lib/ws';
import { useSession } from '../state/session';

export interface Person {
  id: string;
  username: string;
}
export interface Presence {
  status: 'available' | 'playing' | 'offline';
  game: 'poker' | 'blackjack' | null;
}
export interface Overview {
  friends: (Person & { since: string; presence: Presence })[];
  incoming: { requestId: string; from: Person; at: string }[];
  outgoing: { requestId: string; to: Person; at: string }[];
}
export interface AppNotification {
  id: number;
  kind: 'friend_request' | 'friend_accepted' | 'room_invite';
  payload: Record<string, any>;
  readAt: string | null;
  createdAt: string;
}

/** Lista de amigos que se refresca sola cuando el servidor avisa de un cambio. */
export function useFriends() {
  const { user } = useSession();
  const [data, setData] = useState<Overview | null>(null);
  const load = useCallback(() => {
    if (!user) return;
    api.get<Overview>('/api/social/friends').then(setData).catch(() => undefined);
  }, [user]);
  useEffect(() => {
    load();
    const off = socket.on('friends.changed', load);
    const t = window.setInterval(load, 30_000);
    return () => {
      off();
      clearInterval(t);
    };
  }, [load]);
  return { data, reload: load };
}

export function useNotifications() {
  const { user } = useSession();
  const [items, setItems] = useState<AppNotification[]>([]);
  const [unread, setUnread] = useState(0);
  const load = useCallback(() => {
    if (!user) return;
    api.get<{ items: AppNotification[]; unread: number }>('/api/social/notifications').then((r) => {
      setItems(r.items);
      setUnread(r.unread);
    }).catch(() => undefined);
  }, [user]);
  useEffect(() => {
    load();
    const off = socket.on('notification', (m) => {
      setItems((list) => [m.notification as AppNotification, ...list].slice(0, 30));
      setUnread((n) => n + 1);
    });
    return off;
  }, [load]);
  const markAll = async (): Promise<void> => {
    await api.post('/api/social/notifications/read', {});
    setUnread(0);
    setItems((list) => list.map((n) => ({ ...n, readAt: n.readAt ?? new Date().toISOString() })));
  };
  return { items, unread, markAll, reload: load };
}

export const PRESENCE_LABEL: Record<Presence['status'], string> = { available: 'Disponible', playing: 'Jugando', offline: 'Desconectado' };
export const PRESENCE_DOT: Record<Presence['status'], string> = { available: 'bg-exito', playing: 'bg-oro', offline: 'bg-white/25' };
export const presenceText = (p: Presence): string =>
  p.status === 'playing' ? `Jugando al ${p.game === 'poker' ? 'póker' : 'blackjack'}` : PRESENCE_LABEL[p.status];
