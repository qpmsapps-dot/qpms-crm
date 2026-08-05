-- 047: Public cleanliness triage for Hospital Feedback QR.
-- Additive workflow extension. Do not apply automatically.
-- Rollback guidance:
--   drop function if exists public.rpc_submit_public_cleanliness_complaint(uuid,uuid,uuid,uuid,text,text,text,text,jsonb,timestamptz);
--   drop indexes added below, then drop added columns only if no public feedback/tickets depend on them.

alter table public.hospital_feedback_submissions
  add column if not exists cleanliness_status text,
  add column if not exists respondent_mobile text,
  add column if not exists linked_ticket_id uuid references public.hospital_tickets(id) on delete set null,
  add column if not exists ticket_creation_status text not null default 'pending';

alter table public.hospital_feedback_submissions
  alter column rating drop not null;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'hospital_feedback_submissions_cleanliness_status_check'
      and conrelid = 'public.hospital_feedback_submissions'::regclass
  ) then
    alter table public.hospital_feedback_submissions
      add constraint hospital_feedback_submissions_cleanliness_status_check
      check (cleanliness_status is null or cleanliness_status in ('clean', 'not_clean'))
      not valid;
  end if;

  if not exists (
    select 1 from pg_constraint
    where conname = 'hospital_feedback_submissions_ticket_creation_status_check'
      and conrelid = 'public.hospital_feedback_submissions'::regclass
  ) then
    alter table public.hospital_feedback_submissions
      add constraint hospital_feedback_submissions_ticket_creation_status_check
      check (ticket_creation_status in ('pending', 'not_required', 'created', 'failed'))
      not valid;
  end if;

  if not exists (
    select 1 from pg_constraint
    where conname = 'hospital_feedback_submissions_respondent_mobile_check'
      and conrelid = 'public.hospital_feedback_submissions'::regclass
  ) then
    alter table public.hospital_feedback_submissions
      add constraint hospital_feedback_submissions_respondent_mobile_check
      check (respondent_mobile is null or respondent_mobile ~ '^[6-9][0-9]{9}$')
      not valid;
  end if;
end $$;

create index if not exists idx_hospital_feedback_submissions_cleanliness
  on public.hospital_feedback_submissions(cleanliness_status, submitted_at desc);
create index if not exists idx_hospital_feedback_submissions_linked_ticket
  on public.hospital_feedback_submissions(linked_ticket_id)
  where linked_ticket_id is not null;
create index if not exists idx_hospital_feedback_submissions_ticket_creation_status
  on public.hospital_feedback_submissions(ticket_creation_status, submitted_at desc);

alter table public.hospital_tickets
  add column if not exists linked_public_feedback_submission_id uuid references public.hospital_feedback_submissions(id) on delete set null,
  add column if not exists public_feedback_qr_id uuid references public.hospital_feedback_qr_codes(id) on delete set null,
  add column if not exists ticket_source text,
  add column if not exists respondent_name text,
  add column if not exists respondent_mobile text,
  add column if not exists dean_user_id uuid references public.hospital_ticket_users(id),
  add column if not exists dean_escalated_at timestamptz,
  add column if not exists dean_sla_due_at timestamptz,
  add column if not exists escalation_status text;

create unique index if not exists ux_hospital_tickets_public_feedback_submission
  on public.hospital_tickets(linked_public_feedback_submission_id)
  where linked_public_feedback_submission_id is not null;
create index if not exists idx_hospital_tickets_public_qr_source
  on public.hospital_tickets(public_feedback_qr_id, raised_at desc)
  where public_feedback_qr_id is not null;
create index if not exists idx_hospital_tickets_dean_escalations
  on public.hospital_tickets(client_id, dean_escalated_at desc)
  where dean_escalated_at is not null;

alter table public.hospital_ticket_users
  drop constraint if exists hospital_ticket_users_role_code_check;
