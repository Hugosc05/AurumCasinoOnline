import { AnimatePresence, animate, motion } from 'motion/react';
import { Coins, LogOut, Menu, Settings2, Shield, User as UserIcon, Volume2, VolumeX, X } from 'lucide-react';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Link, NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom';
import { credits, cx } from '../lib/format';
import { socket, type WsStatus } from '../lib/ws';
import { LOW_BALANCE } from '../lib/economy';
import { useSession } from '../state/session';
import { Button } from './ui';

export function Logo({ compact = false }: { compact?: boolean }) {
  return (
    <Link to="/" className="group flex items-center gap-2.5" aria-label="Aurum, ir al inicio">
      <svg width="34" height="34" viewBox="0 0 64 64" aria-hidden className="transition-transform duration-500 ease-casino group-hover:rotate-[8deg]">
        <circle cx="32" cy="32" r="30" fill="#0D1526" stroke="#CFAE6B" strokeWidth="1.5" />
        {Array.from({ length: 12 }, (_, i) => (
          <line key={i} x1="32" y1="5" x2="32" y2="10" stroke="#CFAE6B" strokeOpacity="0.5" strokeWidth="1.2" transform={`rotate(${i * 30} 32 32)`} />
        ))}
        <path d="M32 15 L45 47 H39.5 L36.6 39.5 H27.4 L24.5 47 H19 Z M29.2 34.8 H34.8 L32 27.4 Z" fill="#E2C78C" />
      </svg>
      {!compact && (
        <span className="font-display text-2xl leading-none tracking-wide text-marfil">
          Aurum
        </span>
      )}
    </Link>
  );
}

/** Saldo con contador animado; ∞ para administradores. */
export function BalancePill() {
  const { user, speed } = useSession();
  const ref = useRef<HTMLSpanElement>(null);
  const prev = useRef<number | null>(null);
  const [flash, setFlash] = useState<'up' | 'down' | null>(null);
  useEffect(() => {
    if (!user || user.unlimited || user.balance === null) return;
    const from = prev.current ?? user.balance;
    const to = user.balance;
    prev.current = to;
    if (from === to || !ref.current) {
      if (ref.current) ref.current.textContent = credits(to);
      return;
    }
    setFlash(to > from ? 'up' : 'down');
    const t = window.setTimeout(() => setFlash(null), 900);
    const ctrl = animate(from, to, {
      duration: speed === 0 ? 0 : Math.min(1.2, 0.4 + Math.abs(to - from) / 20000) * Math.max(speed, 0.4),
      ease: [0.22, 1, 0.36, 1],
      onUpdate: (v) => {
        if (ref.current) ref.current.textContent = credits(Math.round(v));
      },
    });
    return () => {
      ctrl.stop();
      clearTimeout(t);
    };
  }, [user, speed]);
  if (!user) return null;
  return (
    <Link
      to="/perfil"
      className={cx(
        'flex items-center gap-2 rounded-full border bg-noche/70 py-1.5 pl-2 pr-4 transition-colors duration-500',
        flash === 'up' ? 'border-exito/60' : flash === 'down' ? 'border-rubi/50' : 'border-oro/35',
      )}
      aria-label={user.unlimited ? 'Saldo ilimitado de administrador' : `Saldo: ${credits(user.balance)} créditos virtuales`}
    >
      <span className="grid h-7 w-7 place-items-center rounded-full bg-gradient-to-b from-oro-claro to-oro-oscuro text-noche">
        <Coins className="h-4 w-4" />
      </span>
      <span ref={ref} className="font-display text-lg tabular-nums text-oro-claro">
        {credits(user.unlimited ? null : user.balance)}
      </span>
    </Link>
  );
}

function SoundToggle() {
  const { prefs, updatePrefs } = useSession();
  return (
    <button
      onClick={() => void updatePrefs({ sound: !prefs.sound })}
      className="grid h-10 w-10 place-items-center rounded-full text-niebla transition-colors hover:bg-white/5 hover:text-marfil"
      aria-label={prefs.sound ? 'Silenciar sonidos' : 'Activar sonidos'}
      aria-pressed={!prefs.sound}
      title={prefs.sound ? 'Silenciar' : 'Activar sonido'}
    >
      {prefs.sound ? <Volume2 className="h-5 w-5" /> : <VolumeX className="h-5 w-5" />}
    </button>
  );
}

function ConnectionDot() {
  const [status, setStatus] = useState<WsStatus>(socket.status);
  useEffect(() => socket.onStatus(setStatus), []);
  if (status === 'open') return null;
  return (
    <span className="flex items-center gap-1.5 text-xs text-aviso" role="status">
      <span className="h-2 w-2 animate-pulse rounded-full bg-aviso" />
      {status === 'connecting' ? 'Conectando…' : 'Sin conexión en tiempo real'}
    </span>
  );
}

