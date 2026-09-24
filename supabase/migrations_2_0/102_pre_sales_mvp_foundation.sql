-- Pre-Sales MVP foundation. Additive only; no existing lead data is rewritten.
begin;

-- Keep the existing canonical role vocabulary and add the two approved
-- Pre-Sales roles. NOT VALID avoids an unrelated historical-row validation.
alter table public.profiles drop constraint if exists profiles_role_check;
alter table public.profiles add constraint profiles_role_check check (
  role in (
    'Admin', 'QPMS Admin', 'Developer', 'Dev', 'IT Admin', 'Management IT Admin',
    'Management',
    'MD', 'COO', 'Executive Assistant', 'GM', 'General Manager', 'South Head',
    'Business Head', 'Branch Head', 'Operations Manager', 'Manager', 'KAM',
    'FO', 'Field Officer', 'Supervisor', 'BD Executive', 'BD Head',
    'Pre-Sales Executive', 'Pre-Sales Manager', 'Hospital Management', 'RMO',
    'Doctor', 'Operations Team', 'Coordinator', 'Commercial', 'Commercial Team',
    'Commercial Reviewer', 'Finance', 'Finance Team', 'Finance Reviewer',
    'HR Reviewer', 'HR', 'HR GM', 'Finance GM', 'DEMO_VIEWER'
  )
) not valid;

alter table public.leads
  add column if not exists pre_sales_stage text,
  add column if not exists pre_sales_owner_profile_id uuid references public.profiles(id) on delete set null,
  add column if not exists last_activity_at timestamptz;

alter table public.leads drop constraint if exists leads_pre_sales_stage_check;
alter table public.leads add constraint leads_pre_sales_stage_check check (
  pre_sales_stage is null or pre_sales_stage in (
    'new_lead', 'pre_sales_assigned', 'calling', 'follow_up',
    'meeting_scheduled', 'meeting_completed', 'qualification',
    'pending_bd_handover', 'bd_accepted', 'invalid'
  )
);

create index if not exists idx_leads_pre_sales_owner_stage
  on public.leads(pre_sales_owner_profile_id, pre_sales_stage, updated_at desc);

create table if not exists public.lead_call_updates (
  id uuid primary key default gen_random_uuid(),
  lead_id uuid not null references public.leads(id) on delete restrict,
  feedback_type text not null check (feedback_type in (
    'rnr', 'call_back', 'future_followup', 'no_requirement', 'invalid_lead', 'interested'
  )),
  notes text not null check (btrim(notes) <> ''),
  next_action text,
  followup_at timestamptz,
  created_by_profile_id uuid references public.profiles(id) on delete set null,
  created_by_name text not null,
  metadata jsonb not null default '{}'::jsonb check (jsonb_typeof(metadata) = 'object'),
  created_at timestamptz not null default now()
);

