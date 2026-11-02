-- PREPARED ONLY: additive read projection and DISABLED twelve-stage catalog.
-- No order/status rewrites, account grants, gate changes or legacy RPC replacements.
begin;
set local lock_timeout='5s';
set local statement_timeout='60s';
do $$begin
 if not exists(select 1 from pg_proc where oid=to_regprocedure('public.retail_mis_allowed(uuid,text,text,boolean)') and md5(replace(prosrc,E'\r\n',E'\n'))='b6263716364179e72456cbe7a11532f0')
 or not exists(select 1 from pg_proc where oid=to_regprocedure('public.rpc_retail_mis_access(uuid,uuid)') and md5(replace(prosrc,E'\r\n',E'\n'))='53053e4e76a2c775cff98ef6bd3656b5') then raise exception 'Reviewed operator authorization baseline differs';end if;
end;$$;
create table public.retail_oos_workflow_catalog(
 version integer primary key check(version=2),enabled boolean not null default false check(enabled=false),
 stages jsonb not null,created_at timestamptz not null default clock_timestamp()
);
alter table public.retail_oos_workflow_catalog enable row level security;
revoke all on public.retail_oos_workflow_catalog from public,anon,authenticated,service_role;
insert into public.retail_oos_workflow_catalog(version,stages) values(2,'[
 {"code":"OOS12_QUOTATION_SHARED","label":"Quotation Shared – Waiting for PO"},
 {"code":"OOS12_PO_PENDING_COMMERCIAL","label":"PO Pending Commercial Confirmation"},
 {"code":"OOS12_PO_RECEIVED","label":"PO Received – Fund Yet to Raise"},
 {"code":"OOS12_FUND_RAISED","label":"Fund Raised – Yet to Receive"},
 {"code":"OOS12_FUND_DELIVERED","label":"Fund Delivered"},
 {"code":"OOS12_FUND_RECEIVED","label":"Fund Received – Work Yet to Start"},
 {"code":"OOS12_WIP","label":"WIP – Work in Progress"},
 {"code":"OOS12_WORK_DONE","label":"Work Done – Document Pending"},
 {"code":"OOS12_DOCUMENT_SUBMITTED","label":"Document Submitted"},
 {"code":"OOS12_DOCUMENT_RECEIVED","label":"Document Received – JMS Yet to Be Created"},
 {"code":"OOS12_JMS_CREATED","label":"JMS Created – Invoice Yet to Raise"},
 {"code":"OOS12_INVOICE_RAISED","label":"Invoice Raised"}
]'::jsonb);
create trigger retail_oos_workflow_catalog_immutable before update or delete on public.retail_oos_workflow_catalog for each row execute function public.retail_mis_immutable();

create function public.rpc_retail_oos_register(p_actor uuid) returns jsonb
language plpgsql stable security definer set search_path=pg_catalog,public as $$
declare result jsonb;begin
 if not public.retail_mis_allowed(p_actor,'oos',null,false) then raise exception using errcode='42501',message='Assigned OOS scope required';end if;
 -- One bulk scan of scoped orders/events. Never return source bytes or unscoped stores.
 with allowed as materialized (
  select o.* from public.retail_service_orders o where o.kind='OOS' and public.retail_mis_oos_order_allowed(p_actor,o.id,false)
 ), event_rows as materialized (
  select e.id,e.order_id,e.action,e.created_at,e.actor_id,
   jsonb_build_object('status',e.before_value->'status') before_value,
   jsonb_build_object('status',e.after_value->'status','revision',e.after_value->'revision',
    'details',case when e.action='CREATE_OOS' then jsonb_build_object('items',e.after_value->'details'->'items') else '{}'::jsonb end) after_value,
   jsonb_build_object('po_date',e.evidence->'po_date','po_number',e.evidence->'po_number') evidence,
   e.evidence ? 'original_base64' has_workbook
  from public.retail_service_events e join allowed o on o.id=e.order_id
 ), originals as (
  select distinct on(order_id) order_id,after_value->'details'->'items' original_items
  from event_rows where action='CREATE_OOS' order by order_id,created_at,id
 ), po as (
  select distinct on(order_id) order_id,evidence->>'po_date' po_date,evidence->>'po_number' po_number
  from event_rows where action='PO_RECORDED' and before_value->>'status' is distinct from after_value->>'status'
  order by order_id,created_at,id
 ), entered as (
  select distinct on(e.order_id) e.order_id,e.created_at entered_at
  from event_rows e join allowed o on o.id=e.order_id
  where e.after_value->>'status'=o.status and
   (e.action='CREATE_OOS' or e.before_value->>'status' is distinct from e.after_value->>'status')
  order by e.order_id,e.created_at desc,e.id desc
 ), stores as (
  select o.id,jsonb_agg(jsonb_build_object('id',s.id,'store_code',s.store_code,'store_name',s.store_name,'state',s.state) order by s.store_code) mapped_stores
  from allowed o join public.reliance_retail_store_master s on s.id=any(o.store_ids)
  where public.retail_mis_allowed(p_actor,'oos',s.state,false) group by o.id
 ), history as (
  select order_id,jsonb_agg(jsonb_build_object('id',id,'action',action,'actor_id',actor_id,'created_at',created_at,
   'from_status',before_value->>'status','to_status',after_value->>'status','revision',after_value->'revision',
   'has_workbook',has_workbook) order by created_at,id) events
  from event_rows group by order_id
 ) select coalesce(jsonb_agg(public.retail_service_public_order(to_jsonb(o))||jsonb_build_object(
  'workflow_version',1,'original_items',a.original_items,'original_po_date',p.po_date,'original_po_number',p.po_number,
  'status_entered_at',e.entered_at,'mapped_stores',coalesce(s.mapped_stores,'[]'::jsonb),'history',coalesce(h.events,'[]'::jsonb),
  'retired',exists(select 1 from public.retail_mis_oos_retirements r where r.order_id=o.id)) order by o.created_at desc,o.id),'[]'::jsonb)
 into result from allowed o left join originals a on a.order_id=o.id left join po p on p.order_id=o.id
 left join entered e on e.order_id=o.id left join stores s on s.id=o.id left join history h on h.order_id=o.id;
 return jsonb_build_object('rows',result,'complete',true,'workflow_version',1,'twelve_stage_enabled',false,
  'states',(select coalesce(jsonb_agg(s),'[]') from unnest(array['TN','KA','KL','TG','AP-1','AP-2','PY']) s where public.retail_mis_allowed(p_actor,'oos',s,false)),
  'as_of',statement_timestamp());
end;$$;
revoke all on function public.rpc_retail_oos_register(uuid) from public,anon,authenticated,service_role;
grant execute on function public.rpc_retail_oos_register(uuid) to service_role;
commit;
