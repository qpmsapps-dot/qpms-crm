-- 038: Allow the trusted final-leg reconciliation command to persist its
-- targeted row and attendance delta. No anon/authenticated table access is
-- changed. Both tables are protected by existing RLS for client roles.

grant select, insert, update on table public.fo_travel_legs to service_role;
grant update on table public.fo_attendance to service_role;

-- fo_travel_legs.id is UUID-backed, so no serial privilege is required.
