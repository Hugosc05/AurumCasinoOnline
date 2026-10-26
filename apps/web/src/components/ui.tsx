import { createPortal } from 'react-dom';
import { AnimatePresence, motion } from 'motion/react';
import { Loader2, X } from 'lucide-react';
import { forwardRef, useEffect, useId, useRef, type ButtonHTMLAttributes, type InputHTMLAttributes, type ReactNode } from 'react';
import { audio } from '../lib/audio';
import { cx } from '../lib/format';

type Variant = 'gold' | 'ghost' | 'outline' | 'danger' | 'felt';
type Size = 'sm' | 'md' | 'lg';

const VARIANTS: Record<Variant, string> = {
  gold: 'bg-gradient-to-b from-oro-claro via-oro to-oro-oscuro text-noche shadow-[0_1px_0_rgba(255,255,255,0.4)_inset,0_10px_24px_-12px_rgba(207,174,107,0.8)] hover:brightness-110',
  ghost: 'text-marfil hover:bg-white/5',
  outline: 'border border-oro/50 text-oro-claro hover:border-oro hover:bg-oro/10',
  danger: 'border border-rubi/60 text-[#f1a3ad] hover:bg-rubi/15',
  felt: 'bg-tapete-claro/90 text-marfil border border-white/10 hover:bg-tapete-claro',
};
const SIZES: Record<Size, string> = {
  sm: 'h-9 px-3 text-sm gap-1.5',
  md: 'h-11 px-5 text-sm gap-2',
  lg: 'h-14 px-7 text-base gap-2.5',
};

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  size?: Size;
  loading?: boolean;
  /** Motivo por el que está deshabilitado (se muestra como ayuda accesible). */
  disabledReason?: string | null;
  silent?: boolean;
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant = 'gold', size = 'md', loading, disabled, disabledReason, className, children, onClick, silent, title, ...rest },
  ref,
) {
  const isDisabled = disabled || loading;
  return (
    <button
      ref={ref}
      {...rest}
      title={isDisabled && disabledReason ? disabledReason : title}
      aria-disabled={isDisabled || undefined}
      disabled={isDisabled}
      onClick={(e) => {
        if (!silent) audio.play('click');
        onClick?.(e);
      }}
      className={cx(
        'relative inline-flex select-none items-center justify-center rounded-full font-semibold tracking-wide transition-[transform,filter,background-color,border-color,opacity] duration-150 ease-casino active:scale-[0.97] disabled:cursor-not-allowed disabled:opacity-45 disabled:active:scale-100',
        VARIANTS[variant],
        SIZES[size],
        className,
      )}
    >
      {loading && <Loader2 className="h-4 w-4 animate-spin" aria-hidden />}
      {children}
    </button>
  );
});

export function Spinner({ label = 'Cargando…' }: { label?: string }) {
  return (
    <div className="flex items-center justify-center gap-3 py-10 text-niebla" role="status">
      <Loader2 className="h-5 w-5 animate-spin text-oro" aria-hidden />
      <span className="text-sm">{label}</span>
    </div>
  );
}