alter table public.hospital_ticket_users
  add constraint hospital_ticket_users_role_code_check
    check (role_code in (
      'doctor', 'hospital_management', 'housekeeping_supervisor',
      'operations_executive', 'facility_manager', 'project_head', 'hospital_dean'
    ));

alter table public.hospital_tickets
  drop constraint if exists hospital_tickets_status_check;
alter table public.hospital_tickets
  add constraint hospital_tickets_status_check
    check (status_code in (
      'open', 'awaiting_supervisor_acceptance', 'assigned', 'accepted', 'in_progress',
      'escalated_operations_executive', 'escalated_facility_manager',
      'escalated_project_head', 'escalated_hospital_dean',
      'resolved_awaiting_confirmation', 'reopened', 'closed', 'cancelled'
    ));

alter table public.hospital_tickets
  drop constraint if exists hospital_tickets_escalation_check;
alter table public.hospital_tickets
  add constraint hospital_tickets_escalation_check
    check (current_escalation_level in (
      'supervisor', 'operations_executive', 'facility_manager', 'zonal_head', 'project_head',
      'hospital_dean', 'client_confirmation', 'completed'
    ));

alter table public.hospital_tickets
  drop constraint if exists hospital_tickets_level_no_check;
alter table public.hospital_tickets
  add constraint hospital_tickets_level_no_check
    check (current_escalation_level_no between 1 and 5);

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'hospital_tickets_ticket_source_check'
      and conrelid = 'public.hospital_tickets'::regclass
  ) then
    alter table public.hospital_tickets
      add constraint hospital_tickets_ticket_source_check
      check (ticket_source is null or ticket_source in ('public_qr_feedback', 'client_portal', 'internal'))
      not valid;
  end if;

  if not exists (
    select 1 from pg_constraint
    where conname = 'hospital_tickets_respondent_mobile_check'
      and conrelid = 'public.hospital_tickets'::regclass
  ) then
    alter table public.hospital_tickets
      add constraint hospital_tickets_respondent_mobile_check
      check (respondent_mobile is null or respondent_mobile ~ '^[6-9][0-9]{9}$')
      not valid;
  end if;
end $$;

create or replace function public.hospital_ticket_role_for_level(p_level integer)
returns text language sql immutable as $$
  select case p_level
    when 1 then 'housekeeping_supervisor'
    when 2 then 'facility_manager'
    when 3 then 'operations_executive'
    when 4 then 'project_head'
    when 5 then 'hospital_dean'
    else 'housekeeping_supervisor'
  end
$$;

create or replace function public.hospital_ticket_level_for_role(p_role text)
returns integer language sql immutable as $$
  select case p_role
    when 'housekeeping_supervisor' then 1
    when 'supervisor' then 1
    when 'operations_executive' then 3
    when 'zonal_head' then 3
    when 'facility_manager' then 2
    when 'project_head' then 4
    when 'hospital_dean' then 5
    else 1
  end
$$;

create or replace function public.hospital_ticket_level_code(p_level integer)
returns text language sql immutable as $$
  select case p_level
    when 1 then 'supervisor'
    when 2 then 'facility_manager'
    when 3 then 'zonal_head'
    when 4 then 'project_head'
    when 5 then 'hospital_dean'
    else 'supervisor'
  end
$$;

create or replace function public.hospital_ticket_role_label(p_role text)
returns text language sql immutable as $$
  select case p_role
    when 'housekeeping_supervisor' then 'Supervisor'
    when 'facility_manager' then 'Facility Manager'
    when 'operations_executive' then 'Zonal Head'
    when 'zonal_head' then 'Zonal Head'
    when 'project_head' then 'Project Head'
    when 'hospital_dean' then 'Hospital Dean'
    else initcap(replace(coalesce(p_role, 'owner'), '_', ' '))
  end
$$;

