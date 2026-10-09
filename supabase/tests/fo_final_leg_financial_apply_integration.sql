\set ON_ERROR_STOP on
\set VERBOSITY terse

select id as evidence_run_id, input_digest as evidence_digest
from public.fo_final_leg_reconciliation_runs
where attendance_id='a8d170e6-cbb4-4788-928d-6eb9999d51e2'
  and travel_leg_id='48991354-ca06-4856-9931-8f95e6bb932e'
\gset

set session authorization authenticated;
select set_config('request.jwt.claim.sub','30000000-0000-4000-8000-000000000001',false);
select set_config('request.jwt.claims','{"email":"reviewer@example.test"}',false);
select set_config('test.is_qpms_admin','true',false);
select public.rpc_resolve_fo_final_leg_evidence_v1(
  :'evidence_run_id', 'APPROVED_EVIDENCE', 19.40, 'Disposable GPS evidence approval'
);
select public.rpc_set_fo_km_financial_write_state_v1(true,'Disposable final-leg apply test');
reset session authorization;

set session authorization service_role;
select set_config('request.jwt.claim.role','service_role',false);
\set ON_ERROR_STOP off
select public.rpc_apply_fo_final_leg_financial_v1(
  'a8d170e6-cbb4-4788-928d-6eb9999d51e2','48991354-ca06-4856-9931-8f95e6bb932e',
  :'evidence_run_id',repeat('f',64),:'evidence_digest',
  timestamptz '2026-10-07 19:45:00+05:30',timestamptz '2026-10-07 19:45:00+05:30',
  76.45,76.45,76.45,305.80,0,0,0,0,19.40,4.00,77.60,'fo-bike-rate-v1','no_approval_test'
);
select public.rpc_apply_fo_final_leg_financial_v1(
  'a8d170e6-cbb4-4788-928d-6eb9999d51e2','48991354-ca06-4856-9931-8f95e6bb932e',
  :'evidence_run_id',repeat('f',64),:'evidence_digest',
  timestamptz '2026-10-07 19:46:00+05:30',timestamptz '2026-10-07 19:45:00+05:30',
  76.45,76.45,76.45,305.80,0,0,0,0,19.40,4.00,77.60,'fo-bike-rate-v1','stale_test'
);
select public.rpc_apply_fo_final_leg_financial_v1(
  '20000000-0000-4000-8000-000000000001','48991354-ca06-4856-9931-8f95e6bb932e',
  :'evidence_run_id',repeat('f',64),:'evidence_digest',
  timestamptz '2026-10-07 19:45:00+05:30',timestamptz '2026-10-07 19:45:00+05:30',
  76.45,76.45,76.45,305.80,0,0,0,0,19.40,4.00,77.60,'fo-bike-rate-v1','scope_test'
);
\set ON_ERROR_STOP on
reset session authorization;

do $$
begin
  if exists (
    select 1 from public.fo_attendance where id='a8d170e6-cbb4-4788-928d-6eb9999d51e2'
      and (total_route_km,eligible_km,total_approved_km,petrol_amount) is distinct from
          (76.45::numeric,76.45::numeric,76.45::numeric,305.80::numeric)
  ) or exists (
    select 1 from public.fo_travel_legs where id='48991354-ca06-4856-9931-8f95e6bb932e'
      and (calculated_km,payable_km,payable_amount) is distinct from
          (0::numeric,0::numeric,0::numeric)
  ) then raise exception 'test_failed_rejected_apply_changed_financials'; end if;
end
$$;

set session authorization authenticated;
select set_config('request.jwt.claim.sub','30000000-0000-4000-8000-000000000001',false);
select set_config('request.jwt.claims','{"email":"reviewer@example.test"}',false);
select set_config('test.is_qpms_admin','true',false);
\set ON_ERROR_STOP off
select public.rpc_approve_fo_km_financial_change_v1(
  'a8d170e6-cbb4-4788-928d-6eb9999d51e2',repeat('f',64),
  timestamptz '2026-10-07 19:45:00+05:30',99,76.45,76.45,305.80,
  95.85,95.85,95.85,383.40,'Rejected mismatched approval'
);
\set ON_ERROR_STOP on
select public.rpc_approve_fo_km_financial_change_v1(
  'a8d170e6-cbb4-4788-928d-6eb9999d51e2',repeat('f',64),
  timestamptz '2026-10-07 19:45:00+05:30',76.45,76.45,76.45,305.80,
  95.85,95.85,95.85,383.40,'Approved final-leg-only delta'
);
reset session authorization;

