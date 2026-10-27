import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import {
  KM_FINANCIAL_WRITES_MAINTENANCE_CODE,
  assertKmFinancialWritesAvailable,
  kmFinancialWritesMaintenanceEnabled,
} from '../services/kmFinancialWriteMaintenanceService.js';

test('maintenance gate blocks financial writes with a controlled retryable response', () => {
  assert.equal(kmFinancialWritesMaintenanceEnabled({ KM_FINANCIAL_WRITES_MAINTENANCE: 'true' }), true);
  assert.throws(
    () => assertKmFinancialWritesAvailable({ environment: { KM_FINANCIAL_WRITES_MAINTENANCE: 'TRUE' } }),
    (error) => error.statusCode === 503 && error.code === KM_FINANCIAL_WRITES_MAINTENANCE_CODE && error.retryable === true,
  );
});

test('maintenance gate permits dry-runs and is disabled by default', () => {
  assert.equal(kmFinancialWritesMaintenanceEnabled({}), false);
  assert.doesNotThrow(() => assertKmFinancialWritesAvailable({ environment: {} }));
  assert.doesNotThrow(() => assertKmFinancialWritesAvailable({
    dryRun: true,
    environment: { KM_FINANCIAL_WRITES_MAINTENANCE: 'true' },
  }));
});

test('general paths enforce the hold; Missing-KM is admitted only through its independent guarded RPC', async () => {
  const recalculation = await readFile(new URL('../foKmRecalculationService.js', import.meta.url), 'utf8');
  const persistence = await readFile(new URL('../services/foKmV2PersistenceService.js', import.meta.url), 'utf8');
  const main = recalculation.slice(
    recalculation.indexOf('export async function recalculateFoKm('),
    recalculation.indexOf('export async function reconcileFinalLegOnly'),
  );
  const missing = recalculation.slice(
    recalculation.indexOf('export async function decideMissingKmReview'),
    recalculation.indexOf('export async function reconcileFinalLegOnlyBatch'),
  );
  const batch = recalculation.slice(recalculation.indexOf('export async function recalculateFoKmBatch'));
  assert.match(main, /assertKmFinancialWritesAvailable\(\{ dryRun/);
  assert.match(missing, /client\.rpc\('rpc_approve_fo_missing_km_v1'/);
  assert.doesNotMatch(missing, /persistCanonicalKmV2|recalculateFoKm\(/);
  assert.match(batch, /assertKmFinancialWritesAvailable\(\{ dryRun/);
  assert.match(persistence, /assertKmFinancialWritesAvailable\(\{ dryRun: false/);
});
