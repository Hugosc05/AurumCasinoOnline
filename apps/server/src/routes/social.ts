import { Router } from 'express';
import { z } from 'zod';
import type { AppContext } from '../context';
import { parse, requireAuth } from '../lib/http';
import { RateLimiter, rateLimit } from '../lib/rateLimit';

/** Amigos y notificaciones del usuario de la sesión. */
export function socialRoutes(ctx: AppContext): Router {
  const r = Router();
  const { social } = ctx;
  r.use(requireAuth);
  const searchLimiter = new RateLimiter(60, 60_000);
  const requestLimiter = new RateLimiter(20, 10 * 60_000);
  const id = z.string().uuid();

  r.get('/friends', (req, res) => res.json(social.overview(req.user!.id)));

  r.get(
    '/friends/search',
    rateLimit(searchLimiter, (req) => `fs:${req.user!.id}`, 'Demasiadas búsquedas. Espera un momento.'),
    (req, res) => {
      const q = parse(z.object({ q: z.string().max(40).default('') }), req.query).q;
      res.json({ items: social.search(req.user!.id, q) });
    },
  );

  r.post(
    '/friends/requests',
    rateLimit(requestLimiter, (req) => `fr:${req.user!.id}`, 'Demasiadas solicitudes. Inténtalo más tarde.'),
    (req, res) => {
      const body = parse(z.object({ username: z.string().trim().min(1).max(40) }).strict(), req.body);
      res.status(201).json(social.sendRequest(req.user!.id, body.username));
    },
  );
  r.post('/friends/requests/:id/accept', (req, res) => res.json(social.accept(req.user!.id, id.parse(req.params.id))));
  r.post('/friends/requests/:id/reject', (req, res) => {
    social.reject(req.user!.id, id.parse(req.params.id));
    res.json({ ok: true });
  });
  r.delete('/friends/requests/:id', (req, res) => {
    social.cancel(req.user!.id, id.parse(req.params.id));
    res.json({ ok: true });
  });
  r.delete('/friends/:userId', (req, res) => {
    social.removeFriend(req.user!.id, id.parse(req.params.userId));
    res.json({ ok: true });
  });

  r.get('/notifications', (req, res) => res.json(social.notifications(req.user!.id)));
  r.post('/notifications/read', (req, res) => {
    const body = parse(z.object({ ids: z.array(z.number().int().positive()).max(100).optional() }).strict(), req.body);
    social.markRead(req.user!.id, body.ids ?? null);
    res.json({ ok: true });
  });

  return r;
}
