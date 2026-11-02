-- PREPARED ONLY. Version 2 is disabled on installation. No role or state grants.
-- Separate private versioned ledgers prevent legacy Admin RPCs reaching v2 orders.
begin;
set local lock_timeout='5s';set local statement_timeout='60s';
do $$begin
 if not exists(select 1 from public.retail_oos_workflow_catalog where version=2 and not enabled and jsonb_array_length(stages)=12) then raise exception 'Reviewed disabled catalog required';end if;
 if to_regprocedure('public.retail_mis_oos_order_allowed(uuid,uuid,boolean)') is null then raise exception 'Protected MIS baseline missing';end if;
end;$$;
alter table public.retail_oos_workflow_catalog drop constraint retail_oos_workflow_catalog_enabled_check;
alter table public.retail_oos_workflow_catalog add column revision integer not null default 0;
create function public.retail_oos12_catalog_guard() returns trigger language plpgsql security definer set search_path=pg_catalog,public as $$begin
 if tg_op<>'UPDATE' then raise exception 'Workflow catalog is immutable';end if;
 if (to_jsonb(new)-'enabled'-'revision')<>(to_jsonb(old)-'enabled'-'revision') or new.revision<>old.revision+1 or new.enabled=old.enabled
 or not exists(select 1 from public.retail_mis_audit a where a.action='OOS12_ACTIVATION' and a.before_value=to_jsonb(old) and a.after_value=to_jsonb(new) and a.xmin=pg_current_xact_id()::text::xid) then raise exception 'Audited workflow activation required; catalog immutable';end if;
 return new;end;$$;
drop trigger retail_oos_workflow_catalog_immutable on public.retail_oos_workflow_catalog;
create trigger retail_oos_workflow_catalog_immutable before update or delete on public.retail_oos_workflow_catalog for each row execute function public.retail_oos12_catalog_guard();

create table public.retail_oos12_orders(
 id uuid primary key default gen_random_uuid(),kind text not null default 'OOS' check(kind='OOS'),workflow_version integer not null default 2 check(workflow_version=2),
 reference text not null unique,state text not null check(state in ('TN','KA','KL','TG','AP-1','AP-2','PY')),store_ids uuid[] not null check(cardinality(store_ids)>0),
 stage integer not null default 1 check(stage between 1 and 12),status text not null,revision integer not null default 1,rework_count integer not null default 0,
 details jsonb not null,original_items jsonb not null,created_by uuid not null references public.profiles(id),created_at timestamptz not null default clock_timestamp(),updated_at timestamptz not null default clock_timestamp(),status_entered_at timestamptz not null default clock_timestamp(),
 check(status=(array['OOS12_QUOTATION_SHARED','OOS12_PO_PENDING_COMMERCIAL','OOS12_PO_RECEIVED','OOS12_FUND_RAISED','OOS12_FUND_DELIVERED','OOS12_FUND_RECEIVED','OOS12_WIP','OOS12_WORK_DONE','OOS12_DOCUMENT_SUBMITTED','OOS12_DOCUMENT_RECEIVED','OOS12_JMS_CREATED','OOS12_INVOICE_RAISED'])[stage])
);
create table public.retail_oos12_order_stores(order_id uuid not null references public.retail_oos12_orders(id) on delete restrict,retail_store_id uuid not null references public.reliance_retail_store_master(id) on delete restrict,primary key(order_id,retail_store_id));
create table public.retail_oos12_events(
 id uuid primary key default gen_random_uuid(),order_id uuid not null references public.retail_oos12_orders(id) on delete restrict,request_id uuid not null unique,
 actor_id uuid not null references public.profiles(id),action text not null,before_value jsonb,after_value jsonb not null,evidence jsonb not null,created_at timestamptz not null default clock_timestamp()
);
create index retail_oos12_events_order_time on public.retail_oos12_events(order_id,created_at,id);
create table public.retail_oos12_evidence(
 id uuid primary key default gen_random_uuid(),order_id uuid not null references public.retail_oos12_orders(id),actor_id uuid not null references public.profiles(id),
 stage integer not null check(stage between 2 and 12),revision integer not null,filename text not null,mime_type text not null,file_size bigint not null check(file_size between 1 and 15728640),
 path text not null unique,status text not null default 'prepared' check(status in ('prepared','finalized')),created_at timestamptz not null default clock_timestamp(),finalized_at timestamptz
);
create table public.retail_oos12_import_receipts(reference text not null,sha256 text not null,actor_id uuid not null references public.profiles(id),payload jsonb not null,order_id uuid not null references public.retail_oos12_orders(id),primary key(reference,sha256));
do $$declare t text;begin foreach t in array array['retail_oos12_orders','retail_oos12_order_stores','retail_oos12_events','retail_oos12_evidence','retail_oos12_import_receipts'] loop
 execute format('alter table public.%I enable row level security',t);execute format('revoke all on public.%I from public,anon,authenticated,service_role',t);end loop;end;$$;
