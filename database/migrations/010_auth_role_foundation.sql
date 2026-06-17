-- Migration 010: Auth and Role Foundation
-- Purpose: Add Supabase Auth profile linkage, multi-role foundation, role permissions, and staged RLS helpers.
--
-- Scope:
--   - Additive auth/role foundation only.
--   - Keep existing demo/mock compatibility.
--   - Do not fully lock down every existing table yet.
--   - Do not remove legacy policies in this phase.

create extension if not exists "pgcrypto";

-- ---------------------------------------------------------------------------
-- 1. Profile foundation linked to Supabase Auth users
-- ---------------------------------------------------------------------------
create table if not exists public.profiles (
  id uuid primary key default gen_random_uuid(),
  auth_user_id uuid unique references auth.users(id) on delete cascade,
  email text unique not null,
  full_name text not null,
  role text not null default 'BD',
  status text not null default 'Pending Approval',
  is_active boolean not null default false,
  approved_by uuid references auth.users(id) on delete set null,
  approved_at timestamptz,
  last_login_at timestamptz,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.profiles add column if not exists auth_user_id uuid unique references auth.users(id) on delete cascade;
alter table public.profiles add column if not exists status text not null default 'Pending Approval';
alter table public.profiles add column if not exists is_active boolean not null default false;
alter table public.profiles add column if not exists approved_by uuid references auth.users(id) on delete set null;
alter table public.profiles add column if not exists approved_at timestamptz;
alter table public.profiles add column if not exists last_login_at timestamptz;
alter table public.profiles add column if not exists metadata jsonb not null default '{}'::jsonb;

-- Existing projects may still use detailed role names. Keep role as text for compatibility,
-- then normalize through helper functions instead of forcing a destructive enum migration.
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
    'COO'
  )
);

create table if not exists public.user_roles (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  profile_id uuid references public.profiles(id) on delete cascade,
  role_code text not null,
  is_primary boolean not null default false,
  is_active boolean not null default true,
  assigned_by uuid references auth.users(id) on delete set null,
  assigned_at timestamptz not null default now(),
  expires_at timestamptz,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, role_code)
);

create table if not exists public.role_permissions (
  id uuid primary key default gen_random_uuid(),
  role_code text not null,
  permission_code text not null,
  permission_scope text not null default 'global',
  is_allowed boolean not null default true,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (role_code, permission_code, permission_scope)
);

create index if not exists idx_profiles_auth_user_id on public.profiles(auth_user_id);
create index if not exists idx_profiles_email on public.profiles(lower(email));
create index if not exists idx_user_roles_user_active on public.user_roles(user_id, is_active);
create index if not exists idx_role_permissions_role on public.role_permissions(role_code, permission_code);

-- ---------------------------------------------------------------------------
-- 2. Role mapping helpers
-- ---------------------------------------------------------------------------
create or replace function public.normalize_qpms_role(p_role text)
returns text
language sql
stable
as $$
  select case
    when p_role in ('Admin', 'Developer', 'Super Admin') then 'Admin'
    when p_role in ('COO', 'Management', 'BD Head') then 'Management'
    when p_role in ('BD', 'BD Team', 'BD Executive') then 'BD'
    when p_role in ('Operations', 'Operations Team') then 'Operations'
    when p_role in ('Coordinator') then 'Coordinator'
    when p_role in ('HR', 'HR Reviewer') then 'HR'
    when p_role in ('Commercial', 'Commercial Team', 'Commercial Reviewer') then 'Commercial'
    when p_role in ('Finance', 'Finance Team', 'Finance Reviewer') then 'Finance'
    else coalesce(nullif(trim(p_role), ''), 'BD')
  end;
$$;

create or replace function public.current_profile()
returns public.profiles
language sql
stable
security definer
set search_path = public
as $$
  select p
  from public.profiles p
  where p.auth_user_id = auth.uid()
  limit 1;
$$;

create or replace function public.current_user_role()
returns text
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(
    (
      select ur.role_code
      from public.user_roles ur
      where ur.user_id = auth.uid()
        and ur.is_active = true
      order by ur.is_primary desc, ur.assigned_at asc
      limit 1
    ),
    (
      select public.normalize_qpms_role(p.role)
      from public.profiles p
      where p.auth_user_id = auth.uid()
      limit 1
    )
  );
$$;

create or replace function public.has_role(p_roles text[])
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(public.current_user_role() = any(p_roles), false);
$$;

create or replace function public.has_permission(p_permission_code text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.role_permissions rp
    where rp.role_code = public.current_user_role()
      and rp.permission_code = p_permission_code
      and rp.is_allowed = true
  );
