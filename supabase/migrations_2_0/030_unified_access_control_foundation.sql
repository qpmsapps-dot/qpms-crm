-- Unified Business / Client / Module access-control foundation.
-- Forward-only, additive, and intentionally isolated from existing production
-- authorization until backend/cloud validation enables migration of users.

create extension if not exists "pgcrypto";

create table if not exists public.access_business_verticals (
  id uuid primary key default gen_random_uuid(),
  code text not null,
  name text not null,
  description text,
  active boolean not null default true,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint access_business_verticals_code_not_blank
    check (btrim(code) <> ''),
  constraint access_business_verticals_metadata_object
    check (jsonb_typeof(metadata) = 'object')
);

create unique index if not exists ux_access_business_verticals_code
  on public.access_business_verticals (lower(code));

create table if not exists public.access_clients (
  id uuid primary key default gen_random_uuid(),
  business_vertical_id uuid not null references public.access_business_verticals(id) on delete restrict,
  code text not null,
  name text not null,
  client_type text,
  active boolean not null default true,
  metadata jsonb not null default '{}'::jsonb,
  effective_from timestamptz not null default now(),
  effective_to timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint access_clients_code_not_blank
    check (btrim(code) <> ''),
  constraint access_clients_effective_range
    check (effective_to is null or effective_to > effective_from),
  constraint access_clients_metadata_object
    check (jsonb_typeof(metadata) = 'object')
);

create unique index if not exists ux_access_clients_vertical_code
  on public.access_clients (business_vertical_id, lower(code));

create index if not exists idx_access_clients_vertical_active
  on public.access_clients (business_vertical_id, active);

create table if not exists public.access_modules (
  id uuid primary key default gen_random_uuid(),
  code text not null,
  name text not null,
  description text,
  application_target text not null default 'shared',
  active boolean not null default true,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint access_modules_code_not_blank
    check (btrim(code) <> ''),
  constraint access_modules_target_not_blank
    check (btrim(application_target) <> ''),
  constraint access_modules_metadata_object
    check (jsonb_typeof(metadata) = 'object')
);

create unique index if not exists ux_access_modules_code
  on public.access_modules (lower(code));

create table if not exists public.access_business_vertical_modules (
  business_vertical_id uuid not null references public.access_business_verticals(id) on delete restrict,
  module_id uuid not null references public.access_modules(id) on delete restrict,
  enabled boolean not null default false,
  configuration jsonb not null default '{}'::jsonb,
  effective_from timestamptz not null default now(),
  effective_to timestamptz,
  created_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (business_vertical_id, module_id),
  constraint access_bvm_effective_range
    check (effective_to is null or effective_to > effective_from),
  constraint access_bvm_configuration_object
    check (jsonb_typeof(configuration) = 'object')
);

create index if not exists idx_access_bvm_module_enabled
  on public.access_business_vertical_modules (module_id, enabled);

create table if not exists public.access_client_modules (
  client_id uuid not null references public.access_clients(id) on delete restrict,
  module_id uuid not null references public.access_modules(id) on delete restrict,
  enabled boolean not null default false,
  configuration jsonb not null default '{}'::jsonb,
  effective_from timestamptz not null default now(),
  effective_to timestamptz,
  created_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (client_id, module_id),
  constraint access_client_modules_effective_range
    check (effective_to is null or effective_to > effective_from),
  constraint access_client_modules_configuration_object
    check (jsonb_typeof(configuration) = 'object')
);

create index if not exists idx_access_client_modules_module_enabled
  on public.access_client_modules (module_id, enabled);

create table if not exists public.access_roles (
  id uuid primary key default gen_random_uuid(),
  code text not null,
  name text not null,
  user_type text not null,
  module_id uuid references public.access_modules(id) on delete restrict,
  active boolean not null default true,
  description text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint access_roles_code_not_blank
    check (btrim(code) <> ''),
  constraint access_roles_user_type_check
    check (user_type in ('internal', 'client')),
  constraint access_roles_metadata_object
    check (jsonb_typeof(metadata) = 'object')
);

create unique index if not exists ux_access_roles_code_module_user_type
  on public.access_roles (
    lower(code),
    coalesce(module_id, '00000000-0000-0000-0000-000000000000'::uuid),
    user_type
  );

create index if not exists idx_access_roles_module_active
  on public.access_roles (module_id, active);

