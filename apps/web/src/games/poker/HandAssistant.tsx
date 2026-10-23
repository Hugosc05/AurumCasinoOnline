import { HAND_CATEGORIES, type HandInsight } from '@aurum/engine';
import { AnimatePresence, motion } from 'motion/react';
import { GraduationCap, Info, Sparkles } from 'lucide-react';
import { memo } from 'react';
import { PlayingCard } from '../../components/PlayingCard';
import { Segmented } from '../../components/ui';
import { cx } from '../../lib/format';
import type { AssistMode } from './assist';

const pct = (p: number): string => `${(p * 100).toLocaleString('es-ES', { maximumFractionDigits: 1, minimumFractionDigits: 1 })} %`;

const STAGE_LABEL: Record<HandInsight['stage'], string> = {
  preflop: 'Antes del flop',
  flop: 'Flop',
  turn: 'Turn',
  river: 'River: mano final',
};

/** Escala de las diez categorías con la actual marcada (modo principiante). */
function CategoryLadder({ category }: { category: number }) {
  return (
    <div className="mt-3" aria-label={`Tu combinación es la número ${category + 1} de 10, de menor a mayor`}>
      <div className="flex gap-1">
        {HAND_CATEGORIES.map((name, i) => (
          <div key={name} className="group relative flex-1">
            <div
              className={cx(
                'h-2 rounded-full transition-colors duration-500',
                i === category ? 'bg-oro-claro shadow-[0_0_10px_rgba(235,217,166,0.8)]' : i < category ? 'bg-oro/40' : 'bg-white/10',
              )}
            />
            <span className="pointer-events-none absolute -top-7 left-1/2 hidden -translate-x-1/2 whitespace-nowrap rounded bg-black/85 px-2 py-0.5 text-[10px] text-marfil group-hover:block">{name}</span>
          </div>
        ))}
      </div>
      <div className="mt-1 flex justify-between text-[10px] text-niebla">
        <span>Carta alta</span>
        <span>Escalera real</span>
      </div>
    </div>
  );
}

interface Props {
  insight: HandInsight | null;
  mode: AssistMode;
  onMode: (m: AssistMode) => void;
  folded: boolean;
}

/**
 * Asistente visual de la mano del jugador. Solo muestra información calculada
 * con sus propias cartas y las comunitarias; nunca decide por él.
 */
