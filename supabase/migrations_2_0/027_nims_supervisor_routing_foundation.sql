-- Phase 2C: backend-controlled NIMS supervisor routing foundation.
-- Additive: creates shift/routing/history structures and replaces only hospital
-- ticket assignment functions. Existing migrations 022-026 remain unchanged.

create table if not exists public.hospital_shifts (
  id uuid primary key default gen_random_uuid(),
  client_id uuid references public.hospital_clients(id) on delete cascade,
  shift_code text not null,
  shift_name text not null,
  starts_at time not null,
  ends_at time not null,
  timezone text not null default 'Asia/Kolkata',
  days_of_week smallint[] not null default array[0,1,2,3,4,5,6],
  is_overnight boolean generated always as (ends_at <= starts_at) stored,
  source text,
  source_reference text,
  verification_status text not null default 'draft',
  is_active boolean not null default true,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint hospital_shifts_verification_status_check
    check (verification_status in ('draft','verified','rejected','inactive')),
  constraint hospital_shifts_days_check
    check (array_length(days_of_week, 1) is not null and days_of_week <@ array[0,1,2,3,4,5,6])
);

create unique index if not exists ux_hospital_shifts_client_code
  on public.hospital_shifts(coalesce(client_id, '00000000-0000-0000-0000-000000000000'::uuid), shift_code);
create index if not exists idx_hospital_shifts_active
  on public.hospital_shifts(client_id, is_active, verification_status);

create table if not exists public.hospital_supervisor_assignments (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references public.hospital_clients(id) on delete cascade,
  user_id uuid not null references public.hospital_ticket_users(id) on delete cascade,
  block_id uuid references public.hospital_blocks(id) on delete cascade,
  department_id uuid references public.hospital_departments(id) on delete set null,
  category_id uuid references public.hospital_ticket_categories(id) on delete set null,
  shift_id uuid not null references public.hospital_shifts(id) on delete restrict,
  assignment_type text not null,
  routing_priority integer not null default 100,
  effective_from timestamptz not null default now(),
  effective_to timestamptz,
  days_of_week smallint[] not null default array[0,1,2,3,4,5,6],
  verification_status text not null default 'draft',
  source text,
  source_reference text,
  is_active boolean not null default true,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint hospital_supervisor_assignments_type_check
    check (assignment_type in ('primary','backup','overall_fallback','operations_fallback')),
  constraint hospital_supervisor_assignments_verification_status_check
    check (verification_status in ('draft','verified','rejected','inactive')),
  constraint hospital_supervisor_assignments_effective_check
    check (effective_to is null or effective_to > effective_from),
  constraint hospital_supervisor_assignments_days_check
    check (array_length(days_of_week, 1) is not null and days_of_week <@ array[0,1,2,3,4,5,6])
);

create unique index if not exists ux_hospital_supervisor_assignments_identity
  on public.hospital_supervisor_assignments(
    client_id,
    user_id,
    coalesce(block_id, '00000000-0000-0000-0000-000000000000'::uuid),
    coalesce(department_id, '00000000-0000-0000-0000-000000000000'::uuid),
    coalesce(category_id, '00000000-0000-0000-0000-000000000000'::uuid),
    shift_id,
    assignment_type,
    effective_from
  );
create index if not exists idx_hospital_supervisor_assignments_route
  on public.hospital_supervisor_assignments(client_id, block_id, department_id, category_id, shift_id, verification_status, is_active);
create index if not exists idx_hospital_supervisor_assignments_user
  on public.hospital_supervisor_assignments(user_id, is_active, verification_status);

create table if not exists public.hospital_supervisor_availability (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references public.hospital_clients(id) on delete cascade,
  user_id uuid not null references public.hospital_ticket_users(id) on delete cascade,
  availability_status text not null,
  starts_at timestamptz not null,
  ends_at timestamptz,
  reason text,
  source text,
  source_reference text,
  is_active boolean not null default true,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint hospital_supervisor_availability_status_check
    check (availability_status in ('available','unavailable','weekly_off','leave','temporary_unavailable')),
  constraint hospital_supervisor_availability_window_check
    check (ends_at is null or ends_at > starts_at)
);
create index if not exists idx_hospital_supervisor_availability_active
  on public.hospital_supervisor_availability(client_id, user_id, availability_status, starts_at, ends_at)
  where is_active;

