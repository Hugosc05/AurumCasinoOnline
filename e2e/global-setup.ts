import { execFileSync } from 'node:child_process';
import { rmSync } from 'node:fs';
import path from 'node:path';

/** Base de datos limpia para E2E y un administrador creado con la CLI protegida. */
export default function globalSetup(): void {
  const dir = path.resolve('apps/server/data');
  for (const suffix of ['', '-wal', '-shm']) rmSync(path.join(dir, `e2e.db${suffix}`), { force: true });
  execFileSync(
    process.execPath,
    ['--no-warnings=ExperimentalWarning', '--import', 'tsx', 'apps/server/src/cli/createAdmin.ts', '--username', 'e2eadmin', '--email', 'e2eadmin@example.com'],
    { env: { ...process.env, DATABASE_PATH: 'data/e2e.db', ADMIN_PASSWORD: 'AdminE2E2026' }, stdio: 'inherit' },
  );
}
