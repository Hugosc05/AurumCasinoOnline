import { AvatarEditor } from '../components/social/AvatarEditor';
import { PlayerName } from '../components/social/PlayerAvatar';
import { motion } from 'motion/react';
import { Award, Flame, Lock } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Badge, Button, EmptyState, Segmented, Spinner } from '../components/ui';
import { api } from '../lib/api';
import { GAME_NAMES, credits, cx, dateTime, signed } from '../lib/format';
import { useSession } from '../state/session';
import type { Achievement } from '../state/types';

interface Stats {
  stats: { rounds: number; wins: number; losses: number; pushes: number; totalBet: number; totalPayout: number; currentStreak: number; bestStreak: number; biggestWin: number; net: number };
  byGame: { game: string; rounds: number; wins: number; losses: number; totalBet: number; totalPayout: number }[];
  recent: { outcome: string; game: string }[];
}
interface Page<T> {
  items: T[];
  total: number;
  page: number;
  pageSize: number;
}
interface HistoryItem {
  id: string;
  game: string;
  bet: number;
  payout: number;
  createdAt: string;
  summary: string;
}
interface Tx {
  id: number;
  amount: number;
  balanceBefore: number;
  balanceAfter: number;
  reason: string;
  unlimited: number;
  createdAt: string;
}

const REASONS: Record<string, string> = {
  signup_bonus: 'Saldo inicial', daily_bonus: 'Bono diario', demo_refill: 'Recarga de demostración', bet: 'Apuesta', payout: 'Premio',
  poker_buyin: 'Entrada a mesa de póker', poker_cashout: 'Salida de mesa de póker', admin_adjustment: 'Ajuste de administración', refund: 'Reembolso',
};

type Tab = 'resumen' | 'historial' | 'movimientos' | 'logros' | 'ajustes';

