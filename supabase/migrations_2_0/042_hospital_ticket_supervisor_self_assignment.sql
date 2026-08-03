-- Day 3: live Supervisor self-assignment before Day 2 priority escalation.
-- Additive/backward-compatible. Does not create block-to-supervisor mappings.

alter table public.hospital_tickets
  drop constraint if exists hospital_tickets_status_check;
alter table public.hospital_tickets
  add constraint hospital_tickets_status_check
    check (status_code in (
      'open', 'awaiting_supervisor_acceptance', 'assigned', 'accepted', 'in_progress',
      'escalated_operations_executive', 'escalated_facility_manager', 'escalated_project_head',
      'resolved_awaiting_confirmation', 'reopened', 'closed', 'cancelled'
    ));

alter table public.hospital_tickets
  add column if not exists acceptance_status text not null default 'not_required',
  add column if not exists acceptance_due_at timestamptz,
  add column if not exists accepted_by_user_id uuid references public.hospital_ticket_users(id),
  add column if not exists broadcasted_at timestamptz,
  add column if not exists acceptance_timeout_at timestamptz;

do $$
begin
  if not exists (select 1 from pg_constraint where conname='hospital_tickets_acceptance_status_check') then
    alter table public.hospital_tickets
      add constraint hospital_tickets_acceptance_status_check
      check (acceptance_status in ('awaiting','accepted','timed_out','not_required'));
  end if;
end $$;

create index if not exists idx_hospital_tickets_acceptance_timeout
  on public.hospital_tickets(acceptance_due_at)
  where status_code = 'awaiting_supervisor_acceptance' and acceptance_status = 'awaiting';
create index if not exists idx_hospital_tickets_accepted_by
  on public.hospital_tickets(accepted_by_user_id, accepted_at desc);

alter table public.hospital_ticket_users
  add column if not exists cug_number text,
  add column if not exists cug_number_display text,
  add column if not exists duty_status text not null default 'off_duty',
  add column if not exists duty_started_at timestamptz,
  add column if not exists duty_ended_at timestamptz,
  add column if not exists last_seen_at timestamptz;

do $$
begin
  if not exists (select 1 from pg_constraint where conname='hospital_ticket_users_duty_status_check') then
    alter table public.hospital_ticket_users
      add constraint hospital_ticket_users_duty_status_check
      check (duty_status in ('on_duty','off_duty'));
  end if;
end $$;

create unique index if not exists ux_hospital_ticket_users_cug_number
  on public.hospital_ticket_users(cug_number)
  where cug_number is not null;
create index if not exists idx_hospital_ticket_users_supervisor_duty
  on public.hospital_ticket_users(client_id, role_code, duty_status, is_active)
  where role_code = 'housekeeping_supervisor';

alter table public.hospital_ticket_notifications
  add column if not exists action_status text not null default 'active',
  add column if not exists action_expires_at timestamptz,
  add column if not exists superseded_at timestamptz,
  add column if not exists superseded_reason text;

do $$
begin
  if not exists (select 1 from pg_constraint where conname='hospital_ticket_notifications_action_status_check') then
    alter table public.hospital_ticket_notifications
      add constraint hospital_ticket_notifications_action_status_check
      check (action_status in ('active','accepted','timed_out','superseded','dismissed','not_actionable'));
  end if;
end $$;

create unique index if not exists ux_hospital_incoming_supervisor_ticket_notification
  on public.hospital_ticket_notifications(ticket_id, recipient_user_id, notification_type)
  where notification_type = 'incoming_supervisor_ticket';

create index if not exists idx_hospital_notifications_incoming_actionable
  on public.hospital_ticket_notifications(recipient_user_id, action_status, action_expires_at)
  where notification_type = 'incoming_supervisor_ticket';

create or replace function public.hospital_normalize_cug_number(p_value text)
returns text language sql immutable as $$
  select nullif(regexp_replace(coalesce(p_value, ''), '\D', '', 'g'), '')
$$;

