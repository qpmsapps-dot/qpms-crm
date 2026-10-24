-- PREPARED ONLY. Install only under separate approval. No data backfill or flag changes.
begin;
set local lock_timeout='5s';
set local statement_timeout='30s';
do $preflight$
begin
  if md5(pg_get_functiondef('public.rpc_apply_fo_manual_km_refresh_v1(uuid,text,timestamptz,jsonb,uuid,text)'::regprocedure))
      is distinct from 'c4175daa082fef9ecebf058878cf6884' then
    raise exception 'Manual checkout guard: installed 236 definition drift';
  end if;
  if not exists(select 1 from pg_proc p where p.oid='public.rpc_apply_fo_manual_km_refresh_v1(uuid,text,timestamptz,jsonb,uuid,text)'::regprocedure
      and pg_get_userbyid(p.proowner)='postgres' and p.prosecdef
      and has_function_privilege('service_role',p.oid,'EXECUTE')
      and not has_function_privilege('anon',p.oid,'EXECUTE')
      and not has_function_privilege('authenticated',p.oid,'EXECUTE')) then
    raise exception 'Manual checkout guard: installed 236 ownership or grants drift';
  end if;
  if md5(pg_get_functiondef('public.rpc_apply_fo_admin_km_correction_v1(uuid,text,timestamptz,jsonb,text,text,uuid,text,jsonb)'::regprocedure)) <> '0fd0e644e1fb8f3428c48d803c6bccb7'
     or md5(pg_get_functiondef('public.rpc_persist_fo_canonical_km_v2(uuid,text,timestamptz,jsonb,text,text)'::regprocedure)) <> 'ebcf820a36b6b4fbd8bd18858a71f92c' then
    raise exception 'Manual checkout guard: prerequisite definition drift';
  end if;
  if not exists(select 1 from public.fo_km_financial_control where control_key='canonical_v2' and financial_writes_enabled is false) then
    raise exception 'Manual checkout guard: global gate must remain closed';
  end if;
  if to_regprocedure('public.fo_manual_km_lock_visit_parent_v1()') is not null
     or exists(select 1 from pg_trigger where tgrelid='public.fo_site_visits'::regclass and tgname='trg_manual_km_checkout_parent_lock') then
    raise exception 'Manual checkout guard: parent-lock helper already exists; inspect drift';
  end if;
end
$preflight$;
create function public.fo_manual_km_lock_visit_parent_v1() returns trigger
language plpgsql security definer set search_path=public,pg_temp as $parent$
begin
  -- Lock only this visit's destination parent. No new validation or data writes.
  -- Existing checkout updates/deletes are protected by the guard's row locks.
  perform 1 from public.fo_attendance where id=new.attendance_id for key share;
  return new;
end
$parent$;
revoke all on function public.fo_manual_km_lock_visit_parent_v1() from public,anon,authenticated;
create trigger trg_manual_km_checkout_parent_lock
before insert or update of attendance_id on public.fo_site_visits
for each row execute function public.fo_manual_km_lock_visit_parent_v1();
create or replace function public.rpc_apply_fo_manual_km_refresh_v1(
  p_attendance_id uuid, p_input_digest text,
  p_expected_attendance_updated_at timestamptz, p_calculation jsonb,
  p_admin_user_id uuid, p_approval_reason text
) returns jsonb
language plpgsql security definer set search_path = public, pg_temp
as $function$
declare
  actor public.profiles%rowtype;
  attendance public.fo_attendance%rowtype;
  prior public.fo_km_calculation_runs%rowtype;
  protected boolean := false;
  relation_name text;
  checkout public.fo_site_visits%rowtype;
  snapshot jsonb := p_calculation->'manualCheckoutSnapshot';
  final_leg jsonb;
