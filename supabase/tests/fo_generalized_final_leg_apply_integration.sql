\set ON_ERROR_STOP on
\set VERBOSITY terse

select id as run7,input_digest as evidence7 from public.fo_final_leg_reconciliation_runs
where attendance_id='a8d170e6-cbb4-4788-928d-6eb9999d51e2' \gset
select id as run8,input_digest as evidence8 from public.fo_final_leg_reconciliation_runs
where attendance_id='d299f0c4-9af7-4f0c-b8cc-86e5b7fb1f91' \gset

set session authorization authenticated;
select set_config('request.jwt.claim.sub','30000000-0000-4000-8000-000000000001',false);
select set_config('request.jwt.claims','{"email":"reviewer@example.test"}',false);
select set_config('test.is_qpms_admin','true',false);
select public.rpc_resolve_fo_final_leg_evidence_v1(:'run7','APPROVED_EVIDENCE',19.40,'Reviewed GPS_COMPLETE evidence');
select public.rpc_resolve_fo_final_leg_evidence_v1(:'run8','APPROVED_EVIDENCE',9.68,'Reviewed duplicate-aware GPS_COMPLETE evidence');
select public.rpc_set_fo_km_financial_write_state_v1(true,'Disposable Migration 207 apply validation');
reset session authorization;

-- Existing correction and settlement ledgers must fail closed before a new apply.
set session authorization service_role;
select set_config('request.jwt.claim.role','service_role',false);
insert into public.fo_travel_reimbursement_corrections(attendance_id,status,correction_key,correction_reason)
values('d299f0c4-9af7-4f0c-b8cc-86e5b7fb1f91','applied','synthetic-existing-correction','guard test');
do $$ begin
  begin
    perform public.rpc_apply_fo_final_leg_financial_v1(
      'd299f0c4-9af7-4f0c-b8cc-86e5b7fb1f91','850bc41b-e492-4661-9f5e-05aaafb19d0c',
      (select id from public.fo_final_leg_reconciliation_runs where attendance_id='d299f0c4-9af7-4f0c-b8cc-86e5b7fb1f91'),
      repeat('8',64),(select input_digest from public.fo_final_leg_reconciliation_runs where attendance_id='d299f0c4-9af7-4f0c-b8cc-86e5b7fb1f91'),
      '2026-10-08T13:39:00Z','2026-10-08T13:39:00Z',
      57.54,57.54,57.54,230.16,0,0,0,0,9.68,4.00,38.72,'fo-bike-rate-v1','correction-guard');
    raise exception 'test_failed_existing_correction_accepted';
  exception when object_not_in_prerequisite_state then
    if sqlerrm<>'final_leg_existing_correction_manual_review' then raise; end if;
  end;
end $$;
delete from public.fo_travel_reimbursement_corrections where correction_key='synthetic-existing-correction';
insert into public.fo_monthly_travel_settlements(employee_code,period_start,period_end,approved_payable_amount,source_reference)
values('QPMSTNC17015','2026-10-01','2026-10-31',0,'synthetic-settlement');
do $$ begin
  begin
    perform public.rpc_apply_fo_final_leg_financial_v1(
      'd299f0c4-9af7-4f0c-b8cc-86e5b7fb1f91','850bc41b-e492-4661-9f5e-05aaafb19d0c',
      (select id from public.fo_final_leg_reconciliation_runs where attendance_id='d299f0c4-9af7-4f0c-b8cc-86e5b7fb1f91'),
      repeat('8',64),(select input_digest from public.fo_final_leg_reconciliation_runs where attendance_id='d299f0c4-9af7-4f0c-b8cc-86e5b7fb1f91'),
      '2026-10-08T13:39:00Z','2026-10-08T13:39:00Z',
      57.54,57.54,57.54,230.16,0,0,0,0,9.68,4.00,38.72,'fo-bike-rate-v1','settlement-guard');
    raise exception 'test_failed_existing_settlement_accepted';
  exception when object_not_in_prerequisite_state then
    if sqlerrm<>'final_leg_existing_settlement_manual_review' then raise; end if;
  end;
end $$;
delete from public.fo_monthly_travel_settlements where source_reference='synthetic-settlement';
do $$ begin
  begin
    perform public.rpc_apply_fo_final_leg_financial_v1(
      'd299f0c4-9af7-4f0c-b8cc-86e5b7fb1f91','850bc41b-e492-4661-9f5e-05aaafb19d0c',
      (select id from public.fo_final_leg_reconciliation_runs where attendance_id='d299f0c4-9af7-4f0c-b8cc-86e5b7fb1f91'),
      repeat('8',64),(select input_digest from public.fo_final_leg_reconciliation_runs where attendance_id='d299f0c4-9af7-4f0c-b8cc-86e5b7fb1f91'),
      '2026-10-08T13:39:00Z','2026-10-08T13:39:00Z',
      57.54,57.54,57.54,230.16,0,0,0,0,9.68,4.00,38.72,'fo-bike-rate-v1','no-approval');
    raise exception 'test_failed_no_approval_accepted';
  exception when object_not_in_prerequisite_state then
    if sqlerrm<>'km_v2_financial_approval_required' then raise; end if;
  end;
