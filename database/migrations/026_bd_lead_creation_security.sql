-- Phase 1 BD Lead Creation bootstrap, security, and atomic persistence.
--
-- This migration is intentionally self-contained. The current Supabase project
-- did not receive database/migrations/001-025 in sequence.
--
-- Scope:
--   - Reuse the existing operational public.profiles table.
--   - Create only Phase 1 BD lead tables and compatibility-only lead_mom.
--   - Do not create or alter public.site_visits or public.fo_site_visits.
--   - Do not alter FO, KM, travel, activity-upload, Store Master, or Fault
--     Tracker tables/functions/policies.
--
-- Apply manually in a transaction after running the companion preflight SQL.

begin;

create extension if not exists "pgcrypto";

-- The Phase 1 backend resolves authorization from the existing active profile.
-- Fail clearly if the new Supabase account has an incompatible profile shape.
do $$
declare
  v_missing text;
begin
  if to_regclass('public.profiles') is null then
    raise exception 'BD bootstrap requires the existing public.profiles table.';
  end if;

  select string_agg(required.column_name, ', ' order by required.column_name)
  into v_missing
  from (
    values
      ('id', 'uuid'),
      ('auth_user_id', 'uuid'),
      ('employee_code', 'text'),
      ('full_name', 'text'),
      ('display_name', 'text'),
      ('email', 'text'),
      ('role', 'text'),
      ('status', 'text'),
      ('is_active', 'bool'),
      ('state', 'text')
  ) as required(column_name, udt_name)
  left join information_schema.columns c
    on c.table_schema = 'public'
   and c.table_name = 'profiles'
   and c.column_name = required.column_name
   and c.udt_name = required.udt_name
  where c.column_name is null;

  if v_missing is not null then
    raise exception 'public.profiles is missing required columns or types: %', v_missing;
  end if;
end $$;

alter table public.profiles
  add column if not exists business text,
  add column if not exists branch text;

do $$
begin
  if exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'profiles'
      and column_name in ('business', 'branch')
      and udt_name <> 'text'
  ) then
    raise exception 'public.profiles business and branch columns must use text type.';
  end if;
end $$;

create table if not exists public.leads (
  id uuid primary key default gen_random_uuid(),
  lead_code text,
  client_name text not null,
  company_name text,
  industry_type text not null,
  lead_source text not null,
  site_location text not null,
  state text not null,
  city text not null,
  business text,
  branch text,
  lead_priority text not null default 'Medium',
  service_scope jsonb not null default '[]'::jsonb,
  remarks text,
  assigned_bd_executive text,
  assigned_bd_email text,
  created_by_user_id text not null,
  created_by_name text not null,
  lead_stage text not null default 'New Lead',
  status text not null default 'Active',
  metadata jsonb not null default '{}'::jsonb,
  idempotency_key text not null,
  normalized_client_name text not null,
  normalized_site_location text not null,
  primary_contact_phone_normalized text,
  primary_contact_email_normalized text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint bd_leads_client_name_required check (btrim(client_name) <> ''),
  constraint bd_leads_site_location_required check (btrim(site_location) <> ''),
  constraint bd_leads_service_scope_array check (jsonb_typeof(service_scope) = 'array'),
  constraint bd_leads_metadata_object check (jsonb_typeof(metadata) = 'object'),
  constraint bd_leads_idempotency_key_length check (length(idempotency_key) between 1 and 160)
);

create table if not exists public.lead_contacts (
  id uuid primary key default gen_random_uuid(),
  lead_id uuid not null,
  contact_person_name text not null,
  contact_person_designation text,
  contact_number text,
  email_id text,
  is_primary boolean not null default false,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint bd_lead_contacts_name_required check (btrim(contact_person_name) <> ''),
  constraint bd_lead_contacts_phone_or_email_required check (
    nullif(btrim(contact_number), '') is not null
    or nullif(btrim(email_id), '') is not null
  ),
  constraint bd_lead_contacts_metadata_object check (jsonb_typeof(metadata) = 'object')
);

create table if not exists public.activity_logs (
  id uuid primary key default gen_random_uuid(),
  lead_id uuid not null,
  activity_type text not null,
  activity_message text,
  created_by text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint bd_activity_logs_type_required check (btrim(activity_type) <> ''),
  constraint bd_activity_logs_metadata_object check (jsonb_typeof(metadata) = 'object')
);

