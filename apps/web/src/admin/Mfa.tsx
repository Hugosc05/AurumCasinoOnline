import { Copy, Download, KeyRound, ShieldCheck, Smartphone } from 'lucide-react';
import { useCallback, useEffect, useState, type FormEvent, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { Logo } from '../components/Layout';
import { Button, Field, Spinner } from '../components/ui';
import { ApiError, api } from '../lib/api';
import { useSession } from '../state/session';
import { MFA_EVENT } from './shared';

export interface MfaStatus {
  enabled: boolean;
  required: boolean;
  verified: boolean;
  recoveryLeft: number;
}

function Screen({ children }: { children: ReactNode }) {
  return (
    <div className="grid min-h-screen place-items-center bg-[#070b14] p-4">
      <div className="w-full max-w-md rounded-2xl border border-linea bg-abismo p-6 shadow-2xl">
        <div className="mb-5 flex items-center justify-between">
          <Logo />
          <span className="text-xs text-oro-claro">Admin</span>
        </div>
        {children}
        <Link to="/" className="mt-6 block text-center text-sm text-niebla hover:text-marfil">Volver al casino</Link>
      </div>
    </div>
  );
}

/** Pide el código de la app (o uno de recuperación) para entrar al panel. */
function VerifyScreen({ onDone }: { onDone: () => void }) {
  const [code, setCode] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const submit = async (e: FormEvent): Promise<void> => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await api.post('/api/admin/mfa/verify', { code });
      onDone();
    } catch (err) {
      setError((err as ApiError).message);
      setCode('');
    } finally {
      setBusy(false);
    }
  };
  return (
    <Screen>
      <ShieldCheck className="h-10 w-10 text-oro" />
      <h1 className="mt-3 font-display text-2xl text-marfil">Verificación en dos pasos</h1>
      <p className="mt-1 text-sm text-niebla">Escribe el código de 6 cifras de tu app de autenticación. Si no tienes el móvil, usa un código de recuperación.</p>
      <form className="mt-5 space-y-4" onSubmit={(e) => void submit(e)}>
        <Field label="Código" value={code} onChange={(e) => setCode(e.target.value)} inputMode="text" autoComplete="one-time-code" autoFocus maxLength={20} error={error ?? undefined} data-testid="mfa-code" />
        <Button type="submit" className="w-full" loading={busy} disabled={code.trim().length < 6}>Entrar al panel</Button>
      </form>
    </Screen>
  );
}

/**
 * Asistente para activar la 2FA: contraseña → QR → primer código → códigos de
 * recuperación (se muestran una sola vez y se pueden descargar).
 */