create or replace function public.hospital_ticket_is_on_duty_supervisor(p_user public.hospital_ticket_users)
returns boolean language sql stable as $$
  select coalesce(p_user.is_active,false)
    and p_user.profile_type = 'internal'
    and p_user.role_code = 'housekeeping_supervisor'
    and coalesce(p_user.duty_status,'off_duty') = 'on_duty'
$$;

create or replace function public.hospital_ticket_on_duty_supervisors(p_client_id uuid, p_block_id uuid, p_location_id uuid)
returns setof public.hospital_ticket_users
language sql stable security definer set search_path=public as $$
  select distinct u.*
  from public.hospital_ticket_users u
  join public.hospital_ticket_user_scopes s on s.hospital_ticket_user_id = u.id
  where u.client_id = p_client_id
    and public.hospital_ticket_is_on_duty_supervisor(u)
    and s.client_id = p_client_id
    and s.can_update
    and (
      s.scope_type = 'client'
      or (s.scope_type = 'block' and s.block_id = p_block_id)
      or (s.scope_type = 'location' and s.location_id = p_location_id)
    )
  order by u.display_name, u.id
$$;

create or replace function public.hospital_ticket_pick_operations_owner(p_client_id uuid)
returns public.hospital_ticket_users language plpgsql security definer set search_path=public as $$
declare
  v_user public.hospital_ticket_users%rowtype;
begin
  select * into v_user
  from public.hospital_ticket_users
  where client_id = p_client_id and role_code = 'operations_executive' and is_active
  order by created_at
  limit 1;
  return v_user;
end $$;

create or replace function public.hospital_ticket_incoming_body(
  p_block text,
  p_floor text,
  p_area text,
  p_priority text
) returns text language sql immutable as $$
  select concat_ws(E'\n',
    concat_ws(' · ', nullif(p_block,''), nullif(coalesce(p_floor,p_area),''), upper(coalesce(p_priority,'medium'))),
    'Review and accept within 2 minutes if this location is under your responsibility.'
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
      new.acceptance_due_at := coalesce(new.acceptance_due_at, now()+interval '2 minutes');
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

create or replace function public.hospital_ticket_prepare_owner_sla()
returns trigger language plpgsql security definer set search_path=public as $$
declare
  v_level integer;
  v_due timestamptz;
begin
  if new.status_code in ('resolved_awaiting_confirmation','closed','cancelled') then
    new.escalation_due_at := null;
    new.sla_status := case when new.status_code='closed' then 'closed' else 'resolved' end;
    return new;
  end if;
  if new.current_assignee_user_id is null or new.current_assignee_role is null then
    if new.status_code <> 'awaiting_supervisor_acceptance' then
      new.escalation_due_at := null;
      new.sla_status := 'not_applicable';
    end if;
    return new;
  end if;
  if new.current_assignee_user_id is distinct from old.current_assignee_user_id
    or new.current_assignee_role is distinct from old.current_assignee_role
    or new.escalation_due_at is null
  then
    v_level := public.hospital_ticket_level_for_role(new.current_assignee_role);
    new.current_escalation_level_no := v_level;
    new.current_escalation_level := public.hospital_ticket_level_code(v_level);
    new.assigned_at := coalesce(new.assigned_at, now());
    if v_level = 1 and old.status_code = 'awaiting_supervisor_acceptance' and new.acceptance_status = 'accepted' then
      new.escalation_due_at := coalesce(new.escalation_due_at, new.supervisor_sla_due_at);
    else
      v_due := now() + make_interval(mins => public.hospital_ticket_sla_minutes(new.priority, v_level));
      new.escalation_due_at := coalesce(new.escalation_due_at, v_due);
    end if;
    new.sla_status := case when v_level = 4 then 'final_owner' else 'running' end;
    new.final_escalation := v_level = 4;
    if v_level = 1 then new.supervisor_sla_due_at := coalesce(new.supervisor_sla_due_at, new.escalation_due_at); end if;
    if v_level = 2 then new.operations_sla_due_at := coalesce(new.operations_sla_due_at, new.escalation_due_at); end if;
    if v_level = 4 then new.project_head_sla_due_at := coalesce(new.project_head_sla_due_at, new.escalation_due_at); end if;
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
      else 'No Supervisor accepted within 2 minutes.' end,
    jsonb_build_object('reason',p_reason,'acceptance_timeout_at',p_now,'operations_due_at',v_due)
  ) on conflict do nothing;

  if v_oe.id is not null then
    insert into public.hospital_ticket_notifications(ticket_id,recipient_user_id,notification_type,title,body,priority,current_owner_role,escalation_level,metadata)
    values(
      p_ticket_id, v_oe.id, 'supervisor_acceptance_timeout', 'Supervisor Acceptance Timeout',
      'No On-Duty Supervisor accepted Ticket ' || v_ticket.ticket_no || ' within 2 minutes.' || E'\n\nBlock: ' || coalesce(v_ticket.metadata->>'block_name', v_ticket.block_id::text) || E'\nPriority: ' || upper(v_ticket.priority) || E'\n\nImmediate action required.',
      v_ticket.priority, 'operations_executive', 2,
      jsonb_build_object('ticket_id',p_ticket_id,'ticket_no',v_ticket.ticket_no,'priority',v_ticket.priority,'acceptance_status',v_ticket.acceptance_status,'operations_due_at',v_due)
    ) on conflict do nothing;
  end if;

  return v_ticket;
