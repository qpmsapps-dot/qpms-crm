-- Route registered-contact Hospital tickets only to on-duty scoped supervisors.
-- Migration 054 fixed the ticket insert shape; this migration keeps that shape
-- and replaces the legacy "first active supervisor" lookup with the existing
-- duty-aware helper used by the internal supervisor flow.

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
  v_location public.hospital_locations%rowtype;
  v_supervisor public.hospital_ticket_users%rowtype;
  v_ticket public.hospital_tickets%rowtype;
  v_ticket_no text;
  v_landmark text;
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
    return jsonb_build_object('ticket', to_jsonb(v_ticket), 'idempotent_replay', true);
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
  if not exists (
    select 1 from public.hospital_ticket_categories c
    where c.id = p_category_id
      and c.is_active
      and (c.client_id is null or c.client_id = v_contact.client_id)
  ) then
    raise exception 'Category is unavailable.' using errcode = '22023';
  end if;

  select u.* into v_supervisor
  from public.hospital_ticket_on_duty_supervisors(v_contact.client_id, p_block_id, p_location_id) u
  order by u.display_name, u.id
  limit 1;

  v_landmark := nullif(btrim(coalesce(p_exact_landmark, '')), '');
  v_ticket_no := 'QPMS-HK-' || to_char(timezone('Asia/Kolkata', now()), 'YYYY') || '-' || lpad(nextval('public.hospital_ticket_number_seq')::text, 6, '0');
  insert into public.hospital_tickets (
    ticket_no, client_id, block_id, location_id, category_id,
    raised_by_user_id, raised_by_client_contact_id, raised_by_client_contact_name,
    raised_by_client_contact_mobile, raised_by_client_contact_designation,
    raised_by_client_contact_department, raised_by_name, raised_by_role, floor_name,
    department_name, location_text, title, description, priority,
    status_code, current_assignee_user_id, current_assignee_role,
    supervisor_user_id, assigned_at, supervisor_sla_due_at, idempotency_key,
    exact_landmark_snapshot, metadata
  ) values (
    v_ticket_no, v_contact.client_id, p_block_id, p_location_id, p_category_id,
    null, v_contact.id, v_contact.full_name,
    v_contact.normalized_mobile, v_contact.designation,
    v_contact.department, v_contact.full_name, 'client_contact', v_location.floor_name,
    v_location.department_name, v_location.location_name, btrim(p_title),
    btrim(p_description), p_priority,
    case when v_supervisor.id is null then 'open' else 'assigned' end,
    v_supervisor.id, case when v_supervisor.id is null then null else 'housekeeping_supervisor' end,
    v_supervisor.id, case when v_supervisor.id is null then null else now() end,
    case when v_supervisor.id is null then null else now() + make_interval(mins => greatest(1, p_supervisor_sla_minutes)) end,
    btrim(p_idempotency_key), v_landmark,
    jsonb_build_object(
      'source', 'nims_client_contact_mobile',
      'assignment_source', 'contact_on_duty_supervisor',
      'assignment_state', case when v_supervisor.id is null then 'unassigned' else 'assigned' end,
      'assignment_failure_reason', case when v_supervisor.id is null then 'no_on_duty_supervisor' else null end
    )
  ) returning * into v_ticket;

  insert into public.hospital_ticket_events(ticket_id, event_type, to_status, actor_user_id, actor_name, actor_role, remarks, event_data)
    values (
      v_ticket.id, 'ticket_created', v_ticket.status_code, null,
      v_contact.full_name, 'client_contact', 'Housekeeping complaint created by registered NIMS contact.',
      jsonb_build_object('client_contact_id', v_contact.id)
    );
  if v_supervisor.id is not null then
    insert into public.hospital_ticket_events(ticket_id, event_type, from_status, to_status, actor_name, actor_role, remarks, event_data)
      values (v_ticket.id, 'supervisor_assigned', 'open', 'assigned', 'QPMS Assignment Engine', 'system', 'Assigned to on-duty block Housekeeping Supervisor.', jsonb_build_object('supervisor_user_id', v_supervisor.id));
    insert into public.hospital_ticket_notifications(ticket_id, recipient_user_id, notification_type, title, body)
      values (v_ticket.id, v_supervisor.id, 'ticket_assigned_internal', 'New housekeeping complaint', v_ticket.ticket_no || ' requires action.');
  end if;
  return jsonb_build_object('ticket', to_jsonb(v_ticket), 'idempotent_replay', false);
end $$;

revoke all on function public.rpc_create_hospital_contact_ticket(uuid,uuid,uuid,uuid,text,text,text,text,integer,uuid,uuid,text)
  from public, anon, authenticated;
grant execute on function public.rpc_create_hospital_contact_ticket(uuid,uuid,uuid,uuid,text,text,text,text,integer,uuid,uuid,text)
  to service_role;
