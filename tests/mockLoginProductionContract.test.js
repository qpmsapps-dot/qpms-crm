import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const mobileConfig = await readFile(
  new URL('../Mobile_FO_V2/lib/services/config_service.dart', import.meta.url),
  'utf8',
);
const mobileLogin = await readFile(
  new URL('../Mobile_FO_V2/lib/auth/login_screen.dart', import.meta.url),
  'utf8',
);
const clientConfig = await readFile(
  new URL('../Client_Ticketing_App/lib/services/app_config.dart', import.meta.url),
  'utf8',
);
const clientAuth = await readFile(
  new URL('../Client_Ticketing_App/lib/state/auth_controller.dart', import.meta.url),
  'utf8',
);
const webAuth = await readFile(new URL('../src/context/AuthContext.jsx', import.meta.url), 'utf8');
const server = await readFile(new URL('../backend/server.js', import.meta.url), 'utf8');

test('Flutter demo authentication requires an explicit compile-time flag', () => {
  assert.match(mobileConfig, /HOSPITAL_DEMO_MODE[\s\S]*defaultValue:\s*false/);
  assert.match(mobileLogin, /AppConfig\.hospitalDemoMode\s*&&\s*HospitalDemoAuth\.isDemoLoginId/);
  assert.match(clientConfig, /HOSPITAL_DEMO_MODE[\s\S]*defaultValue:\s*false/);
  assert.match(clientAuth, /if \(demoMode\)/);
});

test('missing Flutter configuration fails closed instead of enabling demo auth', () => {
  assert.match(mobileConfig, /Missing required mobile configuration/);
  assert.match(clientAuth, /Client Ticketing is not configured for this build\./);
});

test('web and backend demo authentication require separate explicit true flags', () => {
  assert.match(webAuth, /VITE_ENABLE_DEMO_AUTH \|\| ''\)[\s\S]*=== 'true'/);
  assert.match(server, /process\.env\.ENABLE_DEMO_AUTH \|\| ''\)[\s\S]*=== 'true'/);
  assert.match(server, /if \(!demoBackendAuthEnabled\)[\s\S]*status\(404\)/);
});
