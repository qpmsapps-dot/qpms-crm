begin;

-- Visit-linked Minutes of Meeting. Additive only; no attendance, GPS, KM,
-- reimbursement, travel-mode, or existing activity rows are rewritten.
create table if not exists public.mom_business_capabilities (
  id uuid primary key default gen_random_uuid(),
  business_key text,
  client_key text,
  is_enabled boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint mom_capability_key_required check (business_key is not null or client_key is not null),
  constraint mom_capability_business_key_format check (business_key is null or business_key ~ '^[A-Z0-9]+$'),
  constraint mom_capability_client_key_format check (client_key is null or client_key ~ '^[A-Z0-9]+$')
);
create unique index if not exists ux_mom_capability_business on public.mom_business_capabilities(business_key) where business_key is not null;
create unique index if not exists ux_mom_capability_client on public.mom_business_capabilities(client_key) where client_key is not null;
insert into public.mom_business_capabilities(business_key, is_enabled)
values ('DME', true)
on conflict (business_key) where business_key is not null do update set is_enabled = excluded.is_enabled;

-- MoM evidence must not share the broader FO activity bucket, whose existing
-- authenticated policies allow direct object access outside the MoM API.
insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
values ('dme-mom-private','dme-mom-private',false,10485760,array['image/jpeg','image/png','image/webp','application/pdf']::text[])
on conflict(id) do update set
  public=false,
  file_size_limit=excluded.file_size_limit,
  allowed_mime_types=excluded.allowed_mime_types;

create table if not exists public.visit_moms (
  id uuid primary key,
  attendance_id uuid not null references public.fo_attendance(id) on delete restrict,
  site_visit_id uuid not null references public.fo_site_visits(id) on delete restrict,
  site_id uuid not null references public.store_master(id) on delete restrict,
  owner_profile_id uuid not null references public.profiles(id) on delete restrict,
  employee_code text not null,
  business_snapshot text,
  client_name_snapshot text,
  site_name_snapshot text not null,
  site_code_snapshot text,
  state_snapshot text,
  location_snapshot text,
  visit_date date not null,
  attendance_check_in timestamptz not null,
  attendance_check_out timestamptz,
  visit_check_in timestamptz not null,
  visit_check_out timestamptz,
  meeting_date date not null,
  meeting_time time not null,
  meeting_with text,
  meeting_designation text,
  meeting_designation_other text,
  audit_area_department text,
  visit_number integer,
  purpose_of_meeting text not null default 'To discuss quality-audit observations, management concerns, operational gaps, required corrective actions, responsibilities and timelines.',
  prepared_by text not null,
  reviewed_by text,
  follow_up_required boolean not null default false,
  follow_up_date date,
  follow_up_mode text,
  follow_up_mode_other text,
  follow_up_notes text,
  closure_statement text not null default 'The above points and action items were discussed and noted. Responsible teams/persons are requested to complete the agreed actions within the target timeline and provide an update during the next review.',
  management_representative_name text,
  management_representative_designation text,
  reviewer_user_id uuid references public.profiles(id) on delete set null,
  reviewer_name text,
  reviewed_at timestamptz,
  review_status text not null default 'pending',
  status text not null default 'draft',
  created_after_checkout boolean not null default false,
  submitted_at timestamptz,
  submitted_by uuid references public.profiles(id) on delete set null,
  submission_payload_hash text,
  closed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint visit_moms_site_visit_unique unique(site_visit_id),
  constraint visit_moms_status_check check (status in ('draft','submitted','follow_up_pending','closed')),
  constraint visit_moms_designation_check check (meeting_designation is null or meeting_designation in ('Director','RMO','Dean','Medical Superintendent','Administrator','Other')),
  constraint visit_moms_follow_up_mode_check check (follow_up_mode is null or follow_up_mode in ('Physical Visit','Call','Email','Other')),
  constraint visit_moms_review_status_check check (review_status in ('pending','approved','changes_requested')),
  constraint visit_moms_visit_number_check check (visit_number is null or visit_number > 0)
);
create index if not exists idx_visit_moms_owner_updated on public.visit_moms(employee_code, updated_at desc);
create index if not exists idx_visit_moms_attendance on public.visit_moms(attendance_id);
create index if not exists idx_visit_moms_site_date on public.visit_moms(site_id, meeting_date desc);
create index if not exists idx_visit_moms_status on public.visit_moms(status, follow_up_date);

