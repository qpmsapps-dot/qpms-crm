-- Add canonical Business Development roles while preserving legacy BD aliases.
-- This migration performs no profile or business-data updates.
begin;

alter table public.profiles drop constraint if exists profiles_role_check;
alter table public.profiles add constraint profiles_role_check check (
  role in (
    'Admin', 'QPMS Admin', 'Developer', 'Dev', 'IT Admin', 'Management IT Admin',
    'Management',
    'MD', 'COO', 'Executive Assistant', 'GM', 'General Manager', 'South Head',
    'Business Head', 'Branch Head', 'Operations Manager', 'Manager', 'KAM',
    'FO', 'Field Officer', 'Supervisor',
    'Business Development Executive', 'Business Development Head',
    'BD Executive', 'BD Head',
    'Pre-Sales', 'Pre-Sales Executive', 'Pre-Sales Manager',
    'Hospital Management', 'RMO', 'Doctor', 'Operations Team', 'Coordinator',
    'Commercial', 'Commercial Team', 'Commercial Reviewer', 'Finance',
    'Finance Team', 'Finance Reviewer', 'HR Reviewer', 'HR', 'HR GM',
    'Finance GM', 'DEMO_VIEWER'
  )
) not valid;

comment on constraint profiles_role_check on public.profiles is
  'Business Development Head and Business Development Executive are canonical business roles. BD Head and BD Executive remain compatibility aliases. Pre-Sales is canonical; Pre-Sales Executive and Pre-Sales Manager remain compatibility aliases.';

create or replace function public.is_business_development_role(p_role text)
returns boolean
language sql
immutable
parallel safe
set search_path = pg_catalog
as $function$
  select upper(regexp_replace(btrim(coalesce(p_role, '')), '[^A-Za-z0-9]+', '', 'g')) in (
    'BUSINESSDEVELOPMENTHEAD',
    'BUSINESSDEVELOPMENTEXECUTIVE',
    'BDHEAD',
    'BDEXECUTIVE'
  );
$function$;

comment on function public.is_business_development_role(text) is
  'Normalizes canonical and legacy Business Development profile roles for workflow authorization.';

revoke all on function public.is_business_development_role(text) from public, anon, authenticated;
grant execute on function public.is_business_development_role(text) to service_role;

-- Migrations 106 and 107 predate the canonical role labels and contain direct
-- role-literal checks. Re-create the existing functions from their live
-- definitions with only those checks replaced by the shared role predicate.
do $migration$
declare
  v_signature text;
  v_function oid;
  v_definition text;
  v_rewritten text;
begin
  foreach v_signature in array array[
    'public.rpc_decide_pre_sales_handoff(uuid,uuid,text,text)',
    'public.rpc_schedule_pre_sales_meeting_handoff(uuid,uuid,uuid,jsonb,text)',
    'public.rpc_submit_bd_meeting_mom(uuid,uuid,jsonb)',
    'public.rpc_prepare_opportunity_proposal(uuid,uuid,jsonb,text)',
    'public.rpc_send_opportunity_proposal(uuid,uuid,text)',
    'public.rpc_record_proposal_outcome(uuid,uuid,text,text,text)'
  ]
  loop
    v_function := to_regprocedure(v_signature);
    if v_function is null then
      raise exception 'Required opportunity workflow function is missing: %', v_signature;
    end if;

    v_definition := pg_get_functiondef(v_function);
    v_rewritten := replace(
      v_definition,
      'v_actor.role not in (''BD Executive'', ''BD Head'')',
      'not public.is_business_development_role(v_actor.role)'
    );
    v_rewritten := replace(
      v_rewritten,
      'role in (''BD Executive'', ''BD Head'')',
      'public.is_business_development_role(role)'
    );

    if v_rewritten = v_definition then
      raise exception 'Expected legacy BD role check was not found in: %', v_signature;
    end if;

    execute v_rewritten;
  end loop;
end;
$migration$;

commit;