create or replace function public.hospital_ticket_status_for_level(p_level integer, p_existing_status text)
returns text language sql immutable as $$
  select case
    when p_level = 1 then case when p_existing_status = 'open' then 'assigned' else coalesce(p_existing_status, 'assigned') end
    when p_level = 2 then 'escalated_facility_manager'
    when p_level = 3 then 'escalated_operations_executive'
    when p_level = 4 then 'escalated_project_head'
    when p_level = 5 then 'escalated_hospital_dean'
    else coalesce(p_existing_status, 'assigned')
  end
$$;

create or replace function public.hospital_ticket_sla_minutes(p_priority text, p_level integer)
returns integer language sql stable set search_path=public as $$
  select case
    when greatest(1, least(5, coalesce(p_level, 1))) between 1 and 5 then 15
    else 15
  end
$$;

create or replace function public.hospital_pick_ticket_owner(p_client_id uuid, p_role text)
returns public.hospital_ticket_users language plpgsql security definer set search_path=public as $$
declare
  v_user public.hospital_ticket_users%rowtype;
  v_role text := case when p_role = 'zonal_head' then 'operations_executive' else p_role end;
begin
  select * into v_user
  from public.hospital_ticket_users
  where client_id = p_client_id
    and role_code = v_role
    and is_active = true
  order by created_at
  limit 1;
  return v_user;
end $$;

create or replace function public.hospital_ticket_prepare_owner_sla()
returns trigger language plpgsql security definer set search_path=public as $$
declare
  v_level integer;
  v_due timestamptz;
begin
  if new.status_code in ('resolved_awaiting_confirmation','closed','cancelled') then
    new.escalation_due_at := null;
    new.sla_status := case when new.status_code='closed' then 'closed' else 'resolved' end;
    return new;
  end if;
  if new.current_assignee_user_id is null or new.current_assignee_role is null then
    if new.status_code <> 'awaiting_supervisor_acceptance' then
      new.escalation_due_at := null;
      new.sla_status := 'not_applicable';
    end if;
    return new;
  end if;
  if new.current_assignee_user_id is distinct from old.current_assignee_user_id
    or new.current_assignee_role is distinct from old.current_assignee_role
    or new.escalation_due_at is null
  then
    v_level := public.hospital_ticket_level_for_role(new.current_assignee_role);
    new.current_escalation_level_no := v_level;
    new.current_escalation_level := public.hospital_ticket_level_code(v_level);
    new.assigned_at := coalesce(new.assigned_at, now());
    if v_level = 1 and old.status_code = 'awaiting_supervisor_acceptance' and new.acceptance_status = 'accepted' then
      new.escalation_due_at := coalesce(new.escalation_due_at, new.supervisor_sla_due_at);
    else
      v_due := now() + interval '15 minutes';
      new.escalation_due_at := coalesce(new.escalation_due_at, v_due);
    end if;
    new.sla_status := case when v_level = 5 then 'final_owner' else 'running' end;
    new.final_escalation := v_level = 5;
    if v_level = 1 then new.supervisor_sla_due_at := coalesce(new.supervisor_sla_due_at, new.escalation_due_at); end if;
    if v_level = 2 then new.operations_sla_due_at := coalesce(new.operations_sla_due_at, new.escalation_due_at); end if;
    if v_level = 4 then new.project_head_sla_due_at := coalesce(new.project_head_sla_due_at, new.escalation_due_at); end if;
    if v_level = 5 then new.dean_sla_due_at := coalesce(new.dean_sla_due_at, new.escalation_due_at); end if;
  end if;
  return new;
end $$;

create or replace function public.rpc_process_hospital_ticket_sla_day2_only(
  p_now timestamptz default now(),
  p_operations_sla_minutes integer default 30
) returns jsonb language plpgsql security definer set search_path=public as $$
declare
  v_ticket public.hospital_tickets%rowtype;
  v_assignee public.hospital_ticket_users%rowtype;
  v_level integer;
  v_next_level integer;
  v_next_role text;
  v_next_status text;
  v_due timestamptz;
  v_missed_event text;
  v_count_supervisor int := 0;
  v_count_facility int := 0;
  v_count_zonal int := 0;
  v_count_project_head int := 0;
  v_count_dean int := 0;
  v_assignment_failures int := 0;
