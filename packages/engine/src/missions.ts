/**
 * Misiones diarias (3) y semanales (5). Se eligen al azar para cada jugador y
 * periodo de forma reproducible (semilla = jugador + periodo), y avanzan con
 * cada partida liquidada.
 */

export type MissionMetric = 'rounds' | 'wins' | 'wagered' | 'netWon' | 'distinctGames';
export type MissionGame = 'blackjack' | 'roulette' | 'slots' | 'poker' | 'bingo' | 'crash' | 'plinko';

export interface MissionTemplate {
  id: string;
  scope: 'daily' | 'weekly';
  metric: MissionMetric;
  game: MissionGame | null;
  target: number;
  text: string;
}

const d = (id: string, metric: MissionMetric, game: MissionGame | null, target: number, text: string): MissionTemplate => ({ id: `d-${id}`, scope: 'daily', metric, game, target, text });
const w = (id: string, metric: MissionMetric, game: MissionGame | null, target: number, text: string): MissionTemplate => ({ id: `w-${id}`, scope: 'weekly', metric, game, target, text });

export const MISSIONS: readonly MissionTemplate[] = [
  d('jugar10', 'rounds', null, 10, 'Juega 10 partidas'),
  d('ganar3', 'wins', null, 3, 'Gana 3 partidas'),
  d('apostar1000', 'wagered', null, 1000, 'Apuesta 1.000 créditos en total'),
  d('neto500', 'netWon', null, 500, 'Gana 500 créditos netos'),
  d('poker5', 'rounds', 'poker', 5, 'Juega 5 manos de póker'),
  d('slots20', 'rounds', 'slots', 20, 'Haz 20 tiradas en las tragaperras'),
  d('plinko30', 'rounds', 'plinko', 30, 'Lanza 30 bolas de plinko'),
  d('cohete3', 'rounds', 'crash', 3, 'Juega 3 rondas del cohete'),
  d('ruleta5', 'rounds', 'roulette', 5, 'Juega 5 giros de ruleta'),
  d('bj3', 'rounds', 'blackjack', 3, 'Juega 3 manos de blackjack'),
  d('bingo1', 'rounds', 'bingo', 1, 'Juega una partida de bingo'),
  d('juegos3', 'distinctGames', null, 3, 'Juega a 3 juegos distintos'),
  w('jugar60', 'rounds', null, 60, 'Juega 60 partidas'),
  w('ganar20', 'wins', null, 20, 'Gana 20 partidas'),
  w('apostar15000', 'wagered', null, 15000, 'Apuesta 15.000 créditos en total'),
  w('neto5000', 'netWon', null, 5000, 'Gana 5.000 créditos netos'),
  w('juegos5', 'distinctGames', null, 5, 'Juega a 5 juegos distintos'),
  w('poker30', 'rounds', 'poker', 30, 'Juega 30 manos de póker'),
  w('bingo8', 'rounds', 'bingo', 8, 'Juega 8 partidas de bingo'),
  w('slots150', 'rounds', 'slots', 150, 'Haz 150 tiradas en las tragaperras'),
  w('plinko200', 'rounds', 'plinko', 200, 'Lanza 200 bolas de plinko'),
  w('cohete25', 'rounds', 'crash', 25, 'Juega 25 rondas del cohete'),
  w('bj30', 'rounds', 'blackjack', 30, 'Juega 30 manos de blackjack'),
  w('ruleta40', 'rounds', 'roulette', 40, 'Juega 40 giros de ruleta'),
  w('ganarbj10', 'wins', 'blackjack', 10, 'Gana 10 manos de blackjack'),
  w('ganarpoker10', 'wins', 'poker', 10, 'Gana 10 manos de póker'),
];

export const MISSION_BY_ID: Record<string, MissionTemplate> = Object.fromEntries(MISSIONS.map((m) => [m.id, m]));
export const MISSIONS_PER_PERIOD = { daily: 3, weekly: 5 } as const;
export const MISSION_REWARD: Record<'daily' | 'weekly', string> = { daily: 'diaria', weekly: 'semanal' };

/** FNV-1a de 32 bits: semilla estable a partir de un texto. */
function hash(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i += 1) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h;
}

/** Misiones del jugador para un periodo (siempre las mismas para el mismo jugador y periodo). */
export function pickMissions(userId: string, scope: 'daily' | 'weekly', periodKey: string): MissionTemplate[] {
  const pool = MISSIONS.filter((m) => m.scope === scope);
  let seed = hash(`${userId}|${scope}|${periodKey}`) || 1;
  const rnd = (): number => {
    seed ^= seed << 13;
    seed >>>= 0;
    seed ^= seed >>> 17;
    seed ^= seed << 5;
    seed >>>= 0;
    return seed / 4294967296;
  };
  const shuffled = pool.map((m) => ({ m, k: rnd() })).sort((a, b) => a.k - b.k).map((x) => x.m);
  // Como mucho una misión del mismo juego concreto, para que no se repitan.
  const out: MissionTemplate[] = [];
  const games = new Set<string>();
  for (const m of shuffled) {
    if (m.game && games.has(m.game)) continue;
    if (m.game) games.add(m.game);
    out.push(m);
    if (out.length === MISSIONS_PER_PERIOD[scope]) break;
  }
  return out;
}

export interface OutcomeLike {
  game: MissionGame;
  bet: number;
  payout: number;
}

/** Cuánto avanza una misión con una partida (para distinctGames, la interfaz guarda los juegos vistos). */
export function missionIncrement(m: MissionTemplate, o: OutcomeLike): number {
  if (m.game && m.game !== o.game) return 0;
  switch (m.metric) {
    case 'rounds':
      return 1;
    case 'wins':
      return o.payout > o.bet ? 1 : 0;
    case 'wagered':
      return o.bet;
    case 'netWon':
      return Math.max(0, o.payout - o.bet);
    case 'distinctGames':
      return 0;
  }
}

/** Clave de semana ISO (lunes a domingo) a partir de un día local AAAA-MM-DD. */
export function isoWeekKey(day: string): string {
  const [y, m, dd] = day.split('-').map(Number) as [number, number, number];
  const date = new Date(Date.UTC(y, m - 1, dd));
  const dow = (date.getUTCDay() + 6) % 7; // lunes = 0
  date.setUTCDate(date.getUTCDate() - dow + 3); // jueves de esa semana
  const firstThursday = new Date(Date.UTC(date.getUTCFullYear(), 0, 4));
  const week = 1 + Math.round(((date.getTime() - firstThursday.getTime()) / 86400000 - 3 + ((firstThursday.getUTCDay() + 6) % 7)) / 7);
  return `${date.getUTCFullYear()}-W${String(week).padStart(2, '0')}`;
}