create trigger retail_oos12_events_immutable before update or delete on public.retail_oos12_events for each row execute function public.retail_mis_immutable();
create trigger retail_oos12_links_immutable before update or delete on public.retail_oos12_order_stores for each row execute function public.retail_mis_immutable();
create trigger retail_oos12_receipts_immutable before update or delete on public.retail_oos12_import_receipts for each row execute function public.retail_mis_immutable();
create function public.retail_oos12_reference_guard() returns trigger language plpgsql security definer set search_path=pg_catalog,public as $$begin
 if new.kind='OOS' then
 perform pg_advisory_xact_lock(hashtextextended('retail_service_orders',0));
 if (tg_table_name='retail_service_orders' and exists(select 1 from public.retail_oos12_orders where reference=new.reference))
 or (tg_table_name='retail_oos12_orders' and exists(select 1 from public.retail_service_orders where kind='OOS' and reference=new.reference)) then raise exception 'Quotation reference exists in another workflow version';end if;
 end if;return new;end;$$;
create trigger retail_oos12_legacy_reference_guard before insert on public.retail_service_orders for each row execute function public.retail_oos12_reference_guard();
create trigger retail_oos12_reference_guard before insert on public.retail_oos12_orders for each row execute function public.retail_oos12_reference_guard();

create function public.retail_oos12_identity(p_actor uuid) returns boolean language sql stable security definer set search_path=pg_catalog,public as $$
 select exists(select 1 from public.profiles p where p.id=p_actor and p.is_active is true and p.web_access_enabled is true and upper(coalesce(p.status,'Active'))='ACTIVE'
 and exists(select 1 from auth.users u where u.id=p.auth_user_id) and (select count(*) from public.profiles d where d.auth_user_id=p.auth_user_id)=1);
$$;
create function public.retail_oos12_authority(p_actor uuid,p_state text,p_authority text) returns boolean language sql stable security definer set search_path=pg_catalog,public as $$
 select public.retail_oos12_identity(p_actor) and case when p_authority='mis' then public.retail_mis_allowed(p_actor,'oos',p_state,true) else exists(
 select 1 from public.profiles p where p.id=p_actor and regexp_replace(upper(coalesce(p.business,'')),'[^A-Z0-9]','','g') in ('RELIANCE','RELIANCERETAIL')
 and regexp_replace(upper(coalesce(p.role,'')),'[^A-Z0-9]','','g')=any(case p_authority
 when 'commercial' then array['COMMERCIAL','COMMERCIALTEAM','COMMERCIALREVIEWER']
 when 'finance' then array['FINANCE','FINANCETEAM','FINANCEREVIEWER','FINANCEGM','CFO']
 when 'branch' then array['BRANCHHEAD'] when 'operations' then array['OPERATIONS','OPERATIONSTEAM','OPERATIONSMANAGER'] else '{}'::text[] end)
 and exists(select 1 from public.retail_provisional_access a where a.actor_id=p.id and a.state=p_state and
 case when p_authority in ('commercial','finance') then a.permission='reviewer' else a.permission in ('editor','reviewer') end)) end;
$$;
create function public.retail_oos12_scope(p_actor uuid,p_state text) returns boolean language sql stable security definer set search_path=pg_catalog,public as $$
 select public.retail_oos12_authority(p_actor,p_state,'mis') or exists(select 1 from unnest(array['commercial','finance','branch','operations']) a where public.retail_oos12_authority(p_actor,p_state,a));
$$;
create function public.retail_oos12_order_allowed(p_actor uuid,p_order uuid) returns boolean language sql stable security definer set search_path=pg_catalog,public as $$
 select exists(select 1 from public.retail_oos12_orders o where o.id=p_order and public.retail_oos12_scope(p_actor,o.state)
 and cardinality(o.store_ids)=(select count(*) from public.reliance_retail_store_master s where s.id=any(o.store_ids) and s.state=o.state and public.retail_mis_unique_store(s.id)));
$$;
create function public.retail_oos12_enabled() returns boolean language sql stable security definer set search_path=pg_catalog,public as $$select coalesce((select enabled from public.retail_oos_workflow_catalog where version=2),false) and public.retail_mis_oos_enabled()$$;
create function public.rpc_retail_oos12_activate(p_actor uuid,p_enabled boolean,p_reason text,p_expected integer) returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $$
declare c public.retail_oos_workflow_catalog%rowtype;n public.retail_oos_workflow_catalog%rowtype;st text;authority text;begin
 if not public.retail_oos12_identity(p_actor) or not public.retail_oos_operator_allowed(p_actor,null) or p_actor<>'d40c2b3f-87f1-4c34-8798-cf9b0d9ca784'::uuid then raise exception using errcode='42501',message='Exact existing operator required for audited activation';end if;
 if p_enabled is null or length(btrim(coalesce(p_reason,''))) not between 3 and 2000 then raise exception 'Activation reason required';end if;
 if p_enabled and not public.retail_mis_oos_enabled() then raise exception 'Existing database gate must already be enabled';end if;
 if p_enabled then
 for st in select s from unnest(array['TN','KA','KL','TG','AP-1','AP-2','PY']) s where public.retail_oos12_authority(p_actor,s,'mis') loop
 foreach authority in array array['commercial','finance','branch','operations'] loop
 if not exists(select 1 from public.profiles p where public.retail_oos12_authority(p.id,st,authority)) then raise exception 'Missing % authority for state %; activation blocked',authority,st;end if;
 end loop;end loop;end if;
 select * into strict c from public.retail_oos_workflow_catalog where version=2 for update;
 if c.revision is distinct from p_expected or c.enabled=p_enabled then raise exception using errcode='40001',message='Activation revision/state changed';end if;
 n:=c;n.enabled:=p_enabled;n.revision:=c.revision+1;
 insert into public.retail_mis_audit(actor_id,action,reason,before_value,after_value) values(p_actor,'OOS12_ACTIVATION',p_reason,to_jsonb(c),to_jsonb(n));
 update public.retail_oos_workflow_catalog set enabled=n.enabled,revision=n.revision where version=2;return to_jsonb(n);
