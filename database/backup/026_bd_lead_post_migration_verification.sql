-- Read-only verification for database/migrations/026_bd_lead_creation_security.sql
-- Run after migration 026. It reports catalog/security state only.

-- 1. Required Phase 1 tables.
with expected(table_name) as (
  values ('leads'), ('lead_contacts'), ('activity_logs'), ('lead_mom')
)
select
  expected.table_name,
  case when c.oid is null then 'FAIL: missing' else 'PASS: exists' end as result,
  c.relrowsecurity as rls_enabled,
  c.relforcerowsecurity as rls_forced
from expected
left join pg_namespace n on n.nspname = 'public'
left join pg_class c on c.relnamespace = n.oid and c.relname = expected.table_name
order by expected.table_name;

-- 2. Required columns and exact PostgreSQL types.
with expected(table_name, column_name, udt_name) as (
  values
    ('profiles', 'business', 'text'),
    ('profiles', 'branch', 'text'),
    ('leads', 'id', 'uuid'),
    ('leads', 'lead_code', 'text'),
    ('leads', 'client_name', 'text'),
    ('leads', 'industry_type', 'text'),
    ('leads', 'lead_source', 'text'),
    ('leads', 'site_location', 'text'),
    ('leads', 'state', 'text'),
    ('leads', 'city', 'text'),
    ('leads', 'business', 'text'),
    ('leads', 'branch', 'text'),
    ('leads', 'lead_priority', 'text'),
    ('leads', 'service_scope', 'jsonb'),
    ('leads', 'assigned_bd_executive', 'text'),
    ('leads', 'assigned_bd_email', 'text'),
    ('leads', 'created_by_user_id', 'text'),
    ('leads', 'created_by_name', 'text'),
    ('leads', 'metadata', 'jsonb'),
    ('leads', 'idempotency_key', 'text'),
    ('leads', 'normalized_client_name', 'text'),
    ('leads', 'normalized_site_location', 'text'),
    ('lead_contacts', 'lead_id', 'uuid'),
    ('lead_contacts', 'contact_person_name', 'text'),
    ('lead_contacts', 'contact_number', 'text'),
    ('lead_contacts', 'email_id', 'text'),
    ('lead_contacts', 'is_primary', 'bool'),
    ('activity_logs', 'lead_id', 'uuid'),
    ('activity_logs', 'activity_type', 'text'),
    ('activity_logs', 'activity_message', 'text'),
    ('activity_logs', 'metadata', 'jsonb'),
    ('lead_mom', 'lead_id', 'uuid'),
    ('lead_mom', 'mom_status', 'text')
)
select
  expected.table_name,
  expected.column_name,
  expected.udt_name as expected_type,
  c.udt_name as actual_type,
  case when c.udt_name = expected.udt_name then 'PASS' else 'FAIL' end as result
from expected
left join information_schema.columns c
  on c.table_schema = 'public'
 and c.table_name = expected.table_name
 and c.column_name = expected.column_name
order by expected.table_name, expected.column_name;

-- 3. Policies: exactly the scoped authenticated SELECT policies should exist.
with expected(table_name, policy_name) as (
  values
    ('leads', 'bd_leads_visible_select'),
    ('lead_contacts', 'bd_lead_contacts_visible_select'),
    ('activity_logs', 'bd_activity_logs_visible_select'),
    ('lead_mom', 'bd_lead_mom_visible_select')
)
select
  expected.table_name,
  expected.policy_name,
  p.permissive,
  p.roles,
  p.cmd,
  p.qual,
  p.with_check,
  case
    when p.policyname is null then 'FAIL: missing policy'
    when 'anon' = any(p.roles) then 'FAIL: anon policy'
    when p.cmd <> 'SELECT' then 'FAIL: mutation policy'
    when coalesce(p.qual, '') in ('true', '(true)') then 'FAIL: unconditional policy'
    when coalesce(p.with_check, '') in ('true', '(true)') then 'FAIL: unconditional check'
    else 'PASS'
  end as result
from expected
left join pg_policies p
  on p.schemaname = 'public'
 and p.tablename = expected.table_name
 and p.policyname = expected.policy_name
