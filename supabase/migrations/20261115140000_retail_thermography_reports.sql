-- PREPARED ONLY. Requires installed Retail Operations + verified Retail MIS contracts.
-- Additive: existing inspection identities/status semantics are preserved. No seeds.
begin;
set local lock_timeout='5s';
set local statement_timeout='60s';
do $$begin
 if to_regclass('public.retail_thermography_inspections') is null
 or to_regprocedure('public.retail_mis_allowed(uuid,text,text,boolean)') is null
 or to_regprocedure('public.retail_mis_super(uuid)') is null
 or to_regprocedure('public.retail_operations_access(uuid,text,boolean)') is null
 or to_regprocedure('public.rpc_retail_mis_report(uuid,text,date,date,text)') is null
 or to_regprocedure('public.rpc_retail_operations_snapshot(uuid,date)') is null
 or to_regprocedure('public.retail_mis_unique_store(uuid)') is null then
  raise exception 'Verify installed Retail Operations/MIS contracts before installing Thermography reports';
 end if;
 if exists(select 1 from storage.buckets where id='retail-thermography-reports') then
  raise exception 'Thermography bucket already exists: reconcile its policy/lifecycle before installing';
 end if;
end$$;

-- V2 uses its own scoped reporting contract; shared MIS/Operations RPCs stay unchanged.
alter table public.retail_thermography_inspections
 add column report_managed boolean not null default false,
 add column report_date date,
 add column report_period_end date,
 add column active_report_version_id uuid,
 add column report_review_state text check(report_review_state in ('awaiting','rework','approved')),
 add column report_rework_count integer not null default 0 check(report_rework_count>=0),
 add column report_updated_at timestamptz,
 add column report_deleted_at timestamptz,
 add column report_deleted_by uuid references public.profiles(id),
 add constraint thermo_report_period check(report_period_end is null or report_date is not null and report_period_end>=report_date),
 add constraint thermo_report_deletion check((report_deleted_at is null)=(report_deleted_by is null));

create table public.retail_thermography_report_versions(
 id uuid primary key default gen_random_uuid(),
 inspection_id uuid not null references public.retail_thermography_inspections(id) on delete restrict,
 version_number integer not null check(version_number>0),
 operation_id uuid not null unique,
 expected_revision integer not null,
 original_filename text not null check(length(original_filename) between 5 and 180 and original_filename ~* '\.pdf$'),
 mime_type text not null default 'application/pdf'
  check(mime_type='application/pdf'),
 file_size bigint not null check(file_size between 1 and 10000000),
 source_sha256 text not null check(source_sha256 ~ '^[a-f0-9]{64}$'),
 bucket text not null default 'retail-thermography-reports' check(bucket='retail-thermography-reports'),
 object_path text not null unique,
 state text not null default 'pending' check(state in ('pending','uploaded','invalid','abandoned','cleaned')),
 sha256 text check(sha256 ~ '^[a-f0-9]{64}$'),
 object_id uuid,
 uploaded_by uuid not null references public.profiles(id),
 prepared_at timestamptz not null default clock_timestamp(),
 uploaded_at timestamptz,
 review_status text check(review_status in ('awaiting','rejected','approved')),
 review_remark text,
 reviewed_by uuid references public.profiles(id),reviewed_at timestamptz,
 unique(inspection_id,version_number),unique(inspection_id,id),
 check(state<>'uploaded' or sha256 is not null and object_id is not null and uploaded_at is not null)
);
alter table public.retail_thermography_inspections add constraint thermo_active_version
 foreign key(id,active_report_version_id) references public.retail_thermography_report_versions(inspection_id,id) deferrable initially deferred;

create table public.retail_thermography_report_events(
 id uuid primary key default gen_random_uuid(),inspection_id uuid not null references public.retail_thermography_inspections(id),
 version_id uuid references public.retail_thermography_report_versions(id),actor_id uuid not null references public.profiles(id),
 action text not null,remark text,created_at timestamptz not null default clock_timestamp(),details jsonb not null default '{}'
);
create table public.retail_thermography_report_requests(
 request_id uuid primary key,actor_id uuid not null references public.profiles(id),action text not null,payload jsonb not null,
 inspection_id uuid not null references public.retail_thermography_inspections(id),receipt jsonb not null
);
create index thermo_reports_scope on public.retail_thermography_inspections(scheduled_date,retail_store_id,report_deleted_at);
create index thermo_versions_cleanup on public.retail_thermography_report_versions(state,prepared_at);
create index thermo_events_inspection on public.retail_thermography_report_events(inspection_id,created_at);
alter table public.retail_thermography_report_versions enable row level security;
alter table public.retail_thermography_report_events enable row level security;
alter table public.retail_thermography_report_requests enable row level security;
revoke all on public.retail_thermography_report_versions,public.retail_thermography_report_events,public.retail_thermography_report_requests from public,anon,authenticated,service_role;

