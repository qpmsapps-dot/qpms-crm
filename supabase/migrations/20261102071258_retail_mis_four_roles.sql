-- LOCAL CANDIDATE ONLY. No production execution or user assignment is authorized.
-- Additive MIS API. Existing installed workflow/security definitions are not replaced.
begin;
set local lock_timeout='5s';
set local statement_timeout='60s';
create table public.retail_mis_assignments(
 profile_id uuid primary key references public.profiles(id) on delete restrict,
 auth_user_id uuid not null unique,employee_code text not null,
 role text not null check(role in ('CENTRAL_MIS','MIS_HK','MIS_MEPC','MIS_OOS')),
 states text[] not null,active boolean not null default true,revision integer not null default 1,
 previous_profile jsonb not null,changed_by uuid not null references public.profiles(id),changed_at timestamptz not null default now(),
 check((role='CENTRAL_MIS' and cardinality(states)=0) or (role<>'CENTRAL_MIS' and cardinality(states)>0)),
 check(states <@ array['AP-1','AP-2','KA','KL','TG','TN','PY']::text[])
);
create table public.retail_mis_audit(
 id uuid primary key default gen_random_uuid(),actor_id uuid not null references public.profiles(id),
 action text not null,target_id uuid,reason text not null check(length(btrim(reason)) between 3 and 2000),
 before_value jsonb,after_value jsonb,created_at timestamptz not null default clock_timestamp()
);
create table public.retail_mis_records(
 id uuid primary key default gen_random_uuid(),module text not null check(module in ('pest','cleaning','training-hk','training-mepc')),
 retail_store_id uuid not null references public.reliance_retail_store_master(id) on delete restrict,
 activity_date date not null,status text not null default 'draft' check(status in ('draft','submitted','retired')),
 details jsonb not null default '{}',created_by uuid not null references public.profiles(id),revision int not null default 1,
 created_at timestamptz not null default now(),updated_at timestamptz not null default now()
);
-- FO-style two-phase private evidence. No synthetic attendance/site visit or FO ownership.
create table public.retail_mis_evidence(
 id uuid primary key default gen_random_uuid(),record_id uuid not null references public.retail_mis_records(id) on delete restrict,
 bucket text not null default 'retail-mis-evidence' check(bucket='retail-mis-evidence'),path text not null unique,
 mime_type text not null check(mime_type in ('image/jpeg','image/png','image/webp')),file_size bigint not null check(file_size between 1 and 5242880),
 created_by uuid not null references public.profiles(id),status text not null default 'pending' check(status in ('pending','uploaded','retired')),
 created_at timestamptz not null default now()
);
create table public.retail_mis_oos_retirements(
 order_id uuid primary key references public.retail_service_orders(id) on delete restrict,
 actor_id uuid not null references public.profiles(id),reason text not null check(length(btrim(reason)) between 3 and 2000),
 request_id uuid not null unique,revision int not null,created_at timestamptz not null default now()
);
create index retail_mis_records_scope on public.retail_mis_records(module,retail_store_id,activity_date);
create index retail_mis_evidence_record on public.retail_mis_evidence(record_id,status);
create function public.retail_mis_immutable() returns trigger language plpgsql set search_path=pg_catalog,public as $$begin raise exception 'Immutable Retail MIS history';end;$$;
create trigger retail_mis_audit_immutable before update or delete on public.retail_mis_audit for each row execute function public.retail_mis_immutable();
create trigger retail_mis_retirement_immutable before update or delete on public.retail_mis_oos_retirements for each row execute function public.retail_mis_immutable();
-- Extend only the existing profile role constraint. Do not rename legacy MIS globally.
do $roles$ declare c record;definition text;found_roles integer:=0;begin
 for c in select oid,conname,convalidated,pg_get_expr(conbin,conrelid) expression from pg_constraint where conrelid='public.profiles'::regclass and contype='c' and pg_get_constraintdef(oid) like '%role = ANY%' loop
  definition:=format('CHECK ((%s) OR role IN (''CENTRAL_MIS'',''MIS_HK'',''MIS_MEPC'',''MIS_OOS''))',c.expression);
  execute format('alter table public.profiles drop constraint %I',c.conname);
  execute format('alter table public.profiles add constraint %I %s%s',c.conname,definition,case when c.convalidated then '' else ' NOT VALID' end);
  found_roles:=found_roles+1;
 end loop;
 if found_roles<>1 then raise exception 'Expected exactly one installed profile role constraint';end if;
end;$roles$;
create function public.retail_mis_super(p_actor uuid) returns boolean language sql stable security definer set search_path=pg_catalog,public as $$
 select exists(select 1 from public.profiles p where p.id=p_actor and p.is_active is true and upper(coalesce(p.status,'Active'))='ACTIVE' and
 ((p.id='d40c2b3f-87f1-4c34-8798-cf9b0d9ca784' and p.auth_user_id='79cd196c-c6f3-404a-b22a-d4683afefa3f' and p.employee_code='QPMSADMIN' and p.role in ('Admin','QPMS Admin')) or p.role='Super Admin'));
$$;
create function public.retail_mis_allowed(p_actor uuid,p_module text,p_state text,p_write boolean default false) returns boolean language sql stable security definer set search_path=pg_catalog,public as $$
 select exists(select 1 from public.retail_mis_assignments a join public.profiles p on p.id=a.profile_id
 where a.profile_id=p_actor and a.active and p.is_active is true and upper(coalesce(p.status,'Active'))='ACTIVE'
 and p.auth_user_id=a.auth_user_id and p.employee_code=a.employee_code and p.role=a.role
 and (p_state is null or (p_state in ('AP-1','AP-2','KA','KL','TG','TN','PY') and (a.role='CENTRAL_MIS' or p_state=any(a.states))))
 and case a.role when 'CENTRAL_MIS' then p_module=any(array['dashboard','stores','attendance-hk','attendance-mepc','cleaning','pest','training-hk','training-mepc','fault','maintenance','thermography','oos','imports'])
 when 'MIS_HK' then p_module=any(array['stores','attendance-hk','cleaning','pest','training-hk'])
 when 'MIS_MEPC' then p_module=any(array['stores','attendance-mepc','fault','maintenance','thermography']) when 'MIS_OOS' then p_module='oos' else false end);
$$;
create function public.retail_mis_unique_store(p_store uuid) returns boolean language sql stable security definer set search_path=pg_catalog,public as $$select exists(select 1 from public.reliance_retail_store_master s where s.id=p_store and nullif(btrim(s.store_code),'') is not null and (select count(*) from public.reliance_retail_store_master d where upper(btrim(d.store_code))=upper(btrim(s.store_code)))=1)$$;
create function public.rpc_retail_mis_access(p_actor uuid,p_auth uuid) returns jsonb language sql stable security definer set search_path=pg_catalog,public as $$
 select coalesce((select jsonb_build_object('profile_id',a.profile_id,'role',a.role,'states',case when a.role='CENTRAL_MIS' then array['AP-1','AP-2','KA','KL','TG','TN','PY'] else a.states end,'active',a.active and p.is_active and p.role=a.role and p.auth_user_id=a.auth_user_id and p.employee_code=a.employee_code and upper(coalesce(p.status,'Active'))='ACTIVE','revision',a.revision)
 from public.retail_mis_assignments a join public.profiles p on p.id=a.profile_id where a.profile_id=p_actor and a.auth_user_id=p_auth and p.auth_user_id=p_auth),'{}');
$$;
create function public.rpc_retail_mis_assignments(p_actor uuid) returns jsonb language plpgsql stable security definer set search_path=pg_catalog,public as $$begin
 if not public.retail_mis_super(p_actor) then raise exception using errcode='42501',message='Super Admin required';end if;
 return coalesce((select jsonb_agg(to_jsonb(a)-'previous_profile' order by a.employee_code) from public.retail_mis_assignments a),'[]');end;$$;
