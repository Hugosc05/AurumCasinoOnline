import { AnimatePresence, motion } from 'motion/react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { PLINKO_LIMITS, PLINKO_RISK_LABEL, PLINKO_ROWS, plinkoOdds, plinkoRtp, plinkoTable, type PlinkoRisk, type PlinkoRows } from '@aurum/engine';
import { GameHeader, OddsNote } from '../../components/GameKit';
import { Button } from '../../components/ui';
import { ApiError, api, newKey } from '../../lib/api';
import { audio } from '../../lib/audio';
import { credits, cx } from '../../lib/format';
import { useNotify } from '../../state/notify';
import { useSession } from '../../state/session';
import type { Achievement, Balance } from '../../state/types';

/**
 * Plinko. El servidor sortea la ruta de cada bola (izquierda o derecha en cada
 * fila) antes de que caiga; aquí solo se dibuja ese recorrido con rebotes
 * creíbles. Al acumular bolas, el histograma dibuja la campana de Gauss.
 */

interface Ball {
  roundId: string;
  path: number[];
  bucket: number;
  multiplier: number;
  payout: number;
  bet: number;
}
interface DropResponse {
  balls: Ball[];
  balance: Balance;
  achievements: Achievement[];
}

interface Flying {
  ball: Ball;
  rows: PlinkoRows;
  start: number;
  /** Fila del último clavo ya sonado. */
  lastRow: number;
  /** Pequeña variación para que no todas las bolas dibujen el mismo arco. */
  wobble: number;
  hue: number;
}

const SEG_MS = 118; // tiempo por fila
const FIRST_MS = 260; // caída hasta el primer clavo

/** Color de una casilla según lo lejos que está del centro (centro dorado, bordes rojos). */
function bucketColor(i: number, rows: number): string {
  const d = Math.abs(i - rows / 2) / (rows / 2);
  const hue = 48 - 48 * d;
  return `hsl(${hue} ${70 + d * 20}% ${52 - d * 8}%)`;
}

const fmtMult = (m: number): string => (m >= 100 ? `${m}` : m.toLocaleString('es-ES', { maximumFractionDigits: 1 })) + '×';