-- The current CRM page reads lead_mom while loading Lead Management. Phase 1
-- does not implement or grant browser mutation of MOM data, but this compatible
-- table prevents the lead page from depending on an absent legacy table.
create table if not exists public.lead_mom (
  id uuid primary key default gen_random_uuid(),
  lead_id uuid not null,
  to_email text,
  cc_emails text,
  subject text,
  discussion_summary text,
  service_scope_discussion text,
  action_items text,
  next_followup_date date,
  scheduled_site_visit_date date,
  scheduled_site_visit_time time,
  site_visit_remarks text,
  calendar_invite_sent boolean not null default false,
  mom_status text not null default 'Draft',
  sent_at timestamptz,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint bd_lead_mom_metadata_object check (jsonb_typeof(metadata) = 'object')
);

-- CREATE TABLE IF NOT EXISTS must not silently accept a legacy object with an
-- incompatible runtime shape. Validate every column used by Phase 1 code.
do $$
declare
  v_problem text;
begin
  select string_agg(
    expected.table_name || '.' || expected.column_name || ' expected ' || expected.udt_name,
    '; ' order by expected.table_name, expected.ordinal
  )
  into v_problem
  from (
    values
      (1, 'leads', 'id', 'uuid'),
      (2, 'leads', 'lead_code', 'text'),
      (3, 'leads', 'client_name', 'text'),
      (4, 'leads', 'company_name', 'text'),
      (5, 'leads', 'industry_type', 'text'),
      (6, 'leads', 'lead_source', 'text'),
      (7, 'leads', 'site_location', 'text'),
      (8, 'leads', 'state', 'text'),
      (9, 'leads', 'city', 'text'),
      (10, 'leads', 'business', 'text'),
      (11, 'leads', 'branch', 'text'),
      (12, 'leads', 'lead_priority', 'text'),
      (13, 'leads', 'service_scope', 'jsonb'),
      (14, 'leads', 'remarks', 'text'),
      (15, 'leads', 'assigned_bd_executive', 'text'),
      (16, 'leads', 'assigned_bd_email', 'text'),
      (17, 'leads', 'created_by_user_id', 'text'),
      (18, 'leads', 'created_by_name', 'text'),
      (19, 'leads', 'lead_stage', 'text'),
      (20, 'leads', 'status', 'text'),
      (21, 'leads', 'metadata', 'jsonb'),
      (22, 'leads', 'idempotency_key', 'text'),
      (23, 'leads', 'normalized_client_name', 'text'),
      (24, 'leads', 'normalized_site_location', 'text'),
      (25, 'leads', 'primary_contact_phone_normalized', 'text'),
      (26, 'leads', 'primary_contact_email_normalized', 'text'),
      (27, 'leads', 'created_at', 'timestamptz'),
      (28, 'leads', 'updated_at', 'timestamptz'),
      (29, 'lead_contacts', 'id', 'uuid'),
      (30, 'lead_contacts', 'lead_id', 'uuid'),
      (31, 'lead_contacts', 'contact_person_name', 'text'),
      (32, 'lead_contacts', 'contact_person_designation', 'text'),
      (33, 'lead_contacts', 'contact_number', 'text'),
      (34, 'lead_contacts', 'email_id', 'text'),
      (35, 'lead_contacts', 'is_primary', 'bool'),
      (36, 'lead_contacts', 'metadata', 'jsonb'),
      (37, 'lead_contacts', 'created_at', 'timestamptz'),
      (38, 'lead_contacts', 'updated_at', 'timestamptz'),
      (39, 'activity_logs', 'id', 'uuid'),
      (40, 'activity_logs', 'lead_id', 'uuid'),
      (41, 'activity_logs', 'activity_type', 'text'),
      (42, 'activity_logs', 'activity_message', 'text'),
      (43, 'activity_logs', 'created_by', 'text'),
      (44, 'activity_logs', 'metadata', 'jsonb'),
      (45, 'activity_logs', 'created_at', 'timestamptz'),
      (46, 'activity_logs', 'updated_at', 'timestamptz'),
      (47, 'lead_mom', 'id', 'uuid'),
      (48, 'lead_mom', 'lead_id', 'uuid'),
      (49, 'lead_mom', 'to_email', 'text'),
      (50, 'lead_mom', 'cc_emails', 'text'),
      (51, 'lead_mom', 'subject', 'text'),
      (52, 'lead_mom', 'discussion_summary', 'text'),
      (53, 'lead_mom', 'service_scope_discussion', 'text'),
      (54, 'lead_mom', 'action_items', 'text'),
      (55, 'lead_mom', 'next_followup_date', 'date'),
      (56, 'lead_mom', 'scheduled_site_visit_date', 'date'),
      (57, 'lead_mom', 'scheduled_site_visit_time', 'time'),
      (58, 'lead_mom', 'site_visit_remarks', 'text'),
      (59, 'lead_mom', 'calendar_invite_sent', 'bool'),
      (60, 'lead_mom', 'mom_status', 'text'),
      (61, 'lead_mom', 'sent_at', 'timestamptz'),
      (62, 'lead_mom', 'metadata', 'jsonb'),
      (63, 'lead_mom', 'created_at', 'timestamptz'),
      (64, 'lead_mom', 'updated_at', 'timestamptz')
  ) as expected(ordinal, table_name, column_name, udt_name)
  left join information_schema.columns c
    on c.table_schema = 'public'
   and c.table_name = expected.table_name
   and c.column_name = expected.column_name
   and c.udt_name = expected.udt_name
  where c.column_name is null;

  if v_problem is not null then
    raise exception 'Existing CRM objects are structurally incompatible: %', v_problem;
  end if;

  select string_agg(required.table_name, ', ' order by required.table_name)
  into v_problem
  from (
    values ('leads'), ('lead_contacts'), ('activity_logs'), ('lead_mom')
  ) as required(table_name)
  where not exists (
    select 1
    from pg_constraint con
    join pg_class rel on rel.oid = con.conrelid
    join pg_namespace n on n.oid = rel.relnamespace
    where n.nspname = 'public'
      and rel.relname = required.table_name
      and con.contype = 'p'
      and pg_get_constraintdef(con.oid) = 'PRIMARY KEY (id)'
  );

  if v_problem is not null then
    raise exception 'CRM tables missing PRIMARY KEY (id): %', v_problem;
  end if;
