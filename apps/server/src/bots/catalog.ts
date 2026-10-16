import type { BjBetStyle, BjStrategy, BotDifficulty, BotProfile } from '@aurum/engine';

/**
 * Catálogo de bots de demostración.
 *
 * Nombres de fantasía (no corresponden a personas reales) con un aire de
 * apodo de jugador. En toda la interfaz llevan el distintivo BOT y se explica
 * que son participantes automatizados. Estos nombres quedan reservados: no
 * se pueden registrar como usuario.
 */

export type Experience = 'novato' | 'regular' | 'veterano';

/** Descripción de un avatar original dibujado en SVG por la interfaz. */
export interface AvatarSpec {
  bg: [string, string];
  skin: string;
  hair: { style: 'short' | 'long' | 'bun' | 'curly' | 'shaved' | 'wavy' | 'bob'; color: string };
  outfit: string;
  accessory: 'none' | 'glasses' | 'shades' | 'earring' | 'cap' | 'headphones' | 'visor';
  pattern: 'none' | 'dots' | 'stripes' | 'rays';
}

export interface BotSpec {
  name: string;
  /** Nombre antiguo (versiones anteriores) para conservar el historial del bot. */
  legacy?: string;
  profile: BotProfile;
  difficulty: BotDifficulty;
  bjStrategy: BjStrategy;
  betStyle: BjBetStyle;
  experience: Experience;
  tagline: string;
  avatar: AvatarSpec;
}

const SKIN = ['#f3d2b8', '#e8b998', '#cf9b78', '#b07d5a', '#8d5b3c', '#6a4128'];
const HAIR = ['#1d1612', '#3a2618', '#6b3e1f', '#a8672e', '#d9b25f', '#8c8c94', '#5a2a5e', '#b23b3b'];

const av = (bg: [string, string], skin: number, style: AvatarSpec['hair']['style'], hair: number, outfit: string, accessory: AvatarSpec['accessory'], pattern: AvatarSpec['pattern'] = 'none'): AvatarSpec => ({
  bg, skin: SKIN[skin]!, hair: { style, color: HAIR[hair]! }, outfit, accessory, pattern,
});

