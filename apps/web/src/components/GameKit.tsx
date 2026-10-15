import { motion } from 'motion/react';
import { FastForward, Info } from 'lucide-react';
import { useEffect, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { audio } from '../lib/audio';
import { credits, cx } from '../lib/format';
import { useSession } from '../state/session';
import { CHIP_DENOMS, Chip } from './Chip';

/** Cabecera común de cada juego: nombre, saldo y accesos a reglas. */
export function GameHeader({ title, subtitle, children }: { title: string; subtitle: string; children?: ReactNode }) {
  return (
    <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
      <div>
        <h1 className="text-4xl text-marfil sm:text-5xl">{title}</h1>
        <p className="mt-1 text-sm text-niebla">{subtitle}</p>
      </div>
      <div className="flex items-center gap-2">
        {children}
        <Link to="/reglas" className="inline-flex items-center gap-1.5 rounded-full border border-linea px-3 py-1.5 text-sm text-niebla hover:border-oro/50 hover:text-marfil">
          <Info className="h-4 w-4" /> Reglas y pagos
        </Link>
      </div>
    </div>
  );
}

/** Selector de ficha (denominación activa). */
export function ChipRack({ value, onChange, max, disabled, values }: { value: number; onChange: (v: number) => void; max?: number | null; disabled?: boolean; values?: number[] }) {
  const list = (values ?? CHIP_DENOMS.map((d) => d.value)).filter((v) => max === undefined || max === null || v <= Math.max(max, CHIP_DENOMS[0]!.value));
  return (
    <div role="radiogroup" aria-label="Valor de la ficha" className="flex flex-wrap items-center gap-2">
      {list.map((v) => {
        const active = v === value;
        return (
          <motion.button
            key={v}
            role="radio"
            aria-checked={active}
            aria-label={`Ficha de ${credits(v)}`}
            disabled={disabled}
            data-chip={v}
            onClick={() => {
              audio.play('chip');
              onChange(v);
            }}
            animate={{ y: active ? -8 : 0, scale: active ? 1.08 : 1 }}
            whileHover={disabled ? undefined : { y: active ? -10 : -4 }}
            whileTap={{ scale: 0.94 }}
            transition={{ type: 'spring', stiffness: 500, damping: 26 }}
            className={cx('rounded-full disabled:opacity-40', active && 'ring-2 ring-oro-claro ring-offset-2 ring-offset-noche')}
          >
            <Chip value={v} size={46} />
          </motion.button>
        );
      })}
    </div>
  );
}

/** Botón y tecla (Espacio) para saltar animaciones largas. */
export function SkipButton({ visible, onSkip }: { visible: boolean; onSkip: () => void }) {
  useEffect(() => {
    if (!visible) return;
    const onKey = (e: KeyboardEvent): void => {
      if (e.code === 'Space' && !(e.target instanceof HTMLInputElement)) {
        e.preventDefault();
        onSkip();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [visible, onSkip]);
  if (!visible) return null;
  return (
    <button onClick={onSkip} className="inline-flex items-center gap-1.5 rounded-full border border-white/15 bg-black/70 px-3 py-1.5 text-xs text-marfil hover:bg-black/80">
      <FastForward className="h-3.5 w-3.5" /> Saltar <kbd className="ml-1 rounded border border-white/20 px-1 text-[10px] text-niebla">Espacio</kbd>
    </button>
  );
}

export function BalanceLine({ pendingBet = 0 }: { pendingBet?: number }) {
  const { user } = useSession();
  if (!user) return null;
  return (
    <div className="flex items-baseline gap-4 text-sm">
      <span className="text-niebla">
        Saldo <span className="font-display text-xl text-oro-claro">{credits(user.unlimited ? null : user.balance)}</span>
      </span>
      {pendingBet > 0 && (
        <span className="text-niebla">
          Apuesta <span className="font-display text-xl text-marfil">{credits(pendingBet)}</span>
        </span>
      )}
    </div>
  );
}

/** Nota discreta: los resultados son independientes (se puede ocultar en preferencias). */
export function OddsNote() {
  const { prefs } = useSession();
  if (!prefs.showOddsNotes) return null;
  return <p className="text-xs text-niebla/80">Cada resultado es independiente del anterior. Las rachas no predicen la siguiente jugada.</p>;
}

export type Outcome = 'win' | 'lose' | 'push' | 'blackjack' | 'bust' | null;

export function OutcomeBanner({ outcome, title, amount }: { outcome: Outcome; title: string; amount?: number }) {
  if (!outcome) return null;
  const good = outcome === 'win' || outcome === 'blackjack';
  return (
    <motion.div
      key={title}
      role="status"
      initial={{ opacity: 0, scale: 0.85, y: 10 }}
      animate={{ opacity: 1, scale: 1, y: 0 }}
      exit={{ opacity: 0 }}
      transition={{ type: 'spring', stiffness: 420, damping: 24 }}
      className={cx(
        'rounded-2xl border px-6 py-3 text-center shadow-hondo',
        good ? 'border-oro/60 bg-noche/95' : outcome === 'push' ? 'border-white/20 bg-noche/90' : 'border-rubi/50 bg-noche/90',
      )}
    >
      <p className={cx('font-display text-3xl', good ? 'gold-text' : outcome === 'push' ? 'text-marfil' : 'text-[#f1a3ad]')}>{title}</p>
      {amount !== undefined && amount !== 0 && <p className="text-sm text-marfil">{amount > 0 ? `+${credits(amount)}` : credits(amount)} créditos</p>}
    </motion.div>
  );
}
