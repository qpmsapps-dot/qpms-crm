-- Migration 016: Mobile FO self registration support
-- Purpose: Store myQPMS mobile registration profile fields while keeping
-- passwords in Supabase Auth, never in public tables.

create extension if not exists "pgcrypto";

alter table public.profiles add column if not exists mobile text;
alter table public.profiles add column if not exists birth_date date;
alter table public.profiles add column if not exists gender text;
alter table public.profiles add column if not exists state text;

create unique index if not exists ux_profiles_mobile
  on public.profiles (regexp_replace(coalesce(mobile, ''), '\D', '', 'g'))
  where mobile is not null and trim(mobile) <> '';

create unique index if not exists ux_profiles_email_normalized
  on public.profiles (lower(email));

create or replace function public.rpc_check_fo_registration_unique(
  p_mobile text,
  p_email text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_mobile text;
  v_email text;
  v_mobile_exists boolean;
  v_email_exists boolean;
begin
  v_mobile := regexp_replace(coalesce(p_mobile, ''), '\D', '', 'g');
  v_email := lower(trim(coalesce(p_email, '')));

  select exists (
    select 1
    from public.profiles
    where regexp_replace(coalesce(mobile, ''), '\D', '', 'g') = v_mobile
      and v_mobile <> ''
  ) into v_mobile_exists;

  select exists (
    select 1
    from public.profiles
    where lower(email) = v_email
      and v_email <> ''
  ) into v_email_exists;

  return jsonb_build_object(
    'mobile_exists', v_mobile_exists,
    'email_exists', v_email_exists
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
    and is_active = true
  order by created_at desc
  limit 1;

  return v_email;
end;
$$;

grant execute on function public.rpc_check_fo_registration_unique(text, text) to anon, authenticated;
grant execute on function public.rpc_resolve_fo_login_email(text) to anon, authenticated;

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
  v_is_mobile_fo boolean;
begin
  v_email := lower(coalesce(new.email, ''));
  v_name := coalesce(new.raw_user_meta_data ->> 'full_name', new.raw_user_meta_data ->> 'name', split_part(v_email, '@', 1), 'QPMS User');
  v_role := public.normalize_qpms_role(coalesce(new.raw_user_meta_data ->> 'role', 'BD'));
  v_mobile := nullif(trim(coalesce(new.raw_user_meta_data ->> 'mobile', new.raw_user_meta_data ->> 'phone', '')), '');
  v_gender := nullif(trim(coalesce(new.raw_user_meta_data ->> 'gender', '')), '');
  v_state := nullif(trim(coalesce(new.raw_user_meta_data ->> 'state', '')), '');
  v_is_mobile_fo := coalesce(new.raw_user_meta_data ->> 'registration_source', '') = 'myqpms_mobile';

  begin
    v_birth_date := nullif(new.raw_user_meta_data ->> 'birth_date', '')::date;
  exception when others then
    v_birth_date := null;
  end;

  insert into public.profiles (
    auth_user_id,
    email,
    full_name,
    mobile,
    birth_date,
    gender,
    state,
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
