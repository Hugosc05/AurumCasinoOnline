// Ejecuta las pruebas del servidor contra PostgreSQL (PGlite: PostgreSQL real en WebAssembly,
// sin instalar nada). Así se comprueba que todo el SQL funciona también en Supabase.
import { spawnSync } from 'node:child_process';

const isWin = process.platform === 'win32';
const r = spawnSync(isWin ? 'npx.cmd' : 'npx', ['vitest', 'run', 'apps/server', ...process.argv.slice(2)], {
  stdio: 'inherit',
  shell: isWin,
  env: { ...process.env, TEST_DB: 'pg' },
});
process.exit(r.status ?? 1);