end;$$;

create function public.retail_oos12_spec(p_stage integer) returns jsonb language sql immutable set search_path=pg_catalog,public as $$
 select jsonb_build_object('authority',(array['mis','mis','commercial','mis','finance','branch','branch','operations','mis','commercial','commercial','commercial'])[p_stage],
 'fields',case p_stage
 when 2 then '["po_number","po_date"]'::jsonb when 3 then '["confirmation_ref"]'::jsonb
 when 4 then '["fund_request_ref","fund_request_date","fund_request_amount"]'::jsonb when 5 then '["payment_ref","payment_date","payment_amount"]'::jsonb
 when 6 then '["receipt_ref","receipt_date"]'::jsonb when 7 then '["handover_ref","handover_date"]'::jsonb
 when 8 then '["work_completion_ref","completion_date"]'::jsonb when 9 then '["documents_ref","submission_date"]'::jsonb
 when 10 then '["acknowledgement_ref","received_date"]'::jsonb when 11 then '["jms_number","jms_date"]'::jsonb
 when 12 then '["invoice_number","invoice_date","invoice_amount"]'::jsonb else '[]'::jsonb end,'minimum_evidence',case when p_stage between 2 and 12 then 1 else 0 end);
$$;
create function public.retail_oos12_can_advance(p_actor uuid,p_order uuid) returns boolean language sql stable security definer set search_path=pg_catalog,public as $$
 select exists(select 1 from public.retail_oos12_orders o where o.id=p_order and o.stage<12 and public.retail_oos12_order_allowed(p_actor,o.id)
 and public.retail_oos12_authority(p_actor,o.state,public.retail_oos12_spec(o.stage+1)->>'authority')
 and (o.stage+1<>3 or (o.created_by<>p_actor
 and p_actor is distinct from (select e.actor_id from public.retail_oos12_events e where e.order_id=o.id and e.action in ('CREATE_OOS','REWORK') order by e.created_at desc,e.id desc limit 1)
 and p_actor is distinct from (select e.actor_id from public.retail_oos12_events e where e.order_id=o.id and e.action='OOS12_PO_PENDING_COMMERCIAL' order by e.created_at desc,e.id desc limit 1)))
 and (o.stage+1<>5 or (o.created_by<>p_actor and p_actor is distinct from (select e.actor_id from public.retail_oos12_events e where e.order_id=o.id and e.action='OOS12_FUND_RAISED' order by e.created_at desc,e.id desc limit 1))));
$$;
create function public.rpc_retail_oos12_access(p_actor uuid,p_auth uuid) returns jsonb language sql stable security definer set search_path=pg_catalog,public as $$
 select case when public.retail_oos12_identity(p_actor) and exists(select 1 from public.profiles where id=p_actor and auth_user_id=p_auth)
 and exists(select 1 from unnest(array['TN','KA','KL','TG','AP-1','AP-2','PY']) s where public.retail_oos12_scope(p_actor,s))
 then jsonb_build_object('active',true,'role','MIS_OOS','specialist',true,'profile_id',p_actor,'states',(select jsonb_agg(s) from unnest(array['TN','KA','KL','TG','AP-1','AP-2','PY']) s where public.retail_oos12_scope(p_actor,s))) else '{}'::jsonb end;
$$;

insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types) values('retail-oos12-evidence','retail-oos12-evidence',false,15728640,array['application/pdf','image/jpeg','image/png','application/vnd.openxmlformats-officedocument.spreadsheetml.sheet','application/vnd.openxmlformats-officedocument.wordprocessingml.document']);
create function public.retail_oos12_evidence_guard() returns trigger language plpgsql set search_path=pg_catalog,public as $$begin
 if tg_op<>'UPDATE' or old.status<>'prepared' or new.status<>'finalized' or new.finalized_at is null or
 (to_jsonb(new)-'status'-'finalized_at')<>(to_jsonb(old)-'status'-'finalized_at') then raise exception 'OOS evidence immutable';end if;return new;end;$$;
