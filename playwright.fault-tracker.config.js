import {defineConfig} from '@playwright/test';

// Dedicated production-artifact preview. No existing server/session is reused.
export default defineConfig({
 testDir:'./tests/browser',
 testMatch:'faultTrackerAgeing.spec.js',
 outputDir:'.cache/fault-tracker-ageing-results',
 timeout:60000,
 expect:{timeout:10000},
 workers:1,
 reporter:'list',
 use:{baseURL:'http://127.0.0.1:4186',browserName:'chromium',headless:true,screenshot:'only-on-failure',trace:'retain-on-failure'},
 webServer:{
  command:'node node_modules/vite/bin/vite.js preview --host 127.0.0.1 --port 4186 --strictPort',
  url:'http://127.0.0.1:4186',reuseExistingServer:false,timeout:30000,
  env:{VITE_SUPABASE_URL:'',VITE_SUPABASE_ANON_KEY:'',VITE_API_URL:'http://127.0.0.1:4999'},
 },
});
