-- NIMS hospital location master foundation.
-- Additive only: preserves hospital ticketing migrations 022/023 and existing flattened locations.

create extension if not exists "pgcrypto";

alter table public.hospital_blocks
  add column if not exists source text not null default 'legacy',
  add column if not exists source_reference text,
  add column if not exists verification_status text not null default 'draft',
  add column if not exists verified_by uuid references public.hospital_ticket_users(id),
  add column if not exists verified_at timestamptz;

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'hospital_blocks_verification_status_check'
  ) then
    alter table public.hospital_blocks
      add constraint hospital_blocks_verification_status_check
      check (verification_status in ('draft', 'verified', 'rejected', 'inactive'));
  end if;
end $$;

create table if not exists public.hospital_floors (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references public.hospital_clients(id) on delete cascade,
  block_id uuid not null,
  floor_code text not null,
  floor_name text not null,
  floor_number integer,
  sort_order integer not null default 0,
  is_known_service_floor boolean not null default true,
  is_confirmed_building_floor boolean not null default false,
  source text not null default 'manual',
  source_reference text,
  verification_status text not null default 'draft',
  verified_by uuid references public.hospital_ticket_users(id),
  verified_at timestamptz,
  is_active boolean not null default true,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, client_id),
  unique (client_id, floor_code),
  constraint hospital_floors_block_client_fk
    foreign key (block_id, client_id)
    references public.hospital_blocks(id, client_id)
    on delete cascade,
  constraint hospital_floors_verification_status_check
    check (verification_status in ('draft', 'verified', 'rejected', 'inactive'))
);

create table if not exists public.hospital_departments (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references public.hospital_clients(id) on delete cascade,
  block_id uuid not null,
  floor_id uuid,
  department_code text not null,
  department_name text not null,
  department_type text,
  source text not null default 'manual',
  source_reference text,
  verification_status text not null default 'draft',
  verified_by uuid references public.hospital_ticket_users(id),
  verified_at timestamptz,
  is_active boolean not null default true,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, client_id),
  unique (client_id, department_code),
  constraint hospital_departments_block_client_fk
    foreign key (block_id, client_id)
    references public.hospital_blocks(id, client_id)
    on delete cascade,
  constraint hospital_departments_floor_client_fk
    foreign key (floor_id)
    references public.hospital_floors(id)
    on delete set null,
  constraint hospital_departments_verification_status_check
    check (verification_status in ('draft', 'verified', 'rejected', 'inactive'))
);

create table if not exists public.hospital_location_aliases (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references public.hospital_clients(id) on delete cascade,
  entity_type text not null,
  entity_id uuid not null,
  alias_value text not null,
  normalised_alias text not null,
  source text not null default 'manual',
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  constraint hospital_location_aliases_entity_type_check
    check (entity_type in ('block', 'floor', 'department', 'location')),
  constraint hospital_location_aliases_normalised_required
    check (btrim(normalised_alias) <> '')
);

create table if not exists public.hospital_location_import_batches (
  id uuid primary key default gen_random_uuid(),
  client_id uuid references public.hospital_clients(id) on delete set null,
  source_filename text not null,
  source_sheet text,
  started_at timestamptz not null default now(),
  completed_at timestamptz,
  imported_by uuid references public.hospital_ticket_users(id),
  dry_run boolean not null default true,
  inserted_count integer not null default 0,
  updated_count integer not null default 0,
  skipped_count integer not null default 0,
  duplicate_count integer not null default 0,
  ambiguous_count integer not null default 0,
  rejected_count integer not null default 0,
  error_summary jsonb not null default '[]'::jsonb,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  constraint hospital_location_import_batches_counts_check check (
    inserted_count >= 0 and updated_count >= 0 and skipped_count >= 0
    and duplicate_count >= 0 and ambiguous_count >= 0 and rejected_count >= 0
  )
);

create table if not exists public.hospital_location_import_rows (
  id uuid primary key default gen_random_uuid(),
  import_batch_id uuid not null references public.hospital_location_import_batches(id) on delete cascade,
  source_sheet text not null,
  source_row integer not null,
  row_status text not null,
  target_entity_type text,
  target_entity_id uuid,
  message text,
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  constraint hospital_location_import_rows_status_check
    check (row_status in ('inserted', 'updated', 'skipped', 'duplicate', 'ambiguous', 'rejected')),
  constraint hospital_location_import_rows_entity_type_check
    check (target_entity_type is null or target_entity_type in ('client', 'block', 'floor', 'department', 'location', 'alias'))
);

