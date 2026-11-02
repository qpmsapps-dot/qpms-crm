-- Additive local candidate. No access grants or gate activation are seeded.
begin;
set local lock_timeout='5s';
set local statement_timeout='60s';
do $baseline$ begin
 if not exists(select 1 from pg_proc where oid=to_regprocedure('public.retail_mis_allowed(uuid,text,text,boolean)') and md5(replace(prosrc,E'\r\n',E'\n'))='76d9993da440c19b5e15f2b3fc3bfa3b') or not exists(select 1 from pg_proc where oid=to_regprocedure('public.rpc_retail_mis_access(uuid,uuid)') and md5(replace(prosrc,E'\r\n',E'\n'))='839b5f5685879b947eba345105bf8909') then raise exception 'Reviewed MIS authorization baseline differs';end if;
end;$baseline$;
create table public.retail_oos_operator_access(profile_id uuid primary key references public.profiles(id) on delete restrict,auth_user_id uuid not null,employee_code text not null,states text[] not null check(cardinality(states)>0 and states <@ array['AP-1','AP-2','KA','KL','TG','TN','PY']::text[] and array_position(states,null) is null),active boolean not null,revision integer not null default 1,changed_by uuid not null references public.profiles(id),changed_at timestamptz not null default clock_timestamp());
alter table public.retail_oos_operator_access enable row level security;
revoke all on public.retail_oos_operator_access from public,anon,authenticated,service_role;
create function public.retail_oos_operator_allowed(p_actor uuid,p_state text) returns boolean language sql stable security definer set search_path=pg_catalog,public as $$
 select exists(select 1 from public.retail_oos_operator_access a join public.profiles p on p.id=a.profile_id where a.profile_id=p_actor and a.active and a.profile_id='d40c2b3f-87f1-4c34-8798-cf9b0d9ca784' and a.auth_user_id='79cd196c-c6f3-404a-b22a-d4683afefa3f' and a.employee_code='QPMSADMIN' and p.auth_user_id=a.auth_user_id and exists(select 1 from auth.users u where u.id=p.auth_user_id) and (select count(*) from public.profiles other where other.auth_user_id=p.auth_user_id)=1 and p.employee_code=a.employee_code and p.role in ('Admin','QPMS Admin') and p.is_active is true and p.web_access_enabled is true and upper(coalesce(p.status,'Active'))='ACTIVE' and (p_state is null or p_state=any(a.states)));
$$;
create function public.rpc_retail_oos_operator_grant(p_actor uuid,p_enabled boolean,p_states text[],p_reason text,p_expected integer) returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $$declare p public.profiles%rowtype;a public.retail_oos_operator_access%rowtype;result jsonb;begin
 select * into p from public.profiles where id=p_actor for update;
 if p.id is distinct from 'd40c2b3f-87f1-4c34-8798-cf9b0d9ca784'::uuid or p.auth_user_id is distinct from '79cd196c-c6f3-404a-b22a-d4683afefa3f'::uuid or p.employee_code is distinct from 'QPMSADMIN' or not public.retail_mis_super(p_actor) or p.web_access_enabled is not true or not exists(select 1 from auth.users u where u.id=p.auth_user_id) or (select count(*) from public.profiles other where other.auth_user_id=p.auth_user_id)<>1 then raise exception using errcode='42501',message='Exact verified QPMSADMIN required';end if;
 if p_enabled is null or length(btrim(coalesce(p_reason,''))) not between 3 and 2000 or p_states is null or cardinality(p_states)=0 or not(p_states <@ array['AP-1','AP-2','KA','KL','TG','TN','PY']::text[]) or array_position(p_states,null) is not null then raise exception 'Explicit state scope and audit reason required';end if;
 select * into a from public.retail_oos_operator_access where profile_id=p_actor for update;
 if coalesce(a.revision,0) is distinct from p_expected then raise exception using errcode='40001',message='Operator grant changed; refresh';end if;
 insert into public.retail_oos_operator_access(profile_id,auth_user_id,employee_code,states,active,changed_by,revision) values(p.id,p.auth_user_id,p.employee_code,array(select distinct unnest(p_states) order by 1),p_enabled,p_actor,coalesce(a.revision,0)+1) on conflict(profile_id) do update set states=excluded.states,active=excluded.active,revision=excluded.revision,changed_by=p_actor,changed_at=clock_timestamp() returning to_jsonb(retail_oos_operator_access) into result;
 insert into public.retail_mis_audit(actor_id,action,target_id,reason,before_value,after_value) values(p_actor,'OOS_OPERATOR_ACCESS',p_actor,p_reason,to_jsonb(a),result);
 return result;
