-- Mobile_FO_V2 schema migration 2.0
-- 013: Repair FO-named RLS helper so all mobile operational roles can write
-- only their own attendance/site-visit rows.

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
  'Checks own mobile operational RLS access using null-safe, case-insensitive employee codes.';

grant execute on function public.is_current_fo(text) to authenticated;

