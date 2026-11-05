import { useState } from 'react';
import { Segmented } from '../components/ui';
import { GAME_NAMES, credits, signed } from '../lib/format';
import { sectionName } from './LivePage';
import { Card, Loadable, MiniChart, PageTitle, Stat, pct, shortDay, td, th, useLoad } from './shared';

interface Activity {
  timezone: string;
  days: { day: string; active: number; newUsers: number; visitors: number; views: number; peakOnline: number; rounds: number; houseProfit: number }[];
  users: { total: number; dau: number; wau: number; mau: number; newInRange: number; retention: { cohort: number; d1: number | null; d7: number | null } };
  sections: { path: string; views: number }[];
  games: { game: string; rounds: number; players: number; bet: number; payout: number; houseProfit: number; rtp: number | null }[];
  economy: { circulating: number; flows: { reason: string; total: number; count: number; game: boolean }[]; houseProfit: number; created: number; removed: number };
  players: {
    topWinners: { username: string; net: number; rounds: number }[];
    mostActive: { username: string; rounds: number; net: number }[];
    bigWins: { username: string; game: string; bet: number; payout: number; at: string }[];
  };
}

const REASON: Record<string, string> = {
  signup_bonus: 'Saldo inicial al registrarse',
  daily_bonus: 'Recompensa diaria',
  demo_refill: 'Recarga por saldo bajo',
  ad_reward: 'Anuncios recompensados',
  case_reward: 'Premios de cajas',
  case_purchase: 'Compra de cajas',
  admin_adjustment: 'Ajustes de administración',
  bet: 'Apuestas',
  payout: 'Premios de juegos',
  poker_buyin: 'Entradas de póker',
  poker_cashout: 'Salidas de póker',
  refund: 'Devoluciones',
};

