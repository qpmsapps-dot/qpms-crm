-- Separate housekeeping operational ownership from management escalation.
-- This migration changes behavior only; it does not rewrite ticket history.

create or replace function public.hospital_can_access_ticket(p_ticket_id uuid)
returns boolean
language sql
stable
security definer
set search_path=public
as $$
  select exists (
    select 1
    from public.hospital_tickets t
    join public.hospital_ticket_users u
      on u.auth_user_id=auth.uid()
     and u.is_active
     and u.client_id=t.client_id
    where t.id=p_ticket_id
      and case
        when u.role_code='facility_manager' then exists (
          select 1 from public.hospital_ticket_user_scopes s
          where s.hospital_ticket_user_id=u.id
            and s.client_id=t.client_id
            and s.can_view
        )
        when u.role_code in ('housekeeping_supervisor','operations_executive') then
          t.status_code not in ('closed','cancelled')
          and lower(coalesce(u.metadata->>'test_user','false')) <> 'true'
          and lower(coalesce(u.metadata->>'demo','false')) <> 'true'
          and lower(coalesce(u.metadata->>'demo_user','false')) <> 'true'
          and lower(coalesce(u.metadata->>'uat_only','false')) <> 'true'
          and lower(coalesce(u.metadata->>'do_not_use_for_real_staff','false')) <> 'true'
          and exists (
            select 1 from public.hospital_ticket_user_scopes s
            where s.hospital_ticket_user_id=u.id
              and s.client_id=t.client_id
              and s.can_view
          )
        when u.role_code='project_head' then
          t.current_assignee_user_id=u.id
          and public.hospital_can_access_scope(t.client_id,t.block_id,t.location_id,'view')
        else public.hospital_can_access_scope(t.client_id,t.block_id,t.location_id,'view')
      end
  )
$$;

drop policy if exists hospital_tickets_scoped_select on public.hospital_tickets;
create policy hospital_tickets_scoped_select
on public.hospital_tickets
for select
to authenticated
using (public.hospital_can_access_ticket(id));

revoke all on function public.hospital_can_access_ticket(uuid) from public;
grant execute on function public.hospital_can_access_ticket(uuid) to authenticated, service_role;

