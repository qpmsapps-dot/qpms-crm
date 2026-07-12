-- Mobile_FO_V2 schema migration 2.0
-- 017: Allow intended admin/developer aliases through mobile login RPC and
-- admin-style RLS helpers without weakening own-record operational access.

create or replace function public.current_fo_employee_code()
returns text
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_employee_code text;
begin
  select p.employee_code
  into v_employee_code
  from public.profiles p
  where p.auth_user_id = auth.uid()
    and p.is_active = true
    and coalesce(p.mobile_access_enabled, true) = true
    and regexp_replace(upper(btrim(coalesce(p.role, ''))), '[[:space:]_]+', '', 'g') in (
      'FO',
      'FIELDOFFICER',
      'KAM',
      'KEYACCOUNTMANAGER',
      'OM',
      'OPERATIONSMANAGER',
      'MANAGER',
      'BRANCHHEAD',
      'GM',
      'GENERALMANAGER'
    )
  order by p.created_at desc
  limit 1;

  return v_employee_code;
end;
$$;

comment on function public.current_fo_employee_code() is
  'Returns the active authenticated mobile operational user employee code for FO-owned RLS policies.';

grant execute on function public.current_fo_employee_code() to authenticated;

create or replace function public.is_qpms_admin()
returns boolean
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  return exists (
    select 1
    from public.profiles p
    where p.auth_user_id = auth.uid()
      and coalesce(p.is_active, true) = true
      and regexp_replace(upper(btrim(coalesce(p.role, ''))), '[[:space:]_]+', '', 'g') in (
        'ADMIN',
        'QPMSADMIN',
        'DEVELOPER',
        'DEV',
        'ITADMIN',
        'MANAGEMENTITADMIN',
        'BDHEAD',
        'OPERATIONSTEAM',
        'COORDINATOR',
        'COMMERCIAL',
        'COMMERCIALTEAM',
        'COMMERCIALREVIEWER',
        'FINANCE',
        'FINANCETEAM',
        'FINANCEREVIEWER',
        'HRREVIEWER',
        'COO'
      )
  );
end;
$$;

grant execute on function public.is_qpms_admin() to authenticated;

create or replace function public.rpc_resolve_mobile_login_profile(p_mobile text)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_profile public.profiles%rowtype;
  v_normalized_role text;
begin
  select p.*
  into v_profile
  from public.profiles p
  where regexp_replace(coalesce(p.mobile, ''), '\D', '', 'g') =
        regexp_replace(coalesce(p_mobile, ''), '\D', '', 'g')
  order by p.created_at desc
  limit 1;

  if not found then
    return jsonb_build_object('status', 'profile_not_found');
  end if;

  if v_profile.auth_user_id is null then
    return jsonb_build_object('status', 'auth_user_missing');
  end if;

  if v_profile.is_active is distinct from true then
    return jsonb_build_object('status', 'inactive_profile');
  end if;

  v_normalized_role := regexp_replace(
    upper(btrim(coalesce(v_profile.role, ''))),
    '[[:space:]_]+',
    '',
    'g'
  );

  if v_normalized_role not in (
    'FO',
    'FIELDOFFICER',
    'KAM',
    'KEYACCOUNTMANAGER',
    'OM',
    'OPERATIONSMANAGER',
    'MANAGER',
    'BRANCHHEAD',
    'GM',
    'GENERALMANAGER',
    'ADMIN',
    'QPMSADMIN',
    'DEVELOPER',
    'DEV',
    'ITADMIN',
    'MANAGEMENTITADMIN'
  ) then
    return jsonb_build_object(
      'status', 'role_not_allowed',
      'role', v_profile.role
    );
  end if;

  if nullif(btrim(coalesce(v_profile.email, '')), '') is null then
    return jsonb_build_object('status', 'auth_user_missing');
  end if;

  return jsonb_build_object(
    'status', 'ok',
    'email', v_profile.email,
    'role', v_profile.role
  );
end;
$$;

comment on function public.rpc_resolve_mobile_login_profile(text) is
  'Resolves active Operations/Admin mobile login profiles and returns a non-sensitive diagnostic status.';

grant execute on function public.rpc_resolve_mobile_login_profile(text) to anon, authenticated;

create or replace function public.rpc_resolve_fo_login_email(p_mobile text)
returns text
language sql
stable
security definer
set search_path = public
as $$
  select case
    when resolved ->> 'status' = 'ok' then resolved ->> 'email'
    else null
  end
  from (select public.rpc_resolve_mobile_login_profile(p_mobile) as resolved) result
$$;

comment on function public.rpc_resolve_fo_login_email(text) is
  'Legacy-compatible email resolver for all active Operations/Admin mobile roles.';

grant execute on function public.rpc_resolve_fo_login_email(text) to anon, authenticated;
