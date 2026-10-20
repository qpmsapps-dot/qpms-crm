-- 215: Additive Reliance Retail Store Master expansion for KA, KL, AP-1 and AP-2.
-- No Store Master rows, Zones or FO assignments are seeded by this migration.

begin;

alter table public.reliance_retail_store_master
  drop constraint if exists reliance_retail_store_state_check;
alter table public.reliance_retail_store_master
  add constraint reliance_retail_store_state_check check (
    upper(btrim(state)) in ('TN', 'PY', 'KA', 'KL', 'AP-1', 'AP-2')
  );

alter table public.reliance_retail_store_master
  alter column assigned_fo_profile_id drop not null,
  alter column assigned_fo_employee_code drop not null,
  alter column assigned_fo_name_snapshot drop not null;

alter table public.reliance_retail_store_master
  drop constraint if exists reliance_retail_store_fo_assignment_consistency_check;
alter table public.reliance_retail_store_master
  add constraint reliance_retail_store_fo_assignment_consistency_check check (
    (
      assigned_fo_profile_id is not null
      and nullif(btrim(assigned_fo_employee_code), '') is not null
      and nullif(btrim(assigned_fo_name_snapshot), '') is not null
    )
    or (
      assigned_fo_profile_id is null
      and assigned_fo_employee_code is null
      and assigned_fo_name_snapshot is null
      and assigned_fo_phone_snapshot is null
      and zone_id is null
      and upper(coalesce(metadata ->> 'operational_model', '')) = 'SUPERVISOR_ONLY'
    )
  );

create or replace function public.reliance_retail_coordinates_valid_for_region(
  p_state text,
  p_latitude numeric,
  p_longitude numeric
)
returns boolean
language sql
immutable
strict
set search_path = public, pg_temp
as $$
  select case upper(btrim(p_state))
    when 'TN' then p_latitude between 8 and 14 and p_longitude between 76 and 81
    when 'PY' then p_latitude between 8 and 14 and p_longitude between 76 and 81
    when 'KA' then p_latitude between 11 and 19 and p_longitude between 74 and 79
    when 'KL' then p_latitude between 8 and 13 and p_longitude between 74 and 78
    when 'AP-1' then p_latitude between 12 and 20 and p_longitude between 76 and 85
    when 'AP-2' then p_latitude between 12 and 20 and p_longitude between 76 and 85
    else false
  end;
$$;
revoke all on function public.reliance_retail_coordinates_valid_for_region(text,numeric,numeric)
  from public, anon, authenticated;
grant execute on function public.reliance_retail_coordinates_valid_for_region(text,numeric,numeric)
  to service_role;

alter table public.reliance_retail_store_master
  drop constraint if exists reliance_retail_store_coordinate_range_check;
alter table public.reliance_retail_store_master
  add constraint reliance_retail_store_coordinate_range_check check (
    latitude is null
    or public.reliance_retail_coordinates_valid_for_region(state, latitude, longitude)
  );

-- The immutable audit table has no state column, so retain a bounded south-India
-- envelope there. The store row and registration RPC apply the tighter region bound.
alter table public.reliance_retail_store_location_audit
  drop constraint if exists reliance_retail_location_latitude_check,
  drop constraint if exists reliance_retail_location_longitude_check;
alter table public.reliance_retail_store_location_audit
  add constraint reliance_retail_location_latitude_check check (latitude between 8 and 20),
  add constraint reliance_retail_location_longitude_check check (longitude between 74 and 85);

