-- 118: Mixed-mode FO travel reimbursement integrity and correction audit.
-- Additive audit storage plus a safe active-attendance refresh guard.
-- Raw GPS, attendance route history, site visits, tickets, and parking are not modified here.

begin;

create table if not exists public.fo_travel_reimbursement_corrections (
  id uuid primary key default gen_random_uuid(),
  correction_key text not null unique,
  attendance_id uuid not null,
  employee_code text not null,
  attendance_date date not null,
  correction_confidence text not null,
  correction_reason text not null,
  status text not null default 'previewed',
  before_state jsonb not null,
  proposed_state jsonb not null,
  applied_state jsonb,
  error_detail jsonb,
  created_at timestamptz not null default now(),
  applied_at timestamptz,
  updated_at timestamptz not null default now(),
  constraint fo_travel_reimbursement_corrections_confidence_check
    check (correction_confidence in ('HIGH', 'MEDIUM', 'LOW')),
  constraint fo_travel_reimbursement_corrections_status_check
    check (status in ('previewed', 'applying', 'applied', 'skipped', 'failed')),
  constraint fo_travel_reimbursement_corrections_before_object_check
    check (jsonb_typeof(before_state) = 'object'),
  constraint fo_travel_reimbursement_corrections_proposed_object_check
    check (jsonb_typeof(proposed_state) = 'object')
);

create index if not exists idx_fo_travel_reimbursement_corrections_attendance
  on public.fo_travel_reimbursement_corrections(attendance_id, created_at desc);

create index if not exists idx_fo_travel_reimbursement_corrections_period
  on public.fo_travel_reimbursement_corrections(attendance_date, status);

alter table public.fo_travel_reimbursement_corrections enable row level security;

drop policy if exists "fo_travel_reimbursement_corrections_service_role_all"
  on public.fo_travel_reimbursement_corrections;
create policy "fo_travel_reimbursement_corrections_service_role_all"
  on public.fo_travel_reimbursement_corrections
  for all
  using (auth.role() = 'service_role')
  with check (auth.role() = 'service_role');

revoke all on table public.fo_travel_reimbursement_corrections from public, anon, authenticated;
grant select, insert, update on table public.fo_travel_reimbursement_corrections to service_role;

drop trigger if exists trg_fo_travel_reimbursement_corrections_updated_at
  on public.fo_travel_reimbursement_corrections;
create trigger trg_fo_travel_reimbursement_corrections_updated_at
before update on public.fo_travel_reimbursement_corrections
for each row execute function public.set_updated_at();

comment on table public.fo_travel_reimbursement_corrections is
  'Durable before/proposed/after audit for controlled FO travel reimbursement corrections.';

create or replace function public.refresh_fo_attendance_payable_route_km(
  p_attendance_id uuid
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_has_travel_legs boolean;
begin
  if p_attendance_id is null then
    return;
  end if;

  -- Any travel-leg row means the backend leg engine owns the financial total.
  -- A site-visit trigger must never collapse a mixed-mode day into one rate.
  select exists (
    select 1
    from public.fo_travel_legs leg
    where leg.attendance_id = p_attendance_id
      and lower(coalesce(leg.status, '')) <> 'cancelled'
  ) into v_has_travel_legs;

  if v_has_travel_legs then
    return;
  end if;

  -- Backward compatibility for old mobile clients that never create legs.
  -- Only private modes receive distance reimbursement.
  update public.fo_attendance attendance
  set
    total_route_km = case
      when lower(coalesce(attendance.travel_mode, 'bike')) in ('bike', 'own_vehicle', 'car')
        then route_totals.total_route_km
      else 0
    end,
    eligible_km = case
      when lower(coalesce(attendance.travel_mode, 'bike')) in ('bike', 'own_vehicle', 'car')
        then route_totals.total_route_km
      else 0
    end,
    total_approved_km = case
      when lower(coalesce(attendance.travel_mode, 'bike')) in ('bike', 'own_vehicle', 'car')
        then route_totals.total_route_km
      else 0
    end,
    petrol_amount = case
      when lower(coalesce(attendance.travel_mode, 'bike')) in ('bike', 'own_vehicle')
        then round((route_totals.total_route_km * 4)::numeric, 2)
      when lower(coalesce(attendance.travel_mode, '')) = 'car'
        then round((route_totals.total_route_km * 8)::numeric, 2)
      else 0
    end,
    route_sync_status = 'legacy_single_mode_site_visit_route_km_sum',
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

revoke all on function public.refresh_fo_attendance_payable_route_km(uuid) from public;
grant execute on function public.refresh_fo_attendance_payable_route_km(uuid) to authenticated, service_role;

commit;
