import test from 'node:test';
import assert from 'node:assert/strict';
import { applyPreSalesLeadScope, decideHandoff, preSalesLeadPermissions } from '../services/preSalesService.js';
import { canViewLead, normalizeLeadRole } from '../services/leadManagementService.js';
import { canonicalProfileRoleForWrite } from '../userManagementService.js';

test('User Management accepts canonical Pre-Sales and preserves legacy aliases', () => {
  assert.equal(canonicalProfileRoleForWrite('Pre-Sales'), 'Pre-Sales');
  assert.equal(canonicalProfileRoleForWrite('Pre-Sales Executive'), 'Pre-Sales Executive');
  assert.equal(canonicalProfileRoleForWrite('Pre-Sales Manager'), 'Pre-Sales Manager');
});

for (const alias of ['Pre-Sales', 'Pre-Sales Executive', 'Pre-Sales Manager']) {
  test(`${alias} normalizes to canonical Pre-Sales`, () => assert.equal(normalizeLeadRole(alias), 'Pre-Sales'));
}

test('all Pre-Sales aliases scope to creator/owner and never to team hierarchy', () => {
  for (const role of ['Pre-Sales', 'Pre-Sales Executive', 'Pre-Sales Manager']) {
    const operations = [];
    const query = { or(value) { operations.push(value); return this; }, eq() { throw new Error('unexpected hierarchy scope'); } };
    applyPreSalesLeadScope(query, { role, profileId: 'profile-1', authUserId: 'auth-1' });
    assert.match(operations[0], /pre_sales_owner_profile_id\.eq\.profile-1/);
    assert.match(operations[0], /created_by_user_id\.eq\.auth-1/);
  }
});

test('canonical Pre-Sales can view an associated lead but not an unrelated lead', () => {
  const actor = { role: 'Pre-Sales', profileId: 'profile-1', authUserId: 'auth-1', email: 'one@example.com' };
  assert.equal(canViewLead(actor, { pre_sales_owner_profile_id: 'profile-1' }), true);
  assert.equal(canViewLead(actor, { pre_sales_owner_profile_id: 'profile-2', created_by_user_id: 'auth-2' }), false);
});

function postHandoverClient({ accepted = false, visit = false, workflow = false } = {}) {
  return {
    from(table) {
      return {
        select() { return this; }, eq() { return this; }, order() { return this; },
        async limit() {
          const exists = table === 'lead_handoffs' ? accepted : table === 'site_visits' ? visit : workflow;
          return { data: exists ? [{ id: `${table}-1` }] : [], error: null };
        },
      };
    },
  };
}

test('Pre-Sales capabilities change from action to read-only after authoritative handover marker', async () => {
  const actor = { role: 'Pre-Sales Manager', profileId: 'profile-1', authUserId: 'auth-1' };
  const lead = { id: 'lead-1', status: 'Qualified', pre_sales_stage: 'pending_bd_handover', pre_sales_owner_profile_id: 'profile-1' };
  const before = await preSalesLeadPermissions(postHandoverClient(), actor, lead);
  assert.equal(before.access_mode, 'action');
  assert.equal(before.can_edit_pre_sales, true);
  assert.equal(before.can_handover, true);
  const after = await preSalesLeadPermissions(postHandoverClient({ workflow: true }), actor, lead);
  assert.equal(after.access_mode, 'read_only');
  assert.equal(after.can_view, true);
  assert.equal(after.can_edit_pre_sales, false);
  assert.equal(after.can_add_call_update, false);
  assert.equal(after.can_manage_followups, false);
  assert.equal(after.can_manage_meetings, false);
  assert.equal(after.can_handover, false);
  assert.equal(after.can_mutate_downstream, false);
});

test('BD handoff decision uses the atomic service-role RPC', async () => {
  const calls = [];
  const client = { async rpc(name, payload) { calls.push({ name, payload }); return { data: { status: 'accepted' }, error: null }; } };
  const result = await decideHandoff(client, { role: 'BD Executive', profileId: 'bd-1' }, 'handoff-1', 'accepted');
  assert.equal(result.status, 'accepted');
  assert.deepEqual(calls[0], { name: 'rpc_decide_pre_sales_handoff', payload: { p_handoff_id: 'handoff-1', p_actor_profile_id: 'bd-1', p_decision: 'accepted', p_rejection_reason: null } });
});
