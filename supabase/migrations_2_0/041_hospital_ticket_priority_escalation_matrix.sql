-- Day 2: configurable priority-based Hospital Housekeeping SLA escalation.
-- Additive/backward-compatible: preserves existing tickets, events, APIs and historical escalation rows.

alter table public.hospital_ticket_users
  drop constraint if exists hospital_ticket_users_role_code_check;
alter table public.hospital_ticket_users
  add constraint hospital_ticket_users_role_code_check
    check (role_code in (
      'doctor', 'hospital_management', 'housekeeping_supervisor',
      'operations_executive', 'facility_manager', 'project_head'
    ));

alter table public.hospital_tickets
  drop constraint if exists hospital_tickets_status_check;
alter table public.hospital_tickets
  add constraint hospital_tickets_status_check
    check (status_code in (
      'open', 'assigned', 'accepted', 'in_progress',
      'escalated_operations_executive', 'escalated_facility_manager', 'escalated_project_head',
      'resolved_awaiting_confirmation', 'reopened', 'closed', 'cancelled'
    ));

alter table public.hospital_tickets
  drop constraint if exists hospital_tickets_escalation_check;
alter table public.hospital_tickets
  add constraint hospital_tickets_escalation_check
    check (current_escalation_level in (
      'supervisor', 'operations_executive', 'facility_manager', 'project_head',
      'client_confirmation', 'completed'
    ));

alter table public.hospital_tickets
  add column if not exists project_head_user_id uuid references public.hospital_ticket_users(id),
  add column if not exists current_escalation_level_no integer not null default 1,
  add column if not exists escalation_due_at timestamptz,
  add column if not exists last_escalated_at timestamptz,
  add column if not exists escalation_count integer not null default 0,
  add column if not exists final_escalation boolean not null default false,
  add column if not exists sla_status text not null default 'running',
  add column if not exists facility_manager_escalated_at timestamptz,
  add column if not exists project_head_sla_due_at timestamptz,
  add column if not exists project_head_escalated_at timestamptz;

do $$
begin
  if not exists (select 1 from pg_constraint where conname='hospital_tickets_level_no_check') then
    alter table public.hospital_tickets
      add constraint hospital_tickets_level_no_check
      check (current_escalation_level_no between 1 and 4);
  end if;
  if not exists (select 1 from pg_constraint where conname='hospital_tickets_escalation_count_check') then
    alter table public.hospital_tickets
      add constraint hospital_tickets_escalation_count_check
      check (escalation_count >= 0);
  end if;
  if not exists (select 1 from pg_constraint where conname='hospital_tickets_sla_status_check') then
    alter table public.hospital_tickets
      add constraint hospital_tickets_sla_status_check
      check (sla_status in ('not_applicable','running','near_breach','breached','blocked','final_owner','resolved','closed'));
  end if;
end $$;

create index if not exists idx_hospital_tickets_escalation_due
  on public.hospital_tickets(escalation_due_at)
  where status_code not in ('resolved_awaiting_confirmation','closed','cancelled');
create index if not exists idx_hospital_tickets_project_head
  on public.hospital_tickets(project_head_user_id, status_code);

alter table public.hospital_ticket_notifications
  add column if not exists priority text,
  add column if not exists current_owner_role text,
  add column if not exists escalation_level integer,
  add column if not exists read_status boolean not null default false;

create table if not exists public.hospital_ticket_sla_matrix (
  id uuid primary key default gen_random_uuid(),
  priority text not null,
  escalation_level integer not null,
  owner_role text not null,
  owner_label text not null,
  sla_minutes integer not null,
  is_final_level boolean not null default false,
  is_active boolean not null default true,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint hospital_ticket_sla_matrix_priority_check check (priority in ('low','medium','critical')),
  constraint hospital_ticket_sla_matrix_level_check check (escalation_level between 1 and 4),
  constraint hospital_ticket_sla_matrix_owner_role_check check (owner_role in ('housekeeping_supervisor','operations_executive','facility_manager','project_head')),
  constraint hospital_ticket_sla_matrix_minutes_check check (sla_minutes > 0),
  constraint hospital_ticket_sla_matrix_unique unique(priority, escalation_level)
);

insert into public.hospital_ticket_sla_matrix(priority, escalation_level, owner_role, owner_label, sla_minutes, is_final_level, metadata)
values
  ('critical', 1, 'housekeeping_supervisor', 'Supervisor', 10, false, '{"source":"day2_priority_matrix"}'),
  ('critical', 2, 'operations_executive', 'Operations Executive', 10, false, '{"source":"day2_priority_matrix"}'),
  ('critical', 3, 'facility_manager', 'Facility Manager', 10, false, '{"source":"day2_priority_matrix"}'),
  ('critical', 4, 'project_head', 'Project Head', 10, true, '{"source":"day2_priority_matrix"}'),
  ('medium', 1, 'housekeeping_supervisor', 'Supervisor', 15, false, '{"source":"day2_priority_matrix"}'),
  ('medium', 2, 'operations_executive', 'Operations Executive', 15, false, '{"source":"day2_priority_matrix"}'),
  ('medium', 3, 'facility_manager', 'Facility Manager', 15, false, '{"source":"day2_priority_matrix"}'),
  ('medium', 4, 'project_head', 'Project Head', 15, true, '{"source":"day2_priority_matrix"}'),
  ('low', 1, 'housekeeping_supervisor', 'Supervisor', 20, false, '{"source":"day2_priority_matrix"}'),
  ('low', 2, 'operations_executive', 'Operations Executive', 20, false, '{"source":"day2_priority_matrix"}'),
  ('low', 3, 'facility_manager', 'Facility Manager', 20, false, '{"source":"day2_priority_matrix"}'),
  ('low', 4, 'project_head', 'Project Head', 20, true, '{"source":"day2_priority_matrix"}')