create or replace function public.rpc_accept_hospital_operational_ticket(
  p_ticket_id uuid,
  p_actor_user_id uuid,
  p_expected_version integer,
  p_confirmed_location boolean default false,
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
  v_previous_status text;
  v_is_escalated boolean;
  v_previous_escalation_owner uuid;
begin
  if p_confirmed_location is not true then
    raise exception 'Confirm that this location is under your responsibility.' using errcode='22023';
  end if;

  select * into v_actor
  from public.hospital_ticket_users
  where id=p_actor_user_id
    and is_active
    and profile_type='internal'
    and role_code='housekeeping_supervisor'
  for share;
  if not found then
    raise exception 'Only an active Supervisor can accept this ticket.' using errcode='42501';
  end if;
  if lower(coalesce(v_actor.metadata->>'test_user','false'))='true'
    or lower(coalesce(v_actor.metadata->>'demo','false'))='true'
    or lower(coalesce(v_actor.metadata->>'demo_user','false'))='true'
    or lower(coalesce(v_actor.metadata->>'uat_only','false'))='true'
    or lower(coalesce(v_actor.metadata->>'do_not_use_for_real_staff','false'))='true'
  then
    raise exception 'A production Supervisor profile is required.' using errcode='42501';
  end if;
  if coalesce(v_actor.duty_status, 'off_duty') <> 'on_duty' then
    raise exception 'Supervisor must be On Duty to accept tickets.' using errcode='42501';
  end if;

  select * into v_ticket
  from public.hospital_tickets
  where id=p_ticket_id
  for update;
  if not found then raise exception 'Ticket not found.' using errcode='P0002'; end if;
  if v_ticket.version <> p_expected_version then
    raise exception 'Ticket version conflict.' using errcode='40001';
  end if;
  if v_ticket.client_id <> v_actor.client_id then
    raise exception 'Cross-client acceptance denied.' using errcode='42501';
  end if;
  if v_ticket.status_code in ('resolved_awaiting_confirmation','closed','cancelled') then
    raise exception 'This ticket is no longer open for Supervisor acceptance.' using errcode='40001';
  end if;
  if v_ticket.supervisor_user_id is not null then
    raise exception 'Ticket has already been accepted by another Supervisor.' using errcode='40001';
  end if;
  if not exists (
    select 1
    from public.hospital_ticket_user_scopes s
    where s.hospital_ticket_user_id=v_actor.id
      and s.client_id=v_ticket.client_id
      and s.can_update
  ) then
    raise exception 'Ticket acceptance is outside the actor client scope.' using errcode='42501';
  end if;

  v_previous_status := v_ticket.status_code;
  v_is_escalated := v_ticket.status_code in (
    'escalated_operations_executive',
    'escalated_facility_manager',
    'escalated_project_head'
  );
  v_previous_escalation_owner := case when v_is_escalated then v_ticket.current_assignee_user_id else null end;

  update public.hospital_tickets
  set status_code=case when v_is_escalated then status_code else 'accepted' end,
      acceptance_status='accepted',
      acceptance_due_at=null,
      accepted_at=p_now,
      accepted_by_user_id=v_actor.id,
      supervisor_user_id=v_actor.id,
      current_assignee_user_id=case when v_is_escalated then current_assignee_user_id else v_actor.id end,
      current_assignee_role=case when v_is_escalated then current_assignee_role else 'housekeeping_supervisor' end,
      current_escalation_level=case when v_is_escalated then current_escalation_level else 'supervisor' end,
      current_escalation_level_no=case when v_is_escalated then current_escalation_level_no else 1 end,
      assigned_at=coalesce(assigned_at, raised_at, created_at, p_now),
      final_escalation=case when v_is_escalated then final_escalation else false end,
      sla_status=case when v_is_escalated then sla_status else 'running' end,
      metadata=coalesce(metadata,'{}'::jsonb) || jsonb_build_object(
        'assignment_state','accepted',
        'operational_supervisor_user_id',v_actor.id,
        'operational_accepted_at',p_now,
        'accepted_after_escalation',v_is_escalated,
        'preserved_escalation_owner_user_id',v_previous_escalation_owner,
        'preserved_escalation_level',case when v_is_escalated then v_ticket.current_escalation_level else null end,
        'preserved_escalation_level_no',case when v_is_escalated then v_ticket.current_escalation_level_no else null end
      ),
      version=version+1,
      updated_at=p_now
  where id=p_ticket_id
    and version=p_expected_version
    and supervisor_user_id is null
  returning * into v_ticket;

  if v_ticket.id is null then
    raise exception 'Ticket has already been accepted by another Supervisor.' using errcode='40001';
  end if;

  update public.hospital_ticket_notifications
  set action_status=case when recipient_user_id=v_actor.id then 'accepted' else 'superseded' end,
      superseded_at=case when recipient_user_id=v_actor.id then superseded_at else p_now end,
      superseded_reason=case when recipient_user_id=v_actor.id then superseded_reason else 'accepted_by_other_supervisor' end
  where ticket_id=p_ticket_id
    and notification_type='incoming_supervisor_ticket'
    and action_status='active';

  perform public.hospital_record_assignment_history(
    p_ticket_id,
    null,
    v_actor.id,
    'operational_owner',
    null,
    null,
    case when v_is_escalated then 'accepted_after_management_escalation' else 'supervisor_self_accepted' end,
    v_actor.id,
    'self_acceptance',
    v_previous_status,
    v_ticket.status_code,
    jsonb_build_object(
      'accepted_at',p_now,
      'confirmed_location',p_confirmed_location,
      'escalation_preserved',v_is_escalated,
      'escalation_owner_user_id',v_previous_escalation_owner,
      'escalation_level',v_ticket.current_escalation_level,
      'escalation_level_no',v_ticket.current_escalation_level_no
    )
  );

  insert into public.hospital_ticket_events(
    ticket_id,event_type,from_status,to_status,actor_user_id,actor_name,actor_role,remarks,event_data
  ) values (
    p_ticket_id,
    case when v_is_escalated then 'supervisor_accepted_after_escalation' else 'supervisor_self_accepted' end,
    v_previous_status,
    v_ticket.status_code,
    v_actor.id,
    v_actor.display_name,
    v_actor.role_code,
    case
      when v_is_escalated then 'Ticket operationally accepted by Supervisor; management escalation was preserved.'
      else 'Ticket accepted by Supervisor ' || v_actor.display_name || '.'
    end,
    jsonb_build_object(
      'accepted_at',p_now,
      'operational_supervisor_user_id',v_actor.id,
      'escalation_preserved',v_is_escalated,
      'escalation_owner_user_id',v_previous_escalation_owner,
      'escalation_level',v_ticket.current_escalation_level,
      'escalation_level_no',v_ticket.current_escalation_level_no
    )
  );

  return jsonb_build_object(
    'ticket',to_jsonb(v_ticket),
    'accepted_by',jsonb_build_object('id',v_actor.id,'display_name',v_actor.display_name),
    'escalation_preserved',v_is_escalated
  );
end $$;

revoke all on function public.rpc_accept_hospital_operational_ticket(uuid,uuid,integer,boolean,timestamptz)
  from public, anon, authenticated;
grant execute on function public.rpc_accept_hospital_operational_ticket(uuid,uuid,integer,boolean,timestamptz)
  to service_role;

comment on function public.rpc_accept_hospital_operational_ticket(uuid,uuid,integer,boolean,timestamptz) is
  'Atomically assigns an open Hospital ticket to one operational Supervisor while preserving any management escalation owner, status, SLA history, events, and notifications.';
