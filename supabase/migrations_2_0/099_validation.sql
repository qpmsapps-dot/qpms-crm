-- Mobile_FO_V2 schema migration 2.0
-- 099: Post-migration validation queries. Read-only except function probes.

select
  table_name,
  case when table_name in (
    'profiles',
    'fo_attendance',
    'fo_live_status',
    'fo_location_logs',
    'fo_site_visits',
    'fo_daily_tasks',
    'fo_activity_submissions',
    'fo_activity_uploads',
    'store_master',
    'mobile_crash_logs'
  ) then 'required' else 'extra' end as requirement
from information_schema.tables
where table_schema = 'public'
  and table_name in (
    'profiles',
    'fo_attendance',
    'fo_live_status',
    'fo_location_logs',
    'fo_site_visits',
    'fo_daily_tasks',
    'fo_activity_submissions',
    'fo_activity_uploads',
    'store_master',
    'mobile_crash_logs'
  )
order by table_name;

select
  table_name,
  column_name,
  data_type,
  is_nullable,
  column_default
from information_schema.columns
where table_schema = 'public'
  and table_name in (
    'profiles',
    'fo_attendance',
    'fo_live_status',
    'fo_location_logs',
    'fo_site_visits',
    'fo_daily_tasks',
    'fo_activity_submissions',
    'fo_activity_uploads',
    'store_master',
    'mobile_crash_logs'
  )
order by table_name, ordinal_position;

select
  schemaname,
  tablename,
  policyname,
  roles,
  cmd
from pg_policies
where schemaname = 'public'
  and tablename in (
    'profiles',
    'fo_attendance',
    'fo_live_status',
    'fo_location_logs',
    'fo_site_visits',
    'fo_daily_tasks',
    'fo_activity_submissions',
    'fo_activity_uploads',
    'store_master',
    'mobile_crash_logs'
  )
order by tablename, policyname;

select
  tablename,
  rowsecurity
from pg_tables
where schemaname = 'public'
  and tablename in (
    'profiles',
    'fo_attendance',
    'fo_live_status',
    'fo_location_logs',
    'fo_site_visits',
    'fo_daily_tasks',
    'fo_activity_submissions',
    'fo_activity_uploads',
    'store_master',
    'mobile_crash_logs'
  )
order by tablename;

select
  routine_name,
  routine_type
from information_schema.routines
where specific_schema = 'public'
  and routine_name in (
    'set_updated_at',
    'current_fo_employee_code',
    'is_current_fo',
    'is_qpms_admin',
    'rpc_resolve_fo_login_email',
    'rpc_check_fo_registration_unique',
    'refresh_fo_attendance_actual_travel_km',
    'refresh_fo_attendance_payable_route_km',
    'trg_refresh_fo_attendance_actual_travel_km',
    'trg_refresh_fo_attendance_payable_route_km'
  )
order by routine_name;

select
  bucket.id,
  bucket.name,
  bucket.public
from storage.buckets bucket
where bucket.id in ('fo-activity-uploads');

select
  schemaname,
  tablename,
  policyname,
  roles,
  cmd
from pg_policies
where schemaname = 'storage'
  and tablename = 'objects'
  and policyname like 'fo_activity_uploads_%'
order by policyname;

select
  indexname,
  tablename
from pg_indexes
where schemaname = 'public'
  and indexname in (
    'ux_profiles_auth_user_id',
    'ux_profiles_employee_code',
    'ux_fo_attendance_local_id',
    'idx_fo_attendance_active_today',
    'ux_fo_live_status_user',
    'ux_fo_location_logs_local_id',
    'ux_fo_site_visits_local_id',
    'ux_store_master_store_code'
  )
order by tablename, indexname;

with route_totals as (
  select
    attendance_id,
    round(coalesce(sum(route_km) filter (where route_km is not null and route_km > 0), 0)::numeric, 2) as route_km_sum
  from public.fo_site_visits
  group by attendance_id
)
select
  attendance.id as attendance_id,
  attendance.total_route_km,
  attendance.eligible_km,
  attendance.petrol_amount,
  coalesce(route_totals.route_km_sum, 0) as expected_route_km,
  round((coalesce(route_totals.route_km_sum, 0) * coalesce(attendance.rate_per_km, 4))::numeric, 2) as expected_petrol_amount
from public.fo_attendance attendance
left join route_totals on route_totals.attendance_id = attendance.id
where attendance.attendance_date >= current_date - interval '7 days'
order by attendance.login_time desc;
