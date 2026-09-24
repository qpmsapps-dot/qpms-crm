import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import { safeHospitalError } from '../services/hospitalTicketWorkflowService.js';

const migration103 = readFileSync(
  new URL('../../supabase/migrations_2_0/103_nims_ticket_visibility_operational_acceptance.sql', import.meta.url),
  'utf8',
);
const migration104 = readFileSync(
  new URL('../../supabase/migrations_2_0/104_fix_hospital_operational_acceptance_history_contract.sql', import.meta.url),
  'utf8',
);

function captureHospitalError(error) {
  const result = { status: null, body: null };
  const response = {
    status(value) {
      result.status = value;
      return this;
    },
    json(value) {
      result.body = value;
      return this;
    },
  };
  safeHospitalError(response, error);
  return result;
}

test('operational acceptance history values are allowed without narrowing established values', () => {
  assert.match(migration103, /'operational_owner'/);
  assert.match(migration103, /'self_acceptance'/);

  for (const assignmentType of [
    'primary',
    'backup',
    'overall_fallback',
    'operations_fallback',
    'acceptance_escalation',
    'manual_reassignment',
    'operational_owner',
  ]) {
    assert.match(migration104, new RegExp(`'${assignmentType}'`), assignmentType);
  }

  for (const source of [
    'automatic',
    'manual',
    'escalation',
    'handover',
    'takeover',
    'unassigned',
    'self_acceptance',
  ]) {
    assert.match(migration104, new RegExp(`'${source}'`), source);
  }
});

test('constraint correction changes no ticket, event, notification, or ownership data', () => {
  assert.doesNotMatch(migration104, /\b(?:insert|update|delete|truncate)\b/i);
  assert.doesNotMatch(migration104, /alter\s+table\s+public\.hospital_tickets/i);
  assert.doesNotMatch(migration104, /hospital_ticket_(?:events|notifications)/i);
  assert.match(migration104, /^begin;/m);
  assert.match(migration104, /commit;\s*$/m);
});

test('Project Head escalation and management assignee remain preserved by operational acceptance', () => {
  assert.match(migration103, /v_is_escalated := v_ticket\.status_code in[\s\S]*'escalated_project_head'/);
  assert.match(migration103, /status_code=case when v_is_escalated then status_code else 'accepted' end/);
  assert.match(migration103, /current_assignee_user_id=case when v_is_escalated then current_assignee_user_id else v_actor\.id end/);
  assert.match(migration103, /current_assignee_role=case when v_is_escalated then current_assignee_role else 'housekeeping_supervisor' end/);
  assert.match(migration103, /current_escalation_level=case when v_is_escalated then current_escalation_level else 'supervisor' end/);
  assert.match(migration103, /sla_status=case when v_is_escalated then sla_status else 'running' end/);
  assert.match(migration103, /and supervisor_user_id is null/);
});

test('known acceptance conflicts and authorization failures do not become HTTP 500', () => {
  const alreadyAccepted = captureHospitalError(Object.assign(
    new Error('Ticket has already been accepted by another Supervisor.'),
    { code: '40001' },
  ));
  assert.equal(alreadyAccepted.status, 409);
  assert.equal(alreadyAccepted.body.code, 'ticket_already_accepted');

  const versionConflict = captureHospitalError(Object.assign(
    new Error('Ticket version conflict.'),
    { code: '40001' },
  ));
  assert.equal(versionConflict.status, 409);
  assert.equal(versionConflict.body.code, 'ticket_version_conflict');

  const unauthorized = captureHospitalError(Object.assign(
    new Error('Cross-client acceptance denied.'),
    { code: '42501' },
  ));
  assert.equal(unauthorized.status, 403);
  assert.equal(unauthorized.body.code, 'hospital_access_denied');

  const unexpected = captureHospitalError(Object.assign(
    new Error('Unexpected database failure.'),
    { code: 'XX000' },
  ));
  assert.equal(unexpected.status, 500);
  assert.equal(unexpected.body.code, 'hospital_ticket_failed');
});
