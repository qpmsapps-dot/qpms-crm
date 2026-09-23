-- Read-only post-deployment verification for Migration 103.
-- Baseline captured 2026-09-23 before deployment:
-- tickets=12, active=8, awaiting_confirmation=2, closed=3, cancelled=1,
-- events=211, notifications=460.

select
  current_database() as database_name,
  current_user as connected_role,
  current_setting('server_version') as postgres_version,
  inet_server_addr() as server_address;

select id, client_name, is_active
from public.hospital_clients
where id = 'bfb5d707-1a4e-451d-af1f-11b7c0aeeb66'::uuid;

select
  p.oid::regprocedure::text as function_signature,
  p.prosecdef as security_definer,
  p.provolatile as volatility,
  p.proconfig as function_settings,
  pg_get_functiondef(p.oid) as function_definition
from pg_proc p
join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public'
  and p.proname in (
    'hospital_can_access_ticket',
    'rpc_accept_hospital_operational_ticket'
  )
order by p.proname;

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
  and tablename = 'hospital_tickets'
  and policyname = 'hospital_tickets_scoped_select';

select
  to_regprocedure('public.hospital_can_access_ticket(uuid)') is not null
    as access_function_exists,
  to_regprocedure(
    'public.rpc_accept_hospital_operational_ticket(uuid,uuid,integer,boolean,timestamptz)'
  ) is not null as operational_acceptance_rpc_exists,
  has_function_privilege(
    'service_role',
    'public.rpc_accept_hospital_operational_ticket(uuid,uuid,integer,boolean,timestamptz)',
    'EXECUTE'
  ) as service_role_can_execute,
  has_function_privilege(
    'authenticated',
    'public.rpc_accept_hospital_operational_ticket(uuid,uuid,integer,boolean,timestamptz)',
    'EXECUTE'
  ) as authenticated_cannot_execute_expected_false,
  has_function_privilege(
    'anon',
    'public.rpc_accept_hospital_operational_ticket(uuid,uuid,integer,boolean,timestamptz)',
    'EXECUTE'
  ) as anon_cannot_execute_expected_false;

with baseline as (
  select
    12::bigint as total_tickets,
    8::bigint as active_tickets,
    2::bigint as resolved_awaiting_confirmation,
    3::bigint as closed_tickets,
    1::bigint as cancelled_tickets
), actual as (
  select
    count(*) as total_tickets,
    count(*) filter (where status_code not in ('closed', 'cancelled')) as active_tickets,
    count(*) filter (where status_code = 'resolved_awaiting_confirmation') as resolved_awaiting_confirmation,
    count(*) filter (where status_code = 'closed') as closed_tickets,
    count(*) filter (where status_code = 'cancelled') as cancelled_tickets
  from public.hospital_tickets
  where client_id = 'bfb5d707-1a4e-451d-af1f-11b7c0aeeb66'::uuid
)
select
  actual.*,
  actual.total_tickets = baseline.total_tickets
    and actual.active_tickets = baseline.active_tickets
    and actual.resolved_awaiting_confirmation = baseline.resolved_awaiting_confirmation
    and actual.closed_tickets = baseline.closed_tickets
    and actual.cancelled_tickets = baseline.cancelled_tickets
    as ticket_counts_match_baseline
from actual cross join baseline;

with actual as (
  select count(*) as event_count
  from public.hospital_ticket_events e
  join public.hospital_tickets t on t.id = e.ticket_id
  where t.client_id = 'bfb5d707-1a4e-451d-af1f-11b7c0aeeb66'::uuid
)
select event_count, event_count = 211 as event_count_matches_baseline
from actual;

with actual as (
  select count(*) as notification_count
  from public.hospital_ticket_notifications n
  join public.hospital_tickets t on t.id = n.ticket_id
  where t.client_id = 'bfb5d707-1a4e-451d-af1f-11b7c0aeeb66'::uuid
)
select
  notification_count,
  notification_count = 460 as notification_count_matches_baseline
from actual;
