import { lazy, Suspense, type ReactNode } from 'react';
import { Navigate, Route, Routes, useLocation } from 'react-router-dom';
import { Layout } from './components/Layout';
import { Spinner } from './components/ui';
import { useSession } from './state/session';
import { HomePage } from './pages/Home';
import { LoginPage, RegisterPage } from './pages/Auth';
import { NotFound } from './pages/NotFound';

const BlackjackPage = lazy(() => import('./games/blackjack/BlackjackPage'));
const BlackjackLobby = lazy(() => import('./games/blackjack/multi/BlackjackLobby'));
const BlackjackTablePage = lazy(() => import('./games/blackjack/multi/BlackjackTablePage'));
const RoulettePage = lazy(() => import('./games/roulette/RoulettePage'));
const SlotsPage = lazy(() => import('./games/slots/SlotsPage'));
const SlotsLobby = lazy(() => import('./games/slots/SlotsLobby'));
const PlinkoPage = lazy(() => import('./games/plinko/PlinkoPage'));
const CrashPage = lazy(() => import('./games/crash/CrashPage'));
const InfoPage = lazy(() => import('./pages/Info').then((m) => ({ default: m.InfoPage })));
const RewardsPage = lazy(() => import('./pages/rewards/RewardsPage'));
const BingoLobby = lazy(() => import('./games/bingo/BingoLobby'));
const BingoRoomPage = lazy(() => import('./games/bingo/BingoRoomPage'));
const PokerLobby = lazy(() => import('./games/poker/PokerLobby'));
const PokerTablePage = lazy(() => import('./games/poker/PokerTablePage'));
const ProfilePage = lazy(() => import('./pages/Profile'));
const LeaderboardPage = lazy(() => import('./pages/Leaderboard'));
const BotsPage = lazy(() => import('./pages/Bots'));
const RecoveryPage = lazy(() => import('./pages/Recovery'));
const FriendsPage = lazy(() => import('./pages/Friends'));
const RoomsPage = lazy(() => import('./rooms/RoomsPage'));
const RoomPage = lazy(() => import('./rooms/RoomPage'));
const PromotionsPage = lazy(() => import('./pages/Promotions'));
const AdminApp = lazy(() => import('./admin/AdminApp'));
const CardGallery = lazy(() => import('./dev/CardGallery'));
const DealerGallery = lazy(() => import('./dev/DealerGallery'));

/** Protección de rutas privadas en el cliente (la autorización real está en el servidor). */
function RequireAuth({ children, admin = false }: { children: ReactNode; admin?: boolean }) {
  const { user, loading } = useSession();
  const loc = useLocation();
  if (loading) return <Spinner label="Recuperando tu sesión…" />;
  if (!user) return <Navigate to="/entrar" replace state={{ from: loc.pathname }} />;
  if (admin && user.role !== 'admin') return <Navigate to="/" replace />;
  return <>{children}</>;
}

export function App() {
  return (
    <Suspense fallback={<Spinner />}>
      <Routes>
        {import.meta.env.DEV && <Route path="/dev/cartas" element={<CardGallery />} />}
        {import.meta.env.DEV && <Route path="/dev/crupier" element={<DealerGallery />} />}
        <Route path="/admin/*" element={<RequireAuth admin><AdminApp /></RequireAuth>} />
        <Route element={<Layout />}>
          <Route index element={<HomePage />} />
          <Route path="entrar" element={<LoginPage />} />
          <Route path="registro" element={<RegisterPage />} />
          <Route path="blackjack" element={<BlackjackLobby />} />
          <Route path="blackjack/individual" element={<RequireAuth><BlackjackPage /></RequireAuth>} />
          <Route path="blackjack/mesa/:tableId" element={<BlackjackTablePage />} />
          <Route path="ruleta" element={<RequireAuth><RoulettePage /></RequireAuth>} />
          <Route path="slots" element={<SlotsLobby />} />
          <Route path="slots/:machineId" element={<RequireAuth><SlotsPage /></RequireAuth>} />
          <Route path="plinko" element={<RequireAuth><PlinkoPage /></RequireAuth>} />
          <Route path="cohete" element={<CrashPage />} />
          <Route path="recompensas" element={<RequireAuth><RewardsPage /></RequireAuth>} />
          <Route path="bingo" element={<BingoLobby />} />
          <Route path="bingo/:roomId" element={<BingoRoomPage />} />
          <Route path="poker" element={<PokerLobby />} />
          <Route path="poker/:tableId" element={<PokerTablePage />} />
          <Route path="perfil" element={<RequireAuth><ProfilePage /></RequireAuth>} />
          <Route path="clasificacion" element={<LeaderboardPage />} />
          <Route path="bots" element={<BotsPage />} />
          <Route path="sin-saldo" element={<RequireAuth><RecoveryPage /></RequireAuth>} />
          <Route path="amigos" element={<RequireAuth><FriendsPage /></RequireAuth>} />
          <Route path="salas" element={<RequireAuth><RoomsPage /></RequireAuth>} />
          <Route path="salas/:roomId" element={<RequireAuth><RoomPage /></RequireAuth>} />
          <Route path="promociones" element={<PromotionsPage />} />
          <Route path="reglas" element={<InfoPage kind="rules" />} />
          <Route path="ayuda" element={<InfoPage kind="help" />} />
          <Route path="privacidad" element={<InfoPage kind="privacy" />} />
          <Route path="terminos" element={<InfoPage kind="terms" />} />
          <Route path="juego-responsable" element={<InfoPage kind="responsible" />} />
          <Route path="*" element={<NotFound />} />
        </Route>
      </Routes>
    </Suspense>
  );
}
