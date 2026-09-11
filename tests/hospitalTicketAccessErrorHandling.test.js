import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const hook = fs.readFileSync(path.join(root, 'src/hooks/useHospitalTicketAccess.js'), 'utf8');
const dashboard = fs.readFileSync(path.join(root, 'src/pages/Dashboard.jsx'), 'utf8');

test('Hospital Ticket access distinguishes a scope denial from transport failure', () => {
  assert.match(hook, /response\?\.status === 403/);
  assert.match(hook, /Hospital ticket scope is not assigned\./);
  assert.match(hook, /Unable to verify Hospital Ticketing access\./);
});

test('Dashboard renders the shared access result instead of hardcoding every denial as missing scope', () => {
  assert.match(dashboard, /hospitalAccess\.loading \?/);
  assert.match(dashboard, /Verifying Hospital Ticketing access/);
  assert.match(dashboard, /hospitalAccess\.error \|\| 'Hospital ticket scope is not assigned\.'/);
});

test('Hospital Ticket access requests are cached and do not retry in a render loop', () => {
  assert.match(hook, /const accessCache = new Map\(\)/);
  assert.match(hook, /accessCache\.set\(cacheKey, request\)/);
  assert.match(hook, /\[presentation, user\?\.isDemoReadOnly, userKey\]/);
});
