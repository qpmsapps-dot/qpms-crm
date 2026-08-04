-- DME Hospital Feedback QR hierarchy and feedback submission persistence.
-- Additive only. Preserves existing hospital_clients semantics and QR tokens.
--
-- Rollback guidance:
--   drop table if exists public.hospital_feedback_submissions;
--   alter table public.hospital_clients drop column if exists parent_client_id;
--   drop table if exists public.hospital_parent_clients;

create extension if not exists "pgcrypto";

create table if not exists public.hospital_parent_clients (
  id uuid primary key default gen_random_uuid(),
  client_code text not null unique,
  client_name text not null,
  business_type text,
  is_active boolean not null default true,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint hospital_parent_clients_code_not_blank check (btrim(client_code) <> ''),
  constraint hospital_parent_clients_name_not_blank check (btrim(client_name) <> ''),
  constraint hospital_parent_clients_metadata_object check (jsonb_typeof(metadata) = 'object')
);

alter table public.hospital_clients
  add column if not exists parent_client_id uuid references public.hospital_parent_clients(id) on delete set null;

create index if not exists idx_hospital_clients_parent_client
  on public.hospital_clients(parent_client_id, is_active);

do $$
begin
  if exists (
    select 1 from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'set_updated_at'
  ) then
    drop trigger if exists trg_hospital_parent_clients_updated_at on public.hospital_parent_clients;
    create trigger trg_hospital_parent_clients_updated_at
    before update on public.hospital_parent_clients
    for each row execute function public.set_updated_at();
  else
    drop trigger if exists trg_hospital_parent_clients_updated_at on public.hospital_parent_clients;
    create trigger trg_hospital_parent_clients_updated_at
    before update on public.hospital_parent_clients
    for each row execute function public.set_hospital_ticket_updated_at();
  end if;
end $$;

alter table public.hospital_parent_clients enable row level security;
revoke all on public.hospital_parent_clients from anon;
revoke insert, update, delete on public.hospital_parent_clients from authenticated;
grant select on public.hospital_parent_clients to authenticated;
grant all on public.hospital_parent_clients to service_role;

drop policy if exists hospital_parent_clients_scoped_select on public.hospital_parent_clients;
create policy hospital_parent_clients_scoped_select on public.hospital_parent_clients
for select to authenticated
using (
  is_active
  and exists (
    select 1
    from public.hospital_clients hc
    where hc.parent_client_id = hospital_parent_clients.id
      and hc.is_active
      and public.hospital_can_access_scope(hc.id, null, null, 'view')
  )
);

create table if not exists public.hospital_feedback_submissions (
  id uuid primary key default gen_random_uuid(),
  qr_code_id uuid not null references public.hospital_feedback_qr_codes(id) on delete restrict,
  location_id uuid not null references public.hospital_locations(id) on delete restrict,
  parent_client_id uuid references public.hospital_parent_clients(id) on delete set null,
  hospital_id uuid not null references public.hospital_clients(id) on delete restrict,
  block_id uuid references public.hospital_blocks(id) on delete set null,
  floor_id uuid references public.hospital_floors(id) on delete set null,
  department_id uuid references public.hospital_departments(id) on delete set null,
  rating smallint not null,
  language text not null,
  comments text,
  answers jsonb not null default '{}'::jsonb,
  needs_attention boolean not null default false,
  submission_key uuid not null,
  submitted_at timestamptz not null default now(),
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  constraint hospital_feedback_submissions_rating_check check (rating between 1 and 5),
  constraint hospital_feedback_submissions_language_check check (language in ('en', 'ta')),
  constraint hospital_feedback_submissions_answers_object check (jsonb_typeof(answers) = 'object'),
  constraint hospital_feedback_submissions_metadata_object check (jsonb_typeof(metadata) = 'object')
);

create unique index if not exists ux_hospital_feedback_submissions_submission_key
  on public.hospital_feedback_submissions(submission_key);

create index if not exists idx_hospital_feedback_submissions_submitted_at
  on public.hospital_feedback_submissions(submitted_at desc);

create index if not exists idx_hospital_feedback_submissions_parent_client
  on public.hospital_feedback_submissions(parent_client_id, submitted_at desc);

create index if not exists idx_hospital_feedback_submissions_hospital
  on public.hospital_feedback_submissions(hospital_id, submitted_at desc);

