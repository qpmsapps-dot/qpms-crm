-- Day 4: Firebase push delivery registry/outbox for Hospital Ticketing.
-- Additive only. Database notifications remain the source of truth.

create table if not exists public.hospital_ticket_push_devices (
  id uuid primary key default gen_random_uuid(),
  auth_user_id uuid not null,
  hospital_ticket_user_id uuid not null references public.hospital_ticket_users(id),
  client_id uuid not null,
  app_scope text not null,
  platform text not null,
  device_id text not null,
  fcm_token text not null,
  token_hash text,
  app_version text,
  enabled boolean not null default true,
  notification_permission text not null default 'unknown',
  last_registered_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  disabled_at timestamptz,
  disable_reason text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  metadata jsonb not null default '{}'::jsonb
);

do $$
begin
  if not exists (select 1 from pg_constraint where conname='hospital_ticket_push_devices_app_scope_check') then
    alter table public.hospital_ticket_push_devices
      add constraint hospital_ticket_push_devices_app_scope_check
      check (app_scope in ('myqpms_internal','qpms_client'));
  end if;
  if not exists (select 1 from pg_constraint where conname='hospital_ticket_push_devices_platform_check') then
    alter table public.hospital_ticket_push_devices
      add constraint hospital_ticket_push_devices_platform_check
      check (platform in ('android','ios','web','unknown'));
  end if;
  if not exists (select 1 from pg_constraint where conname='hospital_ticket_push_devices_permission_check') then
    alter table public.hospital_ticket_push_devices
      add constraint hospital_ticket_push_devices_permission_check
      check (notification_permission in ('granted','denied','provisional','unknown'));
  end if;
end $$;

create unique index if not exists ux_hospital_ticket_push_device_owner_scope_device
  on public.hospital_ticket_push_devices(hospital_ticket_user_id, app_scope, device_id);
create index if not exists idx_hospital_ticket_push_devices_recipient
  on public.hospital_ticket_push_devices(hospital_ticket_user_id, app_scope, enabled, last_seen_at desc);
create index if not exists idx_hospital_ticket_push_devices_token_hash
  on public.hospital_ticket_push_devices(token_hash)
  where token_hash is not null;

create table if not exists public.hospital_ticket_push_deliveries (
  id uuid primary key default gen_random_uuid(),
  notification_id uuid not null references public.hospital_ticket_notifications(id),
  device_id uuid not null references public.hospital_ticket_push_devices(id),
  ticket_id uuid,
  app_scope text not null,
  status text not null default 'pending',
  attempt_count integer not null default 0,
  max_attempts integer not null default 5,
  claimed_at timestamptz,
  claim_token uuid,
  last_attempt_at timestamptz,
  next_attempt_at timestamptz not null default now(),
  sent_at timestamptz,
  fcm_message_id text,
  error_code text,
  error_message text,
  retryable boolean not null default true,
  payload_metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint hospital_ticket_push_deliveries_unique unique(notification_id, device_id)
);

do $$
begin
  if not exists (select 1 from pg_constraint where conname='hospital_ticket_push_deliveries_app_scope_check') then
    alter table public.hospital_ticket_push_deliveries
      add constraint hospital_ticket_push_deliveries_app_scope_check
      check (app_scope in ('myqpms_internal','qpms_client'));
  end if;
  if not exists (select 1 from pg_constraint where conname='hospital_ticket_push_deliveries_status_check') then
    alter table public.hospital_ticket_push_deliveries
      add constraint hospital_ticket_push_deliveries_status_check
      check (status in ('pending','processing','sent','failed','invalid_token','skipped'));
  end if;
  if not exists (select 1 from pg_constraint where conname='hospital_ticket_push_deliveries_attempt_check') then
    alter table public.hospital_ticket_push_deliveries
      add constraint hospital_ticket_push_deliveries_attempt_check
      check (attempt_count >= 0 and max_attempts > 0);
  end if;
end $$;

create index if not exists idx_hospital_ticket_push_deliveries_pending
  on public.hospital_ticket_push_deliveries(status, next_attempt_at, created_at)
  where status in ('pending','failed') and retryable = true;
create index if not exists idx_hospital_ticket_push_deliveries_notification
  on public.hospital_ticket_push_deliveries(notification_id);
create index if not exists idx_hospital_ticket_push_deliveries_ticket
  on public.hospital_ticket_push_deliveries(ticket_id);

alter table public.hospital_ticket_push_devices enable row level security;
alter table public.hospital_ticket_push_deliveries enable row level security;

drop policy if exists hospital_ticket_push_devices_service_role_all on public.hospital_ticket_push_devices;
create policy hospital_ticket_push_devices_service_role_all
  on public.hospital_ticket_push_devices
  for all
  using (auth.role() = 'service_role')
  with check (auth.role() = 'service_role');

drop policy if exists hospital_ticket_push_deliveries_service_role_all on public.hospital_ticket_push_deliveries;
create policy hospital_ticket_push_deliveries_service_role_all
  on public.hospital_ticket_push_deliveries
  for all
  using (auth.role() = 'service_role')
  with check (auth.role() = 'service_role');
