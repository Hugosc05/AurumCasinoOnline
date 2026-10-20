import { randomUUID } from 'node:crypto';
import { Router } from 'express';
import { z } from 'zod';
import { RouletteError, validateRouletteBets, type RouletteBet } from '@aurum/engine';
import type { AppContext } from '../context';
import { nowIso } from '../db/database';
import { AppError, conflict, notFound } from '../lib/errors';
import { parse, requireAuth } from '../lib/http';
import { getBalance } from '../wallet/wallet';

/** Límite de formaciones guardadas por usuario. */
export const MAX_FORMATIONS = 30;

const amount = z.number().int().positive().max(10_000_000);
const insideBet = z.object({ kind: z.enum(['straight', 'split', 'street', 'corner', 'sixline']), numbers: z.array(z.number().int().min(0).max(36)).min(1).max(6), amount }).strict();
const dozenBet = z.object({ kind: z.enum(['dozen', 'column']), index: z.union([z.literal(1), z.literal(2), z.literal(3)]), amount }).strict();
const evenBet = z.object({ kind: z.enum(['red', 'black', 'even', 'odd', 'low', 'high']), amount }).strict();
const betsSchema = z.array(z.union([insideBet, dozenBet, evenBet])).min(1).max(40);
const nameSchema = z.string().trim().min(1, 'Ponle un nombre').max(40, 'Máximo 40 caracteres');

/** Misma apuesta = mismo tipo y mismos números (en cualquier orden). */
function betKey(b: RouletteBet): string {
  if ('numbers' in b) return `${b.kind}:${[...b.numbers].sort((x, y) => x - y).join('-')}`;
  if ('index' in b) return `${b.kind}:${b.index}`;
  return b.kind;
}

/** Valida con las reglas del motor (las mismas que al girar) y une las apuestas repetidas. */
function normalize(bets: RouletteBet[]): { bets: RouletteBet[]; total: number } {
  const merged = new Map<string, RouletteBet>();
  for (const b of bets) {
    const k = betKey(b);
    const prev = merged.get(k);
    merged.set(k, prev ? { ...prev, amount: prev.amount + b.amount } : { ...b, ...('numbers' in b ? { numbers: [...b.numbers].sort((x, y) => x - y) } : {}) });
  }
  const list = [...merged.values()];
  try {
    return { bets: list, total: validateRouletteBets(list) };
  } catch (err) {
    if (err instanceof RouletteError) throw new AppError(400, err.code, err.message);
    throw err;
  }
}

interface Row {
  id: string;
  user_id: string;
  name: string;
  bets_json: string;
  total: number;
  created_at: string;
  updated_at: string;
}

const view = (r: Row) => ({ id: r.id, name: r.name, bets: JSON.parse(r.bets_json) as RouletteBet[], total: r.total, createdAt: r.created_at, updatedAt: r.updated_at });

/**
 * Formaciones de ruleta. Cada usuario solo ve y modifica las suyas (el
 * propietario sale siempre de la sesión, nunca de la petición). Guardar o
 * cargar una formación no realiza ninguna apuesta.
 */
