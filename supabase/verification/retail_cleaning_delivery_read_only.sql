-- Owner-level READ ONLY. No function execution, secrets, data edits or DDL.
begin read only;
select current_database(),current_user;
select table_name,column_name,data_type,is_nullable,column_default from information_schema.columns
where table_schema='public' and table_name in ('client_deep_cleaning_schedules','client_deep_cleaning_submissions','client_deep_cleaning_uploads','reliance_retail_store_master','access_user_assignments','access_user_scopes') order by table_name,ordinal_position;
select c.relname,c.relrowsecurity,c.relforcerowsecurity from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relname in ('client_deep_cleaning_schedules','client_deep_cleaning_submissions','client_deep_cleaning_uploads');
select * from pg_policies where tablename in ('client_deep_cleaning_schedules','client_deep_cleaning_submissions','client_deep_cleaning_uploads','objects');
select table_name,grantee,privilege_type from information_schema.role_table_grants where table_schema='public' and table_name like '%deep_cleaning%';
select c.relname,k.conname,pg_get_constraintdef(k.oid) definition from pg_constraint k join pg_class c on c.oid=k.conrelid where c.relname in ('client_deep_cleaning_schedules','client_deep_cleaning_submissions','client_deep_cleaning_uploads');
select c.relname,t.tgname,pg_get_triggerdef(t.oid),pg_get_functiondef(t.tgfoid) from pg_trigger t join pg_class c on c.oid=t.tgrelid where not t.tgisinternal and c.relname in ('client_deep_cleaning_schedules','client_deep_cleaning_submissions','client_deep_cleaning_uploads','reliance_retail_zone_fo_assignments','reliance_retail_store_master');
select p.oid::regprocedure,p.proacl,md5(pg_get_functiondef(p.oid)) fingerprint,pg_get_functiondef(p.oid) definition from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and (p.proname like '%cleaning%' or p.proname in ('retail_unified_owner','retail_unified_access','retail_mis_cleaning_access'));
select indexname,indexdef from pg_indexes where schemaname='public' and tablename in ('client_deep_cleaning_schedules','client_deep_cleaning_submissions','client_deep_cleaning_uploads');
select status,count(*) from public.client_deep_cleaning_schedules group by status;
select column_name from information_schema.columns where table_schema='public' and table_name='client_deep_cleaning_submissions' and column_name='schedule_id';
-- If schedule_id is installed, separately check duplicate non-null links before a unique index.
select id,public,allowed_mime_types,file_size_limit from storage.buckets where id in ('client-deep-cleaning-uploads','fo-activity-uploads');
rollback;