create function public.thermo_report_access(p_actor uuid,p_state text,p_mode text) returns boolean
 language sql stable security definer set search_path=pg_catalog,public as $$
 select case when p_mode='super' then public.retail_mis_super(p_actor)
 when p_mode='write' then exists(select 1 from public.profiles p where p.id=p_actor and p.role='MIS_MEPC'
  and regexp_replace(upper(coalesce(p.business,'')),'[^A-Z0-9]','','g') in ('RELIANCE','RELIANCERETAIL'))
  and public.retail_mis_allowed(p_actor,'thermography',p_state,true)
 else public.retail_mis_super(p_actor) or (exists(select 1 from public.profiles p where p.id=p_actor and regexp_replace(upper(coalesce(p.business,'')),'[^A-Z0-9]','','g') in ('RELIANCE','RELIANCERETAIL')) and public.retail_mis_allowed(p_actor,'thermography',p_state,false))
  or public.retail_operations_access(p_actor,p_state,false) end
$$;
create function public.thermo_report_status(t public.retail_thermography_inspections) returns text
 language sql immutable set search_path=pg_catalog,public as $$
 select case when t.report_deleted_at is not null then 'Deleted'
 when not t.report_managed and t.status='Completed' then 'Completed (legacy; no PDF)'
 when t.report_review_state='rework' then 'Rework Required'
 when t.status='Client Approved' then 'Client Approved'
 when t.status='Completed' and t.active_report_version_id is not null then
  case when t.report_rework_count>0 then 'Awaiting Client Approval — Revised' else 'Awaiting Client Approval' end
 else t.status end
$$;
create function public.thermo_report_guard() returns trigger language plpgsql set search_path=pg_catalog,public as $$
begin
 if current_setting('myqpms.thermography_report_contract',true) is distinct from 'reports.v1' then
  if tg_table_name='retail_thermography_inspections' then
   if old.report_managed or new.report_managed or old.report_deleted_at is not null or new.report_deleted_at is not null then
    raise exception using errcode='42501',message='Use the authorized Thermography report workflow';
   end if;
  else
   raise exception using errcode='42501',message='Use the authorized Thermography report workflow';
  end if;
 end if;
 return new;
end$$;
create trigger thermo_managed_inspection_guard before update on public.retail_thermography_inspections for each row execute function public.thermo_report_guard();
create trigger thermo_versions_guard before insert or update or delete on public.retail_thermography_report_versions for each row execute function public.thermo_report_guard();
create trigger thermo_events_guard before insert on public.retail_thermography_report_events for each row execute function public.thermo_report_guard();
create trigger thermo_events_immutable before update or delete on public.retail_thermography_report_events for each row execute function public.retail_operations_immutable();
create trigger thermo_requests_immutable before update or delete on public.retail_thermography_report_requests for each row execute function public.retail_operations_immutable();

insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
 values('retail-thermography-reports','retail-thermography-reports',false,10000000,array['application/pdf']);
