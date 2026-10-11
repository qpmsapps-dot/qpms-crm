\set ON_ERROR_STOP on
\set VERBOSITY terse

truncate table
  public.fo_final_leg_financial_applies,
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
) values
  (
    'a8d170e6-cbb4-4788-928d-6eb9999d51e2', 'QPMSTNC17015', 'QPMSTNC17015',
    date '2026-10-07', timestamptz '2026-10-07 09:00:00+05:30',
    timestamptz '2026-10-07 19:44:00+05:30', 'Completed',
    12.8926100, 80.0828080, 76.45, 76.45, 76.45, 4.00, 305.80,
    'bike', 'pending_canonical_end_day_recalculation',
    '{"canonical_recalculation_pending":true}', timestamptz '2026-10-07 19:45:00+05:30'
  ),
  (
    'd299f0c4-9af7-4f0c-b8cc-86e5b7fb1f91', 'QPMSTNC17015', 'QPMSTNC17015',
    date '2026-10-08', timestamptz '2026-10-08 09:00:00+05:30',
    timestamptz '2026-10-08 19:08:51+05:30', 'Completed',
    12.9100000, 80.1200000, 80.62, 80.62, 80.62, 4.00, 322.48,
    'bike', 'pending_canonical_end_day_recalculation',
    '{"canonical_recalculation_pending":true}', timestamptz '2026-10-08 19:09:00+05:30'
  );

insert into public.fo_site_visits (
  id, attendance_id, check_in_time, check_out_time,
  check_out_latitude, check_out_longitude, route_km
) values
  (
    '10000000-0000-4000-8000-000000000007',
    'a8d170e6-cbb4-4788-928d-6eb9999d51e2',
    timestamptz '2026-10-07 09:00:00+05:30', timestamptz '2026-10-07 18:44:00+05:30',
    12.8016060, 80.1990800, 76.45
  ),
  (
    '10000000-0000-4000-8000-000000000008',
    'd299f0c4-9af7-4f0c-b8cc-86e5b7fb1f91',
    timestamptz '2026-10-08 09:00:00+05:30', timestamptz '2026-10-08 18:07:42+05:30',
    12.8400000, 80.1800000, 80.62
  );

insert into public.fo_travel_legs (
  id, attendance_id, employee_code, fo_user_id, travel_mode, payable_km_allowed,
  started_at, ended_at, start_lat, start_lng, end_lat, end_lng,
  calculated_km, payable_km, rate_per_km, payable_amount, fare_amount, status, updated_at
) values
  (
    '48991354-ca06-4856-9931-8f95e6bb932e',
    'a8d170e6-cbb4-4788-928d-6eb9999d51e2', 'QPMSTNC17015', 'QPMSTNC17015', 'bike', true,
    timestamptz '2026-10-07 18:44:00+05:30', timestamptz '2026-10-07 19:44:00+05:30',
    12.8016060, 80.1990800, 12.8926100, 80.0828080,
    0, 0, 4, 0, 0, 'completed', timestamptz '2026-10-07 19:45:00+05:30'
  ),
  (
    '850bc41b-e492-4661-9f5e-05aaafb19d0c',
    'd299f0c4-9af7-4f0c-b8cc-86e5b7fb1f91', 'QPMSTNC17015', 'QPMSTNC17015', 'bike', true,
    timestamptz '2026-10-08 18:07:42+05:30', timestamptz '2026-10-08 19:08:51+05:30',
    12.8400000, 80.1800000, 12.9100000, 80.1200000,
    0, 0, 4, 0, 0, 'completed', timestamptz '2026-10-08 19:09:00+05:30'
  );

