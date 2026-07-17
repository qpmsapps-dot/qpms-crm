-- Read-only verification after applying 022_hospital_ticketing_foundation.sql.
select c.relname as table_name, c.relrowsecurity as rls_enabled
from pg_class c join pg_namespace n on n.oid=c.relnamespace
where n.nspname='public' and c.relname like 'hospital_%' and c.relkind='r'
order by c.relname;

select table_name, count(*) as column_count
from information_schema.columns
where table_schema='public' and table_name like 'hospital_%'
group by table_name order by table_name;

select schemaname, tablename, policyname, roles, cmd, qual, with_check
from pg_policies
where tablename like 'hospital_%'
order by tablename, policyname;

select grantee, table_name, privilege_type
from information_schema.role_table_grants
where table_schema='public' and table_name like 'hospital_%'
  and grantee in ('anon','authenticated','service_role')
order by table_name, grantee, privilege_type;

select p.proname, pg_get_function_identity_arguments(p.oid) as arguments,
       array_to_string(p.proacl, ',') as grants
from pg_proc p join pg_namespace n on n.oid=p.pronamespace
where n.nspname='public' and p.proname like '%hospital%'
order by p.proname;

select indexname, indexdef from pg_indexes
where schemaname='public' and tablename like 'hospital_%'
order by tablename, indexname;

select id, name, public, file_size_limit, allowed_mime_types
from storage.buckets where id='hospital-ticket-attachments';

select client_code, client_name, is_active from public.hospital_clients
where client_code='QPMS_HOSPITAL_PILOT';

select b.block_code, b.block_name, count(l.id) as location_count
from public.hospital_blocks b
left join public.hospital_locations l on l.block_id=b.id
join public.hospital_clients c on c.id=b.client_id
where c.client_code='QPMS_HOSPITAL_PILOT'
group by b.block_code,b.block_name order by b.block_code;

-- These existing operational tables must remain present; migration 022 never alters them.
select to_regclass('public.fo_attendance') as fo_attendance,
       to_regclass('public.fo_site_visits') as fo_site_visits,
       to_regclass('public.fo_location_logs') as fo_location_logs,
       to_regclass('public.fo_travel_expense_claims') as fo_travel_expense_claims;
