import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './tests/browser',
  timeout: 45_000,
  expect: { timeout: 8_000 },
  fullyParallel: false,
  reporter: [['list'], ['html', { outputFolder: 'D:/QPMS_CRM/.phase4-test-output/report', open: 'never' }]],
  use: {
    baseURL: 'http://127.0.0.1:4174',
    browserName: 'chromium',
    headless: true,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
  },
  webServer: {
    command: 'npm run dev -- --host 127.0.0.1 --port 4174',
    url: 'http://127.0.0.1:4174',
    reuseExistingServer: true,
    timeout: 30_000,
    env: {
      VITE_ENABLE_DEMO_AUTH: 'true',
      VITE_APP_MODE: 'demo',
      VITE_SUPABASE_URL: '',
      VITE_SUPABASE_ANON_KEY: '',
      VITE_API_URL: 'http://127.0.0.1:4999',
    },
  },
});
