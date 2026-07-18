-- Phase 1 Hospital Ticketing UAT readiness.
-- Forward-only: do not rewrite the 022 foundation migration.

alter table public.hospital_tickets
  alter column supervisor_sla_due_at drop not null;

drop index if exists public.ux_hospital_ticket_events_sla_milestone;
create unique index if not exists ux_hospital_ticket_events_sla_cycle
  on public.hospital_ticket_events(
    ticket_id,
    event_type,
    coalesce(event_data->>'sla_cycle', '0')
  )
  where event_type in (
    'supervisor_sla_warning', 'supervisor_sla_breached',
    'operations_sla_warning', 'operations_sla_breached'
  );
create unique index if not exists ux_hospital_ticket_assignment_alert
  on public.hospital_ticket_events(ticket_id, event_type)
  where event_type in (
    'ticket_unassigned',
    'operations_assignment_missing', 'facility_manager_assignment_missing'
  );

create or replace function public.hospital_ticket_prepare_assignment()
returns trigger language plpgsql security definer set search_path=public as $$
declare v_supervisor public.hospital_ticket_users%rowtype;
begin
  if tg_op='INSERT' and new.supervisor_user_id is null then
    new.supervisor_sla_due_at := null;
    new.metadata := coalesce(new.metadata,'{}'::jsonb) || jsonb_build_object(
      'assignment_state','unassigned',
      'assignment_failure_reason','no_active_supervisor_for_scope'
    );
  elsif tg_op='UPDATE' and old.status_code='resolved_awaiting_confirmation'
      and new.status_code='reopened' then
    select u.* into v_supervisor
    from public.hospital_ticket_users u
    join public.hospital_ticket_user_scopes s on s.hospital_ticket_user_id=u.id
    where u.client_id=new.client_id and u.role_code='housekeeping_supervisor'
      and u.is_active and s.can_update
      and (s.scope_type='client' or (s.scope_type='block' and s.block_id=new.block_id))
    order by u.created_at limit 1;

    new.current_escalation_level := 'supervisor';
    new.current_assignee_user_id := v_supervisor.id;
    new.current_assignee_role := case when v_supervisor.id is null then null else 'housekeeping_supervisor' end;
    new.supervisor_user_id := v_supervisor.id;
    new.supervisor_sla_due_at := case when v_supervisor.id is null then null else now()+interval '20 minutes' end;
    new.supervisor_escalated_at := null;
    new.operations_executive_user_id := null;
    new.operations_sla_due_at := null;
    new.operations_escalated_at := null;
    new.facility_manager_user_id := null;
    new.metadata := coalesce(new.metadata,'{}'::jsonb) || jsonb_build_object(
      'assignment_state',case when v_supervisor.id is null then 'unassigned' else 'assigned' end,
      'assignment_failure_reason',case when v_supervisor.id is null then 'no_active_supervisor_for_reopen_scope' else null end,
      'sla_restarted_at',now(),
      'sla_cycle',new.reopen_count
    );
  end if;
  return new;
end $$;

drop trigger if exists trg_hospital_ticket_prepare_assignment on public.hospital_tickets;
create trigger trg_hospital_ticket_prepare_assignment
before insert or update of status_code on public.hospital_tickets
for each row execute function public.hospital_ticket_prepare_assignment();

