import { Router } from 'express';
import { z } from 'zod';
import {
  BlackjackError,
  DEFAULT_BLACKJACK_RULES,
  DEFAULT_ROULETTE_LIMITS,
  DEFAULT_SLOT_LIMITS,
  RouletteError,
  SlotError,
  applyBlackjackAction,
  blackjackLegalActions,
  extraStakeFor,
  isNatural,
  publicBlackjackEvents,
  publicBlackjackState,
  settleRoulette,
  spinRoulette,
  startBlackjack,
  validateRouletteBets,
  type BjAction,
  type BjState,
  type RouletteBet,
  type ShoeState,
} from '@aurum/engine';
import type { AppContext } from '../context';
import { nowIso } from '../db/database';
import { AppError, conflict, notFound } from '../lib/errors';
import { parse, requireAuth } from '../lib/http';
import { RateLimiter, rateLimit } from '../lib/rateLimit';
import { cryptoRng } from '../lib/rng';
import { getBalance } from '../wallet/wallet';
import { slotBonusPick, slotFeatureAct, slotFeatureState, slotSpin } from '../games/slots';
import {
  type RoundRow,
  addToRoundBet,
  assertGameEnabled,
  findRoundByKey,
  openRound,
  settleRound,
} from '../games/rounds';

const idempotencyKey = z.string().trim().min(8).max(64).regex(/^[A-Za-z0-9_-]+$/, 'Clave no válida');
const intAmount = z.number().int().positive().max(10_000_000);

const insideBet = z.object({
  kind: z.enum(['straight', 'split', 'street', 'corner', 'sixline']),
  numbers: z.array(z.number().int().min(0).max(36)).min(1).max(6),
  amount: intAmount,
}).strict();
const dozenBet = z.object({ kind: z.enum(['dozen', 'column']), index: z.union([z.literal(1), z.literal(2), z.literal(3)]), amount: intAmount }).strict();
const evenBet = z.object({ kind: z.enum(['red', 'black', 'even', 'odd', 'low', 'high']), amount: intAmount }).strict();
const rouletteSchema = z.object({
  bets: z.array(z.union([insideBet, dozenBet, evenBet])).min(1).max(DEFAULT_ROULETTE_LIMITS.maxBets),
  idempotencyKey,
});
const machineId = z.string().min(1).max(40).default('aurum-royale');
const slotsSchema = z.object({ machine: machineId, betPerLine: intAmount, lines: z.number().int(), idempotencyKey });
const bonusPickSchema = z.object({ machine: machineId, index: z.number().int().min(0).max(30) });
const featureSchema = z.object({ machine: machineId, action: z.enum(['spin', 'pick', 'respin']), index: z.number().int().min(0).max(30).optional() }).strict();
const bjStartSchema = z.object({ bet: intAmount, idempotencyKey });
const bjActionSchema = z.object({
  roundId: z.string().uuid(),
  action: z.enum(['hit', 'stand', 'double', 'split']),
  seq: z.number().int().min(0),
});

/** Convierte errores de los motores en errores HTTP 400 legibles. */
function engineGuard<T>(fn: () => T): T {
  try {
    return fn();
  } catch (err) {
    if (err instanceof BlackjackError || err instanceof RouletteError || err instanceof SlotError) {
      throw new AppError(400, err.code, err.message);
    }
    throw err;
  }
}

