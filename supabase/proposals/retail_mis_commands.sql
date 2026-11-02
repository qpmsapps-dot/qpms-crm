-- Local MIS command adapters. Appended to the single reviewed migration by build script.
create table public.retail_mis_controls(singleton boolean primary key default true check(singleton),oos_writes_enabled boolean not null default false);
create table public.retail_mis_store_proposals(id uuid primary key default gen_random_uuid(),store_id uuid not null references public.reliance_retail_store_master(id) on delete restrict,maker_id uuid not null references public.profiles(id),changes jsonb not null,baseline jsonb not null,reason text not null,status text not null default 'PENDING' check(status in ('PENDING','APPROVED','REJECTED')),reviewer_id uuid references public.profiles(id),reviewed_at timestamptz,created_at timestamptz not null default now(),check(reviewer_id is null or reviewer_id<>maker_id));
alter table public.retail_mis_store_proposals enable row level security;
revoke all on public.retail_mis_store_proposals from public,anon,authenticated,service_role;
insert into public.retail_mis_controls values(true,false);
alter table public.retail_mis_controls enable row level security;
revoke all on public.retail_mis_controls from public,anon,authenticated,service_role;
create function public.rpc_retail_mis_identity(p_actor uuid,p_employee text) returns jsonb language plpgsql stable security definer set search_path=pg_catalog,public as $$declare p public.profiles%rowtype;begin
 if not public.retail_mis_super(p_actor) then raise exception using errcode='42501',message='Super Admin required';end if;
 if (select count(*) from public.profiles where employee_code=p_employee)<>1 then raise exception using errcode='42501',message='One exact employee identity required';end if;
 select * into p from public.profiles where employee_code=p_employee;
 if p.auth_user_id is null or p.is_active is not true or not exists(select 1 from auth.users where id=p.auth_user_id) or (select count(*) from public.profiles where auth_user_id=p.auth_user_id)<>1 then raise exception using errcode='42501',message='Unique active linked auth identity required';end if;
 return jsonb_build_object('id',p.id,'auth_user_id',p.auth_user_id,'employee_code',p.employee_code,'full_name',p.full_name,'role',p.role);end;$$;
create function public.rpc_retail_mis_store_reviews(p_actor uuid) returns jsonb language plpgsql stable security definer set search_path=pg_catalog,public as $$begin
 if not public.retail_mis_super(p_actor) then raise exception using errcode='42501',message='Super Admin required';end if;
 return coalesce((select jsonb_agg(to_jsonb(p)||jsonb_build_object('store_code',s.store_code,'state',s.state)) from public.retail_mis_store_proposals p join public.reliance_retail_store_master s on s.id=p.store_id where p.status='PENDING'),'[]');end;$$;
create function public.rpc_retail_mis_store_review(p_actor uuid,p_proposal uuid,p_approve boolean,p_reason text) returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $$declare p public.retail_mis_store_proposals%rowtype;s public.reliance_retail_store_master%rowtype;begin
 if not public.retail_mis_super(p_actor) then raise exception using errcode='42501',message='Super Admin required';end if;
 select * into p from public.retail_mis_store_proposals where id=p_proposal for update;select * into s from public.reliance_retail_store_master where id=p.store_id for update;
 if p.id is null or p.status<>'PENDING' or p.maker_id=p_actor or p_approve is null or length(btrim(coalesce(p_reason,'')))<3 then raise exception using errcode='42501',message='Pending independently reviewed proposal and reason required';end if;
 if p.baseline is distinct from jsonb_build_object('store_name',s.store_name,'city',s.city) then raise exception using errcode='40001',message='Store changed after proposal';end if;
 if p_approve then update public.reliance_retail_store_master set store_name=coalesce(nullif(p.changes->>'store_name',''),store_name),city=coalesce(nullif(p.changes->>'city',''),city) where id=s.id;end if;
 update public.retail_mis_store_proposals set status=case when p_approve then 'APPROVED' else 'REJECTED' end,reviewer_id=p_actor,reviewed_at=clock_timestamp() where id=p.id;
 insert into public.retail_mis_audit(actor_id,action,target_id,reason,before_value,after_value) values(p_actor,'STORE_PROPOSAL_REVIEW',p.id,p_reason,to_jsonb(p),jsonb_build_object('approved',p_approve,'store_id',s.id,'changes',p.changes));return jsonb_build_object('reviewed',true,'approved',p_approve);end;$$;
