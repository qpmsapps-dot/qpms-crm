-- Atomic bridge from Pre-Sales meeting/handoff to BD MOM and the existing
-- Site Visit + Estimation workflow. Forward-only; no existing business rows
-- are updated by applying this migration.
begin;

alter table public.lead_meetings
  add column if not exists client_contact_person text,
  add column if not exists client_contact_number text,
  add column if not exists requirement_summary text,
  add column if not exists assigned_bd_profile_id uuid references public.profiles(id) on delete set null,
  add column if not exists idempotency_key text;

alter table public.lead_handoffs
  add column if not exists meeting_id uuid references public.lead_meetings(id) on delete restrict,
  add column if not exists idempotency_key text;

alter table public.lead_mom
  add column if not exists meeting_id uuid references public.lead_meetings(id) on delete restrict,
  add column if not exists attendees text,
  add column if not exists requirement_discussed text,
  add column if not exists scope_summary text,
  add column if not exists key_points text,
  add column if not exists client_expectations text,
  add column if not exists follow_up_actions text,
  add column if not exists remarks text,
  add column if not exists site_survey_required boolean,
  add column if not exists preferred_survey_date date,
  add column if not exists site_contact text,
  add column if not exists site_address text,
  add column if not exists survey_notes text,
  add column if not exists created_by_profile_id uuid references public.profiles(id) on delete set null,
  add column if not exists updated_at timestamptz not null default now(),
  add column if not exists metadata jsonb not null default '{}'::jsonb;

alter table public.site_visits
  add column if not exists source_meeting_id uuid references public.lead_meetings(id) on delete restrict,
  add column if not exists source_lead_mom_id uuid references public.lead_mom(id) on delete restrict,
  add column if not exists branch_head_profile_id uuid references public.profiles(id) on delete set null,
  add column if not exists assigned_operations_manager_profile_id uuid references public.profiles(id) on delete set null,
  add column if not exists assigned_by_profile_id uuid references public.profiles(id) on delete set null,
  add column if not exists assigned_at timestamptz,
  add column if not exists routing_status text not null default 'not_required';

-- A proposal can originate either from the established Site Survey workflow or
-- directly from an accepted BD handoff when the client does not require a
-- survey. The latter must not fabricate Site Visit / assessment rows.
alter table public.proposals
  alter column workflow_instance_id drop not null,
  alter column site_visit_id drop not null,
  alter column assessment_id drop not null;

create unique index if not exists ux_proposals_direct_lead_version
  on public.proposals(lead_id, proposal_version)
  where assessment_id is null;

create table if not exists public.opportunity_notifications (
  id uuid primary key default gen_random_uuid(),
  lead_id uuid not null references public.leads(id) on delete restrict,
  recipient_profile_id uuid not null references public.profiles(id) on delete restrict,
  notification_type text not null,
  title text not null,
  message text,
  action_url text,
  read_at timestamptz,
  dedupe_key text not null unique,
  metadata jsonb not null default '{}'::jsonb check (jsonb_typeof(metadata) = 'object'),
  created_at timestamptz not null default now()
);

create index if not exists idx_opportunity_notifications_recipient
  on public.opportunity_notifications(recipient_profile_id, read_at, created_at desc);

alter table public.opportunity_notifications enable row level security;
revoke all on public.opportunity_notifications from public, anon, authenticated;
grant all on public.opportunity_notifications to service_role;

create or replace function public.opportunity_notify(
  p_lead_id uuid,
  p_recipient_profile_id uuid,
  p_notification_type text,
  p_title text,
  p_message text,
  p_action_url text,
  p_dedupe_key text,
  p_metadata jsonb default '{}'::jsonb
)
returns void
language plpgsql
security definer
set search_path = pg_catalog, public
as $function$
begin
  if p_lead_id is null or p_recipient_profile_id is null or nullif(btrim(p_dedupe_key), '') is null then
    return;
  end if;
  insert into public.opportunity_notifications(
    lead_id, recipient_profile_id, notification_type, title, message,
    action_url, dedupe_key, metadata
  ) values (
    p_lead_id, p_recipient_profile_id, p_notification_type, p_title, p_message,
    p_action_url, p_dedupe_key, coalesce(p_metadata, '{}'::jsonb)
  ) on conflict (dedupe_key) do nothing;
exception when others then
  -- Notifications are intentionally best-effort and must never roll back the
  -- opportunity's authoritative business transition.
  raise warning 'Opportunity notification skipped: %', sqlerrm;
end
$function$;

revoke all on function public.opportunity_notify(uuid,uuid,text,text,text,text,text,jsonb)
  from public, anon, authenticated;
grant execute on function public.opportunity_notify(uuid,uuid,text,text,text,text,text,jsonb)
  to service_role;

create unique index if not exists ux_lead_meetings_idempotency_key
  on public.lead_meetings(idempotency_key) where idempotency_key is not null;
create unique index if not exists ux_lead_handoffs_idempotency_key
  on public.lead_handoffs(idempotency_key) where idempotency_key is not null;
create unique index if not exists ux_lead_mom_meeting
  on public.lead_mom(meeting_id) where meeting_id is not null;
create index if not exists idx_site_visits_branch_routing
  on public.site_visits(branch_head_profile_id, routing_status, updated_at desc);
create index if not exists idx_site_visits_operations_owner
  on public.site_visits(assigned_operations_manager_profile_id, status, updated_at desc);

create or replace function public.opportunity_state_key(p_value text)
returns text
language sql
immutable
set search_path = pg_catalog
as $function$
  select case regexp_replace(upper(coalesce(p_value, '')), '[^A-Z0-9]+', '', 'g')
    when 'TAMILNADU' then 'TN'
    when 'KERALA' then 'KL'
    when 'KARNATAKA' then 'KA'
    when 'TELANGANA' then 'TG'
    when 'ANDHRAPRADESH1' then 'AP1'
    when 'ANDHRAPRADESH2' then 'AP2'
    else regexp_replace(upper(coalesce(p_value, '')), '[^A-Z0-9]+', '', 'g')
  end
$function$;

create or replace function public.opportunity_handoff_notification_trigger()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
as $function$
begin
  if tg_op = 'INSERT' and new.handoff_status = 'pending' then
    perform public.opportunity_notify(
      new.lead_id, new.to_profile_id, 'bd_handoff_assigned',
      'New opportunity handover', 'A Pre-Sales opportunity is waiting for your decision.',
      '/pre-sales/handover', 'handoff:pending:' || new.id::text,
      jsonb_build_object('handoff_id', new.id)
    );
  elsif tg_op = 'UPDATE' and new.handoff_status is distinct from old.handoff_status
        and new.handoff_status in ('accepted', 'rejected') then
    perform public.opportunity_notify(
      new.lead_id, new.from_profile_id,
      case when new.handoff_status = 'accepted' then 'bd_handoff_accepted' else 'bd_handoff_rejected' end,
      case when new.handoff_status = 'accepted' then 'BD accepted opportunity' else 'BD returned opportunity' end,
      case when new.handoff_status = 'accepted'
        then 'Business Development accepted your opportunity handover.'
        else 'Business Development returned your opportunity. Review the rejection reason.' end,
      '/pre-sales/leads/' || new.lead_id::text,
      'handoff:' || new.handoff_status || ':' || new.id::text,
      jsonb_build_object('handoff_id', new.id, 'rejection_reason', new.rejection_reason)
    );
  end if;
  return new;
end
$function$;

drop trigger if exists trg_opportunity_handoff_notification on public.lead_handoffs;
create trigger trg_opportunity_handoff_notification
after insert or update of handoff_status on public.lead_handoffs
for each row execute function public.opportunity_handoff_notification_trigger();

create or replace function public.opportunity_site_visit_notification_trigger()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
as $function$
begin
  if tg_op = 'INSERT' and new.branch_head_profile_id is not null then
    perform public.opportunity_notify(
      new.lead_id, new.branch_head_profile_id, 'site_survey_routed',
      'Site Survey request', 'A new-business Site Survey requires Operations Manager assignment.',
      '/site-survey-requests', 'site-survey:branch:' || new.id::text,
      jsonb_build_object('site_visit_id', new.id)
    );
  end if;
  if new.assigned_operations_manager_profile_id is not null
     and (tg_op = 'INSERT' or new.assigned_operations_manager_profile_id is distinct from old.assigned_operations_manager_profile_id) then
    perform public.opportunity_notify(
      new.lead_id, new.assigned_operations_manager_profile_id, 'site_survey_assigned',
      'Site Survey assigned', 'A Site Survey and assessment task has been assigned to you.',
      '/site-survey-requests', 'site-survey:operations-manager:' || new.id::text,
      jsonb_build_object('site_visit_id', new.id)
    );
  end if;
  return new;