-- Existing permissive Storage policies cannot grant authenticated access to this namespace.
create policy thermo_reports_private_read on storage.objects as restrictive for select to anon,authenticated using(bucket_id<>'retail-thermography-reports');
create policy thermo_reports_private_insert on storage.objects as restrictive for insert to anon,authenticated with check(bucket_id<>'retail-thermography-reports');
create policy thermo_reports_private_update on storage.objects as restrictive for update to anon,authenticated using(bucket_id<>'retail-thermography-reports') with check(bucket_id<>'retail-thermography-reports');
create policy thermo_reports_private_delete on storage.objects as restrictive for delete to anon,authenticated using(bucket_id<>'retail-thermography-reports');
create function public.thermo_report_storage_guard() returns trigger language plpgsql security definer set search_path=pg_catalog,public as $$
declare v public.retail_thermography_report_versions%rowtype;
begin
 if (tg_op='INSERT' and new.bucket_id='retail-thermography-reports') or (tg_op='UPDATE' and (new.bucket_id='retail-thermography-reports' or old.bucket_id='retail-thermography-reports')) or (tg_op='DELETE' and old.bucket_id='retail-thermography-reports') then
  select * into v from public.retail_thermography_report_versions where object_path=case when tg_op='DELETE' then old.name else new.name end;
  if v.id is null or (tg_op='INSERT' and v.state<>'pending') or (tg_op='UPDATE' and (v.state<>'pending' or old.name<>new.name or old.bucket_id<>new.bucket_id)) or (tg_op='DELETE' and v.state not in ('abandoned','cleaned')) then
   raise exception using errcode='42501',message='Prepared Thermography upload required; confirmed PDFs are immutable';
  end if;
 end if;
 if tg_op='DELETE' then return old;end if;return new;
end$$;
create trigger thermo_report_storage_guard before insert or update or delete on storage.objects for each row execute function public.thermo_report_storage_guard();

create function public.rpc_retail_thermography_reports(p_actor uuid,p_action text,p_data jsonb default '{}') returns jsonb
language plpgsql security definer set search_path=pg_catalog,public as $$
declare
 t public.retail_thermography_inspections%rowtype;v public.retail_thermography_report_versions%rowtype;
 s public.reliance_retail_store_master%rowtype;r public.retail_thermography_report_requests%rowtype;
 req uuid:=(p_data->>'request_id')::uuid;record_id uuid:=(p_data->>'id')::uuid;
 today date:=public.retail_operations_today();start_day date;end_day date;is_super boolean;
 revision_expected integer:=(p_data->>'revision')::integer;version_id uuid:=(p_data->>'version_id')::uuid;
 result jsonb;before_state jsonb;all_rows jsonb;page_rows jsonb;stores jsonb;state_filter text:=nullif(p_data->>'state','');
 offset_rows integer:=greatest(0,coalesce((p_data->>'page')::integer,0))*least(100,greatest(1,coalesce((p_data->>'limit')::integer,25)));
 page_limit integer:=least(100,greatest(1,coalesce((p_data->>'limit')::integer,25)));
