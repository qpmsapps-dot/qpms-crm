-- PREPARED ONLY. Explicit production authorization and owner-level preflight required.
-- Extends the installed provisional schema; no source rows, employee grants or canonical values seeded.
begin;
alter table public.retail_provisional_access add column permission text not null default 'viewer' check(permission in ('viewer','editor','reviewer'));
alter table public.retail_provisional_files add column source_sheets jsonb,add column import_receipt jsonb,add column source_format text;
alter table public.retail_provisional_proposals add column kind text not null default 'identity' check(kind in ('identity','zone','store_zone','zone_fo','HK','MEPC','DC_SCHEDULE')),
 add column target_store uuid references public.reliance_retail_store_master(id),add column target_zone uuid references public.reliance_retail_zones(id),add column state text,add column baseline jsonb;
alter table public.retail_provisional_proposals alter column row_id drop not null;
create table public.retail_unified_epoch(singleton boolean primary key default true check(singleton),observed_at timestamptz not null,store_zones jsonb not null);
insert into public.retail_unified_epoch(observed_at,store_zones) select clock_timestamp(),coalesce(jsonb_object_agg(id::text,jsonb_build_object('zone_id',zone_id)),'{}') from public.reliance_retail_store_master;
create unique index retail_store_zone_one_event on public.reliance_retail_store_zone_history(retail_store_id,changed_at);
-- Existing activity records stay untouched. This missing planning relation is empty on installation.
create table if not exists public.client_deep_cleaning_schedules(
 id uuid primary key default gen_random_uuid(),retail_store_id uuid not null references public.reliance_retail_store_master(id) on delete restrict,
 scheduled_date date not null,assigned_fo_profile_id uuid references public.profiles(id),status text not null default 'Planned' check(status in ('Planned','Completed','Not Done','Cancelled')),
 not_done_reason text,completed_at timestamptz,source_type text not null default 'UNIFIED_REVIEW',source_reference text unique,
 created_by_profile_id uuid not null references public.profiles(id),metadata jsonb not null default '{}',created_at timestamptz not null default now(),updated_at timestamptz not null default now(),
 unique(retail_store_id,scheduled_date)
);
alter table public.client_deep_cleaning_schedules enable row level security;
revoke all on public.client_deep_cleaning_schedules from public,anon,authenticated,service_role;

-- Independent approved HK/MEPC records remain in the existing authoritative AOP relation.
alter table public.retail_attendance_aop_versions alter column hk_count drop not null,alter column mepc_count drop not null,
 add column aop_class text check(aop_class in ('HK','MEPC')),add column components jsonb,add column approval_ref text,add column calculation_ref text,add column proposal_id uuid references public.retail_provisional_proposals(id);
alter table public.retail_attendance_aop_versions add constraint retail_aop_class_values check(
 (aop_class is null and hk_count is not null and mepc_count is not null) or
 (aop_class='HK' and hk_count is not null and mepc_count is null) or
 (aop_class='MEPC' and mepc_count is not null and hk_count is null));
create or replace function public.retail_attendance_aop_no_overlap() returns trigger
language plpgsql set search_path=public,pg_temp as $$
begin
 perform pg_advisory_xact_lock(hashtextextended('retail_uploaded_attendance',0));
 if new.superseded_at is null and exists(select 1 from public.retail_attendance_aop_versions a where a.retail_store_id=new.retail_store_id and a.id<>new.id and a.superseded_at is null
 and (a.aop_class is null or new.aop_class is null or a.aop_class=new.aop_class)
 and daterange(a.effective_from,a.effective_to,'[]') && daterange(new.effective_from,new.effective_to,'[]')) then raise exception 'Overlapping approved AOP periods'; end if;
 return new;
end; $$;

create function public.retail_unified_access(p_actor uuid,p_state text,p_action text) returns boolean
language sql stable security definer set search_path=pg_catalog,public as $$
 select exists(
  select 1 from public.profiles p where p.id=p_actor and p.is_active is true and upper(coalesce(p.status,'Active'))='ACTIVE'
  and (
   regexp_replace(upper(coalesce(p.role,'')),'[^A-Z0-9]','','g') in ('ADMIN','QPMSADMIN')
   or (
    regexp_replace(upper(coalesce(p.business,'')),'[^A-Z0-9]','','g') in ('RELIANCE','RELIANCERETAIL')
    and exists(
     select 1 from public.retail_provisional_access a where a.actor_id=p.id and (p_state is null or a.state=p_state)
     and (p_action='view' or (p_action='edit' and a.permission in ('editor','reviewer')) or (p_action='review' and a.permission='reviewer'))
    )
   )
  )
 );