create trigger retail_oos12_evidence_immutable before update or delete on public.retail_oos12_evidence for each row execute function public.retail_oos12_evidence_guard();
create function public.retail_oos12_storage_guard() returns trigger language plpgsql security definer set search_path=pg_catalog,public as $$begin
 if (case when tg_op='DELETE' then old.bucket_id else new.bucket_id end)='retail-oos12-evidence' or (tg_op='UPDATE' and old.bucket_id='retail-oos12-evidence') then
 if tg_op<>'INSERT' then raise exception using errcode='42501',message='OOS evidence objects cannot be changed or deleted';end if;
 if not exists(select 1 from public.retail_oos12_evidence e where e.path=new.name and e.status='prepared' and public.retail_oos12_enabled() and public.retail_oos12_can_advance(e.actor_id,e.order_id) and e.file_size=(new.metadata->>'size')::bigint and e.mime_type=new.metadata->>'mimetype'
 and exists(select 1 from public.retail_oos12_orders o where o.id=e.order_id and o.revision=e.revision and o.stage+1=e.stage)) then raise exception using errcode='42501',message='Verified current OOS evidence intent required';end if;
 end if;return case when tg_op='DELETE' then old else new end;end;$$;
create trigger retail_oos12_storage_guard before insert or update or delete on storage.objects for each row execute function public.retail_oos12_storage_guard();
create policy retail_oos12_private_insert on storage.objects as restrictive for insert to authenticated with check(bucket_id<>'retail-oos12-evidence');
create policy retail_oos12_private_read on storage.objects as restrictive for select to authenticated using(bucket_id<>'retail-oos12-evidence');
create policy retail_oos12_private_update on storage.objects as restrictive for update to authenticated using(bucket_id<>'retail-oos12-evidence') with check(bucket_id<>'retail-oos12-evidence');
create policy retail_oos12_private_delete on storage.objects as restrictive for delete to authenticated using(bucket_id<>'retail-oos12-evidence');

create function public.rpc_retail_oos12_evidence_prepare(p_actor uuid,p_order uuid,p_revision integer,p_filename text,p_mime text,p_size bigint) returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $$
declare o public.retail_oos12_orders%rowtype;e public.retail_oos12_evidence%rowtype;eid uuid:=gen_random_uuid();begin
 if not public.retail_oos12_enabled() then raise exception using errcode='42501',message='Twelve-stage writes disabled';end if;
 if not public.retail_oos12_order_allowed(p_actor,p_order) then raise exception using errcode='42501',message='Order outside scope';end if;
 select * into strict o from public.retail_oos12_orders where id=p_order for update;
 if not public.retail_oos12_can_advance(p_actor,p_order) then raise exception using errcode='42501',message='Next-stage authority required';end if;
 if o.revision is distinct from p_revision then raise exception using errcode='40001',message='Revision changed; refresh';end if;
 if p_size is null or p_size not between 1 and 15728640 or p_mime is null or p_mime<>all(array['application/pdf','image/jpeg','image/png','application/vnd.openxmlformats-officedocument.spreadsheetml.sheet','application/vnd.openxmlformats-officedocument.wordprocessingml.document']) or length(btrim(coalesce(p_filename,''))) not between 1 and 200 then raise exception 'Supported filename, MIME and size required';end if;
 insert into public.retail_oos12_evidence(id,order_id,actor_id,stage,revision,filename,mime_type,file_size,path) values(eid,o.id,p_actor,o.stage+1,o.revision,p_filename,p_mime,p_size,o.id::text||'/'||eid::text) returning * into e;
 return to_jsonb(e);end;$$;
create function public.rpc_retail_oos12_evidence_object(p_actor uuid,p_evidence uuid,p_finalize boolean default false) returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $$
declare e public.retail_oos12_evidence%rowtype;begin
 select * into e from public.retail_oos12_evidence where id=p_evidence for update;
 if not found or not public.retail_oos12_order_allowed(p_actor,e.order_id) then raise exception using errcode='42501',message='Evidence outside scope';end if;
 if p_finalize then
 if not public.retail_oos12_enabled() or e.actor_id<>p_actor or not public.retail_oos12_can_advance(p_actor,e.order_id) or not exists(select 1 from public.retail_oos12_orders o where o.id=e.order_id and o.revision=e.revision and o.stage+1=e.stage) then raise exception using errcode='42501',message='Current upload authority required';end if;
 if not exists(select 1 from storage.objects s where s.bucket_id='retail-oos12-evidence' and s.name=e.path and s.metadata->>'mimetype'=e.mime_type and (s.metadata->>'size')::bigint=e.file_size) then raise exception 'Stored evidence metadata mismatch';end if;
 if e.status='prepared' then update public.retail_oos12_evidence set status='finalized',finalized_at=clock_timestamp() where id=e.id returning * into e;end if;
 elsif e.status<>'finalized' or not exists(select 1 from public.retail_oos12_events v where v.order_id=e.order_id and v.evidence->'evidence_ids' ? e.id::text) then raise exception using errcode='42501',message='Only committed evidence may be viewed';end if;
 return to_jsonb(e);end;$$;

