-- Mobile_FO_V2 schema migration 2.0
-- 001: Profiles table, registration/login support, profile indexes.

create table if not exists public.profiles (
  id uuid primary key default gen_random_uuid(),
  auth_user_id uuid,
  employee_code text,
  username text,
  full_name text,
  display_name text,
  mobile text,
  email text,
  birth_date date,
  gender text,
  state text,
  role text not null default 'FO',
  status text not null default 'Active',
  is_active boolean not null default true,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.profiles
  add column if not exists auth_user_id uuid,
  add column if not exists employee_code text,
  add column if not exists username text,
  add column if not exists full_name text,
  add column if not exists display_name text,
  add column if not exists mobile text,
  add column if not exists email text,
  add column if not exists birth_date date,
  add column if not exists gender text,
  add column if not exists state text,
  add column if not exists role text default 'FO',
  add column if not exists status text default 'Active',
  add column if not exists is_active boolean default true,
  add column if not exists metadata jsonb not null default '{}'::jsonb,
  add column if not exists created_at timestamptz not null default now(),
  add column if not exists updated_at timestamptz not null default now();

create unique index if not exists ux_profiles_auth_user_id
  on public.profiles(auth_user_id)
  where auth_user_id is not null;

create unique index if not exists ux_profiles_employee_code
  on public.profiles(upper(employee_code))
  where employee_code is not null and trim(employee_code) <> '';

create unique index if not exists ux_profiles_mobile
  on public.profiles(regexp_replace(coalesce(mobile, ''), '\D', '', 'g'))
  where mobile is not null and trim(mobile) <> '';

create unique index if not exists ux_profiles_email_normalized
  on public.profiles(lower(email))
  where email is not null and trim(email) <> '';

create index if not exists idx_profiles_role_status
  on public.profiles(role, status);

create index if not exists idx_profiles_created_at
  on public.profiles(created_at desc);

drop trigger if exists trg_profiles_updated_at on public.profiles;
create trigger trg_profiles_updated_at
before update on public.profiles
for each row execute function public.set_updated_at();
