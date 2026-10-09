\set ON_ERROR_STOP on
\set VERBOSITY terse

insert into public.fo_attendance (
  id, fo_user_id, employee_code, attendance_date, login_time, logout_time, status,
  eligible_km, total_route_km, total_approved_km, rate_per_km, petrol_amount,
  travel_mode, route_sync_status, metadata, updated_at
) values (
  '20000000-0000-4000-8000-000000000001', 'TEST001', 'TEST001', date '2026-10-07',
  timestamptz '2026-10-07 09:00:00+05:30', timestamptz '2026-10-07 18:00:00+05:30',
  'Completed', 10, 10, 10, 4, 40, 'bike', 'pending_canonical_end_day_recalculation',
  '{"canonical_recalculation_pending":true}', timestamptz '2026-10-07 18:01:00+05:30'
), (
  '20000000-0000-4000-8000-000000000002', 'TEST002', 'TEST002', date '2026-10-07',
  timestamptz '2026-10-07 09:00:00+05:30', timestamptz '2026-10-07 18:00:00+05:30',
  'Completed', 5, 5, 5, 4, 20, 'bike', 'pending_canonical_end_day_recalculation',
  '{"canonical_recalculation_pending":true}', timestamptz '2026-10-07 18:01:00+05:30'
);

create or replace function pg_temp.zero_calculation(p_digest text)
returns jsonb language sql stable as $$
  select jsonb_build_object(
    'calculationVersion','KM_ENGINE_V2',
    'inputDigest',p_digest,
    'canonicalLegs','[]'::jsonb,
    'inputRowCount',0,
    'acceptedPointCount',0,
    'rejectedPointReasons','{}'::jsonb,
    'acceptedGpsKm',0,
    'reconstructedGapKm',0,
    'payableKm',0,
    'reimbursement',0,
    'modeRateSnapshot','[]'::jsonb,
    'riskFlags','[]'::jsonb,
    'decision','ACCEPTED',
    'sourceRowIds','[]'::jsonb,
    'attendanceMetadata',jsonb_build_object('canonical_recalculation_pending',false)
  )
$$;

set session authorization service_role;
select set_config('request.jwt.claim.role','service_role',false);
\set ON_ERROR_STOP off
select public.rpc_approve_fo_km_financial_change_v1(
  '20000000-0000-4000-8000-000000000001',repeat('b',64),
  timestamptz '2026-10-07 18:01:00+05:30',10,10,10,40,0,0,0,0,'forbidden service approval'
);
\set ON_ERROR_STOP on
reset session authorization;

set session authorization authenticated;
select set_config('request.jwt.claim.sub','30000000-0000-4000-8000-000000000001',false);
select set_config('request.jwt.claims','{"email":"reviewer@example.test"}',false);
select set_config('test.is_qpms_admin','true',false);
select public.rpc_set_fo_km_financial_write_state_v1(true,'disposable integration test');
\set ON_ERROR_STOP off
select public.rpc_approve_fo_km_financial_change_v1(
  '20000000-0000-4000-8000-000000000002',repeat('c',64),
  timestamptz '2026-10-07 18:01:00+05:30',99,5,5,20,0,0,0,0,'stale rejected approval'
);
\set ON_ERROR_STOP on
select public.rpc_approve_fo_km_financial_change_v1(
  '20000000-0000-4000-8000-000000000001',repeat('b',64),
  timestamptz '2026-10-07 18:01:00+05:30',10,10,10,40,0,0,0,0,'approved disposable change'
);
reset session authorization;

set session authorization service_role;
select set_config('request.jwt.claim.role','service_role',false);
\set ON_ERROR_STOP off
select public.rpc_persist_fo_canonical_km_v2(
  '20000000-0000-4000-8000-000000000002',repeat('d',64),
  timestamptz '2026-10-07 18:02:00+05:30',pg_temp.zero_calculation(repeat('d',64)),
  'integration_stale','service_role'
);
select public.rpc_persist_fo_canonical_km_v2(
  '20000000-0000-4000-8000-000000000002',repeat('d',64),
  timestamptz '2026-10-07 18:01:00+05:30',pg_temp.zero_calculation(repeat('d',64)),
  'integration_no_approval','service_role'
);
\set ON_ERROR_STOP on
select public.rpc_persist_fo_canonical_km_v2(
  '20000000-0000-4000-8000-000000000001',repeat('b',64),
  timestamptz '2026-10-07 18:01:00+05:30',pg_temp.zero_calculation(repeat('b',64)),
  'integration_approved','service_role'
);
select public.rpc_persist_fo_canonical_km_v2(
  '20000000-0000-4000-8000-000000000001',repeat('b',64),
  timestamptz '2026-10-07 18:01:00+05:30',pg_temp.zero_calculation(repeat('b',64)),
  'integration_replay','service_role'
);
reset session authorization;

do $$
begin
  if exists (
    select 1 from public.fo_attendance where id='20000000-0000-4000-8000-000000000001'
      and (total_route_km,eligible_km,total_approved_km,petrol_amount) is distinct from
          (0::numeric,0::numeric,0::numeric,0::numeric)
  ) then raise exception 'test_failed_approved_write'; end if;
  if exists (
    select 1 from public.fo_attendance where id='20000000-0000-4000-8000-000000000002'
      and (total_route_km,eligible_km,total_approved_km,petrol_amount) is distinct from
          (5::numeric,5::numeric,5::numeric,20::numeric)
  ) then raise exception 'test_failed_rejected_write_rollback'; end if;
  if (select count(*) from public.fo_km_calculation_runs where attendance_id='20000000-0000-4000-8000-000000000001') <> 1
     or (select count(*) from public.fo_km_financial_approval_consumptions where attendance_id='20000000-0000-4000-8000-000000000001') <> 1 then
    raise exception 'test_failed_replay_or_consumption';
  end if;
  if exists (select 1 from public.fo_km_financial_approvals where attendance_id='20000000-0000-4000-8000-000000000002') then
    raise exception 'test_failed_stale_approval_inserted';
  end if;
end
$$;

\set ON_ERROR_STOP off
update public.fo_km_financial_approvals set approval_reason='mutated';
update public.fo_km_financial_approval_consumptions set input_digest=repeat('f',64);
\set ON_ERROR_STOP on

do $$
begin
  if (select approval_reason from public.fo_km_financial_approvals where attendance_id='20000000-0000-4000-8000-000000000001') <> 'approved disposable change'
     or (select input_digest from public.fo_km_financial_approval_consumptions where attendance_id='20000000-0000-4000-8000-000000000001') <> repeat('b',64) then
    raise exception 'test_failed_immutable_financial_audit';
  end if;
  raise notice 'CANONICAL_INTEGRATION_OK';
end
$$;
