-- Reconciled BD Site Visit + Estimation foundation.
-- This migration is additive. It must not recreate or replace modern lead/profile tables.

begin;

do $preflight$
declare
  v_table text;
  v_column text;
  v_type text;
begin
  foreach v_table in array array['leads', 'lead_contacts', 'profiles', 'activity_logs']
  loop
    if to_regclass(format('public.%I', v_table)) is null then
      raise exception 'BD Site Visit preflight failed: required table public.% is missing', v_table;
    end if;
  end loop;

  foreach v_table in array array['buckets', 'objects']
  loop
    if to_regclass(format('storage.%I', v_table)) is null then
      raise exception 'BD Site Visit preflight failed: required Supabase Storage table storage.% is missing',
        v_table;
    end if;
  end loop;

  foreach v_column in array array[
    'id', 'auth_user_id', 'employee_code', 'name', 'email', 'role', 'state', 'branch',
    'status', 'is_active', 'web_access_enabled'
  ]
  loop
    if not exists (
      select 1
      from information_schema.columns
      where table_schema = 'public'
        and table_name = 'profiles'
        and column_name = v_column
    ) then
      raise exception 'BD Site Visit preflight failed: public.profiles.% is missing', v_column;
    end if;
  end loop;

  select data_type into v_type
  from information_schema.columns
  where table_schema = 'public' and table_name = 'leads' and column_name = 'id';
  if v_type is distinct from 'uuid' then
    raise exception 'BD Site Visit preflight failed: public.leads.id must be uuid, found %', coalesce(v_type, 'missing');
  end if;

  foreach v_column in array array['id', 'auth_user_id']
  loop
    select data_type into v_type
    from information_schema.columns
    where table_schema = 'public' and table_name = 'profiles' and column_name = v_column;
    if v_type is distinct from 'uuid' then
      raise exception 'BD Site Visit preflight failed: public.profiles.% must be uuid, found %',
        v_column, coalesce(v_type, 'missing');
    end if;
  end loop;

  foreach v_column in array array['employee_code', 'name', 'email', 'role', 'state', 'branch']
  loop
    select data_type into v_type
    from information_schema.columns
    where table_schema = 'public' and table_name = 'profiles' and column_name = v_column;
    if v_type not in ('text', 'character varying') then
      raise exception 'BD Site Visit preflight failed: public.profiles.% must be text-compatible, found %',
        v_column, coalesce(v_type, 'missing');
    end if;
  end loop;

  foreach v_column in array array['is_active', 'web_access_enabled']
  loop
    select data_type into v_type
    from information_schema.columns
    where table_schema = 'public' and table_name = 'profiles' and column_name = v_column;
    if v_type is distinct from 'boolean' then
      raise exception 'BD Site Visit preflight failed: public.profiles.% must be boolean, found %',
        v_column, coalesce(v_type, 'missing');
    end if;
  end loop;
end
$preflight$;

create table if not exists public.site_visits (
  id uuid primary key default gen_random_uuid(),
  lead_id uuid not null references public.leads(id) on delete restrict,
  client_name text,
  site_name text,
  site_location text,
  scheduled_visit_date date,
  scheduled_visit_time time without time zone,
  status text not null default 'Scheduled',
  current_stage text not null default 'bd_survey',
  pending_with text not null default 'BD Executive',
  mom_status text not null default 'Pending',
  assigned_profile_id uuid references public.profiles(id) on delete set null,
  assigned_bd_executive text,
  assigned_bd_email text,
  created_by_profile_id uuid not null references public.profiles(id) on delete restrict,
  created_by_auth_user_id uuid not null,
  owner_state text,
  owner_branch text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint site_visits_one_per_lead unique (lead_id)
);

create table if not exists public.site_assessments (
  id uuid primary key default gen_random_uuid(),
  site_visit_id uuid not null references public.site_visits(id) on delete cascade,
  lead_id uuid not null references public.leads(id) on delete restrict,
  schema_version smallint not null default 1 check (schema_version >= 1),
  assessment_status text not null default 'Draft',
  status text not null default 'Draft',
  current_stage text not null default 'BD Survey',
  row_version bigint not null default 1 check (row_version >= 1),
  submitted_at timestamptz,
  submitted_by_profile_id uuid references public.profiles(id) on delete set null,
  submitted_by_auth_user_id uuid,
  survey_snapshot jsonb not null default '{}'::jsonb,
  commercial_costing_summary jsonb not null default '{}'::jsonb,
  basic_site_information jsonb not null default '{}'::jsonb,
  ifm_service_scope jsonb not null default '{}'::jsonb,
  hard_services jsonb not null default '{}'::jsonb,
  soft_services jsonb not null default '{}'::jsonb,
  landscaping_pest_control jsonb not null default '{}'::jsonb,
  hse_compliance jsonb not null default '[]'::jsonb,
  manpower_requirement jsonb not null default '{}'::jsonb,
  tools_equipment_consumables jsonb not null default '{}'::jsonb,
  client_kyc jsonb not null default '{}'::jsonb,
  risk_assessment jsonb not null default '{}'::jsonb,
  penalty_clauses jsonb not null default '{}'::jsonb,
  commercial_statement jsonb not null default '{}'::jsonb,
  approval_mechanism jsonb not null default '{}'::jsonb,
  final_remarks_signoff jsonb not null default '{}'::jsonb,
  final_remarks text,
  created_by text,
  created_by_profile_id uuid not null references public.profiles(id) on delete restrict,
  created_by_auth_user_id uuid not null,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint site_assessments_one_per_visit unique (site_visit_id)
);

create table if not exists public.assessment_sections (
  id uuid primary key default gen_random_uuid(),
  assessment_id uuid not null references public.site_assessments(id) on delete cascade,
  section_key text not null,
  section_name text,
  section_data jsonb not null default '{}'::jsonb,
  version bigint not null default 1 check (version >= 1),
  status text not null default 'Draft',
  saved_by_profile_id uuid not null references public.profiles(id) on delete restrict,
  saved_by_auth_user_id uuid not null,
  saved_at timestamptz not null default now(),
  metadata jsonb not null default '{}'::jsonb,
  constraint assessment_sections_current_unique unique (assessment_id, section_key)
);

create table if not exists public.assessment_section_versions (
  id uuid primary key default gen_random_uuid(),
  assessment_id uuid not null references public.site_assessments(id) on delete cascade,
  section_id uuid not null references public.assessment_sections(id) on delete cascade,
  section_key text not null,
  section_data jsonb not null,
  version bigint not null check (version >= 1),
  status text not null,
  saved_by_profile_id uuid not null references public.profiles(id) on delete restrict,
  saved_by_auth_user_id uuid not null,
  saved_at timestamptz not null default now(),
  remarks text,
  metadata jsonb not null default '{}'::jsonb,
  constraint assessment_section_versions_unique unique (assessment_id, section_key, version)
);

create table if not exists public.assessment_drafts (
  id uuid primary key default gen_random_uuid(),
  assessment_id uuid not null references public.site_assessments(id) on delete cascade,
  section_key text not null,
  draft_data jsonb not null default '{}'::jsonb,
  base_version bigint,
  draft_version bigint not null default 1 check (draft_version >= 1),
  owner_profile_id uuid not null references public.profiles(id) on delete cascade,
  owner_auth_user_id uuid not null,
  expires_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint assessment_drafts_owner_unique unique (assessment_id, section_key, owner_profile_id)
);

create table if not exists public.site_images (
  id uuid primary key default gen_random_uuid(),
  site_visit_id uuid not null references public.site_visits(id) on delete cascade,
  assessment_id uuid references public.site_assessments(id) on delete cascade,
  section_key text,
  storage_bucket text not null default 'site-survey-images',
  storage_path text not null,
  original_filename text,
  mime_type text not null check (mime_type in ('image/jpeg', 'image/png', 'image/webp')),
  size_bytes bigint not null check (size_bytes > 0 and size_bytes <= 10485760),
  caption text,
  uploaded_by_profile_id uuid not null references public.profiles(id) on delete restrict,
  uploaded_by_auth_user_id uuid not null,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  constraint site_images_storage_path_unique unique (storage_bucket, storage_path)
);

