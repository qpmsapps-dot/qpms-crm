import assert from 'node:assert/strict';
import test from 'node:test';

import { KM_ENGINE_VERSION } from '../services/foCanonicalKmEngineV2.js';
import {
  KM_V2_PERSISTENCE_RPC,
  getKmV2FinancialWriteState,
  persistCanonicalKmV2,
} from '../services/foKmV2PersistenceService.js';

const calculation = {
  calculationVersion: KM_ENGINE_VERSION,
  inputDigest: 'a'.repeat(64),
  canonicalLegs: [],
};

test('persistence uses exactly one transactional RPC', async () => {
  const calls = [];
  const client = {
    rpc: async (name, args) => {
      calls.push({ name, args });
      return { data: { ok: true, calculation_run_id: 'run-1' }, error: null };
    },
  };
  const result = await persistCanonicalKmV2(client, {
    attendanceId: 'attendance-1',
    expectedAttendanceUpdatedAt: '2026-09-30T12:00:00Z',
    calculation,
    sourceEntryPoint: 'end_day',
    actorSource: 'backend',
  });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].name, KM_V2_PERSISTENCE_RPC);
  assert.equal(calls[0].args.p_input_digest, calculation.inputDigest);
  assert.equal(result.calculation_run_id, 'run-1');
});

test('concurrent callers remain separate RPC transactions for database lock serialization', async () => {
  let calls = 0;
  const client = {
    rpc: async () => {
      calls += 1;
      return { data: { ok: true, idempotent_replay: calls > 1 }, error: null };
    },
  };
  await Promise.all(Array.from({ length: 10 }, () => persistCanonicalKmV2(client, {
    attendanceId: 'attendance-1',
    expectedAttendanceUpdatedAt: '2026-09-30T12:00:00Z',
    calculation,
    sourceEntryPoint: 'scheduler',
  })));
  assert.equal(calls, 10);
});

test('stale digest/row-lock conflict fails closed', async () => {
  const client = {
    rpc: async () => ({ data: null, error: { code: '40001', message: 'km_v2_stale_input_digest' } }),
  };
  await assert.rejects(
    persistCanonicalKmV2(client, {
      attendanceId: 'attendance-1',
      expectedAttendanceUpdatedAt: '2026-09-30T12:00:00Z',
      calculation,
      sourceEntryPoint: 'manual_refresh',
    }),
    (error) => error.code === '40001' && error.statusCode === 409,
  );
});

test('failed RPC exposes no partial-success result', async () => {
  const client = { rpc: async () => ({ data: { partial: true }, error: { code: 'XX000', message: 'rollback' } }) };
  await assert.rejects(persistCanonicalKmV2(client, {
    attendanceId: 'attendance-1',
    expectedAttendanceUpdatedAt: '2026-09-30T12:00:00Z',
    calculation,
    sourceEntryPoint: 'end_day',
  }), /rollback/);
});

test('maintenance mode blocks persistence before the transactional RPC is called', async () => {
  let calls = 0;
  const client = { rpc: async () => { calls += 1; return { data: {}, error: null }; } };
  await assert.rejects(
    persistCanonicalKmV2(client, {
      attendanceId: 'attendance-1',
      expectedAttendanceUpdatedAt: '2026-09-30T12:00:00Z',
      calculation,
      sourceEntryPoint: 'end_day',
      environment: { KM_FINANCIAL_WRITES_MAINTENANCE: 'true' },
    }),
    (error) => error.code === 'KM_FINANCIAL_WRITES_MAINTENANCE' && error.statusCode === 503,
  );
  assert.equal(calls, 0);
});

test('database financial state lookup fails closed when the guard RPC is unavailable', async () => {
  const state = await getKmV2FinancialWriteState({
    rpc: async () => ({ data: null, error: { code: 'PGRST202' } }),
  });
  assert.equal(state.financial_writes_enabled, false);
  assert.equal(state.reason, 'database_financial_gate_unavailable');
  assert.equal(state.error_code, 'PGRST202');
});

test('database financial state lookup fails closed on an invalid response', async () => {
  const state = await getKmV2FinancialWriteState({
    rpc: async () => ({ data: null, error: null }),
  });
  assert.deepEqual(state, {
    financial_writes_enabled: false,
    reason: 'database_financial_gate_invalid_response',
  });
});
