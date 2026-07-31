-- Hospital Feedback QR Phase 1: grant one existing demo user scoped access.
--
-- DO NOT run until you replace the three values in the params CTE:
--   p_email
--   p_employee_code
--   p_hospital_name
--
-- This script is intentionally idempotent and does not create users,
-- hospitals, access clients, modules, roles, or permissions. It reuses the
-- records created by the existing profile, hospital master, unified access,
-- and migration 039 foundations.

begin;

do $$
declare
  v_email text := '<ACTUAL USER EMAIL>';
  v_employee_code text := '<ACTUAL EMPLOYEE CODE>';
  v_hospital_name text := '<ACTUAL HOSPITAL NAME>';
  v_profile public.profiles%rowtype;
  v_hospital_client public.hospital_clients%rowtype;
  v_business_vertical public.access_business_verticals%rowtype;
  v_access_client public.access_clients%rowtype;
  v_module public.access_modules%rowtype;
  v_role public.access_roles%rowtype;
  v_assignment public.access_user_assignments%rowtype;
  v_match_count integer := 0;
  v_zero_uuid constant uuid := '00000000-0000-0000-0000-000000000000'::uuid;
begin
  if v_email like '<ACTUAL%' or v_employee_code like '<ACTUAL%' or v_hospital_name like '<ACTUAL%' then
    raise exception 'Replace p_email, p_employee_code, and p_hospital_name before running this script.';
  end if;

  select count(*)
  into v_match_count
  from public.profiles
  where lower(email) = lower(v_email)
    and upper(employee_code) = upper(v_employee_code)
    and is_active = true
    and lower(coalesce(status, 'active')) = 'active';

  if v_match_count = 0 then
    raise exception 'Active profile not found for email % and employee code %.', v_email, v_employee_code;
  elsif v_match_count > 1 then
    raise exception 'Multiple active profiles found for email % and employee code %. Resolve duplicates before granting access.', v_email, v_employee_code;
  end if;

  select *
  into v_profile
  from public.profiles
  where lower(email) = lower(v_email)
    and upper(employee_code) = upper(v_employee_code)
    and is_active = true
    and lower(coalesce(status, 'active')) = 'active'
  order by created_at desc
  limit 1;

  if v_profile.auth_user_id is null then
    raise exception 'Profile % has no auth_user_id; unified access requires an auth user identity.', v_profile.id;
  end if;

  select count(*)
  into v_match_count
  from public.hospital_clients
  where lower(client_name) = lower(v_hospital_name)
    and is_active = true;

  if v_match_count = 0 then
    raise exception 'Active hospital client not found for hospital name %.', v_hospital_name;
  elsif v_match_count > 1 then
    raise exception 'Multiple active hospital clients found for hospital name %. Use a unique hospital name or resolve duplicates before granting access.', v_hospital_name;
  end if;

  select *
  into v_hospital_client
  from public.hospital_clients
  where lower(client_name) = lower(v_hospital_name)
    and is_active = true
  order by created_at desc
  limit 1;

  select *
  into v_business_vertical
  from public.access_business_verticals
  where code = 'hospital'
    and active = true
  limit 1;

  if not found then
    raise exception 'Active access business vertical "hospital" was not found.';
  end if;

  select count(*)
  into v_match_count
  from public.access_clients
  where business_vertical_id = v_business_vertical.id
    and active = true
    and (
      metadata ->> 'legacy_hospital_client_id' = v_hospital_client.id::text
      or code = v_hospital_client.client_code
    );

  if v_match_count = 0 then
    raise exception 'Access client mapping missing for hospital %. Expected access_clients.metadata.legacy_hospital_client_id = % or code = %.',
      v_hospital_client.client_name,
      v_hospital_client.id,
      v_hospital_client.client_code;
  elsif v_match_count > 1 then
    raise exception 'Multiple access client mappings found for hospital %. Resolve access_clients mapping before granting access.', v_hospital_client.client_name;
  end if;

  select *
  into v_access_client
  from public.access_clients
  where business_vertical_id = v_business_vertical.id
    and active = true
    and (
      metadata ->> 'legacy_hospital_client_id' = v_hospital_client.id::text
      or code = v_hospital_client.client_code
    )
  order by
    case when metadata ->> 'legacy_hospital_client_id' = v_hospital_client.id::text then 0 else 1 end,
    created_at desc
  limit 1;

  if v_access_client.code <> v_hospital_client.client_code
     and coalesce(v_access_client.metadata ->> 'legacy_hospital_client_id', '') <> v_hospital_client.id::text then
    raise exception 'Resolved access client % does not safely map to hospital client %.', v_access_client.id, v_hospital_client.id;
  end if;

  select *
  into v_module
  from public.access_modules
  where code = 'hospital_feedback'
    and active = true
  limit 1;

  if not found then
    raise exception 'Active access module "hospital_feedback" was not found. Confirm migration 039 was applied.';
  end if;

  if not exists (
    select 1
    from public.access_business_vertical_modules
    where business_vertical_id = v_business_vertical.id
      and module_id = v_module.id
      and enabled = true
      and effective_from <= now()
      and (effective_to is null or effective_to > now())
  ) then
    raise exception 'Module hospital_feedback is not enabled for business vertical hospital.';
  end if;

  if not exists (
    select 1
    from public.access_client_modules
    where client_id = v_access_client.id
      and module_id = v_module.id
      and enabled = true
      and effective_from <= now()
      and (effective_to is null or effective_to > now())
  ) then
    raise exception 'Module hospital_feedback is not enabled for access client % (%).', v_access_client.code, v_access_client.id;
  end if;

  select r.*
  into v_role
  from public.access_roles r
  where r.code = 'admin'
    and r.user_type = 'internal'
    and r.module_id = v_module.id
    and r.active = true
  limit 1;

  if not found then
    raise exception 'Active hospital_feedback module role "admin" was not found. Confirm migration 039 role seed was applied.';
  end if;

  if not exists (
    select 1
    from public.access_role_permissions arp
    join public.access_permissions p on p.id = arp.permission_id
    where arp.role_id = v_role.id
      and arp.allowed = true
      and p.active = true
      and p.module_id = v_module.id
      and p.code = 'hospital_feedback_qr.view'
  ) then
    raise exception 'Role hospital_feedback/admin is missing permission hospital_feedback_qr.view.';
  end if;

  if not exists (
    select 1
    from public.access_role_permissions arp
    join public.access_permissions p on p.id = arp.permission_id
    where arp.role_id = v_role.id
      and arp.allowed = true
      and p.active = true
      and p.module_id = v_module.id
      and p.code = 'hospital_feedback_qr.generate'
  ) then
    raise exception 'Role hospital_feedback/admin is missing permission hospital_feedback_qr.generate.';
  end if;

  insert into public.access_user_assignments (
    auth_user_id,
    profile_id,
    business_vertical_id,
    client_id,
    module_id,
    role_id,
    active,
    verification_status,
    effective_from,
    effective_to,
    source,
    metadata,
    created_by
  )
  values (
    v_profile.auth_user_id,
    v_profile.id,
    v_business_vertical.id,
    v_access_client.id,
    v_module.id,
    v_role.id,
    true,
    'verified',
    now(),
    null,
    'manual_hospital_feedback_qr_demo',
    jsonb_build_object(
      'source', 'hospital_feedback_qr_demo_user_access',
      'hospital_client_id', v_hospital_client.id,
      'hospital_client_code', v_hospital_client.client_code
    ),
    null
  )
  on conflict (
    (coalesce(auth_user_id, '00000000-0000-0000-0000-000000000000'::uuid)),
    (coalesce(profile_id, '00000000-0000-0000-0000-000000000000'::uuid)),
    business_vertical_id,
    (coalesce(client_id, '00000000-0000-0000-0000-000000000000'::uuid)),
    module_id,
    role_id,
    (coalesce(effective_to, 'infinity'::timestamptz))
  )
  where active = true and verification_status <> 'rejected'
  do update
  set active = true,
      verification_status = 'verified',
      metadata = public.access_user_assignments.metadata || excluded.metadata,
      updated_at = now()
  returning * into v_assignment;

  insert into public.access_user_scopes (
    user_assignment_id,
    scope_type,
    scope_id,
    scope_code,
    scope_text,
    allowed,
    metadata,
    effective_from,
    effective_to,
    created_by
  )
  values (
    v_assignment.id,
    'client',
    v_access_client.id,
    v_access_client.code,
    v_access_client.name,
    true,
    jsonb_build_object(
      'source', 'hospital_feedback_qr_demo_user_access',
      'hospital_client_id', v_hospital_client.id,
      'hospital_client_name', v_hospital_client.client_name
    ),
    now(),
    null,
    null
  )
  on conflict (
    user_assignment_id,
    (lower(scope_type)),
    (coalesce(scope_id, '00000000-0000-0000-0000-000000000000'::uuid)),
    (coalesce(lower(scope_code), '')),
    (coalesce(scope_text, ''))
  )
  where allowed = true
  do update
  set allowed = excluded.allowed,
      metadata = public.access_user_scopes.metadata || excluded.metadata,
      updated_at = now();

  raise notice 'Hospital Feedback QR access granted: profile %, access client %, assignment %.',
    v_profile.id,
    v_access_client.id,
    v_assignment.id;
