import { defineConfig, devices } from '@playwright/test';

/**
 * Pruebas de extremo a extremo (navegador real contra el servidor real).
 * Requisito previo (una vez): `npx playwright install chromium`.
 * Usa una base de datos propia (apps/server/data/e2e.db) que se borra al empezar.
 */
const PORT = 3101;
/** E2E_DB=pg: la misma batería contra PostgreSQL (PGlite en un puerto local, como Supabase). */
const PG = process.env.E2E_DB === 'pg';
const PG_PORT = 54329;
export const E2E_DATABASE_URL = `postgresql://postgres:postgres@127.0.0.1:${PG_PORT}/postgres`;
if (PG) process.env.DATABASE_URL = E2E_DATABASE_URL;

const appServer = {
  command: 'npm run build && npm run start',
  url: `http://127.0.0.1:${PORT}/api/health`,
  timeout: 180_000,
  reuseExistingServer: false,
  env: {
    PORT: String(PORT),
    DATABASE_PATH: 'data/e2e.db',
    // Sin E2E_DB=pg se fuerza SQLite aunque haya un DATABASE_URL (p. ej. Supabase) en .env.
    DATABASE_URL: PG ? E2E_DATABASE_URL : '',
    CLIENT_ORIGINS: `http://127.0.0.1:${PORT},http://localhost:${PORT}`,
    LOG_LEVEL: 'warn',
    EMAIL_STRICT: 'false',
    REGISTER_LIMIT_PER_HOUR: '1000',
    LOGIN_LIMIT_PER_15MIN: '1000',
  },
};

export default defineConfig({
  testDir: './e2e',
  timeout: 60_000,
  fullyParallel: false,
  workers: 1,
  reporter: [['list']],
  globalSetup: './e2e/global-setup.ts',
  use: {
    baseURL: `http://127.0.0.1:${PORT}`,
    trace: 'retain-on-failure',
    ...(process.env.PLAYWRIGHT_CHROMIUM_PATH ? { launchOptions: { executablePath: process.env.PLAYWRIGHT_CHROMIUM_PATH } } : {}),
  },
  projects: [
    { name: 'escritorio', use: { ...devices['Desktop Chrome'] }, testIgnore: /responsive/ },
    { name: 'movil', use: { ...devices['Pixel 7'] }, testMatch: /responsive/ },
  ],
  webServer: PG
    ? [{ command: `node scripts/pglite-server.mjs ${PG_PORT}`, port: PG_PORT, timeout: 60_000, reuseExistingServer: false }, appServer]
    : appServer,
});
