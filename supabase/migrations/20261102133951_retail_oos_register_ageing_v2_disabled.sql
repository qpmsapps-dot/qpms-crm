-- PREPARED ONLY: additive read projection and DISABLED twelve-stage catalog.
-- No order/status rewrites, seeded accounts/grants or gate changes. OOS state and audited MIS user contracts are revised.
begin;
set local lock_timeout='5s';
set local statement_timeout='60s';
do $$begin
 if not exists(select 1 from pg_proc where oid=to_regprocedure('public.retail_mis_allowed(uuid,text,text,boolean)') and md5(replace(prosrc,E'\r\n',E'\n'))='b6263716364179e72456cbe7a11532f0')
 or not exists(select 1 from pg_proc where oid=to_regprocedure('public.rpc_retail_mis_access(uuid,uuid)') and md5(replace(prosrc,E'\r\n',E'\n'))='53053e4e76a2c775cff98ef6bd3656b5') then raise exception 'Reviewed operator authorization baseline differs';end if;
end;$$;
create function public.retail_oos_state(p_state text) returns text language sql immutable set search_path=pg_catalog,public as $$select case when upper(btrim(p_state))='PY' then 'TN' when upper(btrim(p_state))='KN' then 'KA' else upper(btrim(p_state)) end$$;
revoke all on function public.retail_oos_state(text) from public,anon,authenticated,service_role;
create or replace function public.retail_mis_allowed(p_actor uuid,p_module text,p_state text,p_write boolean default false) returns boolean language sql stable security definer set search_path=pg_catalog,public as $$
 select (p_module='oos' and public.retail_oos_operator_allowed(p_actor,(case when p_module='oos' then public.retail_oos_state(p_state) else p_state end))) or exists(select 1 from public.retail_mis_assignments a join public.profiles p on p.id=a.profile_id
 where a.profile_id=p_actor and a.active and p.is_active is true and upper(coalesce(p.status,'Active'))='ACTIVE'
 and p.auth_user_id=a.auth_user_id and p.employee_code=a.employee_code and p.role=a.role
 and ((case when p_module='oos' then public.retail_oos_state(p_state) else p_state end) is null or ((case when p_module='oos' then public.retail_oos_state(p_state) else p_state end) in ('AP-1','AP-2','KA','KL','TG','TN','PY') and (a.role='CENTRAL_MIS' or (case when p_module='oos' then public.retail_oos_state(p_state) else p_state end)=any(a.states))))
 and case a.role when 'CENTRAL_MIS' then p_module=any(array['dashboard','stores','attendance-hk','attendance-mepc','cleaning','pest','training-hk','training-mepc','fault','maintenance','thermography','oos','imports'])
 when 'MIS_HK' then p_module=any(array['stores','attendance-hk','cleaning','pest','training-hk'])
 when 'MIS_MEPC' then p_module=any(array['stores','attendance-mepc','fault','maintenance','thermography']) when 'MIS_OOS' then p_module='oos' else false end);
$$;
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
  'states',(select coalesce(jsonb_agg(s),'[]') from unnest(array['TN','KA','KL','TG','AP-1','AP-2']) s where public.retail_mis_allowed(p_actor,'oos',s,false)),
  'as_of',statement_timestamp());
end;$$;
revoke all on function public.rpc_retail_oos_register(uuid) from public,anon,authenticated,service_role;
grant execute on function public.rpc_retail_oos_register(uuid) to service_role;
create or replace function public.rpc_retail_mis_assign(p_actor uuid,p_target uuid,p_auth uuid,p_employee text,p_role text,p_states text[],p_reason text,p_expected integer) returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $$
declare p public.profiles%rowtype;a public.retail_mis_assignments%rowtype;prior jsonb;result jsonb;begin
 if not public.retail_mis_super(p_actor) or p_target=p_actor then raise exception using errcode='42501',message='Super Admin required; self assignment prohibited';end if;
 if p_reason is null or length(btrim(p_reason)) not between 3 and 2000 or (p_role is not null and p_role not in ('MIS_HK','MIS_MEPC','MIS_OOS')) then raise exception using errcode='22023',message='Role and audit reason required';end if;
 perform pg_advisory_xact_lock(hashtextextended('retail_mis_assignment:'||p_target::text,0));
 select * into p from public.profiles where id=p_target for update;
 if not found or p.auth_user_id is distinct from p_auth or p.employee_code is distinct from p_employee
 or not exists(select 1 from auth.users where id=p_auth) or (select count(*) from public.profiles where auth_user_id=p_auth)<>1 or (select count(*) from public.profiles where employee_code=p_employee)<>1 then raise exception using errcode='42501',message='Exact unique active profile/auth/employee identity required';end if;
 if p.role in ('Admin','QPMS Admin','Developer','Super Admin') then raise exception using errcode='42501',message='Do not replace an administration account';end if;
 select * into a from public.retail_mis_assignments where profile_id=p_target for update;
 if a.profile_id is not null and (a.auth_user_id is distinct from p_auth or a.employee_code is distinct from p_employee) then raise exception using errcode='40001',message='Assignment identity changed; independent reconciliation required';end if;
 if coalesce(a.revision,0) is distinct from p_expected then raise exception using errcode='40001',message='Assignment changed; refresh';end if;
 prior:=jsonb_build_object('assignment',to_jsonb(a),'profile',jsonb_build_object('role',p.role,'business',p.business,'designation',p.designation,'employee_code',p.employee_code,'auth_user_id',p.auth_user_id));
 if p_role is null then
  if a.profile_id is null or p.role<>a.role then raise exception using errcode='40001',message='Assignment/profile drift';end if;
  update public.profiles set role=a.previous_profile->>'role',business=a.previous_profile->>'business',designation=a.previous_profile->>'designation' where id=p_target;
  update public.retail_mis_assignments set active=false,revision=revision+1,changed_by=p_actor,changed_at=clock_timestamp() where profile_id=p_target returning to_jsonb(retail_mis_assignments) into result;
 else
  if p_states is null or (p_role='CENTRAL_MIS' and cardinality(p_states)<>0) or (p_role<>'CENTRAL_MIS' and cardinality(p_states)=0) or not(p_states <@ array['AP-1','AP-2','KA','KL','TG','TN']::text[]) or array_position(p_states,null) is not null then raise exception using errcode='22023',message='Explicit geographic states required; AP and wildcard are forbidden';end if;
  insert into public.retail_mis_assignments(profile_id,auth_user_id,employee_code,role,states,previous_profile,changed_by,revision)
  values(p_target,p_auth,p_employee,p_role,array(select distinct unnest(p_states) order by 1),coalesce(a.previous_profile,jsonb_build_object('role',p.role,'business',p.business,'designation',p.designation)),p_actor,coalesce(a.revision,0)+1)
  on conflict(profile_id) do update set role=excluded.role,states=excluded.states,active=true,revision=excluded.revision,changed_by=p_actor,changed_at=clock_timestamp() returning to_jsonb(retail_mis_assignments) into result;
  update public.profiles set role=p_role,business='Reliance Retail',designation=case p_role when 'CENTRAL_MIS' then 'Central MIS' when 'MIS_HK' then 'HK-MIS' when 'MIS_MEPC' then 'MEPC-MIS' else 'OOS-MIS' end where id=p_target;
 end if;
 insert into public.retail_mis_audit(actor_id,action,target_id,reason,before_value,after_value) values(p_actor,'ROLE_STATE_ASSIGNMENT',p_target,p_reason,prior,result||jsonb_build_object('role_label',case p_role when 'MIS_HK' then 'HK-MIS' when 'MIS_MEPC' then 'MEPC-MIS' when 'MIS_OOS' then 'OOS-MIS' end));
 return result-'previous_profile';end;$$;