end;$$;
create or replace function public.retail_mis_allowed(p_actor uuid,p_module text,p_state text,p_write boolean default false) returns boolean language sql stable security definer set search_path=pg_catalog,public as $$
 select (p_module='oos' and public.retail_oos_operator_allowed(p_actor,p_state)) or exists(select 1 from public.retail_mis_assignments a join public.profiles p on p.id=a.profile_id
 where a.profile_id=p_actor and a.active and p.is_active is true and upper(coalesce(p.status,'Active'))='ACTIVE'
 and p.auth_user_id=a.auth_user_id and p.employee_code=a.employee_code and p.role=a.role
 and (p_state is null or (p_state in ('AP-1','AP-2','KA','KL','TG','TN','PY') and (a.role='CENTRAL_MIS' or p_state=any(a.states))))
 and case a.role when 'CENTRAL_MIS' then p_module=any(array['dashboard','stores','attendance-hk','attendance-mepc','cleaning','pest','training-hk','training-mepc','fault','maintenance','thermography','oos','imports'])
 when 'MIS_HK' then p_module=any(array['stores','attendance-hk','cleaning','pest','training-hk'])
 when 'MIS_MEPC' then p_module=any(array['stores','attendance-mepc','fault','maintenance','thermography']) when 'MIS_OOS' then p_module='oos' else false end);
$$;
create or replace function public.rpc_retail_mis_access(p_actor uuid,p_auth uuid) returns jsonb language sql stable security definer set search_path=pg_catalog,public as $$
 select coalesce((select jsonb_build_object('profile_id',a.profile_id,'role',a.role,'states',case when a.role='CENTRAL_MIS' then array['AP-1','AP-2','KA','KL','TG','TN','PY'] else a.states end,'active',a.active and p.is_active and p.role=a.role and p.auth_user_id=a.auth_user_id and p.employee_code=a.employee_code and upper(coalesce(p.status,'Active'))='ACTIVE','revision',a.revision)
 from public.retail_mis_assignments a join public.profiles p on p.id=a.profile_id where a.profile_id=p_actor and a.auth_user_id=p_auth and p.auth_user_id=p_auth),case when public.retail_oos_operator_allowed(p_actor,null) and exists(select 1 from public.profiles where id=p_actor and auth_user_id=p_auth) then jsonb_build_object('profile_id',p_actor,'role','MIS_OOS','active',true,'operator',true,'states',(select states from public.retail_oos_operator_access where profile_id=p_actor)) else '{}'::jsonb end);
$$;
create function public.rpc_retail_oos_capabilities(p_actor uuid) returns jsonb language plpgsql stable security definer set search_path=pg_catalog,public as $$declare o record;actions jsonb:='{}';permitted text[];next text;reviewer boolean;latest uuid;begin
 if not public.retail_mis_allowed(p_actor,'oos',null) then raise exception using errcode='42501',message='Assigned OOS access required';end if;
 for o in select * from public.retail_service_orders x where public.retail_mis_oos_order_allowed(p_actor,x.id,false) loop
  permitted:='{}';
  if not exists(select 1 from public.retail_mis_oos_retirements where order_id=o.id) then
   next:=(array['QUOTED','PO_RECORDED','COMMERCIALLY_CONFIRMED','FUND_RECORDED','PAYMENT_RECORDED','DELIVERED'])[array_position(array['QUOTED','PO_RECORDED','COMMERCIALLY_CONFIRMED','FUND_RECORDED','PAYMENT_RECORDED','DELIVERED'],o.status)+1];
   reviewer:=public.retail_mis_oos_access(p_actor,o.state,'review');
   select actor_id into latest from public.retail_service_events where order_id=o.id and action in ('CREATE_OOS','REWORK') order by created_at desc,id desc limit 1;
   if next is not null and (next not in ('COMMERCIALLY_CONFIRMED','FUND_RECORDED','PAYMENT_RECORDED') or reviewer) and (next<>'COMMERCIALLY_CONFIRMED' or (o.created_by<>p_actor and latest is distinct from p_actor)) then permitted:=array_append(permitted,next);end if;
   if o.status='QUOTED' and not(o.details ?| array['po_number','confirmation_ref','fund_ref','payment_ref','delivery_ref']) and not exists(select 1 from public.retail_service_events where order_id=o.id and action in ('PO_RECORDED','COMMERCIALLY_CONFIRMED','FUND_RECORDED','PAYMENT_RECORDED','DELIVERED')) then permitted:=array_append(permitted,'RETIRE');end if;
  end if;
  actions:=actions||jsonb_build_object(o.id::text,permitted);
 end loop;
 return jsonb_build_object('database_writes_enabled',public.retail_mis_oos_enabled(),'actions',actions);
end;$$;
revoke all on function public.retail_oos_operator_allowed(uuid,text),public.rpc_retail_oos_operator_grant(uuid,boolean,text[],text,integer),public.rpc_retail_oos_capabilities(uuid) from public,anon,authenticated,service_role;
grant execute on function public.rpc_retail_oos_operator_grant(uuid,boolean,text[],text,integer),public.rpc_retail_oos_capabilities(uuid) to service_role;
commit;