export function gameRoutes(ctx: AppContext): Router {
  const r = Router();
  const { db } = ctx;
  // Freno a scripts: máx. 120 jugadas por minuto y usuario.
  const playLimiter = new RateLimiter(120, 60_000);
  r.use(requireAuth);
  r.use(rateLimit(playLimiter, (req) => `play:${req.user!.id}`, 'Demasiadas jugadas seguidas. Respira un momento.'));

  /* ----------------------------- Configuración ----------------------------- */
  r.get('/config', (_req, res) => {
    res.json({
      blackjack: DEFAULT_BLACKJACK_RULES,
      roulette: DEFAULT_ROULETTE_LIMITS,
      slots: DEFAULT_SLOT_LIMITS,
    });
  });

  /* -------------------------------- Ruleta -------------------------------- */
  r.post('/roulette/spin', (req, res) => {
    assertGameEnabled(db, 'roulette');
    const body = parse(rouletteSchema, req.body);
    const user = req.user!;
    const replay = findRoundByKey(db, user.id, body.idempotencyKey);
    if (replay) {
      res.json({ roundId: replay.id, result: JSON.parse(replay.result_json ?? 'null'), balance: getBalance(db, user.id), achievements: [], replayed: true });
      return;
    }
    const bets = body.bets as RouletteBet[];
    const total = engineGuard(() => validateRouletteBets(bets));
    const out = db.tx(() => {
      const round = openRound(db, user.id, 'roulette', total, body.idempotencyKey);
      // El resultado se decide aquí, en el servidor, con un CSPRNG. La animación del cliente solo lo representa.
      const winning = spinRoulette(cryptoRng);
      const result = settleRoulette(bets, winning);
      const straightHit = result.bets.some((b) => b.won && b.bet.kind === 'straight');
      const settled = settleRound(db, round.id, result.totalPayout, result, { rouletteStraightHit: straightHit });
      return { roundId: round.id, result, ...settled };
    });
    res.json(out);
  });

  /* --------------------------------- Slots -------------------------------- */
  r.get('/slots/state', (req, res) => {
    const machine = machineId.parse(req.query.machine ?? undefined);
    res.json(engineGuard(() => slotFeatureState(db, req.user!.id, machine)));
  });

  r.post('/slots/spin', (req, res) => {
    assertGameEnabled(db, 'slots');
    const body = parse(slotsSchema, req.body);
    const user = req.user!;
    const replay = findRoundByKey(db, user.id, body.idempotencyKey);
    if (replay) {
      res.json({ roundId: replay.id, result: JSON.parse(replay.result_json ?? 'null'), balance: getBalance(db, user.id), achievements: [], replayed: true, feature: slotFeatureState(db, user.id, body.machine) });
      return;
    }
    res.json(engineGuard(() => slotSpin(db, user.id, body.machine, body.betPerLine, body.lines, body.idempotencyKey)));
  });

  r.post('/slots/bonus/pick', (req, res) => {
    assertGameEnabled(db, 'slots');
    const body = parse(bonusPickSchema, req.body);
    res.json(engineGuard(() => slotBonusPick(db, req.user!.id, body.machine, body.index)));
  });

  r.post('/slots/feature', (req, res) => {
    assertGameEnabled(db, 'slots');
    const body = parse(featureSchema, req.body);
    res.json(engineGuard(() => slotFeatureAct(db, req.user!.id, body.machine, body.action, body.index)));
  });

  /* ------------------------------- Blackjack ------------------------------- */
  const loadShoe = (userId: string): ShoeState | null => {
    const row = db.get<{ cards_json: string; size: number }>('SELECT cards_json, size FROM blackjack_shoes WHERE user_id = ?', userId);
    return row ? { cards: JSON.parse(row.cards_json) as string[], size: row.size } : null;
  };
  const saveShoe = (userId: string, state: BjState): void => {
    db.run(
      `INSERT INTO blackjack_shoes (user_id, cards_json, size, updated_at) VALUES (?, ?, ?, ?)
       ON CONFLICT(user_id) DO UPDATE SET cards_json = excluded.cards_json, size = excluded.size, updated_at = excluded.updated_at`,
      userId, JSON.stringify(state.shoe), state.shoeSize, nowIso(),
    );
  };
  const bjView = (round: RoundRow, state: BjState, extra: object = {}) => ({
    roundId: round.id,
    seq: round.action_seq,
    state: publicBlackjackState(state),
    events: publicBlackjackEvents(state.events),
    ...extra,
  });
  /** Liquida si la mano ha terminado; el estado guardado ya no contiene el zapato. */
  const finishIfSettled = (round: RoundRow, state: BjState) => {
    if (state.phase !== 'settled') return { balance: getBalance(db, round.user_id), achievements: [], streak: null };
    saveShoe(round.user_id, state);
    const natural = state.hands.length === 1 && state.hands[0]!.outcome === 'blackjack' && isNatural(state.hands[0]!.cards);
    return settleRound(db, round.id, state.totalPayout, publicBlackjackState(state), { natural }, null);
  };

  r.get('/blackjack/current', (req, res) => {
    const round = db.get<RoundRow>(
      `SELECT * FROM game_rounds WHERE user_id = ? AND game = 'blackjack' AND status = 'open' AND state_json IS NOT NULL ORDER BY created_at DESC LIMIT 1`,
      req.user!.id,
    );
    if (!round || !round.state_json) {
      res.json({ round: null, shoe: loadShoeInfo(req.user!.id) });
      return;
    }
    const state = JSON.parse(round.state_json) as BjState;
    state.events = [];
    res.json({ round: bjView(round, state), shoe: { remaining: state.shoe.length, size: state.shoeSize } });
  });

  const loadShoeInfo = (userId: string) => {
    const s = loadShoe(userId);
    return s ? { remaining: s.cards.length, size: s.size } : null;
  };

  r.post('/blackjack/start', (req, res) => {
    assertGameEnabled(db, 'blackjack');
    const body = parse(bjStartSchema, req.body);
    const user = req.user!;
    const replay = findRoundByKey(db, user.id, body.idempotencyKey);
    if (replay) throw conflict('DUPLICATE_REQUEST', 'Esta mano ya se ha iniciado');
    const out = db.tx(() => {
      const open = db.get<{ id: string }>(`SELECT id FROM game_rounds WHERE user_id = ? AND game = 'blackjack' AND status = 'open' AND idempotency_key NOT LIKE 'bjt:%'`, user.id);
      if (open) throw new AppError(409, 'ROUND_IN_PROGRESS', 'Ya tienes una mano en curso', { roundId: open.id });
      const state = engineGuard(() => startBlackjack(body.bet, loadShoe(user.id), cryptoRng));
      const round = openRound(db, user.id, 'blackjack', body.bet, body.idempotencyKey);
      db.run('UPDATE game_rounds SET state_json = ? WHERE id = ?', JSON.stringify(state), round.id);
      const settled = finishIfSettled(round, state);
      return bjView(round, state, settled);
    });
    res.json(out);
  });

  r.post('/blackjack/action', (req, res) => {
    const body = parse(bjActionSchema, req.body);
    const user = req.user!;
    const out = db.tx(() => {
      const round = db.get<RoundRow>('SELECT * FROM game_rounds WHERE id = ? AND user_id = ?', body.roundId, user.id);
      if (!round || round.game !== 'blackjack') throw notFound('Mano no encontrada');
      if (round.status !== 'open') throw conflict('ROUND_CLOSED', 'La mano ya ha terminado');
      // Prevención de acciones duplicadas: el cliente envía el número de secuencia que espera.
      if (body.seq !== round.action_seq) throw conflict('STALE_ACTION', 'Acción duplicada o desfasada');
      const state = JSON.parse(round.state_json!) as BjState;
      const action = body.action as BjAction;
      if (!blackjackLegalActions(state).includes(action)) throw new AppError(400, 'ILLEGAL_ACTION', 'Acción no permitida ahora');
      const extra = extraStakeFor(state, action);
      if (extra > 0) addToRoundBet(db, round, extra);
      engineGuard(() => applyBlackjackAction(state, action, cryptoRng));
      const upd = db.run(
        'UPDATE game_rounds SET state_json = ?, action_seq = action_seq + 1 WHERE id = ? AND action_seq = ?',
        JSON.stringify(state), round.id, body.seq,
      );
      if (upd.changes !== 1) throw conflict('STALE_ACTION', 'Acción duplicada o desfasada');
      const fresh = db.get<RoundRow>('SELECT * FROM game_rounds WHERE id = ?', round.id)!;
      const settled = finishIfSettled(fresh, state);
      return bjView(fresh, state, settled);
    });
    res.json(out);
  });

  return r;
}