create or replace function pg_temp.final_leg_plan(p_date date)
returns jsonb language sql stable as $$
  select case p_date
    when date '2026-10-07' then jsonb_build_object(
      'calculationVersion','KM_ENGINE_V2_FINAL_LEG_EVIDENCE_V1','inputDigest',repeat('7',64),
      'attendanceId','a8d170e6-cbb4-4788-928d-6eb9999d51e2','finalLegId','48991354-ca06-4856-9931-8f95e6bb932e',
      'employeeCode','QPMSTNC17015','attendanceDate','2026-10-07',
      'attendanceUpdatedAt','2026-10-07T14:15:00Z','finalLegUpdatedAt','2026-10-07T14:15:00Z',
      'startedAt','2026-10-07T13:14:00Z','endedAt','2026-10-07T14:14:00Z',
      'startLat',12.8016060,'startLng',80.1990800,'endLat',12.8926100,'endLng',80.0828080,
      'existingCalculatedKm',0,'existingPayableKm',0,'existingPayableAmount',0,'existingFareAmount',0,
      'expectedTotalRouteKm',76.45,'expectedEligibleKm',76.45,'expectedTotalApprovedKm',76.45,
      'expectedPetrolAmount',305.80,'expectedSiteVisitCount',1,'expectedSiteVisitRouteKm',76.45,
      'candidateCalculatedKm',19.40,'acceptedGpsKm',19.401,'source','GPS_BASED','referenceOnly',false,
      'decision','MANUAL_REVIEW','persistable',true,'proposedPayableKm',0,'proposedReimbursementChange',0,
      'sourceRowIds',jsonb_build_array('gps-7'),'riskFlags',jsonb_build_array('FINAL_LEG_PAYABLE_REVIEW_REQUIRED')
    )
    when date '2026-10-08' then jsonb_build_object(
      'calculationVersion','KM_ENGINE_V2_FINAL_LEG_EVIDENCE_V1','inputDigest',repeat('8',64),
      'attendanceId','d299f0c4-9af7-4f0c-b8cc-86e5b7fb1f91','finalLegId','850bc41b-e492-4661-9f5e-05aaafb19d0c',
      'employeeCode','QPMSTNC17015','attendanceDate','2026-10-08',
      'attendanceUpdatedAt','2026-10-08T13:39:00Z','finalLegUpdatedAt','2026-10-08T13:39:00Z',
      'startedAt','2026-10-08T12:37:42Z','endedAt','2026-10-08T13:38:51Z',
      'startLat',12.8400000,'startLng',80.1800000,'endLat',12.9100000,'endLng',80.1200000,
      'existingCalculatedKm',0,'existingPayableKm',0,'existingPayableAmount',0,'existingFareAmount',0,
      'expectedTotalRouteKm',80.62,'expectedEligibleKm',80.62,'expectedTotalApprovedKm',80.62,
      'expectedPetrolAmount',322.48,'expectedSiteVisitCount',1,'expectedSiteVisitRouteKm',80.62,
      'candidateCalculatedKm',9.68,'acceptedGpsKm',9.68,'source','GPS_BASED','referenceOnly',false,
      'decision','MANUAL_REVIEW','persistable',true,'proposedPayableKm',0,'proposedReimbursementChange',0,
      'rawSampleCount',155,'duplicateSampleCount',44,'effectiveSampleCount',111,
      'validPointCount',79,'validSampleRatio',79.0/111.0,'rejectedUniqueSampleCount',32,
      'sourceRowIds',jsonb_build_array('gps-8'),'riskFlags',jsonb_build_array('FINAL_LEG_PAYABLE_REVIEW_REQUIRED')
    )
  end
$$;

set session authorization service_role;
select set_config('request.jwt.claim.role', 'service_role', false);

do $$
begin
  if (select financial_writes_enabled from public.fo_km_financial_control where control_key='canonical_v2') then
    raise exception 'test_failed_gate_not_closed';
  end if;
end
$$;

select public.rpc_record_fo_final_leg_evidence_v1(pg_temp.final_leg_plan(date '2026-10-07'), 'two_target_test');
select public.rpc_record_fo_final_leg_evidence_v1(pg_temp.final_leg_plan(date '2026-10-08'), 'two_target_test');
select public.rpc_record_fo_final_leg_evidence_v1(pg_temp.final_leg_plan(date '2026-10-07'), 'two_target_replay');
select public.rpc_record_fo_final_leg_evidence_v1(pg_temp.final_leg_plan(date '2026-10-08'), 'two_target_replay');

