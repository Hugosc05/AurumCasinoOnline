import { type Rng, shuffle } from './rng';

export type Suit = 's' | 'h' | 'd' | 'c';
/** 2..10, 11 = J, 12 = Q, 13 = K, 14 = A */
export type Rank = 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10 | 11 | 12 | 13 | 14;

/** Carta codificada como texto compacto, p. ej. "As", "Td", "9h". */
export type Card = string;

export const SUITS: readonly Suit[] = ['s', 'h', 'd', 'c'];
export const RANKS: readonly Rank[] = [2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14];

const RANK_CHARS: Record<Rank, string> = {
  2: '2', 3: '3', 4: '4', 5: '5', 6: '6', 7: '7', 8: '8', 9: '9',
  10: 'T', 11: 'J', 12: 'Q', 13: 'K', 14: 'A',
};
const CHAR_RANKS: Record<string, Rank> = Object.fromEntries(
  Object.entries(RANK_CHARS).map(([r, c]) => [c, Number(r) as Rank]),
) as Record<string, Rank>;

export function makeCard(rank: Rank, suit: Suit): Card {
  return `${RANK_CHARS[rank]}${suit}`;
}

export function rankOf(card: Card): Rank {
  const r = CHAR_RANKS[card[0] ?? ''];
  if (r === undefined) throw new Error(`Carta inválida: ${card}`);
  return r;
}

export function suitOf(card: Card): Suit {
  const s = card[1];
  if (s !== 's' && s !== 'h' && s !== 'd' && s !== 'c') throw new Error(`Carta inválida: ${card}`);
  return s;
}

export function isValidCard(card: unknown): card is Card {
  return typeof card === 'string' && card.length === 2 && card[0]! in CHAR_RANKS && 'shdc'.includes(card[1]!);
}

/** Baraja estándar de 52 cartas, ordenada. */
export function createDeck(): Card[] {
  const deck: Card[] = [];
  for (const s of SUITS) for (const r of RANKS) deck.push(makeCard(r, s));
  return deck;
}

/** Zapato de `decks` barajas, barajado con el RNG indicado. */
export function createShoe(decks: number, rng: Rng): Card[] {
  const cards: Card[] = [];
  for (let i = 0; i < decks; i += 1) cards.push(...createDeck());
  return shuffle(cards, rng);
}

/** Parsea "As Kd 7h" → ["As","Kd","7h"] (útil en pruebas). */
export function parseCards(text: string): Card[] {
  const out = text.trim().split(/\s+/).filter(Boolean);
  for (const c of out) if (!isValidCard(c)) throw new Error(`Carta inválida: ${c}`);
  return out;
}
