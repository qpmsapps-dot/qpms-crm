begin;

-- Structured Training masters for new Reliance Retail sessions.
-- Legacy fo_activity_submissions, fo_activity_uploads, and fo-activity-uploads
-- remain unchanged and are intentionally not backfilled.

create table if not exists public.training_categories (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  name text not null,
  description text,
  icon_key text,
  require_attendee boolean not null default true,
  require_selected_topic boolean not null default true,
  topic_evidence_policy text not null default 'optional',
  require_group_photo boolean not null default false,
  require_attendance_sheet boolean not null default false,
  require_training_document boolean not null default false,
  max_group_photos integer not null default 10,
  is_active boolean not null default true,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint training_categories_code_not_blank check (btrim(code) <> ''),
  constraint training_categories_name_not_blank check (btrim(name) <> ''),
  constraint training_categories_topic_evidence_policy_check
    check (topic_evidence_policy in ('optional', 'required', 'at_least_one')),
  constraint training_categories_max_group_photos_check check (max_group_photos >= 0)
);

create table if not exists public.training_types (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  name text not null,
  description text,
  is_active boolean not null default true,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint training_types_code_not_blank check (btrim(code) <> ''),
  constraint training_types_name_not_blank check (btrim(name) <> '')
);

create table if not exists public.training_topics (
  id uuid primary key default gen_random_uuid(),
  category_id uuid not null references public.training_categories(id) on delete restrict,
  code text not null,
  module_name text not null,
  topic_description text not null,
  icon_key text,
  is_required_default boolean not null default false,
  is_active boolean not null default true,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint training_topics_category_code_key unique (category_id, code),
  constraint training_topics_code_not_blank check (btrim(code) <> ''),
  constraint training_topics_module_name_not_blank check (btrim(module_name) <> ''),
  constraint training_topics_description_not_blank check (btrim(topic_description) <> '')
);

create index if not exists idx_training_topics_category
  on public.training_topics(category_id);
create index if not exists idx_training_topics_active
  on public.training_topics(is_active);
create index if not exists idx_training_topics_category_sort
  on public.training_topics(category_id, sort_order);

create table if not exists public.training_sessions (
  id uuid primary key references public.fo_activity_submissions(id) on delete restrict,
  category_id uuid not null references public.training_categories(id) on delete restrict,
  training_type_id uuid not null references public.training_types(id) on delete restrict,
  trainer_profile_id uuid references public.profiles(id) on delete set null,
  trainer_name_snapshot text not null,
  training_date date not null,
  remarks text,
  status text not null default 'draft',
  attendance_id uuid not null references public.fo_attendance(id) on delete restrict,
  site_visit_id uuid not null references public.fo_site_visits(id) on delete restrict,
  store_id uuid not null references public.store_master(id) on delete restrict,
  access_client_id uuid not null references public.access_clients(id) on delete restrict,
  access_client_code text not null,
  business_code_snapshot text,
  business_name_snapshot text,
  state_snapshot text,
  store_code_snapshot text,
  store_name_snapshot text,
  require_attendee_snapshot boolean not null,
  require_selected_topic_snapshot boolean not null,
  topic_evidence_policy_snapshot text not null,
  require_group_photo_snapshot boolean not null,
  require_attendance_sheet_snapshot boolean not null,
  require_training_document_snapshot boolean not null,
  max_group_photos_snapshot integer not null,
  submitted_at timestamptz,
  submitted_by uuid references public.profiles(id) on delete set null,
  cancelled_at timestamptz,
  cancelled_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint training_sessions_status_check check (status in ('draft', 'submitted', 'cancelled')),
  constraint training_sessions_access_client_code_not_blank check (btrim(access_client_code) <> ''),
  constraint training_sessions_trainer_name_not_blank check (btrim(trainer_name_snapshot) <> ''),
  constraint training_sessions_topic_evidence_policy_check
    check (topic_evidence_policy_snapshot in ('optional', 'required', 'at_least_one')),
  constraint training_sessions_max_group_photos_check check (max_group_photos_snapshot >= 0),
  constraint training_sessions_remarks_length_check check (remarks is null or char_length(remarks) <= 500)
);

create index if not exists idx_training_sessions_status
  on public.training_sessions(status);
create index if not exists idx_training_sessions_store
  on public.training_sessions(store_id);
create index if not exists idx_training_sessions_attendance
  on public.training_sessions(attendance_id);