on conflict (priority, escalation_level) do update
set owner_role = excluded.owner_role,
    owner_label = excluded.owner_label,
    sla_minutes = excluded.sla_minutes,
    is_final_level = excluded.is_final_level,
    is_active = true,
    metadata = excluded.metadata,
    updated_at = now();

create or replace function public.hospital_ticket_effective_priority(p_priority text)
returns text language sql immutable as $$
  select case lower(coalesce(p_priority, 'medium'))
    when 'low' then 'low'
    when 'medium' then 'medium'
    when 'critical' then 'critical'
    when 'high' then 'critical'
    else 'medium'
  end
$$;

create or replace function public.hospital_ticket_sla_minutes(p_priority text, p_level integer)
returns integer language sql stable set search_path=public as $$
  select coalesce((
    select m.sla_minutes
    from public.hospital_ticket_sla_matrix m
    where m.priority = public.hospital_ticket_effective_priority(p_priority)
      and m.escalation_level = greatest(1, least(4, coalesce(p_level, 1)))
      and m.is_active
    limit 1
  ), case public.hospital_ticket_effective_priority(p_priority)
    when 'critical' then 10
    when 'low' then 20
    else 15
  end)
$$;

create or replace function public.hospital_ticket_role_for_level(p_level integer)
returns text language sql immutable as $$
  select case p_level
    when 1 then 'housekeeping_supervisor'
    when 2 then 'operations_executive'
    when 3 then 'facility_manager'
    when 4 then 'project_head'
    else 'housekeeping_supervisor'
  end
$$;

create or replace function public.hospital_ticket_level_for_role(p_role text)
returns integer language sql immutable as $$
  select case p_role
    when 'housekeeping_supervisor' then 1
    when 'supervisor' then 1
    when 'operations_executive' then 2
    when 'facility_manager' then 3
    when 'project_head' then 4
    else 1
  end
$$;

create or replace function public.hospital_ticket_level_code(p_level integer)
returns text language sql immutable as $$
  select case p_level
    when 1 then 'supervisor'
    when 2 then 'operations_executive'
    when 3 then 'facility_manager'
    when 4 then 'project_head'
    else 'supervisor'
  end
$$;

create or replace function public.hospital_ticket_role_label(p_role text)
returns text language sql immutable as $$
  select case p_role
    when 'housekeeping_supervisor' then 'Supervisor'
    when 'operations_executive' then 'Operations Executive'
    when 'facility_manager' then 'Facility Manager'
    when 'project_head' then 'Project Head'
    else initcap(replace(coalesce(p_role, 'owner'), '_', ' '))
  end
$$;

create or replace function public.hospital_ticket_status_for_level(p_level integer, p_existing_status text)
returns text language sql immutable as $$
  select case
    when p_level = 1 then case when p_existing_status = 'open' then 'assigned' else coalesce(p_existing_status, 'assigned') end
    when p_level = 2 then 'escalated_operations_executive'
    when p_level = 3 then 'escalated_facility_manager'
    when p_level = 4 then 'escalated_project_head'
    else coalesce(p_existing_status, 'assigned')
  end
$$;

create or replace function public.hospital_pick_ticket_owner(p_client_id uuid, p_role text)
returns public.hospital_ticket_users language plpgsql security definer set search_path=public as $$
declare
  v_user public.hospital_ticket_users%rowtype;
begin
  select * into v_user
  from public.hospital_ticket_users
  where client_id = p_client_id
    and role_code = p_role
    and is_active = true
  order by created_at
  limit 1;
  return v_user;
end $$;

create or replace function public.hospital_ticket_prepare_assignment()
returns trigger language plpgsql security definer set search_path=public as $$
declare
  v_supervisor public.hospital_ticket_users%rowtype;
  v_routing jsonb;
  v_due timestamptz;