do $$
begin
  begin
    perform public.rpc_record_fo_final_leg_evidence_v1(
      pg_temp.final_leg_plan(date '2026-10-08') || jsonb_build_object(
        'attendanceId','99999999-9999-4999-8999-999999999999',
        'finalLegId','99999999-9999-4999-8999-999999999998'
      ), 'unauthorized_target_test'
    );
    raise exception 'test_failed_unauthorized_target_accepted';
  exception when insufficient_privilege then
    if sqlerrm <> 'final_leg_evidence_target_not_authorized' then raise; end if;
  end;

  begin
    perform public.rpc_record_fo_final_leg_evidence_v1(
      (pg_temp.final_leg_plan(date '2026-10-08') - 'inputDigest')
        || jsonb_build_object('inputDigest',repeat('9',64),'attendanceUpdatedAt','2026-10-08T13:39:01Z'),
      'stale_test'
    );
    raise exception 'test_failed_stale_target_accepted';
  exception when serialization_failure then
    if sqlerrm <> 'final_leg_evidence_stale_input' then raise; end if;
  end;

  begin
    perform public.rpc_apply_fo_final_leg_financial_v1(
      'd299f0c4-9af7-4f0c-b8cc-86e5b7fb1f91', '850bc41b-e492-4661-9f5e-05aaafb19d0c',
      null, repeat('a',64), repeat('8',64), null, null,
      80.62,80.62,80.62,322.48,0,0,0,0,9.68,4,38.72,'test', 'two_target_test'
    );
    raise exception 'test_failed_8_october_financial_apply_authorized';
  exception when insufficient_privilege then
    if sqlerrm <> 'final_leg_financial_target_not_authorized' then raise; end if;
  end;
end
$$;

reset session authorization;

do $$
begin
  if (select count(*) from public.fo_final_leg_reconciliation_runs) <> 2 then
    raise exception 'test_failed_two_target_idempotency';
  end if;
  if not exists (
    select 1 from public.fo_final_leg_reconciliation_runs
    where attendance_id='a8d170e6-cbb4-4788-928d-6eb9999d51e2' and candidate_calculated_km=19.40
  ) or not exists (
    select 1 from public.fo_final_leg_reconciliation_runs
    where attendance_id='d299f0c4-9af7-4f0c-b8cc-86e5b7fb1f91' and candidate_calculated_km=9.68
      and (result->>'rawSampleCount')::integer=155
      and (result->>'duplicateSampleCount')::integer=44
      and (result->>'effectiveSampleCount')::integer=111
  ) then
    raise exception 'test_failed_two_target_evidence_values';
  end if;
  if exists (
    select 1 from public.fo_attendance
    where (id='a8d170e6-cbb4-4788-928d-6eb9999d51e2'
           and (total_route_km,eligible_km,total_approved_km,petrol_amount) is distinct from
               (76.45::numeric,76.45::numeric,76.45::numeric,305.80::numeric))
       or (id='d299f0c4-9af7-4f0c-b8cc-86e5b7fb1f91'
           and (total_route_km,eligible_km,total_approved_km,petrol_amount) is distinct from
               (80.62::numeric,80.62::numeric,80.62::numeric,322.48::numeric))
  ) then raise exception 'test_failed_attendance_financials_changed'; end if;
  if exists (
    select 1 from public.fo_travel_legs
    where (calculated_km,payable_km,payable_amount,fare_amount) is distinct from
          (0::numeric,0::numeric,0::numeric,0::numeric)
  ) then raise exception 'test_failed_evidence_changed_leg'; end if;
  if exists (select 1 from public.fo_final_leg_financial_applies)
     or exists (select 1 from public.fo_km_financial_approval_consumptions) then
    raise exception 'test_failed_financial_audit_write';
  end if;
  if (select round(sum(route_km),2) from public.fo_site_visits where attendance_id='a8d170e6-cbb4-4788-928d-6eb9999d51e2') <> 76.45
     or (select round(sum(route_km),2) from public.fo_site_visits where attendance_id='d299f0c4-9af7-4f0c-b8cc-86e5b7fb1f91') <> 80.62 then
    raise exception 'test_failed_site_visit_values_changed';
  end if;
  raise notice 'TWO_TARGET_EVIDENCE_INTEGRATION_OK';
end
$$;
