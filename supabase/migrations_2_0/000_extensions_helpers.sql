-- Mobile_FO_V2 schema migration 2.0
-- 000: Extensions and shared helper functions.

create extension if not exists "pgcrypto";

create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

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
      and p.role in (
        'Admin',
        'BD Head',
        'Operations Team',
        'Coordinator',
        'Commercial',
        'Commercial Team',
        'Commercial Reviewer',
        'Finance',
        'Finance Team',
        'Finance Reviewer',
        'HR Reviewer',
        'COO'
      )
  );
end;
$$;

create or replace function public.rpc_resolve_fo_login_email(p_mobile text)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_mobile text;
  v_email text;
begin
  v_mobile := regexp_replace(coalesce(p_mobile, ''), '\D', '', 'g');

  select email
  into v_email
  from public.profiles
  where regexp_replace(coalesce(mobile, ''), '\D', '', 'g') = v_mobile
    and role in ('FO', 'Field Officer')
    and coalesce(is_active, true) = true
  order by created_at desc
  limit 1;

  return v_email;
end;
$$;

create or replace function public.rpc_check_fo_registration_unique(
  p_employee_code text,
  p_mobile text,
  p_email text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_employee_code text;
  v_mobile text;
  v_email text;
begin
  v_employee_code := upper(trim(coalesce(p_employee_code, '')));
  v_mobile := regexp_replace(coalesce(p_mobile, ''), '\D', '', 'g');
  v_email := lower(trim(coalesce(p_email, '')));

  return jsonb_build_object(
    'employee_code_exists',
      exists (
        select 1
        from public.profiles
        where upper(coalesce(employee_code, '')) = v_employee_code
          and v_employee_code <> ''
      ),
    'mobile_exists',
      exists (
        select 1
        from public.profiles
        where regexp_replace(coalesce(mobile, ''), '\D', '', 'g') = v_mobile
          and v_mobile <> ''
      ),
    'email_exists',
      exists (
        select 1
        from public.profiles
        where lower(coalesce(email, '')) = v_email
          and v_email <> ''
      )
  );
end;
$$;

grant execute on function public.current_fo_employee_code() to authenticated;
grant execute on function public.is_current_fo(text) to authenticated;
grant execute on function public.is_qpms_admin() to authenticated;
grant execute on function public.rpc_resolve_fo_login_email(text) to anon, authenticated;
grant execute on function public.rpc_check_fo_registration_unique(text, text, text) to anon, authenticated;
