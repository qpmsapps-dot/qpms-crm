-- 205: Isolated final Check-Out -> End Day evidence, review and guarded apply.
-- Depends on guarded Migration 200. Evidence operations are nonfinancial. The
-- 7/8 October evidence operations are nonfinancial. The 7 October-only
-- financial RPC requires both evidence and financial approval.

begin;

do $preflight$
begin
  if to_regclass('public.fo_km_calculation_runs') is null
     or to_regclass('public.fo_km_financial_control') is null
     or to_regclass('public.fo_km_financial_approvals') is null
     or to_regclass('public.fo_km_financial_approval_consumptions') is null
     or to_regprocedure('public.trg_reject_fo_km_audit_mutation()') is null
     or to_regprocedure('public.rpc_persist_fo_canonical_km_v2(uuid,text,timestamp with time zone,jsonb,text,text)') is null then
    raise exception 'Final-leg evidence preflight failed: guarded Migration 200 canonical V2 prerequisites are missing';
  end if;
  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'fo_travel_legs'
      and column_name = 'calculation_version'
  ) then
    raise exception 'Final-leg evidence preflight failed: fo_travel_legs.calculation_version is missing';
  end if;
  if coalesce((
    select financial_writes_enabled from public.fo_km_financial_control
    where control_key = 'canonical_v2'
  ), true) is true then
    raise exception 'Final-leg evidence preflight failed: canonical financial gate must remain closed';
  end if;
end
$preflight$;

create table if not exists public.fo_final_leg_reconciliation_runs (
  id uuid primary key default gen_random_uuid(),
  attendance_id uuid not null references public.fo_attendance(id) on delete restrict,
  travel_leg_id uuid not null references public.fo_travel_legs(id) on delete restrict,
  calculation_version text not null,
  input_digest text not null,
  candidate_calculated_km numeric(14,2) not null,
  source text not null,
  reference_only boolean not null default false,
  decision text not null,
  site_visit_count integer not null,
  site_visit_route_km numeric(14,2) not null,
  attendance_totals_before jsonb not null,
  leg_financials_before jsonb not null,
  source_row_ids jsonb not null default '[]'::jsonb,
  risk_flags jsonb not null default '[]'::jsonb,
  result jsonb not null,
  actor_source text,
  created_at timestamptz not null default now(),
  constraint fo_final_leg_reconciliation_version_check
    check (calculation_version = 'KM_ENGINE_V2_FINAL_LEG_EVIDENCE_V1'),
  constraint fo_final_leg_reconciliation_digest_check
    check (input_digest ~ '^[0-9a-f]{64}$'),
  constraint fo_final_leg_reconciliation_candidate_check
    check (candidate_calculated_km > 0),
  constraint fo_final_leg_reconciliation_source_check
    check (source in ('GPS_BASED', 'GPS_ROUTE_SUPPORTED', 'VERIFIED_ROAD_ROUTE', 'HAVERSINE_REFERENCE')),
  constraint fo_final_leg_reconciliation_reference_check check (
    (source = 'HAVERSINE_REFERENCE' and reference_only is true)
    or (source <> 'HAVERSINE_REFERENCE' and reference_only is false)
  ),
  constraint fo_final_leg_reconciliation_decision_check
    check (decision = 'MANUAL_REVIEW'),
  constraint fo_final_leg_reconciliation_nonnegative_check
    check (site_visit_count >= 0 and site_visit_route_km >= 0),
  constraint fo_final_leg_reconciliation_json_check
    check (
      jsonb_typeof(attendance_totals_before) = 'object'
      and jsonb_typeof(leg_financials_before) = 'object'
      and jsonb_typeof(source_row_ids) = 'array'
      and jsonb_typeof(risk_flags) = 'array'
      and jsonb_typeof(result) = 'object'
    ),
  constraint fo_final_leg_reconciliation_idempotency_key
    unique (attendance_id, travel_leg_id, input_digest)
);

create table if not exists public.fo_final_leg_reconciliation_resolutions (
  id uuid primary key default gen_random_uuid(),
  reconciliation_run_id uuid not null unique
    references public.fo_final_leg_reconciliation_runs(id) on delete restrict,
  attendance_id uuid not null references public.fo_attendance(id) on delete restrict,
  travel_leg_id uuid not null references public.fo_travel_legs(id) on delete restrict,
  decision text not null check (decision in ('APPROVED_EVIDENCE', 'REJECTED')),
  approved_evidence_km numeric(14,2) not null default 0,
  reviewer_user_id uuid not null,
  reviewer_identity text not null,
  review_reason text not null,
  reviewed_at timestamptz not null default now(),
  constraint fo_final_leg_resolution_km_check check (
    (decision = 'APPROVED_EVIDENCE' and approved_evidence_km > 0)
    or (decision = 'REJECTED' and approved_evidence_km = 0)
  )
);

