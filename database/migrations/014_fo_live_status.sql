-- Migration 014: FO live status foundation
-- Purpose: One canonical live row per Field Officer for dashboard tracking.
-- Safe additive migration. Does not change existing FO attendance/task tables.

create extension if not exists pgcrypto;

create or replace function public.set_updated_at()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

create table if not exists public.fo_live_status (
  id uuid primary key default gen_random_uuid(),
  fo_user_id text not null,
  attendance_id uuid references public.fo_attendance(id) on delete set null,
  active_task_id uuid references public.fo_daily_tasks(id) on delete set null,
  active_site_visit_id uuid references public.fo_site_visits(id) on delete set null,
  is_online boolean not null default false,
  is_tracking boolean not null default false,
  current_status text not null default 'offline',
  latitude numeric(10, 7),
  longitude numeric(10, 7),
  accuracy numeric(10, 2),
  speed numeric(10, 2),
  heading numeric(10, 2),
  battery_percentage integer,
  route_km_today numeric(10, 2) not null default 0,
  last_seen_at timestamptz not null default now(),
  source text not null default 'mobile',
  sync_status text not null default 'synced',
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists ux_fo_live_status_user
  on public.fo_live_status (fo_user_id);

create index if not exists idx_fo_live_status_online_seen
  on public.fo_live_status (is_online, last_seen_at desc);

create index if not exists idx_fo_live_status_seen
  on public.fo_live_status (last_seen_at desc);

drop trigger if exists trg_fo_live_status_updated_at on public.fo_live_status;
create trigger trg_fo_live_status_updated_at
before update on public.fo_live_status
for each row execute function public.set_updated_at();
