\set ON_ERROR_STOP on
\set VERBOSITY terse

truncate table
  public.fo_km_auto_recovery_applies,
  public.fo_km_auto_recovery_authorizations,
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
  id,fo_user_id,employee_code,attendance_date,login_time,logout_time,status,
  end_latitude,end_longitude,eligible_km,total_route_km,total_approved_km,
  rate_per_km,petrol_amount,travel_mode,route_sync_status,metadata,updated_at
) values
('a8d170e6-cbb4-4788-928d-6eb9999d51e2','QPMSTNC17015','QPMSTNC17015','2026-10-07',
 '2026-10-07T03:30:00Z','2026-10-07T14:14:00Z','Completed',12.8926100,80.0828080,
 76.45,76.45,76.45,4,305.80,'bike','pending','{}','2026-10-07T14:15:00Z'),
('d299f0c4-9af7-4f0c-b8cc-86e5b7fb1f91','QPMSTNC17015','QPMSTNC17015','2026-10-08',
 '2026-10-08T03:30:00Z','2026-10-08T13:38:51Z','Completed',12.9100000,80.1200000,
 57.54,57.54,57.54,4,230.16,'bike','pending','{}','2026-10-08T13:39:00Z');

insert into public.fo_site_visits(id,attendance_id,check_in_time,check_out_time,check_out_latitude,check_out_longitude,route_km) values
('10000000-0000-4000-8000-000000000007','a8d170e6-cbb4-4788-928d-6eb9999d51e2','2026-10-07T03:30:00Z','2026-10-07T13:14:00Z',12.8016060,80.1990800,76.45),
('10000000-0000-4000-8000-000000000008','d299f0c4-9af7-4f0c-b8cc-86e5b7fb1f91','2026-10-08T03:30:00Z','2026-10-08T12:37:42Z',12.8400000,80.1800000,57.54);

insert into public.fo_travel_legs(
  id,attendance_id,employee_code,fo_user_id,travel_mode,payable_km_allowed,started_at,ended_at,
  start_lat,start_lng,end_lat,end_lng,calculated_km,payable_km,rate_per_km,payable_amount,fare_amount,status,updated_at
) values
('48991354-ca06-4856-9931-8f95e6bb932e','a8d170e6-cbb4-4788-928d-6eb9999d51e2','QPMSTNC17015','QPMSTNC17015','bike',true,
 '2026-10-07T13:14:00Z','2026-10-07T14:14:00Z',12.8016060,80.1990800,12.8926100,80.0828080,0,0,4,0,0,'completed','2026-10-07T14:15:00Z'),
('850bc41b-e492-4661-9f5e-05aaafb19d0c','d299f0c4-9af7-4f0c-b8cc-86e5b7fb1f91','QPMSTNC17015','QPMSTNC17015','bike',true,
 '2026-10-08T12:37:42Z','2026-10-08T13:38:51Z',12.8400000,80.1800000,12.9100000,80.1200000,0,0,4,0,0,'completed','2026-10-08T13:39:00Z');

create or replace function pg_temp.auto_plan(p_date date)
returns jsonb language sql stable as $$
  select case p_date
    when date '2026-10-07' then jsonb_build_object(
      'version','KM_ENGINE_V2_AUTO_MISSING_LEG_V1','inputDigest',repeat('7',64),
      'attendanceId','a8d170e6-cbb4-4788-928d-6eb9999d51e2','travelLegId','48991354-ca06-4856-9931-8f95e6bb932e',
      'employeeCode','QPMSTNC17015','attendanceDate','2026-10-07','legType','last_checkout_to_end_day',
      'attendanceUpdatedAt','2026-10-07T14:15:00Z','travelLegUpdatedAt','2026-10-07T14:15:00Z',
      'source','GPS_BASED','gpsCoverageClassification','GPS_COMPLETE','decision','ACCEPTED','payable',true,
      'candidateKm',19.40,'rate',4.00,'amount',77.60,
      'before',jsonb_build_object('totalRouteKm',76.45,'eligibleKm',76.45,'totalApprovedKm',76.45,'petrolAmount',305.80),
      'existingLeg',jsonb_build_object('calculatedKm',0,'payableKm',0,'payableAmount',0,'fareAmount',0),
      'siteVisits',jsonb_build_object('count',1,'routeKm',76.45),'riskFlags','[]'::jsonb,'diagnostics','{}'::jsonb
    )
    when date '2026-10-08' then jsonb_build_object(
      'version','KM_ENGINE_V2_AUTO_MISSING_LEG_V1','inputDigest',repeat('8',64),
      'attendanceId','d299f0c4-9af7-4f0c-b8cc-86e5b7fb1f91','travelLegId','850bc41b-e492-4661-9f5e-05aaafb19d0c',
      'employeeCode','QPMSTNC17015','attendanceDate','2026-10-08','legType','last_checkout_to_end_day',
      'attendanceUpdatedAt','2026-10-08T13:39:00Z','travelLegUpdatedAt','2026-10-08T13:39:00Z',
      'source','GPS_BASED','gpsCoverageClassification','GPS_COMPLETE','decision','ACCEPTED_WITH_WARNING','payable',true,
      'candidateKm',9.68,'rate',4.00,'amount',38.72,
      'before',jsonb_build_object('totalRouteKm',57.54,'eligibleKm',57.54,'totalApprovedKm',57.54,'petrolAmount',230.16),
      'existingLeg',jsonb_build_object('calculatedKm',0,'payableKm',0,'payableAmount',0,'fareAmount',0),
      'siteVisits',jsonb_build_object('count',1,'routeKm',57.54),'riskFlags','[]'::jsonb,'diagnostics','{}'::jsonb
    ) end
