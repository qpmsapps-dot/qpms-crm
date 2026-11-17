-- REVIEW ONLY: no production installation authorized by preparation.
-- Baseline inspected on 2026-11-17. Existing authorization functions and AP scopes are untouched.
-- Install once, after independent SQL review and database release approval.
begin;
do $guard$
begin
 if to_regprocedure('public.rpc_retail_reporting_snapshot(uuid,date,date,text)') is not null then
  raise exception 'Reporting RPC already exists: inspect installed contract before proceeding';
 end if;
 if (select md5(prosrc) from pg_proc where oid='public.rpc_retail_unified_snapshot(uuid,date,date)'::regprocedure) is distinct from '1818b3601df08143864bc52a5e765ce2' then
  raise exception 'Installed snapshot drift: renew review; do not overwrite';
 end if;
end $guard$;
CREATE OR REPLACE FUNCTION public.rpc_retail_unified_snapshot(p_actor uuid, p_from date, p_to date)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
declare stores jsonb; rows jsonb; files jsonb; proposals jsonb; zones jsonb; fos jsonb; permissions jsonb; attendance jsonb; aop jsonb; dc jsonb; training jsonb; images jsonb; schedules jsonb; events jsonb; assignments jsonb; histories jsonb; stamp text; admin boolean; report_scope jsonb;
begin
 if not public.retail_unified_access(p_actor,null,'view') then raise exception using errcode='42501',message='Assigned Retail state permission required'; end if;
 if p_from is null or p_to is null or p_to<p_from or p_to-p_from>366 then raise exception 'Select a reporting range up to 366 days'; end if;
 admin:=public.retail_unified_access(p_actor,'__ALL__','view');
 -- Evaluate the unchanged authority predicate once per actual state, never once per data row.
 select jsonb_object_agg(coalesce(to_jsonb(state)::text,'null'),public.retail_unified_access(p_actor,state,'view'))
 into report_scope from (
  select state from public.reliance_retail_store_master
  union select source_state from public.retail_provisional_rows
  union select state from public.retail_provisional_proposals
  union select state from public.reliance_retail_zones
  union select case when state='KN' then 'KA' else state end from public.profiles
  union select after_state->>'state' from public.reliance_retail_management_audit where action like 'UNIFIED_%'
  union select null::text
 ) state_domains;
 select coalesce(jsonb_agg(jsonb_build_object('state',s,'permission','admin')),'[]') into permissions from unnest(array['TN','PY','KA','KL','TG','AP-1','AP-2']) s where admin;
 if not admin then select coalesce(jsonb_agg(jsonb_build_object('state',state,'permission',permission)),'[]') into permissions from public.retail_provisional_access where actor_id=p_actor; end if;
 select coalesce(jsonb_agg(to_jsonb(s)||jsonb_build_object('ownership',public.retail_unified_owner(s.id,now()),'observed_zone_id',(select store_zones->s.id::text->>'zone_id' from public.retail_unified_epoch)) order by s.store_code),'[]') into stores from public.reliance_retail_store_master s where coalesce((report_scope->>coalesce(to_jsonb(s.state)::text,'null'))::boolean,false);
 select coalesce(jsonb_agg(to_jsonb(r)||jsonb_build_object('version',f.version,'filename',f.filename,'sha256',f.sha256,'withdrawn_at',f.withdrawn_at) order by r.source_state,r.source_row),'[]') into rows from public.retail_provisional_rows r join public.retail_provisional_files f on f.id=r.batch_id where coalesce((report_scope->>coalesce(to_jsonb(r.source_state)::text,'null'))::boolean,false);
 select coalesce(jsonb_agg(to_jsonb(f)-'original_base64'-'source_sheets' order by f.version desc),'[]') into files from public.retail_provisional_files f where admin or exists(select 1 from public.retail_provisional_rows r where r.batch_id=f.id and coalesce((report_scope->>coalesce(to_jsonb(r.source_state)::text,'null'))::boolean,false));
 select coalesce(jsonb_agg(to_jsonb(p) order by p.created_at desc),'[]') into proposals from public.retail_provisional_proposals p left join public.retail_provisional_rows r on r.id=p.row_id where coalesce((report_scope->>coalesce(to_jsonb(coalesce(p.state,r.source_state))::text,'null'))::boolean,false);
 select coalesce(jsonb_agg(to_jsonb(z) order by z.state,z.zone_name),'[]') into zones from public.reliance_retail_zones z where coalesce((report_scope->>coalesce(to_jsonb(z.state)::text,'null'))::boolean,false);
 select coalesce(jsonb_agg(jsonb_build_object('id',p.id,'employee_code',p.employee_code,'full_name',p.full_name,'contact',p.mobile,'state',p.state)),'[]') into fos from public.profiles p where p.is_active is true and upper(coalesce(p.status,'Active'))='ACTIVE' and regexp_replace(upper(coalesce(p.role,'')),'[^A-Z0-9]','','g') in ('FO','FIELDOFFICER') and regexp_replace(upper(coalesce(p.business,'')),'[^A-Z0-9]','','g') in ('RELIANCE','RELIANCERETAIL') and coalesce((report_scope->>coalesce(to_jsonb(case when p.state='KN' then 'KA' else p.state end)::text,'null'))::boolean,false);
 select coalesce(jsonb_agg(to_jsonb(a)),'[]') into assignments from public.reliance_retail_zone_fo_assignments a join public.reliance_retail_zones z on z.id=a.zone_id where coalesce((report_scope->>coalesce(to_jsonb(z.state)::text,'null'))::boolean,false);
 select coalesce(jsonb_agg(to_jsonb(h) order by h.changed_at),'[]') into histories from public.reliance_retail_store_zone_history h join public.reliance_retail_store_master s on s.id=h.retail_store_id where coalesce((report_scope->>coalesce(to_jsonb(s.state)::text,'null'))::boolean,false);
 select coalesce(jsonb_agg(jsonb_build_object('retail_store_id',a.retail_store_id,'attendance_date',a.attendance_date,'class',a.class,'credit',a.credit,'ownership',public.retail_unified_owner(a.retail_store_id,(a.attendance_date::text||'T23:59:59+05:30')::timestamptz))),'[]') into attendance from public.retail_employee_daily_attendance a join public.reliance_retail_store_master s on s.id=a.retail_store_id where a.superseded_at is null and a.attendance_date between p_from and p_to and coalesce((report_scope->>coalesce(to_jsonb(s.state)::text,'null'))::boolean,false);
 select coalesce(jsonb_agg(to_jsonb(a)),'[]') into aop from public.retail_attendance_aop_versions a join public.reliance_retail_store_master s on s.id=a.retail_store_id where a.superseded_at is null and a.effective_from<=p_to and (a.effective_to is null or a.effective_to>=p_from) and coalesce((report_scope->>coalesce(to_jsonb(s.state)::text,'null'))::boolean,false);
 select coalesce(jsonb_agg(to_jsonb(d)||jsonb_build_object('ownership',public.retail_unified_owner(s.id,coalesce(d.submitted_at,d.created_at)))),'[]') into dc from public.client_deep_cleaning_submissions d join public.reliance_retail_store_master s on (d.retail_store_id=s.id or (d.retail_store_id is null and upper(btrim(d.store_code))=upper(btrim(s.store_code)))) where (d.retail_store_id is not null or regexp_replace(upper(coalesce(to_jsonb(d)->>'business','')),'[^A-Z0-9]','','g') in ('RELIANCE','RELIANCERETAIL')) and d.deep_cleaning_date between p_from and p_to and coalesce((report_scope->>coalesce(to_jsonb(s.state)::text,'null'))::boolean,false);
 select coalesce(jsonb_agg(jsonb_build_object('submission_id',u.submission_id,'photo_type',u.upload_type,'uploaded',u.upload_status='uploaded')),'[]') into images from public.client_deep_cleaning_uploads u where u.submission_id in (select (d->>'id')::uuid from jsonb_array_elements(dc) d);
 select coalesce(jsonb_agg(to_jsonb(t)||jsonb_build_object('ownership',public.retail_unified_owner(s.id,coalesce(t.submitted_at,t.created_at)))),'[]') into training from public.training_sessions t join public.reliance_retail_store_master s on (t.retail_store_id=s.id or (t.retail_store_id is null and upper(btrim(t.store_code_snapshot))=upper(btrim(s.store_code)))) where (t.retail_store_id is not null or regexp_replace(upper(coalesce(to_jsonb(t)->>'business_name_snapshot',to_jsonb(t)->>'business_code_snapshot','')),'[^A-Z0-9]','','g') in ('RELIANCE','RELIANCERETAIL')) and t.training_date between p_from and p_to and coalesce((report_scope->>coalesce(to_jsonb(s.state)::text,'null'))::boolean,false);
 if to_regclass('public.client_deep_cleaning_schedules') is not null then
 execute 'select coalesce(jsonb_agg(to_jsonb(d)||jsonb_build_object(''ownership'',public.retail_unified_owner(s.id,(d.scheduled_date::text||''T23:59:59+05:30'')::timestamptz))),''[]'') from public.client_deep_cleaning_schedules d join public.reliance_retail_store_master s on s.id=d.retail_store_id where d.scheduled_date between $1 and $2 and public.retail_unified_access($3,s.state,''view'')' into schedules using p_from,p_to,p_actor;
 end if;
 select coalesce(jsonb_agg(to_jsonb(e) order by e.created_at desc),'[]') into events from public.reliance_retail_management_audit e where e.action like 'UNIFIED_%' and coalesce((report_scope->>coalesce(to_jsonb(e.after_state->>'state')::text,'null'))::boolean,false);
 stamp:=md5(stores::text||rows::text||files::text);
 return jsonb_build_object('actor_id',p_actor,'admin',admin,'permissions',permissions,'stores',stores,'rows',rows,'files',files,'proposals',proposals,'zones',zones,'fos',fos,'assignments',assignments,'store_zone_history',histories,'attendance',attendance,'aop',aop,'deep_cleaning',dc,'images',images,'schedules',schedules,'training',training,'events',events,'stamp',stamp,'from',p_from,'to',p_to,'epoch_at',(select observed_at from public.retail_unified_epoch));
