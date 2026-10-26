import { AnimatePresence, animate, motion, useMotionValue } from 'motion/react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { CASE_BY_ID, COSMETIC_BY_ID, RARITY_INFO, type CaseDrop } from '@aurum/engine';
import { Celebration, type CelebrationHandle } from '../../components/Celebration';
import { Button } from '../../components/ui';
import { audio } from '../../lib/audio';
import { credits } from '../../lib/format';
import { useSession } from '../../state/session';
import { RewardTile, dropTitle } from './RewardItem';

export interface OpenResult {
  caseId: string;
  index: number;
  drop: CaseDrop;
  credited: number;
  duplicate: boolean;
}

const TILE = 132;
const GAP = 6;
const COUNT = 64;
const WIN_AT = 56;

/**
 * Apertura al estilo CS:GO: una cinta de premios pasa a toda velocidad bajo
 * la línea central y frena poco a poco hasta el premio que YA sorteó el
 * servidor (va colocado en una posición fija de la cinta). El resto de
 * casillas se rellenan al azar con los mismos pesos de la caja, así que la
 * cinta es una muestra honesta de lo que puede salir.
 */
export function CaseOpener({ result, onClose, onAgain }: { result: OpenResult; onClose: () => void; onAgain?: () => void }) {
  const { motion: level, effects } = useSession();
  const def = CASE_BY_ID[result.caseId]!;
  const x = useMotionValue(0);
  const wrap = useRef<HTMLDivElement>(null);
  const fx = useRef<CelebrationHandle>(null);
  const [done, setDone] = useState(false);
  const targetRef = useRef(0);
  const ctlRef = useRef<{ stop: () => void } | null>(null);

  const strip = useMemo(() => {
    const total = def.drops.reduce((a, d) => a + d.weight, 0);
    const pick = (): CaseDrop => {
      let r = Math.random() * total;
      for (const d of def.drops) {
        r -= d.weight;
        if (r < 0) return d;
      }
      return def.drops[0]!;
    };
    return Array.from({ length: COUNT }, (_, i) => (i === WIN_AT ? result.drop : pick()));
  }, [def, result.drop]);

  useEffect(() => {
    const w = wrap.current?.clientWidth ?? 800;
    // El premio queda bajo la línea central, con un desvío aleatorio dentro de su casilla (como en el original).
    const jitter = (Math.random() - 0.5) * (TILE * 0.7);
    const target = -(WIN_AT * (TILE + GAP) + TILE / 2 - w / 2 + jitter);
    targetRef.current = target;
    if (level === 'off') {
      x.set(target);
      setDone(true);
      return;
    }
    let lastTile = 0;
    audio.play('spinStart');
    const ctl = animate(x, target, {
      duration: level === 'reduced' ? 3 : 6.5,
      ease: [0.08, 0.72, 0.1, 1],
      onUpdate: (v) => {
        const tile = Math.floor((-v + w / 2) / (TILE + GAP));
        if (tile !== lastTile) {
          lastTile = tile;
          audio.play('ballTick');
        }
      },
    });
    ctlRef.current = ctl;
    void ctl.then(() => setDone(true));
    return () => ctl.stop();
  }, [level, x]);

  useEffect(() => {
    if (!done) return;
    const rank = ['common', 'uncommon', 'rare', 'epic', 'legendary', 'mythic', 'exceptional'].indexOf(result.drop.rarity);
    audio.play(rank >= 4 ? 'winBig' : rank >= 2 ? 'winMedium' : 'winSmall');
    if (rank >= 3) fx.current?.play(rank >= 5 ? 'fireworks' : 'burst', [{ x: 0.5, y: 0.4 }]);
  }, [done, result.drop.rarity]);

  const r = RARITY_INFO[result.drop.rarity];
  const item = result.drop.kind === 'cosmetic' ? COSMETIC_BY_ID[result.drop.id] : null;
  return (
    <div className="fixed inset-0 z-[90] flex items-start justify-center overflow-y-auto bg-black/80 p-3 pt-[16vh] backdrop-blur-sm" role="dialog" aria-label={`Abriendo ${def.name}`} data-testid="case-opener">
      <Celebration ref={fx} level={effects} />
      <div className="w-full max-w-4xl">
        <p className="text-center text-sm uppercase tracking-[0.3em] text-niebla">{def.name}</p>
        <div ref={wrap} className="case-window relative mt-3 overflow-hidden rounded-xl border border-white/10 bg-[#0a0d14] py-3">
          <motion.div className="flex will-change-transform" style={{ x, gap: GAP }}>
            {strip.map((d, i) => <RewardTile key={i} drop={d} width={TILE} highlight={done && i === WIN_AT} />)}
          </motion.div>
          {/* Línea central */}
          <div className="pointer-events-none absolute inset-y-0 left-1/2 w-[3px] -translate-x-1/2 bg-oro shadow-[0_0_12px_#f4d27a]" />
          <div className="pointer-events-none absolute left-1/2 top-0 h-0 w-0 -translate-x-1/2 border-x-8 border-t-[10px] border-x-transparent border-t-oro" />
          <div className="pointer-events-none absolute bottom-0 left-1/2 h-0 w-0 -translate-x-1/2 border-x-8 border-b-[10px] border-x-transparent border-b-oro" />
          <div className="pointer-events-none absolute inset-y-0 left-0 w-24 bg-gradient-to-r from-[#0a0d14] to-transparent" />
          <div className="pointer-events-none absolute inset-y-0 right-0 w-24 bg-gradient-to-l from-[#0a0d14] to-transparent" />
        </div>
        <AnimatePresence>
          {done && (
            <motion.div initial={{ opacity: 0, y: 20, scale: 0.9 }} animate={{ opacity: 1, y: 0, scale: 1 }} transition={{ type: 'spring', stiffness: 260, damping: 20 }} className="mt-6 text-center" data-testid="case-result">
              <p className="text-sm font-semibold uppercase tracking-[0.25em]" style={{ color: r.color }}>{r.label}</p>
              <p className="mt-1 font-display text-4xl text-marfil">{dropTitle(result.drop)}</p>
              {item && !result.duplicate && <p className="mt-1 text-sm text-niebla">Nuevo en tu inventario. Equípalo en la pestaña Inventario.</p>}
              {result.duplicate && <p className="mt-1 text-sm text-niebla">Ya lo tenías: se convierte en {credits(result.credited)} créditos.</p>}
              {result.drop.kind === 'credits' && <p className="mt-1 text-sm text-exito">+{credits(result.credited)} a tu saldo</p>}
              <div className="mt-5 flex justify-center gap-2">
                {onAgain && <Button variant="outline" onClick={onAgain} data-testid="case-again">Abrir otra</Button>}
                <Button onClick={onClose} data-testid="case-close">Seguir</Button>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
        {!done && (
          <div className="mt-6 text-center">
            <button type="button" className="text-sm text-niebla underline-offset-4 hover:underline" onClick={() => { ctlRef.current?.stop(); x.set(targetRef.current); setDone(true); }}>
              Saltar animación
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