$$;

create or replace function public.can_update_workflow()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.has_role(array['Admin', 'Management', 'BD', 'Operations', 'Coordinator', 'HR', 'Commercial', 'Finance']);
$$;

-- ---------------------------------------------------------------------------
-- 3. Auth user -> profile synchronization
-- ---------------------------------------------------------------------------
create or replace function public.handle_new_auth_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_email text;
  v_name text;
  v_role text;
begin
  v_email := lower(coalesce(new.email, ''));
  v_name := coalesce(new.raw_user_meta_data ->> 'full_name', new.raw_user_meta_data ->> 'name', split_part(v_email, '@', 1), 'QPMS User');
  v_role := public.normalize_qpms_role(coalesce(new.raw_user_meta_data ->> 'role', 'BD'));

  insert into public.profiles (
    auth_user_id,
    email,
    full_name,
    role,
    status,
    is_active,
    metadata
  ) values (
    new.id,
    v_email,
    v_name,
    v_role,
    'Pending Approval',
    false,
    coalesce(new.raw_user_meta_data, '{}'::jsonb)
  )
  on conflict (email) do update set
    auth_user_id = coalesce(public.profiles.auth_user_id, excluded.auth_user_id),
    full_name = coalesce(nullif(public.profiles.full_name, ''), excluded.full_name),
    role = coalesce(public.profiles.role, excluded.role),
    updated_at = now();

  insert into public.user_roles (
    user_id,
    profile_id,
    role_code,
    is_primary,
    is_active
  )
  select
    new.id,
    p.id,
    public.normalize_qpms_role(p.role),
    true,
    p.is_active
  from public.profiles p
  where p.auth_user_id = new.id
  on conflict (user_id, role_code) do update set
    profile_id = excluded.profile_id,
    is_primary = true,
    updated_at = now();

  return new;
end;
$$;

drop trigger if exists on_auth_user_created_qpms_profile on auth.users;
create trigger on_auth_user_created_qpms_profile
after insert on auth.users
for each row execute function public.handle_new_auth_user();

create or replace function public.sync_profile_primary_role()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.auth_user_id is not null then
    insert into public.user_roles (
      user_id,
      profile_id,
      role_code,
      is_primary,
      is_active
    ) values (
      new.auth_user_id,
      new.id,
      public.normalize_qpms_role(new.role),
      true,
      new.is_active
    )
    on conflict (user_id, role_code) do update set
      profile_id = excluded.profile_id,
      is_primary = true,
      is_active = excluded.is_active,
      updated_at = now();
  end if;
  return new;
end;
$$;

drop trigger if exists on_profile_role_sync on public.profiles;
create trigger on_profile_role_sync
after insert or update of auth_user_id, role, is_active on public.profiles
for each row execute function public.sync_profile_primary_role();

-- ---------------------------------------------------------------------------
-- 4. Permission seed foundation
-- ---------------------------------------------------------------------------
insert into public.role_permissions (role_code, permission_code, permission_scope)
values
  ('Admin', 'system.manage', 'global'),
  ('Admin', 'workflow.read', 'global'),
  ('Admin', 'workflow.write', 'global'),
  ('Admin', 'approval.decide', 'global'),
  ('Admin', 'notification.read_all', 'global'),
  ('Management', 'workflow.read', 'global'),
  ('Management', 'approval.observe', 'global'),
  ('BD', 'lead.manage', 'own'),
  ('BD', 'workflow.read', 'own'),
  ('BD', 'workflow.write', 'own'),
  ('Operations', 'workflow.read', 'assigned'),
  ('Operations', 'approval.decide', 'assigned'),
  ('Coordinator', 'workflow.read', 'assigned'),
  ('Coordinator', 'approval.decide', 'assigned'),
  ('HR', 'workflow.read', 'assigned'),
  ('HR', 'approval.decide', 'assigned'),
  ('Commercial', 'workflow.read', 'assigned'),
  ('Commercial', 'approval.decide', 'assigned'),
  ('Finance', 'workflow.read', 'assigned'),
  ('Finance', 'approval.decide', 'assigned')
on conflict (role_code, permission_code, permission_scope) do update set
  is_allowed = excluded.is_allowed,
  updated_at = now();