create or replace function public.hospital_ticket_assignment_events()
returns trigger language plpgsql security definer set search_path=public as $$
begin
  if tg_op='INSERT' and new.supervisor_user_id is null then
    insert into public.hospital_ticket_events(
      ticket_id,event_type,to_status,actor_name,actor_role,remarks,event_data
    ) values (
      new.id,'ticket_unassigned',new.status_code,'QPMS Assignment Engine','system',
      'No active Housekeeping Supervisor is mapped to this scope.',
      jsonb_build_object('reason','no_active_supervisor_for_scope')
    ) on conflict do nothing;
    insert into public.hospital_ticket_notifications(ticket_id,recipient_user_id,notification_type,title,body)
    select new.id,u.id,'assignment_alert','Unassigned housekeeping ticket',new.ticket_no||' requires a Supervisor mapping.'
    from public.hospital_ticket_users u
    where u.client_id=new.client_id and u.role_code='facility_manager' and u.is_active;
  elsif tg_op='UPDATE' and old.status_code='resolved_awaiting_confirmation'
      and new.status_code='reopened' then
    insert into public.hospital_ticket_events(
      ticket_id,event_type,from_status,to_status,actor_name,actor_role,remarks,event_data
    ) values (
      new.id,
      case when new.supervisor_user_id is null then 'reopened_unassigned' else 'reopened_sla_restarted' end,
      old.status_code,new.status_code,'QPMS SLA Engine','system',
      case when new.supervisor_user_id is null
        then 'Ticket reopened but no active Supervisor is mapped.'
        else 'Supervisor SLA restarted for 20 minutes after client requested rework.' end,
      jsonb_build_object('sla_cycle',new.reopen_count,'supervisor_due_at',new.supervisor_sla_due_at)
    ) on conflict do nothing;
    if new.supervisor_user_id is not null then
      insert into public.hospital_ticket_notifications(ticket_id,recipient_user_id,notification_type,title,body)
      values(new.id,new.supervisor_user_id,'ticket_reopened','Client requested rework',new.ticket_no||' has a new 20-minute Supervisor SLA.');
    else
      insert into public.hospital_ticket_notifications(ticket_id,recipient_user_id,notification_type,title,body)
      select new.id,u.id,'assignment_alert','Reopened ticket is unassigned',new.ticket_no||' requires a Supervisor mapping.'
      from public.hospital_ticket_users u
      where u.client_id=new.client_id and u.role_code='facility_manager' and u.is_active;
    end if;
  end if;
  return null;
end $$;

drop trigger if exists trg_hospital_ticket_assignment_events on public.hospital_tickets;
create trigger trg_hospital_ticket_assignment_events
after insert or update of status_code on public.hospital_tickets
for each row execute function public.hospital_ticket_assignment_events();

create or replace function public.rpc_process_hospital_ticket_sla(
  p_now timestamptz default now(), p_operations_sla_minutes integer default 30
)
returns jsonb language plpgsql security definer set search_path=public as $$
declare
  v_ticket public.hospital_tickets%rowtype;
  v_assignee public.hospital_ticket_users%rowtype;
  v_supervisor_count int:=0; v_operations_count int:=0; v_assignment_failures int:=0;
