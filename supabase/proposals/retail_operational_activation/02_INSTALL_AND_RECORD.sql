-- NEW activation package only. Explicit owner authorization required.
-- Atomic installation, source/history guards, fail-closed replay and protected data checks.
begin;
set local lock_timeout='5s';set local statement_timeout='90s';
do $install$
declare source text:=$retail_source$create table public.retail_service_orders(
 id uuid primary key default gen_random_uuid(),kind text not null check(kind in ('OOS','FAULT')),
 reference text not null,state text not null,store_ids uuid[] not null check(cardinality(store_ids)>0),
 status text not null,revision integer not null default 1,rework_count integer not null default 0,
 details jsonb not null,created_by uuid not null references public.profiles(id),assigned_profile_id uuid references public.profiles(id) on delete restrict,created_at timestamptz not null default now(),updated_at timestamptz not null default now(),
 unique(kind,reference),check((kind='OOS' and status in ('QUOTED','PO_RECORDED','COMMERCIALLY_CONFIRMED','FUND_RECORDED','PAYMENT_RECORDED','DELIVERED')) or (kind='FAULT' and status in ('REGISTERED','ASSIGNED','IN_PROGRESS','RESOLVED','CLOSED')))
);
create table public.retail_service_events(
 id uuid primary key default gen_random_uuid(),order_id uuid not null references public.retail_service_orders(id) on delete restrict,
 request_id uuid not null unique,actor_id uuid not null references public.profiles(id),action text not null,before_value jsonb,after_value jsonb not null,evidence jsonb not null,created_at timestamptz not null default now()
);
-- Keep the existing API array, with real FK-backed links protecting canonical
-- stores from deletion while an OOS/Fault record references them.
create table public.retail_service_order_stores(
 order_id uuid not null references public.retail_service_orders(id) on delete restrict,
 retail_store_id uuid not null references public.reliance_retail_store_master(id) on delete restrict,
 primary key(order_id,retail_store_id)
);
alter table public.retail_service_orders enable row level security;
alter table public.retail_service_events enable row level security;
alter table public.retail_service_order_stores enable row level security;
revoke all on public.retail_service_orders,public.retail_service_events,public.retail_service_order_stores from public,anon,authenticated,service_role;
create function public.retail_service_event_immutable() returns trigger language plpgsql set search_path=pg_catalog,public as $$begin raise exception 'Service audit history is immutable';end;$$;
create trigger retail_service_event_immutable before update or delete on public.retail_service_events for each row execute function public.retail_service_event_immutable();
create trigger retail_service_order_stores_immutable before update or delete on public.retail_service_order_stores for each row execute function public.retail_service_event_immutable();
-- A source workbook can contain other states. Keep the original immutable in
-- audit storage but never expose its full base64 through a state-scoped response.
create function public.retail_service_public_order(p_value jsonb) returns jsonb language sql immutable set search_path=pg_catalog,public as $$select case when p_value is null then null else p_value||jsonb_build_object('details',coalesce(p_value->'details','{}')-'original_base64') end;$$;

create function public.rpc_retail_service_snapshot(p_actor uuid) returns jsonb language sql stable security definer set search_path=pg_catalog,public as $$
select jsonb_build_object('orders',coalesce((select jsonb_agg(public.retail_service_public_order(to_jsonb(o))||jsonb_build_object('ownership',(select jsonb_agg(jsonb_build_object('store_id',s, 'owner',public.retail_unified_owner(s,now()))) from unnest(o.store_ids) s))) from public.retail_service_orders o where public.retail_unified_access(p_actor,o.state,'view')),'[]'::jsonb),'events',coalesce((select jsonb_agg(to_jsonb(e)||jsonb_build_object('before_value',public.retail_service_public_order(e.before_value),'after_value',public.retail_service_public_order(e.after_value),'evidence',e.evidence-'original_base64') order by e.created_at) from public.retail_service_events e join public.retail_service_orders o on o.id=e.order_id where public.retail_unified_access(p_actor,o.state,'view')),'[]'::jsonb));
$$;