begin
  for v_ticket in
    select *
    from public.hospital_tickets
    where status_code not in ('awaiting_supervisor_acceptance','resolved_awaiting_confirmation','closed','cancelled')
      and coalesce(final_escalation, false) = false
      and current_assignee_user_id is not null
      and coalesce(escalation_due_at, supervisor_sla_due_at, operations_sla_due_at, project_head_sla_due_at, dean_sla_due_at) is not null
      and coalesce(escalation_due_at, supervisor_sla_due_at, operations_sla_due_at, project_head_sla_due_at, dean_sla_due_at) <= p_now
    for update skip locked
  loop
    v_level := greatest(1, least(5, coalesce(v_ticket.current_escalation_level_no, public.hospital_ticket_level_for_role(v_ticket.current_assignee_role), 1)));
    v_next_level := v_level + 1;
    v_next_role := public.hospital_ticket_role_for_level(v_next_level);
    v_next_status := public.hospital_ticket_status_for_level(v_next_level, v_ticket.status_code);
    v_due := p_now + interval '15 minutes';
    v_missed_event := case v_level
      when 1 then 'supervisor_sla_missed'
      when 2 then 'facility_manager_sla_missed'
      when 3 then 'zonal_head_sla_missed'
      when 4 then 'project_head_sla_missed'
      else 'sla_missed'
    end;
    v_assignee := public.hospital_pick_ticket_owner(v_ticket.client_id, v_next_role);
    if v_assignee.id is null then
      update public.hospital_tickets
      set escalation_due_at = null,
          sla_status = 'blocked',
          escalation_status = 'assignment_required',
          metadata = coalesce(metadata,'{}'::jsonb) || jsonb_build_object(
            'assignment_state','escalation_blocked',
            'assignment_failure_reason','no_active_' || v_next_role,
            'assignment_failed_at',p_now,
            'assignment_required_level',v_next_level
          ),
          version = version + 1,
          updated_at = p_now
      where id = v_ticket.id;
      insert into public.hospital_ticket_events(ticket_id,event_type,from_status,to_status,actor_name,actor_role,remarks,event_data)
      values(v_ticket.id,'escalation_assignment_missing',v_ticket.status_code,v_ticket.status_code,'QPMS SLA Engine','system',
        'Escalation could not be assigned because the required active role is not mapped.',
        jsonb_build_object('from_level',v_level,'to_level',v_next_level,'role',v_next_role,'due_at',coalesce(v_ticket.escalation_due_at,v_ticket.supervisor_sla_due_at,v_ticket.operations_sla_due_at,v_ticket.project_head_sla_due_at)))
      on conflict do nothing;
      v_assignment_failures := v_assignment_failures + 1;
      continue;
    end if;

    update public.hospital_tickets
    set status_code = v_next_status,
        current_escalation_level = public.hospital_ticket_level_code(v_next_level),
        current_escalation_level_no = v_next_level,
        current_assignee_user_id = v_assignee.id,
        current_assignee_role = v_next_role,
        assigned_at = p_now,
        operations_executive_user_id = case when v_next_role='operations_executive' then v_assignee.id else operations_executive_user_id end,
        facility_manager_user_id = case when v_next_role='facility_manager' then v_assignee.id else facility_manager_user_id end,
        project_head_user_id = case when v_next_role='project_head' then v_assignee.id else project_head_user_id end,
        dean_user_id = case when v_next_role='hospital_dean' then v_assignee.id else dean_user_id end,
        supervisor_sla_due_at = case when v_level=1 then null else supervisor_sla_due_at end,
        operations_sla_due_at = case when v_next_level=3 then v_due when v_level=3 then null else operations_sla_due_at end,
        project_head_sla_due_at = case when v_next_level=4 then v_due when v_level=4 then null else project_head_sla_due_at end,
        dean_sla_due_at = case when v_next_level=5 then v_due else dean_sla_due_at end,
        escalation_due_at = v_due,
        last_escalated_at = p_now,
        dean_escalated_at = case when v_next_level=5 then p_now else dean_escalated_at end,
        escalation_count = coalesce(escalation_count,0)+1,
        final_escalation = v_next_level=5,
        sla_status = case when v_next_level=5 then 'final_owner' else 'running' end,
        escalation_status = case when v_next_level=5 then 'dean_escalated' else 'escalated' end,
        version = version + 1,
        updated_at = p_now
    where id = v_ticket.id;

    insert into public.hospital_ticket_events(ticket_id,event_type,from_status,to_status,actor_name,actor_role,remarks,event_data)
    values(v_ticket.id,v_missed_event,v_ticket.status_code,v_ticket.status_code,'QPMS SLA Engine','system',
      public.hospital_ticket_role_label(v_ticket.current_assignee_role) || ' SLA missed.',
      jsonb_build_object('sla_cycle',v_ticket.reopen_count,'from_level',v_level,'to_level',v_next_level,'due_at',coalesce(v_ticket.escalation_due_at,v_ticket.supervisor_sla_due_at,v_ticket.operations_sla_due_at,v_ticket.project_head_sla_due_at)))
    on conflict do nothing;
    insert into public.hospital_ticket_events(ticket_id,event_type,from_status,to_status,actor_name,actor_role,remarks,event_data)
    values(v_ticket.id,case when v_next_level=5 then 'dean_escalated' when v_next_level=4 then 'project_head_assigned' else 'ticket_escalated' end,
      v_ticket.status_code,v_next_status,'QPMS SLA Engine','system',
      'Escalated to ' || public.hospital_ticket_role_label(v_next_role) || '.',
      jsonb_build_object('sla_cycle',v_ticket.reopen_count,'from_level',v_level,'to_level',v_next_level,'due_at',v_due,'system_generated',true))
    on conflict do nothing;

    insert into public.hospital_ticket_notifications(ticket_id,recipient_user_id,notification_type,title,body,priority,current_owner_role,escalation_level)
    values(v_ticket.id,v_assignee.id,'sla_escalation',
      public.hospital_ticket_role_label(v_ticket.current_assignee_role) || ' SLA missed',
      v_ticket.ticket_no || ' requires ' || public.hospital_ticket_role_label(v_next_role) || ' action.',
      v_ticket.priority,v_next_role,v_next_level);

    if v_level = 1 then v_count_supervisor := v_count_supervisor + 1;
    elsif v_level = 2 then v_count_facility := v_count_facility + 1;
    elsif v_level = 3 then v_count_zonal := v_count_zonal + 1;
    elsif v_level = 4 then v_count_project_head := v_count_project_head + 1; end if;
    if v_next_level = 5 then v_count_dean := v_count_dean + 1; end if;
  end loop;

  return jsonb_build_object(
    'supervisor_escalations', v_count_supervisor,
    'facility_manager_escalations', v_count_facility,
    'zonal_head_escalations', v_count_zonal,
    'project_head_escalations', v_count_project_head,
    'dean_escalations', v_count_dean,
    'assignment_failures', v_assignment_failures,
    'processed_at', p_now
  );
