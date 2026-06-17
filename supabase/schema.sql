create extension if not exists "pgcrypto";

create table if not exists public.profiles (
  id uuid primary key default gen_random_uuid(),
  email text unique not null,
  full_name text not null,
  role text not null check (role in ('Admin', 'BD Head', 'BD Executive', 'Operations Team', 'Coordinator', 'Commercial', 'Commercial Team', 'Commercial Reviewer', 'Finance', 'Finance Team', 'Finance Reviewer', 'HR Reviewer', 'COO')),
  status text not null default 'Pending Approval',
  is_active boolean not null default false,
  approved_by text,
  approved_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.leads (
  id uuid primary key default gen_random_uuid(),
  client_name text not null,
  industry_type text,
  lead_source text,
  site_location text,
  state text,
  city text,
  lead_priority text,
  service_scope jsonb not null default '[]'::jsonb,
  remarks text,
  assigned_bd_executive text,
  assigned_bd_email text,
  created_by_user_id text,
  created_by_name text,
  lead_stage text not null default 'New Lead',
  status text not null default 'Active',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.lead_contacts (
  id uuid primary key default gen_random_uuid(),
  lead_id uuid not null references public.leads(id) on delete cascade,
  assessment_id uuid,
  contact_person_name text not null,
  contact_person_designation text,
  contact_number text,
  email_id text,
  is_primary boolean not null default false,
  created_at timestamptz not null default now()
);

alter table public.lead_contacts drop constraint if exists lead_contacts_lead_id_key;
alter table public.lead_contacts add column if not exists assessment_id uuid;
create unique index if not exists lead_contacts_one_primary_per_lead on public.lead_contacts(lead_id) where is_primary = true and assessment_id is null;
create unique index if not exists lead_contacts_unique_email_per_lead on public.lead_contacts(lead_id, lower(email_id)) where email_id is not null;
create unique index if not exists lead_contacts_unique_phone_per_lead on public.lead_contacts(lead_id, contact_number) where contact_number is not null;

create table if not exists public.lead_mom (
  id uuid primary key default gen_random_uuid(),
  lead_id uuid not null unique references public.leads(id) on delete cascade,
  to_email text,
  cc_emails text,
  subject text,
  discussion_summary text,
  service_scope_discussion text,
  action_items text,
  next_followup_date date,
  scheduled_site_visit_date date,
  scheduled_site_visit_time time,
  site_visit_remarks text,
  calendar_invite_sent boolean not null default false,
  mom_status text not null default 'Draft',
  sent_at timestamptz,
  created_at timestamptz not null default now()
);

alter table public.leads
add column if not exists service_scope jsonb not null default '[]'::jsonb;

alter table public.lead_mom
add column if not exists scheduled_site_visit_date date,
add column if not exists scheduled_site_visit_time time,
add column if not exists next_followup_date date,
add column if not exists calendar_invite_sent boolean not null default false;

create table if not exists public.site_visits (
  id uuid primary key default gen_random_uuid(),
  lead_id uuid not null references public.leads(id) on delete cascade,
  client_name text not null,
  site_name text,
  scheduled_visit_date date,
  scheduled_visit_time time,
  assigned_bd_executive text,
  assigned_bd_email text,
  current_stage text not null default 'Pre-Operational Assessment',
  status text not null default 'Scheduled',
  mom_status text not null default 'Pending',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.site_assessments (
  id uuid primary key default gen_random_uuid(),
  site_visit_id uuid not null unique references public.site_visits(id) on delete cascade,
  lead_id uuid references public.leads(id) on delete cascade,
  basic_site_information jsonb not null default '{}'::jsonb,
  ifm_service_scope jsonb not null default '{}'::jsonb,
  hard_services jsonb not null default '{}'::jsonb,
  soft_services jsonb not null default '{}'::jsonb,
  landscaping_pest_control jsonb not null default '{}'::jsonb,
  hse_compliance jsonb not null default '[]'::jsonb,
  manpower_requirement jsonb not null default '{}'::jsonb,
  tools_equipment_consumables jsonb not null default '{}'::jsonb,
  client_kyc jsonb not null default '{}'::jsonb,
  risk_assessment jsonb not null default '{}'::jsonb,
  penalty_clauses jsonb not null default '{}'::jsonb,
  commercial_statement jsonb not null default '{}'::jsonb,
  approval_mechanism jsonb not null default '{}'::jsonb,
  final_remarks_signoff jsonb not null default '{}'::jsonb,
  assessment_status text not null default 'Draft',
  final_remarks text,
  created_by text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.site_images (
  id uuid primary key default gen_random_uuid(),
  site_visit_id uuid references public.site_visits(id) on delete cascade,
  assessment_id uuid references public.site_assessments(id) on delete cascade,
  image_category text not null,
  image_url text not null,
  file_name text,
  uploaded_by text,
  created_at timestamptz not null default now()
);

create table if not exists public.site_mom (
  id uuid primary key default gen_random_uuid(),
  site_visit_id uuid not null unique references public.site_visits(id) on delete cascade,
  to_email text,
  cc_emails text,
  subject text,
  summary text,
  scope text,
  requirements text,
  commercial_notes text,
  next_action text,
  mom_status text not null default 'Draft',
  sent_at timestamptz,
  created_at timestamptz not null default now()
);

create table if not exists public.approval_requests (
  id uuid primary key default gen_random_uuid(),
  lead_id uuid references public.leads(id) on delete cascade,
  site_visit_id uuid references public.site_visits(id) on delete cascade,
  assessment_id uuid references public.site_assessments(id) on delete cascade,
  approval_stage text not null,
  pending_with text not null,
  status text not null default 'Pending',
  remarks text,
  approved_by text,
  approved_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.assessment_audit_logs (
  id uuid primary key default gen_random_uuid(),
  site_visit_id uuid references public.site_visits(id) on delete cascade,
  assessment_id uuid references public.site_assessments(id) on delete cascade,
  section_name text not null,
  action_type text not null,
  edited_by text,
  edited_by_role text,
  edited_at timestamptz not null default now(),
  old_value jsonb not null default '{}'::jsonb,
  new_value jsonb not null default '{}'::jsonb,
  remarks text
);

alter table public.approval_requests add column if not exists approved_by text;
alter table public.approval_requests add column if not exists approved_at timestamptz;

create table if not exists public.commercial_reviews (
  id uuid primary key default gen_random_uuid(),
  site_visit_id uuid references public.site_visits(id) on delete cascade,
  reviewer_id text,
  reviewer_name text,
  status text not null default 'Pending',
  comments text,
  submitted_at timestamptz default now(),
  approved_at timestamptz,
  rejected_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.finance_reviews (
  id uuid primary key default gen_random_uuid(),
  site_visit_id uuid references public.site_visits(id) on delete cascade,
  reviewer_id text,
  reviewer_name text,
  status text not null default 'Pending',
  comments text,
  submitted_at timestamptz default now(),
  approved_at timestamptz,
  rejected_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.hr_reviews (
  id uuid primary key default gen_random_uuid(),
  site_visit_id uuid references public.site_visits(id) on delete cascade,
  reviewer_id text,
  reviewer_name text,
  status text not null default 'Pending',
  comments text,
  submitted_at timestamptz default now(),
  approved_at timestamptz,
  rejected_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.workflow_activity_logs (
  id uuid primary key default gen_random_uuid(),
  site_visit_id uuid references public.site_visits(id) on delete cascade,
  actor_id text,
  actor_name text,
  actor_role text,
  activity_type text not null,
  comments text,
  created_at timestamptz not null default now()
);

create table if not exists public.approval_tracking (
  id uuid primary key default gen_random_uuid(),
  site_visit_id uuid references public.site_visits(id) on delete cascade,
  approval_stage text not null,
  pending_with text,
  status text not null default 'Pending',
  reviewer_name text,
  comments text,
  acted_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.assessment_edit_logs (
  id uuid primary key default gen_random_uuid(),
  site_visit_id uuid references public.site_visits(id) on delete cascade,
  assessment_id uuid references public.site_assessments(id) on delete cascade,
  section_name text not null,
  edited_by text,
  edited_by_role text,
  edited_at timestamptz not null default now(),
  old_value jsonb not null default '{}'::jsonb,
  new_value jsonb not null default '{}'::jsonb,
  comments text
);

create table if not exists public.wage_master (
  id uuid primary key default gen_random_uuid(),
  state text not null,
  zone text not null,
  designation text not null,
  basic numeric not null default 0,
  da numeric not null default 0,
  hours numeric not null default 8,
  effective_date date not null,
  created_at timestamptz not null default now()
);

create table if not exists public.statutory_master (
  id uuid primary key default gen_random_uuid(),
  pf_percent numeric not null default 0.12,
  esi_percent numeric not null default 0.0325,
  gratuity_percent numeric not null default 0.0481,
  leave_wage_percent numeric not null default 0.0481,
  bonus_percent numeric not null default 0.0833,
  reliever_percent numeric not null default 0.167,
  management_fee numeric not null default 0.10,
  effective_date date default current_date,
  created_at timestamptz not null default now()
);

create table if not exists public.manpower_costing (
  id uuid primary key default gen_random_uuid(),
  site_visit_id uuid references public.site_visits(id) on delete cascade,
  assessment_id uuid references public.site_assessments(id) on delete cascade,
  designation text,
  quantity numeric not null default 0,
  shift text,
  wage_category text,
  gender text,
  gross_salary numeric not null default 0,
  statutory_deductions numeric not null default 0,
  employer_contribution numeric not null default 0,
  reliever_cost numeric not null default 0,
  nfh numeric not null default 0,
  management_fee numeric not null default 0,
  profitability numeric not null default 0,
  final_billable_value numeric not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.proposal_generations (
  id uuid primary key default gen_random_uuid(),
  site_visit_id uuid references public.site_visits(id) on delete cascade,
  proposal_status text not null default 'Draft',
  template_name text default 'New Business Proposal Format.xlsx',
  excel_url text,
  pdf_url text,
  sent_to_client_at timestamptz,
  generated_by text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.linkedin_lead_sync_queue (
  id uuid primary key default gen_random_uuid(),
  provider text not null default 'LinkedIn',
  external_lead_id text,
  payload jsonb not null default '{}'::jsonb,
  mapped_lead_id uuid references public.leads(id) on delete set null,
  sync_status text not null default 'Pending',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.activity_logs (
  id uuid primary key default gen_random_uuid(),
  lead_id uuid references public.leads(id) on delete cascade,
  site_visit_id uuid references public.site_visits(id) on delete cascade,
  activity_type text not null,
  activity_message text not null,
  created_by text,
  created_at timestamptz not null default now()
);

insert into storage.buckets (id, name, public)
values ('site-survey-images', 'site-survey-images', true)
on conflict (id) do nothing;

alter table public.profiles enable row level security;
alter table public.leads enable row level security;
alter table public.lead_contacts enable row level security;
alter table public.lead_mom enable row level security;
alter table public.site_visits enable row level security;
alter table public.site_assessments enable row level security;
alter table public.site_images enable row level security;
alter table public.site_mom enable row level security;
alter table public.approval_requests enable row level security;
alter table public.assessment_audit_logs enable row level security;
alter table public.commercial_reviews enable row level security;
alter table public.finance_reviews enable row level security;
alter table public.hr_reviews enable row level security;
alter table public.workflow_activity_logs enable row level security;
alter table public.assessment_edit_logs enable row level security;
alter table public.approval_tracking enable row level security;
alter table public.wage_master enable row level security;
alter table public.statutory_master enable row level security;
alter table public.manpower_costing enable row level security;
alter table public.proposal_generations enable row level security;
alter table public.linkedin_lead_sync_queue enable row level security;
alter table public.activity_logs enable row level security;

drop policy if exists "anon crm read profiles" on public.profiles;
drop policy if exists "anon crm all leads" on public.leads;
drop policy if exists "anon crm all lead contacts" on public.lead_contacts;
drop policy if exists "anon crm all lead mom" on public.lead_mom;
drop policy if exists "anon crm all site visits" on public.site_visits;
drop policy if exists "anon crm all site assessments" on public.site_assessments;
drop policy if exists "anon crm all site images" on public.site_images;
drop policy if exists "anon crm all site mom" on public.site_mom;
drop policy if exists "anon crm all approvals" on public.approval_requests;
drop policy if exists "anon crm all assessment audit logs" on public.assessment_audit_logs;
drop policy if exists "anon crm all commercial reviews" on public.commercial_reviews;
drop policy if exists "anon crm all finance reviews" on public.finance_reviews;
drop policy if exists "anon crm all hr reviews" on public.hr_reviews;
drop policy if exists "anon crm all workflow activity logs" on public.workflow_activity_logs;
drop policy if exists "anon crm all assessment edit logs" on public.assessment_edit_logs;
drop policy if exists "anon crm all approval tracking" on public.approval_tracking;
drop policy if exists "anon crm all wage master" on public.wage_master;
drop policy if exists "anon crm all statutory master" on public.statutory_master;
drop policy if exists "anon crm all manpower costing" on public.manpower_costing;
drop policy if exists "anon crm all proposal generations" on public.proposal_generations;
drop policy if exists "anon crm all linkedin lead sync queue" on public.linkedin_lead_sync_queue;
drop policy if exists "anon crm all activity logs" on public.activity_logs;
drop policy if exists "anon upload site survey images" on storage.objects;
drop policy if exists "anon read site survey images" on storage.objects;

create policy "anon crm read profiles" on public.profiles for select using (true);
create policy "anon crm all leads" on public.leads for all using (true) with check (true);
create policy "anon crm all lead contacts" on public.lead_contacts for all using (true) with check (true);
create policy "anon crm all lead mom" on public.lead_mom for all using (true) with check (true);
create policy "anon crm all site visits" on public.site_visits for all using (true) with check (true);
create policy "anon crm all site assessments" on public.site_assessments for all using (true) with check (true);
create policy "anon crm all site images" on public.site_images for all using (true) with check (true);
create policy "anon crm all site mom" on public.site_mom for all using (true) with check (true);
create policy "anon crm all approvals" on public.approval_requests for all using (true) with check (true);
create policy "anon crm all assessment audit logs" on public.assessment_audit_logs for all using (true) with check (true);
create policy "anon crm all commercial reviews" on public.commercial_reviews for all using (true) with check (true);
create policy "anon crm all finance reviews" on public.finance_reviews for all using (true) with check (true);
create policy "anon crm all hr reviews" on public.hr_reviews for all using (true) with check (true);
create policy "anon crm all workflow activity logs" on public.workflow_activity_logs for all using (true) with check (true);
create policy "anon crm all assessment edit logs" on public.assessment_edit_logs for all using (true) with check (true);
create policy "anon crm all approval tracking" on public.approval_tracking for all using (true) with check (true);
create policy "anon crm all wage master" on public.wage_master for all using (true) with check (true);
create policy "anon crm all statutory master" on public.statutory_master for all using (true) with check (true);
create policy "anon crm all manpower costing" on public.manpower_costing for all using (true) with check (true);
create policy "anon crm all proposal generations" on public.proposal_generations for all using (true) with check (true);
create policy "anon crm all linkedin lead sync queue" on public.linkedin_lead_sync_queue for all using (true) with check (true);
create policy "anon crm all activity logs" on public.activity_logs for all using (true) with check (true);

create policy "anon upload site survey images"
on storage.objects for insert
with check (bucket_id = 'site-survey-images');

create policy "anon read site survey images"
on storage.objects for select
using (bucket_id = 'site-survey-images');