create function public.rpc_retail_service_command(p_actor uuid,p_request uuid,p_action text,p_order uuid,p_revision integer,p_data jsonb) returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $$
declare o public.retail_service_orders%rowtype;b jsonb;e public.retail_service_events%rowtype;ids uuid[];st text;next_stage text;required_field text;fields text[];stage_list text[];k text;allowed_fields text[];
begin
 if p_request is null or p_data is null or jsonb_typeof(p_data)<>'object' then raise exception 'Request ID and object required';end if;
 allowed_fields:=case p_action
 when 'CREATE_OOS' then array['reference','store_ids','items','filename','file_sha256','original_base64']
 when 'REGISTER_FAULT' then array['reference','store_ids','category','priority','description']
 when 'REWORK' then array['reference','store_ids','items','reason','quotation_file_sha256','original_base64']
 when 'ESCALATE' then array['reason'] when 'PO_RECORDED' then array['po_number','po_date']
 when 'COMMERCIALLY_CONFIRMED' then array['confirmation_ref'] when 'FUND_RECORDED' then array['fund_ref']
 when 'PAYMENT_RECORDED' then array['payment_ref'] when 'DELIVERED' then array['delivery_ref','delivery_date']
 when 'ASSIGNED' then array['assigned_profile_id'] when 'IN_PROGRESS' then array['remarks']
 when 'RESOLVED' then array['resolution','closure_evidence_ref'] when 'CLOSED' then array['closure_evidence_ref'] end;
 if allowed_fields is null or exists(select 1 from jsonb_object_keys(p_data) key where not(key=any(allowed_fields))) then raise exception 'Unsupported action or unrelated update fields';end if;
 perform pg_advisory_xact_lock(hashtextextended('retail_service_orders',0));
 select * into e from public.retail_service_events where request_id=p_request;
 if found then
  if e.actor_id<>p_actor or e.action<>p_action or e.evidence-'filename'<>p_data-'filename' or (p_order is not null and e.order_id<>p_order) then raise exception 'Request ID reused with different command';end if;
  if not public.retail_unified_access(p_actor,e.after_value->>'state','edit') then raise exception using errcode='42501',message='Outside editor scope';end if;
  return jsonb_build_object('replayed',true,'order',public.retail_service_public_order(e.after_value));
 end if;
 if p_action in ('CREATE_OOS','REGISTER_FAULT') then
  select array_agg(value::uuid) into ids from jsonb_array_elements_text(p_data->'store_ids');
  if coalesce(cardinality(ids),0)=0 or cardinality(ids)>1000 then raise exception 'Verified stores required';end if;
  if exists(select 1 from unnest(ids) x left join public.reliance_retail_store_master s on s.id=x where s.id is null or s.status<>'Active') then raise exception 'Only active canonical stores can be used';end if;
  select min(state) into st from public.reliance_retail_store_master where id=any(ids);
  if (select count(distinct state) from public.reliance_retail_store_master where id=any(ids))<>1 then raise exception 'Cross-state orders are not supported';end if;
  if not public.retail_unified_access(p_actor,st,'edit') then raise exception using errcode='42501',message='Outside editor scope';end if;
  k:=case when p_action='CREATE_OOS' then 'OOS' else 'FAULT' end;
  if nullif(btrim(p_data->>'reference'),'') is null then raise exception 'Reference required';end if;
  if k='OOS' then
   if jsonb_typeof(p_data->'items') is distinct from 'array' or jsonb_array_length(p_data->'items')=0 or coalesce(p_data->>'file_sha256','')!~'^[a-f0-9]{64}$' or encode(sha256(decode(p_data->>'original_base64','base64')),'hex')<>p_data->>'file_sha256' then raise exception 'Quotation source, items and matching hash required';end if;
   if exists(select 1 from jsonb_array_elements(p_data->'items') i where coalesce(i->>'description','')='' or coalesce(i->>'store_id','')='' or not ((i->>'store_id')::uuid=any(ids)) or coalesce(i->>'quantity','')!~'^[0-9]+([.][0-9]+)?$' or coalesce(i->>'unit_rate','')!~'^[0-9]+([.][0-9]+)?$' or (i->>'quantity')::numeric<=0 or (i->>'unit_rate')::numeric<0) then raise exception 'Invalid quotation items';end if;
  else
   if cardinality(ids)<>1 or nullif(btrim(p_data->>'category'),'') is null or nullif(btrim(p_data->>'description'),'') is null or p_data->>'priority' not in ('LOW','MEDIUM','HIGH','CRITICAL') or p_data->>'priority' is null then raise exception 'Fault category, priority, description and one store required';end if;
  end if;
  select * into o from public.retail_service_orders where kind=k and reference=p_data->>'reference';
  if found then
   if k='OOS' and o.details->>'file_sha256'=p_data->>'file_sha256' and o.details->'items'=p_data->'items' then return jsonb_build_object('replayed',true,'order',public.retail_service_public_order(to_jsonb(o)));end if;
   raise exception 'Reference already exists; use reviewed rework without overwriting history';
  end if;
  insert into public.retail_service_orders(kind,reference,state,store_ids,status,details,created_by) values(k,p_data->>'reference',st,ids,case when k='OOS' then 'QUOTED' else 'REGISTERED' end,p_data,p_actor) returning * into o;
  insert into public.retail_service_order_stores(order_id,retail_store_id) select o.id,value from (select distinct unnest(ids) as value) s;
 else
  select * into o from public.retail_service_orders where id=p_order for update;
  if not found then raise exception 'Order not found';end if;
  if not public.retail_unified_access(p_actor,o.state,'edit') then raise exception using errcode='42501',message='Outside editor scope';end if;
  if p_revision is distinct from o.revision then raise exception using errcode='40001',message='Order changed; reload before updating';end if;
  b:=to_jsonb(o);next_stage:=o.status;
  if p_action='REWORK' then
   if o.kind<>'OOS' or o.status<>'QUOTED' then raise exception 'Rework is allowed before PO only';end if;
   fields:=array['reason','quotation_file_sha256','original_base64'];
   if coalesce(p_data->>'quotation_file_sha256','')!~'^[a-f0-9]{64}$' or encode(sha256(decode(p_data->>'original_base64','base64')),'hex')<>p_data->>'quotation_file_sha256' then raise exception 'Rework source hash mismatch';end if;
   if p_data->>'reference' is distinct from o.reference or p_data->'store_ids' is distinct from to_jsonb(o.store_ids) or jsonb_typeof(p_data->'items') is distinct from 'array' or jsonb_array_length(p_data->'items')=0 then raise exception 'Rework must retain quotation reference and stores';end if;
   if exists(select 1 from jsonb_array_elements(p_data->'items') i where coalesce(i->>'description','')='' or coalesce(i->>'store_id','')='' or not ((i->>'store_id')::uuid=any(o.store_ids)) or coalesce(i->>'quantity','')!~'^[0-9]+([.][0-9]+)?$' or coalesce(i->>'unit_rate','')!~'^[0-9]+([.][0-9]+)?$' or (i->>'quantity')::numeric<=0 or (i->>'unit_rate')::numeric<0) then raise exception 'Invalid rework items';end if;
  elsif p_action='ESCALATE' then
   if o.kind<>'FAULT' or o.status='CLOSED' then raise exception 'Only open faults can be escalated';end if;fields:=array['reason'];
  else
   stage_list:=case when o.kind='OOS' then array['QUOTED','PO_RECORDED','COMMERCIALLY_CONFIRMED','FUND_RECORDED','PAYMENT_RECORDED','DELIVERED'] else array['REGISTERED','ASSIGNED','IN_PROGRESS','RESOLVED','CLOSED'] end;
   next_stage:=stage_list[array_position(stage_list,o.status)+1];
   if next_stage is null or p_action<>next_stage then raise exception 'Only next forward stage allowed';end if;
   fields:=case p_action when 'PO_RECORDED' then array['po_number','po_date'] when 'COMMERCIALLY_CONFIRMED' then array['confirmation_ref'] when 'FUND_RECORDED' then array['fund_ref'] when 'PAYMENT_RECORDED' then array['payment_ref'] when 'DELIVERED' then array['delivery_ref','delivery_date'] when 'ASSIGNED' then array['assigned_profile_id'] when 'IN_PROGRESS' then array['remarks'] when 'RESOLVED' then array['resolution','closure_evidence_ref'] when 'CLOSED' then array['closure_evidence_ref'] end;
   if p_action in ('COMMERCIALLY_CONFIRMED','FUND_RECORDED','PAYMENT_RECORDED','CLOSED') and not public.retail_unified_access(p_actor,o.state,'review') then raise exception using errcode='42501',message='Reviewer authorization required';end if;
   if p_action='COMMERCIALLY_CONFIRMED' and o.created_by=p_actor then raise exception 'Independent commercial reviewer required';end if;
   if p_action='ASSIGNED' and not exists(select 1 from public.profiles p where p.id=(p_data->>'assigned_profile_id')::uuid and p.is_active is true and upper(coalesce(p.status,'Active'))='ACTIVE'
    and regexp_replace(upper(coalesce(p.role,'')),'[^A-Z0-9]','','g') in ('FO','FIELDOFFICER')
    and regexp_replace(upper(coalesce(p.business,'')),'[^A-Z0-9]','','g') in ('RELIANCE','RELIANCERETAIL')
    and (case when p.state in ('TN','PY') then 'TN' when p.state='KN' then 'KA' else p.state end)=(case when o.state in ('TN','PY') then 'TN' else o.state end)) then raise exception 'Verified active operational-scope FO account required';end if;
  end if;
  foreach required_field in array fields loop if nullif(btrim(p_data->>required_field),'') is null then raise exception '% is required',required_field;end if;end loop;
  foreach required_field in array array['po_date','delivery_date'] loop if p_data ? required_field then
   if p_data->>required_field!~'^[0-9]{4}-[0-9]{2}-[0-9]{2}$' then raise exception 'Valid date required';end if;perform (p_data->>required_field)::date;
  end if;end loop;
  update public.retail_service_orders set status=next_stage,revision=revision+1,rework_count=rework_count+case when p_action='REWORK' then 1 else 0 end,assigned_profile_id=case when p_action='ASSIGNED' then (p_data->>'assigned_profile_id')::uuid else assigned_profile_id end,details=details||p_data,updated_at=now() where id=o.id returning * into o;
 end if;
 insert into public.retail_service_events(order_id,request_id,actor_id,action,before_value,after_value,evidence) values(o.id,p_request,p_actor,p_action,b,to_jsonb(o),p_data);
 return jsonb_build_object('replayed',false,'order',public.retail_service_public_order(to_jsonb(o)));