create table if not exists public.hospital_ticket_assignment_history (
  id uuid primary key default gen_random_uuid(),
  ticket_id uuid not null references public.hospital_tickets(id) on delete cascade,
  from_user_id uuid references public.hospital_ticket_users(id),
  to_user_id uuid references public.hospital_ticket_users(id),
  assignment_type text,
  routing_assignment_id uuid references public.hospital_supervisor_assignments(id),
  shift_id uuid references public.hospital_shifts(id),
  reason text not null,
  assigned_by uuid references public.hospital_ticket_users(id),
  assigned_at timestamptz not null default now(),
  source text not null,
  previous_status text,
  resulting_status text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  constraint hospital_ticket_assignment_history_source_check
    check (source in ('automatic','manual','escalation','handover','takeover','unassigned')),
  constraint hospital_ticket_assignment_history_type_check
    check (assignment_type is null or assignment_type in ('primary','backup','overall_fallback','operations_fallback'))
);
create index if not exists idx_hospital_ticket_assignment_history_ticket
  on public.hospital_ticket_assignment_history(ticket_id, assigned_at desc);
create index if not exists idx_hospital_ticket_assignment_history_to_user
  on public.hospital_ticket_assignment_history(to_user_id, assigned_at desc);

create table if not exists public.hospital_supervisor_roster_import_rows (
  id uuid primary key default gen_random_uuid(),
  client_id uuid references public.hospital_clients(id) on delete cascade,
  source_name text not null,
  source_role text,
  source_shift text,
  source_responsibility text,
  matched_user_id uuid references public.hospital_ticket_users(id),
  matched_block_id uuid references public.hospital_blocks(id),
  import_status text not null default 'draft',
  ambiguity_reason text,
  is_active boolean not null default true,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint hospital_supervisor_roster_import_rows_status_check
    check (import_status in ('draft','matched','ambiguous','unmatched','rejected','verified'))
);
create index if not exists idx_hospital_supervisor_roster_import_rows_client
  on public.hospital_supervisor_roster_import_rows(client_id, import_status, source_name);

drop trigger if exists trg_hospital_shifts_updated_at on public.hospital_shifts;
create trigger trg_hospital_shifts_updated_at
before update on public.hospital_shifts
for each row execute function public.set_hospital_ticket_updated_at();

drop trigger if exists trg_hospital_supervisor_assignments_updated_at on public.hospital_supervisor_assignments;
create trigger trg_hospital_supervisor_assignments_updated_at
before update on public.hospital_supervisor_assignments
for each row execute function public.set_hospital_ticket_updated_at();

drop trigger if exists trg_hospital_supervisor_availability_updated_at on public.hospital_supervisor_availability;
create trigger trg_hospital_supervisor_availability_updated_at
before update on public.hospital_supervisor_availability
for each row execute function public.set_hospital_ticket_updated_at();

drop trigger if exists trg_hospital_supervisor_roster_import_rows_updated_at on public.hospital_supervisor_roster_import_rows;
create trigger trg_hospital_supervisor_roster_import_rows_updated_at
before update on public.hospital_supervisor_roster_import_rows
for each row execute function public.set_hospital_ticket_updated_at();

insert into public.hospital_shifts(
  client_id, shift_code, shift_name, starts_at, ends_at, source, source_reference,
  verification_status, is_active
)
values
  (null,'nims_0700_1500','NIMS 7 AM-3 PM','07:00','15:00','phase_2c_roster','Provided NIMS supervisor roster','draft',true),
  (null,'nims_0800_1600','NIMS 8 AM-4 PM','08:00','16:00','phase_2c_roster','Provided NIMS supervisor roster','draft',true),
  (null,'nims_1200_2000','NIMS 12 Noon-8 PM','12:00','20:00','phase_2c_roster','Provided NIMS supervisor roster','draft',true),
  (null,'nims_1400_2000','NIMS 2 PM-8 PM','14:00','20:00','phase_2c_roster','Provided NIMS supervisor roster','draft',true),
  (null,'nims_2000_0800','NIMS 8 PM-8 AM','20:00','08:00','phase_2c_roster','Provided NIMS supervisor roster','draft',true)
