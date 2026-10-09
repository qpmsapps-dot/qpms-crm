\set ON_ERROR_STOP on
\set VERBOSITY terse

truncate table
  public.fo_final_leg_reconciliation_resolutions,
  public.fo_final_leg_reconciliation_runs,
  public.fo_km_financial_approval_consumptions,
  public.fo_km_financial_approvals,
  public.fo_km_calculation_runs,
  public.fo_missing_km_reviews,
  public.fo_location_logs,
  public.fo_travel_legs,
  public.fo_site_visits,
  public.fo_attendance
restart identity cascade;

insert into public.fo_attendance (
  id, fo_user_id, employee_code, attendance_date, login_time, logout_time, status,
  end_latitude, end_longitude, eligible_km, total_route_km, total_approved_km,
  rate_per_km, petrol_amount, travel_mode, route_sync_status, metadata, updated_at
) values (
  'a8d170e6-cbb4-4788-928d-6eb9999d51e2', 'QPMSTNC17015', 'QPMSTNC17015',
  date '2026-10-07', timestamptz '2026-10-07 09:00:00+05:30',
  timestamptz '2026-10-07 19:44:00+05:30', 'Completed',
  12.8926100, 80.0828080, 76.45, 76.45, 76.45,
  4.00, 305.80, 'bike', 'pending_canonical_end_day_recalculation',
  '{"canonical_recalculation_pending":true}',
  timestamptz '2026-10-07 19:45:00+05:30'
);

insert into public.fo_site_visits (
  id, attendance_id, check_in_time, check_out_time,
  check_out_latitude, check_out_longitude, route_km
)
select
  ('10000000-0000-4000-8000-' || lpad(n::text, 12, '0'))::uuid,
  'a8d170e6-cbb4-4788-928d-6eb9999d51e2'::uuid,
  timestamptz '2026-10-07 09:00:00+05:30' + (n || ' hours')::interval,
  case when n = 7 then timestamptz '2026-10-07 18:44:00+05:30'
       else timestamptz '2026-10-07 09:30:00+05:30' + (n || ' hours')::interval end,
  case when n = 7 then 12.8016060 else 12.70 + n / 100.0 end,
  case when n = 7 then 80.1990800 else 80.10 + n / 100.0 end,
  (array[10.00,11.00,12.00,13.00,9.00,8.00,13.45]::numeric[])[n]
from generate_series(1, 7) n;

insert into public.fo_travel_legs (
  id, attendance_id, employee_code, fo_user_id, travel_mode, payable_km_allowed,
  started_at, ended_at, start_lat, start_lng, end_lat, end_lng,
  calculated_km, payable_km, rate_per_km, payable_amount, fare_amount, status, updated_at
) values (
  '48991354-ca06-4856-9931-8f95e6bb932e',
  'a8d170e6-cbb4-4788-928d-6eb9999d51e2', 'QPMSTNC17015', 'QPMSTNC17015',
  'bike', true, timestamptz '2026-10-07 18:44:00+05:30',
  timestamptz '2026-10-07 19:44:00+05:30',
  12.8016060, 80.1990800, 12.8926100, 80.0828080,
  0, 0, 4, 0, 0, 'completed', timestamptz '2026-10-07 19:45:00+05:30'
);

create or replace function pg_temp.final_leg_evidence_plan()
returns jsonb language sql stable as $$
  select jsonb_build_object(
    'calculationVersion', 'KM_ENGINE_V2_FINAL_LEG_EVIDENCE_V1',
    'inputDigest', repeat('e', 64),
    'attendanceId', 'a8d170e6-cbb4-4788-928d-6eb9999d51e2',
    'finalLegId', '48991354-ca06-4856-9931-8f95e6bb932e',
    'employeeCode', 'QPMSTNC17015',
    'attendanceDate', '2026-10-07',
    'attendanceUpdatedAt', '2026-10-07T14:15:00Z',
    'finalLegUpdatedAt', '2026-10-07T14:15:00Z',
    'startedAt', '2026-10-07T13:14:00Z',
    'endedAt', '2026-10-07T14:14:00Z',
    'startLat', 12.8016060, 'startLng', 80.1990800,
    'endLat', 12.8926100, 'endLng', 80.0828080,
    'existingCalculatedKm', 0, 'existingPayableKm', 0,
    'existingPayableAmount', 0, 'existingFareAmount', 0,
    'expectedTotalRouteKm', 76.45, 'expectedEligibleKm', 76.45,
    'expectedTotalApprovedKm', 76.45, 'expectedPetrolAmount', 305.80,
    'expectedSiteVisitCount', 7, 'expectedSiteVisitRouteKm', 76.45,
    'candidateCalculatedKm', 19.40, 'acceptedGpsKm', 19.401,
    'source', 'GPS_BASED', 'referenceOnly', false,
    'decision', 'MANUAL_REVIEW', 'persistable', true,
    'proposedPayableKm', 0, 'proposedReimbursementChange', 0,
    'sourceRowIds', jsonb_build_array('gps-1'),
    'riskFlags', jsonb_build_array('REQUIRES_FINANCIAL_APPROVAL')
  )
$$;

