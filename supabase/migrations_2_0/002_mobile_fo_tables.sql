-- Mobile_FO_V2 schema migration 2.0
-- 002: Core FO mobile operational tables.

create table if not exists public.fo_attendance (
  id uuid primary key default gen_random_uuid(),
  fo_user_id text not null,
  employee_code text,
  username text,
  display_name text,
  attendance_date date not null default current_date,
  login_time timestamptz not null default now(),
  logout_time timestamptz,
  status text not null default 'Active',
  start_latitude numeric(10, 7),
  start_longitude numeric(10, 7),
  end_latitude numeric(10, 7),
  end_longitude numeric(10, 7),
  start_battery_percentage integer,
  end_battery_percentage integer,
  battery_start integer,
  battery_end integer,
  actual_km numeric(10, 2) not null default 0,
  eligible_km numeric(10, 2) not null default 0,
  total_raw_km numeric(10, 2) not null default 0,
  total_route_km numeric(10, 2) not null default 0,
  total_approved_km numeric(10, 2) not null default 0,
  raw_gps_km numeric(10, 2) not null default 0,
  filtered_gps_km numeric(10, 2) not null default 0,
  actual_travel_km numeric(10, 2) not null default 0,
  actual_travel_updated_at timestamptz,
  rate_per_km numeric(10, 2) not null default 4,
  petrol_amount numeric(10, 2) not null default 0,
  eligibility_status text not null default 'Needs Review',
  route_sync_status text not null default 'pending',
  sync_status text not null default 'synced',
  local_id text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.fo_attendance
  add column if not exists fo_user_id text,
  add column if not exists employee_code text,
  add column if not exists username text,
  add column if not exists display_name text,
  add column if not exists attendance_date date default current_date,
  add column if not exists login_time timestamptz default now(),
  add column if not exists logout_time timestamptz,
  add column if not exists status text default 'Active',
  add column if not exists start_latitude numeric(10, 7),
  add column if not exists start_longitude numeric(10, 7),
  add column if not exists end_latitude numeric(10, 7),
  add column if not exists end_longitude numeric(10, 7),
  add column if not exists start_battery_percentage integer,
  add column if not exists end_battery_percentage integer,
  add column if not exists battery_start integer,
  add column if not exists battery_end integer,
  add column if not exists actual_km numeric(10, 2) default 0,
  add column if not exists eligible_km numeric(10, 2) default 0,
  add column if not exists total_raw_km numeric(10, 2) default 0,
  add column if not exists total_route_km numeric(10, 2) default 0,
  add column if not exists total_approved_km numeric(10, 2) default 0,
  add column if not exists raw_gps_km numeric(10, 2) default 0,
  add column if not exists filtered_gps_km numeric(10, 2) default 0,
  add column if not exists actual_travel_km numeric(10, 2) default 0,
  add column if not exists actual_travel_updated_at timestamptz,
  add column if not exists rate_per_km numeric(10, 2) default 4,
  add column if not exists petrol_amount numeric(10, 2) default 0,
  add column if not exists eligibility_status text default 'Needs Review',
  add column if not exists route_sync_status text default 'pending',
  add column if not exists sync_status text default 'synced',
  add column if not exists local_id text,
  add column if not exists metadata jsonb not null default '{}'::jsonb,
  add column if not exists created_at timestamptz not null default now(),
  add column if not exists updated_at timestamptz not null default now();

create unique index if not exists ux_fo_attendance_local_id
  on public.fo_attendance(local_id)
  where local_id is not null;
create index if not exists idx_fo_attendance_fo_user_date
  on public.fo_attendance(fo_user_id, attendance_date desc);
create index if not exists idx_fo_attendance_active_today
  on public.fo_attendance(fo_user_id, attendance_date, status, logout_time)
  where status = 'Active' and logout_time is null;
create index if not exists idx_fo_attendance_login_time
  on public.fo_attendance(login_time desc);

drop trigger if exists trg_fo_attendance_updated_at on public.fo_attendance;
create trigger trg_fo_attendance_updated_at
before update on public.fo_attendance
for each row execute function public.set_updated_at();

create table if not exists public.store_master (
  id uuid primary key default gen_random_uuid(),
  store_name text not null,
  client_name text not null,
  store_code text not null,
  state text not null,
  latitude numeric(10, 7),
  longitude numeric(10, 7),
  gps_accuracy numeric(10, 2),
  created_by_employee_code text,
  created_by_full_name text,
  attendance_id uuid,
  captured_at timestamptz not null default now(),
  status text not null default 'Active',
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.store_master
  add column if not exists store_name text,
  add column if not exists client_name text,
  add column if not exists store_code text,
  add column if not exists state text,
  add column if not exists latitude numeric(10, 7),
  add column if not exists longitude numeric(10, 7),
  add column if not exists gps_accuracy numeric(10, 2),
  add column if not exists created_by_employee_code text,
  add column if not exists created_by_full_name text,
  add column if not exists attendance_id uuid,
  add column if not exists captured_at timestamptz not null default now(),
  add column if not exists status text default 'Active',
  add column if not exists metadata jsonb not null default '{}'::jsonb,
  add column if not exists created_at timestamptz not null default now(),
  add column if not exists updated_at timestamptz not null default now();

create unique index if not exists ux_store_master_store_code
  on public.store_master(upper(store_code))
  where store_code is not null and trim(store_code) <> '';
create index if not exists idx_store_master_search
  on public.store_master(upper(store_name), upper(store_code));
create index if not exists idx_store_master_gps_active
  on public.store_master(status, latitude, longitude)
  where latitude is not null and longitude is not null;

drop trigger if exists trg_store_master_updated_at on public.store_master;
create trigger trg_store_master_updated_at
before update on public.store_master
for each row execute function public.set_updated_at();

create table if not exists public.fo_daily_tasks (
  id uuid primary key default gen_random_uuid(),
  fo_user_id text not null,
  employee_code text,
  attendance_id uuid,
  task_date date not null default current_date,
  store_id uuid,
  store_code text,
  site_name text,
  task_type text,
  task_category text,
  task_status text not null default 'planned',
  local_id text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.fo_daily_tasks
  add column if not exists fo_user_id text,
  add column if not exists employee_code text,
  add column if not exists attendance_id uuid,
  add column if not exists task_date date default current_date,
  add column if not exists store_id uuid,
  add column if not exists store_code text,
  add column if not exists site_name text,
  add column if not exists task_type text,
  add column if not exists task_category text,
  add column if not exists task_status text default 'planned',
  add column if not exists local_id text,
  add column if not exists metadata jsonb not null default '{}'::jsonb,
  add column if not exists created_at timestamptz not null default now(),
  add column if not exists updated_at timestamptz not null default now();

create unique index if not exists ux_fo_daily_tasks_local_id
  on public.fo_daily_tasks(local_id)
  where local_id is not null;
create index if not exists idx_fo_daily_tasks_user_date
  on public.fo_daily_tasks(fo_user_id, task_date desc, task_status);

drop trigger if exists trg_fo_daily_tasks_updated_at on public.fo_daily_tasks;
create trigger trg_fo_daily_tasks_updated_at
before update on public.fo_daily_tasks
for each row execute function public.set_updated_at();

create table if not exists public.fo_site_visits (
  id uuid primary key default gen_random_uuid(),
  fo_user_id text not null,
  employee_code text,
  full_name text,
  display_name text,
  attendance_id uuid,
  fo_daily_task_id uuid,
  store_id uuid,
  site_id uuid,
  store_name text,
  site_name text,
  store_code text,
  site_code text,
  client_name text,
  state text,
  check_in_time timestamptz not null default now(),
  check_out_time timestamptz,
  checkout_time timestamptz,
  check_in_latitude numeric(10, 7),
  check_in_longitude numeric(10, 7),
  check_out_latitude numeric(10, 7),
  check_out_longitude numeric(10, 7),
  current_latitude numeric(10, 7),
  current_longitude numeric(10, 7),
  current_gps_accuracy numeric(10, 2),
  checkin_accuracy numeric(10, 2),
  checkout_accuracy numeric(10, 2),
  checkout_distance_meters numeric(12, 2),
  checkout_location_status text not null default 'valid',
  checkout_note text,
  petrol_eligible_after_checkout boolean not null default true,
  petrol_penalty_distance_meters numeric(12, 2) not null default 0,
  origin_lat numeric(10, 7),
  origin_lng numeric(10, 7),
  destination_lat numeric(10, 7),
  destination_lng numeric(10, 7),
  straight_line_km numeric(10, 2),
  route_km numeric(10, 2),
  route_duration_minutes integer,
  google_route_polyline text,
  distance_source text,
  visit_duration_minutes integer,
  status text not null default 'Checked In',
  visit_status text,
  local_id text,
  sync_status text not null default 'synced',
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.fo_site_visits
  add column if not exists fo_user_id text,
  add column if not exists employee_code text,
  add column if not exists full_name text,
  add column if not exists display_name text,
  add column if not exists attendance_id uuid,
  add column if not exists fo_daily_task_id uuid,
  add column if not exists store_id uuid,
  add column if not exists site_id uuid,
  add column if not exists store_name text,
  add column if not exists site_name text,
  add column if not exists store_code text,
  add column if not exists site_code text,
  add column if not exists client_name text,
  add column if not exists state text,
  add column if not exists check_in_time timestamptz default now(),
  add column if not exists check_out_time timestamptz,
  add column if not exists checkout_time timestamptz,
  add column if not exists check_in_latitude numeric(10, 7),
  add column if not exists check_in_longitude numeric(10, 7),
  add column if not exists check_out_latitude numeric(10, 7),
  add column if not exists check_out_longitude numeric(10, 7),
  add column if not exists current_latitude numeric(10, 7),
  add column if not exists current_longitude numeric(10, 7),
  add column if not exists current_gps_accuracy numeric(10, 2),
  add column if not exists checkin_accuracy numeric(10, 2),
  add column if not exists checkout_accuracy numeric(10, 2),
  add column if not exists checkout_distance_meters numeric(12, 2),
  add column if not exists checkout_location_status text default 'valid',
  add column if not exists checkout_note text,
  add column if not exists petrol_eligible_after_checkout boolean default true,
  add column if not exists petrol_penalty_distance_meters numeric(12, 2) default 0,
  add column if not exists origin_lat numeric(10, 7),
  add column if not exists origin_lng numeric(10, 7),
  add column if not exists destination_lat numeric(10, 7),
  add column if not exists destination_lng numeric(10, 7),
  add column if not exists straight_line_km numeric(10, 2),
  add column if not exists route_km numeric(10, 2),
  add column if not exists route_duration_minutes integer,
  add column if not exists google_route_polyline text,
  add column if not exists distance_source text,
  add column if not exists visit_duration_minutes integer,
  add column if not exists status text default 'Checked In',
  add column if not exists visit_status text,
  add column if not exists local_id text,
  add column if not exists sync_status text default 'synced',
  add column if not exists metadata jsonb not null default '{}'::jsonb,
  add column if not exists created_at timestamptz not null default now(),
  add column if not exists updated_at timestamptz not null default now();

create unique index if not exists ux_fo_site_visits_local_id
  on public.fo_site_visits(local_id)
  where local_id is not null;
create index if not exists idx_fo_site_visits_user_checkin
  on public.fo_site_visits(fo_user_id, check_in_time desc);
create index if not exists idx_fo_site_visits_attendance_id
  on public.fo_site_visits(attendance_id);
create index if not exists idx_fo_site_visits_open
  on public.fo_site_visits(fo_user_id, attendance_id, check_in_time desc)
  where checkout_time is null;
create index if not exists idx_fo_site_visits_checkout_location_status
  on public.fo_site_visits(checkout_location_status);

drop trigger if exists trg_fo_site_visits_updated_at on public.fo_site_visits;
create trigger trg_fo_site_visits_updated_at
before update on public.fo_site_visits
for each row execute function public.set_updated_at();

create table if not exists public.fo_location_logs (
  id uuid primary key default gen_random_uuid(),
  fo_user_id text not null,
  employee_code text,
  username text,
  attendance_id uuid,
  task_id uuid,
  site_visit_id uuid,
  latitude numeric(10, 7) not null,
  longitude numeric(10, 7) not null,
  accuracy numeric(10, 2),
  speed numeric(10, 2),
  heading numeric(10, 2),
  bearing numeric(10, 2),
  battery_percentage integer,
  is_mocked boolean not null default false,
  logged_at timestamptz not null default now(),
  captured_at timestamptz not null default now(),
  local_id text,
  source text not null default 'mobile',
  sync_status text not null default 'synced',
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

alter table public.fo_location_logs
  add column if not exists fo_user_id text,
  add column if not exists employee_code text,
  add column if not exists username text,
  add column if not exists attendance_id uuid,
  add column if not exists task_id uuid,
  add column if not exists site_visit_id uuid,
  add column if not exists latitude numeric(10, 7),
  add column if not exists longitude numeric(10, 7),
  add column if not exists accuracy numeric(10, 2),
  add column if not exists speed numeric(10, 2),
  add column if not exists heading numeric(10, 2),
  add column if not exists bearing numeric(10, 2),
  add column if not exists battery_percentage integer,
  add column if not exists is_mocked boolean default false,
  add column if not exists logged_at timestamptz default now(),
  add column if not exists captured_at timestamptz default now(),
  add column if not exists local_id text,
  add column if not exists source text default 'mobile',
  add column if not exists sync_status text default 'synced',
  add column if not exists metadata jsonb not null default '{}'::jsonb,
  add column if not exists created_at timestamptz not null default now();

update public.fo_location_logs
set captured_at = coalesce(captured_at, logged_at, created_at)
where captured_at is null;

create unique index if not exists ux_fo_location_logs_local_id
  on public.fo_location_logs(local_id)
  where local_id is not null;
create index if not exists idx_fo_location_logs_fo_user_captured
  on public.fo_location_logs(fo_user_id, captured_at);
create index if not exists idx_fo_location_logs_attendance_captured
  on public.fo_location_logs(attendance_id, captured_at);

create table if not exists public.fo_live_status (
  id uuid primary key default gen_random_uuid(),
  fo_user_id text not null,
  username text,
  display_name text,
  attendance_id uuid,
  active_task_id uuid,
  active_site_visit_id uuid,
  latitude numeric(10, 7),
  longitude numeric(10, 7),
  accuracy numeric(10, 2),
  speed numeric(10, 2),
  heading numeric(10, 2),
  bearing numeric(10, 2),
  battery_percentage integer,
  route_km_today numeric(10, 2) not null default 0,
  is_online boolean not null default false,
  is_tracking boolean not null default false,
  current_status text not null default 'Offline',
  last_seen_at timestamptz not null default now(),
  source text not null default 'mobile',
  sync_status text not null default 'synced',
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.fo_live_status
  add column if not exists fo_user_id text,
  add column if not exists username text,
  add column if not exists display_name text,
  add column if not exists attendance_id uuid,
  add column if not exists active_task_id uuid,
  add column if not exists active_site_visit_id uuid,
  add column if not exists latitude numeric(10, 7),
  add column if not exists longitude numeric(10, 7),
  add column if not exists accuracy numeric(10, 2),
  add column if not exists speed numeric(10, 2),
  add column if not exists heading numeric(10, 2),
  add column if not exists bearing numeric(10, 2),
  add column if not exists battery_percentage integer,
  add column if not exists route_km_today numeric(10, 2) default 0,
  add column if not exists is_online boolean default false,
  add column if not exists is_tracking boolean default false,
  add column if not exists current_status text default 'Offline',
  add column if not exists last_seen_at timestamptz default now(),
  add column if not exists source text default 'mobile',
  add column if not exists sync_status text default 'synced',
  add column if not exists metadata jsonb not null default '{}'::jsonb,
  add column if not exists created_at timestamptz not null default now(),
  add column if not exists updated_at timestamptz not null default now();

create unique index if not exists ux_fo_live_status_user
  on public.fo_live_status(fo_user_id);
create index if not exists idx_fo_live_status_seen
  on public.fo_live_status(last_seen_at desc);

drop trigger if exists trg_fo_live_status_updated_at on public.fo_live_status;
create trigger trg_fo_live_status_updated_at
before update on public.fo_live_status
for each row execute function public.set_updated_at();

create table if not exists public.fo_activity_submissions (
  id uuid primary key default gen_random_uuid(),
  fo_user_id text not null,
  employee_code text,
  attendance_id uuid,
  site_visit_id uuid,
  store_id uuid,
  store_code text,
  activity_type text not null,
  status text not null default 'submitted',
  remarks text,
  submitted_at timestamptz not null default now(),
  local_id text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.fo_activity_submissions
  add column if not exists fo_user_id text,
  add column if not exists employee_code text,
  add column if not exists attendance_id uuid,
  add column if not exists site_visit_id uuid,
  add column if not exists store_id uuid,
  add column if not exists store_code text,
  add column if not exists activity_type text,
  add column if not exists status text default 'submitted',
  add column if not exists remarks text,
  add column if not exists submitted_at timestamptz default now(),
  add column if not exists local_id text,
  add column if not exists metadata jsonb not null default '{}'::jsonb,
  add column if not exists created_at timestamptz not null default now(),
  add column if not exists updated_at timestamptz not null default now();

create unique index if not exists ux_fo_activity_submissions_local_id
  on public.fo_activity_submissions(local_id)
  where local_id is not null;
create index if not exists idx_fo_activity_submissions_user_created
  on public.fo_activity_submissions(fo_user_id, created_at desc);

drop trigger if exists trg_fo_activity_submissions_updated_at on public.fo_activity_submissions;
create trigger trg_fo_activity_submissions_updated_at
before update on public.fo_activity_submissions
for each row execute function public.set_updated_at();

create table if not exists public.fo_activity_uploads (
  id uuid primary key default gen_random_uuid(),
  submission_id uuid,
  fo_user_id text not null,
  employee_code text,
  attendance_id uuid,
  site_visit_id uuid,
  store_code text,
  activity_type text not null,
  upload_role text,
  file_url text not null,
  file_name text,
  file_type text,
  file_size bigint,
  storage_bucket text not null default 'fo-activity-uploads',
  uploaded_at timestamptz not null default now(),
  local_id text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

alter table public.fo_activity_uploads
  add column if not exists submission_id uuid,
  add column if not exists fo_user_id text,
  add column if not exists employee_code text,
  add column if not exists attendance_id uuid,
  add column if not exists site_visit_id uuid,
  add column if not exists store_code text,
  add column if not exists activity_type text,
  add column if not exists upload_role text,
  add column if not exists file_url text,
  add column if not exists file_name text,
  add column if not exists file_type text,
  add column if not exists file_size bigint,
  add column if not exists storage_bucket text default 'fo-activity-uploads',
  add column if not exists uploaded_at timestamptz default now(),
  add column if not exists local_id text,
  add column if not exists metadata jsonb not null default '{}'::jsonb,
  add column if not exists created_at timestamptz not null default now();

create unique index if not exists ux_fo_activity_uploads_local_id
  on public.fo_activity_uploads(local_id)
  where local_id is not null;
create index if not exists idx_fo_activity_uploads_user_created
  on public.fo_activity_uploads(fo_user_id, created_at desc);

create table if not exists public.mobile_crash_logs (
  id uuid primary key default gen_random_uuid(),
  fo_user_id text,
  employee_code text,
  stage text,
  screen text,
  action text,
  error_message text,
  stack_trace text,
  created_at timestamptz not null default now()
);

alter table public.mobile_crash_logs
  add column if not exists fo_user_id text,
  add column if not exists employee_code text,
  add column if not exists stage text,
  add column if not exists screen text,
  add column if not exists action text,
  add column if not exists error_message text,
  add column if not exists stack_trace text,
  add column if not exists created_at timestamptz not null default now();

create index if not exists idx_mobile_crash_logs_employee_created
  on public.mobile_crash_logs(employee_code, created_at desc);
create index if not exists idx_mobile_crash_logs_created
  on public.mobile_crash_logs(created_at desc);
