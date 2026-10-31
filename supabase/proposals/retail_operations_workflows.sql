-- PREPARED: install only through the authorized production acceptance/release gate.
-- No Store Master/AOP writes, grants to employees, OOS changes or operational seeds.
begin;
create table public.retail_maintenance_calls (
 id uuid primary key default gen_random_uuid(),
 retail_store_id uuid not null references public.reliance_retail_store_master(id) on delete restrict,
 store_code text not null, state text not null,
 kind text not null check(kind in ('CM','PM')),
 report_month date not null check(extract(day from report_month)=1),
 completed_on date not null, completed_at timestamptz not null default now(),
 completed_by uuid not null references public.profiles(id),
 request_id uuid not null unique,
 unique(retail_store_id,kind,report_month),
 check(date_trunc('month',completed_on)::date=report_month),
 check((kind='CM' and extract(day from completed_on)<=15) or (kind='PM' and extract(day from completed_on)>=16))
);
create table public.retail_thermography_inspections (
 id uuid primary key default gen_random_uuid(),
 retail_store_id uuid not null references public.reliance_retail_store_master(id) on delete restrict,
 store_code text not null, state text not null, scheduled_date date not null,
 status text not null default 'Scheduled' check(status in ('Scheduled','Completed','Client Approved')),
 revision integer not null default 1 check(revision>0),
 created_at timestamptz not null default now(),created_by uuid not null references public.profiles(id),
 schedule_request_id uuid not null unique,
 completed_on date,completed_at timestamptz,completed_by uuid references public.profiles(id),completed_request_id uuid unique,
 approval_due_on date,approved_on date,approved_at timestamptz,approved_by uuid references public.profiles(id),approved_request_id uuid unique,
 approved_late boolean not null default false,
 check((status='Scheduled' and completed_on is null and completed_at is null and completed_by is null and completed_request_id is null and approval_due_on is null and approved_on is null and approved_at is null and approved_by is null and approved_request_id is null and not approved_late)
  or (status='Completed' and completed_on is not null and completed_at is not null and completed_by is not null and completed_request_id is not null and approval_due_on is not null and approval_due_on=completed_on+10 and approved_on is null and approved_at is null and approved_by is null and approved_request_id is null and not approved_late)
  or (status='Client Approved' and completed_on is not null and completed_at is not null and completed_by is not null and completed_request_id is not null and approval_due_on is not null and approval_due_on=completed_on+10 and approved_on is not null and approved_at is not null and approved_by is not null and approved_request_id is not null and approved_on>=completed_on and approved_late=(approved_on>approval_due_on))),
 check(completed_on is null or completed_on>=scheduled_date)
);
create index retail_maintenance_month on public.retail_maintenance_calls(report_month,retail_store_id);
create index retail_thermography_date on public.retail_thermography_inspections(scheduled_date,retail_store_id);
alter table public.retail_maintenance_calls enable row level security;
alter table public.retail_thermography_inspections enable row level security;
revoke all on public.retail_maintenance_calls,public.retail_thermography_inspections from public,anon,authenticated,service_role;

create function public.retail_operations_today() returns date language sql stable
set search_path=pg_catalog,public as $$select (now() at time zone 'Asia/Kolkata')::date$$;
create function public.retail_operations_access(p_actor uuid,p_state text,p_write boolean) returns boolean
language sql stable security definer set search_path=pg_catalog,public as $$
 select exists(select 1 from public.profiles p where p.id=p_actor and p.is_active is true and upper(coalesce(p.status,'Active'))='ACTIVE'
 and (regexp_replace(upper(coalesce(p.role,'')),'[^A-Z0-9]','','g') in ('ADMIN','QPMSADMIN') or
  (regexp_replace(upper(coalesce(p.business,'')),'[^A-Z0-9]','','g') in ('RELIANCE','RELIANCERETAIL') and exists(
   select 1 from unnest(array[p.role,p.designation,p.department]) k where regexp_replace(upper(coalesce(k,'')),'[^A-Z0-9]','','g') in ('MIS','HKMIS','HOUSEKEEPINGMIS','TECHNICALMIS','TECHMIS','KAM'))))
 and public.retail_unified_access(p_actor,p_state,case when p_write then 'edit' else 'view' end));
$$;
create function public.retail_operations_immutable() returns trigger language plpgsql
set search_path=pg_catalog,public as $$begin raise exception using errcode='42501',message='Completed maintenance and operational audit records are immutable';end;$$;
create trigger retail_maintenance_immutable before update or delete on public.retail_maintenance_calls
for each row execute function public.retail_operations_immutable();
create trigger retail_thermography_no_delete before delete on public.retail_thermography_inspections
for each row execute function public.retail_operations_immutable();