create table if not exists public.site_mom (
  id uuid primary key default gen_random_uuid(),
  site_visit_id uuid not null references public.site_visits(id) on delete cascade,
  to_email text,
  cc_emails jsonb not null default '[]'::jsonb,
  subject text,
  summary text,
  scope text,
  requirements text,
  commercial_notes text,
  next_action text,
  mom_status text not null default 'Draft',
  sent_at timestamptz,
  created_by_profile_id uuid not null references public.profiles(id) on delete restrict,
  created_by_auth_user_id uuid not null,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint site_mom_one_per_visit unique (site_visit_id)
);

create table if not exists public.workflow_instances (
  id uuid primary key default gen_random_uuid(),
  lead_id uuid not null references public.leads(id) on delete restrict,
  site_visit_id uuid not null references public.site_visits(id) on delete cascade,
  assessment_id uuid not null references public.site_assessments(id) on delete cascade,
  current_stage_code text not null default 'bd_survey',
  status text not null default 'Active',
  pending_role text not null default 'BD Executive',
  approval_status text not null default 'Draft',
  version bigint not null default 1 check (version >= 1),
  owner_state text,
  owner_branch text,
  created_by_profile_id uuid not null references public.profiles(id) on delete restrict,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  completed_at timestamptz,
  constraint workflow_instances_one_per_assessment unique (assessment_id),
  constraint workflow_instances_one_per_visit unique (site_visit_id)
);

create table if not exists public.workflow_assignments (
  id uuid primary key default gen_random_uuid(),
  workflow_instance_id uuid not null references public.workflow_instances(id) on delete cascade,
  stage_code text not null,
  assigned_role text not null,
  assigned_profile_id uuid references public.profiles(id) on delete set null,
  status text not null default 'Pending',
  created_at timestamptz not null default now(),
  completed_at timestamptz,
  metadata jsonb not null default '{}'::jsonb
);

create unique index if not exists workflow_assignments_one_pending_stage
  on public.workflow_assignments(workflow_instance_id, stage_code)
  where status = 'Pending';

