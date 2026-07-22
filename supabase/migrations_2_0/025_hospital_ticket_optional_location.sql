-- Phase 2A.1: allow hospital ticket creation with hierarchy + exact landmark
-- when no confirmed room/area location row exists. Additive and backward-compatible.

alter table public.hospital_tickets
  alter column location_id drop not null;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'hospital_tickets_meaningful_location_check'
  ) then
    alter table public.hospital_tickets
      add constraint hospital_tickets_meaningful_location_check
      check (
        block_id is not null
        and nullif(btrim(coalesce(floor_name, '')), '') is not null
        and nullif(btrim(coalesce(location_text, '')), '') is not null
        and (
          location_id is not null
          or nullif(btrim(coalesce(exact_landmark_snapshot, '')), '') is not null
        )
      );
  end if;
end $$;

create or replace function public.set_hospital_ticket_location_snapshots()
returns trigger language plpgsql security definer set search_path=public as $$
declare
  v_client public.hospital_clients%rowtype;
  v_block public.hospital_blocks%rowtype;
  v_location public.hospital_locations%rowtype;
  v_room_area text;
  v_path text;
begin
  select * into v_client from public.hospital_clients where id = new.client_id;
  select * into v_block from public.hospital_blocks where id = new.block_id;

  if new.location_id is not null then
    select * into v_location from public.hospital_locations where id = new.location_id;
    v_room_area := nullif(btrim(concat_ws(' / ', v_location.ward_name, v_location.room_number, v_location.area_name)), '');

    new.ward_name_snapshot := coalesce(new.ward_name_snapshot, v_location.ward_name);
    new.room_area_snapshot := coalesce(new.room_area_snapshot, v_room_area);
    new.location_source_snapshot := coalesce(new.location_source_snapshot, v_location.source);
    new.location_verification_status_snapshot := coalesce(
      new.location_verification_status_snapshot,
      v_location.verification_status
    );
  end if;

  new.site_name_snapshot := coalesce(new.site_name_snapshot, v_client.client_name);
  new.block_name_snapshot := coalesce(new.block_name_snapshot, v_block.block_name);
  new.exact_landmark_snapshot := nullif(btrim(coalesce(new.exact_landmark_snapshot, '')), '');

  v_path := nullif(btrim(concat_ws(
    ' > ',
    new.site_name_snapshot,
    new.block_name_snapshot,
    case
      when lower(nullif(btrim(coalesce(new.floor_name, '')), '')) in ('not specified', 'floor not confirmed') then null
      else nullif(btrim(coalesce(new.floor_name, '')), '')
    end,
    nullif(btrim(coalesce(new.department_name, '')), ''),
    nullif(btrim(coalesce(new.ward_name_snapshot, '')), ''),
    nullif(btrim(coalesce(new.room_area_snapshot, '')), ''),
    case
      when nullif(btrim(coalesce(new.location_text, '')), '') is not null
        and nullif(btrim(coalesce(new.location_text, '')), '') is distinct from nullif(btrim(coalesce(new.room_area_snapshot, '')), '')
      then nullif(btrim(coalesce(new.location_text, '')), '')
      else null
    end,
    new.exact_landmark_snapshot
  )), '');

  new.location_path_snapshot := coalesce(new.location_path_snapshot, v_path);
  return new;
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
)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_actor public.hospital_ticket_users%rowtype;
  v_block public.hospital_blocks%rowtype;
  v_floor public.hospital_floors%rowtype;
  v_department public.hospital_departments%rowtype;
  v_location public.hospital_locations%rowtype;
  v_supervisor public.hospital_ticket_users%rowtype;
  v_ticket public.hospital_tickets%rowtype;
  v_ticket_no text;
  v_landmark text;
  v_floor_name text;
  v_department_name text;
  v_location_text text;
  v_room_area text;
