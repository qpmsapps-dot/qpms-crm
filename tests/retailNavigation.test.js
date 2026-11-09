import test from 'node:test';
import assert from 'node:assert/strict';
import { readRetailNavigation, retailNavigationState } from '../src/utils/retailNavigation.js';
const scope = { month: '2026-10', from: '2026-10-01', to: '2026-10-09', state: 'PY', store: 'store-1', zone: 'zone-1' };
test('Training receives exact supported period/state/store/zone', () => assert.deepEqual(readRetailNavigation(retailNavigationState({ id: 'training' }, scope), 'training', '2026-11-09'), { ...scope, state: 'TN', kind: undefined }));
for (const kind of ['cm', 'pm']) test('maintenance receives ' + kind + ' without altering module windows', () => {
  const context = readRetailNavigation(retailNavigationState({ id: kind }, scope), 'maintenance', '2026-11-09');
  assert.equal(context.kind, kind.toUpperCase()); assert.equal(context.month, '2026-10'); assert.equal(context.zone, '');
});
test('no context preserves destination defaults', () => assert.equal(readRetailNavigation(null, 'training', '2026-11-09'), null));
for (const patch of [{ version: 0 }, { source: 'outside' }, { from: '2026-10-33' }, { to: '2027-01-01' }, { state: 'UNKNOWN' }, { store: '../../outside' }, { month: '2026-09' }]) test('invalid context preserves defaults: ' + JSON.stringify(patch), () => {
  const state = retailNavigationState({ id: 'training' }, scope); Object.assign(state.retailExecutiveScope, patch);
  assert.equal(readRetailNavigation(state, 'training', '2026-11-09'), null);
});
test('context for a different module cannot leak filters', () => assert.equal(readRetailNavigation(retailNavigationState({ id: 'training' }, scope), 'attendance', '2026-11-09'), null));