end
$function$;

drop trigger if exists trg_opportunity_site_visit_notification on public.site_visits;
create trigger trg_opportunity_site_visit_notification
after insert or update of assigned_operations_manager_profile_id on public.site_visits
for each row execute function public.opportunity_site_visit_notification_trigger();

create or replace function public.opportunity_workflow_notification_trigger()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
as $function$
declare
  v_bd_profile_id uuid;
begin
  if new.current_stage_code = 'returned_to_bd'
     and (tg_op = 'INSERT' or new.current_stage_code is distinct from old.current_stage_code) then
    select h.to_profile_id into v_bd_profile_id
    from public.lead_handoffs h
    where h.lead_id = new.lead_id and h.handoff_status = 'accepted'
    order by h.accepted_at desc nulls last, h.created_at desc
    limit 1;
    perform public.opportunity_notify(
      new.lead_id, v_bd_profile_id, 'opportunity_returned_to_bd',
      'Opportunity ready for proposal', 'The approval workflow is complete and the opportunity is ready for proposal preparation.',
      '/pre-sales/meetings', 'workflow:returned-to-bd:' || new.id::text,
      jsonb_build_object('workflow_instance_id', new.id)
    );
  end if;
  return new;
end
$function$;

drop trigger if exists trg_opportunity_workflow_notification on public.workflow_instances;
create trigger trg_opportunity_workflow_notification
after insert or update of current_stage_code on public.workflow_instances
for each row execute function public.opportunity_workflow_notification_trigger();