$$;
create function public.retail_unified_owner(p_store uuid,p_at timestamptz) returns jsonb
language plpgsql stable security definer set search_path=pg_catalog,public as $$
declare e public.retail_unified_epoch%rowtype; z uuid; f public.reliance_retail_zone_fo_assignments%rowtype; h public.reliance_retail_store_zone_history%rowtype;
begin
 select * into e from public.retail_unified_epoch;
 if p_at<e.observed_at then return jsonb_build_object('known',false,'zone_id',null,'fo_profile_id',null,'reason','Historical zone ownership predates observed baseline'); end if;
 z:=(e.store_zones->p_store::text->>'zone_id')::uuid;
 select * into h from public.reliance_retail_store_zone_history where retail_store_id=p_store and changed_at<=p_at order by changed_at desc,id desc limit 1;
 if found then z:=h.new_zone_id; end if;
 select * into f from public.reliance_retail_zone_fo_assignments where zone_id=z and effective_from<=p_at and (effective_to is null or p_at<effective_to) order by effective_from desc limit 1;
 return jsonb_build_object('known',true,'zone_id',z,'fo_profile_id',f.fo_profile_id,'fo_employee_code',f.fo_employee_code,'fo_effective_from',f.effective_from,'fo_effective_to',f.effective_to);
end; $$;
create function public.rpc_retail_unified_capability() returns boolean language sql stable security definer set search_path=pg_catalog,public as $$select true;$$;
create function public.retail_unified_fo_no_overlap() returns trigger
language plpgsql set search_path=pg_catalog,public as $$
begin
 perform pg_advisory_xact_lock(hashtextextended('retail_unified_ownership',0));
 if new.effective_to is not null and new.effective_to<=new.effective_from then raise exception 'FO interval must be nonempty'; end if;
 if exists(select 1 from public.reliance_retail_zone_fo_assignments a where a.zone_id=new.zone_id and a.id<>new.id and tstzrange(a.effective_from,a.effective_to,'[)') && tstzrange(new.effective_from,new.effective_to,'[)')) then raise exception 'Overlapping primary FO assignments'; end if;
 return new;
end; $$;
create trigger retail_unified_fo_intervals before insert or update on public.reliance_retail_zone_fo_assignments for each row execute function public.retail_unified_fo_no_overlap();
create function public.retail_unified_proposal_permissions() returns trigger
language plpgsql set search_path=pg_catalog,public as $$
declare scope text;
begin
 scope:=coalesce(new.state,(select source_state from public.retail_provisional_rows where id=new.row_id));
 if not public.retail_unified_access(new.proposed_by,scope,'edit') or new.status<>'PENDING' or new.decided_by is not null then raise exception using errcode='42501',message='State editor and pending unreviewed proposal required'; end if;
 if new.kind='identity' and new.changes ? 'state' and not public.retail_unified_access(new.proposed_by,new.changes->>'state','edit') then raise exception using errcode='42501',message='Proposed geography outside editor scope'; end if;
 return new;
end; $$;
create trigger retail_unified_proposal_scope before insert on public.retail_provisional_proposals for each row execute function public.retail_unified_proposal_permissions();
-- Keep the existing operational view as the current Store -> Zone -> FO authority.
-- Column order/types are preserved from the actual canonical relation.
do $$ declare cols text;begin
 select string_agg(case when attname='zone_id' then '(o.owner->>''zone_id'')::uuid as zone_id' else 's.'||quote_ident(attname) end,',' order by attnum) into cols
 from pg_attribute where attrelid='public.reliance_retail_store_master'::regclass and attnum>0 and not attisdropped;
 execute 'create or replace view public.reliance_retail_store_operational_ownership as select '||cols||',z.zone_code,z.zone_name,z.status as zone_status,(o.owner->>''fo_profile_id'')::uuid as current_responsible_fo_profile_id,o.owner->>''fo_employee_code'' as current_responsible_fo_employee_code,(o.owner->>''fo_effective_from'')::timestamptz as zone_fo_effective_from from public.reliance_retail_store_master s cross join lateral (select public.retail_unified_owner(s.id,now()) as owner) o left join public.reliance_retail_zones z on z.id=(o.owner->>''zone_id'')::uuid';
end; $$;
revoke all on public.reliance_retail_store_operational_ownership from public,anon,authenticated;
grant select on public.reliance_retail_store_operational_ownership to service_role;