end $$;

create or replace function public.rpc_set_hospital_supervisor_duty(
  p_actor_user_id uuid,
  p_on_duty boolean,
  p_cug_number text default null,
  p_now timestamptz default now()
) returns jsonb language plpgsql security definer set search_path=public as $$
declare
  v_actor public.hospital_ticket_users%rowtype;
  v_cug text;
begin
  select * into v_actor from public.hospital_ticket_users where id=p_actor_user_id for update;
  if not found or v_actor.profile_type <> 'internal' or v_actor.role_code <> 'housekeeping_supervisor' or not v_actor.is_active then
    raise exception 'Active Supervisor profile required.' using errcode='42501';
  end if;

  v_cug := public.hospital_normalize_cug_number(coalesce(p_cug_number, v_actor.cug_number_display, v_actor.cug_number));
  if p_cug_number is not null and v_cug is null then
    raise exception 'CUG number is invalid.' using errcode='22023';
  end if;

  update public.hospital_ticket_users
  set duty_status = case when p_on_duty then 'on_duty' else 'off_duty' end,
      duty_started_at = case when p_on_duty then p_now else duty_started_at end,
      duty_ended_at = case when p_on_duty then null else p_now end,
      last_seen_at = p_now,
      cug_number = coalesce(v_cug, cug_number),
      cug_number_display = coalesce(p_cug_number, cug_number_display),
      updated_at = p_now
  where id=p_actor_user_id
  returning * into v_actor;

  return jsonb_build_object(
    'duty_status', v_actor.duty_status,
    'duty_started_at', v_actor.duty_started_at,
    'duty_ended_at', v_actor.duty_ended_at,
    'last_seen_at', v_actor.last_seen_at,
    'cug_number', v_actor.cug_number
  );
end $$;

create or replace function public.rpc_accept_hospital_supervisor_ticket(
  p_ticket_id uuid,
  p_actor_user_id uuid,
  p_expected_version integer,
  p_confirmed_location boolean default false,
  p_now timestamptz default now()
) returns jsonb language plpgsql security definer set search_path=public as $$
declare
  v_ticket public.hospital_tickets%rowtype;
  v_actor public.hospital_ticket_users%rowtype;
  v_current_owner public.hospital_ticket_users%rowtype;