order by expected.table_name;

-- Any extra policy on these module-owned tables is a failure.
select
  p.tablename,
  p.policyname,
  p.roles,
  p.cmd,
  p.qual,
  p.with_check,
  'FAIL: unexpected policy' as result
from pg_policies p
where p.schemaname = 'public'
  and p.tablename in ('leads', 'lead_contacts', 'activity_logs', 'lead_mom')
  and p.policyname not in (
    'bd_leads_visible_select',
    'bd_lead_contacts_visible_select',
    'bd_activity_logs_visible_select',
    'bd_lead_mom_visible_select'
  )
order by p.tablename, p.policyname;

-- 4. Table grants. Any anon privilege or authenticated mutation is a failure.
select
  table_name,
  grantee,
  privilege_type,
  case
    when grantee = 'anon' then 'FAIL: anon grant'
    when grantee = 'authenticated' and privilege_type <> 'SELECT' then 'FAIL: authenticated mutation grant'
    when grantee = 'authenticated' and privilege_type = 'SELECT' then 'PASS'
    when grantee = 'service_role' then 'PASS'
    else 'REVIEW'
  end as result
from information_schema.role_table_grants
where table_schema = 'public'
  and table_name in ('leads', 'lead_contacts', 'activity_logs', 'lead_mom')
  and grantee in ('anon', 'authenticated', 'service_role', 'PUBLIC')
order by table_name, grantee, privilege_type;

-- Effective privilege matrix, including inherited PUBLIC privileges.
select
  table_name,
  has_table_privilege('anon', format('public.%I', table_name), 'SELECT') as anon_select,
  (
    has_table_privilege('anon', format('public.%I', table_name), 'INSERT')
    or has_table_privilege('anon', format('public.%I', table_name), 'UPDATE')
    or has_table_privilege('anon', format('public.%I', table_name), 'DELETE')
  ) as anon_mutate,
  has_table_privilege('authenticated', format('public.%I', table_name), 'SELECT') as authenticated_select,
  (
    has_table_privilege('authenticated', format('public.%I', table_name), 'INSERT')
    or has_table_privilege('authenticated', format('public.%I', table_name), 'UPDATE')
    or has_table_privilege('authenticated', format('public.%I', table_name), 'DELETE')
  ) as authenticated_mutate,
  (
    has_table_privilege('service_role', format('public.%I', table_name), 'SELECT')
    and has_table_privilege('service_role', format('public.%I', table_name), 'INSERT')
    and has_table_privilege('service_role', format('public.%I', table_name), 'UPDATE')
    and has_table_privilege('service_role', format('public.%I', table_name), 'DELETE')
  ) as service_role_manage,
  case
    when has_table_privilege('anon', format('public.%I', table_name), 'SELECT')
      or has_table_privilege('anon', format('public.%I', table_name), 'INSERT')
      or has_table_privilege('anon', format('public.%I', table_name), 'UPDATE')
      or has_table_privilege('anon', format('public.%I', table_name), 'DELETE') then 'FAIL: anon effective privilege'
    when has_table_privilege('authenticated', format('public.%I', table_name), 'INSERT')
      or has_table_privilege('authenticated', format('public.%I', table_name), 'UPDATE')
      or has_table_privilege('authenticated', format('public.%I', table_name), 'DELETE') then 'FAIL: authenticated mutation'
    when not has_table_privilege('authenticated', format('public.%I', table_name), 'SELECT') then 'FAIL: authenticated SELECT missing'
    when not has_table_privilege('service_role', format('public.%I', table_name), 'SELECT')
      or not has_table_privilege('service_role', format('public.%I', table_name), 'INSERT')
      or not has_table_privilege('service_role', format('public.%I', table_name), 'UPDATE')
      or not has_table_privilege('service_role', format('public.%I', table_name), 'DELETE') then 'FAIL: service_role manage missing'
    else 'PASS'
  end as result
from (
  values ('leads'), ('lead_contacts'), ('activity_logs'), ('lead_mom')
) as expected(table_name)
order by table_name;

