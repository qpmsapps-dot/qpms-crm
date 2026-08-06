import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { buildStoreMasterExportRows, fetchAllStoreMasterRows } from '../src/utils/storeMasterExport.js';

function storeRows(count, offset = 0) {
  return Array.from({ length: count }, (_, index) => {
    const number = offset + index + 1;
    return {
      id: `store-${number}`,
      store_code: `S${String(number).padStart(4, '0')}`,
      store_name: `Store ${number}`,
      site_name: `Site ${number}`,
      client_name: number % 2 ? 'Client A' : 'Client B',
      business: 'IFMS',
      state: 'TN',
      latitude: 13,
      longitude: 80,
      gps_accuracy: 10,
      updated_at: '2026-08-01T00:00:00.000Z',
      status: 'Active',
    };
  });
}

test('Store Master export supports fewer than 100 stores', async () => {
  const calls = [];
  const rows = storeRows(42);
  const result = await fetchAllStoreMasterRows(async (params) => {
    calls.push(params);
    return { rows };
  }, { state: 'TN' }, { batchSize: 100 });

  assert.equal(result.length, 42);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].exportAll, true);
  assert.equal(calls[0].state, 'TN');
});

test('Store Master export fetches more than 100 stores without using the visible page', async () => {
  const source = storeRows(150);
  const result = await fetchAllStoreMasterRows(async ({ page, limit }) => ({
    rows: source.slice((page - 1) * limit, page * limit),
  }), {}, { batchSize: 100 });

  assert.equal(result.length, 150);
  assert.equal(result.at(0).id, 'store-1');
  assert.equal(result.at(-1).id, 'store-150');
});

test('Store Master export fetches more than one internal batch with a smaller final batch', async () => {
  const source = storeRows(2500);
  const calls = [];
  const result = await fetchAllStoreMasterRows(async ({ page, limit, business }) => {
    calls.push({ page, limit, business });
    return { rows: source.slice((page - 1) * limit, page * limit) };
  }, { business: 'IFMS' }, { batchSize: 1000 });

  assert.equal(result.length, 2500);
  assert.deepEqual(calls.map((call) => call.page), [1, 2, 3]);
  assert.equal(calls.every((call) => call.business === 'IFMS'), true);
});

test('Store Master export applies filters to every batch', async () => {
  const filters = {
    search: 'cge',
    business: 'DME',
    state: 'TN',
    status: 'Active',
    storeType: 'Hospital',
    client: 'RGGH',
    gpsStatus: 'GPS Available',
  };
  const calls = [];

  await fetchAllStoreMasterRows(async (params) => {
    calls.push(params);
    return { rows: calls.length === 1 ? storeRows(2) : [] };
  }, filters, { batchSize: 2 });

  assert.equal(calls.length, 2);
  for (const call of calls) {
    assert.equal(call.search, filters.search);
    assert.equal(call.business, filters.business);
    assert.equal(call.state, filters.state);
    assert.equal(call.status, filters.status);
    assert.equal(call.storeType, filters.storeType);
    assert.equal(call.client, filters.client);
    assert.equal(call.gpsStatus, filters.gpsStatus);
  }
});

test('Store Master export stops without duplicate or missing stores', async () => {
  const source = storeRows(205);
  const result = await fetchAllStoreMasterRows(async ({ page, limit }) => ({
    rows: source.slice((page - 1) * limit, page * limit),
  }), {}, { batchSize: 50 });
  const ids = result.map((row) => row.id);

  assert.equal(result.length, 205);
  assert.equal(new Set(ids).size, 205);
  assert.deepEqual(ids, source.map((row) => row.id));
});

test('Store Master export fails safely when a later batch fails', async () => {
  await assert.rejects(
    fetchAllStoreMasterRows(async ({ page }) => {
      if (page === 2) throw new Error('Batch 2 failed');
      return { rows: storeRows(100) };
    }, {}, { batchSize: 100 }),
    /Batch 2 failed/,
  );
});

test('Store Master export row count matches filtered database rows returned', async () => {
  const source = storeRows(1842);
  const result = await fetchAllStoreMasterRows(async ({ page, limit }) => ({
    rows: source.slice((page - 1) * limit, page * limit),
  }), { client: 'RGGH' }, { batchSize: 1000 });

  assert.equal(buildStoreMasterExportRows(result).length, 1842);
});

test('Store Master API keeps normal list cap but permits export batches', () => {
  const server = readFileSync(new URL('../backend/server.js', import.meta.url), 'utf8');
  assert.match(server, /const isExportRequest = \/\^true\$\/i\.test\(String\(request\.query\.exportAll \|\| ''\)\);/);
  assert.match(server, /const maxLimit = isExportRequest \? 1000 : 100;/);
  assert.match(server, /\.order\('created_at', \{ ascending: true, nullsFirst: false \}\)\.order\('id', \{ ascending: true \}\)/);
});