create table if not exists public.mom_discussion_points (
  id uuid primary key,
  mom_id uuid not null references public.visit_moms(id) on delete cascade,
  area_department text,
  observation_issue text not null,
  management_direction text,
  priority text not null default 'Medium',
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint mom_discussion_priority_check check (priority in ('Low','Medium','High','Critical')),
  constraint mom_discussion_observation_not_blank check (btrim(observation_issue) <> ''),
  constraint mom_discussion_mom_id_id_unique unique(mom_id,id)
);
create index if not exists idx_mom_discussion_mom_sort on public.mom_discussion_points(mom_id, sort_order);

create table if not exists public.mom_action_items (
  id uuid primary key,
  mom_id uuid not null references public.visit_moms(id) on delete cascade,
  discussion_point_id uuid,
  issue_observation text not null,
  corrective_action text not null,
  responsible_person text,
  responsible_team text,
  target_date date,
  status text not null default 'Open',
  remarks text,
  completed_at timestamptz,
  verified_at timestamptz,
  source_mom_id uuid references public.visit_moms(id) on delete set null,
  source_action_item_id uuid references public.mom_action_items(id) on delete set null,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint mom_action_status_check check (status in ('Open','In Progress','Completed','Verified','Closed')),
  constraint mom_action_issue_not_blank check (btrim(issue_observation) <> ''),
  constraint mom_action_corrective_not_blank check (btrim(corrective_action) <> ''),
  constraint mom_action_discussion_same_mom_fk foreign key(mom_id,discussion_point_id)
    references public.mom_discussion_points(mom_id,id) on delete set null (discussion_point_id)
);
create index if not exists idx_mom_actions_mom_sort on public.mom_action_items(mom_id, sort_order);
create index if not exists idx_mom_actions_open_target on public.mom_action_items(status, target_date) where status in ('Open','In Progress');

create table if not exists public.mom_management_concerns (
  id uuid primary key,
  mom_id uuid not null references public.visit_moms(id) on delete cascade,
  concern_text text not null,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  constraint mom_concern_not_blank check (btrim(concern_text) <> '')
);
create index if not exists idx_mom_concerns_mom_sort on public.mom_management_concerns(mom_id, sort_order);

create table if not exists public.mom_appreciations (
  id uuid primary key,
  mom_id uuid not null references public.visit_moms(id) on delete cascade,
  appreciation_text text not null,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  constraint mom_appreciation_not_blank check (btrim(appreciation_text) <> '')
);
create index if not exists idx_mom_appreciations_mom_sort on public.mom_appreciations(mom_id, sort_order);

create table if not exists public.mom_attachments (
  id uuid primary key,
  mom_id uuid not null references public.visit_moms(id) on delete cascade,
  attachment_type text not null,
  storage_bucket text not null default 'dme-mom-private',
  storage_path text not null unique,
  original_filename text not null,
  mime_type text not null,
  file_size bigint not null,
  uploaded_by uuid references public.profiles(id) on delete set null,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  constraint mom_attachment_type_check check (attachment_type in ('management_signature','signed_mom','supporting_document')),
  constraint mom_attachment_size_check check (file_size > 0 and file_size <= 10485760)
);
create index if not exists idx_mom_attachments_mom on public.mom_attachments(mom_id, created_at);

