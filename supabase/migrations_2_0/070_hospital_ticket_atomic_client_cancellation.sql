-- Make registered-client cancellation atomic and preserve the client actor identity.

alter table public.hospital_ticket_events
  add column if not exists actor_client_contact_id uuid
    references public.hospital_client_contacts(id) on delete set null;

create index if not exists idx_hospital_ticket_events_client_actor
  on public.hospital_ticket_events(actor_client_contact_id, created_at desc)
  where actor_client_contact_id is not null;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'hospital_ticket_events_single_actor_check'
  ) then
    alter table public.hospital_ticket_events
      add constraint hospital_ticket_events_single_actor_check
      check (not (actor_user_id is not null and actor_client_contact_id is not null));
  end if;
end $$;

create or replace function public.hospital_ticket_validate_event_actor()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if new.event_type = 'ticket_cancelled_by_client' then
    if new.actor_user_id is not null or new.actor_client_contact_id is null then
      raise exception 'Client cancellation events require the client-contact actor.' using errcode = '23514';
    end if;
  elsif new.actor_role = 'system' then
    if new.actor_user_id is not null or new.actor_client_contact_id is not null then
      raise exception 'System ticket events cannot use a human actor identifier.' using errcode = '23514';
    end if;
  end if;
  return new;
end $$;

drop trigger if exists trg_hospital_ticket_validate_event_actor on public.hospital_ticket_events;
create trigger trg_hospital_ticket_validate_event_actor
before insert on public.hospital_ticket_events
for each row execute function public.hospital_ticket_validate_event_actor();

revoke all on function public.hospital_ticket_validate_event_actor() from public, anon, authenticated;
grant execute on function public.hospital_ticket_validate_event_actor() to service_role;

do $$
begin
  if exists (
    select 1
    from public.hospital_ticket_events
    where event_type = 'ticket_cancelled_by_client'
    group by ticket_id
    having count(*) > 1
  ) then
    raise exception 'Duplicate historical client cancellation events require manual review before migration 070.';
  end if;
end $$;

create unique index if not exists ux_hospital_ticket_client_cancellation_event
  on public.hospital_ticket_events(ticket_id, event_type)
  where event_type = 'ticket_cancelled_by_client';

