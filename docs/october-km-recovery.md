# October 2026 additional KM recovery (inactive candidate)

This implementation starts at `acc7c57af859c1531fc919035af78749bab20fc1`. It does not replace canonical attendance, route, petrol, approval or settlement values. No automatic financial credit is issued.

## Implementation map

| Layer | Implementation |
| --- | --- |
| Admin entry | FO Activities employee detail → October KM Recovery |
| UI | `src/components/OctoberKmRecoveryDialog.jsx` |
| Admin API | `backend/routes/foOctoberRecoveryRoutes.js`, mounted at `/api/fo/km` |
| Evidence | `foOctoberRecoveryEvidenceService.js`, existing `normalizeGpsEvidence` / `planGpsSegments` |
| Directions | Existing `googleDirectionsRoute`, through coordinate-validated `estimateOctoberRecoveryRoute` |
| Requests/decisions | `foOctoberRecoveryService.js`, two service-only SQL RPCs |
| Ledger/transaction proposal | `supabase/proposals/238_october_km_additional_recovery.sql` (NOT installed) |
| Dashboard/detail/PDF calculated claim totals | `foOctoberRecoveryReportingService.js`, existing authorized summary and employee-range loaders |
| All 12 recovery claim fields | authenticated Admin CSV export and an October KM Recovery worksheet in the existing employee Excel export (`src/utils/octoberRecoveryExport.js`) |

## Endpoints

- `GET /api/fo/km/october-recovery?employee_code=...&date=...`: requests, statuses and capabilities.
- `POST /api/fo/km/october-recovery/evidence`: read-only calculation. A POST is used to carry the selection, not to persist data. Optional documented journey start/end select trustworthy boundary coordinates for a separate Directions estimate.
- `POST /api/fo/km/october-recovery/requests`: explicitly store one pending request after request activation.
- `POST /api/fo/km/october-recovery/decision`: explicitly approve/reject one pending request after separate financial activation.
- `GET /api/fo/km/october-recovery.csv?employee_code=...&date_from=2026-10-01&date_to=2026-10-31`: monthly recovery ledger export. Pending/rejected entries add no payable distance or amount.

All endpoints check active authenticated Admin/QPMSAdmin identity before acquiring the privileged client. SQL independently rechecks the actor, explicit allowlist, self-approval and activation. Neither employees nor managers receive approval permission. Existing Finance/Operations report authorization is reused unchanged for approved-credit read overlays.

## Evidence and manual recovery

Continuous reconstruction ignores site event boundaries and partitions by employee, Indian calendar day and verified attendance session. Missing Check-Out or End Day does not suppress closed GPS movements. Ambiguous/foreign sessions, mocked/poor-quality points and implausible movement are rejected; long gaps remain unknown rather than straight-line journeys. No synthetic End Day or GPS point is created.

The existing normalizer rejects arrivals over ten minutes old. Recovery analysis alone admits delayed mobile points with original capture time, local sync ID, non-mocked status, a non-future receipt and no stale-provider marker. Original data is retained; late sync remains explicitly flagged for Admin review. Other quality/speed/deduplication rules remain in force. This does not change the live/mobile collector or the canonical engine's policy.

GPS is physical travel evidence, not proof of official purpose, private transport or unpaid distance. Directions estimates are separately labelled comparisons; they never replace accepted detours. Missing both trustworthy endpoints produces no route estimate. Retrieval failures throw errors and do not become zero logs/KM. Legacy logged-at timestamps are separately flagged for timestamp review.

A manual request can have no GPS, no checkout and no attendance row. It still needs a documented journey window, start/destination, official reason, total journey distance, requested additional distance, actual mode, explanation and any supporting references/stops. The window is an Admin account of the journey, not fabricated application events. The Admin must explicitly enter verified included KM and an inclusion explanation; blank/unknown is not zero.

Recorded private-mode rates are preserved, including historical overrides. Without attendance, the documented private mode uses the existing engine's defaults (Bike/own vehicle ₹4; Car ₹8). Known mode mismatch, false petrol eligibility, conflicting recorded rates or unknown existing payable baselines require separate reconciliation. Public modes can be recorded/reviewed but cannot receive petrol recovery. Suspected public movement is a review flag, never an automatic deduction.

## Transaction and duplicate controls

The proposal creates a separate service-only recovery ledger, append-only event history and disabled activation record. A request key binds exact submitted details. A decision key binds exact actor/action/amount/remarks/inclusion. Retries replay the stored result; changed reuse fails. A second approved window overlapping an existing approved recovery is blocked even under a different key.

Approval takes an employee/date advisory lock, request row lock, attendance/leg locks and settlement share locks. It rechecks the captured canonical/approval/correction/settlement snapshot and rejects stale state. Fully contained saved payable legs impose a lower bound on included KM. Additional approved KM cannot exceed the request or documented journey total minus verified included KM. Unknown/partial inclusion is an explicit Admin verification responsibility, not an automatically inferred zero.

Only the new ledger and its event history are written. Canonical totals and settlements remain untouched. A proposed attendance trigger prevents subsequent automatic financial rebasing or transport/rate changes from absorbing/re-crediting an approved additive recovery. Tracking-only updates remain possible. Such a financial rebase needs its own reviewed reconciliation. Existing Migration 237 remains unchanged.

Existing canonical paths can take locks in another order. PostgreSQL may abort a conflicting concurrent transaction; callers must refresh/retry, never treat a timeout as approval. Real PostgreSQL 17.11 multi-process readiness tests now verify simultaneous approvals, retries, approve/reject races, audit-write rollback, disjoint/overlapping journeys, concurrent claim reading and a parent-lock conflict. The conflict returns an abort/retry, never a partial credit. Evidence is in `artifacts/p1-readiness-20261025/POSTGRES-CONCURRENCY.json` in the primary workspace.

