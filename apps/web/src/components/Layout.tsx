import { AnimatePresence, animate, motion, useMotionValue } from 'motion/react';
import { Coins, DoorOpen, Gift, LogOut, Menu, Music, Settings2, Shield, User as UserIcon, Users, Volume2, VolumeX, X } from 'lucide-react';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Link, NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom';
import { credits, cx } from '../lib/format';
import { socket, type WsStatus } from '../lib/ws';
import { LOW_BALANCE } from '../lib/economy';
import { NotificationBell } from '../social/NotificationBell';
import { api } from '../lib/api';
import { music } from '../lib/music';
import { PlayerCardProvider } from './social/PlayerCard';
import { PlayerAvatar } from './social/PlayerAvatar';
import { useRewardsSummary } from '../pages/rewards/summary';
import { useSession } from '../state/session';
import { Button } from './ui';

/** Rueda del logo: una ruleta europea en miniatura (37 casillas) con la A en el cubo. */
const LOGO_POCKETS = Array.from({ length: 37 }, (_, i) => {
  const a0 = ((i * 360) / 37 - 90 - 360 / 74) * (Math.PI / 180);
  const a1 = (((i + 1) * 360) / 37 - 90 - 360 / 74) * (Math.PI / 180);
  const r1 = 27.5;
  const r0 = 19;
  const p = (r: number, a: number) => `${(32 + r * Math.cos(a)).toFixed(2)} ${(32 + r * Math.sin(a)).toFixed(2)}`;
  return { d: `M${p(r0, a0)} L${p(r1, a0)} A${r1} ${r1} 0 0 1 ${p(r1, a1)} L${p(r0, a1)} A${r0} ${r0} 0 0 0 ${p(r0, a0)} Z`, fill: i === 0 ? '#0f7a4f' : i % 2 ? '#b0202f' : '#12161f' };
});

