# October 2026 historical KM recovery — production audit and release gate

Status: **NO-GO for financial posting.** This file is a scoped implementation specification, not a deployment authorization or a claim that KM has been credited.

## Verified on production (2026-11-03)
- 1,512 October attendances; all have logout times; 857 status `Completed`, 655 `Stale Auto Ended`.
- 1,326 already have positive payable KM; existing credits must not be replaced or double counted.
- 355 have `fo_km_job_provenance`; 359 have reconciliation jobs.
- `fo_km_attendance_authorizations`: **0**. `fo_km_scope_authorizations`: 3 historical, **0 live**.
- `fo_km_scope_control.emergency_pause=true`, `release_until=null`; `fo_km_financial_control.financial_writes_enabled=false`.
- No new October incremental credits were found after 2026-11-03 15:22 UTC. November receipts must be audited separately.

## Exact incompatibility
`backend/services/foKmV2PersistenceService.js` selects `rpc_reconcile_fo_policy_km_v1` when `KM_CANONICAL_POLICY_ENABLED=true`. Migration 246 wraps this RPC and requires an existing evidence-bound authorization. The owner-only function `fo_authorize_attendance_km_v246` requires `session_user=postgres`, an active shutdown, a matching job and provenance, and a verified server plan. It cannot authorize all historical attendances, and MUST NOT be replaced with fabricated provenance or a service-role self-authorization shortcut.

The Admin bulk endpoint `/reconcile-supported-batch` processes at most 10 attendances per call. A successful HTTP response is not a posting receipt.

## Required implementation (separate reviewed migration + backend)
1. Introduce an **owner-controlled historical Admin authorization path**, distinct from Migration 246 automatic/late-GPS authorization. Restrict it to completed October 2026 attendance, authenticated Admin identity, explicit date scope, genuine server-calculated plan, canonical evidence digest, baseline-inclusion check, immutable audit, short expiry, and bounded incremental KM/amount. Do not create provenance events for old attendance.
2. Split **prepare** and **post** phases: owner-authorized prepare runs with scope emergency pause ON and global gate OFF; post only after a bounded release and DB policy activation. Never grant owner-only authorization creation to `service_role`, `anon`, or `authenticated`.
3. Add a dedicated service-only posting RPC validating exact authorization, attendance identity, evidence freshness, cap, no self-approval if required by policy, and single-use receipt. Call the existing `fo_reconcile_km_239_core` under the transaction guards. Keep idempotent retries.
4. Extend the Admin backend with preview -> authorize -> post, paginated cursor and per-attendance outcomes. No blind retry after timeout: check receipt first. Keep unresolved and disputed legs as exceptions, without withholding independent supported legs.
5. Regression-test positive supported legs, duplicate requests, already credited/settled baseline, missing GPS, mismatched digest, expired/revoked authorization, out-of-period attendance, unauthorized role, concurrent requests, and shutdown mid-batch.
6. Canary one verified attendance, inspect receipt and reporting totals, retry idempotently, then progress in batches. Compare total added KM and amount to immutable receipts, and keep separate state-wise export audit.

## Railway and DB release gates
- Do **not** enable global financial writes to bypass the canonical guards.
- During controlled policy posting, `KM_FINANCIAL_WRITES_MAINTENANCE=true` is compatible with authorized Admin policy posting; `KM_FINANCIAL_WRITES_EMERGENCY_PAUSE=false` is needed only during the explicitly released window. Verify actual Railway environment before any posting.
- Preserve `KM_SHARED_RECONCILIATION_ENABLED`, `KM_INCREMENTAL_REPORTING_ENABLED`, and `KM_CANONICAL_POLICY_ENABLED` as explicit checked conditions.
- The existing DB policy expiry and worker_enabled must be rechecked at release; do not rely on earlier timestamps.
- Shutdown immediately with DB emergency pause and backend emergency pause; retain all receipts and ledgers.

## Unresolved deployment dependencies
- No Railway logs/config connector is available in this session.
- An owner-executed database migration and backend change are required. **Do not merge this audit-only branch as if it were the fix.**
