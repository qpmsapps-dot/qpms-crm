-- Migration 020: Mobile crash diagnostics
-- Purpose: Persist Start Day/background tracking crash breadcrumbs from FO Android app.

create extension if not exists "pgcrypto";

create table if not exists public.mobile_crash_logs (
  id uuid primary key default gen_random_uuid(),
  fo_user_id text,
  stage text,
  -- Compatibility columns retained for older app builds and web debug panels.
  employee_code text,
  screen text,
  action text,
  error_message text,
  stack_trace text,
  created_at timestamptz not null default now()
);

alter table public.mobile_crash_logs
  add column if not exists fo_user_id text,
  add column if not exists stage text,
  add column if not exists employee_code text,
  add column if not exists screen text,
  add column if not exists action text,
  add column if not exists error_message text,
  add column if not exists stack_trace text,
  add column if not exists created_at timestamptz not null default now();

create index if not exists idx_mobile_crash_logs_fo_user_created
  on public.mobile_crash_logs (fo_user_id, created_at desc);

create index if not exists idx_mobile_crash_logs_created
  on public.mobile_crash_logs (created_at desc);

create index if not exists idx_mobile_crash_logs_employee_created
  on public.mobile_crash_logs (employee_code, created_at desc);
