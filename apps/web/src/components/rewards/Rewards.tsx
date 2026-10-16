import { AnimatePresence, motion } from 'motion/react';
import { CalendarCheck, Check, Clapperboard, LifeBuoy, TriangleAlert } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { ApiError, api } from '../../lib/api';
import { audio } from '../../lib/audio';
import { credits, cx } from '../../lib/format';
import { useNotify } from '../../state/notify';
import { useSession } from '../../state/session';
import type { Balance } from '../../state/types';
import { Celebration, type CelebrationHandle } from '../Celebration';
import { Button, Modal } from '../ui';

export interface DailyInfo {
  day: string;
  timezone: string;
  claimed: boolean;
  amount: number;
  base: number;
  streak: { enabled: boolean; days: number; maxSteps: number; step: number; bonus: number };
  nextResetAt: string;
  msUntilReset: number;
  history: { day: string; amount: number; at: string }[];
}

export interface AdsInfo {
  mode: 'none' | 'dev-simulation' | 'signed-callback';
  available: boolean;
  reward: number;
  dailyLimit: number;
  remainingToday: number;
  minWatchSeconds: number;
  label: string | null;
  message: string | null;
}

export interface Promotions {
  day: string;
  daily: DailyInfo;
  demoRefill: { amount: number; threshold: number; claimed: boolean; eligible: boolean };
  ads: AdsInfo;
}

/** Carga las promociones. El reinicio se calcula con el tiempo restante que da el servidor (no con el reloj del equipo). */
export function usePromotions() {
  const { user } = useSession();
  const [promo, setPromo] = useState<(Promotions & { resetAtLocal: number }) | null>(null);
  const [error, setError] = useState(false);
  const load = useCallback(() => {
    if (!user || user.unlimited) return;
    setError(false);
    api.get<Promotions>('/api/me/promotions')
      .then((p) => setPromo({ ...p, resetAtLocal: Date.now() + p.daily.msUntilReset }))
      .catch(() => setError(true));
  }, [user]);
  useEffect(load, [load]);
  return { promo, reload: load, error };
}

function useCountdown(target: number | null): string | null {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    if (!target) return;
    const t = window.setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [target]);
  if (!target) return null;
  const ms = Math.max(0, target - now);
  const h = Math.floor(ms / 3600_000);
  const m = Math.floor((ms % 3600_000) / 60_000);
  const s = Math.floor((ms % 60_000) / 1000);
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