end $$;

commit;

-- Verification query.
-- Replace the same three values below before running.
with params as (
  select
    '<ACTUAL USER EMAIL>'::text as p_email,
    '<ACTUAL EMPLOYEE CODE>'::text as p_employee_code,
    '<ACTUAL HOSPITAL NAME>'::text as p_hospital_name
),
resolved as (
  select
    p.id as profile_id,
    p.auth_user_id,
    p.email,
    p.employee_code,
    hc.id as hospital_client_id,
    hc.client_code as hospital_client_code,
    hc.client_name as hospital_name,
    ac.id as access_client_id,
    ac.code as access_client_code,
    bv.id as business_vertical_id,
    m.id as module_id,
    r.id as role_id
  from params x
  join public.profiles p
    on lower(p.email) = lower(x.p_email)
   and upper(p.employee_code) = upper(x.p_employee_code)
   and p.is_active = true
   and lower(coalesce(p.status, 'active')) = 'active'
  join public.hospital_clients hc
    on lower(hc.client_name) = lower(x.p_hospital_name)
   and hc.is_active = true
  join public.access_business_verticals bv
    on bv.code = 'hospital'
   and bv.active = true
  join public.access_clients ac
    on ac.business_vertical_id = bv.id
   and ac.active = true
   and (
     ac.metadata ->> 'legacy_hospital_client_id' = hc.id::text
     or ac.code = hc.client_code
   )
  join public.access_modules m
    on m.code = 'hospital_feedback'
   and m.active = true
  join public.access_roles r
    on r.module_id = m.id
   and r.code = 'admin'
   and r.user_type = 'internal'
   and r.active = true
),
assignment as (
  select a.*
  from public.access_user_assignments a
  join resolved r
    on a.auth_user_id = r.auth_user_id
   and a.profile_id = r.profile_id
   and a.business_vertical_id = r.business_vertical_id
   and a.client_id = r.access_client_id
   and a.module_id = r.module_id
   and a.role_id = r.role_id
  where a.active = true
    and a.verification_status = 'verified'
    and a.effective_from <= now()
    and (a.effective_to is null or a.effective_to > now())
),
scope_check as (
  select s.*
  from public.access_user_scopes s
  join assignment a on a.id = s.user_assignment_id
  join resolved r on r.access_client_id = s.scope_id
  where s.allowed = true
    and s.scope_type = 'client'
    and s.effective_from <= now()
    and (s.effective_to is null or s.effective_to > now())
),
permission_check as (
  select
    bool_or(p.code = 'hospital_feedback_qr.view' and arp.allowed = true and p.active = true) as can_view,
    bool_or(p.code = 'hospital_feedback_qr.generate' and arp.allowed = true and p.active = true) as can_generate
  from resolved r
  join public.access_role_permissions arp on arp.role_id = r.role_id
  join public.access_permissions p on p.id = arp.permission_id and p.module_id = r.module_id
)
select
  exists(select 1 from assignment) as has_active_hospital_feedback_assignment,
  exists(select 1 from scope_check) as has_selected_hospital_client_scope,
  coalesce((select can_view from permission_check), false) as hospital_feedback_qr_view_allowed,
  coalesce((select can_generate from permission_check), false) as hospital_feedback_qr_generate_allowed,
  (select jsonb_build_object(
    'email', email,
    'employee_code', employee_code,
    'hospital_name', hospital_name,
    'hospital_client_id', hospital_client_id,
    'access_client_id', access_client_id,
    'access_client_code', access_client_code,
    'module', 'hospital_feedback',
    'role', 'admin'
  ) from resolved limit 1) as resolved_context;
