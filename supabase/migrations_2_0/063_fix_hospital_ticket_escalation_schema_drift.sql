begin;

-- Fix Hospital Ticketing escalation schema/function drift introduced after
-- the Day 2 priority escalation matrix.
--
-- Scope:
--   * Restore the production Hospital Ticket escalation role order:
--       1 housekeeping_supervisor
--       2 operations_executive
--       3 facility_manager
--       4 project_head
--   * Preserve hospital_dean as level 5 only for the separate
--     public-cleanliness/dean workflow introduced by migration 047.
--     The normal Hospital Ticket SLA processor from migration 061 stops at
--     level 4/project_head and is not replaced here.
--   * Allow every assignment_type written by current production code.
--
-- This migration does not modify tickets, users, Auth, passwords, SLA minutes,
-- RLS policies, notifications, or existing assignment-history rows.

do $$
declare
  v_unexpected_assignment_types text[];
begin
  select array_agg(distinct assignment_type order by assignment_type)
  into v_unexpected_assignment_types
  from public.hospital_ticket_assignment_history
  where assignment_type is not null
    and assignment_type not in (
      'primary',
      'backup',
      'overall_fallback',
      'operations_fallback',
      'acceptance_escalation',
      'manual_reassignment'
    );

  if coalesce(array_length(v_unexpected_assignment_types, 1), 0) > 0 then
    raise exception
      'Unexpected hospital_ticket_assignment_history.assignment_type values exist: %',
      array_to_string(v_unexpected_assignment_types, ', ');
  end if;
end $$;

create or replace function public.hospital_ticket_role_for_level(p_level integer)
returns text
language sql
immutable
as $$
  select case p_level
    when 1 then 'housekeeping_supervisor'
    when 2 then 'operations_executive'
    when 3 then 'facility_manager'
    when 4 then 'project_head'
    when 5 then 'hospital_dean'
    else 'housekeeping_supervisor'
  end
$$;

create or replace function public.hospital_ticket_level_for_role(p_role text)
returns integer
language sql
immutable
as $$
  select case p_role
    when 'housekeeping_supervisor' then 1
    when 'supervisor' then 1
    when 'operations_executive' then 2
    when 'zonal_head' then 2
    when 'facility_manager' then 3
    when 'project_head' then 4
    when 'hospital_dean' then 5
    else 1
  end
$$;

create or replace function public.hospital_ticket_level_code(p_level integer)
returns text
language sql
immutable
as $$
  select case p_level
    when 1 then 'supervisor'
    when 2 then 'operations_executive'
    when 3 then 'facility_manager'
    when 4 then 'project_head'
    when 5 then 'hospital_dean'
    else 'supervisor'
  end
$$;

create or replace function public.hospital_ticket_role_label(p_role text)
returns text
language sql
immutable
as $$
  select case p_role
    when 'housekeeping_supervisor' then 'Supervisor'
    when 'operations_executive' then 'Operations Executive'
    when 'zonal_head' then 'Zonal Head'
    when 'facility_manager' then 'Facility Manager'
    when 'project_head' then 'Project Head'
    when 'hospital_dean' then 'Hospital Dean'
    else initcap(replace(coalesce(p_role, 'owner'), '_', ' '))
  end
$$;

create or replace function public.hospital_ticket_status_for_level(p_level integer, p_existing_status text)
returns text
language sql
immutable
as $$
  select case
    when p_level = 1 and coalesce(p_existing_status, '') = 'awaiting_supervisor_acceptance' then 'assigned'
    when p_level = 1 then coalesce(nullif(p_existing_status, ''), 'assigned')
    when p_level = 2 then 'escalated_operations_executive'
    when p_level = 3 then 'escalated_facility_manager'
    when p_level = 4 then 'escalated_project_head'
    when p_level = 5 then 'escalated_hospital_dean'
    else coalesce(nullif(p_existing_status, ''), 'assigned')
  end
$$;

do $$
begin
  if exists (
    select 1
    from pg_constraint
    where conrelid = 'public.hospital_ticket_assignment_history'::regclass
      and conname = 'hospital_ticket_assignment_history_type_check'
  ) then
    alter table public.hospital_ticket_assignment_history
      drop constraint hospital_ticket_assignment_history_type_check;
  end if;
end $$;

alter table public.hospital_ticket_assignment_history
  add constraint hospital_ticket_assignment_history_type_check
  check (
    assignment_type is null
    or assignment_type in (
      'primary',
      'backup',
      'overall_fallback',
      'operations_fallback',
      'acceptance_escalation',
      'manual_reassignment'
    )
  );

comment on function public.hospital_ticket_role_for_level(integer) is
  'Hospital Ticket role hierarchy helper. Normal SLA escalation stops at level 4/project_head; level 5 preserves separate public-cleanliness Hospital Dean support.';
comment on constraint hospital_ticket_assignment_history_type_check on public.hospital_ticket_assignment_history is
  'Allows routing, fallback, acceptance escalation, and manual reassignment assignment history types written by current production code.';

commit;
