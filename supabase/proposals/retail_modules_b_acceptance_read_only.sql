-- Workstream B: Super Admin manual catalog verification only.
-- No installation, grants, policy changes, uploads or business-record writes.
-- Return these result sets for review; do not treat this as release approval.
-- Minimum production acceptance (manual; no production checks are executed here):
-- 1. An authorized Super Admin runs this script unchanged and retains all five
--    result sets. Confirm required RPC signatures/settings, restricted execution,
--    RLS/constraints, no direct schedule SELECT, all applicable storage policies,
--    and both evidence buckets private. Missing/ambiguous controls block acceptance;
--    do not install functions, grant privileges or change policies in this check.
-- 2. In existing authorized browser sessions, select a known period/state/store:
--    attendance actual credits remain visible when missing AOP makes percentages N/A;
--    cleaning Remaining reconciles to Scheduled minus Completed, with recorded
--    Not Completed and pending shown separately and zero denominators shown as N/A.
-- 3. View only existing authorized private evidence through the reporting route;
--    confirm another role/scope cannot read the report/evidence or acquire a URL.
--    Do not upload files or copy signed URLs into shared acceptance records.
-- 4. Check HK/MEPC counts using existing role/hierarchy-authorized sessions and a
--    denied/out-of-scope session. CM/PM and Thermography must stay unavailable
--    without authoritative sources. Use no uploads, submissions or other writes.
begin transaction read only;

-- 1. Required RPC signatures, owner, definer/search-path settings and execution.
-- Reporting RPCs: service_role execution only. The internal access helper is
-- intentionally not directly executable by service_role; do not grant it access.
select p.oid::regprocedure as signature, r.rolname as owner,
       p.prosecdef as security_definer, p.proconfig as function_settings,
       has_function_privilege('service_role',p.oid,'EXECUTE') as service_execute,
       has_function_privilege('anon',p.oid,'EXECUTE') as anonymous_execute,
       has_function_privilege('authenticated',p.oid,'EXECUTE') as employee_execute
from pg_proc p join pg_namespace n on n.oid=p.pronamespace
join pg_roles r on r.oid=p.proowner
where n.nspname='public' and p.proname in
 ('rpc_retail_unified_snapshot','retail_unified_access','retail_unified_owner',
  'rpc_retail_attendance_report_source')
order by p.oid::regprocedure::text;

-- 2. Tables, RLS and effective privileges. Direct schedule access must stay false.
with required(schema_name,name) as (values
 ('public','client_deep_cleaning_schedules'),('public','client_deep_cleaning_submissions'),
 ('public','client_deep_cleaning_uploads'),('public','training_sessions'),
 ('public','training_evidence'),('storage','objects'))
select q.schema_name,q.name, c.oid is not null as present, c.relrowsecurity as rls,
       c.relforcerowsecurity as force_rls,
       has_table_privilege('service_role',c.oid,'SELECT') as service_select,
       has_table_privilege('anon',c.oid,'SELECT') as anonymous_select,
       has_table_privilege('authenticated',c.oid,'SELECT') as employee_select
from required q left join pg_class c on c.oid=to_regclass(q.schema_name||'.'||q.name)
order by q.schema_name,q.name;

-- 3. PK/FK, store/date uniqueness, status and evidence validation constraints.
select c.conrelid::regclass as relation, c.conname, c.contype,
       c.convalidated, pg_get_constraintdef(c.oid) as definition
from pg_constraint c join pg_class t on t.oid=c.conrelid
join pg_namespace n on n.oid=t.relnamespace
where n.nspname='public' and t.relname in
 ('client_deep_cleaning_schedules','client_deep_cleaning_submissions',
  'client_deep_cleaning_uploads','training_sessions','training_evidence')
order by c.conrelid::regclass::text,c.conname;

-- 4. Include ALL storage.objects policies: a broad policy may not name a bucket.
select schemaname,tablename,policyname,permissive,roles,cmd,qual,with_check
from pg_policies where (schemaname='storage' and tablename='objects')
 or (schemaname='public' and tablename in
 ('client_deep_cleaning_schedules','client_deep_cleaning_submissions',
  'client_deep_cleaning_uploads','training_sessions','training_evidence'))
order by schemaname,tablename,policyname;

-- 5. Private evidence bucket configuration; no object contents or URLs are read.
select id,public,file_size_limit,allowed_mime_types from storage.buckets
where id in ('client-deep-cleaning-uploads','training-evidence') order by id;

rollback;