create or replace function public.rpc_cancel_hospital_contact_ticket(
  p_contact_id uuid,
  p_ticket_id uuid,
  p_expected_version integer,
  p_reason_code text,
  p_reason_text text,
  p_now timestamptz default now()
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_contact public.hospital_client_contacts%rowtype;
  v_ticket public.hospital_tickets%rowtype;
  v_recipient_id uuid;
  v_notification_id uuid;
  v_reason text;
  v_from_status text;
begin
  select * into v_contact
  from public.hospital_client_contacts
  where id = p_contact_id and is_active = true
  for share;
  if not found then
    raise exception 'Registered client contact required.' using errcode = '42501';
  end if;

  select * into v_ticket
  from public.hospital_tickets
  where id = p_ticket_id
  for update;
  if not found or v_ticket.raised_by_client_contact_id is distinct from v_contact.id
      or v_ticket.client_id is distinct from v_contact.client_id then
    raise exception 'Ticket was not found for this registered mobile number.' using errcode = '42501';
  end if;

  if v_ticket.status_code = 'cancelled' then
    select id into v_notification_id
    from public.hospital_ticket_notifications
    where ticket_id = v_ticket.id and notification_type = 'ticket_cancelled'
    order by created_at limit 1;
    return jsonb_build_object(
      'ticket', to_jsonb(v_ticket),
      'notification_id', v_notification_id,
      'idempotent_replay', true
    );
  end if;
  if v_ticket.status_code in ('closed', 'resolved_awaiting_confirmation') then
    raise exception 'Ticket has already been closed and cannot be cancelled.' using errcode = '22023';
  end if;
  if v_ticket.status_code not in (
    'open', 'awaiting_supervisor_acceptance', 'assigned', 'accepted', 'in_progress', 'reopened',
    'escalated_operations_executive', 'escalated_facility_manager', 'escalated_project_head'
  ) then
    raise exception 'This ticket can no longer be cancelled.' using errcode = '22023';
  end if;
  if v_ticket.version <> p_expected_version then
    raise exception 'Ticket version conflict.' using errcode = '40001';
  end if;

  v_reason := left(coalesce(nullif(btrim(p_reason_text), ''), 'Client cancelled the ticket'), 500);
  v_from_status := v_ticket.status_code;
  v_recipient_id := coalesce(
    v_ticket.current_assignee_user_id,
    v_ticket.accepted_by_user_id,
    v_ticket.supervisor_user_id
  );

  update public.hospital_tickets
  set status_code = 'cancelled',
      cancelled_at = p_now,
      escalation_due_at = null,
      acceptance_status = case when acceptance_status = 'awaiting' then 'not_required' else coalesce(acceptance_status, 'not_required') end,
      version = version + 1,
      updated_at = p_now,
      metadata = coalesce(metadata, '{}'::jsonb) || jsonb_build_object(
        'cancellation', jsonb_build_object(
          'by_user_id', v_contact.id,
          'by_role', 'client_contact',
          'reason_code', left(coalesce(p_reason_code, ''), 80),
          'reason_text', v_reason,
          'cancelled_at', p_now
        )
      )
  where id = v_ticket.id
  returning * into v_ticket;

  insert into public.hospital_ticket_events(
    ticket_id, event_type, from_status, to_status, actor_user_id,
    actor_client_contact_id, actor_name, actor_role, remarks, event_data
  ) values (
    v_ticket.id, 'ticket_cancelled_by_client', v_from_status, 'cancelled', null,
    v_contact.id, v_contact.full_name, 'client_contact', v_reason,
    jsonb_build_object('reason_code', p_reason_code, 'cancelled_by_client', true, 'is_client_visible', true)
  ) on conflict (ticket_id, event_type) where event_type = 'ticket_cancelled_by_client' do nothing;

  if v_recipient_id is null then
    select n.recipient_user_id into v_recipient_id
    from public.hospital_ticket_notifications n
    where n.ticket_id = v_ticket.id
      and n.notification_type = 'incoming_supervisor_ticket'
      and n.action_status = 'active'
    order by n.created_at
    limit 1;
  end if;

  if v_recipient_id is not null then
    insert into public.hospital_ticket_notifications(
      ticket_id, recipient_user_id, notification_type, title, body,
      priority, current_owner_role, escalation_level, dedupe_key, metadata
    ) values (
      v_ticket.id, v_recipient_id, 'ticket_cancelled', 'Ticket Cancelled by Requester',
      'Ticket ' || v_ticket.ticket_no || ' has been cancelled by the requester.',
      v_ticket.priority, v_ticket.current_assignee_role, v_ticket.current_escalation_level_no,
      'hospital_ticket_notification:ticket_cancelled:' || v_ticket.id || ':' || v_recipient_id,
      jsonb_build_object(
        'ticket_id', v_ticket.id, 'ticket_no', v_ticket.ticket_no,
        'notification_type', 'ticket_cancelled', 'event_type', 'ticket_cancelled',
        'app_scope', 'myqpms_internal', 'target_screen', 'ticket_detail'
      )
    )
    on conflict (dedupe_key) do update set dedupe_key = excluded.dedupe_key
    returning id into v_notification_id;
  end if;

  update public.hospital_ticket_notifications
  set action_status = 'superseded',
      superseded_at = coalesce(superseded_at, p_now),
      superseded_reason = coalesce(superseded_reason, 'ticket_cancelled_by_client')
  where ticket_id = v_ticket.id
    and notification_type = 'incoming_supervisor_ticket'
    and action_status = 'active';

  return jsonb_build_object(
    'ticket', to_jsonb(v_ticket),
    'notification_id', v_notification_id,
    'idempotent_replay', false
  );
end $$;

revoke all on function public.rpc_cancel_hospital_contact_ticket(uuid,uuid,integer,text,text,timestamptz)
  from public, anon, authenticated;
grant execute on function public.rpc_cancel_hospital_contact_ticket(uuid,uuid,integer,text,text,timestamptz)
  to service_role;

-- supervisor_sla_due_at is the single resolution deadline. It starts on first
-- acceptance and is preserved by later Start Work updates.
create or replace function public.hospital_ticket_set_resolution_deadline()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if new.accepted_at is not null and old.accepted_at is null then
    new.supervisor_sla_due_at := new.accepted_at + interval '20 minutes';
    new.escalation_due_at := new.supervisor_sla_due_at;
    new.metadata := coalesce(new.metadata, '{}'::jsonb) || jsonb_build_object(
      'resolution_sla_started_at', new.accepted_at,
      'resolution_due_at', new.supervisor_sla_due_at,
      'resolution_sla_minutes', 20
    );
  elsif old.accepted_at is not null and new.accepted_at = old.accepted_at then
    new.supervisor_sla_due_at := old.supervisor_sla_due_at;
  end if;
  return new;
end $$;

drop trigger if exists trg_hospital_ticket_resolution_deadline on public.hospital_tickets;
create trigger trg_hospital_ticket_resolution_deadline
before update on public.hospital_tickets
for each row execute function public.hospital_ticket_set_resolution_deadline();

revoke all on function public.hospital_ticket_set_resolution_deadline() from public, anon, authenticated;
grant execute on function public.hospital_ticket_set_resolution_deadline() to service_role;

create or replace function public.hospital_ticket_write_requester_transition_notification()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_supervisor_name text;
  v_type text;
  v_title text;
  v_body text;
  v_target text;
  v_recipient_key text;
begin
  if old.status_code is distinct from 'accepted' and new.status_code = 'accepted' then
    select display_name into v_supervisor_name
    from public.hospital_ticket_users
    where id = new.accepted_by_user_id;
    v_type := 'ticket_accepted';
    v_title := 'Ticket Accepted';
    v_body := 'Your ticket has been accepted by ' || coalesce(v_supervisor_name, 'the assigned supervisor') ||
      '. It will be resolved within 20 minutes.';
    v_target := 'ticket_detail';
  elsif old.status_code is distinct from 'closed' and new.status_code = 'closed' then
    v_type := 'ticket_closed';
    v_title := 'Ticket Closed';
    v_body := 'Your ticket ' || new.ticket_no || ' has been resolved and closed.';
    v_target := 'ticket_detail';
  else
    return new;
  end if;

  v_recipient_key := case
    when new.raised_by_client_contact_id is not null then 'contact:' || new.raised_by_client_contact_id
    when new.raised_by_user_id is not null then new.raised_by_user_id::text
    else null
  end;
  if v_recipient_key is null then return new; end if;

  insert into public.hospital_ticket_notifications(
    ticket_id, recipient_user_id, recipient_client_contact_id,
    notification_type, title, body, priority, current_owner_role,
    escalation_level, dedupe_key, metadata
  ) values (
    new.id, new.raised_by_user_id, new.raised_by_client_contact_id,
    v_type, v_title, v_body, new.priority, new.current_assignee_role,
    new.current_escalation_level_no,
    concat_ws(':', 'hospital_ticket_notification', v_type, new.id, v_recipient_key, new.version, coalesce(new.reopen_count, 0)),
    jsonb_build_object(
      'ticket_id', new.id, 'ticket_no', new.ticket_no,
      'ticket_version', new.version, 'reopen_count', coalesce(new.reopen_count, 0),
      'app_scope', 'qpms_client', 'target_screen', v_target,
      'notification_type', v_type,
      'resolution_due_at', new.supervisor_sla_due_at,
      'accepted_by_name', v_supervisor_name
    )
  ) on conflict (dedupe_key) do nothing;
  return new;
end $$;

drop trigger if exists trg_hospital_ticket_requester_transition_notification on public.hospital_tickets;
create trigger trg_hospital_ticket_requester_transition_notification
after update on public.hospital_tickets
for each row execute function public.hospital_ticket_write_requester_transition_notification();

revoke all on function public.hospital_ticket_write_requester_transition_notification() from public, anon, authenticated;
grant execute on function public.hospital_ticket_write_requester_transition_notification() to service_role;
