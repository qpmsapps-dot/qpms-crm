-- Mobile_FO_V2 schema migration 2.0
-- 003: GPS trail recalculation and payable route KM guard.
-- Payable KM is always SUM(fo_site_visits.route_km) for the attendance.
-- GPS-derived KM is stored only in raw_gps_km/filtered_gps_km/actual_travel_km.

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
  ),
  route_totals as (
    select
      coalesce(
        sum(route_km) filter (
          where route_km is not null
            and route_km > 0
        ),
        0
      ) as route_km
    from public.fo_site_visits
    where attendance_id = p_attendance_id
  )
  update public.fo_attendance attendance
  set
    raw_gps_km = round(coalesce(totals.raw_gps_km, 0)::numeric, 2),
    filtered_gps_km = round(coalesce(totals.filtered_gps_km, 0)::numeric, 2),
    actual_travel_km = round(
      (coalesce(totals.filtered_gps_km, 0) + coalesce(totals.gap_safety_km, 0))::numeric,
      2
    ),
    total_raw_km = round(coalesce(totals.raw_gps_km, 0)::numeric, 2),
    actual_km = round(coalesce(route_totals.route_km, 0)::numeric, 2),
    total_route_km = round(coalesce(route_totals.route_km, 0)::numeric, 2),
    eligible_km = round(coalesce(route_totals.route_km, 0)::numeric, 2),
    total_approved_km = round(coalesce(route_totals.route_km, 0)::numeric, 2),
    petrol_amount = round((coalesce(route_totals.route_km, 0) * coalesce(attendance.rate_per_km, 4))::numeric, 2),
    actual_travel_updated_at = now(),
    updated_at = now()
  from totals, route_totals
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
    actual_km = route_totals.total_route_km,
    total_route_km = route_totals.total_route_km,
    eligible_km = route_totals.total_route_km,
    total_approved_km = route_totals.total_route_km,
    petrol_amount = round((route_totals.total_route_km * coalesce(attendance.rate_per_km, 4))::numeric, 2),
    route_sync_status = 'site_visit_route_km_sum',
    updated_at = now()
  from (
    select
      round(coalesce(sum(route_km) filter (where route_km is not null and route_km > 0), 0)::numeric, 2) as total_route_km
    from public.fo_site_visits
    where attendance_id = p_attendance_id
  ) route_totals
  where attendance.id = p_attendance_id;
end;
$$;

create or replace function public.trg_refresh_fo_attendance_payable_route_km()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if tg_op in ('UPDATE', 'DELETE') then
    perform public.refresh_fo_attendance_payable_route_km(old.attendance_id);
  end if;

  if tg_op = 'INSERT' then
    perform public.refresh_fo_attendance_payable_route_km(new.attendance_id);
  elsif tg_op = 'UPDATE' and (
    new.attendance_id is distinct from old.attendance_id
    or new.route_km is distinct from old.route_km
  ) then
    perform public.refresh_fo_attendance_payable_route_km(new.attendance_id);
  end if;

  return coalesce(new, old);
end;
$$;

create or replace function public.trg_refresh_fo_attendance_actual_travel_km()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public.refresh_fo_attendance_actual_travel_km(
    coalesce(new.attendance_id, old.attendance_id)
  );
  return coalesce(new, old);
end;
$$;

drop trigger if exists trg_fo_location_logs_actual_travel_km on public.fo_location_logs;
create trigger trg_fo_location_logs_actual_travel_km
after insert or update or delete on public.fo_location_logs
for each row execute function public.trg_refresh_fo_attendance_actual_travel_km();

drop trigger if exists trg_fo_site_visits_payable_route_km on public.fo_site_visits;
create trigger trg_fo_site_visits_payable_route_km
after insert or update of route_km, attendance_id or delete on public.fo_site_visits
for each row execute function public.trg_refresh_fo_attendance_payable_route_km();

grant execute on function public.refresh_fo_attendance_actual_travel_km(uuid) to authenticated;
grant execute on function public.refresh_fo_attendance_payable_route_km(uuid) to authenticated;
