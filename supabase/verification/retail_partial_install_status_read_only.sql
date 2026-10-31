-- NEXT SAFE ACTION after Fault correction COMMIT and Cleaning preflight failure.
-- Only three targeted result rows. No repeat catalog audit or mutation RPCs.
-- Initial ROLLBACK clears an aborted transaction if the SQL Editor retained it;
-- it cannot undo the already committed Fault Tracker correction.
rollback;
begin transaction read only;
set local statement_timeout='30s';

with required_tables(name) as (values
 ('fault_tracker_import_batches'),('fault_tracker_tickets'),('fault_tracker_ticket_updates')
), required_roles(name) as (values('anon'),('authenticated'),('service_role')),
rights as (
 select t.name as table_name,r.name as role_name,c.oid is not null as table_present,
 role_entry.oid is not null as role_present,
 case when c.oid is not null and role_entry.oid is not null then has_table_privilege(role_entry.oid,c.oid,'SELECT') end can_select,
 case when c.oid is not null and role_entry.oid is not null then has_table_privilege(role_entry.oid,c.oid,'INSERT') end can_insert,
 case when c.oid is not null and role_entry.oid is not null then has_table_privilege(role_entry.oid,c.oid,'UPDATE') end can_update,
 case when c.oid is not null and role_entry.oid is not null then has_table_privilege(role_entry.oid,c.oid,'DELETE') end can_delete,
 case when c.oid is not null and role_entry.oid is not null then has_any_column_privilege(role_entry.oid,c.oid,'INSERT') end any_column_insert,
 case when c.oid is not null and role_entry.oid is not null then has_any_column_privilege(role_entry.oid,c.oid,'UPDATE') end any_column_update
 from required_tables t cross join required_roles r
 left join pg_roles role_entry on role_entry.rolname::text=r.name
 left join pg_namespace n on n.nspname='public'
 left join pg_class c on c.relnamespace=n.oid and c.relname=t.name
), required_functions(signature) as (values
 ('public.retail_cleaning_object_access(text,text,boolean)'),
 ('public.retail_cleaning_has_stored_pair(uuid)'),
 ('public.retail_cleaning_legacy_guard()'),
 ('public.retail_cleaning_storage_guard()')
), required_policies(name) as (values
 ('retail_cleaning_private_read'),('retail_cleaning_owned_insert'),
 ('retail_cleaning_draft_update'),('retail_cleaning_draft_delete')
), required_triggers(schema_name,table_name,name) as (values
 ('public','fo_activity_submissions','trg_retail_cleaning_submission_guard'),
 ('public','fo_activity_uploads','trg_retail_cleaning_upload_guard'),
 ('storage','objects','trg_retail_cleaning_storage_guard')
), residue as (
 select 'function' object_type,f.signature object_name,to_regprocedure(f.signature) is not null as present from required_functions f
 union all select 'policy','storage.objects.'||p.name,exists(select 1 from pg_policies x where x.schemaname='storage' and x.tablename='objects' and x.policyname=p.name) from required_policies p
 union all select 'trigger',r.schema_name||'.'||r.table_name||'.'||r.name,exists(select 1 from pg_trigger t join pg_class c on c.oid=t.tgrelid join pg_namespace n on n.oid=c.relnamespace where n.nspname=r.schema_name and c.relname=r.table_name and t.tgname=r.name and not t.tgisinternal) from required_triggers r
), platform_capability as (
 select current_user as execution_role,a.rolsuper,a.rolbypassrls,
 c.oid is not null as storage_objects_present,o.rolname as storage_owner,
 case when c.oid is not null then (a.rolsuper or pg_has_role(a.oid,c.relowner,'USAGE')) end native_owner_authority,
 case when c.oid is not null then has_table_privilege(a.oid,c.oid,'TRIGGER') end existing_trigger_privilege,
 has_schema_privilege(a.oid,to_regnamespace('public'),'CREATE') as public_create_privilege,
 current_setting('supautils.version',true) as supautils_version,
 current_setting('supautils.policy_grants',true) as existing_platform_policy_grants,
 current_setting('supautils.drop_trigger_grants',true) as existing_platform_drop_trigger_grants
 from pg_roles a
 left join pg_namespace n on n.nspname='storage'
 left join pg_class c on c.relnamespace=n.oid and c.relname='objects'
 left join pg_roles o on o.oid=c.relowner
 where a.rolname=current_user
)
select 1 section_number,'Committed Fault correction: effective table/column rights' section_name,
 (select coalesce(jsonb_agg(to_jsonb(r) order by table_name,role_name),'[]') from rights r) result
union all
select 2,'Failed Cleaning attempt: all eleven objects should be absent',
 (select coalesce(jsonb_agg(to_jsonb(r) order by object_type,object_name),'[]') from residue r)
union all
select 3,'Existing Supabase delegation: configuration evidence, not DDL proof',
 (select coalesce(jsonb_agg(to_jsonb(p)),'[]') from platform_capability p)
order by section_number;

rollback;
