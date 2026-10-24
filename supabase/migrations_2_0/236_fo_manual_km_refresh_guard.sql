-- Manual Refresh KM only. No gate/configuration changes and no backfill.
begin;
do $preflight$
begin
  if to_regprocedure('public.rpc_apply_fo_admin_km_correction_v1(uuid,text,timestamptz,jsonb,text,text,uuid,text,jsonb)') is null
     or to_regprocedure('public.rpc_persist_fo_canonical_km_v2(uuid,text,timestamptz,jsonb,text,text)') is null then
    raise exception 'Manual KM refresh: required production 228 functions are missing';
  end if;
  if md5(pg_get_functiondef('public.rpc_apply_fo_admin_km_correction_v1(uuid,text,timestamptz,jsonb,text,text,uuid,text,jsonb)'::regprocedure)) <> '0fd0e644e1fb8f3428c48d803c6bccb7'
     or md5(pg_get_functiondef('public.rpc_persist_fo_canonical_km_v2(uuid,text,timestamptz,jsonb,text,text)'::regprocedure)) <> 'ebcf820a36b6b4fbd8bd18858a71f92c' then
    raise exception 'Manual KM refresh: production function definition drift; review before applying';
  end if;
  if not exists(select 1 from public.fo_km_financial_control where control_key='canonical_v2' and financial_writes_enabled is false) then
    raise exception 'Manual KM refresh: global financial gate must remain closed';
  end if;
end
$preflight$;
create function public.rpc_apply_fo_manual_km_refresh_v1(
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