create function public.rpc_retail_mis_assign(p_actor uuid,p_target uuid,p_auth uuid,p_employee text,p_role text,p_states text[],p_reason text,p_expected integer) returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $$
declare p public.profiles%rowtype;a public.retail_mis_assignments%rowtype;prior jsonb;result jsonb;begin
 if not public.retail_mis_super(p_actor) or p_target=p_actor then raise exception using errcode='42501',message='Super Admin required; self assignment prohibited';end if;
 if p_reason is null or length(btrim(p_reason)) not between 3 and 2000 or (p_role is not null and p_role not in ('CENTRAL_MIS','MIS_HK','MIS_MEPC','MIS_OOS')) then raise exception using errcode='22023',message='Role and audit reason required';end if;
 perform pg_advisory_xact_lock(hashtextextended('retail_mis_assignment:'||p_target::text,0));
 select * into p from public.profiles where id=p_target for update;
 if not found or p.auth_user_id is distinct from p_auth or p.employee_code is distinct from p_employee or (p_role is not null and (p.is_active is not true or upper(coalesce(p.status,'Active'))<>'ACTIVE'))
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
  if p_states is null or (p_role='CENTRAL_MIS' and cardinality(p_states)<>0) or (p_role<>'CENTRAL_MIS' and cardinality(p_states)=0) or not(p_states <@ array['AP-1','AP-2','KA','KL','TG','TN','PY']::text[]) or array_position(p_states,null) is not null then raise exception using errcode='22023',message='Explicit geographic states required; AP and wildcard are forbidden';end if;
  insert into public.retail_mis_assignments(profile_id,auth_user_id,employee_code,role,states,previous_profile,changed_by,revision)
  values(p_target,p_auth,p_employee,p_role,array(select distinct unnest(p_states) order by 1),coalesce(a.previous_profile,jsonb_build_object('role',p.role,'business',p.business,'designation',p.designation)),p_actor,coalesce(a.revision,0)+1)
  on conflict(profile_id) do update set role=excluded.role,states=excluded.states,active=true,revision=excluded.revision,changed_by=p_actor,changed_at=clock_timestamp() returning to_jsonb(retail_mis_assignments) into result;
  update public.profiles set role=p_role,business='Reliance Retail',designation=case p_role when 'CENTRAL_MIS' then 'Central MIS' when 'MIS_HK' then 'MIS-HK' when 'MIS_MEPC' then 'MIS-MEPC' else 'MIS-OOS' end where id=p_target;
 end if;
 insert into public.retail_mis_audit(actor_id,action,target_id,reason,before_value,after_value) values(p_actor,'ROLE_STATE_ASSIGNMENT',p_target,p_reason,prior,result);
 return result-'previous_profile';end;$$;
create function public.rpc_retail_mis_oos_stores(p_actor uuid) returns jsonb language plpgsql stable security definer set search_path=pg_catalog,public as $$begin
 if not public.retail_mis_allowed(p_actor,'oos',null) then raise exception using errcode='42501',message='OOS assignment required';end if;
 -- Narrow lookup is only used internally for quotation validation, not returned by the HTTP API.
 return coalesce((select jsonb_agg(jsonb_build_object('id',s.id,'store_code',s.store_code,'store_name',s.store_name,'state',s.state,'status',s.status)) from public.reliance_retail_store_master s where public.retail_mis_allowed(p_actor,'oos',s.state)),'[]');end;$$;
create function public.retail_mis_oos_order_allowed(p_actor uuid,p_order uuid,p_write boolean) returns boolean language sql stable security definer set search_path=pg_catalog,public as $$
 select exists(select 1 from public.retail_service_orders o where o.id=p_order and o.kind='OOS' and cardinality(o.store_ids)>0
 and (select count(*) from public.reliance_retail_store_master s where s.id=any(o.store_ids))=cardinality(o.store_ids)
 and (select count(distinct s.state) from public.reliance_retail_store_master s where s.id=any(o.store_ids))=1
 and not exists(select 1 from public.reliance_retail_store_master s where s.id=any(o.store_ids) and (s.state<>o.state or not public.retail_mis_allowed(p_actor,'oos',s.state,p_write)
 or (select count(*) from public.reliance_retail_store_master x where upper(btrim(x.store_code))=upper(btrim(s.store_code)))<>1))
 and not exists(select 1 from jsonb_array_elements(coalesce(o.details->'items','[]')) i where not exists(select 1 from public.reliance_retail_store_master s where s.id=any(o.store_ids) and s.id::text=i->>'store_id' and (not(i ? 'store_code') or upper(btrim(i->>'store_code'))=upper(btrim(s.store_code))))));