on conflict do nothing;

create or replace function public.hospital_shift_matches(
  p_starts_at time,
  p_ends_at time,
  p_days_of_week smallint[],
  p_at timestamptz default now(),
  p_timezone text default 'Asia/Kolkata'
)
returns boolean language plpgsql immutable as $$
declare
  v_local timestamp;
  v_local_time time;
  v_day smallint;
  v_previous_day smallint;
begin
  v_local := timezone(coalesce(nullif(p_timezone,''),'Asia/Kolkata'), p_at);
  v_local_time := v_local::time;
  v_day := extract(dow from v_local)::smallint;
  v_previous_day := extract(dow from (v_local - interval '1 day'))::smallint;

  if p_ends_at <= p_starts_at then
    if v_local_time >= p_starts_at then
      return v_day = any(p_days_of_week);
    elsif v_local_time < p_ends_at then
      return v_previous_day = any(p_days_of_week);
    end if;
    return false;
  end if;

  return v_local_time >= p_starts_at
    and v_local_time < p_ends_at
    and v_day = any(p_days_of_week);
end $$;

create or replace function public.hospital_select_ticket_supervisor(
  p_client_id uuid,
  p_block_id uuid,
  p_department_id uuid default null,
  p_category_id uuid default null,
  p_at timestamptz default now()
)
returns jsonb language plpgsql security definer set search_path=public as $$
declare
  v_match record;
  v_candidate_count int := 0;
  v_draft_count int := 0;
begin
  select count(*) into v_draft_count
  from public.hospital_supervisor_assignments a
  where a.client_id=p_client_id
    and a.is_active
    and a.verification_status='draft'
    and (a.block_id is null or a.block_id=p_block_id);

  select a.id assignment_id, a.user_id, a.assignment_type, a.shift_id,
    s.shift_name, a.routing_priority,
    case
      when a.department_id is not null and a.block_id is not null and a.category_id is not null then 1
      when a.block_id is not null and a.category_id is not null then 2
      when a.block_id is not null and a.assignment_type='primary' then 3
      when a.block_id is not null and a.assignment_type='backup' then 4
      when a.block_id is null and a.assignment_type in ('primary','backup') and s.is_overnight then 5
      when a.block_id is null and a.assignment_type='overall_fallback' then 6
      else 50
    end precedence_rank,
    ((case when a.department_id is not null then 4 else 0 end)
      + (case when a.block_id is not null then 2 else 0 end)
      + (case when a.category_id is not null then 1 else 0 end)) specificity
  into v_match
  from public.hospital_supervisor_assignments a
  join public.hospital_shifts s on s.id=a.shift_id and s.is_active
  join public.hospital_ticket_users u on u.id=a.user_id
    and u.client_id=a.client_id and u.role_code='housekeeping_supervisor' and u.is_active
  where a.client_id=p_client_id
    and a.is_active
    and a.verification_status='verified'
    and a.effective_from<=p_at
    and (a.effective_to is null or a.effective_to>p_at)
    and (a.block_id is null or a.block_id=p_block_id)
    and (a.department_id is null or a.department_id=p_department_id)
    and (a.category_id is null or a.category_id=p_category_id)
    and public.hospital_shift_matches(s.starts_at, s.ends_at, a.days_of_week, p_at, s.timezone)
    and not exists (
      select 1 from public.hospital_supervisor_availability av
      where av.client_id=a.client_id and av.user_id=a.user_id and av.is_active
        and av.availability_status in ('unavailable','weekly_off','leave','temporary_unavailable')
        and av.starts_at<=p_at and (av.ends_at is null or av.ends_at>p_at)
    )
  order by
    precedence_rank,
    a.routing_priority,
    case a.assignment_type when 'primary' then 1 when 'backup' then 2 when 'overall_fallback' then 3 else 4 end,
    specificity desc,
    a.created_at,
    a.id
  limit 1;

  get diagnostics v_candidate_count = row_count;

  if v_candidate_count = 0 then
    return jsonb_build_object(
      'assigned', false,
      'reason', case when v_draft_count > 0 then 'only_draft_mappings_exist' else 'no_verified_active_shift_assignment' end,
      'draft_mapping_count', v_draft_count
    );
  end if;

  return jsonb_build_object(
    'assigned', true,
    'user_id', v_match.user_id,
    'assignment_id', v_match.assignment_id,
    'assignment_type', v_match.assignment_type,
    'shift_id', v_match.shift_id,
    'reason', concat_ws(':', 'matched_verified_shift_assignment', v_match.assignment_type, v_match.shift_name)
  );