end;$$;
-- All quotation groups commit or roll back together. One group cannot silently
-- disappear after a later group fails scope/reference validation.
create function public.rpc_retail_service_import(p_actor uuid,p_sha256 text,p_filename text,p_original text,p_groups jsonb) returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $$
declare g jsonb;receipts jsonb:='[]';request uuid;
begin
 if jsonb_typeof(p_groups) is distinct from 'array' or jsonb_array_length(p_groups)=0 or jsonb_array_length(p_groups)>1000 then raise exception 'Quotation groups required';end if;
 for g in select value from jsonb_array_elements(p_groups) loop
  request:=md5(p_sha256||'|'||(g->>'quotation_number')||'|'||p_actor::text)::uuid;
  receipts:=receipts||jsonb_build_array(public.rpc_retail_service_command(p_actor,request,'CREATE_OOS',null,null,jsonb_build_object('reference',g->>'quotation_number','store_ids',g->'store_ids','items',g->'items','filename',p_filename,'file_sha256',p_sha256,'original_base64',p_original)));
 end loop;
 return jsonb_build_object('quotation_groups',jsonb_array_length(p_groups),'receipts',receipts);
end;$$;
revoke all on function public.retail_service_event_immutable(),public.rpc_retail_service_snapshot(uuid),public.rpc_retail_service_command(uuid,uuid,text,uuid,integer,jsonb) from public,anon,authenticated,service_role;
revoke all on function public.retail_service_public_order(jsonb) from public,anon,authenticated,service_role;
revoke all on function public.rpc_retail_service_import(uuid,text,text,text,jsonb) from public,anon,authenticated,service_role;
grant execute on function public.rpc_retail_service_snapshot(uuid),public.rpc_retail_service_command(uuid,uuid,text,uuid,integer,jsonb) to service_role;
grant execute on function public.rpc_retail_service_import(uuid,text,text,text,jsonb) to service_role;
-- Enforce a defined group on future writes without rewriting legacy mappings.
alter table public.reliance_retail_zones add constraint retail_zones_defined_state check(state is not null and state in ('TN','PY','KA','KL','TG','AP-1','AP-2')) not valid;
create table public.retail_zone_mapping_drafts(
 id uuid primary key default gen_random_uuid(),row_id uuid not null references public.retail_provisional_rows(id) on delete restrict,
 row_revision integer not null,row_digest text not null,state text not null check(state in ('TN','PY','KA','KL','TG','AP-1','AP-2')),
 zone_id uuid references public.reliance_retail_zones(id) on delete restrict,effective_from text not null,effective_to timestamptz,
 reason text not null,proposed_by uuid not null references public.profiles(id),created_at timestamptz not null default now(),
 status text not null default 'DRAFT_PENDING_IDENTITY' check(status='DRAFT_PENDING_IDENTITY'),fingerprint text not null unique
);
alter table public.retail_zone_mapping_drafts enable row level security;
revoke all on public.retail_zone_mapping_drafts from public,anon,authenticated,service_role;
create function public.retail_zone_draft_immutable() returns trigger language plpgsql set search_path=pg_catalog,public as $$begin raise exception 'Zone mapping drafts are immutable source-bound evidence';end;$$;
create trigger retail_zone_draft_immutable before update or delete on public.retail_zone_mapping_drafts for each row execute function public.retail_zone_draft_immutable();
create function public.rpc_retail_zone_draft_save(p_actor uuid,p_row uuid,p_revision integer,p_zone uuid,p_effective_from text,p_effective_to timestamptz,p_reason text) returns jsonb
language plpgsql security definer set search_path=pg_catalog,public as $$
declare r public.retail_provisional_rows%rowtype; d public.retail_zone_mapping_drafts%rowtype; start_at timestamptz; digest text;
begin
 perform pg_advisory_xact_lock(hashtextextended('retail_unified_ownership',0));
 select * into r from public.retail_provisional_rows where id=p_row;
 if not found or not public.retail_unified_access(p_actor,r.source_state,'edit') then raise exception using errcode='42501',message='Retained source and state editor required';end if;
 if r.revision is distinct from p_revision or exists(select 1 from public.retail_provisional_files where id=r.batch_id and withdrawn_at is not null) then raise exception using errcode='40001',message='Source revision changed or withdrawn';end if;
 if exists(select 1 from public.reliance_retail_store_master where upper(btrim(store_code))=upper(btrim(r.store_code))) then raise exception 'Canonical match must use verified Store mapping proposals';end if;
 if p_zone is not null and not exists(select 1 from public.reliance_retail_zones where id=p_zone and state=r.source_state and status='Active') then raise exception 'Active same-geography zone required';end if;
 if coalesce(length(btrim(p_reason)),0) not between 3 and 2000 then raise exception 'Evidence reason required';end if;
 start_at:=case when p_effective_from='ON_ACTIVATION' then now() else p_effective_from::timestamptz end;
 if start_at is null or start_at<now()-interval '1 minute' or (p_effective_to is not null and p_effective_to<=start_at) then raise exception 'Current/future nonempty interval required';end if;
 digest:=md5(jsonb_build_array(p_actor,p_row,p_revision,r.row_digest,p_zone,p_effective_from,p_effective_to,p_reason)::text);
 select * into d from public.retail_zone_mapping_drafts where fingerprint=digest;
 if found then return jsonb_build_object('id',d.id,'replayed',true,'status',d.status,'operational_writes',0);end if;
 insert into public.retail_zone_mapping_drafts(row_id,row_revision,row_digest,state,zone_id,effective_from,effective_to,reason,proposed_by,fingerprint)
 values(r.id,r.revision,r.row_digest,r.source_state,p_zone,p_effective_from,p_effective_to,p_reason,p_actor,digest) returning * into d;
 insert into public.reliance_retail_management_audit(action,entity_type,entity_id,actor_profile_id,after_state) values('ZONE_MAPPING_DRAFT','provisional_zone_mapping',d.id,p_actor,to_jsonb(d));
 return jsonb_build_object('id',d.id,'replayed',false,'status',d.status,'operational_writes',0);
