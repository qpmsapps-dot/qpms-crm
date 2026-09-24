import test from 'node:test';
import assert from 'node:assert/strict';
import { addCallUpdate, applyPreSalesLeadScope, validateCallUpdate } from '../services/preSalesService.js';

const future = () => new Date(Date.now() + 86_400_000).toISOString();

test('RNR, call back, and future follow-up require a future scheduled action', () => {
  for (const feedback_type of ['rnr', 'call_back', 'future_followup']) {
    assert.throws(() => validateCallUpdate({ feedback_type, notes: 'Client response', followup_at: '' }), /required/i);
    const value = validateCallUpdate({ feedback_type, notes: 'Client response', followup_at: future() });
    assert.equal(value.feedback_type, feedback_type);
    assert.ok(value.followup_at);
  }
});

test('no requirement accepts an optional revisit while invalid requires meaningful notes', () => {
  assert.equal(validateCallUpdate({ feedback_type: 'no_requirement', notes: 'No current requirement' }).followup_at, null);
  assert.ok(validateCallUpdate({ feedback_type: 'no_requirement', notes: 'Renewal next quarter', followup_at: future() }).followup_at);
  assert.throws(() => validateCallUpdate({ feedback_type: 'invalid_lead', notes: 'x' }), /reason/i);
});

test('interested meeting flow validates meeting date and mode', () => {
  assert.throws(() => validateCallUpdate({ feedback_type: 'interested', notes: 'Interested', meeting_required: true }), /meeting date/i);
  const result = validateCallUpdate({ feedback_type: 'interested', notes: 'Interested', meeting_required: true, meeting: { scheduled_at: future(), meeting_mode: 'video', location_or_link: 'https://example.com' } });
  assert.equal(result.meeting.meeting_mode, 'video');
});

test('call update uses one atomic database RPC after authorization', async () => {
  const calls = [];
  const lead = { id: 'lead-1', status: 'Active', pre_sales_owner_profile_id: 'actor-1' };
  const client = {
    from(table) {
      assert.equal(table, 'leads');
      return { select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: lead, error: null }) }) }) };
    },
    async rpc(name, payload) { calls.push({ name, payload }); return { data: { lead }, error: null }; },
  };
  const actor = { role: 'Admin', profileId: 'actor-1', name: 'Admin' };
  await addCallUpdate(client, actor, lead.id, { feedback_type: 'call_back', notes: 'Call tomorrow', followup_at: future() });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].name, 'rpc_add_pre_sales_call_update');
  assert.equal(calls[0].payload.p_payload.pre_sales_stage, 'follow_up');
});

test('executive scoping is applied at query level rather than browser filtering', () => {
  const operations = [];
  const query = { or(value) { operations.push(['or', value]); return this; }, eq(...args) { operations.push(['eq', ...args]); return this; } };
  applyPreSalesLeadScope(query, { role: 'Pre-Sales Executive', profileId: 'profile-1', authUserId: 'auth-1', email: 'user@example.com' });
  assert.equal(operations[0][0], 'or');
  assert.match(operations[0][1], /pre_sales_owner_profile_id/);
});

test('Pre-Sales Manager hierarchy scope fails closed when profile scope is missing', () => {
  const operations = [];
  const query = { or(value) { operations.push(['or', value]); return this; }, eq(...args) { operations.push(['eq', ...args]); return this; } };
  applyPreSalesLeadScope(query, { role: 'Pre-Sales Manager', profileId: 'manager-1' });
  assert.deepEqual(operations[0], ['eq', 'id', '00000000-0000-0000-0000-000000000000']);
});
