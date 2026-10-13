import { CalendarCheck, LifeBuoy } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Button, Spinner } from '../components/ui';
import { ApiError, api } from '../lib/api';
import { audio } from '../lib/audio';
import { credits } from '../lib/format';
import { useNotify } from '../state/notify';
import { useSession } from '../state/session';
import type { Balance } from '../state/types';

interface Promo {
  day: string;
  dailyBonus: { amount: number; claimed: boolean };
  demoRefill: { amount: number; threshold: number; claimed: boolean; eligible: boolean };
}

export default function PromotionsPage() {
  const { user, setBalance } = useSession();
  const { notify } = useNotify();
  const nav = useNavigate();
  const [promo, setPromo] = useState<Promo | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(() => {
    if (user) api.get<Promo>('/api/me/promotions').then(setPromo).catch(() => {});
  }, [user]);
  useEffect(load, [load]);

  const claim = async (kind: 'daily-bonus' | 'demo-refill'): Promise<void> => {
    setBusy(kind);
    try {
      const r = await api.post<{ balance: Balance }>(`/api/me/promotions/${kind}`);
      setBalance(r.balance);
      audio.play('winSmall');
      notify('success', kind === 'daily-bonus' ? 'Bono diario añadido a tu saldo.' : 'Recarga de demostración añadida.');
      load();
    } catch (err) {
      notify('error', err instanceof ApiError ? err.message : 'No se pudo reclamar.');
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="mx-auto max-w-5xl px-4 py-10 sm:px-6">
      <h1 className="text-5xl text-marfil">Promociones</h1>
      <p className="mt-2 max-w-2xl text-niebla">Todas las promociones de Aurum dan créditos virtuales gratuitos. No hay compras, depósitos ni condiciones ocultas, y los créditos no se pueden canjear por dinero.</p>
      {!user ? (
        <div className="panel mt-8 flex flex-wrap items-center justify-between gap-4 p-6">
          <p className="text-marfil">Inicia sesión para reclamar tus créditos diarios.</p>
          <Button onClick={() => nav('/entrar', { state: { from: '/promociones' } })}>Entrar</Button>
        </div>
      ) : user.unlimited ? (
        <p className="panel mt-8 p-6 text-niebla">Tu cuenta de administración tiene saldo ilimitado: las promociones no aplican.</p>
      ) : !promo ? (
        <Spinner />
      ) : (
        <div className="mt-8 grid gap-6 md:grid-cols-2">
          <article className="panel arch flex flex-col items-center px-8 pb-8 pt-12 text-center">
            <CalendarCheck className="h-10 w-10 text-oro" />
            <h2 className="mt-4 text-3xl text-marfil">Bono diario</h2>
            <p className="mt-2 text-niebla">Una vez al día, {credits(promo.dailyBonus.amount)} créditos para seguir jugando.</p>
            <p className="mt-6 font-display text-5xl gold-text">+{credits(promo.dailyBonus.amount)}</p>
            <Button className="mt-6" onClick={() => void claim('daily-bonus')} loading={busy === 'daily-bonus'} disabled={promo.dailyBonus.claimed} disabledReason="Ya lo has reclamado hoy">
              {promo.dailyBonus.claimed ? 'Reclamado hoy' : 'Reclamar bono'}
            </Button>
          </article>
          <article className="panel arch flex flex-col items-center px-8 pb-8 pt-12 text-center">
            <LifeBuoy className="h-10 w-10 text-oro" />
            <h2 className="mt-4 text-3xl text-marfil">Recarga de demostración</h2>
            <p className="mt-2 text-niebla">Si tu saldo baja de {credits(promo.demoRefill.threshold)}, recupera {credits(promo.demoRefill.amount)} créditos una vez al día. Queda registrada en tus movimientos.</p>
            <p className="mt-6 font-display text-5xl gold-text">+{credits(promo.demoRefill.amount)}</p>
            <Button
              className="mt-6"
              variant="outline"
              onClick={() => void claim('demo-refill')}
              loading={busy === 'demo-refill'}
              disabled={promo.demoRefill.claimed || !promo.demoRefill.eligible}
              disabledReason={promo.demoRefill.claimed ? 'Ya la has usado hoy' : `Disponible con saldo inferior a ${credits(promo.demoRefill.threshold)}`}
            >
              {promo.demoRefill.claimed ? 'Usada hoy' : promo.demoRefill.eligible ? 'Recargar' : `Disponible con saldo < ${credits(promo.demoRefill.threshold)}`}
            </Button>
          </article>
        </div>
      )}
    </div>
  );
}
