begin;

-- Align NIMS Hospital Ticketing with the approved operational escalation flow:
--
--   Housekeeping Supervisor
--     -> 20 minutes unresolved
--   Operations Executive
--     -> 20 minutes unresolved
--   Facility Manager
--     -> 20 minutes unresolved
--   Project Head
--     -> final / stop
--
-- Acceptance remains a separate acknowledgement concept, but the current
-- production acceptance-timeout processor moves the ticket to the next
-- operational role. To avoid exposing higher roles before the 20-minute
-- unresolved-work deadline, the NIMS acceptance window is aligned to the same
-- 20-minute operational window. This migration does not remove acceptance.
--
-- Scope:
--   * Adds NIMS/client-specific SLA overrides instead of changing the shared
--     global priority matrix.
--   * Uses the NIMS-specific 20-minute work SLA when computing current-level
--     and next-level due timestamps.
--   * Preserves normal escalation stop at level 4/project_head.
--
-- This migration does not modify existing tickets, users, Auth, passwords,
-- notifications, RLS policies, role hierarchy, or the global SLA matrix rows.

alter table public.hospital_tickets
  add column if not exists facility_manager_sla_due_at timestamptz;

create table if not exists public.hospital_ticket_client_sla_overrides (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references public.hospital_clients(id) on delete cascade,
  priority text not null,
  escalation_level integer not null,
  owner_role text not null,
  sla_minutes integer not null,
  is_active boolean not null default true,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint hospital_ticket_client_sla_overrides_priority_check
    check (priority in ('low', 'medium', 'critical')),
  constraint hospital_ticket_client_sla_overrides_level_check
    check (escalation_level between 1 and 4),
  constraint hospital_ticket_client_sla_overrides_owner_role_check
    check (owner_role in (
      'housekeeping_supervisor',
      'operations_executive',
      'facility_manager',
      'project_head'
    )),
  constraint hospital_ticket_client_sla_overrides_minutes_check
    check (sla_minutes > 0),
  constraint hospital_ticket_client_sla_overrides_unique
    unique (client_id, priority, escalation_level)
);

alter table public.hospital_ticket_client_sla_overrides enable row level security;

revoke all on table public.hospital_ticket_client_sla_overrides from public, anon, authenticated;
grant select, insert, update, delete on table public.hospital_ticket_client_sla_overrides to service_role;

do $$
declare
  v_expected_nims_client_id constant uuid := 'bfb5d707-1a4e-451d-af1f-11b7c0aeeb66';
  v_nims_client_id uuid;
  v_nims_count integer;
begin
  select count(*)
  into v_nims_count
  from public.hospital_clients
  where is_active = true
    and id = v_expected_nims_client_id
    and upper(coalesce(client_code, '')) = 'NIMS_HYDERABAD';

  if v_nims_count <> 1 then
    raise exception
      'Expected exactly one active NIMS_HYDERABAD hospital client with id %, found %.',
      v_expected_nims_client_id,
      v_nims_count;
  end if;

  v_nims_client_id := v_expected_nims_client_id;

  insert into public.hospital_ticket_client_sla_overrides (
    client_id,
    priority,
    escalation_level,
    owner_role,
    sla_minutes,
    is_active,
    metadata
  )
  values
    (v_nims_client_id, 'critical', 1, 'housekeeping_supervisor', 20, true, '{"source":"nims_resolution_sla_20_minutes"}'),
    (v_nims_client_id, 'critical', 2, 'operations_executive', 20, true, '{"source":"nims_resolution_sla_20_minutes"}'),
    (v_nims_client_id, 'critical', 3, 'facility_manager', 20, true, '{"source":"nims_resolution_sla_20_minutes"}'),
    (v_nims_client_id, 'critical', 4, 'project_head', 20, true, '{"source":"nims_resolution_sla_20_minutes"}'),
    (v_nims_client_id, 'medium', 1, 'housekeeping_supervisor', 20, true, '{"source":"nims_resolution_sla_20_minutes"}'),
    (v_nims_client_id, 'medium', 2, 'operations_executive', 20, true, '{"source":"nims_resolution_sla_20_minutes"}'),
    (v_nims_client_id, 'medium', 3, 'facility_manager', 20, true, '{"source":"nims_resolution_sla_20_minutes"}'),
    (v_nims_client_id, 'medium', 4, 'project_head', 20, true, '{"source":"nims_resolution_sla_20_minutes"}'),
    (v_nims_client_id, 'low', 1, 'housekeeping_supervisor', 20, true, '{"source":"nims_resolution_sla_20_minutes"}'),
    (v_nims_client_id, 'low', 2, 'operations_executive', 20, true, '{"source":"nims_resolution_sla_20_minutes"}'),
    (v_nims_client_id, 'low', 3, 'facility_manager', 20, true, '{"source":"nims_resolution_sla_20_minutes"}'),
    (v_nims_client_id, 'low', 4, 'project_head', 20, true, '{"source":"nims_resolution_sla_20_minutes"}')
  on conflict (client_id, priority, escalation_level) do update
  set owner_role = excluded.owner_role,
      sla_minutes = excluded.sla_minutes,
      is_active = true,
      metadata = excluded.metadata,
      updated_at = now();