create function public.rpc_retail_unified_snapshot(p_actor uuid,p_from date,p_to date) returns jsonb
language plpgsql security definer set search_path=pg_catalog,public as $$
declare stores jsonb; rows jsonb; files jsonb; proposals jsonb; zones jsonb; fos jsonb; permissions jsonb; attendance jsonb; aop jsonb; dc jsonb; training jsonb; images jsonb; schedules jsonb; events jsonb; assignments jsonb; histories jsonb; stamp text; admin boolean;
begin
 if not public.retail_unified_access(p_actor,null,'view') then raise exception using errcode='42501',message='Assigned Retail state permission required'; end if;
 if p_from is null or p_to is null or p_to<p_from or p_to-p_from>366 then raise exception 'Select a reporting range up to 366 days'; end if;
 admin:=public.retail_unified_access(p_actor,'__ALL__','view');
 select coalesce(jsonb_agg(jsonb_build_object('state',s,'permission','admin')),'[]') into permissions from unnest(array['TN','PY','KA','KL','TG','AP-1','AP-2']) s where admin;
 if not admin then select coalesce(jsonb_agg(jsonb_build_object('state',state,'permission',permission)),'[]') into permissions from public.retail_provisional_access where actor_id=p_actor; end if;
 select coalesce(jsonb_agg(to_jsonb(s)||jsonb_build_object('ownership',public.retail_unified_owner(s.id,now()),'observed_zone_id',(select store_zones->s.id::text->>'zone_id' from public.retail_unified_epoch)) order by s.store_code),'[]') into stores from public.reliance_retail_store_master s where public.retail_unified_access(p_actor,s.state,'view');
 select coalesce(jsonb_agg(to_jsonb(r)||jsonb_build_object('version',f.version,'filename',f.filename,'sha256',f.sha256,'withdrawn_at',f.withdrawn_at) order by r.source_state,r.source_row),'[]') into rows from public.retail_provisional_rows r join public.retail_provisional_files f on f.id=r.batch_id where public.retail_unified_access(p_actor,r.source_state,'view');
 select coalesce(jsonb_agg(to_jsonb(f)-'original_base64'-'source_sheets' order by f.version desc),'[]') into files from public.retail_provisional_files f where admin or exists(select 1 from public.retail_provisional_rows r where r.batch_id=f.id and public.retail_unified_access(p_actor,r.source_state,'view'));
 select coalesce(jsonb_agg(to_jsonb(p) order by p.created_at desc),'[]') into proposals from public.retail_provisional_proposals p left join public.retail_provisional_rows r on r.id=p.row_id where public.retail_unified_access(p_actor,coalesce(p.state,r.source_state),'view');
 select coalesce(jsonb_agg(to_jsonb(z) order by z.state,z.zone_name),'[]') into zones from public.reliance_retail_zones z where public.retail_unified_access(p_actor,z.state,'view');
 select coalesce(jsonb_agg(jsonb_build_object('id',p.id,'employee_code',p.employee_code,'full_name',p.full_name,'contact',p.mobile,'state',p.state)),'[]') into fos from public.profiles p where p.is_active is true and upper(coalesce(p.status,'Active'))='ACTIVE' and regexp_replace(upper(coalesce(p.role,'')),'[^A-Z0-9]','','g') in ('FO','FIELDOFFICER') and regexp_replace(upper(coalesce(p.business,'')),'[^A-Z0-9]','','g') in ('RELIANCE','RELIANCERETAIL') and public.retail_unified_access(p_actor,case when p.state='KN' then 'KA' else p.state end,'view');
 select coalesce(jsonb_agg(to_jsonb(a)),'[]') into assignments from public.reliance_retail_zone_fo_assignments a join public.reliance_retail_zones z on z.id=a.zone_id where public.retail_unified_access(p_actor,z.state,'view');
 select coalesce(jsonb_agg(to_jsonb(h) order by h.changed_at),'[]') into histories from public.reliance_retail_store_zone_history h join public.reliance_retail_store_master s on s.id=h.retail_store_id where public.retail_unified_access(p_actor,s.state,'view');
 select coalesce(jsonb_agg(jsonb_build_object('retail_store_id',a.retail_store_id,'attendance_date',a.attendance_date,'class',a.class,'credit',a.credit,'ownership',public.retail_unified_owner(a.retail_store_id,(a.attendance_date::text||'T23:59:59+05:30')::timestamptz))),'[]') into attendance from public.retail_employee_daily_attendance a join public.reliance_retail_store_master s on s.id=a.retail_store_id where a.superseded_at is null and a.attendance_date between p_from and p_to and public.retail_unified_access(p_actor,s.state,'view');
 select coalesce(jsonb_agg(to_jsonb(a)),'[]') into aop from public.retail_attendance_aop_versions a join public.reliance_retail_store_master s on s.id=a.retail_store_id where a.superseded_at is null and a.effective_from<=p_to and (a.effective_to is null or a.effective_to>=p_from) and public.retail_unified_access(p_actor,s.state,'view');
 select coalesce(jsonb_agg(to_jsonb(d)||jsonb_build_object('ownership',public.retail_unified_owner(s.id,coalesce(d.submitted_at,d.created_at)))),'[]') into dc from public.client_deep_cleaning_submissions d join public.reliance_retail_store_master s on (d.retail_store_id=s.id or (d.retail_store_id is null and upper(btrim(d.store_code))=upper(btrim(s.store_code)))) where (d.retail_store_id is not null or regexp_replace(upper(coalesce(to_jsonb(d)->>'business','')),'[^A-Z0-9]','','g') in ('RELIANCE','RELIANCERETAIL')) and d.deep_cleaning_date between p_from and p_to and public.retail_unified_access(p_actor,s.state,'view');
 select coalesce(jsonb_agg(jsonb_build_object('submission_id',u.submission_id,'photo_type',u.upload_type,'uploaded',u.upload_status='uploaded')),'[]') into images from public.client_deep_cleaning_uploads u where exists(select 1 from jsonb_array_elements(dc) d where d->>'id'=u.submission_id::text);
 select coalesce(jsonb_agg(to_jsonb(t)||jsonb_build_object('ownership',public.retail_unified_owner(s.id,coalesce(t.submitted_at,t.created_at)))),'[]') into training from public.training_sessions t join public.reliance_retail_store_master s on (t.retail_store_id=s.id or (t.retail_store_id is null and upper(btrim(t.store_code_snapshot))=upper(btrim(s.store_code)))) where (t.retail_store_id is not null or regexp_replace(upper(coalesce(to_jsonb(t)->>'business_name_snapshot',to_jsonb(t)->>'business_code_snapshot','')),'[^A-Z0-9]','','g') in ('RELIANCE','RELIANCERETAIL')) and t.training_date between p_from and p_to and public.retail_unified_access(p_actor,s.state,'view');
 if to_regclass('public.client_deep_cleaning_schedules') is not null then
 execute 'select coalesce(jsonb_agg(to_jsonb(d)||jsonb_build_object(''ownership'',public.retail_unified_owner(s.id,(d.scheduled_date::text||''T23:59:59+05:30'')::timestamptz))),''[]'') from public.client_deep_cleaning_schedules d join public.reliance_retail_store_master s on s.id=d.retail_store_id where d.scheduled_date between $1 and $2 and public.retail_unified_access($3,s.state,''view'')' into schedules using p_from,p_to,p_actor;
 end if;
 select coalesce(jsonb_agg(to_jsonb(e) order by e.created_at desc),'[]') into events from public.reliance_retail_management_audit e where e.action like 'UNIFIED_%' and public.retail_unified_access(p_actor,e.after_state->>'state','view');
 stamp:=md5(stores::text||rows::text||files::text);
 return jsonb_build_object('actor_id',p_actor,'admin',admin,'permissions',permissions,'stores',stores,'rows',rows,'files',files,'proposals',proposals,'zones',zones,'fos',fos,'assignments',assignments,'store_zone_history',histories,'attendance',attendance,'aop',aop,'deep_cleaning',dc,'images',images,'schedules',schedules,'training',training,'events',events,'stamp',stamp,'from',p_from,'to',p_to,'epoch_at',(select observed_at from public.retail_unified_epoch));
