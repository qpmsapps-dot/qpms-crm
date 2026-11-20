-- Backend-only enablement for Reliance Retail MIS personal FO tracking.
-- No mobile app/API screens, MIS assignment scope or KM financial policy changes.
-- MIS authorization here is employee-self-scoped, active, state-assigned and
-- explicitly controlled by profiles.mobile_access_enabled.

create or replace function public.retail_mis_mobile_tracking_owner(p_employee_code text)
returns boolean
language sql stable security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.profiles p
    join public.retail_mis_assignments a
      on a.profile_id = p.id
     and a.auth_user_id = p.auth_user_id
     and a.employee_code = p.employee_code
     and a.role = p.role
    where p.auth_user_id = auth.uid()
      and p.employee_code = p_employee_code
      and p.is_active is true
      and coalesce(p.status, 'Active') = 'Active'
      and p.mobile_access_enabled is true
      and p.role in ('MIS_HK', 'MIS_MEPC', 'MIS_OOS')
      and regexp_replace(upper(coalesce(p.business, '')), '[^A-Z0-9]', '', 'g')
          in ('RELIANCE', 'RELIANCERETAIL')
      and a.active is true
      and coalesce(cardinality(a.states), 0) > 0
  )
$$;

revoke all on function public.retail_mis_mobile_tracking_owner(text) from public, anon;
grant execute on function public.retail_mis_mobile_tracking_owner(text) to authenticated;
comment on function public.retail_mis_mobile_tracking_owner(text) is
  'Authenticated Reliance Retail MIS self-only mobile operations ownership. Never grants MIS web admin or financial approvals.';

-- Preserve all current operational role/designation behavior. Add eligible MIS only.
create or replace function public.current_fo_employee_code()
returns text
language sql stable security definer
set search_path = 'public'
as $$
  select p.employee_code
  from public.profiles p
  where p.auth_user_id = auth.uid()
    and p.is_active = true
    and coalesce(p.status, 'Active') = 'Active'
    and (
      p.role in (
        'Admin', 'BD Executive', 'Branch Head', 'COO', 'FO',
        'GM', 'KAM', 'Management', 'MD', 'Operations Manager',
        'OPERATIONS_MANAGER', 'South Head'
      )
      or p.designation in (
        'Developer', 'BD Executive', 'Branch Head', 'COO',
        'Field Officer', 'MIS', 'Vigilance Officer',
        'QUALITY, SAFETY & CRM', 'Key Account Manager',
        'IT Admin', 'MD', 'Operations Manager', 'IFMS HEAD-SOUTH'
      )
      or public.retail_mis_mobile_tracking_owner(p.employee_code)
    )
  limit 1
$$;

create or replace function public.is_current_fo(p_employee_code text)
returns boolean
language sql stable security definer
set search_path = 'public'
as $$
  select exists (
    select 1
    from public.profiles p
    where p.auth_user_id = auth.uid()
      and p.is_active = true
      and coalesce(p.status, 'Active') = 'Active'
      and p.employee_code = p_employee_code
      and (
        p.role in (
          'Admin', 'BD Executive', 'Branch Head', 'COO', 'FO',
          'GM', 'KAM', 'Management', 'MD', 'Operations Manager',
          'OPERATIONS_MANAGER', 'South Head'
        )
        or p.designation in (
          'Developer', 'BD Executive', 'Branch Head', 'COO',
          'Field Officer', 'MIS', 'Vigilance Officer',
          'QUALITY, SAFETY & CRM', 'Key Account Manager',
          'IT Admin', 'MD', 'Operations Manager', 'IFMS HEAD-SOUTH'
        )
        or public.retail_mis_mobile_tracking_owner(p_employee_code)
      )
  )
$$;

-- Add MIS roles to mobile-number resolver while retaining existing roles.
-- For MIS, the resolver also checks active assignment and the mobile flag.
create or replace function public.rpc_resolve_mobile_login_profile(p_mobile text)
returns jsonb
language plpgsql stable security definer
set search_path = 'public'
as $$
declare
  v_profile public.profiles%rowtype;
  v_normalized_role text;
begin
  if nullif(regexp_replace(coalesce(p_mobile, ''), '[^0-9]', '', 'g'), '') is null then
    return jsonb_build_object('status', 'profile_not_found');
  end if;

  select p.* into v_profile
  from public.profiles p
  where regexp_replace(coalesce(p.mobile, ''), '[^0-9]', '', 'g') =
        regexp_replace(coalesce(p_mobile, ''), '[^0-9]', '', 'g')
  order by p.created_at desc limit 1;

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
    upper(btrim(coalesce(v_profile.role, ''))), '[[:space:]_]+', '', 'g'
  );

  if v_normalized_role in ('MISHK', 'MISMEPC', 'MISOOS') then
    if v_profile.mobile_access_enabled is distinct from true
       or coalesce(v_profile.status, 'Active') <> 'Active'
       or regexp_replace(upper(coalesce(v_profile.business, '')), '[^A-Z0-9]', '', 'g')
          not in ('RELIANCE', 'RELIANCERETAIL')
       or not exists (
         select 1 from public.retail_mis_assignments a
         where a.profile_id = v_profile.id
           and a.auth_user_id = v_profile.auth_user_id
           and a.employee_code = v_profile.employee_code
           and a.role = v_profile.role
           and a.active is true
           and coalesce(cardinality(a.states), 0) > 0
       )
    then
      return jsonb_build_object('status', 'role_not_allowed', 'role', v_profile.role);
    end if;
  elsif v_normalized_role not in (
    'FO', 'FIELDOFFICER', 'KAM', 'KEYACCOUNTMANAGER',
    'OPERATIONSMANAGER', 'MANAGER', 'BRANCHHEAD', 'GM'
  ) then
    return jsonb_build_object('status', 'role_not_allowed', 'role', v_profile.role);
  end if;

  if nullif(btrim(coalesce(v_profile.email, '')), '') is null then
    return jsonb_build_object('status', 'auth_user_missing');
  end if;
  return jsonb_build_object('status', 'ok', 'email', v_profile.email, 'role', v_profile.role);
end
$$;

-- Enable the five previously web-only, properly assigned MIS accounts.
-- Existing OOS MIS mobile grant remains unchanged; no role or state changes.
update public.profiles p
set mobile_access_enabled = true, updated_at = now()
from public.retail_mis_assignments a
where a.profile_id = p.id
  and a.auth_user_id = p.auth_user_id
  and a.employee_code = p.employee_code
  and a.role = p.role
  and a.active is true
  and coalesce(cardinality(a.states), 0) > 0
  and p.role in ('MIS_HK', 'MIS_MEPC', 'MIS_OOS')
  and regexp_replace(upper(coalesce(p.business, '')), '[^A-Z0-9]', '', 'g')
      in ('RELIANCE', 'RELIANCERETAIL')
  and p.is_active is true
  and coalesce(p.status, 'Active') = 'Active'
  and p.mobile_access_enabled is false;
