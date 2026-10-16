import type { BjBetStyle, BjStrategy, BotDifficulty, BotProfile } from '@aurum/engine';
import type { Database } from '../db/database';
import type { AvatarSpec, Experience } from './catalog';

/** Identidad pública de un bot (todo lo que puede mostrarse en la interfaz). */
export interface BotIdentity {
  id: string;
  name: string;
  profile: BotProfile;
  difficulty: BotDifficulty;
  bjStrategy: BjStrategy;
  betStyle: BjBetStyle;
  experience: Experience;
  tagline: string;
  avatar: AvatarSpec | null;
}

interface BotRow {
  id: string;
  name: string;
  profile: BotProfile;
  difficulty: BotDifficulty;
  bj_strategy: BjStrategy;
  bet_style: BjBetStyle;
  experience: Experience;
  tagline: string;
  avatar_json: string;
}

export function parseAvatar(json: string | null | undefined): AvatarSpec | null {
  if (!json) return null;
  try {
    const v = JSON.parse(json) as Partial<AvatarSpec>;
    return v && Array.isArray(v.bg) && v.hair ? (v as AvatarSpec) : null;
  } catch {
    return null;
  }
}

const toIdentity = (r: BotRow): BotIdentity => ({
  id: r.id,
  name: r.name,
  profile: r.profile,
  difficulty: r.difficulty,
  bjStrategy: r.bj_strategy,
  betStyle: r.bet_style,
  experience: r.experience,
  tagline: r.tagline,
  avatar: parseAvatar(r.avatar_json),
});

/** Saldo con el que se repone la banca de demostración de un bot que se queda sin fichas. */
const BOT_BANKROLL_REFILL = 100_000;

/**
 * Banca y asignación de bots compartida por todas las mesas (póker y blackjack).
 *
 * - Un bot solo puede estar sentado en una mesa a la vez.
 * - Rotación: entra primero el que menos ha jugado.
 * - Sus fichas son internas de demostración y nunca se mezclan con el
 *   monedero de ningún usuario.
 */
export class BotPool {
  private seated = new Map<string, string>(); // botId → clave de mesa ("poker:x", "bj:y")
  constructor(private readonly db: Database) {}

  acquire(tableKey: string): BotIdentity | null {
    const rows = this.db.all<BotRow & { played: number }>(
      `SELECT id, name, profile, difficulty, bj_strategy, bet_style, experience, tagline, avatar_json,
              hands_played + bj_rounds AS played
         FROM bots WHERE enabled = 1 ORDER BY played ASC, name ASC`,
    );
    const free = rows.find((b) => !this.seated.has(b.id));
    if (!free) return null;
    this.seated.set(free.id, tableKey);
    return toIdentity(free);
  }

  takeBuyIn(botId: string, amount: number): number {
    const row = this.db.get<{ bankroll: number }>('SELECT bankroll FROM bots WHERE id = ?', botId);
    // Si la banca de demostración se agota, se repone (documentado: los bots no son jugadores reales).
    if (!row || row.bankroll < amount) this.db.run('UPDATE bots SET bankroll = ? WHERE id = ?', BOT_BANKROLL_REFILL, botId);
    this.db.run('UPDATE bots SET bankroll = bankroll - ? WHERE id = ?', amount, botId);
    return amount;
  }

  release(botId: string, stackReturned: number): void {
    this.seated.delete(botId);
    this.db.run('UPDATE bots SET bankroll = bankroll + ? WHERE id = ?', stackReturned, botId);
  }

  /** Mano de póker terminada: estadísticas reales. */
  recordHand(botId: string, net: number): void {
    this.db.run(
      'UPDATE bots SET hands_played = hands_played + 1, net_result = net_result + ?, poker_wins = poker_wins + ? WHERE id = ?',
      net, net > 0 ? 1 : 0, botId,
    );
  }

  /** Ronda de blackjack terminada: estadísticas reales. */
  recordBlackjack(botId: string, net: number): void {
    this.db.run(
      'UPDATE bots SET bj_rounds = bj_rounds + 1, bj_net = bj_net + ?, bj_wins = bj_wins + ? WHERE id = ?',
      net, net > 0 ? 1 : 0, botId,
    );
  }

  seatedAt(botId: string): string | null {
    return this.seated.get(botId) ?? null;
  }
}
