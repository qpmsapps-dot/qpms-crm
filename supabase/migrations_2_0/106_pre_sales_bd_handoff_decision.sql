-- Atomic Business Development acceptance/rejection of a pending Pre-Sales handoff.
begin;

create or replace function public.rpc_decide_pre_sales_handoff(
  p_handoff_id uuid,
  p_actor_profile_id uuid,
  p_decision text,
  p_rejection_reason text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $function$
declare
  v_handoff public.lead_handoffs%rowtype;
  v_actor public.profiles%rowtype;
  v_now timestamptz := now();
  v_decision text := lower(btrim(coalesce(p_decision, '')));
  v_reason text := nullif(btrim(coalesce(p_rejection_reason, '')), '');
begin
  if v_decision not in ('accepted', 'rejected') then
    raise exception using errcode = '22023', message = 'invalid_handoff_decision';
  end if;
  if v_decision = 'rejected' and v_reason is null then
    raise exception using errcode = '22023', message = 'handoff_rejection_reason_required';
  end if;

  select * into v_actor
  from public.profiles
  where id = p_actor_profile_id
    and is_active is true
    and lower(coalesce(status, 'active')) = 'active';
  if not found or v_actor.role not in ('BD Executive', 'BD Head') then
    raise exception using errcode = '42501', message = 'handoff_actor_not_authorized';
  end if;

  select * into v_handoff
  from public.lead_handoffs
  where id = p_handoff_id
  for update;
  if not found then
    raise exception using errcode = 'P0002', message = 'handoff_not_found';
  end if;
  if v_handoff.handoff_status <> 'pending' then
    raise exception using errcode = '40001', message = 'handoff_already_decided';
  end if;
  if v_handoff.to_profile_id <> p_actor_profile_id then
    raise exception using errcode = '42501', message = 'handoff_not_assigned_to_actor';
  end if;

  update public.lead_handoffs
  set handoff_status = v_decision,
      accepted_at = case when v_decision = 'accepted' then v_now else null end,
      rejected_at = case when v_decision = 'rejected' then v_now else null end,
      rejection_reason = case when v_decision = 'rejected' then v_reason else null end,
      metadata = coalesce(metadata, '{}'::jsonb) || jsonb_build_object(
        'decision_actor_profile_id', p_actor_profile_id,
        'decision_at', v_now
      )
  where id = v_handoff.id;

  if v_decision = 'accepted' then
    update public.leads
    set pre_sales_stage = 'bd_accepted',
        last_activity_at = v_now,
        updated_at = v_now
    where id = v_handoff.lead_id;
  else
    update public.leads
    set pre_sales_stage = 'qualification',
        last_activity_at = v_now,
        updated_at = v_now
    where id = v_handoff.lead_id
      and pre_sales_stage = 'pending_bd_handover';
  end if;

  insert into public.activity_logs (
    lead_id, activity_type, activity_message, created_by, metadata
  ) values (
    v_handoff.lead_id,
    case when v_decision = 'accepted' then 'BD Handover Accepted' else 'BD Handover Rejected' end,
    case when v_decision = 'accepted' then 'Business Development accepted the handover' else 'Business Development rejected the handover' end,
    coalesce(v_actor.full_name, v_actor.employee_code, 'Business Development'),
    jsonb_build_object(
      'handoff_id', v_handoff.id,
      'decision', v_decision,
      'actor_profile_id', p_actor_profile_id,
      'rejection_reason', v_reason
    )
  );

  return jsonb_build_object(
    'handoff_id', v_handoff.id,
    'lead_id', v_handoff.lead_id,
    'status', v_decision,
    'decided_at', v_now
  );
end
$function$;

revoke all on function public.rpc_decide_pre_sales_handoff(uuid, uuid, text, text) from public, anon, authenticated;
grant execute on function public.rpc_decide_pre_sales_handoff(uuid, uuid, text, text) to service_role;

comment on function public.rpc_decide_pre_sales_handoff(uuid, uuid, text, text) is
  'Service-role-only atomic BD decision for a pending Pre-Sales handoff.';

commit;
