-- Phase 2 Hospital Ticketing notification reliability hardening.
-- Additive/idempotent: hospital_ticket_notifications remains the source of truth.

alter table public.hospital_ticket_notifications
  add column if not exists dedupe_key text;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'hospital_ticket_notifications_dedupe_key_unique'
  ) then
    alter table public.hospital_ticket_notifications
      add constraint hospital_ticket_notifications_dedupe_key_unique unique (dedupe_key);
  end if;
end $$;

create or replace function public.hospital_ticket_notification_dedupe_key(p_row public.hospital_ticket_notifications)
returns text language plpgsql stable set search_path=public as $$
declare
  v_ticket public.hospital_tickets%rowtype;
  v_cycle text;
  v_window text;
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

  if p_row.notification_type = 'incoming_supervisor_ticket' then
    v_window := coalesce(
      p_row.action_expires_at::text,
      p_row.metadata->>'acceptance_due_at',
      case when v_ticket.id is not null then v_ticket.acceptance_due_at::text end,
      case when v_ticket.id is not null then v_ticket.version::text end,
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
    'awaiting_confirmation',
    'ticket_reopened',
    'client_satisfied',
    'ticket_cancelled',
    'supervisor_acceptance_timeout'
  ) then
    return concat_ws(':', 'hospital_ticket_notification', p_row.notification_type, p_row.ticket_id, p_row.recipient_user_id, coalesce(v_ticket.version, 0)::text, v_cycle);
  end if;

  return null;
end $$;

create or replace function public.set_hospital_ticket_notification_dedupe_key()
returns trigger language plpgsql set search_path=public as $$
begin
  if new.dedupe_key is null then
    new.dedupe_key := public.hospital_ticket_notification_dedupe_key(new);
  end if;
  return new;
end $$;

drop trigger if exists trg_hospital_ticket_notification_dedupe_key on public.hospital_ticket_notifications;
create trigger trg_hospital_ticket_notification_dedupe_key
before insert on public.hospital_ticket_notifications
for each row execute function public.set_hospital_ticket_notification_dedupe_key();

drop index if exists public.ux_hospital_incoming_supervisor_ticket_notification;
create unique index if not exists ux_hospital_incoming_supervisor_ticket_notification_window
  on public.hospital_ticket_notifications(ticket_id, recipient_user_id, notification_type, action_expires_at)
  where notification_type = 'incoming_supervisor_ticket'
    and action_expires_at is not null;

revoke all on function public.hospital_ticket_notification_dedupe_key(public.hospital_ticket_notifications) from public, anon, authenticated;
revoke all on function public.set_hospital_ticket_notification_dedupe_key() from public, anon, authenticated;
grant execute on function public.hospital_ticket_notification_dedupe_key(public.hospital_ticket_notifications) to service_role;
grant execute on function public.set_hospital_ticket_notification_dedupe_key() to service_role;
