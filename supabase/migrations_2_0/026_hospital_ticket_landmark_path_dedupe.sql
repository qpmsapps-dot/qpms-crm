-- Phase 2A.1 corrective migration:
-- avoid duplicate landmark/location text in immutable ticket location paths.

create or replace function public.set_hospital_ticket_location_snapshots()
returns trigger language plpgsql security definer set search_path=public as $$
declare
  v_client public.hospital_clients%rowtype;
  v_block public.hospital_blocks%rowtype;
  v_location public.hospital_locations%rowtype;
  v_room_area text;
  v_location_text text;
  v_path text;
begin
  select * into v_client from public.hospital_clients where id = new.client_id;
  select * into v_block from public.hospital_blocks where id = new.block_id;

  if new.location_id is not null then
    select * into v_location from public.hospital_locations where id = new.location_id;
    v_room_area := nullif(btrim(concat_ws(' / ', v_location.ward_name, v_location.room_number, v_location.area_name)), '');

    new.ward_name_snapshot := coalesce(new.ward_name_snapshot, v_location.ward_name);
    new.room_area_snapshot := coalesce(new.room_area_snapshot, v_room_area);
    new.location_source_snapshot := coalesce(new.location_source_snapshot, v_location.source);
    new.location_verification_status_snapshot := coalesce(
      new.location_verification_status_snapshot,
      v_location.verification_status
    );
  end if;

  new.site_name_snapshot := coalesce(new.site_name_snapshot, v_client.client_name);
  new.block_name_snapshot := coalesce(new.block_name_snapshot, v_block.block_name);
  new.exact_landmark_snapshot := nullif(btrim(coalesce(new.exact_landmark_snapshot, '')), '');

  v_location_text := nullif(btrim(coalesce(new.location_text, '')), '');
  if v_location_text is not null and (
    v_location_text is not distinct from nullif(btrim(coalesce(new.room_area_snapshot, '')), '')
    or v_location_text is not distinct from new.exact_landmark_snapshot
  ) then
    v_location_text := null;
  end if;

  v_path := nullif(btrim(concat_ws(
    ' > ',
    new.site_name_snapshot,
    new.block_name_snapshot,
    case
      when lower(nullif(btrim(coalesce(new.floor_name, '')), '')) in ('not specified', 'floor not confirmed') then null
      else nullif(btrim(coalesce(new.floor_name, '')), '')
    end,
    nullif(btrim(coalesce(new.department_name, '')), ''),
    nullif(btrim(coalesce(new.ward_name_snapshot, '')), ''),
    nullif(btrim(coalesce(new.room_area_snapshot, '')), ''),
    v_location_text,
    new.exact_landmark_snapshot
  )), '');

  new.location_path_snapshot := coalesce(new.location_path_snapshot, v_path);
  return new;
end $$;

revoke all on function public.set_hospital_ticket_location_snapshots() from public, anon, authenticated;
grant execute on function public.set_hospital_ticket_location_snapshots() to service_role;