create table if not exists public.fo_final_leg_financial_applies (
  id uuid primary key default gen_random_uuid(),
  attendance_id uuid not null references public.fo_attendance(id) on delete restrict,
  travel_leg_id uuid not null references public.fo_travel_legs(id) on delete restrict,
  reconciliation_run_id uuid not null references public.fo_final_leg_reconciliation_runs(id) on delete restrict,
  resolution_id uuid not null references public.fo_final_leg_reconciliation_resolutions(id) on delete restrict,
  approval_id uuid not null unique references public.fo_km_financial_approvals(id) on delete restrict,
  input_digest text not null,
  evidence_input_digest text not null,
  approved_final_leg_km numeric(14,2) not null,
  approved_rate_per_km numeric(14,2) not null,
  approved_payable_amount numeric(14,2) not null,
  rate_policy text not null,
  attendance_financials_before jsonb not null,
  attendance_financials_after jsonb not null,
  leg_financials_before jsonb not null,
  leg_financials_after jsonb not null,
  site_visit_route_snapshot jsonb not null,
  reconciliation_status text not null,
  actor_source text,
  created_at timestamptz not null default now(),
  constraint fo_final_leg_financial_apply_target_key unique (attendance_id, travel_leg_id),
  constraint fo_final_leg_financial_apply_digest_key unique (attendance_id, input_digest),
  constraint fo_final_leg_financial_apply_digest_check check (
    input_digest ~ '^[0-9a-f]{64}$' and evidence_input_digest ~ '^[0-9a-f]{64}$'
  ),
  constraint fo_final_leg_financial_apply_values_check check (
    approved_final_leg_km > 0 and approved_rate_per_km > 0 and approved_payable_amount > 0
  ),
  constraint fo_final_leg_financial_apply_status_check check (
    reconciliation_status = 'FINAL_LEG_FINANCIALLY_APPLIED_CANONICAL_PENDING'
  ),
  constraint fo_final_leg_financial_apply_json_check check (
    jsonb_typeof(attendance_financials_before) = 'object'
    and jsonb_typeof(attendance_financials_after) = 'object'
    and jsonb_typeof(leg_financials_before) = 'object'
    and jsonb_typeof(leg_financials_after) = 'object'
    and jsonb_typeof(site_visit_route_snapshot) = 'array'
  )
);

alter table public.fo_km_financial_approval_consumptions
  add column if not exists final_leg_apply_id uuid;
alter table public.fo_km_financial_approval_consumptions
  alter column calculation_run_id drop not null;

do $consumption_contract$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'fo_km_financial_consumption_final_leg_apply_fk'
  ) then
    alter table public.fo_km_financial_approval_consumptions
      add constraint fo_km_financial_consumption_final_leg_apply_fk
      foreign key (final_leg_apply_id)
      references public.fo_final_leg_financial_applies(id) on delete restrict;
  end if;
  if not exists (
    select 1 from pg_constraint
    where conname = 'fo_km_financial_consumption_one_apply_check'
  ) then
    alter table public.fo_km_financial_approval_consumptions
      add constraint fo_km_financial_consumption_one_apply_check
      check (num_nonnulls(calculation_run_id, final_leg_apply_id) = 1);
  end if;
end
$consumption_contract$;

create index if not exists idx_fo_final_leg_reconciliation_attendance_created
  on public.fo_final_leg_reconciliation_runs(attendance_id, created_at desc);

alter table public.fo_final_leg_reconciliation_runs enable row level security;
alter table public.fo_final_leg_reconciliation_resolutions enable row level security;
alter table public.fo_final_leg_financial_applies enable row level security;
revoke all on table public.fo_final_leg_reconciliation_runs from public, anon, authenticated;
revoke all on table public.fo_final_leg_reconciliation_resolutions from public, anon, authenticated, service_role;
revoke all on table public.fo_final_leg_financial_applies from public, anon, authenticated, service_role;
grant select on table public.fo_final_leg_reconciliation_runs to service_role;
grant select on table public.fo_final_leg_reconciliation_resolutions to service_role;
grant select on table public.fo_final_leg_financial_applies to service_role;

drop policy if exists "fo_final_leg_reconciliation_service_role" on public.fo_final_leg_reconciliation_runs;
create policy "fo_final_leg_reconciliation_service_role"
  on public.fo_final_leg_reconciliation_runs
  for select
  to service_role
  using (true);

drop trigger if exists trg_immutable_fo_final_leg_reconciliation_runs
  on public.fo_final_leg_reconciliation_runs;
create trigger trg_immutable_fo_final_leg_reconciliation_runs
before update or delete on public.fo_final_leg_reconciliation_runs
for each row execute function public.trg_reject_fo_km_audit_mutation();

drop trigger if exists trg_immutable_fo_final_leg_reconciliation_resolutions
  on public.fo_final_leg_reconciliation_resolutions;
create trigger trg_immutable_fo_final_leg_reconciliation_resolutions
before update or delete on public.fo_final_leg_reconciliation_resolutions
for each row execute function public.trg_reject_fo_km_audit_mutation();

drop trigger if exists trg_immutable_fo_final_leg_financial_applies
  on public.fo_final_leg_financial_applies;
create trigger trg_immutable_fo_final_leg_financial_applies
before update or delete on public.fo_final_leg_financial_applies
for each row execute function public.trg_reject_fo_km_audit_mutation();

