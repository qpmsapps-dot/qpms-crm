import test from 'node:test';
import assert from 'node:assert/strict';
import {
  BUSINESS_DEVELOPMENT_CAPABILITIES,
  BUSINESS_DEVELOPMENT_PROFILE_ROLES,
  canonicalBusinessDevelopmentRoleLabel,
  normalizeBusinessDevelopmentCapability,
} from '../shared/businessDevelopmentRoles.js';
import { normalizeLeadRole } from '../services/leadManagementService.js';
import {
  decideHandoff,
  listBdHandoffAssignees,
} from '../services/preSalesService.js';
import {
  prepareOpportunityProposal,
  recordProposalOutcome,
  sendOpportunityProposal,
  submitBdMeetingMom,
} from '../services/opportunityWorkflowService.js';
import {
  canonicalProfileRoleForWrite,
  isAllowedProfileRole,
} from '../userManagementService.js';

const roleCases = [
  ['Business Development Head', BUSINESS_DEVELOPMENT_CAPABILITIES.HEAD, 'BD Head', 'Business Development Head'],
  ['BD Head', BUSINESS_DEVELOPMENT_CAPABILITIES.HEAD, 'BD Head', 'Business Development Head'],
  ['Business Development Executive', BUSINESS_DEVELOPMENT_CAPABILITIES.EXECUTIVE, 'BD Executive', 'Business Development Executive'],
  ['BD Executive', BUSINESS_DEVELOPMENT_CAPABILITIES.EXECUTIVE, 'BD Executive', 'Business Development Executive'],
];

test('canonical and legacy BD roles normalize into the same capability families', () => {
  for (const [role, capability, leadRole, label] of roleCases) {
    assert.equal(normalizeBusinessDevelopmentCapability(role), capability, role);
    assert.equal(normalizeLeadRole(role), leadRole, role);
    assert.equal(canonicalBusinessDevelopmentRoleLabel(role), label, role);
  }
  assert.equal(normalizeBusinessDevelopmentCapability('Finance Reviewer'), null);
});

test('User Management accepts canonical BD roles while preserving legacy stored aliases', () => {
  for (const role of BUSINESS_DEVELOPMENT_PROFILE_ROLES) {
    assert.equal(isAllowedProfileRole(role), true, role);
    assert.equal(canonicalProfileRoleForWrite(role), role, role);
  }
});

test('Pre-Sales BD assignee list includes all aliases, emits canonical labels, and excludes non-BD rows', async () => {
  const calls = [];
  const rows = [
    { id: 'bd-1', full_name: 'Canonical Executive', employee_code: 'BD1', role: 'Business Development Executive', manager_employee_code: null },
    { id: 'bd-2', full_name: 'Legacy Executive', employee_code: 'BD2', role: 'BD Executive', manager_employee_code: null },
    { id: 'bd-3', full_name: 'Canonical Head', employee_code: 'BD3', role: 'Business Development Head' },
    { id: 'bd-4', full_name: 'Legacy Head', employee_code: 'BD4', role: 'BD Head' },
    { id: 'finance-1', full_name: 'Not BD', employee_code: 'FIN1', role: 'Finance Reviewer' },
  ];
  const query = {
    select(...args) { calls.push(['select', ...args]); return this; },
    in(...args) { calls.push(['in', ...args]); return this; },
    eq(...args) { calls.push(['eq', ...args]); return this; },
    ilike(...args) { calls.push(['ilike', ...args]); return this; },
    async order(...args) { calls.push(['order', ...args]); return { data: rows, error: null }; },
  };
  const result = await listBdHandoffAssignees({ from: () => query });

  assert.deepEqual(calls.find(([method]) => method === 'in'), ['in', 'role', BUSINESS_DEVELOPMENT_PROFILE_ROLES]);
  assert.deepEqual(result.map(({ id, role }) => ({ id, role })), [
    { id: 'bd-1', role: 'Business Development Executive' },
    { id: 'bd-2', role: 'Business Development Executive' },
    { id: 'bd-3', role: 'Business Development Head' },
    { id: 'bd-4', role: 'Business Development Head' },
  ]);
});

test('assigned canonical and legacy BD actors reach existing handoff, MOM, and proposal RPCs', async () => {
  const calls = [];
  const client = {
    async rpc(name, payload) {
      calls.push({ name, payload });
      return { data: { ok: true }, error: null };
    },
  };

  await decideHandoff(client, { role: 'Business Development Executive', profileId: 'bd-1' }, 'handoff-1', 'accepted');
  await submitBdMeetingMom(client, { role: 'Business Development Head', profileId: 'bd-2' }, 'meeting-1', {
    requirement_discussed: 'Scope',
    site_survey_required: false,
  });
  await prepareOpportunityProposal(client, { role: 'BD Executive', profileId: 'bd-3' }, 'lead-1', {}, 'key-1');

  assert.deepEqual(calls.map((call) => call.name), [
    'rpc_decide_pre_sales_handoff',
    'rpc_submit_bd_meeting_mom',
    'rpc_prepare_opportunity_proposal',
  ]);
});

test('assigned BD Executive without a reporting manager can complete the full BD workflow', async () => {
  const calls = [];
  const client = {
    async rpc(name, payload) {
      calls.push({ name, payload });
      return { data: { ok: true }, error: null };
    },
  };
  const actor = {
    role: 'BD Executive',
    profileId: 'bd-without-manager',
    manager_employee_code: null,
  };

  await decideHandoff(client, actor, 'handoff-1', 'accepted');
  await decideHandoff(client, actor, 'handoff-2', 'rejected', { rejection_reason: 'UAT rejection' });
  await submitBdMeetingMom(client, actor, 'meeting-1', {
    requirement_discussed: 'Scope',
    site_survey_required: true,
    preferred_survey_date: '2026-10-01',
  });
  await prepareOpportunityProposal(client, actor, 'lead-1', {}, 'prepare-key');
  await sendOpportunityProposal(client, actor, 'proposal-1', 'send-key');
  await recordProposalOutcome(client, actor, 'proposal-1', { outcome: 'Converted' }, 'outcome-key');
  await recordProposalOutcome(client, actor, 'proposal-2', { outcome: 'Lost', reason: 'Client declined' }, 'lost-key');

  assert.deepEqual(calls.map((call) => call.name), [
    'rpc_decide_pre_sales_handoff',
    'rpc_decide_pre_sales_handoff',
    'rpc_submit_bd_meeting_mom',
    'rpc_prepare_opportunity_proposal',
    'rpc_send_opportunity_proposal',
    'rpc_record_proposal_outcome',
    'rpc_record_proposal_outcome',
  ]);
  assert.ok(calls.every((call) => call.payload.p_actor_profile_id === actor.profileId));
});

test('canonical BD actor receives a controlled denial when the atomic RPC rejects assignment', async () => {
  const client = { async rpc() { return { data: null, error: { code: '42501', message: 'handoff_actor_not_authorized' } }; } };
  await assert.rejects(
    decideHandoff(client, { role: 'Business Development Executive', profileId: 'unassigned-bd' }, 'handoff-1', 'accepted'),
    (error) => error.statusCode === 403 && error.code === 'handoff_decision_denied',
  );
});