const NAV = [
  { to: '/', label: 'Salón', end: true },
  { to: '/poker', label: 'Póker' },
  { to: '/clasificacion', label: 'Clasificación' },
  { to: '/promociones', label: 'Promociones' },
];

function Header() {
  const { user, logout } = useSession();
  const [open, setOpen] = useState(false);
  const [menu, setMenu] = useState(false);
  const nav = useNavigate();
  const loc = useLocation();
  useEffect(() => {
    setOpen(false);
    setMenu(false);
  }, [loc.pathname]);
  return (
    <header className="sticky top-0 z-40 border-b border-linea/60 bg-noche/80 backdrop-blur-md">
      <div className="mx-auto flex h-16 max-w-7xl items-center gap-4 px-4 sm:px-6">
        <Logo />
        <nav className="ml-6 hidden items-center gap-1 md:flex" aria-label="Principal">
          {NAV.map((n) => (
            <NavLink
              key={n.to}
              to={n.to}
              end={n.end}
              className={({ isActive }) => cx('rounded-full px-3.5 py-2 text-sm transition-colors', isActive ? 'text-oro-claro' : 'text-niebla hover:text-marfil')}
            >
              {n.label}
            </NavLink>
          ))}
        </nav>
        <div className="ml-auto flex items-center gap-2">
          <ConnectionDot />
          <SoundToggle />
          {user ? (
            <>
              <BalancePill />
              <div className="relative hidden sm:block">
                <button
                  onClick={() => setMenu((m) => !m)}
                  className="grid h-10 w-10 place-items-center rounded-full border border-linea bg-abismo text-marfil hover:border-oro/50"
                  aria-haspopup="menu"
                  aria-expanded={menu}
                  aria-label="Menú de la cuenta"
                >
                  <span className="font-display text-lg">{user.username[0]!.toUpperCase()}</span>
                </button>
                <AnimatePresence>
                  {menu && (
                    <motion.div
                      role="menu"
                      initial={{ opacity: 0, y: -6 }}
                      animate={{ opacity: 1, y: 0 }}
                      exit={{ opacity: 0, y: -4 }}
                      className="panel absolute right-0 mt-2 w-56 p-2"
                    >
                      <p className="px-3 py-2 text-sm text-niebla">
                        Sesión de <span className="text-marfil">{user.username}</span>
                      </p>
                      <MenuLink to="/perfil" icon={<UserIcon className="h-4 w-4" />}>Perfil e historial</MenuLink>
                      <MenuLink to="/perfil?tab=ajustes" icon={<Settings2 className="h-4 w-4" />}>Sonido y animaciones</MenuLink>
                      {user.role === 'admin' && <MenuLink to="/admin" icon={<Shield className="h-4 w-4" />}>Administración</MenuLink>}
                      <button
                        role="menuitem"
                        onClick={async () => {
                          await logout();
                          nav('/');
                        }}
                        className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-sm text-niebla hover:bg-white/5 hover:text-marfil"
                      >
                        <LogOut className="h-4 w-4" /> Cerrar sesión
                      </button>
                    </motion.div>
                  )}
                </AnimatePresence>
              </div>
            </>
          ) : (
            <div className="hidden items-center gap-2 sm:flex">
              <Button variant="ghost" size="sm" onClick={() => nav('/entrar')}>Entrar</Button>
              <Button size="sm" onClick={() => nav('/registro')}>Crear cuenta</Button>
            </div>
          )}
          <button className="grid h-10 w-10 place-items-center rounded-full text-marfil md:hidden" onClick={() => setOpen(true)} aria-label="Abrir menú">
            <Menu className="h-5 w-5" />
          </button>
        </div>
      </div>
      <AnimatePresence>
        {open && (
          <motion.div className="fixed inset-0 z-50 bg-black/70 md:hidden" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={() => setOpen(false)}>
            <motion.nav
              aria-label="Menú móvil"
              initial={{ x: '100%' }}
              animate={{ x: 0 }}
              exit={{ x: '100%' }}
              transition={{ type: 'spring', stiffness: 380, damping: 36 }}
              className="absolute inset-y-0 right-0 flex w-72 flex-col gap-1 border-l border-linea bg-abismo p-5"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="mb-4 flex items-center justify-between">
                <Logo />
                <button onClick={() => setOpen(false)} aria-label="Cerrar menú" className="p-2 text-niebla">
                  <X className="h-5 w-5" />
                </button>
              </div>
              {[...NAV, { to: '/blackjack', label: 'Blackjack' }, { to: '/ruleta', label: 'Ruleta' }, { to: '/slots', label: 'Slots' }].map((n) => (
                <NavLink key={n.to} to={n.to} end={'end' in n} className={({ isActive }) => cx('rounded-lg px-3 py-2.5', isActive ? 'bg-white/5 text-oro-claro' : 'text-marfil')}>
                  {n.label}
                </NavLink>
              ))}
              <div className="hairline my-3" />
              {user ? (
                <>
                  <NavLink to="/perfil" className="rounded-lg px-3 py-2.5 text-marfil">Perfil</NavLink>
                  {user.role === 'admin' && <NavLink to="/admin" className="rounded-lg px-3 py-2.5 text-marfil">Administración</NavLink>}
                  <button className="rounded-lg px-3 py-2.5 text-left text-niebla" onClick={() => void logout()}>Cerrar sesión</button>
                </>
              ) : (
                <>
                  <Button onClick={() => nav('/registro')}>Crear cuenta</Button>
                  <Button variant="ghost" onClick={() => nav('/entrar')}>Entrar</Button>
                </>
              )}
            </motion.nav>
          </motion.div>
        )}
      </AnimatePresence>
    </header>
  );
}