create index if not exists idx_training_sessions_site_visit
  on public.training_sessions(site_visit_id);
create index if not exists idx_training_sessions_access_client
  on public.training_sessions(access_client_id);
create index if not exists idx_training_sessions_training_date
  on public.training_sessions(training_date);
create index if not exists idx_training_sessions_category
  on public.training_sessions(category_id);

create table if not exists public.training_session_attendees (
  id uuid primary key default gen_random_uuid(),
  training_session_id uuid not null references public.training_sessions(id) on delete cascade,
  profile_id uuid references public.profiles(id) on delete set null,
  employee_code text not null,
  employee_name text not null,
  designation_snapshot text,
  added_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  constraint training_session_attendees_session_employee_key
    unique (training_session_id, employee_code),
  constraint training_session_attendees_employee_code_not_blank check (btrim(employee_code) <> ''),
  constraint training_session_attendees_employee_name_not_blank check (btrim(employee_name) <> '')
);

create index if not exists idx_training_session_attendees_session
  on public.training_session_attendees(training_session_id);
create index if not exists idx_training_session_attendees_employee_code
  on public.training_session_attendees(employee_code);

create table if not exists public.training_session_topics (
  id uuid primary key default gen_random_uuid(),
  training_session_id uuid not null references public.training_sessions(id) on delete cascade,
  topic_id uuid not null references public.training_topics(id) on delete restrict,
  is_covered boolean not null default false,
  remarks text,
  completed_at timestamptz,
  completed_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint training_session_topics_session_topic_key unique (training_session_id, topic_id),
  constraint training_session_topics_completion_check
    check (is_covered or (completed_at is null and completed_by is null))
);

create index if not exists idx_training_session_topics_session
  on public.training_session_topics(training_session_id);
create index if not exists idx_training_session_topics_topic
  on public.training_session_topics(topic_id);
create index if not exists idx_training_session_topics_covered
  on public.training_session_topics(is_covered);

create table if not exists public.training_evidence (
  id uuid primary key default gen_random_uuid(),
  training_session_id uuid not null references public.training_sessions(id) on delete cascade,
  training_session_topic_id uuid references public.training_session_topics(id) on delete set null,
  evidence_type text not null,
  storage_bucket text not null default 'training-evidence',
  storage_path text not null,
  file_name text not null,
  mime_type text not null,
  file_size bigint not null,
  uploaded_by uuid references public.profiles(id) on delete set null,
  metadata jsonb default '{}'::jsonb,
  created_at timestamptz not null default now(),
  constraint training_evidence_type_check
    check (evidence_type in (
      'topic_photo',
      'group_photo',
      'attendance_sheet',
      'training_document',
      'additional_document'
    )),
  constraint training_evidence_file_size_check check (file_size >= 0),
  constraint training_evidence_storage_bucket_not_blank check (btrim(storage_bucket) <> ''),
  constraint training_evidence_storage_path_not_blank check (btrim(storage_path) <> ''),
  constraint training_evidence_file_name_not_blank check (btrim(file_name) <> ''),
  constraint training_evidence_mime_type_not_blank check (btrim(mime_type) <> ''),
  constraint training_evidence_metadata_object_check
    check (metadata is null or jsonb_typeof(metadata) = 'object')
);

create unique index if not exists ux_training_evidence_storage_object
  on public.training_evidence(storage_bucket, storage_path);
create index if not exists idx_training_evidence_session
  on public.training_evidence(training_session_id);
create index if not exists idx_training_evidence_session_topic
  on public.training_evidence(training_session_topic_id);
create index if not exists idx_training_evidence_type
  on public.training_evidence(evidence_type);

create table if not exists public.training_events (
  id uuid primary key default gen_random_uuid(),
  training_session_id uuid not null references public.training_sessions(id) on delete cascade,
  event_type text not null,
  actor_profile_id uuid references public.profiles(id) on delete set null,
  metadata jsonb default '{}'::jsonb,
  created_at timestamptz not null default now(),
  constraint training_events_event_type_not_blank check (btrim(event_type) <> ''),
  constraint training_events_metadata_object_check
    check (metadata is null or jsonb_typeof(metadata) = 'object')
);

create index if not exists idx_training_events_session
  on public.training_events(training_session_id);
create index if not exists idx_training_events_type
  on public.training_events(event_type);
