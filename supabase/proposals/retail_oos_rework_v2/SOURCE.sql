create function public.rpc_retail_service_rework_v2(p_actor uuid,p_request uuid,p_action text,p_order uuid,p_revision integer,p_data jsonb) returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $$
declare o public.retail_service_orders%rowtype;b jsonb;e public.retail_service_events%rowtype;ids uuid[];st text;next_stage text;required_field text;fields text[];stage_list text[];k text;allowed_fields text[];
begin
 if p_action is distinct from 'REWORK' then raise exception 'Only status-preserving quotation rework is supported';end if;
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
   if o.kind<>'OOS' then raise exception 'Only OOS quotations support rework';end if;
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
revoke all on function public.rpc_retail_service_rework_v2(uuid,uuid,text,uuid,integer,jsonb) from public,anon,authenticated,service_role;
grant execute on function public.rpc_retail_service_rework_v2(uuid,uuid,text,uuid,integer,jsonb) to service_role;
