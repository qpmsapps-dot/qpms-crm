-- Generalized, additive-only final Check-Out -> End Day recovery.
-- Reuses Migration 200/205 ledgers; creates no parallel financial source of truth.

begin;

do $preflight$
declare
  v_record_rpc regprocedure := to_regprocedure('public.rpc_record_fo_final_leg_evidence_v1(jsonb,text)');
  v_record_definition text;
  v_record_config text[];
begin
  if current_setting('server_version_num')::integer < 170000 then
    raise exception 'Migration 207 requires PostgreSQL 17 or newer';
  end if;
  if to_regclass('public.fo_final_leg_reconciliation_runs') is null
     or to_regclass('public.fo_final_leg_reconciliation_resolutions') is null
     or to_regclass('public.fo_final_leg_financial_applies') is null
     or to_regclass('public.fo_km_financial_approvals') is null
     or to_regclass('public.fo_km_financial_approval_consumptions') is null
     or to_regclass('public.fo_travel_reimbursement_corrections') is null
     or to_regclass('public.fo_monthly_travel_settlements') is null then
    raise exception 'Migrations 200, 205 and 206 are required before Migration 207';
  end if;
  if v_record_rpc is null then
    raise exception 'Unexpected Migration 206 evidence RPC; refusing generalized replacement';
  end if;
  v_record_definition := pg_get_functiondef(v_record_rpc);
  select proconfig into v_record_config from pg_proc where oid=v_record_rpc;
  if md5(v_record_definition) not in (
       'b21d2a6088f9e1a66ec523296ab6ed2d',
       'a68275074bd5f6a11ceda0c4f9556a70'
     )
     or strpos(v_record_definition,'pg_try_advisory_xact_lock')=0
     or strpos(v_record_definition,'final_leg_evidence_already_running')=0
     or not ('lock_timeout=2s'=any(v_record_config))
     or not ('statement_timeout=15s'=any(v_record_config))
     or has_function_privilege('anon',v_record_rpc,'EXECUTE')
     or has_function_privilege('authenticated',v_record_rpc,'EXECUTE')
     or not has_function_privilege('service_role',v_record_rpc,'EXECUTE') then
    raise exception 'Unexpected Migration 206 evidence RPC definition, settings or grants';
  end if;
  if to_regprocedure('public.rpc_resolve_fo_final_leg_evidence_v1(uuid,text,numeric,text)') is null
     or to_regprocedure('public.rpc_apply_fo_final_leg_financial_v1(uuid,uuid,uuid,text,text,timestamptz,timestamptz,numeric,numeric,numeric,numeric,numeric,numeric,numeric,numeric,numeric,numeric,numeric,text,text)') is null then
    raise exception 'Migration 205 review/apply RPCs are missing';
  end if;
end
$preflight$;

