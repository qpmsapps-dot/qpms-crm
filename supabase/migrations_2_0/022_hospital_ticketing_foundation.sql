-- QPMS Hospital Housekeeping Ticketing foundation.
-- Forward-only and isolated from FO, KM, GPS, Fault Tracker, and CRM tables.

create extension if not exists "pgcrypto";

create sequence if not exists public.hospital_ticket_number_seq;

create table if not exists public.hospital_clients (
  id uuid primary key default gen_random_uuid(),
  client_code text not null unique,
  client_name text not null,
  business_type text not null default 'hospital',
  is_active boolean not null default true,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.hospital_blocks (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references public.hospital_clients(id) on delete cascade,
  block_code text not null,
  block_name text not null,
  sort_order integer not null default 0,
  is_active boolean not null default true,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (client_id, block_code),
  unique (id, client_id)
);

create table if not exists public.hospital_locations (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references public.hospital_clients(id) on delete cascade,
  block_id uuid not null,
  floor_name text not null,
  department_name text,
  location_name text not null,
  location_code text not null,
  is_active boolean not null default true,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (client_id, location_code),
  unique (id, client_id),
  constraint hospital_locations_block_client_fk
    foreign key (block_id, client_id)
    references public.hospital_blocks(id, client_id)
    on delete cascade
);

create table if not exists public.hospital_ticket_users (
  id uuid primary key default gen_random_uuid(),
  auth_user_id uuid not null unique references auth.users(id) on delete cascade,
  client_id uuid not null references public.hospital_clients(id) on delete cascade,
  profile_type text not null,
  role_code text not null,
  display_name text not null,
  email text not null,
  employee_code text,
  is_active boolean not null default true,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (client_id, email),
  constraint hospital_ticket_users_profile_type_check
    check (profile_type in ('client', 'internal')),
  constraint hospital_ticket_users_role_code_check
    check (role_code in (
      'doctor', 'hospital_management', 'housekeeping_supervisor',
      'operations_executive', 'facility_manager'
    ))
);

create table if not exists public.hospital_ticket_user_scopes (
  id uuid primary key default gen_random_uuid(),
  hospital_ticket_user_id uuid not null references public.hospital_ticket_users(id) on delete cascade,
  client_id uuid not null references public.hospital_clients(id) on delete cascade,
  block_id uuid references public.hospital_blocks(id) on delete cascade,
  location_id uuid references public.hospital_locations(id) on delete cascade,
  scope_type text not null,
  can_view boolean not null default true,
  can_create boolean not null default false,
  can_update boolean not null default false,
  created_at timestamptz not null default now(),
  constraint hospital_ticket_user_scopes_type_check
    check (scope_type in ('client', 'block', 'location')),
  constraint hospital_ticket_user_scopes_shape_check check (
    (scope_type = 'client' and block_id is null and location_id is null)
    or (scope_type = 'block' and block_id is not null and location_id is null)
    or (scope_type = 'location' and location_id is not null)
  )
);

create unique index if not exists ux_hospital_ticket_user_scopes_identity
  on public.hospital_ticket_user_scopes (
    hospital_ticket_user_id,
    client_id,
    scope_type,
    coalesce(block_id, '00000000-0000-0000-0000-000000000000'::uuid),
    coalesce(location_id, '00000000-0000-0000-0000-000000000000'::uuid)
  );

create table if not exists public.hospital_ticket_categories (
  id uuid primary key default gen_random_uuid(),
  client_id uuid references public.hospital_clients(id) on delete cascade,
  category_code text not null,
  category_name text not null,
  subcategory_name text,
  default_priority text not null default 'medium',
  supervisor_sla_minutes integer not null default 20,
  operations_sla_minutes integer not null default 30,
  is_active boolean not null default true,
  sort_order integer not null default 0,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint hospital_ticket_categories_priority_check
    check (default_priority in ('low', 'medium', 'high', 'critical')),
  constraint hospital_ticket_categories_sla_check
    check (supervisor_sla_minutes > 0 and operations_sla_minutes > 0)
);

create unique index if not exists ux_hospital_ticket_categories_client_code
  on public.hospital_ticket_categories (
    coalesce(client_id, '00000000-0000-0000-0000-000000000000'::uuid),
    category_code
  );

create table if not exists public.hospital_tickets (
  id uuid primary key default gen_random_uuid(),
  ticket_no text not null unique,
  client_id uuid not null references public.hospital_clients(id),
  block_id uuid not null references public.hospital_blocks(id),
  location_id uuid not null references public.hospital_locations(id),
  category_id uuid not null references public.hospital_ticket_categories(id),
  raised_by_user_id uuid not null references public.hospital_ticket_users(id),
  raised_by_name text not null,
  raised_by_role text not null,
  floor_name text not null,
  department_name text,
  location_text text not null,
  title text not null,
  description text not null,
  priority text not null,
  status_code text not null default 'open',
  current_escalation_level text not null default 'supervisor',
  current_assignee_user_id uuid references public.hospital_ticket_users(id),
  current_assignee_role text,
  supervisor_user_id uuid references public.hospital_ticket_users(id),
  operations_executive_user_id uuid references public.hospital_ticket_users(id),
  facility_manager_user_id uuid references public.hospital_ticket_users(id),
  raised_at timestamptz not null default now(),
  assigned_at timestamptz,
  accepted_at timestamptz,
  work_started_at timestamptz,
  supervisor_sla_due_at timestamptz not null,
  supervisor_escalated_at timestamptz,
  operations_sla_due_at timestamptz,
  operations_escalated_at timestamptz,
  resolved_at timestamptz,
  resolved_by_user_id uuid references public.hospital_ticket_users(id),
  resolution_action text,
  resolution_remarks text,
  awaiting_confirmation_at timestamptz,
  closed_at timestamptz,
  reopened_at timestamptz,
  cancelled_at timestamptz,
  client_rating integer,
  client_feedback text,
  client_satisfaction_status text,
  reopen_count integer not null default 0,
  idempotency_key text,
  version integer not null default 1,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint hospital_tickets_priority_check
    check (priority in ('low', 'medium', 'high', 'critical')),
  constraint hospital_tickets_status_check
    check (status_code in (
      'open', 'assigned', 'accepted', 'in_progress',
      'escalated_operations_executive', 'escalated_facility_manager',
      'resolved_awaiting_confirmation', 'reopened', 'closed', 'cancelled'
    )),
  constraint hospital_tickets_escalation_check
    check (current_escalation_level in (
      'supervisor', 'operations_executive', 'facility_manager',
      'client_confirmation', 'completed'
    )),
  constraint hospital_tickets_rating_check
    check (client_rating is null or client_rating between 1 and 5),
  constraint hospital_tickets_satisfaction_check
    check (client_satisfaction_status is null or client_satisfaction_status in ('satisfied', 'not_satisfied')),
  constraint hospital_tickets_reopen_count_check check (reopen_count >= 0),
  constraint hospital_tickets_version_check check (version > 0)
);

create unique index if not exists ux_hospital_tickets_user_idempotency
  on public.hospital_tickets(raised_by_user_id, idempotency_key)
  where idempotency_key is not null;
create index if not exists idx_hospital_tickets_scope
  on public.hospital_tickets(client_id, block_id, status_code);
create index if not exists idx_hospital_tickets_assignee
  on public.hospital_tickets(current_assignee_user_id, status_code);
create index if not exists idx_hospital_tickets_supervisor_sla
  on public.hospital_tickets(supervisor_sla_due_at)
  where status_code in ('open', 'assigned', 'accepted', 'in_progress', 'reopened');
create index if not exists idx_hospital_tickets_operations_sla
  on public.hospital_tickets(operations_sla_due_at)
  where status_code = 'escalated_operations_executive';
create index if not exists idx_hospital_tickets_raised_at
  on public.hospital_tickets(raised_at desc);

create table if not exists public.hospital_ticket_events (
  id uuid primary key default gen_random_uuid(),
  ticket_id uuid not null references public.hospital_tickets(id) on delete cascade,
  event_type text not null,
  from_status text,
  to_status text,
  actor_user_id uuid references public.hospital_ticket_users(id),
  actor_name text not null,
  actor_role text not null,
  remarks text,
  event_data jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create index if not exists idx_hospital_ticket_events_timeline
  on public.hospital_ticket_events(ticket_id, created_at);
create unique index if not exists ux_hospital_ticket_events_sla_milestone
  on public.hospital_ticket_events(ticket_id,event_type)
  where event_type in ('supervisor_sla_warning','supervisor_sla_breached','operations_sla_warning','operations_sla_breached');

create table if not exists public.hospital_ticket_comments (
  id uuid primary key default gen_random_uuid(),
  ticket_id uuid not null references public.hospital_tickets(id) on delete cascade,
  author_user_id uuid not null references public.hospital_ticket_users(id),
  author_name text not null,
  author_role text not null,
  comment_type text not null,
  comment_text text not null,
  is_client_visible boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint hospital_ticket_comments_type_check check (comment_type in (
    'client_comment', 'internal_update', 'resolution_note', 'feedback', 'system_note'
  ))
);
create index if not exists idx_hospital_ticket_comments_ticket
  on public.hospital_ticket_comments(ticket_id, created_at);

create table if not exists public.hospital_ticket_attachments (
  id uuid primary key default gen_random_uuid(),
  ticket_id uuid not null references public.hospital_tickets(id) on delete cascade,
  uploaded_by_user_id uuid not null references public.hospital_ticket_users(id),
  attachment_type text not null,
  storage_bucket text not null default 'hospital-ticket-attachments',
  storage_path text not null unique,
  original_filename text not null,
  mime_type text not null,
  size_bytes bigint not null,
  is_client_visible boolean not null default false,
  created_at timestamptz not null default now(),
  constraint hospital_ticket_attachments_type_check check (attachment_type in (
    'complaint_photo', 'progress_photo', 'completion_photo', 'supporting_document'
  )),
  constraint hospital_ticket_attachments_mime_check check (mime_type in (
    'image/jpeg', 'image/png', 'image/webp'
  )),
  constraint hospital_ticket_attachments_size_check check (size_bytes > 0 and size_bytes <= 10485760)
);
create index if not exists idx_hospital_ticket_attachments_ticket
  on public.hospital_ticket_attachments(ticket_id, created_at);

create table if not exists public.hospital_ticket_notifications (
  id uuid primary key default gen_random_uuid(),
  ticket_id uuid not null references public.hospital_tickets(id) on delete cascade,
  recipient_user_id uuid not null references public.hospital_ticket_users(id) on delete cascade,
  notification_type text not null,
  title text not null,
  body text not null,
  delivery_channel text not null default 'in_app',
  delivery_status text not null default 'pending',
  read_at timestamptz,
  sent_at timestamptz,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  constraint hospital_ticket_notifications_channel_check check (delivery_channel in ('in_app', 'email', 'push')),
  constraint hospital_ticket_notifications_status_check check (delivery_status in ('pending', 'sent', 'failed', 'read'))
);
create index if not exists idx_hospital_ticket_notifications_recipient
  on public.hospital_ticket_notifications(recipient_user_id, read_at, created_at desc);

create or replace function public.set_hospital_ticket_updated_at()
returns trigger language plpgsql set search_path = public as $$
begin
  new.updated_at := now();
  return new;
end $$;

-- The ticket timeline is append-only, including for privileged backend access.
create or replace function public.reject_hospital_ticket_event_mutation()
returns trigger language plpgsql set search_path = public as $$
begin
  raise exception 'Hospital ticket events are append-only.' using errcode = '42501';
end $$;

drop trigger if exists trg_hospital_ticket_events_append_only on public.hospital_ticket_events;
create trigger trg_hospital_ticket_events_append_only
before update or delete on public.hospital_ticket_events
for each row execute function public.reject_hospital_ticket_event_mutation();

/*
 * The loop below intentionally uses the hospital-specific timestamp helper so
 * this migration does not depend on repository-history migrations having run.
 */
do $$
declare v_table text;
begin
  foreach v_table in array array[
    'hospital_clients', 'hospital_blocks', 'hospital_locations',
    'hospital_ticket_users', 'hospital_ticket_categories',
    'hospital_ticket_comments'
  ] loop
    execute format('drop trigger if exists %I on public.%I', 'trg_' || v_table || '_updated_at', v_table);
    execute format(
      'create trigger %I before update on public.%I for each row execute function public.set_hospital_ticket_updated_at()',
      'trg_' || v_table || '_updated_at', v_table
    );
  end loop;
end $$;

create or replace function public.hospital_current_user_id()
returns uuid language sql stable security definer set search_path = public as $$
  select u.id from public.hospital_ticket_users u
  where u.auth_user_id = auth.uid() and u.is_active = true limit 1
$$;

create or replace function public.hospital_can_access_scope(
  p_client_id uuid, p_block_id uuid, p_location_id uuid, p_permission text default 'view'
)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1
    from public.hospital_ticket_users u
    join public.hospital_ticket_user_scopes s on s.hospital_ticket_user_id = u.id
    where u.auth_user_id = auth.uid() and u.is_active = true
      and u.client_id = p_client_id and s.client_id = p_client_id
      and case p_permission when 'create' then s.can_create when 'update' then s.can_update else s.can_view end
      and (
        s.scope_type = 'client'
        or (s.scope_type = 'block' and s.block_id = p_block_id)
        or (s.scope_type = 'location' and s.location_id = p_location_id)
      )
  )
$$;

create or replace function public.hospital_can_access_ticket(p_ticket_id uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.hospital_tickets t
    where t.id = p_ticket_id
      and public.hospital_can_access_scope(t.client_id, t.block_id, t.location_id, 'view')
  )
$$;

revoke all on function public.hospital_current_user_id() from public;
revoke all on function public.hospital_can_access_scope(uuid, uuid, uuid, text) from public;
revoke all on function public.hospital_can_access_ticket(uuid) from public;
grant execute on function public.hospital_current_user_id() to authenticated;
grant execute on function public.hospital_can_access_scope(uuid, uuid, uuid, text) to authenticated;
grant execute on function public.hospital_can_access_ticket(uuid) to authenticated;

create or replace function public.rpc_create_hospital_ticket(
  p_actor_user_id uuid,
  p_block_id uuid,
  p_location_id uuid,
  p_category_id uuid,
  p_priority text,
  p_title text,
  p_description text,
  p_idempotency_key text,
  p_supervisor_sla_minutes integer default 20
)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_actor public.hospital_ticket_users%rowtype;
  v_location public.hospital_locations%rowtype;
  v_supervisor public.hospital_ticket_users%rowtype;
  v_ticket public.hospital_tickets%rowtype;
  v_ticket_no text;
begin
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
  select * into v_location from public.hospital_locations
    where id = p_location_id and block_id = p_block_id and client_id = v_actor.client_id and is_active = true;
  if not found then raise exception 'Location is outside the actor client/block.' using errcode = '42501'; end if;
  if not exists (
    select 1 from public.hospital_ticket_user_scopes s
    where s.hospital_ticket_user_id = p_actor_user_id and s.client_id = v_actor.client_id and s.can_create
      and (s.scope_type = 'client' or (s.scope_type = 'block' and s.block_id = p_block_id) or (s.scope_type = 'location' and s.location_id = p_location_id))
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
  v_ticket_no := 'QPMS-HK-' || to_char(timezone('Asia/Kolkata', now()), 'YYYY') || '-' || lpad(nextval('public.hospital_ticket_number_seq')::text, 6, '0');
  insert into public.hospital_tickets (
    ticket_no, client_id, block_id, location_id, category_id,
    raised_by_user_id, raised_by_name, raised_by_role, floor_name,
    department_name, location_text, title, description, priority,
    status_code, current_assignee_user_id, current_assignee_role,
    supervisor_user_id, assigned_at, supervisor_sla_due_at, idempotency_key
  ) values (
    v_ticket_no, v_actor.client_id, p_block_id, p_location_id, p_category_id,
    v_actor.id, v_actor.display_name, v_actor.role_code, v_location.floor_name,
    v_location.department_name, v_location.location_name, btrim(p_title),
    btrim(p_description), p_priority,
    case when v_supervisor.id is null then 'open' else 'assigned' end,
    v_supervisor.id, case when v_supervisor.id is null then null else 'housekeeping_supervisor' end,
    v_supervisor.id, case when v_supervisor.id is null then null else now() end,
    now() + make_interval(mins => greatest(1, p_supervisor_sla_minutes)), btrim(p_idempotency_key)
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
      ))
    ) then
    v_to := v_from; v_event := case when p_action='progress' then 'progress_update' else 'assistance_requested' end;
    if v_remarks is null then raise exception 'Remarks are required.' using errcode='22023'; end if;
    update public.hospital_tickets set version=version+1, updated_at=now() where id=p_ticket_id returning * into v_ticket;
  elsif p_action in ('manual_escalation','escalate_operations') and v_actor.role_code in ('housekeeping_supervisor','operations_executive') and v_from in ('open','assigned','accepted','in_progress','reopened') then
    select * into v_assignee from public.hospital_ticket_users where client_id=v_ticket.client_id and role_code='operations_executive' and is_active order by created_at limit 1;
    v_to := 'escalated_operations_executive'; v_event := 'manual_escalation';
    update public.hospital_tickets set status_code=v_to, current_escalation_level='operations_executive', current_assignee_user_id=v_assignee.id, current_assignee_role='operations_executive', operations_executive_user_id=v_assignee.id, supervisor_escalated_at=coalesce(supervisor_escalated_at,now()), operations_sla_due_at=now()+make_interval(mins=>greatest(1,p_operations_sla_minutes)), version=version+1, updated_at=now() where id=p_ticket_id returning * into v_ticket;
  elsif p_action = 'escalate_facility' and v_actor.role_code in ('operations_executive','facility_manager') and v_from='escalated_operations_executive' then
    select * into v_assignee from public.hospital_ticket_users where client_id=v_ticket.client_id and role_code='facility_manager' and is_active order by created_at limit 1;
    v_to := 'escalated_facility_manager'; v_event := 'facility_manager_assigned';
    update public.hospital_tickets set status_code=v_to, current_escalation_level='facility_manager', current_assignee_user_id=v_assignee.id, current_assignee_role='facility_manager', facility_manager_user_id=v_assignee.id, operations_escalated_at=now(), version=version+1, updated_at=now() where id=p_ticket_id returning * into v_ticket;
  elsif p_action = 'take_over' and ((v_actor.role_code='operations_executive' and v_from='escalated_operations_executive') or (v_actor.role_code='facility_manager' and v_from='escalated_facility_manager')) then
    v_to := v_from; v_event := case when v_actor.role_code='operations_executive' then 'operations_taken_over' else 'facility_manager_assigned' end;
    update public.hospital_tickets set current_assignee_user_id=v_actor.id, current_assignee_role=v_actor.role_code, version=version+1, updated_at=now() where id=p_ticket_id returning * into v_ticket;
  elsif p_action = 'reassign_supervisor' and v_actor.role_code='operations_executive' and v_from not in ('closed','cancelled','resolved_awaiting_confirmation') then
    select u.* into v_assignee from public.hospital_ticket_users u join public.hospital_ticket_user_scopes s on s.hospital_ticket_user_id=u.id where u.client_id=v_ticket.client_id and u.role_code='housekeeping_supervisor' and u.is_active and s.block_id=v_ticket.block_id and s.can_update order by u.created_at limit 1;
    if v_assignee.id is null then raise exception 'No active block Supervisor is available.' using errcode='22023'; end if;
    v_to:=v_from; v_event:='supervisor_assigned';
    update public.hospital_tickets set current_assignee_user_id=v_assignee.id,current_assignee_role='housekeeping_supervisor',supervisor_user_id=v_assignee.id,version=version+1,updated_at=now() where id=p_ticket_id returning * into v_ticket;
  elsif p_action = 'assign_support' and v_actor.role_code='facility_manager' and v_from not in ('closed','cancelled','resolved_awaiting_confirmation') then
    if v_remarks is null then raise exception 'Support assignment remarks are required.' using errcode='22023'; end if;
    v_to:=v_from; v_event:='progress_update';
    update public.hospital_tickets set version=version+1,updated_at=now() where id=p_ticket_id returning * into v_ticket;
  elsif p_action = 'resolve' and ((v_actor.role_code='housekeeping_supervisor' and v_from in ('in_progress','accepted','reopened')) or (v_actor.role_code='operations_executive' and v_from='escalated_operations_executive') or (v_actor.role_code='facility_manager' and v_from in ('escalated_facility_manager','reopened'))) then
    if nullif(btrim(p_payload->>'resolution_action'),'') is null or nullif(btrim(p_payload->>'resolution_remarks'),'') is null then raise exception 'Resolution action and remarks are required.' using errcode='22023'; end if;
    if not exists (select 1 from public.hospital_ticket_attachments where ticket_id=p_ticket_id and attachment_type='completion_photo') then raise exception 'Completion photo is required.' using errcode='22023'; end if;
    v_to := 'resolved_awaiting_confirmation'; v_event := 'ticket_resolved';
    update public.hospital_tickets set status_code=v_to, current_escalation_level='client_confirmation', resolved_at=now(), resolved_by_user_id=v_actor.id, resolution_action=btrim(p_payload->>'resolution_action'), resolution_remarks=btrim(p_payload->>'resolution_remarks'), awaiting_confirmation_at=now(), version=version+1, updated_at=now() where id=p_ticket_id returning * into v_ticket;
  elsif p_action = 'feedback' and v_actor.profile_type='client' and v_from='resolved_awaiting_confirmation' then
    if (p_payload->>'rating')::integer not between 1 and 5 then raise exception 'Rating must be from 1 to 5.' using errcode='22023'; end if;
    if p_payload->>'satisfaction_status' = 'satisfied' then
      v_to := 'closed'; v_event := 'client_satisfied';
      update public.hospital_tickets set status_code=v_to, current_escalation_level='completed', client_rating=(p_payload->>'rating')::integer, client_feedback=coalesce(p_payload->>'comments',''), client_satisfaction_status='satisfied', closed_at=now(), version=version+1, updated_at=now() where id=p_ticket_id returning * into v_ticket;
    elsif p_payload->>'satisfaction_status' = 'not_satisfied' and nullif(btrim(p_payload->>'comments'),'') is not null then
      select * into v_assignee from public.hospital_ticket_users
      where client_id=v_ticket.client_id and role_code='facility_manager' and is_active
      order by created_at limit 1;
      v_to := 'reopened'; v_event := 'client_not_satisfied';
      update public.hospital_tickets set status_code=v_to,
        current_escalation_level=case when v_assignee.id is not null then 'facility_manager' else 'supervisor' end,
        current_assignee_user_id=coalesce(v_assignee.id,resolved_by_user_id,supervisor_user_id),
        current_assignee_role=case when v_assignee.id is not null then 'facility_manager' else coalesce(current_assignee_role,'housekeeping_supervisor') end,
        facility_manager_user_id=coalesce(facility_manager_user_id,v_assignee.id),
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
    from (select distinct unnest(array[v_ticket.supervisor_user_id,v_ticket.operations_executive_user_id,v_ticket.facility_manager_user_id,v_ticket.resolved_by_user_id]) recipient_id) recipients
    where recipient_id is not null;
  end if;
  return jsonb_build_object('ticket',to_jsonb(v_ticket));