do $$
begin
  if (select financial_writes_enabled from public.fo_km_financial_control where control_key='canonical_v2') then
    raise exception 'test_failed_gate_not_closed';
  end if;
  if not has_function_privilege('service_role', 'public.rpc_persist_fo_canonical_km_v2(uuid,text,timestamptz,jsonb,text,text)', 'EXECUTE')
     or has_function_privilege('service_role', 'public.rpc_approve_fo_km_financial_change_v1(uuid,text,timestamptz,numeric,numeric,numeric,numeric,numeric,numeric,numeric,numeric,text)', 'EXECUTE')
     or not has_function_privilege('authenticated', 'public.rpc_approve_fo_km_financial_change_v1(uuid,text,timestamptz,numeric,numeric,numeric,numeric,numeric,numeric,numeric,numeric,text)', 'EXECUTE')
     or not has_function_privilege('service_role', 'public.rpc_record_fo_final_leg_evidence_v1(jsonb,text)', 'EXECUTE')
     or has_function_privilege('authenticated', 'public.rpc_record_fo_final_leg_evidence_v1(jsonb,text)', 'EXECUTE')
     or not has_function_privilege('authenticated', 'public.rpc_resolve_fo_final_leg_evidence_v1(uuid,text,numeric,text)', 'EXECUTE')
     or has_function_privilege('service_role', 'public.rpc_resolve_fo_final_leg_evidence_v1(uuid,text,numeric,text)', 'EXECUTE')
     or not has_function_privilege('service_role', 'public.rpc_apply_fo_final_leg_financial_v1(uuid,uuid,uuid,text,text,timestamptz,timestamptz,numeric,numeric,numeric,numeric,numeric,numeric,numeric,numeric,numeric,numeric,numeric,text,text)', 'EXECUTE')
     or has_function_privilege('authenticated', 'public.rpc_apply_fo_final_leg_financial_v1(uuid,uuid,uuid,text,text,timestamptz,timestamptz,numeric,numeric,numeric,numeric,numeric,numeric,numeric,numeric,numeric,numeric,numeric,text,text)', 'EXECUTE')
     or not has_table_privilege('service_role', 'public.fo_final_leg_financial_applies', 'SELECT')
     or has_table_privilege('service_role', 'public.fo_final_leg_financial_applies', 'INSERT,UPDATE,DELETE') then
    raise exception 'test_failed_rpc_grants';
  end if;
  if exists (
    select 1 from pg_class c join pg_namespace n on n.oid=c.relnamespace
    where n.nspname='public'
      and c.relname in ('fo_final_leg_reconciliation_runs','fo_final_leg_reconciliation_resolutions','fo_final_leg_financial_applies')
      and c.relrowsecurity is not true
  ) then raise exception 'test_failed_final_leg_rls'; end if;
end
$$;

set session authorization service_role;
select set_config('request.jwt.claim.role', 'service_role', false);
\set ON_ERROR_STOP off
select public.rpc_persist_fo_canonical_km_v2(
  'a8d170e6-cbb4-4788-928d-6eb9999d51e2', repeat('a',64),
  timestamptz '2026-10-07 19:45:00+05:30',
  jsonb_build_object('calculationVersion','KM_ENGINE_V2','canonicalLegs','[]'::jsonb),
  'integration_test', 'service_role_direct'
);
update public.fo_attendance set total_route_km = 99
where id = 'a8d170e6-cbb4-4788-928d-6eb9999d51e2';
\set ON_ERROR_STOP on
select public.rpc_record_fo_final_leg_evidence_v1(pg_temp.final_leg_evidence_plan(), 'integration_test');
select public.rpc_record_fo_final_leg_evidence_v1(pg_temp.final_leg_evidence_plan(), 'integration_test_replay');
reset session authorization;

do $$
declare
  v_visits numeric[];
begin
  select array_agg(route_km order by check_in_time) into v_visits
  from public.fo_site_visits
  where attendance_id='a8d170e6-cbb4-4788-928d-6eb9999d51e2';
  if v_visits <> array[10.00,11.00,12.00,13.00,9.00,8.00,13.45]::numeric[] then
    raise exception 'test_failed_site_visit_values_changed';
  end if;
  if exists (
    select 1 from public.fo_attendance
    where id='a8d170e6-cbb4-4788-928d-6eb9999d51e2'
      and (total_route_km,eligible_km,total_approved_km,petrol_amount) is distinct from
          (76.45::numeric,76.45::numeric,76.45::numeric,305.80::numeric)
  ) then
    raise exception 'test_failed_attendance_financials_changed';
  end if;
  if exists (
    select 1 from public.fo_travel_legs
    where id='48991354-ca06-4856-9931-8f95e6bb932e'
      and (calculated_km,payable_km,payable_amount,fare_amount) is distinct from
          (0::numeric,0::numeric,0::numeric,0::numeric)
  ) then
    raise exception 'test_failed_evidence_changed_leg';
  end if;
  if (select count(*) from public.fo_final_leg_reconciliation_runs) <> 1 then
    raise exception 'test_failed_evidence_replay_not_idempotent';
  end if;
end
$$;

\set ON_ERROR_STOP off
update public.fo_final_leg_reconciliation_runs set candidate_calculated_km=1;
\set ON_ERROR_STOP on

do $$
begin
  if (select candidate_calculated_km from public.fo_final_leg_reconciliation_runs) <> 19.40 then
    raise exception 'test_failed_evidence_not_immutable';
  end if;
  raise notice 'PRIORITY1_INTEGRATION_OK';
end
$$;