$$;
create function public.rpc_retail_mis_report(p_actor uuid,p_module text,p_from date,p_to date,p_state text default null) returns jsonb language plpgsql stable security definer set search_path=pg_catalog,public as $$
declare ids uuid[];rows jsonb:='[]';stores jsonb:='[]';aop jsonb:='[]';evidence jsonb:='[]';begin
 if not public.retail_mis_allowed(p_actor,p_module,p_state) then raise exception using errcode='42501',message='Outside module/state scope';end if;
 if p_from is null or p_to is null or p_to<p_from or p_to-p_from>366 then raise exception using errcode='22023',message='Reporting range up to 366 days required';end if;
 select coalesce(array_agg(s.id),'{}') into ids from public.reliance_retail_store_master s where public.retail_mis_allowed(p_actor,p_module,s.state) and (p_state is null or s.state=p_state);
 if p_module<>'stores' and exists(select 1 from public.reliance_retail_store_master s where s.id=any(ids) and not public.retail_mis_unique_store(s.id)) then raise exception using errcode='42501',message='Ambiguous canonical Store Code; report unavailable pending reconciliation';end if;
 if p_module<>'oos' then select coalesce(jsonb_agg(jsonb_build_object('id',s.id,'store_code',s.store_code,'store_name',s.store_name,'state',s.state,'status',s.status) order by s.store_code),'[]') into stores from public.reliance_retail_store_master s where s.id=any(ids);end if;
 if p_module='stores' then rows:=stores;
 elsif p_module like 'attendance-%' then
  select coalesce(jsonb_agg(to_jsonb(x)),'[]') into rows from (select a.retail_store_id,a.attendance_date,a.class,sum(a.credit) credit from public.retail_employee_daily_attendance a where a.retail_store_id=any(ids) and a.superseded_at is null and a.attendance_date between p_from and p_to and a.class=case when p_module='attendance-hk' then 'HK' else 'MEPC' end group by 1,2,3) x;
  select coalesce(jsonb_agg(jsonb_build_object('retail_store_id',a.retail_store_id,'hk_count',case when p_module='attendance-hk' then a.hk_count else null end,'mepc_count',case when p_module='attendance-mepc' then a.mepc_count else null end,'effective_from',a.effective_from,'effective_to',a.effective_to,'mepc_cycle_anchor',a.mepc_cycle_anchor,'aop_class',a.aop_class)),'[]') into aop from public.retail_attendance_aop_versions a where a.retail_store_id=any(ids) and a.superseded_at is null and a.effective_from<=p_to and (a.effective_to is null or a.effective_to>=p_from) and (a.aop_class is null or a.aop_class=case when p_module='attendance-hk' then 'HK' else 'MEPC' end);
 elsif p_module='maintenance' then select coalesce(jsonb_agg(to_jsonb(x)),'[]') into rows from public.retail_maintenance_calls x where x.retail_store_id=any(ids) and x.completed_on between p_from and p_to;
 elsif p_module='thermography' then select coalesce(jsonb_agg(to_jsonb(x)),'[]') into rows from public.retail_thermography_inspections x where x.retail_store_id=any(ids) and x.scheduled_date between p_from and p_to;
 elsif p_module='fault' then
  select coalesce(jsonb_agg(to_jsonb(t)-'raw_row'),'[]') into rows from public.fault_tracker_tickets t where t.is_active is true and (select count(*) from public.reliance_retail_store_master s where upper(btrim(s.store_code))=upper(btrim(t.store_code)))=1 and exists(select 1 from public.reliance_retail_store_master s where s.id=any(ids) and upper(btrim(s.store_code))=upper(btrim(t.store_code)) and s.status='Active');
 elsif p_module='oos' then
  select coalesce(jsonb_agg(public.retail_service_public_order(to_jsonb(o))||jsonb_build_object('store_codes_by_id',(select jsonb_object_agg(s.id::text,s.store_code) from public.reliance_retail_store_master s where s.id=any(o.store_ids)),'store_codes',(select jsonb_agg(s.store_code order by s.store_code) from public.reliance_retail_store_master s where s.id=any(o.store_ids)),'retired',exists(select 1 from public.retail_mis_oos_retirements r where r.order_id=o.id))),'[]') into rows from public.retail_service_orders o where public.retail_mis_oos_order_allowed(p_actor,o.id,false) and (p_state is null or o.state=p_state);
 elsif p_module in ('pest','cleaning','training-hk','training-mepc') then
  select coalesce(jsonb_agg(to_jsonb(r)||jsonb_build_object('store_code',s.store_code,'store_name',s.store_name,'state',s.state,'remarks',r.details->>'remarks')),'[]') into rows from public.retail_mis_records r join public.reliance_retail_store_master s on s.id=r.retail_store_id where r.module=p_module and r.retail_store_id=any(ids) and r.activity_date between p_from and p_to;
  if p_module='cleaning' then
   rows:=rows||coalesce((select jsonb_agg(to_jsonb(s)||jsonb_build_object('source_kind','existing_schedule')) from public.client_deep_cleaning_schedules s where s.retail_store_id=any(ids) and s.scheduled_date between p_from and p_to),'[]')
    ||coalesce((select jsonb_agg(to_jsonb(s)||jsonb_build_object('source_kind','existing_submission')) from public.client_deep_cleaning_submissions s join public.reliance_retail_store_master m on m.id=s.retail_store_id and upper(btrim(m.store_code))=upper(btrim(s.store_code)) and m.state=s.state where s.retail_store_id=any(ids) and s.deep_cleaning_date between p_from and p_to),'[]');
  elsif p_module like 'training-%' then
   rows:=rows||coalesce((select jsonb_agg(to_jsonb(t)||jsonb_build_object('source_kind','existing_fo_training')) from public.training_sessions t join public.training_categories c on c.id=t.category_id join public.reliance_retail_store_master m on m.id=t.retail_store_id and upper(btrim(m.store_code))=upper(btrim(t.store_code_snapshot)) and m.state=case when t.state_snapshot='KN' then 'KA' else t.state_snapshot end where t.retail_store_id=any(ids) and t.access_client_code='reliance_retail' and t.training_date between p_from and p_to and c.code=case when p_module='training-hk' then 'hk' else 'technical_mep' end),'[]');
  end if;
  select coalesce(jsonb_agg(jsonb_build_object('id',e.id,'record_id',e.record_id,'status',e.status,'mime_type',e.mime_type)),'[]') into evidence from public.retail_mis_evidence e join public.retail_mis_records r on r.id=e.record_id where r.module=p_module and r.retail_store_id=any(ids) and r.activity_date between p_from and p_to;
  if p_module='cleaning' then evidence:=evidence||coalesce((select jsonb_agg(jsonb_build_object('id',e.id,'record_id',r.id,'status','uploaded','existing',true)) from public.client_deep_cleaning_uploads e join public.client_deep_cleaning_submissions r on r.id=e.submission_id join public.reliance_retail_store_master m on m.id=r.retail_store_id and upper(btrim(m.store_code))=upper(btrim(r.store_code)) and m.state=r.state where r.retail_store_id=any(ids) and r.deep_cleaning_date between p_from and p_to and e.upload_status='uploaded'),'[]');
  elsif p_module like 'training-%' then evidence:=evidence||coalesce((select jsonb_agg(jsonb_build_object('id',e.id,'record_id',r.id,'status','uploaded','existing',true)) from public.training_evidence e join public.training_sessions r on r.id=e.training_session_id join public.training_categories c on c.id=r.category_id join public.reliance_retail_store_master m on m.id=r.retail_store_id and upper(btrim(m.store_code))=upper(btrim(r.store_code_snapshot)) and m.state=case when r.state_snapshot='KN' then 'KA' else r.state_snapshot end where r.retail_store_id=any(ids) and r.access_client_code='reliance_retail' and r.training_date between p_from and p_to and c.code=case when p_module='training-hk' then 'hk' else 'technical_mep' end),'[]');end if;
 elsif p_module='imports' then select coalesce(jsonb_agg(jsonb_build_object('id',u.id,'filename',u.filename,'kind',u.kind,'status',u.status,'uploaded_at',u.uploaded_at)),'[]') into rows from public.retail_attendance_uploads u;
 elsif p_module='dashboard' then
  rows:=jsonb_build_array(jsonb_build_object('active_stores',(select count(*) from public.reliance_retail_store_master s where s.id=any(ids) and s.status='Active'),'attendance_credits',(select coalesce(sum(credit),0) from public.retail_employee_daily_attendance a where a.retail_store_id=any(ids) and a.superseded_at is null and a.attendance_date between p_from and p_to),
  'maintenance_completed',(select count(*) from public.retail_maintenance_calls c where c.retail_store_id=any(ids) and c.completed_on between p_from and p_to),
  'thermography_inspections',(select count(*) from public.retail_thermography_inspections c where c.retail_store_id=any(ids) and c.scheduled_date between p_from and p_to),
  'existing_cleaning_submissions',(select count(*) from public.client_deep_cleaning_submissions c join public.reliance_retail_store_master m on m.id=c.retail_store_id and upper(btrim(m.store_code))=upper(btrim(c.store_code)) and m.state=c.state where c.retail_store_id=any(ids) and c.deep_cleaning_date between p_from and p_to),
  'existing_training_sessions',(select count(*) from public.training_sessions c join public.reliance_retail_store_master m on m.id=c.retail_store_id and upper(btrim(m.store_code))=upper(btrim(c.store_code_snapshot)) and m.state=case when c.state_snapshot='KN' then 'KA' else c.state_snapshot end where c.retail_store_id=any(ids) and c.access_client_code='reliance_retail' and c.training_date between p_from and p_to),
  'mis_submitted_activities',(select count(*) from public.retail_mis_records c where c.retail_store_id=any(ids) and c.status='submitted' and c.activity_date between p_from and p_to),
  'oos_orders',(select count(*) from public.retail_service_orders o where public.retail_mis_oos_order_allowed(p_actor,o.id,false))));
 end if;
 return jsonb_build_object('module',p_module,'from',p_from,'to',p_to,'stores',stores,'rows',rows,'aop',aop,'evidence',evidence,'complete',true);
end;$$;
-- PRIVATE immutable-evidence namespace. Existing FO buckets/guards remain untouched.
insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types) values('retail-mis-evidence','retail-mis-evidence',false,5242880,array['image/jpeg','image/png','image/webp']);
create function public.retail_mis_storage_guard() returns trigger language plpgsql security definer set search_path=pg_catalog,public as $$begin
 if (tg_op<>'INSERT' and old.bucket_id='retail-mis-evidence') or (tg_op='UPDATE' and new.bucket_id='retail-mis-evidence') then raise exception 'Retail MIS evidence objects are immutable; retire metadata instead';end if;
 if tg_op='INSERT' and new.bucket_id='retail-mis-evidence' and not exists(select 1 from public.retail_mis_evidence e join public.retail_mis_records r on r.id=e.record_id join public.reliance_retail_store_master s on s.id=r.retail_store_id where e.path=new.name and e.status='pending' and r.status='draft' and public.retail_mis_allowed(e.created_by,r.module,s.state,true)) then raise exception 'Prepared active scoped draft evidence required';end if;
 if tg_op='DELETE' then return old;end if;return new;end;$$;
