/**
 * Quita la verificación en dos pasos de un administrador (por si pierde el
 * móvil y los códigos de recuperación). Solo se puede ejecutar en el propio
 * servidor: quien llega aquí ya controla la máquina.
 *
 *   npm run admin:reset-2fa -w @aurum/server -- --username admin
 */
import { loadConfig } from '../config';
import { Database, migrate, nowIso } from '../db/database';

const i = process.argv.indexOf('--username');
const username = i > -1 ? process.argv[i + 1] : undefined;
if (!username) {
  console.error('Uso: npm run admin:reset-2fa -w @aurum/server -- --username <nombre>');
  process.exit(1);
}
const db = new Database(loadConfig().dbTarget);
migrate(db);
const user = db.get<{ id: string; role: string }>('SELECT id, role FROM users WHERE lower(username) = lower(?)', username);
if (!user) {
  console.error(`No existe el usuario ${username}.`);
  process.exit(1);
}
db.tx(() => {
  db.run('DELETE FROM admin_mfa WHERE user_id = ?', user.id);
  // Cierra sus sesiones: tendrá que entrar de nuevo y volver a configurar la 2FA.
  db.run('DELETE FROM sessions WHERE user_id = ?', user.id);
  db.run(
    'INSERT INTO security_events (kind, severity, ip, user_id, detail, created_at) VALUES (?, ?, ?, ?, ?, ?)',
    'mfa_disabled', 'high', null, user.id, `${username} (desde la consola del servidor)`, nowIso(),
  );
});
db.close();
console.log(`Verificación en dos pasos quitada a ${username}. Al entrar al panel se le pedirá configurarla de nuevo.`);
