import { DEFAULT_ROULETTE_LIMITS, ROULETTE_BET_LABELS, ROULETTE_PAYOUTS, WHEEL_ORDER, numberColor, type RouletteBet, type RouletteResult } from '@aurum/engine';
import { AnimatePresence, motion } from 'motion/react';
import { Brush, Eraser, Repeat2, RotateCcw, Sparkles, Table2, Trash2, Undo2 } from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ChipRack, GameHeader, OddsNote, OutcomeBanner, SkipButton, type Outcome } from '../../components/GameKit';
import { useFlyingChips } from '../../components/FlyingChips';
import { Button, Modal } from '../../components/ui';
import { ApiError, api, newKey } from '../../lib/api';
import { DURATION } from '../../lib/anim/tokens';
import { audio } from '../../lib/audio';
import { credits, cx } from '../../lib/format';
import { useNotify } from '../../state/notify';
import { useSession } from '../../state/session';
import type { Achievement, Balance } from '../../state/types';
import { BettingBoard, ZONES, type PlacedBet } from './BettingBoard';
import { betKey, type Zone } from './board';
import { Formations } from './Formations';
import { RouletteWheel, type WheelHandle } from './RouletteWheel';

interface SpinResponse {
  roundId: string;
  result: RouletteResult;
  balance: Balance;
  achievements: Achievement[];
}

type Phase = 'betting' | 'spinning' | 'result';

function useIsNarrow(): boolean {
  const q = '(max-width: 767px)';
  const [narrow, setNarrow] = useState(() => window.matchMedia(q).matches);
  useEffect(() => {
    const mq = window.matchMedia(q);
    const on = (): void => setNarrow(mq.matches);
    mq.addEventListener('change', on);
    return () => mq.removeEventListener('change', on);
  }, []);
  return narrow;
}

const NUMBER_BG = { red: 'bg-[#9d1f2e]', black: 'bg-[#131925] border border-white/10', green: 'bg-[#0f6b47]' } as const;

