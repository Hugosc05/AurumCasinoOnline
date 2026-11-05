import { AlertTriangle, CheckCircle2, Info, XCircle } from 'lucide-react';
import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { ErrorBox, Spinner } from '../components/ui';
import { ApiError, api } from '../lib/api';
import { cx } from '../lib/format';

/** El panel vuelve a pedir el código 2FA si la verificación caduca (12 h) en mitad del uso. */
export const MFA_EVENT = 'aurum:mfa-required';

export function useLoad<T>(url: string, refreshMs = 0): { data: T | null; error: string | null; reload: () => void } {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const reload = useCallback(() => {
    api.get<T>(url).then((d) => {
      setData(d);
      setError(null);
    }).catch((e: ApiError) => {
      if (e.code === 'MFA_REQUIRED' || e.code === 'MFA_SETUP_REQUIRED') window.dispatchEvent(new Event(MFA_EVENT));
      setError(e.message);
    });
  }, [url]);
  useEffect(() => {
    reload();
    if (!refreshMs) return;
    const t = window.setInterval(() => {
      if (document.visibilityState === 'visible') reload();
    }, refreshMs);
    return () => clearInterval(t);
  }, [reload, refreshMs]);
  return { data, error, reload };
}

export function Loadable<T>({ state, children }: { state: { data: T | null; error: string | null; reload: () => void }; children: (d: T) => ReactNode }) {
  if (state.error && !state.data) return <ErrorBox message={state.error} onRetry={state.reload} />;
  if (!state.data) return <Spinner />;
  return <>{children(state.data)}</>;
}

export function Card({ title, children, action, className }: { title: string; children: ReactNode; action?: ReactNode; className?: string }) {
  return (
    <section className={cx('min-w-0 rounded-2xl border border-linea bg-abismo p-5', className)}>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <h2 className="font-display text-xl text-marfil">{title}</h2>
        {action}
      </div>
      {children}
    </section>
  );
}

export const th = 'pb-2 pr-3 text-left font-normal text-niebla';
export const td = 'border-t border-linea/50 py-2 pr-3';

/** Cifra destacada con su contexto. */
export function Stat({ label, value, sub, tone }: { label: string; value: ReactNode; sub?: ReactNode; tone?: 'good' | 'bad' | 'warn' }) {
  return (
    <div className="rounded-2xl border border-linea bg-abismo p-5">
      <p className="text-sm text-niebla">{label}</p>
      <p className={cx('font-display text-3xl', tone === 'good' ? 'text-exito' : tone === 'bad' ? 'text-[#f1a3ad]' : tone === 'warn' ? 'text-oro-claro' : 'text-marfil')}>{value}</p>
      {sub && <p className="mt-0.5 text-xs text-niebla">{sub}</p>}
    </div>
  );
}

export function PageTitle({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <div className="mb-5 flex flex-wrap items-end justify-between gap-3">
      <h1 className="font-display text-3xl text-marfil">{title}</h1>
      {children}
    </div>
  );
}

const STATUS_ICON = {
  ok: { icon: CheckCircle2, cls: 'text-exito', label: 'Bien' },
  warn: { icon: AlertTriangle, cls: 'text-oro-claro', label: 'Revisar' },
  fail: { icon: XCircle, cls: 'text-[#f1a3ad]', label: 'Mal' },
  info: { icon: Info, cls: 'text-niebla', label: 'Información' },
} as const;

/** Estado con icono y texto (nunca solo color). */
export function StatusMark({ status, withLabel = false }: { status: keyof typeof STATUS_ICON; withLabel?: boolean }) {
  const s = STATUS_ICON[status];
  return (
    <span className={cx('inline-flex items-center gap-1', s.cls)}>
      <s.icon className="h-4 w-4 shrink-0" aria-hidden />
      <span className={withLabel ? 'text-xs' : 'sr-only'}>{s.label}</span>
    </span>
  );
}

/* --------------------------------- Gráficos -------------------------------- */
/** Colores de serie (validados contra el fondo del panel: contraste ≥ 3:1 y separación para daltonismo). */
const POS = '#CFAE6B';
const NEG = '#E0607A';

export interface Point {
  label: string;
  value: number;
}

/**
 * Gráfico de una sola serie (línea para tendencias, barras para cantidades por
 * día). Rejilla discreta, tooltip al pasar el ratón o el dedo y tabla accesible.
 * En barras, los valores negativos bajan desde el cero con otro color.
 */
