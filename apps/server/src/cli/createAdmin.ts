/**
 * Creación protegida del primer administrador (o promoción de una cuenta existente).
 *
 * Solo puede ejecutarlo quien tenga acceso a la máquina y a la base de datos:
 * no existe ningún endpoint público para obtener el rol de administrador.
 *
 *   npm run admin:create -- --username admin --email admin@example.com
 *   (la contraseña se pide por teclado sin mostrarse, o se lee de ADMIN_PASSWORD)
 *
 *   npm run admin:create -- --promote nombre_de_usuario
 *   npm run admin:create -- --reset-password nombre_de_usuario
 */
import { randomUUID } from 'node:crypto';
import { stdin, stdout } from 'node:process';
import { parseArgs } from 'node:util';
import { loadConfig } from '../config';
import { Database, migrate, nowIso } from '../db/database';
import { seed } from '../db/seed';
import { hashPassword } from '../auth/password';
import { emailSchema, passwordSchema, usernameSchema } from '../auth/users';

function promptHidden(question: string): Promise<string> {
  return new Promise((resolve, reject) => {
    if (!stdin.isTTY) {
      reject(new Error('No hay terminal interactiva: define ADMIN_PASSWORD en el entorno.'));
      return;
    }
    stdout.write(question);
    let value = '';
    stdin.setRawMode(true);
    stdin.resume();
    stdin.setEncoding('utf8');
    const onData = (ch: string): void => {
      if (ch === '\r' || ch === '\n' || ch === '\u0004') {
        stdin.setRawMode(false);
        stdin.pause();
        stdin.off('data', onData);
        stdout.write('\n');
        resolve(value);
      } else if (ch === '\u0003') {
        stdin.setRawMode(false);
        process.exit(130);
      } else if (ch === '\u007f' || ch === '\b') {
        value = value.slice(0, -1);
      } else {
        value += ch;
      }
    };
    stdin.on('data', onData);
  });
}

async function main(): Promise<void> {
  const { values } = parseArgs({
    options: {
      username: { type: 'string' },
      email: { type: 'string' },
      promote: { type: 'string' },
      'reset-password': { type: 'string' },
    },
  });
  const config = loadConfig();
  const db = new Database(config.dbFile);
  migrate(db);
  seed(db);

  if (values['reset-password']) {
    const target = values['reset-password'];
    let pw = process.env.ADMIN_PASSWORD ?? '';
    if (!pw) {
      pw = await promptHidden(`Nueva contraseña para "${target}": `);
      const again = await promptHidden('Repite la contraseña: ');
      if (pw !== again) throw new Error('Las contraseñas no coinciden');
    }
    passwordSchema.parse(pw);
    const user = db.get<{ id: string }>('SELECT id FROM users WHERE username = ?', target);
    if (!user) throw new Error(`No existe el usuario "${target}"`);
    db.run('UPDATE users SET password_hash = ? WHERE id = ?', await hashPassword(pw), user.id);
    db.run('DELETE FROM sessions WHERE user_id = ?', user.id);
    db.run(
      'INSERT INTO audit_log (actor_id, action, target, details_json, ip, created_at) VALUES (NULL, ?, ?, ?, ?, ?)',
      'cli.reset_password', user.id, null, 'cli', nowIso(),
    );
    console.log(`✔ Contraseña de "${target}" restablecida; sus sesiones se han cerrado.`);
    return;
  }

  if (values.promote) {
    const r = db.run(`UPDATE users SET role = 'admin' WHERE username = ?`, values.promote);
    if (r.changes !== 1) throw new Error(`No existe el usuario "${values.promote}"`);
    db.run(
      'INSERT INTO audit_log (actor_id, action, target, details_json, ip, created_at) VALUES (NULL, ?, ?, ?, ?, ?)',
      'cli.promote', values.promote, null, 'cli', nowIso(),
    );
    console.log(`✔ "${values.promote}" ahora es administrador.`);
    return;
  }

  const username = usernameSchema.parse(values.username ?? '');
  const email = emailSchema.parse(values.email ?? '');
  let password = process.env.ADMIN_PASSWORD ?? '';
  if (!password) {
    password = await promptHidden('Contraseña del administrador (mín. 10, letras y números): ');
    const again = await promptHidden('Repite la contraseña: ');
    if (password !== again) throw new Error('Las contraseñas no coinciden');
  }
  passwordSchema.parse(password);

  const exists = db.get('SELECT id FROM users WHERE username = ? OR email = ?', username, email);
  if (exists) throw new Error('Ya existe un usuario con ese nombre o correo. Usa --promote <usuario> para promoverlo.');
  const id = randomUUID();
  db.run(
    `INSERT INTO users (id, username, email, password_hash, role, balance, created_at) VALUES (?, ?, ?, ?, 'admin', 0, ?)`,
    id, username, email, await hashPassword(password), nowIso(),
  );
  db.run(
    'INSERT INTO audit_log (actor_id, action, target, details_json, ip, created_at) VALUES (NULL, ?, ?, ?, ?, ?)',
    'cli.create_admin', id, JSON.stringify({ username }), 'cli', nowIso(),
  );
  console.log(`✔ Administrador "${username}" creado. Inicia sesión en la aplicación con su correo o nombre de usuario.`);
  db.close();
}

main().catch((err: unknown) => {
  const issues = (err as { issues?: { message: string }[] }).issues;
  console.error('✖', issues ? issues.map((i) => i.message).join('; ') : err instanceof Error ? err.message : err);
  process.exit(1);
});
