import { defineConfig, devices } from '@playwright/test';

/**
 * Pruebas de animación contra el servidor de DESARROLLO (Vite + React en modo
 * estricto), que es como se suele usar la aplicación mientras se trabaja en ella.
 * Uso: `npm run test:e2e:dev`. Usa su propia base de datos (apps/server/data/e2e.db).
 */
const API = 3102;
const WEB = 5174;

export default defineConfig({
  testDir: './e2e',
  testMatch: /animations\.spec\.ts/,
  timeout: 60_000,
  workers: 1,
  reporter: [['list']],
  globalSetup: './e2e/global-setup.ts',
  use: {
    baseURL: `http://127.0.0.1:${WEB}`,
    trace: 'retain-on-failure',
    ...(process.env.PLAYWRIGHT_CHROMIUM_PATH ? { launchOptions: { executablePath: process.env.PLAYWRIGHT_CHROMIUM_PATH } } : {}),
  },
  projects: [{ name: 'desarrollo', use: { ...devices['Desktop Chrome'] } }],
  webServer: [
    {
      command: 'npm run start -w @aurum/server',
      url: `http://127.0.0.1:${API}/api/health`,
      timeout: 60_000,
      reuseExistingServer: false,
      env: {
        PORT: String(API),
        DATABASE_PATH: 'data/e2e.db',
        CLIENT_ORIGINS: `http://127.0.0.1:${WEB},http://localhost:${WEB}`,
        LOG_LEVEL: 'warn',
        EMAIL_STRICT: 'false',
        REGISTER_LIMIT_PER_HOUR: '1000',
        LOGIN_LIMIT_PER_15MIN: '1000',
      },
    },
    {
      command: `npm run dev -w @aurum/web -- --port ${WEB} --host 127.0.0.1`,
      url: `http://127.0.0.1:${WEB}`,
      timeout: 60_000,
      reuseExistingServer: false,
      env: { AURUM_API: `http://127.0.0.1:${API}` },
    },
  ],
});
