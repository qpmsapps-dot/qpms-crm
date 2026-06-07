-- Migration 021: Demo-stable FO tracking schema guard
-- Purpose: Ensure the foreground demo tracking path has the columns,
-- defaults, indexes, and upsert/duplicate guards it relies on.
-- Safe additive migration. Does not delete or rewrite existing business data.

create extension if not exists pgcrypto;

create table if not exists public.fo_location_logs (
  id uuid primary key default gen_random_uuid(),
  fo_user_id text not null,
  attendance_id uuid,
  latitude numeric not null,
  longitude numeric not null,
  accuracy numeric,
  speed numeric,
  battery_percentage integer,
  local_id text,
  captured_at timestamptz,
  created_at timestamptz default now()
);

alter table public.fo_location_logs
  alter column id set default gen_random_uuid(),
  add column if not exists fo_user_id text,
  add column if not exists username text,
  add column if not exists attendance_id uuid,
  add column if not exists latitude numeric,
  add column if not exists longitude numeric,
  add column if not exists accuracy numeric,
  add column if not exists speed numeric,
  add column if not exists battery_percentage integer,
  add column if not exists local_id text,
  add column if not exists captured_at timestamptz,
  add column if not exists logged_at timestamptz,
  add column if not exists created_at timestamptz default now();

update public.fo_location_logs
set fo_user_id = coalesce(fo_user_id, username),
    captured_at = coalesce(captured_at, logged_at, created_at, now()),
    logged_at = coalesce(logged_at, captured_at, created_at, now()),
    created_at = coalesce(created_at, now())
where fo_user_id is null
   or captured_at is null
   or logged_at is null
   or created_at is null;

alter table public.fo_location_logs
  alter column captured_at set default now(),
  alter column logged_at set default now(),
  alter column created_at set default now();

do $$
begin
  if not exists (
    select 1 from public.fo_location_logs where fo_user_id is null
  ) then
    alter table public.fo_location_logs alter column fo_user_id set not null;
  end if;
  if not exists (
    select 1 from public.fo_location_logs where attendance_id is null
  ) then
    alter table public.fo_location_logs alter column attendance_id set not null;
  end if;
  if not exists (
    select 1 from public.fo_location_logs where latitude is null
  ) then
    alter table public.fo_location_logs alter column latitude set not null;
  end if;
  if not exists (
    select 1 from public.fo_location_logs where longitude is null
  ) then
    alter table public.fo_location_logs alter column longitude set not null;
  end if;
end $$;

create unique index if not exists ux_fo_location_logs_local_id
  on public.fo_location_logs(local_id)
  where local_id is not null;

create index if not exists idx_fo_location_logs_user_captured
  on public.fo_location_logs(fo_user_id, captured_at);

create index if not exists idx_fo_location_logs_attendance_captured
  on public.fo_location_logs(attendance_id, captured_at);

alter table public.fo_attendance
  add column if not exists actual_km numeric default 0,
  add column if not exists eligible_km numeric default 0,
  add column if not exists total_raw_km numeric default 0,
  add column if not exists total_route_km numeric default 0,
  add column if not exists total_approved_km numeric default 0,
  add column if not exists updated_at timestamptz;

update public.fo_attendance
set actual_km = coalesce(actual_km, 0),
    eligible_km = coalesce(eligible_km, 0),
    total_raw_km = coalesce(total_raw_km, 0),
    total_route_km = coalesce(total_route_km, 0),
    total_approved_km = coalesce(total_approved_km, 0),
    updated_at = coalesce(updated_at, now())
where actual_km is null
   or eligible_km is null
   or total_raw_km is null
   or total_route_km is null
   or total_approved_km is null
   or updated_at is null;

alter table public.fo_attendance
  alter column actual_km set default 0,
  alter column eligible_km set default 0,
  alter column total_raw_km set default 0,
  alter column total_route_km set default 0,
  alter column total_approved_km set default 0;

create index if not exists idx_fo_attendance_user_date
  on public.fo_attendance(fo_user_id, attendance_date);

create table if not exists public.fo_live_status (
  id uuid primary key default gen_random_uuid(),
  fo_user_id text not null,
  latitude numeric,
  longitude numeric,
  accuracy numeric,
  speed numeric,
  battery_percentage integer,
  route_km_today numeric default 0,
  is_online boolean default false,
  is_tracking boolean default false,
  current_status text,
  updated_at timestamptz default now()
);

alter table public.fo_live_status
  add column if not exists fo_user_id text,
  add column if not exists username text,
  add column if not exists display_name text,
  add column if not exists latitude numeric,
  add column if not exists longitude numeric,
  add column if not exists accuracy numeric,
  add column if not exists speed numeric,
  add column if not exists battery_percentage integer,
  add column if not exists route_km_today numeric default 0,
  add column if not exists is_online boolean default false,
  add column if not exists is_tracking boolean default false,
  add column if not exists current_status text,
  add column if not exists last_seen_at timestamptz default now(),
  add column if not exists source text default 'mobile',
  add column if not exists sync_status text default 'synced',
  add column if not exists updated_at timestamptz default now();

update public.fo_live_status
set route_km_today = coalesce(route_km_today, 0),
    is_online = coalesce(is_online, false),
    is_tracking = coalesce(is_tracking, false),
    last_seen_at = coalesce(last_seen_at, now()),
    source = coalesce(source, 'mobile'),
    sync_status = coalesce(sync_status, 'synced'),
    updated_at = coalesce(updated_at, now())
where route_km_today is null
   or is_online is null
   or is_tracking is null
   or last_seen_at is null
   or source is null
   or sync_status is null
   or updated_at is null;

alter table public.fo_live_status
  alter column route_km_today set default 0,
  alter column is_online set default false,
  alter column is_tracking set default false,
  alter column last_seen_at set default now(),
  alter column source set default 'mobile',
  alter column sync_status set default 'synced',
  alter column updated_at set default now();

create unique index if not exists ux_fo_live_status_user
  on public.fo_live_status(fo_user_id);

create index if not exists idx_fo_live_status_fo_user_id
  on public.fo_live_status(fo_user_id);

create table if not exists public.mobile_crash_logs (
  id uuid primary key default gen_random_uuid(),
  fo_user_id text,
  employee_code text,
  action text,
  stage text,
  error_message text,
  stack_trace text,
  created_at timestamptz default now()
);

alter table public.mobile_crash_logs
  add column if not exists fo_user_id text,
  add column if not exists employee_code text,
  add column if not exists action text,
  add column if not exists stage text,
  add column if not exists error_message text,
  add column if not exists stack_trace text,
  add column if not exists created_at timestamptz default now();

alter table public.mobile_crash_logs
  alter column created_at set default now();
