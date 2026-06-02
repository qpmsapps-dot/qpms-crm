-- Admin-only review helper: identify likely mock/demo FO users.
-- This script is intentionally read-only. Do not run deletes from here.

select
  id,
  employee_code,
  username,
  full_name,
  role,
  status,
  created_at
from public.profiles
where
  upper(coalesce(employee_code, username, '')) in ('FO0001', 'FO0002', 'FO0003', 'FO0004', 'FO0005')
  or lower(coalesce(employee_code, '')) in ('fo-demo-001')
  or lower(coalesce(username, '')) like '%test%'
  or lower(coalesce(username, '')) like '%demo%'
  or lower(coalesce(full_name, '')) like '%test%'
  or lower(coalesce(full_name, '')) like '%demo%'
order by created_at desc nulls last;

select
  fo_user_id,
  min(login_time) as first_login_time,
  max(login_time) as last_login_time,
  count(*) as attendance_rows
from public.fo_attendance
where
  upper(coalesce(fo_user_id, '')) in ('FO0001', 'FO0002', 'FO0003', 'FO0004', 'FO0005')
  or lower(coalesce(fo_user_id, '')) like '%test%'
  or lower(coalesce(fo_user_id, '')) like '%demo%'
group by fo_user_id
order by last_login_time desc nulls last;
