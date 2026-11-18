# Deep Cleaning V2 release candidate - NOT APPROVED FOR PRODUCTION

Branch: `feat/deep-cleaning-v2-production-ready`, based on PR #102 head
`3d5f4e36a280c2a188f0e5180d074b5368507a81`. Main base:
`3453b06aee160611a62755a9feaba8123a617886` (already included in PR #102).

## Database baseline measured read-only on 2026-11-18

95 schedules, all Planned; 14 submitted reports, all without schedule_id;
zero exact canonical store/date matches. No historical completion is inferred.
12 reports use the verified Phase 1B paired contract; two are legacy records and
one legacy record lacks a canonical store ID. Missing identity/evidence cannot be
overridden by manual linking. Installation leaves all historical records unchanged.
The FO assignment column is nullable. The installed private validator requires FO.
Its ACL is owner-only. Independent mobile finalization preserves actual dates and
submitted records are immutable. None of those contracts is removed.

## Proposed installation order - separate production approval required

1. `supabase/proposals/retail_cleaning_store_only_import_20261118.sql`.
   Transactional replacement of the reviewed validator, accepting only blank/missing
   FO. Supplied FO checks, ownership checks, state scope and ACL stay intact.
   Exact normalized installed-definition checks reject drift and allow exact replay.
2. `supabase/proposals/retail_cleaning_verified_matching_20261118.sql`.
   New exact store/date matching trigger. Requires submitted Completed Phase 1B
   evidence, persisted objects, before/after pairs and a supporting document.
   Locks the schedule; keeps the independent submission unchanged; records the link
   on the existing schedule and appends an audit. No backfill. Conflicting assigned
   FO, ambiguous schedules and terminal schedules remain unmatched.
   Automatic matching installs DISABLED; the new manual RPC is not granted to the
   backend service until activation. Exact replay preserves existing activation.
   Admin-only manual linking requires preview, a 20-2000-character reason and an
   explicit date-exception confirmation. It preserves original dates and evidence.
   Future jobs, conflicting assigned FO, unknown identity and missing evidence are denied.
3. `supabase/proposals/retail_cleaning_schedule_writer_20261118.sql`.
   Separate user-authorized state-writer proposal. Creates only the dedicated role
   and `deep_cleaning.schedule.manage` permission, with no user assignments. Requires
   an approved, verified, effective assignment with `metadata.approval_reference`,
   explicit effective state scopes and existing Retail hierarchy view access.
   Unsupported scopes, AP-wide aliases, disabled modules, contradictory identity,
   cross-business clients and HK MIS/read-only roles are denied. It grants no
   submission, approval, evidence, export or other-module permission. Existing
   Central MIS calls and their SQL authorization remain intact. The owner-only
   validator and plan RPC changes are exact-definition checked.

After matching backend/frontend deployment and health checks, separately execute
`supabase/proposals/retail_cleaning_v2_activate_20261118.sql` under explicit release
approval. It checks function/trigger definitions, enables automatic matching and
grants backend execution of the manual RPC. Never run it during pre-deployment
installation. Review cutover-window submissions through the audited UI; no backfill.

No production SQL, role assignment, bucket or RLS change has been applied.
HK MIS remains read-only. Monthly import uses existing authorized Central MIS
or the separately approved state-writer assignment after migration. Named user,
state, approval reference, effective dates and existing hierarchy must be approved
before any production assignment. No assignment SQL is embedded in these proposals.
AP-1/AP-2 state grants are not combined or remapped.

## Metrics

Schedules counts active scheduled jobs. Done counts completed schedules with a
verified linked report; Pending counts scheduled jobs still open. Submitted reports
is a separate count, including independent work. Report export distinguishes these
measures and includes schedule details separately. Legacy reports remain readable.

## Recovery

Before approval, capture provider backup/recovery evidence and the exact installed
function definitions, ACLs, triggers and index definitions. Test restoration in an
isolated environment. Keep original evidence objects and submitted rows unchanged.
If acceptance fails, use the separately approved recovery proposal
`supabase/proposals/retail_cleaning_v2_recovery_20261118.sql`. It disables only the
new trigger, withdraws manual RPC execution, deactivates only the new writer role
and restores the reviewed plan RPC/FO-optional validator. All records and audits remain.
Do not delete schedules, submissions, evidence or the unique linkage index.
Restore the validator baseline only after confirming that the installed function
matches the approved replacement and documenting remaining FO-less schedules.
Retain compatible reporting readers for persisted schedule-side links. Automatically
reverting to pre-V2 readers is not an approved recovery: they cannot interpret
these links. Prefer a reviewed forward fix after the non-destructive recovery.

## Release sequence and live smoke test

Obtain explicit approval for exact migration bytes, reviewed PR/commit and backend/
frontend deployment. Recheck main, schema drift, mutation controls, private bucket
and backups. Apply only installation steps 1-3 above; do not execute the recovery
file as an installation migration. Release matching application versions through
the existing protected process, verify health, then run the reviewed activation
script. Never activate an unrelated release gate. Approve named writer accounts,
explicit states, effective dates and approval references separately before granting
any user assignment; installation creates no assignments.

With authorized authenticated accounts, verify template -> preview -> atomic import
-> FO paired evidence plus document -> exact schedule match -> schedule KPIs ->
private evidence viewer -> Excel/PPT. Test retries, missing evidence and cross-state
denial. Confirm unmatched historical and independent reports remain accurate. Check
HK MIS cannot mutate and existing South/Branch Head visibility remains scoped.
Verify Railway frontend/backend health, browser console and Supabase errors.

## Evidence and outstanding acceptance

Local verification: 391 focused tests passed, 120 Retail regression tests passed,
29 Retail browser tests passed, and two dedicated Deep Cleaning browser tests
passed. Scoped ESLint and the production frontend build passed. The Windows
29-test runner required stopping its owned Vite process during cleanup after all
workers completed; no assertions or timeouts were bypassed. Dedicated browser
tests run sequentially, matching CI. Remote results are recorded in the PR.

Local fixtures are synthetic and native tests use loopback PostgreSQL 17. They do
not prove authenticated production acceptance or production Storage recovery.
Native multi-session completion/import races, 500-row atomic import, FO-less
validation, corrections and state-writer boundaries are covered. The monthly browser
wizard tests validation rejection, confirmation, identical retry recovery and HK
read-only UI. Browser exports test real XLSX/PPT packages, embedded photos, partial
evidence warnings and responsive layouts. Historical manual links support Admin
preview and audited date exceptions for verified canonical Phase 1B reports; the
existing verified FO-activity path also remains available. Associated historical
photos are exported separately from actual-period report totals. No current
unmatched production report is force-linked.
Native tests retain the 8-second statement limit. Measured on local PostgreSQL 17:
500-row preview plus atomic import took 1068 ms for Central MIS and 2393 ms for the
state writer. The permission lookup uses a cached PL/pgSQL plan; no scope check or
timeout was relaxed. Native tests cover installation, activation, exact replays,
manual link races, original-record immutability and non-destructive recovery.
Remote workflows and authenticated production smoke tests must pass before final
acceptance. Historical fixtures under backend/tests/fixtures are regression inputs,
not additional production migrations.
No production deployment, merge or mobile build is authorized by this document.

## CI integration corrections

The initial remote candidate exposed a historical Thermography source assertion
that treated the authorized Deep Cleaning page as unchanged. It now verifies the
immutable Thermography integration and current non-cleaning source separately,
while requiring the complete exact Deep Cleaning payload. No assertion is skipped.
The dedicated workflow used runner.temp at job-level env, where GitHub does not
provide runner context; the value now lives in the browser step environment.
Reference: https://docs.github.com/en/actions/reference/workflows-and-actions/contexts

## Reviewed file scope

Application changes are confined to Deep Cleaning. Shared files add only scoped
Deep Cleaning routes, permissions, names and verified links. CI adapters preserve
all existing checks and pin this exact 42-file candidate. Historical SQL files in
backend/tests/fixtures are regression inputs, never production migrations. No
package pins, mobile, KM/financial, Attendance, Training, Thermography application,
hierarchy or AP mapping is changed.

- `.github/deep-cleaning-v2-pins.json`
- `.github/deepCleaningV2Guard.mjs`
- `.github/thermographyV2Guard.mjs`
- `.github/workflows/deep-cleaning-pr102-browser-validation.yml`
- `.github/workflows/retail-ui-visual-checks.yml`
- `backend/routes/retailMisRoutes.js`
- `backend/services/retailCleaningFoLinkService.js`
- `backend/services/retailCleaningPlanService.js`
- `backend/services/retailModuleReportService.js`
- `backend/shared/retailModuleReports.js`
- `backend/tests/deepCleaningMobileIntegration.test.js`
- `backend/tests/deepCleaningPhase1b.test.js`
- `backend/tests/deepCleaningStoreOnlyPostgres.test.js`
- `backend/tests/deepCleaningWriterAccess.test.js`
- `backend/tests/fixtures/cleaningPlanRpcBaseline.sql`
- `backend/tests/fixtures/cleaningPlanValidatorBaseline.sql`
- `backend/tests/fixtures/cleaningRequiredDocumentHistoricalPatch.sql`
- `backend/tests/fixtures/cleaningScheduledFinalizerHistorical.sql`
- `backend/tests/retailCleaningPhase1.test.js`
- `backend/tests/retailModuleReportService.test.js`
- `docs/DEEP_CLEANING_V2_PRODUCTION_RELEASE.md`
- `src/components/reliance-retail/DeepCleaningEvidenceDrawer.jsx`
- `src/components/reliance-retail/DeepCleaningOverview.jsx`
- `src/components/reliance-retail/RetailCleaningMonthlyPlan.jsx`
- `src/components/reliance-retail/deepCleaningV2.css`
- `src/pages/reliance-retail/RetailScopedDeepCleaning.jsx`
- `src/utils/deepCleaningExport.js`
- `src/utils/deepCleaningExportFiles.js`
- `src/utils/deepCleaningView.js`
- `supabase/proposals/retail_cleaning_schedule_writer_20261118.sql`
- `supabase/proposals/retail_cleaning_store_only_import_20261118.sql`
- `supabase/proposals/retail_cleaning_v2_activate_20261118.sql`
- `supabase/proposals/retail_cleaning_v2_recovery_20261118.sql`
- `supabase/proposals/retail_cleaning_verified_matching_20261118.sql`
- `tests/browser/retailExcelInline.spec.js`
- `tests/deepCleaningExports.browser.test.js`
- `tests/deepCleaningExports.test.js`
- `tests/deepCleaningV2Guard.test.js`
- `tests/deepCleaningView.test.js`
- `tests/deepCleaningWorkflow.browser.test.js`
- `tests/thermographyFullstackGuard.test.js`
- `tests/thermographyReports.test.js`
