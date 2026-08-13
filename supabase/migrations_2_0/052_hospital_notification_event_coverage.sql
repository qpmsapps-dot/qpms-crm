-- Phase 3 Hospital Ticketing notification event coverage.
-- Extends Phase 2 dedupe semantics for lifecycle notification types.

create or replace function public.hospital_ticket_notification_dedupe_key(p_row public.hospital_ticket_notifications)
returns text language plpgsql stable set search_path=public as $$
declare
  v_ticket public.hospital_tickets%rowtype;
  v_cycle text;
  v_window text;
  v_version text;
begin
  if p_row.ticket_id is null or p_row.recipient_user_id is null or p_row.notification_type is null then
    return null;
  end if;

  select * into v_ticket
  from public.hospital_tickets
  where id = p_row.ticket_id;

  v_cycle := coalesce(
    p_row.metadata->>'sla_cycle',
    p_row.metadata->>'reopen_count',
    case when v_ticket.id is not null then coalesce(v_ticket.reopen_count, 0)::text end,
    '0'
  );

  v_version := coalesce(
    p_row.metadata->>'ticket_version',
    case when v_ticket.id is not null then coalesce(v_ticket.version, 0)::text end,
    '0'
  );

  if p_row.notification_type = 'incoming_supervisor_ticket' then
    v_window := coalesce(
      p_row.action_expires_at::text,
      p_row.metadata->>'acceptance_due_at',
      case when v_ticket.id is not null then v_ticket.acceptance_due_at::text end,
      v_version,
      'unknown'
    );
    return concat_ws(':', 'hospital_ticket_notification', p_row.notification_type, p_row.ticket_id, p_row.recipient_user_id, v_window);
  end if;

  if p_row.notification_type = 'sla_escalation' then
    return concat_ws(':', 'hospital_ticket_notification', p_row.notification_type, p_row.ticket_id, p_row.recipient_user_id, coalesce(p_row.escalation_level, 0)::text, v_cycle);
  end if;

  if p_row.notification_type = 'assignment_alert' then
    return concat_ws(':', 'hospital_ticket_notification', p_row.notification_type, p_row.ticket_id, p_row.recipient_user_id, coalesce(p_row.current_owner_role, ''), coalesce(p_row.escalation_level, 0)::text, coalesce(p_row.metadata->>'reason', p_row.metadata->>'stage', ''));
  end if;

  if p_row.notification_type in (
    'ticket_created',
    'ticket_accepted',
    'work_started',
    'ticket_assigned_internal',
    'ticket_reopened_client',
    'ticket_closed',
    'awaiting_confirmation',
    'ticket_reopened',
    'client_satisfied',
    'ticket_cancelled',
    'supervisor_acceptance_timeout'
  ) then
    return concat_ws(':', 'hospital_ticket_notification', p_row.notification_type, p_row.ticket_id, p_row.recipient_user_id, v_version, v_cycle);
  end if;

  return null;
end $$;

revoke all on function public.hospital_ticket_notification_dedupe_key(public.hospital_ticket_notifications) from public, anon, authenticated;
grant execute on function public.hospital_ticket_notification_dedupe_key(public.hospital_ticket_notifications) to service_role;