end $$;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.lead_contacts'::regclass
      and confrelid = 'public.leads'::regclass
      and contype = 'f'
      and pg_get_constraintdef(oid) like 'FOREIGN KEY (lead_id) REFERENCES leads(id)%'
  ) then
    alter table public.lead_contacts
      add constraint bd_lead_contacts_lead_id_fkey
      foreign key (lead_id) references public.leads(id) on delete cascade;
  end if;

  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.activity_logs'::regclass
      and confrelid = 'public.leads'::regclass
      and contype = 'f'
      and pg_get_constraintdef(oid) like 'FOREIGN KEY (lead_id) REFERENCES leads(id)%'
  ) then
    alter table public.activity_logs
      add constraint bd_activity_logs_lead_id_fkey
      foreign key (lead_id) references public.leads(id) on delete cascade;
  end if;

  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.lead_mom'::regclass
      and confrelid = 'public.leads'::regclass
      and contype = 'f'
      and pg_get_constraintdef(oid) like 'FOREIGN KEY (lead_id) REFERENCES leads(id)%'
  ) then
    alter table public.lead_mom
      add constraint bd_lead_mom_lead_id_fkey
      foreign key (lead_id) references public.leads(id) on delete cascade;
  end if;
end $$;

create unique index if not exists ux_bd_leads_lead_code
  on public.leads(lead_code)
  where lead_code is not null;

create unique index if not exists ux_bd_leads_creator_idempotency
  on public.leads(created_by_user_id, idempotency_key);

create index if not exists idx_bd_leads_status_stage
  on public.leads(status, lead_stage);

create index if not exists idx_bd_leads_assigned_email
  on public.leads(lower(assigned_bd_email))
  where assigned_bd_email is not null;

create index if not exists idx_bd_leads_normalized_duplicate_lookup
  on public.leads(normalized_client_name, state, city, normalized_site_location);

create index if not exists idx_bd_leads_business_state_branch
  on public.leads(business, state, branch);

create index if not exists idx_bd_leads_created_at
  on public.leads(created_at desc);

create index if not exists idx_bd_lead_contacts_lead_id
  on public.lead_contacts(lead_id, created_at);

create unique index if not exists ux_bd_lead_contacts_one_primary
  on public.lead_contacts(lead_id)
  where is_primary = true;

create unique index if not exists ux_bd_lead_contacts_email_normalized
  on public.lead_contacts(lead_id, lower(email_id))
  where nullif(btrim(email_id), '') is not null;

create index if not exists idx_bd_activity_logs_lead_created
  on public.activity_logs(lead_id, created_at desc);

create unique index if not exists ux_bd_lead_mom_lead_id
  on public.lead_mom(lead_id);