begin
  insert into public.hospital_ticket_events(ticket_id,event_type,from_status,to_status,actor_name,actor_role,remarks,event_data)
  select t.id,'supervisor_sla_warning',t.status_code,t.status_code,'QPMS SLA Engine','system',
    'Supervisor SLA will expire within five minutes.',jsonb_build_object('sla_cycle',t.reopen_count)
  from public.hospital_tickets t
  where t.status_code in ('open','assigned','accepted','in_progress','reopened')
    and t.supervisor_sla_due_at>p_now and t.supervisor_sla_due_at<=p_now+interval '5 minutes'
  on conflict do nothing;

  insert into public.hospital_ticket_events(ticket_id,event_type,from_status,to_status,actor_name,actor_role,remarks,event_data)
  select t.id,'operations_sla_warning',t.status_code,t.status_code,'QPMS SLA Engine','system',
    'Operations SLA will expire within five minutes.',jsonb_build_object('sla_cycle',t.reopen_count)
  from public.hospital_tickets t where t.status_code='escalated_operations_executive'
    and t.operations_sla_due_at>p_now and t.operations_sla_due_at<=p_now+interval '5 minutes'
  on conflict do nothing;

  for v_ticket in select * from public.hospital_tickets
    where status_code in ('open','assigned','accepted','in_progress','reopened')
      and supervisor_sla_due_at is not null and supervisor_sla_due_at<=p_now
    for update skip locked loop
    v_assignee := null;
    select * into v_assignee from public.hospital_ticket_users
      where client_id=v_ticket.client_id and role_code='operations_executive' and is_active
      order by created_at limit 1;
    if v_assignee.id is null then
      update public.hospital_tickets set supervisor_sla_due_at=null,
        metadata=coalesce(metadata,'{}'::jsonb)||jsonb_build_object(
          'assignment_state','escalation_blocked','assignment_failure_reason','no_active_operations_executive','assignment_failed_at',p_now
        ),version=version+1,updated_at=p_now where id=v_ticket.id;
      insert into public.hospital_ticket_events(ticket_id,event_type,from_status,to_status,actor_name,actor_role,remarks,event_data)
      values(v_ticket.id,'operations_assignment_missing',v_ticket.status_code,v_ticket.status_code,'QPMS SLA Engine','system',
        'Supervisor SLA expired but no active Operations Executive is mapped.',jsonb_build_object('reason','no_active_operations_executive'))
      on conflict do nothing;
      insert into public.hospital_ticket_notifications(ticket_id,recipient_user_id,notification_type,title,body)
      select v_ticket.id,u.id,'assignment_alert','Operations assignment missing',v_ticket.ticket_no||' could not escalate to Operations.'
      from public.hospital_ticket_users u where u.client_id=v_ticket.client_id and u.role_code='facility_manager' and u.is_active;
      v_assignment_failures:=v_assignment_failures+1;
      continue;
    end if;
    update public.hospital_tickets set status_code='escalated_operations_executive',current_escalation_level='operations_executive',
      current_assignee_user_id=v_assignee.id,current_assignee_role='operations_executive',operations_executive_user_id=v_assignee.id,
      supervisor_escalated_at=p_now,operations_sla_due_at=p_now+make_interval(mins=>greatest(1,p_operations_sla_minutes)),
      metadata=(coalesce(metadata,'{}'::jsonb)-'assignment_failure_reason')||jsonb_build_object('assignment_state','assigned'),
      version=version+1,updated_at=p_now where id=v_ticket.id;
    insert into public.hospital_ticket_events(ticket_id,event_type,from_status,to_status,actor_name,actor_role,remarks,event_data)
    values(v_ticket.id,'supervisor_sla_breached',v_ticket.status_code,'escalated_operations_executive','QPMS SLA Engine','system',
      'Supervisor SLA exceeded.',jsonb_build_object('sla_cycle',v_ticket.reopen_count));
    insert into public.hospital_ticket_notifications(ticket_id,recipient_user_id,notification_type,title,body)
    values(v_ticket.id,v_assignee.id,'sla_escalation','Supervisor SLA breached',v_ticket.ticket_no||' requires Operations action.');
    v_supervisor_count:=v_supervisor_count+1;
  end loop;

  for v_ticket in select * from public.hospital_tickets where status_code='escalated_operations_executive'
    and operations_sla_due_at is not null and operations_sla_due_at<=p_now for update skip locked loop
    v_assignee := null;
    select * into v_assignee from public.hospital_ticket_users
      where client_id=v_ticket.client_id and role_code='facility_manager' and is_active order by created_at limit 1;
    if v_assignee.id is null then
      update public.hospital_tickets set operations_sla_due_at=null,
        metadata=coalesce(metadata,'{}'::jsonb)||jsonb_build_object(
          'assignment_state','escalation_blocked','assignment_failure_reason','no_active_facility_manager','assignment_failed_at',p_now
        ),version=version+1,updated_at=p_now where id=v_ticket.id;
      insert into public.hospital_ticket_events(ticket_id,event_type,from_status,to_status,actor_name,actor_role,remarks,event_data)
      values(v_ticket.id,'facility_manager_assignment_missing',v_ticket.status_code,v_ticket.status_code,'QPMS SLA Engine','system',
        'Operations SLA expired but no active Facility Manager is mapped.',jsonb_build_object('reason','no_active_facility_manager'))
      on conflict do nothing;
      insert into public.hospital_ticket_notifications(ticket_id,recipient_user_id,notification_type,title,body)
      values(v_ticket.id,v_ticket.current_assignee_user_id,'assignment_alert','Facility Manager assignment missing',v_ticket.ticket_no||' requires management configuration.');
      v_assignment_failures:=v_assignment_failures+1;
      continue;
    end if;
    update public.hospital_tickets set status_code='escalated_facility_manager',current_escalation_level='facility_manager',
      current_assignee_user_id=v_assignee.id,current_assignee_role='facility_manager',facility_manager_user_id=v_assignee.id,
      operations_escalated_at=p_now,metadata=(coalesce(metadata,'{}'::jsonb)-'assignment_failure_reason')||jsonb_build_object('assignment_state','assigned'),
      version=version+1,updated_at=p_now where id=v_ticket.id;
    insert into public.hospital_ticket_events(ticket_id,event_type,from_status,to_status,actor_name,actor_role,remarks,event_data)
    values(v_ticket.id,'operations_sla_breached',v_ticket.status_code,'escalated_facility_manager','QPMS SLA Engine','system',
      'Operations Executive SLA exceeded.',jsonb_build_object('sla_cycle',v_ticket.reopen_count));
    insert into public.hospital_ticket_notifications(ticket_id,recipient_user_id,notification_type,title,body)
    values(v_ticket.id,v_assignee.id,'sla_escalation','Operations SLA breached',v_ticket.ticket_no||' requires Facility Manager action.');
    v_operations_count:=v_operations_count+1;
  end loop;
  return jsonb_build_object('supervisor_escalations',v_supervisor_count,'operations_escalations',v_operations_count,
    'assignment_failures',v_assignment_failures,'processed_at',p_now);
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
  if p_stage not in ('operations_executive','facility_manager') then
    raise exception 'Unsupported assignment stage.' using errcode='22023';
  end if;
  select * into v_ticket from public.hospital_tickets where id=p_ticket_id for update;
  if not found then raise exception 'Ticket not found.' using errcode='P0002'; end if;
  if v_ticket.version<>p_expected_version then raise exception 'Ticket version conflict.' using errcode='40001'; end if;
  v_event := case when p_stage='operations_executive' then 'operations_assignment_missing' else 'facility_manager_assignment_missing' end;
  update public.hospital_tickets set
    supervisor_sla_due_at=case when p_stage='operations_executive' then null else supervisor_sla_due_at end,
    operations_sla_due_at=case when p_stage='facility_manager' then null else operations_sla_due_at end,
    metadata=coalesce(metadata,'{}'::jsonb)||jsonb_build_object(
      'assignment_state','escalation_blocked','assignment_failure_reason',p_reason,'assignment_failed_at',now()
    ),version=version+1,updated_at=now()
  where id=p_ticket_id returning * into v_ticket;
  insert into public.hospital_ticket_events(ticket_id,event_type,from_status,to_status,actor_name,actor_role,remarks,event_data)
  values(v_ticket.id,v_event,v_ticket.status_code,v_ticket.status_code,'QPMS Assignment Engine','system',
    'Escalation could not be assigned because the required active role is not mapped.',
    jsonb_build_object('reason',p_reason,'stage',p_stage)) on conflict do nothing;
  insert into public.hospital_ticket_notifications(ticket_id,recipient_user_id,notification_type,title,body)
  select v_ticket.id,u.id,'assignment_alert','Hospital ticket assignment blocked',v_ticket.ticket_no||' requires role mapping.'
  from public.hospital_ticket_users u
  where u.client_id=v_ticket.client_id and u.is_active and (
    (p_stage='operations_executive' and u.role_code='facility_manager')
    or (p_stage='facility_manager' and u.id=v_ticket.current_assignee_user_id)
  );
  return jsonb_build_object('ticket',to_jsonb(v_ticket));
end $$;

revoke all on function public.hospital_ticket_prepare_assignment() from public, anon, authenticated;
revoke all on function public.hospital_ticket_assignment_events() from public, anon, authenticated;
revoke all on function public.rpc_process_hospital_ticket_sla(timestamptz,integer) from public, anon, authenticated;
revoke all on function public.rpc_record_hospital_assignment_failure(uuid,integer,text,text) from public, anon, authenticated;
grant execute on function public.rpc_process_hospital_ticket_sla(timestamptz,integer) to service_role;
grant execute on function public.rpc_record_hospital_assignment_failure(uuid,integer,text,text) to service_role;
