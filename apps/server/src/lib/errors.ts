/** Error de aplicación con código estable y estado HTTP. El mensaje es apto para mostrarse al usuario. */
export class AppError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
    public readonly details?: unknown,
  ) {
    super(message);
  }
}

export const badRequest = (code: string, message: string, details?: unknown): AppError => new AppError(400, code, message, details);
export const unauthorized = (message = 'Debes iniciar sesión'): AppError => new AppError(401, 'UNAUTHORIZED', message);
export const forbidden = (message = 'No tienes permiso para esta acción'): AppError => new AppError(403, 'FORBIDDEN', message);
export const notFound = (message = 'No encontrado'): AppError => new AppError(404, 'NOT_FOUND', message);
export const conflict = (code: string, message: string): AppError => new AppError(409, code, message);
export const tooMany = (message: string, retryAfterSec?: number): AppError =>
  new AppError(429, 'RATE_LIMITED', message, retryAfterSec ? { retryAfterSec } : undefined);