end; $$;

create function public.rpc_retail_unified_stage(p_actor uuid,p_filename text,p_sha256 text,p_original text,p_rows jsonb,p_sheets jsonb,p_format text,p_stamp text,p_receipt jsonb) returns jsonb
language plpgsql security definer set search_path=pg_catalog,public as $$
declare b uuid; r jsonb; snap jsonb; n integer;
begin
 if not public.retail_unified_access(p_actor,null,'edit') then raise exception using errcode='42501',message='State editor required'; end if;
 if length(p_filename)>255 or p_sha256 !~ '^[a-f0-9]{64}$' or encode(sha256(decode(p_original,'base64')),'hex') is distinct from p_sha256 or length(p_original)>14000000 or jsonb_typeof(p_rows) is distinct from 'array' then raise exception 'Invalid immutable source evidence'; end if;
 n:=jsonb_array_length(p_rows);if n<1 or n>10000 then raise exception 'Invalid row count'; end if;
 perform pg_advisory_xact_lock(hashtextextended('retail_provisional_review',0));
 select id into b from public.retail_provisional_files where sha256=p_sha256;
 if found then
  if exists(select 1 from public.retail_provisional_rows where batch_id=b and not public.retail_unified_access(p_actor,source_state,'view')) then raise exception using errcode='42501',message='File contains unauthorized states'; end if;
  return jsonb_build_object('batch_id',b,'replayed',true,'receipt',coalesce((select import_receipt from public.retail_provisional_files where id=b),'{}')||jsonb_build_object('inserted',0,'staged_rows',0,'unchanged',(select count(*) from public.retail_provisional_rows where batch_id=b),'operational_writes',0));
 end if;
 snap:=public.rpc_retail_unified_snapshot(p_actor,current_date,current_date);
 if snap->>'stamp' is distinct from p_stamp then raise exception using errcode='40001',message='Master changed since preview; preview again'; end if;
 for r in select value from jsonb_array_elements(p_rows) loop
  if not public.retail_unified_access(p_actor,r->>'state','edit') then raise exception using errcode='42501',message='Every source state must be authorized; no rows were discarded'; end if;
  if r->>'row_digest' !~ '^[a-f0-9]{64}$' or jsonb_typeof(r->'raw') is distinct from 'object' then raise exception 'Invalid row provenance'; end if;
 end loop;
 p_receipt:=p_receipt||jsonb_build_object('inserted',n,'staged_rows',n,'operational_writes',0);
 insert into public.retail_provisional_files(filename,sha256,original_base64,uploaded_by,source_sheets,source_format,import_receipt) values(p_filename,p_sha256,p_original,p_actor,p_sheets,p_format,p_receipt) returning id into b;
 insert into public.retail_provisional_rows(batch_id,source_row,row_digest,source,store_code,source_state,review)
 select b,(item.value->>'source_row')::int,item.value->>'row_digest',item.value,item.value->>'store_code',item.value->>'state',item.value->'review' from jsonb_array_elements(p_rows) item;
 insert into public.retail_provisional_events(batch_id,actor_id,action,details) values(b,p_actor,'UNIFIED_UPLOAD',jsonb_build_object('sha256',p_sha256,'rows',n,'receipt',p_receipt));
 return jsonb_build_object('batch_id',b,'replayed',false,'receipt',p_receipt);
end; $$;