end $$;

create or replace function public.hospital_ticket_sla_minutes_for_client(
  p_client_id uuid,
  p_priority text,
  p_level integer
)
returns integer
language plpgsql
stable
set search_path=public
as $$
declare
  v_priority text;
  v_minutes integer;
begin
  v_priority := case lower(coalesce(p_priority, 'medium'))
    when 'high' then 'critical'
    when 'critical' then 'critical'
    when 'low' then 'low'
    else 'medium'
  end;

  select o.sla_minutes
  into v_minutes
  from public.hospital_ticket_client_sla_overrides o
  where o.client_id = p_client_id
    and o.priority = v_priority
    and o.escalation_level = p_level
    and o.is_active = true
  limit 1;

  if v_minutes is not null then
    return v_minutes;
  end if;

  return public.hospital_ticket_sla_minutes(p_priority, p_level);
end $$;

create or replace function public.hospital_ticket_acceptance_window_for_client(
  p_client_id uuid
)
returns interval
language sql
stable
set search_path=public
as $$
  select case
    when exists (
      select 1
      from public.hospital_ticket_client_sla_overrides o
      where o.client_id = p_client_id
        and o.is_active = true
        and o.metadata->>'source' = 'nims_resolution_sla_20_minutes'
    )
      then interval '20 minutes'
    else public.hospital_escalation_acceptance_window()
  end
$$;

create or replace function public.hospital_ticket_prepare_assignment()
returns trigger
language plpgsql
security definer
set search_path=public
as $$
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
      new.acceptance_due_at := coalesce(new.acceptance_due_at, now()+public.hospital_ticket_acceptance_window_for_client(new.client_id));
      new.broadcasted_at := coalesce(new.broadcasted_at, now());
      new.supervisor_sla_due_at := coalesce(
        new.supervisor_sla_due_at,
        now()+make_interval(mins => public.hospital_ticket_sla_minutes_for_client(new.client_id, new.priority, 1))
      );
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
      v_due := new.assigned_at + make_interval(
        mins => public.hospital_ticket_sla_minutes_for_client(
          new.client_id,
          new.priority,
          public.hospital_ticket_level_for_role(new.current_assignee_role)
        )
      );
      new.escalation_due_at := coalesce(new.escalation_due_at, v_due);
      new.sla_status := 'running';
    end if;
  end if;

  return new;
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
  v_supervisor_minutes integer;
  v_priority text;
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

  v_priority := case lower(coalesce(p_priority, 'medium'))
    when 'high' then 'critical'
    when 'critical' then 'critical'
    when 'low' then 'low'
    else 'medium'
  end;
  select o.sla_minutes
  into v_supervisor_minutes
  from public.hospital_ticket_client_sla_overrides o
  where o.client_id = v_contact.client_id
    and o.priority = v_priority
    and o.escalation_level = 1
    and o.is_active = true
  limit 1;

  v_landmark := nullif(btrim(coalesce(p_exact_landmark, '')), '');
  v_ticket_no := 'QPMS-HK-' || to_char(timezone('Asia/Kolkata', now()), 'YYYY') || '-' || lpad(nextval('public.hospital_ticket_number_seq')::text, 6, '0');
  v_acceptance_due_at := now() + public.hospital_ticket_acceptance_window_for_client(v_contact.client_id);
  v_supervisor_due_at := now() + make_interval(mins => greatest(1, coalesce(v_supervisor_minutes, p_supervisor_sla_minutes)));

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
      'acceptance_window_seconds', extract(epoch from public.hospital_ticket_acceptance_window_for_client(v_contact.client_id))::integer
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

