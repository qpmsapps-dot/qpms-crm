-- READ ONLY. Save output. Do not rerun installed migrations.
begin transaction read only;
do $preflight$ declare item record;begin if to_regclass('supabase_migrations.schema_migrations') is null then raise exception 'Installed migration history required';end if;
 if not exists(select 1 from supabase_migrations.schema_migrations where version='20261029140000' and cardinality(statements)=1 and md5(replace(statements[1],E'\r\n',E'\n'))='0800864af23894d608e5a0d11e65f0c4') then raise exception 'Installed Unified migration fingerprint mismatch; do not rerun it';end if;
 if to_regprocedure('public.retail_unified_access(uuid,text,text)') is null or to_regprocedure('public.retail_unified_owner(uuid,timestamp with time zone)') is null then raise exception 'Installed access and effective ownership functions required';end if;
 for item in select * from (values ('profiles','id','uuid'),
('profiles','state','text'),
('profiles','is_active','boolean'),
('profiles','status','text'),
('profiles','role','text'),
('profiles','business','text'),
('reliance_retail_store_master','id','uuid'),
('reliance_retail_store_master','store_code','text'),
('reliance_retail_store_master','state','text'),
('reliance_retail_store_master','status','text'),
('reliance_retail_zones','id','uuid'),
('reliance_retail_zones','state','text'),
('reliance_retail_zones','status','text'),
('retail_provisional_rows','id','uuid'),
('retail_provisional_rows','batch_id','uuid'),
('retail_provisional_rows','source_state','text'),
('retail_provisional_rows','revision','integer'),
('retail_provisional_rows','row_digest','text'),
('retail_provisional_rows','store_code','text'),
('retail_provisional_files','id','uuid'),
('retail_provisional_files','withdrawn_at','timestamp with time zone'),
('reliance_retail_management_audit','action','text'),
('reliance_retail_management_audit','entity_type','text'),
('reliance_retail_management_audit','entity_id','uuid'),
('reliance_retail_management_audit','actor_profile_id','uuid'),
('reliance_retail_management_audit','after_state','jsonb')) v(table_name,column_name,column_type) loop
  if not exists(select 1 from pg_attribute where attrelid=to_regclass('public.'||item.table_name) and attname=item.column_name and (atttypid=to_regtype(item.column_type) or item.column_type='text' and atttypid in ('varchar'::regtype,'bpchar'::regtype)) and not attisdropped) then raise exception 'Incompatible required column %.%',item.table_name,item.column_name;end if;
 end loop;
 if exists(select 1 from public.reliance_retail_zones where state is null or state not in ('TN','PY','KA','KL','TG','AP-1','AP-2')) then raise exception 'Existing undefined Zone state requires explicit review';end if; end;$preflight$;
select version,name,cardinality(statements)=1 as one_statement,md5(replace(statements[1],E'\r\n',E'\n')) as source_md5 from supabase_migrations.schema_migrations where version in ('20261029140000','20261030140000') order by version;
select name,to_regclass('public.'||name) as existing_object from unnest(array['retail_service_orders','retail_service_events','retail_service_order_stores','retail_zone_mapping_drafts']) name;
select name,(xpath('/table/row/n/text()',report))[1]::text::bigint as row_count,(xpath('/table/row/digest/text()',report))[1]::text as digest
 from unnest(array['reliance_retail_store_master','reliance_retail_zones','reliance_retail_zone_fo_assignments','reliance_retail_store_zone_history','retail_employee_daily_attendance','retail_attendance_uploads','retail_attendance_aop_versions','retail_store_import_approvals','retail_store_import_batches','retail_store_import_events','retail_provisional_rows','retail_provisional_files','retail_provisional_events','retail_provisional_proposals','retail_provisional_access','client_deep_cleaning_submissions','client_deep_cleaning_uploads','client_deep_cleaning_schedules','training_sessions','training_evidence','training_events','profiles']) name cross join lateral (select case when to_regclass('public.'||name) is not null then query_to_xml(format('select count(*) as n,md5(coalesce(jsonb_agg(to_jsonb(x) order by to_jsonb(x)::text),''[]''::jsonb)::text) as digest from public.%I x',name),false,false,'') end as report) q where to_regclass('public.'||name) is not null;
select p.oid::regprocedure,md5(replace(p.prosrc,E'\r\n',E'\n')) as body_md5,p.prosecdef,p.proconfig,p.proacl from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and (p.proname like 'rpc_retail_unified_%' or p.proname in ('retail_unified_access','retail_unified_owner','rpc_confirm_retail_store_import','rpc_confirm_retail_bulk_identity')) order by p.proname;
rollback;
