import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const auth = await readFile(new URL('../src/context/AuthContext.jsx', import.meta.url), 'utf8');
const api = await readFile(new URL('../src/services/api.js', import.meta.url), 'utf8');
const users = await readFile(new URL('../src/pages/settings/UserManagement.jsx', import.meta.url), 'utf8');
const operations = await readFile(new URL('../src/pages/FOActivities.jsx', import.meta.url), 'utf8');

test('auth provider owns the session and one cleaned-up auth listener', () => {
  assert.match(auth, /const \[session, setSessionState\] = useState\(null\)/);
  assert.equal((auth.match(/onAuthStateChange/g) || []).length, 1);
  assert.match(auth, /listener\?\.subscription\?\.unsubscribe\(\)/);
});

test('protected API requests use shared authentication instead of direct getSession calls', () => {
  assert.match(api, /authenticatedApiRequest/);
  assert.match(api, /authenticatedFetch/);
  assert.doesNotMatch(api, /supabase\.auth\.getSession\(/);
});

test('User Management waits for auth and does not turn request failure into zero profiles', () => {
  assert.match(users, /authStatus === 'loading'/);
  assert.match(users, /!session\?\.access_token/);
  assert.doesNotMatch(users, /catch \(error\) \{[\s\S]*?setUsers\(\[\]\)[\s\S]*?setTotal\(0\)/);
  assert.match(users, /loadError \? 'Profiles unavailable'/);
});

test('Operations polling and Realtime are gated by an active session and channels are removed', () => {
  assert.match(operations, /if \(!hasActiveSession\) return undefined;[\s\S]*?setInterval/);
  assert.ok((operations.match(/!hasActiveSession\) return undefined/g) || []).length >= 3);
  assert.ok((operations.match(/supabase\.removeChannel\(channel\)/g) || []).length >= 2);
  assert.doesNotMatch(operations, /REALTIME_RECONNECT/);
});

test('Operations protected backend actions use the shared authenticated helpers', () => {
  assert.doesNotMatch(operations, /supabase\.auth\.getSession\(/);
  assert.ok((operations.match(/authenticatedFetch\(/g) || []).length >= 5);
  assert.match(operations, /authenticatedApiRequest\(\{/);
});

test('Leaflet deferred callbacks are cancelled and guarded after unmount', () => {
  assert.match(operations, /window\.clearTimeout\(timer\)/);
  assert.match(operations, /window\.cancelAnimationFrame\(animationFrame\)/);
  assert.match(operations, /!container\?\.isConnected \|\| !map\._loaded/);
  assert.match(operations, /mountedRef\.current = false/);
});