export function Modal({ open, onClose, title, children, wide }: { open: boolean; onClose: () => void; title: string; children: ReactNode; wide?: boolean }) {
  const ref = useRef<HTMLDivElement>(null);
  // onClose suele ser una función nueva en cada render: se guarda en una ref para que
  // el efecto de foco solo se ejecute al abrir/cerrar (si no, cada tecla robaba el foco del campo).
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  useEffect(() => {
    if (!open) return;
    const prev = document.activeElement as HTMLElement | null;
    // Respeta el autoFocus de un campo del modal; si no hay, enfoca el diálogo.
    if (!ref.current?.contains(document.activeElement)) ref.current?.focus();
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') closeRef.current();
    };
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('keydown', onKey);
      prev?.focus();
    };
  }, [open]);
  // Portal: un ancestro con transform o backdrop-filter (p. ej., .panel) atraparía el modal fijo.
  return createPortal(
    <AnimatePresence>
      {open && (
        <motion.div className="fixed inset-0 z-50 grid place-items-center bg-black/70 p-4 backdrop-blur-sm" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onMouseDown={onClose}>
          <motion.div
            ref={ref}
            tabIndex={-1}
            role="dialog"
            aria-modal="true"
            aria-label={title}
            initial={{ y: 20, opacity: 0, scale: 0.98 }}
            animate={{ y: 0, opacity: 1, scale: 1 }}
            exit={{ y: 10, opacity: 0 }}
            transition={{ type: 'spring', stiffness: 380, damping: 32 }}
            onMouseDown={(e) => e.stopPropagation()}
            className={cx('panel max-h-[88vh] w-full overflow-y-auto p-6 focus:outline-none', wide ? 'max-w-3xl' : 'max-w-lg')}
          >
            <div className="mb-4 flex items-start justify-between gap-4">
              <h2 className="text-2xl text-marfil">{title}</h2>
              <button onClick={onClose} className="rounded-full p-1 text-niebla hover:bg-white/5 hover:text-marfil" aria-label="Cerrar">
                <X className="h-5 w-5" />
              </button>
            </div>
            {children}
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>,
    document.body,
  );
}

interface FieldProps extends InputHTMLAttributes<HTMLInputElement> {
  label: string;
  error?: string | undefined;
  hint?: string;
}
export function Field({ label, error, hint, className, ...rest }: FieldProps) {
  const id = useId();
  return (
    <div className={className}>
      <label htmlFor={id} className="label">
        {label}
      </label>
      <input id={id} {...rest} aria-invalid={!!error} aria-describedby={error || hint ? `${id}-d` : undefined} className={cx('input', error && 'border-rubi/70')} />
      {(error || hint) && (
        <p id={`${id}-d`} className={cx('mt-1.5 text-xs', error ? 'text-[#f1a3ad]' : 'text-niebla')}>
          {error ?? hint}
        </p>
      )}
    </div>
  );
}

export function Segmented<T extends string>({ value, options, onChange, label }: { value: T; options: { value: T; label: string }[]; onChange: (v: T) => void; label: string }) {
  return (
    <div role="radiogroup" aria-label={label} className="inline-flex rounded-full border border-linea bg-noche/60 p-1">
      {options.map((o) => (
        <button
          key={o.value}
          role="radio"
          aria-checked={value === o.value}
          onClick={() => {
            audio.play('click');
            onChange(o.value);
          }}
          className={cx('rounded-full px-3.5 py-1.5 text-sm transition-colors', value === o.value ? 'bg-oro text-noche' : 'text-niebla hover:text-marfil')}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

export function EmptyState({ title, children, action }: { title: string; children?: ReactNode; action?: ReactNode }) {
  return (
    <div className="flex flex-col items-center gap-3 rounded-2xl border border-dashed border-linea px-6 py-10 text-center">
      <p className="font-display text-xl text-marfil">{title}</p>
      {children && <div className="max-w-sm text-sm text-niebla">{children}</div>}
      {action}
    </div>
  );
}

export function Badge({ children, tone = 'gold' }: { children: ReactNode; tone?: 'gold' | 'muted' | 'green' | 'red' }) {
  const tones = {
    gold: 'border-oro/40 text-oro-claro bg-oro/10',
    muted: 'border-linea text-niebla bg-white/5',
    green: 'border-exito/40 text-exito bg-exito/10',
    red: 'border-rubi/50 text-[#f1a3ad] bg-rubi/10',
  };
  return <span className={cx('inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs', tones[tone])}>{children}</span>;
}

export function ErrorBox({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <div role="alert" className="flex flex-col items-center gap-3 rounded-2xl border border-rubi/40 bg-rubi/10 px-6 py-8 text-center">
      <p className="text-sm text-[#f1c4ca]">{message}</p>
      {onRetry && (
        <Button variant="outline" size="sm" onClick={onRetry}>
          Reintentar
        </Button>
      )}
    </div>
  );
}