create function public.rpc_retail_oos12_transition(p_actor uuid,p_order uuid,p_action text,p_revision integer,p_request uuid,p_fields jsonb,p_evidence uuid[],p_remarks text) returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $$
declare o public.retail_oos12_orders%rowtype;e public.retail_oos12_events%rowtype;b jsonb;spec jsonb;code text;k text;v text;payload jsonb;changed_at timestamptz;today date:=(clock_timestamp() at time zone 'Asia/Kolkata')::date;begin
 if not public.retail_oos12_enabled() then raise exception using errcode='42501',message='Twelve-stage writes disabled';end if;
 if p_request is null or not public.retail_oos12_order_allowed(p_actor,p_order) then raise exception using errcode='42501',message='Verified order scope and request required';end if;
 if p_fields is null or jsonb_typeof(p_fields)<>'object' or length(btrim(coalesce(p_remarks,''))) not between 3 and 2000 or p_revision is null then raise exception 'Fields, revision and remarks required';end if;
 select * into strict o from public.retail_oos12_orders where id=p_order for update;
 perform pg_advisory_xact_lock(hashtextextended('oos12-request:'||p_request::text,0));
 payload:=jsonb_build_object('fields',p_fields,'evidence_ids',to_jsonb(p_evidence),'remarks',p_remarks,'expected_revision',p_revision);
 select * into e from public.retail_oos12_events where request_id=p_request;
 if found then
 if e.actor_id<>p_actor or e.order_id<>p_order or e.action<>p_action or e.evidence<>payload then raise exception 'Request ID reused with different command';end if;
 -- Revalidate original stage authority even after forward progress; revoked accounts cannot replay.
 if not public.retail_oos12_authority(p_actor,o.state,public.retail_oos12_spec((e.after_value->>'stage')::integer)->>'authority') then raise exception using errcode='42501',message='Replay authority revoked';end if;
 return jsonb_build_object('replayed',true,'order',public.retail_service_public_order(e.after_value));end if;
 if o.revision is distinct from p_revision then raise exception using errcode='40001',message='Revision changed; refresh';end if;
 code:=(select stages->o.stage->>'code' from public.retail_oos_workflow_catalog where version=2);
 if o.stage>=12 or p_action is distinct from code then raise exception 'Only next forward workflow stage allowed; no backward/skipped transition';end if;
 if not public.retail_oos12_can_advance(p_actor,p_order) then raise exception using errcode='42501',message='Independent next-stage authority required';end if;
 spec:=public.retail_oos12_spec(o.stage+1);
 if exists(select 1 from jsonb_object_keys(p_fields) key where not(spec->'fields' ? key)) then raise exception 'Unrelated update field';end if;
 for k in select jsonb_array_elements_text(spec->'fields') loop
 v:=p_fields->>k;if jsonb_typeof(p_fields->k)<>'string' or length(btrim(coalesce(v,''))) not between 1 and 2000 then raise exception 'Required field missing/invalid: %',k;end if;
 if k like '%date' then
 if v!~'^\d{4}-\d{2}-\d{2}$' or v::date>today or to_char(v::date,'YYYY-MM-DD')<>v then raise exception 'Valid non-future business date required: %',k;end if;
 elsif k like '%amount' and (v!~'^[0-9]{1,18}([.][0-9]{1,2})?$' or v::numeric<=0) then raise exception 'Positive exact decimal amount with at most 2 decimals required: %',k;end if;
 end loop;
 if p_evidence is null or cardinality(p_evidence)<1 or cardinality(p_evidence)>20 or array_position(p_evidence,null) is not null or cardinality(p_evidence)<>(select count(distinct x) from unnest(p_evidence) x) then raise exception 'Unique mandatory evidence required';end if;
 if exists(select 1 from unnest(p_evidence) eid left join public.retail_oos12_evidence d on d.id=eid where d.id is null or d.actor_id<>p_actor or d.order_id<>o.id or d.stage<>o.stage+1 or d.revision<>o.revision or d.status<>'finalized'
 or not exists(select 1 from storage.objects s where s.bucket_id='retail-oos12-evidence' and s.name=d.path and s.metadata->>'mimetype'=d.mime_type and (s.metadata->>'size')::bigint=d.file_size)) then raise exception 'Verified finalized current-stage evidence required';end if;
 b:=to_jsonb(o);changed_at:=clock_timestamp();
 update public.retail_oos12_orders set stage=stage+1,status=code,revision=revision+1,details=details||p_fields,updated_at=changed_at,status_entered_at=changed_at where id=o.id returning * into o;
 insert into public.retail_oos12_events(order_id,request_id,actor_id,action,before_value,after_value,evidence,created_at) values(o.id,p_request,p_actor,code,b,to_jsonb(o),payload,changed_at);
 return jsonb_build_object('replayed',false,'order',public.retail_service_public_order(to_jsonb(o)));end;$$;