-- Atomic profile edit + exact-identity role/state assignment. Auth provisioning remains server-side.
create function public.rpc_retail_mis_user_save(p_actor uuid,p_target uuid,p_auth uuid,p_employee text,p_role text,p_states text[],p_reason text,p_expected integer,p_patch jsonb) returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $$
declare p public.profiles%rowtype;before_profile jsonb;begin
 if not public.retail_mis_super(p_actor) or p_actor=p_target then raise exception using errcode='42501',message='Exact Super Admin required; self assignment forbidden';end if;
 if p_patch is null or jsonb_typeof(p_patch)<>'object' or exists(select 1 from jsonb_object_keys(p_patch) k where k<>all(array['full_name','display_name','mobile','email','state','designation','department','business','role','requires_password_change','mobile_access_enabled','web_access_enabled','status','is_active'])) then raise exception 'Unsupported MIS profile edit';end if;
 select * into strict p from public.profiles where id=p_target for update;before_profile:=to_jsonb(p);
 if p.role in ('Admin','QPMS Admin','Developer','Super Admin') then raise exception using errcode='42501',message='Administration accounts cannot become MIS';end if;
 if p.role in ('MIS_HK','MIS_MEPC','MIS_OOS') and p.role<>p_role and exists(select 1 from public.retail_mis_assignments a where a.profile_id=p_target and a.role<>p.role) then raise exception 'Assignment/profile drift';end if;
 -- Assignment owns role/business/designation. Preserve credentials and identity columns.
 perform public.rpc_retail_mis_assign(p_actor,p_target,p_auth,p_employee,p_role,p_states,p_reason,p_expected);
 select * into p from jsonb_populate_record(null::public.profiles,(select to_jsonb(x) from public.profiles x where x.id=p_target)||(p_patch-'role'-'business'-'designation'-'state'));
 update public.profiles set full_name=p.full_name,display_name=p.display_name,mobile=p.mobile,email=p.email,department=p.department,requires_password_change=p.requires_password_change,mobile_access_enabled=p.mobile_access_enabled,web_access_enabled=p.web_access_enabled,status=p.status,is_active=p.is_active where id=p_target returning * into p;
 insert into public.retail_mis_audit(actor_id,action,target_id,reason,before_value,after_value) values(p_actor,'MIS_USER_EDIT',p_target,p_reason,before_profile,to_jsonb(p));
 return to_jsonb(p);
end;$$;
revoke all on function public.rpc_retail_mis_user_save(uuid,uuid,uuid,text,text,text[],text,integer,jsonb) from public,anon,authenticated,service_role;
grant execute on function public.rpc_retail_mis_user_save(uuid,uuid,uuid,text,text,text[],text,integer,jsonb) to service_role;
create function public.rpc_retail_mis_user_contract(p_actor uuid) returns jsonb language plpgsql stable security definer set search_path=pg_catalog,public as $$begin
 if not public.retail_mis_super(p_actor) then raise exception using errcode='42501',message='Exact Super Admin required';end if;
 return jsonb_build_object('roles',jsonb_build_object('MIS_HK','HK-MIS','MIS_MEPC','MEPC-MIS','MIS_OOS','OOS-MIS'),'states',jsonb_build_array('TN','KA','KL','TG','AP-1','AP-2'),'version',1);
end;$$;
revoke all on function public.rpc_retail_mis_user_contract(uuid) from public,anon,authenticated,service_role;
grant execute on function public.rpc_retail_mis_user_contract(uuid) to service_role;
commit;
