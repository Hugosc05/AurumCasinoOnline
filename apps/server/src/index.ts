import { buildApp } from './app';
import { loadConfig } from './config';
import { logger } from './lib/logger';

const config = loadConfig();
const running = buildApp(config);

running.server.listen(config.PORT, config.HOST, () => {
  const admins = running.ctx.db.get<{ n: number }>(`SELECT COUNT(*) AS n FROM users WHERE role = 'admin'`)!.n;
  logger.info(`Aurum Casino escuchando en http://${config.HOST}:${config.PORT} (${config.NODE_ENV})`);
  logger.info(`Base de datos: ${running.ctx.db.dialect === 'postgres' ? 'PostgreSQL (DATABASE_URL)' : config.dbFile}`);
  if (config.keepAliveUrl) startKeepAlive(config.keepAliveUrl);
  if (admins === 0) {
    logger.info('No hay administradores. Crea uno con: npm run admin:create -- --username <nombre> --email <correo>');
  }
});

/**
 * Plataformas gratuitas como Render duermen el servicio tras 15 minutos sin tráfico
 * entrante. Cada 5 minutos el servidor se llama a sí mismo por su dirección pública
 * (la petición entra por el balanceador, así que cuenta como tráfico). La ruta
 * /api/health hace además una consulta mínima, que mantiene activo Supabase.
 */
function startKeepAlive(url: string): void {
  const ping = (): void => {
    fetch(url, { signal: AbortSignal.timeout(20_000) })
      .then((r) => { if (!r.ok) logger.warn('Keep-alive: respuesta inesperada', { status: r.status }); })
      .catch((err: unknown) => logger.warn('Keep-alive: no se pudo contactar', { error: err instanceof Error ? err.message : String(err) }));
  };
  setTimeout(ping, 60_000).unref();
  setInterval(ping, 5 * 60_000).unref();
  logger.info(`Keep-alive cada 5 minutos: ${url}`);
}

let closing = false;
async function shutdown(signal: string): Promise<void> {
  if (closing) return;
  closing = true;
  logger.info(`Recibido ${signal}: cerrando (se devuelven las fichas de las mesas de póker)…`);
  const force = setTimeout(() => process.exit(1), 8000);
  try {
    await running.close();
  } finally {
    clearTimeout(force);
    process.exit(0);
  }
}
process.on('SIGINT', () => void shutdown('SIGINT'));
process.on('SIGTERM', () => void shutdown('SIGTERM'));
process.on('unhandledRejection', (err) => logger.error('Promesa rechazada sin capturar', err));
process.on('uncaughtException', (err) => logger.error('Excepción no capturada', err));