alter table public.hospital_locations
  add column if not exists floor_id uuid,
  add column if not exists department_id uuid,
  add column if not exists room_number text,
  add column if not exists area_name text,
  add column if not exists ward_name text,
  add column if not exists location_type text,
  add column if not exists source text not null default 'legacy',
  add column if not exists source_reference text,
  add column if not exists verification_status text not null default 'draft',
  add column if not exists verified_by uuid references public.hospital_ticket_users(id),
  add column if not exists verified_at timestamptz;

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'hospital_locations_floor_client_fk'
  ) then
    alter table public.hospital_locations
      add constraint hospital_locations_floor_client_fk
      foreign key (floor_id)
      references public.hospital_floors(id)
      on delete set null;
  end if;
  if not exists (
    select 1 from pg_constraint where conname = 'hospital_locations_department_client_fk'
  ) then
    alter table public.hospital_locations
      add constraint hospital_locations_department_client_fk
      foreign key (department_id)
      references public.hospital_departments(id)
      on delete set null;
  end if;
  if not exists (
    select 1 from pg_constraint where conname = 'hospital_locations_verification_status_check'
  ) then
    alter table public.hospital_locations
      add constraint hospital_locations_verification_status_check
      check (verification_status in ('draft', 'verified', 'rejected', 'inactive'));
  end if;
end $$;

alter table public.hospital_tickets
  add column if not exists site_name_snapshot text,
  add column if not exists block_name_snapshot text,
  add column if not exists ward_name_snapshot text,
  add column if not exists room_area_snapshot text,
  add column if not exists exact_landmark_snapshot text,
  add column if not exists location_path_snapshot text,
  add column if not exists location_source_snapshot text,
  add column if not exists location_verification_status_snapshot text;

do $$
declare v_table text;
begin
  foreach v_table in array array[
    'hospital_floors',
    'hospital_departments'
  ] loop
    execute format('drop trigger if exists %I on public.%I', 'trg_' || v_table || '_updated_at', v_table);
    execute format(
      'create trigger %I before update on public.%I for each row execute function public.set_hospital_ticket_updated_at()',
      'trg_' || v_table || '_updated_at', v_table
    );
  end loop;
end $$;

create or replace function public.set_hospital_ticket_location_snapshots()
returns trigger language plpgsql security definer set search_path=public as $$
declare
  v_client public.hospital_clients%rowtype;
  v_block public.hospital_blocks%rowtype;
  v_location public.hospital_locations%rowtype;
  v_room_area text;
begin
  select * into v_client from public.hospital_clients where id = new.client_id;
  select * into v_block from public.hospital_blocks where id = new.block_id;
  select * into v_location from public.hospital_locations where id = new.location_id;

  v_room_area := nullif(btrim(concat_ws(' / ', v_location.ward_name, v_location.room_number, v_location.area_name)), '');

  new.site_name_snapshot := coalesce(new.site_name_snapshot, v_client.client_name);
  new.block_name_snapshot := coalesce(new.block_name_snapshot, v_block.block_name);
  new.ward_name_snapshot := coalesce(new.ward_name_snapshot, v_location.ward_name);
  new.room_area_snapshot := coalesce(new.room_area_snapshot, v_room_area);
  new.location_source_snapshot := coalesce(new.location_source_snapshot, v_location.source);
  new.location_verification_status_snapshot := coalesce(
    new.location_verification_status_snapshot,
    v_location.verification_status
  );
  new.location_path_snapshot := coalesce(
    new.location_path_snapshot,
    nullif(btrim(concat_ws(
      ' > ',
      v_client.client_name,
      v_block.block_name,
      new.floor_name,
      new.department_name,
      v_room_area,
      new.location_text,
      new.exact_landmark_snapshot
    )), '')
  );
  return new;
end $$;

drop trigger if exists trg_hospital_ticket_location_snapshots on public.hospital_tickets;
create trigger trg_hospital_ticket_location_snapshots
before insert on public.hospital_tickets
for each row execute function public.set_hospital_ticket_location_snapshots();

create unique index if not exists ux_hospital_floors_client_block_code
  on public.hospital_floors(client_id, block_id, floor_code);
create unique index if not exists ux_hospital_floors_client_block_name_active
  on public.hospital_floors(client_id, block_id, lower(floor_name))
  where is_active;
create index if not exists idx_hospital_floors_lookup
  on public.hospital_floors(client_id, block_id, is_active, verification_status, sort_order);