export const HandAssistant = memo(function HandAssistant({ insight, mode, onMode, folded }: Props) {
  const showFive = insight && insight.best.length === 5;
  const cards = insight ? (showFive ? insight.best : [...insight.core, ...insight.kickers]) : [];
  return (
    <section className="panel mt-4 overflow-hidden p-4 sm:p-5" aria-label="Asistente de manos" aria-live="polite">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
        <h2 className="flex items-center gap-2 text-lg text-marfil">
          <GraduationCap className="h-5 w-5 text-oro" /> Tu mano
          {insight && <span className="rounded-full border border-linea px-2 py-0.5 text-[11px] font-normal text-niebla">{STAGE_LABEL[insight.stage]}</span>}
        </h2>
        <Segmented<AssistMode>
          label="Modo del asistente"
          value={mode}
          onChange={onMode}
          options={[
            { value: 'beginner', label: 'Principiante' },
            { value: 'standard', label: 'Estándar' },
            { value: 'advanced', label: 'Avanzado' },
          ]}
        />
      </div>

      {folded ? (
        <p className="text-sm text-niebla">Te has retirado de esta mano. El asistente volverá con tus cartas de la siguiente.</p>
      ) : !insight ? (
        <p className="text-sm text-niebla">Cuando recibas tus cartas verás aquí qué combinación tienes y qué cartas la forman.</p>
      ) : (
        <div className={cx('grid gap-4', mode === 'advanced' ? 'sm:grid-cols-[auto_1fr]' : 'lg:grid-cols-[minmax(0,1fr)_minmax(0,1.15fr)]')}>
          <div>
            <AnimatePresence mode="wait">
              <motion.div
                key={insight.title}
                initial={{ opacity: 0, y: 8, scale: 0.98 }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                exit={{ opacity: 0, y: -6 }}
                transition={{ duration: 0.28, ease: [0.22, 1, 0.36, 1] }}
              >
                <p className={cx('font-display leading-tight', insight.category >= 1 ? 'gold-text' : 'text-marfil', mode === 'advanced' ? 'text-2xl' : 'text-3xl')} data-testid="hand-title">
                  {insight.title}
                </p>
                {insight.final && <p className="mt-0.5 text-xs font-semibold uppercase tracking-wider text-oro">Mano final</p>}
              </motion.div>
            </AnimatePresence>
            <div className="mt-3 flex items-end gap-1.5" aria-label={showFive ? 'Tus cinco mejores cartas' : 'Tus cartas'}>
              {cards.map((c) => {
                const lit = insight.category >= 1 && insight.core.includes(c);
                return (
                  <motion.div key={c} layout transition={{ type: 'spring', stiffness: 380, damping: 30 }} data-core={lit ? 'true' : 'false'}>
                    <PlayingCard card={c} width={44} variant="compact" highlight={lit} dim={!lit && insight.category >= 1 ? 'soft' : undefined} selected={lit} />
                  </motion.div>
                );
              })}
            </div>
            {mode !== 'advanced' && showFive && (
              <p className="mt-2 text-xs text-niebla">
                {insight.category >= 1 ? 'Iluminadas: las cartas que forman la combinación. ' : ''}
                {insight.holeCardsUsed === 0 ? 'Las cinco están en la mesa.' : `Usas ${insight.holeCardsUsed === 2 ? 'tus dos cartas' : 'una de tus cartas'}.`}
              </p>
            )}
          </div>

          {mode !== 'advanced' && (
            <div className="space-y-3 text-sm">
              {mode === 'beginner' && (
                <div className="rounded-xl border border-linea/70 bg-noche/50 p-3">
                  <p className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-oro"><Info className="h-3.5 w-3.5" /> {insight.categoryName}</p>
                  <p className="mt-1 text-marfil">{insight.explanation}</p>
                  <CategoryLadder category={insight.category} />
                </div>
              )}
              <p className="text-marfil/90">{mode === 'beginner' ? insight.summary : insight.summary.split('. ').slice(0, 1).join('. ') + '.'}</p>

              {insight.draws.length > 0 && (
                <ul className="flex flex-wrap gap-2">
                  {insight.draws.map((d) => (
                    <li key={d.kind} className="rounded-full border border-oro/30 bg-oro/10 px-2.5 py-1 text-xs text-oro-claro">
                      {d.label} · {d.outs} cartas lo completan
                    </li>
                  ))}
                </ul>
              )}

              {insight.improvement && (
                <div className="rounded-xl border border-linea/70 bg-noche/40 p-3">
                  <div className="flex items-baseline justify-between gap-2">
                    <p className="flex items-center gap-1.5 text-marfil"><Sparkles className="h-4 w-4 text-oro" /> Probabilidad de mejorar</p>
                    <p className="font-display text-xl text-oro-claro" data-testid="improve-odds">{pct(insight.improvement.probability)}</p>
                  </div>
                  <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-white/10">
                    <motion.div className="h-full w-full origin-left rounded-full bg-gradient-to-r from-oro-oscuro to-oro-claro" initial={false} animate={{ scaleX: insight.improvement.probability }} transition={{ duration: 0.5 }} />
                  </div>
                  {mode === 'beginner' && insight.improvement.byCategory.length > 0 && (
                    <ul className="mt-2 grid grid-cols-2 gap-x-4 gap-y-0.5 text-xs text-niebla">
                      {insight.improvement.byCategory.slice(0, 4).map((c) => (
                        <li key={c.category} className="flex justify-between"><span>{c.name}</span><span className="text-marfil">{pct(c.probability)}</span></li>
                      ))}
                    </ul>
                  )}
                  <p className="mt-2 text-[11px] leading-snug text-niebla">
                    Cálculo exacto con las {insight.improvement.cardsToCome === 2 ? 'dos cartas' : 'cartas'} que faltan por salir, sin conocer las de los rivales. Mejorar no garantiza ganar la mano.
                  </p>
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </section>
  );
});