/** Contador que sube hasta el importe al cobrar. */
function CountUp({ value, run }: { value: number; run: boolean }) {
  const [v, setV] = useState(run ? 0 : value);
  useEffect(() => {
    if (!run) {
      setV(value);
      return;
    }
    const start = performance.now();
    let raf = 0;
    const tick = (t: number): void => {
      const k = Math.min(1, (t - start) / 900);
      setV(Math.round(value * (1 - (1 - k) ** 3)));
      if (k < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [value, run]);
  return <>{credits(v)}</>;
}

export function DailyRewardCard({ promo, onChanged, compact = false }: { promo: Promotions & { resetAtLocal: number }; onChanged: () => void; compact?: boolean }) {
  const { setBalance, effects } = useSession();
  const { notify } = useNotify();
  const [busy, setBusy] = useState(false);
  const [justClaimed, setJustClaimed] = useState<number | null>(null);
  const fx = useRef<CelebrationHandle>(null);
  const d = promo.daily;
  const countdown = useCountdown(d.claimed ? promo.resetAtLocal : null);

  const claim = async (): Promise<void> => {
    if (busy || d.claimed) return; // evita dobles clics; el servidor también lo impide
    setBusy(true);
    try {
      const r = await api.post<{ balance: Balance; amount: number }>('/api/me/promotions/daily-bonus');
      setBalance(r.balance);
      setJustClaimed(r.amount);
      audio.play('winMedium');
      audio.play('coins', 200);
      fx.current?.play('burst', [{ x: 0.5, y: 0.45 }]);
      notify('success', `Recompensa diaria: +${credits(r.amount)} créditos.`);
      onChanged();
    } catch (err) {
      notify('error', err instanceof ApiError ? err.message : 'No se pudo reclamar.');
      onChanged();
    } finally {
      setBusy(false);
    }
  };

  // Últimos 7 días (el actual a la derecha) para la racha.
  const claimedDays = new Set(d.history.map((h) => h.day));
  const days = Array.from({ length: 7 }, (_, i) => {
    const t = new Date(`${d.day}T12:00:00Z`);
    t.setUTCDate(t.getUTCDate() - (6 - i));
    return t.toISOString().slice(0, 10);
  });

  return (
    <article className={cx('panel arch relative flex flex-col items-center overflow-hidden text-center', compact ? 'px-5 pb-6 pt-8' : 'px-8 pb-8 pt-12')} data-testid="daily-card">
      <Celebration ref={fx} level={effects} />
      <CalendarCheck className="h-10 w-10 text-oro" />
      <h2 className={cx('mt-3 text-marfil', compact ? 'text-2xl' : 'text-3xl')}>Recompensa diaria</h2>
      <p className="mt-2 text-sm text-niebla">Una vez al día (horario de {d.timezone.replace('_', ' ')}). Reclamarla varios días seguidos suma un extra; saltarte un día no te quita lo acumulado de golpe.</p>
      <p className="mt-5 font-display text-5xl gold-text" data-testid="daily-amount">
        +<CountUp value={justClaimed ?? d.amount} run={justClaimed !== null} />
      </p>
      {d.streak.enabled && (
        <div className="mt-3 flex items-center gap-1.5" aria-label={`Días reclamados en la última semana: ${d.streak.days + (d.claimed ? 1 : 0)}`}>
          {days.map((day) => {
            const done = claimedDays.has(day);
            const isToday = day === d.day;
            return (
              <span key={day} className={cx('grid h-6 w-6 place-items-center rounded-full border text-[10px]', done ? 'border-oro bg-oro/80 text-noche' : isToday ? 'border-oro-claro text-oro-claro' : 'border-white/15 text-niebla')} title={day}>
                {done ? <Check className="h-3.5 w-3.5" /> : new Date(`${day}T12:00:00Z`).getUTCDate()}
              </span>
            );
          })}
        </div>
      )}
      {d.streak.enabled && !d.claimed && d.streak.bonus > 0 && <p className="mt-2 text-xs text-oro-claro">Incluye +{credits(d.streak.bonus)} por {d.streak.days} {d.streak.days === 1 ? 'día' : 'días'} de la última semana</p>}
      <AnimatePresence mode="wait">
        {d.claimed ? (
          <motion.div key="done" initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} className="mt-5 flex flex-col items-center gap-1" role="status">
            <span className="inline-flex items-center gap-1.5 rounded-full border border-exito/40 bg-exito/10 px-3 py-1 text-sm text-exito"><Check className="h-4 w-4" /> Reclamada hoy</span>
            <span className="text-xs text-niebla">Próxima en <span className="font-mono text-marfil" data-testid="daily-countdown">{countdown}</span></span>
          </motion.div>
        ) : (
          <motion.div key="claim" initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="mt-5">
            <Button onClick={() => void claim()} loading={busy} data-testid="claim-daily">Reclamar recompensa</Button>
          </motion.div>
        )}
      </AnimatePresence>
      {!compact && d.history.length > 0 && (
        <details className="mt-5 w-full text-left text-xs text-niebla">
          <summary className="cursor-pointer text-center">Historial de recompensas</summary>
          <ul className="mt-2 space-y-1">
            {d.history.map((h) => (
              <li key={h.day} className="flex justify-between"><span>{new Date(h.at).toLocaleString('es-ES')}</span><span className="text-marfil">+{credits(h.amount)}</span></li>
            ))}
          </ul>
        </details>
      )}
    </article>
  );
}

export function DemoRefillCard({ promo, onChanged, compact = false }: { promo: Promotions; onChanged: () => void; compact?: boolean }) {
  const { setBalance } = useSession();
  const { notify } = useNotify();
  const [busy, setBusy] = useState(false);
  const r = promo.demoRefill;
  const claim = async (): Promise<void> => {
    if (busy) return;
    setBusy(true);
    try {
      const out = await api.post<{ balance: Balance }>('/api/me/promotions/demo-refill');
      setBalance(out.balance);
      audio.play('winSmall');
      notify('success', 'Recarga de demostración añadida.');
      onChanged();
    } catch (err) {
      notify('error', err instanceof ApiError ? err.message : 'No se pudo recargar.');
    } finally {
      setBusy(false);
    }
  };
  return (
    <article className={cx('panel arch flex flex-col items-center text-center', compact ? 'px-5 pb-6 pt-8' : 'px-8 pb-8 pt-12')}>
      <LifeBuoy className="h-10 w-10 text-oro" />
      <h2 className={cx('mt-3 text-marfil', compact ? 'text-2xl' : 'text-3xl')}>Recarga de demostración</h2>
      <p className="mt-2 text-sm text-niebla">Si tu saldo baja de {credits(r.threshold)}, recupera {credits(r.amount)} créditos una vez al día. Queda registrada en tus movimientos.</p>
      <p className="mt-5 font-display text-5xl gold-text">+{credits(r.amount)}</p>
      <Button
        className="mt-5"
        variant="outline"
        onClick={() => void claim()}
        loading={busy}
        disabled={r.claimed || !r.eligible}
        disabledReason={r.claimed ? 'Ya la has usado hoy' : `Disponible con saldo inferior a ${credits(r.threshold)}`}
      >
        {r.claimed ? 'Usada hoy' : r.eligible ? 'Recargar' : `Disponible con saldo < ${credits(r.threshold)}`}
      </Button>
    </article>
  );
}

/**
 * Anuncio recompensado. Sin proveedor configurado, se dice claramente que no
 * están disponibles. Nunca se muestra nada que imite un anuncio real: la
 * simulación de desarrollo va etiquetada como tal.
 */
export function RewardedAdCard({ ads, onChanged, compact = false }: { ads: AdsInfo; onChanged: () => void; compact?: boolean }) {
  const { setBalance } = useSession();
  const { notify } = useNotify();
  const [session, setSession] = useState<{ id: string; endsAt: number; mode: AdsInfo['mode'] } | null>(null);
  const [busy, setBusy] = useState(false);
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    if (!session) return;
    const t = window.setInterval(() => setNow(Date.now()), 250);
    return () => clearInterval(t);
  }, [session]);

  // Proveedor real: la confirmación llega por el servidor; aquí solo se consulta el estado.
  useEffect(() => {
    if (!session || session.mode !== 'signed-callback') return;
    const t = window.setInterval(async () => {
      try {
        const st = await api.get<{ status: string; reward: number }>(`/api/ads/sessions/${session.id}`);
        if (st.status === 'rewarded') {
          setSession(null);
          notify('success', `Anuncio completado: +${credits(st.reward)} créditos.`);
          onChanged();
        } else if (st.status !== 'started') {
          setSession(null);
          onChanged();
        }
      } catch {
        /* se reintenta */
      }
    }, 2000);
    return () => clearInterval(t);
  }, [session, notify, onChanged]);

  const start = async (): Promise<void> => {
    setBusy(true);
    try {
      const s = await api.post<{ sessionId: string; minWatchSeconds: number; mode: AdsInfo['mode'] }>('/api/ads/sessions');
      setSession({ id: s.sessionId, endsAt: Date.now() + s.minWatchSeconds * 1000 + 300, mode: s.mode });
    } catch (err) {
      notify('error', err instanceof ApiError ? err.message : 'No se pudo iniciar.');
    } finally {
      setBusy(false);
    }
  };

  const finishSimulation = async (): Promise<void> => {
    if (!session) return;
    setBusy(true);
    try {
      const r = await api.post<{ balance: Balance; reward: number }>(`/api/ads/sessions/${session.id}/complete`);
      setBalance(r.balance);
      audio.play('winSmall');
      notify('success', `Simulación completada: +${credits(r.reward)} créditos.`);
      setSession(null);
      onChanged();
    } catch (err) {
      notify('error', err instanceof ApiError ? err.message : 'No se pudo completar.');
    } finally {
      setBusy(false);
    }
  };

  const remaining = session ? Math.max(0, Math.ceil((session.endsAt - now) / 1000)) : 0;
  const isSim = ads.mode === 'dev-simulation';

  return (
    <article className={cx('panel arch flex flex-col items-center text-center', compact ? 'px-5 pb-6 pt-8' : 'px-8 pb-8 pt-12')} data-testid="ads-card">
      <Clapperboard className="h-10 w-10 text-oro" />
      <h2 className={cx('mt-3 text-marfil', compact ? 'text-2xl' : 'text-3xl')}>Anuncio recompensado</h2>
      {ads.mode === 'none' ? (
        <p className="mt-3 text-sm text-niebla" role="status">Los anuncios recompensados no están disponibles en este entorno.</p>
      ) : (
        <>
          {isSim && (
            <p className="mt-2 inline-flex items-center gap-1.5 rounded-full border border-aviso/50 bg-aviso/10 px-3 py-1 text-xs text-aviso">
              <TriangleAlert className="h-3.5 w-3.5" /> Modo de prueba de desarrollo: no es un anuncio real
            </p>
          )}
          <p className="mt-2 text-sm text-niebla">
            Créditos virtuales gratuitos, sin valor económico. Te quedan {ads.remainingToday} de {ads.dailyLimit} hoy.
          </p>
          <p className="mt-5 font-display text-5xl gold-text">+{credits(ads.reward)}</p>
          <Button className="mt-5" variant="outline" onClick={() => void start()} loading={busy && !session} disabled={!ads.available} disabledReason={ads.message ?? undefined}>
            {isSim ? 'Iniciar simulación' : 'Ver anuncio'}
          </Button>
          {ads.message && <p className="mt-2 text-xs text-niebla">{ads.message}</p>}
        </>
      )}
      <Modal open={!!session} onClose={() => setSession(null)} title={isSim ? 'Simulación de anuncio (desarrollo)' : 'Anuncio recompensado'}>
        {session && isSim && (
          <div className="flex flex-col items-center gap-4 text-center">
            <div className="grid h-40 w-full place-items-center rounded-xl border-2 border-dashed border-aviso/50 bg-aviso/5 text-aviso">
              <div>
                <p className="text-sm font-semibold uppercase tracking-wide">Simulación de desarrollo</p>
                <p className="text-xs">Aquí se mostraría el anuncio del proveedor configurado.</p>
                <p className="mt-3 font-display text-4xl" aria-live="polite">{remaining > 0 ? `${remaining} s` : 'Listo'}</p>
              </div>
            </div>
            <p className="text-xs text-niebla">El servidor comprueba el tiempo mínimo y el límite diario antes de conceder los créditos.</p>
            <Button onClick={() => void finishSimulation()} loading={busy} disabled={remaining > 0} disabledReason="Espera a que termine la simulación">
              Reclamar +{credits(ads.reward)}
            </Button>
          </div>
        )}
        {session && !isSim && (
          <div className="space-y-3 text-center text-sm text-niebla">
            <p>El anuncio lo muestra el proveedor configurado. Los créditos se añaden cuando su servidor confirma que lo has visto completo.</p>
            <p className="text-xs">Esperando confirmación…</p>
          </div>
        )}
      </Modal>
    </article>
  );
}