begin
  if p_confirmed_location is not true then
    raise exception 'Confirm that this location is under your responsibility.' using errcode='22023';
  end if;

  select * into v_actor from public.hospital_ticket_users where id=p_actor_user_id and is_active for share;
  if not found or v_actor.profile_type <> 'internal' or v_actor.role_code <> 'housekeeping_supervisor' then
    raise exception 'Only an active Supervisor can accept this ticket.' using errcode='42501';
  end if;
  if v_actor.duty_status <> 'on_duty' then
    raise exception 'Supervisor must be On Duty to accept incoming tickets.' using errcode='42501';
  end if;

  select * into v_ticket from public.hospital_tickets where id=p_ticket_id for update;
  if not found then raise exception 'Ticket not found.' using errcode='P0002'; end if;
  if v_ticket.version <> p_expected_version then raise exception 'Ticket version conflict.' using errcode='40001'; end if;
  if v_ticket.client_id <> v_actor.client_id then raise exception 'Cross-client acceptance denied.' using errcode='42501'; end if;
  if v_ticket.status_code <> 'awaiting_supervisor_acceptance' or v_ticket.acceptance_status <> 'awaiting' then
    if v_ticket.accepted_by_user_id is not null then
      select * into v_current_owner from public.hospital_ticket_users where id=v_ticket.accepted_by_user_id;
      raise exception 'This ticket has already been accepted by %.', coalesce(v_current_owner.display_name,'another Supervisor') using errcode='40001';
    end if;
    raise exception 'This ticket is no longer available for Supervisor acceptance.' using errcode='40001';
  end if;
  if v_ticket.acceptance_due_at is null or v_ticket.acceptance_due_at <= p_now then
    raise exception 'The Supervisor acceptance window has expired.' using errcode='40001';
  end if;
  if not exists (
    select 1 from public.hospital_ticket_notifications n
    where n.ticket_id=p_ticket_id
      and n.recipient_user_id=p_actor_user_id
      and n.notification_type='incoming_supervisor_ticket'
      and n.action_status='active'
  ) then
    raise exception 'This ticket is not in your active incoming queue.' using errcode='42501';
  end if;

  update public.hospital_tickets
  set status_code='accepted',
      acceptance_status='accepted',
      accepted_at=p_now,
      accepted_by_user_id=v_actor.id,
      current_assignee_user_id=v_actor.id,
      current_assignee_role='housekeeping_supervisor',
      supervisor_user_id=v_actor.id,
      current_escalation_level='supervisor',
      current_escalation_level_no=1,
      assigned_at=coalesce(assigned_at, raised_at, created_at),
      final_escalation=false,
      sla_status='running',
      version=version+1,
      updated_at=p_now
  where id=p_ticket_id
    and status_code='awaiting_supervisor_acceptance'
    and acceptance_status='awaiting'
    and current_assignee_user_id is null
  returning * into v_ticket;

  if v_ticket.id is null then
    select * into v_ticket from public.hospital_tickets where id=p_ticket_id;
    if v_ticket.accepted_by_user_id is not null then
      select * into v_current_owner from public.hospital_ticket_users where id=v_ticket.accepted_by_user_id;
    end if;
    raise exception 'This ticket has already been accepted by %.', coalesce(v_current_owner.display_name,'another Supervisor') using errcode='40001';
  end if;

  update public.hospital_ticket_notifications
  set action_status = case when recipient_user_id=p_actor_user_id then 'accepted' else 'superseded' end,
      superseded_at = case when recipient_user_id=p_actor_user_id then superseded_at else p_now end,
      superseded_reason = case when recipient_user_id=p_actor_user_id then superseded_reason else 'accepted_by_other_supervisor' end
  where ticket_id=p_ticket_id and notification_type='incoming_supervisor_ticket';

  perform public.hospital_record_assignment_history(
    p_ticket_id, null, v_actor.id, 'primary', null, null,
    'supervisor_confirmed_location_responsibility', v_actor.id, 'automatic',
    'awaiting_supervisor_acceptance', v_ticket.status_code,
    jsonb_build_object('accepted_at',p_now,'acceptance_due_at',v_ticket.acceptance_due_at,'confirmed_location',p_confirmed_location)
  );

  insert into public.hospital_ticket_events(ticket_id,event_type,from_status,to_status,actor_user_id,actor_name,actor_role,remarks,event_data)
  values(p_ticket_id,'supervisor_self_accepted','awaiting_supervisor_acceptance',v_ticket.status_code,v_actor.id,v_actor.display_name,v_actor.role_code,
    'Ticket accepted by Supervisor ' || v_actor.display_name || '.',
    jsonb_build_object('accepted_at',p_now,'acceptance_due_at',v_ticket.acceptance_due_at))
  on conflict do nothing;

  return jsonb_build_object('ticket',to_jsonb(v_ticket),'accepted_by',jsonb_build_object('id',v_actor.id,'display_name',v_actor.display_name));
