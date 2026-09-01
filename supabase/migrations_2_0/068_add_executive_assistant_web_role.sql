-- Add Executive Assistant as a first-class web-only application/profile role.
--
-- This migration only widens the public.profiles role constraint. It does not
-- create users, alter COO, seed hospital/mobile roles, or change mobile login
-- RPC allowlists.

do $$
declare
  v_constraint_name text;
begin
  select con.conname
    into v_constraint_name
  from pg_constraint con
  join pg_class rel on rel.oid = con.conrelid
  join pg_namespace nsp on nsp.oid = rel.relnamespace
  where nsp.nspname = 'public'
    and rel.relname = 'profiles'
    and con.contype = 'c'
    and con.conname = 'profiles_role_check'
  order by con.conname
  limit 1;

  if v_constraint_name is not null then
    execute format('alter table public.profiles drop constraint %I', v_constraint_name);
  end if;
end $$;

alter table public.profiles
  add constraint profiles_role_check
  check (
    role in (
      'Admin',
      'QPMS Admin',
      'Developer',
      'Dev',
      'IT Admin',
      'Management IT Admin',
      'MD',
      'COO',
      'Executive Assistant',
      'GM',
      'General Manager',
      'South Head',
      'Business Head',
      'Branch Head',
      'Operations Manager',
      'Manager',
      'KAM',
      'FO',
      'Field Officer',
      'Supervisor',
      'BD Executive',
      'BD Head',
      'Hospital Management',
      'RMO',
      'Doctor',
      'Operations Team',
      'Coordinator',
      'Commercial',
      'Commercial Team',
      'Commercial Reviewer',
      'Finance',
      'Finance Team',
      'Finance Reviewer',
      'HR Reviewer',
      'HR',
      'HR GM',
      'Finance GM'
    )
  ) not valid;
