-- Tender maker-checker workflow. Forward-only; applying this migration does
-- not update existing profiles, hierarchy rows, or business records.
begin;

alter table public.profiles drop constraint if exists profiles_role_check;
alter table public.profiles add constraint profiles_role_check check (role in (
  'Admin','QPMS Admin','Developer','Dev','IT Admin','Management IT Admin','Management',
  'MD','COO','Executive Assistant','GM','General Manager','South Head','Business Head',
  'Branch Head','Operations Manager','Manager','KAM','FO','Field Officer','Supervisor',
  'Business Development Executive','Business Development Head','BD Executive','BD Head',
  'Pre-Sales','Pre-Sales Executive','Pre-Sales Manager','Tender',
  'Hospital Management','RMO','Doctor','Operations Team','Coordinator','Commercial',
  'Commercial Team','Commercial Reviewer','Finance','Finance Team','Finance Reviewer',
  'HR Reviewer','HR','HR GM','Finance GM','CFO','DEMO_VIEWER'
)) not valid;

insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
values('tender-workbooks','tender-workbooks',false,26214400,array[
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
]) on conflict(id) do update set public=false,
  file_size_limit=excluded.file_size_limit, allowed_mime_types=excluded.allowed_mime_types;

create table public.tender_packages (
  id uuid primary key default gen_random_uuid(),
  workflow_instance_id uuid not null unique references public.workflow_instances(id) on delete cascade,
  lead_id uuid not null references public.leads(id) on delete restrict,
  site_visit_id uuid not null references public.site_visits(id) on delete restrict,
  assessment_id uuid not null references public.site_assessments(id) on delete restrict,
  assigned_tender_profile_id uuid references public.profiles(id) on delete restrict,
  assigned_bd_profile_id uuid references public.profiles(id) on delete set null,
  status text not null default 'Waiting for Tender Assignment' check(status in (
    'Waiting for Tender Assignment','In Preparation','Rework','Approval Pending',
    'CFO Approval','COO Approval','Proposal Ready','Completed'
  )),
  pending_with text not null default 'Tender',
  current_version integer not null default 0 check(current_version >= 0),
  approval_version_id uuid,
  rework_count integer not null default 0 check(rework_count >= 0),
  claimed_at timestamptz,
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.tender_versions (
  id uuid primary key default gen_random_uuid(),
  tender_package_id uuid not null references public.tender_packages(id) on delete cascade,
  version_number integer not null check(version_number >= 1),
  storage_bucket text not null default 'tender-workbooks' check(storage_bucket='tender-workbooks'),
  storage_path text not null unique,
  original_filename text not null check(original_filename ~* '\.xlsx$'),
  mime_type text not null check(mime_type='application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'),
  file_size bigint check(file_size is null or file_size between 1 and 26214400),
  notes text,
  status text not null default 'Draft' check(status in ('Draft','Submitted','Rework','Approval Version','Superseded')),
  uploaded_by_profile_id uuid not null references public.profiles(id) on delete restrict,
  uploaded_at timestamptz not null default now(),
  submitted_at timestamptz,
  unique(tender_package_id,version_number)
);
alter table public.tender_packages add constraint tender_packages_approval_version_fk
  foreign key(approval_version_id) references public.tender_versions(id) on delete restrict;

create table public.tender_reviews (
  id uuid primary key default gen_random_uuid(),
  tender_package_id uuid not null references public.tender_packages(id) on delete cascade,
  tender_version_id uuid not null references public.tender_versions(id) on delete restrict,
  approval_cycle integer not null check(approval_cycle >= 1),
  reviewer_role text not null check(reviewer_role in ('HR','Commercial','Finance','CFO','COO')),
  assigned_reviewer_profile_id uuid references public.profiles(id) on delete set null,
  status text not null default 'Pending' check(status in ('Pending','Approved','Rework','Cancelled')),
  remarks text,
  decided_by_profile_id uuid references public.profiles(id) on delete set null,
  requested_at timestamptz not null default now(),
  decided_at timestamptz,
  unique(tender_version_id,reviewer_role)
);

create table public.tender_events (
  id uuid primary key default gen_random_uuid(),
  tender_package_id uuid not null references public.tender_packages(id) on delete cascade,
  tender_version_id uuid references public.tender_versions(id) on delete set null,
  lead_id uuid not null references public.leads(id) on delete restrict,
  actor_profile_id uuid not null references public.profiles(id) on delete restrict,
  actor_role text not null,
  action text not null,
  from_status text,
  to_status text,
  remarks text,
  admin_override boolean not null default false,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create table public.tender_idempotency (
  idempotency_key text primary key,
  operation text not null,
  actor_profile_id uuid not null references public.profiles(id) on delete restrict,
  response_payload jsonb not null,
  created_at timestamptz not null default now()
);

create index tender_packages_owner_status_idx on public.tender_packages(assigned_tender_profile_id,status);
create index tender_packages_status_idx on public.tender_packages(status,updated_at desc);
create index tender_versions_package_idx on public.tender_versions(tender_package_id,version_number desc);
create index tender_reviews_queue_idx on public.tender_reviews(reviewer_role,status,requested_at);
create index tender_events_package_idx on public.tender_events(tender_package_id,created_at);

alter table public.tender_packages enable row level security;
alter table public.tender_versions enable row level security;
alter table public.tender_reviews enable row level security;
alter table public.tender_events enable row level security;
alter table public.tender_idempotency enable row level security;
revoke all on public.tender_packages,public.tender_versions,public.tender_reviews,public.tender_events,public.tender_idempotency from anon,authenticated;
grant all on public.tender_packages,public.tender_versions,public.tender_reviews,public.tender_events,public.tender_idempotency to service_role;

create or replace function public.tender_role_key(p_role text) returns text language sql immutable
set search_path=pg_catalog as $$ select upper(regexp_replace(btrim(coalesce(p_role,'')),'[^A-Za-z0-9]+','','g')) $$;

create or replace function public.tender_is_admin(p_role text) returns boolean language sql immutable
set search_path=pg_catalog as $$ select public.tender_role_key(p_role) in ('ADMIN','QPMSADMIN','DEVELOPER','DEV','ITADMIN','MANAGEMENTITADMIN') $$;

create or replace function public.tender_emit(p_lead uuid,p_recipient uuid,p_type text,p_title text,p_message text,p_key text,p_meta jsonb default '{}'::jsonb)
returns void language plpgsql security definer set search_path=pg_catalog,public as $$ begin
  if p_recipient is not null then
    perform public.opportunity_notify(p_lead,p_recipient,p_type,p_title,p_message,'/tender',p_key,p_meta);
  end if;
end $$;

create or replace function public.tender_review_role_key(p_role text) returns text language sql immutable
set search_path=pg_catalog as $$
  select case public.tender_role_key(p_role)
    when 'HRREVIEWER' then 'HR' when 'HRGM' then 'HR'
    when 'COMMERCIALTEAM' then 'COMMERCIAL' when 'COMMERCIALREVIEWER' then 'COMMERCIAL'
    when 'FINANCETEAM' then 'FINANCE' when 'FINANCEREVIEWER' then 'FINANCE' when 'FINANCEGM' then 'FINANCE'
    else public.tender_role_key(p_role)
  end
$$;

create or replace function public.tender_require_idempotency(p_key text,p_operation text,p_actor uuid)
returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $$ declare v_row public.tender_idempotency%rowtype; begin
  if nullif(btrim(p_key),'') is null then raise exception 'idempotency_key_required' using errcode='22023'; end if;
  select * into v_row from public.tender_idempotency where idempotency_key=p_key;
  if v_row.idempotency_key is null then return null; end if;
  if v_row.operation<>p_operation or v_row.actor_profile_id<>p_actor then raise exception 'idempotency_key_conflict' using errcode='22023'; end if;
  return v_row.response_payload;
end $$;

create or replace function public.create_tender_package_for_assessment() returns trigger language plpgsql security definer
set search_path=pg_catalog,public as $$ declare v_w public.workflow_instances%rowtype; v_p public.tender_packages%rowtype; v_bd uuid; v_r record; begin
  if new.assessment_status <> 'Submitted' or old.assessment_status is not distinct from new.assessment_status then return new; end if;
  select * into v_w from public.workflow_instances where assessment_id=new.id;
  if v_w.id is null then return new; end if;
  select lh.to_profile_id into v_bd from public.lead_handoffs lh where lh.lead_id=v_w.lead_id and lh.handoff_status='accepted' order by lh.accepted_at desc nulls last limit 1;
  insert into public.tender_packages(workflow_instance_id,lead_id,site_visit_id,assessment_id,assigned_bd_profile_id)
  values(v_w.id,v_w.lead_id,v_w.site_visit_id,v_w.assessment_id,v_bd)
  on conflict(workflow_instance_id) do nothing returning * into v_p;
  if v_p.id is not null then
    update public.workflow_instances set current_stage_code='tender_queue',pending_role='Tender',approval_status='Waiting for Tender Assignment',version=version+1,updated_at=now() where id=v_w.id;
    update public.site_visits set current_stage='Tender Queue',pending_with='Tender',status='Waiting for Tender Assignment',updated_at=now() where id=v_w.site_visit_id;
    for v_r in select id from public.profiles where role='Tender' and is_active=true and lower(coalesce(status,''))='active' and auth_user_id is not null loop
      perform public.tender_emit(v_w.lead_id,v_r.id,'tender_queue','New Tender task available','A completed Site Survey is waiting to be claimed.','tender-queue-'||v_p.id||'-'||v_r.id,jsonb_build_object('tender_package_id',v_p.id));
    end loop;
  end if;
  return new;
end $$;
drop trigger if exists trg_create_tender_package on public.site_assessments;
create constraint trigger trg_create_tender_package after update on public.site_assessments
deferrable initially deferred for each row execute function public.create_tender_package_for_assessment();

create or replace function public.complete_tender_package_for_lead() returns trigger language plpgsql security definer
set search_path=pg_catalog,public as $$ begin
  if new.status in ('Converted','Lost') and new.status is distinct from old.status then
    update public.tender_packages set status='Completed',pending_with=new.status,completed_at=now(),updated_at=now()
    where lead_id=new.id and status='Proposal Ready';
  end if;
  return new;
end $$;
drop trigger if exists trg_complete_tender_package on public.leads;
create trigger trg_complete_tender_package after update of status on public.leads
for each row execute function public.complete_tender_package_for_lead();

create or replace function public.rpc_claim_tender_task(p_package_id uuid,p_actor jsonb,p_idempotency_key text)
returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $$ declare v_p public.tender_packages%rowtype; v_role text:=public.tender_role_key(p_actor->>'role'); v_actor uuid:=(p_actor->>'profile_id')::uuid; v_out jsonb; begin
  v_out:=public.tender_require_idempotency(p_idempotency_key,'claim',v_actor); if v_out is not null then return v_out; end if;
  if v_role <> 'TENDER' and not public.tender_is_admin(p_actor->>'role') then raise exception 'tender_role_required' using errcode='42501'; end if;
  if not public.tender_is_admin(p_actor->>'role') and not exists(select 1 from public.profiles where id=v_actor and role='Tender' and is_active=true and lower(coalesce(status,''))='active' and auth_user_id is not null) then raise exception 'tender_actor_inactive' using errcode='42501'; end if;
  select * into strict v_p from public.tender_packages where id=p_package_id for update;
  if v_p.assigned_tender_profile_id is not null and v_p.assigned_tender_profile_id<>v_actor and not public.tender_is_admin(p_actor->>'role') then raise exception 'tender_task_already_claimed' using errcode='42501'; end if;
  if v_p.status<>'Waiting for Tender Assignment' then raise exception 'invalid_tender_stage' using errcode='22023'; end if;
  update public.tender_packages set assigned_tender_profile_id=v_actor,status='In Preparation',pending_with='Tender',claimed_at=now(),updated_at=now() where id=v_p.id returning * into v_p;
  insert into public.tender_events(tender_package_id,lead_id,actor_profile_id,actor_role,action,from_status,to_status,admin_override) values(v_p.id,v_p.lead_id,v_actor,p_actor->>'role','CLAIM','Waiting for Tender Assignment','In Preparation',public.tender_is_admin(p_actor->>'role'));
  perform public.tender_emit(v_p.lead_id,v_actor,'tender_claimed','Tender task claimed','This Tender task is now assigned to you.','tender-claimed-'||v_p.id,jsonb_build_object('tender_package_id',v_p.id));
  v_out:=to_jsonb(v_p); insert into public.tender_idempotency values(p_idempotency_key,'claim',v_actor,v_out,now()); return v_out;
end $$;

create or replace function public.rpc_reserve_tender_version(p_package_id uuid,p_actor jsonb,p_filename text,p_mime text,p_notes text,p_idempotency_key text)
returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $$ declare v_p public.tender_packages%rowtype; v_v public.tender_versions%rowtype; v_actor uuid:=(p_actor->>'profile_id')::uuid; v_n int; v_out jsonb; begin
  v_out:=public.tender_require_idempotency(p_idempotency_key,'reserve-version',v_actor); if v_out is not null then return v_out; end if;
  if p_filename !~* '\.xlsx$' or p_mime<>'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' then raise exception 'invalid_tender_workbook_type' using errcode='22023'; end if;
  select * into strict v_p from public.tender_packages where id=p_package_id for update;
  if v_p.assigned_tender_profile_id<>v_actor and not public.tender_is_admin(p_actor->>'role') then raise exception 'tender_owner_required' using errcode='42501'; end if;
  if v_p.status not in ('In Preparation','Rework') then raise exception 'invalid_tender_stage' using errcode='22023'; end if;
  v_n:=v_p.current_version+1;
  insert into public.tender_versions(tender_package_id,version_number,storage_path,original_filename,mime_type,notes,uploaded_by_profile_id)
  values(v_p.id,v_n,v_p.id||'/v'||v_n||'/'||gen_random_uuid()||'.xlsx',p_filename,p_mime,nullif(btrim(p_notes),''),v_actor) returning * into v_v;
  update public.tender_packages set current_version=v_n,status='In Preparation',updated_at=now() where id=v_p.id;
  insert into public.tender_events(tender_package_id,tender_version_id,lead_id,actor_profile_id,actor_role,action,from_status,to_status,remarks,admin_override,metadata) values(v_p.id,v_v.id,v_p.lead_id,v_actor,p_actor->>'role','UPLOAD_VERSION',v_p.status,'In Preparation',p_notes,public.tender_is_admin(p_actor->>'role'),jsonb_build_object('version',v_n));
  v_out:=to_jsonb(v_v); insert into public.tender_idempotency values(p_idempotency_key,'reserve-version',v_actor,v_out,now()); return v_out;
end $$;

create or replace function public.rpc_submit_tender_version(p_package_id uuid,p_version_id uuid,p_actor jsonb,p_file_size bigint,p_idempotency_key text)
returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $$ declare v_p public.tender_packages%rowtype; v_v public.tender_versions%rowtype; v_actor uuid:=(p_actor->>'profile_id')::uuid; v_cycle int; v_role text; v_rec uuid; v_out jsonb; begin
  v_out:=public.tender_require_idempotency(p_idempotency_key,'submit-version',v_actor); if v_out is not null then return v_out; end if;
  select * into strict v_p from public.tender_packages where id=p_package_id for update;
  select * into strict v_v from public.tender_versions where id=p_version_id and tender_package_id=v_p.id for update;
  if v_p.assigned_tender_profile_id<>v_actor and not public.tender_is_admin(p_actor->>'role') then raise exception 'tender_owner_required' using errcode='42501'; end if;
  if v_p.status not in ('In Preparation','Rework') or v_v.status<>'Draft' then raise exception 'invalid_tender_stage' using errcode='22023'; end if;
  if p_file_size is null or p_file_size not between 1 and 26214400 then raise exception 'invalid_tender_workbook_size' using errcode='22023'; end if;
  update public.tender_versions set status='Approval Version',file_size=p_file_size,submitted_at=now() where id=v_v.id;
  update public.tender_versions set status='Superseded' where tender_package_id=v_p.id and id<>v_v.id and status in ('Submitted','Approval Version');
  select coalesce(max(approval_cycle),0)+1 into v_cycle from public.tender_reviews where tender_package_id=v_p.id;
  foreach v_role in array array['HR','Commercial','Finance'] loop
    select id into v_rec from public.profiles where is_active=true and lower(coalesce(status,''))='active' and auth_user_id is not null and case v_role when 'HR' then role in ('HR','HR Reviewer','HR GM') when 'Commercial' then role in ('Commercial','Commercial Team','Commercial Reviewer') else role in ('Finance','Finance Team','Finance Reviewer','Finance GM') end order by full_name limit 1;
    insert into public.tender_reviews(tender_package_id,tender_version_id,approval_cycle,reviewer_role,assigned_reviewer_profile_id) values(v_p.id,v_v.id,v_cycle,v_role,v_rec);
    if v_rec is not null then perform public.tender_emit(v_p.lead_id,v_rec,'tender_approval','Tender approval required','Tender workbook V'||v_v.version_number||' is waiting for '||v_role||' review.','tender-review-'||v_v.id||'-'||v_role,jsonb_build_object('tender_package_id',v_p.id,'version',v_v.version_number)); end if;
  end loop;
  update public.tender_packages set status='Approval Pending',pending_with='HR + Commercial + Finance',approval_version_id=v_v.id,updated_at=now() where id=v_p.id returning * into v_p;
  update public.workflow_instances set current_stage_code='tender_parallel_approval',pending_role='HR + Commercial + Finance',approval_status='Pending',version=version+1,updated_at=now() where id=v_p.workflow_instance_id;
  insert into public.tender_events(tender_package_id,tender_version_id,lead_id,actor_profile_id,actor_role,action,from_status,to_status,admin_override,metadata) values(v_p.id,v_v.id,v_p.lead_id,v_actor,p_actor->>'role','SUBMIT_FOR_APPROVAL','In Preparation','Approval Pending',public.tender_is_admin(p_actor->>'role'),jsonb_build_object('version',v_v.version_number,'cycle',v_cycle));
  v_out:=jsonb_build_object('package',to_jsonb(v_p),'version',to_jsonb(v_v)); insert into public.tender_idempotency values(p_idempotency_key,'submit-version',v_actor,v_out,now()); return v_out;
end $$;

create or replace function public.rpc_decide_tender_review(p_review_id uuid,p_decision text,p_remarks text,p_actor jsonb,p_idempotency_key text)
returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $$ declare v_r public.tender_reviews%rowtype; v_p public.tender_packages%rowtype; v_actor uuid:=(p_actor->>'profile_id')::uuid; v_dec text:=upper(btrim(p_decision)); v_required text; v_next text; v_rec uuid; v_out jsonb; begin
  v_out:=public.tender_require_idempotency(p_idempotency_key,'review-decision',v_actor); if v_out is not null then return v_out; end if;
  select * into strict v_r from public.tender_reviews where id=p_review_id for update; select * into strict v_p from public.tender_packages where id=v_r.tender_package_id for update;
  v_required:=public.tender_role_key(v_r.reviewer_role);
  if not public.tender_is_admin(p_actor->>'role') and (public.tender_review_role_key(p_actor->>'role')<>v_required or v_r.assigned_reviewer_profile_id is distinct from v_actor) then raise exception 'tender_reviewer_denied' using errcode='42501'; end if;
  if v_r.status<>'Pending' or v_p.approval_version_id<>v_r.tender_version_id then raise exception 'invalid_tender_stage' using errcode='22023'; end if;
  if v_dec not in ('APPROVE','REWORK') then raise exception 'invalid_tender_decision' using errcode='22023'; end if;
  if v_dec='REWORK' and nullif(btrim(p_remarks),'') is null then raise exception 'rework_remarks_required' using errcode='22023'; end if;
  update public.tender_reviews set status=case when v_dec='APPROVE' then 'Approved' else 'Rework' end,remarks=nullif(btrim(p_remarks),''),decided_by_profile_id=v_actor,decided_at=now() where id=v_r.id;
  if v_dec='REWORK' then
    update public.tender_reviews set status='Cancelled',decided_at=now() where tender_version_id=v_r.tender_version_id and status='Pending';
    update public.tender_versions set status='Rework' where id=v_r.tender_version_id;
    update public.tender_packages set status='Rework',pending_with='Tender',rework_count=rework_count+1,updated_at=now() where id=v_p.id returning * into v_p;
    update public.workflow_instances set current_stage_code='tender_rework',pending_role='Tender',approval_status='Rework',version=version+1,updated_at=now() where id=v_p.workflow_instance_id;
    perform public.tender_emit(v_p.lead_id,v_p.assigned_tender_profile_id,'tender_rework','Tender rework required',v_r.reviewer_role||': '||p_remarks,'tender-rework-'||v_r.id,jsonb_build_object('tender_package_id',v_p.id,'reviewer_role',v_r.reviewer_role));
    v_next:='Rework';
  elsif v_r.reviewer_role in ('HR','Commercial','Finance') and not exists(select 1 from public.tender_reviews where tender_version_id=v_r.tender_version_id and reviewer_role in ('HR','Commercial','Finance') and status<>'Approved') then
    select id into v_rec from public.profiles where role='CFO' and is_active=true and lower(coalesce(status,''))='active' and auth_user_id is not null order by full_name limit 1;
    insert into public.tender_reviews(tender_package_id,tender_version_id,approval_cycle,reviewer_role,assigned_reviewer_profile_id) values(v_p.id,v_r.tender_version_id,v_r.approval_cycle,'CFO',v_rec);
    update public.tender_packages set status='CFO Approval',pending_with='CFO',updated_at=now() where id=v_p.id; v_next:='CFO Approval';
    update public.workflow_instances set current_stage_code='tender_cfo_approval',pending_role='CFO',approval_status='Pending',version=version+1,updated_at=now() where id=v_p.workflow_instance_id;
    perform public.tender_emit(v_p.lead_id,v_rec,'tender_cfo_approval','Tender CFO approval required','All parallel reviews are approved. CFO approval is required.','tender-cfo-'||v_r.tender_version_id,jsonb_build_object('tender_package_id',v_p.id));
  elsif v_r.reviewer_role='CFO' then
    select id into v_rec from public.profiles where role='COO' and is_active=true and lower(coalesce(status,''))='active' and auth_user_id is not null order by full_name limit 1;
    insert into public.tender_reviews(tender_package_id,tender_version_id,approval_cycle,reviewer_role,assigned_reviewer_profile_id) values(v_p.id,v_r.tender_version_id,v_r.approval_cycle,'COO',v_rec);
    update public.tender_packages set status='COO Approval',pending_with='COO',updated_at=now() where id=v_p.id; v_next:='COO Approval';
    update public.workflow_instances set current_stage_code='tender_coo_approval',pending_role='COO',approval_status='Pending',version=version+1,updated_at=now() where id=v_p.workflow_instance_id;
    perform public.tender_emit(v_p.lead_id,v_rec,'tender_coo_approval','Tender COO approval required','CFO approved the Tender package. COO approval is required.','tender-coo-'||v_r.tender_version_id,jsonb_build_object('tender_package_id',v_p.id));
  elsif v_r.reviewer_role='COO' then
    update public.tender_packages set status='Proposal Ready',pending_with='Business Development',updated_at=now() where id=v_p.id; v_next:='Proposal Ready';
    update public.workflow_instances set current_stage_code='proposal',pending_role='BD Executive',approval_status='Proposal Ready',version=version+1,updated_at=now() where id=v_p.workflow_instance_id;
    perform public.tender_emit(v_p.lead_id,v_p.assigned_bd_profile_id,'proposal_ready','Proposal ready','Tender approvals are complete. Prepare the client proposal.','tender-proposal-'||v_p.id,jsonb_build_object('tender_package_id',v_p.id));
  else v_next:=v_p.status; end if;
  insert into public.tender_events(tender_package_id,tender_version_id,lead_id,actor_profile_id,actor_role,action,from_status,to_status,remarks,admin_override,metadata) values(v_p.id,v_r.tender_version_id,v_p.lead_id,v_actor,p_actor->>'role',v_dec,v_p.status,v_next,p_remarks,public.tender_is_admin(p_actor->>'role'),jsonb_build_object('reviewer_role',v_r.reviewer_role,'cycle',v_r.approval_cycle));
  v_out:=jsonb_build_object('status',v_next,'decision',v_dec); insert into public.tender_idempotency values(p_idempotency_key,'review-decision',v_actor,v_out,now()); return v_out;
end $$;

revoke all on function public.tender_role_key(text),public.tender_is_admin(text),public.tender_review_role_key(text),public.tender_require_idempotency(text,text,uuid),public.tender_emit(uuid,uuid,text,text,text,text,jsonb),public.complete_tender_package_for_lead(),public.rpc_claim_tender_task(uuid,jsonb,text),public.rpc_reserve_tender_version(uuid,jsonb,text,text,text,text),public.rpc_submit_tender_version(uuid,uuid,jsonb,bigint,text),public.rpc_decide_tender_review(uuid,text,text,jsonb,text) from public,anon,authenticated;
grant execute on function public.rpc_claim_tender_task(uuid,jsonb,text),public.rpc_reserve_tender_version(uuid,jsonb,text,text,text,text),public.rpc_submit_tender_version(uuid,uuid,jsonb,bigint,text),public.rpc_decide_tender_review(uuid,text,text,jsonb,text) to service_role;
commit;
