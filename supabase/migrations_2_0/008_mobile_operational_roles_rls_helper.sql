-- Mobile_FO_V2 schema migration 2.0
-- 008: Allow active mobile operational roles through FO-owned RLS policies.

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
      'MIS'
    )
  order by p.created_at desc
  limit 1;

  return v_employee_code;
end;
$$;

comment on function public.current_fo_employee_code() is
  'Returns the active authenticated mobile operational user employee code for FO-owned RLS policies.';

grant execute on function public.current_fo_employee_code() to authenticated;

create or replace function public.is_current_fo(p_employee_code text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(
    nullif(
      regexp_replace(
        upper(btrim(public.current_fo_employee_code())),
        '[[:space:]_]+',
        '',
        'g'
      ),
      ''
    ) = nullif(
      regexp_replace(
        upper(btrim(p_employee_code)),
        '[[:space:]_]+',
        '',
        'g'
      ),
      ''
    ),
    false
  )
$$;

comment on function public.is_current_fo(text) is
  'Checks FO-owned RLS access using null-safe, case-insensitive employee codes with spaces and underscores removed.';

grant execute on function public.is_current_fo(text) to authenticated;

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
    'OPERATIONSMANAGER',
    'MANAGER',
    'BRANCHHEAD',
    'GM'
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
  'Resolves active Operations mobile login profiles and returns a non-sensitive diagnostic status.';

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
  'Legacy-compatible email resolver for all active Operations mobile roles.';

grant execute on function public.rpc_resolve_fo_login_email(text) to anon, authenticated;

/*
ROLLBACK SQL (run manually; do not include in the forward migration execution):

drop function if exists public.rpc_resolve_mobile_login_profile(text);

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
    and p.role in ('FO', 'Field Officer')
    and coalesce(p.is_active, true) = true
  order by p.created_at desc
  limit 1;

  return v_employee_code;
end;
$$;

create or replace function public.is_current_fo(p_employee_code text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(public.current_fo_employee_code() = p_employee_code, false)
$$;

comment on function public.current_fo_employee_code() is null;
comment on function public.is_current_fo(text) is null;

grant execute on function public.current_fo_employee_code() to authenticated;
grant execute on function public.is_current_fo(text) to authenticated;
*/

/*
MANUAL TEST SQL (run each transaction separately in the Supabase SQL editor):

-- Expected: true for QPMSKL1346.
begin;
select set_config(
  'request.jwt.claim.sub',
  (
    select p.auth_user_id::text
    from public.profiles p
    where regexp_replace(upper(btrim(p.employee_code)), '[[:space:]_]+', '', 'g') = 'QPMSKL1346'
    limit 1
  ),
  true
);
set local role authenticated;
select public.is_current_fo('QPMSKL1346') as qpmskl1346_allowed;
rollback;

-- Expected: true when the authenticated profile stores QPMS KL 3310.
begin;
select set_config(
  'request.jwt.claim.sub',
  (
    select p.auth_user_id::text
    from public.profiles p
    where regexp_replace(upper(btrim(p.employee_code)), '[[:space:]_]+', '', 'g') = 'QPMSKL3310'
    limit 1
  ),
  true
);
set local role authenticated;
select public.is_current_fo('QPMSKL3310') as qpmskl3310_allowed;
rollback;

-- Expected: true when the authenticated profile stores QPMS TN 4360.
begin;
select set_config(
  'request.jwt.claim.sub',
  (
    select p.auth_user_id::text
    from public.profiles p
    where regexp_replace(upper(btrim(p.employee_code)), '[[:space:]_]+', '', 'g') = 'QPMSTN4360'
    limit 1
  ),
  true
);
set local role authenticated;
select public.is_current_fo('QPMSTN4360') as qpmstn4360_allowed;
rollback;
*/