create or replace function public.bd_lead_set_updated_at()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists trg_bd_leads_updated_at on public.leads;
create trigger trg_bd_leads_updated_at
before update on public.leads
for each row execute function public.bd_lead_set_updated_at();

drop trigger if exists trg_bd_lead_contacts_updated_at on public.lead_contacts;
create trigger trg_bd_lead_contacts_updated_at
before update on public.lead_contacts
for each row execute function public.bd_lead_set_updated_at();

drop trigger if exists trg_bd_activity_logs_updated_at on public.activity_logs;
create trigger trg_bd_activity_logs_updated_at
before update on public.activity_logs
for each row execute function public.bd_lead_set_updated_at();

drop trigger if exists trg_bd_lead_mom_updated_at on public.lead_mom;
create trigger trg_bd_lead_mom_updated_at
before update on public.lead_mom
for each row execute function public.bd_lead_set_updated_at();

create or replace function public.normalize_bd_lead_text(p_value text)
returns text
language sql
immutable
parallel safe
set search_path = public, pg_temp
as $$
  select nullif(btrim(regexp_replace(lower(coalesce(p_value, '')), '[^a-z0-9]+', ' ', 'g')), '')
$$;

create or replace function public.normalize_bd_lead_phone(p_value text)
returns text
language sql
immutable
parallel safe
set search_path = public, pg_temp
as $$
  with normalized as (
    select regexp_replace(coalesce(p_value, ''), '\D', '', 'g') as digits
  )
  select nullif(
    case
      when length(digits) = 12 and digits like '91%' then substring(digits from 3)
      when length(digits) = 11 and digits like '0%' then substring(digits from 2)
      else digits
    end,
    ''
  )
  from normalized
$$;

create unique index if not exists ux_bd_lead_contacts_phone_normalized
  on public.lead_contacts(lead_id, public.normalize_bd_lead_phone(contact_number))
  where public.normalize_bd_lead_phone(contact_number) is not null;

create or replace function public.current_bd_lead_profile_value(p_key text)
returns text
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select case p_key
    when 'role' then p.role
    when 'email' then lower(p.email)
    when 'state' then p.state
    when 'business' then p.business
    when 'branch' then p.branch
    when 'profile_id' then p.id::text
    when 'employee_code' then p.employee_code
    else null
  end
  from public.profiles p
  where p.auth_user_id = auth.uid()
    and coalesce(p.is_active, false) = true
    and lower(coalesce(p.status, 'active')) = 'active'
  limit 1
$$;

create or replace function public.current_bd_lead_role()
returns text
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select case regexp_replace(upper(coalesce(public.current_bd_lead_profile_value('role'), '')), '[^A-Z0-9]+', '', 'g')
    when 'BDEXECUTIVE' then 'BD Executive'
    when 'BUSINESSDEVELOPMENTEXECUTIVE' then 'BD Executive'
    when 'BDHEAD' then 'BD Head'
    when 'BUSINESSDEVELOPMENTHEAD' then 'BD Head'
    when 'BUSINESSHEAD' then 'Business Head'
    when 'BRANCHHEAD' then 'Branch Head'
    when 'BH' then 'Branch Head'
    when 'ADMIN' then 'Admin'
    when 'QPMSADMIN' then 'QPMS Admin'
    when 'DEVELOPER' then 'Developer'
    when 'DEV' then 'Developer'
    when 'ITADMIN' then 'Developer'
    when 'MANAGEMENTITADMIN' then 'Developer'
    when 'COO' then 'COO'
    when 'MD' then 'MD'
    else public.current_bd_lead_profile_value('role')
  end
$$;