begin
  if new.status_code in ('resolved_awaiting_confirmation','closed','cancelled') then
    new.escalation_due_at := null;
    new.sla_status := case when new.status_code='closed' then 'closed' else 'resolved' end;
    return new;
  end if;

  if tg_op='INSERT' then
    new.current_escalation_level := 'supervisor';
    new.current_escalation_level_no := 1;
    new.escalation_count := coalesce(new.escalation_count, 0);
    new.final_escalation := false;
    if new.current_assignee_user_id is null then
      new.supervisor_sla_due_at := null;
      new.escalation_due_at := null;
      new.sla_status := 'not_applicable';
      new.metadata := coalesce(new.metadata,'{}'::jsonb) || jsonb_build_object(
        'assignment_state','unassigned',
        'assignment_failure_reason',coalesce(new.metadata->>'assignment_failure_reason','no_verified_active_shift_assignment')
      );
    else
      new.assigned_at := coalesce(new.assigned_at, now());
      v_due := new.assigned_at + make_interval(mins => public.hospital_ticket_sla_minutes(new.priority, 1));
      new.supervisor_sla_due_at := v_due;
      new.escalation_due_at := v_due;
      new.sla_status := 'running';
    end if;
  elsif tg_op='UPDATE' and old.status_code='resolved_awaiting_confirmation' and new.status_code='reopened' then
    v_routing := public.hospital_select_ticket_supervisor(new.client_id, new.block_id, null, new.category_id, now());
    if coalesce((v_routing->>'assigned')::boolean, false) then
      select * into v_supervisor from public.hospital_ticket_users where id=(v_routing->>'user_id')::uuid and is_active for share;
    end if;
    new.current_escalation_level := 'supervisor';
    new.current_escalation_level_no := 1;
    new.current_assignee_user_id := v_supervisor.id;
    new.current_assignee_role := case when v_supervisor.id is null then null else 'housekeeping_supervisor' end;
    new.supervisor_user_id := v_supervisor.id;
    new.assigned_at := case when v_supervisor.id is null then null else now() end;
    v_due := case when v_supervisor.id is null then null else now()+make_interval(mins => public.hospital_ticket_sla_minutes(new.priority, 1)) end;
    new.supervisor_sla_due_at := v_due;
    new.escalation_due_at := v_due;
    new.supervisor_escalated_at := null;
    new.operations_executive_user_id := null;
    new.operations_sla_due_at := null;
    new.operations_escalated_at := null;
    new.facility_manager_user_id := null;
    new.facility_manager_escalated_at := null;
    new.project_head_user_id := null;
    new.project_head_sla_due_at := null;
    new.project_head_escalated_at := null;
    new.escalation_count := 0;
    new.final_escalation := false;
    new.sla_status := case when v_supervisor.id is null then 'not_applicable' else 'running' end;
    new.metadata := coalesce(new.metadata,'{}'::jsonb) || jsonb_build_object(
      'assignment_state',case when v_supervisor.id is null then 'unassigned' else 'assigned' end,
      'assignment_failure_reason',case when v_supervisor.id is null then v_routing->>'reason' else null end,
      'routing_reason',v_routing->>'reason',
      'assignment_type',v_routing->>'assignment_type',
      'routing_assignment_id',v_routing->>'assignment_id',
      'routing_shift_id',v_routing->>'shift_id',
      'sla_restarted_at',now(),
      'sla_cycle',new.reopen_count
    );
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
    new.escalation_due_at := null;
    new.sla_status := 'not_applicable';
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
    v_due := now() + make_interval(mins => public.hospital_ticket_sla_minutes(new.priority, v_level));
    new.escalation_due_at := coalesce(new.escalation_due_at, v_due);
    new.sla_status := case when v_level = 4 then 'final_owner' else 'running' end;
    new.final_escalation := v_level = 4;
    if v_level = 1 then new.supervisor_sla_due_at := coalesce(new.supervisor_sla_due_at, new.escalation_due_at); end if;
    if v_level = 2 then new.operations_sla_due_at := coalesce(new.operations_sla_due_at, new.escalation_due_at); end if;
    if v_level = 4 then new.project_head_sla_due_at := coalesce(new.project_head_sla_due_at, new.escalation_due_at); end if;
  end if;
  return new;
end $$;

drop trigger if exists trg_hospital_ticket_prepare_assignment on public.hospital_tickets;
create trigger trg_hospital_ticket_prepare_assignment
before insert or update of status_code on public.hospital_tickets
for each row execute function public.hospital_ticket_prepare_assignment();

drop trigger if exists trg_hospital_ticket_prepare_owner_sla on public.hospital_tickets;
create trigger trg_hospital_ticket_prepare_owner_sla
before update of current_assignee_user_id, current_assignee_role, escalation_due_at on public.hospital_tickets
for each row execute function public.hospital_ticket_prepare_owner_sla();

create or replace function public.hospital_ticket_notification_enrich()
returns trigger language plpgsql security definer set search_path=public as $$
declare
  v_ticket public.hospital_tickets%rowtype;
begin
  select * into v_ticket from public.hospital_tickets where id = new.ticket_id;
  if found then
    new.priority := coalesce(new.priority, v_ticket.priority);
    new.current_owner_role := coalesce(new.current_owner_role, v_ticket.current_assignee_role);
    new.escalation_level := coalesce(new.escalation_level, v_ticket.current_escalation_level_no);
    new.metadata := coalesce(new.metadata,'{}'::jsonb) || jsonb_build_object(
      'priority', coalesce(new.priority, v_ticket.priority),
      'current_owner', coalesce(new.current_owner_role, v_ticket.current_assignee_role),
      'escalation_level', coalesce(new.escalation_level, v_ticket.current_escalation_level_no)
    );
  end if;
  new.read_status := coalesce(new.read_status, false);
  return new;
end $$;

drop trigger if exists trg_hospital_ticket_notification_enrich on public.hospital_ticket_notifications;
create trigger trg_hospital_ticket_notification_enrich
before insert on public.hospital_ticket_notifications
for each row execute function public.hospital_ticket_notification_enrich();

drop index if exists ux_hospital_ticket_events_priority_sla_milestone;
create unique index ux_hospital_ticket_events_priority_sla_milestone
  on public.hospital_ticket_events(
    ticket_id,
    event_type,
    ((event_data->>'sla_cycle')),
    ((event_data->>'from_level')),
    ((event_data->>'to_level'))
  )
  where event_type in (
    'supervisor_sla_missed','operations_executive_sla_missed','facility_manager_sla_missed',
    'ticket_escalated','project_head_assigned','project_head_sla_final'
  );

