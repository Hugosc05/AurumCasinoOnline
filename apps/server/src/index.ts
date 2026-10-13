import { buildApp } from './app';
import { loadConfig } from './config';
import { logger } from './lib/logger';

const config = loadConfig();
const running = buildApp(config);

running.server.listen(config.PORT, config.HOST, () => {
  const admins = running.ctx.db.get<{ n: number }>(`SELECT COUNT(*) AS n FROM users WHERE role = 'admin'`)!.n;
  logger.info(`Aurum Casino escuchando en http://${config.HOST}:${config.PORT} (${config.NODE_ENV})`);
  logger.info(`Base de datos: ${config.dbFile}`);
  if (admins === 0) {
    logger.info('No hay administradores. Crea uno con: npm run admin:create -- --username <nombre> --email <correo>');
  }
});

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