create unique index if not exists ux_hospital_departments_client_block_floor_code
  on public.hospital_departments(
    client_id,
    block_id,
    coalesce(floor_id, '00000000-0000-0000-0000-000000000000'::uuid),
    department_code
  );
create unique index if not exists ux_hospital_departments_client_block_floor_name_active
  on public.hospital_departments(
    client_id,
    block_id,
    coalesce(floor_id, '00000000-0000-0000-0000-000000000000'::uuid),
    lower(department_name)
  )
  where is_active;
create index if not exists idx_hospital_departments_lookup
  on public.hospital_departments(client_id, block_id, floor_id, is_active, verification_status);

create unique index if not exists ux_hospital_location_aliases_active
  on public.hospital_location_aliases(client_id, entity_type, normalised_alias)
  where is_active;
create index if not exists idx_hospital_location_aliases_entity
  on public.hospital_location_aliases(entity_type, entity_id, is_active);

create index if not exists idx_hospital_locations_hierarchy
  on public.hospital_locations(client_id, block_id, floor_id, department_id, is_active, verification_status);

create index if not exists idx_hospital_blocks_verification
  on public.hospital_blocks(client_id, is_active, verification_status);
create index if not exists idx_hospital_locations_source_reference
  on public.hospital_locations(client_id, source, source_reference);

create index if not exists idx_hospital_import_batches_source
  on public.hospital_location_import_batches(source_filename, source_sheet, dry_run, started_at desc);
create index if not exists idx_hospital_import_rows_batch_status
  on public.hospital_location_import_rows(import_batch_id, row_status, source_sheet, source_row);

do $$ declare v_table text; begin
  foreach v_table in array array[
    'hospital_floors',
    'hospital_departments',
    'hospital_location_aliases',
    'hospital_location_import_batches',
    'hospital_location_import_rows'
  ] loop
    execute format('alter table public.%I enable row level security', v_table);
    execute format('revoke all on public.%I from anon', v_table);
    execute format('revoke insert,update,delete on public.%I from authenticated', v_table);
    execute format('grant all on public.%I to service_role', v_table);
  end loop;
end $$;

grant select on public.hospital_floors to authenticated;
grant select on public.hospital_departments to authenticated;
grant select on public.hospital_location_aliases to authenticated;

drop policy if exists hospital_floors_scoped_select on public.hospital_floors;
create policy hospital_floors_scoped_select on public.hospital_floors
for select to authenticated
using (
  is_active
  and public.hospital_can_access_scope(client_id, block_id, null, 'view')
);

drop policy if exists hospital_departments_scoped_select on public.hospital_departments;
create policy hospital_departments_scoped_select on public.hospital_departments
for select to authenticated
using (
  is_active
  and public.hospital_can_access_scope(client_id, block_id, null, 'view')
);

drop policy if exists hospital_location_aliases_scoped_select on public.hospital_location_aliases;
create policy hospital_location_aliases_scoped_select on public.hospital_location_aliases
for select to authenticated
using (
  is_active
  and (
    (entity_type = 'block' and exists (
      select 1 from public.hospital_blocks b
      where b.id = entity_id and public.hospital_can_access_scope(b.client_id, b.id, null, 'view')
    ))
    or (entity_type = 'floor' and exists (
      select 1 from public.hospital_floors f
      where f.id = entity_id and public.hospital_can_access_scope(f.client_id, f.block_id, null, 'view')
    ))
    or (entity_type = 'department' and exists (
      select 1 from public.hospital_departments d
      where d.id = entity_id and public.hospital_can_access_scope(d.client_id, d.block_id, null, 'view')
    ))
    or (entity_type = 'location' and exists (
      select 1 from public.hospital_locations l
      where l.id = entity_id and public.hospital_can_access_scope(l.client_id, l.block_id, l.id, 'view')
    ))
  )
);

revoke all on function public.set_hospital_ticket_location_snapshots() from public, anon, authenticated;
grant execute on function public.set_hospital_ticket_location_snapshots() to service_role;

comment on table public.hospital_floors is 'NIMS-ready floor master. Known service floors are separate from confirmed total building floors.';
comment on table public.hospital_departments is 'NIMS-ready department/unit master. Departments may remain draft and floor-unconfirmed.';
comment on table public.hospital_location_aliases is 'Aliases for hospital blocks, floors, departments and locations without automatic ambiguous merging.';
comment on table public.hospital_location_import_batches is 'Audit summary for NIMS location import dry-runs and controlled service-role applies.';
comment on table public.hospital_location_import_rows is 'Row-level import audit and validation results for NIMS location imports.';
