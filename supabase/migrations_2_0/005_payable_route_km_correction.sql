-- Mobile_FO_V2 schema migration 2.0
-- 005: Correct payable attendance KM to use only fo_site_visits.route_km.
-- Run after 003 if an earlier GPS-based function or backend recalculation inflated attendance totals.

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

drop trigger if exists trg_fo_site_visits_payable_route_km on public.fo_site_visits;
create trigger trg_fo_site_visits_payable_route_km
after insert or update of route_km, attendance_id or delete on public.fo_site_visits
for each row execute function public.trg_refresh_fo_attendance_payable_route_km();

grant execute on function public.refresh_fo_attendance_payable_route_km(uuid) to authenticated;

with affected_attendance as (
  select id
  from public.fo_attendance
)
select public.refresh_fo_attendance_payable_route_km(id)
from affected_attendance;