create trigger retail_mis_storage_guard before insert or update or delete on storage.objects for each row execute function public.retail_mis_storage_guard();
-- Restrictive policies close access through unrelated existing permissive policies.
create policy retail_mis_private_read on storage.objects as restrictive for select to authenticated using(bucket_id<>'retail-mis-evidence');
create policy retail_mis_private_insert on storage.objects as restrictive for insert to authenticated with check(bucket_id<>'retail-mis-evidence');
create policy retail_mis_private_update on storage.objects as restrictive for update to authenticated using(bucket_id<>'retail-mis-evidence') with check(bucket_id<>'retail-mis-evidence');
create policy retail_mis_private_delete on storage.objects as restrictive for delete to authenticated using(bucket_id<>'retail-mis-evidence');
create function public.retail_mis_current_account() returns boolean language sql stable security definer set search_path=pg_catalog,public as $$select exists(select 1 from public.profiles p where p.auth_user_id=auth.uid() and p.role in ('CENTRAL_MIS','MIS_HK','MIS_MEPC','MIS_OOS')) or exists(select 1 from public.retail_mis_assignments a where a.auth_user_id=auth.uid() and a.active)$$;
do $profile_rls$ begin if not exists(select 1 from pg_class where oid='public.profiles'::regclass and relrowsecurity) then raise exception 'Existing profiles RLS is required';end if;end;$profile_rls$;
-- Direct self-profile changes cannot rewrite authority or create a second login
-- profile. Backend self-service uses its established service-role whitelist.
create policy retail_mis_profile_read on public.profiles as restrictive for select to authenticated using(not public.retail_mis_current_account() or auth_user_id=auth.uid());
create policy retail_mis_profile_insert on public.profiles as restrictive for insert to authenticated with check(not public.retail_mis_current_account());
create policy retail_mis_profile_update on public.profiles as restrictive for update to authenticated using(not public.retail_mis_current_account()) with check(not public.retail_mis_current_account());
create policy retail_mis_profile_delete on public.profiles as restrictive for delete to authenticated using(not public.retail_mis_current_account());
-- New roles retrieve legacy private evidence through scoped backend signing only.
-- Existing roles retain their existing policies; no broad permissive policy added.
create policy retail_mis_legacy_private_read on storage.objects as restrictive for select to authenticated using(not public.retail_mis_current_account() or bucket_id not in ('fo-activity-uploads','training-evidence','client-deep-cleaning-uploads'));
create policy retail_mis_legacy_private_insert on storage.objects as restrictive for insert to authenticated with check(not public.retail_mis_current_account() or bucket_id not in ('fo-activity-uploads','training-evidence','client-deep-cleaning-uploads'));
create policy retail_mis_legacy_private_update on storage.objects as restrictive for update to authenticated using(not public.retail_mis_current_account() or bucket_id not in ('fo-activity-uploads','training-evidence','client-deep-cleaning-uploads')) with check(not public.retail_mis_current_account() or bucket_id not in ('fo-activity-uploads','training-evidence','client-deep-cleaning-uploads'));
create policy retail_mis_legacy_private_delete on storage.objects as restrictive for delete to authenticated using(not public.retail_mis_current_account() or bucket_id not in ('fo-activity-uploads','training-evidence','client-deep-cleaning-uploads'));
-- Contain legacy direct Data API access as well as HTTP routes. Existing
-- employees retain their existing permissive policies; no RLS flag is changed.
do $legacy_scope$ declare t text;begin
 foreach t in array array['fault_tracker_import_batches','fault_tracker_tickets','fault_tracker_ticket_updates','fo_activity_submissions','fo_activity_uploads'] loop
  if not exists(select 1 from pg_class where oid=to_regclass('public.'||t) and relkind='r' and relrowsecurity) then raise exception 'Required legacy RLS prerequisite missing: %',t;end if;
  execute format('create policy retail_mis_api_only on public.%I as restrictive for all to authenticated using (not public.retail_mis_current_account()) with check (not public.retail_mis_current_account())',t);
 end loop;
end;$legacy_scope$;
create function public.rpc_retail_mis_evidence_prepare(p_actor uuid,p_module text,p_record uuid,p_mime text,p_size bigint) returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $$
declare r public.retail_mis_records%rowtype;s public.reliance_retail_store_master%rowtype;e public.retail_mis_evidence%rowtype;eid uuid:=gen_random_uuid();begin
 select * into r from public.retail_mis_records where id=p_record for update;select * into s from public.reliance_retail_store_master where id=r.retail_store_id;
 if not public.retail_mis_unique_store(s.id) or r.id is null or r.module is distinct from p_module or r.status<>'draft' or not public.retail_mis_allowed(p_actor,r.module,s.state,true) then raise exception using errcode='42501',message='Scoped draft required';end if;
 insert into public.retail_mis_evidence(id,record_id,path,mime_type,file_size,created_by) values(eid,r.id,p_actor::text||'/'||s.id::text||'/'||r.module||'/'||r.id::text||'/'||eid::text,p_mime,p_size,p_actor) returning * into e;
 insert into public.retail_mis_audit(actor_id,action,target_id,reason,after_value) values(p_actor,'EVIDENCE_PREPARED',e.id,'Private draft evidence upload',to_jsonb(e));return to_jsonb(e);end;$$;
create function public.rpc_retail_mis_evidence_object(p_actor uuid,p_evidence uuid,p_write boolean) returns jsonb language plpgsql stable security definer set search_path=pg_catalog,public as $$
declare e public.retail_mis_evidence%rowtype;r public.retail_mis_records%rowtype;s public.reliance_retail_store_master%rowtype;begin
 select * into e from public.retail_mis_evidence where id=p_evidence;select * into r from public.retail_mis_records where id=e.record_id;select * into s from public.reliance_retail_store_master where id=r.retail_store_id;
 if not public.retail_mis_unique_store(s.id) or e.id is null or not public.retail_mis_allowed(p_actor,r.module,s.state,p_write) or (p_write and (r.status<>'draft' or e.created_by<>p_actor or e.status<>'pending')) or (not p_write and (e.status<>'uploaded' or r.status='retired')) then raise exception using errcode='42501',message='Evidence outside scope or immutable';end if;return to_jsonb(e);end;$$;
create function public.rpc_retail_mis_evidence_finalize(p_actor uuid,p_evidence uuid) returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $$declare e jsonb;begin
 perform 1 from public.retail_mis_records where id=(select record_id from public.retail_mis_evidence where id=p_evidence) for update;
 e:=public.rpc_retail_mis_evidence_object(p_actor,p_evidence,true);
 if not exists(select 1 from storage.objects o where o.bucket_id=e->>'bucket' and o.name=e->>'path' and (o.metadata->>'size')::bigint=(e->>'file_size')::bigint and o.metadata->>'mimetype'=e->>'mime_type') then raise exception using errcode='22023',message='Stored object size/type mismatch';end if;
 update public.retail_mis_evidence set status='uploaded' where id=p_evidence;
 insert into public.retail_mis_audit(actor_id,action,target_id,reason,before_value,after_value) values(p_actor,'EVIDENCE_FINALIZED',p_evidence,'Stored private object verified',e,e||'{"status":"uploaded"}');return jsonb_build_object('id',p_evidence,'status','uploaded');end;$$;
create function public.rpc_retail_mis_evidence_retire(p_actor uuid,p_evidence uuid,p_reason text) returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $$declare e jsonb;begin
 perform 1 from public.retail_mis_records where id=(select record_id from public.retail_mis_evidence where id=p_evidence) for update;
 e:=public.rpc_retail_mis_evidence_object(p_actor,p_evidence,false);
 if not exists(select 1 from public.retail_mis_records where id=(e->>'record_id')::uuid and status='draft') then raise exception using errcode='42501',message='Submitted evidence is immutable';end if;
 if not public.retail_mis_allowed(p_actor,(select module from public.retail_mis_records where id=(e->>'record_id')::uuid),(select s.state from public.retail_mis_records r join public.reliance_retail_store_master s on s.id=r.retail_store_id where r.id=(e->>'record_id')::uuid),true) then raise exception using errcode='42501',message='Scoped editor required';end if;
 update public.retail_mis_evidence set status='retired' where id=p_evidence;
 insert into public.retail_mis_audit(actor_id,action,target_id,reason,before_value,after_value) values(p_actor,'EVIDENCE_RETIRED',p_evidence,p_reason,e,e||'{"status":"retired"}');return jsonb_build_object('retired',true);end;$$;