end $$;

create or replace function public.rpc_process_hospital_ticket_sla(
  p_now timestamptz default now(), p_operations_sla_minutes integer default 30
)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_ticket public.hospital_tickets%rowtype; v_assignee public.hospital_ticket_users%rowtype; v_supervisor_count int:=0; v_operations_count int:=0;
begin
  insert into public.hospital_ticket_events(ticket_id,event_type,from_status,to_status,actor_name,actor_role,remarks)
  select t.id,'supervisor_sla_warning',t.status_code,t.status_code,'QPMS SLA Engine','system','Supervisor SLA will expire within five minutes.'
  from public.hospital_tickets t where t.status_code in ('open','assigned','accepted','in_progress') and t.supervisor_sla_due_at>p_now and t.supervisor_sla_due_at<=p_now+interval '5 minutes'
  on conflict do nothing;
  insert into public.hospital_ticket_events(ticket_id,event_type,from_status,to_status,actor_name,actor_role,remarks)
  select t.id,'operations_sla_warning',t.status_code,t.status_code,'QPMS SLA Engine','system','Operations SLA will expire within five minutes.'
  from public.hospital_tickets t where t.status_code='escalated_operations_executive' and t.operations_sla_due_at>p_now and t.operations_sla_due_at<=p_now+interval '5 minutes'
  on conflict do nothing;
  for v_ticket in select * from public.hospital_tickets where status_code in ('open','assigned','accepted','in_progress') and supervisor_sla_due_at<=p_now for update skip locked loop
    select * into v_assignee from public.hospital_ticket_users where client_id=v_ticket.client_id and role_code='operations_executive' and is_active order by created_at limit 1;
    update public.hospital_tickets set status_code='escalated_operations_executive',current_escalation_level='operations_executive',current_assignee_user_id=v_assignee.id,current_assignee_role='operations_executive',operations_executive_user_id=v_assignee.id,supervisor_escalated_at=p_now,operations_sla_due_at=p_now+make_interval(mins=>greatest(1,p_operations_sla_minutes)),version=version+1,updated_at=p_now where id=v_ticket.id;
    insert into public.hospital_ticket_events(ticket_id,event_type,from_status,to_status,actor_name,actor_role,remarks) values(v_ticket.id,'supervisor_sla_breached',v_ticket.status_code,'escalated_operations_executive','QPMS SLA Engine','system','Supervisor SLA exceeded.');
    if v_assignee.id is not null then insert into public.hospital_ticket_notifications(ticket_id,recipient_user_id,notification_type,title,body) values(v_ticket.id,v_assignee.id,'sla_escalation','Supervisor SLA breached',v_ticket.ticket_no||' requires Operations action.'); end if;
    v_supervisor_count:=v_supervisor_count+1;
  end loop;
  for v_ticket in select * from public.hospital_tickets where status_code='escalated_operations_executive' and operations_sla_due_at<=p_now for update skip locked loop
    select * into v_assignee from public.hospital_ticket_users where client_id=v_ticket.client_id and role_code='facility_manager' and is_active order by created_at limit 1;
    update public.hospital_tickets set status_code='escalated_facility_manager',current_escalation_level='facility_manager',current_assignee_user_id=v_assignee.id,current_assignee_role='facility_manager',facility_manager_user_id=v_assignee.id,operations_escalated_at=p_now,version=version+1,updated_at=p_now where id=v_ticket.id;
    insert into public.hospital_ticket_events(ticket_id,event_type,from_status,to_status,actor_name,actor_role,remarks) values(v_ticket.id,'operations_sla_breached',v_ticket.status_code,'escalated_facility_manager','QPMS SLA Engine','system','Operations Executive SLA exceeded.');
    if v_assignee.id is not null then insert into public.hospital_ticket_notifications(ticket_id,recipient_user_id,notification_type,title,body) values(v_ticket.id,v_assignee.id,'sla_escalation','Operations SLA breached',v_ticket.ticket_no||' requires Facility Manager action.'); end if;
    v_operations_count:=v_operations_count+1;
  end loop;
  return jsonb_build_object('supervisor_escalations',v_supervisor_count,'operations_escalations',v_operations_count,'processed_at',p_now);