$$;

do $$ begin
  begin
    perform public.rpc_apply_fo_gps_complete_missing_leg_v1(
      gen_random_uuid(),pg_temp.auto_plan('2026-10-07'),
      '30000000-0000-4000-8000-000000000001','admin@example.test');
    raise exception 'test_failed_missing_authorization_accepted';
  exception when insufficient_privilege then
    if sqlerrm <> 'auto_missing_km_bounded_authorization_required' then raise; end if;
  end;
end $$;

insert into public.fo_km_auto_recovery_authorizations(
  id,employee_code,date_from,date_to,max_attendances,max_legs,
  authorized_by_identity,authorization_reason,expires_at
) values (
  '90000000-0000-4000-8000-000000000001','QPMSTNC17015','2026-10-07','2026-10-08',2,2,
  'technical-operator@example.test','Explicit disposable two-date test authorization',now()+interval '1 hour'
);

do $$ begin
  begin
    perform public.rpc_apply_fo_gps_complete_missing_leg_v1(
      '90000000-0000-4000-8000-000000000001',
      pg_temp.auto_plan('2026-10-07')||jsonb_build_object('employeeCode','OTHER_EMPLOYEE'),
      '30000000-0000-4000-8000-000000000001','admin@example.test');
    raise exception 'test_failed_wrong_employee_scope_accepted';
  exception when insufficient_privilege then
    if sqlerrm <> 'auto_missing_km_bounded_authorization_required' then raise; end if;
  end;

  begin
    perform public.rpc_apply_fo_gps_complete_missing_leg_v1(
      '90000000-0000-4000-8000-000000000001',
      pg_temp.auto_plan('2026-10-08')||jsonb_build_object('rate',8,'amount',77.44),
      '30000000-0000-4000-8000-000000000001','admin@example.test');
    raise exception 'test_failed_wrong_rate_accepted';
  exception when insufficient_privilege then
    if sqlerrm <> 'auto_missing_km_stored_travel_policy_rejected' then raise; end if;
  end;
end $$;

insert into public.fo_monthly_travel_settlements(employee_code,period_start,period_end,approved_payable_amount,source_reference)
values('QPMSTNC17015','2026-10-08','2026-10-08',0,'auto-recovery-protection-test');
do $$ begin
  begin
    perform public.rpc_apply_fo_gps_complete_missing_leg_v1(
      '90000000-0000-4000-8000-000000000001',pg_temp.auto_plan('2026-10-08'),
      '30000000-0000-4000-8000-000000000001','admin@example.test');
    raise exception 'test_failed_settled_attendance_accepted';
  exception when object_not_in_prerequisite_state then
    if sqlerrm <> 'auto_missing_km_existing_settlement_finance_reconciliation' then raise; end if;
  end;
end $$;
delete from public.fo_monthly_travel_settlements where source_reference='auto-recovery-protection-test';

select public.rpc_apply_fo_gps_complete_missing_leg_v1(
  '90000000-0000-4000-8000-000000000001',pg_temp.auto_plan('2026-10-07'),
  '30000000-0000-4000-8000-000000000001','admin@example.test');
select public.rpc_apply_fo_gps_complete_missing_leg_v1(
  '90000000-0000-4000-8000-000000000001',pg_temp.auto_plan('2026-10-08'),
  '30000000-0000-4000-8000-000000000001','admin@example.test');
select public.rpc_apply_fo_gps_complete_missing_leg_v1(
  '90000000-0000-4000-8000-000000000001',pg_temp.auto_plan('2026-10-08'),
  '30000000-0000-4000-8000-000000000001','admin@example.test');

do $$ begin
  if exists(select 1 from public.fo_km_financial_control where control_key='canonical_v2' and financial_writes_enabled) then
    raise exception 'test_failed_global_financial_gate_opened';
  end if;
  if not exists(select 1 from public.fo_attendance where id='a8d170e6-cbb4-4788-928d-6eb9999d51e2'
    and (total_route_km,eligible_km,total_approved_km,petrol_amount)=(95.85,95.85,95.85,383.40)) then
    raise exception 'test_failed_balaji_07_totals';
  end if;
  if not exists(select 1 from public.fo_attendance where id='d299f0c4-9af7-4f0c-b8cc-86e5b7fb1f91'
    and (total_route_km,eligible_km,total_approved_km,petrol_amount)=(67.22,67.22,67.22,268.88)) then
    raise exception 'test_failed_balaji_08_totals_or_replay';
  end if;
  if (select count(*) from public.fo_km_auto_recovery_applies) <> 2 then
    raise exception 'test_failed_apply_audit_or_idempotency';
  end if;
  if (select sum(route_km) from public.fo_site_visits where attendance_id='a8d170e6-cbb4-4788-928d-6eb9999d51e2')<>76.45
     or (select sum(route_km) from public.fo_site_visits where attendance_id='d299f0c4-9af7-4f0c-b8cc-86e5b7fb1f91')<>57.54 then
    raise exception 'test_failed_existing_site_visit_km_changed';
  end if;
  raise notice 'GPS_COMPLETE_AUTOMATIC_MISSING_KM_INTEGRATION_OK';
end $$;