begin
 if not public.thermo_report_access(p_actor,null,'read') then raise exception using errcode='42501',message='Active authorized Thermography account required';end if;
 is_super:=public.thermo_report_access(p_actor,null,'super');
 perform set_config('myqpms.thermography_report_contract','reports.v1',true);
 if p_action='dashboard' then page_limit:=5000;offset_rows:=0;end if;
 if p_action in ('list','dashboard') then
  start_day:=(p_data->>'from')::date;end_day:=(p_data->>'to')::date;
  if start_day is null or end_day is null or end_day<start_day or end_day-start_day>366 then raise exception using errcode='22023',message='Choose a reporting range up to 366 days';end if;
  if coalesce((p_data->>'deleted')::boolean,false) and not is_super then raise exception using errcode='42501',message='Super Admin required for deleted reports';end if;
  -- Resolve the unchanged access predicates once per state; canonical-code uniqueness
  -- is the same all-master comparison as retail_mis_unique_store, computed in one pass.
  with state_scope as materialized (
   select state,public.thermo_report_access(p_actor,state,'read') can_read,public.thermo_report_access(p_actor,state,'write') can_write
   from (select distinct state from public.reliance_retail_store_master) states
  ), codes as materialized (
   select upper(btrim(store_code)) code,count(*) n from public.reliance_retail_store_master group by upper(btrim(store_code))
  ) select coalesce(jsonb_agg(jsonb_build_object('id',x.id,'store_code',x.store_code,'store_name',x.store_name,'state',x.state,'status',x.status,'can_upload',a.can_write,'can_schedule',is_super or a.can_write) order by x.store_code),'[]') into stores
   from public.reliance_retail_store_master x join state_scope a on a.state=x.state and a.can_read
   join codes c on c.code=upper(btrim(x.store_code)) and c.n=1 and nullif(c.code,'') is not null;
  with scoped as (
   select i.*,m.store_name,m.state current_state,m.status store_status,public.thermo_report_status(i) display_status,
    fv.original_filename,fv.file_size,fv.version_number,fv.uploaded_at,fv.uploaded_by,
    (select coalesce(p.full_name,p.employee_code) from public.profiles p where p.id=fv.uploaded_by) uploaded_by_name,
    (select coalesce(p.full_name,p.employee_code) from public.profiles p where p.id=i.approved_by) approved_by_name,
    allowed.can_upload can_write
   from public.retail_thermography_inspections i join public.reliance_retail_store_master m on m.id=i.retail_store_id
   join jsonb_to_recordset(stores) as allowed(id uuid,state text,can_upload boolean) on allowed.id=m.id and allowed.state=m.state
   left join public.retail_thermography_report_versions fv on fv.id=i.active_report_version_id and fv.state='uploaded'
   where i.scheduled_date between start_day and end_day
   and (not coalesce((p_data->>'deleted')::boolean,false) and i.report_deleted_at is null or coalesce((p_data->>'deleted')::boolean,false) and i.report_deleted_at is not null)
   and (state_filter is null or (case when m.state='PY' then 'TN' when m.state='KA' then 'KN' else m.state end)=(case when state_filter='PY' then 'TN' when state_filter='KA' then 'KN' else state_filter end))
   and (nullif(p_data->>'store','') is null or m.id=(p_data->>'store')::uuid)
  ), filtered as (
   select * from scoped where (nullif(p_data->>'status','') is null or display_status=p_data->>'status' or p_data->>'status'='awaiting' and report_review_state='awaiting')
    and (nullif(p_data->>'q','') is null or position(lower(p_data->>'q') in lower(store_code||' '||store_name||' '||display_status))>0)
  ), dto as (
   select id,jsonb_build_object('id',id,'retail_store_id',retail_store_id,'store_code',store_code,'store_name',store_name,'state',current_state,
    'scheduled_date',scheduled_date,'report_date',report_date,'report_period_end',report_period_end,'status',status,'display_status',display_status,
    'revision',revision,'report_managed',report_managed,'report_review_state',report_review_state,'report_rework_count',report_rework_count,
    'pdf_verified',exists(select 1 from public.retail_thermography_report_versions verified where verified.id=active_report_version_id and verified.state='uploaded' and verified.mime_type='application/pdf' and verified.sha256=verified.source_sha256 and verified.object_id is not null),'active_version_id',active_report_version_id,'filename',original_filename,'file_size',file_size,'version_number',version_number,
    'uploaded_at',uploaded_at,'uploaded_by',uploaded_by,'uploaded_by_name',uploaded_by_name,'approved_at',approved_at,'approved_by',approved_by,'approved_by_name',approved_by_name,
    'approval_due_on',approval_due_on,'approval_overdue',status='Completed' and report_review_state is distinct from 'rework' and today>approval_due_on,
    'report_deleted_at',report_deleted_at,'can_write',can_write,'can_restore',is_super,'can_reopen',is_super,
    'can_upload',can_write and store_status='Active' and status='Scheduled' and today>=scheduled_date,'can_replace',can_write and store_status='Active' and report_review_state='rework' and active_report_version_id is not null,
    'can_approve',can_write and status='Completed' and report_review_state='awaiting' and active_report_version_id is not null,
    'pending_upload',(select jsonb_build_object('request_id',pv.operation_id,'filename',pv.original_filename,'size',pv.file_size,'source_sha256',pv.source_sha256,'revision',pv.expected_revision) from public.retail_thermography_report_versions pv where pv.inspection_id=filtered.id and pv.uploaded_by=p_actor and pv.state='pending' and pv.expected_revision=filtered.revision order by pv.prepared_at desc limit 1)) row_data
   from filtered
  ) select coalesce(jsonb_agg(row_data order by id),'[]') into all_rows from dto;
  select coalesce(jsonb_agg(value),'[]') into page_rows from (select value from jsonb_array_elements(all_rows) with ordinality a(value,n) order by n offset offset_rows limit page_limit) b;
  return jsonb_build_object('contract','thermography-reports.v1','scope_digest',md5(all_rows::text),'from',start_day,'to',end_day,'today',today,'rows',page_rows,'total',jsonb_array_length(all_rows),'stores',stores,'page',offset_rows/page_limit,'limit',page_limit,'is_super',is_super,'can_upload',public.thermo_report_access(p_actor,null,'write'),'can_schedule',is_super or public.thermo_report_access(p_actor,null,'write'),
   'counts',jsonb_build_object('scheduled',(select count(*) from jsonb_array_elements(all_rows) x where x->>'display_status'='Scheduled'),
    'awaiting',(select count(*) from jsonb_array_elements(all_rows) x where x->>'report_deleted_at' is null and x->>'report_review_state'='awaiting'),
    'rework',(select count(*) from jsonb_array_elements(all_rows) x where x->>'report_deleted_at' is null and x->>'report_review_state'='rework'),
    'approved',(select count(*) from jsonb_array_elements(all_rows) x where x->>'report_deleted_at' is null and x->>'status'='Client Approved' and nullif(x->>'active_version_id','') is not null),
    'legacy_records',(select count(*) from jsonb_array_elements(all_rows) x where (x->>'report_managed')::boolean=false and x->>'status'<>'Scheduled'),
    'active_reports',(select count(*) from jsonb_array_elements(all_rows) x where x->>'report_deleted_at' is null and nullif(x->>'active_version_id','') is not null)));
 end if;
 if p_action in ('cleanup_candidates','cleanup_abandon','cleanup_done') then
  if not is_super then raise exception using errcode='42501',message='Super Admin required';end if;
  if p_action='cleanup_candidates' then return coalesce((select jsonb_agg(to_jsonb(x)) from (select id,inspection_id,bucket,object_path from public.retail_thermography_report_versions where state in ('pending','invalid','abandoned') and prepared_at<clock_timestamp()-interval '24 hours' order by prepared_at limit 20) x),'[]');end if;
  select * into v from public.retail_thermography_report_versions where id=version_id for update;
  if v.id is null or v.state not in ('pending','invalid','abandoned') or v.prepared_at>=clock_timestamp()-interval '24 hours' then raise exception using errcode='40001',message='Upload is not an abandoned cleanup candidate';end if;
  update public.retail_thermography_report_versions set state=case when p_action='cleanup_done' then 'cleaned' else 'abandoned' end where id=v.id;
  insert into public.retail_thermography_report_events(inspection_id,version_id,actor_id,action) values(v.inspection_id,v.id,p_actor,p_action);
  return jsonb_build_object('id',v.id,'bucket',v.bucket,'object_path',v.object_path);
 end if;
 if p_action='prepare' then
  if record_id is null then raise exception using errcode='22023',message='Scheduled inspection ID required';end if;
  if req is null then raise exception using errcode='22023',message='Stable request ID required';end if;
  -- Serialize the same operation before creating an inspection or version.
  perform pg_advisory_xact_lock(hashtextextended(req::text,0));
  select * into v from public.retail_thermography_report_versions where operation_id=req;
  if found then
   select * into t from public.retail_thermography_inspections where id=v.inspection_id;
   select * into s from public.reliance_retail_store_master where id=t.retail_store_id;
   if not public.thermo_report_access(p_actor,s.state,'write') or v.uploaded_by<>p_actor then raise exception using errcode='42501',message='Upload outside authorized scope';end if;
   if v.original_filename is distinct from p_data->>'filename' or v.source_sha256 is distinct from p_data->>'source_sha256' or v.file_size is distinct from (p_data->>'size')::bigint or t.retail_store_id is distinct from (p_data->>'store_id')::uuid or t.report_date is distinct from (p_data->>'date')::date or t.report_period_end is distinct from nullif(p_data->>'period_end','')::date or (record_id is not null and record_id<>t.id) then raise exception using errcode='23505',message='Request ID reused for a different report';end if;
   if t.report_deleted_at is not null or v.state not in ('pending','uploaded') then raise exception using errcode='40001',message='Upload expired or invalid; choose the corrected PDF as a new operation';end if;
   return to_jsonb(v);
  end if;
  select * into s from public.reliance_retail_store_master where id=(p_data->>'store_id')::uuid;
  if s.id is null or s.status<>'Active' or not public.retail_mis_unique_store(s.id) or not public.thermo_report_access(p_actor,s.state,'write') then raise exception using errcode='42501',message='Active canonical store in assigned MEPC MIS state required';end if;
  start_day:=(p_data->>'date')::date;end_day:=nullif(p_data->>'period_end','')::date;
  if start_day is null or start_day>today or end_day is not null and (end_day<start_day or end_day>today) then raise exception using errcode='22023',message='Select actual report dates, not future dates';end if;
  if record_id is null then
  else
   select * into t from public.retail_thermography_inspections where id=record_id for update;
   if t.id is null or t.retail_store_id<>s.id or t.report_deleted_at is not null or t.revision is distinct from revision_expected then raise exception using errcode='40001',message='Report changed; refresh before preparing upload';end if;
   if today<t.scheduled_date then raise exception using errcode='22023',message='Inspection is scheduled in the future';end if;
   if not (t.status='Scheduled' and t.active_report_version_id is null or t.status='Completed' and t.report_review_state='rework' and t.active_report_version_id is not null) then raise exception using errcode='22023',message='Upload only to a scheduled record or replace a rejected report';end if;
   if t.active_report_version_id is not null and (t.report_date<>start_day or t.report_period_end is distinct from end_day) then raise exception using errcode='22023',message='Replacement must retain the report date/period';end if;
   update public.retail_thermography_inspections set report_managed=true,report_date=start_day,report_period_end=end_day,report_updated_at=clock_timestamp() where id=t.id returning * into t;
  end if;
  version_id:=gen_random_uuid();
  insert into public.retail_thermography_report_versions(id,inspection_id,version_number,operation_id,expected_revision,original_filename,file_size,source_sha256,object_path,uploaded_by)
   values(version_id,t.id,(select coalesce(max(version_number),0)+1 from public.retail_thermography_report_versions where inspection_id=t.id),req,t.revision,p_data->>'filename',(p_data->>'size')::bigint,p_data->>'source_sha256',t.id::text||'/'||version_id::text||'.pdf',p_actor) returning * into v;
  insert into public.retail_thermography_report_events(inspection_id,version_id,actor_id,action) values(t.id,v.id,p_actor,'UPLOAD_PREPARED');
  return to_jsonb(v);
 end if;
 if p_action='schedule' then
  if req is null then raise exception using errcode='22023',message='Stable request ID required';end if;
  perform pg_advisory_xact_lock(hashtextextended(req::text,0));
  select * into s from public.reliance_retail_store_master where id=(p_data->>'store_id')::uuid;
  if s.id is null or s.status<>'Active' or not public.retail_mis_unique_store(s.id) or not (is_super or public.thermo_report_access(p_actor,s.state,'write')) then raise exception using errcode='42501',message='Authorized scheduler and active canonical store required';end if;
  select * into r from public.retail_thermography_report_requests where request_id=req;
  if found then if r.actor_id<>p_actor or r.action<>p_action or r.payload<>p_data-'request_id' then raise exception using errcode='23505',message='Request ID reused';end if;return r.receipt;end if;
  start_day:=(p_data->>'date')::date;if start_day is null then raise exception using errcode='22023',message='Scheduled date required';end if;
  insert into public.retail_thermography_inspections(retail_store_id,store_code,state,scheduled_date,created_by,schedule_request_id)
   values(s.id,s.store_code,s.state,start_day,p_actor,req) returning * into t;
 else
  if p_action in ('finalize','upload') then select * into v from public.retail_thermography_report_versions where operation_id=req;record_id:=v.inspection_id;end if;
  select * into t from public.retail_thermography_inspections where id=record_id for update;
  select * into s from public.reliance_retail_store_master where id=t.retail_store_id;
  if t.id is null or not public.thermo_report_access(p_actor,s.state,'read') then raise exception using errcode='42501',message='Report unavailable in authorized state/store';end if;
  if p_action='delete' and req is not null then
   select * into r from public.retail_thermography_report_requests where request_id=req;
   if found then
    if not public.thermo_report_access(p_actor,s.state,'write') or r.actor_id<>p_actor then raise exception using errcode='42501',message='State-assigned MEPC MIS editor required';end if;
    if r.action<>p_action or r.payload<>p_data-'request_id' then raise exception using errcode='23505',message='Request ID reused';end if;
    return r.receipt;
   end if;
  end if;
  if t.report_deleted_at is not null and not is_super then raise exception using errcode='42501',message='Report is deleted';end if;
  before_state:=to_jsonb(t);
  if p_action='upload' then
   if v.uploaded_by is distinct from p_actor or not public.thermo_report_access(p_actor,s.state,'write') or v.state not in ('pending','uploaded') then raise exception using errcode='42501',message='Upload unavailable in authorized scope';end if;
   return to_jsonb(v);
  end if;
  if p_action='history' then
   return jsonb_build_object('id',t.id,'page',offset_rows/page_limit,'limit',page_limit,
    'versions_total',(select count(*) from public.retail_thermography_report_versions where inspection_id=t.id),
    'events_total',(select count(*) from public.retail_thermography_report_events where inspection_id=t.id),
    'legacy_total',(select count(*) from public.reliance_retail_management_audit where entity_type='retail_thermography' and entity_id=t.id),
    'versions',coalesce((select jsonb_agg(jsonb_build_object('id',x.id,'version_number',x.version_number,'filename',x.original_filename,'file_size',x.file_size,'state',x.state,'uploaded_at',x.uploaded_at,'uploaded_by',x.uploaded_by,'review_status',x.review_status,'remark',x.review_remark,'reviewed_at',x.reviewed_at,'active',x.id=t.active_report_version_id) order by x.version_number desc) from (select * from public.retail_thermography_report_versions where inspection_id=t.id order by version_number desc offset offset_rows limit page_limit) x),'[]'),
    'events',coalesce((select jsonb_agg(jsonb_build_object('id',e.id,'action',e.action,'version_id',e.version_id,'actor_id',e.actor_id,'created_at',e.created_at,'remark',e.remark,'details',e.details) order by e.created_at desc) from (select * from public.retail_thermography_report_events where inspection_id=t.id order by created_at desc,id desc offset offset_rows limit page_limit) e),'[]'),
    'legacy_events',coalesce((select jsonb_agg(jsonb_build_object('id',a.id,'action',a.action,'created_at',a.created_at,'actor_id',a.actor_profile_id) order by a.created_at desc) from (select * from public.reliance_retail_management_audit where entity_type='retail_thermography' and entity_id=t.id order by created_at desc offset offset_rows limit page_limit) a),'[]'));
  end if;
  if p_action='version' then
   select * into v from public.retail_thermography_report_versions where id=coalesce(version_id,t.active_report_version_id) and inspection_id=t.id and state='uploaded';
   if v.id is null then raise exception using errcode='22023',message='No confirmed PDF available';end if;
   return to_jsonb(v);
  end if;
  if p_action in ('restore','reopen') then
   if not is_super or length(btrim(coalesce(p_data->>'reason','')))<3 then raise exception using errcode='42501',message='Super Admin and an audit reason required';end if;
  elsif not public.thermo_report_access(p_actor,s.state,'write') then raise exception using errcode='42501',message='State-assigned MEPC MIS editor required';end if;
  if req is null then raise exception using errcode='22023',message='Stable request ID required';end if;
  select * into r from public.retail_thermography_report_requests where request_id=req;
  if found then if r.actor_id<>p_actor or r.action<>p_action or r.payload<>p_data-'request_id' then raise exception using errcode='23505',message='Request ID reused';end if;return r.receipt;end if;
  if p_action='finalize' then revision_expected:=v.expected_revision;end if;
  if t.revision is distinct from revision_expected then raise exception using errcode='40001',message='Report changed; refresh before applying this action';end if;
  if p_action='finalize' then
   select * into v from public.retail_thermography_report_versions where operation_id=req for update;
   if v.uploaded_by<>p_actor or v.state<>'pending' or t.report_deleted_at is not null or today<t.scheduled_date
    or not (t.status='Scheduled' or t.status='Completed' and t.report_review_state='rework') then raise exception using errcode='40001',message='Upload cannot be finalized in the current report state';end if;
   if p_data->>'sha256' is distinct from v.source_sha256 or not exists(select 1 from storage.objects o where o.id=(p_data->>'object_id')::uuid and o.bucket_id=v.bucket and o.name=v.object_path and (o.metadata->>'size')::bigint=v.file_size and o.metadata->>'mimetype'=v.mime_type) then raise exception using errcode='22023',message='Stored validated PDF required';end if;
   update public.retail_thermography_report_versions set state='uploaded',sha256=p_data->>'sha256',object_id=(p_data->>'object_id')::uuid,uploaded_at=clock_timestamp(),review_status='awaiting' where id=v.id returning * into v;
   update public.retail_thermography_inspections set status='Completed',active_report_version_id=v.id,report_review_state='awaiting',completed_on=today,completed_at=clock_timestamp(),completed_by=p_actor,completed_request_id=req,approval_due_on=today+10,approved_on=null,approved_at=null,approved_by=null,approved_request_id=null,approved_late=false where id=t.id;
  elsif p_action='invalidate' then
   update public.retail_thermography_report_versions set state='invalid' where operation_id=req and inspection_id=t.id and state='pending' and uploaded_by=p_actor;
  elsif p_action in ('reject','approve','reopen') then
   select * into v from public.retail_thermography_report_versions where id=t.active_report_version_id and state='uploaded';
   if v.id is null or t.report_deleted_at is not null or p_action='approve' and t.report_review_state<>'awaiting' or p_action='reject' and t.report_review_state<>'awaiting' or p_action='reopen' and t.status<>'Client Approved' then raise exception using errcode='22023',message='Action is unavailable for this active report';end if;
   if p_action='approve' and not exists(select 1 from storage.objects o where o.id=v.object_id and o.bucket_id=v.bucket and o.name=v.object_path and (o.metadata->>'size')::bigint=v.file_size) then raise exception using errcode='22023',message='Confirmed current PDF required before approval';end if;
   update public.retail_thermography_report_versions set review_status=case when p_action='approve' then 'approved' else 'rejected' end,reviewed_by=p_actor,reviewed_at=clock_timestamp(),review_remark=left(coalesce(p_data->>'reason',''),2000) where id=v.id;
   update public.retail_thermography_inspections set status=case when p_action='approve' then 'Client Approved' else 'Completed' end,report_review_state=case when p_action='approve' then 'approved' else 'rework' end,
    report_rework_count=report_rework_count+case when p_action='approve' then 0 else 1 end,
    approved_on=case when p_action='approve' then today end,approved_at=case when p_action='approve' then clock_timestamp() end,approved_by=case when p_action='approve' then p_actor end,approved_request_id=case when p_action='approve' then req end,approved_late=case when p_action='approve' then today>approval_due_on else false end where id=t.id;
  elsif p_action='delete' then
   if t.report_deleted_at is not null then raise exception using errcode='40001',message='Report already deleted';end if;
   update public.retail_thermography_inspections set report_deleted_at=clock_timestamp(),report_deleted_by=p_actor where id=t.id;
  elsif p_action='restore' then
   if t.report_deleted_at is null then raise exception using errcode='22023',message='Report is not deleted';end if;
   if t.active_report_version_id is not null and not exists(select 1 from public.retail_thermography_report_versions fv join storage.objects o on o.id=fv.object_id and o.bucket_id=fv.bucket and o.name=fv.object_path where fv.id=t.active_report_version_id and fv.state='uploaded') then raise exception using errcode='22023',message='Latest valid PDF must be available before restoration';end if;
   update public.retail_thermography_inspections set report_deleted_at=null,report_deleted_by=null where id=t.id;
  else raise exception using errcode='22023',message='Unknown Thermography report action';end if;
  update public.retail_thermography_inspections set revision=revision+1,report_updated_at=clock_timestamp() where id=t.id returning * into t;
 end if;
 result:=jsonb_build_object('id',t.id,'revision',t.revision,'action',p_action,'version_id',t.active_report_version_id,'confirmed_at',clock_timestamp());
 insert into public.retail_thermography_report_requests(request_id,actor_id,action,payload,inspection_id,receipt) values(req,p_actor,p_action,p_data-'request_id',t.id,result);
 insert into public.retail_thermography_report_events(inspection_id,version_id,actor_id,action,remark,details) values(t.id,t.active_report_version_id,p_actor,upper(p_action),left(coalesce(p_data->>'reason',''),2000),jsonb_build_object('before',before_state,'after',to_jsonb(t)));
 return result;
end$$;
revoke all on function public.thermo_report_access(uuid,text,text),public.thermo_report_status(public.retail_thermography_inspections),public.thermo_report_guard(),public.thermo_report_storage_guard(),public.rpc_retail_thermography_reports(uuid,text,jsonb) from public,anon,authenticated,service_role;
grant execute on function public.rpc_retail_thermography_reports(uuid,text,jsonb) to service_role;
notify pgrst,'reload schema';
commit;