end $$;

create or replace function public.hospital_record_assignment_history(
  p_ticket_id uuid,
  p_from_user_id uuid,
  p_to_user_id uuid,
  p_assignment_type text,
  p_routing_assignment_id uuid,
  p_shift_id uuid,
  p_reason text,
  p_assigned_by uuid,
  p_source text,
  p_previous_status text,
  p_resulting_status text,
  p_metadata jsonb default '{}'::jsonb
)
returns uuid language plpgsql security definer set search_path=public as $$
declare v_id uuid;
begin
  insert into public.hospital_ticket_assignment_history(
    ticket_id, from_user_id, to_user_id, assignment_type, routing_assignment_id,
    shift_id, reason, assigned_by, source, previous_status, resulting_status, metadata
  )
  values(
    p_ticket_id, p_from_user_id, p_to_user_id, p_assignment_type,
    p_routing_assignment_id, p_shift_id, coalesce(nullif(btrim(p_reason),''),'not_recorded'),
    p_assigned_by, p_source, p_previous_status, p_resulting_status, coalesce(p_metadata,'{}'::jsonb)
  )
  returning id into v_id;
  return v_id;
end $$;

create or replace function public.hospital_ticket_assignment_history_from_update()
returns trigger language plpgsql security definer set search_path=public as $$
declare
  v_source text;
begin
  if old.current_assignee_user_id is not distinct from new.current_assignee_user_id then
    return null;
  end if;
  if coalesce(new.metadata->>'assignment_source','') = 'handover' then
    return null;
  end if;
  v_source := case
    when new.current_assignee_role in ('operations_executive','facility_manager') then 'escalation'
    when old.current_assignee_user_id is null then 'automatic'
    else 'manual'
  end;
  perform public.hospital_record_assignment_history(
    new.id,
    old.current_assignee_user_id,
    new.current_assignee_user_id,
    case when new.current_assignee_role='housekeeping_supervisor' then coalesce(new.metadata->>'assignment_type','primary') else null end,
    nullif(new.metadata->>'routing_assignment_id','')::uuid,
    nullif(new.metadata->>'routing_shift_id','')::uuid,
    coalesce(new.metadata->>'routing_reason', 'assignee_changed'),
    null,
    v_source,
    old.status_code,
    new.status_code,
    jsonb_build_object('previous_role', old.current_assignee_role, 'new_role', new.current_assignee_role)
  );
  return null;
end $$;