end $$;

create or replace function public.rpc_complete_hospital_attachment(
  p_ticket_id uuid,p_actor_user_id uuid,p_attachment_type text,p_storage_path text,
  p_original_filename text,p_mime_type text,p_size_bytes bigint,p_is_client_visible boolean
)
returns jsonb language plpgsql security definer set search_path=public as $$
declare v_attachment public.hospital_ticket_attachments%rowtype; v_actor public.hospital_ticket_users%rowtype; v_ticket public.hospital_tickets%rowtype;
begin
  select * into v_actor from public.hospital_ticket_users where id=p_actor_user_id and is_active;
  select * into v_ticket from public.hospital_tickets where id=p_ticket_id;
  if v_actor.id is null or v_ticket.id is null or v_actor.client_id<>v_ticket.client_id then raise exception 'Attachment access denied.' using errcode='42501'; end if;
  if p_storage_path not like v_ticket.client_id::text||'/'||v_ticket.id::text||'/%' then raise exception 'Attachment path is outside the ticket.' using errcode='42501'; end if;
  if p_attachment_type='complaint_photo' and (select count(*) from public.hospital_ticket_attachments where ticket_id=p_ticket_id and attachment_type='complaint_photo')>=3 then raise exception 'A maximum of three complaint photos is allowed.' using errcode='22023'; end if;
  insert into public.hospital_ticket_attachments(ticket_id,uploaded_by_user_id,attachment_type,storage_path,original_filename,mime_type,size_bytes,is_client_visible)
  values(p_ticket_id,p_actor_user_id,p_attachment_type,p_storage_path,p_original_filename,p_mime_type,p_size_bytes,p_is_client_visible)
  returning * into v_attachment;
  insert into public.hospital_ticket_events(ticket_id,event_type,from_status,to_status,actor_user_id,actor_name,actor_role,remarks,event_data)
  values(p_ticket_id,'photo_uploaded',v_ticket.status_code,v_ticket.status_code,v_actor.id,v_actor.display_name,v_actor.role_code,'Ticket photo uploaded.',jsonb_build_object('attachment_id',v_attachment.id,'attachment_type',p_attachment_type,'is_client_visible',p_is_client_visible));
  return to_jsonb(v_attachment);