create or replace function public.rpc_process_hospital_ticket_sla(
  p_now timestamptz default now(),
  p_operations_sla_minutes integer default 30
)
returns jsonb language plpgsql security definer set search_path=public as $$
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
    where status_code not in ('resolved_awaiting_confirmation','closed','cancelled')
      and coalesce(final_escalation, false) = false
      and current_assignee_user_id is not null
      and coalesce(
        escalation_due_at,
        case
          when coalesce(current_escalation_level_no, public.hospital_ticket_level_for_role(current_assignee_role)) = 1 then supervisor_sla_due_at
          when coalesce(current_escalation_level_no, public.hospital_ticket_level_for_role(current_assignee_role)) = 2 then operations_sla_due_at
          when coalesce(current_escalation_level_no, public.hospital_ticket_level_for_role(current_assignee_role)) = 4 then project_head_sla_due_at
          else null
        end
      ) is not null
      and coalesce(
        escalation_due_at,
        case
          when coalesce(current_escalation_level_no, public.hospital_ticket_level_for_role(current_assignee_role)) = 1 then supervisor_sla_due_at
          when coalesce(current_escalation_level_no, public.hospital_ticket_level_for_role(current_assignee_role)) = 2 then operations_sla_due_at
          when coalesce(current_escalation_level_no, public.hospital_ticket_level_for_role(current_assignee_role)) = 4 then project_head_sla_due_at
          else null
        end
      ) <= p_now
    for update skip locked
  loop
    v_level := greatest(1, least(4, coalesce(v_ticket.current_escalation_level_no, public.hospital_ticket_level_for_role(v_ticket.current_assignee_role), 1)));
    if v_level >= 4 then
      update public.hospital_tickets
      set sla_status='final_owner',
          final_escalation=true,
          project_head_sla_due_at=coalesce(project_head_sla_due_at, escalation_due_at),
          version=version+1,
          updated_at=p_now
      where id=v_ticket.id;
      insert into public.hospital_ticket_events(ticket_id,event_type,from_status,to_status,actor_name,actor_role,remarks,event_data)
      values(v_ticket.id,'project_head_sla_final',v_ticket.status_code,v_ticket.status_code,'QPMS SLA Engine','system',
        'Project Head is the final escalation owner.',
        jsonb_build_object('sla_cycle',v_ticket.reopen_count,'from_level',v_level,'to_level',v_level))
      on conflict do nothing;
      continue;
    end if;

    v_next_level := v_level + 1;
    v_next_role := public.hospital_ticket_role_for_level(v_next_level);
    v_next_status := public.hospital_ticket_status_for_level(v_next_level, v_ticket.status_code);
    v_due := p_now + make_interval(mins => public.hospital_ticket_sla_minutes(v_ticket.priority, v_next_level));
    v_missed_event := case v_level
      when 1 then 'supervisor_sla_missed'
      when 2 then 'operations_executive_sla_missed'
      when 3 then 'facility_manager_sla_missed'
      else 'sla_missed'
    end;
    v_assignee := public.hospital_pick_ticket_owner(v_ticket.client_id, v_next_role);

    if v_assignee.id is null then
      update public.hospital_tickets
      set escalation_due_at = null,
          sla_status = 'blocked',
          metadata = coalesce(metadata,'{}'::jsonb) || jsonb_build_object(
            'assignment_state','escalation_blocked',
            'assignment_failure_reason','no_active_' || v_next_role,
            'assignment_failed_at',p_now,
            'blocked_escalation_level',v_next_level
          ),
          version = version + 1,
          updated_at = p_now
      where id = v_ticket.id;
      insert into public.hospital_ticket_events(ticket_id,event_type,from_status,to_status,actor_name,actor_role,remarks,event_data)
      values(v_ticket.id,v_next_role || '_assignment_missing',v_ticket.status_code,v_ticket.status_code,'QPMS SLA Engine','system',
        public.hospital_ticket_role_label(v_next_role) || ' assignment is missing for SLA escalation.',
        jsonb_build_object('reason','no_active_' || v_next_role,'from_level',v_level,'to_level',v_next_level,'sla_cycle',v_ticket.reopen_count))
      on conflict do nothing;
      insert into public.hospital_ticket_notifications(ticket_id,recipient_user_id,notification_type,title,body,priority,current_owner_role,escalation_level)
      select v_ticket.id,u.id,'assignment_alert','Hospital ticket escalation blocked',
        v_ticket.ticket_no || ' requires ' || public.hospital_ticket_role_label(v_next_role) || ' mapping.',
        v_ticket.priority,v_ticket.current_assignee_role,v_level
      from public.hospital_ticket_users u
      where u.client_id=v_ticket.client_id and u.is_active
        and u.role_code in ('operations_executive','facility_manager','project_head');
      v_assignment_failures := v_assignment_failures + 1;
      continue;
    end if;

    update public.hospital_tickets
    set status_code = v_next_status,
        current_escalation_level = public.hospital_ticket_level_code(v_next_level),
        current_escalation_level_no = v_next_level,
        current_assignee_user_id = v_assignee.id,
        current_assignee_role = v_next_role,
        assigned_at = p_now,
        operations_executive_user_id = case when v_next_role='operations_executive' then v_assignee.id else operations_executive_user_id end,
        facility_manager_user_id = case when v_next_role='facility_manager' then v_assignee.id else facility_manager_user_id end,
        project_head_user_id = case when v_next_role='project_head' then v_assignee.id else project_head_user_id end,
        supervisor_sla_due_at = case when v_level=1 then null else supervisor_sla_due_at end,
        supervisor_escalated_at = case when v_level=1 then coalesce(supervisor_escalated_at,p_now) else supervisor_escalated_at end,
        operations_sla_due_at = case when v_next_level=2 then v_due when v_level=2 then null else operations_sla_due_at end,
        operations_escalated_at = case when v_level=2 then coalesce(operations_escalated_at,p_now) else operations_escalated_at end,
        facility_manager_escalated_at = case when v_level=3 then coalesce(facility_manager_escalated_at,p_now) else facility_manager_escalated_at end,
        project_head_sla_due_at = case when v_next_level=4 then v_due else project_head_sla_due_at end,
        project_head_escalated_at = case when v_next_level=4 then p_now else project_head_escalated_at end,
        escalation_due_at = v_due,
        last_escalated_at = p_now,
        escalation_count = coalesce(escalation_count,0) + 1,
        final_escalation = v_next_level = 4,
        sla_status = case when v_next_level = 4 then 'final_owner' else 'running' end,
        metadata = (coalesce(metadata,'{}'::jsonb)-'assignment_failure_reason') || jsonb_build_object(
          'assignment_state','assigned',
          'last_escalation_from',public.hospital_ticket_level_code(v_level),
          'last_escalation_to',public.hospital_ticket_level_code(v_next_level)
        ),
        version = version + 1,
        updated_at = p_now
    where id = v_ticket.id;

    insert into public.hospital_ticket_events(ticket_id,event_type,from_status,to_status,actor_name,actor_role,remarks,event_data)
    values(v_ticket.id,v_missed_event,v_ticket.status_code,v_ticket.status_code,'QPMS SLA Engine','system',
      public.hospital_ticket_role_label(v_ticket.current_assignee_role) || ' SLA missed.',
      jsonb_build_object('sla_cycle',v_ticket.reopen_count,'from_level',v_level,'to_level',v_next_level,'due_at',coalesce(v_ticket.escalation_due_at,v_ticket.supervisor_sla_due_at,v_ticket.operations_sla_due_at)))
    on conflict do nothing;
    insert into public.hospital_ticket_events(ticket_id,event_type,from_status,to_status,actor_name,actor_role,remarks,event_data)
    values(v_ticket.id,case when v_next_level=4 then 'project_head_assigned' else 'ticket_escalated' end,
      v_ticket.status_code,v_next_status,'QPMS SLA Engine','system',
      'Escalated to ' || public.hospital_ticket_role_label(v_next_role) || '.',
      jsonb_build_object('sla_cycle',v_ticket.reopen_count,'from_level',v_level,'to_level',v_next_level,'due_at',v_due))
    on conflict do nothing;

    insert into public.hospital_ticket_notifications(ticket_id,recipient_user_id,notification_type,title,body,priority,current_owner_role,escalation_level)
    values(v_ticket.id,v_assignee.id,'sla_escalation',
      public.hospital_ticket_role_label(v_ticket.current_assignee_role) || ' SLA missed',
      v_ticket.ticket_no || ' requires ' || public.hospital_ticket_role_label(v_next_role) || ' action.',
      v_ticket.priority,v_next_role,v_next_level);

    if v_level = 1 then v_count_supervisor := v_count_supervisor + 1;
    elsif v_level = 2 then v_count_operations := v_count_operations + 1;
    elsif v_level = 3 then v_count_facility := v_count_facility + 1;
    end if;
    if v_next_level = 4 then v_count_project_head := v_count_project_head + 1; end if;
  end loop;

  return jsonb_build_object(
    'supervisor_escalations', v_count_supervisor,
    'operations_escalations', v_count_operations,
    'facility_manager_escalations', v_count_facility,
    'project_head_assignments', v_count_project_head,
    'assignment_failures', v_assignment_failures,
    'processed_at', p_now
  );
