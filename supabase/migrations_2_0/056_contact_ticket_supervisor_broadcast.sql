-- Broadcast registered-contact Housekeeping tickets to all on-duty NIMS
-- Housekeeping Supervisors. Tickets remain unassigned until a supervisor
-- accepts through the existing atomic supervisor acceptance RPC.

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
  v_acceptance_due_at := now() + interval '2 minutes';
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
      'acceptance_window_seconds', 120
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