drop trigger if exists trg_mom_capabilities_updated_at on public.mom_business_capabilities;
create trigger trg_mom_capabilities_updated_at before update on public.mom_business_capabilities for each row execute function public.set_updated_at();
drop trigger if exists trg_visit_moms_updated_at on public.visit_moms;
create trigger trg_visit_moms_updated_at before update on public.visit_moms for each row execute function public.set_updated_at();
drop trigger if exists trg_mom_discussion_updated_at on public.mom_discussion_points;
create trigger trg_mom_discussion_updated_at before update on public.mom_discussion_points for each row execute function public.set_updated_at();
drop trigger if exists trg_mom_actions_updated_at on public.mom_action_items;
create trigger trg_mom_actions_updated_at before update on public.mom_action_items for each row execute function public.set_updated_at();

alter table public.mom_business_capabilities enable row level security;
alter table public.visit_moms enable row level security;
alter table public.mom_discussion_points enable row level security;
alter table public.mom_action_items enable row level security;
alter table public.mom_management_concerns enable row level security;
alter table public.mom_appreciations enable row level security;
alter table public.mom_attachments enable row level security;
revoke all on public.mom_business_capabilities, public.visit_moms, public.mom_discussion_points,
  public.mom_action_items, public.mom_management_concerns, public.mom_appreciations, public.mom_attachments from anon, authenticated;
grant all on public.mom_business_capabilities, public.visit_moms, public.mom_discussion_points,
  public.mom_action_items, public.mom_management_concerns, public.mom_appreciations, public.mom_attachments to service_role;

create or replace function public.rpc_save_visit_mom(
  p_actor_profile_id uuid,
  p_payload jsonb,
  p_submit boolean default false
) returns uuid
language plpgsql security definer set search_path = public
as $$
declare
  v_profile public.profiles%rowtype;
  v_attendance public.fo_attendance%rowtype;
  v_visit public.fo_site_visits%rowtype;
  v_store public.store_master%rowtype;
  v_existing public.visit_moms%rowtype;
  v_requested_mom_id uuid := (p_payload->>'id')::uuid;
  v_mom_id uuid := v_requested_mom_id;
  v_employee_code text;
  v_business_key text;
  v_client_key text;
  v_now timestamptz := now();
  v_status text;
  v_payload_hash text := md5(p_payload::text);
  v_action_timestamps jsonb := '{}'::jsonb;