end $$;

revoke all on function public.rpc_create_hospital_ticket(uuid,uuid,uuid,uuid,text,text,text,text,integer) from public, anon, authenticated;
revoke all on function public.rpc_hospital_ticket_action(uuid,uuid,text,integer,jsonb,integer) from public, anon, authenticated;
revoke all on function public.rpc_process_hospital_ticket_sla(timestamptz,integer) from public, anon, authenticated;
revoke all on function public.rpc_complete_hospital_attachment(uuid,uuid,text,text,text,text,bigint,boolean) from public, anon, authenticated;
grant execute on function public.rpc_create_hospital_ticket(uuid,uuid,uuid,uuid,text,text,text,text,integer) to service_role;
grant execute on function public.rpc_hospital_ticket_action(uuid,uuid,text,integer,jsonb,integer) to service_role;
grant execute on function public.rpc_process_hospital_ticket_sla(timestamptz,integer) to service_role;
grant execute on function public.rpc_complete_hospital_attachment(uuid,uuid,text,text,text,text,bigint,boolean) to service_role;

do $$ declare v_table text; begin
  foreach v_table in array array['hospital_clients','hospital_blocks','hospital_locations','hospital_ticket_users','hospital_ticket_user_scopes','hospital_ticket_categories','hospital_tickets','hospital_ticket_events','hospital_ticket_comments','hospital_ticket_attachments','hospital_ticket_notifications'] loop
    execute format('alter table public.%I enable row level security',v_table);
    execute format('revoke all on public.%I from anon',v_table);
    execute format('revoke insert,update,delete on public.%I from authenticated',v_table);
    execute format('grant select on public.%I to authenticated',v_table);
    execute format('grant all on public.%I to service_role',v_table);
  end loop;
