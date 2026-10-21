-- Local preparation only. No financial backfill and no global gate changes.
-- Dependencies: canonical V2 (200 and installed evidence amendments), forward 216.
begin;

-- Preserve the installed canonical implementation, including evidence amendments.
-- A closed global gate admits only a matching, unused financial approval. The
-- ordinary completed-day approval checks later in the function still execute.
do $migration$
declare
  definition text;
  old_guard text := E'if coalesce(v_financial_writes_enabled, false) is not true then\n    raise exception using errcode = ''55000'', message = ''km_v2_database_financial_writes_closed'';\n  end if;';
  new_guard text := $guard$if coalesce(v_financial_writes_enabled, false) is not true and not exists (
    select 1 from public.fo_km_financial_approvals a
    where a.attendance_id = p_attendance_id and a.input_digest = p_input_digest
      and exists (select 1 from public.profiles reviewer
        where reviewer.auth_user_id = a.reviewer_user_id and reviewer.is_active is true
          and reviewer.web_access_enabled is distinct from false
          and lower(coalesce(reviewer.status,'')) not in ('inactive','disabled','deactivated')
          and regexp_replace(upper(coalesce(reviewer.role,'')), '[^A-Z0-9]', '', 'g') in ('ADMIN','QPMSADMIN')
          and nullif(btrim(reviewer.employee_code),'') is not null
          and upper(btrim(reviewer.employee_code)) <> upper(btrim(coalesce(v_attendance.employee_code,'')))
          and (v_attendance.fo_user_id is null or v_attendance.fo_user_id::text not in
            (reviewer.id::text, reviewer.auth_user_id::text, reviewer.employee_code)))
      and a.expected_attendance_updated_at = p_expected_attendance_updated_at
      and a.before_total_route_km = round(coalesce(v_attendance.total_route_km, 0), 2)
      and a.before_eligible_km = round(coalesce(v_attendance.eligible_km, 0), 2)
      and a.before_total_approved_km = round(coalesce(v_attendance.total_approved_km, 0), 2)
      and a.before_petrol_amount = round(coalesce(v_attendance.petrol_amount, 0), 2)
      and a.after_total_route_km = round(coalesce(
        (p_calculation #>> '{authoritativeAppliedCorrection,routeKm}')::numeric,
        (p_calculation ->> 'payableKm')::numeric - (p_calculation ->> 'approvedMissingKm')::numeric), 2)
      and a.after_eligible_km = round((p_calculation ->> 'payableKm')::numeric, 2)
      and a.after_total_approved_km = round((p_calculation ->> 'payableKm')::numeric, 2)
      and a.after_petrol_amount = round((p_calculation ->> 'reimbursement')::numeric, 2)
      and not exists (select 1 from public.fo_km_financial_approval_consumptions c where c.approval_id = a.id)
  ) then
    raise exception using errcode = '55000', message = 'km_v2_database_financial_writes_closed';
  end if;$guard$;
begin
  definition := replace(pg_get_functiondef(
    'public.rpc_persist_fo_canonical_km_v2(uuid,text,timestamptz,jsonb,text,text)'::regprocedure), E'\r\n', E'\n');
  if (length(definition) - length(replace(definition, old_guard, ''))) <> length(old_guard)
     or position('km_v2_financial_approval_required' in definition) = 0
     or position('km_v2_stale_input_digest' in definition) = 0 then
    raise exception 'Migration 228: canonical definition drift; review installed definition before applying';
  end if;
  execute replace(definition, old_guard, new_guard);
end
$migration$;

create function public.rpc_apply_fo_admin_km_correction_v1(
  p_attendance_id uuid, p_input_digest text,
  p_expected_attendance_updated_at timestamptz, p_calculation jsonb,
  p_source_entry_point text, p_actor_source text,
  p_admin_user_id uuid, p_approval_reason text, p_review_decision jsonb default null
) returns jsonb
language plpgsql security definer set search_path = public, pg_temp
as $function$
declare
  actor public.profiles%rowtype;
  attendance public.fo_attendance%rowtype;
  review public.fo_missing_km_reviews%rowtype;
  approval public.fo_km_financial_approvals%rowtype;
  result jsonb;
  decision jsonb;
  route_km numeric;
  approved_km numeric;
  amount numeric;
  requested_km numeric;
  upper_bound_km numeric;
  previous_review_km numeric := 0;
  previous_review_amount numeric := 0;
begin
  -- Only the JWT-authenticated backend may assert this identity; browsers cannot
  -- invoke this service-only RPC or supply their own calculated route payload.
  if coalesce(auth.role(), '') <> 'service_role' then
    raise exception using errcode = '42501', message = 'km_v2_service_role_required';
  end if;
  select * into strict actor from public.profiles where auth_user_id = p_admin_user_id;
  if actor.is_active is not true or actor.web_access_enabled is false
     or lower(coalesce(actor.status, '')) in ('inactive', 'disabled', 'deactivated')
     or regexp_replace(upper(coalesce(actor.role, '')), '[^A-Z0-9]', '', 'g') not in ('ADMIN', 'QPMSADMIN') then
    raise exception using errcode = '42501', message = 'km_v2_financial_approval_admin_required';
  end if;
  if nullif(btrim(p_approval_reason), '') is null
     or coalesce(p_input_digest, '') !~ '^[0-9a-f]{64}$'
     or coalesce(p_calculation ->> 'calculationVersion', '') <> 'KM_ENGINE_V2'
     or p_calculation ->> 'inputDigest' is distinct from p_input_digest then
    raise exception using errcode = '22023', message = 'km_v2_financial_approval_input_invalid';
  end if;
  if (p_review_decision is null and p_source_entry_point is distinct from 'admin_correction')
     or (p_review_decision is not null and p_source_entry_point is distinct from 'missing_km_approval') then
    raise exception using errcode = '22023', message = 'km_v2_admin_action_source_invalid';
  end if;
  perform pg_advisory_xact_lock(hashtextextended(p_attendance_id::text, 0));
  select * into strict attendance from public.fo_attendance where id = p_attendance_id for update;
  if upper(btrim(coalesce(actor.employee_code, ''))) = upper(btrim(coalesce(attendance.employee_code, '')))
     or attendance.fo_user_id::text in (actor.id::text, actor.auth_user_id::text, actor.employee_code) then
    raise exception using errcode = '42501', message = 'km_v2_self_approval_forbidden';
  end if;
  if attendance.metadata ->> 'shared_travel_adjustment' = 'true'
     and attendance.payable_km_allowed is false then
    raise exception using errcode = '55000', message = 'km_v2_protected_shared_travel';
  end if;

  if p_review_decision is not null then
    select * into strict review from public.fo_missing_km_reviews
      where id = (p_review_decision ->> 'reviewId')::uuid and attendance_id = p_attendance_id for update;
    decision := p_review_decision -> 'update';
    requested_km := round((decision ->> 'approved_missing_km')::numeric, 2);
    if requested_km is null or requested_km < 0 or coalesce(decision ->> 'status', '') <> 'approved'
       or upper(btrim(coalesce(review.employee_code, ''))) = upper(btrim(coalesce(actor.employee_code, ''))) then
      raise exception using errcode = '42501', message = 'km_v2_review_approval_invalid';
    end if;
    -- Committed approval retries return their original receipt. Never add again,
    -- overwrite a later correction, or refresh the review's approval timestamps.
    if review.status = 'approved' and review.metadata ->> 'atomic_approval_input_digest' is not null then
      if review.approved_missing_km <> requested_km then
        raise exception using errcode = '40001', message = 'km_v2_approved_review_change_forbidden';
      end if;
      perform 1 from public.fo_km_calculation_runs
        where id::text = review.metadata ->> 'atomic_approval_calculation_run_id'
          and attendance_id = p_attendance_id
          and input_digest = review.metadata ->> 'atomic_approval_input_digest';
      if not found then
        raise exception using errcode = '40001', message = 'km_v2_review_receipt_missing';
      end if;
      return jsonb_build_object('ok', true, 'idempotent_replay', true, 'review', to_jsonb(review),
        'calculation_run_id', review.metadata ->> 'atomic_approval_calculation_run_id',
        'total_route_km', attendance.total_route_km, 'payable_km', attendance.total_approved_km,
        'reimbursement', attendance.petrol_amount,
        'approved_missing_review_count', (select count(*) from public.fo_missing_km_reviews
          where attendance_id = p_attendance_id and status = 'approved'),
        'approved_missing_km', (select coalesce(sum(approved_missing_km), 0)
          from public.fo_missing_km_reviews where attendance_id = p_attendance_id and status = 'approved'));
    end if;
    if review.updated_at is distinct from (p_review_decision ->> 'expectedUpdatedAt')::timestamptz
       or review.status is distinct from p_review_decision ->> 'expectedStatus'
       or (review.status = 'approved' and review.approved_missing_km <> requested_km) then
      raise exception using errcode = '40001', message = 'km_v2_stale_review_decision';
    end if;
    if review.rate_per_km is null or review.rate_per_km not in (4, 8)
       or (decision ->> 'approved_amount')::numeric is distinct from round(requested_km * review.rate_per_km, 2) then
      raise exception using errcode = '22023', message = 'km_v2_review_rate_invalid';
    end if;
    if review.status = 'approved' then
      previous_review_km := coalesce(review.approved_missing_km,0);
      previous_review_amount := coalesce(review.approved_amount,0);
    end if;
    if review.metadata ->> 'incremental_determination' = 'requires_review'
       and coalesce(decision #>> '{metadata,manual_override}', 'false') <> 'true' then
      raise exception using errcode = '22023', message = 'km_v2_review_clarification_required';
    end if;
    if decision #>> '{metadata,manual_override}' = 'true' then
      upper_bound_km := greatest((review.metadata ->> 'detected_missing_km')::numeric,
        review.filtered_gps_km, review.google_route_km, review.suggested_missing_km);
      if upper_bound_km is null or requested_km > upper_bound_km + 0.001
         or nullif(btrim(decision ->> 'review_remarks'), '') is null then
        raise exception using errcode = '22023', message = 'km_v2_review_evidence_limit';
      end if;
    elsif requested_km > coalesce(review.suggested_missing_km, 0) + 0.01
      and (coalesce(decision #>> '{metadata,elevated_override}', 'false') <> 'true'
        or nullif(btrim(decision ->> 'review_remarks'), '') is null) then
      raise exception using errcode = '22023', message = 'km_v2_review_override_required';
    end if;
  end if;

  -- A full-correction replay must pass the canonical RPC's own state check.
  if p_review_decision is null and exists (select 1 from public.fo_km_calculation_runs
      where attendance_id = p_attendance_id and input_digest = p_input_digest and calculation_version = 'KM_ENGINE_V2') then
    return public.rpc_persist_fo_canonical_km_v2(p_attendance_id, p_input_digest,
      p_expected_attendance_updated_at, p_calculation, p_source_entry_point, actor.employee_code);
  end if;
  if attendance.updated_at is distinct from p_expected_attendance_updated_at then
    raise exception using errcode = '40001', message = 'km_v2_stale_input_digest';
  end if;

  if p_review_decision is not null then
    update public.fo_missing_km_reviews set status = 'approved', approved_missing_km = requested_km,
      approved_amount = round(requested_km * review.rate_per_km, 2), requested_clarification = null,
      reviewer_employee_code = actor.employee_code,
      reviewer_name = coalesce(to_jsonb(actor) ->> 'full_name', to_jsonb(actor) ->> 'display_name', actor.employee_code),
      reviewed_at = now(), review_remarks = decision ->> 'review_remarks', updated_at = now(),
      metadata = coalesce(review.metadata, '{}'::jsonb) || coalesce(decision -> 'metadata', '{}'::jsonb)
    where id = review.id returning * into review;
  end if;

  -- Approval and consumption use the existing ledger and canonical RPC. No gate
  -- toggling, alternative KM calculation, financial direct UPDATE, or catch block.
  approved_km := round((p_calculation ->> 'payableKm')::numeric, 2);
  amount := round((p_calculation ->> 'reimbursement')::numeric, 2);
  route_km := round(coalesce((p_calculation #>> '{authoritativeAppliedCorrection,routeKm}')::numeric,
    approved_km - (p_calculation ->> 'approvedMissingKm')::numeric), 2);
  if approved_km is null or amount is null or route_km is null then
    raise exception using errcode = '22023', message = 'km_v2_financial_approval_input_invalid';
  end if;
  if p_review_decision is not null and (
    route_km <> round(coalesce(attendance.total_route_km,0),2)
    or approved_km <> round(coalesce(attendance.total_approved_km,0)
      - previous_review_km + requested_km,2)
    or approved_km <> round(coalesce(attendance.eligible_km,0) - previous_review_km + requested_km,2)
    or amount <> round(coalesce(attendance.petrol_amount,0) - previous_review_amount
      + requested_km * review.rate_per_km,2)
  ) then
    -- A Missing KM decision cannot silently reprice/recompute previously approved
    -- base travel. Reconcile that base explicitly through the Admin action first.
    raise exception using errcode = '40001', message = 'km_v2_missing_review_base_changed';
  end if;
  insert into public.fo_km_financial_approvals (
    attendance_id, input_digest, expected_attendance_updated_at,
    before_total_route_km, before_eligible_km, before_total_approved_km, before_petrol_amount,
    after_total_route_km, after_eligible_km, after_total_approved_km, after_petrol_amount,
    reviewer_user_id, reviewer_identity, approval_reason
  ) values (p_attendance_id, p_input_digest, p_expected_attendance_updated_at,
    round(coalesce(attendance.total_route_km,0),2), round(coalesce(attendance.eligible_km,0),2),
    round(coalesce(attendance.total_approved_km,0),2), round(coalesce(attendance.petrol_amount,0),2),
    route_km, approved_km, approved_km, amount, p_admin_user_id, actor.employee_code, btrim(p_approval_reason))
  on conflict (attendance_id, input_digest) do nothing;

  -- Reject conflicting/consumed approvals even when the global gate is open.
  select * into strict approval from public.fo_km_financial_approvals
    where attendance_id = p_attendance_id and input_digest = p_input_digest for update;
  if approval.expected_attendance_updated_at is distinct from p_expected_attendance_updated_at
     or approval.before_total_route_km <> round(coalesce(attendance.total_route_km,0),2)
     or approval.before_eligible_km <> round(coalesce(attendance.eligible_km,0),2)
     or approval.before_total_approved_km <> round(coalesce(attendance.total_approved_km,0),2)
     or approval.before_petrol_amount <> round(coalesce(attendance.petrol_amount,0),2)
     or approval.after_total_route_km <> route_km or approval.after_eligible_km <> approved_km
     or approval.after_total_approved_km <> approved_km or approval.after_petrol_amount <> amount
     or exists (select 1 from public.fo_km_financial_approval_consumptions where approval_id = approval.id) then
    raise exception using errcode = '40001', message = 'km_v2_financial_approval_digest_state_mismatch';
  end if;
  result := public.rpc_persist_fo_canonical_km_v2(p_attendance_id, p_input_digest,
    p_expected_attendance_updated_at, p_calculation, p_source_entry_point, actor.employee_code);

  if p_review_decision is not null then
    update public.fo_missing_km_reviews set metadata = metadata || jsonb_build_object(
      'atomic_approval_input_digest', p_input_digest,
      'atomic_approval_calculation_run_id', result ->> 'calculation_run_id')
    where id = review.id returning * into review;
    update public.fo_site_visits set metadata = coalesce(metadata, '{}'::jsonb) || jsonb_build_object(
      'requires_checkout_review', true, 'checkout_review_status', review.status,
      'checkout_review_id', review.id, 'missing_checkout_review_id', review.id,
      'suggested_missing_checkout_km', review.suggested_missing_km,
      'suggested_missing_checkout_amount', review.suggested_amount,
      'suggested_missing_checkout_source', review.calculation_source,
      'suggested_missing_checkout_evidence_quality', review.evidence_quality,
      'suggested_missing_checkout_reason_code', review.reason_code,
      'approved_missing_checkout_km', review.approved_missing_km,
      'approved_missing_checkout_amount', review.approved_amount,
      'approved_missing_checkout_adjustment_km', review.approved_missing_km,
      'approved_missing_checkout_adjustment_amount', review.approved_amount,
      'checkout_review_last_action_at', review.reviewed_at, 'checkout_review_remarks', review.review_remarks,
      'checkout_review_clarification', null), updated_at = now()
    where id = review.site_visit_id and attendance_id = p_attendance_id;
    result := result || jsonb_build_object('review', to_jsonb(review));
  end if;
  return result || jsonb_build_object('total_route_km', route_km,
    'approved_missing_review_count', (select count(*) from public.fo_missing_km_reviews
      where attendance_id = p_attendance_id and status = 'approved'));
end
$function$;

revoke all on function public.rpc_apply_fo_admin_km_correction_v1(uuid,text,timestamptz,jsonb,text,text,uuid,text,jsonb) from public, anon, authenticated;
grant execute on function public.rpc_apply_fo_admin_km_correction_v1(uuid,text,timestamptz,jsonb,text,text,uuid,text,jsonb) to service_role;
commit;