create function public.rpc_retail_operations_snapshot(p_actor uuid,p_month date) returns jsonb
language plpgsql stable security definer set search_path=pg_catalog,public as $$
begin
 if p_month is null or extract(day from p_month)<>1 then raise exception using errcode='22023',message='First day of reporting month required';end if;
 if not public.retail_operations_access(p_actor,null,false) then raise exception using errcode='42501',message='Active authorized Retail MIS account and state grant required';end if;
 return jsonb_build_object('today',public.retail_operations_today(),'month',p_month,
 'stores',coalesce((select jsonb_agg(jsonb_build_object('id',s.id,'store_code',s.store_code,'store_name',s.store_name,'state',s.state,'store_format',s.store_format,'city',s.city,'status',s.status,'can_save',s.status='Active' and public.retail_operations_access(p_actor,s.state,true)) order by s.store_code)
 from public.reliance_retail_store_master s where public.retail_operations_access(p_actor,s.state,false) and (s.status='Active' or exists(select 1 from public.retail_maintenance_calls c where c.retail_store_id=s.id and c.report_month=p_month) or exists(select 1 from public.retail_thermography_inspections t where t.retail_store_id=s.id and t.scheduled_date>=p_month and t.scheduled_date<(p_month+interval '1 month')::date))),'[]'::jsonb),
 'calls',coalesce((select jsonb_agg(to_jsonb(c) order by c.completed_at) from public.retail_maintenance_calls c join public.reliance_retail_store_master s on s.id=c.retail_store_id where c.report_month=p_month and public.retail_operations_access(p_actor,s.state,false)),'[]'::jsonb),
 'thermography',coalesce((select jsonb_agg(to_jsonb(t)||jsonb_build_object('approval_overdue',t.status='Completed' and public.retail_operations_today()>t.approval_due_on) order by t.scheduled_date,t.id) from public.retail_thermography_inspections t join public.reliance_retail_store_master s on s.id=t.retail_store_id where t.scheduled_date>=p_month and t.scheduled_date<(p_month+interval '1 month')::date and public.retail_operations_access(p_actor,s.state,false)),'[]'::jsonb),
 'events',coalesce((select jsonb_agg(jsonb_build_object('id',a.id,'entity_id',a.entity_id,'action',a.action,'actor_profile_id',a.actor_profile_id,'created_at',a.created_at,'before_state',a.before_state,'after_state',a.after_state) order by a.created_at) from public.reliance_retail_management_audit a
 where (a.entity_type='retail_maintenance' and exists(select 1 from public.retail_maintenance_calls c join public.reliance_retail_store_master s on s.id=c.retail_store_id where c.id=a.entity_id and c.report_month=p_month and public.retail_operations_access(p_actor,s.state,false)))
 or (a.entity_type='retail_thermography' and exists(select 1 from public.retail_thermography_inspections t join public.reliance_retail_store_master s on s.id=t.retail_store_id where t.id=a.entity_id and t.scheduled_date>=p_month and t.scheduled_date<(p_month+interval '1 month')::date and public.retail_operations_access(p_actor,s.state,false)))),'[]'::jsonb));
end;$$;

create function public.rpc_retail_maintenance_complete(p_actor uuid,p_store uuid,p_kind text,p_month date,p_request uuid) returns jsonb
language plpgsql security definer set search_path=pg_catalog,public as $$
declare s public.reliance_retail_store_master%rowtype;c public.retail_maintenance_calls%rowtype;today date:=public.retail_operations_today();
begin
 select * into s from public.reliance_retail_store_master where id=p_store;
 if not found or not public.retail_operations_access(p_actor,s.state,true) then raise exception using errcode='42501',message='Store is outside assigned editor scope';end if;
 if p_request is null or p_kind is null or p_kind not in ('CM','PM') or p_month is null or extract(day from p_month)<>1 then raise exception using errcode='22023',message='Store, kind, month and request ID required';end if;
 select * into c from public.retail_maintenance_calls where request_id=p_request;
 if found then
  if c.retail_store_id<>p_store or c.kind<>p_kind or c.report_month<>p_month or c.completed_by<>p_actor then raise exception using errcode='23505',message='Request ID already used';end if;
  return to_jsonb(c);
 end if;
 if s.status<>'Active' then raise exception using errcode='22023',message='Active canonical Store Code required';end if;
 if date_trunc('month',today)::date<>p_month or (p_kind='CM' and extract(day from today)>15) or (p_kind='PM' and extract(day from today)<16) then
  raise exception using errcode='42501',message='Period is closed or upcoming. CM permits days 1–15; PM permits days 16–month-end. No backdating or closed-month changes.';
 end if;
 insert into public.retail_maintenance_calls(retail_store_id,store_code,state,kind,report_month,completed_on,completed_by,request_id)
 values(s.id,s.store_code,s.state,p_kind,p_month,today,p_actor,p_request) returning * into c;
 insert into public.reliance_retail_management_audit(action,entity_type,entity_id,actor_profile_id,after_state)
 values(p_kind||'_COMPLETED','retail_maintenance',c.id,p_actor,to_jsonb(c));
 return to_jsonb(c);
