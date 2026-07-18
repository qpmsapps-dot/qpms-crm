import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const sql = fs.readFileSync(new URL('../../supabase/migrations_2_0/023_hospital_ticket_uat_readiness.sql', import.meta.url), 'utf8');
const provisioner = fs.readFileSync(new URL('../scripts/provisionHospitalUatUsers.js', import.meta.url), 'utf8');

test('reopen gets a fresh scoped Supervisor SLA without deleting history', () => {
  assert.match(sql, /old\.status_code='resolved_awaiting_confirmation'[\s\S]*new\.status_code='reopened'/);
  assert.match(sql, /new\.supervisor_sla_due_at := case[\s\S]*now\(\)\+interval '20 minutes'/);
  assert.match(sql, /reopened_sla_restarted/);
  assert.doesNotMatch(sql, /delete from public\.hospital_ticket_(events|comments|attachments)/);
  assert.match(sql, /new\.reopen_count/);
});

test('reopened tickets use the new due time in server SLA processing', () => {
  assert.match(sql, /status_code in \('open','assigned','accepted','in_progress','reopened'\)/);
  assert.match(sql, /supervisor_sla_due_at is not null and supervisor_sla_due_at<=p_now/);
  assert.match(sql, /sla_cycle/);
});

test('missing assignments are explicit, alerted once, and stop retrying', () => {
  assert.match(sql, /ticket_unassigned/);
  assert.match(sql, /operations_assignment_missing/);
  assert.match(sql, /facility_manager_assignment_missing/);
  assert.match(sql, /ux_hospital_ticket_assignment_alert/);
  assert.match(sql, /supervisor_sla_due_at=null/);
  assert.match(sql, /operations_sla_due_at=null/);
  assert.match(sql, /rpc_record_hospital_assignment_failure/);
  assert.match(sql, /p_expected_version/);
});

test('provisioning defaults to dry-run and never logs secrets', () => {
  assert.match(provisioner, /const apply = process\.argv\.includes\('--apply'\)/);
  assert.match(provisioner, /const dryRun = !apply/);
  assert.match(provisioner, /HOSPITAL_UAT_PRODUCTION_CONFIRM/);
  assert.doesNotMatch(provisioner, /console\.log\([^\n]*(password|serviceKey)/i);
});