create or replace function public.can_current_user_view_bd_lead(p_lead public.leads)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select case
    when public.current_bd_lead_role() in ('BD Head', 'Admin', 'QPMS Admin', 'Developer', 'COO', 'MD') then true
    when public.current_bd_lead_role() = 'BD Executive' then
      lower(coalesce(p_lead.assigned_bd_email, '')) = lower(coalesce(public.current_bd_lead_profile_value('email'), ''))
      or p_lead.created_by_user_id = auth.uid()::text
      or p_lead.created_by_user_id = public.current_bd_lead_profile_value('profile_id')
    when public.current_bd_lead_role() = 'Business Head' then
      nullif(public.current_bd_lead_profile_value('business'), '') is not null
      and public.normalize_bd_lead_text(p_lead.business) = public.normalize_bd_lead_text(public.current_bd_lead_profile_value('business'))
    when public.current_bd_lead_role() = 'Branch Head' then
      nullif(public.current_bd_lead_profile_value('state'), '') is not null
      and public.normalize_bd_lead_text(p_lead.state) = public.normalize_bd_lead_text(public.current_bd_lead_profile_value('state'))
      and (
        nullif(public.current_bd_lead_profile_value('branch'), '') is null
        or nullif(p_lead.branch, '') is null
        or public.normalize_bd_lead_text(p_lead.branch) = public.normalize_bd_lead_text(public.current_bd_lead_profile_value('branch'))
      )
      and (
        nullif(public.current_bd_lead_profile_value('business'), '') is null
        or nullif(p_lead.business, '') is null
        or public.normalize_bd_lead_text(p_lead.business) = public.normalize_bd_lead_text(public.current_bd_lead_profile_value('business'))
      )
    else false
  end
$$;

revoke all on function public.bd_lead_set_updated_at() from public;
revoke all on function public.normalize_bd_lead_text(text) from public;
revoke all on function public.normalize_bd_lead_phone(text) from public;
revoke all on function public.current_bd_lead_profile_value(text) from public;
revoke all on function public.current_bd_lead_role() from public;
revoke all on function public.can_current_user_view_bd_lead(public.leads) from public;
grant execute on function public.current_bd_lead_profile_value(text) to authenticated;
grant execute on function public.current_bd_lead_role() to authenticated;
grant execute on function public.can_current_user_view_bd_lead(public.leads) to authenticated;

-- Remove every pre-existing policy from these module-owned tables. This avoids
-- retaining a legacy permissive policy when bootstrapping onto a reused schema.
do $$
declare
  v_policy record;
begin
  for v_policy in
    select schemaname, tablename, policyname
    from pg_policies
    where schemaname = 'public'
      and tablename in ('leads', 'lead_contacts', 'activity_logs', 'lead_mom')
  loop
    execute format('drop policy if exists %I on %I.%I', v_policy.policyname, v_policy.schemaname, v_policy.tablename);
  end loop;
end $$;

alter table public.leads enable row level security;
alter table public.lead_contacts enable row level security;
alter table public.activity_logs enable row level security;
alter table public.lead_mom enable row level security;

create policy bd_leads_visible_select on public.leads
for select to authenticated
using (public.can_current_user_view_bd_lead(leads));

create policy bd_lead_contacts_visible_select on public.lead_contacts
for select to authenticated
using (exists (
  select 1
  from public.leads l
  where l.id = lead_contacts.lead_id
    and public.can_current_user_view_bd_lead(l)
));

create policy bd_activity_logs_visible_select on public.activity_logs
for select to authenticated
using (exists (
  select 1
  from public.leads l
  where l.id = activity_logs.lead_id
    and public.can_current_user_view_bd_lead(l)
));

create policy bd_lead_mom_visible_select on public.lead_mom
for select to authenticated
using (exists (
  select 1
  from public.leads l
  where l.id = lead_mom.lead_id
    and public.can_current_user_view_bd_lead(l)
));

revoke all on public.leads, public.lead_contacts, public.activity_logs, public.lead_mom from public;
revoke all on public.leads, public.lead_contacts, public.activity_logs, public.lead_mom from anon;
revoke all on public.leads, public.lead_contacts, public.activity_logs, public.lead_mom from authenticated;
grant select on public.leads, public.lead_contacts, public.activity_logs, public.lead_mom to authenticated;
grant all on public.leads, public.lead_contacts, public.activity_logs, public.lead_mom to service_role;

