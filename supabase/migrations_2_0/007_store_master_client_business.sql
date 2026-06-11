-- Mobile_FO_V2 schema migration 2.0
-- 007: Store master client and business classification support.

alter table public.store_master
  add column if not exists client_name text,
  add column if not exists business text;

comment on column public.store_master.client_name is
  'Client/company name linked to this site/store for CRM filtering and reporting.';

comment on column public.store_master.business is
  'Business vertical classification of this site/store for CRM filtering and reporting.';

comment on column public.store_master.state is
  'Auto-filled from creator FO/user profile state during mobile site creation.';
