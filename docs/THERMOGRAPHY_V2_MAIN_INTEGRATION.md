# Thermography V2 — main integration and production approval packet

Original implementation: draft PR #100, approved commit `2842c1e2c9bf5467cff728d6338f4ad33bec2685`.
Freshly fetched main: `46707ec63c440d015c21339b00c423b461089ff1` (PR #97 HK MIS, including PR #98 leadership).
Integration branch: `integration/thermography-v2-main-20261118`.
Refreshed divergence: main has 23 exclusive commits; approved feature has 7; common ancestor is
`f23bb8ac03afcba3222b9738369a01043ede2d11`.

## Strategy and conflict resolutions

Selective file integration from the approved commit onto a clean branch from current main.
No divergent-history merge, force push, reset, or overwrite of newer main files was used.
The complete standalone Thermography implementation is reused; the UI/services are not rebuilt.

- Backend mount: add only the dedicated Thermography router before the generic MIS router.
  Verified identity and current database role/state predicates remain mandatory. The current
  main leadership middleware and every other route remain intact after line-ending normalization and removing
  the three-line Thermography import/mount addition.
- MIS UI: retain main's HK MIS dispatch **first**. Only the non-HK Thermography route selects
  the V2 component. All existing HK/legacy workspace code remains unchanged.
- Operations UI: add a Thermography-only wrapper. The entire current-main CM/PM component
  body is retained unchanged, including navigation scope, financial/approval gates and windows.
- Dashboard filter transfer: V2 consumes main's existing `readRetailNavigation` context,
  including month, KPI cutoff, state and store; KN is translated to the existing KA master key.
  This is filter context only, never an authorization grant. A browser test exercises the actual
  Dashboard link and return scope.
- Shared reporting: integrate only the approved Thermography soft-delete/rework counting
  branch and optional Thermography rework metric. Keep scheduled-date cohort terminology.
  Do **not** copy the older branch's report-date filter into the main reporting service or
  overwrite the current Retail Dashboard, Attendance, Training, Cleaning or leadership fixes.
- Exact CI authorization: pin the complete integrated payload to current main. Reconstruct
  the workflow from that exact main blob plus the single reviewed Thermography block.
  Existing export assertions receive the verified original main workflow, retaining every
  historical assertion; no arbitrary block removal, new path globs or skipped security tests.
- Test dependencies: reuse approved PGlite 0.3.14 and tus-js-client 4.3.1 as **dev-only** tools.
  The latter retains the approved legacy signed-upload security regressions; V2 runtime uses
  signed PDF uploads. Every existing main dependency version remains unchanged.

## Production preflight — measured read-only, 18 November 2026

Project `ubawkjdbtickdlrgkulz`; queries ran in explicit read-only transactions with a 5-second limit.

- Neither Thermography migration is in the ledger. Report/version/import contracts and the
  `retail-thermography-reports` bucket are absent. Neither migration was applied by this task.
- Five historical inspections: four Completed and one Client Approved; one duplicate store/date
  group. No historical rows were edited or deleted. The proposed trigger rejects only new
  collisions and permits unchanged-key updates on legacy duplicate rows.
- Inspection RLS is enabled; table ACL is owner-only and no direct authenticated policy exists.
  Existing command RPC is service-role-only. Existing MIS and geographic access helpers are
  owner-controlled; the report RPC delegates to those existing predicates.
- Current geographic authority functions are installed, even though the geographic migration
  ledger row is absent. Do not rerun that unrelated migration. Its functions are exercised
  unchanged in the isolated fixture; reconcile historical ledger provenance separately.
  Read-only SQL-token comparison (preserving string literals) matches all four installed
  geographic/unified/operations authority bodies to current main; formatting alone differs.
- Bucket privacy/limit cannot yet be inspected because the bucket is absent. The proposed
  bucket is private, PDF-only and capped at **10,000,000 bytes**.
- **Global Storage upload limit remains UNVERIFIED**: the connected tool exposes SQL/project
  metadata, not Storage service configuration. An authorized operator must verify it supports
  10,000,000 bytes before production approval. No credential inspection or setting change was used.
- Database/Storage backup recoverability, deployed environment limits and authenticated live
  production acceptance remain operator/release checks, not inferred from synthetic tests.

## Verification and preservation

Both proposed migrations are installed, in order, in disposable PostgreSQL 17 with current
main's geographic authority contract. Native tests require version 17 and actual overlapping
sessions. The strict monthly query limit remains 4,000 ms and native statement timeout remains
8 seconds. No performance limit is raised. The legacy-data fixture preserves all original
completion, approval, identity, revision and request fields across installation.

Additional native/PGlite tests verify current South/Branch Head geography, immediate grant
revocation, wrong-business denial, MIS-only report writes, and unchanged authority-function
hashes after installation. TN/AP-1/AP-2 MIS boundaries remain distinct. Existing mounted JWT,
HK MIS, leadership, financial-denial and Retail regression suites remain mandatory in CI.

The exact-file manifest and negative tests reject missing, extra, altered and unpinned files.
Pins must be verified against staged and committed raw Git bytes. A new main head requires
fresh integration review and renewed pins; this packet does not authorize a stale-base release.

## Exact production release sequence — approvals required, do not execute in this task

**A — Approval:** review the new draft PR against main and approve the exact commit, both SQL
migrations and private PDF Storage configuration. PR #100 remains the original implementation
record. No automatic merge is authorized.

**B — Database:** a named operator verifies restorable database/Storage backups, records
historical aggregates/approval snapshots, confirms ledger/object absence and function/ACL/RLS
fingerprints, and verifies the global upload limit. Under the approved production change only,
apply `20261115140000_retail_thermography_reports.sql`, then
`20261118010000_retail_thermography_schedule_v2.sql`. Keep Thermography writes closed during
installation. Verify private PDF-only bucket, immutable keys, 10,000,000-byte cap, service-only
RPCs, duplicate prevention, original row preservation and matching runtime upload configuration.
Never rerun an installed migration or install an unrelated geographic migration to repair a ledger.

**C — Application:** after separate merge/deployment approval, release the matching backend
and frontend commit through the protected process. Confirm both deployed identities and health.

**D — Authenticated live acceptance:** state MIS and approved multi-state MIS preview/import a
reviewed Excel schedule; verify canonical mapping and recorded totals. Read-only accounts cannot
mutate. Verify exact PDF byte round trip, verified completion, separate client approval/rework,
current/past/future IST KPIs, entire-month future rows, chart, filters, pagination, history and
Excel export. Deny cross-state/cross-business requests and premature future completion. Exercise
HK MIS, South/Branch Head, Attendance, Cleaning, Training, CM/PM and other current Retail paths.

**E — Monitoring:** verify Railway backend/frontend health, Supabase query/Storage errors,
browser console and representative production monthly latency against the agreed limit.
Only then approve ordinary operational use.

## Separate non-destructive recovery

On acceptance failure, an authorized operator pauses Thermography writes using the existing
write control, retains V2-compatible private reads/history, captures request receipts and
reconciles pending uploads/imports. Prefer a reviewed forward correction. Do not delete original
PDFs, drop tables/bucket/policies, undo historical approvals or run destructive down migrations.
The old XLSX backend is incompatible with the PDF bucket. Any restore requires separate approval
and reconciliation of post-backup immutable objects and receipts before writes reopen.

Remaining limits: 5,000 inspections per selected month; no automatic legacy PDF backfill, malware
classification or thermal interpretation. Existing status-only records remain explicitly unverified.

## Complete changed-file inventory and justification

<!-- FILE INVENTORY: generated once from the reviewed integration scope below. -->

Exact candidate: **46 files**. Original PR #100 files reused/adapted are marked V2; supporting dependencies are individually justified.

| File | Scope and reason |
| --- | --- |
| `.github/thermography-v2-pins.json` | V2: approved implementation, adapted only for current-main integration/security pins. |
| `.github/thermographyV2Guard.mjs` | V2: approved implementation, adapted only for current-main integration/security pins. |
| `.github/workflows/retail-ui-visual-checks.yml` | V2: approved implementation, adapted only for current-main integration/security pins. |
| `.github/workflows/thermography-fullstack.yml` | V2: approved implementation, adapted only for current-main integration/security pins. |
| `backend/routes/relianceRetailManagementRoutes.js` | Three-line dedicated Thermography router mount/import; all newer main routes and middleware preserved. |
| `backend/routes/thermographyReportsRoutes.js` | V2: approved implementation, adapted only for current-main integration/security pins. |
| `backend/services/thermographyDashboard.js` | V2: approved implementation, adapted only for current-main integration/security pins. |
| `backend/services/thermographyPdf.js` | V2: approved implementation, adapted only for current-main integration/security pins. |
| `backend/services/thermographyReportsService.js` | V2: approved implementation, adapted only for current-main integration/security pins. |
| `backend/services/thermographySchedule.js` | V2: approved implementation, adapted only for current-main integration/security pins. |
| `backend/services/thermographyScheduleWorker.js` | V2: approved implementation, adapted only for current-main integration/security pins. |
| `backend/services/thermographyWorkbook.js` | Validated XLSX ZIP integrity guard reused for schedule workbooks. |
| `backend/shared/retailOperations.js` | Thermography-only soft-delete and rework counting; maintenance body unchanged. |
| `backend/tests/helpers/nativeThermographyPostgres.js` | Approved disposable PostgreSQL 17 multi-session test harness. |
| `backend/tests/helpers/thermographyFixture.js` | V2: approved implementation, adapted only for current-main integration/security pins. |
| `backend/tests/helpers/thermographyServiceFixture.js` | V2: approved implementation, adapted only for current-main integration/security pins. |
| `backend/tests/thermographyDashboard.test.js` | V2: approved implementation, adapted only for current-main integration/security pins. |
| `backend/tests/thermographyReports.concurrent.test.js` | V2: approved implementation, adapted only for current-main integration/security pins. |
| `backend/tests/thermographyReports.database.test.js` | V2: approved implementation, adapted only for current-main integration/security pins. |
| `backend/tests/thermographyReports.limits.test.js` | V2: approved implementation, adapted only for current-main integration/security pins. |
| `backend/tests/thermographyReports.test.js` | V2: approved implementation, adapted only for current-main integration/security pins. |
| `backend/tests/thermographySchedule.test.js` | V2: approved implementation, adapted only for current-main integration/security pins. |
| `docs/THERMOGRAPHY_V2_MAIN_INTEGRATION.md` | Full dependency justification, measured production preflight, approval sequence and separate recovery plan. |
| `docs/THERMOGRAPHY_V2_RELEASE.md` | V2: approved implementation, adapted only for current-main integration/security pins. |
| `package-lock.json` | Lock the dev-only tools/transitives; preserve every existing main version. |
| `package.json` | Add exactly two approved test-only development tools; no existing dependency upgrade. |
| `src/components/reliance-retail/ThermographyReports.jsx` | V2: approved implementation, adapted only for current-main integration/security pins. |
| `src/components/reliance-retail/thermographyReports.css` | V2: approved implementation, adapted only for current-main integration/security pins. |
| `src/pages/reliance-retail/RetailMisWorkspace.jsx` | Thermography dispatch after existing HK-first branch; all HK/legacy behavior retained. |
| `src/pages/reliance-retail/RetailOperations.jsx` | Thermography-only dispatch wrapper; current main CM/PM body unchanged. |
| `src/utils/retailExecutiveReport.js` | Thermography-only optional rework metric; preserve scheduled cohort and other module calculations. |
| `src/utils/thermographyReports.js` | Approved legacy identity/export compatibility helpers required by retained regression tests. |
| `src/utils/thermographyTusUpload.js` | Approved signed-upload compatibility helper; test-only dependency, not V2 runtime upload. |
| `src/utils/thermographyV2.js` | V2: approved implementation, adapted only for current-main integration/security pins. |
| `supabase/migrations/20261115140000_retail_thermography_reports.sql` | V2: approved implementation, adapted only for current-main integration/security pins. |
| `supabase/migrations/20261118010000_retail_thermography_schedule_v2.sql` | V2: approved implementation, adapted only for current-main integration/security pins. |
| `supabase/verification/retail_thermography_reports_postinstall_read_only.sql` | Original reviewed read-only postinstall integrity checks. |
| `supabase/verification/retail_thermography_reports_preflight_read_only.sql` | Original reviewed read-only installation/permissions preflight. |
| `tests/browser/retailReportVisualSmoke.spec.js` | V2: approved implementation, adapted only for current-main integration/security pins. |
| `tests/deepCleaningExportGuard.test.js` | Same exact workflow adapter; preserve all existing Cleaning export assertions. |
| `tests/retailOperationsShapeBrowser.test.js` | V2: approved implementation, adapted only for current-main integration/security pins. |
| `tests/thermographyFullstackGuard.test.js` | V2: approved implementation, adapted only for current-main integration/security pins. |
| `tests/thermographyReports.browser.test.js` | V2: approved implementation, adapted only for current-main integration/security pins. |
| `tests/thermographyReports.test.js` | V2: approved implementation, adapted only for current-main integration/security pins. |
| `tests/thermographyTusUpload.test.js` | Retain original interruption, authorization and identity security assertions. |
| `tests/trainingExportGuard.test.js` | Strictly verify and unwrap only the exact Thermography workflow addition before unchanged historical assertions. |

Omitted from the original 30-file delta: `.github/thermographyFullstackGuard.mjs`, whose historical integration-base guard is superseded by the exact current-main V2 guard. Its protection is retained through the pinned base, complete payload/negative checks and exact workflow reconstruction. The obsolete 100 MiB manifest and report-date changes to the main Dashboard/reporting service are not imported.
