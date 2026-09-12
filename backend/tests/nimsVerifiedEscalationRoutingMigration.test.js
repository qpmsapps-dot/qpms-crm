import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

const migration = readFileSync(
  new URL('../../supabase/migrations_2_0/071_nims_verified_escalation_routing.sql', import.meta.url),
  'utf8',
);

const NIMS_CLIENT_ID = 'bfb5d707-1a4e-451d-af1f-11b7c0aeeb66';
const REAL_SUPERVISORS = [
  '34b2efc3-0a28-44fc-85d4-88115227dbed',
  '67756352-98cb-4b60-955d-d0aa9abd384b',
  '40ec4df4-9bec-4b3a-8c6e-41559bfcea5d',
  'f3ba0678-468a-4b7a-bd65-8605a6c96015',
  '1c538cd0-4ba8-406f-b916-1003b6ad6339',
  '04806a4d-6a8e-4018-86dd-b3ec1d924658',
  'acad77d9-16d2-47fc-b1b8-91f16580f21b',
  'f2e46f67-98b6-41bb-9c72-a6f0a6c707d7',
  'cf391383-37d7-4346-aa58-1fcdac7f77e1',
  '597d69ce-cf2f-441d-ad28-fd2aee8d366a',
];

test('migration is transactional and targets the canonical NIMS client', () => {
  assert.match(migration, /^begin;/i);
  assert.match(migration, /commit;\s*$/i);
  assert.match(migration, new RegExp(NIMS_CLIENT_ID, 'g'));
  assert.match(migration, /client_code = 'NIMS_HYDERABAD'/);
});

test('all confirmed production users are explicit and no historical row is deleted', () => {
  for (const id of REAL_SUPERVISORS) assert.match(migration, new RegExp(id, 'g'));
  assert.match(migration, /ecea828c-c419-47b1-a962-e7c0e5fff19e/g);
  assert.match(migration, /db983e24-31fc-4c77-baf4-95068643476f/g);
  assert.doesNotMatch(migration, /delete\s+from\s+public\.hospital_ticket_users/i);
  assert.doesNotMatch(migration, /update\s+public\.hospital_tickets/i);
});

test('test and demo users are excluded without deactivating their accounts', () => {
  for (const id of [
    '84ef6e42-caa2-426b-af88-a5096a7fc2a2',
    'e2407733-42ce-49a5-bb85-5f2db2696639',
    'e2e8522f-6d84-43f3-80c0-eeb137a41eec',
    '5d956b83-4d41-4474-ac7d-d6b86682f582',
    '42713526-f625-404f-8c92-da9062c706ab',
  ]) assert.match(migration, new RegExp(id));
  assert.match(migration, /'production_routing_eligible', false/);
  assert.match(migration, /metadata->>'test_user'/);
  assert.match(migration, /metadata->>'demo'/);
  assert.match(migration, /metadata->>'do_not_use_for_real_staff'/);
  assert.doesNotMatch(migration, /set\s+is_active\s*=\s*false/i);
});

test('NIMS owner selection requires exactly one verified client-wide candidate', () => {
  assert.match(migration, /v_candidate_count <> 1/);
  assert.match(migration, /scope_type = 'client'/);
  assert.match(migration, /s\.can_update = true/);
  assert.match(migration, /return null;/);
  const nimsBranch = migration.slice(migration.indexOf("if p_client_id = 'bfb5d707"));
  assert.doesNotMatch(nimsBranch.split('end if;')[0], /order by u\.created_at/i);
});

test('picker selects Koduri and Alli and fails closed for Project Head', () => {
  assert.match(migration, /operations_executive[\s\S]*ecea828c-c419-47b1-a962-e7c0e5fff19e/);
  assert.match(migration, /facility_manager[\s\S]*db983e24-31fc-4c77-baf4-95068643476f/);
  assert.match(migration, /'project_head'[\s\S]*if v_owner\.id is not null/);
});

test('Supervisor and legacy management alerts share production eligibility filtering', () => {
  assert.match(migration, /create or replace function public\.hospital_ticket_is_on_duty_supervisor/);
  assert.match(migration, /create or replace function public\.hospital_ticket_on_duty_supervisors/);
  assert.match(migration, /create or replace function public\.hospital_ticket_assignment_events/);
  assert.match(migration, /public\.hospital_ticket_is_production_routing_eligible\(u\)/g);
  assert.match(migration, /must configure exactly ten production-eligible NIMS Supervisors/);
});

test('migration leaves role order, SLA functions, and authorization untouched', () => {
  assert.doesNotMatch(migration, /create or replace function public\.hospital_ticket_role_for_level/);
  assert.doesNotMatch(migration, /create or replace function public\.hospital_ticket_sla_minutes_for_client/);
  assert.doesNotMatch(migration, /hospital_ticket_auth/i);
  assert.doesNotMatch(migration, /canViewHospitalTicket/);
});