-- Additive regional import contract. It always inserts pending coordinates and
-- never updates an existing Store Code, including stores with FO-verified GPS.
create or replace function public.rpc_import_reliance_retail_regional_store(
  p_store_code text,
  p_store_name text,
  p_region text,
  p_city text,
  p_store_format text,
  p_store_status text,
  p_source_name text,
  p_fo_profile_id uuid default null,
  p_zone_id uuid default null,
  p_supervisor_name text default null,
  p_supervisor_employee_code text default null,
  p_supervisor_phone text default null,
  p_supervisor_email text default null,
  p_metadata jsonb default '{}'::jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_region text := upper(btrim(coalesce(p_region, '')));
  v_status text;
  v_profile public.profiles%rowtype;
  v_zone public.reliance_retail_zones%rowtype;
  v_existing public.reliance_retail_store_master%rowtype;
  v_store public.reliance_retail_store_master%rowtype;
  v_supervisor jsonb;
  v_operational_model text;
  v_status_source text;
begin
  if nullif(btrim(p_store_code), '') is null
     or nullif(btrim(p_store_name), '') is null
     or nullif(btrim(p_source_name), '') is null then
    raise exception 'reliance_regional_store_required_field_missing' using errcode = '22023';
  end if;
  if v_region not in ('KA', 'KL', 'AP-1', 'AP-2') then
    raise exception 'reliance_regional_store_region_invalid' using errcode = '22023';
  end if;
  if nullif(btrim(coalesce(p_store_status, '')), '') is null
     and v_region in ('KA', 'AP-1', 'AP-2') then
    v_status := 'Active';
    v_status_source := 'CONFIRMED_ACTIVE_20261015';
  elsif upper(btrim(coalesce(p_store_status, ''))) = 'ACTIVE' then
    v_status := 'Active';
    v_status_source := 'SOURCE_EXPLICIT';
  elsif upper(btrim(coalesce(p_store_status, ''))) = 'INACTIVE' then
    v_status := 'Inactive';
    v_status_source := 'SOURCE_EXPLICIT';
  else
    raise exception 'reliance_regional_store_status_required' using errcode = '22023';
  end if;

  v_supervisor := jsonb_strip_nulls(jsonb_build_object(
    'name', nullif(btrim(coalesce(p_supervisor_name, '')), ''),
    'employee_code', nullif(upper(btrim(coalesce(p_supervisor_employee_code, ''))), ''),
    'phone', nullif(regexp_replace(coalesce(p_supervisor_phone, ''), '\D', '', 'g'), ''),
    'email', nullif(lower(btrim(coalesce(p_supervisor_email, ''))), '')
  ));

  if p_fo_profile_id is null then
    if p_zone_id is not null then
      raise exception 'reliance_supervisor_only_zone_forbidden' using errcode = '22023';
    end if;
    if nullif(btrim(coalesce(p_supervisor_name, '')), '') is null then
      raise exception 'reliance_supervisor_only_details_required' using errcode = '22023';
    end if;
    v_operational_model := 'SUPERVISOR_ONLY';
  else
    if p_zone_id is null then
      raise exception 'reliance_regional_store_zone_required' using errcode = '22023';
    end if;
    select * into v_profile from public.profiles where id = p_fo_profile_id for share;
    if not found
       or v_profile.is_active is not true
       or upper(coalesce(v_profile.status, '')) in ('INACTIVE', 'DISABLED')
       or regexp_replace(upper(coalesce(v_profile.business, '')), '[^A-Z0-9]+', '', 'g') not in ('RELIANCE', 'RELIANCERETAIL')
       or regexp_replace(upper(coalesce(v_profile.role, '')), '[^A-Z0-9]+', '', 'g') not in ('FO', 'FIELDOFFICER') then
      raise exception 'reliance_regional_store_fo_invalid' using errcode = '42501';
    end if;
    select * into v_zone from public.reliance_retail_zones where id = p_zone_id for share;
    if not found or v_zone.status <> 'Active' or upper(btrim(coalesce(v_zone.state, ''))) <> v_region then
      raise exception 'reliance_regional_store_zone_invalid' using errcode = '22023';
    end if;
    if not exists (
      select 1 from public.reliance_retail_zone_fo_assignments a
      where a.zone_id = p_zone_id
        and a.fo_profile_id = p_fo_profile_id
        and a.status = 'Active'
        and a.effective_to is null
    ) then
      raise exception 'reliance_regional_store_zone_fo_mismatch' using errcode = '22023';
    end if;
    v_operational_model := 'FO_ZONE_ASSIGNED';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(upper(btrim(p_store_code)), 215));
  select * into v_existing
  from public.reliance_retail_store_master
  where upper(btrim(store_code)) = upper(btrim(p_store_code))
  for update;
  if found then
    raise exception 'reliance_regional_store_code_exists' using errcode = '23505';
  end if;

  insert into public.reliance_retail_store_master (
    store_code, store_name, state, city, store_format, status,
    latitude, longitude, gps_accuracy, location_status,
    zone_id, assigned_fo_profile_id, assigned_fo_employee_code,
    assigned_fo_name_snapshot, assigned_fo_phone_snapshot,
    source_name, metadata
  ) values (
    upper(btrim(p_store_code)), btrim(p_store_name), v_region,
    nullif(btrim(coalesce(p_city, '')), ''),
    nullif(btrim(coalesce(p_store_format, '')), ''), v_status,
    null, null, null, 'LOCATION_PENDING',
    p_zone_id, v_profile.id,
    case when p_fo_profile_id is null then null else coalesce(nullif(btrim(v_profile.employee_code), ''), btrim(v_profile.username)) end,
    case when p_fo_profile_id is null then null else coalesce(nullif(btrim(v_profile.full_name), ''), nullif(btrim(v_profile.display_name), ''), btrim(v_profile.employee_code)) end,
    case when p_fo_profile_id is null then null else nullif(regexp_replace(coalesce(v_profile.mobile, ''), '\D', '', 'g'), '') end,
    btrim(p_source_name),
    coalesce(p_metadata, '{}'::jsonb) || jsonb_build_object(
      'import_region', v_region,
      'operational_model', v_operational_model,
      'supervisor', v_supervisor,
      'status_source', v_status_source,
      'coordinate_source', null,
      'import_contract', 'REGIONAL_STORE_MASTER_215'
    )
  ) returning * into v_store;

  return jsonb_build_object(
    'retail_store_id', v_store.id,
    'store_code', v_store.store_code,
    'region', v_store.state,
    'status', v_store.status,
    'location_status', v_store.location_status,
    'operational_model', v_operational_model
  );