end $$;

create or replace function public.rpc_submit_public_cleanliness_complaint(
  p_qr_code_id uuid,
  p_location_id uuid,
  p_submission_key uuid,
  p_language text,
  p_respondent_name text,
  p_respondent_mobile text,
  p_comments text,
  p_answers jsonb default '{}'::jsonb,
  p_submitted_at timestamptz default now()
) returns jsonb language plpgsql security definer set search_path=public as $$
declare
  v_qr public.hospital_feedback_qr_codes%rowtype;
  v_location public.hospital_locations%rowtype;
  v_client public.hospital_clients%rowtype;
  v_block public.hospital_blocks%rowtype;
  v_floor public.hospital_floors%rowtype;
  v_category public.hospital_ticket_categories%rowtype;
  v_submission public.hospital_feedback_submissions%rowtype;
  v_ticket public.hospital_tickets%rowtype;
  v_ticket_no text;
  v_acceptance_due_at timestamptz;
  v_supervisor_due_at timestamptz;
  v_supervisor_count integer := 0;
  v_description text := btrim(coalesce(p_comments, ''));
begin
  if p_language not in ('en','ta') then raise exception 'Unsupported language.' using errcode='22023'; end if;
  if v_description = '' then raise exception 'Complaint details are required.' using errcode='22023'; end if;

  perform pg_advisory_xact_lock(hashtextextended(p_submission_key::text, 0));

  select * into v_submission
  from public.hospital_feedback_submissions
  where submission_key = p_submission_key
  for update;
  if found then
    if v_submission.qr_code_id <> p_qr_code_id or v_submission.location_id <> p_location_id then
      raise exception 'This submission reference has already been used.' using errcode='23505';
    end if;
    if v_submission.linked_ticket_id is not null then
      select * into v_ticket from public.hospital_tickets where id = v_submission.linked_ticket_id;
      return jsonb_build_object('submission', to_jsonb(v_submission), 'ticket', to_jsonb(v_ticket), 'idempotent_replay', true);
    end if;
  end if;

  select * into v_qr
  from public.hospital_feedback_qr_codes
  where id = p_qr_code_id and location_id = p_location_id and status = 'active'
  for share;
  if not found then raise exception 'This feedback session is no longer valid.' using errcode='42501'; end if;

  select * into v_location from public.hospital_locations where id = p_location_id and is_active for share;
  if not found then raise exception 'Location is unavailable.' using errcode='42501'; end if;
  select * into v_client from public.hospital_clients where id = v_location.client_id and is_active for share;
  if not found then raise exception 'Hospital is unavailable.' using errcode='42501'; end if;
  select * into v_block from public.hospital_blocks where id = v_location.block_id and is_active for share;
  if not found then raise exception 'Block is unavailable.' using errcode='42501'; end if;
  if v_location.floor_id is not null then
    select * into v_floor from public.hospital_floors where id = v_location.floor_id and is_active for share;
  end if;

  select * into v_category
  from public.hospital_ticket_categories
  where is_active
    and category_code in ('TOILET_CLEANLINESS', 'WASHROOM_CLEANING')
    and (client_id is null or client_id = v_location.client_id)
  order by case when category_code = 'TOILET_CLEANLINESS' then 0 else 1 end, client_id nulls last
  limit 1;
  if not found then raise exception 'Toilet cleanliness complaint category is unavailable.' using errcode='22023'; end if;

  if v_submission.id is null then
    insert into public.hospital_feedback_submissions(
      qr_code_id, location_id, parent_client_id, hospital_id, block_id, floor_id, department_id,
      respondent_name, respondent_mobile, rating, language, comments, answers, needs_attention,
      cleanliness_status, ticket_creation_status, submission_key, submitted_at, metadata
    ) values (
      p_qr_code_id, p_location_id, v_client.parent_client_id, v_location.client_id, v_location.block_id,
      v_location.floor_id, v_location.department_id, nullif(btrim(coalesce(p_respondent_name,'')), ''),
      p_respondent_mobile, null, p_language, v_description, coalesce(p_answers,'{}'::jsonb), true,
      'not_clean', 'pending', p_submission_key, p_submitted_at,
      jsonb_build_object('source','public_feedback_qr','workflow','cleanliness_complaint')
    )
    returning * into v_submission;
  end if;

  v_ticket_no := 'QPMS-HK-' || to_char(timezone('Asia/Kolkata', p_submitted_at), 'YYYY') || '-' || lpad(nextval('public.hospital_ticket_number_seq')::text, 6, '0');
  v_acceptance_due_at := p_submitted_at + interval '2 minutes';
  v_supervisor_due_at := p_submitted_at + interval '15 minutes';

  insert into public.hospital_tickets (
    ticket_no, client_id, block_id, location_id, category_id,
    raised_by_user_id, raised_by_name, raised_by_role, floor_name,
    department_name, location_text, title, description, priority,
    status_code, current_escalation_level, current_escalation_level_no,
    supervisor_sla_due_at, acceptance_status, acceptance_due_at, broadcasted_at,
    idempotency_key, linked_public_feedback_submission_id, public_feedback_qr_id,
    ticket_source, respondent_name, respondent_mobile, metadata
  )
  select
    v_ticket_no, v_location.client_id, v_location.block_id, v_location.id, v_category.id,
    u.id, 'Public QR Feedback', 'public_feedback',
    coalesce(v_location.floor_name, v_floor.floor_name, 'Not specified'),
    v_location.department_name, v_location.location_name,
    'Toilet Cleanliness Complaint', v_description, 'medium',
    'awaiting_supervisor_acceptance', 'supervisor', 1,
    v_supervisor_due_at, 'awaiting', v_acceptance_due_at, p_submitted_at,
    p_submission_key::text, v_submission.id, p_qr_code_id,
    'public_qr_feedback', nullif(btrim(coalesce(p_respondent_name,'')), ''), p_respondent_mobile,
    jsonb_build_object(
      'source','public_qr_feedback',
      'public_feedback_submission_id',v_submission.id,
      'qr_code_id',p_qr_code_id,
      'cleanliness_status','not_clean',
      'block_name',v_block.block_name,
      'floor_name',coalesce(v_location.floor_name, v_floor.floor_name, 'Not specified'),
      'area',v_location.location_name,
      'acceptance_window_seconds',120
    )
  from public.hospital_ticket_users u
  where u.client_id = v_location.client_id
    and u.profile_type = 'client'
    and u.role_code in ('hospital_management', 'doctor')
    and u.is_active
  order by case when u.role_code = 'hospital_management' then 0 else 1 end, u.created_at
  limit 1
  returning * into v_ticket;

  if v_ticket.id is null then
    update public.hospital_feedback_submissions
    set ticket_creation_status='failed',
        metadata = metadata || jsonb_build_object('ticket_creation_error','no_active_client_actor'),
        created_at = created_at
    where id = v_submission.id
    returning * into v_submission;
    raise exception 'Complaint could not be created because the hospital client actor is not mapped.' using errcode='55000';
  end if;

  insert into public.hospital_ticket_events(ticket_id, event_type, to_status, actor_name, actor_role, remarks, event_data)
  values (v_ticket.id, 'ticket_created', v_ticket.status_code, 'Public QR Feedback', 'public_feedback',
    'Public toilet cleanliness complaint submitted for Supervisor review.',
    jsonb_build_object('feedback_submission_id',v_submission.id,'acceptance_due_at',v_acceptance_due_at,'supervisor_sla_due_at',v_supervisor_due_at));

  insert into public.hospital_ticket_notifications(
    ticket_id, recipient_user_id, notification_type, title, body, priority, current_owner_role, escalation_level,
    action_status, action_expires_at, metadata
  )
  select
    v_ticket.id, u.id, 'incoming_supervisor_ticket', 'New Public Toilet Complaint',
    public.hospital_ticket_incoming_body(v_block.block_name, coalesce(v_location.floor_name, v_floor.floor_name), v_location.location_name, v_ticket.priority),
    v_ticket.priority, 'housekeeping_supervisor', 1,
    'active', v_acceptance_due_at,
    jsonb_build_object('ticket_id',v_ticket.id,'ticket_no',v_ticket.ticket_no,'source','public_qr_feedback','feedback_submission_id',v_submission.id,'acceptance_due_at',v_acceptance_due_at)
  from public.hospital_ticket_on_duty_supervisors(v_location.client_id, v_location.block_id, v_location.id) u
  on conflict do nothing;
  get diagnostics v_supervisor_count = row_count;

  if v_supervisor_count = 0 then
    update public.hospital_tickets
    set status_code = 'open',
        current_escalation_level = null,
        current_escalation_level_no = null,
        current_assignee_user_id = null,
        current_assignee_role = null,
        supervisor_user_id = null,
        operations_executive_user_id = null,
        facility_manager_user_id = null,
        project_head_user_id = null,
        dean_user_id = null,
        supervisor_sla_due_at = null,
        operations_sla_due_at = null,
        project_head_sla_due_at = null,
        dean_sla_due_at = null,
        escalation_due_at = null,
        acceptance_status = null,
        acceptance_due_at = null,
        broadcasted_at = null,
        assigned_at = null,
        sla_status = 'not_applicable',
        escalation_status = 'not_started',
        metadata = metadata || jsonb_build_object(
          'assignment_state','assignment_required',
          'assignment_required',true,
          'assignment_failure_reason','no_mapped_on_duty_supervisor',
          'role_based_escalation','under_configuration'
        )
    where id = v_ticket.id
    returning * into v_ticket;

    insert into public.hospital_ticket_events(ticket_id,event_type,from_status,to_status,actor_name,actor_role,remarks,event_data)
    values(v_ticket.id,'ticket_unassigned','awaiting_supervisor_acceptance','open','QPMS Assignment Engine','system',
      'Public complaint created without a mapped On-Duty Supervisor. Assignment is required before SLA escalation can start.',
      jsonb_build_object(
        'feedback_submission_id',v_submission.id,
        'assignment_state','assignment_required',
        'role_based_escalation','under_configuration',
        'sla_started',false
      ))
    on conflict do nothing;
  else
    insert into public.hospital_ticket_events(ticket_id,event_type,from_status,to_status,actor_name,actor_role,remarks,event_data)
    values(v_ticket.id,'supervisor_broadcast_created','awaiting_supervisor_acceptance','awaiting_supervisor_acceptance','QPMS Assignment Engine','system',
      'Incoming public complaint broadcast to mapped On-Duty Supervisors.',
      jsonb_build_object('broadcast_count',v_supervisor_count,'acceptance_due_at',v_acceptance_due_at))
    on conflict do nothing;
  end if;

  update public.hospital_feedback_submissions
  set linked_ticket_id = v_ticket.id,
      ticket_creation_status = 'created',
      metadata = metadata || jsonb_build_object('ticket_no', v_ticket.ticket_no, 'ticket_created_at', p_submitted_at)
  where id = v_submission.id
  returning * into v_submission;

  return jsonb_build_object('submission', to_jsonb(v_submission), 'ticket', to_jsonb(v_ticket), 'idempotent_replay', false, 'broadcast_count', v_supervisor_count);
