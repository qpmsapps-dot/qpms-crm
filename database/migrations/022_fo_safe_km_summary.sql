-- Purpose: Calculate FO-safe GPS KM and petrol claims from fo_location_logs.
-- This is additive and does not change mobile tracking or existing attendance writes.

alter table public.fo_location_logs
  add column if not exists is_mocked boolean,
  add column if not exists metadata jsonb not null default '{}'::jsonb;

create or replace view public.fo_safe_km_summary as
with all_logs as (
  select
    id,
    fo_user_id,
    attendance_id,
    latitude::numeric as latitude,
    longitude::numeric as longitude,
    accuracy::numeric as accuracy,
    coalesce(captured_at, logged_at, created_at) as captured_at,
    coalesce(is_mocked, false) as is_mocked,
    coalesce(metadata, '{}'::jsonb) as metadata,
    case
      when coalesce(is_mocked, false) then false
      when lower(coalesce(metadata ->> 'mock', 'false')) in ('true', '1', 'yes') then false
      when latitude is null or longitude is null then false
      when latitude::numeric < -90 or latitude::numeric > 90 then false
      when longitude::numeric < -180 or longitude::numeric > 180 then false
      when accuracy is null or accuracy::numeric > 50 then false
      when coalesce(captured_at, logged_at, created_at) is null then false
      else true
    end as is_valid
  from public.fo_location_logs
),
valid_logs as (
  select
    *,
    lag(latitude) over (
      partition by fo_user_id, attendance_id
      order by captured_at, id
    ) as previous_latitude,
    lag(longitude) over (
      partition by fo_user_id, attendance_id
      order by captured_at, id
    ) as previous_longitude,
    lag(captured_at) over (
      partition by fo_user_id, attendance_id
      order by captured_at, id
    ) as previous_captured_at
  from all_logs
  where is_valid
),
segments as (
  select
    fo_user_id,
    attendance_id,
    extract(epoch from captured_at - previous_captured_at) as gap_seconds,
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
  from valid_logs
  where previous_latitude is not null
    and previous_longitude is not null
    and previous_captured_at is not null
),
rollup as (
  select
    all_logs.fo_user_id,
    all_logs.attendance_id,
    count(*)::integer as gps_logs_count,
    count(*) filter (where all_logs.is_valid)::integer as valid_points_count,
    count(*) filter (where not all_logs.is_valid)::integer as rejected_points_count
  from all_logs
  group by all_logs.fo_user_id, all_logs.attendance_id
),
segment_rollup as (
  select
    fo_user_id,
    attendance_id,
    coalesce(
      sum(segment_km) filter (
        where gap_seconds > 0
          and gap_seconds <= 600
          and segment_km * 1000 >= 5
          and segment_km * 1000 <= 1000
          and (segment_km * 1000) / nullif(gap_seconds, 0) <= 33.33
      ),
      0
    ) as raw_gps_km,
    coalesce(
      sum(segment_km * 1.20) filter (
        where gap_seconds > 600
      ),
      0
    ) as gap_safety_km,
    avg(gap_seconds) filter (where gap_seconds > 0) as average_gap_seconds,
    max(gap_seconds) filter (where gap_seconds > 0) as max_gap_seconds
  from segments
  group by fo_user_id, attendance_id
),
scored as (
  select
    r.fo_user_id,
    r.attendance_id,
    round(coalesce(s.raw_gps_km, 0)::numeric, 2) as raw_gps_km,
    round((coalesce(s.raw_gps_km, 0) + coalesce(s.gap_safety_km, 0))::numeric, 2) as gap_adjusted_km,
    r.gps_logs_count,
    r.valid_points_count,
    r.rejected_points_count,
    round(
      case
        when coalesce(s.raw_gps_km, 0) > 0
          then r.valid_points_count::numeric / nullif(s.raw_gps_km, 0)
        else r.valid_points_count::numeric
      end,
      2
    ) as logs_per_km,
    round(coalesce(s.average_gap_seconds, 0)::numeric, 2) as average_gap_seconds,
    round(coalesce(s.max_gap_seconds, 0)::numeric, 2) as max_gap_seconds
  from rollup r
  left join segment_rollup s
    on s.fo_user_id = r.fo_user_id
   and coalesce(s.attendance_id::text, '') = coalesce(r.attendance_id::text, '')
),
classified as (
  select
    *,
    case
      when valid_points_count < 2 or raw_gps_km <= 0 then 'REVIEW'
      when (rejected_points_count::numeric / nullif(gps_logs_count, 0)) > 0.35 then 'REVIEW'
      when logs_per_km >= 8 and max_gap_seconds <= 180 and average_gap_seconds <= 90 then 'HIGH'
      when logs_per_km >= 4 and max_gap_seconds <= 600 and average_gap_seconds <= 180 then 'MEDIUM'
      when logs_per_km >= 2 and max_gap_seconds <= 1800 then 'LOW'
      else 'REVIEW'
    end as km_confidence
  from scored
)
select
  fo_user_id,
  attendance_id,
  raw_gps_km,
  gap_adjusted_km,
  gps_logs_count,
  logs_per_km,
  average_gap_seconds,
  max_gap_seconds,
  rejected_points_count,
  km_confidence,
  case
    when km_confidence in ('LOW', 'REVIEW') then true
    else false
  end as review_required,
  round(
    greatest(
      raw_gps_km,
      gap_adjusted_km,
      case
        when km_confidence = 'HIGH' then raw_gps_km * 1.03
        when km_confidence = 'MEDIUM' then raw_gps_km * 1.08
        when km_confidence = 'LOW' then raw_gps_km * 1.12
        else raw_gps_km
      end
    ),
    2
  ) as claim_km,
  round(
    greatest(
      raw_gps_km,
      gap_adjusted_km,
      case
        when km_confidence = 'HIGH' then raw_gps_km * 1.03
        when km_confidence = 'MEDIUM' then raw_gps_km * 1.08
        when km_confidence = 'LOW' then raw_gps_km * 1.12
        else raw_gps_km
      end
    ) * 4,
    2
  ) as petrol_amount,
  concat_ws(
    ', ',
    case when gap_adjusted_km > raw_gps_km then 'Gap safety multiplier 1.20' end,
    case
      when km_confidence = 'HIGH' then 'Confidence multiplier 1.03'
      when km_confidence = 'MEDIUM' then 'Confidence multiplier 1.08'
      when km_confidence = 'LOW' then 'Confidence multiplier 1.12'
      when km_confidence = 'REVIEW' then 'Supervisor review required'
    end
  ) as adjustment_applied
from classified;
