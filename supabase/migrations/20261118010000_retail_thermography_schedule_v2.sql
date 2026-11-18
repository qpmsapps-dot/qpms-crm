begin;
set local lock_timeout='5s';
set local statement_timeout='60s';
-- PREPARED ONLY. Execute in the same reviewed transaction as Thermography reports.
-- Existing duplicate legacy schedules are retained; the trigger prevents NEW duplicates.
create index if not exists retail_thermo_schedule_lookup on public.retail_thermography_inspections(retail_store_id,scheduled_date);
create function public.thermo_schedule_unique() returns trigger language plpgsql set search_path=public,pg_temp as $$
begin
 if tg_op='UPDATE' and new.retail_store_id=old.retail_store_id and new.scheduled_date=old.scheduled_date then return new;end if;
 perform pg_advisory_xact_lock(hashtextextended(new.retail_store_id::text||':'||new.scheduled_date::text,17));
 if exists(select 1 from public.retail_thermography_inspections where retail_store_id=new.retail_store_id and scheduled_date=new.scheduled_date and id<>new.id) then
  raise exception using errcode='23505',message='Store/date already scheduled; existing records are never overwritten';
 end if;return new;
end$$;
create trigger thermo_schedule_unique before insert or update of retail_store_id,scheduled_date on public.retail_thermography_inspections for each row execute function public.thermo_schedule_unique();

create table public.retail_thermography_schedule_imports(
 id uuid primary key default gen_random_uuid(),request_id uuid not null unique,
 actor_id uuid not null references public.profiles(id),month date not null,
 filename text not null,sha256 text not null check(sha256~'^[a-f0-9]{64}$'),
 payload jsonb not null,receipt jsonb not null,created_at timestamptz not null default clock_timestamp()
);
alter table public.retail_thermography_schedule_imports enable row level security;
revoke all on public.retail_thermography_schedule_imports from public,anon,authenticated,service_role;
create trigger thermo_schedule_history_immutable before update or delete on public.retail_thermography_schedule_imports for each row execute function public.retail_operations_immutable();

create function public.rpc_retail_thermography_schedule(p_actor uuid,p_action text,p_data jsonb default '{}') returns jsonb
language plpgsql security definer set search_path=public,pg_temp as $$
declare
 month_start date;today date:=public.retail_operations_today();item jsonb;resolved jsonb:='[]';
 matches integer;s public.reliance_retail_store_master%rowtype;reason text;digest text;
 req uuid:=nullif(p_data->>'request_id','')::uuid;prior public.retail_thermography_schedule_imports%rowtype;
 inspection uuid;result jsonb;created jsonb:='[]';
