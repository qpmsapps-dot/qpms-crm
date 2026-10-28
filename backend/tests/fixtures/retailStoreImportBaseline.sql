-- Disposable PostgreSQL fixture matching the relevant 211/212/215 store contract.
-- Never install this test fixture in production.
create role anon;
create role authenticated;
create role service_role bypassrls;
create table public.profiles(id uuid primary key,employee_code text,username text,full_name text,display_name text,mobile text,state text,role text,designation text,department text,status text default 'Active',is_active boolean,business text);
create table public.reliance_retail_store_master(
 id uuid primary key default gen_random_uuid(),store_code text not null,store_name text not null,state text not null,
 city text,store_format text,status text not null default 'Active',latitude numeric(10,7),longitude numeric(10,7),gps_accuracy numeric(10,2),
 location_status text not null default 'LOCATION_PENDING',assigned_fo_profile_id uuid references profiles(id),
 assigned_fo_employee_code text,assigned_fo_name_snapshot text,assigned_fo_phone_snapshot text,zone_id uuid,
 source_name text not null,metadata jsonb not null default '{}',created_at timestamptz not null default now(),updated_at timestamptz not null default now(),
 constraint reliance_retail_store_state_check check(upper(btrim(state)) in ('TN','PY','KA','KL','AP-1','AP-2')),
 check(btrim(store_code)<>''),check(btrim(store_name)<>''),check(status in ('Active','Inactive')),
 check(location_status in ('LOCATION_PENDING','GPS_READY')),
 check((latitude is null)=(longitude is null)),
 check((location_status='LOCATION_PENDING' and latitude is null and longitude is null) or (location_status='GPS_READY' and latitude is not null and longitude is not null)),
 check((assigned_fo_profile_id is not null and nullif(btrim(assigned_fo_employee_code),'') is not null and nullif(btrim(assigned_fo_name_snapshot),'') is not null)
 or (assigned_fo_profile_id is null and assigned_fo_employee_code is null and assigned_fo_name_snapshot is null and assigned_fo_phone_snapshot is null and zone_id is null and upper(coalesce(metadata->>'operational_model',''))='SUPERVISOR_ONLY'))
);
create unique index ux_reliance_retail_store_master_code on public.reliance_retail_store_master(upper(btrim(store_code)));
alter table public.reliance_retail_store_master enable row level security;
grant select on public.profiles to service_role;
grant select,insert,update on public.reliance_retail_store_master to service_role;
