import { AnimatePresence, motion } from 'motion/react';
import { useRef, useState } from 'react';
import { Celebration, type CelebrationHandle } from '../../components/Celebration';
import { Button } from '../../components/ui';
import { ApiError, api } from '../../lib/api';
import { audio } from '../../lib/audio';
import { credits, cx } from '../../lib/format';
import { useNotify } from '../../state/notify';
import { useSession } from '../../state/session';
import type { Achievement, Balance } from '../../state/types';
import { SlotSymbolArt } from './symbols';

export interface BonusView {
  machine: string;
  totalBet: number;
  chests: { index: number; opened: boolean; prize: number | null }[];
  picksLeft: number;
  won: number;
  done: boolean;
}

/**
 * Minijuego de cofres. Los premios los fijó el servidor al activarse el bono:
 * abrir un cofre solo revela lo que ya estaba decidido (el navegador no
 * conoce los premios de los cofres cerrados).
 */
export function ChestBonus({ machine, bonus, onUpdate, onClose }: { machine: string; bonus: BonusView; onUpdate: (b: BonusView) => void; onClose: () => void }) {
  const { setBalance, effects } = useSession();
  const { notify, celebrate } = useNotify();
  const [busy, setBusy] = useState<number | null>(null);
  const [lastOpened, setLastOpened] = useState<number | null>(null);
  const fx = useRef<CelebrationHandle>(null);

  const pick = async (index: number): Promise<void> => {
    if (busy !== null || bonus.done) return;
    setBusy(index);
    audio.play('click');
    try {
      const r = await api.post<{ prize: number; done: boolean; bonus: BonusView; balance: Balance; achievements: Achievement[] }>('/api/games/slots/bonus/pick', { machine, index });
      setLastOpened(index);
      audio.play('coins');
      const cell = { x: ((index % 3) + 0.5) / 3, y: (Math.floor(index / 3) + 0.5) / 3 };
      fx.current?.play(r.prize >= bonus.totalBet * 10 ? 'burst' : 'sparkle', [cell]);
      onUpdate(r.bonus);
      if (r.done) {
        setBalance(r.balance);
        celebrate(r.achievements);
        audio.play(r.bonus.won >= bonus.totalBet * 20 ? 'winBig' : 'winMedium', 300);
        if (r.bonus.won >= bonus.totalBet * 20) fx.current?.play('fireworks', [{ x: 0.5, y: 0.5 }]);
      }
    } catch (err) {
      notify('error', err instanceof ApiError ? err.message : 'No se pudo abrir el cofre.');
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="absolute inset-0 z-40 grid place-items-center overflow-hidden rounded-[36px] bg-[radial-gradient(ellipse_at_center,rgba(6,40,58,0.94),rgba(2,10,18,0.97))] p-4" role="dialog" aria-label="Bono de cofres" data-testid="chest-bonus">
      <Celebration ref={fx} level={effects} />
      <div className="relative w-full max-w-md text-center">
        <p className="text-xs uppercase tracking-[0.3em] text-[#7ff0e4]">Bono</p>
        <h2 className="font-display text-3xl text-marfil sm:text-4xl">Tesoro del arrecife</h2>
        <p className="mt-1 text-sm text-niebla">
          {bonus.done ? 'Estos eran los premios de todos los cofres.' : `Elige ${bonus.picksLeft} ${bonus.picksLeft === 1 ? 'cofre' : 'cofres'}. Los premios ya están repartidos.`}
        </p>
        <div className="mx-auto mt-5 grid max-w-sm grid-cols-3 gap-3">
          {bonus.chests.map((c) => {
            const revealed = c.prize !== null;
            const mine = c.opened;
            return (
              <motion.button
                key={c.index}
                type="button"
                onClick={() => void pick(c.index)}
                disabled={revealed || bonus.done || busy !== null}
                whileHover={!revealed && !bonus.done ? { y: -4, scale: 1.04 } : undefined}
                whileTap={!revealed ? { scale: 0.95 } : undefined}
                className={cx(
                  'relative grid aspect-square place-items-center rounded-2xl border bg-[#06283a]/80 transition-colors',
                  mine ? 'border-oro-claro shadow-[0_0_24px_rgba(244,210,122,0.45)]' : revealed ? 'border-white/10 opacity-60' : 'border-[#7ff0e4]/30 hover:border-[#7ff0e4]',
                )}
                aria-label={revealed ? `Cofre ${c.index + 1}: ${credits(c.prize!)}` : `Abrir cofre ${c.index + 1}`}
                data-testid={`chest-${c.index}`}
              >
                <AnimatePresence mode="wait">
                  {revealed ? (
                    <motion.div key="open" initial={{ rotateY: 90, scale: 0.6 }} animate={{ rotateY: 0, scale: 1 }} transition={{ type: 'spring', stiffness: 260, damping: 18 }} className="flex flex-col items-center">
                      <span className={cx('font-display text-xl tabular-nums', mine ? 'gold-text text-2xl' : 'text-niebla')}>{credits(c.prize!)}</span>
                      <span className="text-[10px] text-niebla">{(c.prize! / bonus.totalBet).toFixed(0)}×</span>
                    </motion.div>
                  ) : (
                    <motion.div key="closed" exit={{ rotateY: -90, scale: 0.8 }} animate={busy === c.index ? { rotate: [0, -6, 6, -4, 0] } : { rotate: 0 }} transition={{ duration: 0.4 }}>
                      <SlotSymbolArt symbol="chest" size={64} />
                    </motion.div>
                  )}
                </AnimatePresence>
                {lastOpened === c.index && mine && <span className="pointer-events-none absolute inset-0 rounded-2xl ring-2 ring-oro-claro" />}
              </motion.button>
            );
          })}
        </div>
        <p className="mt-5 text-sm text-niebla">Ganado en el bono</p>
        <p className="font-display text-4xl gold-text tabular-nums" data-testid="bonus-won">{credits(bonus.won)}</p>
        {bonus.done && <Button className="mt-4" onClick={onClose}>Volver a la máquina</Button>}
      </div>
    </div>
  );
}
