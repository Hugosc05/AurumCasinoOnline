import { AnimatePresence, motion } from 'motion/react';
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
const COUNT = 52;
const WIN_AT = 45;

/**
 * Apertura al estilo CS:GO: una cinta de premios pasa a toda velocidad bajo
 * la línea central y frena poco a poco hasta el premio que YA sorteó el
 * servidor (va colocado en una posición fija de la cinta). El resto de
 * casillas se rellenan al azar con los mismos pesos de la caja, así que la
 * cinta es una muestra honesta de lo que puede salir.
 */
/** Curva de frenado (como `cubic-bezier`): progreso en función del tiempo, para sincronizar el «tic». */
const EASE: [number, number, number, number] = [0.06, 0.74, 0.12, 1];
function bezierAt(t: number, [x1, y1, x2, y2]: typeof EASE): number {
  const cx = 3 * x1;
  const bx = 3 * (x2 - x1) - cx;
  const ax = 1 - cx - bx;
  const cy = 3 * y1;
  const by = 3 * (y2 - y1) - cy;
  const ay = 1 - cy - by;
  // Newton para hallar el parámetro u con x(u) = t.
  let u = t;
  for (let i = 0; i < 8; i += 1) {
    const x = ((ax * u + bx) * u + cx) * u - t;
    const dx = (3 * ax * u + 2 * bx) * u + cx;
    if (Math.abs(x) < 1e-5 || Math.abs(dx) < 1e-6) break;
    u -= x / dx;
  }
  u = Math.min(1, Math.max(0, u));
  return ((ay * u + by) * u + cy) * u;
}

export function CaseOpener({ result, onClose, onAgain }: { result: OpenResult; onClose: () => void; onAgain?: () => void }) {
  const { motion: level, effects } = useSession();
  const def = CASE_BY_ID[result.caseId]!;
  const stripRef = useRef<HTMLDivElement>(null);
  const wrap = useRef<HTMLDivElement>(null);
  const fx = useRef<CelebrationHandle>(null);
  const [done, setDone] = useState(false);
  const targetRef = useRef(0);
  const finish = useRef<() => void>(() => {});

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

  /**
   * El desplazamiento lo hace el compositor del navegador (transición CSS de
   * `transform`), así la cinta va fluida aunque la página esté ocupada. El
   * «tic» de cada casilla se calcula aparte con la misma curva.
   */
  useEffect(() => {
    const el = stripRef.current;
    const w = wrap.current?.clientWidth ?? 800;
    if (!el) return;
    const jitter = (Math.random() - 0.5) * (TILE * 0.7);
    const target = -(WIN_AT * (TILE + GAP) + TILE / 2 - w / 2 + jitter);
    targetRef.current = target;
    const end = (): void => {
      el.style.transition = 'none';
      el.style.transform = `translate3d(${target}px,0,0)`;
      setDone(true);
    };
    finish.current = end;
    if (level === 'off') {
      end();
      return;
    }
    const duration = level === 'reduced' ? 3200 : 6800;
    audio.play('caseOpen');
    let raf = 0;
    let started = 0;
    let lastTile = Math.floor((w / 2) / (TILE + GAP));
    // Arranca en el siguiente fotograma para que la transición tenga un punto de partida.
    raf = requestAnimationFrame(() => {
      started = performance.now();
      el.style.transition = `transform ${duration}ms cubic-bezier(${EASE.join(',')})`;
      el.style.transform = `translate3d(${target}px,0,0)`;
      const tick = (now: number): void => {
        const t = Math.min(1, (now - started) / duration);
        const pos = target * bezierAt(t, EASE);
        const tile = Math.floor((-pos + w / 2) / (TILE + GAP));
        if (tile !== lastTile) {
          lastTile = tile;
          audio.play('caseTick', 0, { rate: 0.94 + Math.random() * 0.12 });
        }
        if (t < 1) raf = requestAnimationFrame(tick);
        else end();
      };
      raf = requestAnimationFrame(tick);
    });
    return () => cancelAnimationFrame(raf);
  }, [level]);

  useEffect(() => {
    if (!done) return;
    const rank = ['common', 'uncommon', 'rare', 'epic', 'legendary', 'mythic', 'exceptional'].indexOf(result.drop.rarity);
    audio.play('caseReveal', 0, { rate: 1 + rank * 0.08 });
    if (rank >= 4) audio.play('winBig', 250);
    if (rank >= 3) fx.current?.play(rank >= 5 ? 'fireworks' : 'burst', [{ x: 0.5, y: 0.4 }]);
  }, [done, result.drop.rarity]);

  const r = RARITY_INFO[result.drop.rarity];
  const item = result.drop.kind === 'cosmetic' ? COSMETIC_BY_ID[result.drop.id] : null;
  return (
    <div className="fixed inset-0 z-[90] flex items-start justify-center overflow-y-auto bg-[rgba(5,7,12,0.93)] p-3 pt-[16vh]" role="dialog" aria-label={`Abriendo ${def.name}`} data-testid="case-opener">
      <Celebration ref={fx} level={effects} />
      <div className="w-full max-w-4xl">
        <p className="text-center text-sm uppercase tracking-[0.3em] text-niebla">{def.name}</p>
        <div ref={wrap} className="case-window relative mt-3 overflow-hidden rounded-xl border border-white/10 bg-[#0a0d14] py-3">
          <div ref={stripRef} className="case-strip flex" style={{ gap: GAP, transform: 'translate3d(0,0,0)' }}>
            {strip.map((d, i) => <RewardTile key={i} drop={d} width={TILE} highlight={done && i === WIN_AT} />)}
          </div>
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
            <button type="button" className="text-sm text-niebla underline-offset-4 hover:underline" onClick={() => finish.current()}>
              Saltar animación
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
