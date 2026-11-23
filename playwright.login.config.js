import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './tests/browser',
  testMatch: 'loginExperience.spec.js',
  use: { baseURL: 'http://127.0.0.1:4175', browserName: 'chromium', headless: true },
  webServer: {
    command: 'npm run dev -- --host 127.0.0.1 --port 4175',
    url: 'http://127.0.0.1:4175',
    env: {
      VITE_ENABLE_DEMO_AUTH: 'false', VITE_DEMO_MODE: 'false',
      VITE_SUPABASE_URL: 'http://127.0.0.1:4998',
      VITE_SUPABASE_ANON_KEY: 'synthetic-test-key',
      VITE_API_URL: 'http://127.0.0.1:4999',
    },
  },
});
