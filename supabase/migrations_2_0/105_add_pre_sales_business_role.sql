-- Add the canonical Pre-Sales business role without changing profile data.
begin;

alter table public.profiles drop constraint if exists profiles_role_check;
alter table public.profiles add constraint profiles_role_check check (
  role in (
    'Admin', 'QPMS Admin', 'Developer', 'Dev', 'IT Admin', 'Management IT Admin',
    'Management',
    'MD', 'COO', 'Executive Assistant', 'GM', 'General Manager', 'South Head',
    'Business Head', 'Branch Head', 'Operations Manager', 'Manager', 'KAM',
    'FO', 'Field Officer', 'Supervisor', 'BD Executive', 'BD Head',
    'Pre-Sales', 'Pre-Sales Executive', 'Pre-Sales Manager',
    'Hospital Management', 'RMO', 'Doctor', 'Operations Team', 'Coordinator',
    'Commercial', 'Commercial Team', 'Commercial Reviewer', 'Finance',
    'Finance Team', 'Finance Reviewer', 'HR Reviewer', 'HR', 'HR GM',
    'Finance GM', 'DEMO_VIEWER'
  )
) not valid;

comment on constraint profiles_role_check on public.profiles is
  'Pre-Sales is the canonical business role. Pre-Sales Executive and Pre-Sales Manager remain compatibility aliases.';

commit;
