\set ON_ERROR_STOP on

create extension if not exists pgcrypto;
create schema if not exists auth;

create or replace function auth.uid()
returns uuid language sql stable as $$
  select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid
$$;

create or replace function auth.jwt()
returns jsonb language sql stable as $$
  select coalesce(nullif(current_setting('request.jwt.claims', true), ''), '{}')::jsonb
$$;

create or replace function public.is_qpms_admin()
returns boolean language sql stable as $$
  select coalesce(current_setting('test.is_qpms_admin', true), '') = 'true'
$$;

create table public.fo_attendance (
  id uuid primary key default gen_random_uuid(),
  fo_user_id text not null,
  employee_code text,
  attendance_date date not null,
  login_time timestamptz not null,
  logout_time timestamptz,
  status text not null default 'Active',
  end_latitude numeric(10,7),
  end_longitude numeric(10,7),
  actual_km numeric(10,2) not null default 0,
  eligible_km numeric(10,2) not null default 0,
  total_raw_km numeric(10,2) not null default 0,
  total_route_km numeric(10,2) not null default 0,
  total_approved_km numeric(10,2) not null default 0,
  raw_gps_km numeric(10,2) not null default 0,
  filtered_gps_km numeric(10,2) not null default 0,
  actual_travel_km numeric(10,2) not null default 0,
  actual_travel_updated_at timestamptz,
  rate_per_km numeric(10,2) not null default 4,
  petrol_amount numeric(10,2) not null default 0,
  travel_mode text default 'bike',
  route_sync_status text not null default 'pending',
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.fo_site_visits (
  id uuid primary key default gen_random_uuid(),
  attendance_id uuid references public.fo_attendance(id) on delete cascade,
  check_in_time timestamptz not null,
  check_out_time timestamptz,
  check_out_latitude numeric(10,7),
  check_out_longitude numeric(10,7),
  route_km numeric(10,2) not null default 0
);

create table public.fo_location_logs (
  id uuid primary key default gen_random_uuid(),
  attendance_id uuid references public.fo_attendance(id) on delete cascade,
  latitude numeric(10,7) not null,
  longitude numeric(10,7) not null,
  accuracy numeric(10,2),
  is_mocked boolean not null default false,
  logged_at timestamptz,
  captured_at timestamptz,
  created_at timestamptz not null default now()
);

create table public.fo_travel_legs (
  id uuid primary key default gen_random_uuid(),
  attendance_id uuid not null references public.fo_attendance(id) on delete cascade,
  employee_code text not null,
  fo_user_id text,
  travel_mode text not null,
  payable_km_allowed boolean not null,
  started_at timestamptz not null,
  ended_at timestamptz,
  start_lat double precision,
  start_lng double precision,
  end_lat double precision,
  end_lng double precision,
  calculated_km numeric(10,2) not null default 0,
  payable_km numeric(10,2) not null default 0,
  rate_per_km numeric(10,2),
  payable_amount numeric(10,2),
  fare_amount numeric(10,2) not null default 0,
  status text not null default 'active',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (attendance_id, started_at)
);

create unique index ux_fo_travel_legs_attendance_started
  on public.fo_travel_legs(attendance_id, started_at);

create table public.fo_missing_km_reviews (
  id uuid primary key default gen_random_uuid(),
  attendance_id uuid not null references public.fo_attendance(id) on delete cascade,
  status text not null,
  approved_missing_km numeric,
  approved_amount numeric
);

alter table public.fo_attendance enable row level security;
alter table public.fo_site_visits enable row level security;
alter table public.fo_location_logs enable row level security;
alter table public.fo_travel_legs enable row level security;
alter table public.fo_missing_km_reviews enable row level security;

grant select, insert, update, delete on table
  public.fo_attendance,
  public.fo_site_visits,
  public.fo_location_logs,
  public.fo_travel_legs,
  public.fo_missing_km_reviews
to service_role;

create or replace function public.refresh_fo_attendance_actual_travel_km(p_attendance_id uuid)
returns void language plpgsql security definer set search_path = public, pg_temp as $$
begin
  return;
end
$$;

create or replace function public.refresh_fo_attendance_payable_route_km(p_attendance_id uuid)
returns void language plpgsql security definer set search_path = public, pg_temp as $$
begin
  return;
end
$$;

revoke all on function public.refresh_fo_attendance_payable_route_km(uuid)
  from public, anon, authenticated;
grant execute on function public.refresh_fo_attendance_payable_route_km(uuid) to service_role;

create or replace function public.trg_refresh_fo_attendance_actual_travel_km()
returns trigger language plpgsql as $$
begin
  perform public.refresh_fo_attendance_actual_travel_km(new.attendance_id);
  return new;
end
$$;

create trigger trg_fo_location_logs_actual_travel_km
after insert or update on public.fo_location_logs
for each row execute function public.trg_refresh_fo_attendance_actual_travel_km();

create or replace function public.trg_refresh_fo_attendance_payable_route_km()
returns trigger language plpgsql as $$
begin
  perform public.refresh_fo_attendance_payable_route_km(coalesce(new.attendance_id, old.attendance_id));
  return coalesce(new, old);
end
$$;

create trigger trg_fo_site_visits_payable_route_km
after insert or update or delete on public.fo_site_visits
for each row execute function public.trg_refresh_fo_attendance_payable_route_km();