begin
 if not public.thermo_report_access(p_actor,null,'read') then raise exception using errcode='42501',message='Thermography access required';end if;
 if p_action='history' then
  return coalesce((select jsonb_agg(entry order by created_at desc) from (
   select i.created_at,jsonb_build_object('id',i.id,'month',i.month,'filename',i.filename,'created_at',i.created_at,
    'uploader',p.full_name,'count',jsonb_array_length(i.receipt->'inspections'),'reason',i.payload->>'reason') entry
   from public.retail_thermography_schedule_imports i join public.profiles p on p.id=i.actor_id
   where not exists(select 1 from jsonb_array_elements(i.receipt->'inspections') x where not public.thermo_report_access(p_actor,x->>'state','read'))
   order by i.created_at desc limit 100) h),'[]');
 end if;
 if p_action not in ('preview','import') then raise exception using errcode='22023',message='Unsupported schedule action';end if;
 if not public.thermo_report_access(p_actor,null,'write') then raise exception using errcode='42501',message='State-assigned MEPC MIS editor required';end if;
 if coalesce(p_data->>'month','')!~'^\d{4}-(0[1-9]|1[0-2])$' or jsonb_typeof(p_data->'rows') is distinct from 'array' or jsonb_array_length(p_data->'rows') not between 1 and 5000
  or coalesce(p_data->>'filename','')!~*'\.xlsx$' or coalesce(p_data->>'sha256','')!~'^[a-f0-9]{64}$' then
  raise exception using errcode='22023',message='Valid month, workbook identity and bounded schedule rows required';end if;
 month_start:=((p_data->>'month')||'-01')::date;
 if p_action='import' then
  if req is null then raise exception using errcode='22023',message='Stable request ID required';end if;
  perform pg_advisory_xact_lock(hashtextextended(req::text,18));
  select * into prior from public.retail_thermography_schedule_imports where request_id=req;
  if found then
   if prior.actor_id<>p_actor or prior.payload<>p_data-'request_id' then raise exception using errcode='23505',message='Import request ID reused';end if;
   if exists(select 1 from jsonb_array_elements(prior.receipt->'inspections') x where not public.thermo_report_access(p_actor,x->>'state','write')) then raise exception using errcode='42501',message='Import no longer in authorized scope';end if;
   return prior.receipt;
  end if;
  -- Sorted locks serialize store/date imports without lock-order inversion.
  for item in select value from jsonb_array_elements(p_data->'rows') order by upper(value->>'store_code'),value->>'scheduled_date' loop
   perform pg_advisory_xact_lock(hashtextextended(upper(item->>'store_code')||':'||coalesce(item->>'scheduled_date',''),19));
  end loop;
 end if;
 for item in select value from jsonb_array_elements(p_data->'rows') loop
  reason:=nullif(item->>'error','');s:=null;
  select count(*) into matches from public.reliance_retail_store_master m where upper(btrim(m.store_code))=upper(btrim(item->>'store_code'));
  if matches<>1 then reason:='Unknown or ambiguous Store Code';
  else
   select * into s from public.reliance_retail_store_master m where upper(btrim(m.store_code))=upper(btrim(item->>'store_code'));
   if s.status<>'Active' or not public.retail_mis_unique_store(s.id) or not public.thermo_report_access(p_actor,s.state,'write') then reason:='Store unavailable in authorized scope';end if;
  end if;
  if reason is null then
   begin
    if (item->>'scheduled_date')::date<month_start or (item->>'scheduled_date')::date>=(month_start+interval '1 month')::date or item->>'scheduled_date' is null then reason:='Date outside selected month';end if;
   exception when others then reason:='Invalid scheduled date';end;
  end if;
  if reason is null and (select count(*) from jsonb_array_elements(p_data->'rows') x where upper(x->>'store_code')=upper(item->>'store_code') and x->>'scheduled_date'=item->>'scheduled_date')>1 then reason:='Duplicate store/date in workbook';end if;
  if reason is null and exists(select 1 from public.retail_thermography_inspections t where t.retail_store_id=s.id and t.scheduled_date=(item->>'scheduled_date')::date) then reason:='Store/date already scheduled; no records overwritten';end if;
  resolved:=resolved||jsonb_build_array(jsonb_build_object('row',item->'row','store_code',item->>'store_code','scheduled_date',item->>'scheduled_date',
   'store_id',case when reason is null then s.id end,'store_name',case when reason is null then s.store_name end,'state',case when reason is null then s.state end,'error',reason));
 end loop;
 digest:=md5(resolved::text||p_actor::text||(p_data->>'sha256'));
 if p_action='preview' then return jsonb_build_object('rows',resolved,'preview_digest',digest,'expected_upload_date',month_start-1,'requires_reason',today<>month_start-1,
  'valid',(select count(*) from jsonb_array_elements(resolved) x where x->>'error' is null),'rejected',(select count(*) from jsonb_array_elements(resolved) x where x->>'error' is not null));end if;
 if digest is distinct from p_data->>'preview_digest' then raise exception using errcode='40001',message='Preview changed; review a fresh preview before importing';end if;
 if exists(select 1 from jsonb_array_elements(resolved) x where x->>'error' is not null) then raise exception using errcode='22023',message='Correct all rejected rows before importing';end if;
 if today<>month_start-1 and length(btrim(coalesce(p_data->>'reason','')))<3 then raise exception using errcode='22023',message='Audited early, late or corrective upload reason required';end if;
 perform set_config('myqpms.thermography_report_contract','reports.v1',true);
 for item in select value from jsonb_array_elements(resolved) order by value->>'store_id',value->>'scheduled_date' loop
  insert into public.retail_thermography_inspections(retail_store_id,store_code,state,scheduled_date,created_by,schedule_request_id,report_managed)
   values((item->>'store_id')::uuid,item->>'store_code',item->>'state',(item->>'scheduled_date')::date,p_actor,gen_random_uuid(),true) returning id into inspection;
  created:=created||jsonb_build_array(jsonb_build_object('id',inspection,'state',item->>'state'));
  insert into public.retail_thermography_report_events(inspection_id,actor_id,action,remark,details) values(inspection,p_actor,'SCHEDULE_IMPORTED',left(p_data->>'reason',2000),jsonb_build_object('request_id',req,'sha256',p_data->>'sha256'));
 end loop;
 result:=jsonb_build_object('request_id',req,'month',month_start,'inspections',created,'count',jsonb_array_length(created),'confirmed_at',clock_timestamp());
 insert into public.retail_thermography_schedule_imports(request_id,actor_id,month,filename,sha256,payload,receipt) values(req,p_actor,month_start,left(p_data->>'filename',180),p_data->>'sha256',p_data-'request_id',result);
 return result;
end$$;
revoke all on function public.thermo_schedule_unique(),public.rpc_retail_thermography_schedule(uuid,text,jsonb) from public,anon,authenticated,service_role;
grant execute on function public.rpc_retail_thermography_schedule(uuid,text,jsonb) to service_role;

notify pgrst,'reload schema';
commit;