export function MfaSetup({ onDone, compact = false }: { onDone: () => void; compact?: boolean }) {
  const { user } = useSession();
  const [step, setStep] = useState<'password' | 'scan' | 'codes'>('password');
  const [password, setPassword] = useState('');
  const [setup, setSetup] = useState<{ secret: string; qr: string } | null>(null);
  const [code, setCode] = useState('');
  const [codes, setCodes] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const run = async (fn: () => Promise<void>): Promise<void> => {
    setBusy(true);
    setError(null);
    try {
      await fn();
    } catch (err) {
      setError((err as ApiError).message);
    } finally {
      setBusy(false);
    }
  };

  const download = (): void => {
    const text = `Aurum Casino - códigos de recuperación de ${user?.username ?? 'admin'}\nCada código sirve una sola vez.\n\n${codes.join('\n')}\n`;
    const url = URL.createObjectURL(new Blob([text], { type: 'text/plain' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = 'aurum-codigos-recuperacion.txt';
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div data-testid="mfa-setup">
      {!compact && (
        <>
          <Smartphone className="h-10 w-10 text-oro" />
          <h1 className="mt-3 font-display text-2xl text-marfil">Activa la verificación en dos pasos</h1>
          <p className="mt-1 text-sm text-niebla">El panel controla el casino entero: además de la contraseña, pedirá un código que cambia cada 30 segundos en tu móvil.</p>
        </>
      )}
      {step === 'password' && (
        <form className="mt-5 space-y-4" onSubmit={(e) => { e.preventDefault(); void run(async () => { setSetup(await api.post('/api/admin/mfa/setup', { password })); setStep('scan'); }); }}>
          <p className="text-sm text-marfil">1. Instala una app de autenticación en el móvil: Google Authenticator, Microsoft Authenticator o Authy (gratis).</p>
          <Field label="Confirma tu contraseña" type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} error={error ?? undefined} data-testid="mfa-password" />
          <Button type="submit" loading={busy} disabled={!password}>Continuar</Button>
        </form>
      )}
      {step === 'scan' && setup && (
        <form className="mt-5 space-y-4" onSubmit={(e) => { e.preventDefault(); void run(async () => { const r = await api.post<{ recoveryCodes: string[] }>('/api/admin/mfa/enable', { code }); setCodes(r.recoveryCodes); setStep('codes'); }); }}>
          <p className="text-sm text-marfil">2. En la app, pulsa «+» → «Escanear código QR»:</p>
          <img src={setup.qr} alt="Código QR para la app de autenticación" className="mx-auto h-48 w-48 rounded-lg bg-white p-2" data-testid="mfa-qr" />
          <details className="text-xs text-niebla">
            <summary className="cursor-pointer">¿No puedes escanearlo? Escribe la clave a mano</summary>
            <p className="mt-2 flex items-center gap-2 break-all font-mono text-marfil">
              {setup.secret.match(/.{1,4}/g)!.join(' ')}
              <button type="button" className="shrink-0 text-niebla hover:text-marfil" onClick={() => void navigator.clipboard?.writeText(setup.secret)} aria-label="Copiar clave"><Copy className="h-4 w-4" /></button>
            </p>
          </details>
          <p className="text-sm text-marfil">3. Escribe el código de 6 cifras que muestra la app:</p>
          <Field label="Código" value={code} onChange={(e) => setCode(e.target.value)} inputMode="numeric" autoComplete="one-time-code" maxLength={6} error={error ?? undefined} data-testid="mfa-first-code" />
          <Button type="submit" loading={busy} disabled={code.trim().length !== 6}>Activar</Button>
        </form>
      )}
      {step === 'codes' && (
        <div className="mt-5 space-y-4">
          <p className="flex items-center gap-2 text-sm text-exito"><ShieldCheck className="h-4 w-4" /> Verificación en dos pasos activada.</p>
          <p className="text-sm text-marfil"><KeyRound className="mr-1 inline h-4 w-4 text-oro" />Guarda estos códigos de recuperación fuera del móvil (papel o gestor de contraseñas). Cada uno sirve una vez si pierdes el teléfono. <strong>No se volverán a mostrar.</strong></p>
          <ul className="grid grid-cols-2 gap-2 rounded-xl border border-linea bg-noche p-3 font-mono text-sm text-marfil" data-testid="mfa-recovery">
            {codes.map((c) => <li key={c}>{c}</li>)}
          </ul>
          <div className="flex flex-wrap gap-2">
            <Button variant="outline" onClick={download}><Download className="h-4 w-4" /> Descargar</Button>
            <Button variant="outline" onClick={() => void navigator.clipboard?.writeText(codes.join('\n'))}><Copy className="h-4 w-4" /> Copiar</Button>
            <Button onClick={onDone} data-testid="mfa-done">Ya los he guardado</Button>
          </div>
        </div>
      )}
    </div>
  );
}

/**
 * Puerta del panel: según el estado de la 2FA muestra el panel, la pantalla de
 * verificación o (si es obligatoria y no está activada) el asistente.
 */
export function MfaGate({ children }: { children: (status: MfaStatus, refresh: () => void) => ReactNode }) {
  const [status, setStatus] = useState<MfaStatus | null>(null);
  const [error, setError] = useState<string | null>(null);
  const refresh = useCallback(() => {
    api.get<MfaStatus>('/api/admin/mfa').then(setStatus).catch((e: ApiError) => setError(e.message));
  }, []);
  useEffect(() => {
    refresh();
    window.addEventListener(MFA_EVENT, refresh);
    return () => window.removeEventListener(MFA_EVENT, refresh);
  }, [refresh]);
  if (error) return <Screen><p className="text-sm text-[#f1a3ad]">{error}</p></Screen>;
  if (!status) return <div className="grid min-h-screen place-items-center bg-[#070b14]"><Spinner /></div>;
  if (status.enabled && !status.verified) return <VerifyScreen onDone={refresh} />;
  if (!status.enabled && status.required) return <Screen><MfaSetup onDone={refresh} /></Screen>;
  return <>{children(status, refresh)}</>;
}
