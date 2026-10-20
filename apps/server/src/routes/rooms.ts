import { Router } from 'express';
import { z } from 'zod';
import type { AppContext } from '../context';
import { clientIp, parse, requireAuth } from '../lib/http';
import { RateLimiter, rateLimit } from '../lib/rateLimit';

const name = z.string().trim().min(3, 'Mínimo 3 caracteres').max(40, 'Máximo 40 caracteres');
const pokerSettings = z.object({
  smallBlind: z.number().int().min(1).max(100_000),
  bigBlind: z.number().int().min(2).max(200_000),
  minBuyIn: z.number().int().min(20).max(10_000_000),
  maxBuyIn: z.number().int().min(20).max(10_000_000),
  startingChips: z.number().int().min(20).max(10_000_000),
}).partial().strict();
const bjSettings = z.object({
  minBet: z.number().int().min(1).max(100_000),
  maxBet: z.number().int().min(1).max(1_000_000),
}).partial().strict();

const createSchema = z.object({
  name,
  game: z.enum(['poker', 'blackjack']),
  maxSeats: z.number().int().min(2).max(7),
  privacy: z.enum(['code', 'friends']).default('code'),
  allowBots: z.boolean().default(false),
  chipMode: z.enum(['wallet', 'room']).default('wallet'),
  poker: pokerSettings.optional(),
  blackjack: bjSettings.optional(),
}).strict().refine((v) => v.game !== 'poker' || v.maxSeats <= 6, { message: 'El póker admite hasta 6 asientos', path: ['maxSeats'] });

/** Salas privadas. Todas las comprobaciones de pertenencia y de anfitrión se hacen en el servicio. */
export function roomRoutes(ctx: AppContext): Router {
  const r = Router();
  const { rooms } = ctx;
  r.use(requireAuth);
  // Contra la adivinación de códigos: pocos intentos por usuario y por conexión.
  const joinByUser = new RateLimiter(10, 10 * 60_000);
  const joinByIp = new RateLimiter(30, 10 * 60_000);
  const createLimiter = new RateLimiter(10, 60 * 60_000);
  const inviteLimiter = new RateLimiter(30, 10 * 60_000);
  const id = z.string().uuid();

  r.get('/', (req, res) => res.json({ items: rooms.mine(req.user!.id) }));

  r.post('/', rateLimit(createLimiter, (req) => `rc:${req.user!.id}`, 'Has creado demasiadas salas. Inténtalo más tarde.'), (req, res) => {
    const body = parse(createSchema, req.body);
    res.status(201).json(rooms.create(req.user!.id, body));
  });

  r.post(
    '/join',
    rateLimit(joinByIp, (req) => `rj-ip:${clientIp(req)}`, 'Demasiados intentos. Espera unos minutos.'),
    rateLimit(joinByUser, (req) => `rj:${req.user!.id}`, 'Demasiados intentos. Espera unos minutos.'),
    (req, res) => {
      const body = parse(z.object({ code: z.string().min(1).max(20) }).strict(), req.body);
      res.json(rooms.joinByCode(req.user!.id, body.code));
    },
  );

  r.get('/:id', (req, res) => res.json(rooms.view(id.parse(req.params.id), req.user!.id)));
  r.post('/:id/accept-invite', (req, res) => res.json(rooms.joinByInvite(req.user!.id, id.parse(req.params.id))));
  r.post('/:id/invite', rateLimit(inviteLimiter, (req) => `ri:${req.user!.id}`, 'Demasiadas invitaciones.'), (req, res) => {
    const body = parse(z.object({ username: z.string().trim().min(1).max(40) }).strict(), req.body);
    res.json(rooms.invite(req.user!.id, id.parse(req.params.id), body.username));
  });
  r.post('/:id/code', (req, res) => res.json(rooms.regenerateCode(req.user!.id, id.parse(req.params.id))));
  r.patch('/:id', (req, res) => {
    const body = parse(z.object({ name: name.optional(), allowBots: z.boolean().optional(), privacy: z.enum(['code', 'friends']).optional(), poker: pokerSettings.optional(), blackjack: bjSettings.optional() }).strict(), req.body);
    res.json(rooms.update(req.user!.id, id.parse(req.params.id), body));
  });
  r.post('/:id/leave', (req, res) => {
    rooms.leave(req.user!.id, id.parse(req.params.id));
    res.json({ ok: true });
  });
  r.post('/:id/close', (req, res) => {
    rooms.close(req.user!.id, id.parse(req.params.id));
    res.json({ ok: true });
  });
  return r;
}