create function public.rpc_retail_oos12_import(p_actor uuid,p_sha256 text,p_filename text,p_original text,p_groups jsonb) returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $$
declare g jsonb;o public.retail_oos12_orders%rowtype;b jsonb;ids uuid[];st text;receipt public.retail_oos12_import_receipts%rowtype;receipts jsonb:='[]';request uuid;existing boolean;stamp timestamptz;begin
 if not public.retail_mis_oos_enabled() then raise exception using errcode='42501',message='OOS writes unavailable';end if;
 if not public.retail_oos12_identity(p_actor) or not(public.retail_mis_allowed(p_actor,'oos',null,true) or exists(select 1 from unnest(array['TN','KA','KL','TG','AP-1','AP-2','PY']) s where public.retail_oos12_authority(p_actor,s,'commercial'))) then raise exception using errcode='42501',message='Assigned MIS or Commercial rework authority required';end if;
 if p_sha256 is null or p_sha256!~'^[a-f0-9]{64}$' or p_original is null or encode(sha256(decode(p_original,'base64')),'hex')<>p_sha256 or length(btrim(coalesce(p_filename,''))) not between 1 and 200 then raise exception 'Original workbook, filename and matching hash required';end if;
 if jsonb_typeof(p_groups) is distinct from 'array' or jsonb_array_length(p_groups) not between 1 and 100 then raise exception 'Reviewed quotation groups required';end if;
 -- Same lock as legacy create/import: no duplicate reference across versions.
 perform pg_advisory_xact_lock(hashtextextended('retail_service_orders',0));
 for g in select value from jsonb_array_elements(p_groups) loop
 if length(btrim(coalesce(g->>'quotation_number',''))) not between 1 and 200 or coalesce(g->>'expected_revision','')!~'^[0-9]+$' then raise exception 'Reference and reviewed revision required';end if;
 if coalesce((g->>'expected_workflow_version')::integer,1)<>(case when exists(select 1 from public.retail_service_orders where kind='OOS' and reference=g->>'quotation_number') then 1 when exists(select 1 from public.retail_oos12_orders where reference=g->>'quotation_number') then 2 when public.retail_oos12_enabled() then 2 else 1 end) then raise exception using errcode='40001',message='Reviewed workflow version changed; preview again';end if;
 if exists(select 1 from public.retail_service_orders where kind='OOS' and reference=g->>'quotation_number') then
 receipts:=receipts||coalesce(public.rpc_retail_mis_oos_import(p_actor,p_sha256,p_filename,p_original,jsonb_build_array(g))->'receipts','[]'::jsonb);continue;end if;
 if not public.retail_oos12_enabled() then
 -- Existing v2 orders must never fall through to legacy creation while v2 is off.
 if exists(select 1 from public.retail_oos12_orders where reference=g->>'quotation_number') then raise exception using errcode='42501',message='Twelve-stage writes disabled';end if;
 receipts:=receipts||coalesce(public.rpc_retail_mis_oos_import(p_actor,p_sha256,p_filename,p_original,jsonb_build_array(g))->'receipts','[]'::jsonb);continue;end if;
 select array_agg(x::uuid order by x) into ids from jsonb_array_elements_text(g->'store_ids') x;
 if coalesce(cardinality(ids),0) not between 1 and 1000 or array_position(ids,null) is not null or cardinality(ids)<>(select count(distinct x) from unnest(ids) x) then raise exception 'Unique canonical stores required';end if;
 if exists(select 1 from unnest(ids) x left join public.reliance_retail_store_master s on s.id=x where s.id is null or s.status<>'Active' or not public.retail_mis_unique_store(s.id) or not(public.retail_oos12_authority(p_actor,s.state,'mis') or public.retail_oos12_authority(p_actor,s.state,'commercial'))) then raise exception using errcode='42501',message='Canonical active stores outside import scope';end if;
 select min(state) into st from public.reliance_retail_store_master where id=any(ids);
 if (select count(distinct state) from public.reliance_retail_store_master where id=any(ids))<>1 then raise exception 'Cross-state quotations not supported';end if;
 if jsonb_typeof(g->'items') is distinct from 'array' or jsonb_array_length(g->'items')=0 or exists(select 1 from jsonb_array_elements(g->'items') i where coalesce(i->>'store_id','')='' or not((i->>'store_id')::uuid=any(ids)) or length(btrim(coalesce(i->>'description','')))=0 or coalesce(i->>'quantity','')!~'^[0-9]+([.][0-9]+)?$' or coalesce(i->>'unit_rate','')!~'^[0-9]+([.][0-9]+)?$' or (i->>'quantity')::numeric<=0 or (i->>'unit_rate')::numeric<0) then raise exception 'Valid exact decimal items required';end if;
 select * into o from public.retail_oos12_orders where reference=g->>'quotation_number' for update;existing:=found;
 if existing and not public.retail_oos12_order_allowed(p_actor,o.id) then raise exception using errcode='42501',message='Existing order outside scope';end if;
 select * into receipt from public.retail_oos12_import_receipts where reference=g->>'quotation_number' and sha256=p_sha256;
 if found then
 if receipt.actor_id<>p_actor or receipt.payload<>(g-'expected_revision') then raise exception 'Source hash reused by different actor or payload';end if;
 receipts:=receipts||jsonb_build_array(jsonb_build_object('replayed',true,'order',public.retail_service_public_order(to_jsonb(o))));continue;end if;
 if (g->>'expected_revision')::integer<>(case when existing then o.revision else 0 end) then raise exception using errcode='40001',message='Reviewed quotation revision changed';end if;
 request:=md5('OOS12_IMPORT|'||p_sha256||'|'||(g->>'quotation_number'))::uuid;stamp:=clock_timestamp();
 if existing then
 if o.stage=1 and not public.retail_oos12_authority(p_actor,o.state,'mis') then raise exception using errcode='42501',message='MIS authority required before PO';end if;
 if ids<>o.store_ids then raise exception 'Rework cannot change canonical stores or state';end if;
 if o.stage>1 and (not public.retail_oos12_authority(p_actor,o.state,'commercial') or o.created_by=p_actor or p_actor=(select actor_id from public.retail_oos12_events where order_id=o.id and action in ('CREATE_OOS','REWORK') order by created_at desc,id desc limit 1)) then raise exception using errcode='42501',message='Independent Commercial reviewer required for progressed rework';end if;
 b:=to_jsonb(o);update public.retail_oos12_orders set details=details||jsonb_build_object('items',g->'items','file_sha256',p_sha256,'filename',p_filename),revision=revision+1,rework_count=rework_count+1,updated_at=stamp where id=o.id returning * into o;
 else
 if not public.retail_oos12_authority(p_actor,st,'mis') then raise exception using errcode='42501',message='Only OOS MIS may create quotations';end if;
 b:=null;insert into public.retail_oos12_orders(reference,state,store_ids,status,details,original_items,created_by,created_at,updated_at,status_entered_at)
 values(g->>'quotation_number',st,ids,'OOS12_QUOTATION_SHARED',jsonb_build_object('items',g->'items','file_sha256',p_sha256,'filename',p_filename),g->'items',p_actor,stamp,stamp,stamp) returning * into o;
 insert into public.retail_oos12_order_stores(order_id,retail_store_id) select o.id,x from unnest(ids) x;
 end if;
 insert into public.retail_oos12_events(order_id,request_id,actor_id,action,before_value,after_value,evidence,created_at) values(o.id,request,p_actor,case when existing then 'REWORK' else 'CREATE_OOS' end,b,to_jsonb(o),jsonb_build_object('filename',p_filename,'file_sha256',p_sha256,'original_base64',p_original),stamp);
 insert into public.retail_oos12_import_receipts(reference,sha256,actor_id,payload,order_id) values(o.reference,p_sha256,p_actor,g-'expected_revision',o.id);
 receipts:=receipts||jsonb_build_array(jsonb_build_object('replayed',false,'order',public.retail_service_public_order(to_jsonb(o))));
 end loop;return jsonb_build_object('receipts',receipts);end;$$;

