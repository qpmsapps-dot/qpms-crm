import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const migration = readFileSync(
  new URL('../../supabase/migrations_2_0/043_hospital_ticket_push_notifications.sql', import.meta.url),
  'utf8',
);
const contactPushMigration = readFileSync(
  new URL('../../supabase/migrations_2_0/059_hospital_contact_push_recipients.sql', import.meta.url),
  'utf8',
);

test('Day 4 migration creates a hospital push device registry', () => {
  assert.match(migration, /create table if not exists public\.hospital_ticket_push_devices/i);
  assert.match(migration, /auth_user_id uuid not null/i);
  assert.match(migration, /hospital_ticket_user_id uuid not null references public\.hospital_ticket_users\(id\)/i);
  assert.match(migration, /app_scope in \('myqpms_internal','qpms_client'\)/i);
  assert.match(migration, /fcm_token text not null/i);
  assert.match(migration, /token_hash text/i);
  assert.match(migration, /ux_hospital_ticket_push_device_owner_scope_device/i);
});

test('Day 4 migration tracks push delivery attempts idempotently', () => {
  assert.match(migration, /create table if not exists public\.hospital_ticket_push_deliveries/i);
  assert.match(migration, /notification_id uuid not null references public\.hospital_ticket_notifications\(id\)/i);
  assert.match(migration, /status in \('pending','processing','sent','failed','invalid_token','skipped'\)/i);
  assert.match(migration, /constraint hospital_ticket_push_deliveries_unique unique\(notification_id, device_id\)/i);
  assert.match(migration, /idx_hospital_ticket_push_deliveries_pending/i);
});

test('Day 4 migration keeps service-role-only RLS access for push tables', () => {
  assert.match(migration, /alter table public\.hospital_ticket_push_devices enable row level security/i);
  assert.match(migration, /alter table public\.hospital_ticket_push_deliveries enable row level security/i);
  assert.match(migration, /hospital_ticket_push_devices_service_role_all/i);
  assert.match(migration, /hospital_ticket_push_deliveries_service_role_all/i);
});

test('contact push migration supports registered contacts without fake hospital users', () => {
  assert.match(contactPushMigration, /hospital_client_contact_id uuid references public\.hospital_client_contacts\(id\)/i);
  assert.match(contactPushMigration, /alter column hospital_ticket_user_id drop not null/i);
  assert.match(contactPushMigration, /alter column recipient_user_id drop not null/i);
  assert.match(contactPushMigration, /recipient_client_contact_id uuid references public\.hospital_client_contacts\(id\)/i);
  assert.match(contactPushMigration, /hospital_ticket_push_devices_owner_check/i);
  assert.match(contactPushMigration, /hospital_ticket_notifications_recipient_check/i);
  assert.match(contactPushMigration, /ux_hospital_ticket_push_contact_scope_device/i);
});