drop trigger if exists trg_hospital_ticket_assignment_history_from_update on public.hospital_tickets;
create trigger trg_hospital_ticket_assignment_history_from_update
after update of current_assignee_user_id, current_assignee_role on public.hospital_tickets
for each row execute function public.hospital_ticket_assignment_history_from_update();

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
  v_routing jsonb;
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

  perform pg_advisory_xact_lock(hashtextextended(p_actor_user_id::text || ':' || btrim(p_idempotency_key), 0));

  select * into v_ticket from public.hospital_tickets
    where raised_by_user_id = p_actor_user_id and idempotency_key = btrim(p_idempotency_key);
  if found then return jsonb_build_object('ticket', to_jsonb(v_ticket), 'idempotent_replay', true); end if;

  select * into v_block from public.hospital_blocks where id = p_block_id and client_id = v_actor.client_id and is_active = true;
  if not found then raise exception 'Block is outside the actor client.' using errcode = '42501'; end if;

  if p_floor_id is not null then
    select * into v_floor from public.hospital_floors where id = p_floor_id and client_id = v_actor.client_id and block_id = p_block_id and is_active = true;
    if not found then raise exception 'Floor is outside the selected block.' using errcode = '42501'; end if;
  end if;

  if p_department_id is not null then
    select * into v_department from public.hospital_departments where id = p_department_id and client_id = v_actor.client_id and block_id = p_block_id and is_active = true;
    if not found then raise exception 'Department is outside the selected block.' using errcode = '42501'; end if;
    if p_floor_id is not null and v_department.floor_id is not null and v_department.floor_id <> p_floor_id then
      raise exception 'Department is outside the selected floor.' using errcode = '42501';
    end if;
  end if;

  if p_location_id is not null then
    select * into v_location from public.hospital_locations where id = p_location_id and block_id = p_block_id and client_id = v_actor.client_id and is_active = true;
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
      and (s.scope_type = 'client' or (s.scope_type = 'block' and s.block_id = p_block_id)
        or (s.scope_type = 'location' and p_location_id is not null and s.location_id = p_location_id))
  ) then raise exception 'Ticket creation is outside the actor scope.' using errcode = '42501'; end if;

  if not exists (select 1 from public.hospital_ticket_categories c where c.id = p_category_id and c.is_active and (c.client_id is null or c.client_id = v_actor.client_id)) then
    raise exception 'Category is unavailable.' using errcode = '22023';
  end if;

  v_routing := public.hospital_select_ticket_supervisor(v_actor.client_id, p_block_id, p_department_id, p_category_id, now());
  if coalesce((v_routing->>'assigned')::boolean, false) then
    select * into v_supervisor from public.hospital_ticket_users where id=(v_routing->>'user_id')::uuid and is_active for share;
  end if;

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
    exact_landmark_snapshot, metadata
  ) values (
    v_ticket_no, v_actor.client_id, p_block_id, p_location_id, p_category_id,
    v_actor.id, v_actor.display_name, v_actor.role_code, v_floor_name,
    v_department_name, v_location_text, btrim(p_title), btrim(p_description), p_priority,
    case when v_supervisor.id is null then 'open' else 'assigned' end,
    v_supervisor.id, case when v_supervisor.id is null then null else 'housekeeping_supervisor' end,
    v_supervisor.id, case when v_supervisor.id is null then null else now() end,
    case when v_supervisor.id is null then null else now() + make_interval(mins => greatest(1, p_supervisor_sla_minutes)) end,
    btrim(p_idempotency_key), v_landmark,
    jsonb_build_object(
      'assignment_state', case when v_supervisor.id is null then 'unassigned' else 'assigned' end,
      'assignment_failure_reason', case when v_supervisor.id is null then v_routing->>'reason' else null end,
      'assignment_source', 'automatic',
      'assignment_type', v_routing->>'assignment_type',
      'routing_reason', v_routing->>'reason',
      'routing_assignment_id', v_routing->>'assignment_id',
      'routing_shift_id', v_routing->>'shift_id'
    )
  ) returning * into v_ticket;

  insert into public.hospital_ticket_events(ticket_id, event_type, to_status, actor_user_id, actor_name, actor_role, remarks)
    values (v_ticket.id, 'ticket_created', v_ticket.status_code, v_actor.id, v_actor.display_name, v_actor.role_code, 'Housekeeping complaint created.');

  perform public.hospital_record_assignment_history(
    v_ticket.id, null, v_supervisor.id, v_routing->>'assignment_type',
    nullif(v_routing->>'assignment_id','')::uuid, nullif(v_routing->>'shift_id','')::uuid,
    coalesce(v_routing->>'reason','no_verified_active_shift_assignment'), null,
    case when v_supervisor.id is null then 'unassigned' else 'automatic' end,
    'open', v_ticket.status_code, v_routing
  );

  if v_supervisor.id is not null then
    insert into public.hospital_ticket_events(ticket_id, event_type, from_status, to_status, actor_name, actor_role, remarks, event_data)
      values (v_ticket.id, 'supervisor_assigned', 'open', 'assigned', 'QPMS Assignment Engine', 'system',
        'Assigned using verified Supervisor routing.', v_routing);
    insert into public.hospital_ticket_notifications(ticket_id, recipient_user_id, notification_type, title, body)
      values (v_ticket.id, v_supervisor.id, 'ticket_assigned', 'New housekeeping complaint', v_ticket.ticket_no || ' requires action.');
  end if;

  return jsonb_build_object('ticket', to_jsonb(v_ticket), 'idempotent_replay', false);
