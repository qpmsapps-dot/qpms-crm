-- REVIEW/READ ONLY. Requires the separately approved migration to be installed.
begin transaction read only;
select id,public,file_size_limit,allowed_mime_types from storage.buckets
where id='retail-thermography-reports';
select c.relname,c.relrowsecurity,c.relacl from pg_class c
join pg_namespace n on n.oid=c.relnamespace
where n.nspname='public' and c.relname like 'retail_thermography%';
select schemaname,tablename,policyname,permissive,roles,cmd,qual,with_check
from pg_policies where (schemaname='storage' and tablename='objects')
or (schemaname='public' and tablename like 'retail_thermography%');
select p.oid::regprocedure,p.prosecdef,p.proconfig,p.proacl,md5(pg_get_functiondef(p.oid))
from pg_proc p join pg_namespace n on n.oid=p.pronamespace
where n.nspname='public' and (p.proname like '%thermography%' or p.proname in
('rpc_retail_mis_report','rpc_retail_operations_snapshot'));
select tablename,indexname,indexdef from pg_indexes
where schemaname='public' and tablename like 'retail_thermography%';
select conrelid::regclass,conname,pg_get_constraintdef(oid)
from pg_constraint where conrelid in (select oid from pg_class where relname like 'retail_thermography%');
select tgrelid::regclass,tgname,pg_get_triggerdef(oid) from pg_trigger
where not tgisinternal and (tgrelid='storage.objects'::regclass or tgrelid in
(select oid from pg_class where relname like 'retail_thermography%'));
select coalesce(report_date,scheduled_date) as business_date,status,report_review_state,
 report_deleted_at is not null as deleted,count(*)
from public.retail_thermography_inspections group by 1,2,3,4 order by 1;
-- Must be zero: active links without a confirmed private Storage object.
select count(*) as broken_active_links from public.retail_thermography_inspections i
left join public.retail_thermography_report_versions v on v.id=i.active_report_version_id
left join storage.objects o on o.bucket_id='retail-thermography-reports' and o.name=v.object_path
where i.active_report_version_id is not null and
(v.id is null or v.state<>'uploaded' or o.id is null);
rollback;
