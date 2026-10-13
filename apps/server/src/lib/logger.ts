import type { Database } from '../db/database';
import { nowIso } from '../db/database';

type Level = 'debug' | 'info' | 'warn' | 'error';
const ORDER: Record<Level, number> = { debug: 10, info: 20, warn: 30, error: 40 };

/**
 * Registro sencillo: consola + tabla `error_logs` para avisos y errores
 * (visibles en el panel de administración). Nunca registra contraseñas ni tokens.
 */
export class Logger {
  private db: Database | null = null;
  constructor(private level: Level = 'info') {}

  attach(db: Database, level: Level): void {
    this.db = db;
    this.level = level;
  }

  private write(level: Level, message: string, context?: Record<string, unknown>, err?: unknown): void {
    if (ORDER[level] < ORDER[this.level]) return;
    const line = `[${new Date().toISOString()}] ${level.toUpperCase()} ${message}`;
    const out = level === 'error' || level === 'warn' ? console.error : console.log;
    if (process.env.NODE_ENV !== 'test' || level === 'error') out(line, context ? JSON.stringify(context) : '');
    if ((level === 'warn' || level === 'error') && this.db) {
      try {
        this.db.run(
          'INSERT INTO error_logs (level, message, stack, context_json, created_at) VALUES (?, ?, ?, ?, ?)',
          level,
          message.slice(0, 1000),
          err instanceof Error ? (err.stack ?? null)?.slice(0, 4000) ?? null : null,
          context ? JSON.stringify(context).slice(0, 4000) : null,
          nowIso(),
        );
      } catch {
        /* no romper por fallos de registro */
      }
    }
  }

  debug(message: string, context?: Record<string, unknown>): void {
    this.write('debug', message, context);
  }
  info(message: string, context?: Record<string, unknown>): void {
    this.write('info', message, context);
  }
  warn(message: string, context?: Record<string, unknown>, err?: unknown): void {
    this.write('warn', message, context, err);
  }
  error(message: string, err?: unknown, context?: Record<string, unknown>): void {
    this.write('error', message, { ...context, error: err instanceof Error ? err.message : String(err) }, err);
  }
}

export const logger = new Logger();
