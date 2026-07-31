-- Hospital Feedback QR - Phase 1 public QR foundation.
-- Additive only. Reuses hospital_clients/blocks/floors/departments/locations.
-- Rollback guidance:
--   drop table public.hospital_feedback_qr_codes;
--   delete from public.access_role_permissions where permission_id in (
--     select id from public.access_permissions where code like 'hospital_feedback_qr.%'
--   );
--   delete from public.access_permissions where code like 'hospital_feedback_qr.%';
--   delete from public.access_modules where code = 'hospital_feedback';

create extension if not exists "pgcrypto";

create table if not exists public.hospital_feedback_qr_codes (
  id uuid primary key default gen_random_uuid(),
  location_id uuid not null references public.hospital_locations(id) on delete restrict,
  public_token_hash text not null,
  public_token_encrypted text,
  token_lookup_key text not null,
  status text not null default 'active',
  version integer not null default 1,
  generated_by uuid references public.profiles(id) on delete set null,
  generated_at timestamptz not null default now(),
  activated_at timestamptz,
  deactivated_at timestamptz,
  replaced_at timestamptz,
  replaced_by_qr_id uuid references public.hospital_feedback_qr_codes(id) on delete set null,
  replacement_reason text,
  last_printed_at timestamptz,
  print_count integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  metadata jsonb not null default '{}'::jsonb,
  constraint hospital_feedback_qr_status_check
    check (status in ('active', 'inactive', 'replaced', 'revoked')),
  constraint hospital_feedback_qr_version_check check (version > 0),
  constraint hospital_feedback_qr_print_count_check check (print_count >= 0),
  constraint hospital_feedback_qr_hash_not_blank check (btrim(public_token_hash) <> ''),
  constraint hospital_feedback_qr_lookup_not_blank check (btrim(token_lookup_key) <> ''),
  constraint hospital_feedback_qr_metadata_object check (jsonb_typeof(metadata) = 'object')
);

create unique index if not exists ux_hospital_feedback_qr_token_hash
  on public.hospital_feedback_qr_codes(public_token_hash);

create unique index if not exists ux_hospital_feedback_qr_one_active_per_location
  on public.hospital_feedback_qr_codes(location_id)
  where status = 'active';

create index if not exists idx_hospital_feedback_qr_lookup
  on public.hospital_feedback_qr_codes(token_lookup_key, status);

create index if not exists idx_hospital_feedback_qr_location_status
  on public.hospital_feedback_qr_codes(location_id, status, created_at desc);

do $$
begin
  if exists (
    select 1 from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'set_updated_at'
  ) then
    drop trigger if exists trg_hospital_feedback_qr_codes_updated_at on public.hospital_feedback_qr_codes;
    create trigger trg_hospital_feedback_qr_codes_updated_at
    before update on public.hospital_feedback_qr_codes
    for each row execute function public.set_updated_at();
  else
    drop trigger if exists trg_hospital_feedback_qr_codes_updated_at on public.hospital_feedback_qr_codes;
    create trigger trg_hospital_feedback_qr_codes_updated_at
    before update on public.hospital_feedback_qr_codes
    for each row execute function public.set_hospital_ticket_updated_at();
  end if;
end $$;

alter table public.hospital_feedback_qr_codes enable row level security;
revoke all on public.hospital_feedback_qr_codes from anon, authenticated;
grant all on public.hospital_feedback_qr_codes to service_role;

insert into public.access_modules (code, name, description, application_target, metadata)
values (
  'hospital_feedback',
  'Hospital Feedback',
  'Hospital public feedback QR foundation.',
  'web',
  '{"source":"phase1_hospital_feedback_qr"}'::jsonb
)
on conflict do nothing;

insert into public.access_business_vertical_modules (
  business_vertical_id,
  module_id,
  enabled,
  configuration
)
select bv.id, m.id, true, '{"source":"phase1_hospital_feedback_qr"}'::jsonb
from public.access_business_verticals bv
join public.access_modules m on m.code = 'hospital_feedback'
where bv.code = 'hospital'
on conflict (business_vertical_id, module_id) do update
set enabled = excluded.enabled,
    configuration = excluded.configuration,
    updated_at = now();

insert into public.access_client_modules (
  client_id,
  module_id,
  enabled,
  configuration
)
select c.id, m.id, true, '{"source":"phase1_hospital_feedback_qr"}'::jsonb
from public.access_clients c
join public.access_business_verticals bv on bv.id = c.business_vertical_id and bv.code = 'hospital'
join public.access_modules m on m.code = 'hospital_feedback'
on conflict (client_id, module_id) do update
set enabled = excluded.enabled,
    configuration = excluded.configuration,
    updated_at = now();

insert into public.access_permissions (code, name, module_id, action, resource, description)
select p.code, p.name, m.id, p.action, p.resource, p.description
from (
  values
    ('hospital_feedback_qr.view', 'View Hospital Feedback QR', 'view', 'hospital_feedback_qr', 'View scoped hospital feedback QR foundation data.'),
    ('hospital_feedback_qr.generate', 'Generate Hospital Feedback QR', 'generate', 'hospital_feedback_qr', 'Generate scoped public hospital feedback QR codes.')
) as p(code, name, action, resource, description)
join public.access_modules m on m.code = 'hospital_feedback'
on conflict do nothing;

insert into public.access_roles (code, name, user_type, module_id, description, metadata)
select r.code, r.name, r.user_type, m.id, r.description, '{"source":"phase1_hospital_feedback_qr"}'::jsonb
from (
  values
    ('admin', 'Admin', 'internal', 'Hospital Feedback QR administrator.'),
    ('operations_executive', 'Operations Executive', 'internal', 'Generate scoped Hospital Feedback QR codes.'),
    ('facility_manager', 'Facility Manager', 'internal', 'Generate scoped Hospital Feedback QR codes.')
) as r(code, name, user_type, description)
join public.access_modules m on m.code = 'hospital_feedback'
on conflict (
  lower(code),
  coalesce(module_id, '00000000-0000-0000-0000-000000000000'::uuid),
  user_type
) do nothing;

insert into public.access_role_permissions (role_id, permission_id, allowed)
select r.id, p.id, true
from public.access_roles r
join public.access_modules m on m.id = r.module_id and m.code = 'hospital_feedback'
join public.access_permissions p on p.module_id = m.id
where r.code in ('admin', 'operations_executive', 'facility_manager')
  and p.code in ('hospital_feedback_qr.view', 'hospital_feedback_qr.generate')
on conflict (role_id, permission_id) do update
set allowed = excluded.allowed;

comment on table public.hospital_feedback_qr_codes is
  'Phase 1 registry for secure public Hospital Feedback QR tokens mapped to canonical hospital_locations. No survey or ticket creation data is stored here.';
comment on column public.hospital_feedback_qr_codes.public_token_hash is
  'SHA-256 hash of the public QR token; raw token is not exposed by public APIs.';
comment on column public.hospital_feedback_qr_codes.public_token_encrypted is
  'Server-encrypted token copy for controlled reprint/demo retrieval when the backend encryption secret is configured.';