-- BEGIN GENERATED MIS WORKFLOWS
-- Local MIS command adapters. Appended to the single reviewed migration by build script.
create function public.rpc_retail_mis_oos_history(p_actor uuid,p_order uuid) returns jsonb language plpgsql stable security definer set search_path=pg_catalog,public as $$begin
 if not public.retail_mis_oos_order_allowed(p_actor,p_order,false) then raise exception using errcode='42501',message='Quotation outside assigned scope';end if;
 return coalesce((select jsonb_agg(jsonb_build_object('id',e.id,'action',e.action,'actor_id',e.actor_id,'created_at',e.created_at,'before_value',public.retail_service_public_order(e.before_value),'after_value',public.retail_service_public_order(e.after_value),'evidence',e.evidence-'original_base64','has_workbook',e.evidence ? 'original_base64') order by e.created_at,e.id) from public.retail_service_events e where e.order_id=p_order),'[]')||coalesce((select jsonb_agg(jsonb_build_object('id',r.order_id,'action','RETIRED','actor_id',r.actor_id,'created_at',r.created_at,'evidence',jsonb_build_object('reason',r.reason,'revision',r.revision),'has_workbook',false)) from public.retail_mis_oos_retirements r where r.order_id=p_order),'[]');end;$$;
create function public.rpc_retail_mis_oos_attachment(p_actor uuid,p_event uuid) returns jsonb language plpgsql stable security definer set search_path=pg_catalog,public as $$declare e public.retail_service_events%rowtype;begin
 select * into e from public.retail_service_events where id=p_event;
 if e.id is null or not public.retail_mis_oos_order_allowed(p_actor,e.order_id,false) or not(e.evidence ? 'original_base64') then raise exception using errcode='42501',message='Quotation attachment unavailable in assigned scope';end if;
 -- Legacy imports can share one workbook across quotations in different states.
 -- A scoped order does not authorize downloading the other quotations' bytes.
 if exists(select 1 from public.retail_service_events peer where coalesce(peer.evidence->>'quotation_file_sha256',peer.evidence->>'file_sha256')=coalesce(e.evidence->>'quotation_file_sha256',e.evidence->>'file_sha256') and not public.retail_mis_oos_order_allowed(p_actor,peer.order_id,false)) then raise exception using errcode='42501',message='Shared workbook contains quotations outside assigned scope';end if;
 return jsonb_build_object('original_base64',e.evidence->>'original_base64','sha256',coalesce(e.evidence->>'quotation_file_sha256',e.evidence->>'file_sha256'));end;$$;
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

-- GENERATED by scripts/buildRetailMisWorkflowAdapters.mjs. Review-only local adapters.
create function public.retail_mis_maintenance_complete(p_actor uuid,p_store uuid,p_kind text,p_month date,p_request uuid) returns jsonb
language plpgsql security definer set search_path=pg_catalog,public as $$
declare s public.reliance_retail_store_master%rowtype;c public.retail_maintenance_calls%rowtype;today date:=public.retail_operations_today();
begin
 select * into s from public.reliance_retail_store_master where id=p_store;
 if not found or (not public.retail_mis_unique_store(s.id) or not public.retail_mis_operations_access(p_actor,s.state,true)) then raise exception using errcode='42501',message='Store is outside assigned editor scope';end if;
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
create function public.retail_mis_thermography_command(p_actor uuid,p_action text,p_store uuid,p_record uuid,p_scheduled date,p_revision integer,p_request uuid) returns jsonb
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
 if s.id is null or (not public.retail_mis_unique_store(s.id) or not public.retail_mis_operations_access(p_actor,s.state,true)) then raise exception using errcode='42501',message='Store is outside assigned editor scope';end if;
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
create or replace function public.retail_mis_fault_update(p_actor uuid,p_ticket uuid,p_stage text,p_remarks text,p_expected timestamptz,p_request uuid) returns jsonb
language plpgsql security definer set search_path=pg_catalog,public as $$
declare p public.profiles%rowtype;t public.fault_tracker_tickets%rowtype;e public.fault_tracker_ticket_updates%rowtype; valid text[]:=array['Fault Raised - Quote Yet to Submit','Quote Submitted - PO Yet to Receive','PO Received - Fund Request Pending','Fund Released - Work Yet to Start','Fund Released - Work in Progress','Work Completed - Documents Pending','Documents Received - JMS Yet to Create','JMS Created - Invoice Yet to Raise','Invoice Raised - Payment Pending','Set Off Pending'];completion boolean;
begin
 select * into p from public.profiles where id=p_actor;
 if not found or p.is_active is not true or upper(coalesce(p.status,'Active'))<>'ACTIVE' or not public.retail_mis_allowed(p_actor,'fault',null,true) then raise exception using errcode='42501',message='Existing ticket manager required';end if;
 if p_request is null or p_expected is null or p_stage is null or not(p_stage=any(valid)) or p_remarks is null or length(p_remarks)>4000 then raise exception using errcode='22023',message='Invalid ticket update';end if;
 select * into t from public.fault_tracker_tickets where id=p_ticket for update;
 if not found or t.is_active is not true or (select count(*) from public.reliance_retail_store_master s where upper(btrim(s.store_code))=upper(btrim(t.store_code)))<>1 or not exists(select 1 from public.reliance_retail_store_master s where upper(btrim(s.store_code))=upper(btrim(t.store_code)) and upper(s.status)='ACTIVE') then raise exception using errcode='42501',message='Eligible active Store Code required';end if;
 if not exists(select 1 from public.reliance_retail_store_master s where upper(btrim(s.store_code))=upper(btrim(t.store_code)) and public.retail_mis_allowed(p_actor,'fault',s.state,true)) then raise exception using errcode='42501',message='Outside assigned state';end if;
 select * into e from public.fault_tracker_ticket_updates where ticket_id=t.id and metadata->>'retail_request_id'=p_request::text;
 if found then
  if e.new_stage is distinct from p_stage or e.remarks is distinct from p_remarks or e.metadata->>'actor_profile_id' is distinct from p.id::text then raise exception using errcode='40001',message='Request ID reused with different command';end if;
  return jsonb_build_object('id',t.id,'replayed',true);
 end if;
 if t.updated_at is distinct from p_expected then raise exception using errcode='40001',message='Ticket changed';end if;
 completion:=array_position(valid,t.stage) between 1 and 5 and array_position(valid,p_stage)>=6;
 insert into public.fault_tracker_ticket_updates(ticket_id,updated_by_auth_user_id,updated_by_employee_code,update_type,previous_stage,new_stage,remarks,metadata)
 values(t.id,p.auth_user_id,p.employee_code,case when completion then 'WORK_COMPLETED' else 'STAGE_OR_REMARKS' end,t.stage,p_stage,p_remarks,jsonb_build_object('retail_request_id',p_request,'retail_workflow_version',1,'actor_profile_id',p.id,'previous_remarks',t.remarks));
 update public.fault_tracker_tickets set stage=p_stage,stage_group=case when array_position(valid,p_stage)=10 then 'Closed' when array_position(valid,p_stage)>=6 then 'Completed' when array_position(valid,p_stage)=5 then 'In Progress' else 'Pending' end,remarks=p_remarks,updated_at=clock_timestamp(),metadata=coalesce(metadata,'{}')||jsonb_build_object('lastUpdatedBy',p.employee_code) where id=t.id;
 return jsonb_build_object('id',t.id,'saved',true);
