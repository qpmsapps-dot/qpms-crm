-- Bounded, additive-only automatic recovery of GPS_COMPLETE missing travel legs.
-- The canonical global financial gate remains closed; a separately inserted, expiring
-- employee/date authorization is required for every applied leg.

begin;

do $preflight$
begin
  if current_setting('server_version_num')::integer < 170000 then
    raise exception 'Migration 208 requires PostgreSQL 17 or newer';
  end if;
  if to_regclass('public.fo_attendance') is null
     or to_regclass('public.fo_travel_legs') is null
     or to_regclass('public.fo_site_visits') is null
     or to_regclass('public.fo_km_financial_control') is null
     or to_regclass('public.fo_travel_reimbursement_corrections') is null
     or to_regclass('public.fo_monthly_travel_settlements') is null
     or to_regprocedure('public.trg_reject_fo_km_audit_mutation()') is null then
    raise exception 'Migrations 200 and 205-207 objects are required before Migration 208';
  end if;
  if not exists (
    select 1 from public.fo_km_financial_control
    where control_key = 'canonical_v2' and financial_writes_enabled is false
  ) then
    raise exception 'Migration 208 requires the canonical global financial gate to be closed';
  end if;
end
$preflight$;

create table if not exists public.fo_km_auto_recovery_authorizations (
  id uuid primary key default gen_random_uuid(),
  employee_code text not null,
  date_from date not null,
  date_to date not null,
  max_attendances integer not null default 31,
  max_legs integer not null default 100,
  authorized_by_identity text not null,
  authorization_reason text not null,
  expires_at timestamptz not null,
  status text not null default 'ACTIVE',
  created_at timestamptz not null default now(),
  constraint fo_km_auto_recovery_authorization_employee_check
    check (employee_code = upper(btrim(employee_code)) and employee_code <> ''),
  constraint fo_km_auto_recovery_authorization_range_check
    check (date_to >= date_from and date_to - date_from <= 30),
  constraint fo_km_auto_recovery_authorization_limits_check
    check (max_attendances between 1 and 31 and max_legs between 1 and 100),
  constraint fo_km_auto_recovery_authorization_identity_check
    check (btrim(authorized_by_identity) <> '' and btrim(authorization_reason) <> ''),
  constraint fo_km_auto_recovery_authorization_expiry_check
    check (expires_at > created_at and expires_at <= created_at + interval '24 hours'),
  constraint fo_km_auto_recovery_authorization_status_check
    check (status = 'ACTIVE')
);

create unique index if not exists uq_fo_km_auto_recovery_active_scope
  on public.fo_km_auto_recovery_authorizations(employee_code, date_from, date_to)
  where status = 'ACTIVE';

create table if not exists public.fo_km_auto_recovery_applies (
  id uuid primary key default gen_random_uuid(),
  authorization_id uuid not null references public.fo_km_auto_recovery_authorizations(id) on delete restrict,
  attendance_id uuid not null references public.fo_attendance(id) on delete restrict,
  travel_leg_id uuid not null references public.fo_travel_legs(id) on delete restrict,
  employee_code text not null,
  attendance_date date not null,
  leg_type text not null,
  input_digest text not null,
  source text not null,
  gps_coverage_classification text not null,
  applied_km numeric(14,2) not null,
  applied_rate_per_km numeric(14,2) not null,
  applied_amount numeric(14,2) not null,
  attendance_financials_before jsonb not null,
  attendance_financials_after jsonb not null,
  leg_financials_before jsonb not null,
  leg_financials_after jsonb not null,
  site_visit_route_snapshot jsonb not null,
  evidence_snapshot jsonb not null,
  actor_user_id uuid not null,
  actor_identity text not null,
  created_at timestamptz not null default now(),
  constraint fo_km_auto_recovery_apply_target_key unique (attendance_id, travel_leg_id),
  constraint fo_km_auto_recovery_apply_digest_key unique (attendance_id, input_digest),
  constraint fo_km_auto_recovery_apply_leg_type_check check (
    leg_type in ('start_to_first_checkin','site_checkout_to_next_checkin','last_checkout_to_end_day')
  ),
  constraint fo_km_auto_recovery_apply_digest_check check (input_digest ~ '^[0-9a-f]{64}$'),
  constraint fo_km_auto_recovery_apply_evidence_check check (
    source in ('GPS_BASED','GPS_ROUTE_SUPPORTED')
    and gps_coverage_classification = 'GPS_COMPLETE'
  ),
  constraint fo_km_auto_recovery_apply_values_check check (
    applied_km > 0 and applied_rate_per_km > 0 and applied_amount = round(applied_km * applied_rate_per_km, 2)
  ),
  constraint fo_km_auto_recovery_apply_json_check check (
    jsonb_typeof(attendance_financials_before) = 'object'
    and jsonb_typeof(attendance_financials_after) = 'object'
    and jsonb_typeof(leg_financials_before) = 'object'
    and jsonb_typeof(leg_financials_after) = 'object'
    and jsonb_typeof(site_visit_route_snapshot) = 'array'
    and jsonb_typeof(evidence_snapshot) = 'object'
  )
);