create index if not exists idx_training_events_created
  on public.training_events(created_at);

-- Reuse the existing public.set_updated_at() helper without replacing it.
do $triggers$
declare
  v_table text;
  v_trigger text;
begin
  foreach v_table in array array[
    'training_categories',
    'training_types',
    'training_topics',
    'training_sessions',
    'training_session_topics'
  ] loop
    v_trigger := 'trg_' || v_table || '_updated_at';
    if not exists (
      select 1
      from pg_trigger t
      join pg_class c on c.oid = t.tgrelid
      join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'public'
        and c.relname = v_table
        and t.tgname = v_trigger
        and not t.tgisinternal
    ) then
      execute format(
        'create trigger %I before update on public.%I for each row execute function public.set_updated_at()',
        v_trigger,
        v_table
      );
    end if;
  end loop;
end
$triggers$;

-- Categories.
insert into public.training_categories (
  code,
  name,
  description,
  sort_order
)
values
  (
    'hk',
    'Housekeeping (HK)',
    'Housekeeping, cleaning, hygiene, SOP, PPE and soft services training.',
    1
  ),
  (
    'technical_mep',
    'Technical / MEP',
    'Electrical, HVAC, DG, UPS, safety and technical maintenance training.',
    2
  )
on conflict (code) do update
set name = excluded.name,
    description = excluded.description,
    sort_order = excluded.sort_order,
    is_active = true;

-- Training types.
insert into public.training_types (code, name, sort_order)
values
  ('toolbox', 'Toolbox', 1),
  ('classroom', 'Classroom', 2),
  ('practical', 'Practical', 3),
  ('refresher', 'Refresher', 4)
on conflict (code) do update
set name = excluded.name,
    sort_order = excluded.sort_order,
    is_active = true;

-- Housekeeping topics (17).
insert into public.training_topics (
  category_id,
  code,
  module_name,
  topic_description,
  sort_order
)
select
  c.id,
  seed.code,
  seed.module_name,
  seed.topic_description,
  seed.sort_order
from public.training_categories c
cross join (
  values
    ('housekeeping_basics', 'Housekeeping Basics', 'Cleaning principles, cleaning sequence and area-wise standards', 1),
    ('cleaning_chemicals', 'Cleaning Chemicals', 'Chemical identification, dilution, storage and safe handling', 2),
    ('floor_care', 'Floor Care', 'Sweeping, mopping, scrubbing, polishing and stain removal', 3),
    ('washroom_cleaning', 'Washroom Cleaning', 'Cleaning procedure, hygiene standards and consumable management', 4),
    ('glass_high_level_cleaning', 'Glass & High-Level Cleaning', 'Proper tools, access equipment and safety precautions', 5),
    ('dusting_surface_cleaning', 'Dusting & Surface Cleaning', 'Correct methods for different surfaces and fixtures', 6),
    ('deep_cleaning', 'Deep Cleaning', 'Periodic deep-cleaning activities and checklist compliance', 7),
    ('machine_operation', 'Machine Operation', 'Single-disc machine, scrubber, vacuum cleaner and other equipment', 8),
    ('ppe_safety', 'PPE & Safety', 'Gloves, masks, safety shoes, signage and chemical safety', 9),
    ('waste_management', 'Waste Management', 'Waste segregation, collection and disposal procedures', 10),
    ('pest_control_awareness', 'Pest Control Awareness', 'Identification of pest activity and escalation process', 11),
    ('store_hygiene', 'Store Hygiene', 'Retail-floor, back-office and customer-area hygiene standards', 12),
    ('attendance_grooming', 'Attendance & Grooming', 'Uniform, ID card, personal hygiene, attendance and discipline', 13),
    ('customer_interaction', 'Customer Interaction', 'Store-team communication and complaint handling', 14),
    ('sop_compliance', 'SOP Compliance', 'Daily/weekly/monthly checklists and supervisor verification', 15),
    ('quality_inspection', 'Quality Inspection', 'Housekeeping audit points and corrective actions', 16),
    ('emergency_response', 'Emergency Response', 'Spill management, broken glass, water leakage and other incidents', 17)
) as seed(code, module_name, topic_description, sort_order)
where c.code = 'hk'
on conflict (category_id, code) do update
set module_name = excluded.module_name,
    topic_description = excluded.topic_description,
    sort_order = excluded.sort_order,
    is_active = true;

