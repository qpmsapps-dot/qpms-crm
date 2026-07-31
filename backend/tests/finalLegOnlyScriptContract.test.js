import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const script = fs.readFileSync(new URL('../scripts/reconcileFinalTravelLegs.js', import.meta.url), 'utf8');

test('final-leg-only command is wired to the isolated reconciliation service', () => {
  assert.match(script, /args\.has\('--final-leg-only'\)/);
  assert.match(script, /reconcileFinalLegOnly\(/);
  assert.match(script, /reconcileFinalLegOnlyBatch\(/);
  assert.match(script, /finalLegOnly\s*\?/);
});