function MenuLink({ to, icon, children }: { to: string; icon: ReactNode; children: ReactNode }) {
  return (
    <Link role="menuitem" to={to} className="flex items-center gap-2 rounded-lg px-3 py-2 text-sm text-niebla hover:bg-white/5 hover:text-marfil">
      {icon}
      {children}
    </Link>
  );
}

function Footer() {
  return (
    <footer className="mt-24 border-t border-linea/60 bg-noche">
      <div className="mx-auto grid max-w-7xl gap-10 px-4 py-12 sm:px-6 md:grid-cols-[1.4fr_1fr_1fr_1fr]">
        <div className="space-y-4">
          <Logo />
          <p className="max-w-sm text-sm leading-relaxed text-niebla">
            Aurum es un casino de demostración. Se juega con créditos virtuales sin valor económico: no se compran, no se venden y no se pueden retirar ni transferir.
          </p>
        </div>
        <FooterCol title="Juegos" links={[['/blackjack', 'Blackjack'], ['/poker', "Texas Hold'em"], ['/ruleta', 'Ruleta europea'], ['/slots', 'Tragaperras']]} />
        <FooterCol title="Información" links={[['/reglas', 'Reglas y pagos'], ['/juego-responsable', 'Juego responsable'], ['/ayuda', 'Ayuda'], ['/bots', 'Bots del casino']]} />
        <FooterCol title="Legal" links={[['/privacidad', 'Privacidad'], ['/terminos', 'Condiciones de uso']]} />
      </div>
      <div className="border-t border-linea/40">
        <p className="mx-auto max-w-7xl px-4 py-5 text-xs text-niebla/80 sm:px-6">
          Proyecto de demostración sin dinero real. Cada resultado es independiente: las rachas pasadas no predicen la siguiente partida.
        </p>
      </div>
    </footer>
  );
}

function FooterCol({ title, links }: { title: string; links: [string, string][] }) {
  return (
    <div>
      <p className="mb-3 font-display text-lg text-marfil">{title}</p>
      <ul className="space-y-2">
        {links.map(([to, label]) => (
          <li key={to}>
            <Link to={to} className="text-sm text-niebla hover:text-oro-claro">
              {label}
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}

export function Layout() {
  const loc = useLocation();
  const { speed } = useSession();
  return (
    <div className="flex min-h-screen flex-col overflow-x-clip">
      <a href="#contenido" className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-50 focus:rounded-full focus:bg-oro focus:px-4 focus:py-2 focus:text-noche">
        Saltar al contenido
      </a>
      <Header />
      <main id="contenido" className="flex-1">
        <motion.div
          key={loc.pathname}
          initial={speed ? { opacity: 0, y: 8 } : false}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.32 * Math.max(speed, 0.3), ease: [0.22, 1, 0.36, 1] }}
        >
          <Outlet />
        </motion.div>
      </main>
      <LowBalanceBanner />
      <Footer />
    </div>
  );
}

/** Aviso discreto con saldo agotado: lleva a la pantalla de recuperación sin interrumpir la partida. */
function LowBalanceBanner() {
  const { user } = useSession();
  const loc = useLocation();
  const [dismissed, setDismissed] = useState(false);
  const low = !!user && !user.unlimited && (user.balance ?? 0) < LOW_BALANCE;
  useEffect(() => {
    if (!low) setDismissed(false);
  }, [low]);
  if (!low || dismissed || loc.pathname === '/sin-saldo' || loc.pathname === '/promociones') return null;
  return (
    <div className="fixed inset-x-3 bottom-3 z-50 mx-auto flex max-w-xl items-center gap-3 rounded-2xl border border-oro/40 bg-noche/95 p-3 pl-4 shadow-hondo backdrop-blur" role="status" data-testid="low-balance">
      <p className="flex-1 text-sm text-marfil">Te has quedado sin créditos para apostar.</p>
      <Link to="/sin-saldo" className="rounded-full bg-oro px-3 py-1.5 text-sm font-semibold text-noche">Recuperar créditos</Link>
      <button onClick={() => setDismissed(true)} className="px-1 text-niebla hover:text-marfil" aria-label="Cerrar aviso">×</button>
    </div>
  );
}