create function public.rpc_retail_oos12_stores(p_actor uuid) returns jsonb language plpgsql stable security definer set search_path=pg_catalog,public as $$begin
 if not public.retail_oos12_identity(p_actor) then raise exception using errcode='42501',message='Verified importer required';end if;
 return (select coalesce(jsonb_agg(jsonb_build_object('id',s.id,'store_code',s.store_code,'store_name',s.store_name,'state',s.state,'status',s.status)),'[]') from public.reliance_retail_store_master s where public.retail_mis_unique_store(s.id) and (public.retail_oos12_authority(p_actor,s.state,'mis') or public.retail_oos12_authority(p_actor,s.state,'commercial')));end;$$;

create function public.rpc_retail_oos12_capabilities(p_actor uuid) returns jsonb language plpgsql stable security definer set search_path=pg_catalog,public as $$
declare result jsonb:='{}';actions jsonb:='{}';requirements jsonb:='{}';o record;st jsonb;begin
 if public.retail_mis_allowed(p_actor,'oos',null,false) then result:=public.rpc_retail_oos_capabilities(p_actor);actions:=coalesce(result->'actions','{}');end if;
 if not public.retail_oos12_identity(p_actor) or not exists(select 1 from unnest(array['TN','KA','KL','TG','AP-1','AP-2','PY']) s where public.retail_oos12_scope(p_actor,s)) then raise exception using errcode='42501',message='Assigned OOS scope required';end if;
 for o in select * from public.retail_oos12_orders x where public.retail_oos12_order_allowed(p_actor,x.id) loop
 st:=(select stages->o.stage from public.retail_oos_workflow_catalog where version=2);
 actions:=actions||jsonb_build_object(o.id::text,case when public.retail_oos12_can_advance(p_actor,o.id) then jsonb_build_array(st->>'code') else '[]'::jsonb end);
 requirements:=requirements||jsonb_build_object(o.id::text,jsonb_build_object('next',st,'spec',public.retail_oos12_spec(o.stage+1),'can_submit',public.retail_oos12_can_advance(p_actor,o.id),'current_stage',o.stage));
 end loop;
 return result||jsonb_build_object('actions',actions,'requirements',requirements,'database_writes_enabled',public.retail_mis_oos_enabled(),'twelve_stage_enabled',(select enabled from public.retail_oos_workflow_catalog where version=2),'can_import',public.retail_mis_allowed(p_actor,'oos',null,false) or exists(select 1 from unnest(array['TN','KA','KL','TG','AP-1','AP-2','PY']) s where public.retail_oos12_authority(p_actor,s,'commercial')));end;$$;

