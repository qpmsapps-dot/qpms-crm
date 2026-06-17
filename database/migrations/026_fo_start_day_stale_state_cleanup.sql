-- 026: Close stale previous-day FO state on Start Day.
-- Mobile_FO_V2 creates Start Day rows directly in fo_attendance, so this
-- database trigger protects the direct insert path without mobile code changes.

create or replace function public.close_stale_fo_state_before_start_day()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_target_date date := coalesce(new.attendance_date, current_date);
  v_employee_code text := coalesce(new.fo_user_id, new.employee_code, new.username);
  v_auto_closed_at timestamptz := v_target_date::timestamp at time zone 'Asia/Kolkata';
begin
  if v_employee_code is null
     or trim(v_employee_code) = ''
     or coalesce(new.status, 'Active') <> 'Active'
     or new.logout_time is not null then
    return new;
  end if;

  with stale_attendance as (
    select id
    from public.fo_attendance
    where fo_user_id = v_employee_code
      and attendance_date < v_target_date
      and status = 'Active'
      and logout_time is null
  ),
  stale_live_visits as (
    select visit.id
    from public.fo_site_visits visit
    where visit.fo_user_id = v_employee_code
      and (
        visit.attendance_id in (select id from stale_attendance)
        or (visit.check_in_time at time zone 'Asia/Kolkata')::date < v_target_date
      )
  ),
  closed_visits as (
    update public.fo_site_visits visit
    set
      checkout_time = coalesce(visit.checkout_time, v_auto_closed_at),
      check_out_time = coalesce(visit.check_out_time, v_auto_closed_at),
      status = 'Stale Auto Closed',
      visit_status = coalesce(visit.visit_status, 'stale_auto_closed'),
      checkout_note = trim(both E'\n' from concat_ws(
        E'\n',
        nullif(visit.checkout_note, ''),
        'Auto-closed as stale previous-day open site visit during next Start Day.'
      )),
      metadata = coalesce(visit.metadata, '{}'::jsonb) || jsonb_build_object(
        'stale_auto_closed', true,
        'stale_auto_closed_at', now(),
        'stale_auto_closed_reason', 'next_day_start_day',
        'stale_auto_closed_by', 'close_stale_fo_state_before_start_day',
        'next_attendance_date', v_target_date
      )
    where visit.fo_user_id = v_employee_code
      and visit.checkout_time is null
      and visit.check_out_time is null
      and (
        visit.attendance_id in (select id from stale_attendance)
        or (visit.check_in_time at time zone 'Asia/Kolkata')::date < v_target_date
      )
    returning visit.id
  ),
  closed_attendance as (
    update public.fo_attendance attendance
    set
      logout_time = coalesce(attendance.logout_time, v_auto_closed_at),
      status = 'Completed',
      metadata = coalesce(attendance.metadata, '{}'::jsonb) || jsonb_build_object(
        'stale_auto_closed', true,
        'stale_auto_closed_at', now(),
        'stale_auto_closed_reason', 'next_day_start_day',
        'stale_auto_closed_by', 'close_stale_fo_state_before_start_day',
        'next_attendance_date', v_target_date
      )
    where attendance.id in (select id from stale_attendance)
    returning attendance.id
  )
  update public.fo_live_status live
  set
    active_site_visit_id = null,
    current_status = case
      when live.active_site_visit_id is not null then 'Offline'
      else live.current_status
    end,
    metadata = coalesce(live.metadata, '{}'::jsonb) || jsonb_build_object(
      'stale_active_site_visit_cleared_at', now(),
      'stale_active_site_visit_cleared_reason', 'next_day_start_day',
      'next_attendance_date', v_target_date
    )
  where live.fo_user_id = v_employee_code
    and live.active_site_visit_id in (select id from stale_live_visits);

  return new;
end;
$$;

drop trigger if exists trg_close_stale_fo_state_before_start_day
on public.fo_attendance;

create trigger trg_close_stale_fo_state_before_start_day
before insert on public.fo_attendance
for each row
execute function public.close_stale_fo_state_before_start_day();