create or replace function public.hospital_ticket_escalate_to_acceptance_level(
  p_ticket_id uuid,
  p_from_level integer,
  p_reason text,
  p_now timestamptz default now()
)
returns public.hospital_tickets
language plpgsql
security definer
set search_path=public
as $$
declare
  v_ticket public.hospital_tickets%rowtype;
  v_assignee public.hospital_ticket_users%rowtype;
  v_next_level integer;
  v_next_role text;
  v_next_status text;
  v_acceptance_due timestamptz;
  v_work_due timestamptz;
  v_missed_event text;
begin
  select * into v_ticket
  from public.hospital_tickets
  where id = p_ticket_id
  for update;
  if not found then
    raise exception 'Ticket not found.' using errcode='P0002';
  end if;

  v_next_level := greatest(1, coalesce(p_from_level, 1)) + 1;
  while v_next_level <= 4 loop
    v_next_role := public.hospital_ticket_role_for_level(v_next_level);
    v_assignee := public.hospital_pick_ticket_owner(v_ticket.client_id, v_next_role);
    exit when v_assignee.id is not null;
    v_next_level := v_next_level + 1;
  end loop;

  v_missed_event := case greatest(1, coalesce(p_from_level, 1))
    when 1 then 'supervisor_acceptance_missed'
    when 2 then 'operations_executive_acceptance_missed'
    when 3 then 'facility_manager_acceptance_missed'
    else 'acceptance_missed'
  end;

  if v_assignee.id is null then
    update public.hospital_tickets
    set acceptance_status = case when acceptance_status='awaiting' then 'timed_out' else acceptance_status end,
        acceptance_timeout_at = case when acceptance_status='awaiting' then p_now else acceptance_timeout_at end,
        acceptance_due_at = null,
        escalation_due_at = null,
        sla_status = 'blocked',
        metadata = coalesce(metadata,'{}'::jsonb) || jsonb_build_object(
          'assignment_state','escalation_blocked',
          'assignment_failure_reason','no_active_higher_escalation_role',
          'assignment_failed_at',p_now,
          'blocked_after_level',greatest(1, coalesce(p_from_level, 1))
        ),
        version = version + 1,
        updated_at = p_now
    where id = p_ticket_id
    returning * into v_ticket;

    insert into public.hospital_ticket_events(ticket_id,event_type,from_status,to_status,actor_name,actor_role,remarks,event_data)
    values(
      p_ticket_id,
      'higher_escalation_assignment_missing',
      v_ticket.status_code,
      v_ticket.status_code,
      'QPMS SLA Engine',
      'system',
      'No active higher Hospital escalation role is mapped.',
      jsonb_build_object('reason',p_reason,'from_level',p_from_level,'failed_at',p_now)
    )
    on conflict do nothing;
    return v_ticket;
  end if;

  v_next_status := public.hospital_ticket_status_for_level(v_next_level, v_ticket.status_code);
  v_acceptance_due := p_now + public.hospital_ticket_acceptance_window_for_client(v_ticket.client_id);
  v_work_due := p_now + make_interval(
    mins => public.hospital_ticket_sla_minutes_for_client(v_ticket.client_id, v_ticket.priority, v_next_level)
  );

  update public.hospital_ticket_notifications
  set action_status = case when action_status='active' then 'timed_out' else action_status end,
      superseded_at = coalesce(superseded_at, p_now),
      superseded_reason = coalesce(superseded_reason, p_reason)
  where ticket_id = p_ticket_id
    and notification_type in ('incoming_supervisor_ticket','sla_escalation','supervisor_acceptance_timeout')
    and action_status = 'active';

  update public.hospital_tickets
  set status_code = v_next_status,
      acceptance_status = 'awaiting',
      acceptance_due_at = v_acceptance_due,
      acceptance_timeout_at = null,
      accepted_by_user_id = null,
      current_escalation_level = public.hospital_ticket_level_code(v_next_level),
      current_escalation_level_no = v_next_level,
      current_assignee_user_id = v_assignee.id,
      current_assignee_role = v_next_role,
      assigned_at = p_now,
      operations_executive_user_id = case when v_next_role='operations_executive' then v_assignee.id else operations_executive_user_id end,
      facility_manager_user_id = case when v_next_role='facility_manager' then v_assignee.id else facility_manager_user_id end,
      project_head_user_id = case when v_next_role='project_head' then v_assignee.id else project_head_user_id end,
      supervisor_sla_due_at = case when p_from_level=1 then null else supervisor_sla_due_at end,
      supervisor_escalated_at = case when p_from_level=1 then coalesce(supervisor_escalated_at,p_now) else supervisor_escalated_at end,
      operations_sla_due_at = case
        when v_next_level=2 then v_work_due
        when p_from_level=2 then null
        else operations_sla_due_at
      end,
      operations_escalated_at = case when p_from_level=2 then coalesce(operations_escalated_at,p_now) else operations_escalated_at end,
      facility_manager_sla_due_at = case
        when v_next_level=3 then v_work_due
        when p_from_level=3 then null
        else facility_manager_sla_due_at
      end,
      facility_manager_escalated_at = case when p_from_level=3 then coalesce(facility_manager_escalated_at,p_now) else facility_manager_escalated_at end,
      project_head_sla_due_at = case when v_next_level=4 then v_work_due else project_head_sla_due_at end,
      project_head_escalated_at = case when v_next_level=4 then p_now else project_head_escalated_at end,
      escalation_due_at = v_work_due,
      last_escalated_at = p_now,
      escalation_count = coalesce(escalation_count,0) + 1,
      final_escalation = v_next_level = 4,
      sla_status = 'running',
      metadata = (coalesce(metadata,'{}'::jsonb)-'assignment_failure_reason') || jsonb_build_object(
        'assignment_state','awaiting_acceptance',
        'acceptance_sla_minutes',20,
        'acceptance_due_at',v_acceptance_due,
        'work_sla_due_at',v_work_due,
        'last_escalation_from',public.hospital_ticket_level_code(greatest(1, coalesce(p_from_level, 1))),
        'last_escalation_to',public.hospital_ticket_level_code(v_next_level),
        'last_escalation_reason',p_reason
      ),
      version = version + 1,
      updated_at = p_now
  where id = p_ticket_id
  returning * into v_ticket;

  perform public.hospital_record_assignment_history(
    p_ticket_id,
    null,
    v_assignee.id,
    'acceptance_escalation',
    null,
    null,
    p_reason,
    null,
    'escalation',
    null,
    v_next_status,
    jsonb_build_object(
      'from_level',p_from_level,
      'to_level',v_next_level,
      'acceptance_due_at',v_acceptance_due,
      'work_due_at',v_work_due
    )
  );

  insert into public.hospital_ticket_events(ticket_id,event_type,from_status,to_status,actor_name,actor_role,remarks,event_data)
  values(
    p_ticket_id,
    v_missed_event,
    v_ticket.status_code,
    v_ticket.status_code,
    'QPMS SLA Engine',
    'system',
    'Acceptance and unresolved-work window expired.',
    jsonb_build_object('reason',p_reason,'from_level',p_from_level,'to_level',v_next_level,'expired_at',p_now)
  )
  on conflict do nothing;

  insert into public.hospital_ticket_events(ticket_id,event_type,from_status,to_status,actor_name,actor_role,remarks,event_data)
  values(
    p_ticket_id,
    case when v_next_level=4 then 'project_head_assigned' else 'ticket_escalated' end,
    v_ticket.status_code,
    v_next_status,
    'QPMS SLA Engine',
    'system',
    'Escalated to ' || public.hospital_ticket_role_label(v_next_role) || ' after 20-minute unresolved-work SLA.',
    jsonb_build_object('reason',p_reason,'to_level',v_next_level,'acceptance_due_at',v_acceptance_due,'work_due_at',v_work_due)
  )
  on conflict do nothing;

  insert into public.hospital_ticket_notifications(
    ticket_id,recipient_user_id,notification_type,title,body,priority,
    current_owner_role,escalation_level,action_status,action_expires_at,metadata
  )
  values(
    p_ticket_id,
    v_assignee.id,
    case when v_next_level=2 and p_reason in ('supervisor_acceptance_timeout','no_on_duty_supervisor')
      then 'supervisor_acceptance_timeout'
      else 'sla_escalation'
    end,
    public.hospital_ticket_role_label(v_next_role) || ' action required',
    v_ticket.ticket_no || ' requires ' || public.hospital_ticket_role_label(v_next_role) || ' action after the 20-minute unresolved-work SLA.',
    v_ticket.priority,
    v_next_role,
    v_next_level,
    'active',
    v_acceptance_due,
    jsonb_build_object(
      'ticket_id',p_ticket_id,
      'ticket_no',v_ticket.ticket_no,
      'priority',v_ticket.priority,
      'target_screen','ticket_detail',
      'app_scope','myqpms_internal',
      'acceptance_due_at',v_acceptance_due,
      'acceptance_sla_minutes',20,
      'work_sla_due_at',v_work_due,
      'work_sla_minutes',20,
      'current_owner_role',v_next_role,
      'escalation_level',v_next_level
    )
  )
  on conflict do nothing;

  return v_ticket;