-- Technical / MEP topics (15).
insert into public.training_topics (
  category_id,
  code,
  module_name,
  topic_description,
  sort_order
)
select
  c.id,
  seed.code,
  seed.module_name,
  seed.topic_description,
  seed.sort_order
from public.training_categories c
cross join (
  values
    ('electrical_safety', 'Electrical Safety', 'Electrical safety practices, PPE, LOTO, shock prevention', 1),
    ('electrical_systems', 'Electrical Systems', 'LT panels, DBs, MCB/MCCB, contactors, relays, ATS, DG, UPS', 2),
    ('preventive_maintenance', 'Preventive Maintenance', 'PM checklist, schedule adherence, equipment inspection and reporting', 3),
    ('corrective_maintenance', 'Corrective Maintenance', 'Fault identification, troubleshooting and rectification', 4),
    ('hvac', 'HVAC', 'AHU, FCU, split AC, package AC, basic troubleshooting and PM', 5),
    ('fire_life_safety', 'Fire & Life Safety', 'Fire alarm, fire extinguishers, hydrant/sprinkler basics, emergency response', 6),
    ('dg_ups', 'DG & UPS', 'DG operation, battery maintenance, UPS operation and safety', 7),
    ('thermography', 'Thermography', 'Correct testing procedure, safety, hotspot identification, reporting', 8),
    ('energy_management', 'Energy Management', 'Energy-saving practices and abnormal consumption identification', 9),
    ('tools_instruments', 'Tools & Instruments', 'Multimeter, clamp meter, insulation tester, temperature meter, etc.', 10),
    ('oos_management', 'OOS Management', 'Call acceptance, site visit, quotation, approval, execution and closure', 11),
    ('documentation', 'Documentation', 'Before/after photos, service reports, checklists and closure documents', 12),
    ('quality_standards', 'Quality Standards', 'Workmanship, rework prevention and client audit requirements', 13),
    ('emergency_response', 'Emergency Response', 'Electrical failure, fire, water leakage, power failure and other emergencies', 14),
    ('soft_skills', 'Soft Skills', 'Store-team communication, escalation protocol and professional behaviour', 15)
) as seed(code, module_name, topic_description, sort_order)
where c.code = 'technical_mep'
on conflict (category_id, code) do update
set module_name = excluded.module_name,
    topic_description = excluded.topic_description,
    sort_order = excluded.sort_order,
    is_active = true;

-- New evidence bucket. No storage.objects policies are created: ordinary
-- authenticated clients have no bucket access; the future backend will use
-- service-role-authorized signed URLs.
insert into storage.buckets (id, name, public)
values ('training-evidence', 'training-evidence', false)
on conflict (id) do update
set name = excluded.name,
    public = false;

alter table public.training_categories enable row level security;
alter table public.training_types enable row level security;
alter table public.training_topics enable row level security;
alter table public.training_sessions enable row level security;
alter table public.training_session_attendees enable row level security;
alter table public.training_session_topics enable row level security;
alter table public.training_evidence enable row level security;
alter table public.training_events enable row level security;

revoke all on table public.training_categories from public, anon, authenticated;
revoke all on table public.training_types from public, anon, authenticated;
revoke all on table public.training_topics from public, anon, authenticated;
revoke all on table public.training_sessions from public, anon, authenticated;
revoke all on table public.training_session_attendees from public, anon, authenticated;
revoke all on table public.training_session_topics from public, anon, authenticated;
revoke all on table public.training_evidence from public, anon, authenticated;
revoke all on table public.training_events from public, anon, authenticated;

grant select, insert, update, delete on table public.training_categories to service_role;
grant select, insert, update, delete on table public.training_types to service_role;
grant select, insert, update, delete on table public.training_topics to service_role;
grant select, insert, update, delete on table public.training_sessions to service_role;
grant select, insert, update, delete on table public.training_session_attendees to service_role;
grant select, insert, update, delete on table public.training_session_topics to service_role;
grant select, insert, update, delete on table public.training_evidence to service_role;
grant select, insert, update, delete on table public.training_events to service_role;

comment on table public.training_sessions is
  'Normalized structured Training details for new Reliance Retail sessions. The row ID is the associated fo_activity_submissions ID.';
comment on table public.training_evidence is
  'Evidence metadata for structured Training only. Historical fo_activity_uploads remain unchanged.';

commit;
