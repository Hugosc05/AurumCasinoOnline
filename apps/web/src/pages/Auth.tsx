import { useState, type FormEvent } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { Button, Field } from '../components/ui';
import { ApiError } from '../lib/api';
import { useSession } from '../state/session';

function AuthShell({ title, lead, children }: { title: string; lead: string; children: React.ReactNode }) {
  return (
    <div className="mx-auto grid max-w-5xl gap-10 px-4 py-16 sm:px-6 md:grid-cols-[1fr_1.1fr] md:items-center">
      <div>
        <h1 className="text-5xl leading-tight text-marfil">{title}</h1>
        <p className="mt-4 max-w-sm text-niebla">{lead}</p>
        <div className="hairline mt-8 max-w-xs" />
        <p className="mt-6 max-w-sm text-sm text-niebla">
          Los créditos de Aurum son virtuales: no tienen valor económico ni se pueden comprar, vender o retirar.
        </p>
      </div>
      <div className="panel p-7 sm:p-9">{children}</div>
    </div>
  );
}

export function LoginPage() {
  const { login } = useSession();
  const nav = useNavigate();
  const loc = useLocation();
  const [identifier, setIdentifier] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const from = (loc.state as { from?: string } | null)?.from ?? '/';

  const submit = async (e: FormEvent): Promise<void> => {
    e.preventDefault();
    if (busy) return;
    setError(null);
    if (!identifier.trim() || !password) {
      setError('Escribe tu usuario o correo y tu contraseña.');
      return;
    }
    setBusy(true);
    try {
      await login(identifier.trim(), password);
      nav(from, { replace: true });
    } catch (err) {
      const e2 = err as ApiError;
      setError(e2.details?.retryAfterSec ? `${e2.message} Vuelve a intentarlo en ${Math.ceil(e2.details.retryAfterSec / 60)} min.` : e2.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <AuthShell title="Bienvenido de nuevo" lead="Tu saldo, tus estadísticas y tu historial te esperan donde los dejaste.">
      <form onSubmit={submit} className="space-y-5" noValidate>
        <Field label="Usuario o correo electrónico" autoComplete="username" value={identifier} onChange={(e) => setIdentifier(e.target.value)} autoFocus />
        <Field label="Contraseña" type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} />
        {error && <p role="alert" className="rounded-xl border border-rubi/40 bg-rubi/10 px-4 py-3 text-sm text-[#f1c4ca]">{error}</p>}
        <Button type="submit" className="w-full" size="lg" loading={busy}>Entrar</Button>
        <p className="text-center text-sm text-niebla">
          ¿Aún no tienes cuenta? <Link to="/registro" className="text-oro-claro hover:underline">Crear una</Link>
        </p>
      </form>
    </AuthShell>
  );
}

export function RegisterPage() {
  const { register } = useSession();
  const nav = useNavigate();
  const [form, setForm] = useState({ username: '', email: '', password: '', confirm: '' });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [general, setGeneral] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const set = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement>) => setForm((f) => ({ ...f, [k]: e.target.value }));

  const validate = (): Record<string, string> => {
    const e: Record<string, string> = {};
    if (!/^[A-Za-z0-9_.-]{3,20}$/.test(form.username)) e.username = 'Entre 3 y 20 caracteres: letras, números, punto, guion o guion bajo.';
    else if (/^bot[\s_.-]?/i.test(form.username)) e.username = 'Los nombres que empiezan por "bot" están reservados para los bots.';
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.email)) e.email = 'Introduce un correo válido.';
    if (form.password.length < 10 || !/\d/.test(form.password) || !/[A-Za-zÀ-ÿ]/.test(form.password)) e.password = 'Mínimo 10 caracteres, con letras y números.';
    if (form.confirm !== form.password) e.confirm = 'Las contraseñas no coinciden.';
    return e;
  };

  const submit = async (ev: FormEvent): Promise<void> => {
    ev.preventDefault();
    if (busy) return;
    setGeneral(null);
    const e = validate();
    setErrors(e);
    if (Object.keys(e).length) return;
    setBusy(true);
    try {
      await register(form.username.trim(), form.email.trim(), form.password);
      nav('/', { replace: true });
    } catch (err) {
      const apiErr = err as ApiError;
      if (apiErr.details?.fields) setErrors(apiErr.details.fields);
      else setGeneral(apiErr.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <AuthShell title="Tu asiento te espera" lead="Crea una cuenta y empieza con 10.000 créditos virtuales para probar las cuatro mesas.">
      <form onSubmit={submit} className="space-y-5" noValidate>
        <Field label="Nombre de usuario" autoComplete="username" value={form.username} onChange={set('username')} error={errors.username} hint="Se mostrará en la clasificación." />
        <Field label="Correo electrónico" type="email" autoComplete="email" value={form.email} onChange={set('email')} error={errors.email} />
        <Field label="Contraseña" type="password" autoComplete="new-password" value={form.password} onChange={set('password')} error={errors.password} />
        <Field label="Repite la contraseña" type="password" autoComplete="new-password" value={form.confirm} onChange={set('confirm')} error={errors.confirm} />
        {general && <p role="alert" className="rounded-xl border border-rubi/40 bg-rubi/10 px-4 py-3 text-sm text-[#f1c4ca]">{general}</p>}
        <Button type="submit" className="w-full" size="lg" loading={busy}>Crear cuenta</Button>
        <p className="text-center text-sm text-niebla">
          ¿Ya tienes cuenta? <Link to="/entrar" className="text-oro-claro hover:underline">Entrar</Link>
        </p>
      </form>
    </AuthShell>
  );
}
