-- Route contact-created Housekeeping tickets immediately to Operations when
-- no on-duty Supervisor was available for the initial broadcast.
--
-- Migration 057 already defines public.hospital_ticket_direct_to_operations().
-- This migration keeps the working broadcast RPC intact and adds a DB-side
-- guard that reacts to its existing supervisor_broadcast_created event.

create or replace function public.hospital_ticket_skip_empty_supervisor_broadcast()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_broadcast_count integer;
begin
  if new.event_type <> 'supervisor_broadcast_created' then
    return new;
  end if;

  v_broadcast_count := nullif(new.event_data->>'broadcast_count', '')::integer;
  if coalesce(v_broadcast_count, 0) > 0 then
    return new;
  end if;

  perform public.hospital_ticket_direct_to_operations(
    new.ticket_id,
    'no_on_duty_supervisor',
    coalesce(new.created_at, now())
  );
  return new;
end;
$$;

drop trigger if exists trg_hospital_ticket_skip_empty_supervisor_broadcast
  on public.hospital_ticket_events;

create trigger trg_hospital_ticket_skip_empty_supervisor_broadcast
after insert on public.hospital_ticket_events
for each row
when (new.event_type = 'supervisor_broadcast_created')
execute function public.hospital_ticket_skip_empty_supervisor_broadcast();

revoke all on function public.hospital_ticket_skip_empty_supervisor_broadcast()
  from public, anon, authenticated;
grant execute on function public.hospital_ticket_skip_empty_supervisor_broadcast()
  to service_role;
