-- Mobile_FO_V2 schema migration 2.0
-- 006: Registration department, designation, and business classification.

alter table public.profiles
  add column if not exists department text,
  add column if not exists designation text,
  add column if not exists business text;

update public.profiles
set designation = 'Field Officer'
where role = 'FO'
  and designation is null;

update public.profiles
set department = 'Operations'
where role = 'FO'
  and department is null;

comment on column public.profiles.department is
  'Employee department selected during mobile registration for profile and reporting use.';

comment on column public.profiles.designation is
  'Employee designation selected during mobile registration for profile and reporting use.';

comment on column public.profiles.business is
  'Operations business classification for mobile users; null for non-Operations departments.';