end;$$;
create function public.rpc_retail_zone_drafts(p_actor uuid) returns jsonb language sql stable security definer set search_path=pg_catalog,public as $$
select coalesce(jsonb_agg(to_jsonb(d)||jsonb_build_object('source_current',r.revision=d.row_revision and f.withdrawn_at is null,'canonical_now_exists',exists(select 1 from public.reliance_retail_store_master s where upper(btrim(s.store_code))=upper(btrim(r.store_code)))) order by d.created_at),'[]') from public.retail_zone_mapping_drafts d join public.retail_provisional_rows r on r.id=d.row_id join public.retail_provisional_files f on f.id=r.batch_id where public.retail_unified_access(p_actor,d.state,'view');
$$;
revoke all on function public.retail_zone_draft_immutable(),public.rpc_retail_zone_drafts(uuid),public.rpc_retail_zone_draft_save(uuid,uuid,integer,uuid,text,timestamptz,text) from public,anon,authenticated,service_role;
grant execute on function public.rpc_retail_zone_drafts(uuid),public.rpc_retail_zone_draft_save(uuid,uuid,integer,uuid,text,timestamptz,text) to service_role;
$retail_source$;item record;relation_name text;role_name text;row_count bigint;row_digest text;prior_digest text;after_digest text;prior_acl text;after_acl text;old_oids oid[];old_relation_oids oid[];
begin
 perform pg_advisory_xact_lock(hashtextextended('retail_unified_ownership',0));
 perform pg_advisory_xact_lock(hashtextextended('retail_uploaded_attendance',0));
 perform pg_advisory_xact_lock(hashtextextended('retail_operational_activation_install',0));
 source:=replace(source,E'\r\n',E'\n');if md5(source)<>'822536657943ff7c88b644358e870621' then raise exception 'Activation source fingerprint mismatch';end if;
 if to_regclass('supabase_migrations.schema_migrations') is null then raise exception 'Installed migration history required';end if;
 if not exists(select 1 from supabase_migrations.schema_migrations where version='20261029140000' and cardinality(statements)=1 and md5(replace(statements[1],E'\r\n',E'\n'))='0800864af23894d608e5a0d11e65f0c4') then raise exception 'Installed Unified migration fingerprint mismatch; do not rerun it';end if;
 if to_regprocedure('public.retail_unified_access(uuid,text,text)') is null or to_regprocedure('public.retail_unified_owner(uuid,timestamp with time zone)') is null then raise exception 'Installed access and effective ownership functions required';end if;
 for item in select * from (values ('profiles','id','uuid'),
('profiles','state','text'),
('profiles','is_active','boolean'),
('profiles','status','text'),
('profiles','role','text'),
('profiles','business','text'),
('reliance_retail_store_master','id','uuid'),
('reliance_retail_store_master','store_code','text'),
('reliance_retail_store_master','state','text'),
('reliance_retail_store_master','status','text'),
('reliance_retail_zones','id','uuid'),
('reliance_retail_zones','state','text'),
('reliance_retail_zones','status','text'),
('retail_provisional_rows','id','uuid'),
('retail_provisional_rows','batch_id','uuid'),
('retail_provisional_rows','source_state','text'),
('retail_provisional_rows','revision','integer'),
('retail_provisional_rows','row_digest','text'),
('retail_provisional_rows','store_code','text'),
('retail_provisional_files','id','uuid'),
('retail_provisional_files','withdrawn_at','timestamp with time zone'),
('reliance_retail_management_audit','action','text'),
('reliance_retail_management_audit','entity_type','text'),
('reliance_retail_management_audit','entity_id','uuid'),
('reliance_retail_management_audit','actor_profile_id','uuid'),
('reliance_retail_management_audit','after_state','jsonb')) v(table_name,column_name,column_type) loop
  if not exists(select 1 from pg_attribute where attrelid=to_regclass('public.'||item.table_name) and attname=item.column_name and (atttypid=to_regtype(item.column_type) or item.column_type='text' and atttypid in ('varchar'::regtype,'bpchar'::regtype)) and not attisdropped) then raise exception 'Incompatible required column %.%',item.table_name,item.column_name;end if;
 end loop;
 if exists(select 1 from public.reliance_retail_zones where state is null or state not in ('TN','PY','KA','KL','TG','AP-1','AP-2')) then raise exception 'Existing undefined Zone state requires explicit review';end if;
 if exists(select 1 from supabase_migrations.schema_migrations where version='20261030140000') then
  if not exists(select 1 from supabase_migrations.schema_migrations where version='20261030140000' and name='retail_operational_activation' and cardinality(statements)=1 and md5(replace(statements[1],E'\r\n',E'\n'))='822536657943ff7c88b644358e870621') then raise exception 'Activation migration history drift';end if;
  for item in select * from jsonb_to_recordset('[{"table":"retail_service_orders","column":"id","type":"uuid","not_null":true},{"table":"retail_service_orders","column":"kind","type":"text","not_null":true},{"table":"retail_service_orders","column":"reference","type":"text","not_null":true},{"table":"retail_service_orders","column":"state","type":"text","not_null":true},{"table":"retail_service_orders","column":"store_ids","type":"uuid[]","not_null":true},{"table":"retail_service_orders","column":"status","type":"text","not_null":true},{"table":"retail_service_orders","column":"revision","type":"integer","not_null":true},{"table":"retail_service_orders","column":"rework_count","type":"integer","not_null":true},{"table":"retail_service_orders","column":"details","type":"jsonb","not_null":true},{"table":"retail_service_orders","column":"created_by","type":"uuid","not_null":true},{"table":"retail_service_orders","column":"created_at","type":"timestamp with time zone","not_null":true},{"table":"retail_service_orders","column":"updated_at","type":"timestamp with time zone","not_null":true},{"table":"retail_service_orders","column":"assigned_profile_id","type":"uuid","not_null":false},{"table":"retail_service_events","column":"id","type":"uuid","not_null":true},{"table":"retail_service_events","column":"order_id","type":"uuid","not_null":true},{"table":"retail_service_events","column":"request_id","type":"uuid","not_null":true},{"table":"retail_service_events","column":"actor_id","type":"uuid","not_null":true},{"table":"retail_service_events","column":"action","type":"text","not_null":true},{"table":"retail_service_events","column":"before_value","type":"jsonb","not_null":false},{"table":"retail_service_events","column":"after_value","type":"jsonb","not_null":true},{"table":"retail_service_events","column":"evidence","type":"jsonb","not_null":true},{"table":"retail_service_events","column":"created_at","type":"timestamp with time zone","not_null":true},{"table":"retail_service_order_stores","column":"order_id","type":"uuid","not_null":true},{"table":"retail_service_order_stores","column":"retail_store_id","type":"uuid","not_null":true},{"table":"retail_zone_mapping_drafts","column":"id","type":"uuid","not_null":true},{"table":"retail_zone_mapping_drafts","column":"row_id","type":"uuid","not_null":true},{"table":"retail_zone_mapping_drafts","column":"row_revision","type":"integer","not_null":true},{"table":"retail_zone_mapping_drafts","column":"row_digest","type":"text","not_null":true},{"table":"retail_zone_mapping_drafts","column":"state","type":"text","not_null":true},{"table":"retail_zone_mapping_drafts","column":"zone_id","type":"uuid","not_null":false},{"table":"retail_zone_mapping_drafts","column":"effective_from","type":"text","not_null":true},{"table":"retail_zone_mapping_drafts","column":"effective_to","type":"timestamp with time zone","not_null":false},{"table":"retail_zone_mapping_drafts","column":"reason","type":"text","not_null":true},{"table":"retail_zone_mapping_drafts","column":"proposed_by","type":"uuid","not_null":true},{"table":"retail_zone_mapping_drafts","column":"created_at","type":"timestamp with time zone","not_null":true},{"table":"retail_zone_mapping_drafts","column":"status","type":"text","not_null":true},{"table":"retail_zone_mapping_drafts","column":"fingerprint","type":"text","not_null":true}]'::jsonb) as c("table" text,"column" text,"type" text,not_null boolean) loop
  if not exists(select 1 from pg_attribute where attrelid=to_regclass('public.'||item."table") and attname=item."column" and atttypid=to_regtype(item."type") and attnotnull=item.not_null and not attisdropped) then raise exception 'Target column drift: %.%',item."table",item."column";end if;
 end loop;
 for item in select * from jsonb_to_recordset('[{"signature":"public.retail_service_event_immutable()","body_md5":"e1e6489bc7f34e0a60813676a3815409","rpc":false},{"signature":"public.retail_service_public_order(jsonb)","body_md5":"33261ca49e4ace82c54ad44aa844745c","rpc":false},{"signature":"public.rpc_retail_service_snapshot(uuid)","body_md5":"bd40e5ca30d4f6fb1049891b2f257339","rpc":true},{"signature":"public.rpc_retail_service_command(uuid,uuid,text,uuid,integer,jsonb)","body_md5":"efabf57819cd99a3514da79ca8662e39","rpc":true},{"signature":"public.rpc_retail_service_import(uuid,text,text,text,jsonb)","body_md5":"d8b0498b3670eac2c4bfea497f63426c","rpc":true},{"signature":"public.retail_zone_draft_immutable()","body_md5":"60c8bfc28e8f7b5066e1ca04906c48da","rpc":false},{"signature":"public.rpc_retail_zone_draft_save(uuid,uuid,integer,uuid,text,timestamptz,text)","body_md5":"8e91db6c1a78f4634c99adf62edb5768","rpc":true},{"signature":"public.rpc_retail_zone_drafts(uuid)","body_md5":"e3d9b3738c93426dbb8ce3673350df0c","rpc":true}]'::jsonb) as f(signature text,body_md5 text,rpc boolean) loop
  if not exists(select 1 from pg_proc where oid=to_regprocedure(item.signature) and prosecdef=item.rpc and md5(replace(prosrc,E'\r\n',E'\n'))=item.body_md5 and exists(select 1 from unnest(proconfig) cfg where regexp_replace(cfg,'[[:space:]]','','g')='search_path=pg_catalog,public')) then raise exception 'Installed function drift: %',item.signature;end if;
  if has_function_privilege('anon',item.signature,'EXECUTE') or has_function_privilege('authenticated',item.signature,'EXECUTE') or has_function_privilege('service_role',item.signature,'EXECUTE') is distinct from item.rpc then raise exception 'RPC/helper privilege mismatch: %',item.signature;end if;
 end loop;
 foreach relation_name in array array['retail_service_orders','retail_service_events','retail_service_order_stores','retail_zone_mapping_drafts'] loop
  if not exists(select 1 from pg_class where oid=to_regclass('public.'||relation_name) and relrowsecurity) then raise exception 'RLS/table missing: %',relation_name;end if;
  foreach role_name in array array['anon','authenticated','service_role'] loop
   if has_table_privilege(role_name,'public.'||relation_name,'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER') then raise exception 'Direct table privilege detected: % %',relation_name,role_name;end if;
  end loop;
 end loop;
 if not exists(select 1 from pg_constraint where conrelid='public.retail_service_order_stores'::regclass and confrelid='public.reliance_retail_store_master'::regclass and contype='f' and confdeltype='r') then raise exception 'Canonical Store foreign key protection missing';end if;
 if not exists(select 1 from pg_constraint where conname='retail_zones_defined_state' and conrelid='public.reliance_retail_zones'::regclass) then raise exception 'Defined Zone state constraint missing';end if;
  raise notice 'Activation package already installed exactly; no writes performed';return;
 end if;
 foreach relation_name in array array['retail_service_orders','retail_service_events','retail_service_order_stores','retail_zone_mapping_drafts'] loop if to_regclass('public.'||relation_name) is not null then raise exception 'Unrecorded/partial existing object: %. Stop and reconcile; nothing overwritten',relation_name;end if;end loop;
 if exists(select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and (p.proname like 'rpc_retail_service_%' or p.proname like 'retail_service_%' or p.proname like 'rpc_retail_zone_draft%' or p.proname='retail_zone_draft_immutable')) then raise exception 'Unrecorded target function exists; review before installation';end if;
 create temporary table retail_activation_protected(name text primary key,rows bigint,digest text) on commit drop;
 foreach relation_name in array array['reliance_retail_store_master','reliance_retail_zones','reliance_retail_zone_fo_assignments','reliance_retail_store_zone_history','retail_employee_daily_attendance','retail_attendance_uploads','retail_attendance_aop_versions','retail_store_import_approvals','retail_store_import_batches','retail_store_import_events','retail_provisional_rows','retail_provisional_files','retail_provisional_events','retail_provisional_proposals','retail_provisional_access','client_deep_cleaning_submissions','client_deep_cleaning_uploads','client_deep_cleaning_schedules','training_sessions','training_evidence','training_events','profiles'] loop
  if to_regclass('public.'||relation_name) is not null then
   execute format('lock table public.%I in share mode',relation_name);
   execute format('select count(*),md5(coalesce(jsonb_agg(to_jsonb(x) order by to_jsonb(x)::text),''[]''::jsonb)::text) from public.%I x',relation_name) into row_count,row_digest;
   insert into retail_activation_protected values(relation_name,row_count,row_digest);
  end if;
 end loop;
 select array_agg(p.oid order by p.oid),md5(string_agg(pg_get_functiondef(p.oid)||p.proowner::text||coalesce(p.proacl::text,''),E'\n' order by p.oid)) into old_oids,prior_digest from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.prokind='f';
 select array_agg(c.oid order by c.oid),md5(string_agg(c.oid::text||c.relrowsecurity::text||c.relforcerowsecurity::text||coalesce(c.relacl::text,''),E'\n' order by c.oid)) into old_relation_oids,prior_acl from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public';
 execute source;
 foreach relation_name in array array['reliance_retail_store_master','reliance_retail_zones','reliance_retail_zone_fo_assignments','reliance_retail_store_zone_history','retail_employee_daily_attendance','retail_attendance_uploads','retail_attendance_aop_versions','retail_store_import_approvals','retail_store_import_batches','retail_store_import_events','retail_provisional_rows','retail_provisional_files','retail_provisional_events','retail_provisional_proposals','retail_provisional_access','client_deep_cleaning_submissions','client_deep_cleaning_uploads','client_deep_cleaning_schedules','training_sessions','training_evidence','training_events','profiles'] loop
  if to_regclass('public.'||relation_name) is not null then
   execute format('lock table public.%I in share mode',relation_name);
   execute format('select count(*),md5(coalesce(jsonb_agg(to_jsonb(x) order by to_jsonb(x)::text),''[]''::jsonb)::text) from public.%I x',relation_name) into row_count,row_digest;
   if not exists(select 1 from retail_activation_protected where name=relation_name and rows=row_count and digest=row_digest) then raise exception 'Protected data changed: %',relation_name;end if;
  end if;
 end loop;
 select md5(string_agg(pg_get_functiondef(p.oid)||p.proowner::text||coalesce(p.proacl::text,''),E'\n' order by p.oid)) into after_digest from pg_proc p where p.oid=any(old_oids);
 if after_digest is distinct from prior_digest then raise exception 'Existing function definition/ACL changed; rolling back';end if;
 -- Compare existing relation security, excluding newly-created objects/indexes.
 select md5(string_agg(c.oid::text||c.relrowsecurity::text||c.relforcerowsecurity::text||coalesce(c.relacl::text,''),E'\n' order by c.oid)) into after_acl from pg_class c where c.oid=any(old_relation_oids);
 if after_acl is distinct from prior_acl then raise exception 'Existing relation security changed; rolling back';end if;
 for item in select * from jsonb_to_recordset('[{"table":"retail_service_orders","column":"id","type":"uuid","not_null":true},{"table":"retail_service_orders","column":"kind","type":"text","not_null":true},{"table":"retail_service_orders","column":"reference","type":"text","not_null":true},{"table":"retail_service_orders","column":"state","type":"text","not_null":true},{"table":"retail_service_orders","column":"store_ids","type":"uuid[]","not_null":true},{"table":"retail_service_orders","column":"status","type":"text","not_null":true},{"table":"retail_service_orders","column":"revision","type":"integer","not_null":true},{"table":"retail_service_orders","column":"rework_count","type":"integer","not_null":true},{"table":"retail_service_orders","column":"details","type":"jsonb","not_null":true},{"table":"retail_service_orders","column":"created_by","type":"uuid","not_null":true},{"table":"retail_service_orders","column":"created_at","type":"timestamp with time zone","not_null":true},{"table":"retail_service_orders","column":"updated_at","type":"timestamp with time zone","not_null":true},{"table":"retail_service_orders","column":"assigned_profile_id","type":"uuid","not_null":false},{"table":"retail_service_events","column":"id","type":"uuid","not_null":true},{"table":"retail_service_events","column":"order_id","type":"uuid","not_null":true},{"table":"retail_service_events","column":"request_id","type":"uuid","not_null":true},{"table":"retail_service_events","column":"actor_id","type":"uuid","not_null":true},{"table":"retail_service_events","column":"action","type":"text","not_null":true},{"table":"retail_service_events","column":"before_value","type":"jsonb","not_null":false},{"table":"retail_service_events","column":"after_value","type":"jsonb","not_null":true},{"table":"retail_service_events","column":"evidence","type":"jsonb","not_null":true},{"table":"retail_service_events","column":"created_at","type":"timestamp with time zone","not_null":true},{"table":"retail_service_order_stores","column":"order_id","type":"uuid","not_null":true},{"table":"retail_service_order_stores","column":"retail_store_id","type":"uuid","not_null":true},{"table":"retail_zone_mapping_drafts","column":"id","type":"uuid","not_null":true},{"table":"retail_zone_mapping_drafts","column":"row_id","type":"uuid","not_null":true},{"table":"retail_zone_mapping_drafts","column":"row_revision","type":"integer","not_null":true},{"table":"retail_zone_mapping_drafts","column":"row_digest","type":"text","not_null":true},{"table":"retail_zone_mapping_drafts","column":"state","type":"text","not_null":true},{"table":"retail_zone_mapping_drafts","column":"zone_id","type":"uuid","not_null":false},{"table":"retail_zone_mapping_drafts","column":"effective_from","type":"text","not_null":true},{"table":"retail_zone_mapping_drafts","column":"effective_to","type":"timestamp with time zone","not_null":false},{"table":"retail_zone_mapping_drafts","column":"reason","type":"text","not_null":true},{"table":"retail_zone_mapping_drafts","column":"proposed_by","type":"uuid","not_null":true},{"table":"retail_zone_mapping_drafts","column":"created_at","type":"timestamp with time zone","not_null":true},{"table":"retail_zone_mapping_drafts","column":"status","type":"text","not_null":true},{"table":"retail_zone_mapping_drafts","column":"fingerprint","type":"text","not_null":true}]'::jsonb) as c("table" text,"column" text,"type" text,not_null boolean) loop
  if not exists(select 1 from pg_attribute where attrelid=to_regclass('public.'||item."table") and attname=item."column" and atttypid=to_regtype(item."type") and attnotnull=item.not_null and not attisdropped) then raise exception 'Target column drift: %.%',item."table",item."column";end if;
 end loop;
 for item in select * from jsonb_to_recordset('[{"signature":"public.retail_service_event_immutable()","body_md5":"e1e6489bc7f34e0a60813676a3815409","rpc":false},{"signature":"public.retail_service_public_order(jsonb)","body_md5":"33261ca49e4ace82c54ad44aa844745c","rpc":false},{"signature":"public.rpc_retail_service_snapshot(uuid)","body_md5":"bd40e5ca30d4f6fb1049891b2f257339","rpc":true},{"signature":"public.rpc_retail_service_command(uuid,uuid,text,uuid,integer,jsonb)","body_md5":"efabf57819cd99a3514da79ca8662e39","rpc":true},{"signature":"public.rpc_retail_service_import(uuid,text,text,text,jsonb)","body_md5":"d8b0498b3670eac2c4bfea497f63426c","rpc":true},{"signature":"public.retail_zone_draft_immutable()","body_md5":"60c8bfc28e8f7b5066e1ca04906c48da","rpc":false},{"signature":"public.rpc_retail_zone_draft_save(uuid,uuid,integer,uuid,text,timestamptz,text)","body_md5":"8e91db6c1a78f4634c99adf62edb5768","rpc":true},{"signature":"public.rpc_retail_zone_drafts(uuid)","body_md5":"e3d9b3738c93426dbb8ce3673350df0c","rpc":true}]'::jsonb) as f(signature text,body_md5 text,rpc boolean) loop
  if not exists(select 1 from pg_proc where oid=to_regprocedure(item.signature) and prosecdef=item.rpc and md5(replace(prosrc,E'\r\n',E'\n'))=item.body_md5 and exists(select 1 from unnest(proconfig) cfg where regexp_replace(cfg,'[[:space:]]','','g')='search_path=pg_catalog,public')) then raise exception 'Installed function drift: %',item.signature;end if;
  if has_function_privilege('anon',item.signature,'EXECUTE') or has_function_privilege('authenticated',item.signature,'EXECUTE') or has_function_privilege('service_role',item.signature,'EXECUTE') is distinct from item.rpc then raise exception 'RPC/helper privilege mismatch: %',item.signature;end if;
 end loop;
 foreach relation_name in array array['retail_service_orders','retail_service_events','retail_service_order_stores','retail_zone_mapping_drafts'] loop
  if not exists(select 1 from pg_class where oid=to_regclass('public.'||relation_name) and relrowsecurity) then raise exception 'RLS/table missing: %',relation_name;end if;
  foreach role_name in array array['anon','authenticated','service_role'] loop
   if has_table_privilege(role_name,'public.'||relation_name,'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER') then raise exception 'Direct table privilege detected: % %',relation_name,role_name;end if;
  end loop;
 end loop;
 if not exists(select 1 from pg_constraint where conrelid='public.retail_service_order_stores'::regclass and confrelid='public.reliance_retail_store_master'::regclass and contype='f' and confdeltype='r') then raise exception 'Canonical Store foreign key protection missing';end if;
 if not exists(select 1 from pg_constraint where conname='retail_zones_defined_state' and conrelid='public.reliance_retail_zones'::regclass) then raise exception 'Defined Zone state constraint missing';end if;
 insert into supabase_migrations.schema_migrations(version,name,statements) values('20261030140000','retail_operational_activation',array[source]);
 perform pg_notify('pgrst','reload schema');
 raise notice 'Installed activation package 20261030140000; protected data and existing security unchanged';
end;$install$;
commit;