exception
  when others then
    if v_submission.id is not null and v_ticket.id is null then
      update public.hospital_feedback_submissions
      set ticket_creation_status = 'failed',
          metadata = metadata || jsonb_build_object('ticket_creation_error', sqlstate)
      where id = v_submission.id;
    end if;
    raise;
end $$;

grant execute on function public.rpc_submit_public_cleanliness_complaint(uuid,uuid,uuid,text,text,text,text,jsonb,timestamptz) to service_role;

comment on column public.hospital_feedback_submissions.cleanliness_status is
  'Public QR cleanliness triage answer: clean or not_clean.';
comment on column public.hospital_feedback_submissions.respondent_mobile is
  'Optional public respondent Indian mobile number for complaint follow-up. Internal access only.';
comment on column public.hospital_feedback_submissions.linked_ticket_id is
  'Hospital ticket created for Not Clean public complaints.';
comment on column public.hospital_feedback_submissions.ticket_creation_status is
  'Ticket creation outcome for the public cleanliness workflow.';
comment on column public.hospital_tickets.linked_public_feedback_submission_id is
  'Public feedback submission that created this hospital ticket, if any.';
comment on column public.hospital_tickets.ticket_source is
  'Source channel for tickets; public_qr_feedback identifies public toilet QR complaints.';