end $$;

create or replace function public.hospital_ticket_prepare_assignment()
returns trigger language plpgsql security definer set search_path=public as $$
declare
  v_supervisor public.hospital_ticket_users%rowtype;
  v_routing jsonb;
begin
  if tg_op='INSERT' and new.supervisor_user_id is null then
    new.supervisor_sla_due_at := null;
    new.metadata := coalesce(new.metadata,'{}'::jsonb) || jsonb_build_object(
      'assignment_state','unassigned',
      'assignment_failure_reason',coalesce(new.metadata->>'assignment_failure_reason','no_verified_active_shift_assignment')
    );
  elsif tg_op='UPDATE' and old.status_code='resolved_awaiting_confirmation' and new.status_code='reopened' then
    v_routing := public.hospital_select_ticket_supervisor(new.client_id, new.block_id, null, new.category_id, now());
    if coalesce((v_routing->>'assigned')::boolean, false) then
      select * into v_supervisor from public.hospital_ticket_users where id=(v_routing->>'user_id')::uuid and is_active for share;
    end if;
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

create or replace function public.hospital_ticket_assignment_events()
returns trigger language plpgsql security definer set search_path=public as $$
begin
  if tg_op='INSERT' and new.supervisor_user_id is null then
    insert into public.hospital_ticket_events(ticket_id,event_type,to_status,actor_name,actor_role,remarks,event_data)
    values (
      new.id,'ticket_unassigned',new.status_code,'QPMS Assignment Engine','system',
      'No verified active Supervisor routing rule matched this ticket.',
      jsonb_build_object('reason',coalesce(new.metadata->>'assignment_failure_reason','no_verified_active_shift_assignment'))
    ) on conflict do nothing;
    insert into public.hospital_ticket_notifications(ticket_id,recipient_user_id,notification_type,title,body)
    select new.id,u.id,'assignment_alert','Unassigned housekeeping ticket',new.ticket_no||' requires a verified Supervisor mapping.'
    from public.hospital_ticket_users u
    where u.client_id=new.client_id and u.role_code in ('operations_executive','facility_manager') and u.is_active;
  elsif tg_op='UPDATE' and old.status_code='resolved_awaiting_confirmation' and new.status_code='reopened' then
    perform public.hospital_record_assignment_history(
      new.id, old.current_assignee_user_id, new.supervisor_user_id,
      new.metadata->>'assignment_type',
      nullif(new.metadata->>'routing_assignment_id','')::uuid,
      nullif(new.metadata->>'routing_shift_id','')::uuid,
      coalesce(new.metadata->>'routing_reason','reopened_routing'),
      null, case when new.supervisor_user_id is null then 'unassigned' else 'automatic' end,
      old.status_code, new.status_code, coalesce(new.metadata,'{}'::jsonb)
    );
    insert into public.hospital_ticket_events(ticket_id,event_type,from_status,to_status,actor_name,actor_role,remarks,event_data)
    values (
      new.id,
      case when new.supervisor_user_id is null then 'reopened_unassigned' else 'reopened_sla_restarted' end,
      old.status_code,new.status_code,'QPMS SLA Engine','system',
      case when new.supervisor_user_id is null then 'Ticket reopened but no verified active Supervisor routing rule matched.'
        else 'Supervisor SLA restarted for 20 minutes after client requested rework.' end,
      jsonb_build_object('sla_cycle',new.reopen_count,'supervisor_due_at',new.supervisor_sla_due_at,'routing_reason',new.metadata->>'routing_reason')
    ) on conflict do nothing;
    if new.supervisor_user_id is not null then
      insert into public.hospital_ticket_notifications(ticket_id,recipient_user_id,notification_type,title,body)
      values(new.id,new.supervisor_user_id,'ticket_reopened','Client requested rework',new.ticket_no||' has a new 20-minute Supervisor SLA.');
    else
      insert into public.hospital_ticket_notifications(ticket_id,recipient_user_id,notification_type,title,body)
      select new.id,u.id,'assignment_alert','Reopened ticket is unassigned',new.ticket_no||' requires a verified Supervisor mapping.'
      from public.hospital_ticket_users u
      where u.client_id=new.client_id and u.role_code in ('operations_executive','facility_manager') and u.is_active;
    end if;
  end if;
  return null;