end $$;

drop function if exists public.rpc_create_hospital_ticket(uuid,uuid,uuid,uuid,text,text,text,text,integer);

create or replace function public.rpc_create_hospital_ticket(
  p_actor_user_id uuid,
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
) returns jsonb language plpgsql security definer set search_path=public as $$
declare
  v_actor public.hospital_ticket_users%rowtype;
  v_block public.hospital_blocks%rowtype;
  v_floor public.hospital_floors%rowtype;
  v_department public.hospital_departments%rowtype;
  v_location public.hospital_locations%rowtype;
  v_ticket public.hospital_tickets%rowtype;
  v_oe_ticket public.hospital_tickets%rowtype;
  v_ticket_no text;
  v_landmark text;
  v_floor_name text;
  v_department_name text;
  v_location_text text;
  v_room_area text;
  v_acceptance_due_at timestamptz;
  v_supervisor_due_at timestamptz;
  v_supervisor_count integer := 0;
begin
  v_landmark := nullif(btrim(coalesce(p_exact_landmark, '')), '');
  select * into v_actor from public.hospital_ticket_users where id = p_actor_user_id and is_active = true for share;
  if not found or v_actor.profile_type <> 'client' or v_actor.role_code not in ('doctor', 'hospital_management') then
    raise exception 'Active client ticket user required.' using errcode = '42501';
  end if;
  if nullif(btrim(p_idempotency_key), '') is null then raise exception 'Idempotency key is required.' using errcode = '22023'; end if;
  perform pg_advisory_xact_lock(hashtextextended(p_actor_user_id::text || ':' || btrim(p_idempotency_key), 0));
  select * into v_ticket from public.hospital_tickets where raised_by_user_id = p_actor_user_id and idempotency_key = btrim(p_idempotency_key);
  if found then return jsonb_build_object('ticket', to_jsonb(v_ticket), 'idempotent_replay', true, 'broadcast_count', 0); end if;

  select * into v_block from public.hospital_blocks where id = p_block_id and client_id = v_actor.client_id and is_active = true;
  if not found then raise exception 'Block is outside the actor client.' using errcode = '42501'; end if;
  if p_floor_id is not null then
    select * into v_floor from public.hospital_floors where id = p_floor_id and client_id = v_actor.client_id and block_id = p_block_id and is_active = true;
    if not found then raise exception 'Floor is outside the selected block.' using errcode = '42501'; end if;
  end if;
  if p_department_id is not null then
    select * into v_department from public.hospital_departments where id = p_department_id and client_id = v_actor.client_id and block_id = p_block_id and is_active = true;
    if not found then raise exception 'Department is outside the selected block.' using errcode = '42501'; end if;
  end if;
  if p_location_id is not null then
    select * into v_location from public.hospital_locations where id = p_location_id and block_id = p_block_id and client_id = v_actor.client_id and is_active = true;
    if not found then raise exception 'Location is outside the actor client/block.' using errcode = '42501'; end if;
  elsif v_landmark is null then
    raise exception 'Select a room/area or provide an exact location landmark.' using errcode = '22023';
  elsif p_department_id is null then
    raise exception 'Select a department/unit for landmark-only tickets.' using errcode = '22023';
  end if;
  if not exists (
    select 1 from public.hospital_ticket_user_scopes s
    where s.hospital_ticket_user_id = p_actor_user_id and s.client_id = v_actor.client_id and s.can_create
      and (s.scope_type = 'client' or (s.scope_type = 'block' and s.block_id = p_block_id)
        or (s.scope_type = 'location' and p_location_id is not null and s.location_id = p_location_id))
  ) then raise exception 'Ticket creation is outside the actor scope.' using errcode = '42501'; end if;
  if not exists (select 1 from public.hospital_ticket_categories c where c.id = p_category_id and c.is_active and (c.client_id is null or c.client_id = v_actor.client_id)) then
    raise exception 'Category is unavailable.' using errcode = '22023';
  end if;

  v_floor_name := coalesce(v_location.floor_name, v_floor.floor_name, nullif(v_department.metadata->>'floor_name', ''), 'Not specified');
  v_department_name := coalesce(v_location.department_name, v_department.department_name);
  v_room_area := nullif(btrim(concat_ws(' / ', v_location.ward_name, v_location.room_number, v_location.area_name)), '');
  v_location_text := coalesce(nullif(btrim(coalesce(v_location.location_name, '')), ''), v_room_area, v_landmark);
  v_ticket_no := 'QPMS-HK-' || to_char(timezone('Asia/Kolkata', now()), 'YYYY') || '-' || lpad(nextval('public.hospital_ticket_number_seq')::text, 6, '0');
  v_acceptance_due_at := now() + interval '2 minutes';
  v_supervisor_due_at := now() + make_interval(mins => public.hospital_ticket_sla_minutes(p_priority, 1));

  insert into public.hospital_tickets (
    ticket_no, client_id, block_id, location_id, category_id,
    raised_by_user_id, raised_by_name, raised_by_role, floor_name,
    department_name, location_text, title, description, priority,
    status_code, current_escalation_level, current_escalation_level_no,
    supervisor_sla_due_at, acceptance_status, acceptance_due_at, broadcasted_at,
    idempotency_key, exact_landmark_snapshot, metadata
  ) values (
    v_ticket_no, v_actor.client_id, p_block_id, p_location_id, p_category_id,
    v_actor.id, v_actor.display_name, v_actor.role_code, v_floor_name,
    v_department_name, v_location_text, btrim(p_title), btrim(p_description), lower(p_priority),
    'awaiting_supervisor_acceptance', 'supervisor', 1,
    v_supervisor_due_at, 'awaiting', v_acceptance_due_at, now(),
    btrim(p_idempotency_key), v_landmark,
    jsonb_build_object(
      'assignment_state','awaiting_supervisor_acceptance',
      'assignment_source','supervisor_self_assignment',
      'block_name',v_block.block_name,
      'floor_name',v_floor_name,
      'area',v_location_text,
      'acceptance_window_seconds',120
    )
  ) returning * into v_ticket;

  insert into public.hospital_ticket_events(ticket_id, event_type, to_status, actor_user_id, actor_name, actor_role, remarks, event_data)
  values (v_ticket.id, 'ticket_created', v_ticket.status_code, v_actor.id, v_actor.display_name, v_actor.role_code, 'Housekeeping complaint submitted for Supervisor review.',
    jsonb_build_object('acceptance_due_at',v_acceptance_due_at,'supervisor_sla_due_at',v_supervisor_due_at));

  insert into public.hospital_ticket_notifications(
    ticket_id, recipient_user_id, notification_type, title, body, priority, current_owner_role, escalation_level,
    action_status, action_expires_at, metadata
  )
  select
    v_ticket.id, u.id, 'incoming_supervisor_ticket', 'New Housekeeping Complaint',
    public.hospital_ticket_incoming_body(v_block.block_name, v_floor_name, v_location_text, v_ticket.priority),
    v_ticket.priority, 'housekeeping_supervisor', 1,
    'active', v_acceptance_due_at,
    jsonb_build_object(
      'ticket_id',v_ticket.id,'ticket_no',v_ticket.ticket_no,'priority',v_ticket.priority,
      'block',v_block.block_name,'floor',v_floor_name,'area',v_location_text,
      'complaint_type',(select c.category_name from public.hospital_ticket_categories c where c.id=p_category_id),
      'description',v_ticket.description,'raised_at',v_ticket.raised_at,
      'raised_by_name',v_ticket.raised_by_name,'acceptance_due_at',v_acceptance_due_at,
      'acceptance_status','awaiting'
    )
  from public.hospital_ticket_on_duty_supervisors(v_actor.client_id, p_block_id, p_location_id) u
  on conflict do nothing;

  get diagnostics v_supervisor_count = row_count;
  if v_supervisor_count = 0 then
    v_oe_ticket := public.hospital_ticket_direct_to_operations(v_ticket.id, 'no_on_duty_supervisor', now());
    v_ticket := v_oe_ticket;
  else
    insert into public.hospital_ticket_events(ticket_id,event_type,from_status,to_status,actor_name,actor_role,remarks,event_data)
    values(v_ticket.id,'supervisor_broadcast_created','awaiting_supervisor_acceptance','awaiting_supervisor_acceptance','QPMS Assignment Engine','system',
      'Incoming ticket broadcast to On-Duty Supervisors.',
      jsonb_build_object('broadcast_count',v_supervisor_count,'acceptance_due_at',v_acceptance_due_at))
    on conflict do nothing;
  end if;

  return jsonb_build_object('ticket', to_jsonb(v_ticket), 'idempotent_replay', false, 'broadcast_count', v_supervisor_count);