## Reporting semantics

Read overlays add each approved ledger ID once; pending/rejected amounts are excluded. Canonical saved values remain available as the original baseline. Employee details, dashboard totals and calculated monthly travel claims use the same approved additions. A day without attendance is an explicit financial report row, with no fake attendance ID, Start Day or End Day; it does not increase attendance counts.

The Admin CSV and employee Excel recovery worksheet include employee/name/date, existing payable, recovered and resulting payable KM, rate, additional and resulting claim amount, reason, approving Admin and status. CSV and Excel use the same platform-neutral daily projection: one employee/date row, the original baseline, and unique approved additions. Cumulative request snapshots are never summed as separate daily claims. An Excel write/read round-trip verifies all twelve columns, numerical values, duplicate-ID exclusion, unknown values and pending-credit exclusion. These are claim/audit exports, not payment receipts. Existing Finance settlement `final_payable` remains authoritative and unchanged; approved recoveries on a settled period are supplementary claims requiring Finance settlement reconciliation. Do not add a recovery again merely because a settlement or export is refreshed.

## Activation prerequisites (not executed)

1. Review and approve the proposed SQL, RLS/grants, parent-lock interaction and migration number. Real multi-session tests passed locally. Production catalog checks confirm the reviewed 237 function is installed, but the migration registry has no 237 entry (latest recorded version 234). Reconcile migration history through a separately approved, catalog-backed bookkeeping action; do not rerun 237. Apply nothing to production without explicit migration approval.
2. Review/deploy the exact source with GitHub approval and automatic Railway integration. Verify authenticated Admin and authorized report-reader acceptance against an approved test account.
3. Separately approve request storage, reporting and the narrowly scoped, expiring financial exception. The proposal installs `requests_enabled=false`, `approvals_enabled=false`, `emergency_exception_approved=false`, an empty Admin allowlist and no expiry/reference. No API can activate this record.
4. New application gates default inactive: `KM_OCTOBER_RECOVERY_REQUESTS_ENABLED`, `KM_OCTOBER_RECOVERY_REPORTING_ENABLED`, `KM_OCTOBER_RECOVERY_APPROVAL_ENABLED`. Approval requires reporting too. No flags are changed by this candidate.
5. The database activation requires specifically authorized Admin UUIDs, an explicit reviewed exception reference and a valid expiry. This exception writes only the October additive ledger while requiring `canonical_v2.financial_writes_enabled=false`. It does not disable emergency pause/maintenance or activate any worker. Existing holds stay unchanged; the exception itself requires separate authorization.
6. Confirm settled-period supplementary-claim handling with Finance before approving additions for paid periods. Existing settlement records are not rewritten by this workflow.

Readiness reporting explicitly returns existing/approved/final payable KM, the preserved settlement amount and an unsettled approved supplement. The supplement is known only when there is no matching settlement or each credit's captured settlement timestamp/amount still matches. A changed/missing settlement snapshot returns unknown and requires reconciliation, rather than assuming it is unpaid. Existing Finance access is unchanged; this release's monthly petrol calculation is the existing authorized consolidated travel-claim report, not a new Finance permission or payment endpoint.

No production writes, migration application, financial activation, commit, push or deployment are authorized by implementation approval alone.

## Rollback

Before activation, retain this worktree/patch and discard or revise only this scoped candidate after review; the dirty primary checkout is unaffected. An uninstalled proposal needs no database rollback.

After installation but before credits, a separately authorized rollback can deactivate only the new recovery paths while retaining audit tables. After any approved credit, preserve the ledger and read overlay: rolling back to a reader that ignores it would hide legitimate claims. Stop new recovery decisions through separately approved recovery-specific controls, retain all existing global holds, and use a forward-compatible report/ledger repair. Never delete approved credits or reset canonical/settlement amounts as rollback.

## Local validation

Release-readiness evidence on 25 October uses genuine isolated Supabase GoTrue sessions, PostgREST and PostgreSQL 17.11, with the unchanged production JWT middleware and actual P1 component/router/services. An authenticated Admin approved the isolated QPMSTNC17015 / 23 October fixture: 68.31 + 40 = 108.31 km and 160 additional amount. Browser refresh, duplicate HTTP retries, UI rejection, invalid-token and non-Admin denial pass. Actual authorized daily/monthly/dashboard loaders and the actual employee Excel exporter agree; original settlement 273.24 remains separate from the 160 supplement. This is not production claim acceptance or authority to activate production finances.

The current readiness suite has 342 passing focused checks, no skips/failures, plus the real multi-session and authenticated acceptance evidence. The separate frontend subset retains the inherited Sidebar source-slice assertion failure. Its slice includes later unrelated groups; evaluation of the actual bounded demo array, existing direct-route checks and backend demo write-denial tests pass. Sidebar is unchanged; the assertion is documented as a non-blocking baseline false positive for this scoped release, not silently removed or reported as passing.

The focused suite includes normal engine/financial guard compatibility, cases A–G, Admin HTTP authorization, reporting/export and real proposed SQL execution on isolated PGlite fixtures. Set `PGLITE_TEST_MODULE` to the isolated installed runtime before running `backend/tests/foOctoberRecoverySql.test.js`; no PostgreSQL URL or production credential is used. The local browser harness blocks every non-local request and proves that opening/loading performs GET only, evidence POST is non-persisting, inactive decisions are disabled and an explicit no-GPS 40 km fixture approval produces one credit. Local fixtures do not constitute production acceptance.
