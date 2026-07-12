-- 018: Fault Tracker persistence for Reliance Retail IFMS daily dump tracking.
-- Keeps imported batches for audit/history and stores normalized ticket rows.

create extension if not exists pgcrypto;

create or replace function public.fault_tracker_normalize_key(p_value text)
returns text
language sql
immutable
as $$
  select regexp_replace(upper(btrim(coalesce(p_value, ''))), '[^A-Z0-9]+', '', 'g');
$$;

create or replace function public.fault_tracker_state_code(p_state text)
returns text
language sql
immutable
as $$
  select case public.fault_tracker_normalize_key(p_state)
    when 'TN' then 'TN'
    when 'TAMILNADU' then 'TN'
    when 'ROTN' then 'TN'
    when 'KL' then 'KL'
    when 'KERALA' then 'KL'
    when 'KERALA1' then 'KL'
    when 'KERALA2' then 'KL'
    when 'KA' then 'KN'
    when 'KN' then 'KN'
    when 'KARNATAKA' then 'KN'
    when 'KARNATAKA1' then 'KN'
    when 'KARNATAKA2' then 'KN'
    when 'KARNATAKA3' then 'KN'
    when 'TG' then 'TG'
    when 'TELANGANA' then 'TG'
    when 'TELANGANA1' then 'TG'
    when 'TELANGANA2' then 'TG'
    when 'AP1' then 'AP1'
    when 'ANDHRAPRADESH1' then 'AP1'
    when 'AP2' then 'AP2'
    when 'ANDHRAPRADESH2' then 'AP2'
    else null
  end;
$$;

create or replace function public.fault_tracker_current_profile()
returns public.profiles
language sql
stable
security definer
set search_path = public
as $$
  select p
  from public.profiles p
  where p.auth_user_id = auth.uid()
    and coalesce(p.is_active, true) = true
  order by p.created_at desc
  limit 1;
$$;

create or replace function public.fault_tracker_current_role_key()
returns text
language sql
stable
security definer
set search_path = public
as $$
  select public.fault_tracker_normalize_key((public.fault_tracker_current_profile()).role);
$$;

create or replace function public.fault_tracker_current_state_code()
returns text
language sql
stable
security definer
set search_path = public
as $$
  select public.fault_tracker_state_code((public.fault_tracker_current_profile()).state);
$$;

create or replace function public.fault_tracker_can_manage()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.fault_tracker_current_role_key() in (
    'ADMIN',
    'QPMSADMIN',
    'DEVELOPER',
    'DEV',
    'ITADMIN',
    'MANAGEMENTITADMIN'
  );
$$;

create or replace function public.fault_tracker_can_read_all()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.fault_tracker_current_role_key() in (
    'ADMIN',
    'QPMSADMIN',
    'DEVELOPER',
    'DEV',
    'ITADMIN',
    'MANAGEMENTITADMIN',
    'COO',
    'IFMSSOUTHHEAD',
    'SOUTHHEAD',
    'OPERATIONMANAGER',
    'OPERATIONSMANAGER',
    'OPSMANAGER',
    'BRANCHHEAD'
  );
$$;

create or replace function public.fault_tracker_can_access()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.fault_tracker_can_read_all()
    or public.fault_tracker_current_role_key() in ('PROJECTCOORDINATOR', 'MIS');
$$;

