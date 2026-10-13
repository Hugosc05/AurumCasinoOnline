import type { NextFunction, Request, RequestHandler, Response } from 'express';
import type { z } from 'zod';
import type { UserRow } from '../auth/sessions';
import { AppError, badRequest, forbidden, unauthorized } from './errors';
import { logger } from './logger';

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      user?: UserRow | null;
      sessionToken?: string;
    }
  }
}

/** Valida datos de entrada con Zod; lanza 400 con detalles legibles si no son válidos. */
export function parse<T extends z.ZodType>(schema: T, data: unknown): z.infer<T> {
  const r = schema.safeParse(data);
  if (!r.success) {
    const fields: Record<string, string> = {};
    for (const issue of r.error.issues) {
      const key = issue.path.join('.') || '_';
      fields[key] ??= issue.message;
    }
    throw badRequest('VALIDATION_ERROR', 'Datos no válidos', { fields });
  }
  return r.data;
}

export const requireAuth: RequestHandler = (req, _res, next) => {
  if (!req.user) return next(unauthorized());
  next();
};

/** El rol se comprueba siempre contra la fila de BD cargada desde la sesión, nunca contra datos del cliente. */
export const requireAdmin: RequestHandler = (req, _res, next) => {
  if (!req.user) return next(unauthorized());
  if (req.user.role !== 'admin') return next(forbidden('Acceso restringido a administradores'));
  next();
};

/**
 * Protección CSRF para una API con cookie SameSite=Strict:
 *  - las peticiones que modifican estado deben llevar la cabecera `X-Requested-With: aurum`
 *    (un formulario de otro sitio no puede añadirla y fetch entre orígenes requiere preflight CORS);
 *  - si llega cabecera Origin, debe estar en la lista permitida.
 */
export function csrfGuard(allowedOrigins: string[]): RequestHandler {
  return (req, _res, next) => {
    if (req.method === 'GET' || req.method === 'HEAD' || req.method === 'OPTIONS') return next();
    if (req.get('x-requested-with') !== 'aurum') return next(forbidden('Petición rechazada (CSRF)'));
    const origin = req.get('origin');
    if (origin && !allowedOrigins.includes(origin) && origin !== `${req.protocol}://${req.get('host')}`) {
      return next(forbidden('Origen no permitido'));
    }
    next();
  };
}

/** CORS restringido a los orígenes configurados (solo necesario si el frontend se sirve desde otro origen). */
export function cors(allowedOrigins: string[]): RequestHandler {
  return (req, res, next) => {
    const origin = req.get('origin');
    if (origin && allowedOrigins.includes(origin)) {
      res.setHeader('Access-Control-Allow-Origin', origin);
      res.setHeader('Access-Control-Allow-Credentials', 'true');
      res.setHeader('Vary', 'Origin');
      res.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-Requested-With');
      res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PATCH, PUT, DELETE, OPTIONS');
    }
    if (req.method === 'OPTIONS') return res.status(204).end();
    next();
  };
}

export function errorHandler(err: unknown, req: Request, res: Response, _next: NextFunction): void {
  if (err instanceof AppError) {
    res.status(err.status).json({ error: { code: err.code, message: err.message, details: err.details ?? null } });
    return;
  }
  // JSON mal formado
  if (err && typeof err === 'object' && 'type' in err && (err as { type: string }).type === 'entity.parse.failed') {
    res.status(400).json({ error: { code: 'INVALID_JSON', message: 'Cuerpo JSON no válido', details: null } });
    return;
  }
  if (err && typeof err === 'object' && 'type' in err && (err as { type: string }).type === 'entity.too.large') {
    res.status(413).json({ error: { code: 'PAYLOAD_TOO_LARGE', message: 'Petición demasiado grande', details: null } });
    return;
  }
  logger.error(`Error no controlado en ${req.method} ${req.path}`, err, { userId: req.user?.id ?? null });
  // No se revelan detalles internos al cliente.
  res.status(500).json({ error: { code: 'INTERNAL_ERROR', message: 'Error interno del servidor', details: null } });
}

export const clientIp = (req: Request): string => req.ip ?? req.socket.remoteAddress ?? 'unknown';