create or replace function public.rpc_record_fo_final_leg_evidence_v1(
  p_plan jsonb,
  p_actor_source text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
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
  v_site_visit_count integer;
  v_site_visit_route_km numeric;
  v_source text;
  v_reference_only boolean;
  v_expected_attendance_updated_at timestamptz;
  v_expected_leg_updated_at timestamptz;
  v_expected_total_route_km numeric;
  v_expected_eligible_km numeric;
  v_expected_total_approved_km numeric;
  v_expected_petrol_amount numeric;
begin
  if p_plan is null or jsonb_typeof(p_plan) <> 'object' then
    raise exception using errcode = '22023', message = 'final_leg_evidence_plan_required';
  end if;
  if coalesce(p_plan ->> 'calculationVersion', '') <> 'KM_ENGINE_V2_FINAL_LEG_EVIDENCE_V1'
     or coalesce(p_plan ->> 'inputDigest', '') !~ '^[0-9a-f]{64}$' then
    raise exception using errcode = '22023', message = 'final_leg_evidence_invalid_version_or_digest';
  end if;
  if not (
    (
      (p_plan ->> 'attendanceId')::uuid = 'a8d170e6-cbb4-4788-928d-6eb9999d51e2'::uuid
      and (p_plan ->> 'finalLegId')::uuid = '48991354-ca06-4856-9931-8f95e6bb932e'::uuid
      and coalesce(p_plan ->> 'employeeCode', '') = 'QPMSTNC17015'
      and (p_plan ->> 'attendanceDate')::date = date '2026-10-07'
    )
    or (
      (p_plan ->> 'attendanceId')::uuid = 'd299f0c4-9af7-4f0c-b8cc-86e5b7fb1f91'::uuid
      and (p_plan ->> 'finalLegId')::uuid = '850bc41b-e492-4661-9f5e-05aaafb19d0c'::uuid
      and coalesce(p_plan ->> 'employeeCode', '') = 'QPMSTNC17015'
      and (p_plan ->> 'attendanceDate')::date = date '2026-10-08'
    )
  ) then
    raise exception using errcode = '42501', message = 'final_leg_evidence_target_not_authorized';
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
  v_expected_attendance_updated_at := (p_plan ->> 'attendanceUpdatedAt')::timestamptz;
  v_expected_leg_updated_at := (p_plan ->> 'finalLegUpdatedAt')::timestamptz;
  v_expected_total_route_km := round((p_plan ->> 'expectedTotalRouteKm')::numeric, 2);
  v_expected_eligible_km := round((p_plan ->> 'expectedEligibleKm')::numeric, 2);
  v_expected_total_approved_km := round((p_plan ->> 'expectedTotalApprovedKm')::numeric, 2);
  v_expected_petrol_amount := round((p_plan ->> 'expectedPetrolAmount')::numeric, 2);

  if v_candidate_km <= 0
     or v_source not in ('GPS_BASED', 'GPS_ROUTE_SUPPORTED', 'VERIFIED_ROAD_ROUTE', 'HAVERSINE_REFERENCE')
     or (v_source = 'HAVERSINE_REFERENCE') <> v_reference_only then
    raise exception using errcode = '22023', message = 'final_leg_evidence_source_or_candidate_rejected';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(v_attendance_id::text, 0));

  select * into v_attendance from public.fo_attendance
  where id = v_attendance_id for update;
  if not found then
    raise exception using errcode = 'P0002', message = 'final_leg_evidence_attendance_not_found';
  end if;
  if v_attendance.id <> v_attendance_id
     or coalesce(v_attendance.employee_code, v_attendance.fo_user_id, '') <> coalesce(p_plan ->> 'employeeCode', '')
     or v_attendance.attendance_date <> (p_plan ->> 'attendanceDate')::date then
    raise exception using errcode = '42501', message = 'final_leg_evidence_database_target_mismatch';
  end if;

  select * into v_leg from public.fo_travel_legs
  where id = v_leg_id and attendance_id = v_attendance_id for update;
  if not found then
    raise exception using errcode = 'P0002', message = 'final_leg_evidence_leg_not_found';
  end if;
  if v_leg.id <> v_leg_id then
    raise exception using errcode = '42501', message = 'final_leg_evidence_database_leg_mismatch';
  end if;

  select * into v_existing from public.fo_final_leg_reconciliation_runs
  where attendance_id = v_attendance_id and travel_leg_id = v_leg_id and input_digest = v_digest;
  if found then
    if round(coalesce(v_leg.calculated_km, 0), 2) <> coalesce((v_existing.leg_financials_before ->> 'calculatedKm')::numeric, 0)
       or round(coalesce(v_leg.payable_km, 0), 2) <> coalesce((v_existing.leg_financials_before ->> 'payableKm')::numeric, 0)
       or round(coalesce(v_attendance.total_route_km, 0), 2) <> coalesce((v_existing.attendance_totals_before ->> 'totalRouteKm')::numeric, 0)
       or round(coalesce(v_attendance.eligible_km, 0), 2) <> coalesce((v_existing.attendance_totals_before ->> 'eligibleKm')::numeric, 0)
       or round(coalesce(v_attendance.total_approved_km, 0), 2) <> coalesce((v_existing.attendance_totals_before ->> 'totalApprovedKm')::numeric, 0)
       or round(coalesce(v_attendance.petrol_amount, 0), 2) <> coalesce((v_existing.attendance_totals_before ->> 'petrolAmount')::numeric, 0) then
      raise exception using errcode = '40001', message = 'final_leg_evidence_idempotent_replay_state_mismatch';
    end if;
    return jsonb_build_object(
      'ok', true, 'idempotent_replay', true, 'reconciliation_run_id', v_existing.id,
      'attendance_id', v_attendance_id, 'final_leg_id', v_leg_id,
      'candidate_calculated_km', v_existing.candidate_calculated_km,
      'reference_only', v_existing.reference_only,
      'payable_km_changed', false, 'attendance_totals_changed', false,
      'canonical_recalculation_complete', false
    );
  end if;

  if v_expected_attendance_updated_at is null or v_attendance.updated_at is distinct from v_expected_attendance_updated_at
     or v_expected_leg_updated_at is null or v_leg.updated_at is distinct from v_expected_leg_updated_at then
    raise exception using errcode = '40001', message = 'final_leg_evidence_stale_input';
  end if;
  if coalesce(v_attendance.route_sync_status, '') <> 'pending_canonical_end_day_recalculation'
     or coalesce(v_attendance.metadata ->> 'canonical_recalculation_pending', 'false') <> 'true'
     or coalesce(v_attendance.metadata ->> 'km_calculation_version', '') = 'KM_ENGINE_V2'
     or coalesce(v_leg.canonical_calculated, false) is true then
    raise exception using errcode = '40001', message = 'final_leg_evidence_not_pending_or_already_canonical';
  end if;
  if coalesce(v_attendance.employee_code, v_attendance.fo_user_id, '') <> coalesce(p_plan ->> 'employeeCode', '')
     or v_attendance.attendance_date::text <> coalesce(p_plan ->> 'attendanceDate', '') then
    raise exception using errcode = '22023', message = 'final_leg_evidence_employee_or_date_mismatch';
  end if;
  if lower(coalesce(v_leg.status, '')) <> 'completed'
     or v_leg.started_at is distinct from (p_plan ->> 'startedAt')::timestamptz
     or v_leg.ended_at is distinct from (p_plan ->> 'endedAt')::timestamptz
     or coalesce(abs(v_leg.start_lat - (p_plan ->> 'startLat')::numeric), 999) > 0.000001
     or coalesce(abs(v_leg.start_lng - (p_plan ->> 'startLng')::numeric), 999) > 0.000001
     or coalesce(abs(v_leg.end_lat - (p_plan ->> 'endLat')::numeric), 999) > 0.000001
     or coalesce(abs(v_leg.end_lng - (p_plan ->> 'endLng')::numeric), 999) > 0.000001
     or round(coalesce(v_leg.calculated_km, 0), 2) <> round((p_plan ->> 'existingCalculatedKm')::numeric, 2)
     or round(coalesce(v_leg.payable_km, 0), 2) <> round((p_plan ->> 'existingPayableKm')::numeric, 2)
     or round(coalesce(v_leg.payable_amount, 0), 2) <> round((p_plan ->> 'existingPayableAmount')::numeric, 2)
     or round(coalesce(v_leg.fare_amount, 0), 2) <> round((p_plan ->> 'existingFareAmount')::numeric, 2) then
    raise exception using errcode = '40001', message = 'final_leg_evidence_leg_state_mismatch';
  end if;

  select * into v_last_visit from public.fo_site_visits
  where attendance_id = v_attendance_id and check_out_time is not null
  order by check_in_time desc limit 1;
  if not found
     or abs(extract(epoch from (v_leg.started_at - v_last_visit.check_out_time))) > 1
     or abs(extract(epoch from (v_leg.ended_at - v_attendance.logout_time))) > 1
     or coalesce(abs(v_leg.start_lat - v_last_visit.check_out_latitude), 999) > 0.00025
     or coalesce(abs(v_leg.start_lng - v_last_visit.check_out_longitude), 999) > 0.00025
     or coalesce(abs(v_leg.end_lat - v_attendance.end_latitude), 999) > 0.00025
     or coalesce(abs(v_leg.end_lng - v_attendance.end_longitude), 999) > 0.00025 then
    raise exception using errcode = '22023', message = 'final_leg_evidence_boundary_mismatch';
  end if;

  select count(*), round(coalesce(sum(greatest(coalesce(route_km, 0), 0)), 0)::numeric, 2)
  into v_site_visit_count, v_site_visit_route_km
  from public.fo_site_visits where attendance_id = v_attendance_id;
  if v_site_visit_count <> (p_plan ->> 'expectedSiteVisitCount')::integer
     or v_site_visit_route_km <> round((p_plan ->> 'expectedSiteVisitRouteKm')::numeric, 2) then
    raise exception using errcode = '40001', message = 'final_leg_evidence_site_visit_state_mismatch';
  end if;
  if round(coalesce(v_attendance.total_route_km, 0), 2) <> v_expected_total_route_km
     or round(coalesce(v_attendance.eligible_km, 0), 2) <> v_expected_eligible_km
     or round(coalesce(v_attendance.total_approved_km, 0), 2) <> v_expected_total_approved_km
     or round(coalesce(v_attendance.petrol_amount, 0), 2) <> v_expected_petrol_amount then
    raise exception using errcode = '40001', message = 'final_leg_evidence_attendance_financial_state_mismatch';
  end if;

  insert into public.fo_final_leg_reconciliation_runs (
    id, attendance_id, travel_leg_id, calculation_version, input_digest,
    candidate_calculated_km, source, reference_only, decision, site_visit_count, site_visit_route_km,
    attendance_totals_before, leg_financials_before, source_row_ids, risk_flags,
    result, actor_source
  ) values (
    v_run_id, v_attendance_id, v_leg_id, 'KM_ENGINE_V2_FINAL_LEG_EVIDENCE_V1', v_digest,
    v_candidate_km, v_source, v_reference_only, 'MANUAL_REVIEW', v_site_visit_count, v_site_visit_route_km,
    jsonb_build_object(
      'totalRouteKm', v_expected_total_route_km,
      'eligibleKm', v_expected_eligible_km,
      'totalApprovedKm', v_expected_total_approved_km,
      'petrolAmount', v_expected_petrol_amount
    ),
    jsonb_build_object(
      'calculatedKm', (p_plan ->> 'existingCalculatedKm')::numeric,
      'payableKm', (p_plan ->> 'existingPayableKm')::numeric,
      'payableAmount', (p_plan ->> 'existingPayableAmount')::numeric,
      'fareAmount', (p_plan ->> 'existingFareAmount')::numeric
    ),
    coalesce(p_plan -> 'sourceRowIds', '[]'::jsonb),
    coalesce(p_plan -> 'riskFlags', '[]'::jsonb),
    p_plan || jsonb_build_object(
      'reconciliationRunId', v_run_id,
      'referenceOnly', v_reference_only,
      'payableKmChanged', false,
      'attendanceTotalsChanged', false,
      'travelLegChanged', false,
      'canonicalRecalculationComplete', false
    ),
    p_actor_source
  );

  return jsonb_build_object(
    'ok', true, 'idempotent_replay', false, 'reconciliation_run_id', v_run_id,
    'attendance_id', v_attendance_id, 'final_leg_id', v_leg_id,
    'candidate_calculated_km', v_candidate_km,
    'reference_only', v_reference_only,
    'payable_km_changed', false, 'attendance_totals_changed', false,
    'travel_leg_changed', false,
    'canonical_recalculation_complete', false
  );