alter table public.fo_km_auto_recovery_authorizations enable row level security;
alter table public.fo_km_auto_recovery_applies enable row level security;
revoke all on table public.fo_km_auto_recovery_authorizations from public, anon, authenticated, service_role;
revoke all on table public.fo_km_auto_recovery_applies from public, anon, authenticated, service_role;
grant select on table public.fo_km_auto_recovery_authorizations to service_role;
grant select on table public.fo_km_auto_recovery_applies to service_role;

drop policy if exists "fo_km_auto_recovery_authorizations_service_read" on public.fo_km_auto_recovery_authorizations;
create policy "fo_km_auto_recovery_authorizations_service_read"
  on public.fo_km_auto_recovery_authorizations for select to service_role using (true);
drop policy if exists "fo_km_auto_recovery_applies_service_read" on public.fo_km_auto_recovery_applies;
create policy "fo_km_auto_recovery_applies_service_read"
  on public.fo_km_auto_recovery_applies for select to service_role using (true);

drop trigger if exists trg_immutable_fo_km_auto_recovery_authorizations
  on public.fo_km_auto_recovery_authorizations;
create trigger trg_immutable_fo_km_auto_recovery_authorizations
before update or delete on public.fo_km_auto_recovery_authorizations
for each row execute function public.trg_reject_fo_km_audit_mutation();

drop trigger if exists trg_immutable_fo_km_auto_recovery_applies
  on public.fo_km_auto_recovery_applies;
create trigger trg_immutable_fo_km_auto_recovery_applies
before update or delete on public.fo_km_auto_recovery_applies
for each row execute function public.trg_reject_fo_km_audit_mutation();