create or replace function public.rpc_schedule_pre_sales_meeting_handoff(
  p_lead_id uuid,
  p_actor_profile_id uuid,
  p_bd_profile_id uuid,
  p_payload jsonb,
  p_idempotency_key text
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $function$
declare
  v_actor public.profiles%rowtype;
  v_bd public.profiles%rowtype;
  v_lead public.leads%rowtype;
  v_call public.lead_call_updates%rowtype;
  v_meeting public.lead_meetings%rowtype;
  v_handoff public.lead_handoffs%rowtype;
  v_key text := nullif(btrim(coalesce(p_idempotency_key, '')), '');
  v_scheduled_at timestamptz;
  v_mode text := lower(btrim(coalesce(p_payload->>'meeting_mode', '')));
  v_summary text := nullif(btrim(coalesce(p_payload->>'requirement_summary', '')), '');
begin
  if v_key is null then
    raise exception using errcode = '22023', message = 'idempotency_key_required';
  end if;
  v_scheduled_at := nullif(p_payload->>'scheduled_at', '')::timestamptz;
  if v_scheduled_at is null or v_scheduled_at <= now() then
    raise exception using errcode = '22023', message = 'future_meeting_required';
  end if;
  if v_mode not in ('in_person', 'video', 'phone') then
    raise exception using errcode = '22023', message = 'invalid_meeting_mode';
  end if;
  if v_summary is null then
    raise exception using errcode = '22023', message = 'meeting_requirement_required';
  end if;

  select * into v_actor from public.profiles
  where id = p_actor_profile_id and is_active is true
    and lower(coalesce(status, 'active')) = 'active'
    and role in ('Pre-Sales', 'Pre-Sales Executive', 'Pre-Sales Manager');
  if not found then
    raise exception using errcode = '42501', message = 'pre_sales_actor_not_authorized';
  end if;
  select * into v_bd from public.profiles
  where id = p_bd_profile_id and is_active is true
    and lower(coalesce(status, 'active')) = 'active'
    and role in ('BD Executive', 'BD Head');
  if not found then
    raise exception using errcode = '42501', message = 'bd_actor_not_eligible';
  end if;

  select * into v_lead from public.leads where id = p_lead_id for update;
  if not found then raise exception using errcode = 'P0002', message = 'lead_not_found'; end if;
  if v_lead.pre_sales_owner_profile_id is distinct from p_actor_profile_id
     and coalesce(v_lead.created_by_user_id, '') not in (
       p_actor_profile_id::text, coalesce(v_actor.auth_user_id::text, '')
     ) then
    raise exception using errcode = '42501', message = 'lead_access_denied';
  end if;
  if v_lead.pre_sales_stage = 'bd_accepted'
     or exists (select 1 from public.lead_handoffs h where h.lead_id = p_lead_id and h.handoff_status = 'accepted') then
    raise exception using errcode = '40001', message = 'pre_sales_opportunity_read_only';
  end if;

  select * into v_handoff from public.lead_handoffs
  where idempotency_key = v_key and lead_id = p_lead_id;
  if found then
    select * into v_meeting from public.lead_meetings where id = v_handoff.meeting_id;
    return jsonb_build_object('meeting', to_jsonb(v_meeting), 'handoff', to_jsonb(v_handoff), 'replayed', true);
  end if;
  if exists (select 1 from public.lead_handoffs where lead_id = p_lead_id and handoff_status = 'pending') then
    raise exception using errcode = '23505', message = 'handoff_already_pending';
  end if;

  insert into public.lead_call_updates(
    lead_id, feedback_type, notes, next_action, created_by_profile_id,
    created_by_name, metadata
  ) values (
    p_lead_id, 'interested', v_summary, 'Client meeting with Business Development',
    p_actor_profile_id, coalesce(v_actor.full_name, v_actor.employee_code, 'Pre-Sales'),
    jsonb_build_object('meeting_required', true, 'bd_profile_id', p_bd_profile_id)
  ) returning * into v_call;

  insert into public.lead_meetings(
    lead_id, scheduled_at, meeting_mode, location_or_link, meeting_status,
    meeting_notes, client_contact_person, client_contact_number,
    requirement_summary, assigned_bd_profile_id, created_by_profile_id,
    idempotency_key
  ) values (
    p_lead_id, v_scheduled_at, v_mode, nullif(btrim(p_payload->>'location_or_link'), ''),
    'scheduled', v_summary, nullif(btrim(p_payload->>'client_contact_person'), ''),
    nullif(btrim(p_payload->>'client_contact_number'), ''), v_summary,
    p_bd_profile_id, p_actor_profile_id, v_key
  ) returning * into v_meeting;

  insert into public.lead_handoffs(
    lead_id, from_profile_id, to_profile_id, meeting_id, handoff_status,
    qualification_summary, handoff_notes, idempotency_key, metadata
  ) values (
    p_lead_id, p_actor_profile_id, p_bd_profile_id, v_meeting.id, 'pending',
    v_summary, nullif(btrim(p_payload->>'handoff_notes'), ''), v_key,
    jsonb_build_object('created_by_name', coalesce(v_actor.full_name, v_actor.employee_code), 'call_update_id', v_call.id)
  ) returning * into v_handoff;

  update public.leads set
    pre_sales_stage = 'pending_bd_handover',
    assigned_bd_executive = coalesce(v_bd.full_name, v_bd.employee_code),
    assigned_bd_email = v_bd.email,
    last_activity_at = now(), updated_at = now()
  where id = p_lead_id;

  insert into public.activity_logs(lead_id, activity_type, activity_message, created_by, metadata)
  values (
    p_lead_id, 'Meeting Scheduled and BD Handover Created',
    'Client meeting scheduled; pending Business Development acceptance',
    coalesce(v_actor.full_name, v_actor.employee_code, 'Pre-Sales'),
    jsonb_build_object('meeting_id', v_meeting.id, 'handoff_id', v_handoff.id, 'bd_profile_id', p_bd_profile_id)
  );
  return jsonb_build_object('meeting', to_jsonb(v_meeting), 'handoff', to_jsonb(v_handoff), 'replayed', false);
end
$function$;

-- The existing Site Visit engine treats bd_survey as BD-owned. Survey requests
-- created from an accepted BD meeting are instead completed by the explicitly
-- assigned Operations Manager. Preserve every existing rule and add only that
-- assignment-scoped access.
create or replace function public.site_workflow_actor_can_view(p_assessment_id uuid)
returns boolean
language plpgsql
security definer
stable
set search_path = pg_catalog, public
as $function$
declare
  v_actor record;
  v_record record;
begin
  select * into v_actor from public.site_workflow_current_actor();
  select sv.assigned_profile_id, sv.created_by_profile_id, sv.owner_state, sv.owner_branch,
         sa.current_stage
    into v_record
  from public.site_assessments sa
  join public.site_visits sv on sv.id = sa.site_visit_id
  where sa.id = p_assessment_id;
  if not found then return false; end if;

  if v_actor.role_key in ('ADMIN', 'COO', 'MD') then return true; end if;
  if v_record.assigned_profile_id = v_actor.profile_id then return true; end if;
  if v_actor.role_key = 'GM' then
    return (v_record.owner_state is null or v_record.owner_state = v_actor.actor_state)
      and (v_record.owner_branch is null or v_record.owner_branch = v_actor.actor_branch);
  end if;
  if v_actor.role_key = 'BD_EXECUTIVE' then
    return v_record.assigned_profile_id = v_actor.profile_id or v_record.created_by_profile_id = v_actor.profile_id;
  end if;
  if v_actor.role_key = 'BD_HEAD' then
    return (v_record.owner_state is null or v_record.owner_state = v_actor.actor_state)
      and (v_record.owner_branch is null or v_record.owner_branch = v_actor.actor_branch);
  end if;
  return public.site_workflow_stage_role(v_record.current_stage) = v_actor.role_key
    and (v_record.owner_state is null or v_record.owner_state = v_actor.actor_state)
    and (v_record.owner_branch is null or v_record.owner_branch = v_actor.actor_branch);
end
$function$;

create or replace function public.site_workflow_actor_can_edit(p_assessment_id uuid)
returns boolean
language plpgsql
security definer
stable
set search_path = pg_catalog, public
as $function$
declare
  v_actor record;
  v_assessment record;
begin
  select * into v_actor from public.site_workflow_current_actor();
  select sa.*, sv.assigned_profile_id into v_assessment
  from public.site_assessments sa
  join public.site_visits sv on sv.id = sa.site_visit_id
  where sa.id = p_assessment_id;
  if not found or not public.site_workflow_actor_can_view(p_assessment_id) then return false; end if;
  if v_actor.role_key = 'OPERATIONS'
     and v_assessment.assigned_profile_id = v_actor.profile_id
     and v_assessment.current_stage = 'bd_survey' then
    return true;
  end if;
  return v_actor.role_key in ('BD_EXECUTIVE', 'BD_HEAD', 'ADMIN')
    and v_assessment.current_stage in ('bd_survey', 'returned_to_bd');
end
$function$;

create or replace function public.rpc_submit_bd_meeting_mom(
  p_meeting_id uuid,
  p_actor_profile_id uuid,
  p_payload jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $function$
declare
  v_actor public.profiles%rowtype;
  v_meeting public.lead_meetings%rowtype;
  v_lead public.leads%rowtype;
  v_handoff public.lead_handoffs%rowtype;
  v_mom public.lead_mom%rowtype;
  v_branch public.profiles%rowtype;
  v_branch_count integer;
  v_survey_required boolean := coalesce((p_payload->>'site_survey_required')::boolean, false);
  v_visit public.site_visits%rowtype;
  v_assessment public.site_assessments%rowtype;
  v_workflow public.workflow_instances%rowtype;
begin
  select * into v_actor from public.profiles where id = p_actor_profile_id
    and is_active is true and lower(coalesce(status, 'active')) = 'active'
    and role in ('BD Executive', 'BD Head');
  if not found then raise exception using errcode = '42501', message = 'bd_actor_not_authorized'; end if;
  select * into v_meeting from public.lead_meetings where id = p_meeting_id for update;
  if not found then raise exception using errcode = 'P0002', message = 'meeting_not_found'; end if;
  select * into v_lead from public.leads where id = v_meeting.lead_id for update;
  select * into v_handoff from public.lead_handoffs
    where meeting_id = v_meeting.id and handoff_status = 'accepted' and to_profile_id = p_actor_profile_id
    order by accepted_at desc limit 1;
  if not found then raise exception using errcode = '42501', message = 'meeting_not_owned_by_actor'; end if;
  if nullif(btrim(coalesce(p_payload->>'requirement_discussed', '')), '') is null then
    raise exception using errcode = '22023', message = 'mom_requirement_required';
  end if;

  select * into v_mom from public.lead_mom where lead_id = v_lead.id for update;
  if found and v_mom.meeting_id is distinct from p_meeting_id then
    raise exception using errcode = '40001', message = 'mom_already_exists_for_another_meeting';
  end if;
  if found and v_mom.mom_status = 'Sent' then
    return jsonb_build_object('mom', to_jsonb(v_mom), 'site_visit', null, 'replayed', true);
  end if;
  insert into public.lead_mom(
    lead_id, meeting_id, subject, discussion_summary, service_scope_discussion,
    action_items, attendees, requirement_discussed, scope_summary, key_points,
    client_expectations, follow_up_actions, remarks, site_survey_required,
    preferred_survey_date, site_contact, site_address, survey_notes,
    mom_status, sent_at, created_by_profile_id, metadata, updated_at
  ) values (
    v_lead.id, v_meeting.id, nullif(btrim(p_payload->>'subject'), ''),
    p_payload->>'requirement_discussed', p_payload->>'scope_summary',
    p_payload->>'follow_up_actions', p_payload->>'attendees',
    p_payload->>'requirement_discussed', p_payload->>'scope_summary', p_payload->>'key_points',
    p_payload->>'client_expectations', p_payload->>'follow_up_actions', p_payload->>'remarks',
    v_survey_required, nullif(p_payload->>'preferred_survey_date', '')::date,
    p_payload->>'site_contact', p_payload->>'site_address', p_payload->>'survey_notes',
    'Sent', now(), p_actor_profile_id,
    jsonb_build_object('bd_profile_id', p_actor_profile_id, 'handoff_id', v_handoff.id), now()
  ) on conflict (lead_id) do update set
    meeting_id = excluded.meeting_id, subject = excluded.subject,
    discussion_summary = excluded.discussion_summary,
    service_scope_discussion = excluded.service_scope_discussion,
    action_items = excluded.action_items, attendees = excluded.attendees,
    requirement_discussed = excluded.requirement_discussed,
    scope_summary = excluded.scope_summary, key_points = excluded.key_points,
    client_expectations = excluded.client_expectations,
    follow_up_actions = excluded.follow_up_actions, remarks = excluded.remarks,
    site_survey_required = excluded.site_survey_required,
    preferred_survey_date = excluded.preferred_survey_date,
    site_contact = excluded.site_contact, site_address = excluded.site_address,
    survey_notes = excluded.survey_notes, mom_status = 'Sent',
    sent_at = coalesce(public.lead_mom.sent_at, now()),
    created_by_profile_id = excluded.created_by_profile_id,
    metadata = coalesce(public.lead_mom.metadata, '{}'::jsonb) || excluded.metadata,
    updated_at = now()
  returning * into v_mom;

  update public.lead_meetings set meeting_status = 'completed', completed_at = coalesce(completed_at, now()),
    meeting_notes = coalesce(nullif(p_payload->>'remarks', ''), meeting_notes), updated_at = now()
  where id = v_meeting.id;

  if v_survey_required then
    select count(*) into v_branch_count from public.profiles p
    where p.role = 'Branch Head' and p.is_active is true
      and lower(coalesce(p.status, 'active')) = 'active'
      and public.opportunity_state_key(p.state) = public.opportunity_state_key(v_lead.state);
    if v_branch_count = 1 then
      select * into v_branch from public.profiles p
      where p.role = 'Branch Head' and p.is_active is true and lower(coalesce(p.status, 'active')) = 'active'
        and public.opportunity_state_key(p.state) = public.opportunity_state_key(v_lead.state)
      limit 1;
    end if;

    insert into public.site_visits(
      lead_id, client_name, site_name, site_location, scheduled_visit_date,
      status, current_stage, pending_with, assigned_profile_id,
      created_by_profile_id, created_by_auth_user_id, owner_state, owner_branch,
      source_meeting_id, source_lead_mom_id, branch_head_profile_id,
      routing_status, metadata
    ) values (
      v_lead.id, v_lead.client_name, coalesce(nullif(p_payload->>'site_address', ''), v_lead.site_location),
      coalesce(nullif(p_payload->>'site_address', ''), v_lead.site_location),
      nullif(p_payload->>'preferred_survey_date', '')::date,
      case when v_branch_count = 1 then 'Pending Branch Head Assignment'
           when v_branch_count = 0 then 'Branch Head Routing Unresolved'
           else 'Branch Head Routing Ambiguous' end,
      'bd_survey', case when v_branch_count = 1 then 'Branch Head' else 'Administration' end,
      case when v_branch_count = 1 then v_branch.id else null end,
      p_actor_profile_id, v_actor.auth_user_id, v_lead.state, v_lead.branch,
      v_meeting.id, v_mom.id, case when v_branch_count = 1 then v_branch.id else null end,
      case when v_branch_count = 1 then 'pending_branch_assignment'
           when v_branch_count = 0 then 'branch_head_unresolved'
           else 'branch_head_ambiguous' end,
      jsonb_build_object('business', v_lead.business, 'requested_by_bd_profile_id', p_actor_profile_id, 'survey_notes', p_payload->>'survey_notes', 'eligible_branch_head_count', v_branch_count)
    ) on conflict (lead_id) do update set updated_at = public.site_visits.updated_at
    returning * into v_visit;

    insert into public.site_assessments(site_visit_id, lead_id, current_stage, created_by_profile_id, created_by_auth_user_id, metadata)
    values (v_visit.id, v_lead.id, 'bd_survey', p_actor_profile_id, v_actor.auth_user_id,
      jsonb_build_object('source', 'bd_meeting_mom', 'meeting_id', v_meeting.id))
    on conflict (site_visit_id) do update set updated_at = public.site_assessments.updated_at
    returning * into v_assessment;
    insert into public.workflow_instances(lead_id, site_visit_id, assessment_id, current_stage_code, status, pending_role, approval_status, owner_state, owner_branch, created_by_profile_id)
    values (v_lead.id, v_visit.id, v_assessment.id, 'bd_survey', 'Active',
      case when v_branch_count = 1 then 'Branch Head' else 'Administration' end,
      case when v_branch_count = 1 then 'Pending Assignment' else 'Routing Review Required' end,
      v_lead.state, v_lead.branch, p_actor_profile_id)
    on conflict (assessment_id) do update set updated_at = public.workflow_instances.updated_at
    returning * into v_workflow;
    if v_branch_count = 1 then
      insert into public.workflow_assignments(workflow_instance_id, stage_code, assigned_role, assigned_profile_id, status, metadata)
      values (v_workflow.id, 'bd_survey', 'Branch Head', v_branch.id, 'Pending', jsonb_build_object('assignment_type', 'site_survey_routing'))
      on conflict (workflow_instance_id, stage_code) where status = 'Pending' do nothing;
    end if;
    insert into public.workflow_status(assessment_id, workflow_instance_id, stage_code, stage_label, pending_role, status)
    values (v_assessment.id, v_workflow.id, 'bd_survey', 'Site Survey',
      case when v_branch_count = 1 then 'Branch Head' else 'Administration' end,
      case when v_branch_count = 1 then 'Pending Assignment' else 'Routing Review Required' end)
    on conflict (assessment_id) do update set pending_role = excluded.pending_role, status = excluded.status, updated_at = now();
  end if;

  insert into public.activity_logs(lead_id, activity_type, activity_message, created_by, metadata)
  values (v_lead.id, 'BD Meeting MOM Submitted',
    case when v_survey_required then 'BD submitted MOM; Site Survey requested' else 'BD submitted MOM; opportunity remains with Business Development' end,
    coalesce(v_actor.full_name, v_actor.employee_code, 'Business Development'),
    jsonb_build_object('meeting_id', v_meeting.id, 'mom_id', v_mom.id, 'site_survey_required', v_survey_required, 'site_visit_id', v_visit.id));
  return jsonb_build_object('mom', to_jsonb(v_mom), 'site_visit', case when v_visit.id is null then null else to_jsonb(v_visit) end, 'replayed', false);
end
$function$;

create or replace function public.rpc_assign_site_survey_operations_manager(
  p_site_visit_id uuid,
  p_branch_head_profile_id uuid,
  p_operations_manager_profile_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $function$
declare
  v_branch public.profiles%rowtype;
  v_manager public.profiles%rowtype;
  v_visit public.site_visits%rowtype;
  v_workflow public.workflow_instances%rowtype;
begin
  select * into v_branch from public.profiles where id = p_branch_head_profile_id and role = 'Branch Head'
    and is_active is true and lower(coalesce(status, 'active')) = 'active';
  if not found then raise exception using errcode = '42501', message = 'branch_head_not_authorized'; end if;
  select * into v_visit from public.site_visits where id = p_site_visit_id for update;
  if not found then raise exception using errcode = 'P0002', message = 'site_survey_not_found'; end if;
  if v_visit.branch_head_profile_id is distinct from p_branch_head_profile_id then
    raise exception using errcode = '42501', message = 'site_survey_not_assigned_to_branch_head';
  end if;
  if v_visit.assigned_operations_manager_profile_id is not null then
    raise exception using errcode = '40001', message = 'operations_manager_already_assigned';
  end if;
  select * into v_manager from public.profiles p where p.id = p_operations_manager_profile_id
    and p.role = 'Operations Manager' and p.is_active is true and lower(coalesce(p.status, 'active')) = 'active'
    and (
      public.opportunity_state_key(p.state) in ('ALL', 'ALLSTATE', 'ALLSTATES')
      or public.opportunity_state_key(p.state) = public.opportunity_state_key(v_visit.owner_state)
    )
    and exists (
      select 1 from public.employee_hierarchy eh
      where eh.employee_code = p.employee_code and eh.manager_employee_code = v_branch.employee_code and eh.is_active is true
    );
  if not found then raise exception using errcode = '42501', message = 'operations_manager_outside_branch_hierarchy'; end if;

  update public.site_visits set assigned_profile_id = v_manager.id,
    assigned_operations_manager_profile_id = v_manager.id,
    assigned_by_profile_id = v_branch.id, assigned_at = now(),
    routing_status = 'operations_manager_assigned', status = 'Operations Manager Assigned',
    pending_with = 'Operations Manager', updated_at = now()
  where id = v_visit.id returning * into v_visit;
  select * into v_workflow from public.workflow_instances where site_visit_id = v_visit.id for update;
  update public.workflow_assignments set status = 'Completed', completed_at = now()
  where workflow_instance_id = v_workflow.id and stage_code = 'bd_survey' and status = 'Pending';
  insert into public.workflow_assignments(workflow_instance_id, stage_code, assigned_role, assigned_profile_id, status, metadata)
  values (v_workflow.id, 'bd_survey', 'Operations Manager', v_manager.id, 'Pending', jsonb_build_object('assigned_by_profile_id', v_branch.id));
  update public.workflow_status set pending_role = 'Operations Manager', status = 'Assigned', updated_at = now()
  where workflow_instance_id = v_workflow.id;
  insert into public.workflow_events(workflow_instance_id, lead_id, site_visit_id, assessment_id, from_stage, to_stage, action, actor_profile_id, actor_auth_user_id, actor_employee_code, actor_name, actor_role, metadata)
  values (v_workflow.id, v_workflow.lead_id, v_visit.id, v_workflow.assessment_id, 'bd_survey', 'bd_survey', 'ASSIGN_OPERATIONS_MANAGER',
    v_branch.id, v_branch.auth_user_id, v_branch.employee_code, coalesce(v_branch.full_name, v_branch.employee_code), v_branch.role,
    jsonb_build_object('assigned_operations_manager_profile_id', v_manager.id));
  return jsonb_build_object('site_visit', to_jsonb(v_visit), 'operations_manager', jsonb_build_object('id', v_manager.id, 'employee_code', v_manager.employee_code, 'full_name', v_manager.full_name));
end
$function$;

revoke all on function public.rpc_schedule_pre_sales_meeting_handoff(uuid,uuid,uuid,jsonb,text) from public, anon, authenticated;
revoke all on function public.rpc_submit_bd_meeting_mom(uuid,uuid,jsonb) from public, anon, authenticated;
revoke all on function public.rpc_assign_site_survey_operations_manager(uuid,uuid,uuid) from public, anon, authenticated;
grant execute on function public.rpc_schedule_pre_sales_meeting_handoff(uuid,uuid,uuid,jsonb,text) to service_role;
grant execute on function public.rpc_submit_bd_meeting_mom(uuid,uuid,jsonb) to service_role;
grant execute on function public.rpc_assign_site_survey_operations_manager(uuid,uuid,uuid) to service_role;

comment on function public.rpc_schedule_pre_sales_meeting_handoff(uuid,uuid,uuid,jsonb,text) is
  'Service-role-only idempotent Pre-Sales meeting plus pending BD handoff transition.';
comment on function public.rpc_submit_bd_meeting_mom(uuid,uuid,jsonb) is
  'Service-role-only BD meeting MOM submission with fail-closed State-only Branch Head routing.';
comment on function public.rpc_assign_site_survey_operations_manager(uuid,uuid,uuid) is
  'Service-role-only Branch Head assignment of a validated direct-report Operations Manager.';

-- Preserve the existing Site Visit RPC contracts while delegating authorization
-- to the extended assignment-aware helper above.
create or replace function public.rpc_save_assessment_section(
  p_site_visit_id uuid,
  p_section_code text,
  p_section_name text default null,
  p_section_data jsonb default '{}'::jsonb,
  p_base_version_number bigint default null,
  p_save_mode text default 'save',
  p_actor_user_id uuid default null,
  p_actor_name text default null,
  p_actor_role text default null,
  p_remarks text default null,
  p_idempotency_key text default null
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $function$
declare
  v_actor record;
  v_assessment public.site_assessments%rowtype;
  v_section public.assessment_sections%rowtype;
  v_next_version bigint;
  v_existing jsonb;
  v_key text := nullif(trim(p_idempotency_key), '');
begin
  select * into v_actor from public.site_workflow_current_actor();
  select * into strict v_assessment from public.site_assessments
    where site_visit_id = p_site_visit_id for update;
  if not public.site_workflow_actor_can_edit(v_assessment.id) then
    raise exception 'Assessment section cannot be edited at the current stage' using errcode = '42501';
  end if;
  if nullif(trim(p_section_code), '') is null or jsonb_typeof(coalesce(p_section_data, '{}'::jsonb)) <> 'object' then
    raise exception 'Section key and object data are required' using errcode = '22023';
  end if;
  if v_key is not null then
    select response_payload into v_existing from public.site_workflow_idempotency
      where idempotency_key = v_key and operation = 'save_assessment_section'
        and actor_profile_id = v_actor.profile_id;
    if found then return v_existing; end if;
    if exists (select 1 from public.site_workflow_idempotency where idempotency_key = v_key) then
      raise exception 'Idempotency key is already in use' using errcode = '22023';
    end if;
  end if;

  select * into v_section from public.assessment_sections
    where assessment_id = v_assessment.id and section_key = p_section_code for update;
  if found and p_base_version_number is not null and v_section.version <> p_base_version_number then
    raise exception 'Assessment section version conflict' using errcode = '40001';
  end if;
  v_next_version := coalesce(v_section.version, 0) + 1;

  insert into public.assessment_sections (
    assessment_id, section_key, section_name, section_data, version, status,
    saved_by_profile_id, saved_by_auth_user_id, saved_at
  ) values (
    v_assessment.id, p_section_code, coalesce(p_section_name, p_section_code), p_section_data,
    v_next_version, case when p_save_mode = 'draft' then 'Draft' else 'Saved' end,
    v_actor.profile_id, v_actor.auth_user_id, now()
  )
  on conflict (assessment_id, section_key) do update set
    section_name = excluded.section_name,
    section_data = excluded.section_data,
    version = excluded.version,
    status = excluded.status,
    saved_by_profile_id = excluded.saved_by_profile_id,
    saved_by_auth_user_id = excluded.saved_by_auth_user_id,
    saved_at = excluded.saved_at
  returning * into v_section;

  insert into public.assessment_section_versions (
    assessment_id, section_id, section_key, section_data, version, status,
    saved_by_profile_id, saved_by_auth_user_id, remarks
  ) values (
    v_assessment.id, v_section.id, v_section.section_key, v_section.section_data,
    v_section.version, v_section.status, v_actor.profile_id, v_actor.auth_user_id, p_remarks
  ) on conflict (assessment_id, section_key, version) do nothing;

  update public.site_assessments
  set survey_snapshot = coalesce(survey_snapshot, '{}'::jsonb)
        || jsonb_build_object(p_section_code, p_section_data),
      row_version = row_version + 1,
      updated_at = now()
  where id = v_assessment.id;

  v_existing := jsonb_build_object('assessment_id', v_assessment.id, 'section', to_jsonb(v_section));
  if v_key is not null then
    insert into public.site_workflow_idempotency(
      idempotency_key, operation, actor_profile_id, resource_id, response_payload
    ) values (
      v_key, 'save_assessment_section', v_actor.profile_id, v_assessment.id, v_existing
    );
  end if;
  return v_existing;
end
$function$;

create or replace function public.rpc_submit_for_review(
  p_workflow_instance_id uuid default null,
  p_site_visit_id uuid default null,
  p_target_stage_code text default 'operations_review',
  p_actor_user_id uuid default null,
  p_actor_name text default null,
  p_actor_role text default null,
  p_idempotency_key text default null,
  p_remarks text default null
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $function$
declare
  v_actor record;
  v_workflow public.workflow_instances%rowtype;
  v_assessment public.site_assessments%rowtype;
  v_key text := nullif(trim(p_idempotency_key), '');
  v_existing jsonb;
begin
  select * into v_actor from public.site_workflow_current_actor();
  select * into strict v_workflow from public.workflow_instances
    where (p_workflow_instance_id is not null and id = p_workflow_instance_id)
       or (p_workflow_instance_id is null and site_visit_id = p_site_visit_id)
    for update;
  select * into strict v_assessment from public.site_assessments where id = v_workflow.assessment_id for update;
  if not public.site_workflow_actor_can_edit(v_assessment.id) then
    raise exception 'Actor cannot submit this assessment' using errcode = '42501';
  end if;
  if v_key is not null then
    select response_payload into v_existing from public.site_workflow_idempotency
      where idempotency_key = v_key and operation = 'submit_assessment'
        and actor_profile_id = v_actor.profile_id;
    if found then return v_existing; end if;
    if exists (select 1 from public.site_workflow_idempotency where idempotency_key = v_key) then
      raise exception 'Idempotency key is already in use' using errcode = '22023';
    end if;
  end if;
  if v_workflow.current_stage_code not in ('bd_survey', 'returned_to_bd')
     or p_target_stage_code <> 'operations_review' then
    raise exception 'Invalid assessment submit transition' using errcode = '22023';
  end if;

  update public.workflow_instances set
    current_stage_code = 'operations_review', pending_role = 'Operations',
    approval_status = 'Pending', version = version + 1, updated_at = now()
  where id = v_workflow.id returning * into v_workflow;
  update public.site_assessments set
    assessment_status = 'Submitted', status = 'Pending Review', current_stage = 'operations_review',
    submitted_at = coalesce(submitted_at, now()), submitted_by_profile_id = v_actor.profile_id,
    submitted_by_auth_user_id = v_actor.auth_user_id, row_version = row_version + 1, updated_at = now()
  where id = v_assessment.id;
  update public.site_visits set status = 'Pending Review', current_stage = 'Operations Review',
    pending_with = 'Operations', updated_at = now() where id = v_workflow.site_visit_id;
  insert into public.workflow_assignments(workflow_instance_id, stage_code, assigned_role)
    values (v_workflow.id, 'operations_review', 'Operations')
    on conflict (workflow_instance_id, stage_code) where status = 'Pending' do nothing;
  insert into public.approval_requests(
    workflow_instance_id, lead_id, site_visit_id, assessment_id,
    approval_stage, stage_code, pending_with, status, requested_at
  ) values (
    v_workflow.id, v_workflow.lead_id, v_workflow.site_visit_id, v_workflow.assessment_id,
    'Operations Review', 'operations_review', 'Operations', 'Pending', now()
  ) on conflict (workflow_instance_id, stage_code) do update set
    status = case when public.approval_requests.status = 'Not Started' then 'Pending' else public.approval_requests.status end,
    requested_at = coalesce(public.approval_requests.requested_at, now()),
    updated_at = now();
  insert into public.workflow_status(assessment_id, workflow_instance_id, stage_code, stage_label, pending_role, status, version)
    values(v_workflow.assessment_id, v_workflow.id, 'operations_review', 'Operations Review', 'Operations', 'Pending', v_workflow.version)
    on conflict (assessment_id) do update set stage_code = excluded.stage_code, stage_label = excluded.stage_label,
      pending_role = excluded.pending_role, status = excluded.status, version = excluded.version, updated_at = now();
  perform public.site_workflow_log_event(v_workflow.id, 'bd_survey', 'operations_review', 'SUBMIT_ASSESSMENT', p_remarks);
  v_existing := jsonb_build_object('workflow_instance', to_jsonb(v_workflow), 'stage', 'operations_review');
  if v_key is not null then
    insert into public.site_workflow_idempotency(idempotency_key, operation, actor_profile_id, resource_id, response_payload)
    values(v_key, 'submit_assessment', v_actor.profile_id, v_workflow.assessment_id, v_existing)
    on conflict (idempotency_key) do nothing;
  end if;
  return v_existing;
end
$function$;

create or replace function public.rpc_prepare_opportunity_proposal(
  p_lead_id uuid,
  p_actor_profile_id uuid,
  p_payload jsonb,
  p_idempotency_key text
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $function$
declare
  v_actor public.profiles%rowtype;
  v_lead public.leads%rowtype;
  v_handoff public.lead_handoffs%rowtype;
  v_mom public.lead_mom%rowtype;
  v_workflow public.workflow_instances%rowtype;
  v_proposal public.proposals%rowtype;
  v_key text := nullif(btrim(coalesce(p_idempotency_key, '')), '');
  v_existing jsonb;
begin
  if v_key is null then
    raise exception using errcode = '22023', message = 'idempotency_key_required';
  end if;
  select * into v_actor from public.profiles
  where id = p_actor_profile_id and role in ('BD Executive', 'BD Head')
    and is_active is true and lower(coalesce(status, 'active')) = 'active';
  if not found then raise exception using errcode = '42501', message = 'bd_actor_not_authorized'; end if;
  select * into v_lead from public.leads where id = p_lead_id for update;
  if not found then raise exception using errcode = 'P0002', message = 'lead_not_found'; end if;
  if v_lead.status in ('Converted', 'Lost', 'Archived') or v_lead.lead_stage in ('Converted', 'Lost', 'Archived') then
    raise exception using errcode = '40001', message = 'opportunity_already_final';
  end if;
  select * into v_handoff from public.lead_handoffs
  where lead_id = p_lead_id and to_profile_id = p_actor_profile_id and handoff_status = 'accepted'
  order by accepted_at desc nulls last, created_at desc limit 1;
  if not found then raise exception using errcode = '42501', message = 'proposal_not_owned_by_actor'; end if;
  select * into v_mom from public.lead_mom
  where lead_id = p_lead_id and mom_status = 'Sent'
  order by sent_at desc nulls last, created_at desc limit 1;
  if not found then raise exception using errcode = '22023', message = 'proposal_requires_completed_mom'; end if;

  select response_payload into v_existing from public.site_workflow_idempotency
  where idempotency_key = v_key and operation = 'prepare_opportunity_proposal'
    and actor_profile_id = v_actor.id;
  if found then return v_existing; end if;
  if exists (select 1 from public.site_workflow_idempotency where idempotency_key = v_key) then
    raise exception using errcode = '22023', message = 'idempotency_key_in_use';
  end if;

  select * into v_proposal from public.proposals
  where lead_id = p_lead_id order by proposal_version desc, created_at desc limit 1 for update;
  if found then
    return jsonb_build_object('proposal', to_jsonb(v_proposal), 'replayed', true);
  end if;

  if v_mom.site_survey_required is true then
    select * into v_workflow from public.workflow_instances
    where lead_id = p_lead_id order by updated_at desc limit 1 for update;
    if not found or v_workflow.current_stage_code <> 'returned_to_bd' then
      raise exception using errcode = '40001', message = 'opportunity_not_returned_to_bd';
    end if;
  end if;

  insert into public.proposals(
    workflow_instance_id, lead_id, site_visit_id, assessment_id,
    proposal_number, client_name, proposal_status, proposal_payload,
    generated_by_profile_id, generated_by_auth_user_id, generated_by,
    generated_by_name, metadata
  ) values (
    v_workflow.id, v_lead.id, v_workflow.site_visit_id, v_workflow.assessment_id,
    nullif(btrim(p_payload->>'proposal_number'), ''), v_lead.client_name, 'Generated',
    jsonb_build_object(
      'summary', nullif(btrim(p_payload->>'summary'), ''),
      'template_name', nullif(btrim(p_payload->>'template_name'), '')
    ),
    v_actor.id, v_actor.auth_user_id, v_actor.id,
    coalesce(v_actor.full_name, v_actor.employee_code),
    jsonb_build_object(
      'source', case when v_mom.site_survey_required then 'site_survey_workflow' else 'bd_no_survey' end,
      'meeting_id', v_mom.meeting_id,
      'mom_id', v_mom.id,
      'site_survey_required', v_mom.site_survey_required
    )
  ) returning * into v_proposal;

  if v_workflow.id is not null then
    update public.workflow_instances set current_stage_code = 'proposal',
      pending_role = 'BD Executive', approval_status = 'Proposal Generated',
      version = version + 1, updated_at = now()
    where id = v_workflow.id returning * into v_workflow;
    update public.site_assessments set current_stage = 'proposal', status = 'Proposal Generated',
      row_version = row_version + 1, updated_at = now() where id = v_workflow.assessment_id;
    update public.site_visits set current_stage = 'Proposal', pending_with = 'BD Executive',
      status = 'Proposal Generated', updated_at = now() where id = v_workflow.site_visit_id;
    insert into public.workflow_events(
      workflow_instance_id, lead_id, site_visit_id, assessment_id,
      from_stage, to_stage, action, actor_profile_id, actor_auth_user_id,
      actor_employee_code, actor_name, actor_role, metadata
    ) values (
      v_workflow.id, v_workflow.lead_id, v_workflow.site_visit_id, v_workflow.assessment_id,
      'returned_to_bd', 'proposal', 'GENERATE_PROPOSAL', v_actor.id, v_actor.auth_user_id,
      v_actor.employee_code, coalesce(v_actor.full_name, v_actor.employee_code), v_actor.role,
      jsonb_build_object('proposal_id', v_proposal.id)
    );
  end if;
  insert into public.activity_logs(lead_id, activity_type, activity_message, created_by, metadata)
  values (v_lead.id, 'Proposal Ready', 'Business Development prepared the proposal',
    coalesce(v_actor.full_name, v_actor.employee_code, 'Business Development'),
    jsonb_build_object('proposal_id', v_proposal.id, 'site_survey_required', v_mom.site_survey_required));
  v_existing := jsonb_build_object('proposal', to_jsonb(v_proposal), 'workflow_instance',
    case when v_workflow.id is null then null else to_jsonb(v_workflow) end, 'replayed', false);
  insert into public.site_workflow_idempotency(idempotency_key, operation, actor_profile_id, resource_id, response_payload)
  values(v_key, 'prepare_opportunity_proposal', v_actor.id, v_proposal.id, v_existing);
  return v_existing;
end
$function$;

create or replace function public.rpc_send_opportunity_proposal(
  p_proposal_id uuid,
  p_actor_profile_id uuid,
  p_idempotency_key text
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $function$
declare
  v_actor public.profiles%rowtype;
  v_proposal public.proposals%rowtype;
  v_workflow public.workflow_instances%rowtype;
  v_key text := nullif(btrim(coalesce(p_idempotency_key, '')), '');
  v_existing jsonb;
begin
  if v_key is null then raise exception using errcode = '22023', message = 'idempotency_key_required'; end if;
  select * into v_actor from public.profiles
  where id = p_actor_profile_id and role in ('BD Executive', 'BD Head')
    and is_active is true and lower(coalesce(status, 'active')) = 'active';
  if not found then raise exception using errcode = '42501', message = 'bd_actor_not_authorized'; end if;
  select * into v_proposal from public.proposals where id = p_proposal_id for update;
  if not found then raise exception using errcode = 'P0002', message = 'proposal_not_found'; end if;
  if not exists (
    select 1 from public.lead_handoffs h where h.lead_id = v_proposal.lead_id
      and h.to_profile_id = v_actor.id and h.handoff_status = 'accepted'
  ) then raise exception using errcode = '42501', message = 'proposal_not_owned_by_actor'; end if;
  if v_proposal.proposal_status = 'Sent' then
    return jsonb_build_object('proposal', to_jsonb(v_proposal), 'replayed', true);
  end if;
  if v_proposal.proposal_status <> 'Generated' then
    raise exception using errcode = '40001', message = 'proposal_not_ready';
  end if;
  select response_payload into v_existing from public.site_workflow_idempotency
  where idempotency_key = v_key and operation = 'send_opportunity_proposal'
    and actor_profile_id = v_actor.id;
  if found then return v_existing; end if;
  if exists (select 1 from public.site_workflow_idempotency where idempotency_key = v_key) then
    raise exception using errcode = '22023', message = 'idempotency_key_in_use';
  end if;

  update public.proposals set proposal_status = 'Sent', sent_at = now(), updated_at = now()
  where id = v_proposal.id returning * into v_proposal;
  if v_proposal.workflow_instance_id is not null then
    select * into v_workflow from public.workflow_instances where id = v_proposal.workflow_instance_id for update;
    update public.workflow_instances set status = 'Active', approval_status = 'Client Decision Pending',
      pending_role = 'Client Decision', version = version + 1, updated_at = now(), completed_at = null
    where id = v_workflow.id returning * into v_workflow;
    update public.site_assessments set status = 'Proposal Sent', assessment_status = 'Completed',
      row_version = row_version + 1, updated_at = now() where id = v_proposal.assessment_id;
    update public.site_visits set current_stage = 'Proposal Sent', pending_with = 'Client Decision',
      status = 'Proposal Sent', updated_at = now() where id = v_proposal.site_visit_id;
    insert into public.workflow_events(
      workflow_instance_id, lead_id, site_visit_id, assessment_id,
      from_stage, to_stage, action, actor_profile_id, actor_auth_user_id,
      actor_employee_code, actor_name, actor_role, metadata
    ) values (
      v_workflow.id, v_workflow.lead_id, v_workflow.site_visit_id, v_workflow.assessment_id,
      'proposal', 'proposal_sent', 'SEND_PROPOSAL', v_actor.id, v_actor.auth_user_id,
      v_actor.employee_code, coalesce(v_actor.full_name, v_actor.employee_code), v_actor.role,
      jsonb_build_object('proposal_id', v_proposal.id)
    );
  end if;
  insert into public.activity_logs(lead_id, activity_type, activity_message, created_by, metadata)
  values (v_proposal.lead_id, 'Proposal Sent', 'Proposal sent; client decision is pending',
    coalesce(v_actor.full_name, v_actor.employee_code, 'Business Development'),
    jsonb_build_object('proposal_id', v_proposal.id));
  v_existing := jsonb_build_object('proposal', to_jsonb(v_proposal), 'workflow_instance',
    case when v_workflow.id is null then null else to_jsonb(v_workflow) end, 'replayed', false);
  insert into public.site_workflow_idempotency(idempotency_key, operation, actor_profile_id, resource_id, response_payload)
  values(v_key, 'send_opportunity_proposal', v_actor.id, v_proposal.id, v_existing);
  return v_existing;
end
$function$;

-- Proposal Sent is an active client-decision state, not a successful outcome.
create or replace function public.rpc_mark_proposal_sent(
  p_proposal_id uuid,
  p_idempotency_key text default null,
  p_metadata jsonb default '{}'::jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $function$
declare
  v_actor record;
  v_proposal public.proposals%rowtype;
  v_workflow public.workflow_instances%rowtype;
  v_key text := nullif(trim(p_idempotency_key), '');
  v_existing jsonb;
begin
  select * into v_actor from public.site_workflow_current_actor();
  select * into strict v_proposal from public.proposals where id = p_proposal_id for update;
  select * into strict v_workflow from public.workflow_instances where id = v_proposal.workflow_instance_id for update;
  if v_actor.role_key not in ('BD_EXECUTIVE', 'BD_HEAD', 'ADMIN')
     or not public.site_workflow_actor_can_view(v_workflow.assessment_id) then
    raise exception 'Proposal cannot be sent by this actor or at this stage' using errcode = '42501';
  end if;
  if v_key is not null then
    select response_payload into v_existing from public.site_workflow_idempotency
      where idempotency_key = v_key and operation = 'mark_proposal_sent'
        and actor_profile_id = v_actor.profile_id;
    if found then return v_existing; end if;
    if exists (select 1 from public.site_workflow_idempotency where idempotency_key = v_key) then
      raise exception 'Idempotency key is already in use' using errcode = '22023';
    end if;
  end if;
  if v_proposal.proposal_status = 'Sent' then
    return jsonb_build_object('proposal', to_jsonb(v_proposal), 'workflow_instance', to_jsonb(v_workflow));
  end if;
  if v_workflow.current_stage_code <> 'proposal' then
    raise exception 'Proposal cannot be sent by this actor or at this stage' using errcode = '42501';
  end if;
  update public.proposals set proposal_status = 'Sent', sent_at = now(),
    metadata = coalesce(metadata, '{}'::jsonb) || coalesce(p_metadata, '{}'::jsonb), updated_at = now()
    where id = p_proposal_id returning * into v_proposal;
  update public.workflow_instances set status = 'Active', approval_status = 'Client Decision Pending',
    pending_role = 'Client Decision',
    version = version + 1, updated_at = now(), completed_at = null
    where id = v_workflow.id returning * into v_workflow;
  update public.site_assessments set status = 'Proposal Sent', assessment_status = 'Completed',
    row_version = row_version + 1, updated_at = now() where id = v_workflow.assessment_id;
  update public.site_visits set current_stage = 'Proposal Sent',
    pending_with = 'Client Decision', status = 'Proposal Sent', updated_at = now()
    where id = v_workflow.site_visit_id;
  perform public.site_workflow_log_event(v_workflow.id, 'proposal', 'proposal_sent', 'SEND_PROPOSAL', null);
  v_existing := jsonb_build_object('proposal', to_jsonb(v_proposal), 'workflow_instance', to_jsonb(v_workflow));
  if v_key is not null then
    insert into public.site_workflow_idempotency(idempotency_key, operation, actor_profile_id, resource_id, response_payload)
    values(v_key, 'mark_proposal_sent', v_actor.profile_id, v_proposal.id, v_existing)
    on conflict (idempotency_key) do nothing;
  end if;
  return v_existing;
end
$function$;

create or replace function public.rpc_record_proposal_outcome(
  p_proposal_id uuid,
  p_actor_profile_id uuid,
  p_outcome text,
  p_reason text default null,
  p_idempotency_key text default null
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $function$
declare
  v_actor public.profiles%rowtype;
  v_proposal public.proposals%rowtype;
  v_workflow public.workflow_instances%rowtype;
  v_outcome text := initcap(lower(trim(coalesce(p_outcome, ''))));
  v_existing jsonb;
  v_key text := nullif(trim(p_idempotency_key), '');
  v_recorded_outcome text;
begin
  if v_key is null then
    raise exception using errcode = '22023', message = 'idempotency_key_required';
  end if;
  if v_outcome not in ('Converted', 'Lost') then
    raise exception 'Final outcome must be Converted or Lost' using errcode = '22023';
  end if;
  if v_outcome = 'Lost' and nullif(trim(coalesce(p_reason, '')), '') is null then
    raise exception 'A loss reason is required' using errcode = '22023';
  end if;
  select * into v_actor from public.profiles
  where id = p_actor_profile_id
    and role in ('BD Executive', 'BD Head')
    and is_active is true and lower(coalesce(status, 'active')) = 'active';
  if not found then
    raise exception using errcode = '42501', message = 'bd_actor_not_authorized';
  end if;
  select * into strict v_proposal from public.proposals where id = p_proposal_id for update;
  if not exists (
    select 1 from public.lead_handoffs h
    where h.lead_id = v_proposal.lead_id and h.to_profile_id = v_actor.id
      and h.handoff_status = 'accepted'
  ) then
    raise exception using errcode = '42501', message = 'proposal_not_owned_by_actor';
  end if;
  if v_proposal.workflow_instance_id is not null then
    select * into strict v_workflow from public.workflow_instances
    where id = v_proposal.workflow_instance_id for update;
  end if;
  if v_proposal.proposal_status <> 'Sent' then
    raise exception 'Proposal must be sent before recording the client decision' using errcode = '22023';
  end if;
  v_recorded_outcome := nullif(v_proposal.metadata->>'final_outcome', '');
  if v_recorded_outcome is not null then
    if v_recorded_outcome = v_outcome then
      return jsonb_build_object('proposal', to_jsonb(v_proposal), 'outcome', v_recorded_outcome, 'replayed', true);
    end if;
    raise exception 'Proposal outcome has already been recorded' using errcode = '40001';
  end if;
  if v_key is not null then
    select response_payload into v_existing from public.site_workflow_idempotency
      where idempotency_key = v_key and operation = 'record_proposal_outcome'
        and actor_profile_id = v_actor.id;
    if found then return v_existing; end if;
  end if;

  update public.proposals set metadata = coalesce(metadata, '{}'::jsonb) || jsonb_build_object(
      'final_outcome', v_outcome,
      'outcome_at', now(),
      'outcome_by_profile_id', v_actor.id,
      'loss_reason', case when v_outcome = 'Lost' then trim(p_reason) else null end
    ), updated_at = now()
  where id = v_proposal.id returning * into v_proposal;
  update public.leads set status = v_outcome, lead_stage = v_outcome,
    last_activity_at = now(), updated_at = now()
  where id = v_proposal.lead_id;
  if v_workflow.id is not null then
    update public.workflow_instances set status = 'Completed', approval_status = v_outcome,
      version = version + 1, updated_at = now(), completed_at = now()
    where id = v_workflow.id returning * into v_workflow;
    update public.site_visits set current_stage = v_outcome, pending_with = null,
      status = v_outcome, updated_at = now()
    where id = v_workflow.site_visit_id;
    insert into public.workflow_events(
      workflow_instance_id, lead_id, site_visit_id, assessment_id,
      from_stage, to_stage, action, actor_profile_id, actor_auth_user_id,
      actor_employee_code, actor_name, actor_role, remarks, metadata
    ) values (
      v_workflow.id, v_proposal.lead_id, v_workflow.site_visit_id, v_workflow.assessment_id,
      'proposal_sent', lower(v_outcome), 'RECORD_CLIENT_DECISION', v_actor.id, v_actor.auth_user_id,
      v_actor.employee_code, coalesce(v_actor.full_name, v_actor.employee_code), v_actor.role,
      case when v_outcome = 'Lost' then trim(p_reason) else null end,
      jsonb_build_object('proposal_id', v_proposal.id)
    );
  end if;
  insert into public.activity_logs(lead_id, activity_type, activity_message, created_by, metadata)
  values (v_proposal.lead_id, 'Client Decision', 'Client decision recorded: ' || v_outcome,
    coalesce(v_actor.full_name, v_actor.employee_code, 'Business Development'),
    jsonb_build_object('proposal_id', v_proposal.id, 'outcome', v_outcome,
      'loss_reason', case when v_outcome = 'Lost' then trim(p_reason) else null end));
  v_existing := jsonb_build_object('proposal', to_jsonb(v_proposal), 'outcome', v_outcome, 'replayed', false);
  if v_key is not null then
    insert into public.site_workflow_idempotency(idempotency_key, operation, actor_profile_id, resource_id, response_payload)
    values(v_key, 'record_proposal_outcome', v_actor.id, v_proposal.id, v_existing)
    on conflict (idempotency_key) do nothing;
  end if;
  return v_existing;
end
$function$;

create or replace function public.opportunity_proposal_notification_trigger()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
as $function$
declare
  v_pre_sales_profile_id uuid;
  v_bd_profile_id uuid;
begin
  if new.proposal_status = 'Sent' and new.proposal_status is distinct from old.proposal_status then
    select coalesce(l.pre_sales_owner_profile_id, creator.id) into v_pre_sales_profile_id
    from public.leads l
    left join public.profiles creator on creator.auth_user_id::text = l.created_by_user_id
    where l.id = new.lead_id;
    select h.to_profile_id into v_bd_profile_id from public.lead_handoffs h
    where h.lead_id = new.lead_id and h.handoff_status = 'accepted'
    order by h.accepted_at desc nulls last, h.created_at desc limit 1;
    perform public.opportunity_notify(
      new.lead_id, v_pre_sales_profile_id, 'proposal_sent',
      'Proposal sent', 'The proposal was sent and the client decision is pending.',
      '/pre-sales/leads/' || new.lead_id::text,
      'proposal:sent:pre-sales:' || new.id::text, jsonb_build_object('proposal_id', new.id)
    );
    perform public.opportunity_notify(
      new.lead_id, v_bd_profile_id, 'proposal_sent',
      'Proposal sent', 'The proposal was sent and the client decision is pending.',
      '/pre-sales/meetings',
      'proposal:sent:bd:' || new.id::text, jsonb_build_object('proposal_id', new.id)
    );
  end if;
  return new;
end
$function$;

drop trigger if exists trg_opportunity_proposal_notification on public.proposals;
create trigger trg_opportunity_proposal_notification
after update of proposal_status on public.proposals
for each row execute function public.opportunity_proposal_notification_trigger();

create or replace function public.opportunity_outcome_notification_trigger()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
as $function$
declare
  v_bd_profile_id uuid;
  v_pre_sales_profile_id uuid;
begin
  if new.status in ('Converted', 'Lost') and new.status is distinct from old.status then
    select coalesce(new.pre_sales_owner_profile_id, creator.id) into v_pre_sales_profile_id
    from public.profiles creator where creator.auth_user_id::text = new.created_by_user_id
    limit 1;
    v_pre_sales_profile_id := coalesce(v_pre_sales_profile_id, new.pre_sales_owner_profile_id);
    select h.to_profile_id into v_bd_profile_id from public.lead_handoffs h
    where h.lead_id = new.id and h.handoff_status = 'accepted'
    order by h.accepted_at desc nulls last, h.created_at desc limit 1;
    perform public.opportunity_notify(
      new.id, v_pre_sales_profile_id, 'opportunity_final_outcome',
      'Opportunity ' || new.status, 'The client decision was recorded as ' || new.status || '.',
      '/pre-sales/leads/' || new.id::text,
      'outcome:pre-sales:' || new.id::text || ':' || lower(new.status),
      jsonb_build_object('outcome', new.status)
    );
    perform public.opportunity_notify(
      new.id, v_bd_profile_id, 'opportunity_final_outcome',
      'Opportunity ' || new.status, 'The client decision was recorded as ' || new.status || '.',
      '/pre-sales/meetings',
      'outcome:bd:' || new.id::text || ':' || lower(new.status),
      jsonb_build_object('outcome', new.status)
    );
  end if;
  return new;
end
$function$;

drop trigger if exists trg_opportunity_outcome_notification on public.leads;
create trigger trg_opportunity_outcome_notification
after update of status on public.leads
for each row execute function public.opportunity_outcome_notification_trigger();

revoke all on function public.rpc_prepare_opportunity_proposal(uuid,uuid,jsonb,text)
  from public, anon, authenticated;
revoke all on function public.rpc_send_opportunity_proposal(uuid,uuid,text)
  from public, anon, authenticated;
revoke all on function public.rpc_record_proposal_outcome(uuid,uuid,text,text,text) from public, anon, authenticated;
grant execute on function public.rpc_prepare_opportunity_proposal(uuid,uuid,jsonb,text) to service_role;
grant execute on function public.rpc_send_opportunity_proposal(uuid,uuid,text) to service_role;
grant execute on function public.rpc_record_proposal_outcome(uuid,uuid,text,text,text) to service_role;
revoke all on function public.opportunity_handoff_notification_trigger() from public, anon, authenticated;
revoke all on function public.opportunity_site_visit_notification_trigger() from public, anon, authenticated;
revoke all on function public.opportunity_workflow_notification_trigger() from public, anon, authenticated;
revoke all on function public.opportunity_proposal_notification_trigger() from public, anon, authenticated;
revoke all on function public.opportunity_outcome_notification_trigger() from public, anon, authenticated;

commit;
