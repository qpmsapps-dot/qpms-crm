-- Migration 015: FO GPS test users and simple GPS reporting fields
-- Purpose: Seed FO001-FO005 and expose GPS-only attendance/conveyance columns.

create extension if not exists "pgcrypto";

alter table public.profiles add column if not exists username text;
alter table public.profiles add column if not exists display_name text;

alter table public.profiles drop constraint if exists profiles_role_check;
alter table public.profiles add constraint profiles_role_check check (
  role in (
    'Admin',
    'Developer',
    'Super Admin',
    'BD',
    'BD Team',
    'BD Head',
    'BD Executive',
    'Operations',
    'Operations Team',
    'Coordinator',
    'HR',
    'HR Reviewer',
    'Commercial',
    'Commercial Team',
    'Commercial Reviewer',
    'Finance',
    'Finance Team',
    'Finance Reviewer',
    'Management',
    'COO',
    'FO',
    'Field Officer'
  )
);

create unique index if not exists ux_profiles_username
  on public.profiles (upper(username))
  where username is not null;

alter table public.fo_attendance add column if not exists username text;
alter table public.fo_attendance add column if not exists display_name text;
alter table public.fo_attendance add column if not exists actual_km numeric(10, 2) not null default 0;
alter table public.fo_attendance add column if not exists eligible_km numeric(10, 2) not null default 0;
alter table public.fo_attendance add column if not exists rate_per_km numeric(10, 2) not null default 4;
alter table public.fo_attendance add column if not exists petrol_amount numeric(10, 2) not null default 0;

alter table public.fo_location_logs add column if not exists username text;
alter table public.fo_location_logs add column if not exists captured_at timestamptz;

alter table public.fo_live_status add column if not exists username text;
alter table public.fo_live_status add column if not exists display_name text;

update public.fo_location_logs
set captured_at = coalesce(captured_at, logged_at)
where captured_at is null;

insert into public.profiles (
  username,
  display_name,
  email,
  full_name,
  role,
  status,
  is_active,
  metadata
)
values
  ('FO001', 'Test Field Officer 001', 'fo001@qpms.test', 'Test Field Officer 001', 'FO', 'Active', true, '{"test_password":"123456","auth_mode":"fo_gps_test"}'::jsonb),
  ('FO002', 'Test Field Officer 002', 'fo002@qpms.test', 'Test Field Officer 002', 'FO', 'Active', true, '{"test_password":"123456","auth_mode":"fo_gps_test"}'::jsonb),
  ('FO003', 'Test Field Officer 003', 'fo003@qpms.test', 'Test Field Officer 003', 'FO', 'Active', true, '{"test_password":"123456","auth_mode":"fo_gps_test"}'::jsonb),
  ('FO004', 'Test Field Officer 004', 'fo004@qpms.test', 'Test Field Officer 004', 'FO', 'Active', true, '{"test_password":"123456","auth_mode":"fo_gps_test"}'::jsonb),
  ('FO005', 'Test Field Officer 005', 'fo005@qpms.test', 'Test Field Officer 005', 'FO', 'Active', true, '{"test_password":"123456","auth_mode":"fo_gps_test"}'::jsonb)
on conflict (email) do update set
  username = excluded.username,
  display_name = excluded.display_name,
  full_name = excluded.full_name,
  role = 'FO',
  status = 'Active',
  is_active = true,
  metadata = public.profiles.metadata || excluded.metadata,
  updated_at = now();

insert into public.fo_live_status (
  fo_user_id,
  username,
  display_name,
  is_online,
  is_tracking,
  current_status,
  route_km_today,
  source,
  sync_status
)
values
  ('FO001', 'FO001', 'Test Field Officer 001', false, false, 'offline', 0, 'seed', 'synced'),
  ('FO002', 'FO002', 'Test Field Officer 002', false, false, 'offline', 0, 'seed', 'synced'),
  ('FO003', 'FO003', 'Test Field Officer 003', false, false, 'offline', 0, 'seed', 'synced'),
  ('FO004', 'FO004', 'Test Field Officer 004', false, false, 'offline', 0, 'seed', 'synced'),
  ('FO005', 'FO005', 'Test Field Officer 005', false, false, 'offline', 0, 'seed', 'synced')
on conflict (fo_user_id) do update set
  username = excluded.username,
  display_name = excluded.display_name,
  updated_at = now();