-- ---------------------------------------------------------------------------
-- 5. Staged RLS foundation
-- ---------------------------------------------------------------------------
alter table public.profiles enable row level security;
alter table public.user_roles enable row level security;
alter table public.role_permissions enable row level security;
alter table public.notifications enable row level security;
alter table public.notification_logs enable row level security;
alter table public.workflow_instances enable row level security;
alter table public.workflow_assignments enable row level security;
alter table public.workflow_events enable row level security;
alter table public.approval_decisions enable row level security;
alter table public.assessment_sections enable row level security;
alter table public.assessment_section_versions enable row level security;
alter table public.assessment_drafts enable row level security;
alter table public.proposals enable row level security;
alter table public.proposal_versions enable row level security;
alter table public.proposal_line_items enable row level security;

do $$
begin
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'profiles' and policyname = 'profiles_authenticated_read') then
    create policy profiles_authenticated_read on public.profiles
      for select to authenticated
      using (auth.uid() = auth_user_id or public.has_role(array['Admin', 'Management']));
  end if;

  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'profiles' and policyname = 'profiles_self_update_basic') then
    create policy profiles_self_update_basic on public.profiles
      for update to authenticated
      using (auth.uid() = auth_user_id or public.has_role(array['Admin']))
      with check (auth.uid() = auth_user_id or public.has_role(array['Admin']));
  end if;

  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'user_roles' and policyname = 'user_roles_authenticated_read') then
    create policy user_roles_authenticated_read on public.user_roles
      for select to authenticated
      using (user_id = auth.uid() or public.has_role(array['Admin', 'Management']));
  end if;

  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'role_permissions' and policyname = 'role_permissions_authenticated_read') then
    create policy role_permissions_authenticated_read on public.role_permissions
      for select to authenticated
      using (true);
  end if;

  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'notifications' and policyname = 'notifications_owner_or_role_read') then
    create policy notifications_owner_or_role_read on public.notifications
      for select to authenticated
      using (
        recipient_user_id = auth.uid()
        or recipient_role = public.current_user_role()
        or public.has_role(array['Admin', 'Management'])
      );
  end if;

  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'notifications' and policyname = 'notifications_owner_update_read_state') then
    create policy notifications_owner_update_read_state on public.notifications
      for update to authenticated
      using (
        recipient_user_id = auth.uid()
        or recipient_role = public.current_user_role()
        or public.has_role(array['Admin', 'Management'])
      )
      with check (
        recipient_user_id = auth.uid()
        or recipient_role = public.current_user_role()
        or public.has_role(array['Admin', 'Management'])
      );
  end if;

  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'workflow_instances' and policyname = 'workflow_instances_authenticated_read') then
    create policy workflow_instances_authenticated_read on public.workflow_instances
      for select to authenticated
      using (true);
  end if;

  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'workflow_instances' and policyname = 'workflow_instances_role_write') then
    create policy workflow_instances_role_write on public.workflow_instances
      for all to authenticated
      using (public.can_update_workflow())
      with check (public.can_update_workflow());
  end if;

  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'workflow_assignments' and policyname = 'workflow_assignments_authenticated_read') then
    create policy workflow_assignments_authenticated_read on public.workflow_assignments
      for select to authenticated
      using (true);
  end if;

  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'workflow_assignments' and policyname = 'workflow_assignments_role_write') then
    create policy workflow_assignments_role_write on public.workflow_assignments
      for all to authenticated
      using (public.can_update_workflow())
      with check (public.can_update_workflow());
  end if;

  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'approval_decisions' and policyname = 'approval_decisions_authenticated_read') then
    create policy approval_decisions_authenticated_read on public.approval_decisions
      for select to authenticated
      using (true);
  end if;

  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'approval_decisions' and policyname = 'approval_decisions_role_insert') then
    create policy approval_decisions_role_insert on public.approval_decisions
      for insert to authenticated
      with check (public.has_permission('approval.decide') or public.has_role(array['Admin']));
  end if;
end $$;

-- Staged permissive authenticated read/write policies for foundation tables that are written through security-definer RPCs.
-- These are intentionally not final hardening policies.
do $$
declare
  v_table text;
begin
  foreach v_table in array array[
    'workflow_events',
    'assessment_sections',
    'assessment_section_versions',
    'assessment_drafts',
    'proposals',
    'proposal_versions',
    'proposal_line_items',
    'notification_logs'
  ]
  loop
    if not exists (
      select 1 from pg_policies
      where schemaname = 'public'
        and tablename = v_table
        and policyname = v_table || '_authenticated_staged'
    ) then
      execute format(
        'create policy %I on public.%I for all to authenticated using (true) with check (true)',
        v_table || '_authenticated_staged',
        v_table
      );
    end if;
  end loop;
end $$;