set session authorization service_role;
select set_config('request.jwt.claim.role','service_role',false);
select public.rpc_apply_fo_final_leg_financial_v1(
  'a8d170e6-cbb4-4788-928d-6eb9999d51e2','48991354-ca06-4856-9931-8f95e6bb932e',
  :'evidence_run_id',repeat('f',64),:'evidence_digest',
  timestamptz '2026-10-07 19:45:00+05:30',timestamptz '2026-10-07 19:45:00+05:30',
  76.45,76.45,76.45,305.80,0,0,0,0,19.40,4.00,77.60,'fo-bike-rate-v1','approved_test'
);
select public.rpc_apply_fo_final_leg_financial_v1(
  'a8d170e6-cbb4-4788-928d-6eb9999d51e2','48991354-ca06-4856-9931-8f95e6bb932e',
  :'evidence_run_id',repeat('f',64),:'evidence_digest',
  timestamptz '2026-10-07 19:45:00+05:30',timestamptz '2026-10-07 19:45:00+05:30',
  76.45,76.45,76.45,305.80,0,0,0,0,19.40,4.00,77.60,'fo-bike-rate-v1','replay_test'
);
\set ON_ERROR_STOP off
select public.rpc_apply_fo_final_leg_financial_v1(
  'a8d170e6-cbb4-4788-928d-6eb9999d51e2','48991354-ca06-4856-9931-8f95e6bb932e',
  :'evidence_run_id',repeat('1',64),:'evidence_digest',
  timestamptz '2026-10-07 19:45:00+05:30',timestamptz '2026-10-07 19:45:00+05:30',
  76.45,76.45,76.45,305.80,0,0,0,0,19.40,4.00,77.60,'fo-bike-rate-v1','duplicate_test'
);
\set ON_ERROR_STOP on
reset session authorization;

do $$
declare
  v_routes numeric[];
begin
  select array_agg(route_km order by check_in_time) into v_routes
  from public.fo_site_visits where attendance_id='a8d170e6-cbb4-4788-928d-6eb9999d51e2';
  if v_routes <> array[10.00,11.00,12.00,13.00,9.00,8.00,13.45]::numeric[] then
    raise exception 'test_failed_site_visit_routes_changed';
  end if;
  if (select count(*) from public.fo_travel_legs where attendance_id='a8d170e6-cbb4-4788-928d-6eb9999d51e2') <> 1 then
    raise exception 'test_failed_duplicate_leg_inserted';
  end if;
  if exists (
    select 1 from public.fo_travel_legs where id='48991354-ca06-4856-9931-8f95e6bb932e'
      and ((calculated_km,payable_km,rate_per_km,payable_amount,fare_amount) is distinct from
          (19.40::numeric,19.40::numeric,4.00::numeric,77.60::numeric,0::numeric)
        or calculation_version <> 'KM_ENGINE_V2_FINAL_LEG_ONLY_V1'
        or canonical_calculated is true)
  ) then raise exception 'test_failed_final_leg_values'; end if;
  if exists (
    select 1 from public.fo_attendance where id='a8d170e6-cbb4-4788-928d-6eb9999d51e2'
      and ((total_route_km,eligible_km,total_approved_km,petrol_amount) is distinct from
          (95.85::numeric,95.85::numeric,95.85::numeric,383.40::numeric)
        or route_sync_status <> 'final_leg_reconciled_pending_canonical_v2'
        or coalesce(metadata ->> 'canonical_recalculation_complete','false') <> 'false'
        or coalesce(metadata ->> 'km_calculation_version','') = 'KM_ENGINE_V2')
  ) then raise exception 'test_failed_attendance_after_values'; end if;
  if (select count(*) from public.fo_final_leg_financial_applies) <> 1
     or (select count(*) from public.fo_km_financial_approval_consumptions
         where final_leg_apply_id is not null and calculation_run_id is null) <> 1 then
    raise exception 'test_failed_apply_audit_or_consumption';
  end if;
end
$$;

\set ON_ERROR_STOP off
update public.fo_final_leg_financial_applies set rate_policy='mutated';
\set ON_ERROR_STOP on

do $$
begin
  if (select rate_policy from public.fo_final_leg_financial_applies) <> 'fo-bike-rate-v1' then
    raise exception 'test_failed_apply_audit_not_immutable';
  end if;
  raise notice 'FINAL_LEG_FINANCIAL_APPLY_INTEGRATION_OK';
end
$$;
