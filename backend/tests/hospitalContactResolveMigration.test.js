import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

const migration = readFileSync(
  new URL('../../supabase/migrations_2_0/058_fix_contact_ticket_resolve_confirmation_notification.sql', import.meta.url),
  'utf8',
);

test('migration 058 preserves supervisor resolve but skips null authenticated-client notifications', () => {
  assert.match(migration, /create or replace function public\.rpc_hospital_ticket_action/);
  assert.match(migration, /p_action = 'resolve'/);
  assert.match(migration, /v_actor\.role_code='housekeeping_supervisor' and v_from in \('in_progress','accepted','reopened'\)/);
  assert.match(migration, /Resolution action and remarks are required\./);
  assert.match(migration, /Completion photo is required\./);
  assert.match(migration, /v_to := 'resolved_awaiting_confirmation'/);
  assert.match(migration, /event_type,\s*from_status,\s*to_status,\s*actor_name,\s*actor_role,\s*remarks\)[\s\S]*'awaiting_client_confirmation'/);
  assert.match(migration, /if v_ticket\.raised_by_user_id is not null then[\s\S]*notification_type,title,body\)[\s\S]*'awaiting_confirmation'/);
  const resolveNotificationBlock = migration.slice(
    migration.indexOf('if p_action=\'resolve\' then'),
    migration.indexOf('elsif p_action=\'feedback\' and v_to=\'reopened\' then'),
  );
  assert.match(resolveNotificationBlock, /if v_ticket\.raised_by_user_id is not null then/);
  assert.match(resolveNotificationBlock, /values\(p_ticket_id,v_ticket\.raised_by_user_id,'awaiting_confirmation'/);
  assert.match(resolveNotificationBlock, /end if;/);
});

test('migration 058 does not change broadcast, acceptance, scope, or SLA timing functions', () => {
  assert.doesNotMatch(migration, /rpc_create_hospital_contact_ticket/);
  assert.doesNotMatch(migration, /rpc_accept_hospital_supervisor_ticket/);
  assert.doesNotMatch(migration, /hospital_ticket_on_duty_supervisors/);
  assert.doesNotMatch(migration, /hospital_supervisor_acceptance_window/);
});
