import { defineConfig, devices } from '@playwright/test';

const PORT = 4173;

export default defineConfig({
  testDir: './e2e',
  fullyParallel: false,
  workers: 1,
  timeout: 30_000,
  reporter: [['list']],
  use: { baseURL: `http://localhost:${PORT}`, trace: 'retain-on-failure', ...devices['Desktop Chrome'] },
  webServer: {
    command: 'node --disable-warning=ExperimentalWarning scripts/e2e-server.js',
    url: `http://localhost:${PORT}/`,
    reuseExistingServer: false,
    env: { PORT: String(PORT), DB_PATH: 'data/e2e.db', FLOOD_SECONDS: '0' },
  },
});