end $$;

create or replace function public.rpc_hospital_shift_handover(
  p_now timestamptz default now(),
  p_supervisor_sla_minutes integer default 20
)
returns jsonb language plpgsql security definer set search_path=public as $$
declare
  v_ticket public.hospital_tickets%rowtype;
  v_routing jsonb;
  v_new_user uuid;
  v_count int := 0;
begin
  for v_ticket in
    select * from public.hospital_tickets
    where status_code in ('open','assigned','reopened') for update skip locked
  loop
    v_routing := public.hospital_select_ticket_supervisor(v_ticket.client_id, v_ticket.block_id, null, v_ticket.category_id, p_now);
    v_new_user := nullif(v_routing->>'user_id','')::uuid;
    if coalesce((v_routing->>'assigned')::boolean, false)
      and v_new_user is not null
      and v_new_user is distinct from v_ticket.current_assignee_user_id
      and not exists (
        select 1 from public.hospital_ticket_assignment_history h
        where h.ticket_id=v_ticket.id and h.source='handover'
          and h.to_user_id=v_new_user and h.shift_id=nullif(v_routing->>'shift_id','')::uuid
          and h.assigned_at > p_now - interval '30 minutes'
      )
    then
      update public.hospital_tickets set
        current_assignee_user_id=v_new_user,
        current_assignee_role='housekeeping_supervisor',
        supervisor_user_id=v_new_user,
        assigned_at=p_now,
        supervisor_sla_due_at=coalesce(supervisor_sla_due_at, p_now + make_interval(mins=>greatest(1,p_supervisor_sla_minutes))),
        metadata=(coalesce(metadata,'{}'::jsonb)-'assignment_failure_reason')||jsonb_build_object(
          'assignment_state','assigned','assignment_source','handover','routing_reason',v_routing->>'reason',
          'assignment_type',v_routing->>'assignment_type',
          'routing_assignment_id',v_routing->>'assignment_id','routing_shift_id',v_routing->>'shift_id'
        ),
        version=version+1,
        updated_at=p_now
      where id=v_ticket.id;
      perform public.hospital_record_assignment_history(
        v_ticket.id, v_ticket.current_assignee_user_id, v_new_user, v_routing->>'assignment_type',
        nullif(v_routing->>'assignment_id','')::uuid, nullif(v_routing->>'shift_id','')::uuid,
        coalesce(v_routing->>'reason','shift_handover'), null, 'handover',
        v_ticket.status_code, v_ticket.status_code, v_routing
      );
      insert into public.hospital_ticket_events(ticket_id,event_type,from_status,to_status,actor_name,actor_role,remarks,event_data)
      values(v_ticket.id,'shift_handover_assigned',v_ticket.status_code,v_ticket.status_code,'QPMS Assignment Engine','system',
        'Ticket reassigned during shift handover.',v_routing) on conflict do nothing;
      insert into public.hospital_ticket_notifications(ticket_id,recipient_user_id,notification_type,title,body)
      values(v_ticket.id,v_new_user,'ticket_assigned','Shift handover assignment',v_ticket.ticket_no||' was handed over for action.');
      v_count := v_count + 1;
    end if;
  end loop;
  return jsonb_build_object('handover_assignments', v_count, 'processed_at', p_now);
end $$;

revoke all on function public.hospital_shift_matches(time,time,smallint[],timestamptz,text) from public, anon, authenticated;
revoke all on function public.hospital_select_ticket_supervisor(uuid,uuid,uuid,uuid,timestamptz) from public, anon, authenticated;
revoke all on function public.hospital_record_assignment_history(uuid,uuid,uuid,text,uuid,uuid,text,uuid,text,text,text,jsonb) from public, anon, authenticated;
revoke all on function public.hospital_ticket_assignment_history_from_update() from public, anon, authenticated;
revoke all on function public.rpc_hospital_shift_handover(timestamptz,integer) from public, anon, authenticated;
grant execute on function public.hospital_shift_matches(time,time,smallint[],timestamptz,text) to service_role;
grant execute on function public.hospital_select_ticket_supervisor(uuid,uuid,uuid,uuid,timestamptz) to service_role;
grant execute on function public.hospital_record_assignment_history(uuid,uuid,uuid,text,uuid,uuid,text,uuid,text,text,text,jsonb) to service_role;
grant execute on function public.hospital_ticket_assignment_history_from_update() to service_role;
grant execute on function public.rpc_hospital_shift_handover(timestamptz,integer) to service_role;
revoke all on function public.rpc_create_hospital_ticket(uuid,uuid,uuid,uuid,text,text,text,text,integer,uuid,uuid,text) from public, anon, authenticated;
grant execute on function public.rpc_create_hospital_ticket(uuid,uuid,uuid,uuid,text,text,text,text,integer,uuid,uuid,text) to service_role;