end; $function$;

CREATE OR REPLACE FUNCTION public.rpc_retail_reporting_snapshot(p_actor uuid, p_from date, p_to date, p_module text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
declare stores jsonb; rows jsonb; files jsonb; proposals jsonb; zones jsonb; fos jsonb; permissions jsonb; attendance jsonb; aop jsonb; dc jsonb; training jsonb; images jsonb; schedules jsonb; events jsonb; assignments jsonb; histories jsonb; stamp text; admin boolean; report_scope jsonb;
begin
 if p_module not in ('dashboard','cleaning','training') or p_module is null then raise exception using errcode='22023',message='Unknown reporting module'; end if;
 if not public.retail_unified_access(p_actor,null,'view') then raise exception using errcode='42501',message='Assigned Retail state permission required'; end if;
 if p_from is null or p_to is null or p_to<p_from or p_to-p_from>366 then raise exception 'Select a reporting range up to 366 days'; end if;
 admin:=public.retail_unified_access(p_actor,'__ALL__','view');
 -- Evaluate the unchanged authority predicate once per actual state, never once per data row.
 select jsonb_object_agg(coalesce(to_jsonb(state)::text,'null'),public.retail_unified_access(p_actor,state,'view'))
 into report_scope from (select distinct state from public.reliance_retail_store_master union select null::text ) state_domains;
 select coalesce(jsonb_agg(jsonb_build_object('state',s,'permission','admin')),'[]') into permissions from unnest(array['TN','PY','KA','KL','TG','AP-1','AP-2']) s where admin;
 if not admin then select coalesce(jsonb_agg(jsonb_build_object('state',state,'permission',permission)),'[]') into permissions from public.retail_provisional_access where actor_id=p_actor; end if;
 select coalesce(jsonb_agg(to_jsonb(s) order by s.store_code),'[]') into stores from public.reliance_retail_store_master s where coalesce((report_scope->>coalesce(to_jsonb(s.state)::text,'null'))::boolean,false);
 if p_module='dashboard' then
 select coalesce(jsonb_agg(jsonb_build_object('retail_store_id',a.retail_store_id,'attendance_date',a.attendance_date,'class',a.class,'credit',a.credit)),'[]') into attendance from public.retail_employee_daily_attendance a join public.reliance_retail_store_master s on s.id=a.retail_store_id where a.superseded_at is null and a.attendance_date between p_from and p_to and coalesce((report_scope->>coalesce(to_jsonb(s.state)::text,'null'))::boolean,false);
 select coalesce(jsonb_agg(to_jsonb(a)),'[]') into aop from public.retail_attendance_aop_versions a join public.reliance_retail_store_master s on s.id=a.retail_store_id where a.superseded_at is null and a.effective_from<=p_to and (a.effective_to is null or a.effective_to>=p_from) and coalesce((report_scope->>coalesce(to_jsonb(s.state)::text,'null'))::boolean,false);
 end if;
 if p_module in ('dashboard','cleaning') then
 select coalesce(jsonb_agg(to_jsonb(d)||jsonb_build_object('ownership',public.retail_unified_owner(s.id,coalesce(d.submitted_at,d.created_at)))),'[]') into dc from public.client_deep_cleaning_submissions d join public.reliance_retail_store_master s on (d.retail_store_id=s.id or (d.retail_store_id is null and upper(btrim(d.store_code))=upper(btrim(s.store_code)))) where (d.retail_store_id is not null or regexp_replace(upper(coalesce(to_jsonb(d)->>'business','')),'[^A-Z0-9]','','g') in ('RELIANCE','RELIANCERETAIL')) and d.deep_cleaning_date between p_from and p_to and coalesce((report_scope->>coalesce(to_jsonb(s.state)::text,'null'))::boolean,false);
 select coalesce(jsonb_agg(jsonb_build_object('submission_id',u.submission_id,'photo_type',u.upload_type,'uploaded',u.upload_status='uploaded')),'[]') into images from public.client_deep_cleaning_uploads u where u.submission_id in (select (d->>'id')::uuid from jsonb_array_elements(dc) d);
 if to_regclass('public.client_deep_cleaning_schedules') is not null then
 execute 'select coalesce(jsonb_agg(to_jsonb(d)||jsonb_build_object(''ownership'',public.retail_unified_owner(s.id,(d.scheduled_date::text||''T23:59:59+05:30'')::timestamptz))),''[]'') from public.client_deep_cleaning_schedules d join public.reliance_retail_store_master s on s.id=d.retail_store_id where d.scheduled_date between $1 and $2 and public.retail_unified_access($3,s.state,''view'')' into schedules using p_from,p_to,p_actor;
 end if;
 end if;
 return jsonb_build_object('actor_id',p_actor,'stores',stores,'attendance',coalesce(attendance,'[]'::jsonb),'aop',coalesce(aop,'[]'::jsonb),'deep_cleaning',coalesce(dc,'[]'::jsonb),'images',coalesce(images,'[]'::jsonb),'schedules',schedules,'from',p_from,'to',p_to);
end; $function$;

revoke all on function public.rpc_retail_reporting_snapshot(uuid,date,date,text) from public,anon,authenticated;
grant execute on function public.rpc_retail_reporting_snapshot(uuid,date,date,text) to service_role;
commit;