begin
  select * into v_profile from public.profiles where id = p_actor_profile_id and coalesce(is_active,true) = true;
  if not found then raise exception 'mom_not_owner' using errcode = '42501'; end if;
  v_employee_code := upper(btrim(coalesce(v_profile.employee_code, v_profile.username, '')));
  if v_employee_code = '' then raise exception 'mom_not_owner' using errcode = '42501'; end if;
  select * into v_attendance from public.fo_attendance where id = (p_payload->>'attendance_id')::uuid;
  if not found or v_employee_code not in (upper(coalesce(v_attendance.employee_code,'')), upper(coalesce(v_attendance.fo_user_id,'')), upper(coalesce(v_attendance.username,''))) then
    raise exception 'mom_not_owner' using errcode = '42501';
  end if;
  select * into v_visit from public.fo_site_visits where id = (p_payload->>'site_visit_id')::uuid;
  if not found or v_visit.attendance_id is distinct from v_attendance.id then raise exception 'mom_visit_mismatch' using errcode = '22023'; end if;
  if v_employee_code not in (upper(coalesce(v_visit.employee_code,'')), upper(coalesce(v_visit.fo_user_id,''))) then raise exception 'mom_not_owner' using errcode = '42501'; end if;
  select * into v_store from public.store_master where id = coalesce(v_visit.store_id,v_visit.site_id);
  if not found then raise exception 'mom_visit_mismatch' using errcode = '22023'; end if;
  v_business_key := regexp_replace(upper(coalesce(v_store.business,'')), '[^A-Z0-9]+', '', 'g');
  v_client_key := regexp_replace(upper(coalesce(v_store.client_name,'')), '[^A-Z0-9]+', '', 'g');
  if not exists(select 1 from public.mom_business_capabilities where is_enabled and (business_key = v_business_key or client_key = v_client_key)) then
    raise exception 'mom_not_eligible' using errcode = '42501';
  end if;

  -- Serialise creates for the authoritative visit identity so a retry using a
  -- different client UUID resolves to the existing row instead of racing the
  -- one-MoM-per-visit constraint.
  perform pg_advisory_xact_lock(hashtextextended(v_visit.id::text, 0));
  select * into v_existing from public.visit_moms where site_visit_id = v_visit.id for update;
  if found then
    if upper(v_existing.employee_code) <> v_employee_code then raise exception 'mom_not_owner' using errcode = '42501'; end if;
    if v_existing.status <> 'draft' then
      if p_submit and v_existing.submission_payload_hash = v_payload_hash then return v_existing.id; end if;
      raise exception 'mom_immutable' using errcode = '22023';
    end if;
    v_mom_id := v_existing.id;
  else
    select * into v_existing from public.visit_moms where id = v_requested_mom_id for update;
    if found then raise exception 'mom_visit_mismatch' using errcode = '22023'; end if;
  end if;
  if p_submit and nullif(btrim(p_payload->>'meeting_with'),'') is null then raise exception 'mom_meeting_with_required' using errcode = '22023'; end if;
  if p_submit and coalesce(p_payload->>'meeting_designation','') not in ('Director','RMO','Dean','Medical Superintendent','Administrator','Other') then raise exception 'mom_meeting_designation_required' using errcode = '22023'; end if;
  if p_submit and p_payload->>'meeting_designation' = 'Other' and nullif(btrim(p_payload->>'meeting_designation_other'),'') is null then raise exception 'mom_meeting_designation_other_required' using errcode = '22023'; end if;
  if p_submit and not exists (
    select 1 from jsonb_array_elements(coalesce(p_payload->'discussion_points','[]'::jsonb)) x
    where nullif(btrim(x->>'observation_issue'),'') is not null
  ) then raise exception 'mom_discussion_required' using errcode = '22023'; end if;
  if exists (
    select 1 from jsonb_array_elements(coalesce(p_payload->'discussion_points','[]'::jsonb)) x
    where coalesce(nullif(x->>'priority',''),'Medium') not in ('Low','Medium','High','Critical')
  ) then raise exception 'mom_priority_invalid' using errcode = '22023'; end if;
  if exists (
    select 1 from jsonb_array_elements(coalesce(p_payload->'action_items','[]'::jsonb)) x
    where coalesce(nullif(x->>'status',''),'Open') not in ('Open','In Progress','Completed','Verified','Closed')
  ) then raise exception 'mom_action_status_invalid' using errcode = '22023'; end if;
  if p_submit and exists (
    select 1 from jsonb_array_elements(coalesce(p_payload->'action_items','[]'::jsonb)) x
    where nullif(btrim(x->>'issue_observation'),'') is null or nullif(btrim(x->>'corrective_action'),'') is null
  ) then raise exception 'mom_action_incomplete' using errcode = '22023'; end if;
  if p_submit and coalesce((p_payload->>'follow_up_required')::boolean,false) and nullif(p_payload->>'follow_up_date','') is null then raise exception 'mom_follow_up_date_required' using errcode = '22023'; end if;
  if p_submit and coalesce((p_payload->>'follow_up_required')::boolean,false) and coalesce(p_payload->>'follow_up_mode','') not in ('Physical Visit','Call','Email','Other') then raise exception 'mom_follow_up_mode_required' using errcode = '22023'; end if;
  if p_submit and coalesce((p_payload->>'follow_up_required')::boolean,false) and p_payload->>'follow_up_mode' = 'Other' and nullif(btrim(p_payload->>'follow_up_mode_other'),'') is null then raise exception 'mom_follow_up_mode_other_required' using errcode = '22023'; end if;
  v_status := case when p_submit and coalesce((p_payload->>'follow_up_required')::boolean,false) then 'follow_up_pending' when p_submit then 'submitted' else 'draft' end;

  insert into public.visit_moms(
    id,attendance_id,site_visit_id,site_id,owner_profile_id,employee_code,business_snapshot,client_name_snapshot,
    site_name_snapshot,site_code_snapshot,state_snapshot,location_snapshot,visit_date,attendance_check_in,attendance_check_out,
    visit_check_in,visit_check_out,meeting_date,meeting_time,meeting_with,meeting_designation,meeting_designation_other,
    audit_area_department,visit_number,purpose_of_meeting,prepared_by,reviewed_by,follow_up_required,follow_up_date,
    follow_up_mode,follow_up_mode_other,follow_up_notes,closure_statement,management_representative_name,
    management_representative_designation,status,created_after_checkout,submitted_at,submitted_by,submission_payload_hash
  ) values (
    v_mom_id,v_attendance.id,v_visit.id,v_store.id,v_profile.id,v_employee_code,v_store.business,v_store.client_name,
    coalesce(v_store.store_name,v_visit.store_name,'Unknown site'),coalesce(v_store.store_code,v_visit.store_code),v_store.state,
    coalesce(p_payload->>'location',v_visit.site_name,v_store.store_name),v_attendance.attendance_date,v_attendance.login_time,v_attendance.logout_time,
    v_visit.check_in_time,coalesce(v_visit.check_out_time,v_visit.checkout_time),coalesce(nullif(p_payload->>'meeting_date','')::date,v_visit.check_in_time::date),
    coalesce(nullif(p_payload->>'meeting_time','')::time,v_visit.check_in_time::time),nullif(btrim(p_payload->>'meeting_with'),''),
    nullif(p_payload->>'meeting_designation',''),nullif(btrim(p_payload->>'meeting_designation_other'),''),nullif(btrim(p_payload->>'audit_area_department'),''),
    nullif(p_payload->>'visit_number','')::integer,coalesce(nullif(btrim(p_payload->>'purpose_of_meeting'),''),'To discuss quality-audit observations, management concerns, operational gaps, required corrective actions, responsibilities and timelines.'),
    coalesce(nullif(btrim(v_profile.full_name),''),nullif(btrim(v_profile.display_name),''),v_employee_code),nullif(btrim(p_payload->>'reviewed_by'),''),
    coalesce((p_payload->>'follow_up_required')::boolean,false),case when coalesce((p_payload->>'follow_up_required')::boolean,false) then nullif(p_payload->>'follow_up_date','')::date end,case when coalesce((p_payload->>'follow_up_required')::boolean,false) then nullif(p_payload->>'follow_up_mode','') end,
    case when coalesce((p_payload->>'follow_up_required')::boolean,false) then nullif(btrim(p_payload->>'follow_up_mode_other'),'') end,nullif(btrim(p_payload->>'follow_up_notes'),''),
    coalesce(nullif(btrim(p_payload->>'closure_statement'),''),'The above points and action items were discussed and noted. Responsible teams/persons are requested to complete the agreed actions within the target timeline and provide an update during the next review.'),
    nullif(btrim(p_payload->>'management_representative_name'),''),nullif(btrim(p_payload->>'management_representative_designation'),''),
    v_status,(coalesce(v_visit.check_out_time,v_visit.checkout_time) is not null and v_now > coalesce(v_visit.check_out_time,v_visit.checkout_time)),
    case when p_submit then v_now else null end,case when p_submit then v_profile.id else null end,case when p_submit then v_payload_hash else null end
  ) on conflict(id) do update set
    meeting_date=excluded.meeting_date,meeting_time=excluded.meeting_time,meeting_with=excluded.meeting_with,
    meeting_designation=excluded.meeting_designation,meeting_designation_other=excluded.meeting_designation_other,
    audit_area_department=excluded.audit_area_department,purpose_of_meeting=excluded.purpose_of_meeting,reviewed_by=excluded.reviewed_by,
    follow_up_required=excluded.follow_up_required,follow_up_date=excluded.follow_up_date,follow_up_mode=excluded.follow_up_mode,
    follow_up_mode_other=excluded.follow_up_mode_other,follow_up_notes=excluded.follow_up_notes,closure_statement=excluded.closure_statement,
    management_representative_name=excluded.management_representative_name,
    management_representative_designation=excluded.management_representative_designation,status=excluded.status,
    visit_number=excluded.visit_number,
    attendance_check_out=excluded.attendance_check_out,visit_check_out=excluded.visit_check_out,
    submitted_at=excluded.submitted_at,submitted_by=excluded.submitted_by,submission_payload_hash=excluded.submission_payload_hash,updated_at=v_now;

  select coalesce(jsonb_object_agg(id::text,jsonb_build_object('completed_at',completed_at,'verified_at',verified_at)),'{}'::jsonb)
    into v_action_timestamps from public.mom_action_items where mom_id=v_mom_id;
  delete from public.mom_action_items where mom_id=v_mom_id;
  delete from public.mom_discussion_points where mom_id=v_mom_id;
  delete from public.mom_management_concerns where mom_id=v_mom_id;
  delete from public.mom_appreciations where mom_id=v_mom_id;

  insert into public.mom_discussion_points(id,mom_id,area_department,observation_issue,management_direction,priority,sort_order)
  select (x->>'id')::uuid,v_mom_id,nullif(btrim(x->>'area_department'),''),btrim(x->>'observation_issue'),nullif(btrim(x->>'management_direction'),''),coalesce(nullif(x->>'priority',''),'Medium'),ord-1
  from jsonb_array_elements(coalesce(p_payload->'discussion_points','[]'::jsonb)) with ordinality t(x,ord)
  where nullif(btrim(x->>'observation_issue'),'') is not null;
  insert into public.mom_action_items(id,mom_id,discussion_point_id,issue_observation,corrective_action,responsible_person,responsible_team,target_date,status,remarks,completed_at,verified_at,sort_order)
  select (x->>'id')::uuid,v_mom_id,nullif(x->>'discussion_point_id','')::uuid,btrim(x->>'issue_observation'),btrim(x->>'corrective_action'),nullif(btrim(x->>'responsible_person'),''),nullif(btrim(x->>'responsible_team'),''),nullif(x->>'target_date','')::date,coalesce(nullif(x->>'status',''),'Open'),nullif(btrim(x->>'remarks'),''),
    case when x->>'status' in ('Completed','Verified','Closed') then coalesce(nullif(x->>'completed_at','')::timestamptz,nullif(v_action_timestamps->(x->>'id')->>'completed_at','')::timestamptz,v_now) end,
    case when x->>'status' in ('Verified','Closed') then coalesce(nullif(x->>'verified_at','')::timestamptz,nullif(v_action_timestamps->(x->>'id')->>'verified_at','')::timestamptz,v_now) end,ord-1
  from jsonb_array_elements(coalesce(p_payload->'action_items','[]'::jsonb)) with ordinality t(x,ord)
  where nullif(btrim(x->>'issue_observation'),'') is not null and nullif(btrim(x->>'corrective_action'),'') is not null;
  insert into public.mom_management_concerns(id,mom_id,concern_text,sort_order)
  select (x->>'id')::uuid,v_mom_id,btrim(x->>'text'),ord-1 from jsonb_array_elements(coalesce(p_payload->'concerns','[]'::jsonb)) with ordinality t(x,ord) where nullif(btrim(x->>'text'),'') is not null;
  insert into public.mom_appreciations(id,mom_id,appreciation_text,sort_order)
  select (x->>'id')::uuid,v_mom_id,btrim(x->>'text'),ord-1 from jsonb_array_elements(coalesce(p_payload->'appreciations','[]'::jsonb)) with ordinality t(x,ord) where nullif(btrim(x->>'text'),'') is not null;
  return v_mom_id;
end;
$$;
revoke all on function public.rpc_save_visit_mom(uuid,jsonb,boolean) from public, anon, authenticated;
grant execute on function public.rpc_save_visit_mom(uuid,jsonb,boolean) to service_role;

commit;