end $$;

create or replace function public.rpc_hospital_ticket_action(
  p_ticket_id uuid,
  p_actor_user_id uuid,
  p_action text,
  p_expected_version integer,
  p_payload jsonb default '{}'::jsonb,
  p_operations_sla_minutes integer default 30
)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_ticket public.hospital_tickets%rowtype;
  v_actor public.hospital_ticket_users%rowtype;
  v_from text;
  v_to text;
  v_event text;
  v_remarks text := nullif(btrim(p_payload->>'remarks'), '');
  v_assignee public.hospital_ticket_users%rowtype;
  v_due timestamptz;
begin
  select * into v_actor from public.hospital_ticket_users where id = p_actor_user_id and is_active for share;
  if not found then raise exception 'Active hospital ticket actor required.' using errcode = '42501'; end if;
  select * into v_ticket from public.hospital_tickets where id = p_ticket_id for update;
  if not found then raise exception 'Ticket not found.' using errcode = 'P0002'; end if;
  if v_ticket.client_id <> v_actor.client_id then raise exception 'Cross-client action denied.' using errcode = '42501'; end if;
  if not exists (
    select 1 from public.hospital_ticket_user_scopes s
    where s.hospital_ticket_user_id=v_actor.id and s.client_id=v_ticket.client_id
      and case when v_actor.profile_type='internal' then s.can_update else s.can_view end
      and (s.scope_type='client' or (s.scope_type='block' and s.block_id=v_ticket.block_id) or (s.scope_type='location' and s.location_id=v_ticket.location_id))
  ) then raise exception 'Ticket action is outside the actor scope.' using errcode='42501'; end if;
  if v_ticket.version <> p_expected_version then raise exception 'Ticket version conflict.' using errcode = '40001'; end if;
  v_from := v_ticket.status_code;

  if p_action = 'accept' and v_actor.role_code = 'housekeeping_supervisor' and v_from in ('open','assigned','reopened') then
    v_to := 'accepted'; v_event := 'ticket_accepted';
    update public.hospital_tickets set status_code=v_to, accepted_at=now(), current_assignee_user_id=v_actor.id, current_assignee_role=v_actor.role_code, version=version+1, updated_at=now() where id=p_ticket_id returning * into v_ticket;
  elsif p_action = 'start_work' and v_actor.role_code = 'housekeeping_supervisor' and v_from in ('accepted','reopened') then
    v_to := 'in_progress'; v_event := 'work_started';
    update public.hospital_tickets set status_code=v_to, work_started_at=now(), version=version+1, updated_at=now() where id=p_ticket_id returning * into v_ticket;
  elsif p_action in ('progress','request_assistance')
    and (
      (p_action='request_assistance' and v_actor.role_code='housekeeping_supervisor' and v_from in ('open','assigned','accepted','in_progress','reopened'))
      or (p_action='progress' and (
        (v_actor.role_code='housekeeping_supervisor' and v_from in ('open','assigned','accepted','in_progress','reopened'))
        or (v_actor.role_code='operations_executive' and v_from='escalated_operations_executive')
        or (v_actor.role_code='facility_manager' and v_from in ('escalated_facility_manager','reopened'))
        or (v_actor.role_code='project_head' and v_from='escalated_project_head')
      ))
    ) then
    v_to := v_from; v_event := case when p_action='progress' then 'progress_update' else 'assistance_requested' end;
    if v_remarks is null then raise exception 'Remarks are required.' using errcode='22023'; end if;
    update public.hospital_tickets set version=version+1, updated_at=now() where id=p_ticket_id returning * into v_ticket;
  elsif p_action in ('manual_escalation','escalate_operations') and v_actor.role_code in ('housekeeping_supervisor','operations_executive') and v_from in ('open','assigned','accepted','in_progress','reopened') then
    select * into v_assignee from public.hospital_ticket_users where client_id=v_ticket.client_id and role_code='operations_executive' and is_active order by created_at limit 1;
    v_due := now()+make_interval(mins=>public.hospital_ticket_sla_minutes(v_ticket.priority, 2));
    v_to := 'escalated_operations_executive'; v_event := 'manual_escalation';
    update public.hospital_tickets set
      status_code=v_to,
      current_escalation_level='operations_executive',
      current_escalation_level_no=2,
      current_assignee_user_id=v_assignee.id,
      current_assignee_role='operations_executive',
      operations_executive_user_id=v_assignee.id,
      assigned_at=now(),
      supervisor_sla_due_at=null,
      supervisor_escalated_at=coalesce(supervisor_escalated_at,now()),
      operations_sla_due_at=v_due,
      escalation_due_at=v_due,
      last_escalated_at=now(),
      escalation_count=coalesce(escalation_count,0)+1,
      final_escalation=false,
      sla_status='running',
      version=version+1,
      updated_at=now()
    where id=p_ticket_id returning * into v_ticket;
  elsif p_action = 'escalate_facility' and v_actor.role_code in ('operations_executive','facility_manager') and v_from='escalated_operations_executive' then
    select * into v_assignee from public.hospital_ticket_users where client_id=v_ticket.client_id and role_code='facility_manager' and is_active order by created_at limit 1;
    v_due := now()+make_interval(mins=>public.hospital_ticket_sla_minutes(v_ticket.priority, 3));
    v_to := 'escalated_facility_manager'; v_event := 'facility_manager_assigned';
    update public.hospital_tickets set
      status_code=v_to,
      current_escalation_level='facility_manager',
      current_escalation_level_no=3,
      current_assignee_user_id=v_assignee.id,
      current_assignee_role='facility_manager',
      facility_manager_user_id=v_assignee.id,
      assigned_at=now(),
      operations_sla_due_at=null,
      operations_escalated_at=now(),
      escalation_due_at=v_due,
      last_escalated_at=now(),
      escalation_count=coalesce(escalation_count,0)+1,
      final_escalation=false,
      sla_status='running',
      version=version+1,
      updated_at=now()
    where id=p_ticket_id returning * into v_ticket;
  elsif p_action = 'take_over' and (
    (v_actor.role_code='operations_executive' and v_from='escalated_operations_executive')
    or (v_actor.role_code='facility_manager' and v_from='escalated_facility_manager')
    or (v_actor.role_code='project_head' and v_from='escalated_project_head')
  ) then
    v_to := v_from; v_event := case
      when v_actor.role_code='operations_executive' then 'operations_taken_over'
      when v_actor.role_code='facility_manager' then 'facility_manager_assigned'
      else 'project_head_taken_over'
    end;
    update public.hospital_tickets set current_assignee_user_id=v_actor.id, current_assignee_role=v_actor.role_code, version=version+1, updated_at=now() where id=p_ticket_id returning * into v_ticket;
  elsif p_action = 'reassign_supervisor' and v_actor.role_code='operations_executive' and v_from not in ('closed','cancelled','resolved_awaiting_confirmation') then
    select u.* into v_assignee from public.hospital_ticket_users u join public.hospital_ticket_user_scopes s on s.hospital_ticket_user_id=u.id where u.client_id=v_ticket.client_id and u.role_code='housekeeping_supervisor' and u.is_active and s.block_id=v_ticket.block_id and s.can_update order by u.created_at limit 1;
    if v_assignee.id is null then raise exception 'No active block Supervisor is available.' using errcode='22023'; end if;
    v_due := now()+make_interval(mins=>public.hospital_ticket_sla_minutes(v_ticket.priority, 1));
    v_to:=v_from; v_event:='supervisor_assigned';
    update public.hospital_tickets set current_escalation_level='supervisor',current_escalation_level_no=1,current_assignee_user_id=v_assignee.id,current_assignee_role='housekeeping_supervisor',supervisor_user_id=v_assignee.id,assigned_at=now(),supervisor_sla_due_at=v_due,operations_sla_due_at=null,escalation_due_at=v_due,final_escalation=false,sla_status='running',version=version+1,updated_at=now() where id=p_ticket_id returning * into v_ticket;
  elsif p_action = 'assign_support' and v_actor.role_code='facility_manager' and v_from not in ('closed','cancelled','resolved_awaiting_confirmation') then
    if v_remarks is null then raise exception 'Support assignment remarks are required.' using errcode='22023'; end if;
    v_to:=v_from; v_event:='progress_update';
    update public.hospital_tickets set version=version+1,updated_at=now() where id=p_ticket_id returning * into v_ticket;
  elsif p_action = 'resolve' and (
    (v_actor.role_code='housekeeping_supervisor' and v_from in ('in_progress','accepted','reopened'))
    or (v_actor.role_code='operations_executive' and v_from='escalated_operations_executive')
    or (v_actor.role_code='facility_manager' and v_from in ('escalated_facility_manager','reopened'))
    or (v_actor.role_code='project_head' and v_from='escalated_project_head')
  ) then
    if nullif(btrim(p_payload->>'resolution_action'),'') is null or nullif(btrim(p_payload->>'resolution_remarks'),'') is null then raise exception 'Resolution action and remarks are required.' using errcode='22023'; end if;
    if not exists (select 1 from public.hospital_ticket_attachments where ticket_id=p_ticket_id and attachment_type='completion_photo') then raise exception 'Completion photo is required.' using errcode='22023'; end if;
    v_to := 'resolved_awaiting_confirmation'; v_event := 'ticket_resolved';
    update public.hospital_tickets set status_code=v_to, current_escalation_level='client_confirmation', escalation_due_at=null, sla_status='resolved', resolved_at=now(), resolved_by_user_id=v_actor.id, resolution_action=btrim(p_payload->>'resolution_action'), resolution_remarks=btrim(p_payload->>'resolution_remarks'), awaiting_confirmation_at=now(), version=version+1, updated_at=now() where id=p_ticket_id returning * into v_ticket;
  elsif p_action = 'feedback' and v_actor.profile_type='client' and v_from='resolved_awaiting_confirmation' then
    if (p_payload->>'rating')::integer not between 1 and 5 then raise exception 'Rating must be from 1 to 5.' using errcode='22023'; end if;
    if p_payload->>'satisfaction_status' = 'satisfied' then
      v_to := 'closed'; v_event := 'client_satisfied';
      update public.hospital_tickets set status_code=v_to, current_escalation_level='completed', escalation_due_at=null, sla_status='closed', client_rating=(p_payload->>'rating')::integer, client_feedback=coalesce(p_payload->>'comments',''), client_satisfaction_status='satisfied', closed_at=now(), version=version+1, updated_at=now() where id=p_ticket_id returning * into v_ticket;
    elsif p_payload->>'satisfaction_status' = 'not_satisfied' and nullif(btrim(p_payload->>'comments'),'') is not null then
      v_to := 'reopened'; v_event := 'client_not_satisfied';
      update public.hospital_tickets set status_code=v_to,
        client_rating=(p_payload->>'rating')::integer, client_feedback=btrim(p_payload->>'comments'), client_satisfaction_status='not_satisfied', reopened_at=now(), reopen_count=reopen_count+1, version=version+1, updated_at=now() where id=p_ticket_id returning * into v_ticket;
    else raise exception 'Not Satisfied feedback requires a reason.' using errcode='22023'; end if;
  else
    raise exception 'Status transition is not allowed for this actor.' using errcode='42501';
  end if;

  insert into public.hospital_ticket_events(ticket_id,event_type,from_status,to_status,actor_user_id,actor_name,actor_role,remarks,event_data)
    values(p_ticket_id,v_event,v_from,v_to,v_actor.id,v_actor.display_name,v_actor.role_code,v_remarks,p_payload);
  if p_action in ('progress','request_assistance','assign_support') then
    insert into public.hospital_ticket_comments(ticket_id,author_user_id,author_name,author_role,comment_type,comment_text,is_client_visible)
      values(p_ticket_id,v_actor.id,v_actor.display_name,v_actor.role_code,'internal_update',v_remarks,coalesce((p_payload->>'is_client_visible')::boolean,false));
  elsif p_action='resolve' then
    insert into public.hospital_ticket_comments(ticket_id,author_user_id,author_name,author_role,comment_type,comment_text,is_client_visible)
      values(p_ticket_id,v_actor.id,v_actor.display_name,v_actor.role_code,'resolution_note',btrim(p_payload->>'resolution_remarks'),true);
  elsif p_action='feedback' then
    insert into public.hospital_ticket_comments(ticket_id,author_user_id,author_name,author_role,comment_type,comment_text,is_client_visible)
      values(p_ticket_id,v_actor.id,v_actor.display_name,v_actor.role_code,'feedback',coalesce(nullif(btrim(p_payload->>'comments'),''),'Client confirmed satisfaction.'),true);
  end if;
  if p_action='resolve' then
    insert into public.hospital_ticket_events(ticket_id,event_type,from_status,to_status,actor_name,actor_role,remarks)
      values(p_ticket_id,'awaiting_client_confirmation',v_to,v_to,'QPMS Workflow','system','Waiting for client confirmation.');
    insert into public.hospital_ticket_notifications(ticket_id,recipient_user_id,notification_type,title,body)
      values(p_ticket_id,v_ticket.raised_by_user_id,'awaiting_confirmation','Confirm housekeeping resolution',v_ticket.ticket_no||' is waiting for your confirmation.');
  elsif p_action='feedback' and v_to='reopened' then
    insert into public.hospital_ticket_events(ticket_id,event_type,from_status,to_status,actor_user_id,actor_name,actor_role,remarks)
      values(p_ticket_id,'ticket_reopened',v_from,v_to,v_actor.id,v_actor.display_name,v_actor.role_code,v_remarks);
  elsif p_action='feedback' and v_to='closed' then
    insert into public.hospital_ticket_events(ticket_id,event_type,from_status,to_status,actor_user_id,actor_name,actor_role,remarks)
      values(p_ticket_id,'ticket_closed',v_from,v_to,v_actor.id,v_actor.display_name,v_actor.role_code,v_remarks);
  end if;
  if p_action='feedback' then
    insert into public.hospital_ticket_notifications(ticket_id,recipient_user_id,notification_type,title,body)
    select p_ticket_id,recipient_id,case when v_to='closed' then 'client_satisfied' else 'ticket_reopened' end,
      case when v_to='closed' then 'Client confirmed satisfaction' else 'Client reopened complaint' end,
      v_ticket.ticket_no||case when v_to='closed' then ' was closed by the client.' else ' requires further action.' end
    from (select distinct unnest(array[v_ticket.supervisor_user_id,v_ticket.operations_executive_user_id,v_ticket.facility_manager_user_id,v_ticket.project_head_user_id,v_ticket.resolved_by_user_id]) recipient_id) recipients
    where recipient_id is not null;
  end if;
  return jsonb_build_object('ticket',to_jsonb(v_ticket));
