-- Extend the Supervisor acceptance window used by NIMS contact-created
-- Housekeeping tickets from 2 minutes to 20 minutes.
--
-- This is an override migration. Do not edit migration 056; it is already
-- applied in production.

create or replace function public.hospital_supervisor_acceptance_window()
returns interval language sql immutable as $$
  select interval '20 minutes'
$$;

create or replace function public.hospital_ticket_incoming_body(
  p_block text,
  p_floor text,
  p_area text,
  p_priority text
) returns text language sql immutable as $$
  select concat_ws(E'\n',
    concat_ws(' - ', nullif(p_block,''), nullif(coalesce(p_floor,p_area),''), upper(coalesce(p_priority,'medium'))),
    'Review and accept within 20 minutes if this location is under your responsibility.'
  )
$$;

create or replace function public.hospital_ticket_prepare_assignment()
returns trigger language plpgsql security definer set search_path=public as $$
declare
  v_due timestamptz;
begin
  if new.status_code in ('resolved_awaiting_confirmation','closed','cancelled') then
    new.escalation_due_at := null;
    new.sla_status := case when new.status_code='closed' then 'closed' else 'resolved' end;
    return new;
  end if;

  if tg_op='INSERT' then
    if new.status_code='awaiting_supervisor_acceptance' then
      new.current_escalation_level := 'supervisor';
      new.current_escalation_level_no := 1;
      new.acceptance_status := coalesce(nullif(new.acceptance_status,''),'awaiting');
      new.acceptance_due_at := coalesce(new.acceptance_due_at, now()+public.hospital_supervisor_acceptance_window());
      new.broadcasted_at := coalesce(new.broadcasted_at, now());
      new.supervisor_sla_due_at := coalesce(new.supervisor_sla_due_at, now()+make_interval(mins => public.hospital_ticket_sla_minutes(new.priority, 1)));
      new.escalation_due_at := null;
      new.sla_status := 'running';
      new.final_escalation := false;
      new.metadata := coalesce(new.metadata,'{}'::jsonb) || jsonb_build_object('assignment_state','awaiting_supervisor_acceptance');
    elsif new.current_assignee_user_id is null then
      new.supervisor_sla_due_at := null;
      new.escalation_due_at := null;
      new.sla_status := 'not_applicable';
      new.metadata := coalesce(new.metadata,'{}'::jsonb) || jsonb_build_object(
        'assignment_state','unassigned',
        'assignment_failure_reason',coalesce(new.metadata->>'assignment_failure_reason','no_verified_active_shift_assignment')
      );
    else
      new.assigned_at := coalesce(new.assigned_at, now());
      v_due := new.assigned_at + make_interval(mins => public.hospital_ticket_sla_minutes(new.priority, public.hospital_ticket_level_for_role(new.current_assignee_role)));
      new.escalation_due_at := coalesce(new.escalation_due_at, v_due);
      new.sla_status := 'running';
    end if;
  end if;
  return new;
end $$;

create or replace function public.hospital_ticket_direct_to_operations(
  p_ticket_id uuid,
  p_reason text,
  p_now timestamptz default now()
)
returns public.hospital_tickets language plpgsql security definer set search_path=public as $$
declare
  v_ticket public.hospital_tickets%rowtype;
  v_oe public.hospital_ticket_users%rowtype;
  v_due timestamptz;