create table if not exists public.access_permissions (
  id uuid primary key default gen_random_uuid(),
  code text not null,
  name text not null,
  module_id uuid not null references public.access_modules(id) on delete restrict,
  action text not null,
  resource text not null,
  description text,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint access_permissions_code_not_blank
    check (btrim(code) <> ''),
  constraint access_permissions_action_not_blank
    check (btrim(action) <> ''),
  constraint access_permissions_resource_not_blank
    check (btrim(resource) <> '')
);

create unique index if not exists ux_access_permissions_code
  on public.access_permissions (lower(code));

create index if not exists idx_access_permissions_module_active
  on public.access_permissions (module_id, active);

create table if not exists public.access_role_permissions (
  role_id uuid not null references public.access_roles(id) on delete restrict,
  permission_id uuid not null references public.access_permissions(id) on delete restrict,
  allowed boolean not null default true,
  created_by uuid,
  created_at timestamptz not null default now(),
  primary key (role_id, permission_id)
);

create index if not exists idx_access_role_permissions_permission
  on public.access_role_permissions (permission_id, allowed);

create table if not exists public.access_user_assignments (
  id uuid primary key default gen_random_uuid(),
  auth_user_id uuid,
  profile_id uuid references public.profiles(id) on delete restrict,
  business_vertical_id uuid not null references public.access_business_verticals(id) on delete restrict,
  client_id uuid references public.access_clients(id) on delete restrict,
  module_id uuid not null references public.access_modules(id) on delete restrict,
  role_id uuid not null references public.access_roles(id) on delete restrict,
  active boolean not null default true,
  verification_status text not null default 'draft',
  effective_from timestamptz not null default now(),
  effective_to timestamptz,
  source text not null default 'manual',
  metadata jsonb not null default '{}'::jsonb,
  created_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint access_user_assignments_identity_required
    check (auth_user_id is not null or profile_id is not null),
  constraint access_user_assignments_verification_status
    check (verification_status in ('draft', 'verified', 'rejected', 'inactive')),
  constraint access_user_assignments_effective_range
    check (effective_to is null or effective_to > effective_from),
  constraint access_user_assignments_metadata_object
    check (jsonb_typeof(metadata) = 'object')
);

create unique index if not exists ux_access_user_assignments_active_identity
  on public.access_user_assignments (
    coalesce(auth_user_id, '00000000-0000-0000-0000-000000000000'::uuid),
    coalesce(profile_id, '00000000-0000-0000-0000-000000000000'::uuid),
    business_vertical_id,
    coalesce(client_id, '00000000-0000-0000-0000-000000000000'::uuid),
    module_id,
    role_id,
    coalesce(effective_to, 'infinity'::timestamptz)
  )
  where active = true and verification_status <> 'rejected';

create index if not exists idx_access_user_assignments_auth_active
  on public.access_user_assignments (auth_user_id, active, verification_status, effective_from, effective_to);

create index if not exists idx_access_user_assignments_profile_active
  on public.access_user_assignments (profile_id, active, verification_status, effective_from, effective_to);

create index if not exists idx_access_user_assignments_context
  on public.access_user_assignments (business_vertical_id, client_id, module_id, role_id);

create table if not exists public.access_user_scopes (
  id uuid primary key default gen_random_uuid(),
  user_assignment_id uuid not null references public.access_user_assignments(id) on delete restrict,
  scope_type text not null,
  scope_id uuid,
  scope_code text,
  scope_text text,
  allowed boolean not null default true,
  metadata jsonb not null default '{}'::jsonb,
  effective_from timestamptz not null default now(),
  effective_to timestamptz,
  created_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint access_user_scopes_type_not_blank
    check (btrim(scope_type) <> ''),
  constraint access_user_scopes_effective_range
    check (effective_to is null or effective_to > effective_from),
  constraint access_user_scopes_metadata_object
    check (jsonb_typeof(metadata) = 'object')
);

create unique index if not exists ux_access_user_scopes_identity
  on public.access_user_scopes (
    user_assignment_id,
    lower(scope_type),
    coalesce(scope_id, '00000000-0000-0000-0000-000000000000'::uuid),
    coalesce(lower(scope_code), ''),
    coalesce(scope_text, '')
  )
  where allowed = true;

create index if not exists idx_access_user_scopes_scope_lookup
  on public.access_user_scopes (scope_type, scope_id, allowed);