create function public.retail_mis_oos_enabled() returns boolean language sql stable security definer set search_path=pg_catalog,public as $$select coalesce((select oos_writes_enabled from public.retail_mis_controls where singleton),false)$$;
create function public.retail_mis_retired_order_guard() returns trigger language plpgsql security definer set search_path=pg_catalog,public as $$begin
 if exists(select 1 from public.retail_mis_oos_retirements where order_id=old.id) then raise exception using errcode='42501',message='Retired quotation is immutable across all APIs';end if;
 if tg_op='DELETE' then return old;end if;return new;end;$$;
create trigger retail_mis_retired_order_guard before update or delete on public.retail_service_orders for each row execute function public.retail_mis_retired_order_guard();
create function public.retail_mis_operations_access(p_actor uuid,p_state text,p_write boolean) returns boolean language sql stable security definer set search_path=pg_catalog,public as $$select public.retail_mis_allowed(p_actor,'maintenance',p_state,p_write) and public.retail_mis_allowed(p_actor,'thermography',p_state,p_write)$$;
create function public.retail_mis_cleaning_access(p_actor uuid,p_state text,p_action text) returns boolean language sql stable security definer set search_path=pg_catalog,public as $$select p_action in ('view','edit') and public.retail_mis_allowed(p_actor,'cleaning',p_state,p_action='edit')$$;
create function public.retail_mis_oos_access(p_actor uuid,p_state text,p_action text) returns boolean language sql stable security definer set search_path=pg_catalog,public as $$
 select public.retail_mis_allowed(p_actor,'oos',p_state,p_action<>'view') and (p_action in ('view','edit') or (p_action='review' and exists(select 1 from public.retail_provisional_access a where a.actor_id=p_actor and a.state=p_state and a.permission='reviewer')));
$$;
create function public.rpc_retail_mis_existing_evidence(p_actor uuid,p_module text,p_record uuid,p_evidence uuid) returns jsonb language plpgsql stable security definer set search_path=pg_catalog,public as $$declare result jsonb;begin
 if p_module='cleaning' then
  select jsonb_build_object('bucket',e.storage_bucket,'path',e.storage_path) into result from public.client_deep_cleaning_uploads e join public.client_deep_cleaning_submissions r on r.id=e.submission_id join public.reliance_retail_store_master s on s.id=r.retail_store_id
  where r.id=p_record and e.id=p_evidence and upper(btrim(r.store_code))=upper(btrim(s.store_code)) and r.state=s.state and e.upload_status='uploaded' and e.storage_bucket='client-deep-cleaning-uploads' and starts_with(e.storage_path,'deep-cleaning/reliance-retail/'||regexp_replace(s.store_code,'[^a-zA-Z0-9_-]','-','g')||'/'||r.id::text||'/') and public.retail_mis_allowed(p_actor,p_module,s.state);
 elsif p_module in ('training-hk','training-mepc') then
  select jsonb_build_object('bucket',e.storage_bucket,'path',e.storage_path) into result from public.training_evidence e join public.training_sessions r on r.id=e.training_session_id join public.training_categories c on c.id=r.category_id join public.reliance_retail_store_master s on s.id=r.retail_store_id
  where r.id=p_record and e.id=p_evidence and upper(btrim(r.store_code_snapshot))=upper(btrim(s.store_code)) and s.state=case when r.state_snapshot='KN' then 'KA' else r.state_snapshot end and r.access_client_code='reliance_retail' and e.storage_bucket='training-evidence' and starts_with(e.storage_path,'training/'||r.id::text||'/'||e.id::text||'/') and c.code=case when p_module='training-hk' then 'hk' else 'technical_mep' end and public.retail_mis_allowed(p_actor,p_module,s.state);
 end if;
 if result is null or result->>'path' ~ '(^|/)(\.\.?)(/|$)' or position(E'\\' in result->>'path')>0 or not exists(select 1 from storage.buckets where id=result->>'bucket' and public is false) or not exists(select 1 from storage.objects where bucket_id=result->>'bucket' and name=result->>'path') then raise exception using errcode='42501',message='Private existing evidence outside assigned module/state';end if;return result;end;$$;
