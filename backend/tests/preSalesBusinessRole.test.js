import test from 'node:test';
import assert from 'node:assert/strict';
import { applyPreSalesLeadScope, decideHandoff, preSalesLeadPermissions } from '../services/preSalesService.js';
import { canViewLead, leadMatchesActorWorkMapping, normalizeLeadRole } from '../services/leadManagementService.js';
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
    applyPreSalesLeadScope(query, { role, profileId: 'profile-1', authUserId: 'auth-1', state: 'All States', business: 'All Businesses' });
    assert.match(operations[0], /pre_sales_owner_profile_id\.eq\.profile-1/);
    assert.match(operations[0], /created_by_user_id\.eq\.auth-1/);
  }
});

test('canonical Pre-Sales can view an associated lead but not an unrelated lead', () => {
  const actor = { role: 'Pre-Sales', profileId: 'profile-1', authUserId: 'auth-1', email: 'one@example.com', state: 'All States', business: 'All Businesses' };
  assert.equal(canViewLead(actor, { pre_sales_owner_profile_id: 'profile-1', state: 'TN', business: 'Standalone' }), true);
  assert.equal(canViewLead(actor, { pre_sales_owner_profile_id: 'profile-2', created_by_user_id: 'auth-2', state: 'TN', business: 'Standalone' }), false);
});

function scopedQueryOperations(actor) {
  const operations = [];
  const query = {
    or(value) { operations.push(['or', value]); return this; },
    eq(...args) { operations.push(['eq', ...args]); return this; },
    in(...args) { operations.push(['in', ...args]); return this; },
  };
  applyPreSalesLeadScope(query, actor);
  return operations;
}

test('Pre-Sales work mapping combines ownership with independent state and business predicates', () => {
  const base = { role: 'Pre-Sales', profileId: 'profile-1', authUserId: 'auth-1' };
  const specific = scopedQueryOperations({ ...base, state: 'TN', business: 'Reliance Retail' });
  assert.deepEqual(specific[0][0], 'or');
  assert.deepEqual(specific[1], ['in', 'state', ['TN', 'Tamil Nadu']]);
  assert.deepEqual(specific[2], ['eq', 'business', 'Reliance Retail']);

  const allBusinesses = scopedQueryOperations({ ...base, state: 'TN', business: 'All Businesses' });
  assert.equal(allBusinesses.some((operation) => operation[1] === 'business'), false);
  assert.equal(allBusinesses.some((operation) => operation[1] === 'state'), true);

  const allStates = scopedQueryOperations({ ...base, state: 'All States', business: 'Reliance Retail' });
  assert.equal(allStates.some((operation) => operation[1] === 'state'), false);
  assert.deepEqual(allStates.at(-1), ['eq', 'business', 'Reliance Retail']);

  const all = scopedQueryOperations({ ...base, state: 'All States', business: 'All Businesses' });
  assert.deepEqual(all.map((operation) => operation[0]), ['or']);
  assert.doesNotMatch(all[0][1], /assigned_bd_email/);
});

test('Pre-Sales work mapping never bypasses creator or owner association', () => {
  const actor = { role: 'Pre-Sales', profileId: 'profile-1', authUserId: 'auth-1', state: 'All States', business: 'All Businesses' };
  assert.equal(canViewLead(actor, { created_by_user_id: 'auth-1', state: 'KA', business: 'Standalone' }), true);
  assert.equal(canViewLead(actor, { pre_sales_owner_profile_id: 'profile-1', state: 'Kerala', business: 'Private Clients' }), true);
  assert.equal(canViewLead(actor, { created_by_user_id: 'other-auth', pre_sales_owner_profile_id: 'profile-2', state: 'TN', business: 'Reliance Retail' }), false);
});

test('specific Pre-Sales state and business mappings remain restrictive', () => {
  const actor = { role: 'Pre-Sales', profileId: 'profile-1', authUserId: 'auth-1', state: 'TN', business: 'Reliance Retail' };
  const associated = { created_by_user_id: 'auth-1' };
  assert.equal(canViewLead(actor, { ...associated, state: 'Tamil Nadu', business: 'Reliance Retail' }), true);
  assert.equal(canViewLead(actor, { ...associated, state: 'KA', business: 'Reliance Retail' }), false);
  assert.equal(canViewLead(actor, { ...associated, state: 'TN', business: 'Standalone' }), false);
  assert.equal(leadMatchesActorWorkMapping(actor, { state: 'KA', business: 'Reliance Retail' }), false);
});

test('Branch Head All Businesses keeps state and branch hierarchy restrictions', () => {
  const operations = scopedQueryOperations({ role: 'Branch Head', state: 'TN', business: 'All Businesses', branch: 'Chennai' });
  assert.equal(operations.some((operation) => operation[1] === 'state'), true);
  assert.deepEqual(operations.find((operation) => operation[1] === 'branch'), ['eq', 'branch', 'Chennai']);
  assert.equal(operations.some((operation) => operation[1] === 'business'), false);
});

test('All States cannot erase the only encoded Branch Head hierarchy boundary', () => {
  const operations = scopedQueryOperations({ role: 'Branch Head', state: 'All States', business: 'All Businesses', branch: '' });
  assert.deepEqual(operations, [['eq', 'id', '00000000-0000-0000-0000-000000000000']]);
});

test('Admin lead visibility remains unchanged by work mapping values', () => {
  const operations = scopedQueryOperations({ role: 'Admin', state: 'All States', business: 'All Businesses' });
  assert.deepEqual(operations, []);
  assert.equal(canViewLead({ role: 'Admin' }, { state: 'TN', business: 'Standalone' }), true);
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
  const actor = { role: 'Pre-Sales Manager', profileId: 'profile-1', authUserId: 'auth-1', state: 'All States', business: 'All Businesses' };
  const lead = { id: 'lead-1', status: 'Qualified', pre_sales_stage: 'pending_bd_handover', pre_sales_owner_profile_id: 'profile-1', state: 'TN', business: 'Standalone' };
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
