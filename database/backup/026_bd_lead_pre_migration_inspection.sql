-- Read-only inspection for database/migrations/026_bd_lead_creation_security.sql
-- Run in the CURRENT Supabase SQL Editor before migration 026.
-- This script reports catalog metadata and aggregate counts only.

-- 1. Required, optional, conflicting, and protected table names.
with expected(table_name, classification) as (
  values
    ('profiles', 'existing dependency'),
    ('leads', 'Phase 1 required'),
    ('lead_contacts', 'Phase 1 required'),
    ('activity_logs', 'Phase 1 required BD audit table'),
    ('lead_mom', 'Phase 1 page compatibility'),
    ('site_visits', 'legacy CRM/future - not created by 026'),
    ('fo_site_visits', 'existing Operations - protected'),
    ('notifications', 'future workflow - not required'),
    ('idempotency_keys', 'legacy workflow - not required'),
    ('user_management_audit_logs', 'existing Operations - protected'),
    ('fo_activity_submissions', 'existing Operations - protected'),
    ('fo_activity_uploads', 'existing Operations - protected'),
    ('fault_tracker_import_batches', 'Fault Tracker - protected'),
    ('fault_tracker_tickets', 'Fault Tracker - protected'),
    ('fault_tracker_ticket_updates', 'Fault Tracker - protected')
)
select
  expected.table_name,
  expected.classification,
  case when c.oid is null then 'missing' else 'exists' end as existence,
  case c.relkind when 'r' then 'table' when 'p' then 'partitioned table' when 'v' then 'view' else c.relkind::text end as object_kind,
  c.relrowsecurity as rls_enabled,
  c.relforcerowsecurity as rls_forced
from expected
left join pg_namespace n on n.nspname = 'public'
left join pg_class c on c.relnamespace = n.oid and c.relname = expected.table_name
order by expected.classification, expected.table_name;

-- 2. Existing columns and data types for relevant objects. No row data.
select
  table_name,
  ordinal_position,
  column_name,
  data_type,
  udt_name,
  is_nullable,
  column_default
from information_schema.columns
where table_schema = 'public'
  and table_name in (
    'profiles', 'leads', 'lead_contacts', 'activity_logs', 'lead_mom',
    'site_visits', 'fo_site_visits', 'notifications', 'idempotency_keys'
  )
order by table_name, ordinal_position;

-- 3. Profile authorization/scope columns required by the backend.
with required(column_name, expected_udt) as (
  values
    ('id', 'uuid'),
    ('auth_user_id', 'uuid'),
    ('employee_code', 'text'),
    ('full_name', 'text'),
    ('display_name', 'text'),
    ('email', 'text'),
    ('role', 'text'),
    ('status', 'text'),
    ('is_active', 'bool'),
    ('state', 'text'),
    ('business', 'text'),
    ('branch', 'text')
)
select
  required.column_name,
  required.expected_udt,
  c.udt_name as actual_udt,
  case
    when c.column_name is null and required.column_name in ('business', 'branch') then 'will be added'
    when c.column_name is null then 'blocking: missing'
    when c.udt_name <> required.expected_udt then 'blocking: incompatible type'
    else 'compatible'
  end as status
from required
left join information_schema.columns c
  on c.table_schema = 'public'
 and c.table_name = 'profiles'
 and c.column_name = required.column_name
order by required.column_name;

-- 4. Non-sensitive role distribution for profile-constraint/operator review.
select
  coalesce(nullif(btrim(role), ''), '<blank>') as stored_role,
  count(*) as profile_count,
  count(*) filter (where coalesce(is_active, false)) as active_count
from public.profiles
group by coalesce(nullif(btrim(role), ''), '<blank>')
order by stored_role;

-- 5. Existing policies on CRM-related names.
select
  schemaname,
  tablename,
  policyname,
  permissive,
  roles,
  cmd,
  qual,
  with_check
from pg_policies
where schemaname = 'public'
  and tablename in (
    'leads', 'lead_contacts', 'activity_logs', 'lead_mom', 'site_visits',
    'fo_site_visits', 'notifications', 'idempotency_keys'
  )
order by tablename, policyname;

-- 6. Explicit table grants for API roles.
select
  table_schema,
  table_name,
  grantee,
  privilege_type,
  is_grantable
from information_schema.role_table_grants
where table_schema = 'public'
  and table_name in (
    'leads', 'lead_contacts', 'activity_logs', 'lead_mom', 'site_visits',
    'fo_site_visits', 'notifications', 'idempotency_keys'
  )
  and grantee in ('anon', 'authenticated', 'service_role', 'PUBLIC')
order by table_name, grantee, privilege_type;