begin
  select * into v_ticket from public.hospital_tickets where id = p_ticket_id for update;
  if not found then raise exception 'Ticket not found.' using errcode='P0002'; end if;
  v_oe := public.hospital_ticket_pick_operations_owner(v_ticket.client_id);
  v_due := p_now + make_interval(mins => public.hospital_ticket_sla_minutes(v_ticket.priority, 2));

  update public.hospital_tickets
  set status_code = 'escalated_operations_executive',
      acceptance_status = case when acceptance_status='awaiting' then 'timed_out' else acceptance_status end,
      acceptance_timeout_at = case when acceptance_status='awaiting' then p_now else acceptance_timeout_at end,
      current_assignee_user_id = v_oe.id,
      current_assignee_role = case when v_oe.id is null then null else 'operations_executive' end,
      operations_executive_user_id = v_oe.id,
      current_escalation_level = 'operations_executive',
      current_escalation_level_no = 2,
      assigned_at = p_now,
      operations_sla_due_at = case when v_oe.id is null then null else v_due end,
      escalation_due_at = case when v_oe.id is null then null else v_due end,
      supervisor_sla_due_at = null,
      supervisor_escalated_at = p_now,
      last_escalated_at = p_now,
      escalation_count = case when coalesce(escalation_count,0) = 0 then 1 else escalation_count end,
      sla_status = case when v_oe.id is null then 'blocked' else 'running' end,
      metadata = coalesce(metadata,'{}'::jsonb) || jsonb_build_object('supervisor_acceptance_reason', p_reason),
      version = version + 1,
      updated_at = p_now
  where id = p_ticket_id
  returning * into v_ticket;

  update public.hospital_ticket_notifications
  set action_status = case when action_status='active' then 'timed_out' else action_status end,
      superseded_at = coalesce(superseded_at, p_now),
      superseded_reason = coalesce(superseded_reason, p_reason)
  where ticket_id = p_ticket_id and notification_type = 'incoming_supervisor_ticket';

  perform public.hospital_record_assignment_history(
    p_ticket_id, null, v_oe.id, 'operations_fallback', null, null,
    p_reason, null, 'escalation', 'awaiting_supervisor_acceptance', v_ticket.status_code,
    jsonb_build_object('acceptance_timeout_at', p_now, 'source', 'supervisor_self_assignment')
  );

  insert into public.hospital_ticket_events(ticket_id,event_type,from_status,to_status,actor_name,actor_role,remarks,event_data)
  values(
    p_ticket_id,
    case when p_reason='no_on_duty_supervisor' then 'no_on_duty_supervisor_direct_to_operations' else 'supervisor_acceptance_timed_out' end,
    'awaiting_supervisor_acceptance', v_ticket.status_code, 'QPMS Assignment Engine', 'system',
    case when p_reason='no_on_duty_supervisor'
      then 'No On-Duty Supervisor available; assigned directly to Operations Executive.'
      else 'No Supervisor accepted within 20 minutes.' end,
    jsonb_build_object('reason',p_reason,'acceptance_timeout_at',p_now,'operations_due_at',v_due)
  ) on conflict do nothing;

  if v_oe.id is not null then
    insert into public.hospital_ticket_notifications(ticket_id,recipient_user_id,notification_type,title,body,priority,current_owner_role,escalation_level,metadata)
    values(
      p_ticket_id, v_oe.id, 'supervisor_acceptance_timeout', 'Supervisor Acceptance Timeout',
      'No On-Duty Supervisor accepted Ticket ' || v_ticket.ticket_no || ' within 20 minutes.' || E'\n\nBlock: ' || coalesce(v_ticket.metadata->>'block_name', v_ticket.block_id::text) || E'\nPriority: ' || upper(v_ticket.priority) || E'\n\nImmediate action required.',
      v_ticket.priority, 'operations_executive', 2,
      jsonb_build_object('ticket_id',p_ticket_id,'ticket_no',v_ticket.ticket_no,'priority',v_ticket.priority,'acceptance_status',v_ticket.acceptance_status,'operations_due_at',v_due)
    ) on conflict do nothing;
  end if;

  return v_ticket;
end $$;

create or replace function public.rpc_create_hospital_contact_ticket(
  p_contact_id uuid,
  p_block_id uuid,
  p_location_id uuid,
  p_category_id uuid,
  p_priority text,
  p_title text,
  p_description text,
  p_idempotency_key text,
  p_supervisor_sla_minutes integer default 20,
  p_floor_id uuid default null,
  p_department_id uuid default null,
  p_exact_landmark text default null
)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_contact public.hospital_client_contacts%rowtype;
  v_block public.hospital_blocks%rowtype;
  v_location public.hospital_locations%rowtype;
  v_category public.hospital_ticket_categories%rowtype;
  v_ticket public.hospital_tickets%rowtype;
  v_ticket_no text;
  v_landmark text;
  v_acceptance_due_at timestamptz;
  v_supervisor_due_at timestamptz;
  v_supervisor_count integer := 0;
