-- Migration 013: FO route KM and task evidence foundation
-- Purpose: Store Google route distance separately from straight-line geofence distance.
-- Safe to run after 012_fo_operations_phase1.sql. This migration is additive only.

create extension if not exists pgcrypto;

create or replace function public.set_updated_at()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

create table if not exists public.fo_travel_segments (
  id uuid primary key default gen_random_uuid(),
  fo_user_id text not null,
  attendance_id uuid references public.fo_attendance(id) on delete set null,
  task_id uuid references public.fo_daily_tasks(id) on delete set null,
  site_visit_id uuid references public.fo_site_visits(id) on delete set null,
  from_lat numeric(10,7),
  from_lng numeric(10,7),
  to_lat numeric(10,7),
  to_lng numeric(10,7),
  straight_line_km numeric(10,2),
  route_km numeric(10,2),
  route_duration_minutes integer,
  google_route_polyline text,
  distance_source text default 'google_directions',
  segment_status text default 'calculated',
  local_id text not null unique,
  sync_status text default 'synced',
  metadata jsonb default '{}'::jsonb,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

create index if not exists idx_fo_travel_segments_user_created
  on public.fo_travel_segments (fo_user_id, created_at desc);
create index if not exists idx_fo_travel_segments_attendance
  on public.fo_travel_segments (attendance_id);
create index if not exists idx_fo_travel_segments_task
  on public.fo_travel_segments (task_id);
create index if not exists idx_fo_travel_segments_visit
  on public.fo_travel_segments (site_visit_id);

drop trigger if exists trg_fo_travel_segments_updated_at on public.fo_travel_segments;
create trigger trg_fo_travel_segments_updated_at
before update on public.fo_travel_segments
for each row execute function public.set_updated_at();

create table if not exists public.fo_task_attachments (
  id uuid primary key default gen_random_uuid(),
  fo_user_id text not null,
  task_id uuid references public.fo_daily_tasks(id) on delete set null,
  site_visit_id uuid references public.fo_site_visits(id) on delete set null,
  site_id uuid references public.fo_sites(id) on delete set null,
  file_url text not null,
  file_name text,
  file_type text,
  file_size bigint,
  storage_bucket text default 'fo-task-attachments',
  uploaded_at timestamptz default now(),
  local_id text unique,
  sync_status text default 'synced',
  metadata jsonb default '{}'::jsonb,
  created_at timestamptz default now()
);

create index if not exists idx_fo_task_attachments_task
  on public.fo_task_attachments (task_id);
create index if not exists idx_fo_task_attachments_visit
  on public.fo_task_attachments (site_visit_id);
create index if not exists idx_fo_task_attachments_user_uploaded
  on public.fo_task_attachments (fo_user_id, uploaded_at desc);

create table if not exists public.fo_task_checklist_items (
  id uuid primary key default gen_random_uuid(),
  task_id uuid references public.fo_daily_tasks(id) on delete cascade,
  title text not null,
  is_completed boolean default false,
  remarks text,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

create index if not exists idx_fo_task_checklist_items_task
  on public.fo_task_checklist_items (task_id);

drop trigger if exists trg_fo_task_checklist_items_updated_at on public.fo_task_checklist_items;
create trigger trg_fo_task_checklist_items_updated_at
before update on public.fo_task_checklist_items
for each row execute function public.set_updated_at();

create table if not exists public.fo_app_settings (
  id uuid primary key default gen_random_uuid(),
  key text unique not null,
  value text,
  description text,
  updated_at timestamptz default now()
);

drop trigger if exists trg_fo_app_settings_updated_at on public.fo_app_settings;
create trigger trg_fo_app_settings_updated_at
before update on public.fo_app_settings
for each row execute function public.set_updated_at();

alter table public.fo_attendance
  add column if not exists total_route_km numeric(10,2) default 0,
  add column if not exists route_sync_status text default 'pending';

alter table public.fo_site_visits
  add column if not exists straight_line_km numeric(10,2),
  add column if not exists route_km numeric(10,2),
  add column if not exists route_duration_minutes integer,
  add column if not exists google_route_polyline text,
  add column if not exists distance_source text;

alter table public.fo_daily_tasks
  add column if not exists task_started_at timestamptz,
  add column if not exists task_completed_at timestamptz,
  add column if not exists task_completed_latitude numeric(10,7),
  add column if not exists task_completed_longitude numeric(10,7),
  add column if not exists task_type text,
  add column if not exists task_category text,
  add column if not exists work_status text;

insert into public.fo_app_settings (key, value, description)
values
  ('geofence_radius_meters', '100', 'Default geofence radius for FO site check-in validation.'),
  ('conveyance_rate_per_km', '4', 'Admin/reporting conveyance rate. Do not display amount in mobile app.'),
  ('route_distance_source', 'google_directions', 'Preferred route distance source for FO travel segments.'),
  ('show_petrol_amount_in_mobile', 'false', 'FO mobile must show route KM only, not petrol/conveyance amount.')
on conflict (key) do update
set value = excluded.value,
    description = excluded.description,
    updated_at = now();

insert into storage.buckets (id, name, public)
values ('fo-task-attachments', 'fo-task-attachments', true)
on conflict (id) do nothing;

-- Demo/mobile upload policies for anon mock-login builds.
-- Replace with user-owned Supabase Auth policies before production rollout.
do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'storage'
      and tablename = 'objects'
      and policyname = 'fo_task_attachments_public_read'
  ) then
    create policy fo_task_attachments_public_read
      on storage.objects for select
      using (bucket_id = 'fo-task-attachments');
  end if;

  if not exists (
    select 1 from pg_policies
    where schemaname = 'storage'
      and tablename = 'objects'
      and policyname = 'fo_task_attachments_demo_insert'
  ) then
    create policy fo_task_attachments_demo_insert
      on storage.objects for insert
      with check (bucket_id = 'fo-task-attachments');
  end if;
end $$;