end $$;

create or replace function public.rpc_process_hospital_ticket_sla(
  p_now timestamptz default now(),
  p_operations_sla_minutes integer default 30
) returns jsonb language plpgsql security definer set search_path=public as $$
declare
  v_ticket public.hospital_tickets%rowtype;
  v_timeout_count int := 0;
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
    perform public.hospital_ticket_direct_to_operations(v_ticket.id, 'supervisor_acceptance_timeout', p_now);
    v_timeout_count := v_timeout_count + 1;
  end loop;

  -- Continue the Day 2 matrix escalation for tickets with active owners.
  v_result := (select public.rpc_process_hospital_ticket_sla_day2_only(p_now, p_operations_sla_minutes));
  return coalesce(v_result,'{}'::jsonb) || jsonb_build_object('supervisor_acceptance_timeouts', v_timeout_count, 'processed_at', p_now);
end $$;

-- Preserve Day 2 worker body under a helper name before deployments that need direct DB inspection.
-- If a previous deployment has not created this alias, create it from the current matrix worker source in application migrations.
create or replace function public.rpc_process_hospital_ticket_sla_day2_only(
  p_now timestamptz default now(),
  p_operations_sla_minutes integer default 30
) returns jsonb language plpgsql security definer set search_path=public as $$
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
      and coalesce(final_escalation, false) = false
      and current_assignee_user_id is not null
      and coalesce(escalation_due_at, supervisor_sla_due_at, operations_sla_due_at, project_head_sla_due_at) is not null
      and coalesce(escalation_due_at, supervisor_sla_due_at, operations_sla_due_at, project_head_sla_due_at) <= p_now
    for update skip locked
  loop
    v_level := greatest(1, least(4, coalesce(v_ticket.current_escalation_level_no, public.hospital_ticket_level_for_role(v_ticket.current_assignee_role), 1)));
    if v_level >= 4 then
      update public.hospital_tickets set sla_status='final_owner', final_escalation=true, version=version+1, updated_at=p_now where id=v_ticket.id;
      continue;
    end if;
    v_next_level := v_level + 1;
    v_next_role := public.hospital_ticket_role_for_level(v_next_level);
    v_next_status := public.hospital_ticket_status_for_level(v_next_level, v_ticket.status_code);
    v_due := p_now + make_interval(mins => public.hospital_ticket_sla_minutes(v_ticket.priority, v_next_level));
    v_missed_event := case v_level when 1 then 'supervisor_sla_missed' when 2 then 'operations_executive_sla_missed' when 3 then 'facility_manager_sla_missed' else 'sla_missed' end;
    v_assignee := public.hospital_pick_ticket_owner(v_ticket.client_id, v_next_role);
    if v_assignee.id is null then
      update public.hospital_tickets set escalation_due_at=null,sla_status='blocked',version=version+1,updated_at=p_now where id=v_ticket.id;
      v_assignment_failures := v_assignment_failures + 1;
      continue;
    end if;
    update public.hospital_tickets
    set status_code=v_next_status,current_escalation_level=public.hospital_ticket_level_code(v_next_level),
      current_escalation_level_no=v_next_level,current_assignee_user_id=v_assignee.id,current_assignee_role=v_next_role,
      assigned_at=p_now,operations_executive_user_id=case when v_next_role='operations_executive' then v_assignee.id else operations_executive_user_id end,
      facility_manager_user_id=case when v_next_role='facility_manager' then v_assignee.id else facility_manager_user_id end,
      project_head_user_id=case when v_next_role='project_head' then v_assignee.id else project_head_user_id end,
      supervisor_sla_due_at=case when v_level=1 then null else supervisor_sla_due_at end,
      operations_sla_due_at=case when v_next_level=2 then v_due when v_level=2 then null else operations_sla_due_at end,
      project_head_sla_due_at=case when v_next_level=4 then v_due else project_head_sla_due_at end,
      escalation_due_at=v_due,last_escalated_at=p_now,escalation_count=coalesce(escalation_count,0)+1,
      final_escalation=v_next_level=4,sla_status=case when v_next_level=4 then 'final_owner' else 'running' end,
      version=version+1,updated_at=p_now
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