do $$
declare v_table text;
begin
  foreach v_table in array array[
    'hospital_shifts',
    'hospital_supervisor_assignments',
    'hospital_supervisor_availability',
    'hospital_ticket_assignment_history',
    'hospital_supervisor_roster_import_rows'
  ] loop
    execute format('alter table public.%I enable row level security', v_table);
    execute format('revoke all on public.%I from anon', v_table);
    execute format('revoke insert,update,delete on public.%I from authenticated', v_table);
    execute format('grant select on public.%I to authenticated', v_table);
    execute format('grant all on public.%I to service_role', v_table);
  end loop;
end $$;

drop policy if exists hospital_shifts_ops_select on public.hospital_shifts;
create policy hospital_shifts_ops_select on public.hospital_shifts
for select to authenticated using (
  exists (
    select 1 from public.hospital_ticket_users u
    where u.auth_user_id=auth.uid() and u.is_active
      and u.client_id=coalesce(hospital_shifts.client_id,u.client_id)
      and u.profile_type='internal'
      and u.role_code in ('housekeeping_supervisor','operations_executive','facility_manager')
  )
);

drop policy if exists hospital_supervisor_assignments_internal_select on public.hospital_supervisor_assignments;
create policy hospital_supervisor_assignments_internal_select on public.hospital_supervisor_assignments
for select to authenticated using (
  exists (
    select 1 from public.hospital_ticket_users u
    where u.auth_user_id=auth.uid() and u.is_active
      and u.client_id=hospital_supervisor_assignments.client_id
      and u.profile_type='internal'
      and (
        u.role_code in ('operations_executive','facility_manager')
        or u.id=hospital_supervisor_assignments.user_id
      )
  )
);

drop policy if exists hospital_supervisor_availability_internal_select on public.hospital_supervisor_availability;
create policy hospital_supervisor_availability_internal_select on public.hospital_supervisor_availability
for select to authenticated using (
  exists (
    select 1 from public.hospital_ticket_users u
    where u.auth_user_id=auth.uid() and u.is_active
      and u.client_id=hospital_supervisor_availability.client_id
      and u.profile_type='internal'
      and (u.role_code in ('operations_executive','facility_manager') or u.id=hospital_supervisor_availability.user_id)
  )
);

drop policy if exists hospital_assignment_history_internal_select on public.hospital_ticket_assignment_history;
create policy hospital_assignment_history_internal_select on public.hospital_ticket_assignment_history
for select to authenticated using (
  exists (
    select 1 from public.hospital_tickets t
    join public.hospital_ticket_users u on u.auth_user_id=auth.uid() and u.is_active
    where t.id=hospital_ticket_assignment_history.ticket_id
      and u.client_id=t.client_id
      and u.profile_type='internal'
      and (
        u.role_code in ('operations_executive','facility_manager')
        or u.id=hospital_ticket_assignment_history.to_user_id
        or u.id=hospital_ticket_assignment_history.from_user_id
      )
  )
);

drop policy if exists hospital_supervisor_roster_import_rows_ops_select on public.hospital_supervisor_roster_import_rows;
create policy hospital_supervisor_roster_import_rows_ops_select on public.hospital_supervisor_roster_import_rows
for select to authenticated using (
  exists (
    select 1 from public.hospital_ticket_users u
    where u.auth_user_id=auth.uid() and u.is_active
      and u.client_id=hospital_supervisor_roster_import_rows.client_id
      and u.profile_type='internal'
      and u.role_code in ('operations_executive','facility_manager')
  )
);