end;$$;

create function public.rpc_retail_thermography_command(p_actor uuid,p_action text,p_store uuid,p_record uuid,p_scheduled date,p_revision integer,p_request uuid) returns jsonb
language plpgsql security definer set search_path=pg_catalog,public as $$
declare s public.reliance_retail_store_master%rowtype;t public.retail_thermography_inspections%rowtype;b jsonb;today date:=public.retail_operations_today();
begin
 if p_request is null or p_action is null or p_action not in ('Scheduled','Completed','Client Approved') then raise exception using errcode='22023',message='Valid status and request ID required';end if;
 if p_action='Scheduled' then
  select * into s from public.reliance_retail_store_master where id=p_store;
 else
  select * into t from public.retail_thermography_inspections where id=p_record for update;
  if not found then raise exception using errcode='42501',message='Inspection unavailable in authorized scope';end if;
  select * into s from public.reliance_retail_store_master where id=t.retail_store_id;
 end if;
 if s.id is null or not public.retail_operations_access(p_actor,s.state,true) then raise exception using errcode='42501',message='Store is outside assigned editor scope';end if;
 if p_action='Scheduled' then
  if p_scheduled is null or s.status<>'Active' then raise exception using errcode='22023',message='Active canonical store and scheduled date required';end if;
  select * into t from public.retail_thermography_inspections where schedule_request_id=p_request;
  if found then
   if t.retail_store_id<>s.id or t.scheduled_date<>p_scheduled or t.created_by<>p_actor then raise exception using errcode='23505',message='Request ID already used';end if;
   return to_jsonb(t);
  end if;
  insert into public.retail_thermography_inspections(retail_store_id,store_code,state,scheduled_date,created_by,schedule_request_id)
  values(s.id,s.store_code,s.state,p_scheduled,p_actor,p_request) returning * into t;
 else
  if (p_action='Completed' and t.completed_request_id=p_request and t.completed_by=p_actor) or (p_action='Client Approved' and t.approved_request_id=p_request and t.approved_by=p_actor) then return to_jsonb(t);end if;
  if p_revision is null or p_revision<>t.revision then raise exception using errcode='40001',message='Record changed; refresh before saving';end if;
  b:=to_jsonb(t);
  if p_action='Completed' and t.status='Scheduled' and today>=t.scheduled_date then
   update public.retail_thermography_inspections set status='Completed',completed_on=today,completed_at=now(),completed_by=p_actor,completed_request_id=p_request,approval_due_on=today+10,revision=revision+1 where id=t.id returning * into t;
  elsif p_action='Client Approved' and t.status='Completed' then
   update public.retail_thermography_inspections set status='Client Approved',approved_on=today,approved_at=now(),approved_by=p_actor,approved_request_id=p_request,approved_late=today>approval_due_on,revision=revision+1 where id=t.id returning * into t;
  else raise exception using errcode='22023',message='Only Scheduled → Completed → Client Approved is permitted, on or after the scheduled date';end if;
 end if;
 insert into public.reliance_retail_management_audit(action,entity_type,entity_id,actor_profile_id,before_state,after_state)
 values('THERMOGRAPHY_'||upper(replace(p_action,' ','_')),'retail_thermography',t.id,p_actor,b,to_jsonb(t));
 return to_jsonb(t);
end;$$;
revoke all on function public.retail_operations_today(),public.retail_operations_access(uuid,text,boolean),public.retail_operations_immutable(),public.rpc_retail_operations_snapshot(uuid,date),public.rpc_retail_maintenance_complete(uuid,uuid,text,date,uuid),public.rpc_retail_thermography_command(uuid,text,uuid,uuid,date,integer,uuid) from public,anon,authenticated,service_role;
grant execute on function public.rpc_retail_operations_snapshot(uuid,date),public.rpc_retail_maintenance_complete(uuid,uuid,text,date,uuid),public.rpc_retail_thermography_command(uuid,text,uuid,uuid,date,integer,uuid) to service_role;
notify pgrst,'reload schema';
commit;
