import { useNavigate } from 'react-router-dom';
import { DailyRewardCard, DemoRefillCard, RewardedAdCard, usePromotions } from '../components/rewards/Rewards';
import { Button, ErrorBox, Spinner } from '../components/ui';
import { useSession } from '../state/session';

export default function PromotionsPage() {
  const { user } = useSession();
  const nav = useNavigate();
  const { promo, reload, error } = usePromotions();

  return (
    <div className="mx-auto max-w-6xl px-4 py-10 sm:px-6">
      <h1 className="text-5xl text-marfil">Promociones</h1>
      <p className="mt-2 max-w-2xl text-niebla">Todas las promociones de Aurum dan créditos virtuales gratuitos. No hay compras, depósitos ni condiciones ocultas, y los créditos no se pueden canjear por dinero.</p>
      {!user ? (
        <div className="panel mt-8 flex flex-wrap items-center justify-between gap-4 p-6">
          <p className="text-marfil">Inicia sesión para reclamar tus créditos diarios.</p>
          <Button onClick={() => nav('/entrar', { state: { from: '/promociones' } })}>Entrar</Button>
        </div>
      ) : user.unlimited ? (
        <p className="panel mt-8 p-6 text-niebla">Tu cuenta de administración tiene saldo ilimitado: las promociones no aplican.</p>
      ) : error ? (
        <div className="mt-8"><ErrorBox message="No se pudieron cargar las promociones." onRetry={reload} /></div>
      ) : !promo ? (
        <Spinner />
      ) : (
        <div className="mt-8 grid gap-6 md:grid-cols-2 lg:grid-cols-3">
          <DailyRewardCard promo={promo} onChanged={reload} />
          <DemoRefillCard promo={promo} onChanged={reload} />
          <RewardedAdCard ads={promo.ads} onChanged={reload} />
        </div>
      )}
    </div>
  );
}