-- 5. Atomic RPC signatures and execution privileges.
with expected(function_name, identity_arguments) as (
  values
    ('rpc_create_bd_lead_atomic', 'p_lead jsonb, p_contacts jsonb, p_actor jsonb, p_idempotency_key text'),
    ('rpc_update_bd_lead_atomic', 'p_lead_id uuid, p_lead jsonb, p_contacts jsonb, p_actor jsonb')
)
select
  expected.function_name,
  expected.identity_arguments as expected_arguments,
  pg_get_function_identity_arguments(p.oid) as actual_arguments,
  pg_get_function_result(p.oid) as result_type,
  p.prosecdef as security_definer,
  has_function_privilege('anon', p.oid, 'EXECUTE') as anon_can_execute,
  has_function_privilege('authenticated', p.oid, 'EXECUTE') as authenticated_can_execute,
  has_function_privilege('service_role', p.oid, 'EXECUTE') as service_role_can_execute,
  case
    when p.oid is null then 'FAIL: missing RPC'
    when has_function_privilege('anon', p.oid, 'EXECUTE') then 'FAIL: anon execute'
    when has_function_privilege('authenticated', p.oid, 'EXECUTE') then 'FAIL: authenticated execute'
    when not has_function_privilege('service_role', p.oid, 'EXECUTE') then 'FAIL: service_role missing'
    when not p.prosecdef then 'FAIL: not security definer'
    else 'PASS'
  end as result
from expected
left join pg_namespace n on n.nspname = 'public'
left join pg_proc p
  on p.pronamespace = n.oid
 and p.proname = expected.function_name
 and pg_get_function_identity_arguments(p.oid) = expected.identity_arguments
order by expected.function_name;

-- 6. Required indexes, including idempotency and duplicate lookup.
with expected(index_name) as (
  values
    ('ux_bd_leads_creator_idempotency'),
    ('idx_bd_leads_normalized_duplicate_lookup'),
    ('idx_bd_leads_business_state_branch'),
    ('idx_bd_leads_assigned_email'),
    ('ux_bd_lead_contacts_one_primary'),
    ('ux_bd_lead_contacts_email_normalized'),
    ('ux_bd_lead_contacts_phone_normalized'),
    ('idx_bd_activity_logs_lead_created'),
    ('ux_bd_lead_mom_lead_id')
)
select
  expected.index_name,
  case when i.indexname is null then 'FAIL: missing' else 'PASS' end as result,
  i.indexdef
from expected
left join pg_indexes i
  on i.schemaname = 'public'
 and i.indexname = expected.index_name
order by expected.index_name;

-- 7. Primary keys, foreign keys, and check constraints.
select
  rel.relname as table_name,
  con.conname as constraint_name,
  con.contype as constraint_type,
  pg_get_constraintdef(con.oid) as definition
from pg_constraint con
join pg_class rel on rel.oid = con.conrelid
join pg_namespace n on n.oid = rel.relnamespace
where n.nspname = 'public'
  and rel.relname in ('leads', 'lead_contacts', 'activity_logs', 'lead_mom')
order by rel.relname, con.contype, con.conname;

-- 8. Confirm no CRM site_visits table was created by Phase 1. If it exists,
-- operator must establish its owner/source separately. fo_site_visits is distinct.
select
  to_regclass('public.site_visits') as legacy_crm_site_visits,
  to_regclass('public.fo_site_visits') as operational_fo_site_visits,
  case
    when to_regclass('public.fo_site_visits') is null then 'REVIEW: operational table missing'
    else 'PASS: FO table remains distinct'
  end as result;

-- 9. Confirm helper functions exist.
select
  p.proname,
  pg_get_function_identity_arguments(p.oid) as identity_arguments,
  p.prosecdef as security_definer,
  p.provolatile as volatility
from pg_proc p
join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public'
  and p.proname in (
    'bd_lead_set_updated_at',
    'normalize_bd_lead_text',
    'normalize_bd_lead_phone',
    'current_bd_lead_profile_value',
    'current_bd_lead_role',
    'can_current_user_view_bd_lead'
  )
order by p.proname;

-- 10. Protected Operations/Fault Tracker schema fingerprint. It must match the
-- value saved from section 11 of the pre-migration inspection script.
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
