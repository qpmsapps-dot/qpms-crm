-- NEW PROPOSAL ONLY. Not installed. Requires explicit production authorization.
-- Production: use retail_operational_activation/01, 02 and 03 in order; this bare
-- source is for review/local tests, not a separately repeatable installation.
-- Tracking references only: never posts payments, financial entries or inventory.
begin;
create table public.retail_service_orders(
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
commit;