end $$;

create or replace function public.rpc_record_hospital_assignment_failure(
  p_ticket_id uuid,
  p_expected_version integer,
  p_stage text,
  p_reason text
)
returns jsonb language plpgsql security definer set search_path=public as $$
declare v_ticket public.hospital_tickets%rowtype; v_event text;
begin
  if p_stage not in ('operations_executive','facility_manager','project_head') then
    raise exception 'Unsupported assignment stage.' using errcode='22023';
  end if;
  select * into v_ticket from public.hospital_tickets where id=p_ticket_id for update;
  if not found then raise exception 'Ticket not found.' using errcode='P0002'; end if;
  if v_ticket.version<>p_expected_version then raise exception 'Ticket version conflict.' using errcode='40001'; end if;
  v_event := p_stage || '_assignment_missing';
  update public.hospital_tickets set
    supervisor_sla_due_at=case when p_stage='operations_executive' then null else supervisor_sla_due_at end,
    operations_sla_due_at=case when p_stage='facility_manager' then null else operations_sla_due_at end,
    project_head_sla_due_at=case when p_stage='project_head' then null else project_head_sla_due_at end,
    escalation_due_at=null,
    sla_status='blocked',
    metadata=coalesce(metadata,'{}'::jsonb)||jsonb_build_object(
      'assignment_state','escalation_blocked','assignment_failure_reason',p_reason,'assignment_failed_at',now()
    ),version=version+1,updated_at=now()
  where id=p_ticket_id returning * into v_ticket;
  insert into public.hospital_ticket_events(ticket_id,event_type,from_status,to_status,actor_name,actor_role,remarks,event_data)
  values(v_ticket.id,v_event,v_ticket.status_code,v_ticket.status_code,'QPMS Assignment Engine','system',
    'Escalation could not be assigned because the required active role is not mapped.',
    jsonb_build_object('reason',p_reason,'stage',p_stage)) on conflict do nothing;
  insert into public.hospital_ticket_notifications(ticket_id,recipient_user_id,notification_type,title,body,priority,current_owner_role,escalation_level)
  select v_ticket.id,u.id,'assignment_alert','Hospital ticket assignment blocked',v_ticket.ticket_no||' requires role mapping.',
    v_ticket.priority,v_ticket.current_assignee_role,v_ticket.current_escalation_level_no
  from public.hospital_ticket_users u
  where u.client_id=v_ticket.client_id and u.is_active and (
    (p_stage='operations_executive' and u.role_code in ('facility_manager','project_head'))
    or (p_stage='facility_manager' and u.role_code in ('facility_manager','project_head'))
    or (p_stage='project_head' and u.role_code='facility_manager')
  );
  return jsonb_build_object('ticket',to_jsonb(v_ticket));
