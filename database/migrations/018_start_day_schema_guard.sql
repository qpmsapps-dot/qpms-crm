-- Migration 018: Start Day schema guard
-- Purpose: Ensure the columns written by the mobile Start Day flow exist even
-- when older FO reporting migrations were applied out of order.

alter table public.fo_attendance
  add column if not exists username text,
  add column if not exists display_name text,
  add column if not exists total_route_km numeric(10, 2) not null default 0,
  add column if not exists actual_km numeric(10, 2) not null default 0,
  add column if not exists eligible_km numeric(10, 2) not null default 0,
  add column if not exists rate_per_km numeric(10, 2) not null default 4,
  add column if not exists petrol_amount numeric(10, 2) not null default 0;

alter table public.fo_location_logs
  add column if not exists username text,
  add column if not exists captured_at timestamptz;

alter table public.fo_live_status
  add column if not exists username text,
  add column if not exists display_name text;

update public.fo_location_logs
set captured_at = coalesce(captured_at, logged_at)
where captured_at is null;