create index if not exists idx_access_user_scopes_assignment_allowed
  on public.access_user_scopes (user_assignment_id, allowed, effective_from, effective_to);

create table if not exists public.access_audit_logs (
  id uuid primary key default gen_random_uuid(),
  actor_user_id uuid,
  action text not null,
  target_type text not null,
  target_id uuid,
  before_state jsonb,
  after_state jsonb,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  constraint access_audit_logs_action_not_blank
    check (btrim(action) <> ''),
  constraint access_audit_logs_target_type_not_blank
    check (btrim(target_type) <> ''),
  constraint access_audit_logs_metadata_object
    check (jsonb_typeof(metadata) = 'object')
);

create index if not exists idx_access_audit_logs_actor_created
  on public.access_audit_logs (actor_user_id, created_at desc);

create index if not exists idx_access_audit_logs_target
  on public.access_audit_logs (target_type, target_id, created_at desc);

do $$
declare
  v_table text;
begin
  foreach v_table in array array[
    'access_business_verticals',
    'access_clients',
    'access_modules',
    'access_business_vertical_modules',
    'access_client_modules',
    'access_roles',
    'access_permissions',
    'access_user_assignments',
    'access_user_scopes'
  ]
  loop
    execute format('drop trigger if exists trg_%I_updated_at on public.%I', v_table, v_table);
    execute format(
      'create trigger trg_%I_updated_at before update on public.%I for each row execute function public.set_updated_at()',
      v_table,
      v_table
    );
  end loop;
end $$;

alter table public.access_business_verticals enable row level security;
alter table public.access_clients enable row level security;
alter table public.access_modules enable row level security;
alter table public.access_business_vertical_modules enable row level security;
alter table public.access_client_modules enable row level security;
alter table public.access_roles enable row level security;
alter table public.access_permissions enable row level security;
alter table public.access_role_permissions enable row level security;
alter table public.access_user_assignments enable row level security;
alter table public.access_user_scopes enable row level security;
alter table public.access_audit_logs enable row level security;

revoke all on public.access_business_verticals from anon, authenticated;
revoke all on public.access_clients from anon, authenticated;
revoke all on public.access_modules from anon, authenticated;
revoke all on public.access_business_vertical_modules from anon, authenticated;
revoke all on public.access_client_modules from anon, authenticated;
revoke all on public.access_roles from anon, authenticated;
revoke all on public.access_permissions from anon, authenticated;
revoke all on public.access_role_permissions from anon, authenticated;
revoke all on public.access_user_assignments from anon, authenticated;
revoke all on public.access_user_scopes from anon, authenticated;
revoke all on public.access_audit_logs from anon, authenticated;

-- No direct authenticated access is granted to access-control tables in this
-- foundation phase. Application clients must use backend APIs such as
-- GET /api/access/me and GET /api/access/foundation, where authorization and
-- response minimization are enforced centrally. Service-role/admin workflows
-- remain responsible for writes.

-- Initial conservative platform data. This creates definitions only and no
-- access_user_assignments, so no production user receives new access here.
insert into public.access_business_verticals (code, name, description, metadata)
values
  ('hospital', 'Hospital', 'Hospital facility-management and client ticketing vertical.', '{"source":"phase2_foundation"}'::jsonb),
  ('retail', 'Retail', 'Retail operations, deep cleaning and fault tracking vertical.', '{"source":"phase2_foundation"}'::jsonb),
  ('government', 'Government', 'Government and public-sector operations vertical.', '{"source":"phase2_foundation"}'::jsonb),
  ('airport', 'Airport', 'Airport operations vertical.', '{"source":"phase2_foundation"}'::jsonb),
  ('standalone', 'Standalone', 'Standalone operations vertical.', '{"source":"phase2_foundation"}'::jsonb),
  ('new_business', 'New Business', 'Business development and lead workflow vertical.', '{"source":"phase2_foundation"}'::jsonb)
on conflict do nothing;