create table if not exists public.workflow_events (
  id uuid primary key default gen_random_uuid(),
  workflow_instance_id uuid not null references public.workflow_instances(id) on delete cascade,
  lead_id uuid not null references public.leads(id) on delete restrict,
  site_visit_id uuid not null references public.site_visits(id) on delete cascade,
  assessment_id uuid not null references public.site_assessments(id) on delete cascade,
  from_stage text,
  to_stage text,
  action text not null,
  actor_profile_id uuid not null references public.profiles(id) on delete restrict,
  actor_auth_user_id uuid not null,
  actor_employee_code text not null,
  actor_name text not null,
  actor_role text not null,
  remarks text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create table if not exists public.workflow_status (
  assessment_id uuid primary key references public.site_assessments(id) on delete cascade,
  workflow_instance_id uuid not null unique references public.workflow_instances(id) on delete cascade,
  stage_code text not null,
  stage_label text not null,
  pending_role text not null,
  status text not null,
  version bigint not null default 1,
  updated_at timestamptz not null default now()
);

create table if not exists public.approval_requests (
  id uuid primary key default gen_random_uuid(),
  workflow_instance_id uuid not null references public.workflow_instances(id) on delete cascade,
  lead_id uuid not null references public.leads(id) on delete restrict,
  site_visit_id uuid not null references public.site_visits(id) on delete cascade,
  assessment_id uuid not null references public.site_assessments(id) on delete cascade,
  approval_stage text not null,
  stage_code text not null,
  pending_with text not null,
  status text not null default 'Not Started',
  requested_at timestamptz,
  decided_at timestamptz,
  decided_by_profile_id uuid references public.profiles(id) on delete set null,
  approved_at timestamptz,
  approved_by text,
  remarks text,
  decision_metadata jsonb not null default '{}'::jsonb,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint approval_requests_one_stage unique (workflow_instance_id, stage_code)
);

create table if not exists public.site_assessment_reviews (
  id uuid primary key default gen_random_uuid(),
  assessment_id uuid not null references public.site_assessments(id) on delete cascade,
  workflow_instance_id uuid not null references public.workflow_instances(id) on delete cascade,
  stage_code text not null,
  decision text not null,
  reviewer_profile_id uuid not null references public.profiles(id) on delete restrict,
  reviewer_auth_user_id uuid not null,
  reviewer_role text not null,
  remarks text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  constraint site_assessment_reviews_one_decision unique (workflow_instance_id, stage_code)
);

create table if not exists public.proposals (
  id uuid primary key default gen_random_uuid(),
  workflow_instance_id uuid not null references public.workflow_instances(id) on delete restrict,
  lead_id uuid not null references public.leads(id) on delete restrict,
  site_visit_id uuid not null references public.site_visits(id) on delete restrict,
  assessment_id uuid not null references public.site_assessments(id) on delete restrict,
  proposal_number text,
  proposal_version integer not null default 1 check (proposal_version >= 1),
  client_name text,
  proposal_status text not null default 'Generated',
  proposal_value numeric(14,2) not null default 0,
  management_fee_percent numeric(7,4),
  margin_percent numeric(7,4),
  proposal_payload jsonb not null default '{}'::jsonb,
  generated_by_profile_id uuid not null references public.profiles(id) on delete restrict,
  generated_by_auth_user_id uuid not null,
  generated_by uuid references public.profiles(id) on delete set null,
  generated_by_name text,
  generated_at timestamptz not null default now(),
  sent_at timestamptz,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint proposals_one_version unique (assessment_id, proposal_version),
  constraint proposals_number_unique unique (proposal_number)
);

create table if not exists public.site_workflow_idempotency (
  idempotency_key text primary key,
  operation text not null,
  actor_profile_id uuid not null references public.profiles(id) on delete restrict,
  resource_id uuid,
  response_payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  expires_at timestamptz
);

create index if not exists site_visits_assigned_profile_idx on public.site_visits(assigned_profile_id);
create index if not exists site_visits_scope_idx on public.site_visits(owner_state, owner_branch);
create index if not exists assessment_sections_assessment_idx on public.assessment_sections(assessment_id);
create index if not exists assessment_versions_assessment_idx on public.assessment_section_versions(assessment_id, saved_at);
create index if not exists workflow_events_assessment_idx on public.workflow_events(assessment_id, created_at);
create index if not exists approval_requests_pending_idx on public.approval_requests(stage_code, status);

create or replace function public.normalize_site_workflow_role(p_role text)
returns text
language sql
immutable
set search_path = pg_catalog
as $$
  select case regexp_replace(upper(coalesce(p_role, '')), '[^A-Z0-9]+', '', 'g')
    when 'BDEXECUTIVE' then 'BD_EXECUTIVE'
    when 'BUSINESSDEVELOPMENTEXECUTIVE' then 'BD_EXECUTIVE'
    when 'BDHEAD' then 'BD_HEAD'
    when 'BUSINESSDEVELOPMENTHEAD' then 'BD_HEAD'
    when 'ADMIN' then 'ADMIN'
    when 'QPMSADMIN' then 'ADMIN'
    when 'OPERATIONS' then 'OPERATIONS'
    when 'OPERATIONSTEAM' then 'OPERATIONS'
    when 'OPERATIONSMANAGER' then 'OPERATIONS'
    when 'PROJECTCOORDINATOR' then 'PROJECT_COORDINATOR'
    when 'COORDINATOR' then 'PROJECT_COORDINATOR'
    when 'HR' then 'HR'
    when 'HRREVIEWER' then 'HR'
    when 'HRMANAGER' then 'HR'
    when 'COMMERCIAL' then 'COMMERCIAL'
    when 'COMMERCIALTEAM' then 'COMMERCIAL'
    when 'COMMERCIALREVIEWER' then 'COMMERCIAL'
    when 'FINANCE' then 'FINANCE'
    when 'FINANCETEAM' then 'FINANCE'
    when 'FINANCEREVIEWER' then 'FINANCE'
    when 'COO' then 'COO'
    when 'GM' then 'GM'
    when 'GMTOPMANAGEMENT' then 'GM'
    when 'MD' then 'MD'
    else 'UNAUTHORIZED'
  end
$$;

create or replace function public.site_workflow_current_actor()
returns table (
  profile_id uuid,
  auth_user_id uuid,
  employee_code text,
  actor_name text,
  actor_role text,
  role_key text,
  actor_state text,
  actor_branch text
)
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
begin
  if auth.uid() is null then
    raise exception 'Authentication required' using errcode = '28000';
  end if;

  return query
  select p.id, p.auth_user_id, p.employee_code, p.name, p.role,
    public.normalize_site_workflow_role(p.role), p.state, p.branch
  from public.profiles p
  where p.auth_user_id = auth.uid()
    and lower(coalesce(p.status, '')) = 'active'
    and p.is_active is true
    and p.web_access_enabled is true;

  if not found then
    raise exception 'Active web-enabled profile not found' using errcode = '42501';
  end if;

  if (select count(*) from public.profiles p where p.auth_user_id = auth.uid()
      and lower(coalesce(p.status, '')) = 'active' and p.is_active is true and p.web_access_enabled is true) <> 1 then
    raise exception 'Authenticated identity must resolve to exactly one active profile' using errcode = '42501';
  end if;
end
$$;

create or replace function public.site_workflow_stage_role(p_stage text)
returns text
language sql
immutable
set search_path = pg_catalog
as $$
  select case lower(coalesce(p_stage, ''))
    when 'bd_survey' then 'BD_EXECUTIVE'
    when 'operations_review' then 'OPERATIONS'
    when 'coordinator_costing' then 'PROJECT_COORDINATOR'
    when 'hr_validation' then 'HR'
    when 'commercial_review' then 'COMMERCIAL'
    when 'finance_review' then 'FINANCE'
    when 'returned_to_bd' then 'BD_EXECUTIVE'
    when 'proposal' then 'BD_EXECUTIVE'
    else 'UNAUTHORIZED'
  end
$$;

create or replace function public.site_workflow_stage_label(p_stage text)
returns text
language sql
immutable
set search_path = pg_catalog
as $$
  select case lower(coalesce(p_stage, ''))
    when 'bd_survey' then 'BD Survey'
    when 'operations_review' then 'Operations Review'
    when 'coordinator_costing' then 'Project Coordinator Costing'
    when 'hr_validation' then 'HR Validation'
    when 'commercial_review' then 'Commercial Review'
    when 'finance_review' then 'Finance Review'
    when 'returned_to_bd' then 'Returned to BD'
    when 'proposal' then 'Proposal'
    else 'Unknown'
  end
$$;

create or replace function public.site_workflow_next_stage(p_stage text)
returns text
language sql
immutable
set search_path = pg_catalog
as $$
  select case lower(coalesce(p_stage, ''))
    when 'bd_survey' then 'operations_review'
    when 'operations_review' then 'coordinator_costing'
    when 'coordinator_costing' then 'hr_validation'
    when 'hr_validation' then 'commercial_review'
    when 'commercial_review' then 'finance_review'
    when 'finance_review' then 'returned_to_bd'
    when 'returned_to_bd' then 'proposal'
    else null
  end
$$;

create or replace function public.site_workflow_actor_can_view(p_assessment_id uuid)
returns boolean
language plpgsql
security definer
stable
set search_path = pg_catalog, public
as $$
declare
  v_actor record;
  v_record record;
begin
  select * into v_actor from public.site_workflow_current_actor();
  select sv.assigned_profile_id, sv.created_by_profile_id, sv.owner_state, sv.owner_branch,
         sa.current_stage
    into v_record
  from public.site_assessments sa
  join public.site_visits sv on sv.id = sa.site_visit_id
  where sa.id = p_assessment_id;
  if not found then return false; end if;

  if v_actor.role_key in ('ADMIN', 'COO', 'MD') then return true; end if;
  if v_actor.role_key = 'GM' then
    return (v_record.owner_state is null or v_record.owner_state = v_actor.actor_state)
      and (v_record.owner_branch is null or v_record.owner_branch = v_actor.actor_branch);
  end if;
  if v_actor.role_key = 'BD_EXECUTIVE' then
    return v_record.assigned_profile_id = v_actor.profile_id or v_record.created_by_profile_id = v_actor.profile_id;
  end if;
  if v_actor.role_key = 'BD_HEAD' then
    return (v_record.owner_state is null or v_record.owner_state = v_actor.actor_state)
      and (v_record.owner_branch is null or v_record.owner_branch = v_actor.actor_branch);
  end if;
  return public.site_workflow_stage_role(v_record.current_stage) = v_actor.role_key
    and (v_record.owner_state is null or v_record.owner_state = v_actor.actor_state)
    and (v_record.owner_branch is null or v_record.owner_branch = v_actor.actor_branch);
end
$$;

create or replace function public.site_workflow_actor_can_edit(p_assessment_id uuid)
returns boolean
language plpgsql
security definer
stable
set search_path = pg_catalog, public
as $$
declare
  v_actor record;
  v_assessment public.site_assessments%rowtype;
begin
  select * into v_actor from public.site_workflow_current_actor();
  select * into v_assessment from public.site_assessments where id = p_assessment_id;
  if not found or not public.site_workflow_actor_can_view(p_assessment_id) then return false; end if;
  return v_actor.role_key in ('BD_EXECUTIVE', 'BD_HEAD', 'ADMIN')
    and v_assessment.current_stage in ('bd_survey', 'returned_to_bd');
end
$$;

create or replace function public.site_workflow_log_event(
  p_workflow_instance_id uuid,
  p_from_stage text,
  p_to_stage text,
  p_action text,
  p_remarks text default null,
  p_metadata jsonb default '{}'::jsonb
)
returns uuid
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_actor record;
  v_workflow public.workflow_instances%rowtype;
  v_event_id uuid;
begin
  select * into v_actor from public.site_workflow_current_actor();
  select * into strict v_workflow from public.workflow_instances where id = p_workflow_instance_id;
  insert into public.workflow_events (
    workflow_instance_id, lead_id, site_visit_id, assessment_id,
    from_stage, to_stage, action, actor_profile_id, actor_auth_user_id,
    actor_employee_code, actor_name, actor_role, remarks, metadata
  ) values (
    v_workflow.id, v_workflow.lead_id, v_workflow.site_visit_id, v_workflow.assessment_id,
    p_from_stage, p_to_stage, p_action, v_actor.profile_id, v_actor.auth_user_id,
    v_actor.employee_code, v_actor.actor_name, v_actor.actor_role, p_remarks, coalesce(p_metadata, '{}'::jsonb)
  ) returning id into v_event_id;
  return v_event_id;
end
$$;

create or replace function public.rpc_convert_lead_to_assessment(
  p_lead_id uuid,
  p_actor_user_id uuid default null,
  p_actor_name text default null,
  p_actor_role text default null,
  p_idempotency_key text default null,
  p_scheduled_visit_date date default null,
  p_scheduled_visit_time time without time zone default null,
  p_site_name text default null,
  p_primary_contact jsonb default '{}'::jsonb,
  p_metadata jsonb default '{}'::jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_actor record;
  v_lead public.leads%rowtype;
  v_lead_json jsonb;
  v_assigned_profile_id uuid;
  v_visit public.site_visits%rowtype;
  v_assessment public.site_assessments%rowtype;
  v_workflow public.workflow_instances%rowtype;
  v_existing jsonb;
  v_key text := nullif(trim(p_idempotency_key), '');
begin
  select * into v_actor from public.site_workflow_current_actor();
  if v_actor.role_key not in ('BD_EXECUTIVE', 'BD_HEAD', 'ADMIN') then
    raise exception 'Role is not permitted to create a Site Visit' using errcode = '42501';
  end if;
  select * into strict v_lead from public.leads where id = p_lead_id for update;
  v_lead_json := to_jsonb(v_lead);

  if v_key is not null then
    select response_payload into v_existing from public.site_workflow_idempotency
      where idempotency_key = v_key and operation = 'convert_lead';
    if found then return v_existing; end if;
  end if;

  if v_actor.role_key = 'BD_EXECUTIVE' then
    v_assigned_profile_id := v_actor.profile_id;
  else
    select p.id into v_assigned_profile_id
    from public.profiles p
    where lower(coalesce(p.status, '')) = 'active' and p.is_active is true
      and public.normalize_site_workflow_role(p.role) = 'BD_EXECUTIVE'
      and (
        p.employee_code = coalesce(v_lead_json->>'assigned_bd_executive', v_lead_json->>'assigned_to')
        or p.id::text = coalesce(v_lead_json->>'assigned_to', v_lead_json->>'assigned_bd_executive')
        or p.email = v_lead_json->>'assigned_bd_email'
      )
    limit 1;
  end if;

  insert into public.site_visits (
    lead_id, client_name, site_name, site_location, scheduled_visit_date, scheduled_visit_time,
    assigned_profile_id, assigned_bd_executive, assigned_bd_email,
    created_by_profile_id, created_by_auth_user_id, owner_state, owner_branch, metadata
  ) values (
    p_lead_id, v_lead_json->>'client_name', coalesce(p_site_name, v_lead_json->>'site_location'),
    coalesce(p_site_name, v_lead_json->>'site_location'), p_scheduled_visit_date, p_scheduled_visit_time,
    v_assigned_profile_id, v_lead_json->>'assigned_bd_executive', v_lead_json->>'assigned_bd_email',
    v_actor.profile_id, v_actor.auth_user_id, coalesce(v_lead_json->>'state', v_actor.actor_state),
    coalesce(v_lead_json->>'branch', v_actor.actor_branch), coalesce(p_metadata, '{}'::jsonb)
  )
  on conflict (lead_id) do update set updated_at = public.site_visits.updated_at
  returning * into v_visit;

  insert into public.site_assessments (
    site_visit_id, lead_id, created_by_profile_id, created_by_auth_user_id, metadata
  ) values (
    v_visit.id, p_lead_id, v_actor.profile_id, v_actor.auth_user_id,
    jsonb_build_object('primary_contact_snapshot', coalesce(p_primary_contact, '{}'::jsonb))
  )
  on conflict (site_visit_id) do update set updated_at = public.site_assessments.updated_at
  returning * into v_assessment;

  insert into public.workflow_instances (
    lead_id, site_visit_id, assessment_id, owner_state, owner_branch, created_by_profile_id
  ) values (
    p_lead_id, v_visit.id, v_assessment.id, v_visit.owner_state, v_visit.owner_branch, v_actor.profile_id
  )
  on conflict (assessment_id) do update set updated_at = public.workflow_instances.updated_at
  returning * into v_workflow;

  insert into public.workflow_status (
    assessment_id, workflow_instance_id, stage_code, stage_label, pending_role, status
  ) values (
    v_assessment.id, v_workflow.id, 'bd_survey', 'BD Survey', 'BD Executive', 'Draft'
  ) on conflict (assessment_id) do nothing;

  perform public.site_workflow_log_event(v_workflow.id, null, 'bd_survey', 'CONVERT_LEAD', null, p_metadata);
  v_existing := jsonb_build_object(
    'site_visit', to_jsonb(v_visit),
    'assessment', to_jsonb(v_assessment),
    'workflow_instance', to_jsonb(v_workflow)
  );
  if v_key is not null then
    insert into public.site_workflow_idempotency(idempotency_key, operation, actor_profile_id, resource_id, response_payload)
    values (v_key, 'convert_lead', v_actor.profile_id, v_assessment.id, v_existing)
    on conflict (idempotency_key) do nothing;
  end if;
  return v_existing;
end
$$;

create or replace function public.rpc_save_assessment_section(
  p_site_visit_id uuid,
  p_section_code text,
  p_section_name text default null,
  p_section_data jsonb default '{}'::jsonb,
  p_base_version_number bigint default null,
  p_save_mode text default 'save',
  p_actor_user_id uuid default null,
  p_actor_name text default null,
  p_actor_role text default null,
  p_remarks text default null
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_actor record;
  v_assessment public.site_assessments%rowtype;
  v_section public.assessment_sections%rowtype;
  v_next_version bigint;
begin
  select * into v_actor from public.site_workflow_current_actor();
  select * into strict v_assessment from public.site_assessments
    where site_visit_id = p_site_visit_id for update;
  if not public.site_workflow_actor_can_view(v_assessment.id) then
    raise exception 'Assessment is outside the actor scope' using errcode = '42501';
  end if;
  if v_actor.role_key not in ('BD_EXECUTIVE', 'BD_HEAD', 'ADMIN')
     or v_assessment.current_stage not in ('bd_survey', 'returned_to_bd') then
    raise exception 'Assessment section cannot be edited at the current stage' using errcode = '42501';
  end if;
  if nullif(trim(p_section_code), '') is null or jsonb_typeof(coalesce(p_section_data, '{}'::jsonb)) <> 'object' then
    raise exception 'Section key and object data are required' using errcode = '22023';
  end if;

  select * into v_section from public.assessment_sections
    where assessment_id = v_assessment.id and section_key = p_section_code for update;
  if found and p_base_version_number is not null and v_section.version <> p_base_version_number then
    raise exception 'Assessment section version conflict' using errcode = '40001';
  end if;
  v_next_version := coalesce(v_section.version, 0) + 1;

  insert into public.assessment_sections (
    assessment_id, section_key, section_name, section_data, version, status,
    saved_by_profile_id, saved_by_auth_user_id, saved_at
  ) values (
    v_assessment.id, p_section_code, coalesce(p_section_name, p_section_code), p_section_data,
    v_next_version, case when p_save_mode = 'draft' then 'Draft' else 'Saved' end,
    v_actor.profile_id, v_actor.auth_user_id, now()
  )
  on conflict (assessment_id, section_key) do update set
    section_name = excluded.section_name,
    section_data = excluded.section_data,
    version = excluded.version,
    status = excluded.status,
    saved_by_profile_id = excluded.saved_by_profile_id,
    saved_by_auth_user_id = excluded.saved_by_auth_user_id,
    saved_at = excluded.saved_at
  returning * into v_section;

  insert into public.assessment_section_versions (
    assessment_id, section_id, section_key, section_data, version, status,
    saved_by_profile_id, saved_by_auth_user_id, remarks
  ) values (
    v_assessment.id, v_section.id, v_section.section_key, v_section.section_data,
    v_section.version, v_section.status, v_actor.profile_id, v_actor.auth_user_id, p_remarks
  ) on conflict (assessment_id, section_key, version) do nothing;

  update public.site_assessments
  set survey_snapshot = coalesce(survey_snapshot, '{}'::jsonb)
        || jsonb_build_object(p_section_code, p_section_data),
      row_version = row_version + 1,
      updated_at = now()
  where id = v_assessment.id;

  return jsonb_build_object('assessment_id', v_assessment.id, 'section', to_jsonb(v_section));
end
$$;

create or replace function public.rpc_save_assessment_draft(
  p_assessment_id uuid,
  p_section_key text,
  p_draft_data jsonb,
  p_base_version bigint default null,
  p_expected_draft_version bigint default null,
  p_expires_at timestamptz default null
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_actor record;
  v_draft public.assessment_drafts%rowtype;
begin
  select * into v_actor from public.site_workflow_current_actor();
  if not public.site_workflow_actor_can_view(p_assessment_id) then
    raise exception 'Assessment is outside the actor scope' using errcode = '42501';
  end if;
  select * into v_draft from public.assessment_drafts
    where assessment_id = p_assessment_id and section_key = p_section_key
      and owner_profile_id = v_actor.profile_id for update;
  if found and p_expected_draft_version is not null and v_draft.draft_version <> p_expected_draft_version then
    raise exception 'Draft version conflict' using errcode = '40001';
  end if;
  insert into public.assessment_drafts (
    assessment_id, section_key, draft_data, base_version, draft_version,
    owner_profile_id, owner_auth_user_id, expires_at
  ) values (
    p_assessment_id, p_section_key, coalesce(p_draft_data, '{}'::jsonb), p_base_version,
    coalesce(v_draft.draft_version, 0) + 1, v_actor.profile_id, v_actor.auth_user_id, p_expires_at
  )
  on conflict (assessment_id, section_key, owner_profile_id) do update set
    draft_data = excluded.draft_data,
    base_version = excluded.base_version,
    draft_version = excluded.draft_version,
    expires_at = excluded.expires_at,
    updated_at = now()
  returning * into v_draft;
  return to_jsonb(v_draft);
end
$$;

create or replace function public.rpc_save_site_mom(
  p_site_visit_id uuid,
  p_mom jsonb,
  p_status text default 'Draft'
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_actor record;
  v_assessment_id uuid;
  v_mom public.site_mom%rowtype;
begin
  select * into v_actor from public.site_workflow_current_actor();
  select id into strict v_assessment_id
    from public.site_assessments where site_visit_id = p_site_visit_id;
  if not public.site_workflow_actor_can_view(v_assessment_id)
     or v_actor.role_key not in ('BD_EXECUTIVE', 'BD_HEAD', 'ADMIN') then
    raise exception 'Actor cannot save this Site Visit MOM' using errcode = '42501';
  end if;
  if p_status not in ('Draft', 'Sent') then
    raise exception 'Unsupported Site Visit MOM status' using errcode = '22023';
  end if;
  insert into public.site_mom(
    site_visit_id, to_email, cc_emails, subject, summary, scope, requirements,
    commercial_notes, next_action, mom_status, sent_at,
    created_by_profile_id, created_by_auth_user_id, metadata
  ) values (
    p_site_visit_id, p_mom->>'to_email', coalesce(p_mom->'cc_emails', '[]'::jsonb),
    p_mom->>'subject', p_mom->>'summary', p_mom->>'scope', p_mom->>'requirements',
    p_mom->>'commercial_notes', p_mom->>'next_action', p_status,
    case when p_status = 'Sent' then now() else null end,
    v_actor.profile_id, v_actor.auth_user_id, coalesce(p_mom->'metadata', '{}'::jsonb)
  )
  on conflict (site_visit_id) do update set
    to_email = excluded.to_email,
    cc_emails = excluded.cc_emails,
    subject = excluded.subject,
    summary = excluded.summary,
    scope = excluded.scope,
    requirements = excluded.requirements,
    commercial_notes = excluded.commercial_notes,
    next_action = excluded.next_action,
    mom_status = excluded.mom_status,
    sent_at = case when excluded.mom_status = 'Sent' then coalesce(public.site_mom.sent_at, now())
                   else public.site_mom.sent_at end,
    updated_at = now()
  returning * into v_mom;
  return to_jsonb(v_mom);
end
$$;

create or replace function public.rpc_register_site_image(
  p_site_visit_id uuid,
  p_assessment_id uuid,
  p_section_key text,
  p_storage_path text,
  p_original_filename text,
  p_mime_type text,
  p_size_bytes bigint,
  p_caption text default null,
  p_metadata jsonb default '{}'::jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_actor record;
  v_image public.site_images%rowtype;
begin
  select * into v_actor from public.site_workflow_current_actor();
  if not public.site_workflow_actor_can_edit(p_assessment_id) then
    raise exception 'Actor cannot register evidence for this assessment' using errcode = '42501';
  end if;
  if not exists (
    select 1 from public.site_assessments
    where id = p_assessment_id and site_visit_id = p_site_visit_id
  ) then
    raise exception 'Assessment does not belong to the Site Visit' using errcode = '22023';
  end if;
  if p_storage_path not like (p_site_visit_id::text || '/%') then
    raise exception 'Site evidence storage path is outside the Site Visit scope' using errcode = '22023';
  end if;
  insert into public.site_images(
    site_visit_id, assessment_id, section_key, storage_path, original_filename,
    mime_type, size_bytes, caption, uploaded_by_profile_id, uploaded_by_auth_user_id, metadata
  ) values (
    p_site_visit_id, p_assessment_id, p_section_key, p_storage_path, p_original_filename,
    p_mime_type, p_size_bytes, p_caption, v_actor.profile_id, v_actor.auth_user_id,
    coalesce(p_metadata, '{}'::jsonb)
  ) returning * into v_image;
  return to_jsonb(v_image);
end
$$;

create or replace function public.rpc_submit_for_review(
  p_workflow_instance_id uuid default null,
  p_site_visit_id uuid default null,
  p_target_stage_code text default 'operations_review',
  p_actor_user_id uuid default null,
  p_actor_name text default null,
  p_actor_role text default null,
  p_idempotency_key text default null,
  p_remarks text default null
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_actor record;
  v_workflow public.workflow_instances%rowtype;
  v_assessment public.site_assessments%rowtype;
  v_key text := nullif(trim(p_idempotency_key), '');
  v_existing jsonb;
begin
  select * into v_actor from public.site_workflow_current_actor();
  select * into strict v_workflow from public.workflow_instances
    where (p_workflow_instance_id is not null and id = p_workflow_instance_id)
       or (p_workflow_instance_id is null and site_visit_id = p_site_visit_id)
    for update;
  select * into strict v_assessment from public.site_assessments where id = v_workflow.assessment_id for update;
  if not public.site_workflow_actor_can_view(v_assessment.id)
     or v_actor.role_key not in ('BD_EXECUTIVE', 'BD_HEAD', 'ADMIN') then
    raise exception 'Actor cannot submit this assessment' using errcode = '42501';
  end if;
  if v_workflow.current_stage_code not in ('bd_survey', 'returned_to_bd')
     or p_target_stage_code <> 'operations_review' then
    raise exception 'Invalid assessment submit transition' using errcode = '22023';
  end if;
  if v_key is not null then
    select response_payload into v_existing from public.site_workflow_idempotency
      where idempotency_key = v_key and operation = 'submit_assessment';
    if found then return v_existing; end if;
  end if;

  update public.workflow_instances set
    current_stage_code = 'operations_review', pending_role = 'Operations',
    approval_status = 'Pending', version = version + 1, updated_at = now()
  where id = v_workflow.id returning * into v_workflow;
  update public.site_assessments set
    assessment_status = 'Submitted', status = 'Pending Review', current_stage = 'operations_review',
    submitted_at = coalesce(submitted_at, now()), submitted_by_profile_id = v_actor.profile_id,
    submitted_by_auth_user_id = v_actor.auth_user_id, row_version = row_version + 1, updated_at = now()
  where id = v_assessment.id;
  update public.site_visits set status = 'Pending Review', current_stage = 'Operations Review',
    pending_with = 'Operations', updated_at = now() where id = v_workflow.site_visit_id;
  insert into public.workflow_assignments(workflow_instance_id, stage_code, assigned_role)
    values (v_workflow.id, 'operations_review', 'Operations')
    on conflict (workflow_instance_id, stage_code) where status = 'Pending' do nothing;
  insert into public.approval_requests(
    workflow_instance_id, lead_id, site_visit_id, assessment_id,
    approval_stage, stage_code, pending_with, status, requested_at
  ) values (
    v_workflow.id, v_workflow.lead_id, v_workflow.site_visit_id, v_workflow.assessment_id,
    'Operations Review', 'operations_review', 'Operations', 'Pending', now()
  ) on conflict (workflow_instance_id, stage_code) do update set
    status = case when public.approval_requests.status = 'Not Started' then 'Pending' else public.approval_requests.status end,
    requested_at = coalesce(public.approval_requests.requested_at, now()),
    updated_at = now();
  insert into public.workflow_status(assessment_id, workflow_instance_id, stage_code, stage_label, pending_role, status, version)
    values(v_workflow.assessment_id, v_workflow.id, 'operations_review', 'Operations Review', 'Operations', 'Pending', v_workflow.version)
    on conflict (assessment_id) do update set stage_code = excluded.stage_code, stage_label = excluded.stage_label,
      pending_role = excluded.pending_role, status = excluded.status, version = excluded.version, updated_at = now();
  perform public.site_workflow_log_event(v_workflow.id, 'bd_survey', 'operations_review', 'SUBMIT_ASSESSMENT', p_remarks);
  v_existing := jsonb_build_object('workflow_instance', to_jsonb(v_workflow), 'stage', 'operations_review');
  if v_key is not null then
    insert into public.site_workflow_idempotency(idempotency_key, operation, actor_profile_id, resource_id, response_payload)
    values(v_key, 'submit_assessment', v_actor.profile_id, v_workflow.assessment_id, v_existing)
    on conflict (idempotency_key) do nothing;
  end if;
  return v_existing;
end
$$;

create or replace function public.rpc_record_approval_decision(
  p_workflow_instance_id uuid,
  p_assignment_id uuid default null,
  p_stage_code text default null,
  p_decision text default 'Approved',
  p_actor_user_id uuid default null,
  p_actor_name text default null,
  p_actor_role text default null,
  p_remarks text default null,
  p_reassign_to_role text default null,
  p_reassign_to_user_id uuid default null,
  p_idempotency_key text default null
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_actor record;
  v_workflow public.workflow_instances%rowtype;
  v_current text;
  v_next text;
  v_expected_role text;
  v_decision text := upper(trim(coalesce(p_decision, '')));
  v_key text := nullif(trim(p_idempotency_key), '');
  v_existing jsonb;
begin
  select * into v_actor from public.site_workflow_current_actor();
  select * into strict v_workflow from public.workflow_instances where id = p_workflow_instance_id for update;
  v_current := v_workflow.current_stage_code;
  if p_stage_code is not null and p_stage_code <> v_current then
    raise exception 'Stale or invalid workflow stage' using errcode = '40001';
  end if;
  v_expected_role := public.site_workflow_stage_role(v_current);
  if v_actor.role_key <> 'ADMIN' and v_actor.role_key <> v_expected_role then
    raise exception 'Actor cannot decide the current workflow stage' using errcode = '42501';
  end if;
  if not public.site_workflow_actor_can_view(v_workflow.assessment_id) then
    raise exception 'Assessment is outside the actor scope' using errcode = '42501';
  end if;
  if v_current not in ('operations_review', 'coordinator_costing', 'hr_validation', 'commercial_review', 'finance_review') then
    raise exception 'Current stage does not accept a review decision' using errcode = '22023';
  end if;
  if v_decision not in ('APPROVED', 'RETURNED', 'REWORK REQUESTED', 'REJECTED') then
    raise exception 'Unsupported review decision' using errcode = '22023';
  end if;
  if v_key is not null then
    select response_payload into v_existing from public.site_workflow_idempotency
      where idempotency_key = v_key and operation = 'review_decision';
    if found then return v_existing; end if;
  end if;

  v_next := case when v_decision = 'APPROVED' then public.site_workflow_next_stage(v_current)
                 when v_decision in ('RETURNED', 'REWORK REQUESTED') then 'returned_to_bd'
                 else v_current end;

  update public.approval_requests set
    status = case when v_decision = 'APPROVED' then 'Approved'
                  when v_decision = 'REJECTED' then 'Rejected' else 'Rework Requested' end,
    decided_at = now(), decided_by_profile_id = v_actor.profile_id,
    approved_at = now(), approved_by = v_actor.actor_name,
    remarks = p_remarks, updated_at = now()
  where workflow_instance_id = v_workflow.id and stage_code = v_current;
  insert into public.site_assessment_reviews(
    assessment_id, workflow_instance_id, stage_code, decision,
    reviewer_profile_id, reviewer_auth_user_id, reviewer_role, remarks
  ) values (
    v_workflow.assessment_id, v_workflow.id, v_current, v_decision,
    v_actor.profile_id, v_actor.auth_user_id, v_actor.actor_role, p_remarks
  ) on conflict (workflow_instance_id, stage_code) do nothing;
  update public.workflow_assignments set status = 'Completed', completed_at = now()
    where workflow_instance_id = v_workflow.id and stage_code = v_current and status = 'Pending';

  if v_decision <> 'REJECTED' then
    update public.workflow_instances set current_stage_code = v_next,
      pending_role = case when v_next = 'returned_to_bd' then 'BD Executive'
                          else replace(public.site_workflow_stage_role(v_next), '_', ' ') end,
      approval_status = case when v_next = 'returned_to_bd' then 'Returned to BD' else 'Pending' end,
      version = version + 1, updated_at = now()
      where id = v_workflow.id returning * into v_workflow;
    update public.site_assessments set current_stage = v_next,
      status = case when v_next = 'returned_to_bd' then 'Returned to BD' else 'Pending Review' end,
      row_version = row_version + 1, updated_at = now()
      where id = v_workflow.assessment_id;
    update public.site_visits set current_stage = public.site_workflow_stage_label(v_next),
      pending_with = case when v_next = 'returned_to_bd' then 'BD Executive'
                          else replace(public.site_workflow_stage_role(v_next), '_', ' ') end,
      status = case when v_next = 'returned_to_bd' then 'Returned to BD' else 'Pending Review' end,
      updated_at = now() where id = v_workflow.site_visit_id;
    if v_next not in ('returned_to_bd', 'proposal') then
      insert into public.workflow_assignments(workflow_instance_id, stage_code, assigned_role)
      values(v_workflow.id, v_next, replace(public.site_workflow_stage_role(v_next), '_', ' '))
      on conflict (workflow_instance_id, stage_code) where status = 'Pending' do nothing;
      insert into public.approval_requests(
        workflow_instance_id, lead_id, site_visit_id, assessment_id,
        approval_stage, stage_code, pending_with, status, requested_at
      ) values (
        v_workflow.id, v_workflow.lead_id, v_workflow.site_visit_id, v_workflow.assessment_id,
        public.site_workflow_stage_label(v_next), v_next,
        replace(public.site_workflow_stage_role(v_next), '_', ' '), 'Pending', now()
      ) on conflict (workflow_instance_id, stage_code) do nothing;
    end if;
  else
    update public.workflow_instances set status = 'Rejected', approval_status = 'Rejected',
      version = version + 1, updated_at = now(), completed_at = now()
      where id = v_workflow.id returning * into v_workflow;
    update public.site_assessments set status = 'Rejected', assessment_status = 'Rejected',
      row_version = row_version + 1, updated_at = now() where id = v_workflow.assessment_id;
  end if;

  insert into public.workflow_status(assessment_id, workflow_instance_id, stage_code, stage_label, pending_role, status, version)
    values(v_workflow.assessment_id, v_workflow.id, v_workflow.current_stage_code,
      public.site_workflow_stage_label(v_workflow.current_stage_code), v_workflow.pending_role,
      v_workflow.approval_status, v_workflow.version)
    on conflict (assessment_id) do update set stage_code = excluded.stage_code, stage_label = excluded.stage_label,
      pending_role = excluded.pending_role, status = excluded.status, version = excluded.version, updated_at = now();
  perform public.site_workflow_log_event(v_workflow.id, v_current, v_next, v_decision, p_remarks);
  v_existing := jsonb_build_object('workflow_instance', to_jsonb(v_workflow), 'decision', v_decision, 'next_stage', v_next);
  if v_key is not null then
    insert into public.site_workflow_idempotency(idempotency_key, operation, actor_profile_id, resource_id, response_payload)
    values(v_key, 'review_decision', v_actor.profile_id, v_workflow.assessment_id, v_existing)
    on conflict (idempotency_key) do nothing;
  end if;
  return v_existing;
end
$$;

create or replace function public.rpc_return_assessment_for_correction(
  p_workflow_instance_id uuid,
  p_stage_code text,
  p_remarks text,
  p_idempotency_key text default null
)
returns jsonb
language sql
security definer
set search_path = pg_catalog, public
as $$
  select public.rpc_record_approval_decision(
    p_workflow_instance_id, null, p_stage_code, 'Returned',
    null, null, null, p_remarks, null, null, p_idempotency_key
  )
$$;

create or replace function public.rpc_generate_proposal_record(
  p_workflow_instance_id uuid,
  p_actor_user_id uuid default null,
  p_actor_name text default null,
  p_actor_role text default null,
  p_proposal_number text default null,
  p_template_name text default null,
  p_payload jsonb default '{}'::jsonb,
  p_idempotency_key text default null
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_actor record;
  v_workflow public.workflow_instances%rowtype;
  v_proposal public.proposals%rowtype;
  v_key text := nullif(trim(p_idempotency_key), '');
  v_existing jsonb;
begin
  select * into v_actor from public.site_workflow_current_actor();
  select * into strict v_workflow from public.workflow_instances where id = p_workflow_instance_id for update;
  if v_workflow.current_stage_code <> 'returned_to_bd'
     or v_actor.role_key not in ('BD_EXECUTIVE', 'BD_HEAD', 'ADMIN')
     or not public.site_workflow_actor_can_view(v_workflow.assessment_id) then
    raise exception 'Proposal cannot be generated at the current stage or by this actor' using errcode = '42501';
  end if;
  if v_key is not null then
    select response_payload into v_existing from public.site_workflow_idempotency
      where idempotency_key = v_key and operation = 'generate_proposal';
    if found then return v_existing; end if;
  end if;
  insert into public.proposals(
    workflow_instance_id, lead_id, site_visit_id, assessment_id, proposal_number,
    client_name, proposal_value, management_fee_percent, margin_percent, proposal_payload,
    generated_by_profile_id, generated_by_auth_user_id, generated_by, generated_by_name, metadata
  ) values (
    v_workflow.id, v_workflow.lead_id, v_workflow.site_visit_id, v_workflow.assessment_id,
    p_proposal_number, p_payload->>'clientName',
    coalesce((p_payload->>'proposalValue')::numeric, 0),
    nullif(p_payload->>'managementFeePercent', '')::numeric,
    nullif(p_payload->>'marginPercent', '')::numeric,
    coalesce(p_payload, '{}'::jsonb), v_actor.profile_id, v_actor.auth_user_id,
    v_actor.profile_id, v_actor.actor_name,
    jsonb_build_object('template_name', p_template_name)
  ) returning * into v_proposal;
  update public.workflow_instances set current_stage_code = 'proposal', pending_role = 'BD Executive',
    approval_status = 'Proposal Generated', version = version + 1, updated_at = now()
    where id = v_workflow.id returning * into v_workflow;
  update public.site_assessments set current_stage = 'proposal', status = 'Proposal Generated',
    row_version = row_version + 1, updated_at = now() where id = v_workflow.assessment_id;
  update public.site_visits set current_stage = 'Proposal', pending_with = 'BD Executive',
    status = 'Proposal Generated', updated_at = now() where id = v_workflow.site_visit_id;
  perform public.site_workflow_log_event(v_workflow.id, 'returned_to_bd', 'proposal', 'GENERATE_PROPOSAL', null);
  v_existing := jsonb_build_object('proposal', to_jsonb(v_proposal), 'workflow_instance', to_jsonb(v_workflow));
  if v_key is not null then
    insert into public.site_workflow_idempotency(idempotency_key, operation, actor_profile_id, resource_id, response_payload)
    values(v_key, 'generate_proposal', v_actor.profile_id, v_workflow.assessment_id, v_existing)
    on conflict (idempotency_key) do nothing;
  end if;
  return v_existing;
end
$$;

create or replace function public.rpc_mark_proposal_sent(
  p_proposal_id uuid,
  p_idempotency_key text default null,
  p_metadata jsonb default '{}'::jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_actor record;
  v_proposal public.proposals%rowtype;
  v_workflow public.workflow_instances%rowtype;
  v_key text := nullif(trim(p_idempotency_key), '');
  v_existing jsonb;
begin
  select * into v_actor from public.site_workflow_current_actor();
  select * into strict v_proposal from public.proposals where id = p_proposal_id for update;
  select * into strict v_workflow from public.workflow_instances where id = v_proposal.workflow_instance_id for update;
  if v_proposal.proposal_status = 'Sent' then return to_jsonb(v_proposal); end if;
  if v_workflow.current_stage_code <> 'proposal'
     or v_actor.role_key not in ('BD_EXECUTIVE', 'BD_HEAD', 'ADMIN')
     or not public.site_workflow_actor_can_view(v_workflow.assessment_id) then
    raise exception 'Proposal cannot be sent by this actor or at this stage' using errcode = '42501';
  end if;
  if v_key is not null then
    select response_payload into v_existing from public.site_workflow_idempotency
      where idempotency_key = v_key and operation = 'mark_proposal_sent';
    if found then return v_existing; end if;
  end if;
  update public.proposals set proposal_status = 'Sent', sent_at = now(),
    metadata = coalesce(metadata, '{}'::jsonb) || coalesce(p_metadata, '{}'::jsonb), updated_at = now()
    where id = p_proposal_id returning * into v_proposal;
  update public.workflow_instances set status = 'Completed', approval_status = 'Proposal Sent',
    version = version + 1, updated_at = now(), completed_at = now()
    where id = v_workflow.id returning * into v_workflow;
  update public.site_assessments set status = 'Proposal Sent', assessment_status = 'Completed',
    row_version = row_version + 1, updated_at = now() where id = v_workflow.assessment_id;
  update public.site_visits set current_stage = 'Proposal Sent',
    pending_with = 'Existing Business Operations', status = 'Proposal Sent', updated_at = now()
    where id = v_workflow.site_visit_id;
  perform public.site_workflow_log_event(v_workflow.id, 'proposal', 'proposal_sent', 'SEND_PROPOSAL', null);
  v_existing := jsonb_build_object('proposal', to_jsonb(v_proposal), 'workflow_instance', to_jsonb(v_workflow));
  if v_key is not null then
    insert into public.site_workflow_idempotency(idempotency_key, operation, actor_profile_id, resource_id, response_payload)
    values(v_key, 'mark_proposal_sent', v_actor.profile_id, v_proposal.id, v_existing)
    on conflict (idempotency_key) do nothing;
  end if;
  return v_existing;
end
$$;

create or replace view public.approval_queue
with (security_invoker = true)
as
select ar.id, ar.workflow_instance_id, ar.lead_id, ar.site_visit_id, ar.assessment_id,
  ar.approval_stage, ar.stage_code, ar.pending_with, ar.status, ar.requested_at,
  sv.client_name, sv.site_name, sv.owner_state, sv.owner_branch
from public.approval_requests ar
join public.site_visits sv on sv.id = ar.site_visit_id
where ar.status = 'Pending';

insert into storage.buckets(id, name, public, file_size_limit, allowed_mime_types)
values (
  'site-survey-images',
  'site-survey-images',
  false,
  10485760,
  array['image/jpeg', 'image/png', 'image/webp']
)
on conflict (id) do update set
  public = false,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

alter table public.site_visits enable row level security;
alter table public.site_assessments enable row level security;
alter table public.assessment_sections enable row level security;
alter table public.assessment_section_versions enable row level security;
alter table public.assessment_drafts enable row level security;
alter table public.site_images enable row level security;
alter table public.site_mom enable row level security;
alter table public.workflow_instances enable row level security;
alter table public.workflow_assignments enable row level security;
alter table public.workflow_events enable row level security;
alter table public.workflow_status enable row level security;
alter table public.approval_requests enable row level security;
alter table public.site_assessment_reviews enable row level security;
alter table public.proposals enable row level security;
alter table public.site_workflow_idempotency enable row level security;

revoke all on table public.site_visits, public.site_assessments, public.assessment_sections,
  public.assessment_section_versions, public.assessment_drafts, public.site_images, public.site_mom,
  public.workflow_instances, public.workflow_assignments, public.workflow_events, public.workflow_status,
  public.approval_requests, public.site_assessment_reviews, public.proposals,
  public.site_workflow_idempotency from anon, authenticated;

grant select on table public.site_visits, public.site_assessments, public.assessment_sections,
  public.assessment_section_versions, public.assessment_drafts, public.site_images, public.site_mom,
  public.workflow_instances, public.workflow_assignments, public.workflow_events, public.workflow_status,
  public.approval_requests, public.site_assessment_reviews, public.proposals to authenticated;
grant select on public.approval_queue to authenticated;
grant select, insert, update, delete on table public.site_visits, public.site_assessments,
  public.assessment_sections, public.assessment_section_versions, public.assessment_drafts,
  public.site_images, public.site_mom, public.workflow_instances, public.workflow_assignments,
  public.workflow_events, public.workflow_status, public.approval_requests,
  public.site_assessment_reviews, public.proposals, public.site_workflow_idempotency to service_role;
grant select on public.approval_queue to service_role;

drop policy if exists site_visits_scoped_select on public.site_visits;
create policy site_visits_scoped_select on public.site_visits for select to authenticated
using (
  exists (
    select 1 from public.site_assessments sa
    where sa.site_visit_id = site_visits.id
      and public.site_workflow_actor_can_view(sa.id)
  )
);

drop policy if exists site_assessments_scoped_select on public.site_assessments;
create policy site_assessments_scoped_select on public.site_assessments for select to authenticated
using (public.site_workflow_actor_can_view(id));

drop policy if exists assessment_sections_scoped_select on public.assessment_sections;
create policy assessment_sections_scoped_select on public.assessment_sections for select to authenticated
using (public.site_workflow_actor_can_view(assessment_id));

drop policy if exists assessment_section_versions_scoped_select on public.assessment_section_versions;
create policy assessment_section_versions_scoped_select on public.assessment_section_versions for select to authenticated
using (public.site_workflow_actor_can_view(assessment_id));

drop policy if exists assessment_drafts_owner_select on public.assessment_drafts;
create policy assessment_drafts_owner_select on public.assessment_drafts for select to authenticated
using (
  owner_auth_user_id = auth.uid()
  and public.site_workflow_actor_can_view(assessment_id)
);

drop policy if exists site_images_scoped_select on public.site_images;
create policy site_images_scoped_select on public.site_images for select to authenticated
using (assessment_id is not null and public.site_workflow_actor_can_view(assessment_id));

drop policy if exists site_mom_scoped_select on public.site_mom;
create policy site_mom_scoped_select on public.site_mom for select to authenticated
using (
  exists (select 1 from public.site_assessments sa
    where sa.site_visit_id = site_mom.site_visit_id
      and public.site_workflow_actor_can_view(sa.id))
);

drop policy if exists workflow_instances_scoped_select on public.workflow_instances;
create policy workflow_instances_scoped_select on public.workflow_instances for select to authenticated
using (public.site_workflow_actor_can_view(assessment_id));

drop policy if exists workflow_assignments_scoped_select on public.workflow_assignments;
create policy workflow_assignments_scoped_select on public.workflow_assignments for select to authenticated
using (
  exists (select 1 from public.workflow_instances wi
    where wi.id = workflow_assignments.workflow_instance_id
      and public.site_workflow_actor_can_view(wi.assessment_id))
);

drop policy if exists workflow_events_scoped_select on public.workflow_events;
create policy workflow_events_scoped_select on public.workflow_events for select to authenticated
using (public.site_workflow_actor_can_view(assessment_id));

drop policy if exists workflow_status_scoped_select on public.workflow_status;
create policy workflow_status_scoped_select on public.workflow_status for select to authenticated
using (public.site_workflow_actor_can_view(assessment_id));

drop policy if exists approval_requests_scoped_select on public.approval_requests;
create policy approval_requests_scoped_select on public.approval_requests for select to authenticated
using (public.site_workflow_actor_can_view(assessment_id));

drop policy if exists site_assessment_reviews_scoped_select on public.site_assessment_reviews;
create policy site_assessment_reviews_scoped_select on public.site_assessment_reviews for select to authenticated
using (public.site_workflow_actor_can_view(assessment_id));

drop policy if exists proposals_scoped_select on public.proposals;
create policy proposals_scoped_select on public.proposals for select to authenticated
using (public.site_workflow_actor_can_view(assessment_id));

drop policy if exists site_survey_images_scoped_select on storage.objects;
create policy site_survey_images_scoped_select on storage.objects for select to authenticated
using (
  bucket_id = 'site-survey-images'
  and (storage.foldername(name))[1] ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
  and exists (
    select 1 from public.site_assessments sa
    where sa.site_visit_id = case
        when (storage.foldername(name))[1] ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
          then ((storage.foldername(name))[1])::uuid
        else null
      end
      and public.site_workflow_actor_can_view(sa.id)
  )
);

drop policy if exists site_survey_images_scoped_insert on storage.objects;
create policy site_survey_images_scoped_insert on storage.objects for insert to authenticated
with check (
  bucket_id = 'site-survey-images'
  and (storage.foldername(name))[1] ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
  and exists (
    select 1 from public.site_assessments sa
    where sa.site_visit_id = case
        when (storage.foldername(name))[1] ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
          then ((storage.foldername(name))[1])::uuid
        else null
      end
      and public.site_workflow_actor_can_edit(sa.id)
  )
);

drop policy if exists site_survey_images_owner_delete on storage.objects;
create policy site_survey_images_owner_delete on storage.objects for delete to authenticated
using (
  bucket_id = 'site-survey-images'
  and owner_id::text = auth.uid()::text
  and (storage.foldername(name))[1] ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
  and exists (
    select 1 from public.site_assessments sa
    where sa.site_visit_id = case
        when (storage.foldername(name))[1] ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
          then ((storage.foldername(name))[1])::uuid
        else null
      end
      and public.site_workflow_actor_can_edit(sa.id)
  )
);

revoke all on function public.normalize_site_workflow_role(text) from public, anon;
revoke all on function public.site_workflow_current_actor() from public, anon;
revoke all on function public.site_workflow_stage_role(text) from public, anon;
revoke all on function public.site_workflow_stage_label(text) from public, anon;
revoke all on function public.site_workflow_next_stage(text) from public, anon;
revoke all on function public.site_workflow_actor_can_view(uuid) from public, anon;
revoke all on function public.site_workflow_actor_can_edit(uuid) from public, anon;
revoke all on function public.site_workflow_log_event(uuid,text,text,text,text,jsonb) from public, anon;
revoke all on function public.rpc_convert_lead_to_assessment(uuid,uuid,text,text,text,date,time without time zone,text,jsonb,jsonb) from public, anon;
revoke all on function public.rpc_save_assessment_section(uuid,text,text,jsonb,bigint,text,uuid,text,text,text) from public, anon;
revoke all on function public.rpc_save_assessment_draft(uuid,text,jsonb,bigint,bigint,timestamptz) from public, anon;
revoke all on function public.rpc_save_site_mom(uuid,jsonb,text) from public, anon;
revoke all on function public.rpc_register_site_image(uuid,uuid,text,text,text,text,bigint,text,jsonb) from public, anon;
revoke all on function public.rpc_submit_for_review(uuid,uuid,text,uuid,text,text,text,text) from public, anon;
revoke all on function public.rpc_record_approval_decision(uuid,uuid,text,text,uuid,text,text,text,text,uuid,text) from public, anon;
revoke all on function public.rpc_return_assessment_for_correction(uuid,text,text,text) from public, anon;
revoke all on function public.rpc_generate_proposal_record(uuid,uuid,text,text,text,text,jsonb,text) from public, anon;
revoke all on function public.rpc_mark_proposal_sent(uuid,text,jsonb) from public, anon;

grant execute on function public.normalize_site_workflow_role(text) to authenticated;
grant execute on function public.site_workflow_current_actor() to authenticated;
grant execute on function public.site_workflow_stage_role(text) to authenticated;
grant execute on function public.site_workflow_stage_label(text) to authenticated;
grant execute on function public.site_workflow_next_stage(text) to authenticated;
grant execute on function public.site_workflow_actor_can_view(uuid) to authenticated;
grant execute on function public.site_workflow_actor_can_edit(uuid) to authenticated;
grant execute on function public.rpc_convert_lead_to_assessment(uuid,uuid,text,text,text,date,time without time zone,text,jsonb,jsonb) to authenticated;
grant execute on function public.rpc_save_assessment_section(uuid,text,text,jsonb,bigint,text,uuid,text,text,text) to authenticated;
grant execute on function public.rpc_save_assessment_draft(uuid,text,jsonb,bigint,bigint,timestamptz) to authenticated;
grant execute on function public.rpc_save_site_mom(uuid,jsonb,text) to authenticated;
grant execute on function public.rpc_register_site_image(uuid,uuid,text,text,text,text,bigint,text,jsonb) to authenticated;
grant execute on function public.rpc_submit_for_review(uuid,uuid,text,uuid,text,text,text,text) to authenticated;
grant execute on function public.rpc_record_approval_decision(uuid,uuid,text,text,uuid,text,text,text,text,uuid,text) to authenticated;
grant execute on function public.rpc_return_assessment_for_correction(uuid,text,text,text) to authenticated;
grant execute on function public.rpc_generate_proposal_record(uuid,uuid,text,text,text,text,jsonb,text) to authenticated;
grant execute on function public.rpc_mark_proposal_sent(uuid,text,jsonb) to authenticated;

comment on table public.workflow_events is
  'Authoritative immutable Site Visit workflow audit trail. Modern activity_logs is intentionally unchanged.';
comment on table public.approval_requests is
  'Authoritative Site Visit review decision state; approval_queue is a derived read-only view.';
comment on table public.site_images is
  'Image evidence metadata for the private site-survey-images bucket. Generic documents remain deferred.';

commit;
