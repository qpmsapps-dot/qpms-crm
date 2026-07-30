# 037 Site Visit Foundation Rollback Guidance

## Before `COMMIT`

The migration runs in one transaction. Any preflight, DDL, policy, grant, or
function error must abort the transaction; issue `ROLLBACK` and investigate.
Do not bypass a failed preflight.

## After application

Do not rerun migrations `001` through `011`, drop modern lead/profile objects,
or delete Site Visit rows to undo this migration.

1. Take a database backup and run the postflight report.
2. Record row counts for every object introduced by migration `037`.
3. Disable Site Visit application traffic before changing functions or grants.
4. If any new table contains business data, preserve it and use a reviewed
   forward migration to correct the defect.
5. Only when every new table is proven empty may a separately reviewed rollback
   migration remove the `site-survey-images` policies/bucket metadata, RPCs,
   view, and foundation tables in reverse foreign-key order.

`public.leads`, `public.lead_contacts`, `public.profiles`, and
`public.activity_logs` are pre-existing modern objects and must never be
removed or rewritten by rollback work for migration `037`.