export function formationRoutes(ctx: AppContext): Router {
  const r = Router();
  const { db } = ctx;
  r.use(requireAuth);

  const own = (userId: string, id: string): Row => {
    const row = db.get<Row>('SELECT * FROM roulette_formations WHERE id = ? AND user_id = ?', id, userId);
    if (!row) throw notFound('Formación no encontrada');
    return row;
  };
  const uniqueName = (userId: string, name: string, exceptId: string | null): void => {
    const clash = db.get<{ id: string }>('SELECT id FROM roulette_formations WHERE user_id = ? AND name_key = ?', userId, name.toLowerCase());
    if (clash && clash.id !== exceptId) throw conflict('NAME_TAKEN', 'Ya tienes una formación con ese nombre');
  };
  const insert = (userId: string, name: string, bets: RouletteBet[], total: number): Row => {
    const count = db.get<{ n: number }>('SELECT COUNT(*) AS n FROM roulette_formations WHERE user_id = ?', userId)!.n;
    if (count >= MAX_FORMATIONS) throw new AppError(400, 'TOO_MANY_FORMATIONS', `Puedes guardar hasta ${MAX_FORMATIONS} formaciones`);
    uniqueName(userId, name, null);
    const id = randomUUID();
    const now = nowIso();
    db.run(
      'INSERT INTO roulette_formations (id, user_id, name, name_key, bets_json, total, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
      id, userId, name, name.toLowerCase(), JSON.stringify(bets), total, now, now,
    );
    return own(userId, id);
  };

  r.get('/', (req, res) => {
    const rows = db.all<Row>('SELECT * FROM roulette_formations WHERE user_id = ? ORDER BY updated_at DESC', req.user!.id);
    res.json({ items: rows.map(view), max: MAX_FORMATIONS });
  });

  r.post('/', (req, res) => {
    const body = parse(z.object({ name: nameSchema, bets: betsSchema }).strict(), req.body);
    const { bets, total } = normalize(body.bets as RouletteBet[]);
    res.status(201).json(view(db.tx(() => insert(req.user!.id, body.name, bets, total))));
  });

  r.patch('/:id', (req, res) => {
    const body = parse(z.object({ name: nameSchema.optional(), bets: betsSchema.optional() }).strict(), req.body);
    const userId = req.user!.id;
    const out = db.tx(() => {
      const row = own(userId, z.string().uuid().parse(req.params.id));
      const name = body.name ?? row.name;
      if (body.name) uniqueName(userId, name, row.id);
      const next = body.bets ? normalize(body.bets as RouletteBet[]) : { bets: JSON.parse(row.bets_json) as RouletteBet[], total: row.total };
      db.run('UPDATE roulette_formations SET name = ?, name_key = ?, bets_json = ?, total = ?, updated_at = ? WHERE id = ? AND user_id = ?',
        name, name.toLowerCase(), JSON.stringify(next.bets), next.total, nowIso(), row.id, userId);
      return own(userId, row.id);
    });
    res.json(view(out));
  });

  r.post('/:id/duplicate', (req, res) => {
    const userId = req.user!.id;
    const out = db.tx(() => {
      const row = own(userId, z.string().uuid().parse(req.params.id));
      let name = `${row.name} (copia)`.slice(0, 40);
      for (let i = 2; db.get('SELECT 1 AS x FROM roulette_formations WHERE user_id = ? AND name_key = ?', userId, name.toLowerCase()); i += 1) {
        name = `${row.name.slice(0, 30)} (copia ${i})`;
      }
      return insert(userId, name, JSON.parse(row.bets_json) as RouletteBet[], row.total);
    });
    res.status(201).json(view(out));
  });

  r.delete('/:id', (req, res) => {
    const row = own(req.user!.id, z.string().uuid().parse(req.params.id));
    db.run('DELETE FROM roulette_formations WHERE id = ? AND user_id = ?', row.id, req.user!.id);
    res.json({ ok: true });
  });

  /**
   * Comprobación al cargar: legalidad con las reglas actuales y saldo
   * disponible. No apuesta nada; el usuario confirma después en el tapete.
   */
  r.get('/:id/check', (req, res) => {
    const row = own(req.user!.id, z.string().uuid().parse(req.params.id));
    const bets = JSON.parse(row.bets_json) as RouletteBet[];
    let legal = true;
    let reason: string | null = null;
    try {
      validateRouletteBets(bets);
    } catch (err) {
      legal = false;
      reason = err instanceof RouletteError ? err.message : 'Formación no válida';
    }
    const bal = getBalance(db, req.user!.id);
    const affordable = bal.unlimited || (bal.balance ?? 0) >= row.total;
    res.json({ legal, reason, total: row.total, affordable, balance: bal.balance, unlimited: bal.unlimited });
  });

  return r;
}
