-- Read-only inspection before applying 022_hospital_ticketing_foundation.sql.
select n.nspname as schema_name, c.relname as object_name, c.relkind
from pg_class c join pg_namespace n on n.oid=c.relnamespace
where n.nspname in ('public','storage')
  and (c.relname like 'hospital_%' or c.relname='hospital-ticket-attachments')
order by 1,2;

select table_schema, table_name, column_name, data_type, is_nullable
from information_schema.columns
where table_schema='public' and table_name like 'hospital_%'
order by table_name, ordinal_position;

select schemaname, tablename, policyname, roles, cmd, qual, with_check
from pg_policies
where tablename like 'hospital_%' or policyname like 'hospital_%'
order by tablename, policyname;

select routine_schema, routine_name, data_type
from information_schema.routines
where routine_schema='public' and routine_name like '%hospital%'
order by routine_name;

select bucket.id, bucket.name, bucket.public, bucket.file_size_limit, bucket.allowed_mime_types
from storage.buckets bucket where bucket.id='hospital-ticket-attachments';

select grantee, table_name, privilege_type
from information_schema.role_table_grants
where table_schema='public' and table_name like 'hospital_%'
order by table_name, grantee, privilege_type;
