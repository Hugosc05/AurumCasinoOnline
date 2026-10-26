import { Router } from 'express';
import { z } from 'zod';
import type { CosmeticKind } from '@aurum/engine';
import type { AppContext } from '../context';
import { notFound } from '../lib/errors';
import { parse, requireAuth } from '../lib/http';
import { RateLimiter, rateLimit } from '../lib/rateLimit';
import { buyCase, caseCatalog, claimMission, equip, inventory, missionsView, openCase } from '../rewards/rewards';

/** Fotos de perfil (públicas, con caché por versión). */
export function avatarRoutes(ctx: AppContext): Router {
  const r = Router();
  r.get('/:userId', (req, res) => {
    const id = z.string().uuid().safeParse(req.params.userId);
    const a = id.success ? ctx.looks.avatar(id.data) : null;
    if (!a) throw notFound('Sin foto');
    const etag = `"av-${id.data}-${a.version}"`;
    res.setHeader('ETag', etag);
    res.setHeader('Cache-Control', 'public, max-age=604800, immutable');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    if (req.headers['if-none-match'] === etag) {
      res.status(304).end();
      return;
    }
    res.type(a.mime).send(a.bytes);
  });
  return r;
}

/** Perfil propio, tarjetas de jugador y aspecto público. */
export function profileRoutes(ctx: AppContext): Router {
  const r = Router();
  const { db, looks } = ctx;
  const uploadLimiter = new RateLimiter(10, 60 * 60_000);
  const cardLimiter = new RateLimiter(120, 60_000);

  r.get('/players/:username', rateLimit(cardLimiter, (req) => `pc:${req.user?.id ?? req.ip}`, 'Demasiadas consultas'), (req, res) => {
    const name = z.string().min(1).max(40).parse(req.params.username);
    res.json(looks.card(req.user?.id ?? null, name));
  });

  /** Aspecto de varios jugadores a la vez (para pintar las mesas). */
  r.get('/looks', rateLimit(cardLimiter, (req) => `lk:${req.user?.id ?? req.ip}`, 'Demasiadas consultas'), (req, res) => {
    const names = parse(z.object({ names: z.string().max(800) }), req.query).names.split(',').map((s) => s.trim()).filter(Boolean).slice(0, 40);
    const out: Record<string, unknown> = {};
    for (const n of names) out[n] = looks.byUsername(n);
    res.json({ looks: out });
  });

  r.post('/profile/avatar', requireAuth, rateLimit(uploadLimiter, (req) => `av:${req.user!.id}`, 'Has cambiado la foto demasiadas veces. Inténtalo más tarde.'), (req, res) => {
    const body = parse(z.object({ image: z.string().max(140_000) }).strict(), req.body);
    const version = looks.setAvatar(req.user!.id, body.image);
    res.json({ avatarUrl: `/api/avatars/${req.user!.id}?v=${version}` });
  });
  r.delete('/profile/avatar', requireAuth, (req, res) => {
    looks.setAvatar(req.user!.id, null);
    res.json({ avatarUrl: null });
  });
  r.get('/profile/look', requireAuth, (req, res) => {
    res.json({ look: looks.byUsername(req.user!.username), equipped: inventory(db, req.user!.id).equipped });
  });

  /* ------------------------------ Recompensas ------------------------------ */
  const rewards = Router();
  rewards.use(requireAuth);
  const openLimiter = new RateLimiter(60, 60_000);
  rewards.get('/missions', (req, res) => res.json(missionsView(db, req.user!.id)));
  rewards.post('/missions/claim', (req, res) => {
    const body = parse(z.object({ missionId: z.string().min(1).max(40), period: z.string().min(3).max(20) }).strict(), req.body);
    res.json(claimMission(db, req.user!.id, body.missionId, body.period));
  });
  rewards.get('/cases', (_req, res) => res.json({ cases: caseCatalog() }));
  rewards.get('/inventory', (req, res) => res.json(inventory(db, req.user!.id)));
  rewards.post('/cases/buy', (req, res) => {
    const body = parse(z.object({ caseId: z.string().min(1).max(30), count: z.number().int().min(1).max(10).default(1) }).strict(), req.body);
    res.json(buyCase(db, req.user!.id, body.caseId, body.count));
  });
  rewards.post('/cases/open', rateLimit(openLimiter, (req) => `co:${req.user!.id}`, 'Demasiadas cajas seguidas'), (req, res) => {
    const body = parse(z.object({ id: z.string().uuid() }).strict(), req.body);
    res.json(openCase(db, req.user!.id, body.id));
  });
  rewards.post('/equip', (req, res) => {
    const body = parse(z.object({ kind: z.enum(['frame', 'nameColor', 'cardBack']), itemId: z.string().max(40).nullable() }).strict(), req.body);
    equip(db, req.user!.id, body.kind as CosmeticKind, body.itemId);
    looks.invalidate(req.user!.username);
    res.json(inventory(db, req.user!.id));
  });
  r.use('/rewards', rewards);
  return r;
}