insert into public.access_modules (code, name, description, application_target, metadata)
values
  ('client_ticketing', 'Client Ticketing', 'Client-facing complaint/ticketing workflow.', 'client_mobile', '{"source":"phase2_foundation"}'::jsonb),
  ('hospital_operations', 'Hospital Operations', 'myQPMS hospital supervisor and operations workflow.', 'mobile_fo', '{"source":"phase2_foundation"}'::jsonb),
  ('fo_operations', 'Field Operations', 'FO attendance, visits, GPS and KM operations.', 'mobile_fo', '{"source":"phase2_foundation"}'::jsonb),
  ('deep_cleaning', 'Deep Cleaning', 'Reliance Retail deep-cleaning records and reports.', 'web', '{"source":"phase2_foundation"}'::jsonb),
  ('training', 'Training', 'Training activity submissions and review.', 'shared', '{"source":"phase2_foundation"}'::jsonb),
  ('fault_tracker', 'Fault Tracker', 'Fault Tracker dashboards and ticket records.', 'web', '{"source":"phase2_foundation"}'::jsonb),
  ('new_business', 'New Business', 'Lead and approval workflow.', 'web', '{"source":"phase2_foundation"}'::jsonb),
  ('user_management', 'User Management', 'Controlled provisioning and access administration.', 'web', '{"source":"phase2_foundation"}'::jsonb)
on conflict do nothing;

insert into public.access_business_vertical_modules (
  business_vertical_id,
  module_id,
  enabled,
  configuration
)
select bv.id, m.id, true, '{"source":"phase2_foundation"}'::jsonb
from public.access_business_verticals bv
join public.access_modules m on (
  (bv.code = 'hospital' and m.code in ('client_ticketing', 'hospital_operations'))
  or (bv.code = 'retail' and m.code in ('fo_operations', 'deep_cleaning', 'training', 'fault_tracker'))
  or (bv.code = 'new_business' and m.code in ('new_business', 'user_management'))
)
on conflict (business_vertical_id, module_id) do update
set enabled = excluded.enabled,
    configuration = excluded.configuration,
    updated_at = now();

insert into public.access_clients (
  business_vertical_id,
  code,
  name,
  client_type,
  metadata
)
select
  bv.id,
  hc.client_code,
  hc.client_name,
  coalesce(hc.business_type, 'hospital'),
  jsonb_build_object(
    'source', 'legacy_hospital_clients',
    'legacy_hospital_client_id', hc.id
  )
from public.hospital_clients hc
join public.access_business_verticals bv on bv.code = 'hospital'
on conflict do nothing;

insert into public.access_client_modules (
  client_id,
  module_id,
  enabled,
  configuration
)
select c.id, m.id, true, '{"source":"legacy_hospital_client"}'::jsonb
from public.access_clients c
join public.access_business_verticals bv on bv.id = c.business_vertical_id and bv.code = 'hospital'
join public.access_modules m on m.code in ('client_ticketing', 'hospital_operations')
on conflict (client_id, module_id) do update
set enabled = excluded.enabled,
    configuration = excluded.configuration,
    updated_at = now();

insert into public.access_clients (
  business_vertical_id,
  code,
  name,
  client_type,
  metadata
)
select
  bv.id,
  'reliance_retail',
  'Reliance Retail',
  'retail',
  '{"source":"confirmed_existing_modules"}'::jsonb
from public.access_business_verticals bv
where bv.code = 'retail'
  and exists (
    select 1
    from public.store_master sm
    where lower(coalesce(sm.business, sm.client_name, '')) like '%reliance%'
       or lower(coalesce(sm.client_name, sm.business, '')) like '%reliance%'
  )
on conflict do nothing;

insert into public.access_client_modules (
  client_id,
  module_id,
  enabled,
  configuration
)
select c.id, m.id, true, '{"source":"confirmed_existing_modules"}'::jsonb
from public.access_clients c
join public.access_business_verticals bv on bv.id = c.business_vertical_id and bv.code = 'retail'
join public.access_modules m on m.code in ('fo_operations', 'deep_cleaning', 'training', 'fault_tracker')
where c.code = 'reliance_retail'
on conflict (client_id, module_id) do update
set enabled = excluded.enabled,
    configuration = excluded.configuration,
    updated_at = now();