-- Keep the existing bulk legacy projection unchanged and private behind a union.
alter function public.rpc_retail_oos_register(uuid) rename to retail_oos12_legacy_register;
revoke all on function public.retail_oos12_legacy_register(uuid) from public,anon,authenticated,service_role;
create function public.rpc_retail_oos_register(p_actor uuid) returns jsonb language plpgsql stable security definer set search_path=pg_catalog,public as $$
declare result jsonb:='{"rows":[]}';rows jsonb;begin
 if not public.retail_oos12_identity(p_actor) or not exists(select 1 from unnest(array['TN','KA','KL','TG','AP-1','AP-2','PY']) s where public.retail_oos12_scope(p_actor,s)) then raise exception using errcode='42501',message='Assigned OOS scope required';end if;
 if public.retail_mis_allowed(p_actor,'oos',null,false) then result:=public.retail_oos12_legacy_register(p_actor);end if;
 select coalesce(jsonb_agg(public.retail_service_public_order(to_jsonb(o))||jsonb_build_object(
 'original_items',(select e.after_value->'original_items' from public.retail_oos12_events e where e.order_id=o.id and e.action='CREATE_OOS' order by e.created_at,e.id limit 1),
 'status_entered_at',(select e.created_at from public.retail_oos12_events e where e.order_id=o.id and e.after_value->>'status'=o.status and (e.action='CREATE_OOS' or e.before_value->>'status' is distinct from e.after_value->>'status') order by e.created_at desc,e.id desc limit 1),
 'original_po_date',(select e.evidence->'fields'->>'po_date' from public.retail_oos12_events e where e.order_id=o.id and e.action='OOS12_PO_PENDING_COMMERCIAL' order by e.created_at,e.id limit 1),
 'original_po_number',(select e.evidence->'fields'->>'po_number' from public.retail_oos12_events e where e.order_id=o.id and e.action='OOS12_PO_PENDING_COMMERCIAL' order by e.created_at,e.id limit 1),
 'mapped_stores',(select jsonb_agg(jsonb_build_object('id',s.id,'store_code',s.store_code,'store_name',s.store_name,'state',s.state) order by s.store_code) from public.reliance_retail_store_master s where s.id=any(o.store_ids)),
 'history',(select coalesce(jsonb_agg(jsonb_build_object('id',e.id,'action',e.action,'actor_id',e.actor_id,'created_at',e.created_at,'from_status',e.before_value->>'status','to_status',e.after_value->>'status','revision',e.after_value->'revision','has_workbook',e.evidence ? 'original_base64','evidence_ids',e.evidence->'evidence_ids') order by e.created_at,e.id),'[]') from public.retail_oos12_events e where e.order_id=o.id)) order by o.created_at desc,o.id),'[]') into rows from public.retail_oos12_orders o where public.retail_oos12_order_allowed(p_actor,o.id);
 return result||jsonb_build_object('rows',coalesce(result->'rows','[]')||rows,'complete',true,'twelve_stage_available',true,'twelve_stage_enabled',(select enabled from public.retail_oos_workflow_catalog where version=2),
 'states',(select jsonb_agg(s) from unnest(array['TN','KA','KL','TG','AP-1','AP-2','PY']) s where public.retail_oos12_scope(p_actor,s)),'as_of',statement_timestamp());end;$$;

create function public.rpc_retail_oos12_history(p_actor uuid,p_order uuid) returns jsonb language plpgsql stable security definer set search_path=pg_catalog,public as $$
begin
 if exists(select 1 from public.retail_oos12_orders where id=p_order) then
 if not public.retail_oos12_order_allowed(p_actor,p_order) then raise exception using errcode='42501',message='Order outside scope';end if;
 return (select coalesce(jsonb_agg(jsonb_build_object('id',e.id,'action',e.action,'actor_id',e.actor_id,'created_at',e.created_at,'before_value',public.retail_service_public_order(e.before_value),'after_value',public.retail_service_public_order(e.after_value),'evidence',e.evidence-'original_base64','has_workbook',e.evidence ? 'original_base64') order by e.created_at,e.id),'[]') from public.retail_oos12_events e where e.order_id=p_order);
 end if;return public.rpc_retail_mis_oos_history(p_actor,p_order);end;$$;

-- New helpers are never public APIs. Backend RPCs are service-only and derive actors from verified sessions.
do $$declare f record;begin for f in select oid,proname from pg_proc where pronamespace='public'::regnamespace and (proname like 'retail_oos12_%' or proname like 'rpc_retail_oos12_%' or proname='rpc_retail_oos_register') loop
 execute format('revoke all on function %s from public,anon,authenticated,service_role',f.oid::regprocedure);
 if f.proname like 'rpc_%' then execute format('grant execute on function %s to service_role',f.oid::regprocedure);end if;end loop;end;$$;
commit;
