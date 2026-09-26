import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const migrationPath = fileURLToPath(new URL('../../supabase/migrations_2_0/107_opportunity_meeting_handoff_site_survey_bridge.sql', import.meta.url));
const sql = readFileSync(migrationPath, 'utf8');
const compact = sql.replace(/\s+/g, ' ').trim().toLowerCase();

test('migration 107 is transactional and does not modify prior migration files', () => {
  assert.match(compact, /^-- .* begin;/);
  assert.match(compact, /commit;$/);
  assert.doesNotMatch(compact, /\bdelete\s+from\b/);
  assert.doesNotMatch(compact, /\btruncate\b/);
});

test('meeting and pending BD handoff are one idempotent locked transition', () => {
  assert.match(compact, /rpc_schedule_pre_sales_meeting_handoff/);
  assert.match(compact, /from public\.leads where id = p_lead_id for update/);
  assert.match(compact, /ux_lead_meetings_idempotency_key/);
  assert.match(compact, /ux_lead_handoffs_idempotency_key/);
  assert.match(compact, /handoff_status.*'pending'/);
  assert.match(compact, /role in \('bd executive', 'bd head'\)/);
  assert.match(compact, /pre_sales_owner_profile_id is distinct from p_actor_profile_id/);
  assert.match(compact, /'meeting scheduled and bd handover created'/);
});

test('BD MOM is meeting-linked, duplicate-safe, and controls Site Survey creation', () => {
  assert.match(compact, /ux_lead_mom_meeting/);
  assert.match(compact, /mom_already_exists_for_another_meeting/);
  assert.match(compact, /meeting_not_owned_by_actor/);
  assert.match(compact, /site_survey_required/);
  assert.match(compact, /source_meeting_id/);
  assert.match(compact, /source_lead_mom_id/);
});

test('Branch Head routing uses lead State only and fails closed', () => {
  assert.match(compact, /opportunity_state_key\(p\.state\) = public\.opportunity_state_key\(v_lead\.state\)/);
  assert.doesNotMatch(compact, /opportunity_business_key/);
  assert.match(compact, /branch_head_unresolved/);
  assert.match(compact, /branch_head_ambiguous/);
  assert.match(compact, /routing review required/);
  assert.doesNotMatch(compact, /limit 1;.*v_branch_count > 1/s);
});

test('Branch Head may assign only an active, State-compatible direct-report Operations Manager', () => {
  assert.match(compact, /rpc_assign_site_survey_operations_manager/);
  assert.match(compact, /p\.role = 'operations manager'/);
  assert.match(compact, /eh\.manager_employee_code = v_branch\.employee_code/);
  assert.match(compact, /opportunity_state_key\(p\.state\).*opportunity_state_key\(v_visit\.owner_state\)/);
  assert.doesNotMatch(compact, /opportunity_business_key/);
  assert.match(compact, /operations_manager_outside_branch_hierarchy/);
  assert.match(compact, /operations_manager_already_assigned/);
});

test('existing Site Visit engine is extended only for the assigned Operations Manager', () => {
  assert.match(compact, /v_record\.assigned_profile_id = v_actor\.profile_id/);
  assert.match(compact, /v_actor\.role_key = 'operations'.*v_assessment\.assigned_profile_id = v_actor\.profile_id.*v_assessment\.current_stage = 'bd_survey'/s);
  assert.match(compact, /rpc_save_assessment_section/);
  assert.match(compact, /rpc_submit_for_review/);
  assert.match(compact, /site_workflow_actor_can_edit\(v_assessment\.id\)/);
  assert.match(compact, /'operations_review'/);
});

test('Proposal Sent remains pending and final outcome is explicit and duplicate-safe', () => {
  assert.match(compact, /rpc_prepare_opportunity_proposal/);
  assert.match(compact, /rpc_send_opportunity_proposal/);
  assert.match(compact, /alter column workflow_instance_id drop not null/);
  assert.match(compact, /alter column site_visit_id drop not null/);
  assert.match(compact, /alter column assessment_id drop not null/);
  assert.match(compact, /site_survey_required is true.*current_stage_code <> 'returned_to_bd'/s);
  assert.match(compact, /'source'.*'site_survey_workflow'.*'bd_no_survey'/s);
  assert.doesNotMatch(compact, /v_mom\.site_survey_required is false[\s\S]{0,500}insert into public\.site_visits/);
  assert.match(compact, /approval_status = 'client decision pending'/);
  assert.match(compact, /pending_role = 'client decision'/);
  assert.match(compact, /rpc_record_proposal_outcome/);
  assert.match(compact, /v_outcome not in \('converted', 'lost'\)/);
  assert.match(compact, /v_outcome = 'lost'.*loss reason is required/s);
  assert.match(compact, /proposal outcome has already been recorded/);
  assert.match(compact, /status = v_outcome, lead_stage = v_outcome/);
});

test('opportunity notifications are isolated, deduplicated, and best effort', () => {
  assert.match(compact, /create table if not exists public\.opportunity_notifications/);
  assert.match(compact, /dedupe_key text not null unique/);
  assert.match(compact, /exception when others then.*raise warning 'opportunity notification skipped/s);
  for (const type of [
    'bd_handoff_assigned', 'bd_handoff_accepted', 'bd_handoff_rejected',
    'site_survey_routed', 'site_survey_assigned', 'opportunity_returned_to_bd',
    'proposal_sent', 'opportunity_final_outcome',
  ]) assert.match(compact, new RegExp(type));
  assert.doesNotMatch(compact, /hospital_ticket_notifications/);
});

test('new backend-only transition RPCs are not executable by browser roles', () => {
  for (const signature of [
    'rpc_schedule_pre_sales_meeting_handoff(uuid,uuid,uuid,jsonb,text)',
    'rpc_submit_bd_meeting_mom(uuid,uuid,jsonb)',
    'rpc_assign_site_survey_operations_manager(uuid,uuid,uuid)',
    'rpc_prepare_opportunity_proposal(uuid,uuid,jsonb,text)',
    'rpc_send_opportunity_proposal(uuid,uuid,text)',
    'rpc_record_proposal_outcome(uuid,uuid,text,text,text)',
  ]) {
    assert.ok(compact.includes(`revoke all on function public.${signature} from public, anon, authenticated`));
    assert.ok(compact.includes(`grant execute on function public.${signature} to service_role`));
  }
});