end
$function$;

create or replace function public.rpc_resolve_fo_final_leg_evidence_v1(
  p_reconciliation_run_id uuid,
  p_decision text,
  p_approved_evidence_km numeric,
  p_review_reason text
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $function$
declare
  v_run public.fo_final_leg_reconciliation_runs%rowtype;
  v_resolution public.fo_final_leg_reconciliation_resolutions%rowtype;
  v_reviewer uuid := auth.uid();
  v_identity text := coalesce(auth.jwt() ->> 'email', auth.jwt() ->> 'employee_code', v_reviewer::text);
  v_decision text := upper(trim(coalesce(p_decision, '')));
  v_approved_km numeric := round(coalesce(p_approved_evidence_km, 0), 2);
begin
  if v_reviewer is null or not public.is_qpms_admin() then
    raise exception using errcode = '42501', message = 'final_leg_evidence_resolution_admin_required';
  end if;
  if v_decision not in ('APPROVED_EVIDENCE', 'REJECTED')
     or nullif(trim(coalesce(p_review_reason, '')), '') is null then
    raise exception using errcode = '22023', message = 'final_leg_evidence_resolution_input_invalid';
  end if;

  select * into v_run from public.fo_final_leg_reconciliation_runs
  where id = p_reconciliation_run_id for update;
  if not found or not (
    (v_run.attendance_id = 'a8d170e6-cbb4-4788-928d-6eb9999d51e2'::uuid
      and v_run.travel_leg_id = '48991354-ca06-4856-9931-8f95e6bb932e'::uuid)
    or
    (v_run.attendance_id = 'd299f0c4-9af7-4f0c-b8cc-86e5b7fb1f91'::uuid
      and v_run.travel_leg_id = '850bc41b-e492-4661-9f5e-05aaafb19d0c'::uuid)
  ) then
    raise exception using errcode = '42501', message = 'final_leg_evidence_resolution_target_not_authorized';
  end if;
  if v_decision = 'APPROVED_EVIDENCE' and (
    v_run.reference_only or v_run.source = 'HAVERSINE_REFERENCE'
    or v_approved_km <= 0 or v_approved_km > v_run.candidate_calculated_km
  ) then
    raise exception using errcode = '22023', message = 'final_leg_evidence_resolution_not_approvable';
  end if;
  if v_decision = 'REJECTED' then v_approved_km := 0; end if;

  insert into public.fo_final_leg_reconciliation_resolutions (
    reconciliation_run_id, attendance_id, travel_leg_id, decision,
    approved_evidence_km, reviewer_user_id, reviewer_identity, review_reason
  ) values (
    v_run.id, v_run.attendance_id, v_run.travel_leg_id, v_decision,
    v_approved_km, v_reviewer, v_identity, trim(p_review_reason)
  )
  on conflict (reconciliation_run_id) do nothing
  returning * into v_resolution;
  if not found then
    select * into v_resolution from public.fo_final_leg_reconciliation_resolutions
    where reconciliation_run_id = v_run.id;
    if v_resolution.decision <> v_decision
       or v_resolution.approved_evidence_km <> v_approved_km then
      raise exception using errcode = '40001', message = 'final_leg_evidence_resolution_already_recorded';
    end if;
  end if;

  return jsonb_build_object(
    'ok', true, 'resolution_id', v_resolution.id,
    'decision', v_resolution.decision,
    'approved_evidence_km', v_resolution.approved_evidence_km,
    'financially_approved', false
  );
end
$function$;

create or replace function public.rpc_apply_fo_final_leg_financial_v1(
  p_attendance_id uuid,
  p_final_leg_id uuid,
  p_reconciliation_run_id uuid,
  p_input_digest text,
  p_expected_evidence_input_digest text,
  p_expected_attendance_updated_at timestamptz,
  p_expected_leg_updated_at timestamptz,
  p_expected_before_total_route_km numeric,
  p_expected_before_eligible_km numeric,
  p_expected_before_total_approved_km numeric,
  p_expected_before_petrol_amount numeric,
  p_expected_leg_calculated_km numeric,
  p_expected_leg_payable_km numeric,
  p_expected_leg_payable_amount numeric,
  p_expected_leg_fare_amount numeric,
  p_approved_final_leg_km numeric,
  p_approved_rate_per_km numeric,
  p_approved_payable_amount numeric,
  p_rate_policy text,
  p_actor_source text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $function$
declare
  v_allowed_attendance_id constant uuid := 'a8d170e6-cbb4-4788-928d-6eb9999d51e2';
  v_allowed_leg_id constant uuid := '48991354-ca06-4856-9931-8f95e6bb932e';
  v_allowed_employee_code constant text := 'QPMSTNC17015';
  v_allowed_date constant date := date '2026-10-07';
  v_attendance public.fo_attendance%rowtype;
  v_leg public.fo_travel_legs%rowtype;
  v_evidence public.fo_final_leg_reconciliation_runs%rowtype;
  v_resolution public.fo_final_leg_reconciliation_resolutions%rowtype;
  v_approval public.fo_km_financial_approvals%rowtype;
  v_existing public.fo_final_leg_financial_applies%rowtype;
  v_apply_id uuid := gen_random_uuid();
  v_site_visit_count integer;
  v_site_visit_route_km numeric;
  v_site_visit_snapshot jsonb;
  v_site_visit_snapshot_after jsonb;
  v_final_leg_km numeric := round(coalesce(p_approved_final_leg_km, 0), 2);
  v_rate numeric := round(coalesce(p_approved_rate_per_km, 0), 2);
  v_amount numeric := round(coalesce(p_approved_payable_amount, 0), 2);
  v_before_route numeric := round(coalesce(p_expected_before_total_route_km, -1), 2);
  v_before_eligible numeric := round(coalesce(p_expected_before_eligible_km, -1), 2);
  v_before_approved numeric := round(coalesce(p_expected_before_total_approved_km, -1), 2);
  v_before_petrol numeric := round(coalesce(p_expected_before_petrol_amount, -1), 2);
  v_after_route numeric;
  v_after_eligible numeric;
  v_after_approved numeric;
  v_after_petrol numeric;
begin
  if p_attendance_id <> v_allowed_attendance_id
     or p_final_leg_id <> v_allowed_leg_id then
    raise exception using errcode = '42501', message = 'final_leg_financial_target_not_authorized';
  end if;
  if coalesce(p_input_digest, '') !~ '^[0-9a-f]{64}$'
     or coalesce(p_expected_evidence_input_digest, '') !~ '^[0-9a-f]{64}$'
     or p_reconciliation_run_id is null
     or p_expected_attendance_updated_at is null
     or p_expected_leg_updated_at is null
     or nullif(trim(coalesce(p_rate_policy, '')), '') is null
     or v_final_leg_km <= 0 or v_rate <= 0 or v_amount <= 0
     or v_amount <> round(v_final_leg_km * v_rate, 2) then
    raise exception using errcode = '22023', message = 'final_leg_financial_input_invalid';
  end if;
  if round(coalesce(p_expected_leg_calculated_km, -1), 2) <> 0
     or round(coalesce(p_expected_leg_payable_km, -1), 2) <> 0
     or round(coalesce(p_expected_leg_payable_amount, -1), 2) <> 0
     or round(coalesce(p_expected_leg_fare_amount, -1), 2) <> 0 then
    raise exception using errcode = '40001', message = 'final_leg_financial_expected_zero_leg_state_required';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(p_attendance_id::text, 0));
  select * into v_attendance from public.fo_attendance
  where id = p_attendance_id for update;
  if not found
     or v_attendance.id <> v_allowed_attendance_id
     or coalesce(v_attendance.employee_code, v_attendance.fo_user_id, '') <> v_allowed_employee_code
     or v_attendance.attendance_date <> v_allowed_date then
    raise exception using errcode = '42501', message = 'final_leg_financial_database_target_mismatch';
  end if;

  select * into v_leg from public.fo_travel_legs
  where id = p_final_leg_id and attendance_id = p_attendance_id for update;
  if not found or v_leg.id <> v_allowed_leg_id then
    raise exception using errcode = '42501', message = 'final_leg_financial_database_leg_mismatch';
  end if;

  select * into v_existing from public.fo_final_leg_financial_applies
  where attendance_id = p_attendance_id and travel_leg_id = p_final_leg_id;
  if found then
    if v_existing.input_digest <> p_input_digest
       or round(coalesce(v_leg.calculated_km, 0), 2) <> v_existing.approved_final_leg_km
       or round(coalesce(v_leg.payable_km, 0), 2) <> v_existing.approved_final_leg_km
       or round(coalesce(v_leg.payable_amount, 0), 2) <> v_existing.approved_payable_amount
       or round(coalesce(v_attendance.total_route_km, 0), 2) <> (v_existing.attendance_financials_after ->> 'totalRouteKm')::numeric
       or round(coalesce(v_attendance.eligible_km, 0), 2) <> (v_existing.attendance_financials_after ->> 'eligibleKm')::numeric
       or round(coalesce(v_attendance.total_approved_km, 0), 2) <> (v_existing.attendance_financials_after ->> 'totalApprovedKm')::numeric
       or round(coalesce(v_attendance.petrol_amount, 0), 2) <> (v_existing.attendance_financials_after ->> 'petrolAmount')::numeric then
      raise exception using errcode = '40001', message = 'final_leg_financial_already_applied_state_mismatch';
    end if;
    return jsonb_build_object(
      'ok', true, 'idempotent_replay', true, 'final_leg_apply_id', v_existing.id,
      'attendance_id', p_attendance_id, 'final_leg_id', p_final_leg_id,
      'final_leg_km', v_existing.approved_final_leg_km,
      'payable_amount', v_existing.approved_payable_amount,
      'reconciliation_status', v_existing.reconciliation_status,
      'canonical_recalculation_complete', false
    );
  end if;

  if not exists (
    select 1 from public.fo_km_financial_control
    where control_key = 'canonical_v2' and financial_writes_enabled is true
    for share
  ) then
    raise exception using errcode = '55000', message = 'km_v2_database_financial_writes_closed';
  end if;
  if v_attendance.updated_at is distinct from p_expected_attendance_updated_at
     or v_leg.updated_at is distinct from p_expected_leg_updated_at then
    raise exception using errcode = '40001', message = 'final_leg_financial_stale_input';
  end if;
  if lower(coalesce(v_attendance.status, '')) = 'active'
     or v_attendance.logout_time is null
     or coalesce(v_attendance.metadata ->> 'km_calculation_version', '') = 'KM_ENGINE_V2'
     or coalesce(v_leg.canonical_calculated, false) is true
     or lower(coalesce(v_leg.status, '')) <> 'completed' then
    raise exception using errcode = '40001', message = 'final_leg_financial_state_not_eligible';
  end if;
  if round(coalesce(v_attendance.total_route_km, 0), 2) <> v_before_route
     or round(coalesce(v_attendance.eligible_km, 0), 2) <> v_before_eligible
     or round(coalesce(v_attendance.total_approved_km, 0), 2) <> v_before_approved
     or round(coalesce(v_attendance.petrol_amount, 0), 2) <> v_before_petrol
     or v_before_route <> 76.45 or v_before_eligible <> 76.45 or v_before_approved <> 76.45
     or round(coalesce(v_leg.calculated_km, 0), 2) <> round(p_expected_leg_calculated_km, 2)
     or round(coalesce(v_leg.payable_km, 0), 2) <> round(p_expected_leg_payable_km, 2)
     or round(coalesce(v_leg.payable_amount, 0), 2) <> round(p_expected_leg_payable_amount, 2)
     or round(coalesce(v_leg.fare_amount, 0), 2) <> round(p_expected_leg_fare_amount, 2) then
    raise exception using errcode = '40001', message = 'final_leg_financial_before_state_mismatch';
  end if;

  perform 1 from public.fo_site_visits where attendance_id = p_attendance_id for update;
  select count(*), round(coalesce(sum(route_km), 0)::numeric, 2),
         coalesce(jsonb_agg(jsonb_build_object('id', id, 'routeKm', route_km) order by id), '[]'::jsonb)
  into v_site_visit_count, v_site_visit_route_km, v_site_visit_snapshot
  from public.fo_site_visits where attendance_id = p_attendance_id;
  if v_site_visit_count <> 7 or v_site_visit_route_km <> 76.45 then
    raise exception using errcode = '40001', message = 'final_leg_financial_site_visit_base_mismatch';
  end if;

  select * into v_evidence from public.fo_final_leg_reconciliation_runs
  where id = p_reconciliation_run_id
    and attendance_id = p_attendance_id and travel_leg_id = p_final_leg_id
  for update;
  if not found or v_evidence.input_digest <> p_expected_evidence_input_digest
     or v_evidence.reference_only or v_evidence.source = 'HAVERSINE_REFERENCE' then
    raise exception using errcode = '40001', message = 'final_leg_financial_evidence_mismatch';
  end if;
  select * into v_resolution from public.fo_final_leg_reconciliation_resolutions
  where reconciliation_run_id = v_evidence.id for update;
  if not found or v_resolution.decision <> 'APPROVED_EVIDENCE'
     or v_resolution.approved_evidence_km <> v_final_leg_km
     or v_final_leg_km > v_evidence.candidate_calculated_km then
    raise exception using errcode = '55000', message = 'final_leg_financial_evidence_not_approved';
  end if;

  v_after_route := round(v_before_route + v_final_leg_km, 2);
  v_after_eligible := round(v_before_eligible + v_final_leg_km, 2);
  v_after_approved := round(v_before_approved + v_final_leg_km, 2);
  v_after_petrol := round(v_before_petrol + v_amount, 2);

  select a.* into v_approval from public.fo_km_financial_approvals a
  where a.attendance_id = p_attendance_id
    and a.input_digest = p_input_digest
    and a.expected_attendance_updated_at = p_expected_attendance_updated_at
    and a.before_total_route_km = v_before_route
    and a.before_eligible_km = v_before_eligible
    and a.before_total_approved_km = v_before_approved
    and a.before_petrol_amount = v_before_petrol
    and a.after_total_route_km = v_after_route
    and a.after_eligible_km = v_after_eligible
    and a.after_total_approved_km = v_after_approved
    and a.after_petrol_amount = v_after_petrol
    and not exists (
      select 1 from public.fo_km_financial_approval_consumptions c where c.approval_id = a.id
    )
  for update of a;
  if not found then
    raise exception using errcode = '55000', message = 'km_v2_financial_approval_required';
  end if;

  perform set_config('app.km_v2_authorized_financial_write', 'true', true);
  update public.fo_travel_legs
  set calculated_km = v_final_leg_km,
      payable_km = v_final_leg_km,
      rate_per_km = v_rate,
      payable_amount = v_amount,
      payable_km_allowed = true,
      calculation_version = 'KM_ENGINE_V2_FINAL_LEG_ONLY_V1',
      calculation_run_id = null,
      canonical_calculated = false,
      updated_at = now()
  where id = p_final_leg_id and attendance_id = p_attendance_id;
  if not found then
    raise exception using errcode = '40001', message = 'final_leg_financial_leg_update_lost';
  end if;

  update public.fo_attendance
  set total_route_km = v_after_route,
      eligible_km = v_after_eligible,
      total_approved_km = v_after_approved,
      petrol_amount = v_after_petrol,
      route_sync_status = 'final_leg_reconciled_pending_canonical_v2',
      metadata = coalesce(metadata, '{}'::jsonb) || jsonb_build_object(
        'final_leg_reconciliation_status', 'FINAL_LEG_FINANCIALLY_APPLIED_CANONICAL_PENDING',
        'final_leg_reconciliation_input_digest', p_input_digest,
        'final_leg_reconciliation_run_id', p_reconciliation_run_id,
        'canonical_recalculation_pending', true,
        'canonical_recalculation_complete', false
      ),
      updated_at = now()
  where id = p_attendance_id;

  select coalesce(jsonb_agg(jsonb_build_object('id', id, 'routeKm', route_km) order by id), '[]'::jsonb)
  into v_site_visit_snapshot_after
  from public.fo_site_visits where attendance_id = p_attendance_id;
  if v_site_visit_snapshot_after is distinct from v_site_visit_snapshot then
    raise exception using errcode = '40001', message = 'final_leg_financial_site_visit_snapshot_changed';
  end if;

  insert into public.fo_final_leg_financial_applies (
    id, attendance_id, travel_leg_id, reconciliation_run_id, resolution_id,
    approval_id, input_digest, evidence_input_digest, approved_final_leg_km,
    approved_rate_per_km, approved_payable_amount, rate_policy,
    attendance_financials_before, attendance_financials_after,
    leg_financials_before, leg_financials_after, site_visit_route_snapshot,
    reconciliation_status, actor_source
  ) values (
    v_apply_id, p_attendance_id, p_final_leg_id, v_evidence.id, v_resolution.id,
    v_approval.id, p_input_digest, p_expected_evidence_input_digest, v_final_leg_km,
    v_rate, v_amount, trim(p_rate_policy),
    jsonb_build_object('totalRouteKm',v_before_route,'eligibleKm',v_before_eligible,
      'totalApprovedKm',v_before_approved,'petrolAmount',v_before_petrol),
    jsonb_build_object('totalRouteKm',v_after_route,'eligibleKm',v_after_eligible,
      'totalApprovedKm',v_after_approved,'petrolAmount',v_after_petrol),
    jsonb_build_object('calculatedKm',p_expected_leg_calculated_km,
      'payableKm',p_expected_leg_payable_km,'payableAmount',p_expected_leg_payable_amount,
      'fareAmount',p_expected_leg_fare_amount),
    jsonb_build_object('calculatedKm',v_final_leg_km,'payableKm',v_final_leg_km,
      'ratePerKm',v_rate,'payableAmount',v_amount,'fareAmount',p_expected_leg_fare_amount),
    v_site_visit_snapshot, 'FINAL_LEG_FINANCIALLY_APPLIED_CANONICAL_PENDING', p_actor_source
  );

  insert into public.fo_km_financial_approval_consumptions (
    approval_id, attendance_id, calculation_run_id, input_digest, final_leg_apply_id
  ) values (v_approval.id, p_attendance_id, null, p_input_digest, v_apply_id);

  return jsonb_build_object(
    'ok', true, 'idempotent_replay', false, 'final_leg_apply_id', v_apply_id,
    'attendance_id', p_attendance_id, 'final_leg_id', p_final_leg_id,
    'final_leg_km', v_final_leg_km, 'payable_amount', v_amount,
    'total_route_km', v_after_route, 'total_approved_km', v_after_approved,
    'petrol_amount', v_after_petrol,
    'reconciliation_status', 'FINAL_LEG_FINANCIALLY_APPLIED_CANONICAL_PENDING',
    'canonical_recalculation_complete', false
  );
end
$function$;

alter function public.rpc_record_fo_final_leg_evidence_v1(jsonb, text) owner to postgres;
alter function public.rpc_resolve_fo_final_leg_evidence_v1(uuid, text, numeric, text) owner to postgres;
alter function public.rpc_apply_fo_final_leg_financial_v1(
  uuid, uuid, uuid, text, text, timestamptz, timestamptz,
  numeric, numeric, numeric, numeric, numeric, numeric, numeric, numeric,
  numeric, numeric, numeric, text, text
) owner to postgres;
revoke all on function public.rpc_record_fo_final_leg_evidence_v1(jsonb, text)
  from public, anon, authenticated;
grant execute on function public.rpc_record_fo_final_leg_evidence_v1(jsonb, text)
  to service_role;
revoke all on function public.rpc_resolve_fo_final_leg_evidence_v1(uuid, text, numeric, text)
  from public, anon, service_role;
grant execute on function public.rpc_resolve_fo_final_leg_evidence_v1(uuid, text, numeric, text)
  to authenticated;
revoke all on function public.rpc_apply_fo_final_leg_financial_v1(
  uuid, uuid, uuid, text, text, timestamptz, timestamptz,
  numeric, numeric, numeric, numeric, numeric, numeric, numeric, numeric,
  numeric, numeric, numeric, text, text
) from public, anon, authenticated;
grant execute on function public.rpc_apply_fo_final_leg_financial_v1(
  uuid, uuid, uuid, text, text, timestamptz, timestamptz,
  numeric, numeric, numeric, numeric, numeric, numeric, numeric, numeric,
  numeric, numeric, numeric, text, text
) to service_role;

comment on table public.fo_final_leg_reconciliation_runs is
  'Immutable evidence-only final-leg reconciliation runs. Never a payable or reimbursement authority.';
comment on function public.rpc_record_fo_final_leg_evidence_v1(jsonb, text) is
  'Records isolated final-leg evidence without modifying the travel leg, payable KM, attendance totals, site-visit KM, reimbursement, or canonical pending status.';
comment on table public.fo_final_leg_reconciliation_resolutions is
  'Immutable evidence review decisions. Approval here is evidentiary and never financial authorization.';
comment on table public.fo_final_leg_financial_applies is
  'Immutable single-target financial apply evidence. Uses the canonical approval ledger and leaves full canonical recalculation pending.';
comment on function public.rpc_apply_fo_final_leg_financial_v1(
  uuid, uuid, uuid, text, text, timestamptz, timestamptz,
  numeric, numeric, numeric, numeric, numeric, numeric, numeric, numeric,
  numeric, numeric, numeric, text, text
) is 'Atomically updates only the authorized existing final leg and attendance totals after evidence and financial approval.';

commit;