export const BOT_CATALOG: readonly BotSpec[] = [
  { name: 'AlexRacing', legacy: 'Bot Atlas', profile: 'analytical', difficulty: 'hard', bjStrategy: 'basic', betStyle: 'steady', experience: 'veterano', tagline: 'Calcula cada bote antes de mover ficha.', avatar: av(['#1f3b73', '#0d1a36'], 1, 'short', 0, '#c43d3d', 'visor', 'stripes') },
  { name: 'LunaCards', legacy: 'Bot Brisa', profile: 'conservative', difficulty: 'normal', bjStrategy: 'cautious', betStyle: 'minimum', experience: 'regular', tagline: 'Paciente: espera la mano buena.', avatar: av(['#3d2a6b', '#170f30'], 0, 'long', 7, '#e8e2f5', 'earring', 'dots') },
  { name: 'MarcosAce', legacy: 'Bot Ciro', profile: 'aggressive', difficulty: 'normal', bjStrategy: 'bold', betStyle: 'varied', experience: 'regular', tagline: 'Si hay que subir, sube.', avatar: av(['#7a1f2b', '#2e0a10'], 3, 'curly', 0, '#1d1d24', 'none', 'rays') },
  { name: 'SofiaBlack', legacy: 'Bot Dalia', profile: 'balanced', difficulty: 'normal', bjStrategy: 'basic', betStyle: 'steady', experience: 'veterano', tagline: 'Juego sólido, sin sorpresas.', avatar: av(['#1a1a1f', '#3b3b46'], 2, 'bob', 0, '#cfae6b', 'glasses') },
  { name: 'DanielRiver', legacy: 'Bot Eco', profile: 'analytical', difficulty: 'normal', bjStrategy: 'basic', betStyle: 'steady', experience: 'regular', tagline: 'Le gusta ver la última carta.', avatar: av(['#0f5a5e', '#06282a'], 4, 'short', 1, '#f2efe6', 'none', 'dots') },
  { name: 'Vega77', legacy: 'Bot Fénix', profile: 'aggressive', difficulty: 'hard', bjStrategy: 'bold', betStyle: 'varied', experience: 'veterano', tagline: 'Presión constante en cada calle.', avatar: av(['#b8541a', '#4a1d05'], 1, 'shaved', 0, '#20242e', 'shades', 'rays') },
  { name: 'NicoBluff', legacy: 'Bot Gaia', profile: 'conservative', difficulty: 'easy', bjStrategy: 'cautious', betStyle: 'minimum', experience: 'novato', tagline: 'Aprendiendo; a veces se lanza.', avatar: av(['#3f7a3a', '#12280f'], 0, 'wavy', 4, '#f0c84b', 'cap') },
  { name: 'ElenaRoyal', legacy: 'Bot Hugo', profile: 'balanced', difficulty: 'easy', bjStrategy: 'basic', betStyle: 'minimum', experience: 'novato', tagline: 'Juega por diversión.', avatar: av(['#8a2f6f', '#2c0b23'], 2, 'bun', 2, '#f4dce8', 'earring', 'dots') },
  { name: 'MaxTurn', legacy: 'Bot Iris', profile: 'balanced', difficulty: 'hard', bjStrategy: 'basic', betStyle: 'steady', experience: 'veterano', tagline: 'Decide en el turn.', avatar: av(['#2b4a8c', '#0c1733'], 3, 'short', 3, '#e7e2d4', 'headphones') },
  { name: 'CarlaDiamond', legacy: 'Bot Jano', profile: 'conservative', difficulty: 'hard', bjStrategy: 'cautious', betStyle: 'steady', experience: 'veterano', tagline: 'Pocas manos, bien elegidas.', avatar: av(['#1b6f7a', '#062a2f'], 0, 'long', 4, '#9be3f0', 'none', 'rays') },
  { name: 'KaiStack', legacy: 'Bot Kira', profile: 'aggressive', difficulty: 'easy', bjStrategy: 'bold', betStyle: 'varied', experience: 'novato', tagline: 'Fichas al centro sin pensarlo mucho.', avatar: av(['#a33b1f', '#3a0f05'], 5, 'curly', 0, '#f3e9d2', 'cap', 'stripes') },
  { name: 'IreneFlush', legacy: 'Bot Lince', profile: 'analytical', difficulty: 'easy', bjStrategy: 'basic', betStyle: 'minimum', experience: 'novato', tagline: 'Persigue los colores.', avatar: av(['#5b3f8f', '#1c1133'], 1, 'bob', 6, '#ffd7a8', 'glasses', 'dots') },
  { name: 'PabloKicker', legacy: 'Bot Mora', profile: 'balanced', difficulty: 'normal', bjStrategy: 'basic', betStyle: 'varied', experience: 'regular', tagline: 'Gana por la carta alta.', avatar: av(['#4a5a23', '#181f07'], 4, 'shaved', 0, '#d9c27a', 'none') },
  { name: 'NoraStraight', legacy: 'Bot Nilo', profile: 'conservative', difficulty: 'normal', bjStrategy: 'cautious', betStyle: 'steady', experience: 'regular', tagline: 'Ordenada como una escalera.', avatar: av(['#2f6f4e', '#0b2a1c'], 3, 'bun', 0, '#f2e9d8', 'glasses', 'stripes') },
  { name: 'OscarPairs', legacy: 'Bot Onix', profile: 'analytical', difficulty: 'hard', bjStrategy: 'basic', betStyle: 'steady', experience: 'veterano', tagline: 'Lee las apuestas de la mesa.', avatar: av(['#32323c', '#101014'], 5, 'short', 5, '#b02a3c', 'none', 'dots') },
  { name: 'MiaShuffle', legacy: 'Bot Pira', profile: 'aggressive', difficulty: 'normal', bjStrategy: 'bold', betStyle: 'varied', experience: 'regular', tagline: 'Ritmo rápido, apuestas grandes.', avatar: av(['#c2416b', '#45101f'], 0, 'wavy', 3, '#1f1f28', 'headphones', 'rays') },
  { name: 'TheoChips', profile: 'balanced', difficulty: 'normal', bjStrategy: 'basic', betStyle: 'steady', experience: 'regular', tagline: 'Siempre con la pila ordenada.', avatar: av(['#6b4a1f', '#26180a'], 2, 'curly', 2, '#f0e6cf', 'glasses') },
  { name: 'JulietaSpades', profile: 'conservative', difficulty: 'normal', bjStrategy: 'cautious', betStyle: 'minimum', experience: 'regular', tagline: 'Fan de las picas.', avatar: av(['#14213d', '#05091a'], 1, 'long', 0, '#e9eef8', 'earring', 'stripes') },
  { name: 'RubenAllIn', profile: 'aggressive', difficulty: 'hard', bjStrategy: 'bold', betStyle: 'varied', experience: 'veterano', tagline: 'No le asustan los botes grandes.', avatar: av(['#7d1d4a', '#2a0718'], 3, 'shaved', 0, '#cfae6b', 'shades') },
  { name: 'LeaQueen', profile: 'balanced', difficulty: 'hard', bjStrategy: 'basic', betStyle: 'steady', experience: 'veterano', tagline: 'Paciencia y precisión.', avatar: av(['#3a6ea5', '#0f2238'], 4, 'bob', 0, '#f6e7c1', 'none', 'dots') },
  { name: 'IvanNuts', profile: 'analytical', difficulty: 'normal', bjStrategy: 'basic', betStyle: 'minimum', experience: 'regular', tagline: 'Solo apuesta fuerte con lo mejor.', avatar: av(['#565a2b', '#1c1e0b'], 0, 'short', 3, '#2b3a55', 'glasses', 'stripes') },
  { name: 'ZoeClubs', profile: 'conservative', difficulty: 'easy', bjStrategy: 'cautious', betStyle: 'minimum', experience: 'novato', tagline: 'Recién llegada a la mesa.', avatar: av(['#2c7a6b', '#0a2a24'], 5, 'curly', 0, '#f4c6a0', 'cap', 'dots') },
  { name: 'AnaLucky7', profile: 'aggressive', difficulty: 'easy', bjStrategy: 'bold', betStyle: 'varied', experience: 'novato', tagline: 'Confía en el siete.', avatar: av(['#b88a1a', '#3d2c05'], 2, 'wavy', 7, '#26222e', 'earring', 'rays') },
  { name: 'HectorFold', profile: 'conservative', difficulty: 'hard', bjStrategy: 'cautious', betStyle: 'steady', experience: 'veterano', tagline: 'Sabe cuándo retirarse.', avatar: av(['#3b3f58', '#12131d'], 4, 'shaved', 5, '#d8d2c2', 'none') },
];

/** Nombres reservados (comparación sin mayúsculas). */
export const RESERVED_BOT_NAMES: ReadonlySet<string> = new Set(BOT_CATALOG.map((b) => b.name.toLowerCase()));