create table if not exists public.fault_tracker_import_batches (
  id uuid primary key default gen_random_uuid(),
  uploaded_by_auth_user_id uuid null,
  uploaded_by_employee_code text null,
  uploaded_by_name text null,
  uploaded_by_role text null,
  source_name text not null default 'Reliance Retail IFMS',
  original_file_name text null,
  sheet_name text null,
  imported_at timestamptz not null default now(),
  ticket_count integer not null default 0,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create table if not exists public.fault_tracker_tickets (
  id uuid primary key default gen_random_uuid(),
  import_batch_id uuid not null references public.fault_tracker_import_batches(id) on delete cascade,
  ticket_no text not null,
  created_at_source timestamptz null,
  updated_at_source timestamptz null,
  store_code text null,
  store_name text null,
  city text null,
  state_code text null,
  state_label text null,
  category text null,
  category_group text null,
  stage text null,
  stage_group text null,
  ageing_days integer null,
  ageing_bucket text null,
  supervisor_name text null,
  supervisor_employee_code text null,
  supervisor_mobile text null,
  supervisor_email text null,
  vendor_name text null,
  vendor_code text null,
  remarks text null,
  raw_row jsonb not null default '{}'::jsonb,
  metadata jsonb not null default '{}'::jsonb,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint fault_tracker_tickets_import_ticket_unique unique (import_batch_id, ticket_no)
);

create table if not exists public.fault_tracker_ticket_updates (
  id uuid primary key default gen_random_uuid(),
  ticket_id uuid not null references public.fault_tracker_tickets(id) on delete cascade,
  updated_by_auth_user_id uuid null,
  updated_by_employee_code text null,
  update_type text null,
  previous_stage text null,
  new_stage text null,
  remarks text null,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists idx_fault_tracker_import_batches_imported_at
  on public.fault_tracker_import_batches (imported_at desc);

create index if not exists idx_fault_tracker_tickets_import_batch_id
  on public.fault_tracker_tickets (import_batch_id);

create index if not exists idx_fault_tracker_tickets_ticket_no
  on public.fault_tracker_tickets (ticket_no);

create index if not exists idx_fault_tracker_tickets_state_code
  on public.fault_tracker_tickets (state_code);

create index if not exists idx_fault_tracker_tickets_stage_group
  on public.fault_tracker_tickets (stage_group);

create index if not exists idx_fault_tracker_tickets_ageing_bucket
  on public.fault_tracker_tickets (ageing_bucket);

create index if not exists idx_fault_tracker_tickets_category_group
  on public.fault_tracker_tickets (category_group);

create index if not exists idx_fault_tracker_tickets_supervisor_name
  on public.fault_tracker_tickets (supervisor_name);

create index if not exists idx_fault_tracker_tickets_created_at_source
  on public.fault_tracker_tickets (created_at_source);

create index if not exists idx_fault_tracker_ticket_updates_ticket_id
  on public.fault_tracker_ticket_updates (ticket_id);

alter table public.fault_tracker_import_batches enable row level security;
alter table public.fault_tracker_tickets enable row level security;
alter table public.fault_tracker_ticket_updates enable row level security;

drop policy if exists "fault tracker batches read" on public.fault_tracker_import_batches;
create policy "fault tracker batches read"
  on public.fault_tracker_import_batches
  for select
  to authenticated
  using (public.fault_tracker_can_access());

drop policy if exists "fault tracker batches manage" on public.fault_tracker_import_batches;
create policy "fault tracker batches manage"
  on public.fault_tracker_import_batches
  for all
  to authenticated
  using (public.fault_tracker_can_manage())
  with check (public.fault_tracker_can_manage());

drop policy if exists "fault tracker tickets read" on public.fault_tracker_tickets;
create policy "fault tracker tickets read"
  on public.fault_tracker_tickets
  for select
  to authenticated
  using (
    public.fault_tracker_can_read_all()
    or (
      public.fault_tracker_current_role_key() in ('PROJECTCOORDINATOR', 'MIS')
      and state_code is not null
      and state_code = public.fault_tracker_current_state_code()
    )
  );

drop policy if exists "fault tracker tickets manage" on public.fault_tracker_tickets;
create policy "fault tracker tickets manage"
  on public.fault_tracker_tickets
  for all
  to authenticated
  using (public.fault_tracker_can_manage())
  with check (public.fault_tracker_can_manage());

drop policy if exists "fault tracker ticket updates read" on public.fault_tracker_ticket_updates;
create policy "fault tracker ticket updates read"
  on public.fault_tracker_ticket_updates
  for select
  to authenticated
  using (
    public.fault_tracker_can_read_all()
    or exists (
      select 1
      from public.fault_tracker_tickets t
      where t.id = ticket_id
        and t.state_code = public.fault_tracker_current_state_code()
        and public.fault_tracker_current_role_key() in ('PROJECTCOORDINATOR', 'MIS')
    )
  );

drop policy if exists "fault tracker ticket updates manage" on public.fault_tracker_ticket_updates;
create policy "fault tracker ticket updates manage"
  on public.fault_tracker_ticket_updates
  for all
  to authenticated
  using (public.fault_tracker_can_manage())
  with check (public.fault_tracker_can_manage());

grant execute on function public.fault_tracker_normalize_key(text) to authenticated;
grant execute on function public.fault_tracker_state_code(text) to authenticated;
grant execute on function public.fault_tracker_current_profile() to authenticated;
grant execute on function public.fault_tracker_current_role_key() to authenticated;
grant execute on function public.fault_tracker_current_state_code() to authenticated;
grant execute on function public.fault_tracker_can_manage() to authenticated;
grant execute on function public.fault_tracker_can_read_all() to authenticated;
grant execute on function public.fault_tracker_can_access() to authenticated;

grant select, insert, update, delete on public.fault_tracker_import_batches to authenticated;
grant select, insert, update, delete on public.fault_tracker_tickets to authenticated;
grant select, insert, update, delete on public.fault_tracker_ticket_updates to authenticated;