export default function ActivityPage() {
  const [days, setDays] = useState<'7' | '30' | '90'>('30');
  const st = useLoad<Activity>(`/api/admin/activity?days=${days}`);
  const n = (v: number): string => credits(v);
  return (
    <div className="space-y-5">
      <PageTitle title="Actividad y economía">
        <Segmented label="Periodo" value={days} onChange={setDays} options={[{ value: '7', label: '7 días' }, { value: '30', label: '30 días' }, { value: '90', label: '90 días' }]} />
      </PageTitle>
      <Loadable state={st}>
        {(a) => {
          const series = (key: keyof Activity['days'][number]) => a.days.map((d) => ({ label: shortDay(d.day), value: Number(d[key]) }));
          const created = a.economy.flows.filter((f) => !f.game);
          return (
            <>
              <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
                <Stat label="Activos hoy" value={a.users.dau} sub={`${a.users.wau} esta semana · ${a.users.mau} en 30 días`} />
                <Stat label="Jugadores registrados" value={n(a.users.total)} sub={`${a.users.newInRange} nuevos en el periodo`} />
                <Stat
                  label="Vuelven al día siguiente"
                  value={pct(a.users.retention.d1)}
                  sub={a.users.retention.cohort ? `y ${pct(a.users.retention.d7)} a la semana · de ${a.users.retention.cohort} registrados hace 1–5 semanas` : 'Hace falta más historial'}
                />
                <Stat label="Beneficio de la casa" value={signed(a.economy.houseProfit)} sub="Créditos virtuales: apuestas − premios" tone={a.economy.houseProfit >= 0 ? undefined : 'warn'} />
              </div>

              <div className="grid gap-5 xl:grid-cols-2">
                <Card title="Jugadores activos por día"><MiniChart name="Activos" data={series('active')} /></Card>
                <Card title="Visitantes únicos por día"><MiniChart name="Visitantes" data={series('visitors')} emptyText="Aún no hay visitas registradas (se cuentan desde esta versión)." /></Card>
                <Card title="Registros nuevos por día"><MiniChart name="Registros" kind="bar" data={series('newUsers')} /></Card>
                <Card title="Pico de conectados a la vez"><MiniChart name="Pico" kind="bar" data={series('peakOnline')} emptyText="Se mide desde esta versión." /></Card>
                <Card title="Partidas por día"><MiniChart name="Partidas" kind="bar" data={series('rounds')} format={n} /></Card>
                <Card title="Beneficio de la casa por día"><MiniChart name="Beneficio" kind="bar" data={series('houseProfit')} format={signed} /></Card>
              </div>

              <div className="grid gap-5 xl:grid-cols-[1.4fr_1fr]">
                <Card title="Juegos">
                  <div className="overflow-x-auto">
                    <table className="w-full min-w-[560px] text-sm">
                      <thead><tr><th className={th}>Juego</th><th className={th}>Partidas</th><th className={th}>Jugadores</th><th className={th}>Apostado</th><th className={th}>Retorno</th><th className={th}>Casa</th></tr></thead>
                      <tbody>
                        {a.games.map((g) => (
                          <tr key={g.game}>
                            <td className={td}>{GAME_NAMES[g.game] ?? g.game}</td>
                            <td className={td}>{n(g.rounds)}</td>
                            <td className={td}>{g.players}</td>
                            <td className={td}>{n(g.bet)}</td>
                            <td className={td}>{pct(g.rtp)}</td>
                            <td className={td}>{signed(g.houseProfit)}</td>
                          </tr>
                        ))}
                        {a.games.length === 0 && <tr><td className={td} colSpan={6}>Sin partidas en el periodo.</td></tr>}
                      </tbody>
                    </table>
                  </div>
                  <p className="mt-3 text-xs text-niebla">Retorno = premios ÷ apuestas. Con pocas partidas se aleja mucho del teórico.</p>
                </Card>
                <Card title="Secciones más vistas">
                  {a.sections.length === 0 ? <p className="text-sm text-niebla">Se cuentan desde esta versión.</p> : (
                    <ul className="space-y-2 text-sm">
                      {a.sections.map((s) => {
                        const max = a.sections[0]!.views;
                        return (
                          <li key={s.path}>
                            <div className="flex justify-between gap-3"><span className="text-marfil">{sectionName(s.path)}</span><span className="text-niebla">{n(s.views)}</span></div>
                            <div className="mt-1 h-1.5 rounded-full bg-linea/50"><div className="h-full rounded-full bg-oro" style={{ width: `${(s.views / max) * 100}%` }} /></div>
                          </li>
                        );
                      })}
                    </ul>
                  )}
                </Card>
              </div>

              <div className="grid gap-5 xl:grid-cols-2">
                <Card title="Economía virtual">
                  <div className="mb-4 grid grid-cols-3 gap-3 text-sm">
                    <div><p className="text-niebla">En circulación</p><p className="font-display text-xl text-marfil">{n(a.economy.circulating)}</p></div>
                    <div><p className="text-niebla">Creados</p><p className="font-display text-xl text-marfil">{n(a.economy.created)}</p></div>
                    <div><p className="text-niebla">Retirados</p><p className="font-display text-xl text-marfil">{n(a.economy.removed)}</p></div>
                  </div>
                  <table className="w-full text-sm">
                    <thead><tr><th className={th}>Origen</th><th className={th}>Movimientos</th><th className={`${th} text-right`}>Créditos</th></tr></thead>
                    <tbody>
                      {created.map((f) => (
                        <tr key={f.reason}><td className={td}>{REASON[f.reason] ?? f.reason}</td><td className={td}>{n(f.count)}</td><td className={`${td} text-right`}>{signed(f.total)}</td></tr>
                      ))}
                      <tr><td className={td}>Resultado de los juegos</td><td className={td}>—</td><td className={`${td} text-right`}>{signed(-a.economy.houseProfit)}</td></tr>
                    </tbody>
                  </table>
                  <p className="mt-3 text-xs text-niebla">Si se crean muchos más créditos de los que retira la casa, sube la inflación: cada vez valen menos los premios.</p>
                </Card>
                <Card title="Jugadores destacados (7 días)">
                  <div className="grid gap-4 sm:grid-cols-2">
                    <div>
                      <p className="mb-2 text-sm text-niebla">Más ganancia neta</p>
                      <ol className="space-y-1 text-sm">{a.players.topWinners.map((p) => <li key={p.username} className="flex justify-between gap-2"><span className="truncate text-marfil">{p.username}</span><span className="text-niebla">{signed(p.net)}</span></li>)}{a.players.topWinners.length === 0 && <li className="text-niebla">—</li>}</ol>
                    </div>
                    <div>
                      <p className="mb-2 text-sm text-niebla">Más partidas</p>
                      <ol className="space-y-1 text-sm">{a.players.mostActive.map((p) => <li key={p.username} className="flex justify-between gap-2"><span className="truncate text-marfil">{p.username}</span><span className="text-niebla">{n(p.rounds)}</span></li>)}{a.players.mostActive.length === 0 && <li className="text-niebla">—</li>}</ol>
                    </div>
                  </div>
                  <p className="mb-2 mt-5 text-sm text-niebla">Mayores premios</p>
                  <ul className="space-y-1 text-sm">
                    {a.players.bigWins.map((w, i) => <li key={i} className="flex justify-between gap-2"><span className="truncate text-marfil">{w.username} · {GAME_NAMES[w.game] ?? w.game}</span><span className="text-niebla">{signed(w.payout - w.bet)}</span></li>)}
                    {a.players.bigWins.length === 0 && <li className="text-niebla">Sin partidas esta semana.</li>}
                  </ul>
                </Card>
              </div>
              <p className="text-xs text-niebla">Días según la zona horaria {a.timezone}. Solo cuentan jugadores (los administradores juegan con saldo ilimitado).</p>
            </>
          );
        }}
      </Loadable>
    </div>
  );
}