create or replace function public.rpc_record_fo_final_leg_evidence_v1(
  p_plan jsonb,
  p_actor_source text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
set lock_timeout = '2s'
set statement_timeout = '15s'
as $function$
declare
  v_attendance public.fo_attendance%rowtype;
  v_leg public.fo_travel_legs%rowtype;
  v_existing public.fo_final_leg_reconciliation_runs%rowtype;
  v_last_visit public.fo_site_visits%rowtype;
  v_run_id uuid := gen_random_uuid();
  v_attendance_id uuid;
  v_leg_id uuid;
  v_digest text;
  v_candidate_km numeric;
  v_visit_count integer;
  v_visit_km numeric;
  v_source text;
  v_reference_only boolean;
begin
  if p_plan is null or jsonb_typeof(p_plan) <> 'object'
     or coalesce(p_plan ->> 'calculationVersion', '') <> 'KM_ENGINE_V2_FINAL_LEG_EVIDENCE_V1'
     or coalesce(p_plan ->> 'inputDigest', '') !~ '^[0-9a-f]{64}$' then
    raise exception using errcode = '22023', message = 'final_leg_evidence_invalid_version_or_digest';
  end if;
  if coalesce((p_plan ->> 'persistable')::boolean, false) is not true
     or coalesce(p_plan ->> 'decision', '') <> 'MANUAL_REVIEW'
     or coalesce((p_plan ->> 'proposedPayableKm')::numeric, -1) <> 0
     or coalesce((p_plan ->> 'proposedReimbursementChange')::numeric, -1) <> 0 then
    raise exception using errcode = '22023', message = 'final_leg_evidence_must_be_nonpayable_manual_review';
  end if;
  v_attendance_id := (p_plan ->> 'attendanceId')::uuid;
  v_leg_id := (p_plan ->> 'finalLegId')::uuid;
  v_digest := p_plan ->> 'inputDigest';
  v_candidate_km := round((p_plan ->> 'candidateCalculatedKm')::numeric, 2);
  v_source := p_plan ->> 'source';
  v_reference_only := coalesce((p_plan ->> 'referenceOnly')::boolean, false);
  if v_candidate_km <= 0
     or v_source not in ('GPS_BASED','GPS_ROUTE_SUPPORTED','VERIFIED_ROAD_ROUTE','HAVERSINE_REFERENCE')
     or (v_source = 'HAVERSINE_REFERENCE') <> v_reference_only then
    raise exception using errcode = '22023', message = 'final_leg_evidence_source_or_candidate_rejected';
  end if;
  if not pg_try_advisory_xact_lock(hashtextextended(v_attendance_id::text, 0)) then
    raise exception using errcode = '55P03', message = 'final_leg_evidence_already_running';
  end if;
  select * into v_attendance from public.fo_attendance where id = v_attendance_id for update;
  if not found or coalesce(v_attendance.employee_code, v_attendance.fo_user_id, '') <> p_plan ->> 'employeeCode'
     or v_attendance.attendance_date <> (p_plan ->> 'attendanceDate')::date then
    raise exception using errcode = '42501', message = 'final_leg_evidence_database_target_mismatch';
  end if;
  select * into v_leg from public.fo_travel_legs
  where id = v_leg_id and attendance_id = v_attendance_id for update;
  if not found then
    raise exception using errcode = 'P0002', message = 'final_leg_evidence_leg_not_found';
  end if;
  select * into v_existing from public.fo_final_leg_reconciliation_runs
  where attendance_id = v_attendance_id and travel_leg_id = v_leg_id and input_digest = v_digest;
  if found then
    if round(coalesce(v_leg.payable_km,0),2) <> coalesce((v_existing.leg_financials_before->>'payableKm')::numeric,0)
       or round(coalesce(v_attendance.total_approved_km,0),2) <> coalesce((v_existing.attendance_totals_before->>'totalApprovedKm')::numeric,0)
       or round(coalesce(v_attendance.petrol_amount,0),2) <> coalesce((v_existing.attendance_totals_before->>'petrolAmount')::numeric,0) then
      raise exception using errcode = '40001', message = 'final_leg_evidence_idempotent_replay_state_mismatch';
    end if;
    return jsonb_build_object('ok',true,'idempotent_replay',true,
      'reconciliation_run_id',v_existing.id,'attendance_id',v_attendance_id,'final_leg_id',v_leg_id,
      'candidate_calculated_km',v_existing.candidate_calculated_km,'reference_only',v_existing.reference_only,
      'payable_km_changed',false,'attendance_totals_changed',false,'canonical_recalculation_complete',false);
  end if;
  if v_attendance.updated_at is distinct from (p_plan->>'attendanceUpdatedAt')::timestamptz
     or v_leg.updated_at is distinct from (p_plan->>'finalLegUpdatedAt')::timestamptz then
    raise exception using errcode = '40001', message = 'final_leg_evidence_stale_input';
  end if;
  if v_attendance.logout_time is null or lower(coalesce(v_attendance.status,'')) = 'active'
     or coalesce(v_attendance.metadata->>'km_calculation_version','') = 'KM_ENGINE_V2'
     or coalesce(v_leg.canonical_calculated,false) is true
     or lower(coalesce(v_leg.status,'')) <> 'completed' then
    raise exception using errcode = '40001', message = 'final_leg_evidence_not_pending_or_already_canonical';
  end if;
  if v_leg.started_at is distinct from (p_plan->>'startedAt')::timestamptz
     or v_leg.ended_at is distinct from (p_plan->>'endedAt')::timestamptz
     or coalesce(abs(v_leg.start_lat-(p_plan->>'startLat')::numeric),999) > 0.000001
     or coalesce(abs(v_leg.start_lng-(p_plan->>'startLng')::numeric),999) > 0.000001
     or coalesce(abs(v_leg.end_lat-(p_plan->>'endLat')::numeric),999) > 0.000001
     or coalesce(abs(v_leg.end_lng-(p_plan->>'endLng')::numeric),999) > 0.000001
     or round(coalesce(v_leg.calculated_km,0),2) <> round((p_plan->>'existingCalculatedKm')::numeric,2)
     or round(coalesce(v_leg.payable_km,0),2) <> round((p_plan->>'existingPayableKm')::numeric,2)
     or round(coalesce(v_leg.payable_amount,0),2) <> round((p_plan->>'existingPayableAmount')::numeric,2)
     or round(coalesce(v_leg.fare_amount,0),2) <> round((p_plan->>'existingFareAmount')::numeric,2) then
    raise exception using errcode = '40001', message = 'final_leg_evidence_leg_state_mismatch';
  end if;
  select * into v_last_visit from public.fo_site_visits
  where attendance_id=v_attendance_id and check_out_time is not null
  order by check_in_time desc limit 1;
  if not found or abs(extract(epoch from (v_leg.started_at-v_last_visit.check_out_time))) > 1
     or abs(extract(epoch from (v_leg.ended_at-v_attendance.logout_time))) > 1
     or coalesce(abs(v_leg.start_lat-v_last_visit.check_out_latitude),999) > 0.00025
     or coalesce(abs(v_leg.start_lng-v_last_visit.check_out_longitude),999) > 0.00025
     or coalesce(abs(v_leg.end_lat-v_attendance.end_latitude),999) > 0.00025
     or coalesce(abs(v_leg.end_lng-v_attendance.end_longitude),999) > 0.00025 then
    raise exception using errcode = '22023', message = 'final_leg_evidence_boundary_mismatch';
  end if;
  select count(*),round(coalesce(sum(greatest(coalesce(route_km,0),0)),0)::numeric,2)
  into v_visit_count,v_visit_km from public.fo_site_visits where attendance_id=v_attendance_id;
  if v_visit_count <> (p_plan->>'expectedSiteVisitCount')::integer
     or v_visit_km <> round((p_plan->>'expectedSiteVisitRouteKm')::numeric,2)
     or round(coalesce(v_attendance.total_route_km,0),2) <> round((p_plan->>'expectedTotalRouteKm')::numeric,2)
     or round(coalesce(v_attendance.eligible_km,0),2) <> round((p_plan->>'expectedEligibleKm')::numeric,2)
     or round(coalesce(v_attendance.total_approved_km,0),2) <> round((p_plan->>'expectedTotalApprovedKm')::numeric,2)
     or round(coalesce(v_attendance.petrol_amount,0),2) <> round((p_plan->>'expectedPetrolAmount')::numeric,2) then
    raise exception using errcode = '40001', message = 'final_leg_evidence_financial_or_visit_state_mismatch';
  end if;
  insert into public.fo_final_leg_reconciliation_runs(
    id,attendance_id,travel_leg_id,calculation_version,input_digest,candidate_calculated_km,
    source,reference_only,decision,site_visit_count,site_visit_route_km,attendance_totals_before,
    leg_financials_before,source_row_ids,risk_flags,result,actor_source
  ) values (
    v_run_id,v_attendance_id,v_leg_id,'KM_ENGINE_V2_FINAL_LEG_EVIDENCE_V1',v_digest,v_candidate_km,
    v_source,v_reference_only,'MANUAL_REVIEW',v_visit_count,v_visit_km,
    jsonb_build_object('totalRouteKm',(p_plan->>'expectedTotalRouteKm')::numeric,'eligibleKm',(p_plan->>'expectedEligibleKm')::numeric,
      'totalApprovedKm',(p_plan->>'expectedTotalApprovedKm')::numeric,'petrolAmount',(p_plan->>'expectedPetrolAmount')::numeric),
    jsonb_build_object('calculatedKm',(p_plan->>'existingCalculatedKm')::numeric,'payableKm',(p_plan->>'existingPayableKm')::numeric,
      'payableAmount',(p_plan->>'existingPayableAmount')::numeric,'fareAmount',(p_plan->>'existingFareAmount')::numeric),
    coalesce(p_plan->'sourceRowIds','[]'::jsonb),coalesce(p_plan->'riskFlags','[]'::jsonb),
    p_plan||jsonb_build_object('reconciliationRunId',v_run_id,'payableKmChanged',false,
      'attendanceTotalsChanged',false,'travelLegChanged',false,'canonicalRecalculationComplete',false),p_actor_source
  );
  return jsonb_build_object('ok',true,'idempotent_replay',false,'reconciliation_run_id',v_run_id,
    'attendance_id',v_attendance_id,'final_leg_id',v_leg_id,'candidate_calculated_km',v_candidate_km,
    'reference_only',v_reference_only,'payable_km_changed',false,'attendance_totals_changed',false,
    'travel_leg_changed',false,'canonical_recalculation_complete',false);
end
$function$;

create or replace function public.rpc_resolve_fo_final_leg_evidence_v1(
  p_reconciliation_run_id uuid,p_decision text,p_approved_evidence_km numeric,p_review_reason text
)
returns jsonb language plpgsql security definer set search_path=public,pg_temp
as $function$
declare
  v_run public.fo_final_leg_reconciliation_runs%rowtype;
  v_resolution public.fo_final_leg_reconciliation_resolutions%rowtype;
  v_reviewer uuid:=auth.uid();
  v_identity text:=coalesce(auth.jwt()->>'email',auth.jwt()->>'employee_code',v_reviewer::text);
  v_decision text:=upper(trim(coalesce(p_decision,'')));
  v_km numeric:=round(coalesce(p_approved_evidence_km,0),2);
begin
  if v_reviewer is null or not public.is_qpms_admin() then
    raise exception using errcode='42501',message='final_leg_evidence_resolution_admin_required';
  end if;
  if v_decision not in ('APPROVED_EVIDENCE','REJECTED') or nullif(trim(coalesce(p_review_reason,'')),'') is null then
    raise exception using errcode='22023',message='final_leg_evidence_resolution_input_invalid';
  end if;
  select * into v_run from public.fo_final_leg_reconciliation_runs where id=p_reconciliation_run_id for update;
  if not found then raise exception using errcode='P0002',message='final_leg_evidence_resolution_run_not_found'; end if;
  if v_decision='APPROVED_EVIDENCE' and (v_run.reference_only or v_run.source='HAVERSINE_REFERENCE'
     or v_km<=0 or v_km>v_run.candidate_calculated_km) then
    raise exception using errcode='22023',message='final_leg_evidence_resolution_not_approvable';
  end if;
  if v_decision='REJECTED' then v_km:=0; end if;
  insert into public.fo_final_leg_reconciliation_resolutions(
    reconciliation_run_id,attendance_id,travel_leg_id,decision,approved_evidence_km,
    reviewer_user_id,reviewer_identity,review_reason
  ) values (v_run.id,v_run.attendance_id,v_run.travel_leg_id,v_decision,v_km,v_reviewer,v_identity,trim(p_review_reason))
  on conflict(reconciliation_run_id) do nothing returning * into v_resolution;
  if not found then
    select * into v_resolution from public.fo_final_leg_reconciliation_resolutions where reconciliation_run_id=v_run.id;
    if v_resolution.decision<>v_decision or v_resolution.approved_evidence_km<>v_km then
      raise exception using errcode='40001',message='final_leg_evidence_resolution_already_recorded';
    end if;
  end if;
  return jsonb_build_object('ok',true,'resolution_id',v_resolution.id,'decision',v_resolution.decision,
    'approved_evidence_km',v_resolution.approved_evidence_km,'financially_approved',false);
end
$function$;

create or replace function public.rpc_apply_fo_final_leg_financial_v1(
  p_attendance_id uuid,p_final_leg_id uuid,p_reconciliation_run_id uuid,p_input_digest text,
  p_expected_evidence_input_digest text,p_expected_attendance_updated_at timestamptz,p_expected_leg_updated_at timestamptz,
  p_expected_before_total_route_km numeric,p_expected_before_eligible_km numeric,p_expected_before_total_approved_km numeric,
  p_expected_before_petrol_amount numeric,p_expected_leg_calculated_km numeric,p_expected_leg_payable_km numeric,
  p_expected_leg_payable_amount numeric,p_expected_leg_fare_amount numeric,p_approved_final_leg_km numeric,
  p_approved_rate_per_km numeric,p_approved_payable_amount numeric,p_rate_policy text,p_actor_source text default null
)
returns jsonb language plpgsql security definer set search_path=public,pg_temp set lock_timeout='2s' set statement_timeout='15s'
as $function$
declare
  v_attendance public.fo_attendance%rowtype; v_leg public.fo_travel_legs%rowtype;
  v_evidence public.fo_final_leg_reconciliation_runs%rowtype; v_resolution public.fo_final_leg_reconciliation_resolutions%rowtype;
  v_approval public.fo_km_financial_approvals%rowtype; v_existing public.fo_final_leg_financial_applies%rowtype;
  v_apply_id uuid:=gen_random_uuid(); v_count integer; v_visit_km numeric; v_snapshot jsonb; v_snapshot_after jsonb;
  v_km numeric:=round(coalesce(p_approved_final_leg_km,0),2); v_rate numeric:=round(coalesce(p_approved_rate_per_km,0),2);
  v_amount numeric:=round(coalesce(p_approved_payable_amount,0),2);
  v_br numeric:=round(coalesce(p_expected_before_total_route_km,-1),2); v_be numeric:=round(coalesce(p_expected_before_eligible_km,-1),2);
  v_ba numeric:=round(coalesce(p_expected_before_total_approved_km,-1),2); v_bp numeric:=round(coalesce(p_expected_before_petrol_amount,-1),2);
  v_ar numeric; v_ae numeric; v_aa numeric; v_ap numeric;
begin
  if coalesce(p_input_digest,'')!~'^[0-9a-f]{64}$' or coalesce(p_expected_evidence_input_digest,'')!~'^[0-9a-f]{64}$'
     or p_reconciliation_run_id is null or p_expected_attendance_updated_at is null or p_expected_leg_updated_at is null
     or nullif(trim(coalesce(p_rate_policy,'')),'') is null or v_km<=0 or v_rate<=0 or v_amount<>round(v_km*v_rate,2) then
    raise exception using errcode='22023',message='final_leg_financial_input_invalid';
  end if;
  if round(coalesce(p_expected_leg_calculated_km,-1),2)<>0 or round(coalesce(p_expected_leg_payable_km,-1),2)<>0
     or round(coalesce(p_expected_leg_payable_amount,-1),2)<>0 or round(coalesce(p_expected_leg_fare_amount,-1),2)<>0 then
    raise exception using errcode='40001',message='final_leg_financial_expected_zero_leg_state_required';
  end if;
  if not pg_try_advisory_xact_lock(hashtextextended(p_attendance_id::text,0)) then
    raise exception using errcode='55P03',message='final_leg_financial_already_running';
  end if;
  select * into v_attendance from public.fo_attendance where id=p_attendance_id for update;
  if not found then raise exception using errcode='P0002',message='final_leg_financial_attendance_not_found'; end if;
  select * into v_leg from public.fo_travel_legs where id=p_final_leg_id and attendance_id=p_attendance_id for update;
  if not found then raise exception using errcode='P0002',message='final_leg_financial_leg_not_found'; end if;
  select * into v_existing from public.fo_final_leg_financial_applies where attendance_id=p_attendance_id and travel_leg_id=p_final_leg_id;
  if found then
    if v_existing.input_digest<>p_input_digest or round(coalesce(v_leg.payable_km,0),2)<>v_existing.approved_final_leg_km
       or round(coalesce(v_attendance.total_approved_km,0),2)<>(v_existing.attendance_financials_after->>'totalApprovedKm')::numeric
       or round(coalesce(v_attendance.petrol_amount,0),2)<>(v_existing.attendance_financials_after->>'petrolAmount')::numeric then
      raise exception using errcode='40001',message='final_leg_financial_already_applied_state_mismatch';
    end if;
    return jsonb_build_object('ok',true,'idempotent_replay',true,'final_leg_apply_id',v_existing.id,
      'attendance_id',p_attendance_id,'final_leg_id',p_final_leg_id,'final_leg_km',v_existing.approved_final_leg_km,
      'payable_amount',v_existing.approved_payable_amount,'reconciliation_status',v_existing.reconciliation_status,
      'canonical_recalculation_complete',false);
  end if;
  if not exists(select 1 from public.fo_km_financial_control where control_key='canonical_v2'
    and financial_writes_enabled is true for share) then
    raise exception using errcode='55000',message='km_v2_database_financial_writes_closed';
  end if;
  if exists(select 1 from public.fo_travel_reimbursement_corrections where attendance_id=p_attendance_id and status='applied') then
    raise exception using errcode='55000',message='final_leg_existing_correction_manual_review';
  end if;
  if exists(select 1 from public.fo_monthly_travel_settlements
    where upper(employee_code)=upper(coalesce(v_attendance.employee_code,v_attendance.fo_user_id,''))
      and period_start<=v_attendance.attendance_date and period_end>=v_attendance.attendance_date) then
    raise exception using errcode='55000',message='final_leg_existing_settlement_manual_review';
  end if;
  if v_attendance.updated_at is distinct from p_expected_attendance_updated_at or v_leg.updated_at is distinct from p_expected_leg_updated_at then
    raise exception using errcode='40001',message='final_leg_financial_stale_input';
  end if;
  if lower(coalesce(v_attendance.status,''))='active' or v_attendance.logout_time is null
     or coalesce(v_attendance.metadata->>'km_calculation_version','')='KM_ENGINE_V2'
     or coalesce(v_leg.canonical_calculated,false) is true or lower(coalesce(v_leg.status,''))<>'completed' then
    raise exception using errcode='40001',message='final_leg_financial_state_not_eligible';
  end if;
  if round(coalesce(v_attendance.total_route_km,0),2)<>v_br or round(coalesce(v_attendance.eligible_km,0),2)<>v_be
     or round(coalesce(v_attendance.total_approved_km,0),2)<>v_ba or round(coalesce(v_attendance.petrol_amount,0),2)<>v_bp
     or round(coalesce(v_leg.calculated_km,0),2)<>round(p_expected_leg_calculated_km,2)
     or round(coalesce(v_leg.payable_km,0),2)<>round(p_expected_leg_payable_km,2)
     or round(coalesce(v_leg.payable_amount,0),2)<>round(p_expected_leg_payable_amount,2)
     or round(coalesce(v_leg.fare_amount,0),2)<>round(p_expected_leg_fare_amount,2) then
    raise exception using errcode='40001',message='final_leg_financial_before_state_mismatch';
  end if;
  perform 1 from public.fo_site_visits where attendance_id=p_attendance_id for update;
  select count(*),round(coalesce(sum(greatest(coalesce(route_km,0),0)),0)::numeric,2),
    coalesce(jsonb_agg(jsonb_build_object('id',id,'routeKm',route_km) order by id),'[]'::jsonb)
  into v_count,v_visit_km,v_snapshot from public.fo_site_visits where attendance_id=p_attendance_id;
  select * into v_evidence from public.fo_final_leg_reconciliation_runs
  where id=p_reconciliation_run_id and attendance_id=p_attendance_id and travel_leg_id=p_final_leg_id for update;
  if not found or v_evidence.input_digest<>p_expected_evidence_input_digest or v_evidence.reference_only
     or v_evidence.source='HAVERSINE_REFERENCE' or v_evidence.site_visit_count<>v_count or v_evidence.site_visit_route_km<>v_visit_km then
    raise exception using errcode='40001',message='final_leg_financial_evidence_or_site_visit_mismatch';
  end if;
  select * into v_resolution from public.fo_final_leg_reconciliation_resolutions where reconciliation_run_id=v_evidence.id for update;
  if not found or v_resolution.decision<>'APPROVED_EVIDENCE' or v_resolution.approved_evidence_km<>v_km
     or v_km>v_evidence.candidate_calculated_km then
    raise exception using errcode='55000',message='final_leg_financial_evidence_not_approved';
  end if;
  v_ar:=round(v_br+v_km,2); v_ae:=round(v_be+v_km,2); v_aa:=round(v_ba+v_km,2); v_ap:=round(v_bp+v_amount,2);
  select a.* into v_approval from public.fo_km_financial_approvals a
  where a.attendance_id=p_attendance_id and a.input_digest=p_input_digest
    and a.expected_attendance_updated_at=p_expected_attendance_updated_at
    and a.before_total_route_km=v_br and a.before_eligible_km=v_be and a.before_total_approved_km=v_ba and a.before_petrol_amount=v_bp
    and a.after_total_route_km=v_ar and a.after_eligible_km=v_ae and a.after_total_approved_km=v_aa and a.after_petrol_amount=v_ap
    and not exists(select 1 from public.fo_km_financial_approval_consumptions c where c.approval_id=a.id) for update of a;
  if not found then raise exception using errcode='55000',message='km_v2_financial_approval_required'; end if;
  perform set_config('app.km_v2_authorized_financial_write','true',true);
  update public.fo_travel_legs set calculated_km=v_km,payable_km=v_km,rate_per_km=v_rate,payable_amount=v_amount,
    payable_km_allowed=true,calculation_version='KM_ENGINE_V2_FINAL_LEG_ONLY_V2',calculation_run_id=null,
    canonical_calculated=false,updated_at=now() where id=p_final_leg_id and attendance_id=p_attendance_id;
  update public.fo_attendance set total_route_km=v_ar,eligible_km=v_ae,total_approved_km=v_aa,petrol_amount=v_ap,
    route_sync_status='final_leg_reconciled_pending_canonical_v2',metadata=coalesce(metadata,'{}'::jsonb)||jsonb_build_object(
      'final_leg_reconciliation_status','FINAL_LEG_FINANCIALLY_APPLIED_CANONICAL_PENDING',
      'final_leg_reconciliation_input_digest',p_input_digest,'final_leg_reconciliation_run_id',p_reconciliation_run_id,
      'canonical_recalculation_pending',true,'canonical_recalculation_complete',false),updated_at=now() where id=p_attendance_id;
  select coalesce(jsonb_agg(jsonb_build_object('id',id,'routeKm',route_km) order by id),'[]'::jsonb)
  into v_snapshot_after from public.fo_site_visits where attendance_id=p_attendance_id;
  if v_snapshot_after is distinct from v_snapshot then
    raise exception using errcode='40001',message='final_leg_financial_site_visit_snapshot_changed';
  end if;
  insert into public.fo_final_leg_financial_applies(id,attendance_id,travel_leg_id,reconciliation_run_id,resolution_id,
    approval_id,input_digest,evidence_input_digest,approved_final_leg_km,approved_rate_per_km,approved_payable_amount,rate_policy,
    attendance_financials_before,attendance_financials_after,leg_financials_before,leg_financials_after,
    site_visit_route_snapshot,reconciliation_status,actor_source)
  values(v_apply_id,p_attendance_id,p_final_leg_id,v_evidence.id,v_resolution.id,v_approval.id,p_input_digest,
    p_expected_evidence_input_digest,v_km,v_rate,v_amount,trim(p_rate_policy),
    jsonb_build_object('totalRouteKm',v_br,'eligibleKm',v_be,'totalApprovedKm',v_ba,'petrolAmount',v_bp),
    jsonb_build_object('totalRouteKm',v_ar,'eligibleKm',v_ae,'totalApprovedKm',v_aa,'petrolAmount',v_ap),
    jsonb_build_object('calculatedKm',p_expected_leg_calculated_km,'payableKm',p_expected_leg_payable_km,
      'payableAmount',p_expected_leg_payable_amount,'fareAmount',p_expected_leg_fare_amount),
    jsonb_build_object('calculatedKm',v_km,'payableKm',v_km,'ratePerKm',v_rate,'payableAmount',v_amount,'fareAmount',p_expected_leg_fare_amount),
    v_snapshot,'FINAL_LEG_FINANCIALLY_APPLIED_CANONICAL_PENDING',p_actor_source);
  insert into public.fo_km_financial_approval_consumptions(approval_id,attendance_id,calculation_run_id,input_digest,final_leg_apply_id)
  values(v_approval.id,p_attendance_id,null,p_input_digest,v_apply_id);
  return jsonb_build_object('ok',true,'idempotent_replay',false,'final_leg_apply_id',v_apply_id,
    'attendance_id',p_attendance_id,'final_leg_id',p_final_leg_id,'final_leg_km',v_km,'payable_amount',v_amount,
    'total_route_km',v_ar,'total_approved_km',v_aa,'petrol_amount',v_ap,
    'reconciliation_status','FINAL_LEG_FINANCIALLY_APPLIED_CANONICAL_PENDING','canonical_recalculation_complete',false);
end
$function$;

alter function public.rpc_record_fo_final_leg_evidence_v1(jsonb,text) owner to postgres;
alter function public.rpc_resolve_fo_final_leg_evidence_v1(uuid,text,numeric,text) owner to postgres;
alter function public.rpc_apply_fo_final_leg_financial_v1(uuid,uuid,uuid,text,text,timestamptz,timestamptz,numeric,numeric,numeric,numeric,numeric,numeric,numeric,numeric,numeric,numeric,numeric,text,text) owner to postgres;
revoke all on function public.rpc_record_fo_final_leg_evidence_v1(jsonb,text) from public,anon,authenticated;
grant execute on function public.rpc_record_fo_final_leg_evidence_v1(jsonb,text) to service_role;
revoke all on function public.rpc_resolve_fo_final_leg_evidence_v1(uuid,text,numeric,text) from public,anon,service_role;
grant execute on function public.rpc_resolve_fo_final_leg_evidence_v1(uuid,text,numeric,text) to authenticated;
revoke all on function public.rpc_apply_fo_final_leg_financial_v1(uuid,uuid,uuid,text,text,timestamptz,timestamptz,numeric,numeric,numeric,numeric,numeric,numeric,numeric,numeric,numeric,numeric,numeric,text,text) from public,anon,authenticated;
grant execute on function public.rpc_apply_fo_final_leg_financial_v1(uuid,uuid,uuid,text,text,timestamptz,timestamptz,numeric,numeric,numeric,numeric,numeric,numeric,numeric,numeric,numeric,numeric,numeric,text,text) to service_role;

comment on function public.rpc_record_fo_final_leg_evidence_v1(jsonb,text) is
  'Records immutable nonpayable final-leg evidence for database-validated completed attendances; concurrent duplicates fail fast.';
comment on function public.rpc_apply_fo_final_leg_financial_v1(uuid,uuid,uuid,text,text,timestamptz,timestamptz,numeric,numeric,numeric,numeric,numeric,numeric,numeric,numeric,numeric,numeric,numeric,text,text) is
  'Applies one separately reviewed and financially approved final-leg delta, preserving site visits and rejecting prior correction-ledger rows.';

commit;
