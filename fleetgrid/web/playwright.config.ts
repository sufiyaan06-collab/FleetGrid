import { defineConfig, devices } from '@playwright/test';

const dataDir = `/tmp/fleetgrid-playwright-${process.env.GITHUB_RUN_ID ?? process.pid}`;

export default defineConfig({
  testDir: './e2e',
  fullyParallel: false,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 1 : 0,
  workers: process.env.CI ? 1 : undefined,
  reporter: 'list',
  timeout: 30_000,
  expect: { timeout: 8_000 },
  use: {
    baseURL: 'http://127.0.0.1:5173',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    ...devices['Desktop Chrome'],
  },
  webServer: [
    {
      command: `rm -rf "${dataDir}" && mkdir -p "${dataDir}" && DATA_DIR="${dataDir}" AUTO_SEED=true NODE_ENV=test FLEETGRID_TEST_BYPASS_AUTH=true CORS_ORIGIN=http://127.0.0.1:5173 RESEND_API_KEY= EMAIL_FROM= APP_BASE_URL= PORT=4000 HOST=127.0.0.1 npm run dev --prefix ../server`,
      url: 'http://127.0.0.1:4000/health',
      reuseExistingServer: Boolean(process.env.CI),
      timeout: 60_000,
    },
    {
      command: 'npm run dev -- --host 127.0.0.1',
      url: 'http://127.0.0.1:5173',
      reuseExistingServer: !process.env.CI,
      timeout: 60_000,
    },
  ],
});