export default function PlinkoPage() {
  const { user, setBalance, motion: level } = useSession();
  const { notify, celebrate } = useNotify();
  const [rows, setRows] = useState<PlinkoRows>(12);
  const [risk, setRisk] = useState<PlinkoRisk>('medium');
  const [bet, setBet] = useState(10);
  const [count, setCount] = useState(1);
  const [busy, setBusy] = useState(false);
  const [inFlight, setInFlight] = useState(0);
  const [hist, setHist] = useState<number[]>(() => Array(13).fill(0));
  const [recent, setRecent] = useState<{ id: string; m: number; win: number; bet: number }[]>([]);
  const [hot, setHot] = useState<{ bucket: number; key: number } | null>(null);
  const [session, setSession] = useState({ balls: 0, bet: 0, paid: 0 });

  const canvasRef = useRef<HTMLCanvasElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const flying = useRef<Flying[]>([]);
  const pegFlash = useRef(new Map<string, number>());
  const raf = useRef<number | null>(null);
  const serverBalance = useRef<number | null>(null);
  const pending = useRef(0);
  const sizeRef = useRef({ w: 600, h: 520, dpr: 1 });
  const rowsRef = useRef(rows);
  rowsRef.current = rows;
  /** Ancho de una casilla en píxeles: las casillas quedan justo bajo los huecos de la última fila. */
  const [cellW, setCellW] = useState(40);

  const table = useMemo(() => plinkoTable(rows, risk), [rows, risk]);
  const odds = useMemo(() => plinkoOdds(rows), [rows]);
  const rtp = useMemo(() => plinkoRtp(rows, risk), [rows, risk]);

  // Al cambiar de filas, el histograma empieza de cero (otra campana).
  useEffect(() => setHist(Array(rows + 1).fill(0)), [rows]);

  /* --------------------------- Geometría del tablero --------------------------- */
  const geom = useCallback((r: PlinkoRows) => {
    const { w, h } = sizeRef.current;
    const top = h * 0.07;
    const bottom = h * 0.97;
    const spacing = Math.min(w / (r + 2.2), (bottom - top) / (r + 0.2));
    const rowH = (bottom - top) / r;
    const pegR = Math.max(2.4, spacing * 0.1);
    const ballR = Math.max(4.5, spacing * 0.23);
    return { top, rowH, spacing, pegR, ballR, cx: w / 2 };
  }, []);

  /** Posición de la bola en el instante t (ms desde el lanzamiento). */
  const ballAt = useCallback((f: Flying, t: number) => {
    const g = geom(f.rows);
    const rights = (i: number) => f.ball.path.slice(0, i).reduce((a, b) => a + b, 0);
    const xAt = (i: number) => g.cx + (rights(i) - i / 2) * g.spacing;
    const yAt = (i: number) => g.top + i * g.rowH - g.pegR - g.ballR;
    if (t < FIRST_MS) {
      const k = t / FIRST_MS;
      return { x: g.cx + f.wobble * 2, y: g.top - g.rowH * 0.9 + (yAt(0) - (g.top - g.rowH * 0.9)) * k * k, row: -1 };
    }
    const seg = (t - FIRST_MS) / SEG_MS;
    const i = Math.min(f.rows, Math.floor(seg));
    if (i >= f.rows) {
      return { x: xAt(f.rows), y: yAt(f.rows) + g.ballR * 0.6, row: f.rows };
    }
    const u = seg - i;
    // Rebote: sube un poco al chocar y cae con gravedad hacia el siguiente clavo.
    const y0 = yAt(i);
    const y1 = i + 1 >= f.rows ? yAt(f.rows) + g.ballR * 0.6 : yAt(i + 1);
    const up = g.rowH * (0.32 + 0.06 * f.wobble);
    const y = y0 - up * 4 * u * (1 - u) * (1 - u * 0.25) + (y1 - y0) * u * u;
    const x0 = xAt(i);
    const x1 = xAt(i + 1);
    const ex = 1 - (1 - u) * (1 - u);
    return { x: x0 + (x1 - x0) * ex, y, row: i };
  }, [geom]);

  /* --------------------------------- Dibujo --------------------------------- */
  const draw = useCallback((now: number) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d')!;
    const { w, h, dpr } = sizeRef.current;
    const r = rowsRef.current;
    const g = geom(r);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);
    // Clavos con volumen: sombra, cuerpo metálico y brillo.
    for (let i = 0; i < r; i += 1) {
      const n = i + 3;
      for (let j = 0; j < n; j += 1) {
        const x = g.cx + (j - (n - 1) / 2) * g.spacing;
        const y = g.top + i * g.rowH;
        const flash = pegFlash.current.get(`${i}:${j}`);
        const age = flash ? (now - flash) / 300 : 1;
        ctx.beginPath();
        ctx.arc(x + 1, y + 1.6, g.pegR, 0, Math.PI * 2);
        ctx.fillStyle = 'rgba(0,0,0,0.45)';
        ctx.fill();
        if (age < 1) {
          ctx.beginPath();
          ctx.arc(x, y, g.pegR * (2.6 - age), 0, Math.PI * 2);
          ctx.fillStyle = `rgba(255,214,120,${0.35 * (1 - age)})`;
          ctx.fill();
        }
        const grad = ctx.createRadialGradient(x - g.pegR * 0.35, y - g.pegR * 0.4, g.pegR * 0.1, x, y, g.pegR);
        grad.addColorStop(0, age < 1 ? '#fff6dd' : '#ffffff');
        grad.addColorStop(0.45, age < 1 ? '#f4d27a' : '#c9cfdb');
        grad.addColorStop(1, age < 1 ? '#9a6b12' : '#5b6274');
        ctx.beginPath();
        ctx.arc(x, y, g.pegR, 0, Math.PI * 2);
        ctx.fillStyle = grad;
        ctx.fill();
      }
    }
    // Bolas.
    for (const f of flying.current) {
      const t = now - f.start;
      const p = ballAt(f, t);
      ctx.beginPath();
      ctx.ellipse(p.x + 2, p.y + g.ballR * 0.9, g.ballR * 0.9, g.ballR * 0.35, 0, 0, Math.PI * 2);
      ctx.fillStyle = 'rgba(0,0,0,0.3)';
      ctx.fill();
      const grad = ctx.createRadialGradient(p.x - g.ballR * 0.35, p.y - g.ballR * 0.4, g.ballR * 0.1, p.x, p.y, g.ballR);
      grad.addColorStop(0, '#ffffff');
      grad.addColorStop(0.35, `hsl(${f.hue} 95% 70%)`);
      grad.addColorStop(1, `hsl(${f.hue} 85% 32%)`);
      ctx.beginPath();
      ctx.arc(p.x, p.y, g.ballR, 0, Math.PI * 2);
      ctx.fillStyle = grad;
      ctx.fill();
    }
  }, [ballAt, geom]);

  const land = useCallback((f: Flying) => {
    const b = f.ball;
    pending.current -= b.payout;
    if (serverBalance.current !== null && user && !user.unlimited) setBalance({ balance: serverBalance.current - pending.current, unlimited: false });
    setHist((hh) => {
      if (hh.length !== f.rows + 1) return hh;
      const n = hh.slice();
      n[b.bucket] = (n[b.bucket] ?? 0) + 1;
      return n;
    });
    setHot({ bucket: b.bucket, key: performance.now() });
    setRecent((r) => [{ id: b.roundId, m: b.multiplier, win: b.payout, bet: b.bet }, ...r].slice(0, 14));
    setSession((s) => ({ balls: s.balls + 1, bet: s.bet + b.bet, paid: s.paid + b.payout }));
    setInFlight((n) => n - 1);
    const pan = (b.bucket / f.rows - 0.5) * 1.4;
    audio.play('bucket', 0, { pan, rate: 0.8 + Math.abs(b.bucket - f.rows / 2) / f.rows });
    if (b.multiplier >= 10) audio.play(b.multiplier >= 50 ? 'winBig' : 'winMedium', 60);
  }, [setBalance, user]);

  const tick = useCallback((now: number) => {
    const list = flying.current;
    for (const f of list.slice()) {
      const t = now - f.start;
      const p = ballAt(f, t);
      // Sonido y destello en cada clavo.
      while (p.row >= 0 && f.lastRow < Math.min(p.row, f.rows - 1)) {
        f.lastRow += 1;
        const i = f.lastRow;
        const rights = f.ball.path.slice(0, i).reduce((a, b) => a + b, 0);
        pegFlash.current.set(`${i}:${rights + 1}`, now);
        audio.play('peg', 0, { pan: (rights / Math.max(1, i) - 0.5), rate: 0.85 + (i / f.rows) * 0.5 });
      }
      if (t >= FIRST_MS + SEG_MS * f.rows + 60) {
        list.splice(list.indexOf(f), 1);
        land(f);
      }
    }
    draw(now);
    raf.current = list.length > 0 || [...pegFlash.current.values()].some((v) => now - v < 320) ? requestAnimationFrame(tick) : null;
  }, [ballAt, draw, land]);

  const kick = useCallback(() => {
    if (raf.current === null) raf.current = requestAnimationFrame(tick);
  }, [tick]);

  // Tamaño del lienzo (nítido en pantallas de alta densidad).
  useEffect(() => {
    const wrap = wrapRef.current;
    const canvas = canvasRef.current;
    if (!wrap || !canvas) return;
    const resize = (): void => {
      const w = wrap.clientWidth;
      const h = Math.round(w * 0.78);
      const dpr = Math.min(2, window.devicePixelRatio || 1);
      sizeRef.current = { w, h, dpr };
      canvas.width = Math.round(w * dpr);
      canvas.height = Math.round(h * dpr);
      canvas.style.height = `${h}px`;
      setCellW(geom(rowsRef.current).spacing);
      draw(performance.now());
    };
    resize();
    const ro = new ResizeObserver(resize);
    ro.observe(wrap);
    return () => ro.disconnect();
  }, [draw, geom]);
  useEffect(() => {
    setCellW(geom(rows).spacing);
    draw(performance.now());
  }, [rows, draw, geom]);
  useEffect(() => () => { if (raf.current !== null) cancelAnimationFrame(raf.current); }, []);

  const drop = useCallback(async (): Promise<void> => {
    if (busy || !user) return;
    const total = bet * count;
    if (!user.unlimited && (user.balance ?? 0) < total) {
      notify('error', 'Saldo insuficiente para esta apuesta.');
      return;
    }
    setBusy(true);
    try {
      const res = await api.post<DropResponse>('/api/games/plinko/drop', { rows, risk, bet, count, idempotencyKey: newKey() });
      celebrate(res.achievements);
      const paid = res.balls.reduce((a, b) => a + b.payout, 0);
      if (!res.balance.unlimited && res.balance.balance !== null) {
        // El saldo baja ya con la apuesta; cada premio se suma cuando su bola cae en la casilla.
        serverBalance.current = res.balance.balance;
        pending.current += paid;
        setBalance({ balance: res.balance.balance - pending.current, unlimited: false });
      }
      if (level === 'off') {
        for (const b of res.balls) land({ ball: b, rows, start: 0, lastRow: rows, wobble: 0, hue: 0 });
        return;
      }
      setInFlight((n) => n + res.balls.length);
      res.balls.forEach((b, i) => {
        const f: Flying = { ball: b, rows, start: performance.now() + i * 140, lastRow: -1, wobble: Math.random() * 2 - 1, hue: 320 + Math.random() * 40 };
        window.setTimeout(() => {
          flying.current.push({ ...f, start: performance.now() });
          kick();
        }, i * 140);
      });
    } catch (err) {
      notify('error', err instanceof ApiError ? err.message : 'No se pudo lanzar la bola.');
    } finally {
      setBusy(false);
    }
  }, [bet, busy, celebrate, count, kick, land, level, notify, risk, rows, setBalance, user]);

  // Barra espaciadora: lanzar.
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.code !== 'Space' || e.target instanceof HTMLInputElement || e.repeat) return;
      e.preventDefault();
      void drop();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [drop]);

  const total = hist.reduce((a, b) => a + b, 0);
  const maxH = Math.max(1, ...hist.map((c, i) => Math.max(c, (odds[i] ?? 0) * total)));
  const locked = inFlight > 0 || busy;

  return (
    <div className="mx-auto max-w-7xl px-4 pb-16 pt-8 sm:px-6">
      <GameHeader title="Plinko" subtitle="Las bolas rebotan en los clavos hasta caer en una casilla. El servidor decide cada rebote antes de que la bola caiga." />
      <div className="grid gap-6 lg:grid-cols-[300px_1fr]">
        {/* Controles */}
        <div className="panel order-2 space-y-5 p-5 lg:order-1" data-testid="plinko-controls">
          <div>
            <p className="mb-2 text-sm text-niebla">Apuesta por bola</p>
            <div className="flex items-center gap-2">
              <button type="button" className="h-10 w-10 rounded-full border border-linea text-marfil disabled:opacity-40" disabled={bet <= PLINKO_LIMITS.minBet} onClick={() => setBet((b) => Math.max(PLINKO_LIMITS.minBet, Math.floor(b / 2)))} aria-label="Mitad">½</button>
              <input
                type="number"
                inputMode="numeric"
                min={PLINKO_LIMITS.minBet}
                max={PLINKO_LIMITS.maxBet}
                value={bet}
                onChange={(e) => setBet(Math.max(PLINKO_LIMITS.minBet, Math.min(PLINKO_LIMITS.maxBet, Math.floor(Number(e.target.value) || 0))))}
                className="h-10 w-full rounded-xl border border-linea bg-noche px-3 text-center font-display text-xl text-marfil"
                aria-label="Apuesta por bola"
                data-testid="plinko-bet"
              />
              <button type="button" className="h-10 w-10 rounded-full border border-linea text-marfil disabled:opacity-40" disabled={bet >= PLINKO_LIMITS.maxBet} onClick={() => setBet((b) => Math.min(PLINKO_LIMITS.maxBet, b * 2))} aria-label="Doble">×2</button>
            </div>
          </div>
          <Segmented label="Riesgo" value={risk} disabled={locked} options={(['low', 'medium', 'high'] as const).map((r) => ({ value: r, label: PLINKO_RISK_LABEL[r] }))} onChange={setRisk} />
          <Segmented label="Filas" value={rows} disabled={locked} options={PLINKO_ROWS.map((r) => ({ value: r, label: String(r) }))} onChange={setRows} />
          <Segmented label="Bolas por lanzamiento" value={count} options={[1, 5, 10].map((n) => ({ value: n, label: String(n) }))} onChange={setCount} />
          <Button className="w-full" size="lg" onClick={() => void drop()} loading={busy} disabled={!user} data-testid="plinko-drop">
            Lanzar {count > 1 ? `${count} bolas` : 'bola'} · {credits(bet * count)}
          </Button>
          <p className="text-center text-xs text-niebla">Barra espaciadora: lanzar. Nada se lanza solo.</p>
          <div className="grid grid-cols-3 gap-2 border-t border-linea/60 pt-4 text-center text-xs text-niebla">
            <div><p>Bolas</p><p className="font-display text-lg text-marfil">{session.balls}</p></div>
            <div><p>Apostado</p><p className="font-display text-lg text-marfil">{credits(session.bet)}</p></div>
            <div><p>Ganado</p><p className="font-display text-lg text-marfil">{credits(session.paid)}</p></div>
          </div>
          <p className="text-xs text-niebla">RTP de esta tabla: {(rtp * 100).toLocaleString('es-ES', { maximumFractionDigits: 2 })} % (exacto).</p>
          <OddsNote />
        </div>

        {/* Tablero */}
        <div className="order-1 lg:order-2">
          <div className="plinko-board relative overflow-hidden rounded-[28px] border border-oro/25 p-3 sm:p-5">
            <div ref={wrapRef} className="relative w-full">
              <canvas ref={canvasRef} className="block w-full" aria-label={`Tablero de plinko de ${rows} filas`} role="img" />
            </div>
            {/* Casillas */}
            <div className="mx-auto mt-1 flex gap-[2px]" style={{ width: cellW * (rows + 1) }} data-testid="plinko-buckets">
              {table.map((m, i) => (
                <motion.div
                  key={`${rows}-${risk}-${i}-${hot?.bucket === i ? hot.key : 0}`}
                  initial={false}
                  animate={hot?.bucket === i ? { y: [0, 7, 0], filter: ['brightness(1)', 'brightness(1.6)', 'brightness(1)'] } : { y: 0 }}
                  transition={{ duration: 0.3 }}
                  className="flex min-w-0 flex-1 items-center justify-center rounded-md py-1.5 text-[clamp(7px,1vw,12px)] font-extrabold tabular-nums text-[#1b0d05] shadow-[inset_0_-3px_0_rgba(0,0,0,0.3),0_4px_10px_-4px_rgba(0,0,0,0.7)]"
                  style={{ background: bucketColor(i, rows) }}
                  title={`Casilla ${i + 1}: ${fmtMult(m)} · probabilidad ${(odds[i]! * 100).toLocaleString('es-ES', { maximumFractionDigits: 3 })} %`}
                >
                  {fmtMult(m)}
                </motion.div>
              ))}
            </div>
            {/* Campana de Gauss: barras = bolas caídas; línea = lo esperado */}
            <div className="relative mx-auto mt-3 h-20" style={{ width: cellW * (rows + 1) }} aria-label="Histograma de casillas" data-testid="plinko-histogram">
              <div className="absolute inset-0 flex items-end gap-[2px]">
                {hist.map((c, i) => (
                  <div key={i} className="flex h-full min-w-0 flex-1 items-end">
                    <div className="w-full rounded-t-sm bg-gradient-to-t from-[#ff4fb8]/40 to-[#ffb3e6]/80 transition-[height] duration-300" style={{ height: `${(c / maxH) * 100}%` }} />
                  </div>
                ))}
              </div>
              {total > 0 && (
                <svg className="pointer-events-none absolute inset-0 h-full w-full" viewBox={`0 0 ${rows + 1} 100`} preserveAspectRatio="none" aria-hidden>
                  <polyline fill="none" stroke="#f4d27a" strokeWidth="1.5" vectorEffect="non-scaling-stroke" points={odds.map((p, i) => `${i + 0.5},${100 - ((p * total) / maxH) * 100}`).join(' ')} />
                </svg>
              )}
            </div>
            <p className="mt-1 text-center text-[11px] text-niebla">
              {total === 0 ? 'Lanza bolas y verás cómo se forma la campana de Gauss.' : `${total} bolas: barras = dónde han caído · línea dorada = lo esperado`}
            </p>
          </div>
          {/* Últimos resultados */}
          <div className="mt-3 flex flex-wrap gap-1.5" aria-label="Últimos resultados">
            <AnimatePresence initial={false}>
              {recent.map((r) => (
                <motion.span key={r.id} layout initial={{ opacity: 0, scale: 0.6 }} animate={{ opacity: 1, scale: 1 }} className={cx('rounded-full px-2.5 py-1 text-xs font-bold tabular-nums', r.win > r.bet ? 'bg-exito/20 text-exito' : 'bg-white/5 text-niebla')}>
                  {fmtMult(r.m)}
                </motion.span>
              ))}
            </AnimatePresence>
          </div>
        </div>
      </div>
    </div>
  );
}

function Segmented<T extends string | number>({ label, value, options, onChange, disabled }: { label: string; value: T; options: { value: T; label: string }[]; onChange: (v: T) => void; disabled?: boolean }) {
  return (
    <div>
      <p className="mb-2 text-sm text-niebla">{label}</p>
      <div role="radiogroup" aria-label={label} className="grid gap-1 rounded-full border border-linea bg-noche p-1" style={{ gridTemplateColumns: `repeat(${options.length}, 1fr)` }}>
        {options.map((o) => (
          <button
            key={String(o.value)}
            type="button"
            role="radio"
            aria-checked={o.value === value}
            disabled={disabled}
            onClick={() => { audio.play('click'); onChange(o.value); }}
            className={cx('rounded-full py-1.5 text-sm transition-colors disabled:opacity-50', o.value === value ? 'bg-oro text-noche font-semibold' : 'text-niebla hover:text-marfil')}
          >
            {o.label}
          </button>
        ))}
      </div>
    </div>
  );
}
