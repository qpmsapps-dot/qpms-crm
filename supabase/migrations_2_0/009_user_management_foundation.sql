-- Mobile_FO_V2 schema migration 2.0
-- 009: User Management foundation.
-- Safe lifecycle fields, access flags, employee-code hierarchy, and audit log.
-- No cascade delete. No operational history deletion. No employee-code rewrite.

create extension if not exists "pgcrypto";

alter table public.profiles
  add column if not exists requires_password_change boolean not null default false,
  add column if not exists deactivated_at timestamptz,
  add column if not exists deactivated_by uuid,
  add column if not exists deactivation_reason text,
  add column if not exists mobile_access_enabled boolean not null default true,
  add column if not exists web_access_enabled boolean not null default true,
  add column if not exists auth_provisioning_status text not null default 'unknown',
  add column if not exists auth_provisioning_error text,
  add column if not exists auth_provisioned_at timestamptz,
  add column if not exists last_profile_sync_at timestamptz;

create index if not exists idx_profiles_auth_user_id
  on public.profiles(auth_user_id);

create index if not exists idx_profiles_employee_code
  on public.profiles(employee_code);

create index if not exists idx_profiles_is_active
  on public.profiles(is_active);

create index if not exists idx_profiles_role
  on public.profiles(role);

create index if not exists idx_profiles_department
  on public.profiles(department);

create index if not exists idx_profiles_designation
  on public.profiles(designation);

create index if not exists idx_profiles_business
  on public.profiles(business);

create index if not exists idx_profiles_auth_provisioning_status
  on public.profiles(auth_provisioning_status);

-- Keep hierarchy separate from profiles. Employee codes remain text identifiers
-- because FO operational history is keyed by employee_code/fo_user_id text.
-- Foreign keys are intentionally omitted so existing operational data is not blocked.
create table if not exists public.employee_hierarchy (
  id uuid primary key default gen_random_uuid(),

  employee_code text not null,
  manager_employee_code text,
  managers_manager_employee_code text,
  business_head_employee_code text,
  gm_employee_code text,
  coo_employee_code text,

  hierarchy_level text,
  hierarchy_path text[],

  is_active boolean not null default true,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid,
  updated_by uuid,

  metadata jsonb not null default '{}'::jsonb
);

create index if not exists idx_employee_hierarchy_employee_code
  on public.employee_hierarchy(employee_code);

create index if not exists idx_employee_hierarchy_manager_employee_code
  on public.employee_hierarchy(manager_employee_code);

create index if not exists idx_employee_hierarchy_business_head_employee_code
  on public.employee_hierarchy(business_head_employee_code);

create index if not exists idx_employee_hierarchy_gm_employee_code
  on public.employee_hierarchy(gm_employee_code);

create index if not exists idx_employee_hierarchy_coo_employee_code
  on public.employee_hierarchy(coo_employee_code);

create index if not exists idx_employee_hierarchy_is_active
  on public.employee_hierarchy(is_active);

-- Do not add unique(employee_code) until duplicate and normalization reports
-- have been reviewed against the production data.
create or replace view public.v_duplicate_profile_employee_codes as
select
  employee_code,
  count(*) as duplicate_count,
  array_agg(id) as profile_ids,
  array_agg(full_name) as full_names
from public.profiles
where employee_code is not null
  and trim(employee_code) <> ''
group by employee_code
having count(*) > 1;

-- Dedicated append-only-by-application audit table for User Management actions.
-- No update/delete grants or policies are added for frontend roles.
create table if not exists public.user_management_audit_logs (
  id uuid primary key default gen_random_uuid(),

  action text not null,

  target_profile_id uuid,
  target_auth_user_id uuid,
  target_employee_code text,

  actor_auth_user_id uuid,
  actor_profile_id uuid,
  actor_employee_code text,
  actor_role text,

  old_data jsonb,
  new_data jsonb,

  reason text,
  ip_address text,
  user_agent text,

  metadata jsonb not null default '{}'::jsonb,

  created_at timestamptz not null default now()
);

create index if not exists idx_user_management_audit_logs_action
  on public.user_management_audit_logs(action);

create index if not exists idx_user_management_audit_logs_target_employee_code
  on public.user_management_audit_logs(target_employee_code);

create index if not exists idx_user_management_audit_logs_actor_employee_code
  on public.user_management_audit_logs(actor_employee_code);

create index if not exists idx_user_management_audit_logs_created_at
  on public.user_management_audit_logs(created_at desc);

-- Backend-only foundation: do not expose these tables directly to anon/authenticated.
alter table public.employee_hierarchy enable row level security;
alter table public.user_management_audit_logs enable row level security;

revoke all on public.employee_hierarchy from anon, authenticated;
revoke all on public.user_management_audit_logs from anon, authenticated;

-- Reuse the shared project updated_at trigger helper from migration 000.
drop trigger if exists trg_employee_hierarchy_updated_at
  on public.employee_hierarchy;

create trigger trg_employee_hierarchy_updated_at
before update on public.employee_hierarchy
for each row
execute function public.set_updated_at();