export default function ProfilePage() {
  const { user, prefs, updatePrefs } = useSession();
  const [params, setParams] = useSearchParams();
  const tab = (params.get('tab') as Tab) ?? 'resumen';
  const setTab = (t: Tab): void => setParams({ tab: t });
  const [stats, setStats] = useState<Stats | null>(null);

  useEffect(() => {
    api.get<Stats>('/api/me/stats').then(setStats).catch(() => {});
  }, []);

  if (!user) return null;
  const s = stats?.stats;
  return (
    <div className="mx-auto max-w-6xl px-4 py-10 sm:px-6">
      <div className="flex flex-wrap items-end gap-6">
        <AvatarEditor />
        <div>
          <h1 className="text-4xl text-marfil"><PlayerName name={user.username} /></h1>
          <p className="text-sm text-niebla">Miembro desde {new Date(user.createdAt).toLocaleDateString('es-ES', { day: 'numeric', month: 'long', year: 'numeric' })}{user.role === 'admin' && ' — administrador con saldo ilimitado'}</p>
        </div>
        <div className="ml-auto text-right">
          <p className="text-sm text-niebla">Saldo virtual</p>
          <p className="font-display text-4xl text-oro-claro">{credits(user.unlimited ? null : user.balance)}</p>
        </div>
      </div>
      <div className="mt-8 overflow-x-auto">
        <Segmented<Tab>
          label="Secciones del perfil"
          value={tab}
          onChange={setTab}
          options={[
            { value: 'resumen', label: 'Resumen' },
            { value: 'historial', label: 'Partidas' },
            { value: 'movimientos', label: 'Movimientos' },
            { value: 'logros', label: 'Logros' },
            { value: 'ajustes', label: 'Ajustes' },
          ]}
        />
      </div>

      <div className="mt-6">
        {tab === 'resumen' && (!s ? <Spinner /> : (
          <div className="grid gap-5 lg:grid-cols-[1.2fr_1fr]">
            <div className="panel grid grid-cols-2 gap-6 p-6 sm:grid-cols-3">
              {[
                ['Partidas', String(s.rounds)],
                ['Victorias', String(s.wins)],
                ['Derrotas', String(s.losses)],
                ['Resultado neto', signed(s.net)],
                ['Mayor premio', credits(s.biggestWin)],
                ['Mejor racha', String(s.bestStreak)],
              ].map(([k, v]) => (
                <div key={k}>
                  <p className="text-sm text-niebla">{k}</p>
                  <p className={cx('font-display text-3xl', k === 'Resultado neto' ? (s.net >= 0 ? 'text-exito' : 'text-[#f1a3ad]') : 'text-marfil')}>{v}</p>
                </div>
              ))}
              <div className="col-span-full">
                <p className="mb-2 flex items-center gap-1.5 text-sm text-niebla"><Flame className="h-4 w-4 text-oro" /> Racha actual: <span className="text-marfil">{s.currentStreak}</span></p>
                <div className="flex gap-1">
                  {stats!.recent.map((r, i) => (
                    <span key={i} title={GAME_NAMES[r.game]} className={cx('h-7 flex-1 rounded', r.outcome === 'win' ? 'bg-exito/80' : r.outcome === 'loss' ? 'bg-rubi/70' : 'bg-niebla/40')} />
                  ))}
                </div>
                <p className="mt-2 text-xs text-niebla">Las rachas describen resultados pasados; no predicen la siguiente partida.</p>
              </div>
            </div>
            <div className="panel p-6">
              <h2 className="mb-4 text-xl text-marfil">Por juego</h2>
              {stats!.byGame.length === 0 ? <p className="text-sm text-niebla">Aún no has jugado.</p> : (
                <table className="w-full text-sm">
                  <thead><tr className="text-left text-niebla"><th className="pb-2 font-normal">Juego</th><th className="pb-2 text-right font-normal">Partidas</th><th className="pb-2 text-right font-normal">Victorias</th><th className="pb-2 text-right font-normal">Neto</th></tr></thead>
                  <tbody>
                    {stats!.byGame.map((g) => (
                      <tr key={g.game} className="border-t border-linea/50">
                        <td className="py-2 text-marfil">{GAME_NAMES[g.game]}</td>
                        <td className="py-2 text-right">{g.rounds}</td>
                        <td className="py-2 text-right">{g.wins}</td>
                        <td className={cx('py-2 text-right', g.totalPayout - g.totalBet >= 0 ? 'text-exito' : 'text-[#f1a3ad]')}>{signed(g.totalPayout - g.totalBet)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          </div>
        ))}
        {tab === 'historial' && <HistoryTab />}
        {tab === 'movimientos' && <TxTab />}
        {tab === 'logros' && <AchievementsTab />}
        {tab === 'ajustes' && (
          <div className="panel max-w-2xl space-y-6 p-6">
            <div>
              <p className="mb-2 text-marfil">Animaciones</p>
              <Segmented label="Nivel de animación" value={prefs.animations} onChange={(v) => void updatePrefs({ animations: v })} options={[{ value: 'full', label: 'Completas' }, { value: 'reduced', label: 'Reducidas' }, { value: 'off', label: 'Desactivadas' }]} />
              <p className="mt-2 text-xs text-niebla">Si tu sistema tiene activada la reducción de movimiento, Aurum usa como mínimo el modo reducido.</p>
            </div>
            <div>
              <p className="mb-2 text-marfil">Efectos de celebración</p>
              <Segmented label="Partículas y celebraciones" value={prefs.effects ?? 'full'} onChange={(v) => void updatePrefs({ effects: v })} options={[{ value: 'full', label: 'Completos' }, { value: 'reduced', label: 'Discretos' }, { value: 'off', label: 'Desactivados' }]} />
              <p className="mt-2 text-xs text-niebla">Destellos, partículas y fuegos artificiales al ganar. Nunca superan el nivel de animación elegido arriba.</p>
            </div>
            <div>
              <p className="mb-2 text-marfil">Asistente de póker</p>
              <Segmented label="Asistente de manos de póker" value={prefs.pokerAssist ?? 'beginner'} onChange={(v) => void updatePrefs({ pokerAssist: v })} options={[{ value: 'beginner', label: 'Principiante' }, { value: 'standard', label: 'Estándar' }, { value: 'advanced', label: 'Avanzado' }]} />
              <p className="mt-2 text-xs text-niebla">Principiante explica cada combinación y las reglas; estándar muestra la combinación, las cartas iluminadas y la probabilidad de mejorar; avanzado, solo la combinación. Nunca decide por ti.</p>
            </div>
            <div>
              <p className="mb-2 text-marfil">Presencia</p>
              <Segmented label="Presencia para tus amigos" value={prefs.invisible ? 'invisible' : 'visible'} onChange={(v) => void updatePrefs({ invisible: v === 'invisible' })} options={[{ value: 'visible', label: 'Visible' }, { value: 'invisible', label: 'Invisible' }]} />
              <p className="mt-2 text-xs text-niebla">En modo invisible tus amigos te ven siempre desconectado y no saben si estás jugando.</p>
            </div>
            <div>
              <p className="mb-2 text-marfil">Sonido <span className="text-xs text-niebla">(desactivado por defecto)</span></p>
              <div className="flex flex-wrap items-center gap-4">
                <Segmented label="Sonido" value={prefs.sound ? 'on' : 'off'} onChange={(v) => void updatePrefs({ sound: v === 'on' })} options={[{ value: 'on', label: 'Activado' }, { value: 'off', label: 'Silencio' }]} />
                <label className="flex items-center gap-3 text-sm text-niebla">
                  Volumen
                  <input type="range" min={0} max={1} step={0.05} value={prefs.volume} onChange={(e) => void updatePrefs({ volume: Number(e.target.value) })} className="w-40 accent-[#cfae6b]" aria-label="Volumen" />
                </label>
              </div>
            </div>
            <div>
              <p className="mb-2 text-marfil">Recordatorios</p>
              <Segmented label="Notas de independencia de resultados" value={prefs.showOddsNotes ? 'on' : 'off'} onChange={(v) => void updatePrefs({ showOddsNotes: v === 'on' })} options={[{ value: 'on', label: 'Mostrar' }, { value: 'off', label: 'Ocultar' }]} />
            </div>
            <p className="text-xs text-niebla">Las preferencias se guardan en tu cuenta.</p>
          </div>
        )}
      </div>
    </div>
  );
}

function usePaged<T>(url: string) {
  const [page, setPage] = useState(1);
  const [data, setData] = useState<Page<T> | null>(null);
  useEffect(() => {
    setData(null);
    api.get<Page<T>>(`${url}${url.includes('?') ? '&' : '?'}page=${page}&pageSize=20`).then(setData).catch(() => setData({ items: [], total: 0, page, pageSize: 20 }));
  }, [url, page]);
  return { data, page, setPage };
}

function Pager({ page, total, pageSize, setPage }: { page: number; total: number; pageSize: number; setPage: (p: number) => void }) {
  const pages = Math.max(1, Math.ceil(total / pageSize));
  if (pages <= 1) return null;
  return (
    <div className="mt-4 flex items-center justify-end gap-2 text-sm">
      <Button variant="ghost" size="sm" disabled={page <= 1} onClick={() => setPage(page - 1)}>Anterior</Button>
      <span className="text-niebla">{page} de {pages}</span>
      <Button variant="ghost" size="sm" disabled={page >= pages} onClick={() => setPage(page + 1)}>Siguiente</Button>
    </div>
  );
}

function HistoryTab() {
  const [game, setGame] = useState<string>('');
  const { data, page, setPage } = usePaged<HistoryItem>(`/api/me/history${game ? `?game=${game}` : ''}`);
  return (
    <div className="panel p-5">
      <div className="mb-4">
        <Segmented label="Filtrar por juego" value={game} onChange={(v) => { setGame(v); setPage(1); }} options={[{ value: '', label: 'Todos' }, ...Object.entries(GAME_NAMES).map(([value, label]) => ({ value, label }))]} />
      </div>
      {!data ? <Spinner /> : data.items.length === 0 ? <EmptyState title="Sin partidas todavía">Cuando juegues, cada partida aparecerá aquí con su apuesta y su premio.</EmptyState> : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[560px] text-sm">
            <thead><tr className="text-left text-niebla"><th className="pb-2 font-normal">Fecha</th><th className="pb-2 font-normal">Juego</th><th className="pb-2 font-normal">Detalle</th><th className="pb-2 text-right font-normal">Apuesta</th><th className="pb-2 text-right font-normal">Premio</th><th className="pb-2 text-right font-normal">Neto</th></tr></thead>
            <tbody>
              {data.items.map((h) => (
                <tr key={h.id} className="border-t border-linea/50">
                  <td className="py-2 text-niebla">{dateTime(h.createdAt)}</td>
                  <td className="py-2 text-marfil">{GAME_NAMES[h.game]}</td>
                  <td className="py-2 text-niebla">{h.summary}</td>
                  <td className="py-2 text-right">{credits(h.bet)}</td>
                  <td className="py-2 text-right">{credits(h.payout)}</td>
                  <td className={cx('py-2 text-right', h.payout - h.bet > 0 ? 'text-exito' : h.payout - h.bet < 0 ? 'text-[#f1a3ad]' : 'text-niebla')}>{signed(h.payout - h.bet)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {data && <Pager page={page} total={data.total} pageSize={data.pageSize} setPage={setPage} />}
    </div>
  );
}

function TxTab() {
  const { data, page, setPage } = usePaged<Tx>('/api/me/transactions');
  return (
    <div className="panel p-5">
      {!data ? <Spinner /> : data.items.length === 0 ? <EmptyState title="Sin movimientos" /> : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[560px] text-sm">
            <thead><tr className="text-left text-niebla"><th className="pb-2 font-normal">Fecha</th><th className="pb-2 font-normal">Motivo</th><th className="pb-2 text-right font-normal">Importe</th><th className="pb-2 text-right font-normal">Saldo anterior</th><th className="pb-2 text-right font-normal">Saldo posterior</th></tr></thead>
            <tbody>
              {data.items.map((t) => (
                <tr key={t.id} className="border-t border-linea/50">
                  <td className="py-2 text-niebla">{dateTime(t.createdAt)}</td>
                  <td className="py-2 text-marfil">{REASONS[t.reason] ?? t.reason}{t.unlimited ? <Badge tone="muted">ilimitado</Badge> : null}</td>
                  <td className={cx('py-2 text-right', t.amount > 0 ? 'text-exito' : 'text-[#f1a3ad]')}>{signed(t.amount)}</td>
                  <td className="py-2 text-right text-niebla">{credits(t.balanceBefore)}</td>
                  <td className="py-2 text-right">{credits(t.balanceAfter)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {data && <Pager page={page} total={data.total} pageSize={data.pageSize} setPage={setPage} />}
    </div>
  );
}

function AchievementsTab() {
  const [list, setList] = useState<Achievement[] | null>(null);
  useEffect(() => {
    api.get<{ achievements: Achievement[] }>('/api/me/achievements').then((r) => setList(r.achievements)).catch(() => setList([]));
  }, []);
  if (!list) return <Spinner />;
  const tier = { bronze: 'from-[#8a5a32] to-[#c48a52]', silver: 'from-[#7d8696] to-[#d4d9e2]', gold: 'from-oro-oscuro to-oro-claro' };
  return (
    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
      {list.map((a, i) => (
        <motion.div key={a.id} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.03 }} className={cx('panel flex items-center gap-4 p-4', !a.unlockedAt && 'opacity-55')}>
          <div className={cx('grid h-12 w-12 shrink-0 place-items-center rounded-full bg-gradient-to-br text-noche', a.unlockedAt ? tier[a.tier] : 'from-linea to-marino text-niebla')}>
            {a.unlockedAt ? <Award className="h-6 w-6" /> : <Lock className="h-5 w-5" />}
          </div>
          <div>
            <p className="font-display text-lg text-marfil">{a.title}</p>
            <p className="text-sm text-niebla">{a.description}</p>
            {a.unlockedAt && <p className="text-xs text-oro-claro">{dateTime(a.unlockedAt)}</p>}
          </div>
        </motion.div>
      ))}
    </div>
  );
}