end $$;

create policy hospital_clients_scoped_select on public.hospital_clients for select to authenticated using (public.hospital_can_access_scope(id,null,null,'view'));
create policy hospital_blocks_scoped_select on public.hospital_blocks for select to authenticated using (public.hospital_can_access_scope(client_id,id,null,'view'));
create policy hospital_locations_scoped_select on public.hospital_locations for select to authenticated using (public.hospital_can_access_scope(client_id,block_id,id,'view'));
create policy hospital_ticket_users_self_select on public.hospital_ticket_users for select to authenticated using (auth_user_id=auth.uid());
create policy hospital_ticket_scopes_self_select on public.hospital_ticket_user_scopes for select to authenticated using (hospital_ticket_user_id=public.hospital_current_user_id());
create policy hospital_categories_scoped_select on public.hospital_ticket_categories for select to authenticated using (client_id is null or exists(select 1 from public.hospital_ticket_users u where u.auth_user_id=auth.uid() and u.is_active and u.client_id=hospital_ticket_categories.client_id));
create policy hospital_tickets_scoped_select on public.hospital_tickets for select to authenticated using (public.hospital_can_access_scope(client_id,block_id,location_id,'view'));
create policy hospital_events_scoped_select on public.hospital_ticket_events for select to authenticated using (public.hospital_can_access_ticket(ticket_id));
create policy hospital_comments_scoped_select on public.hospital_ticket_comments for select to authenticated using (public.hospital_can_access_ticket(ticket_id) and (is_client_visible or exists(select 1 from public.hospital_ticket_users u where u.auth_user_id=auth.uid() and u.profile_type='internal' and u.is_active)));
create policy hospital_attachments_scoped_select on public.hospital_ticket_attachments for select to authenticated using (public.hospital_can_access_ticket(ticket_id) and (is_client_visible or exists(select 1 from public.hospital_ticket_users u where u.auth_user_id=auth.uid() and u.profile_type='internal' and u.is_active)));
create policy hospital_notifications_own_select on public.hospital_ticket_notifications for select to authenticated using (recipient_user_id=public.hospital_current_user_id());

insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
values('hospital-ticket-attachments','hospital-ticket-attachments',false,10485760,array['image/jpeg','image/png','image/webp'])
on conflict(id) do update set public=false,file_size_limit=10485760,allowed_mime_types=array['image/jpeg','image/png','image/webp'];

create policy hospital_ticket_storage_scoped_read on storage.objects for select to authenticated using (
  bucket_id='hospital-ticket-attachments'
  and exists(select 1 from public.hospital_ticket_attachments a where a.storage_path=name and public.hospital_can_access_ticket(a.ticket_id) and (a.is_client_visible or exists(select 1 from public.hospital_ticket_users u where u.auth_user_id=auth.uid() and u.profile_type='internal' and u.is_active)))
);

insert into public.hospital_clients(client_code,client_name,business_type,metadata)
values('QPMS_HOSPITAL_PILOT','QPMS Hospital Pilot','hospital','{"pilot":true}'::jsonb)
on conflict(client_code) do update set client_name=excluded.client_name,is_active=true;

insert into public.hospital_blocks(client_id,block_code,block_name,sort_order)
select c.id,v.code,v.name,v.sort_order from public.hospital_clients c cross join (values('BLOCK_A','Block A',1),('BLOCK_B','Block B',2)) v(code,name,sort_order)
where c.client_code='QPMS_HOSPITAL_PILOT' on conflict(client_id,block_code) do update set block_name=excluded.block_name,is_active=true;

