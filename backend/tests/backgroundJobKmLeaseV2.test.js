import assert from 'node:assert/strict';
import test from 'node:test';
import { runOwnedBackgroundJob } from '../services/backgroundJobOwnership.js';

const quiet = { error() {}, warn() {} };
const noWait = async () => {};

test('KM-only worker uses V2 claim/release and preserves a successful result', async () => {
  const called = [];
  const client = { async rpc(name, args) {
    called.push({ name, args });
    assert.equal(args.p_job, 'end_day_km');
    if (name === 'rpc_worker_claim_km_v2' || name === 'rpc_worker_release_km_v2') {
      return { data: true, error: null };
    }
    throw new Error('Unexpected RPC ' + name);
  } };
  const result = await runOwnedBackgroundJob(client, 'end_day_km',
    async ({ signal }) => { assert.equal(signal.aborted, false); return { posted: true, km: 7 }; },
    { logger: quiet, releaseRetryDelaysMs: [0], wait: noWait });
  assert.equal(result.ran, true);
  assert.deepEqual(result.value, { posted: true, km: 7 });
  assert.deepEqual(called.map(c => c.name), ['rpc_worker_claim_km_v2', 'rpc_worker_release_km_v2']);
  assert.equal(called[0].args.p_token, called[1].args.p_token);
  assert.equal(called[0].args.p_owner, called[1].args.p_owner);
});

test('KM release retries transient database restart and clears ownership', async () => {
  let releases = 0;
  let workCalls = 0;
  const client = { async rpc(name) {
    if (name === 'rpc_worker_claim_km_v2') return { data: true, error: null };
    if (name === 'rpc_worker_release_km_v2') {
      releases += 1;
      if (releases === 1) throw new Error('connection reset');
      if (releases === 2) return { data: null, error: { code: 'PGRST000' } };
      return { data: true, error: null };
    }
    throw new Error('Unexpected RPC ' + name);
  } };
  const result = await runOwnedBackgroundJob(client, 'end_day_km',
    async () => { workCalls += 1; return 'posted'; }, {
      logger: quiet, releaseRetryDelaysMs: [0, 1, 2], wait: noWait,
    });
  assert.equal(result.value, 'posted');
  assert.equal(releases, 3);
  assert.equal(workCalls, 1, 'financial work must not be re-executed by release retry');
});

test('KM heartbeat revocation aborts the worker and preserves token fencing', async () => {
  let renewals = 0;
  let releases = 0;
  const client = { async rpc(name) {
    if (name === 'rpc_worker_claim_km_v2') return { data: true, error: null };
    if (name === 'rpc_worker_renew_km_v2') {
      renewals += 1;
      return { data: false, error: null };
    }
    if (name === 'rpc_worker_release_km_v2') {
      releases += 1;
      return { data: true, error: null };
    }
    throw new Error('Unexpected RPC ' + name);
  } };
  await assert.rejects(runOwnedBackgroundJob(client, 'end_day_km',
    async ({ signal, isLeaseValid }) => {
      await new Promise(resolve => setTimeout(resolve, 25));
      assert.equal(signal.aborted, true);
      assert.equal(isLeaseValid(), false);
      return 'must not be accepted';
    }, { logger: quiet, kmHeartbeatIntervalMs: 2, releaseRetryDelaysMs: [0], wait: noWait }),
  error => error.code === 'km_worker_lease_lost');
  assert.ok(renewals >= 1);
  assert.equal(releases, 1);
});

test('KM permanently failed release is reported, not silently marked successful', async () => {
  let releases = 0;
  const client = { async rpc(name) {
    if (name === 'rpc_worker_claim_km_v2') return { data: true, error: null };
    if (name === 'rpc_worker_release_km_v2') {
      releases += 1;
      throw new Error('supabase not responding');
    }
    throw new Error('Unexpected RPC ' + name);
  } };
  await assert.rejects(runOwnedBackgroundJob(client, 'end_day_km', async () => 'posted',
    { logger: quiet, releaseRetryDelaysMs: [0, 1, 2], wait: noWait }),
  error => error.code === 'worker_completion_uncertain');
  assert.equal(releases, 3);
});

test('legacy non-KM workers keep original V1 RPCs', async () => {
  const calls = [];
  const client = { async rpc(name) {
    calls.push(name);
    return { data: true, error: null };
  } };
  const result = await runOwnedBackgroundJob(client, 'gps_summary', async () => 'ok',
    { logger: quiet, releaseRetryDelaysMs: [0], wait: noWait });
  assert.equal(result.value, 'ok');
  assert.deepEqual(calls, ['rpc_worker_claim_v1', 'rpc_worker_release_v1']);
});

test('KM claim held elsewhere does not process or release the job', async () => {
  const calls = [];
  const client = { async rpc(name) {
    calls.push(name);
    return { data: false, error: null };
  } };
  const result = await runOwnedBackgroundJob(client, 'end_day_km', async () => {
    throw new Error('Never run work without ownership.');
  }, { logger: quiet });
  assert.deepEqual(result, { ran: false, reason: 'standby_or_busy' });
  assert.deepEqual(calls, ['rpc_worker_claim_km_v2']);
});

test('V2 DB migration restricts reclaim to expired same-epoch KM claims and service role', async () => {
  const { readFileSync } = await import('node:fs');
  const sql = readFileSync(new URL('../../supabase/pending_review/20261116_km_worker_expiring_lease_v2.sql', import.meta.url),'utf8');
  assert.match(sql, /lease_until<=clock_timestamp\(\)/);
  assert.match(sql, /claimed_epoch=v_epoch/);
  assert.match(sql, /lease_until>clock_timestamp\(\)/);
  assert.match(sql, /rpc_worker_release_km_v2/);
  assert.match(sql, /coalesce\(auth\.role\(\),''\) <> 'service_role'/);
  assert.match(sql, /revoke all on function/);
  assert.match(sql, /grant execute on function/);
});
