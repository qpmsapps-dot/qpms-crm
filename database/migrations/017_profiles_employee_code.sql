-- Migration 017: Unique employee codes for Field Officers
-- Purpose: Generate FO0001, FO0002, ... for registered Field Officers and
-- use employee_code as the stable identifier for mobile attendance/GPS flows.

create extension if not exists "pgcrypto";

alter table public.profiles add column if not exists employee_code text;

create unique index if not exists ux_profiles_employee_code
  on public.profiles (upper(employee_code))
  where employee_code is not null and trim(employee_code) <> '';

create sequence if not exists public.fo_employee_code_seq;

create or replace function public.next_fo_employee_code()
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_next bigint;
  v_code text;
begin
  loop
    v_next := nextval('public.fo_employee_code_seq');
    v_code := 'FO' || lpad(v_next::text, 4, '0');

    exit when not exists (
      select 1
      from public.profiles
      where upper(employee_code) = upper(v_code)
    );
  end loop;

  return v_code;
end;
$$;

with numbered as (
  select
    id,
    'FO' || lpad(row_number() over (order by created_at, id)::text, 4, '0') as next_code
  from public.profiles
  where role in ('FO', 'Field Officer')
    and (employee_code is null or trim(employee_code) = '')
)
update public.profiles p
set employee_code = numbered.next_code,
    updated_at = now()
from numbered
where p.id = numbered.id;

select setval(
  'public.fo_employee_code_seq',
  greatest(
    coalesce((
      select max((substring(employee_code from 3))::int)
      from public.profiles
      where employee_code ~ '^FO[0-9]{4,}$'
    ), 0),
    0
  )
);

create or replace function public.handle_new_auth_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_email text;
  v_name text;
  v_role text;
  v_mobile text;
  v_birth_date date;
  v_gender text;
  v_state text;
  v_employee_code text;
  v_is_mobile_fo boolean;
begin
  v_email := lower(coalesce(new.email, ''));
  v_name := coalesce(new.raw_user_meta_data ->> 'full_name', new.raw_user_meta_data ->> 'name', split_part(v_email, '@', 1), 'QPMS User');
  v_role := public.normalize_qpms_role(coalesce(new.raw_user_meta_data ->> 'role', 'BD'));
  v_mobile := nullif(trim(coalesce(new.raw_user_meta_data ->> 'mobile', new.raw_user_meta_data ->> 'phone', '')), '');
  v_gender := nullif(trim(coalesce(new.raw_user_meta_data ->> 'gender', '')), '');
  v_state := nullif(trim(coalesce(new.raw_user_meta_data ->> 'state', '')), '');
  v_is_mobile_fo := coalesce(new.raw_user_meta_data ->> 'registration_source', '') = 'myqpms_mobile';
  v_employee_code := nullif(trim(coalesce(new.raw_user_meta_data ->> 'employee_code', '')), '');

  begin
    v_birth_date := nullif(new.raw_user_meta_data ->> 'birth_date', '')::date;
  exception when others then
    v_birth_date := null;
  end;

  if v_is_mobile_fo and v_employee_code is null then
    v_employee_code := public.next_fo_employee_code();
  end if;

  insert into public.profiles (
    auth_user_id,
    email,
    full_name,
    mobile,
    birth_date,
    gender,
    state,
    employee_code,
    role,
    status,
    is_active,
    metadata
  ) values (
    new.id,
    v_email,
    v_name,
    v_mobile,
    v_birth_date,
    v_gender,
    v_state,
    v_employee_code,
    case when v_is_mobile_fo then 'FO' else v_role end,
    case when v_is_mobile_fo then 'Active' else 'Pending Approval' end,
    v_is_mobile_fo,
    coalesce(new.raw_user_meta_data, '{}'::jsonb) - 'password'
  )
  on conflict (email) do update set
    auth_user_id = coalesce(public.profiles.auth_user_id, excluded.auth_user_id),
    full_name = coalesce(nullif(excluded.full_name, ''), public.profiles.full_name),
    mobile = coalesce(excluded.mobile, public.profiles.mobile),
    birth_date = coalesce(excluded.birth_date, public.profiles.birth_date),
    gender = coalesce(excluded.gender, public.profiles.gender),
    state = coalesce(excluded.state, public.profiles.state),
    employee_code = coalesce(public.profiles.employee_code, excluded.employee_code),
    role = excluded.role,
    status = excluded.status,
    is_active = excluded.is_active,
    metadata = (public.profiles.metadata || excluded.metadata) - 'password',
    updated_at = now();

  insert into public.user_roles (
    user_id,
    profile_id,
    role_code,
    is_primary,
    is_active
  )
  select
    new.id,
    p.id,
    public.normalize_qpms_role(p.role),
    true,
    p.is_active
  from public.profiles p
  where p.auth_user_id = new.id
  on conflict (user_id, role_code) do update set
    profile_id = excluded.profile_id,
    is_primary = true,
    is_active = excluded.is_active,
    updated_at = now();

  return new;
end;
$$;

grant execute on function public.next_fo_employee_code() to anon, authenticated;