export function MiniChart({ data, kind = 'line', height = 150, format = (v) => String(v), name, emptyText = 'Sin datos aún.' }: {
  data: Point[];
  kind?: 'line' | 'bar';
  height?: number;
  format?: (v: number) => string;
  name: string;
  emptyText?: string;
}) {
  const [hover, setHover] = useState<number | null>(null);
  const box = useRef<HTMLDivElement>(null);
  if (data.length === 0 || data.every((d) => d.value === 0)) return <p className="py-8 text-center text-sm text-niebla">{emptyText}</p>;
  const max = Math.max(0, ...data.map((d) => d.value));
  const min = Math.min(0, ...data.map((d) => d.value));
  const span = max - min || 1;
  const y = (v: number): number => ((max - v) / span) * 100;
  const zero = y(0);
  const n = data.length;
  const xMid = (i: number): number => ((i + 0.5) / n) * 100;
  const onMove = (clientX: number): void => {
    const r = box.current?.getBoundingClientRect();
    if (!r) return;
    setHover(Math.max(0, Math.min(n - 1, Math.floor(((clientX - r.left) / r.width) * n))));
  };
  const h = hover !== null ? data[hover] : null;
  const last = data.at(-1)!;
  return (
    <figure>
      <div className="flex gap-2">
        {/* Eje: solo máximo y mínimo, en tinta tenue */}
        <div className="flex w-14 shrink-0 flex-col justify-between text-right text-[10px] text-niebla" style={{ height }} aria-hidden>
          <span>{format(max)}</span>
          {min < 0 ? <span>{format(min)}</span> : <span>0</span>}
        </div>
        <div
          ref={box}
          className="relative flex-1 touch-pan-y select-none"
          style={{ height }}
          onMouseMove={(e) => onMove(e.clientX)}
          onMouseLeave={() => setHover(null)}
          onTouchStart={(e) => onMove(e.touches[0]!.clientX)}
          onTouchMove={(e) => onMove(e.touches[0]!.clientX)}
          role="img"
          aria-label={`${name}: último valor ${format(last.value)} (${last.label}). Detalle en la tabla.`}
        >
          {[0, 50, 100].map((p) => <div key={p} className="absolute inset-x-0 border-t border-linea/40" style={{ top: `${p}%` }} />)}
          {min < 0 && <div className="absolute inset-x-0 border-t border-niebla/50" style={{ top: `${zero}%` }} />}
          {kind === 'bar' ? (
            <div className="absolute inset-0 flex">
              {data.map((d, i) => {
                const top = Math.min(y(d.value), zero);
                const hgt = Math.abs(y(d.value) - zero);
                return (
                  <div key={d.label} className="relative h-full flex-1 px-[1px]">
                    <div
                      className={cx('absolute inset-x-[1px] transition-opacity', d.value >= 0 ? 'rounded-t' : 'rounded-b', hover !== null && hover !== i && 'opacity-50')}
                      style={{ top: `${top}%`, height: `${Math.max(hgt, d.value ? 0.8 : 0)}%`, background: d.value >= 0 ? POS : NEG }}
                    />
                  </div>
                );
              })}
            </div>
          ) : (
            <svg className="absolute inset-0 h-full w-full overflow-visible" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden>
              <polyline
                points={data.map((d, i) => `${xMid(i)},${y(d.value)}`).join(' ')}
                fill="none"
                stroke={POS}
                strokeWidth={2}
                vectorEffect="non-scaling-stroke"
                strokeLinejoin="round"
                strokeLinecap="round"
              />
            </svg>
          )}
          {kind === 'line' && h && (
            <>
              <div className="pointer-events-none absolute inset-y-0 w-px bg-marfil/30" style={{ left: `${xMid(hover!)}%` }} />
              <div className="pointer-events-none absolute h-2.5 w-2.5 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-abismo" style={{ left: `${xMid(hover!)}%`, top: `${y(h.value)}%`, background: POS }} />
            </>
          )}
          {h && (
            <div
              className="pointer-events-none absolute -top-2 z-10 -translate-y-full whitespace-nowrap rounded-lg border border-linea bg-noche/95 px-2.5 py-1.5 text-xs shadow-lg"
              style={{ left: `${Math.min(85, Math.max(15, xMid(hover!)))}%`, transform: 'translate(-50%, -100%)' }}
            >
              <p className="text-niebla">{h.label}</p>
              <p className="font-semibold text-marfil">{format(h.value)}</p>
            </div>
          )}
        </div>
      </div>
      <div className="ml-16 mt-1 flex justify-between text-[10px] text-niebla" aria-hidden>
        <span>{data[0]!.label}</span>
        <span>{last.label}</span>
      </div>
      <details className="ml-16 mt-1 text-xs text-niebla">
        <summary className="cursor-pointer select-none hover:text-marfil">Ver tabla</summary>
        <table className="mt-2 w-full max-w-sm">
          <thead><tr><th className={th}>Fecha</th><th className={cx(th, 'text-right')}>{name}</th></tr></thead>
          <tbody>
            {data.map((d) => <tr key={d.label}><td className={td}>{d.label}</td><td className={cx(td, 'text-right text-marfil')}>{format(d.value)}</td></tr>)}
          </tbody>
        </table>
      </details>
    </figure>
  );
}

/* -------------------------------- Formatos --------------------------------- */
export const euros = (v: number): string => v.toLocaleString('es-ES', { style: 'currency', currency: 'EUR', minimumFractionDigits: 2 });
export const pct = (v: number | null | undefined): string => (v === null || v === undefined ? '—' : `${v.toLocaleString('es-ES', { maximumFractionDigits: 1 })} %`);
export const shortDay = (iso: string): string => {
  const [, m, d] = iso.split('-');
  return `${Number(d)}/${Number(m)}`;
};

export function duration(sec: number): string {
  if (sec < 60) return `${sec} s`;
  if (sec < 3600) return `${Math.floor(sec / 60)} min`;
  if (sec < 86_400) return `${Math.floor(sec / 3600)} h ${Math.floor((sec % 3600) / 60)} min`;
  return `${Math.floor(sec / 86_400)} d ${Math.floor((sec % 86_400) / 3600)} h`;
}

export function ago(iso: string): string {
  const s = Math.max(0, Math.round((Date.now() - Date.parse(iso)) / 1000));
  return `hace ${duration(s)}`;
}

/** Envía una acción y avisa del resultado. */
export async function act<T>(fn: () => Promise<T>, notify: (kind: 'success' | 'error', msg: string) => void, ok?: string): Promise<T | null> {
  try {
    const r = await fn();
    if (ok) notify('success', ok);
    return r;
  } catch (e) {
    notify('error', (e as ApiError).message);
    return null;
  }
}
