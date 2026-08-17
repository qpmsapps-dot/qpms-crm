-- Support Firebase push delivery for registered-mobile hospital client contacts
-- without creating fake hospital_ticket_users rows.

alter table public.hospital_ticket_push_devices
  alter column auth_user_id drop not null,
  alter column hospital_ticket_user_id drop not null;

alter table public.hospital_ticket_push_devices
  add column if not exists hospital_client_contact_id uuid references public.hospital_client_contacts(id) on delete cascade;

create unique index if not exists ux_hospital_ticket_push_contact_scope_device
  on public.hospital_ticket_push_devices(hospital_client_contact_id, app_scope, device_id);

create index if not exists idx_hospital_ticket_push_devices_contact
  on public.hospital_ticket_push_devices(hospital_client_contact_id, app_scope, enabled, last_seen_at desc)
  where hospital_client_contact_id is not null;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'hospital_ticket_push_devices_owner_check') then
    alter table public.hospital_ticket_push_devices
      add constraint hospital_ticket_push_devices_owner_check
      check (
        (hospital_ticket_user_id is not null and hospital_client_contact_id is null)
        or
        (hospital_ticket_user_id is null and hospital_client_contact_id is not null)
      );
  end if;
end $$;

alter table public.hospital_ticket_notifications
  alter column recipient_user_id drop not null;

alter table public.hospital_ticket_notifications
  add column if not exists recipient_client_contact_id uuid references public.hospital_client_contacts(id) on delete cascade;

create index if not exists idx_hospital_ticket_notifications_contact
  on public.hospital_ticket_notifications(recipient_client_contact_id, read_at, created_at desc)
  where recipient_client_contact_id is not null;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'hospital_ticket_notifications_recipient_check') then
    alter table public.hospital_ticket_notifications
      add constraint hospital_ticket_notifications_recipient_check
      check (
        (recipient_user_id is not null and recipient_client_contact_id is null)
        or
        (recipient_user_id is null and recipient_client_contact_id is not null)
      );
  end if;
end $$;
