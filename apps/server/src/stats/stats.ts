import { ACHIEVEMENT_BY_ID, type AchievementDef, type AchievementId } from '@aurum/engine';
import type { Database } from '../db/database';
import { nowIso } from '../db/database';

export type GameId = 'blackjack' | 'roulette' | 'slots' | 'poker' | 'bingo' | 'crash' | 'plinko';

export interface OutcomeFlags {
  natural?: boolean;
  pokerCategory?: number;
  slotsMultiplier?: number;
  rouletteStraightHit?: boolean;
}

export interface OutcomeInput {
  userId: string;
  game: GameId;
  bet: number;
  payout: number;
  roundId: string;
  flags?: OutcomeFlags;
}

export interface UnlockedAchievement extends AchievementDef {
  unlockedAt: string;
}

/**
 * Actualiza estadísticas, racha y logros a partir de un resultado ya liquidado.
 * Ganar = recibir más de lo apostado; perder = menos; igual = empate (no rompe la racha).
 */
export function recordOutcome(db: Database, input: OutcomeInput): { unlocked: UnlockedAchievement[]; streak: number } {
  return db.tx(() => {
    const now = nowIso();
    const net = input.payout - input.bet;
    const win = net > 0 ? 1 : 0;
    const loss = net < 0 ? 1 : 0;
    const push = net === 0 ? 1 : 0;

    db.run('INSERT INTO user_stats (user_id, updated_at) VALUES (?, ?) ON CONFLICT DO NOTHING', input.userId, now);
    const prev = db.get<{ current_streak: number; best_streak: number; biggest_win: number; rounds: number; wins: number }>(
      'SELECT current_streak, best_streak, biggest_win, rounds, wins FROM user_stats WHERE user_id = ?',
      input.userId,
    )!;
    const streak = win ? prev.current_streak + 1 : loss ? 0 : prev.current_streak;
    const bestStreak = Math.max(prev.best_streak, streak);
    const biggest = Math.max(prev.biggest_win, Math.max(0, net));
    db.run(
      `UPDATE user_stats SET rounds = rounds + 1, wins = wins + ?, losses = losses + ?, pushes = pushes + ?,
         total_bet = total_bet + ?, total_payout = total_payout + ?, current_streak = ?, best_streak = ?, biggest_win = ?, updated_at = ?
       WHERE user_id = ?`,
      win, loss, push, input.bet, input.payout, streak, bestStreak, biggest, now, input.userId,
    );
    db.run(
      `INSERT INTO user_game_stats (user_id, game, rounds, wins, losses, total_bet, total_payout) VALUES (?, ?, 1, ?, ?, ?, ?)
       ON CONFLICT(user_id, game) DO UPDATE SET rounds = user_game_stats.rounds + 1, wins = user_game_stats.wins + excluded.wins,
         losses = user_game_stats.losses + excluded.losses, total_bet = user_game_stats.total_bet + excluded.total_bet,
         total_payout = user_game_stats.total_payout + excluded.total_payout`,
      input.userId, input.game, win, loss, input.bet, input.payout,
    );

    // Logros: solo a partir de datos reales registrados.
    const candidates: AchievementId[] = [];
    const rounds = prev.rounds + 1;
    if (win && prev.wins === 0) candidates.push('first_win');
    if (streak >= 3) candidates.push('streak_3');
    if (streak >= 5) candidates.push('streak_5');
    if (streak >= 10) candidates.push('streak_10');
    if (rounds >= 50) candidates.push('rounds_50');
    if (rounds >= 250) candidates.push('rounds_250');
    if (input.flags?.natural) candidates.push('blackjack_natural');
    if (win && (input.flags?.pokerCategory ?? -1) >= 6) candidates.push('poker_full_house');
    if (win && (input.flags?.pokerCategory ?? -1) >= 7) candidates.push('poker_quads_plus');
    if ((input.flags?.slotsMultiplier ?? 0) >= 15) candidates.push('slots_big_win');
    if (input.flags?.rouletteStraightHit) candidates.push('roulette_straight');

    const unlocked: UnlockedAchievement[] = [];
    for (const id of candidates) {
      const r = db.run(
        'INSERT INTO user_achievements (user_id, achievement_id, round_id, unlocked_at) VALUES (?, ?, ?, ?) ON CONFLICT DO NOTHING',
        input.userId, id, input.roundId, now,
      );
      if (r.changes === 1) unlocked.push({ ...ACHIEVEMENT_BY_ID[id], unlockedAt: now });
    }
    // "Nueva mejor marca" es repetible: se notifica cada vez que se supera el récord (tras haber ganado alguna vez).
    if (net > 0 && net > prev.biggest_win && prev.biggest_win > 0) {
      unlocked.push({ ...ACHIEVEMENT_BY_ID.personal_best, unlockedAt: now });
      db.run(
        `INSERT INTO user_achievements (user_id, achievement_id, round_id, unlocked_at) VALUES (?, 'personal_best', ?, ?)
         ON CONFLICT(user_id, achievement_id) DO UPDATE SET round_id = excluded.round_id, unlocked_at = excluded.unlocked_at`,
        input.userId, input.roundId, now,
      );
    }
    return { unlocked, streak };
  });
}