create function public.rpc_retail_unified_propose(p_actor uuid,p_kind text,p_state text,p_store uuid,p_zone uuid,p_row uuid,p_revision integer,p_changes jsonb,p_reason text) returns uuid
language plpgsql security definer set search_path=pg_catalog,public as $$
declare s public.reliance_retail_store_master%rowtype; z public.reliance_retail_zones%rowtype; r public.retail_provisional_rows%rowtype; proposal uuid; baseline jsonb;
begin
 if not public.retail_unified_access(p_actor,p_state,'edit') then raise exception using errcode='42501',message='State editor required'; end if;
 if p_kind not in ('identity','zone','store_zone','zone_fo','HK','MEPC','DC_SCHEDULE') or jsonb_typeof(p_changes) is distinct from 'object' or coalesce(length(btrim(p_reason)),0) not between 3 and 2000 then raise exception 'Change type, values and evidence reason required'; end if;
 perform pg_advisory_xact_lock(hashtextextended('retail_unified_ownership',0));
 if p_store is not null then select * into s from public.reliance_retail_store_master where id=p_store; if not found or s.state<>p_state then raise exception 'Store/state mismatch'; end if; end if;
 if p_zone is not null then select * into z from public.reliance_retail_zones where id=p_zone; if not found or z.state<>p_state then raise exception 'Zone/state mismatch'; end if; end if;
 if p_row is not null then
 select * into r from public.retail_provisional_rows where id=p_row;
 if not found or r.source_state<>p_state or r.revision is distinct from p_revision or exists(select 1 from public.retail_provisional_files where id=r.batch_id and withdrawn_at is not null) then raise exception using errcode='40001',message='Source changed or withdrawn'; end if;
 end if;
 if p_kind in ('HK','MEPC','store_zone','DC_SCHEDULE') and p_store is null then raise exception 'Verified canonical store required'; end if;
 if p_kind='zone_fo' and p_zone is null then raise exception 'Existing zone required'; end if;
 if p_kind='identity' and p_store is null and p_row is null then raise exception 'Create a pending source record first'; end if;
 if p_kind='identity' and p_changes ? 'state' and not public.retail_unified_access(p_actor,p_changes->>'state','edit') then raise exception using errcode='42501',message='Proposed geography is outside editor scope'; end if;
 if p_kind='identity' and p_changes ? 'state' and coalesce(p_changes->>'state','') not in ('TN','PY','KA','KL','TG','AP-1','AP-2') then raise exception 'Valid proposed geographic state required'; end if;
 baseline:=jsonb_build_object('store',case when p_store is not null then to_jsonb(s) else null end,'zone',case when p_zone is not null then to_jsonb(z) else null end,'row_revision',r.revision,'aop',(select coalesce(jsonb_agg(to_jsonb(a) order by a.id),'[]') from public.retail_attendance_aop_versions a where a.retail_store_id=p_store and a.superseded_at is null),
 'zone_fo',(select coalesce(jsonb_agg(to_jsonb(a) order by a.id),'[]') from public.reliance_retail_zone_fo_assignments a where a.zone_id=p_zone),
 'store_zone',(select coalesce(jsonb_agg(to_jsonb(h) order by h.id),'[]') from public.reliance_retail_store_zone_history h where h.retail_store_id=p_store));
 insert into public.retail_provisional_proposals(row_id,revision,changes,reason,proposed_by,kind,target_store,target_zone,state,baseline) values(p_row,coalesce(p_revision,0),p_changes,p_reason,p_actor,p_kind,p_store,p_zone,p_state,baseline) returning id into proposal;
 insert into public.reliance_retail_management_audit(action,entity_type,entity_id,actor_profile_id,after_state) values('UNIFIED_PROPOSE','proposal',proposal,p_actor,jsonb_build_object('state',p_state,'changes',p_changes,'kind',p_kind,'reason',p_reason));
 return proposal;
end; $$;
create function public.rpc_retail_unified_decide(p_actor uuid,p_proposal uuid,p_approve boolean,p_reason text) returns uuid
language plpgsql security definer set search_path=pg_catalog,public as $$
declare p public.retail_provisional_proposals%rowtype;
begin
 select * into p from public.retail_provisional_proposals where id=p_proposal for update;
 if not found or not public.retail_unified_access(p_actor,p.state,'review') then raise exception using errcode='42501',message='Authorized state reviewer required'; end if;
 if p.status<>'PENDING' or p_approve is null or coalesce(length(btrim(p_reason)),0) not between 3 and 2000 then raise exception 'Pending proposal and decision evidence required'; end if;
 if p.proposed_by=p_actor then raise exception using errcode='42501',message='Self approval/rejection is prohibited'; end if;
 if p.kind='identity' and p.changes ? 'state' and not public.retail_unified_access(p_actor,p.changes->>'state','review') then raise exception using errcode='42501',message='Proposed geography is outside reviewer scope'; end if;
 if p.row_id is not null and exists(select 1 from public.retail_provisional_rows r join public.retail_provisional_files pf on pf.id=r.batch_id where r.id=p.row_id and (r.revision<>p.revision or pf.withdrawn_at is not null)) then raise exception using errcode='40001',message='Source changed or withdrawn'; end if;
 update public.retail_provisional_proposals set status=case when p_approve then 'APPROVED' else 'REJECTED' end,decided_by=p_actor,decided_at=now(),decision_reason=p_reason where id=p.id;
 if p_approve and p.kind='identity' and p.target_store is null and p.row_id is not null then
 update public.retail_provisional_rows set review=review||coalesce((select jsonb_object_agg(key,value) from jsonb_each(p.changes) where value not in ('null'::jsonb,'""'::jsonb)),'{}'),revision=revision+1,
 verification_status=case when nullif(p.changes->>'store_name','') is not null and p.changes->>'operating_status' in ('Active','Inactive') then 'VERIFIED' else 'PENDING_VERIFICATION' end where id=p.row_id;
 end if;
 insert into public.reliance_retail_management_audit(action,entity_type,entity_id,actor_profile_id,after_state) values('UNIFIED_REVIEW','proposal',p.id,p_actor,jsonb_build_object('state',p.state,'approved',p_approve,'evidence',p_reason));
 return p.id;