end;
$$;
revoke all on function public.rpc_import_reliance_retail_regional_store(
  text,text,text,text,text,text,text,uuid,uuid,text,text,text,text,jsonb
) from public, anon, authenticated;
grant execute on function public.rpc_import_reliance_retail_regional_store(
  text,text,text,text,text,text,text,uuid,uuid,text,text,text,text,jsonb
) to service_role;

-- Preserve the one-time registration and evidence controls while applying the
-- coordinate envelope that corresponds to the selected Retail store's region.
create or replace function public.rpc_register_reliance_retail_store_location(
  p_retail_store_id uuid, p_actor_profile_id uuid, p_latitude numeric, p_longitude numeric,
  p_accuracy numeric, p_device_captured_at timestamptz, p_request_id uuid
)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_store public.reliance_retail_store_master%rowtype;
  v_profile public.profiles%rowtype;
  v_existing public.reliance_retail_store_location_audit%rowtype;
begin
  if p_retail_store_id is null or p_actor_profile_id is null or p_request_id is null then
    raise exception 'reliance_store_location_identity_required' using errcode = '22023';
  end if;
  if p_accuracy is null or p_accuracy <= 0 or p_accuracy > 50 then
    raise exception 'reliance_store_location_accuracy_too_poor' using errcode = '22023';
  end if;
  if p_device_captured_at is null
     or p_device_captured_at < clock_timestamp() - interval '2 minutes'
     or p_device_captured_at > clock_timestamp() + interval '30 seconds' then
    raise exception 'reliance_store_location_stale_fix' using errcode = '22023';
  end if;

  select * into v_existing
  from public.reliance_retail_store_location_audit
  where request_id = p_request_id;
  if found then
    if v_existing.retail_store_id = p_retail_store_id
       and v_existing.captured_by_profile_id = p_actor_profile_id
       and v_existing.latitude = round(p_latitude, 7)
       and v_existing.longitude = round(p_longitude, 7)
       and v_existing.gps_accuracy = round(p_accuracy, 2) then
      return jsonb_build_object('retail_store_id', p_retail_store_id, 'location_status', 'GPS_READY', 'idempotent', true);
    end if;
    raise exception 'reliance_store_location_request_conflict' using errcode = '23505';
  end if;

  select * into v_profile from public.profiles where id = p_actor_profile_id for share;
  if not found or v_profile.is_active is not true
     or regexp_replace(upper(coalesce(v_profile.business, '')), '[^A-Z0-9]+', '', 'g') not in ('RELIANCE', 'RELIANCERETAIL')
     or regexp_replace(upper(coalesce(v_profile.role, '')), '[^A-Z0-9]+', '', 'g') not in ('FO', 'FIELDOFFICER') then
    raise exception 'reliance_store_location_actor_forbidden' using errcode = '42501';
  end if;

  select * into v_store
  from public.reliance_retail_store_master
  where id = p_retail_store_id
  for update;
  if not found or v_store.status <> 'Active' then
    raise exception 'reliance_store_location_store_forbidden' using errcode = '42501';
  end if;
  if not public.reliance_retail_coordinates_valid_for_region(v_store.state, p_latitude, p_longitude) then
    raise exception 'reliance_store_location_invalid_coordinates' using errcode = '22023';
  end if;
  if v_store.location_status <> 'LOCATION_PENDING'
     or v_store.latitude is not null
     or v_store.longitude is not null then
    raise exception 'reliance_store_location_already_registered' using errcode = '23505';
  end if;

  insert into public.reliance_retail_store_location_audit (
    request_id, retail_store_id, captured_by_profile_id, captured_by_employee_code,
    latitude, longitude, gps_accuracy, device_captured_at, metadata
  ) values (
    p_request_id, p_retail_store_id, p_actor_profile_id,
    coalesce(nullif(btrim(v_profile.employee_code), ''), btrim(v_profile.username)),
    round(p_latitude, 7), round(p_longitude, 7), round(p_accuracy, 2), p_device_captured_at,
    jsonb_build_object('source', 'FO_MOBILE_ELIGIBLE_RETAIL_CAPTURE', 'store_region', v_store.state)
  );
  update public.reliance_retail_store_master
  set latitude = round(p_latitude, 7),
      longitude = round(p_longitude, 7),
      gps_accuracy = round(p_accuracy, 2),
      location_status = 'GPS_READY',
      metadata = metadata || jsonb_build_object(
        'location_registered_at', clock_timestamp(),
        'location_registration_request_id', p_request_id
      )
  where id = p_retail_store_id;

  return jsonb_build_object(
    'retail_store_id', p_retail_store_id,
    'location_status', 'GPS_READY',
    'latitude', round(p_latitude, 7),
    'longitude', round(p_longitude, 7),
    'gps_accuracy', round(p_accuracy, 2),
    'captured_at', p_device_captured_at,
    'idempotent', false
  );
end;
$$;
revoke all on function public.rpc_register_reliance_retail_store_location(
  uuid,uuid,numeric,numeric,numeric,timestamptz,uuid
) from public, anon, authenticated;
grant execute on function public.rpc_register_reliance_retail_store_location(
  uuid,uuid,numeric,numeric,numeric,timestamptz,uuid
) to service_role;

comment on function public.rpc_import_reliance_retail_regional_store(
  text,text,text,text,text,text,text,uuid,uuid,text,text,text,text,jsonb
) is 'Guarded KA/KL/AP-1/AP-2 Retail Store Master import contract. No source records are seeded by Migration 215.';

commit;
