-- Final NIMS Hospital acceptance SLA rule.
--
-- Acceptance SLA is separate from work/resolution SLA:
--   Supervisor, Operations Executive, Facility Manager, and Project Head each
--   get exactly 2 minutes to accept the ticket.
--
-- This is an override migration. Do not edit already-applied migrations.

create or replace function public.hospital_supervisor_acceptance_window()
returns interval language sql immutable as $$
  select interval '2 minutes'
$$;

create or replace function public.hospital_escalation_acceptance_window()
returns interval language sql immutable as $$
  select interval '2 minutes'
$$;

create or replace function public.hospital_pick_ticket_owner(p_client_id uuid, p_role text)
returns public.hospital_ticket_users
language plpgsql
security definer
set search_path=public
as $$
declare
  v_user public.hospital_ticket_users%rowtype;
begin
  select * into v_user
  from public.hospital_ticket_users
  where client_id = p_client_id
    and profile_type = 'internal'
    and role_code = p_role
    and is_active = true
  order by created_at
  limit 1;
  return v_user;
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
  v_acceptance_due := p_now + public.hospital_escalation_acceptance_window();
  v_work_due := p_now + make_interval(mins => public.hospital_ticket_sla_minutes(v_ticket.priority, v_next_level));

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
      facility_manager_escalated_at = case when p_from_level=3 then coalesce(facility_manager_escalated_at,p_now) else facility_manager_escalated_at end,
      project_head_sla_due_at = case when v_next_level=4 then v_work_due else project_head_sla_due_at end,
      project_head_escalated_at = case when v_next_level=4 then p_now else project_head_escalated_at end,
      escalation_due_at = v_acceptance_due,
      last_escalated_at = p_now,
      escalation_count = coalesce(escalation_count,0) + 1,
      final_escalation = v_next_level = 4,
      sla_status = 'running',
      metadata = (coalesce(metadata,'{}'::jsonb)-'assignment_failure_reason') || jsonb_build_object(
        'assignment_state','awaiting_acceptance',
        'acceptance_sla_minutes',2,
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
    'Acceptance window expired.',
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
    'Escalated to ' || public.hospital_ticket_role_label(v_next_role) || ' for 2-minute acceptance.',
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
    public.hospital_ticket_role_label(v_next_role) || ' acceptance required',
    v_ticket.ticket_no || ' requires ' || public.hospital_ticket_role_label(v_next_role) || ' acceptance within 2 minutes.',
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
      'acceptance_sla_minutes',2,
      'current_owner_role',v_next_role,
      'escalation_level',v_next_level
    )
  )
  on conflict do nothing;

  return v_ticket;
end $$;

create or replace function public.hospital_ticket_mark_project_head_acceptance_overdue(
  p_ticket_id uuid,
  p_now timestamptz default now()
)
returns public.hospital_tickets
language plpgsql
security definer
set search_path=public
as $$
declare
  v_ticket public.hospital_tickets%rowtype;
begin
  select * into v_ticket
  from public.hospital_tickets
  where id = p_ticket_id
    and status_code = 'escalated_project_head'
    and acceptance_status = 'awaiting'
  for update;
  if not found then
    select * into v_ticket from public.hospital_tickets where id = p_ticket_id;
    return v_ticket;
  end if;

  update public.hospital_ticket_notifications
  set action_status = case when action_status='active' then 'timed_out' else action_status end,
      superseded_at = coalesce(superseded_at, p_now),
      superseded_reason = coalesce(superseded_reason, 'project_head_acceptance_timeout')
  where ticket_id = p_ticket_id
    and notification_type = 'sla_escalation'
    and current_owner_role = 'project_head'
    and action_status = 'active';

  update public.hospital_tickets
  set acceptance_status = 'timed_out',
      acceptance_timeout_at = p_now,
      acceptance_due_at = null,
      escalation_due_at = null,
      sla_status = 'blocked',
      final_escalation = true,
      metadata = coalesce(metadata,'{}'::jsonb) || jsonb_build_object(
        'assignment_state','project_head_acceptance_overdue',
        'assignment_failure_reason','project_head_acceptance_timeout',
        'assignment_failed_at',p_now
      ),
      version = version + 1,
      updated_at = p_now
  where id = p_ticket_id
  returning * into v_ticket;

  insert into public.hospital_ticket_events(ticket_id,event_type,from_status,to_status,actor_name,actor_role,remarks,event_data)
  values(
    p_ticket_id,
    'project_head_acceptance_overdue',
    'escalated_project_head',
    'escalated_project_head',
    'QPMS SLA Engine',
    'system',
    'Project Head acceptance window expired; no higher escalation role is defined.',
    jsonb_build_object('expired_at',p_now,'final_escalation',true)
  )
  on conflict do nothing;

  return v_ticket;
end $$;

