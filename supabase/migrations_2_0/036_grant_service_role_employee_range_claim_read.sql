-- The employee-range report reads approved/submitted travel and parking claims
-- through the backend service role. No browser role receives additional access.

grant select
on table public.fo_travel_expense_claims
to service_role;