create table if not exists public.lead_followups (
  id uuid primary key default gen_random_uuid(),
  lead_id uuid not null references public.leads(id) on delete restrict,
  source_type text not null default 'manual',
  source_id uuid,
  followup_type text not null,
  scheduled_at timestamptz not null,
  status text not null default 'pending' check (status in ('pending', 'completed', 'missed', 'cancelled')),
  outcome text,
  remarks text,
  owner_profile_id uuid references public.profiles(id) on delete set null,
  created_by_profile_id uuid references public.profiles(id) on delete set null,
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.lead_meetings (
  id uuid primary key default gen_random_uuid(),
  lead_id uuid not null references public.leads(id) on delete restrict,
  scheduled_at timestamptz not null,
  meeting_mode text not null check (meeting_mode in ('in_person', 'video', 'phone')),
  location_or_link text,
  meeting_status text not null default 'scheduled' check (meeting_status in ('scheduled', 'completed', 'cancelled', 'rescheduled')),
  requirement_identified boolean,
  meeting_notes text,
  created_by_profile_id uuid references public.profiles(id) on delete set null,
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.lead_handoffs (
  id uuid primary key default gen_random_uuid(),
  lead_id uuid not null references public.leads(id) on delete restrict,
  from_profile_id uuid references public.profiles(id) on delete set null,
  to_profile_id uuid not null references public.profiles(id) on delete restrict,
  handoff_status text not null default 'pending' check (handoff_status in ('pending', 'accepted', 'rejected')),
  qualification_summary text not null check (btrim(qualification_summary) <> ''),
  handoff_notes text,
  created_at timestamptz not null default now(),
  accepted_at timestamptz,
  rejected_at timestamptz,
  rejection_reason text,
  metadata jsonb not null default '{}'::jsonb check (jsonb_typeof(metadata) = 'object')
);

create index if not exists idx_lead_call_updates_lead_created
  on public.lead_call_updates(lead_id, created_at desc);
create index if not exists idx_lead_followups_owner_scheduled
  on public.lead_followups(owner_profile_id, scheduled_at);
create index if not exists idx_lead_followups_lead_scheduled
  on public.lead_followups(lead_id, scheduled_at);
create index if not exists idx_lead_followups_status_scheduled
  on public.lead_followups(status, scheduled_at);
create index if not exists idx_lead_meetings_lead_scheduled
  on public.lead_meetings(lead_id, scheduled_at);
create index if not exists idx_lead_meetings_status_scheduled
  on public.lead_meetings(meeting_status, scheduled_at);
create index if not exists idx_lead_handoffs_lead_created
  on public.lead_handoffs(lead_id, created_at desc);
create index if not exists idx_lead_handoffs_status_created
  on public.lead_handoffs(handoff_status, created_at);
create unique index if not exists ux_lead_handoffs_one_pending
  on public.lead_handoffs(lead_id) where handoff_status = 'pending';

create or replace function public.rpc_add_pre_sales_call_update(
  p_lead_id uuid,
  p_payload jsonb,
  p_actor jsonb
) returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_call public.lead_call_updates%rowtype;
  v_followup public.lead_followups%rowtype;
  v_meeting public.lead_meetings%rowtype;
  v_lead public.leads%rowtype;
  v_stage text := p_payload->>'pre_sales_stage';
  v_profile_id uuid := nullif(p_actor->>'profile_id', '')::uuid;
  v_actor_name text := coalesce(nullif(btrim(p_actor->>'name'), ''), 'Unknown');
begin
  select * into v_lead from public.leads where id = p_lead_id for update;
  if not found then raise exception 'Lead not found'; end if;

  insert into public.lead_call_updates (
    lead_id, feedback_type, notes, next_action, followup_at,
    created_by_profile_id, created_by_name, metadata
  ) values (
    p_lead_id, p_payload->>'feedback_type', p_payload->>'notes',
    nullif(p_payload->>'next_action', ''), nullif(p_payload->>'followup_at', '')::timestamptz,
    v_profile_id, v_actor_name,
    jsonb_build_object('meeting_required', coalesce((p_payload->>'meeting_required')::boolean, false), 'qualified', coalesce((p_payload->>'qualified')::boolean, false))
  ) returning * into v_call;

  if nullif(p_payload->>'followup_at', '') is not null then
    insert into public.lead_followups (
      lead_id, source_type, source_id, followup_type, scheduled_at, status,
      remarks, owner_profile_id, created_by_profile_id
    ) values (
      p_lead_id, 'call_update', v_call.id, p_payload->>'feedback_type',
      (p_payload->>'followup_at')::timestamptz, 'pending',
      coalesce(nullif(p_payload->>'next_action', ''), p_payload->>'notes'),
      coalesce(v_lead.pre_sales_owner_profile_id, v_profile_id), v_profile_id
    ) returning * into v_followup;
  end if;

  if jsonb_typeof(p_payload->'meeting') = 'object' then
    insert into public.lead_meetings (
      lead_id, scheduled_at, meeting_mode, location_or_link, meeting_status,
      meeting_notes, created_by_profile_id
    ) values (
      p_lead_id, (p_payload->'meeting'->>'scheduled_at')::timestamptz,
      p_payload->'meeting'->>'meeting_mode', nullif(p_payload->'meeting'->>'location_or_link', ''),
      'scheduled', nullif(p_payload->'meeting'->>'meeting_notes', ''), v_profile_id
    ) returning * into v_meeting;
  end if;

  update public.leads set
    pre_sales_stage = v_stage,
    status = case when p_payload->>'feedback_type' = 'invalid_lead' then 'Invalid'
                  when coalesce((p_payload->>'qualified')::boolean, false) then 'Qualified'
                  else status end,
    last_activity_at = now(), updated_at = now()
  where id = p_lead_id returning * into v_lead;

  insert into public.activity_logs (
    lead_id, activity_type, activity_message, created_by, metadata
  ) values (
    p_lead_id, 'Pre-Sales Call Update',
    coalesce(p_payload->>'feedback_label', p_payload->>'feedback_type') || ': ' || p_payload->>'notes',
    v_actor_name,
    jsonb_build_object('call_update_id', v_call.id, 'followup_id', v_followup.id, 'meeting_id', v_meeting.id, 'pre_sales_stage', v_stage)
  );

  return jsonb_build_object(
    'call_update', to_jsonb(v_call), 'followup', case when v_followup.id is null then null else to_jsonb(v_followup) end,
    'meeting', case when v_meeting.id is null then null else to_jsonb(v_meeting) end,
    'lead', to_jsonb(v_lead)
  );
end;
$$;

alter table public.lead_call_updates enable row level security;
alter table public.lead_followups enable row level security;
alter table public.lead_meetings enable row level security;
alter table public.lead_handoffs enable row level security;

revoke all on public.lead_call_updates, public.lead_followups, public.lead_meetings, public.lead_handoffs from public, anon, authenticated;
grant all on public.lead_call_updates, public.lead_followups, public.lead_meetings, public.lead_handoffs to service_role;
revoke all on function public.rpc_add_pre_sales_call_update(uuid, jsonb, jsonb) from public, anon, authenticated;
grant execute on function public.rpc_add_pre_sales_call_update(uuid, jsonb, jsonb) to service_role;

-- Pre-Sales records are intentionally backend-only in this phase. The Express
-- API applies the existing lead visibility policy before every service-role read/write.

commit;
