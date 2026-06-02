-- Migration 020: Mobile crash diagnostics
-- Purpose: Persist Start Day/background tracking crash breadcrumbs from FO Android app.

create extension if not exists "pgcrypto";

create table if not exists public.mobile_crash_logs (
  id text primary key,
  employee_code text,
  screen text not null,
  action text not null,
  error_message text,
  stack_trace text,
  created_at timestamptz not null default now()
);

create index if not exists idx_mobile_crash_logs_employee_created
  on public.mobile_crash_logs (employee_code, created_at desc);

create index if not exists idx_mobile_crash_logs_created
  on public.mobile_crash_logs (created_at desc);