export default function RoulettePage() {
  const { user, setBalance, speed, motion: level } = useSession();
  const { notify, celebrate } = useNotify();
  const narrow = useIsNarrow();
  const wheel = useRef<WheelHandle>(null);
  const rackRef = useRef<HTMLDivElement>(null);
  const { layer, fly } = useFlyingChips(speed);

  const [chip, setChip] = useState(25);
  const [bets, setBetsState] = useState<Map<string, PlacedBet>>(new Map());
  /** Copia síncrona de las apuestas: un trazo rápido coloca varias fichas antes de volver a renderizar. */
  const betsRef = useRef(bets);
  const setBets = useCallback((next: Map<string, PlacedBet> | ((b: Map<string, PlacedBet>) => Map<string, PlacedBet>)) => {
    const value = typeof next === 'function' ? next(betsRef.current) : next;
    betsRef.current = value;
    setBetsState(value);
  }, []);
  /** Deshacer por grupos: un toque o un trazo completo se deshace de una vez. */
  const [undo, setUndo] = useState<{ group: number; key: string; bet: PlacedBet['bet']; delta: number }[]>([]);
  const group = useRef(1);
  const flown = useRef(0);
  const [tool, setTool] = useState<'chip' | 'erase'>('chip');
  const [confirming, setConfirming] = useState(false);
  const [skipConfirm, setSkipConfirm] = useState(false);
  const [lastBets, setLastBets] = useState<Map<string, PlacedBet> | null>(null);
  const [phase, setPhase] = useState<Phase>('betting');
  const [result, setResult] = useState<RouletteResult | null>(null);
  const [wonKeys, setWonKeys] = useState<Set<string> | null>(null);
  const [history, setHistory] = useState<number[]>([]);
  const [hoverKey, setHoverKey] = useState<string | null>(null);
  const [showPays, setShowPays] = useState(false);
  const [banner, setBanner] = useState<{ outcome: Outcome; title: string; amount: number } | null>(null);
  const busy = useRef(false);

  const total = useMemo(() => [...bets.values()].reduce((a, b) => a + b.amount, 0), [bets]);
  const phaseRef = useRef(phase);
  phaseRef.current = phase;
  const available = user?.unlimited ? Infinity : (user?.balance ?? 0);

  useEffect(() => {
    api.get<{ items: { summary: string }[] }>('/api/me/history?game=roulette&pageSize=18')
      .then((r) => setHistory(r.items.map((i) => Number(/(\d+)/.exec(i.summary)?.[1] ?? NaN)).filter((n) => !Number.isNaN(n))))
      .catch(() => {});
  }, []);

  /** Al volver a apostar tras un giro, el tapete se limpia. */
  const ensureFreshBoard = useCallback(() => {
    if (phase === 'result') {
      setBets(new Map());
      setUndo([]);
      setWonKeys(null);
      setResult(null);
      setBanner(null);
      setPhase('betting');
      return new Map<string, PlacedBet>();
    }
    return null;
  }, [phase]);

  /** Añade una ficha a una zona respetando límites y saldo. Devuelve false si no se pudo. */
  const addChip = useCallback(
    (zone: Zone, el: Element | null, quiet: boolean): boolean => {
      if (phaseRef.current === 'spinning') return false;
      const fresh = ensureFreshBoard();
      const current = fresh ?? betsRef.current;
      const cur = current.get(zone.key)?.amount ?? 0;
      const inside = 'numbers' in zone.bet;
      const max = inside ? DEFAULT_ROULETTE_LIMITS.maxInside : DEFAULT_ROULETTE_LIMITS.maxOutside;
      const add = Math.min(chip, max - cur);
      const totalNow = [...current.values()].reduce((a, b) => a + b.amount, 0);
      const fail = (msg: string, kind: 'info' | 'error' = 'info'): boolean => {
        if (!quiet) notify(kind, msg);
        return false;
      };
      if (add <= 0) return fail(`Máximo por ${inside ? 'apuesta interior' : 'apuesta exterior'}: ${credits(max)}`);
      if (totalNow + add > available) return fail('No tienes saldo suficiente para esa ficha.', 'error');
      if (totalNow + add > DEFAULT_ROULETTE_LIMITS.maxTotal) return fail(`Máximo total por giro: ${credits(DEFAULT_ROULETTE_LIMITS.maxTotal)}`);
      if (!current.has(zone.key) && current.size >= DEFAULT_ROULETTE_LIMITS.maxBets) return fail(`Máximo ${DEFAULT_ROULETTE_LIMITS.maxBets} apuestas distintas por giro`);
      audio.play('chip', speed ? DURATION.chip * speed * 0.85 : 0);
      if (el && !quiet) void fly(rackRef.current?.querySelector(`[data-chip="${chip}"]`) ?? null, el, chip, 30);
      const next = new Map(current);
      next.set(zone.key, { bet: zone.bet, amount: cur + add });
      setBets(next);
      const g = group.current;
      setUndo((u) => [...(fresh ? [] : u), { group: g, key: zone.key, bet: zone.bet, delta: add }]);
      return true;
    },
    [ensureFreshBoard, chip, available, notify, fly, speed, setBets],
  );

  const removeZone = useCallback(
    (key: string) => {
      if (phaseRef.current !== 'betting') return;
      const cur = betsRef.current.get(key);
      if (!cur) return;
      const n = new Map(betsRef.current);
      n.delete(key);
      setBets(n);
      const g = group.current;
      setUndo((u) => [...u, { group: g, key, bet: cur.bet, delta: -cur.amount }]);
      audio.play('chip');
    },
    [setBets],
  );

  /** Toque simple: ficha o borrado según la herramienta. */
  const place = useCallback(
    (zone: Zone, el: Element) => {
      if (tool === 'erase') removeZone(zone.key);
      else addChip(zone, el, false);
      group.current += 1;
    },
    [tool, addChip, removeZone],
  );
  const remove = useCallback((key: string) => {
    removeZone(key);
    group.current += 1;
  }, [removeZone]);

  /** Trazo de pintado: una ficha por zona atravesada (la primera vuela desde el estante). */
  const paint = useCallback(
    (zones: Zone[], elFor: (key: string) => Element | null) => {
      for (const z of zones) {
        if (tool === 'erase') removeZone(z.key);
        else {
          const first = flown.current !== group.current;
          flown.current = group.current;
          addChip(z, first ? elFor(z.key) : null, !first);
        }
      }
    },
    [tool, addChip, removeZone],
  );
  const strokeEnd = useCallback(() => {
    group.current += 1;
  }, []);

  const undoLast = (): void => {
    const last = undo[undo.length - 1];
    if (!last || phase !== 'betting') return;
    const entries = undo.filter((u) => u.group === last.group);
    const n = new Map(betsRef.current);
    for (const u of entries.slice().reverse()) {
      const cur = n.get(u.key)?.amount ?? 0;
      const amount = cur - u.delta;
      if (amount <= 0) n.delete(u.key);
      else n.set(u.key, { bet: u.bet, amount });
    }
    setBets(n);
    setUndo((u) => u.filter((x) => x.group !== last.group));
  };

  /** Coloca una distribución completa (formación o repetición) sin apostar: el usuario la revisa y confirma. */
  const loadDistribution = (list: { bet: PlacedBet['bet']; amount: number }[]): boolean => {
    const next = new Map<string, PlacedBet>();
    for (const b of list) {
      const key = betKey(b.bet);
      if (!ZONES.some((z) => z.key === key)) {
        notify('error', 'La formación contiene una apuesta que no existe en el tapete.');
        return false;
      }
      next.set(key, { bet: ZONES.find((z) => z.key === key)!.bet, amount: (next.get(key)?.amount ?? 0) + b.amount });
    }
    const t = [...next.values()].reduce((a, b) => a + b.amount, 0);
    if (t > available) {
      notify('error', `Saldo insuficiente: la formación suma ${credits(t)}.`);
      return false;
    }
    ensureFreshBoard();
    audio.play('chips');
    setBets(next);
    const g = ++group.current;
    setUndo([...next.entries()].map(([key, v]) => ({ group: g, key, bet: v.bet, delta: v.amount })));
    group.current += 1;
    return true;
  };

  const repeat = (double = false): void => {
    const src = double ? bets : lastBets;
    if (!src || src.size === 0) return;
    const fresh = ensureFreshBoard();
    const base = double ? src : fresh ?? new Map<string, PlacedBet>();
    const next = new Map<string, PlacedBet>();
    for (const [k, v] of src) next.set(k, { ...v, amount: double ? v.amount * 2 : v.amount + (base.get(k)?.amount ?? 0) });
    const t = [...next.values()].reduce((a, b) => a + b.amount, 0);
    if (t > available) {
      notify('error', 'Saldo insuficiente para repetir esa apuesta.');
      return;
    }
    if (t > DEFAULT_ROULETTE_LIMITS.maxTotal) {
      notify('info', `Máximo total por giro: ${credits(DEFAULT_ROULETTE_LIMITS.maxTotal)}`);
      return;
    }
    audio.play('chips');
    setBets(next);
    setUndo([]);
    group.current += 1;
  };

  /** El giro nunca empieza solo: primero se revisa y confirma la distribución. */
  const requestSpin = (): void => {
    if (busy.current || phase !== 'betting' || total === 0) return;
    if (skipConfirm) void spin();
    else setConfirming(true);
  };

  const spin = async (): Promise<void> => {
    setConfirming(false);
    if (busy.current || phase !== 'betting' || total === 0) return;
    busy.current = true;
    setPhase('spinning');
    setHoverKey(null);
    const placed = new Map(bets);
    const payload = [...placed.values()].map((b) => ({ ...b.bet, amount: b.amount }) as RouletteBet);
    if (user && !user.unlimited && user.balance !== null) setBalance({ balance: user.balance - total, unlimited: false });
    let res: SpinResponse;
    try {
      res = await api.post<SpinResponse>('/api/games/roulette/spin', { bets: payload, idempotencyKey: newKey() });
    } catch (err) {
      busy.current = false;
      setPhase('betting');
      if (user) setBalance({ balance: user.balance, unlimited: user.unlimited });
      notify('error', err instanceof ApiError ? err.message : 'No se pudo girar la ruleta.');
      return;
    }
    // El resultado YA está decidido por el servidor; la rueda solo lo representa.
    const dur = level === 'off' ? 0 : level === 'reduced' ? 2600 : DURATION.rouletteSpin;
    await wheel.current?.spin(res.result.pocketIndex, dur, level === 'full');
    const r = res.result;
    // El servidor devuelve los resultados en el mismo orden en que se enviaron las apuestas.
    const keys = [...placed.keys()];
    const won = new Set(r.bets.flatMap((b, i) => (b.won && keys[i] ? [keys[i]] : [])));
    setResult(r);
    setWonKeys(won);
    setHistory((h) => [r.number, ...h].slice(0, 18));
    setLastBets(placed);
    setBalance(res.balance);
    const net = r.totalPayout - r.totalBet;
    if (r.totalPayout > 0) {
      const ratio = r.totalPayout / r.totalBet;
      audio.play(ratio >= 10 ? 'winBig' : ratio >= 2.5 ? 'winMedium' : 'winSmall');
      setBanner({ outcome: net > 0 ? 'win' : net === 0 ? 'push' : 'lose', title: net > 0 ? `Gana ${credits(r.totalPayout)}` : `Recuperas ${credits(r.totalPayout)}`, amount: net });
    } else {
      audio.play('lose');
      setBanner({ outcome: 'lose', title: 'Sin premio', amount: net });
    }
    celebrate(res.achievements);
    setPhase('result');
    busy.current = false;
  };

  const color = result ? numberColor(result.number) : null;

  return (
    <div className="mx-auto max-w-7xl px-4 py-8 sm:px-6">
      {layer}
      <GameHeader title="Ruleta europea" subtitle="Un solo cero. El servidor sortea el número antes de lanzar la bola.">
        <Button variant="outline" size="sm" onClick={() => setShowPays(true)}>
          <Table2 className="h-4 w-4" /> Pagos
        </Button>
      </GameHeader>

      <div className="grid gap-6 lg:grid-cols-[minmax(0,0.9fr)_minmax(0,1.25fr)]">
        {/* Rueda */}
        <div className="panel relative overflow-hidden p-4 sm:p-6">
          <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_at_50%_30%,rgba(207,174,107,0.10),transparent_60%)]" />
          <div className="relative mx-auto max-w-[460px]" style={{ perspective: 1200 }}>
            <div style={{ transform: 'rotateX(30deg)', transformOrigin: '50% 60%' }}>
              <RouletteWheel ref={wheel} highlight={phase === 'result' && result ? result.pocketIndex : null} className="w-full drop-shadow-[0_30px_40px_rgba(0,0,0,0.8)]" label="Ruleta europea" />
            </div>
            <div className="absolute inset-x-0 bottom-2 flex justify-center">
              <SkipButton visible={phase === 'spinning'} onSkip={() => wheel.current?.skip()} />
            </div>
          </div>
          <div className="relative mt-2 flex min-h-[92px] items-center justify-center">
            <AnimatePresence mode="wait">
              {phase === 'spinning' && (
                <motion.p key="sp" className="text-sm text-niebla" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
                  No va más. La bola está en juego…
                </motion.p>
              )}
              {phase === 'result' && result && color && (
                <motion.div key="res" className="flex items-center gap-4" initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}>
                  <span className={cx('grid h-16 w-16 place-items-center rounded-full font-display text-3xl text-marfil shadow-hondo', NUMBER_BG[color])}>{result.number}</span>
                  {banner && <OutcomeBanner outcome={banner.outcome} title={banner.title} amount={banner.amount} />}
                </motion.div>
              )}
              {phase === 'betting' && (
                <motion.p key="bt" className="text-sm text-niebla" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
                  Hagan juego: elige ficha y toca el tapete.
                </motion.p>
              )}
            </AnimatePresence>
          </div>
          <div className="relative mt-3">
            <p className="mb-2 text-xs text-niebla">Últimos números (izquierda, el más reciente)</p>
            <div className="flex flex-wrap gap-1.5" aria-label="Historial de resultados">
              {history.length === 0 && <span className="text-xs text-niebla">Sin giros todavía.</span>}
              {history.map((n, i) => (
                <motion.span
                  key={`${i}-${n}-${history.length}`}
                  layout
                  initial={i === 0 ? { scale: 0.4, opacity: 0 } : false}
                  animate={{ scale: 1, opacity: 1 }}
                  className={cx('grid h-8 w-8 place-items-center rounded-full text-xs font-semibold text-marfil', NUMBER_BG[numberColor(n)], i === 0 && 'ring-2 ring-oro-claro')}
                >
                  {n}
                </motion.span>
              ))}
            </div>
          </div>
        </div>

        {/* Tapete y controles */}
        <div className="flex flex-col gap-4">
          <div className="felt rail rounded-[28px] p-3 sm:p-5">
            <BettingBoard
              bets={bets}
              onPlace={place}
              onRemove={remove}
              onPaint={paint}
              onStrokeEnd={strokeEnd}
              locked={phase === 'spinning'}
              winning={phase === 'result' ? result?.number ?? null : null}
              wonKeys={phase === 'result' ? wonKeys : null}
              vertical={narrow}
              hoverKey={hoverKey}
              onHover={setHoverKey}
            />
          </div>
          <div className="panel flex flex-col gap-4 p-4 sm:p-5">
            <div className="flex flex-wrap items-center justify-between gap-4">
              <div ref={rackRef}>
                <ChipRack value={chip} onChange={(v) => { setChip(v); setTool('chip'); }} disabled={phase === 'spinning'} values={[1, 5, 25, 100, 500, 1000]} />
              </div>
              <div className="flex rounded-full border border-linea p-0.5" role="radiogroup" aria-label="Herramienta">
                {([['chip', 'Fichas', Brush], ['erase', 'Borrar', Trash2]] as const).map(([v, label, Icon]) => (
                  <button key={v} role="radio" aria-checked={tool === v} onClick={() => setTool(v)} className={cx('flex items-center gap-1.5 rounded-full px-3 py-1.5 text-sm', tool === v ? 'bg-oro text-noche' : 'text-niebla hover:text-marfil')} data-testid={`tool-${v}`}>
                    <Icon className="h-4 w-4" /> {label}
                  </button>
                ))}
              </div>
              <div className="text-right text-sm">
                <p className="text-niebla">Apuesta total</p>
                <p className="font-display text-2xl text-marfil">{credits(phase === 'result' ? 0 : total)}</p>
              </div>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <Button variant="ghost" size="sm" onClick={undoLast} disabled={phase !== 'betting' || undo.length === 0} disabledReason="No hay fichas que deshacer">
                <Undo2 className="h-4 w-4" /> Deshacer
              </Button>
              <Button variant="ghost" size="sm" onClick={() => {
                const g = ++group.current;
                setUndo((u) => [...u, ...[...betsRef.current.entries()].map(([key, v]) => ({ group: g, key, bet: v.bet, delta: -v.amount }))]);
                group.current += 1;
                setBets(new Map());
              }} disabled={phase !== 'betting' || bets.size === 0}>
                <Eraser className="h-4 w-4" /> Limpiar mesa
              </Button>
              <Button variant="ghost" size="sm" onClick={() => repeat(false)} disabled={phase === 'spinning' || !lastBets}>
                <Repeat2 className="h-4 w-4" /> Repetir
              </Button>
              <Button variant="ghost" size="sm" onClick={() => repeat(true)} disabled={phase !== 'betting' || bets.size === 0}>
                <RotateCcw className="h-4 w-4" /> Doblar
              </Button>
              <Button
                className="ml-auto min-w-[150px]"
                size="lg"
                onClick={requestSpin}
                loading={phase === 'spinning'}
                data-testid="roulette-spin"
                disabled={phase !== 'betting' || total === 0}
                disabledReason={phase === 'result' ? 'Coloca una ficha para empezar una nueva ronda' : total === 0 ? 'Coloca al menos una ficha' : null}
              >
                {phase === 'spinning' ? 'Girando' : <><Sparkles className="h-4 w-4" /> Girar</>}
              </Button>
            </div>
            <p className="text-xs text-niebla">
              Toca para poner una ficha o mantén pulsado y arrastra para pintar varias (ratón, dedo o lápiz). El trazo pinta el tipo de casilla donde empieza: número, caballo, cuadro o apuesta exterior. Con «Borrar» el trazo retira fichas. Clic derecho, Mayús+clic o Supr retiran una. Nada se apuesta hasta que confirmas el giro.
            </p>
            <OddsNote />
          </div>
        </div>
      </div>

      <Formations
        current={[...bets.values()]}
        disabled={phase === 'spinning'}
        onLoad={loadDistribution}
      />

      <Modal open={confirming} onClose={() => setConfirming(false)} title="Confirmar apuestas">
        <ul className="max-h-60 space-y-1 overflow-y-auto text-sm" data-testid="confirm-list">
          {[...bets.values()].map((b) => {
            const z = ZONES.find((x) => x.key === betKey(b.bet));
            return (
              <li key={betKey(b.bet)} className="flex justify-between border-b border-linea/40 py-1">
                <span className="text-marfil">{z?.label ?? ROULETTE_BET_LABELS[b.bet.kind]}</span>
                <span className="tabular-nums text-niebla">{credits(b.amount)} · paga {ROULETTE_PAYOUTS[b.bet.kind]} a 1</span>
              </li>
            );
          })}
        </ul>
        <p className="mt-3 text-sm text-niebla">
          {bets.size} {bets.size === 1 ? 'apuesta' : 'apuestas'} por un total de <span className="text-marfil">{credits(total)}</span>
          {!user?.unlimited && user?.balance !== null && user?.balance !== undefined ? ` · saldo tras apostar: ${credits(user.balance - total)}` : ''}.
        </p>
        <label className="mt-3 flex items-center gap-2 text-xs text-niebla">
          <input type="checkbox" className="h-4 w-4 accent-[#cfae6b]" checked={skipConfirm} onChange={(e) => setSkipConfirm(e.target.checked)} />
          No volver a preguntar en esta visita
        </label>
        <div className="mt-4 flex justify-end gap-2">
          <Button variant="ghost" onClick={() => setConfirming(false)}>Seguir apostando</Button>
          <Button onClick={() => void spin()} autoFocus data-testid="confirm-spin"><Sparkles className="h-4 w-4" /> Confirmar y girar</Button>
        </div>
      </Modal>

      <Modal open={showPays} onClose={() => setShowPays(false)} title="Tabla de pagos">
        <table className="w-full text-sm">
          <tbody>
            {(Object.keys(ROULETTE_PAYOUTS) as (keyof typeof ROULETTE_PAYOUTS)[]).map((k) => (
              <tr key={k} className="border-b border-linea/50">
                <td className="py-2 text-marfil">{ROULETTE_BET_LABELS[k]}</td>
                <td className="py-2 text-right text-oro-claro">{ROULETTE_PAYOUTS[k]} a 1</td>
              </tr>
            ))}
          </tbody>
        </table>
        <p className="mt-4 text-sm text-niebla">
          Límites: {credits(DEFAULT_ROULETTE_LIMITS.maxInside)} por apuesta interior, {credits(DEFAULT_ROULETTE_LIMITS.maxOutside)} por exterior y {credits(DEFAULT_ROULETTE_LIMITS.maxTotal)} por giro. El 0 hace perder las apuestas exteriores. Orden de la rueda: {WHEEL_ORDER.slice(0, 6).join(', ')}…
        </p>
      </Modal>
    </div>
  );
}