end $$;

insert into public.access_roles (code, name, user_type, module_id, description, metadata)
select 'project_head', 'Project Head', 'internal', m.id, 'Hospital operations Project Head.', '{"source":"day2_priority_matrix"}'::jsonb
from public.access_modules m
where m.code = 'hospital_operations'
on conflict do nothing;

insert into public.access_role_permissions (role_id, permission_id, allowed)
select r.id, p.id, true
from public.access_roles r
join public.access_permissions p on p.code in ('hospital_ticket.view', 'routing.view')
where r.code = 'project_head'
on conflict (role_id, permission_id) do update set allowed = excluded.allowed;

revoke all on function public.hospital_ticket_effective_priority(text) from public, anon, authenticated;
revoke all on function public.hospital_ticket_sla_minutes(text,integer) from public, anon, authenticated;
revoke all on function public.hospital_ticket_role_for_level(integer) from public, anon, authenticated;
revoke all on function public.hospital_ticket_level_for_role(text) from public, anon, authenticated;
revoke all on function public.hospital_ticket_level_code(integer) from public, anon, authenticated;
revoke all on function public.hospital_ticket_role_label(text) from public, anon, authenticated;
revoke all on function public.hospital_ticket_status_for_level(integer,text) from public, anon, authenticated;
revoke all on function public.hospital_pick_ticket_owner(uuid,text) from public, anon, authenticated;
revoke all on function public.hospital_ticket_prepare_assignment() from public, anon, authenticated;
revoke all on function public.hospital_ticket_prepare_owner_sla() from public, anon, authenticated;
revoke all on function public.hospital_ticket_notification_enrich() from public, anon, authenticated;
revoke all on function public.rpc_hospital_ticket_action(uuid,uuid,text,integer,jsonb,integer) from public, anon, authenticated;
revoke all on function public.rpc_process_hospital_ticket_sla(timestamptz,integer) from public, anon, authenticated;
revoke all on function public.rpc_record_hospital_assignment_failure(uuid,integer,text,text) from public, anon, authenticated;
grant execute on function public.hospital_ticket_effective_priority(text) to service_role;
grant execute on function public.hospital_ticket_sla_minutes(text,integer) to service_role;
grant execute on function public.hospital_ticket_role_for_level(integer) to service_role;
grant execute on function public.hospital_ticket_level_for_role(text) to service_role;
grant execute on function public.hospital_ticket_level_code(integer) to service_role;
grant execute on function public.hospital_ticket_role_label(text) to service_role;
grant execute on function public.hospital_ticket_status_for_level(integer,text) to service_role;
grant execute on function public.hospital_pick_ticket_owner(uuid,text) to service_role;
grant execute on function public.rpc_hospital_ticket_action(uuid,uuid,text,integer,jsonb,integer) to service_role;
grant execute on function public.rpc_process_hospital_ticket_sla(timestamptz,integer) to service_role;
grant execute on function public.rpc_record_hospital_assignment_failure(uuid,integer,text,text) to service_role;
