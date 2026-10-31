begin transaction read only;
select version,name from supabase_migrations.schema_migrations where version='20261031090000';
do $verify$ begin
perform p.id,p.auth_user_id,p.username,p.role,p.is_active,p.status from public.profiles p where false;
if exists(select 1 from supabase_migrations.schema_migrations where version='20261031090000') then raise exception 'Already installed; use postinstall, never reinstall';end if;
if not exists(select 1 from pg_proc where oid=to_regprocedure('public.retail_identity_only_approved(uuid,jsonb,text,text,text,text,text,text)') and prosecdef and provolatile='s' and md5(replace(prosrc,E'\r\n',E'\n'))='f3dc5882e6363359ee1c9b6a24ccc9e9') then raise exception 'Reviewed identity proof helper drift';end if;
if has_function_privilege('anon','public.retail_identity_only_approved(uuid,jsonb,text,text,text,text,text,text)','EXECUTE') or has_function_privilege('authenticated','public.retail_identity_only_approved(uuid,jsonb,text,text,text,text,text,text)','EXECUTE') or has_function_privilege('service_role','public.retail_identity_only_approved(uuid,jsonb,text,text,text,text,text,text)','EXECUTE') then raise exception 'Private proof helper ACL drift';end if;
if to_regclass('public.retail_identity_final_authority') is not null then raise exception 'Unexpected final-authority table';end if;
end;$verify$;
select name,(xpath('/table/row/n/text()',report))[1]::text as row_count,(xpath('/table/row/digest/text()',report))[1]::text as digest from unnest(array['reliance_retail_store_master','reliance_retail_zones','reliance_retail_zone_fo_assignments','reliance_retail_store_zone_history','retail_employee_daily_attendance','retail_attendance_aop_versions','retail_provisional_rows','retail_provisional_files','retail_store_import_approvals']) name cross join lateral(select query_to_xml(format('select count(*) n,md5(coalesce(jsonb_agg(to_jsonb(x) order by to_jsonb(x)::text),''[]''::jsonb)::text) digest from public.%I x',name),false,false,'') report) q;
rollback;