create or replace function public.rpc_create_bd_lead_atomic(
  p_lead jsonb,
  p_contacts jsonb,
  p_actor jsonb,
  p_idempotency_key text
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_existing public.leads%rowtype;
  v_lead public.leads%rowtype;
  v_contact jsonb;
  v_contacts jsonb := coalesce(p_contacts, '[]'::jsonb);
  v_contact_rows jsonb;
  v_actor_id text := nullif(btrim(p_actor ->> 'auth_user_id'), '');
  v_actor_name text := nullif(btrim(p_actor ->> 'name'), '');
  v_idempotency_key text := nullif(btrim(p_idempotency_key), '');
  v_primary_count integer;
  v_primary_phone text;
  v_primary_email text;
begin
  if jsonb_typeof(coalesce(p_lead, '{}'::jsonb)) <> 'object'
     or jsonb_typeof(coalesce(p_actor, '{}'::jsonb)) <> 'object' then
    raise exception 'Lead and actor payloads must be JSON objects.' using errcode = '22023';
  end if;
  if v_actor_id is null or v_actor_name is null then
    raise exception 'Authenticated actor ID and name are required.' using errcode = '22023';
  end if;
  if v_idempotency_key is null or length(v_idempotency_key) > 160 then
    raise exception 'A valid idempotency key is required.' using errcode = '22023';
  end if;
  if nullif(btrim(p_lead ->> 'client_name'), '') is null
     or nullif(btrim(p_lead ->> 'site_location'), '') is null
     or nullif(btrim(p_lead ->> 'state'), '') is null
     or nullif(btrim(p_lead ->> 'city'), '') is null then
    raise exception 'Client, site location, state, and city are required.' using errcode = '22023';
  end if;
  if jsonb_typeof(v_contacts) <> 'array' or jsonb_array_length(v_contacts) = 0 then
    raise exception 'At least one contact is required.' using errcode = '22023';
  end if;

  select count(*) filter (
    where coalesce((contact ->> 'is_primary')::boolean, false)
  )
  into v_primary_count
  from jsonb_array_elements(v_contacts) contact;

  if v_primary_count <> 1 then
    raise exception 'Exactly one primary contact is required.' using errcode = '22023';
  end if;

  if exists (
    select 1
    from jsonb_array_elements(v_contacts) contact
    where nullif(btrim(contact ->> 'name'), '') is null
       or (
         nullif(btrim(contact ->> 'phone'), '') is null
         and nullif(btrim(contact ->> 'email'), '') is null
       )
  ) then
    raise exception 'Each contact requires a name and phone or email.' using errcode = '22023';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(v_actor_id || ':' || v_idempotency_key, 0));

  select *
  into v_existing
  from public.leads
  where created_by_user_id = v_actor_id
    and idempotency_key = v_idempotency_key
  limit 1;

  if found then
    select coalesce(jsonb_agg(to_jsonb(c) order by c.created_at), '[]'::jsonb)
    into v_contact_rows
    from public.lead_contacts c
    where c.lead_id = v_existing.id;

    return jsonb_build_object(
      'lead', to_jsonb(v_existing),
      'contacts', v_contact_rows,
      'idempotent_replay', true
    );
  end if;

  select
    public.normalize_bd_lead_phone(contact ->> 'phone'),
    nullif(lower(btrim(contact ->> 'email')), '')
  into v_primary_phone, v_primary_email
  from jsonb_array_elements(v_contacts) contact
  where coalesce((contact ->> 'is_primary')::boolean, false)
  limit 1;

  insert into public.leads (
    lead_code, client_name, company_name, industry_type, lead_source,
    site_location, state, city, business, branch, lead_priority,
    service_scope, remarks, assigned_bd_executive, assigned_bd_email,
    created_by_user_id, created_by_name, lead_stage, status, metadata,
    idempotency_key, normalized_client_name, normalized_site_location,
    primary_contact_phone_normalized, primary_contact_email_normalized
  ) values (
    nullif(btrim(p_lead ->> 'lead_code'), ''),
    btrim(p_lead ->> 'client_name'),
    coalesce(nullif(btrim(p_lead ->> 'company_name'), ''), btrim(p_lead ->> 'client_name')),
    btrim(p_lead ->> 'industry_type'),
    btrim(p_lead ->> 'lead_source'),
    btrim(p_lead ->> 'site_location'),
    btrim(p_lead ->> 'state'),
    btrim(p_lead ->> 'city'),
    nullif(btrim(p_lead ->> 'business'), ''),
    nullif(btrim(p_lead ->> 'branch'), ''),
    coalesce(nullif(btrim(p_lead ->> 'lead_priority'), ''), 'Medium'),
    coalesce(p_lead -> 'service_scope', '[]'::jsonb),
    nullif(btrim(p_lead ->> 'remarks'), ''),
    nullif(btrim(p_lead ->> 'assigned_bd_executive'), ''),
    nullif(lower(btrim(p_lead ->> 'assigned_bd_email')), ''),
    v_actor_id,
    v_actor_name,
    'New Lead',
    'Active',
    coalesce(p_lead -> 'metadata', '{}'::jsonb),
    v_idempotency_key,
    public.normalize_bd_lead_text(p_lead ->> 'client_name'),
    public.normalize_bd_lead_text(p_lead ->> 'site_location'),
    v_primary_phone,
    v_primary_email
  )
  returning * into v_lead;

  for v_contact in
    select value from jsonb_array_elements(v_contacts)
  loop
    insert into public.lead_contacts (
      lead_id, contact_person_name, contact_person_designation,
      contact_number, email_id, is_primary, metadata
    ) values (
      v_lead.id,
      btrim(v_contact ->> 'name'),
      nullif(btrim(v_contact ->> 'designation'), ''),
      nullif(btrim(v_contact ->> 'phone'), ''),
      nullif(lower(btrim(v_contact ->> 'email')), ''),
      coalesce((v_contact ->> 'is_primary')::boolean, false),
      jsonb_build_object(
        'phone_normalized', public.normalize_bd_lead_phone(v_contact ->> 'phone')
      )
    );
  end loop;

  insert into public.activity_logs (
    lead_id, activity_type, activity_message, created_by, metadata
  ) values (
    v_lead.id,
    'Lead Created',
    'Lead created',
    v_actor_name,
    jsonb_strip_nulls(jsonb_build_object(
      'source', coalesce(p_lead ->> 'source', 'authenticated_backend'),
      'idempotency_key', v_idempotency_key,
      'duplicate_override', p_lead #> '{metadata,duplicate_override}',
      'duplicate_override_reason', p_lead #>> '{metadata,duplicate_override_reason}'
    ))
  );

  select coalesce(jsonb_agg(to_jsonb(c) order by c.created_at), '[]'::jsonb)
  into v_contact_rows
  from public.lead_contacts c
  where c.lead_id = v_lead.id;

  return jsonb_build_object(
    'lead', to_jsonb(v_lead),
    'contacts', v_contact_rows,
    'idempotent_replay', false
  );
