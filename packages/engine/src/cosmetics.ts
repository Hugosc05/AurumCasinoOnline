/**
 * Catálogo de recompensas cosméticas. No dan ventaja en ningún juego: solo
 * cambian cómo se ven tu foto, tu nombre y tus cartas.
 */

export type Rarity = 'common' | 'uncommon' | 'rare' | 'epic' | 'legendary' | 'mythic' | 'exceptional';

export const RARITIES: readonly Rarity[] = ['common', 'uncommon', 'rare', 'epic', 'legendary', 'mythic', 'exceptional'];

/** Nombres y colores al estilo de las cajas de CS:GO. */
export const RARITY_INFO: Record<Rarity, { label: string; color: string }> = {
  common: { label: 'Común', color: '#b0c3d9' },
  uncommon: { label: 'Poco común', color: '#5e98d9' },
  rare: { label: 'Rara', color: '#4b69ff' },
  epic: { label: 'Épica', color: '#8847ff' },
  legendary: { label: 'Legendaria', color: '#d32ce6' },
  mythic: { label: 'Mítica', color: '#eb4b4b' },
  exceptional: { label: 'Excepcional', color: '#e4ae39' },
};

export type CosmeticKind = 'cardBack' | 'frame' | 'nameColor';

export interface Cosmetic {
  id: string;
  kind: CosmeticKind;
  name: string;
  rarity: Rarity;
  /** Créditos que se reciben si sale repetido. */
  dupValue: number;
}

export const COSMETIC_KIND_LABEL: Record<CosmeticKind, string> = { cardBack: 'Dorso de cartas', frame: 'Marco de foto', nameColor: 'Color de nombre' };

const DUP: Record<Rarity, number> = { common: 40, uncommon: 100, rare: 250, epic: 600, legendary: 1500, mythic: 4000, exceptional: 10000 };
const c = (id: string, kind: CosmeticKind, name: string, rarity: Rarity): Cosmetic => ({ id, kind, name, rarity, dupValue: DUP[rarity] });

export const COSMETICS: readonly Cosmetic[] = [
  // Dorsos de cartas
  c('back:rubi', 'cardBack', 'Dorso Rubí', 'common'),
  c('back:esmeralda', 'cardBack', 'Dorso Esmeralda', 'common'),
  c('back:zafiro', 'cardBack', 'Dorso Zafiro', 'uncommon'),
  c('back:carbono', 'cardBack', 'Dorso Carbono', 'rare'),
  c('back:neon', 'cardBack', 'Dorso Neón', 'epic'),
  c('back:dragon', 'cardBack', 'Dorso Dragón', 'legendary'),
  c('back:galaxia', 'cardBack', 'Dorso Galaxia', 'mythic'),
  c('back:oro', 'cardBack', 'Dorso Oro de 24 quilates', 'exceptional'),
  // Marcos de foto
  c('frame:plata', 'frame', 'Marco de plata', 'common'),
  c('frame:oro', 'frame', 'Marco de oro', 'uncommon'),
  c('frame:neon', 'frame', 'Marco neón rosa', 'rare'),
  c('frame:electrico', 'frame', 'Marco eléctrico', 'epic'),
  c('frame:llamas', 'frame', 'Marco en llamas', 'legendary'),
  c('frame:arcoiris', 'frame', 'Marco arcoíris', 'mythic'),
  c('frame:diamante', 'frame', 'Marco de diamantes', 'exceptional'),
  // Colores de nombre
  c('name:oro', 'nameColor', 'Nombre dorado', 'common'),
  c('name:esmeralda', 'nameColor', 'Nombre esmeralda', 'common'),
  c('name:zafiro', 'nameColor', 'Nombre zafiro', 'uncommon'),
  c('name:rubi', 'nameColor', 'Nombre rubí', 'uncommon'),
  c('name:rosa', 'nameColor', 'Nombre rosa neón', 'rare'),
  c('name:fuego', 'nameColor', 'Nombre de fuego', 'epic'),
  c('name:hielo', 'nameColor', 'Nombre de hielo', 'legendary'),
  c('name:arcoiris', 'nameColor', 'Nombre arcoíris', 'mythic'),
];

export const COSMETIC_BY_ID: Record<string, Cosmetic> = Object.fromEntries(COSMETICS.map((x) => [x.id, x]));

export function cosmeticsByRarity(r: Rarity): Cosmetic[] {
  return COSMETICS.filter((x) => x.rarity === r);
}