begin
  v_landmark := nullif(btrim(coalesce(p_exact_landmark, '')), '');

  select * into v_actor from public.hospital_ticket_users where id = p_actor_user_id and is_active = true for share;
  if not found or v_actor.profile_type <> 'client' or v_actor.role_code not in ('doctor', 'hospital_management') then
    raise exception 'Active client ticket user required.' using errcode = '42501';
  end if;

  if nullif(btrim(p_idempotency_key), '') is null then
    raise exception 'Idempotency key is required.' using errcode = '22023';
  end if;

  perform pg_advisory_xact_lock(
    hashtextextended(p_actor_user_id::text || ':' || btrim(p_idempotency_key), 0)
  );

  select * into v_ticket from public.hospital_tickets
    where raised_by_user_id = p_actor_user_id and idempotency_key = btrim(p_idempotency_key);
  if found then return jsonb_build_object('ticket', to_jsonb(v_ticket), 'idempotent_replay', true); end if;

  select * into v_block from public.hospital_blocks
    where id = p_block_id and client_id = v_actor.client_id and is_active = true;
  if not found then raise exception 'Block is outside the actor client.' using errcode = '42501'; end if;

  if p_floor_id is not null then
    select * into v_floor from public.hospital_floors
      where id = p_floor_id and client_id = v_actor.client_id and block_id = p_block_id and is_active = true;
    if not found then raise exception 'Floor is outside the selected block.' using errcode = '42501'; end if;
  end if;

  if p_department_id is not null then
    select * into v_department from public.hospital_departments
      where id = p_department_id and client_id = v_actor.client_id and block_id = p_block_id and is_active = true;
    if not found then raise exception 'Department is outside the selected block.' using errcode = '42501'; end if;
    if p_floor_id is not null and v_department.floor_id is not null and v_department.floor_id <> p_floor_id then
      raise exception 'Department is outside the selected floor.' using errcode = '42501';
    end if;
  end if;

  if p_location_id is not null then
    select * into v_location from public.hospital_locations
      where id = p_location_id and block_id = p_block_id and client_id = v_actor.client_id and is_active = true;
    if not found then raise exception 'Location is outside the actor client/block.' using errcode = '42501'; end if;
    if p_floor_id is not null and v_location.floor_id is not null and v_location.floor_id <> p_floor_id then
      raise exception 'Location is outside the selected floor.' using errcode = '42501';
    end if;
    if p_department_id is not null and v_location.department_id is not null and v_location.department_id <> p_department_id then
      raise exception 'Location is outside the selected department.' using errcode = '42501';
    end if;
  elsif v_landmark is null then
    raise exception 'Select a room/area or provide an exact location landmark.' using errcode = '22023';
  elsif p_department_id is null then
    raise exception 'Select a department/unit for landmark-only tickets.' using errcode = '22023';
  end if;

  if not exists (
    select 1 from public.hospital_ticket_user_scopes s
    where s.hospital_ticket_user_id = p_actor_user_id and s.client_id = v_actor.client_id and s.can_create
      and (
        s.scope_type = 'client'
        or (s.scope_type = 'block' and s.block_id = p_block_id)
        or (s.scope_type = 'location' and p_location_id is not null and s.location_id = p_location_id)
      )
  ) then raise exception 'Ticket creation is outside the actor scope.' using errcode = '42501'; end if;

  if not exists (select 1 from public.hospital_ticket_categories c where c.id = p_category_id and c.is_active and (c.client_id is null or c.client_id = v_actor.client_id)) then
    raise exception 'Category is unavailable.' using errcode = '22023';
  end if;

  select u.* into v_supervisor
  from public.hospital_ticket_users u
  join public.hospital_ticket_user_scopes s on s.hospital_ticket_user_id = u.id
  where u.client_id = v_actor.client_id and u.role_code = 'housekeeping_supervisor' and u.is_active
    and s.can_update and (s.scope_type = 'client' or (s.scope_type = 'block' and s.block_id = p_block_id))
  order by u.created_at limit 1;

  v_floor_name := coalesce(v_location.floor_name, v_floor.floor_name, nullif(v_department.metadata->>'floor_name', ''), 'Not specified');
  v_department_name := coalesce(v_location.department_name, v_department.department_name);
  v_room_area := nullif(btrim(concat_ws(' / ', v_location.ward_name, v_location.room_number, v_location.area_name)), '');
  v_location_text := coalesce(nullif(btrim(coalesce(v_location.location_name, '')), ''), v_room_area, v_landmark);

  v_ticket_no := 'QPMS-HK-' || to_char(timezone('Asia/Kolkata', now()), 'YYYY') || '-' || lpad(nextval('public.hospital_ticket_number_seq')::text, 6, '0');
  insert into public.hospital_tickets (
    ticket_no, client_id, block_id, location_id, category_id,
    raised_by_user_id, raised_by_name, raised_by_role, floor_name,
    department_name, location_text, title, description, priority,
    status_code, current_assignee_user_id, current_assignee_role,
    supervisor_user_id, assigned_at, supervisor_sla_due_at, idempotency_key,
    exact_landmark_snapshot
  ) values (
    v_ticket_no, v_actor.client_id, p_block_id, p_location_id, p_category_id,
    v_actor.id, v_actor.display_name, v_actor.role_code, v_floor_name,
    v_department_name, v_location_text, btrim(p_title),
    btrim(p_description), p_priority,
    case when v_supervisor.id is null then 'open' else 'assigned' end,
    v_supervisor.id, case when v_supervisor.id is null then null else 'housekeeping_supervisor' end,
    v_supervisor.id, case when v_supervisor.id is null then null else now() end,
    now() + make_interval(mins => greatest(1, p_supervisor_sla_minutes)), btrim(p_idempotency_key),
    v_landmark
  ) returning * into v_ticket;

  insert into public.hospital_ticket_events(ticket_id, event_type, to_status, actor_user_id, actor_name, actor_role, remarks)
    values (v_ticket.id, 'ticket_created', v_ticket.status_code, v_actor.id, v_actor.display_name, v_actor.role_code, 'Housekeeping complaint created.');

  if v_supervisor.id is not null then
    insert into public.hospital_ticket_events(ticket_id, event_type, from_status, to_status, actor_name, actor_role, remarks, event_data)
      values (v_ticket.id, 'supervisor_assigned', 'open', 'assigned', 'QPMS SLA Engine', 'system', 'Assigned to block Housekeeping Supervisor.', jsonb_build_object('supervisor_user_id', v_supervisor.id));
    insert into public.hospital_ticket_notifications(ticket_id, recipient_user_id, notification_type, title, body)
      values (v_ticket.id, v_supervisor.id, 'ticket_assigned', 'New housekeeping complaint', v_ticket.ticket_no || ' requires action.');
  end if;

  return jsonb_build_object('ticket', to_jsonb(v_ticket), 'idempotent_replay', false);
end $$;

revoke all on function public.rpc_create_hospital_ticket(uuid,uuid,uuid,uuid,text,text,text,text,integer,uuid,uuid,text) from public, anon, authenticated;
grant execute on function public.rpc_create_hospital_ticket(uuid,uuid,uuid,uuid,text,text,text,text,integer,uuid,uuid,text) to service_role;
