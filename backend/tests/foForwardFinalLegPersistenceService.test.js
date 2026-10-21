import assert from 'node:assert/strict';
import test from 'node:test';

import {
  FORWARD_FINAL_LEG_PERSISTENCE_RPC,
  persistForwardFinalLeg,
} from '../services/foForwardFinalLegPersistenceService.js';

const DIGEST = 'a'.repeat(64);

test('forward final-leg persistence uses the guarded RPC and returns run evidence', async () => {
  let call;
  const client = {
    async rpc(name, args) {
      call = { name, args };
      return {
        data: {
          ok: true,
          calculation_run_id: '11111111-1111-4111-8111-111111111111',
          route_sync_status: 'canonical_v2_persisted',
          input_digest: DIGEST,
        },
        error: null,
      };
    },
  };

  const result = await persistForwardFinalLeg(client, {
    attendanceId: '22222222-2222-4222-8222-222222222222',
    expectedAttendanceUpdatedAt: '2026-10-16T14:00:00.000Z',
    calculation: { calculationVersion: 'KM_ENGINE_V2', inputDigest: DIGEST },
    sourceEntryPoint: 'end_day_auto_recalculation',
    actorSource: 'scheduler',
  });

  assert.equal(call.name, FORWARD_FINAL_LEG_PERSISTENCE_RPC);
  assert.equal(call.args.p_input_digest, DIGEST);
  assert.equal(call.args.p_source_entry_point, 'end_day_auto_recalculation');
  assert.equal(result.route_sync_status, 'canonical_v2_persisted');
});

test('forward final-leg persistence rejects invalid calculation evidence before RPC', async () => {
  await assert.rejects(
    persistForwardFinalLeg({ rpc: async () => ({ data: null, error: null }) }, {
      attendanceId: '22222222-2222-4222-8222-222222222222',
      expectedAttendanceUpdatedAt: '2026-10-16T14:00:00.000Z',
      calculation: { calculationVersion: 'KM_ENGINE_V2', inputDigest: 'bad' },
    }),
    (error) => error.code === 'forward_final_leg_persistence_input_invalid' && error.retryable === false,
  );
});

test('protected database outcomes are not retried as transient failures', async () => {
  const client = {
    async rpc() {
      return {
        data: null,
        error: { code: '55000', message: 'forward_final_leg_financial_state_protected' },
      };
    },
  };
  await assert.rejects(
    persistForwardFinalLeg(client, {
      attendanceId: '22222222-2222-4222-8222-222222222222',
      expectedAttendanceUpdatedAt: '2026-10-16T14:00:00.000Z',
      calculation: { calculationVersion: 'KM_ENGINE_V2', inputDigest: DIGEST },
      sourceEntryPoint: 'web_refresh_km',
    }),
    (error) => error.code === 'forward_final_leg_financial_state_protected' && error.retryable === false,
  );
});