end;
$$;

create or replace function public.rpc_update_bd_lead_atomic(
  p_lead_id uuid,
  p_lead jsonb,
  p_contacts jsonb,
  p_actor jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_lead public.leads%rowtype;
  v_contact jsonb;
  v_contact_rows jsonb;
  v_primary_count integer;
  v_primary_phone text;
  v_primary_email text;
  v_actor_name text := nullif(btrim(p_actor ->> 'name'), '');
begin
  if p_lead_id is null or jsonb_typeof(coalesce(p_lead, '{}'::jsonb)) <> 'object' then
    raise exception 'Lead ID and lead payload are required.' using errcode = '22023';
  end if;
  if v_actor_name is null then
    raise exception 'Authenticated actor name is required.' using errcode = '22023';
  end if;
  if jsonb_typeof(p_contacts) <> 'array' or jsonb_array_length(p_contacts) = 0 then
    raise exception 'At least one contact is required.' using errcode = '22023';
  end if;

  select count(*) filter (
    where coalesce((contact ->> 'is_primary')::boolean, false)
  )
  into v_primary_count
  from jsonb_array_elements(p_contacts) contact;

  if v_primary_count <> 1 then
    raise exception 'Exactly one primary contact is required.' using errcode = '22023';
  end if;

  if exists (
    select 1
    from jsonb_array_elements(p_contacts) contact
    where nullif(btrim(contact ->> 'name'), '') is null
       or (
         nullif(btrim(contact ->> 'phone'), '') is null
         and nullif(btrim(contact ->> 'email'), '') is null
       )
  ) then
    raise exception 'Each contact requires a name and phone or email.' using errcode = '22023';
  end if;

  select * into v_lead
  from public.leads
  where id = p_lead_id
  for update;

  if not found then
    raise exception 'Lead not found.' using errcode = 'P0002';
  end if;

  select
    public.normalize_bd_lead_phone(contact ->> 'phone'),
    nullif(lower(btrim(contact ->> 'email')), '')
  into v_primary_phone, v_primary_email
  from jsonb_array_elements(p_contacts) contact
  where coalesce((contact ->> 'is_primary')::boolean, false)
  limit 1;

  update public.leads
  set
    client_name = btrim(p_lead ->> 'client_name'),
    company_name = coalesce(nullif(btrim(p_lead ->> 'company_name'), ''), btrim(p_lead ->> 'client_name')),
    industry_type = btrim(p_lead ->> 'industry_type'),
    lead_source = btrim(p_lead ->> 'lead_source'),
    site_location = btrim(p_lead ->> 'site_location'),
    state = btrim(p_lead ->> 'state'),
    city = btrim(p_lead ->> 'city'),
    business = case when p_lead ? 'business' then nullif(btrim(p_lead ->> 'business'), '') else business end,
    branch = case when p_lead ? 'branch' then nullif(btrim(p_lead ->> 'branch'), '') else branch end,
    lead_priority = btrim(p_lead ->> 'lead_priority'),
    service_scope = coalesce(p_lead -> 'service_scope', service_scope),
    remarks = nullif(btrim(p_lead ->> 'remarks'), ''),
    assigned_bd_executive = case
      when p_lead ? 'assigned_bd_executive' then nullif(btrim(p_lead ->> 'assigned_bd_executive'), '')
      else assigned_bd_executive
    end,
    assigned_bd_email = case
      when p_lead ? 'assigned_bd_email' then nullif(lower(btrim(p_lead ->> 'assigned_bd_email')), '')
      else assigned_bd_email
    end,
    lead_stage = btrim(p_lead ->> 'lead_stage'),
    status = btrim(p_lead ->> 'status'),
    normalized_client_name = public.normalize_bd_lead_text(p_lead ->> 'client_name'),
    normalized_site_location = public.normalize_bd_lead_text(p_lead ->> 'site_location'),
    primary_contact_phone_normalized = v_primary_phone,
    primary_contact_email_normalized = v_primary_email
  where id = p_lead_id
  returning * into v_lead;

  delete from public.lead_contacts where lead_id = p_lead_id;

  for v_contact in
    select value from jsonb_array_elements(p_contacts)
  loop
    insert into public.lead_contacts (
      lead_id, contact_person_name, contact_person_designation,
      contact_number, email_id, is_primary, metadata
    ) values (
      p_lead_id,
      btrim(v_contact ->> 'name'),
      nullif(btrim(v_contact ->> 'designation'), ''),
      nullif(btrim(v_contact ->> 'phone'), ''),
      nullif(lower(btrim(v_contact ->> 'email')), ''),
      coalesce((v_contact ->> 'is_primary')::boolean, false),
      jsonb_build_object(
        'phone_normalized', public.normalize_bd_lead_phone(v_contact ->> 'phone')
      )
    );
  end loop;

  insert into public.activity_logs (
    lead_id, activity_type, activity_message, created_by, metadata
  ) values (
    p_lead_id,
    'Lead Updated',
    'Lead updated through authenticated Lead Management',
    v_actor_name,
    jsonb_build_object(
      'source', 'authenticated_backend',
      'actor_role', p_actor ->> 'role'
    )
  );

  select coalesce(jsonb_agg(to_jsonb(c) order by c.created_at), '[]'::jsonb)
  into v_contact_rows
  from public.lead_contacts c
  where c.lead_id = p_lead_id;

  return jsonb_build_object('lead', to_jsonb(v_lead), 'contacts', v_contact_rows);
end;
$$;

revoke all on function public.rpc_create_bd_lead_atomic(jsonb, jsonb, jsonb, text) from public;
revoke all on function public.rpc_create_bd_lead_atomic(jsonb, jsonb, jsonb, text) from anon;
revoke all on function public.rpc_create_bd_lead_atomic(jsonb, jsonb, jsonb, text) from authenticated;
grant execute on function public.rpc_create_bd_lead_atomic(jsonb, jsonb, jsonb, text) to service_role;

revoke all on function public.rpc_update_bd_lead_atomic(uuid, jsonb, jsonb, jsonb) from public;
revoke all on function public.rpc_update_bd_lead_atomic(uuid, jsonb, jsonb, jsonb) from anon;
revoke all on function public.rpc_update_bd_lead_atomic(uuid, jsonb, jsonb, jsonb) from authenticated;
grant execute on function public.rpc_update_bd_lead_atomic(uuid, jsonb, jsonb, jsonb) to service_role;

comment on table public.leads is
  'Phase 1 BD Lead Creation records. Separate from FO operational visits and claims.';
comment on table public.lead_contacts is
  'Contacts owned by a Phase 1 BD lead.';
comment on table public.activity_logs is
  'Lead-level Phase 1 BD audit history; not FO activity submissions or uploads.';
comment on table public.lead_mom is
  'Compatibility foundation only; MOM workflow is outside Phase 1 Lead Creation.';
comment on function public.rpc_create_bd_lead_atomic(jsonb, jsonb, jsonb, text) is
  'Service-role-only atomic lead, contacts, and initial activity creation with actor-scoped idempotency.';
comment on function public.rpc_update_bd_lead_atomic(uuid, jsonb, jsonb, jsonb) is
  'Service-role-only atomic lead/contact update that preserves creator attribution.';

commit;