begin
  if coalesce(auth.role(), '') <> 'service_role' then
    raise exception using errcode='42501', message='manual_km_service_role_required';
  end if;
  select * into strict actor from public.profiles where auth_user_id=p_admin_user_id;
  if actor.is_active is not true or actor.web_access_enabled is false
     or lower(coalesce(actor.status,'')) in ('inactive','disabled','deactivated')
     or regexp_replace(upper(coalesce(actor.role,'')), '[^A-Z0-9]', '', 'g') not in ('ADMIN','QPMSADMIN')
     or nullif(btrim(actor.employee_code),'') is null then
    raise exception using errcode='42501', message='manual_km_admin_required';
  end if;
  if nullif(btrim(p_approval_reason),'') is null
     or coalesce(p_input_digest,'') !~ '^[0-9a-f]{64}$'
     or p_calculation ->> 'inputDigest' is distinct from p_input_digest
     or p_calculation ->> 'calculationVersion' is distinct from 'KM_ENGINE_V2' then
    raise exception using errcode='22023', message='manual_km_input_invalid';
  end if;
  perform pg_advisory_xact_lock(hashtextextended(p_attendance_id::text,0));
  select * into strict attendance from public.fo_attendance where id=p_attendance_id for update;
  if upper(btrim(actor.employee_code))=upper(btrim(coalesce(attendance.employee_code,'')))
     or attendance.fo_user_id::text in (actor.id::text, actor.auth_user_id::text, actor.employee_code) then
    raise exception using errcode='42501', message='manual_km_self_approval_forbidden';
  end if;
  perform 1 from public.fo_km_financial_control
    where control_key='canonical_v2' and financial_writes_enabled is false for share;
  if not found then
    raise exception using errcode='55000', message='manual_km_global_gate_must_remain_closed';
  end if;
  -- A retry can only replay this Admin's exact previously committed refresh.
  select * into prior from public.fo_km_calculation_runs
    where attendance_id=p_attendance_id and calculation_version='KM_ENGINE_V2'
      and input_digest=p_input_digest;
  if found then
    if prior.actor_source is distinct from actor.employee_code
       or prior.result ->> 'manualRefreshReviewerId' is distinct from p_admin_user_id::text then
      raise exception using errcode='55000', message='manual_km_financial_state_protected';
    end if;
    return public.rpc_persist_fo_canonical_km_v2(p_attendance_id,p_input_digest,
      p_expected_attendance_updated_at,p_calculation,'admin_correction',prior.actor_source);
  end if;
  if p_expected_attendance_updated_at is null
     or attendance.updated_at is distinct from p_expected_attendance_updated_at then
    raise exception using errcode='40001', message='manual_km_preview_stale';
  end if;
  if attendance.logout_time is null or lower(coalesce(attendance.status,'')) not in
    ('completed','ended','ended day','closed','auto ended','stale auto ended') then
    raise exception using errcode='55000', message='manual_km_completed_attendance_required';
  end if;
  -- The parent FOR UPDATE lock blocks new/reassigned visits through the
  -- narrow parent-lock trigger installed below (production has no visit FK).
  -- Lock every existing visit: the latest checkout cannot be moved/replaced or
  -- have its eligibility/coordinates changed while this transaction writes.
  perform 1 from public.fo_site_visits where attendance_id=p_attendance_id order by id for share;
  select * into checkout from public.fo_site_visits
    where attendance_id=p_attendance_id and check_in_time is not null
    order by check_in_time desc,id desc limit 1;
  if not found or checkout.petrol_eligible_after_checkout is not true
     or coalesce(checkout.check_out_time,checkout.checkout_time) is null then
    raise exception using errcode='55000', message='manual_km_checkout_ineligible';
  end if;
  if (select count(*) from public.fo_site_visits where attendance_id=p_attendance_id
      and check_in_time=checkout.check_in_time)<>1 then
    raise exception using errcode='40001', message='manual_km_checkout_ambiguous';
  end if;
  if jsonb_typeof(snapshot) is distinct from 'object'
     or (snapshot->>'visit_id')::uuid is distinct from checkout.id
     or (snapshot->>'attendance_id')::uuid is distinct from p_attendance_id
     or (snapshot->>'check_in_time')::timestamptz is distinct from checkout.check_in_time
     or (snapshot->>'check_out_time')::timestamptz is distinct from coalesce(checkout.check_out_time,checkout.checkout_time)
     or (snapshot->>'updated_at')::timestamptz is distinct from checkout.updated_at
     or (snapshot->>'latitude')::numeric is distinct from checkout.check_out_latitude
     or (snapshot->>'longitude')::numeric is distinct from checkout.check_out_longitude
     or snapshot->'petrol_eligible_after_checkout' is distinct from 'true'::jsonb
     or snapshot->>'location_status' is distinct from checkout.checkout_location_status
     or (snapshot->>'distance_meters')::numeric is distinct from checkout.checkout_distance_meters then
    raise exception using errcode='40001', message='manual_km_checkout_snapshot_stale';
  end if;
  if checkout.check_out_latitude is null or checkout.check_out_longitude is null
     or checkout.check_out_latitude not between -90 and 90
     or checkout.check_out_longitude not between -180 and 180 then
    raise exception using errcode='22023', message='manual_km_checkout_coordinates_required';
  end if;
  if (select count(*) from jsonb_array_elements(p_calculation->'canonicalLegs') leg
      where leg->>'type'='last_checkout_to_end_day')<>1 then
    raise exception using errcode='22023', message='manual_km_exact_final_leg_required';
  end if;
  select leg into final_leg from jsonb_array_elements(p_calculation->'canonicalLegs') leg
    where leg->>'type'='last_checkout_to_end_day';
  if (final_leg->>'startedAt')::timestamptz is distinct from date_trunc('milliseconds',coalesce(checkout.check_out_time,checkout.checkout_time))
     or (final_leg->>'endedAt')::timestamptz is distinct from date_trunc('milliseconds',attendance.logout_time)
     or (final_leg->>'startLat')::numeric is distinct from checkout.check_out_latitude
     or (final_leg->>'startLng')::numeric is distinct from checkout.check_out_longitude then
    raise exception using errcode='40001', message='manual_km_final_leg_boundary_stale';
  end if;
  -- Conservative: this action never replaces an existing approved payable value,
  -- even when its historical approval ledger is incomplete.
  if coalesce(attendance.total_approved_km,0)>0 or coalesce(attendance.petrol_amount,0)>0
     or attendance.metadata ->> 'shared_travel_adjustment' = 'true'
     or exists(select 1 from public.fo_km_financial_approvals where attendance_id=p_attendance_id)
     or exists(select 1 from public.fo_missing_km_reviews where attendance_id=p_attendance_id and status='approved')
     or exists(select 1 from public.fo_travel_reimbursement_corrections where attendance_id=p_attendance_id)
     or exists(select 1 from public.fo_monthly_travel_settlements
       where upper(employee_code)=upper(coalesce(attendance.employee_code,attendance.fo_user_id))
         and period_start<=attendance.attendance_date and period_end>=attendance.attendance_date)
     or exists(select 1 from public.fo_km_calculation_runs where attendance_id=p_attendance_id and calculation_version='KM_ENGINE_V2') then
    raise exception using errcode='55000', message='manual_km_financial_state_protected';
  end if;
  foreach relation_name in array array['fo_final_leg_financial_applies','fo_km_auto_recovery_applies','fo_final_leg_recovery_runs'] loop
    if to_regclass('public.' || relation_name) is not null then
      execute format('select exists(select 1 from public.%I where attendance_id=$1)',relation_name)
        into protected using p_attendance_id;
      if protected then
        raise exception using errcode='55000', message='manual_km_financial_state_protected';
      end if;
    end if;
  end loop;
  -- Approval creation, consumption, canonical legs and totals remain one atomic
  -- transaction in the installed 228 implementation. The global gate stays shut.
  return public.rpc_apply_fo_admin_km_correction_v1(p_attendance_id,p_input_digest,
    p_expected_attendance_updated_at,
    p_calculation || jsonb_build_object('manualRefreshReviewerId',p_admin_user_id::text),'admin_correction',
    'manual_refresh:' || p_admin_user_id::text,p_admin_user_id,p_approval_reason,null);
end
$function$;
revoke all on function public.rpc_apply_fo_manual_km_refresh_v1(uuid,text,timestamptz,jsonb,uuid,text) from public,anon,authenticated;
grant execute on function public.rpc_apply_fo_manual_km_refresh_v1(uuid,text,timestamptz,jsonb,uuid,text) to service_role;
commit;