insert into public.hospital_locations(client_id,block_id,floor_name,department_name,location_name,location_code)
select c.id,b.id,v.floor,v.department,v.location,v.code
from public.hospital_clients c join public.hospital_blocks b on b.client_id=c.id
join (values
('BLOCK_A','1st Floor','OPD','OPD Waiting Area','A_OPD_WAITING'),
('BLOCK_A','2nd Floor','Staff Area','Staff Washroom','A_STAFF_WASHROOM'),
('BLOCK_A','3rd Floor','Nurse Station','Washroom Near Nurse Station','A_NURSE_WASHROOM'),
('BLOCK_A','3rd Floor','Patient Ward','Patient Ward Entrance','A_WARD_ENTRANCE'),
('BLOCK_B','1st Floor','Consultation','Consultation Corridor','B_CONSULT_CORRIDOR'),
('BLOCK_B','2nd Floor','General Area','General Washroom','B_GENERAL_WASHROOM'),
('BLOCK_B','2nd Floor','ICU','ICU Washroom','B_ICU_WASHROOM'),
('BLOCK_B','3rd Floor','Patient Ward','Patient Room Area','B_PATIENT_ROOM')) v(block_code,floor,department,location,code) on v.block_code=b.block_code
where c.client_code='QPMS_HOSPITAL_PILOT'
on conflict(client_id,location_code) do update set floor_name=excluded.floor_name,department_name=excluded.department_name,location_name=excluded.location_name,is_active=true;

insert into public.hospital_ticket_categories(client_id,category_code,category_name,default_priority,supervisor_sla_minutes,operations_sla_minutes,sort_order)
select c.id,v.code,v.name,v.priority,20,30,v.sort_order from public.hospital_clients c cross join (values
('GENERAL_HOUSEKEEPING','General Housekeeping','medium',1),('WASHROOM_CLEANING','Washroom Cleaning','medium',2),('BAD_ODOR','Bad Odor','high',3),('WET_FLOOR','Wet Floor','high',4),('DUSTBIN_OVERFLOW','Dustbin Overflow','high',5),('CONSUMABLES_MISSING','Consumables Missing','medium',6),('PATIENT_ROOM_CLEANING','Patient Room Cleaning','high',7),('CORRIDOR_CLEANING','Corridor Cleaning','medium',8),('EMERGENCY_CLEANING_SUPPORT','Emergency Cleaning Support','critical',9)) v(code,name,priority,sort_order)
where c.client_code='QPMS_HOSPITAL_PILOT'
on conflict do nothing;

comment on table public.hospital_tickets is 'Canonical QPMS hospital housekeeping ticket shared by client and internal mobile applications.';
comment on table public.hospital_ticket_events is 'Append-only hospital ticket activity and escalation timeline.';