end;$$;
create or replace function public.retail_mis_cleaning_link_source(p_actor uuid,p_schedule uuid) returns jsonb
language plpgsql security definer set search_path=pg_catalog,public as $$
declare s public.client_deep_cleaning_schedules%rowtype;m public.reliance_retail_store_master%rowtype;f public.fo_activity_submissions%rowtype;u jsonb;owner jsonb;
begin
 select * into s from public.client_deep_cleaning_schedules where id=p_schedule;
 if not found then raise exception using errcode='42501',message='Schedule unavailable';end if;
 select * into m from public.reliance_retail_store_master where id=s.retail_store_id;
 if not found or public.retail_mis_cleaning_access(p_actor,m.state,'view') is not true then raise exception using errcode='42501',message='Outside schedule scope';end if;
 if s.metadata->'retail_fo_completion'->>'source_id' is null then return null;end if;
 if not exists(select 1 from storage.buckets where id='fo-activity-uploads' and public is false) then raise exception using errcode='42501',message='Private legacy FO evidence bucket required';end if;
 select * into f from public.fo_activity_submissions where id=(s.metadata->'retail_fo_completion'->>'source_id')::uuid;
 if not found or lower(f.activity_type) is distinct from 'deep_cleaning' or lower(f.status) is distinct from 'submitted' or f.metadata->>'pending_images' is distinct from 'false' or f.submitted_at is null or s.created_at is null or f.submitted_at<s.created_at or f.submitted_at>clock_timestamp() or nullif(upper(btrim(f.store_code)),'') is distinct from nullif(upper(btrim(m.store_code)),'') or f.store_code is null or f.metadata->>'activity_date' is distinct from s.scheduled_date::text or upper(coalesce(f.metadata->>'state','')) is distinct from upper(m.state) then raise exception using errcode='22023',message='Verified submitted store/date evidence required';end if;
 if (select count(*) from public.reliance_retail_store_master where upper(btrim(store_code))=upper(btrim(m.store_code)))<>1 then raise exception 'Ambiguous Store Code';end if;
 owner:=public.retail_unified_owner(m.id,(s.scheduled_date::text||'T23:59:59+05:30')::timestamptz);
 if owner->>'known' is distinct from 'true' or owner->>'fo_profile_id' is null or not exists(select 1 from public.profiles p where p.id=(owner->>'fo_profile_id')::uuid and p.employee_code=f.employee_code) or (s.assigned_fo_profile_id is not null and s.assigned_fo_profile_id is distinct from (owner->>'fo_profile_id')::uuid) then raise exception using errcode='42501',message='Verified historical FO ownership required';end if;
 select coalesce(jsonb_agg(to_jsonb(a)),'[]') into u from public.fo_activity_uploads a
 where a.submission_id=f.id and a.activity_type='deep_cleaning' and a.employee_code=f.employee_code
 and upper(btrim(a.store_code))=upper(btrim(m.store_code)) and a.uploaded_at is not null
 and a.storage_bucket='fo-activity-uploads' and a.upload_role in ('deep_cleaning_before','deep_cleaning_after')
 and a.file_type in ('image/jpeg','image/png','image/webp') and a.file_size between 1 and 5242880
 and starts_with(a.file_url,'fo-activity-uploads/'||f.employee_code||'/'||s.scheduled_date::text||'/deep_cleaning/'||f.id::text||'/')
 and a.file_url !~ '(^|/)(\.\.?)(/|$)'
 and exists(select 1 from storage.objects o where o.bucket_id='fo-activity-uploads' and o.name=substring(a.file_url from length('fo-activity-uploads/')+1));
 if not exists(select 1 from jsonb_array_elements(u) a where a->>'upload_role'='deep_cleaning_before') or not exists(select 1 from jsonb_array_elements(u) a where a->>'upload_role'='deep_cleaning_after') then raise exception using errcode='22023',message='Stored before and after evidence required';end if;
 return jsonb_build_object('id','fo:'||f.id::text,'source_kind','verified_fo_link','schedule_id',s.id,'retail_store_id',m.id,'store_code',m.store_code,'state',m.state,'deep_cleaning_date',s.scheduled_date,'status','submitted','submitted_at',f.submitted_at,'employee_code',f.employee_code,'uploads',u);
end;$$;
create or replace function public.retail_mis_cleaning_link_fo(p_actor uuid,p_schedule uuid,p_source uuid) returns jsonb
language plpgsql security definer set search_path=pg_catalog,public as $$
declare p public.profiles%rowtype;s public.client_deep_cleaning_schedules%rowtype;v jsonb;
begin
 select * into p from public.profiles where id=p_actor;
 if not found or p.is_active is not true or upper(coalesce(p.status,'Active'))<>'ACTIVE' or not public.retail_mis_allowed(p_actor,'cleaning',null,true) then raise exception using errcode='42501',message='Existing Retail Admin required';end if;
 select * into s from public.client_deep_cleaning_schedules where id=p_schedule for update;
 -- Unified keeps the proposal APPROVED; application is proven by its audit receipt.
 -- APPLIED is not a valid proposal status in the existing schema.
 if p_source is null or not found or not exists(
  select 1 from public.retail_provisional_proposals r
  join public.reliance_retail_management_audit a on a.entity_id=r.id and a.entity_type='proposal' and a.action='UNIFIED_APPLY'
  where r.id::text=s.source_reference and r.kind='DC_SCHEDULE' and r.status='APPROVED'
  and r.target_store=s.retail_store_id and r.proposed_by is not null and r.decided_by is not null and r.decided_by<>r.proposed_by
  and a.after_state->>'proposal_id'=r.id::text and a.after_state->>'kind'='DC_SCHEDULE'
  and a.after_state->>'store_id'=s.retail_store_id::text
  and a.after_state->'changes'->>'scheduled_date'=s.scheduled_date::text
 ) then raise exception using errcode='42501',message='Independently approved and applied schedule required';end if;
 if s.metadata ? 'retail_fo_completion' then
  if s.metadata->'retail_fo_completion'->>'source_id' is distinct from p_source::text then raise exception using errcode='40001',message='Schedule already linked';end if;
  return public.retail_mis_cleaning_link_source(p_actor,p_schedule);
 end if;
 if s.status is null or s.status not in ('Planned','Scheduled') or not exists(select 1 from public.reliance_retail_store_master m where m.id=s.retail_store_id and upper(m.status)='ACTIVE') or exists(select 1 from public.client_deep_cleaning_schedules x where x.metadata->'retail_fo_completion'->>'source_id'=p_source::text) then raise exception using errcode='40001',message='Completion already linked, store inactive or schedule finalized';end if;
 perform pg_advisory_xact_lock(hashtextextended('retail_fo_link:'||p_source::text,0));
 if exists(select 1 from public.client_deep_cleaning_schedules x where x.metadata->'retail_fo_completion'->>'source_id'=p_source::text) then raise exception using errcode='40001',message='Source already linked';end if;
 update public.client_deep_cleaning_schedules set metadata=metadata||jsonb_build_object('retail_fo_completion',jsonb_build_object('source_id',p_source,'verified_by',p_actor,'verified_at',clock_timestamp())) where id=s.id;
 v:=public.retail_mis_cleaning_link_source(p_actor,s.id);
 update public.client_deep_cleaning_schedules set status='Completed',completed_at=(v->>'submitted_at')::timestamptz,updated_at=clock_timestamp() where id=s.id;
 insert into public.reliance_retail_management_audit(action,entity_type,entity_id,actor_profile_id,before_state,after_state) values('VERIFIED_FO_CLEANING_LINK','deep_cleaning_schedule',s.id,p_actor,to_jsonb(s),jsonb_build_object('source_id',p_source,'status','Completed'));
 return v;