insert into public.access_roles (code, name, user_type, module_id, description, metadata)
select r.code, r.name, r.user_type, m.id, r.description, '{"source":"phase2_foundation"}'::jsonb
from (
  values
    ('hospital_management', 'Hospital Management / RMO', 'client', 'client_ticketing', 'Client-side hospital management complaint raiser/reviewer.'),
    ('doctor', 'Doctor', 'client', 'client_ticketing', 'Client-side doctor complaint raiser.'),
    ('housekeeping_supervisor', 'Supervisor', 'internal', 'hospital_operations', 'Hospital operations supervisor.'),
    ('operations_executive', 'Operations Executive', 'internal', 'hospital_operations', 'Hospital operations executive.'),
    ('facility_manager', 'Facility Manager', 'internal', 'hospital_operations', 'Hospital facility manager.'),
    ('mis', 'MIS', 'internal', 'deep_cleaning', 'MIS read/report role.'),
    ('project_coordinator', 'Project Coordinator', 'internal', 'fault_tracker', 'Fault Tracker project coordinator.'),
    ('admin', 'Admin', 'internal', 'user_management', 'User-management administrator.')
) as r(code, name, user_type, module_code, description)
join public.access_modules m on m.code = r.module_code
on conflict do nothing;

insert into public.access_permissions (code, name, module_id, action, resource, description)
select p.code, p.name, m.id, p.action, p.resource, p.description
from (
  values
    ('hospital_ticket.create', 'Create Hospital Ticket', 'client_ticketing', 'create', 'hospital_ticket', 'Raise client hospital ticket.'),
    ('hospital_ticket.view', 'View Hospital Ticket', 'client_ticketing', 'view', 'hospital_ticket', 'View scoped hospital tickets.'),
    ('hospital_ticket.feedback', 'Submit Ticket Feedback', 'client_ticketing', 'feedback', 'hospital_ticket', 'Submit feedback/reopen.'),
    ('hospital_ticket.accept', 'Accept Hospital Ticket', 'hospital_operations', 'accept', 'hospital_ticket', 'Accept assigned ticket.'),
    ('hospital_ticket.start', 'Start Hospital Ticket Work', 'hospital_operations', 'start', 'hospital_ticket', 'Start ticket work.'),
    ('hospital_ticket.resolve', 'Resolve Hospital Ticket', 'hospital_operations', 'resolve', 'hospital_ticket', 'Resolve ticket.'),
    ('routing.view', 'View Routing', 'hospital_operations', 'view', 'routing', 'View routing coverage.'),
    ('routing.manage', 'Manage Routing', 'hospital_operations', 'manage', 'routing', 'Manage routing assignments.'),
    ('deep_cleaning.view', 'View Deep Cleaning', 'deep_cleaning', 'view', 'deep_cleaning', 'View deep-cleaning records.'),
    ('deep_cleaning.export', 'Export Deep Cleaning', 'deep_cleaning', 'export', 'deep_cleaning', 'Export deep-cleaning reports.'),
    ('fault_tracker.view', 'View Fault Tracker', 'fault_tracker', 'view', 'fault_tracker', 'View fault tracker records.'),
    ('fault_tracker.export', 'Export Fault Tracker', 'fault_tracker', 'export', 'fault_tracker', 'Export fault tracker reports.'),
    ('user_management.invite', 'Invite User', 'user_management', 'invite', 'user_management', 'Invite users.'),
    ('user_management.view', 'View User Management', 'user_management', 'view', 'user_management', 'View user profiles and access.')
) as p(code, name, module_code, action, resource, description)
join public.access_modules m on m.code = p.module_code
on conflict do nothing;

insert into public.access_role_permissions (role_id, permission_id, allowed)
select r.id, p.id, true
from public.access_roles r
join public.access_permissions p on (
  (r.code in ('hospital_management', 'doctor') and p.code in ('hospital_ticket.create', 'hospital_ticket.view', 'hospital_ticket.feedback'))
  or (r.code = 'housekeeping_supervisor' and p.code in ('hospital_ticket.view', 'hospital_ticket.accept', 'hospital_ticket.start', 'hospital_ticket.resolve'))
  or (r.code = 'operations_executive' and p.code in ('hospital_ticket.view', 'routing.view'))
  or (r.code = 'facility_manager' and p.code in ('hospital_ticket.view', 'routing.view'))
  or (r.code = 'mis' and p.code in ('deep_cleaning.view', 'deep_cleaning.export'))
  or (r.code = 'project_coordinator' and p.code in ('fault_tracker.view', 'fault_tracker.export'))
  or (r.code = 'admin' and p.code in ('user_management.view', 'user_management.invite'))
)
on conflict (role_id, permission_id) do update
set allowed = excluded.allowed;