end $$;
reset session authorization;

do $$ begin
  if exists(select 1 from public.fo_final_leg_financial_applies) then
    raise exception 'test_failed_no_approval_created_apply';
  end if;
end $$;

set session authorization authenticated;
select set_config('request.jwt.claim.sub','30000000-0000-4000-8000-000000000001',false);
select set_config('request.jwt.claims','{"email":"reviewer@example.test"}',false);
select set_config('test.is_qpms_admin','true',false);
select public.rpc_approve_fo_km_financial_change_v1(
  'a8d170e6-cbb4-4788-928d-6eb9999d51e2',repeat('7',64),'2026-10-07T14:15:00Z',
  76.45,76.45,76.45,305.80,95.85,95.85,95.85,383.40,'Approved additive 7 October delta');
select public.rpc_approve_fo_km_financial_change_v1(
  'd299f0c4-9af7-4f0c-b8cc-86e5b7fb1f91',repeat('8',64),'2026-10-08T13:39:00Z',
  57.54,57.54,57.54,230.16,67.22,67.22,67.22,268.88,'Approved additive 8 October delta');
reset session authorization;

set session authorization service_role;
select set_config('request.jwt.claim.role','service_role',false);
select public.rpc_apply_fo_final_leg_financial_v1(
  'a8d170e6-cbb4-4788-928d-6eb9999d51e2','48991354-ca06-4856-9931-8f95e6bb932e',
  :'run7',repeat('7',64),:'evidence7','2026-10-07T14:15:00Z','2026-10-07T14:15:00Z',
  76.45,76.45,76.45,305.80,0,0,0,0,19.40,4.00,77.60,'fo-bike-rate-v1','approved-7');
select public.rpc_apply_fo_final_leg_financial_v1(
  'd299f0c4-9af7-4f0c-b8cc-86e5b7fb1f91','850bc41b-e492-4661-9f5e-05aaafb19d0c',
  :'run8',repeat('8',64),:'evidence8','2026-10-08T13:39:00Z','2026-10-08T13:39:00Z',
  57.54,57.54,57.54,230.16,0,0,0,0,9.68,4.00,38.72,'fo-bike-rate-v1','approved-8');
-- Exact replay is idempotent and cannot add the delta twice.
select public.rpc_apply_fo_final_leg_financial_v1(
  'd299f0c4-9af7-4f0c-b8cc-86e5b7fb1f91','850bc41b-e492-4661-9f5e-05aaafb19d0c',
  :'run8',repeat('8',64),:'evidence8','2026-10-08T13:39:00Z','2026-10-08T13:39:00Z',
  57.54,57.54,57.54,230.16,0,0,0,0,9.68,4.00,38.72,'fo-bike-rate-v1','replay-8');
reset session authorization;

do $$
begin
  if exists(select 1 from public.fo_attendance where id='a8d170e6-cbb4-4788-928d-6eb9999d51e2'
    and (total_route_km,eligible_km,total_approved_km,petrol_amount) is distinct from
      (95.85::numeric,95.85::numeric,95.85::numeric,383.40::numeric)) then
    raise exception 'test_failed_7_october_additive_total';
  end if;
  if exists(select 1 from public.fo_attendance where id='d299f0c4-9af7-4f0c-b8cc-86e5b7fb1f91'
    and (total_route_km,eligible_km,total_approved_km,petrol_amount) is distinct from
      (67.22::numeric,67.22::numeric,67.22::numeric,268.88::numeric)) then
    raise exception 'test_failed_8_october_additive_total';
  end if;
  if (select count(*) from public.fo_final_leg_financial_applies)<>2
     or (select count(*) from public.fo_km_financial_approval_consumptions)<>2 then
    raise exception 'test_failed_exactly_once_audit';
  end if;
  if (select route_km from public.fo_site_visits where attendance_id='a8d170e6-cbb4-4788-928d-6eb9999d51e2')<>76.45
     or (select route_km from public.fo_site_visits where attendance_id='d299f0c4-9af7-4f0c-b8cc-86e5b7fb1f91')<>57.54 then
    raise exception 'test_failed_site_visit_base_changed';
  end if;
  if exists(select 1 from public.fo_final_leg_financial_applies
    where reconciliation_status<>'FINAL_LEG_FINANCIALLY_APPLIED_CANONICAL_PENDING') then
    raise exception 'test_failed_canonical_status';
  end if;
  raise notice 'GENERALIZED_FINAL_LEG_APPLY_INTEGRATION_OK';
end
$$;

set session authorization authenticated;
select set_config('request.jwt.claim.sub','30000000-0000-4000-8000-000000000001',false);
select set_config('request.jwt.claims','{"email":"reviewer@example.test"}',false);
select set_config('test.is_qpms_admin','true',false);
select public.rpc_set_fo_km_financial_write_state_v1(false,'Close disposable validation gate');
reset session authorization;