create index if not exists idx_hospital_feedback_submissions_block
  on public.hospital_feedback_submissions(block_id, submitted_at desc);

create index if not exists idx_hospital_feedback_submissions_floor
  on public.hospital_feedback_submissions(floor_id, submitted_at desc);

create index if not exists idx_hospital_feedback_submissions_location
  on public.hospital_feedback_submissions(location_id, submitted_at desc);

create index if not exists idx_hospital_feedback_submissions_rating
  on public.hospital_feedback_submissions(rating, submitted_at desc);

create index if not exists idx_hospital_feedback_submissions_needs_attention
  on public.hospital_feedback_submissions(needs_attention, submitted_at desc);

alter table public.hospital_feedback_submissions enable row level security;
revoke all on public.hospital_feedback_submissions from anon, authenticated;
grant all on public.hospital_feedback_submissions to service_role;

insert into public.hospital_parent_clients (
  client_code,
  client_name,
  business_type,
  is_active,
  metadata
)
values (
  'DME',
  'DME',
  'Government Hospital',
  true,
  '{"demo_source":"DME","generated_for":"DME Government Hospital Demo"}'::jsonb
)
on conflict (client_code) do update
set client_name = excluded.client_name,
    business_type = excluded.business_type,
    is_active = true,
    metadata = public.hospital_parent_clients.metadata || excluded.metadata,
    updated_at = now();

insert into public.hospital_clients (
  client_code,
  client_name,
  business_type,
  parent_client_id,
  is_active,
  metadata
)
select
  'RGGH',
  'RGGH',
  'hospital',
  pc.id,
  true,
  '{"demo_source":"DME","hospital_code":"RGGH","generated_for":"DME Government Hospital Demo"}'::jsonb
from public.hospital_parent_clients pc
where pc.client_code = 'DME'
on conflict (client_code) do update
set client_name = excluded.client_name,
    business_type = excluded.business_type,
    parent_client_id = excluded.parent_client_id,
    is_active = true,
    metadata = public.hospital_clients.metadata || excluded.metadata,
    updated_at = now();

insert into public.hospital_blocks (
  client_id,
  block_code,
  block_name,
  sort_order,
  is_active,
  metadata
)
select
  hc.id,
  v.block_code,
  v.block_name,
  v.sort_order,
  true,
  '{"demo_source":"DME","hospital_code":"RGGH","generated_for":"DME Government Hospital Demo"}'::jsonb
from public.hospital_clients hc
cross join (
  values
    ('RGGH_BLOCK_1', 'Block 1', 1),
    ('RGGH_BLOCK_2', 'Block 2', 2),
    ('RGGH_BLOCK_3', 'Block 3', 3)
) as v(block_code, block_name, sort_order)
where hc.client_code = 'RGGH'
on conflict (client_id, block_code) do update
set block_name = excluded.block_name,
    sort_order = excluded.sort_order,
    is_active = true,
    metadata = public.hospital_blocks.metadata || excluded.metadata,
    updated_at = now();

insert into public.hospital_floors (
  client_id,
  block_id,
  floor_code,
  floor_name,
  floor_number,
  sort_order,
  is_known_service_floor,
  is_confirmed_building_floor,
  source,
  verification_status,
  is_active,
  metadata
)
select
  hc.id,
  hb.id,
  concat('RGGH_B', regexp_replace(hb.block_code, '^RGGH_BLOCK_', ''), '_F', lpad(f.floor_number::text, 2, '0')),
  format('Floor %s', f.floor_number),
  f.floor_number,
  f.floor_number,
  true,
  true,
  'DME_DEMO',
  'verified',
  true,
  '{"demo_source":"DME","hospital_code":"RGGH","generated_for":"DME Government Hospital Demo"}'::jsonb
from public.hospital_clients hc
join public.hospital_blocks hb on hb.client_id = hc.id
cross join generate_series(1, 10) as f(floor_number)
where hc.client_code = 'RGGH'
  and hb.block_code in ('RGGH_BLOCK_1', 'RGGH_BLOCK_2', 'RGGH_BLOCK_3')
on conflict (client_id, floor_code) do update
set block_id = excluded.block_id,
    floor_name = excluded.floor_name,
    floor_number = excluded.floor_number,
    sort_order = excluded.sort_order,
    is_known_service_floor = true,
    is_confirmed_building_floor = true,
    source = excluded.source,
    verification_status = excluded.verification_status,
    is_active = true,
    metadata = public.hospital_floors.metadata || excluded.metadata,
    updated_at = now();

