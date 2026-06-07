-- Migration 019: Store master and mobile FO visit fields
-- Purpose: Support My Tasks store search/check-in and Site Visit history.

create extension if not exists "pgcrypto";

create table if not exists public.store_master (
  id uuid primary key default gen_random_uuid(),
  store_name text not null,
  client_name text not null,
  store_code text not null,
  state text not null,
  latitude numeric(10, 7),
  longitude numeric(10, 7),
  gps_accuracy numeric(10, 2),
  created_by_employee_code text,
  created_by_full_name text,
  attendance_id uuid references public.fo_attendance(id) on delete set null,
  captured_at timestamptz not null default now(),
  status text not null default 'Active',
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists ux_store_master_store_code
  on public.store_master (upper(store_code));

create index if not exists idx_store_master_search
  on public.store_master (upper(store_name), upper(store_code));

drop trigger if exists trg_store_master_updated_at on public.store_master;
create trigger trg_store_master_updated_at
before update on public.store_master
for each row execute function public.set_updated_at();

alter table public.fo_site_visits
  add column if not exists employee_code text,
  add column if not exists full_name text,
  add column if not exists store_id uuid references public.store_master(id) on delete set null,
  add column if not exists store_name text,
  add column if not exists store_code text,
  add column if not exists client_name text,
  add column if not exists state text,
  add column if not exists current_latitude numeric(10, 7),
  add column if not exists current_longitude numeric(10, 7),
  add column if not exists current_gps_accuracy numeric(10, 2),
  add column if not exists checkin_accuracy numeric(10, 2),
  add column if not exists checkout_time timestamptz,
  add column if not exists checkout_accuracy numeric(10, 2),
  add column if not exists visit_duration_minutes integer,
  add column if not exists status text;

create index if not exists idx_fo_site_visits_employee_checkin
  on public.fo_site_visits (employee_code, check_in_time desc);

create index if not exists idx_fo_site_visits_store
  on public.fo_site_visits (store_id);
