-- Hospital Feedback QR Phase 1 demo hierarchy.
-- Development-only helper. Review against your environment before running.
-- This does not create QR records; use the authenticated QR Generator after
-- the location exists.

create extension if not exists "pgcrypto";

insert into public.hospital_clients (client_code, client_name, business_type, metadata)
values (
  'CMCH_FEEDBACK_DEMO',
  'Chengalpattu Medical College Hospital',
  'hospital',
  '{"source":"hospital_feedback_qr_phase1_demo"}'::jsonb
)
on conflict (client_code) do update
set client_name = excluded.client_name,
    is_active = true,
    updated_at = now();

insert into public.hospital_blocks (client_id, block_code, block_name, sort_order, verification_status, metadata)
select id, 'BLOCK_B', 'Block B', 2, 'verified', '{"source":"hospital_feedback_qr_phase1_demo"}'::jsonb
from public.hospital_clients
where client_code = 'CMCH_FEEDBACK_DEMO'
on conflict (client_id, block_code) do update
set block_name = excluded.block_name,
    is_active = true,
    updated_at = now();

insert into public.hospital_floors (client_id, block_id, floor_code, floor_name, floor_number, sort_order, verification_status, is_active, metadata)
select c.id, b.id, 'BLOCK_B_SECOND_FLOOR', 'Second Floor', 2, 2, 'verified', true, '{"source":"hospital_feedback_qr_phase1_demo"}'::jsonb
from public.hospital_clients c
join public.hospital_blocks b on b.client_id = c.id and b.block_code = 'BLOCK_B'
where c.client_code = 'CMCH_FEEDBACK_DEMO'
on conflict (client_id, block_id, floor_code) do update
set floor_name = excluded.floor_name,
    is_active = true,
    updated_at = now();

insert into public.hospital_departments (client_id, block_id, floor_id, department_code, department_name, department_type, verification_status, is_active, metadata)
select c.id, b.id, f.id, 'BLOCK_B_PUBLIC_AREA', 'Public Area', 'public', 'verified', true, '{"source":"hospital_feedback_qr_phase1_demo"}'::jsonb
from public.hospital_clients c
join public.hospital_blocks b on b.client_id = c.id and b.block_code = 'BLOCK_B'
join public.hospital_floors f on f.client_id = c.id and f.block_id = b.id and f.floor_code = 'BLOCK_B_SECOND_FLOOR'
where c.client_code = 'CMCH_FEEDBACK_DEMO'
on conflict do nothing;

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
  verification_status,
  is_active,
  metadata
)
select
  c.id,
  b.id,
  f.id,
  d.id,
  f.floor_name,
  d.department_name,
  'Public Bathroom - B2',
  'BLOCK_B_SECOND_FLOOR_PUBLIC_BATHROOM_B2',
  'Washroom',
  'verified',
  true,
  '{"source":"hospital_feedback_qr_phase1_demo"}'::jsonb
from public.hospital_clients c
join public.hospital_blocks b on b.client_id = c.id and b.block_code = 'BLOCK_B'
join public.hospital_floors f on f.client_id = c.id and f.block_id = b.id and f.floor_code = 'BLOCK_B_SECOND_FLOOR'
join public.hospital_departments d on d.client_id = c.id and d.block_id = b.id and d.floor_id = f.id and d.department_code = 'BLOCK_B_PUBLIC_AREA'
where c.client_code = 'CMCH_FEEDBACK_DEMO'
on conflict (client_id, location_code) do update
set block_id = excluded.block_id,
    floor_id = excluded.floor_id,
    department_id = excluded.department_id,
    floor_name = excluded.floor_name,
    department_name = excluded.department_name,
    location_name = excluded.location_name,
    location_type = excluded.location_type,
    is_active = true,
    updated_at = now();