insert into public.hospital_locations (
  client_id,
  block_id,
  floor_id,
  department_id,
  floor_name,
  department_name,
  location_name,
  location_code,
  location_type,
  source,
  verification_status,
  is_active,
  metadata
)
select
  hc.id,
  hb.id,
  hf.id,
  null,
  hf.floor_name,
  null,
  format('Toilet %s', t.toilet_number),
  concat(
    'RGGH_B',
    regexp_replace(hb.block_code, '^RGGH_BLOCK_', ''),
    '_F',
    lpad(hf.floor_number::text, 2, '0'),
    '_TOILET_',
    lpad(t.toilet_number::text, 2, '0')
  ),
  'Toilet',
  'DME_DEMO',
  'verified',
  true,
  '{"demo_source":"DME","hospital_code":"RGGH","generated_for":"DME Government Hospital Demo"}'::jsonb
from public.hospital_clients hc
join public.hospital_blocks hb on hb.client_id = hc.id
join public.hospital_floors hf on hf.client_id = hc.id and hf.block_id = hb.id
cross join generate_series(1, 6) as t(toilet_number)
where hc.client_code = 'RGGH'
  and hb.block_code in ('RGGH_BLOCK_1', 'RGGH_BLOCK_2', 'RGGH_BLOCK_3')
  and hf.floor_code like 'RGGH_B%_F%'
on conflict (client_id, location_code) do update
set block_id = excluded.block_id,
    floor_id = excluded.floor_id,
    department_id = excluded.department_id,
    floor_name = excluded.floor_name,
    department_name = excluded.department_name,
    location_name = excluded.location_name,
    location_type = excluded.location_type,
    source = excluded.source,
    verification_status = excluded.verification_status,
    is_active = true,
    metadata = public.hospital_locations.metadata || excluded.metadata,
    updated_at = now();

do $$
declare
  v_dme_parent_id uuid;
  v_rggh_hospital_id uuid;
  v_parent_count integer;
  v_hospital_count integer;
  v_block_count integer;
  v_floor_count integer;
  v_location_count integer;
  v_distinct_location_code_count integer;
  v_bad_count integer;
