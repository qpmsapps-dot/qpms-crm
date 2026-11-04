# October 2026 KM Admin Approval — GitHub + Production DB Audit
Date: 2026-11-04
Scope: PR #78, Operations Command Center, production Supabase.

## Confirmed production database
- public.fo_missing_km_reviews: 73 October attendance-linked reviews; 63 clarification_required, 10 pending, **0 approved**.
- Two approved reviews (36.00 KM) exist across the full table but belong to August and September, **not October**.
- public.fo_missing_km_admin_decisions exists, RLS enabled, 0 decisions. Service role permissions reduced to SELECT + INSERT; no direct authenticated/anon privileges.
- public.fo_oct2026_claim_adjustments exists and remains a separate provisional reporting mechanism.
- public.fo_october_km_recoveries, public.fo_october_km_recovery_events, rpc_submit_fo_october_recovery_v1 and rpc_decide_fo_october_recovery_v1 exist.
- No payable KM or petrol records were updated during this work.

## GitHub changes in PR #78
- backend/routes/foMissingKmAdminReviewRoutes.js: authenticated Admin-only review list and insert-only decisions.
- backend/server.js: route mounted at /api/fo/km.
- src/pages/FOActivities.jsx: Admin Missing KM Approvals panel within October KM evidence review.
- backend/sql/20261104_october_missing_km_admin_decisions.sql: idempotent table setup and privilege migration.
- backend/routes/foOctoberClaimsExportRoutes.js: provisional October PDF export (not yet linked to approval decisions).

## Important unresolved items / release blockers
1. Dashboard October KM evidence review flags 906 attendances; fo_missing_km_reviews covers only 73 October cases. These are different datasets. Never label 906 as approved or assume 5,564.19 KM is payable.
2. Admin decisions are **for reconciliation** only. They are not posted to canonical payable KM, do not change petrol, and are not included in the PDF claim export yet.
3. To post approved KM, implement a dedicated idempotent, atomic DB RPC with row locks, saved-travel-leg overlap detection, mode/rate verification, financial gate checks, immutable audit event and re-export reconciliation. Do not globally disable financial safeguards.
4. Verify proposed approved KM does not overlap ordinary eligible_km, prior increments, final-leg recovery or other Admin decisions.
5. Test authenticated Admin vs non-Admin (403), duplicate decision (409), malformed payload, zero/negative KM, prior-month records, 73-case pagination, modal rendering and PDF totals.
6. Run frontend build, backend syntax checks and scoped CI; current PR has a failing Retail MIS exact-scope workflow and must not be merged without resolution or documented workflow scoping.
7. Confirm the October evidence review and approval queue can be reconciled using attendance_id; do not auto-create review rows from GPS gaps.
8. Verify business/profile joins and monthly export against the original QPMS report template. The PDF is provisional, not an approved reimbursement statement.

## Current status
DB ledger and UI/API changes are staged in PR #78. No PR merge, no production backend deployment, no automatic payable KM updates.