end; $$;

create function public.rpc_retail_unified_apply(p_actor uuid,p_proposal uuid) returns jsonb
language plpgsql security definer set search_path=pg_catalog,public as $$
declare p public.retail_provisional_proposals%rowtype; c jsonb; s public.reliance_retail_store_master%rowtype; z public.reliance_retail_zones%rowtype; f public.profiles%rowtype; start_at timestamptz; end_at timestamptz; current_assignment public.reliance_retail_zone_fo_assignments%rowtype; previous_aop public.retail_attendance_aop_versions%rowtype; batch uuid; total numeric; receipt jsonb; zid uuid; dfrom date; dto date;
begin
 -- This operational boundary retains the existing strict active Admin requirement.
 perform public.retail_store_import_admin(p_actor);
 perform pg_advisory_xact_lock(hashtextextended('retail_unified_ownership',0));
 perform pg_advisory_xact_lock(hashtextextended('retail_uploaded_attendance',0));
 select * into p from public.retail_provisional_proposals where id=p_proposal for update;
 if not found or p.status<>'APPROVED' or p.decided_by=p.proposed_by or p.decided_by is null then raise exception 'Independent approved proposal required'; end if;
 select e.after_state into receipt from public.reliance_retail_management_audit e where e.entity_id=p.id and e.action='UNIFIED_APPLY' limit 1;
 if found then return receipt; end if;
 c:=p.changes;
 if p.target_store is not null then select * into s from public.reliance_retail_store_master where id=p.target_store for update; if to_jsonb(s) is distinct from p.baseline->'store' then raise exception using errcode='40001',message='Canonical store changed; propose again'; end if; end if;
 if p.target_zone is not null then select * into z from public.reliance_retail_zones where id=p.target_zone for update; if to_jsonb(z) is distinct from p.baseline->'zone' then raise exception using errcode='40001',message='Zone changed; propose again'; end if; end if;
 if p.row_id is not null and exists(select 1 from public.retail_provisional_rows r join public.retail_provisional_files pf on pf.id=r.batch_id where r.id=p.row_id and (r.revision<>p.revision or pf.withdrawn_at is not null)) then raise exception using errcode='40001',message='Source changed or withdrawn'; end if;
 if p.kind='identity' then
  if p.target_store is null then raise exception 'New identities must use the existing source-bound identity approval/activation function; staging review is not activation'; end if;
  if exists(select 1 from jsonb_object_keys(c) k where k not in ('store_name','city','store_format','area','district','address','pincode','opening_date','closing_date','operating_status','mis_remarks')) then raise exception 'Unsupported identity fields; codes, geography and GPS require separate verified maintenance'; end if;
  if c ? 'store_name' and nullif(btrim(c->>'store_name'),'') is null then raise exception 'Blank name cannot erase verified identity'; end if;
  if c ? 'operating_status' and c->>'operating_status' not in ('Active','Inactive') then raise exception 'Explicit Active or Inactive required'; end if;
  update public.reliance_retail_store_master set store_name=coalesce(nullif(btrim(c->>'store_name'),''),store_name),city=coalesce(nullif(btrim(c->>'city'),''),city),store_format=coalesce(nullif(btrim(c->>'store_format'),''),store_format),status=coalesce(c->>'operating_status',status),metadata=metadata||jsonb_build_object('unified_details',coalesce(metadata->'unified_details','{}')||jsonb_strip_nulls(c),'unified_approval',p.id),updated_at=now() where id=s.id;
 elsif p.kind='zone' then
  if nullif(btrim(c->>'zone_name'),'') is null or c->>'status' not in ('Active','Inactive') then raise exception 'Zone name and explicit status required'; end if;
  if p.target_zone is null then
   if nullif(btrim(c->>'zone_code'),'') is null then raise exception 'Zone code required'; end if;
   insert into public.reliance_retail_zones(zone_code,zone_name,state,status,created_by_profile_id) values(c->>'zone_code',c->>'zone_name',p.state,c->>'status',p_actor) returning id into zid;
  else update public.reliance_retail_zones set zone_name=c->>'zone_name',status=c->>'status',updated_at=now() where id=z.id;zid:=z.id; end if;
 elsif p.kind in ('store_zone','zone_fo') then
  if p.kind='zone_fo' and (select coalesce(jsonb_agg(to_jsonb(a) order by a.id),'[]') from public.reliance_retail_zone_fo_assignments a where a.zone_id=p.target_zone) is distinct from p.baseline->'zone_fo' then raise exception using errcode='40001',message='FO ownership changed since proposal'; end if;
  if p.kind='store_zone' and (select coalesce(jsonb_agg(to_jsonb(h) order by h.id),'[]') from public.reliance_retail_store_zone_history h where h.retail_store_id=p.target_store) is distinct from p.baseline->'store_zone' then raise exception using errcode='40001',message='Store Zone timeline changed since proposal'; end if;
  start_at:=case when c->>'effective_from'='ON_ACTIVATION' then clock_timestamp() else (c->>'effective_from')::timestamptz end;end_at:=nullif(c->>'effective_to','')::timestamptz;
  if start_at is null or start_at<clock_timestamp()-interval '1 minute' or (end_at is not null and end_at<=start_at) then raise exception 'Use a current/future nonempty interval; historical ownership cannot be rewritten'; end if;
  if p.kind='store_zone' then
   zid:=nullif(c->>'zone_id','')::uuid;
   if zid is not null and not exists(select 1 from public.reliance_retail_zones where id=zid and state=p.state and status='Active') then raise exception 'Active same-state zone required'; end if;
   if exists(select 1 from public.reliance_retail_store_zone_history where retail_store_id=s.id and changed_at>=start_at) then raise exception 'Future store mapping exists; review its timeline first'; end if;
   insert into public.reliance_retail_store_zone_history(retail_store_id,previous_zone_id,new_zone_id,changed_by_profile_id,changed_at,reason,metadata) values(s.id,(public.retail_unified_owner(s.id,start_at)->>'zone_id')::uuid,zid,p_actor,start_at,p.reason,jsonb_build_object('proposal_id',p.id));
   if end_at is not null then insert into public.reliance_retail_store_zone_history(retail_store_id,previous_zone_id,new_zone_id,changed_by_profile_id,changed_at,reason,metadata) values(s.id,zid,null,p_actor,end_at,'Approved interval ended',jsonb_build_object('proposal_id',p.id)); end if;
  else
   if nullif(c->>'fo_profile_id','') is not null then
    select * into f from public.profiles where id=(c->>'fo_profile_id')::uuid;
    if not found or f.is_active is not true or upper(coalesce(f.status,'Active'))<>'ACTIVE' or regexp_replace(upper(coalesce(f.business,'')),'[^A-Z0-9]','','g') not in ('RELIANCE','RELIANCERETAIL') or regexp_replace(upper(coalesce(f.role,'')),'[^A-Z0-9]','','g') not in ('FO','FIELDOFFICER') or (case when f.state in ('PY','TN') then 'TN' when f.state='KN' then 'KA' else f.state end)<>(case when p.state in ('TN','PY') then 'TN' else p.state end) then raise exception 'Verified active same-reporting-state QPMS FO required'; end if;
   end if;
   if exists(select 1 from public.reliance_retail_zone_fo_assignments where zone_id=z.id and effective_from>=start_at) then raise exception 'Future FO mapping exists; review its timeline first'; end if;
   select * into current_assignment from public.reliance_retail_zone_fo_assignments where zone_id=z.id and effective_to is null for update;
   if found then update public.reliance_retail_zone_fo_assignments set effective_to=start_at,status='Ended' where id=current_assignment.id; end if;
   if f.id is not null then insert into public.reliance_retail_zone_fo_assignments(zone_id,fo_profile_id,fo_employee_code,effective_from,effective_to,status,assigned_by_profile_id,metadata) values(z.id,f.id,f.employee_code,start_at,end_at,case when end_at is null then 'Active' else 'Ended' end,p_actor,jsonb_build_object('proposal_id',p.id)); end if;
  end if;
 elsif p.kind='DC_SCHEDULE' then
  if nullif(c->>'scheduled_date','') is null then raise exception 'Scheduled date required'; end if;
  insert into public.client_deep_cleaning_schedules(retail_store_id,scheduled_date,source_reference,created_by_profile_id,metadata)
  values(s.id,(c->>'scheduled_date')::date,p.id::text,p_actor,jsonb_build_object('proposal_id',p.id,'approval_ref',p.decision_reason));
 elsif p.kind in ('HK','MEPC') then
  if (select coalesce(jsonb_agg(to_jsonb(a) order by a.id),'[]') from public.retail_attendance_aop_versions a where a.retail_store_id=s.id and a.superseded_at is null) is distinct from p.baseline->'aop' then raise exception using errcode='40001',message='Approved AOP changed; propose again'; end if;
  if nullif(btrim(c->>'approval_ref'),'') is null or nullif(btrim(c->>'calculation_ref'),'') is null or jsonb_typeof(c->'total') is distinct from 'number' or jsonb_typeof(c->'components') is distinct from 'object' then raise exception 'Explicit total, components, calculation and approval evidence required'; end if;
  total:=(c->>'total')::numeric;if total<0 or total::text in ('NaN','Infinity','-Infinity') or round(total,4)<>total then raise exception 'Nonnegative AOP up to four decimal places required'; end if;
  if exists(select 1 from jsonb_each(c->'components') v where jsonb_typeof(v.value) not in ('number','null') or (jsonb_typeof(v.value)='number' and (v.value::text::numeric<0 or round(v.value::text::numeric,4)<>v.value::text::numeric))) then raise exception 'Invalid components'; end if;
  if c->>'effective_from' is null or (nullif(c->>'effective_to','') is not null and (c->>'effective_to')::date<(c->>'effective_from')::date) then raise exception 'AOP effective dates required'; end if;
  insert into public.retail_attendance_uploads(kind,filename,checksum,uploaded_by,committed_at,date_from,date_to,total_rows,valid_rows,rejected_rows,status,validation_summary,payload,raw_source) values('aop','Unified approved '||p.kind,p.id::text,p_actor,now(),(c->>'effective_from')::date,nullif(c->>'effective_to','')::date,1,1,0,'committed',jsonb_build_object('proposal',p.id,'reviewer',p.decided_by,'approval_ref',c->>'approval_ref'),jsonb_build_array(c),jsonb_build_object('proposal',to_jsonb(p))) returning id into batch;
  dfrom:=(c->>'effective_from')::date;dto:=nullif(c->>'effective_to','')::date;
  if nullif(c->>'supersede_version_id','') is not null then
   select * into previous_aop from public.retail_attendance_aop_versions where id=(c->>'supersede_version_id')::uuid and retail_store_id=s.id and aop_class=p.kind and superseded_at is null for update;
   if not found or not(daterange(previous_aop.effective_from,previous_aop.effective_to,'[]') && daterange(dfrom,dto,'[]')) then raise exception 'Explicit overlapping same-class version required for replacement'; end if;
   update public.retail_attendance_aop_versions set superseded_at=now(),superseded_by_batch=batch where id=previous_aop.id;
   if previous_aop.effective_from<dfrom then insert into public.retail_attendance_aop_versions(retail_store_id,hk_count,mepc_count,aop_class,components,approval_ref,calculation_ref,proposal_id,effective_from,effective_to,source_version,batch_id,created_by,mepc_cycle_anchor)
   values(s.id,previous_aop.hk_count,previous_aop.mepc_count,previous_aop.aop_class,previous_aop.components,previous_aop.approval_ref,previous_aop.calculation_ref,previous_aop.proposal_id,previous_aop.effective_from,dfrom-1,'Preserved prefix of '||previous_aop.id,previous_aop.batch_id,p_actor,previous_aop.mepc_cycle_anchor);end if;
   if dto is not null and (previous_aop.effective_to is null or dto<previous_aop.effective_to) then insert into public.retail_attendance_aop_versions(retail_store_id,hk_count,mepc_count,aop_class,components,approval_ref,calculation_ref,proposal_id,effective_from,effective_to,source_version,batch_id,created_by,mepc_cycle_anchor)
   values(s.id,previous_aop.hk_count,previous_aop.mepc_count,previous_aop.aop_class,previous_aop.components,previous_aop.approval_ref,previous_aop.calculation_ref,previous_aop.proposal_id,dto+1,previous_aop.effective_to,'Preserved suffix of '||previous_aop.id,previous_aop.batch_id,p_actor,previous_aop.mepc_cycle_anchor);end if;
  end if;
  insert into public.retail_attendance_aop_versions(retail_store_id,hk_count,mepc_count,aop_class,components,approval_ref,calculation_ref,proposal_id,effective_from,effective_to,source_version,batch_id,created_by)
  values(s.id,case when p.kind='HK' then total end,case when p.kind='MEPC' then total end,p.kind,c->'components',c->>'approval_ref',c->>'calculation_ref',p.id,(c->>'effective_from')::date,nullif(c->>'effective_to','')::date,'Unified independently approved '||p.kind,batch,p_actor);
 end if;
 receipt:=jsonb_build_object('state',p.state,'proposal_id',p.id,'kind',p.kind,'store_id',p.target_store,'zone_id',coalesce(zid,p.target_zone),'applied_at',now(),'changes',c);
 insert into public.reliance_retail_management_audit(action,entity_type,entity_id,actor_profile_id,before_state,after_state) values('UNIFIED_APPLY','proposal',p.id,p_actor,p.baseline,receipt);
 return receipt;
