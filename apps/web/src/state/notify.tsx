import { AnimatePresence, motion } from 'motion/react';
import { AlertCircle, Award, CheckCircle2, Info, X } from 'lucide-react';
import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import { audio } from '../lib/audio';
import { socket } from '../lib/ws';
import type { Achievement } from './types';
import { useSession } from './session';

type Kind = 'error' | 'info' | 'success';
interface Toast {
  id: number;
  kind: Kind;
  message: string;
}

interface NotifyValue {
  notify(kind: Kind, message: string): void;
  celebrate(achievements: Achievement[]): void;
}

const NotifyContext = createContext<NotifyValue | null>(null);

const TIER_STYLE: Record<Achievement['tier'], string> = {
  bronze: 'from-[#8a5a32] to-[#c48a52]',
  silver: 'from-[#7d8696] to-[#d4d9e2]',
  gold: 'from-oro-oscuro to-oro-claro',
};

export function NotifyProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const [queue, setQueue] = useState<Achievement[]>([]);
  const idRef = useRef(1);
  const { speed } = useSession();

  const notify = useCallback((kind: Kind, message: string) => {
    const id = idRef.current++;
    setToasts((t) => [...t.slice(-3), { id, kind, message }]);
    if (kind === 'error') audio.play('error');
    window.setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), kind === 'error' ? 6000 : 4000);
  }, []);

  const celebrate = useCallback((list: Achievement[]) => {
    if (list.length) setQueue((q) => [...q, ...list]);
  }, []);

  useEffect(() => socket.on('achievements', (m) => celebrate(m.achievements as Achievement[])), [celebrate]);
  useEffect(() => socket.on('poker.notice', (m) => notify('info', String(m.message))), [notify]);
  useEffect(() => socket.on('bj.notice', (m) => notify('info', String(m.message))), [notify]);

  const current = queue[0];
  useEffect(() => {
    if (!current) return;
    audio.play('achievement');
    const t = window.setTimeout(() => setQueue((q) => q.slice(1)), speed === 0 ? 2500 : 3600);
    return () => clearTimeout(t);
  }, [current, speed]);

  return (
    <NotifyContext.Provider value={{ notify, celebrate }}>
      {children}
      <div className="pointer-events-none fixed inset-x-0 bottom-4 z-[60] flex flex-col items-center gap-2 px-4" aria-live="polite">
        <AnimatePresence>
          {toasts.map((t) => (
            <motion.div
              key={t.id}
              initial={{ opacity: 0, y: 16 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: 8 }}
              className="pointer-events-auto flex max-w-md items-start gap-3 rounded-xl border border-linea bg-abismo/95 px-4 py-3 text-sm text-marfil shadow-hondo backdrop-blur"
              role={t.kind === 'error' ? 'alert' : 'status'}
            >
              {t.kind === 'error' ? <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-rubi" /> : t.kind === 'success' ? <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-exito" /> : <Info className="mt-0.5 h-4 w-4 shrink-0 text-oro" />}
              <span className="flex-1">{t.message}</span>
              <button className="text-niebla hover:text-marfil" onClick={() => setToasts((x) => x.filter((y) => y.id !== t.id))} aria-label="Cerrar aviso">
                <X className="h-4 w-4" />
              </button>
            </motion.div>
          ))}
        </AnimatePresence>
      </div>
      <div className="pointer-events-none fixed inset-x-0 top-20 z-[70] flex justify-center px-4" aria-live="polite">
        <AnimatePresence>
          {current && (
            <motion.div
              key={current.id + (current.unlockedAt ?? '')}
              initial={{ opacity: 0, y: -24, scale: 0.92 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: -12, scale: 0.98 }}
              transition={{ type: 'spring', stiffness: 320, damping: 26 }}
              className="relative flex items-center gap-4 overflow-hidden rounded-2xl border border-oro/40 bg-abismo/95 px-5 py-4 shadow-oro backdrop-blur"
              role="status"
            >
              <motion.div
                className="pointer-events-none absolute inset-y-0 -left-1/2 w-1/2 bg-gradient-to-r from-transparent via-oro-claro/15 to-transparent"
                initial={{ x: 0 }}
                animate={{ x: '400%' }}
                transition={{ duration: 1.4, ease: 'easeOut', delay: 0.2 }}
              />
              <div className={`grid h-12 w-12 place-items-center rounded-full bg-gradient-to-br ${TIER_STYLE[current.tier]} text-noche shadow-inner`}>
                <Award className="h-6 w-6" />
              </div>
              <div>
                <p className="text-xs text-oro-claro">Logro desbloqueado</p>
                <p className="font-display text-lg text-marfil">{current.title}</p>
                <p className="text-sm text-niebla">{current.description}</p>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </NotifyContext.Provider>
  );
}

export function useNotify(): NotifyValue {
  const v = useContext(NotifyContext);
  if (!v) throw new Error('useNotify fuera de NotifyProvider');
  return v;
}