begin
  select * into v_contact
  from public.hospital_client_contacts
  where id = p_contact_id and is_active = true
  for share;
  if not found then
    raise exception 'Registered client contact required.' using errcode = '42501';
  end if;
  if nullif(btrim(p_idempotency_key), '') is null then
    raise exception 'Idempotency key is required.' using errcode = '22023';
  end if;
  perform pg_advisory_xact_lock(
    hashtextextended(p_contact_id::text || ':' || btrim(p_idempotency_key), 0)
  );
  select * into v_ticket from public.hospital_tickets
    where raised_by_client_contact_id = p_contact_id
      and idempotency_key = btrim(p_idempotency_key);
  if found then
    return jsonb_build_object('ticket', to_jsonb(v_ticket), 'idempotent_replay', true, 'broadcast_count', 0);
  end if;

  select * into v_location from public.hospital_locations
    where id = p_location_id
      and block_id = p_block_id
      and client_id = v_contact.client_id
      and is_active = true;
  if not found then
    raise exception 'Location is outside the registered client.' using errcode = '42501';
  end if;
  if p_floor_id is not null and v_location.floor_id is distinct from p_floor_id then
    raise exception 'Location is outside the selected floor.' using errcode = '42501';
  end if;
  if p_department_id is not null and v_location.department_id is distinct from p_department_id then
    raise exception 'Location is outside the selected department.' using errcode = '42501';
  end if;
  select * into v_block
  from public.hospital_blocks
  where id = p_block_id
    and client_id = v_contact.client_id
    and is_active = true;
  if not found then
    raise exception 'Block is outside the registered client.' using errcode = '42501';
  end if;

  select * into v_category
  from public.hospital_ticket_categories c
  where c.id = p_category_id
    and c.is_active
    and (c.client_id is null or c.client_id = v_contact.client_id);
  if not found then
    raise exception 'Category is unavailable.' using errcode = '22023';
  end if;
  if upper(coalesce(v_category.category_code, '')) <> 'HOUSEKEEPING'
     and lower(coalesce(v_category.category_name, '')) <> 'housekeeping' then
    raise exception 'Registered contact routing is currently configured for Housekeeping tickets only.' using errcode = '22023';
  end if;

  v_landmark := nullif(btrim(coalesce(p_exact_landmark, '')), '');
  v_ticket_no := 'QPMS-HK-' || to_char(timezone('Asia/Kolkata', now()), 'YYYY') || '-' || lpad(nextval('public.hospital_ticket_number_seq')::text, 6, '0');
  v_acceptance_due_at := now() + public.hospital_supervisor_acceptance_window();
  v_supervisor_due_at := now() + make_interval(mins => greatest(1, p_supervisor_sla_minutes));

  insert into public.hospital_tickets (
    ticket_no, client_id, block_id, location_id, category_id,
    raised_by_user_id, raised_by_client_contact_id, raised_by_client_contact_name,
    raised_by_client_contact_mobile, raised_by_client_contact_designation,
    raised_by_client_contact_department, raised_by_name, raised_by_role, floor_name,
    department_name, location_text, title, description, priority,
    status_code, current_assignee_user_id, current_assignee_role,
    supervisor_user_id, assigned_at, supervisor_sla_due_at,
    acceptance_status, acceptance_due_at, broadcasted_at, idempotency_key,
    exact_landmark_snapshot, metadata
  ) values (
    v_ticket_no, v_contact.client_id, p_block_id, p_location_id, p_category_id,
    null, v_contact.id, v_contact.full_name,
    v_contact.normalized_mobile, v_contact.designation,
    v_contact.department, v_contact.full_name, 'client_contact', v_location.floor_name,
    v_location.department_name, v_location.location_name, btrim(p_title),
    btrim(p_description), lower(p_priority),
    'awaiting_supervisor_acceptance', null, null,
    null, null, v_supervisor_due_at,
    'awaiting', v_acceptance_due_at, now(), btrim(p_idempotency_key),
    v_landmark,
    jsonb_build_object(
      'source', 'nims_client_contact_mobile',
      'assignment_source', 'contact_supervisor_broadcast',
      'assignment_state', 'awaiting_supervisor_acceptance',
      'block_name', v_block.block_name,
      'floor_name', v_location.floor_name,
      'area', v_location.location_name,
      'acceptance_window_seconds', 1200
    )
  ) returning * into v_ticket;

  insert into public.hospital_ticket_events(ticket_id, event_type, to_status, actor_user_id, actor_name, actor_role, remarks, event_data)
    values (
      v_ticket.id, 'ticket_created', v_ticket.status_code, null,
      v_contact.full_name, 'client_contact', 'Housekeeping complaint created by registered NIMS contact.',
      jsonb_build_object('client_contact_id', v_contact.id)
    );

  insert into public.hospital_ticket_notifications(
    ticket_id, recipient_user_id, notification_type, title, body, priority,
    current_owner_role, escalation_level, action_status, action_expires_at, metadata
  )
  select
    v_ticket.id,
    u.id,
    'incoming_supervisor_ticket',
    'New Housekeeping Ticket',
    concat_ws(E'\n',
      upper(coalesce(v_block.block_name, 'Block not specified')),
      nullif(v_location.floor_name, ''),
      nullif(v_location.location_name, ''),
      'Priority: ' || upper(v_ticket.priority),
      'Ticket: ' || v_ticket.ticket_no
    ),
    v_ticket.priority,
    'housekeeping_supervisor',
    1,
    'active',
    v_acceptance_due_at,
    jsonb_build_object(
      'ticket_id', v_ticket.id,
      'ticket_no', v_ticket.ticket_no,
      'priority', v_ticket.priority,
      'block', v_block.block_name,
      'floor', v_location.floor_name,
      'area', v_location.location_name,
      'complaint_type', v_category.category_name,
      'description', v_ticket.description,
      'raised_at', v_ticket.raised_at,
      'raised_by_name', v_ticket.raised_by_name,
      'acceptance_due_at', v_acceptance_due_at,
      'acceptance_status', 'awaiting',
      'target_screen', 'incoming_ticket',
      'app_scope', 'myqpms_internal'
    )
  from public.hospital_ticket_on_duty_supervisors(v_contact.client_id, p_block_id, p_location_id) u
  on conflict do nothing;

  get diagnostics v_supervisor_count = row_count;
  insert into public.hospital_ticket_events(ticket_id, event_type, from_status, to_status, actor_name, actor_role, remarks, event_data)
    values (
      v_ticket.id,
      'supervisor_broadcast_created',
      'awaiting_supervisor_acceptance',
      'awaiting_supervisor_acceptance',
      'QPMS Assignment Engine',
      'system',
      case when v_supervisor_count = 0
        then 'No on-duty Housekeeping Supervisor was available when the ticket was raised.'
        else 'Incoming ticket broadcast to on-duty Housekeeping Supervisors.'
      end,
      jsonb_build_object(
        'broadcast_count', v_supervisor_count,
        'acceptance_due_at', v_acceptance_due_at,
        'supervisor_sla_due_at', v_supervisor_due_at
      )
    )
  on conflict do nothing;

  return jsonb_build_object(
    'ticket', to_jsonb(v_ticket),
    'idempotent_replay', false,
    'broadcast_count', v_supervisor_count
  );
end $$;

revoke all on function public.rpc_create_hospital_contact_ticket(uuid,uuid,uuid,uuid,text,text,text,text,integer,uuid,uuid,text)
  from public, anon, authenticated;
grant execute on function public.rpc_create_hospital_contact_ticket(uuid,uuid,uuid,uuid,text,text,text,text,integer,uuid,uuid,text)
  to service_role;