end; $$;

-- No grants to employees. Existing identity functions/approval registries remain unchanged.
alter table public.retail_unified_epoch enable row level security;
revoke all on public.retail_unified_epoch from public,anon,authenticated,service_role;
-- Replace direct operational writes with the approved RPC boundary. Existing identity,
-- location capture, and AOP activation functions remain executable with their existing gates.
revoke insert,update,delete on public.reliance_retail_store_master,public.reliance_retail_zones,public.reliance_retail_zone_fo_assignments,public.reliance_retail_store_manpower_budgets,public.retail_attendance_aop_versions from service_role;
revoke execute on function public.rpc_sync_reliance_retail_fo_zones(uuid,uuid,uuid[]) from service_role;
do $$ declare f regprocedure;begin
 for f in select p.oid::regprocedure from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and (p.proname like 'rpc_retail_unified_%' or p.proname in ('retail_unified_access','retail_unified_owner','retail_unified_fo_no_overlap','retail_unified_proposal_permissions')) loop
 execute format('revoke all on function %s from public,anon,authenticated,service_role',f);
 if f::text like '%rpc_retail_unified_%' then execute format('grant execute on function %s to service_role',f);end if;
 end loop;
end; $$;
grant execute on function public.retail_unified_owner(uuid,timestamptz) to service_role;
commit;