create function public.rpc_retail_mis_linked_evidence(p_actor uuid,p_schedule uuid) returns jsonb language plpgsql stable security definer set search_path=pg_catalog,public as $$begin return public.retail_mis_cleaning_link_source(p_actor,p_schedule);end;$$;
create function public.rpc_retail_mis_command(p_actor uuid,p_module text,p_action text,p_data jsonb) returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $$
declare s public.reliance_retail_store_master%rowtype;r public.retail_mis_records%rowtype;prior jsonb;outcome jsonb;o public.retail_service_orders%rowtype;begin
 if not public.retail_mis_allowed(p_actor,p_module,null,true) then raise exception using errcode='42501',message='Assigned module editor required';end if;
 if p_data is null or jsonb_typeof(p_data)<>'object' then raise exception using errcode='22023',message='Command object required';end if;
 if p_module in ('pest','cleaning','training-hk','training-mepc') and p_action<>'LINK_FO' then
  if p_action='CREATE' then
   select * into s from public.reliance_retail_store_master where upper(btrim(store_code))=upper(btrim(p_data->>'store_code'));
   if not found or (select count(*) from public.reliance_retail_store_master where upper(btrim(store_code))=upper(btrim(p_data->>'store_code')))<>1 or s.status<>'Active' or not public.retail_mis_allowed(p_actor,p_module,s.state,true) then raise exception using errcode='42501',message='One active canonical Store Code in assigned state required';end if;
   if (p_data->>'activity_date')::date>(now() at time zone 'Asia/Kolkata')::date or length(coalesce(p_data->>'remarks',''))>2000 then raise exception using errcode='22023',message='Valid activity date and remarks required';end if;
   insert into public.retail_mis_records(module,retail_store_id,activity_date,details,created_by) values(p_module,s.id,(p_data->>'activity_date')::date,jsonb_build_object('remarks',p_data->>'remarks','source_kind','mis_operational','training_category',case when p_module='training-hk' then 'hk' when p_module='training-mepc' then 'technical_mep' else null end),p_actor) returning * into r;
  else
   select * into r from public.retail_mis_records where id=(p_data->>'id')::uuid for update;
   select * into s from public.reliance_retail_store_master where id=r.retail_store_id;
   if not public.retail_mis_unique_store(s.id) or r.id is null or r.module<>p_module or not public.retail_mis_allowed(p_actor,p_module,s.state,true) or r.revision is distinct from (p_data->>'revision')::integer then raise exception using errcode='40001',message='Record unavailable or changed';end if;
   prior:=to_jsonb(r);
   if r.status<>'draft' then raise exception using errcode='42501',message='Submitted records are immutable';end if;
   if p_action='UPDATE' and length(coalesce(p_data->>'remarks',''))<=2000 then update public.retail_mis_records set details=details||jsonb_build_object('remarks',p_data->>'remarks'),revision=revision+1,updated_at=clock_timestamp() where id=r.id returning * into r;
   elsif p_action='SUBMIT' then
    if not exists(select 1 from public.retail_mis_evidence where record_id=r.id and status='uploaded') or exists(select 1 from public.retail_mis_evidence where record_id=r.id and status='pending') then raise exception using errcode='22023',message='Finalize image evidence before submission';end if;
    update public.retail_mis_records set status='submitted',revision=revision+1,updated_at=clock_timestamp() where id=r.id returning * into r;
   else raise exception using errcode='22023',message='Unsupported record action';end if;
  end if;
  outcome:=to_jsonb(r);
 elsif p_module='stores' and p_action='PROPOSE' then
  -- Identity/AOP/ownership activation remains independently reviewed, never direct CRUD.
  select * into s from public.reliance_retail_store_master where upper(btrim(store_code))=upper(btrim(p_data->>'store_code'));
  if s.id is null or (select count(*) from public.reliance_retail_store_master x where upper(btrim(x.store_code))=upper(btrim(s.store_code)))<>1 or not public.retail_mis_allowed(p_actor,'stores',s.state,true) then raise exception using errcode='42501',message='Unique canonical Store Code in assigned state required';end if;
  if length(btrim(coalesce(p_data->>'store_name','')))=0 or length(p_data->>'store_name')>250 or length(coalesce(p_data->>'city',''))>250 or length(btrim(coalesce(p_data->>'reason','')))<3 then raise exception using errcode='22023',message='Proposed name/city and evidence reason required';end if;
  insert into public.retail_mis_store_proposals(store_id,maker_id,changes,baseline,reason) values(s.id,p_actor,jsonb_build_object('store_name',p_data->>'store_name','city',p_data->>'city'),jsonb_build_object('store_name',s.store_name,'city',s.city),p_data->>'reason') returning jsonb_build_object('proposal_id',id,'status',status,'store_id',store_id) into outcome;
 elsif p_module='maintenance' and p_action='COMPLETE' then
  outcome:=public.retail_mis_maintenance_complete(p_actor,(p_data->>'store_id')::uuid,p_data->>'kind',(p_data->>'month')::date,(p_data->>'request_id')::uuid);
 elsif p_module='thermography' then
  outcome:=public.retail_mis_thermography_command(p_actor,p_action,(p_data->>'store_id')::uuid,(p_data->>'id')::uuid,(p_data->>'scheduled_date')::date,(p_data->>'revision')::integer,(p_data->>'request_id')::uuid);
 elsif p_module='fault' and p_action='UPDATE' then
  outcome:=public.retail_mis_fault_update(p_actor,(p_data->>'id')::uuid,p_data->>'stage',p_data->>'remarks',(p_data->>'expected_updated_at')::timestamptz,(p_data->>'request_id')::uuid);
 elsif p_module='cleaning' and p_action='LINK_FO' then outcome:=public.retail_mis_cleaning_link_fo(p_actor,(p_data->>'schedule_id')::uuid,(p_data->>'source_id')::uuid);
 elsif p_module='oos' then
  if not public.retail_mis_oos_enabled() then raise exception using errcode='42501',message='MIS OOS writes await separate activation';end if;
  select * into o from public.retail_service_orders where id=(p_data->>'order_id')::uuid for update;
  if o.id is null or not public.retail_mis_oos_order_allowed(p_actor,o.id,true) then raise exception using errcode='42501',message='OOS order outside assignment';end if;
  if p_action='RETIRE' then
   if o.revision is distinct from (p_data->>'revision')::integer then raise exception using errcode='40001',message='Order changed';end if;
   if o.status<>'QUOTED' or o.details ?| array['po_number','confirmation_ref','fund_ref','payment_ref','delivery_ref'] or exists(select 1 from public.retail_service_events e where e.order_id=o.id and e.action in ('PO_RECORDED','COMMERCIALLY_CONFIRMED','FUND_RECORDED','PAYMENT_RECORDED','DELIVERED')) then raise exception using errcode='42501',message='Financially referenced or progressed quotations cannot be retired';end if;
   insert into public.retail_mis_oos_retirements(order_id,actor_id,reason,request_id,revision) values(o.id,p_actor,p_data->>'reason',(p_data->>'request_id')::uuid,o.revision);
   outcome:=jsonb_build_object('order_id',o.id,'retired',true,'history_preserved',true);
  else outcome:=public.retail_mis_service_command(p_actor,(p_data->>'request_id')::uuid,p_action,o.id,(p_data->>'revision')::integer,coalesce(p_data->'fields','{}'));
  end if;
 else raise exception using errcode='22023',message='Unsupported module action';end if;
 insert into public.retail_mis_audit(actor_id,action,target_id,reason,before_value,after_value) values(p_actor,p_module||':'||p_action,coalesce(r.id,o.id,s.id),coalesce(nullif(p_data->>'reason',''),p_module||' operational '||p_action),prior,outcome);
 return outcome;
end;$$;
