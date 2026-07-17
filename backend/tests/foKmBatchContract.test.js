import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const servicePath = new URL('../foKmRecalculationService.js', import.meta.url);
const frontendPath = new URL('../../src/pages/FOActivities.jsx', import.meta.url);

test('batch recalculation is cursor-paginated without the old 2,000-row cap', async () => {
  const source = await readFile(servicePath, 'utf8');
  const batch = source.slice(source.indexOf('export async function recalculateFoKmBatch'));
  assert.match(batch, /batchSize \+ 1/);
  assert.match(batch, /Math\.min\(100/);
  assert.match(batch, /runWithConcurrency\(pageRows, 4/);
  assert.match(batch, /nextCursor/);
  assert.doesNotMatch(batch, /limit\(Number\(payload\.limit \|\| 2000\)\)/);
});

test('batch applies profile state/business scope and attendance status', async () => {
  const source = await readFile(servicePath, 'utf8');
  const batch = source.slice(source.indexOf('async function loadBatchProfileScope'));
  assert.match(batch, /from\('profiles'\)/);
  assert.match(batch, /query = query\.eq\('state', state\)/);
  assert.match(batch, /query = query\.eq\('business', business\)/);
  assert.match(batch, /query = query\.ilike\('status', status\)/);
});

test('main recalculation requests non-persisting leg calculation and owns the attendance write', async () => {
  const source = await readFile(servicePath, 'utf8');
  const main = source.slice(
    source.indexOf('export async function recalculateFoKm('),
    source.indexOf('export async function recalculateSwitchModeKmTemporary'),
  );
  assert.match(main, /persist: false/);
  assert.match(main, /auditDelayedCheckout: false/);
  assert.match(main, /eligibility_status: reviewFlags\.length \? \[\.\.\.new Set\(reviewFlags\)\]\.join\(','\) : 'Approved'/);
  assert.equal((main.match(/\.from\('fo_attendance'\)\s*\.update\(/g) || []).length, 1);
});

test('historical recalculation cannot update current live status', async () => {
  const source = await readFile(servicePath, 'utf8');
  const main = source.slice(
    source.indexOf('export async function recalculateFoKm('),
    source.indexOf('export async function recalculateSwitchModeKmTemporary'),
  );
  assert.match(main, /attendance\.attendance_date === indiaDateKey\(\)/);
  assert.match(main, /liveStatus\?\.attendance_id === attendance\.id/);
  assert.doesNotMatch(main, /\.from\('fo_live_status'\)\s*\.upsert\(/);
});

test('Operations UI follows nextCursor batches and reports cumulative progress', async () => {
  const source = await readFile(frontendPath, 'utf8');
  const handler = source.slice(
    source.indexOf('async function recalculateAllKmForSelectedRange'),
    source.indexOf('const stateSummaryRows'),
  );
  assert.match(handler, /while \(!done\)/);
  assert.match(handler, /batchSize: 50/);
  assert.match(handler, /cursor = page\.nextCursor/);
  assert.match(handler, /setBatchKmRecalcProgress/);
  assert.match(handler, /attempt <= 3/);
  assert.match(handler, /setBatchKmRecalcResume/);
  assert.match(handler, /Progress was preserved and can be resumed/);
});
