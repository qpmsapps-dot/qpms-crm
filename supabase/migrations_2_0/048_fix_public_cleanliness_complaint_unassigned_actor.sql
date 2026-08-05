-- 048: Fix live public cleanliness complaint RPC for unassigned demo tickets.
-- This is additive after 047. Do not edit 047 after it has been applied.

do $$
declare
  v_client public.hospital_clients%rowtype;
  v_auth_id uuid;
  v_actor_id uuid;
  v_scope_id uuid;
  v_actor_email text := 'public-qr-feedback+rggh@myqpms.local';
begin
  select * into v_client
  from public.hospital_clients
  where client_code = 'RGGH' and is_active
  order by created_at
  limit 1;

  if v_client.id is null then
    raise exception 'RGGH hospital client is required before provisioning the public QR feedback actor.';
  end if;

  select id into v_auth_id
  from auth.users
  where lower(email) = lower(v_actor_email)
  limit 1;

  if v_auth_id is null then
    v_auth_id := gen_random_uuid();
    insert into auth.users (
      id,
      aud,
      role,
      email,
      email_confirmed_at,
      raw_app_meta_data,
      raw_user_meta_data,
      created_at,
      updated_at
    ) values (
      v_auth_id,
      'authenticated',
      'authenticated',
      v_actor_email,
      now(),
      jsonb_build_object('provider','email','providers',jsonb_build_array('email'),'public_feedback_system',true),
      jsonb_build_object('display_name','Public QR Feedback','system_actor',true),
      now(),
      now()
    );
  end if;

  insert into public.hospital_ticket_users (
    auth_user_id,
    client_id,
    profile_type,
    role_code,
    display_name,
    email,
    employee_code,
    is_active,
    metadata
  ) values (
    v_auth_id,
    v_client.id,
    'client',
    'hospital_management',
    'Public QR Feedback',
    v_actor_email,
    'PUBLIC_QR_FEEDBACK_RGGH',
    true,
    jsonb_build_object(
      'system_actor',true,
      'public_feedback_system',true,
      'source','public_qr_feedback',
      'client_code','RGGH',
      'not_a_human_user',true
    )
  )
  on conflict (auth_user_id) do update
    set client_id = excluded.client_id,
        profile_type = excluded.profile_type,
        role_code = excluded.role_code,
        display_name = excluded.display_name,
        email = excluded.email,
        employee_code = excluded.employee_code,
        is_active = true,
        metadata = public.hospital_ticket_users.metadata || excluded.metadata,
        updated_at = now()
  returning id into v_actor_id;

  select id into v_scope_id
  from public.hospital_ticket_user_scopes
  where hospital_ticket_user_id = v_actor_id
    and client_id = v_client.id
    and scope_type = 'client'
    and block_id is null
    and location_id is null
  limit 1;

  if v_scope_id is null then
    insert into public.hospital_ticket_user_scopes (
      hospital_ticket_user_id,
      client_id,
      scope_type,
      can_view,
      can_create,
      can_update
    ) values (
      v_actor_id,
      v_client.id,
      'client',
      false,
      true,
      false
    );
  else
    update public.hospital_ticket_user_scopes
    set can_view = false,
        can_create = true,
        can_update = false
    where id = v_scope_id;
  end if;
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
  v_actor public.hospital_ticket_users%rowtype;
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

  select * into v_actor
  from public.hospital_ticket_users
  where client_id = v_location.client_id
    and profile_type = 'client'
    and role_code in ('hospital_management', 'doctor')
    and is_active
  order by
    case when metadata->>'public_feedback_system' = 'true' then 0 else 1 end,
    case when role_code = 'hospital_management' then 0 else 1 end,
    created_at
  limit 1;
  if not found then
    raise exception 'Complaint could not be created because the public feedback ticket actor is not mapped.' using errcode='55000';
  end if;

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
  ) values (
    v_ticket_no, v_location.client_id, v_location.block_id, v_location.id, v_category.id,
    v_actor.id, 'Public QR Feedback', 'public_feedback',
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
      'public_feedback_actor_id',v_actor.id,
      'acceptance_window_seconds',120
    )
  )
  returning * into v_ticket;

  insert into public.hospital_ticket_events(ticket_id, event_type, to_status, actor_name, actor_role, remarks, event_data)
  values (v_ticket.id, 'ticket_created', v_ticket.status_code, 'Public QR Feedback', 'public_feedback',
    'Public toilet cleanliness complaint submitted.',
    jsonb_build_object('feedback_submission_id',v_submission.id,'system_generated',true));

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
        current_escalation_level = 'supervisor',
        current_escalation_level_no = 1,
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
        acceptance_status = 'not_required',
        acceptance_due_at = null,
        broadcasted_at = null,
        assigned_at = null,
        sla_status = 'not_applicable',
        escalation_status = 'not_started',
        metadata = metadata || jsonb_build_object(
          'assignment_state','assignment_required',
          'assignment_required',true,
          'assignment_failure_reason','no_mapped_on_duty_supervisor',
          'role_based_escalation','under_configuration',
          'sla_started',false
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
      jsonb_build_object('broadcast_count',v_supervisor_count,'acceptance_due_at',v_acceptance_due_at,'supervisor_sla_due_at',v_supervisor_due_at))
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
    raise;
end $$;

grant execute on function public.rpc_submit_public_cleanliness_complaint(uuid,uuid,uuid,text,text,text,text,jsonb,timestamptz) to service_role;