end $$;

create or replace function public.rpc_accept_hospital_escalation_ticket(
  p_ticket_id uuid,
  p_actor_user_id uuid,
  p_expected_version integer,
  p_now timestamptz default now()
)
returns jsonb
language plpgsql
security definer
set search_path=public
as $$
declare
  v_ticket public.hospital_tickets%rowtype;
  v_actor public.hospital_ticket_users%rowtype;
  v_level integer;
  v_work_due timestamptz;
begin
  select * into v_actor
  from public.hospital_ticket_users
  where id = p_actor_user_id
    and is_active
    and profile_type = 'internal'
  for share;
  if not found or v_actor.role_code not in ('operations_executive','facility_manager','project_head') then
    raise exception 'Active internal escalation actor required.' using errcode='42501';
  end if;

  select * into v_ticket
  from public.hospital_tickets
  where id = p_ticket_id
  for update;
  if not found then raise exception 'Ticket not found.' using errcode='P0002'; end if;
  if v_ticket.version <> p_expected_version then raise exception 'Ticket version conflict.' using errcode='40001'; end if;
  if v_ticket.client_id <> v_actor.client_id then raise exception 'Cross-client acceptance denied.' using errcode='42501'; end if;
  if v_ticket.acceptance_status <> 'awaiting' then
    raise exception 'This ticket is not awaiting escalation acceptance.' using errcode='40001';
  end if;
  if v_ticket.acceptance_due_at is null or v_ticket.acceptance_due_at <= p_now then
    raise exception 'The escalation acceptance window has expired.' using errcode='40001';
  end if;
  if not (
    (v_actor.role_code='operations_executive' and v_ticket.status_code='escalated_operations_executive')
    or (v_actor.role_code='facility_manager' and v_ticket.status_code='escalated_facility_manager')
    or (v_actor.role_code='project_head' and v_ticket.status_code='escalated_project_head')
  ) then
    raise exception 'This escalation level is not assigned to this role.' using errcode='42501';
  end if;
  if v_ticket.current_assignee_user_id is not null and v_ticket.current_assignee_user_id <> v_actor.id then
    raise exception 'This ticket is assigned to another internal owner.' using errcode='42501';
  end if;
  if not exists (
    select 1 from public.hospital_ticket_user_scopes s
    where s.hospital_ticket_user_id = v_actor.id
      and s.client_id = v_ticket.client_id
      and s.can_update
      and (
        s.scope_type='client'
        or (s.scope_type='block' and s.block_id=v_ticket.block_id)
        or (s.scope_type='location' and s.location_id=v_ticket.location_id)
      )
  ) then
    raise exception 'Ticket acceptance is outside the actor scope.' using errcode='42501';
  end if;

  v_level := public.hospital_ticket_level_for_role(v_actor.role_code);
  v_work_due := case
    when v_level = 2 then coalesce(
      v_ticket.operations_sla_due_at,
      v_ticket.assigned_at + make_interval(mins => public.hospital_ticket_sla_minutes_for_client(v_ticket.client_id, v_ticket.priority, v_level)),
      p_now + make_interval(mins => public.hospital_ticket_sla_minutes_for_client(v_ticket.client_id, v_ticket.priority, v_level))
    )
    when v_level = 3 then coalesce(
      v_ticket.facility_manager_sla_due_at,
      v_ticket.assigned_at + make_interval(mins => public.hospital_ticket_sla_minutes_for_client(v_ticket.client_id, v_ticket.priority, v_level)),
      p_now + make_interval(mins => public.hospital_ticket_sla_minutes_for_client(v_ticket.client_id, v_ticket.priority, v_level))
    )
    when v_level = 4 then coalesce(
      v_ticket.project_head_sla_due_at,
      v_ticket.assigned_at + make_interval(mins => public.hospital_ticket_sla_minutes_for_client(v_ticket.client_id, v_ticket.priority, v_level)),
      p_now + make_interval(mins => public.hospital_ticket_sla_minutes_for_client(v_ticket.client_id, v_ticket.priority, v_level))
    )
    else p_now + make_interval(mins => public.hospital_ticket_sla_minutes_for_client(v_ticket.client_id, v_ticket.priority, v_level))
  end;

  update public.hospital_ticket_notifications
  set action_status = case when action_status='active' then 'accepted' else action_status end,
      superseded_at = coalesce(superseded_at, p_now),
      superseded_reason = coalesce(superseded_reason, 'accepted_by_escalation_owner')
  where ticket_id = p_ticket_id
    and recipient_user_id = v_actor.id
    and notification_type in ('sla_escalation','supervisor_acceptance_timeout')
    and action_status = 'active';

  update public.hospital_tickets
  set acceptance_status = 'accepted',
      accepted_at = coalesce(accepted_at, p_now),
      accepted_by_user_id = v_actor.id,
      current_assignee_user_id = v_actor.id,
      current_assignee_role = v_actor.role_code,
      assigned_at = coalesce(assigned_at, p_now),
      escalation_due_at = v_work_due,
      operations_sla_due_at = case when v_level=2 then v_work_due else operations_sla_due_at end,
      facility_manager_sla_due_at = case when v_level=3 then v_work_due else facility_manager_sla_due_at end,
      project_head_sla_due_at = case when v_level=4 then v_work_due else project_head_sla_due_at end,
      sla_status = case when v_level=4 then 'final_owner' else 'running' end,
      final_escalation = v_level=4,
      metadata = coalesce(metadata,'{}'::jsonb) || jsonb_build_object(
        'assignment_state','accepted',
        'accepted_escalation_level',v_level,
        'accepted_at',p_now,
        'work_sla_due_at',v_work_due
      ),
      version = version + 1,
      updated_at = p_now
  where id = p_ticket_id
  returning * into v_ticket;

  insert into public.hospital_ticket_events(ticket_id,event_type,from_status,to_status,actor_user_id,actor_name,actor_role,remarks,event_data)
  values(
    p_ticket_id,
    'escalation_acceptance_accepted',
    v_ticket.status_code,
    v_ticket.status_code,
    v_actor.id,
    v_actor.display_name,
    v_actor.role_code,
    public.hospital_ticket_role_label(v_actor.role_code) || ' accepted the escalation.',
    jsonb_build_object('accepted_at',p_now,'acceptance_due_at',v_ticket.acceptance_due_at,'work_due_at',v_work_due)
  )
  on conflict do nothing;

  return jsonb_build_object('ticket',to_jsonb(v_ticket),'accepted_by',jsonb_build_object('id',v_actor.id,'display_name',v_actor.display_name));