revoke all on function public.hospital_normalize_cug_number(text) from public, anon, authenticated;
revoke all on function public.hospital_ticket_is_on_duty_supervisor(public.hospital_ticket_users) from public, anon, authenticated;
revoke all on function public.hospital_ticket_on_duty_supervisors(uuid,uuid,uuid) from public, anon, authenticated;
revoke all on function public.hospital_ticket_pick_operations_owner(uuid) from public, anon, authenticated;
revoke all on function public.hospital_ticket_incoming_body(text,text,text,text) from public, anon, authenticated;
revoke all on function public.hospital_ticket_prepare_assignment() from public, anon, authenticated;
revoke all on function public.hospital_ticket_prepare_owner_sla() from public, anon, authenticated;
revoke all on function public.hospital_ticket_direct_to_operations(uuid,text,timestamptz) from public, anon, authenticated;
revoke all on function public.rpc_set_hospital_supervisor_duty(uuid,boolean,text,timestamptz) from public, anon, authenticated;
revoke all on function public.rpc_accept_hospital_supervisor_ticket(uuid,uuid,integer,boolean,timestamptz) from public, anon, authenticated;
revoke all on function public.rpc_create_hospital_ticket(uuid,uuid,uuid,uuid,text,text,text,text,integer,uuid,uuid,text) from public, anon, authenticated;
revoke all on function public.rpc_process_hospital_ticket_sla(timestamptz,integer) from public, anon, authenticated;
revoke all on function public.rpc_process_hospital_ticket_sla_day2_only(timestamptz,integer) from public, anon, authenticated;
grant execute on function public.hospital_normalize_cug_number(text) to service_role;
grant execute on function public.hospital_ticket_on_duty_supervisors(uuid,uuid,uuid) to service_role;
grant execute on function public.hospital_ticket_direct_to_operations(uuid,text,timestamptz) to service_role;
grant execute on function public.rpc_set_hospital_supervisor_duty(uuid,boolean,text,timestamptz) to service_role;
grant execute on function public.rpc_accept_hospital_supervisor_ticket(uuid,uuid,integer,boolean,timestamptz) to service_role;
grant execute on function public.rpc_create_hospital_ticket(uuid,uuid,uuid,uuid,text,text,text,text,integer,uuid,uuid,text) to service_role;
grant execute on function public.rpc_process_hospital_ticket_sla(timestamptz,integer) to service_role;
grant execute on function public.rpc_process_hospital_ticket_sla_day2_only(timestamptz,integer) to service_role;
