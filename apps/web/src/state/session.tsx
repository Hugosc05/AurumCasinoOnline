import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { api } from '../lib/api';
import { audio } from '../lib/audio';
import { speedFor, type MotionLevel } from '../lib/anim/tokens';
import { socket } from '../lib/ws';
import type { Balance, Preferences, User } from './types';

const DEFAULT_PREFS: Preferences = { sound: false, volume: 0.6, music: false, animations: 'full', effects: 'full', showOddsNotes: true };
const GUEST_KEY = 'aurum.guestPrefs';

interface SessionValue {
  user: User | null;
  loading: boolean;
  prefs: Preferences;
  motion: MotionLevel;
  /** Nivel efectivo de efectos visuales (partículas): nunca supera el nivel de movimiento. */
  effects: MotionLevel;
  speed: number;
  login(identifier: string, password: string): Promise<User>;
  register(username: string, email: string, password: string): Promise<User>;
  logout(): Promise<void>;
  refresh(): Promise<void>;
  setBalance(b: Balance): void;
  updatePrefs(patch: Partial<Preferences>): Promise<void>;
}

const SessionContext = createContext<SessionValue | null>(null);

function readGuestPrefs(): Preferences {
  try {
    const raw = localStorage.getItem(GUEST_KEY);
    return raw ? { ...DEFAULT_PREFS, ...(JSON.parse(raw) as Partial<Preferences>) } : DEFAULT_PREFS;
  } catch {
    return DEFAULT_PREFS;
  }
}

function useOsReducedMotion(): boolean {
  const [reduced, setReduced] = useState(() => typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches);
  useEffect(() => {
    const mq = window.matchMedia?.('(prefers-reduced-motion: reduce)');
    if (!mq) return;
    const on = (): void => setReduced(mq.matches);
    mq.addEventListener('change', on);
    return () => mq.removeEventListener('change', on);
  }, []);
  return reduced;
}

export function SessionProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const [guestPrefs, setGuestPrefs] = useState<Preferences>(readGuestPrefs);
  const osReduced = useOsReducedMotion();

  const refresh = useCallback(async () => {
    try {
      const r = await api.get<{ user: User | null }>('/api/auth/me');
      setUser(r.user);
    } catch {
      setUser(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
    socket.connect();
  }, [refresh]);

  // Saldo empujado por el servidor (póker, ajustes de administración).
  useEffect(
    () =>
      socket.on('balance', (m) => {
        setUser((u) => (u ? { ...u, balance: m.balance as number | null, unlimited: Boolean(m.unlimited) } : u));
      }),
    [],
  );

  const prefs = user?.preferences ?? guestPrefs;
  const motion: MotionLevel = prefs.animations === 'off' ? 'off' : osReduced || prefs.animations === 'reduced' ? 'reduced' : 'full';
  const rank = { off: 0, reduced: 1, full: 2 } as const;
  const wantedEffects: MotionLevel = prefs.effects ?? 'full';
  const effects: MotionLevel = rank[wantedEffects] <= rank[motion] ? wantedEffects : motion;

  useEffect(() => {
    audio.configure(prefs.sound, prefs.volume);
  }, [prefs.sound, prefs.volume]);

  // Desbloquea el audio en la primera interacción (nunca antes).
  useEffect(() => {
    const unlock = (): void => audio.unlock();
    window.addEventListener('pointerdown', unlock, { once: true });
    window.addEventListener('keydown', unlock, { once: true });
    return () => {
      window.removeEventListener('pointerdown', unlock);
      window.removeEventListener('keydown', unlock);
    };
  }, []);

  useEffect(() => {
    document.documentElement.dataset.motion = motion;
  }, [motion]);

  const login = useCallback(async (identifier: string, password: string) => {
    const r = await api.post<{ user: User }>('/api/auth/login', { identifier, password });
    setUser(r.user);
    socket.reconnect();
    return r.user;
  }, []);

  const register = useCallback(async (username: string, email: string, password: string) => {
    const r = await api.post<{ user: User }>('/api/auth/register', { username, email, password });
    setUser(r.user);
    socket.reconnect();
    return r.user;
  }, []);

  const logout = useCallback(async () => {
    await api.post('/api/auth/logout');
    setUser(null);
    socket.reconnect();
  }, []);

  const setBalance = useCallback((b: Balance) => {
    setUser((u) => (u ? { ...u, balance: b.balance, unlimited: b.unlimited } : u));
  }, []);

  const updatePrefs = useCallback(
    async (patch: Partial<Preferences>) => {
      if (!user) {
        const next = { ...guestPrefs, ...patch };
        setGuestPrefs(next);
        try {
          localStorage.setItem(GUEST_KEY, JSON.stringify(next));
        } catch {
          /* almacenamiento no disponible: solo en memoria */
        }
        return;
      }
      setUser((u) => (u ? { ...u, preferences: { ...u.preferences, ...patch } } : u));
      const r = await api.patch<{ preferences: Preferences }>('/api/me/preferences', patch);
      setUser((u) => (u ? { ...u, preferences: r.preferences } : u));
    },
    [user, guestPrefs],
  );

  const value = useMemo<SessionValue>(
    () => ({ user, loading, prefs, motion, effects, speed: speedFor(motion), login, register, logout, refresh, setBalance, updatePrefs }),
    [user, loading, prefs, motion, effects, login, register, logout, refresh, setBalance, updatePrefs],
  );
  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}

export function useSession(): SessionValue {
  const v = useContext(SessionContext);
  if (!v) throw new Error('useSession fuera de SessionProvider');
  return v;
}