export function Logo({ compact = false }: { compact?: boolean }) {
  const { motion: level } = useSession();
  const rot = useMotionValue(0);
  const spinning = useRef(false);
  const wheelRef = useRef<SVGGElement>(null);
  // El giro se aplica como atributo SVG (rotate con centro explícito): sin dependencias del origen CSS.
  useEffect(() => rot.on('change', (v) => wheelRef.current?.setAttribute('transform', `rotate(${v.toFixed(2)} 32 32)`)), [rot]);
  // Al pasar el ratón la rueda gira y frena como una ruleta de verdad (la A del cubo queda siempre derecha).
  const spin = (): void => {
    if (level === 'off' || spinning.current) return;
    spinning.current = true;
    const turns = level === 'reduced' ? 1 : 2 + Math.random();
    void animate(rot, rot.get() + turns * 360, { duration: level === 'reduced' ? 0.9 : 2.4, ease: [0.15, 0.85, 0.25, 1] }).then(() => {
      spinning.current = false;
    });
  };
  return (
    <Link to="/" className="group flex items-center gap-2.5" aria-label="Aurum, ir al inicio" onMouseEnter={spin} onFocus={spin} data-testid="logo">
      <svg width="34" height="34" viewBox="0 0 64 64" aria-hidden className="drop-shadow-[0_2px_4px_rgba(0,0,0,0.6)]">
        <defs>
          <radialGradient id="logo-wood" cx="50%" cy="40%" r="60%"><stop offset="0" stopColor="#5a3418" /><stop offset="1" stopColor="#2a160a" /></radialGradient>
          <linearGradient id="logo-gold" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stopColor="#fff1c4" /><stop offset="0.5" stopColor="#d9b25e" /><stop offset="1" stopColor="#8c6421" /></linearGradient>
        </defs>
        <circle cx="32" cy="32" r="31" fill="url(#logo-wood)" stroke="#CFAE6B" strokeWidth="1.5" />
        <g ref={wheelRef}>
          {LOGO_POCKETS.map((p, i) => <path key={i} d={p.d} fill={p.fill} stroke="#CFAE6B" strokeOpacity="0.55" strokeWidth="0.35" />)}
          <circle cx="32" cy="32" r="19" fill="url(#logo-wood)" stroke="url(#logo-gold)" strokeWidth="1.2" />
          {Array.from({ length: 4 }, (_, i) => <line key={i} x1="32" y1="14.5" x2="32" y2="20.5" stroke="url(#logo-gold)" strokeWidth="1.6" strokeLinecap="round" transform={`rotate(${i * 90 + 45} 32 32)`} />)}
        </g>
        <circle cx="32" cy="32" r="13.5" fill="#0D1526" stroke="url(#logo-gold)" strokeWidth="1" />
        <path d="M32 20.5 L40.6 42 H36.9 L35 37.1 H29 L27.1 42 H23.4 Z M30.2 34 H33.8 L32 29.2 Z" fill="url(#logo-gold)" />
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

/** Banda sonora del salón: encendida o apagada (baja sola dentro de los juegos). */
function MusicToggle() {
  const { prefs, updatePrefs } = useSession();
  const on = prefs.soundtrack ?? true;
  return (
    <button
      onClick={() => void updatePrefs({ soundtrack: !on })}
      className={cx('relative grid h-10 w-10 place-items-center rounded-full transition-colors hover:bg-white/5', on ? 'text-oro-claro' : 'text-niebla hover:text-marfil')}
      aria-label={on ? 'Apagar la música' : 'Encender la música'}
      aria-pressed={on}
      title={on ? 'Apagar la música' : 'Encender la música'}
      data-testid="music-toggle"
    >
      <Music className="h-5 w-5" />
      {!on && <span className="absolute h-[2px] w-6 rotate-45 rounded bg-current" aria-hidden />}
    </button>
  );
}

/** Rutas de mesa o juego: ahí la música baja para no distraer. */
const GAME_ROUTE = /^\/(poker\/|blackjack\/|ruleta|slots\/|plinko|cohete|bingo\/|salas\/)/;

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
  { to: '/bingo', label: 'Bingo' },
  { to: '/cohete', label: 'Cohete' },
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
    <header className="sticky top-0 z-40 border-b border-linea/60 bg-noche/95 md:bg-noche/80 md:backdrop-blur-md">
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
          {user && <RewardsNavLink />}
        </nav>
        <div className="ml-auto flex items-center gap-2">
          <ConnectionDot />
          <MusicToggle />
          <SoundToggle />
          {user ? (
            <>
              <BalancePill />
              <NotificationBell />
              <div className="relative hidden sm:block">
                <button
                  onClick={() => setMenu((m) => !m)}
                  className="grid h-10 w-10 place-items-center rounded-full border border-linea bg-abismo text-marfil hover:border-oro/50"
                  aria-haspopup="menu"
                  aria-expanded={menu}
                  aria-label="Menú de la cuenta"
                >
                  <PlayerAvatar name={user.username} size={38} interactive={false} />
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
                      <MenuLink to="/amigos" icon={<Users className="h-4 w-4" />}>Amigos</MenuLink>
                      <MenuLink to="/salas" icon={<DoorOpen className="h-4 w-4" />}>Salas privadas</MenuLink>
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
              {user && <RewardsNavLink mobile />}
              {[...NAV, { to: '/blackjack', label: 'Blackjack' }, { to: '/ruleta', label: 'Ruleta' }, { to: '/slots', label: 'Slots' }, { to: '/plinko', label: 'Plinko' }, ...(user ? [{ to: '/amigos', label: 'Amigos' }, { to: '/salas', label: 'Salas privadas' }] : [])].map((n) => (
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
        <FooterCol title="Juegos" links={[['/blackjack', 'Blackjack'], ['/poker', "Texas Hold'em"], ['/ruleta', 'Ruleta europea'], ['/slots', 'Tragaperras'], ['/bingo', 'Bingo'], ['/cohete', 'Cohete'], ['/plinko', 'Plinko']]} />
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

/** Enlace a Recompensas con el número de misiones por reclamar y cajas sin abrir. */
function RewardsNavLink({ mobile = false }: { mobile?: boolean }) {
  const { claimable, unopened } = useRewardsSummary(true);
  const n = claimable + unopened;
  return (
    <NavLink
      to="/recompensas"
      className={({ isActive }) => cx(mobile ? 'rounded-lg px-3 py-2.5' : 'rounded-full px-3.5 py-2 text-sm transition-colors', isActive ? 'text-oro-claro' : mobile ? 'text-marfil' : 'text-niebla hover:text-marfil', 'relative inline-flex items-center gap-1.5')}
      data-testid="nav-rewards"
    >
      <Gift className="h-4 w-4" /> Recompensas
      {n > 0 && <span className="grid h-5 min-w-5 place-items-center rounded-full bg-rubi px-1 text-[11px] font-bold text-marfil">{n}</span>}
    </NavLink>
  );
}

export function Layout() {
  const loc = useLocation();
  const { speed } = useSession();
  const { user } = useSession();
  useEffect(() => {
    music.setDucked(GAME_ROUTE.test(loc.pathname));
  }, [loc.pathname]);
  return (
    <PlayerCardProvider>
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
    </PlayerCardProvider>
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
