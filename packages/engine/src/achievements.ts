/**
 * Catálogo de logros. Se desbloquean exclusivamente a partir de resultados
 * reales liquidados por el servidor; no influyen en ningún resultado.
 */
export type AchievementId =
  | 'first_win'
  | 'streak_3'
  | 'streak_5'
  | 'streak_10'
  | 'blackjack_natural'
  | 'poker_full_house'
  | 'poker_quads_plus'
  | 'slots_big_win'
  | 'roulette_straight'
  | 'rounds_50'
  | 'rounds_250'
  | 'personal_best'
  | 'mission_done';

export interface AchievementDef {
  id: AchievementId;
  title: string;
  description: string;
  icon: string; // nombre de icono Lucide
  tier: 'bronze' | 'silver' | 'gold';
}

export const ACHIEVEMENTS: readonly AchievementDef[] = [
  { id: 'first_win', title: 'Primera victoria', description: 'Gana tu primera partida.', icon: 'Sparkles', tier: 'bronze' },
  { id: 'streak_3', title: 'En racha', description: 'Encadena 3 partidas ganadas.', icon: 'Flame', tier: 'bronze' },
  { id: 'streak_5', title: 'Racha dorada', description: 'Encadena 5 partidas ganadas.', icon: 'Flame', tier: 'silver' },
  { id: 'streak_10', title: 'Imparable', description: 'Encadena 10 partidas ganadas.', icon: 'Crown', tier: 'gold' },
  { id: 'blackjack_natural', title: 'Natural', description: 'Consigue un blackjack natural.', icon: 'Spade', tier: 'bronze' },
  { id: 'poker_full_house', title: 'Casa llena', description: 'Gana un bote con full o mejor.', icon: 'Layers', tier: 'silver' },
  { id: 'poker_quads_plus', title: 'Mano legendaria', description: 'Gana un bote con póker o escalera de color.', icon: 'Gem', tier: 'gold' },
  { id: 'slots_big_win', title: 'Gran premio', description: 'Obtén un premio de 15× o más en slots.', icon: 'Star', tier: 'silver' },
  { id: 'roulette_straight', title: 'Pleno', description: 'Acierta un pleno en la ruleta.', icon: 'Target', tier: 'silver' },
  { id: 'rounds_50', title: 'Habitual', description: 'Juega 50 partidas.', icon: 'Medal', tier: 'bronze' },
  { id: 'rounds_250', title: 'Veterano', description: 'Juega 250 partidas.', icon: 'Trophy', tier: 'gold' },
  { id: 'personal_best', title: 'Nueva mejor marca', description: 'Supera tu mayor premio individual.', icon: 'TrendingUp', tier: 'bronze' },
  { id: 'mission_done', title: 'Misión completada', description: 'Reclama tu caja en Misiones.', icon: 'Gift', tier: 'silver' },
];

export const ACHIEVEMENT_BY_ID: Readonly<Record<AchievementId, AchievementDef>> = Object.fromEntries(
  ACHIEVEMENTS.map((a) => [a.id, a]),
) as Record<AchievementId, AchievementDef>;
