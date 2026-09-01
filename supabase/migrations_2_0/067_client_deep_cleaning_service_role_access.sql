-- 067: Restore trusted backend access for independent client Deep Cleaning.
-- 066 intentionally removed direct anon/authenticated table access.
-- The backend API uses the Supabase service_role client after validating
-- the caller's JWT, FO role, Reliance Retail business, ownership, and state.

grant select, insert, update, delete
on table public.client_deep_cleaning_submissions
to service_role;

grant select, insert, update, delete
on table public.client_deep_cleaning_uploads
to service_role;