end;$$;
create function public.retail_mis_service_command(p_actor uuid,p_request uuid,p_action text,p_order uuid,p_revision integer,p_data jsonb) returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $$
declare o public.retail_service_orders%rowtype;b jsonb;e public.retail_service_events%rowtype;ids uuid[];st text;next_stage text;required_field text;fields text[];stage_list text[];k text;allowed_fields text[];
begin
 if not public.retail_mis_oos_enabled() then raise exception using errcode='42501',message='MIS OOS writes require separate activation';end if;
 if p_action not in ('CREATE_OOS','REWORK','PO_RECORDED','COMMERCIALLY_CONFIRMED','FUND_RECORDED','PAYMENT_RECORDED','DELIVERED') then raise exception using errcode='42501',message='OOS actions only';end if;
 if p_order is not null and (not public.retail_mis_oos_order_allowed(p_actor,p_order,true) or exists(select 1 from public.retail_mis_oos_retirements where order_id=p_order)) then raise exception using errcode='42501',message='Order unavailable or retired';end if;
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
  if not public.retail_mis_oos_order_allowed(p_actor,e.order_id,true) or exists(select 1 from public.retail_mis_oos_retirements r where r.order_id=e.order_id) then raise exception using errcode='42501',message='Replayed order unavailable or retired';end if;
  if not public.retail_mis_oos_access(p_actor,e.after_value->>'state','edit') then raise exception using errcode='42501',message='Outside editor scope';end if;
  return jsonb_build_object('replayed',true,'order',public.retail_service_public_order(e.after_value));
 end if;
 if p_action in ('CREATE_OOS','REGISTER_FAULT') then
  select array_agg(value::uuid) into ids from jsonb_array_elements_text(p_data->'store_ids');
  if coalesce(cardinality(ids),0)=0 or cardinality(ids)>1000 then raise exception 'Verified stores required';end if;
  if exists(select 1 from unnest(ids) x left join public.reliance_retail_store_master s on s.id=x where s.id is null or s.status<>'Active') then raise exception 'Only active canonical stores can be used';end if;
  if exists(select 1 from public.reliance_retail_store_master s where s.id=any(ids) and (nullif(btrim(s.store_code),'') is null or (select count(*) from public.reliance_retail_store_master d where upper(btrim(d.store_code))=upper(btrim(s.store_code)))<>1)) then raise exception using errcode='42501',message='Ambiguous canonical Store Code';end if;
  select min(state) into st from public.reliance_retail_store_master where id=any(ids);
  if (select count(distinct state) from public.reliance_retail_store_master where id=any(ids))<>1 then raise exception 'Cross-state orders are not supported';end if;
  if not public.retail_mis_oos_access(p_actor,st,'edit') then raise exception using errcode='42501',message='Outside editor scope';end if;
  k:=case when p_action='CREATE_OOS' then 'OOS' else 'FAULT' end;
  if nullif(btrim(p_data->>'reference'),'') is null then raise exception 'Reference required';end if;
  if k='OOS' then
   if jsonb_typeof(p_data->'items') is distinct from 'array' or jsonb_array_length(p_data->'items')=0 or coalesce(p_data->>'file_sha256','')!~'^[a-f0-9]{64}$' or encode(sha256(decode(p_data->>'original_base64','base64')),'hex')<>p_data->>'file_sha256' then raise exception 'Quotation source, items and matching hash required';end if;
   if exists(select 1 from jsonb_array_elements(p_data->'items') i where coalesce(i->>'description','')='' or coalesce(i->>'store_id','')='' or not ((i->>'store_id')::uuid=any(ids)) or coalesce(i->>'quantity','')!~'^[0-9]+([.][0-9]+)?$' or coalesce(i->>'unit_rate','')!~'^[0-9]+([.][0-9]+)?$' or (i->>'quantity')::numeric<=0 or (i->>'unit_rate')::numeric<0) then raise exception 'Invalid quotation items';end if;
  else
   if cardinality(ids)<>1 or nullif(btrim(p_data->>'category'),'') is null or nullif(btrim(p_data->>'description'),'') is null or p_data->>'priority' not in ('LOW','MEDIUM','HIGH','CRITICAL') or p_data->>'priority' is null then raise exception 'Fault category, priority, description and one store required';end if;
  end if;
  select * into o from public.retail_service_orders where kind=k and reference=p_data->>'reference';
  if found and (not public.retail_mis_oos_order_allowed(p_actor,o.id,true) or exists(select 1 from public.retail_mis_oos_retirements where order_id=o.id)) then raise exception using errcode='42501',message='Existing quotation outside assignment or retired';end if;
  if found then
   if k='OOS' and o.details->>'file_sha256'=p_data->>'file_sha256' and o.details->'items'=p_data->'items' then return jsonb_build_object('replayed',true,'order',public.retail_service_public_order(to_jsonb(o)));end if;
   raise exception 'Reference already exists; use reviewed rework without overwriting history';
  end if;
  insert into public.retail_service_orders(kind,reference,state,store_ids,status,details,created_by) values(k,p_data->>'reference',st,ids,case when k='OOS' then 'QUOTED' else 'REGISTERED' end,p_data,p_actor) returning * into o;
  insert into public.retail_service_order_stores(order_id,retail_store_id) select o.id,value from (select distinct unnest(ids) as value) s;
 else
  select * into o from public.retail_service_orders where id=p_order for update;
  if not found then raise exception 'Order not found';end if;
  if not public.retail_mis_oos_access(p_actor,o.state,'edit') then raise exception using errcode='42501',message='Outside editor scope';end if;
  if p_revision is distinct from o.revision then raise exception using errcode='40001',message='Order changed; reload before updating';end if;
  b:=to_jsonb(o);next_stage:=o.status;
  if p_action='REWORK' then
   if o.kind<>'OOS' then raise exception 'OOS quotation required';end if; if o.status<>'QUOTED' and (not public.retail_mis_oos_access(p_actor,o.state,'review') or o.created_by=p_actor) then raise exception using errcode='42501',message='Advanced rework requires independent authorized reviewer';end if;
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
   if p_action in ('COMMERCIALLY_CONFIRMED','FUND_RECORDED','PAYMENT_RECORDED','CLOSED') and not public.retail_mis_oos_access(p_actor,o.state,'review') then raise exception using errcode='42501',message='Reviewer authorization required';end if;
   if p_action='COMMERCIALLY_CONFIRMED' and (o.created_by=p_actor or p_actor=(select author_event.actor_id from public.retail_service_events author_event where author_event.order_id=o.id and author_event.action in ('CREATE_OOS','REWORK') order by author_event.created_at desc,author_event.id desc limit 1)) then raise exception 'Independent commercial reviewer required';end if;
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
create function public.rpc_retail_mis_oos_import(p_actor uuid,p_sha256 text,p_filename text,p_original text,p_groups jsonb) returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $$
declare g jsonb;receipts jsonb:='[]';request uuid;o public.retail_service_orders%rowtype;
begin
 if not public.retail_mis_oos_enabled() or not public.retail_mis_allowed(p_actor,'oos',null,true) then raise exception using errcode='42501',message='OOS writes unavailable';end if;
 if (select count(distinct s.state) from jsonb_array_elements(p_groups) as quoted(value) cross join lateral jsonb_array_elements_text(quoted.value->'store_ids') i join public.reliance_retail_store_master s on s.id=i.value::uuid)<>1 then raise exception using errcode='42501',message='Cross-state file rejected in full';end if;
 if jsonb_typeof(p_groups) is distinct from 'array' or jsonb_array_length(p_groups)=0 or jsonb_array_length(p_groups)>1000 then raise exception 'Quotation groups required';end if;
 perform pg_advisory_xact_lock(hashtextextended('retail_service_orders',0));
 for g in select value from jsonb_array_elements(p_groups) loop
  request:=md5(p_sha256||'|'||(g->>'quotation_number')||'|'||p_actor::text)::uuid;
  select * into o from public.retail_service_orders where kind='OOS' and reference=g->>'quotation_number' for update;
  if found then
   if not public.retail_mis_oos_order_allowed(p_actor,o.id,true) or exists(select 1 from public.retail_mis_oos_retirements where order_id=o.id) then raise exception using errcode='42501',message='Quotation outside assignment or retired';end if;
   if exists(select 1 from public.retail_service_events e where e.order_id=o.id and (e.evidence->>'file_sha256'=p_sha256 or e.evidence->>'quotation_file_sha256'=p_sha256)) then
    receipts:=receipts||jsonb_build_array(jsonb_build_object('replayed',true,'order_id',o.id));
   else
    if o.revision is distinct from (g->>'expected_revision')::integer then raise exception using errcode='40001',message='Quotation changed after preview';end if;
    receipts:=receipts||jsonb_build_array(public.retail_mis_service_command(p_actor,request,'REWORK',o.id,o.revision,jsonb_build_object('reference',g->>'quotation_number','store_ids',g->'store_ids','items',g->'items','reason','Reviewed revised quotation upload','quotation_file_sha256',p_sha256,'original_base64',p_original)));
   end if;
  else
   if (g->>'expected_revision')::integer is distinct from 0 then raise exception using errcode='40001',message='Quotation identity changed after preview';end if;
   receipts:=receipts||jsonb_build_array(public.retail_mis_service_command(p_actor,request,'CREATE_OOS',null,null,jsonb_build_object('reference',g->>'quotation_number','store_ids',g->'store_ids','items',g->'items','filename',p_filename,'file_sha256',p_sha256,'original_base64',p_original)));
  end if;
 end loop;
 return jsonb_build_object('quotation_groups',jsonb_array_length(p_groups),'receipts',receipts);
