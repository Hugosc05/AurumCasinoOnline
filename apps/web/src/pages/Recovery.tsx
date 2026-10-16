import { Eye, Home } from 'lucide-react';
import { Link } from 'react-router-dom';
import { DailyRewardCard, DemoRefillCard, RewardedAdCard, usePromotions } from '../components/rewards/Rewards';
import { Button, ErrorBox, Spinner } from '../components/ui';
import { credits } from '../lib/format';
import { useSession } from '../state/session';

/** Pantalla de recuperación cuando el saldo se agota: todas las vías gratuitas, sin presiones. */
export function RecoveryContent({ compact = false, onClose }: { compact?: boolean; onClose?: () => void }) {
  const { user } = useSession();
  const { promo, reload, error } = usePromotions();
  return (
    <div>
      <p className="text-niebla">
        Tu saldo es de <span className="text-marfil">{credits(user?.balance ?? 0)}</span> créditos. Son créditos virtuales sin valor económico: puedes recuperar algunos gratis con estas opciones.
      </p>
      {error ? (
        <div className="mt-6"><ErrorBox message="No se pudieron cargar las opciones." onRetry={reload} /></div>
      ) : !promo ? (
        <Spinner />
      ) : (
        <div className="mt-6 grid gap-4 md:grid-cols-3">
          <DailyRewardCard promo={promo} onChanged={reload} compact />
          <DemoRefillCard promo={promo} onChanged={reload} compact />
          <RewardedAdCard ads={promo.ads} onChanged={reload} compact />
        </div>
      )}
      <div className="panel mt-4 flex flex-wrap items-center gap-3 p-4 text-sm">
        <Eye className="h-5 w-5 text-oro" />
        <p className="flex-1 text-niebla">Mientras tanto, puedes observar gratis las mesas en directo de póker y blackjack.</p>
        <Link to="/poker" onClick={onClose} className="text-oro-claro hover:underline">Póker</Link>
        <Link to="/blackjack" onClick={onClose} className="text-oro-claro hover:underline">Blackjack</Link>
      </div>
      <div className="mt-5 flex justify-center gap-3">
        <Link to="/" onClick={onClose}><Button variant="ghost"><Home className="h-4 w-4" /> Volver al inicio</Button></Link>
        {compact && onClose && <Button variant="outline" onClick={onClose}>Cerrar</Button>}
      </div>
    </div>
  );
}

export default function RecoveryPage() {
  return (
    <div className="mx-auto max-w-6xl px-4 py-10 sm:px-6">
      <h1 className="text-4xl text-marfil sm:text-5xl">Te has quedado sin créditos</h1>
      <div className="mt-4"><RecoveryContent /></div>
    </div>
  );
}
