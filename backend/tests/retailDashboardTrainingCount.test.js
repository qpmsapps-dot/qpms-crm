import test from 'node:test';
import assert from 'node:assert/strict';
import { retailDashboard } from '../services/relianceRetailManagementService.js';

const TN = '10000000-0000-0000-0000-000000000001';
const KL = '10000000-0000-0000-0000-000000000002';
const OTHER = '10000000-0000-0000-0000-000000000003';
const actor = { id: 'admin', role: 'Admin', business: 'Reliance Retail' };
const session = (id, extra = {}) => ({ id, store_id: null, retail_store_id: null, access_client_code: 'reliance_retail', training_date: '2026-10-22', ...extra });

function fixture(sessions) {
  const calls = [];
  const tables = {
    reliance_retail_store_master: [
      { id: TN, store_code: 'TN1', state: 'TN', zone_id: 'zone-tn', status: 'Active' },
      { id: KL, store_code: 'KL1', state: 'KL', zone_id: 'zone-kl', status: 'Active' },
    ],
    training_sessions: sessions,
  };
  return { calls, client: { from(table) {
    calls.push({ table });
    let rows = [...(tables[table] || [])];
    const q = {
      select(columns, options) { calls.push({ table, select: columns, options }); return q; },
      limit() { return q; },
      eq(key, value) { rows = rows.filter(row => row[key] === value); return q; },
      in(key, values) { rows = rows.filter(row => values.includes(row[key])); return q; },
      is(key, value) { rows = rows.filter(row => (row[key] ?? null) === value); return q; },
      gte(key, value) { rows = rows.filter(row => row[key] >= value); return q; },
      lt(key, value) { rows = rows.filter(row => row[key] < value); return q; },
      or(expression) {
        calls.push({ table, or: expression });
        const match = expression.match(/^store_id\.in\.\(([^)]+)\),retail_store_id\.in\.\(([^)]+)\)$/);
        assert.ok(match, 'Use a single row-level OR over the two supported linkage columns');
        const legacy = match[1].split(','); const retail = match[2].split(',');
        rows = rows.filter(row => legacy.includes(row.store_id) || retail.includes(row.retail_store_id));
        return q;
      },
      then(resolve, reject) { return Promise.resolve({ data: rows, count: rows.length, error: null }).then(resolve, reject); },
    };
    return q;
  } } };
}

for (const [name, rows, expected] of [
  ['legacy store_id only', [session('a', { store_id: TN })], 1],
  ['canonical retail_store_id only', [session('a', { retail_store_id: TN })], 1],
  ['both identifiers matching one store', [session('a', { store_id: TN, retail_store_id: TN })], 1],
  ['both identifiers matching different selected stores', [session('a', { store_id: TN, retail_store_id: KL })], 1],
  ['mixed supported sessions', [session('a', { store_id: TN }), session('b', { retail_store_id: TN }), session('c', { store_id: KL, retail_store_id: KL })], 3],
  ['unrelated and unlinked stores', [session('a', { store_id: OTHER, retail_store_id: OTHER }), session('b')], 0],
  ['different business/client excluded', [session('a', { retail_store_id: TN, access_client_code: 'other_client' })], 0],
  ['month boundaries preserved', [session('a', { store_id: TN, training_date: '2026-10-01' }), session('b', { retail_store_id: TN, training_date: '2026-09-30' }), session('c', { retail_store_id: TN, training_date: '2026-11-01' })], 1],
]) test(`Retail Training count: ${name}`, async () => {
  const f = fixture(rows);
  const result = await retailDashboard(f.client, actor, { month: '2026-10' });
  assert.equal(result.training_sessions, expected);
  assert.equal(f.calls.filter(c => c.table === 'training_sessions' && c.or).length, 1);
  assert.ok(f.calls.some(c => c.table === 'training_sessions' && c.options?.count === 'exact' && c.options?.head === true));
});

for (const filters of [{ state: 'TN' }, { zone_id: 'zone-tn' }, { store_id: TN }]) {
  test(`Retail Training count preserves selected store filters ${JSON.stringify(filters)}`, async () => {
    const f = fixture([session('a', { retail_store_id: TN }), session('b', { store_id: KL })]);
    assert.equal((await retailDashboard(f.client, actor, { month: '2026-10', ...filters })).training_sessions, 1);
    const expression = f.calls.find(c => c.or).or;
    assert.ok(expression.includes(TN)); assert.ok(!expression.includes(KL));
  });
}

test('Retail Training count: no selected stores yields zero without an empty OR', async () => {
  const f = fixture([session('a', { retail_store_id: TN })]);
  assert.equal((await retailDashboard(f.client, actor, { state: 'XX' })).training_sessions, 0);
  assert.equal(f.calls.filter(c => c.or).length, 0);
});

test('Retail Training count: unauthorized actor is rejected before any query', async () => {
  const f = fixture([session('a', { retail_store_id: TN })]);
  await assert.rejects(() => retailDashboard(f.client, { id: 'hk', role: 'MIS', designation: 'HK MIS', business: 'Other' }, {}), error => error.statusCode === 403);
  assert.deepEqual(f.calls, []);
});
