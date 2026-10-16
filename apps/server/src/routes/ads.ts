import { Router } from 'express';
import { z } from 'zod';
import type { AppContext } from '../context';
import { RateLimiter, rateLimit } from '../lib/rateLimit';
import { requireAuth } from '../lib/http';

const idSchema = z.string().min(10).max(100).regex(/^[A-Za-z0-9_-]+$/);

/** Anuncios recompensados para el usuario con sesión. */
export function adsRoutes(ctx: AppContext): Router {
  const r = Router();
  const startLimiter = new RateLimiter(20, 10 * 60_000);

  r.get('/status', (req, res) => {
    res.json(ctx.ads.status(req.user?.id ?? null, req.user?.role ?? null));
  });

  r.post(
    '/sessions',
    requireAuth,
    rateLimit(startLimiter, (req) => `ads:${req.user!.id}`, 'Demasiados intentos. Espera unos minutos.'),
    (req, res) => {
      res.status(201).json(ctx.ads.startSession(req.user!.id, req.user!.role));
    },
  );

  r.get('/sessions/:id', requireAuth, (req, res) => {
    res.json(ctx.ads.sessionStatus(req.user!.id, idSchema.parse(req.params.id)));
  });

  /** Solo la simulación de desarrollo acepta la confirmación del navegador. */
  r.post('/sessions/:id/complete', requireAuth, (req, res) => {
    res.json(ctx.ads.completeFromClient(req.user!.id, idSchema.parse(req.params.id)));
  });

  return r;
}

/**
 * Llamada servidor a servidor del proveedor (firmada). Se monta fuera de la
 * protección CSRF porque no usa la cookie de sesión: la autenticidad la da
 * la firma HMAC.
 */
export function adsCallbackRoute(ctx: AppContext): Router {
  const r = Router();
  const limiter = new RateLimiter(120, 60_000);
  r.post('/', rateLimit(limiter, (req) => `adcb:${req.ip}`, 'Demasiadas llamadas'), (req, res) => {
    res.json(ctx.ads.handleCallback(req.body));
  });
  return r;
}
