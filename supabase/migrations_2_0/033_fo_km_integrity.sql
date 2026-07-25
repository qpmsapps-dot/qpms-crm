-- 033: Protect canonical End Day KM totals and persist travel-leg boundaries.
-- This migration intentionally preserves the live GPS cleaning thresholds.

do $$
begin
  if exists (
    select 1
    from public.fo_travel_legs
    group by attendance_id, started_at
    having count(*) > 1
  ) then
    raise exception
      'Duplicate fo_travel_legs start boundaries exist; resolve them before applying migration 033.';
  end if;
end
$$;

create unique index if not exists ux_fo_travel_legs_attendance_started
  on public.fo_travel_legs (attendance_id, started_at);

grant select on table public.fo_travel_legs to service_role;

comment on column public.fo_attendance.actual_km is
  'Actual GPS travel audit KM. Written only by refresh_fo_attendance_actual_travel_km; never payable route KM.';

create or replace function public.refresh_fo_attendance_actual_travel_km(
  p_attendance_id uuid
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if p_attendance_id is null then
    return;
  end if;

  with ordered_logs as (
    select
      id,
      attendance_id,
      latitude::numeric as latitude,
      longitude::numeric as longitude,
      accuracy::numeric as accuracy,
      coalesce(speed, 0)::numeric as speed,
      coalesce(captured_at, logged_at, created_at) as captured_at,
      coalesce(is_mocked, false) as is_mocked,
      coalesce(metadata, '{}'::jsonb) as metadata
    from public.fo_location_logs
    where attendance_id = p_attendance_id
      and latitude is not null
      and longitude is not null
      and latitude::numeric between -90 and 90
      and longitude::numeric between -180 and 180
      and coalesce(captured_at, logged_at, created_at) is not null
      and coalesce(is_mocked, false) = false
      and lower(coalesce(metadata ->> 'mock', 'false')) not in ('true', '1', 'yes')
  ),
  paired_logs as (
    select
      *,
      lag(latitude) over (order by captured_at, id) as previous_latitude,
      lag(longitude) over (order by captured_at, id) as previous_longitude,
      lag(captured_at) over (order by captured_at, id) as previous_captured_at,
      lag(accuracy) over (order by captured_at, id) as previous_accuracy
    from ordered_logs
  ),
  segments as (
    select
      extract(epoch from captured_at - previous_captured_at) as gap_seconds,
      accuracy,
      previous_accuracy,
      (
        6371 * 2 * asin(
          least(
            1,
            sqrt(
              power(sin(radians((latitude - previous_latitude) / 2)), 2)
              + cos(radians(previous_latitude))
                * cos(radians(latitude))
                * power(sin(radians((longitude - previous_longitude) / 2)), 2)
            )
          )
        )
      ) as segment_km
    from paired_logs
    where previous_latitude is not null
      and previous_longitude is not null
      and previous_captured_at is not null
  ),
  totals as (
    select
      coalesce(
        sum(segment_km) filter (
          where gap_seconds > 0
            and segment_km * 1000 >= 5
        ),
        0
      ) as raw_gps_km,
      coalesce(
        sum(segment_km) filter (
          where gap_seconds > 0
            and gap_seconds <= 600
            and segment_km * 1000 >= 5
            and segment_km * 1000 <= 1000
            and (segment_km * 1000) / nullif(gap_seconds, 0) <= 33.33
            and coalesce(accuracy, 999999) <= 50
            and coalesce(previous_accuracy, 999999) <= 50
        ),
        0
      ) as filtered_gps_km,
      coalesce(
        sum(segment_km * 1.20) filter (
          where gap_seconds > 600
            and segment_km * 1000 >= 5
            and coalesce(accuracy, 999999) <= 50
            and coalesce(previous_accuracy, 999999) <= 50
        ),
        0
      ) as gap_safety_km
    from segments
  )
  update public.fo_attendance attendance
  set
    raw_gps_km = round(coalesce(totals.raw_gps_km, 0)::numeric, 2),
    filtered_gps_km = round(coalesce(totals.filtered_gps_km, 0)::numeric, 2),
    actual_travel_km = round(
      (coalesce(totals.filtered_gps_km, 0) + coalesce(totals.gap_safety_km, 0))::numeric,
      2
    ),
    actual_km = round(
      (coalesce(totals.filtered_gps_km, 0) + coalesce(totals.gap_safety_km, 0))::numeric,
      2
    ),
    total_raw_km = round(coalesce(totals.raw_gps_km, 0)::numeric, 2),
    actual_travel_updated_at = now(),
    updated_at = now()
  from totals
  where attendance.id = p_attendance_id;
end;
$$;

create or replace function public.refresh_fo_attendance_payable_route_km(
  p_attendance_id uuid
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if p_attendance_id is null then
    return;
  end if;

  update public.fo_attendance attendance
  set
    total_route_km = route_totals.total_route_km,
    eligible_km = route_totals.total_route_km,
    total_approved_km = route_totals.total_route_km,
    petrol_amount = round(
      (route_totals.total_route_km * coalesce(attendance.rate_per_km, 4))::numeric,
      2
    ),
    route_sync_status = 'site_visit_route_km_sum',
    updated_at = now()
  from (
    select round(
      coalesce(
        sum(route_km) filter (where route_km is not null and route_km > 0),
        0
      )::numeric,
      2
    ) as total_route_km
    from public.fo_site_visits
    where attendance_id = p_attendance_id
  ) route_totals
  where attendance.id = p_attendance_id
    and attendance.status = 'Active'
    and attendance.logout_time is null
    and coalesce(attendance.route_sync_status, '') <> 'canonical_end_day_recalculation';
end;
$$;