begin
  select count(*) into v_parent_count
  from public.hospital_parent_clients
  where client_code = 'DME' and is_active;
  if v_parent_count <> 1 then
    raise exception 'DME hierarchy validation failed: expected exactly one active DME parent client, found %', v_parent_count;
  end if;

  select id into v_dme_parent_id
  from public.hospital_parent_clients
  where client_code = 'DME' and is_active;

  select count(*) into v_hospital_count
  from public.hospital_clients hc
  where hc.client_code = 'RGGH'
    and hc.parent_client_id = v_dme_parent_id
    and hc.is_active;
  if v_hospital_count <> 1 then
    raise exception 'DME hierarchy validation failed: expected exactly one active RGGH hospital under DME, found %', v_hospital_count;
  end if;

  select id into v_rggh_hospital_id
  from public.hospital_clients
  where client_code = 'RGGH'
    and parent_client_id = v_dme_parent_id
    and is_active;

  select count(*) into v_block_count
  from public.hospital_blocks hb
  where hb.client_id = v_rggh_hospital_id
    and hb.block_code in ('RGGH_BLOCK_1', 'RGGH_BLOCK_2', 'RGGH_BLOCK_3')
    and hb.is_active;
  if v_block_count <> 3 then
    raise exception 'DME hierarchy validation failed: expected active RGGH blocks RGGH_BLOCK_1, RGGH_BLOCK_2 and RGGH_BLOCK_3, found %', v_block_count;
  end if;

  with expected_blocks as (
    select block_number, concat('RGGH_BLOCK_', block_number) as block_code
    from generate_series(1, 3) as b(block_number)
  ),
  expected_floors as (
    select
      eb.block_number,
      eb.block_code,
      floor_number,
      concat('RGGH_B', eb.block_number, '_F', lpad(floor_number::text, 2, '0')) as floor_code
    from expected_blocks eb
    cross join generate_series(1, 10) as f(floor_number)
  )
  select count(*) into v_floor_count
  from expected_floors ef
  join public.hospital_blocks hb
    on hb.client_id = v_rggh_hospital_id
   and hb.block_code = ef.block_code
   and hb.is_active
  join public.hospital_floors hf
    on hf.client_id = v_rggh_hospital_id
   and hf.block_id = hb.id
   and hf.floor_code = ef.floor_code
   and hf.floor_number = ef.floor_number
   and hf.is_active;
  if v_floor_count <> 30 then
    raise exception 'DME hierarchy validation failed: expected 30 active floors with correct block linkage, found %', v_floor_count;
  end if;

  with expected_blocks as (
    select block_number, concat('RGGH_BLOCK_', block_number) as block_code
    from generate_series(1, 3) as b(block_number)
  ),
  expected_floors as (
    select
      eb.block_number,
      eb.block_code,
      floor_number,
      concat('RGGH_B', eb.block_number, '_F', lpad(floor_number::text, 2, '0')) as floor_code
    from expected_blocks eb
    cross join generate_series(1, 10) as f(floor_number)
  ),
  expected_locations as (
    select
      ef.block_number,
      ef.block_code,
      ef.floor_number,
      ef.floor_code,
      toilet_number,
      concat(ef.floor_code, '_TOILET_', lpad(toilet_number::text, 2, '0')) as location_code
    from expected_floors ef
    cross join generate_series(1, 6) as t(toilet_number)
  )
  select count(*), count(distinct el.location_code)
  into v_location_count, v_distinct_location_code_count
  from expected_locations el
  join public.hospital_blocks hb
    on hb.client_id = v_rggh_hospital_id
   and hb.block_code = el.block_code
   and hb.is_active
  join public.hospital_floors hf
    on hf.client_id = v_rggh_hospital_id
   and hf.block_id = hb.id
   and hf.floor_code = el.floor_code
   and hf.floor_number = el.floor_number
   and hf.is_active
  join public.hospital_locations hl
    on hl.client_id = v_rggh_hospital_id
   and hl.block_id = hb.id
   and hl.floor_id = hf.id
   and hl.location_code = el.location_code
   and hl.location_type = 'Toilet'
   and hl.is_active;
  if v_location_count <> 180 or v_distinct_location_code_count <> 180 then
    raise exception 'DME hierarchy validation failed: expected 180 active distinct toilets with correct block/floor linkage, found rows %, distinct codes %',
      v_location_count, v_distinct_location_code_count;
  end if;

  with expected_blocks as (
    select block_number, concat('RGGH_BLOCK_', block_number) as block_code
    from generate_series(1, 3) as b(block_number)
  ),
  expected_floors as (
    select
      eb.block_number,
      eb.block_code,
      floor_number,
      concat('RGGH_B', eb.block_number, '_F', lpad(floor_number::text, 2, '0')) as floor_code
    from expected_blocks eb
    cross join generate_series(1, 10) as f(floor_number)
  ),
  expected_locations as (
    select
      ef.block_number,
      ef.block_code,
      ef.floor_number,
      ef.floor_code,
      toilet_number,
      concat(ef.floor_code, '_TOILET_', lpad(toilet_number::text, 2, '0')) as location_code
    from expected_floors ef
    cross join generate_series(1, 6) as t(toilet_number)
  )
  select count(*) into v_bad_count
  from expected_floors ef
  left join public.hospital_blocks hb
    on hb.client_id = v_rggh_hospital_id and hb.block_code = ef.block_code
  left join public.hospital_floors hf
    on hf.client_id = v_rggh_hospital_id and hf.floor_code = ef.floor_code
  where hf.id is null
     or hf.block_id is null
     or hf.block_id <> hb.id
     or hf.floor_number <> ef.floor_number;
  if v_bad_count <> 0 then
    raise exception 'DME hierarchy validation failed: expected floor codes are missing or linked to the wrong block. Bad rows %', v_bad_count;
  end if;

  with expected_blocks as (
    select block_number, concat('RGGH_BLOCK_', block_number) as block_code
    from generate_series(1, 3) as b(block_number)
  ),
  expected_floors as (
    select
      eb.block_number,
      eb.block_code,
      floor_number,
      concat('RGGH_B', eb.block_number, '_F', lpad(floor_number::text, 2, '0')) as floor_code
    from expected_blocks eb
    cross join generate_series(1, 10) as f(floor_number)
  ),
  expected_locations as (
    select
      ef.block_number,
      ef.block_code,
      ef.floor_number,
      ef.floor_code,
      toilet_number,
      concat(ef.floor_code, '_TOILET_', lpad(toilet_number::text, 2, '0')) as location_code
    from expected_floors ef
    cross join generate_series(1, 6) as t(toilet_number)
  )
  select count(*) into v_bad_count
  from expected_locations el
  left join public.hospital_blocks hb
    on hb.client_id = v_rggh_hospital_id and hb.block_code = el.block_code
  left join public.hospital_floors hf
    on hf.client_id = v_rggh_hospital_id and hf.floor_code = el.floor_code
  left join public.hospital_locations hl
    on hl.client_id = v_rggh_hospital_id and hl.location_code = el.location_code
  where hl.id is null
     or hl.block_id is null
     or hl.floor_id is null
     or hl.block_id <> hb.id
     or hl.floor_id <> hf.id
     or hf.block_id <> hb.id
     or hl.location_type <> 'Toilet';
  if v_bad_count <> 0 then
    raise exception 'DME hierarchy validation failed: expected toilet codes are missing or linked to the wrong block/floor. Bad rows %', v_bad_count;
  end if;

  with expected_blocks as (
    select block_number, concat('RGGH_BLOCK_', block_number) as block_code
    from generate_series(1, 3) as b(block_number)
  )
  select count(*) into v_bad_count
  from expected_blocks eb
  join public.hospital_blocks hb
    on hb.client_id = v_rggh_hospital_id
   and hb.block_code = eb.block_code
   and hb.is_active
  join public.hospital_floors hf
    on hf.client_id = v_rggh_hospital_id
   and hf.block_id = hb.id
   and hf.is_active
  group by hb.id
  having count(*) <> 10
  limit 1;
  if v_bad_count is not null then
    raise exception 'DME hierarchy validation failed: every RGGH block must have exactly 10 active floors';
  end if;

  with expected_blocks as (
    select block_number, concat('RGGH_BLOCK_', block_number) as block_code
    from generate_series(1, 3) as b(block_number)
  )
  select count(*) into v_bad_count
  from expected_blocks eb
  join public.hospital_blocks hb
    on hb.client_id = v_rggh_hospital_id
   and hb.block_code = eb.block_code
   and hb.is_active
  join public.hospital_locations hl
    on hl.client_id = v_rggh_hospital_id
   and hl.block_id = hb.id
   and hl.location_code like concat('RGGH_B', eb.block_number, '_F%_TOILET_%')
   and hl.is_active
  group by hb.id
  having count(*) <> 60
  limit 1;
  if v_bad_count is not null then
    raise exception 'DME hierarchy validation failed: every RGGH block must have exactly 60 active toilets';
  end if;

  select count(*) into v_bad_count
  from public.hospital_floors hf
  join public.hospital_locations hl
    on hl.client_id = v_rggh_hospital_id
   and hl.floor_id = hf.id
   and hl.is_active
  where hf.client_id = v_rggh_hospital_id
    and hf.floor_code like 'RGGH_B%_F%'
    and hf.is_active
  group by hf.id
  having count(*) <> 6
  limit 1;
  if v_bad_count is not null then
    raise exception 'DME hierarchy validation failed: every RGGH floor must have exactly 6 active toilets';
  end if;
end $$;

comment on table public.hospital_parent_clients is
  'Parent client master above hospital_clients for hospital feedback QR hierarchies such as DME -> RGGH.';
comment on column public.hospital_clients.parent_client_id is
  'Optional parent client for hospital feedback reporting. Null preserves legacy hospital_clients rows.';
comment on table public.hospital_feedback_submissions is
  'Anonymous public Hospital Feedback QR submissions persisted through backend-validated short-lived public sessions.';
comment on column public.hospital_feedback_submissions.needs_attention is
  'True for below-4 ratings requiring Soft Services dashboard attention.';
comment on column public.hospital_feedback_submissions.submission_key is
  'Client-generated UUID used for idempotent public feedback submission retries.';

-- Expected DME/RGGH demo counts after this migration:
--   hospital_parent_clients: 1 DME
--   hospital_clients: 1 RGGH under DME
--   hospital_blocks: 3
--   hospital_floors: 30
--   hospital_locations: 180 Toilet locations