create or replace function public.hospital_ticket_direct_to_operations(
  p_ticket_id uuid,
  p_reason text,
  p_now timestamptz default now()
)
returns public.hospital_tickets
language plpgsql
security definer
set search_path=public
as $$
begin
  return public.hospital_ticket_escalate_to_acceptance_level(
    p_ticket_id,
    1,
    p_reason,
    p_now
  );
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
    when v_level = 2 then coalesce(v_ticket.operations_sla_due_at, p_now + make_interval(mins => public.hospital_ticket_sla_minutes(v_ticket.priority, v_level)))
    when v_level = 4 then coalesce(v_ticket.project_head_sla_due_at, p_now + make_interval(mins => public.hospital_ticket_sla_minutes(v_ticket.priority, v_level)))
    else p_now + make_interval(mins => public.hospital_ticket_sla_minutes(v_ticket.priority, v_level))
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

create or replace function public.rpc_process_hospital_ticket_sla(
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
  v_level integer;
  v_timeout_count int := 0;
  v_project_head_overdue_count int := 0;
  v_result jsonb;
begin
  for v_ticket in
    select *
    from public.hospital_tickets
    where status_code='awaiting_supervisor_acceptance'
      and acceptance_status='awaiting'
      and acceptance_due_at is not null
      and acceptance_due_at <= p_now
    for update skip locked
  loop
    perform public.hospital_ticket_escalate_to_acceptance_level(v_ticket.id, 1, 'supervisor_acceptance_timeout', p_now);
    v_timeout_count := v_timeout_count + 1;
  end loop;

  for v_ticket in
    select *
    from public.hospital_tickets
    where status_code in ('escalated_operations_executive','escalated_facility_manager','escalated_project_head')
      and acceptance_status='awaiting'
      and acceptance_due_at is not null
      and acceptance_due_at <= p_now
    for update skip locked
  loop
    v_level := public.hospital_ticket_level_for_role(v_ticket.current_assignee_role);
    if v_level >= 4 then
      perform public.hospital_ticket_mark_project_head_acceptance_overdue(v_ticket.id, p_now);
      v_project_head_overdue_count := v_project_head_overdue_count + 1;
    else
      perform public.hospital_ticket_escalate_to_acceptance_level(v_ticket.id, v_level, v_ticket.current_assignee_role || '_acceptance_timeout', p_now);
      v_timeout_count := v_timeout_count + 1;
    end if;
  end loop;

  v_result := (
    select public.rpc_process_hospital_ticket_sla_day2_only(p_now, p_operations_sla_minutes)
  );
  return coalesce(v_result,'{}'::jsonb) || jsonb_build_object(
    'acceptance_timeouts', v_timeout_count,
    'supervisor_acceptance_timeouts', v_timeout_count,
    'project_head_acceptance_overdues', v_project_head_overdue_count,
    'processed_at', p_now
  );
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
      and coalesce(escalation_due_at, supervisor_sla_due_at, operations_sla_due_at, project_head_sla_due_at) is not null
      and coalesce(escalation_due_at, supervisor_sla_due_at, operations_sla_due_at, project_head_sla_due_at) <= p_now
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
    v_due := p_now + make_interval(mins => public.hospital_ticket_sla_minutes(v_ticket.priority, v_next_level));
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

revoke all on function public.hospital_supervisor_acceptance_window() from public, anon, authenticated;
revoke all on function public.hospital_escalation_acceptance_window() from public, anon, authenticated;
revoke all on function public.hospital_pick_ticket_owner(uuid,text) from public, anon, authenticated;
revoke all on function public.hospital_ticket_escalate_to_acceptance_level(uuid,integer,text,timestamptz) from public, anon, authenticated;
revoke all on function public.hospital_ticket_mark_project_head_acceptance_overdue(uuid,timestamptz) from public, anon, authenticated;
revoke all on function public.hospital_ticket_direct_to_operations(uuid,text,timestamptz) from public, anon, authenticated;
revoke all on function public.rpc_accept_hospital_escalation_ticket(uuid,uuid,integer,timestamptz) from public, anon, authenticated;
revoke all on function public.rpc_process_hospital_ticket_sla(timestamptz,integer) from public, anon, authenticated;
revoke all on function public.rpc_process_hospital_ticket_sla_day2_only(timestamptz,integer) from public, anon, authenticated;

grant execute on function public.hospital_supervisor_acceptance_window() to service_role;
grant execute on function public.hospital_escalation_acceptance_window() to service_role;
grant execute on function public.hospital_pick_ticket_owner(uuid,text) to service_role;
grant execute on function public.hospital_ticket_escalate_to_acceptance_level(uuid,integer,text,timestamptz) to service_role;
grant execute on function public.hospital_ticket_mark_project_head_acceptance_overdue(uuid,timestamptz) to service_role;
grant execute on function public.hospital_ticket_direct_to_operations(uuid,text,timestamptz) to service_role;
grant execute on function public.rpc_accept_hospital_escalation_ticket(uuid,uuid,integer,timestamptz) to service_role;
grant execute on function public.rpc_process_hospital_ticket_sla(timestamptz,integer) to service_role;
grant execute on function public.rpc_process_hospital_ticket_sla_day2_only(timestamptz,integer) to service_role;