create or replace function public.rpc_apply_fo_gps_complete_missing_leg_v1(
  p_authorization_id uuid,
  p_plan jsonb,
  p_actor_user_id uuid,
  p_actor_identity text
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
set lock_timeout = '2s'
set statement_timeout = '15s'
as $function$
declare
  v_authorization public.fo_km_auto_recovery_authorizations%rowtype;
  v_attendance public.fo_attendance%rowtype;
  v_leg public.fo_travel_legs%rowtype;
  v_existing public.fo_km_auto_recovery_applies%rowtype;
  v_apply_id uuid := gen_random_uuid();
  v_attendance_id uuid;
  v_leg_id uuid;
  v_employee_code text;
  v_attendance_date date;
  v_leg_type text;
  v_digest text;
  v_source text;
  v_km numeric;
  v_rate numeric;
  v_amount numeric;
  v_stored_rate numeric;
  v_mode text;
  v_br numeric; v_be numeric; v_ba numeric; v_bp numeric;
  v_ar numeric; v_ae numeric; v_aa numeric; v_ap numeric;
  v_site_count integer; v_site_km numeric;
  v_site_snapshot jsonb; v_site_snapshot_after jsonb;
  v_used_attendances integer; v_used_legs integer;
begin
  if p_plan is null or jsonb_typeof(p_plan) <> 'object'
     or coalesce(p_plan->>'version','') <> 'KM_ENGINE_V2_AUTO_MISSING_LEG_V1'
     or coalesce(p_plan->>'inputDigest','') !~ '^[0-9a-f]{64}$'
     or p_authorization_id is null or p_actor_user_id is null
     or nullif(btrim(coalesce(p_actor_identity,'')),'') is null then
    raise exception using errcode='22023', message='auto_missing_km_input_invalid';
  end if;

  v_attendance_id := (p_plan->>'attendanceId')::uuid;
  v_leg_id := (p_plan->>'travelLegId')::uuid;
  v_employee_code := upper(btrim(p_plan->>'employeeCode'));
  v_attendance_date := (p_plan->>'attendanceDate')::date;
  v_leg_type := p_plan->>'legType';
  v_digest := p_plan->>'inputDigest';
  v_source := p_plan->>'source';
  v_km := round((p_plan->>'candidateKm')::numeric,2);
  v_rate := round((p_plan->>'rate')::numeric,2);
  v_amount := round((p_plan->>'amount')::numeric,2);
  v_br := round((p_plan#>>'{before,totalRouteKm}')::numeric,2);
  v_be := round((p_plan#>>'{before,eligibleKm}')::numeric,2);
  v_ba := round((p_plan#>>'{before,totalApprovedKm}')::numeric,2);
  v_bp := round((p_plan#>>'{before,petrolAmount}')::numeric,2);

  if v_leg_type not in ('start_to_first_checkin','site_checkout_to_next_checkin','last_checkout_to_end_day')
     or v_source not in ('GPS_BASED','GPS_ROUTE_SUPPORTED')
     or coalesce(p_plan->>'gpsCoverageClassification','') <> 'GPS_COMPLETE'
     or coalesce((p_plan->>'payable')::boolean,false) is not true
     or coalesce(p_plan->>'decision','') not in ('ACCEPTED','ACCEPTED_WITH_WARNING')
     or v_km <= 0 or v_rate <= 0 or v_amount <> round(v_km*v_rate,2)
     or round(coalesce((p_plan#>>'{existingLeg,calculatedKm}')::numeric,-1),2) <> 0
     or round(coalesce((p_plan#>>'{existingLeg,payableKm}')::numeric,-1),2) <> 0
     or round(coalesce((p_plan#>>'{existingLeg,payableAmount}')::numeric,-1),2) <> 0
     or round(coalesce((p_plan#>>'{existingLeg,fareAmount}')::numeric,-1),2) <> 0 then
    raise exception using errcode='22023', message='auto_missing_km_evidence_or_zero_state_rejected';
  end if;

  select * into v_authorization from public.fo_km_auto_recovery_authorizations
  where id=p_authorization_id for update;
  if not found or v_authorization.status <> 'ACTIVE' or v_authorization.expires_at <= now()
     or v_authorization.employee_code <> v_employee_code
     or v_authorization.date_from > v_attendance_date or v_authorization.date_to < v_attendance_date then
    raise exception using errcode='42501', message='auto_missing_km_bounded_authorization_required';
  end if;
  if exists(select 1 from public.fo_km_financial_control
    where control_key='canonical_v2' and financial_writes_enabled is true) then
    raise exception using errcode='55000', message='auto_missing_km_requires_global_financial_gate_closed';
  end if;

  if not pg_try_advisory_xact_lock(hashtextextended(v_attendance_id::text,0)) then
    raise exception using errcode='55P03', message='auto_missing_km_attendance_already_running';
  end if;
  select * into v_attendance from public.fo_attendance where id=v_attendance_id for update;
  if not found or upper(coalesce(v_attendance.employee_code,v_attendance.fo_user_id,'')) <> v_employee_code
     or v_attendance.attendance_date <> v_attendance_date then
    raise exception using errcode='42501', message='auto_missing_km_database_target_mismatch';
  end if;
  select * into v_leg from public.fo_travel_legs
  where id=v_leg_id and attendance_id=v_attendance_id for update;
  if not found then raise exception using errcode='P0002', message='auto_missing_km_leg_not_found'; end if;

  select * into v_existing from public.fo_km_auto_recovery_applies
  where attendance_id=v_attendance_id and travel_leg_id=v_leg_id;
  if found then
    if v_existing.input_digest <> v_digest
       or round(coalesce(v_leg.payable_km,0),2) <> v_existing.applied_km
       or round(coalesce(v_attendance.total_approved_km,0),2) <
          (v_existing.attendance_financials_after->>'totalApprovedKm')::numeric then
      raise exception using errcode='40001', message='auto_missing_km_idempotent_replay_state_mismatch';
    end if;
    return jsonb_build_object('ok',true,'idempotent_replay',true,'apply_id',v_existing.id,
      'attendance_id',v_attendance_id,'travel_leg_id',v_leg_id,'applied_km',v_existing.applied_km,
      'applied_amount',v_existing.applied_amount);
  end if;

  select count(distinct attendance_id),count(*) into v_used_attendances,v_used_legs
  from public.fo_km_auto_recovery_applies where authorization_id=p_authorization_id;
  if v_used_legs >= v_authorization.max_legs
     or (v_used_attendances >= v_authorization.max_attendances and not exists(
       select 1 from public.fo_km_auto_recovery_applies
       where authorization_id=p_authorization_id and attendance_id=v_attendance_id
     )) then
    raise exception using errcode='42501', message='auto_missing_km_authorization_limit_exhausted';
  end if;

  if v_attendance.updated_at is distinct from (p_plan->>'attendanceUpdatedAt')::timestamptz
     or v_leg.updated_at is distinct from (p_plan->>'travelLegUpdatedAt')::timestamptz
     or lower(coalesce(v_attendance.status,''))='active' or v_attendance.logout_time is null
     or lower(coalesce(v_leg.status,''))<>'completed' or coalesce(v_leg.canonical_calculated,false) is true then
    raise exception using errcode='40001', message='auto_missing_km_stale_or_ineligible_state';
  end if;
  if round(coalesce(v_attendance.total_route_km,0),2)<>v_br
     or round(coalesce(v_attendance.eligible_km,0),2)<>v_be
     or round(coalesce(v_attendance.total_approved_km,0),2)<>v_ba
     or round(coalesce(v_attendance.petrol_amount,0),2)<>v_bp
     or round(coalesce(v_leg.calculated_km,0),2)<>0
     or round(coalesce(v_leg.payable_km,0),2)<>0
     or round(coalesce(v_leg.payable_amount,0),2)<>0
     or round(coalesce(v_leg.fare_amount,0),2)<>0 then
    raise exception using errcode='40001', message='auto_missing_km_before_state_mismatch';
  end if;

  v_mode := lower(coalesce(nullif(v_leg.travel_mode,''),nullif(v_attendance.travel_mode,''),''));
  v_stored_rate := round(coalesce(v_leg.rate_per_km,v_attendance.rate_per_km,-1),2);
  if v_mode not in ('bike','own_vehicle','car')
     or v_leg.payable_km_allowed is not true
     or v_stored_rate <= 0 or v_rate <> v_stored_rate then
    raise exception using errcode='42501', message='auto_missing_km_stored_travel_policy_rejected';
  end if;
  if exists(select 1 from public.fo_travel_reimbursement_corrections
    where attendance_id=v_attendance_id and status='applied') then
    raise exception using errcode='55000', message='auto_missing_km_existing_correction_finance_reconciliation';
  end if;
  if exists(select 1 from public.fo_monthly_travel_settlements
    where upper(employee_code)=v_employee_code
      and period_start<=v_attendance_date and period_end>=v_attendance_date) then
    raise exception using errcode='55000', message='auto_missing_km_existing_settlement_finance_reconciliation';
  end if;

  perform 1 from public.fo_site_visits where attendance_id=v_attendance_id for update;
  select count(*),round(coalesce(sum(greatest(coalesce(route_km,0),0)),0)::numeric,2),
    coalesce(jsonb_agg(jsonb_build_object('id',id,'routeKm',route_km) order by id),'[]'::jsonb)
  into v_site_count,v_site_km,v_site_snapshot
  from public.fo_site_visits where attendance_id=v_attendance_id;
  if v_site_count <> (p_plan#>>'{siteVisits,count}')::integer
     or v_site_km <> round((p_plan#>>'{siteVisits,routeKm}')::numeric,2) then
    raise exception using errcode='40001', message='auto_missing_km_site_visit_snapshot_mismatch';
  end if;

  v_ar:=round(v_br+v_km,2); v_ae:=round(v_be+v_km,2);
  v_aa:=round(v_ba+v_km,2); v_ap:=round(v_bp+v_amount,2);
  perform set_config('app.km_v2_authorized_financial_write','true',true);
  update public.fo_travel_legs set
    calculated_km=v_km,payable_km=v_km,rate_per_km=v_rate,payable_amount=v_amount,
    payable_km_allowed=true,calculation_version='KM_ENGINE_V2_AUTO_MISSING_LEG_V1',
    calculation_run_id=null,canonical_calculated=false,updated_at=now()
  where id=v_leg_id and attendance_id=v_attendance_id;
  update public.fo_attendance set
    total_route_km=v_ar,eligible_km=v_ae,total_approved_km=v_aa,petrol_amount=v_ap,
    route_sync_status='auto_missing_km_recovered_pending_canonical_v2',
    metadata=coalesce(metadata,'{}'::jsonb)||jsonb_build_object(
      'automatic_missing_km_recovery_status','GPS_COMPLETE_ADDITIVE_APPLIED',
      'automatic_missing_km_last_input_digest',v_digest,
      'canonical_recalculation_pending',true,'canonical_recalculation_complete',false),
    updated_at=now()
  where id=v_attendance_id;

  select coalesce(jsonb_agg(jsonb_build_object('id',id,'routeKm',route_km) order by id),'[]'::jsonb)
  into v_site_snapshot_after from public.fo_site_visits where attendance_id=v_attendance_id;
  if v_site_snapshot_after is distinct from v_site_snapshot then
    raise exception using errcode='40001', message='auto_missing_km_site_visit_changed';
  end if;

  insert into public.fo_km_auto_recovery_applies(
    id,authorization_id,attendance_id,travel_leg_id,employee_code,attendance_date,leg_type,
    input_digest,source,gps_coverage_classification,applied_km,applied_rate_per_km,applied_amount,
    attendance_financials_before,attendance_financials_after,leg_financials_before,leg_financials_after,
    site_visit_route_snapshot,evidence_snapshot,actor_user_id,actor_identity
  ) values (
    v_apply_id,p_authorization_id,v_attendance_id,v_leg_id,v_employee_code,v_attendance_date,v_leg_type,
    v_digest,v_source,'GPS_COMPLETE',v_km,v_rate,v_amount,
    jsonb_build_object('totalRouteKm',v_br,'eligibleKm',v_be,'totalApprovedKm',v_ba,'petrolAmount',v_bp),
    jsonb_build_object('totalRouteKm',v_ar,'eligibleKm',v_ae,'totalApprovedKm',v_aa,'petrolAmount',v_ap),
    p_plan->'existingLeg',jsonb_build_object('calculatedKm',v_km,'payableKm',v_km,'ratePerKm',v_rate,
      'payableAmount',v_amount,'fareAmount',round(coalesce(v_leg.fare_amount,0),2)),
    v_site_snapshot,p_plan,p_actor_user_id,btrim(p_actor_identity)
  );
  return jsonb_build_object('ok',true,'idempotent_replay',false,'apply_id',v_apply_id,
    'attendance_id',v_attendance_id,'travel_leg_id',v_leg_id,'applied_km',v_km,
    'applied_amount',v_amount,'total_approved_km',v_aa,'petrol_amount',v_ap);
end
$function$;

alter function public.rpc_apply_fo_gps_complete_missing_leg_v1(uuid,jsonb,uuid,text) owner to postgres;
revoke all on function public.rpc_apply_fo_gps_complete_missing_leg_v1(uuid,jsonb,uuid,text)
  from public,anon,authenticated;
grant execute on function public.rpc_apply_fo_gps_complete_missing_leg_v1(uuid,jsonb,uuid,text)
  to service_role;

comment on table public.fo_km_auto_recovery_authorizations is
  'Immutable, expiring employee/date scopes inserted only after separate production financial authorization.';
comment on function public.rpc_apply_fo_gps_complete_missing_leg_v1(uuid,jsonb,uuid,text) is
  'Atomically adds one persisted zero-financial GPS_COMPLETE private-mode leg under a bounded authorization while the global gate remains closed.';

commit;
