import {fileURLToPath} from 'node:url';
import base from '../../playwright.config.js';
// Never reuse a Vite server from another developer worktree.
export default {
  ...base,testDir:fileURLToPath(new URL('.',import.meta.url)),
  testMatch:/retailAttendance(?:Correction|Exceptions)?\.spec\.js/,
  outputDir:fileURLToPath(new URL('../../test-results/attendance-correction',import.meta.url)),
  reporter:[['list']],
  use:{...base.use,baseURL:'http://127.0.0.1:4186'},
  webServer:{...base.webServer,command:'npm run dev -- --host 127.0.0.1 --port 4186 --strictPort',url:'http://127.0.0.1:4186',reuseExistingServer:false},
};