end $$;

create or replace function public.rpc_process_hospital_ticket_sla_day2_only(
  p_now timestamptz default now(),
  p_operations_sla_minutes integer default 30
)
returns jsonb
language plpgsql
security definer
set search_path=public
as $$
declare
  v_ticket public.hospital_tickets%rowtype;
  v_assignee public.hospital_ticket_users%rowtype;
  v_level integer;
  v_next_level integer;
  v_next_role text;
  v_next_status text;
  v_due timestamptz;
  v_missed_event text;
  v_count_supervisor int := 0;
  v_count_operations int := 0;
  v_count_facility int := 0;
  v_count_project_head int := 0;
  v_assignment_failures int := 0;
begin
  for v_ticket in
    select *
    from public.hospital_tickets
    where status_code not in ('awaiting_supervisor_acceptance','resolved_awaiting_confirmation','closed','cancelled')
      and coalesce(acceptance_status,'not_required') <> 'awaiting'
      and coalesce(final_escalation, false) = false
      and current_assignee_user_id is not null
      and coalesce(escalation_due_at, supervisor_sla_due_at, operations_sla_due_at, facility_manager_sla_due_at, project_head_sla_due_at) is not null
      and coalesce(escalation_due_at, supervisor_sla_due_at, operations_sla_due_at, facility_manager_sla_due_at, project_head_sla_due_at) <= p_now
    for update skip locked
  loop
    v_level := greatest(1, least(4, coalesce(v_ticket.current_escalation_level_no, public.hospital_ticket_level_for_role(v_ticket.current_assignee_role), 1)));
    if v_level >= 4 then
      update public.hospital_tickets
      set sla_status='final_owner',
          final_escalation=true,
          version=version+1,
          updated_at=p_now
      where id=v_ticket.id;
      continue;
    end if;
    v_next_level := v_level + 1;
    v_next_role := public.hospital_ticket_role_for_level(v_next_level);
    v_next_status := public.hospital_ticket_status_for_level(v_next_level, v_ticket.status_code);
    v_due := p_now + make_interval(
      mins => public.hospital_ticket_sla_minutes_for_client(v_ticket.client_id, v_ticket.priority, v_next_level)
    );
    v_missed_event := case v_level when 1 then 'supervisor_sla_missed' when 2 then 'operations_executive_sla_missed' when 3 then 'facility_manager_sla_missed' else 'sla_missed' end;
    v_assignee := public.hospital_pick_ticket_owner(v_ticket.client_id, v_next_role);
    if v_assignee.id is null then
      update public.hospital_tickets
      set escalation_due_at=null,
          sla_status='blocked',
          version=version+1,
          updated_at=p_now
      where id=v_ticket.id;
      v_assignment_failures := v_assignment_failures + 1;
      continue;
    end if;
    update public.hospital_tickets
    set status_code=v_next_status,
        current_escalation_level=public.hospital_ticket_level_code(v_next_level),
        current_escalation_level_no=v_next_level,
        current_assignee_user_id=v_assignee.id,
        current_assignee_role=v_next_role,
        assigned_at=p_now,
        operations_executive_user_id=case when v_next_role='operations_executive' then v_assignee.id else operations_executive_user_id end,
        facility_manager_user_id=case when v_next_role='facility_manager' then v_assignee.id else facility_manager_user_id end,
        project_head_user_id=case when v_next_role='project_head' then v_assignee.id else project_head_user_id end,
        supervisor_sla_due_at=case when v_level=1 then null else supervisor_sla_due_at end,
        operations_sla_due_at=case when v_next_level=2 then v_due when v_level=2 then null else operations_sla_due_at end,
        facility_manager_sla_due_at=case when v_next_level=3 then v_due when v_level=3 then null else facility_manager_sla_due_at end,
        project_head_sla_due_at=case when v_next_level=4 then v_due else project_head_sla_due_at end,
        escalation_due_at=v_due,
        last_escalated_at=p_now,
        escalation_count=coalesce(escalation_count,0)+1,
        final_escalation=v_next_level=4,
        sla_status=case when v_next_level=4 then 'final_owner' else 'running' end,
        version=version+1,
        updated_at=p_now
    where id=v_ticket.id;
    insert into public.hospital_ticket_events(ticket_id,event_type,from_status,to_status,actor_name,actor_role,remarks,event_data)
    values(v_ticket.id,v_missed_event,v_ticket.status_code,v_ticket.status_code,'QPMS SLA Engine','system',
      public.hospital_ticket_role_label(v_ticket.current_assignee_role) || ' SLA missed.',
      jsonb_build_object('sla_cycle',v_ticket.reopen_count,'from_level',v_level,'to_level',v_next_level))
    on conflict do nothing;
    insert into public.hospital_ticket_events(ticket_id,event_type,from_status,to_status,actor_name,actor_role,remarks,event_data)
    values(v_ticket.id,case when v_next_level=4 then 'project_head_assigned' else 'ticket_escalated' end,
      v_ticket.status_code,v_next_status,'QPMS SLA Engine','system',
      'Escalated to ' || public.hospital_ticket_role_label(v_next_role) || '.',
      jsonb_build_object('sla_cycle',v_ticket.reopen_count,'from_level',v_level,'to_level',v_next_level,'due_at',v_due))
    on conflict do nothing;
    insert into public.hospital_ticket_notifications(ticket_id,recipient_user_id,notification_type,title,body,priority,current_owner_role,escalation_level)
    values(v_ticket.id,v_assignee.id,'sla_escalation',public.hospital_ticket_role_label(v_ticket.current_assignee_role) || ' SLA missed',
      v_ticket.ticket_no || ' requires ' || public.hospital_ticket_role_label(v_next_role) || ' action.',
      v_ticket.priority,v_next_role,v_next_level);
    if v_level = 1 then v_count_supervisor := v_count_supervisor + 1; elsif v_level = 2 then v_count_operations := v_count_operations + 1; elsif v_level = 3 then v_count_facility := v_count_facility + 1; end if;
    if v_next_level = 4 then v_count_project_head := v_count_project_head + 1; end if;
  end loop;
  return jsonb_build_object('supervisor_escalations',v_count_supervisor,'operations_escalations',v_count_operations,'facility_manager_escalations',v_count_facility,'project_head_assignments',v_count_project_head,'assignment_failures',v_assignment_failures,'processed_at',p_now);
end $$;

comment on table public.hospital_ticket_client_sla_overrides is
  'Client-specific Hospital Ticket work/resolution SLA overrides. NIMS uses 20 minutes for levels 1-4 without changing the global priority matrix.';
comment on function public.hospital_ticket_sla_minutes_for_client(uuid,text,integer) is
  'Returns client-specific Hospital Ticket work SLA minutes when configured, otherwise falls back to the global priority SLA matrix.';
comment on function public.hospital_ticket_acceptance_window_for_client(uuid) is
  'Returns client-specific Hospital Ticket acknowledgement window. NIMS is aligned to the 20-minute unresolved-work SLA to avoid premature higher-role exposure; other clients keep the existing global acceptance window.';

commit;