-- 7. Existing indexes.
select schemaname, tablename, indexname, indexdef
from pg_indexes
where schemaname = 'public'
  and tablename in (
    'profiles', 'leads', 'lead_contacts', 'activity_logs', 'lead_mom',
    'site_visits', 'fo_site_visits', 'notifications', 'idempotency_keys'
  )
order by tablename, indexname;

-- 8. Existing constraints and relationship definitions.
select
  n.nspname as table_schema,
  rel.relname as table_name,
  con.conname as constraint_name,
  con.contype as constraint_type,
  pg_get_constraintdef(con.oid) as definition
from pg_constraint con
join pg_class rel on rel.oid = con.conrelid
join pg_namespace n on n.oid = rel.relnamespace
where n.nspname = 'public'
  and rel.relname in (
    'profiles', 'leads', 'lead_contacts', 'activity_logs', 'lead_mom',
    'site_visits', 'fo_site_visits', 'notifications', 'idempotency_keys'
  )
order by rel.relname, con.contype, con.conname;

-- 9. Existing function/RPC names and signatures that 026 may create/replace.
select
  n.nspname as function_schema,
  p.proname as function_name,
  pg_get_function_identity_arguments(p.oid) as identity_arguments,
  pg_get_function_result(p.oid) as result_type,
  p.prosecdef as security_definer,
  p.provolatile as volatility,
  p.proacl as acl
from pg_proc p
join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public'
  and p.proname in (
    'bd_lead_set_updated_at',
    'normalize_bd_lead_text',
    'normalize_bd_lead_phone',
    'current_bd_lead_profile_value',
    'current_bd_lead_role',
    'can_current_user_view_bd_lead',
    'rpc_create_bd_lead_atomic',
    'rpc_update_bd_lead_atomic'
  )
order by p.proname, identity_arguments;

-- 10. Safe aggregate data-quality checks when legacy lead tables exist.
do $$
declare
  v_result record;
begin
  if to_regclass('public.leads') is not null then
    execute $query$
      select
        count(*) as total_leads,
        count(*) filter (
          where nullif(btrim(to_jsonb(l) ->> 'created_by_user_id'), '') is null
        ) as missing_creator,
        count(*) filter (
          where nullif(btrim(to_jsonb(l) ->> 'assigned_bd_email'), '') is null
        ) as unassigned,
        count(*) filter (
          where nullif(btrim(to_jsonb(l) ->> 'idempotency_key'), '') is null
        ) as missing_idempotency
      from public.leads l
    $query$ into v_result;
    raise notice 'legacy leads aggregates: total=%, missing_creator=%, unassigned=%, missing_idempotency=%',
      v_result.total_leads, v_result.missing_creator, v_result.unassigned, v_result.missing_idempotency;
  else
    raise notice 'public.leads is absent; no legacy lead aggregates to inspect.';
  end if;
end $$;

-- 11. Protected Operations/Fault Tracker schema fingerprint. Save this value
-- and compare it with section 10 of the post-migration verification script.
with protected_relations as (
  select c.oid, n.nspname, c.relname
  from pg_class c
  join pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'public'
    and c.relkind in ('r', 'p')
    and (
      c.relname like 'fo\_%' escape '\'
      or c.relname like 'fault\_tracker\_%' escape '\'
      or c.relname in (
        'employee_hierarchy', 'store_master', 'mobile_crash_logs',
        'user_management_audit_logs'
      )
    )
), definitions as (
  select
    pr.nspname || '.' || pr.relname || '.column.' || a.attname || ':' ||
    format_type(a.atttypid, a.atttypmod) || ':' || a.attnotnull::text || ':' ||
    coalesce(pg_get_expr(ad.adbin, ad.adrelid), '') as definition
  from protected_relations pr
  join pg_attribute a on a.attrelid = pr.oid and a.attnum > 0 and not a.attisdropped
  left join pg_attrdef ad on ad.adrelid = pr.oid and ad.adnum = a.attnum
  union all
  select pr.nspname || '.' || pr.relname || '.constraint.' || con.conname || ':' || pg_get_constraintdef(con.oid)
  from protected_relations pr
  join pg_constraint con on con.conrelid = pr.oid
  union all
  select pr.nspname || '.' || pr.relname || '.index.' || idx.relname || ':' || pg_get_indexdef(i.indexrelid)
  from protected_relations pr
  join pg_index i on i.indrelid = pr.oid
  join pg_class idx on idx.oid = i.indexrelid
)
select
  count(*) as protected_definition_count,
  md5(coalesce(string_agg(definition, E'\n' order by definition), '')) as protected_schema_fingerprint
from definitions;