end;$$;
create function public.rpc_retail_mis_attendance_commit(p_batch uuid,p_actor uuid,p_replace boolean default false,p_reason text default null,p_preview_key text default null)
returns uuid language plpgsql security definer set search_path = public,pg_temp as $$
declare b public.retail_attendance_uploads%rowtype; current_ids jsonb; p public.profiles%rowtype;
begin
  select * into p from public.profiles where id = p_actor;
  if not found or p.is_active is not true or not (public.retail_mis_allowed(p_actor,'attendance-hk',null,true) or public.retail_mis_allowed(p_actor,'attendance-mepc',null,true)) then
    raise exception using errcode='42501',message='Administrative upload authorization required';
  end if;
  perform pg_advisory_xact_lock(hashtextextended('retail_uploaded_attendance',0));
  select * into b from public.retail_attendance_uploads where id = p_batch for update;
  if not found or b.uploaded_by <> p_actor then raise exception using errcode='42501',message='Upload owner mismatch'; end if;
  if b.kind<>'attendance' or exists(select 1 from jsonb_array_elements(b.payload) v left join public.reliance_retail_store_master s on s.id=(v->>'retail_store_id')::uuid where s.id is null or not public.retail_mis_unique_store(s.id) or upper(btrim(v->>'store_code')) is distinct from upper(btrim(s.store_code)) or not public.retail_mis_allowed(p_actor,case when v->>'class'='HK' then 'attendance-hk' when v->>'class'='MEPC' then 'attendance-mepc' else '' end,s.state,true)) then raise exception using errcode='42501',message='Entire attendance upload must remain within assigned class/state';end if;
  if exists(select 1 from public.retail_employee_daily_attendance x where x.superseded_at is null and exists(select 1 from jsonb_array_elements(b.payload) v where v->>'employee_code'=x.employee_code and (v->>'attendance_date')::date=x.attendance_date) and not exists(select 1 from public.reliance_retail_store_master s where s.id=x.retail_store_id and public.retail_mis_allowed(p_actor,case when x.class='HK' then 'attendance-hk' else 'attendance-mepc' end,s.state,true))) then raise exception using errcode='42501',message='Cross-scope employee/day correction denied';end if;
  if b.status = 'committed' then return b.id; end if;
  if p_preview_key is distinct from b.validation_summary ->> 'preview_key' then raise exception using errcode='40001',message='Preview changed; review it again'; end if;
  if b.valid_rows = 0 then raise exception 'Resolve upload validation errors first'; end if;
  if b.kind = 'attendance' then
    select coalesce(jsonb_agg(x.id::text order by x.id::text),'[]'::jsonb) into current_ids
      from public.retail_employee_daily_attendance x where x.superseded_at is null and exists(
        select 1 from jsonb_array_elements(b.payload) v where v->>'employee_code'=x.employee_code and (v->>'attendance_date')::date=x.attendance_date);
  else
    select coalesce(jsonb_agg(x.id::text order by x.id::text),'[]'::jsonb) into current_ids
      from public.retail_attendance_aop_versions x where x.superseded_at is null and exists(
        select 1 from jsonb_array_elements(b.payload) v where (v->>'retail_store_id')::uuid=x.retail_store_id
          and daterange(x.effective_from,x.effective_to,'[]') && daterange((v->>'effective_from')::date,(v->>'effective_to')::date,'[]'));
  end if;
  if current_ids <> b.expected_ids then raise exception using errcode='40001',message='Data changed since preview; upload again for a new preview'; end if;
  if jsonb_array_length(current_ids)>0 and (not p_replace or nullif(btrim(p_reason),'') is null) then raise exception 'Explicit correction confirmation and reason required'; end if;
  if b.kind = 'attendance' then
    update public.retail_employee_daily_attendance set superseded_at=now(),superseded_by_batch=b.id where id::text in(select jsonb_array_elements_text(current_ids));
    insert into public.retail_employee_daily_attendance(attendance_date,employee_code,employee_name,retail_store_id,store_code_snapshot,class,original_status,credit,batch_id,source_row)
      select (v->>'attendance_date')::date,v->>'employee_code',v->>'employee_name',(v->>'retail_store_id')::uuid,v->>'store_code',v->>'class',v->>'original_status',(v->>'credit')::numeric,b.id,(v->>'source_row')::integer
      from jsonb_array_elements(b.payload) v;
  else
    -- Only exact-window corrections; do not silently erase/split historical periods.
    if exists(select 1 from public.retail_attendance_aop_versions x join jsonb_array_elements(b.payload) v on (v->>'retail_store_id')::uuid=x.retail_store_id
      and daterange(x.effective_from,x.effective_to,'[]') && daterange((v->>'effective_from')::date,(v->>'effective_to')::date,'[]')
      where x.id::text in(select jsonb_array_elements_text(current_ids))
        and (x.effective_from is distinct from (v->>'effective_from')::date or x.effective_to is distinct from (v->>'effective_to')::date)) then
      raise exception 'AOP correction must preserve the existing effective window';
    end if;
    update public.retail_attendance_aop_versions set superseded_at=now(),superseded_by_batch=b.id where id::text in(select jsonb_array_elements_text(current_ids));
    insert into public.retail_attendance_aop_versions(retail_store_id,hk_count,mepc_count,effective_from,effective_to,source_version,batch_id,created_by,mepc_cycle_anchor)
      select (v->>'retail_store_id')::uuid,(v->>'hk_count')::numeric,(v->>'mepc_count')::numeric,(v->>'effective_from')::date,(v->>'effective_to')::date,v->>'source_version',b.id,p_actor,(v->>'mepc_cycle_anchor')::date
      from jsonb_array_elements(b.payload) v;
  end if;
  update public.retail_attendance_uploads set status='committed',committed_at=now(),correction_reason=nullif(btrim(p_reason),'') where id=b.id;
  return b.id;
end; $$;
-- END GENERATED MIS WORKFLOWS
-- No direct employee table access, even if default privileges were permissive.
do $security$ declare t text;f record;begin
 foreach t in array array['retail_mis_assignments','retail_mis_audit','retail_mis_records','retail_mis_evidence','retail_mis_oos_retirements'] loop
  execute format('alter table public.%I enable row level security',t);
  execute format('revoke all on public.%I from public,anon,authenticated,service_role',t);
 end loop;
 for f in select p.oid::regprocedure signature,p.proname from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and (p.proname like 'retail_mis_%' or p.proname like 'rpc_retail_mis_%') loop
  execute format('revoke all on function %s from public,anon,authenticated,service_role',f.signature);
  if f.proname like 'rpc_retail_mis_%' then execute format('grant execute on function %s to service_role',f.signature);end if;
 end loop;
end;$security$;
grant execute on function public.retail_mis_current_account() to authenticated;
commit;
