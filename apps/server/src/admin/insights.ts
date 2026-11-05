import type { Database } from '../db/database';
import { dayKey, shiftDay, startOfDay } from '../economy/period';

const GAME_REASONS = ['bet', 'payout', 'poker_buyin', 'poker_cashout', 'refund'];

/**
 * Actividad y economía para el panel: usuarios activos, retención, visitas,
 * juegos, beneficio de la casa y de dónde salen los créditos.
 * Solo cuentan jugadores (los administradores juegan con saldo ilimitado).
 */
export function activityReport(db: Database, tz: string, days: number, now = new Date()) {
  const today = dayKey(now, tz);
  const first = shiftDay(today, -(days - 1));
  const fromIso = startOfDay(first, tz).toISOString();
  const range: string[] = [];
  for (let d = first; d <= today; d = shiftDay(d, 1)) range.push(d);
  const toLocalDay = (iso: string): string => dayKey(new Date(iso), tz);

  // Usuarios activos
  const dauRows = db.all<{ day: string; n: number }>('SELECT day, COUNT(*) AS n FROM daily_activity WHERE day >= ? GROUP BY day', first);
  const dau = new Map(dauRows.map((r) => [r.day, Number(r.n)]));
  const distinctSince = (day: string): number => Number(db.get<{ n: number }>('SELECT COUNT(DISTINCT user_id) AS n FROM daily_activity WHERE day >= ?', day)!.n);
  const newRows = db.all<{ created_at: string }>(`SELECT created_at FROM users WHERE role = 'player' AND created_at >= ?`, fromIso);
  const newByDay = new Map<string, number>();
  for (const r of newRows) newByDay.set(toLocalDay(r.created_at), (newByDay.get(toLocalDay(r.created_at)) ?? 0) + 1);

  // Retención: de quienes se registraron hace 8–37 días, cuántos volvieron al día siguiente y a la semana.
  const cohortFrom = startOfDay(shiftDay(today, -37), tz).toISOString();
  const cohortTo = startOfDay(shiftDay(today, -7), tz).toISOString();
  const cohort = db.all<{ id: string; created_at: string }>(`SELECT id, created_at FROM users WHERE role = 'player' AND created_at >= ? AND created_at < ?`, cohortFrom, cohortTo);
  let d1 = 0;
  let d7 = 0;
  if (cohort.length) {
    const act = new Set(db.all<{ user_id: string; day: string }>('SELECT user_id, day FROM daily_activity WHERE day >= ?', shiftDay(today, -37)).map((r) => `${r.user_id}|${r.day}`));
    for (const u of cohort) {
      const day0 = toLocalDay(u.created_at);
      if (act.has(`${u.id}|${shiftDay(day0, 1)}`)) d1 += 1;
      if (act.has(`${u.id}|${shiftDay(day0, 7)}`)) d7 += 1;
    }
  }
  const pct = (n: number, of: number): number | null => (of ? Math.round((n / of) * 1000) / 10 : null);

  // Visitas
  const viewsRows = db.all<{ day: string; n: number }>('SELECT day, SUM(views) AS n FROM page_views WHERE day >= ? GROUP BY day', first);
  const views = new Map(viewsRows.map((r) => [r.day, Number(r.n)]));
  const visitorRows = db.all<{ day: string; n: number }>('SELECT day, COUNT(*) AS n FROM daily_visitors WHERE day >= ? GROUP BY day', first);
  const visitors = new Map(visitorRows.map((r) => [r.day, Number(r.n)]));
  const peakRows = db.all<{ day: string; n: number }>('SELECT day, peak_online AS n FROM site_daily WHERE day >= ?', first);
  const peak = new Map(peakRows.map((r) => [r.day, Number(r.n)]));
  const sections = db.all<{ path: string; views: number }>('SELECT path, SUM(views) AS views FROM page_views WHERE day >= ? GROUP BY path ORDER BY views DESC LIMIT 12', first)
    .map((r) => ({ path: r.path, views: Number(r.views) }));

  // Juegos (por hora UTC y luego al día local, para respetar la zona horaria)
  const gameRows = db.all<{ hour: string; game: string; rounds: number; players: number; bet: number; payout: number }>(
    `SELECT substr(r.created_at, 1, 13) AS hour, r.game, COUNT(*) AS rounds, COUNT(DISTINCT r.user_id) AS players,
            SUM(r.bet_total) AS bet, SUM(r.payout) AS payout
     FROM game_rounds r JOIN users u ON u.id = r.user_id
     WHERE r.status = 'settled' AND u.role = 'player' AND r.created_at >= ?
     GROUP BY substr(r.created_at, 1, 13), r.game`,
    fromIso,
  );
  const profitByDay = new Map<string, number>();
  const roundsByDay = new Map<string, number>();
  for (const g of gameRows) {
    const day = toLocalDay(`${g.hour}:00:00.000Z`);
    profitByDay.set(day, (profitByDay.get(day) ?? 0) + Number(g.bet) - Number(g.payout));
    roundsByDay.set(day, (roundsByDay.get(day) ?? 0) + Number(g.rounds));
  }
  const gamesAgg = db.all<{ game: string; rounds: number; players: number; bet: number; payout: number }>(
    `SELECT r.game, COUNT(*) AS rounds, COUNT(DISTINCT r.user_id) AS players, SUM(r.bet_total) AS bet, SUM(r.payout) AS payout
     FROM game_rounds r JOIN users u ON u.id = r.user_id
     WHERE r.status = 'settled' AND u.role = 'player' AND r.created_at >= ?
     GROUP BY r.game ORDER BY COUNT(*) DESC`,
    fromIso,
  ).map((g) => ({
    game: g.game,
    rounds: Number(g.rounds),
    players: Number(g.players),
    bet: Number(g.bet),
    payout: Number(g.payout),
    houseProfit: Number(g.bet) - Number(g.payout),
    rtp: Number(g.bet) > 0 ? Math.round((Number(g.payout) / Number(g.bet)) * 1000) / 10 : null,
  }));

  // Economía: créditos en circulación y de dónde salen o adónde van
  const circulating = Number(db.get<{ s: number }>(`SELECT COALESCE(SUM(balance), 0) AS s FROM users WHERE role = 'player'`)!.s);
  const flows = db.all<{ reason: string; total: number; n: number }>(
    `SELECT w.reason, SUM(w.amount) AS total, COUNT(*) AS n FROM wallet_transactions w JOIN users u ON u.id = w.user_id
     WHERE w.unlimited = 0 AND u.role = 'player' AND w.created_at >= ? GROUP BY w.reason ORDER BY SUM(w.amount) DESC`,
    fromIso,
  ).map((f) => ({ reason: f.reason, total: Number(f.total), count: Number(f.n), game: GAME_REASONS.includes(f.reason) }));

  const sinceWeek = startOfDay(shiftDay(today, -6), tz).toISOString();
  const topWinners = db.all<{ username: string; net: number; rounds: number }>(
    `SELECT u.username, SUM(r.payout - r.bet_total) AS net, COUNT(*) AS rounds FROM game_rounds r JOIN users u ON u.id = r.user_id
     WHERE r.status = 'settled' AND u.role = 'player' AND r.created_at >= ? GROUP BY u.username ORDER BY SUM(r.payout - r.bet_total) DESC LIMIT 5`,
    sinceWeek,
  ).map((r) => ({ username: r.username, net: Number(r.net), rounds: Number(r.rounds) }));
  const mostActive = db.all<{ username: string; rounds: number; net: number }>(
    `SELECT u.username, COUNT(*) AS rounds, SUM(r.payout - r.bet_total) AS net FROM game_rounds r JOIN users u ON u.id = r.user_id
     WHERE r.status = 'settled' AND u.role = 'player' AND r.created_at >= ? GROUP BY u.username ORDER BY COUNT(*) DESC LIMIT 5`,
    sinceWeek,
  ).map((r) => ({ username: r.username, rounds: Number(r.rounds), net: Number(r.net) }));
  const bigWins = db.all<{ username: string; game: string; bet: number; payout: number; at: string }>(
    `SELECT u.username, r.game, r.bet_total AS bet, r.payout, r.settled_at AS at FROM game_rounds r JOIN users u ON u.id = r.user_id
     WHERE r.status = 'settled' AND u.role = 'player' AND r.created_at >= ? ORDER BY (r.payout - r.bet_total) DESC LIMIT 5`,
    sinceWeek,
  ).map((r) => ({ ...r, bet: Number(r.bet), payout: Number(r.payout) }));

  const totalPlayers = Number(db.get<{ n: number }>(`SELECT COUNT(*) AS n FROM users WHERE role = 'player'`)!.n);

  return {
    timezone: tz,
    days: range.map((day) => ({
      day,
      active: dau.get(day) ?? 0,
      newUsers: newByDay.get(day) ?? 0,
      visitors: visitors.get(day) ?? 0,
      views: views.get(day) ?? 0,
      peakOnline: peak.get(day) ?? 0,
      rounds: roundsByDay.get(day) ?? 0,
      houseProfit: profitByDay.get(day) ?? 0,
    })),
    users: {
      total: totalPlayers,
      dau: dau.get(today) ?? 0,
      wau: distinctSince(shiftDay(today, -6)),
      mau: distinctSince(shiftDay(today, -29)),
      newInRange: newRows.length,
      retention: { cohort: cohort.length, d1: pct(d1, cohort.length), d7: pct(d7, cohort.length) },
    },
    sections,
    games: gamesAgg,
    economy: {
      circulating,
      flows,
      houseProfit: gamesAgg.reduce((s, g) => s + g.houseProfit, 0),
      created: flows.filter((f) => !f.game && f.total > 0).reduce((s, f) => s + f.total, 0),
      removed: -flows.filter((f) => !f.game && f.total < 0).reduce((s, f) => s + f.total, 0),
    },
    players: { topWinners, mostActive, bigWins },
  };
}
