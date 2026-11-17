# Thermography report management — local candidate

## Current integration candidate (2026-11-16)

Integrated in `D:\QPMS_CRM\.worktrees\thermography-main-20261116`, branch
`integration/thermography-main-20261116`, on verified main
`f23bb8ac03afcba3222b9738369a01043ede2d11`. The original November 15 worktree
is preserved. Historical validation and access notes below describe that earlier
candidate, not current production acceptance.

Only existing Thermography hunks were ported. In particular, the newer
`cleaningFromSnapshot` adapter and submitted-report count/store-scope calculations
remain unchanged. The three added management-router lines no longer have trailing
whitespace. The preservation test now compares against the integrated main base.

Dedicated authorization is prepared in `.github/thermography-fullstack-pins.json`
and `.github/thermographyFullstackGuard.mjs`, following the existing exact-payload
review process. Pins cover the complete candidate, its verifier, negative tests and
the dedicated full-stack workflow. The existing UI workflow only gains pinned
Thermography triggers/authorization; all existing subsequent checks remain required.
The verifier rejects any other workflow alteration, missing/extra payload, changed
blob, or different base. This is a prepared review candidate, not a maintainer
approval or proof of remote CI. Existing Training/Deep Cleaning exceptions are not
modified or reused.

The two existing export-guard tests use a strict Thermography workflow adapter:
it first asserts the entire current workflow equals the exact pinned additions to
main, then supplies the unchanged main workflow to their original byte-for-byte
historical comparisons. No export guard assertions/pins or application behavior
are removed. The dedicated browser checks run serially, with existing timeouts.

Integration validation: 61 focused SQL/service/permission/reporting/authorization
checks and 7 native PostgreSQL checks passed; 3 browser/shape checks passed when
run serially after the build. The initial parallel browser run during the build
had two page-load timeouts; no timeout was increased. Production Vite build and
scoped production-file lint passed, with existing bundle/import warnings. Native
Linux CI provisioning and remote required checks remain unexecuted; local tests
are not evidence of production Supabase settings or production acceptance.

Production Supabase contracts, policies, bucket state and project-global upload-limit
support remain UNKNOWN; no production queries or changes were performed here.
Required order: authorized read-only preflight and Storage global-limit verification
-> independent exact-payload review and green required CI -> explicit release and
migration approval -> reviewed additive migration once -> post-install read-only
invariants -> compatible backend -> frontend -> separately authorized private
upload/download/rework/approval and count acceptance. Do not install prerequisite
proposals blindly or remove retained versions/history during rollback.

### Current large-upload candidate (supersedes historical 25 MiB notes below)

The old cap was enforced in browser, backend, version constraint and bucket creation;
transport was one signed PUT. The prepared cap is now **100 MiB (104,857,600 bytes)**,
covering 25–40 MB and larger workbooks with a finite resource ceiling. The backend
continues to advertise/enforce the lower configured/private-bucket cap. Production
project-global Storage settings must separately permit the chosen maximum; this
preparation does not change any production setting or install SQL. If the earlier
migration is already installed, do not rerun this creation migration: review a
separate additive limit migration against the actual installed constraint/bucket.

Files above 6 MiB use pinned `tus-js-client` 4.3.1 with 6 MiB chunks and Supabase's
signed `/storage/v1/upload/resumable/sign` endpoint. The backend alone reserves the
authorized immutable version and issues the object-specific token with upsert false.
The direct hosted Storage hostname is used; no service-role or user JWT is forwarded
to the browser. Small files keep the existing signed PUT.

Resume fingerprints include actor, request, version, project origin, object, hash
and size. Session storage retains only the TUS resource URL/size, never signed tokens
or file bytes. Reload/retry requires the same file and a fresh authorized prepare
request; expired tokens are reported without silently creating a new report. Upload
resource locations are restricted to the signed Storage origin/path before sending
credentials. Each browser chunk has a 120-second timeout and bounded retries.
Neither upload progress nor TUS success changes workflow status. Finalization still
streams the complete stored workbook, validates its archive and SHA-256, and uses
the existing transactional revision/object checks. Approved originals cannot be
replaced; rejected replacements retain prior versions until verified finalization.

Finalization's temporary signed read lasts 300 seconds; its bounded stream deadline
is 180 seconds and this page's finalize request timeout is 240 seconds. Archive
safety limits remain unchanged (50 MiB per expanded entry; 250 MiB total). No cells,
temperature values, thermal images or classifications are parsed or extracted.

Focused local validation: 23 checks passed, including actual TUS interruption/resume
of a 41 MiB synthetic payload with fresh authorization and no duplicate POST; valid
31,982,520-byte and 63,956,235-byte embedded-image XLSX original-byte round-trips;
100 MiB/+1 boundaries; state/role restrictions; missing-file rejection; and approved
original preservation. These use disposable SQL/Storage/protocol fixtures, not live
Supabase. The existing full-stack manifest/authorization pins must be renewed for
the new dependency, helper, tests and modified existing Thermography files. All
previous guard checks stay required. Actual production TUS/CORS/policy behavior,
global size support and slow-network acceptance remain release blockers.

Incremental files in this continuation: `package.json`, `package-lock.json`,
`backend/services/thermographyWorkbook.js`, `thermographyReportsService.js`,
`backend/tests/helpers/thermographyServiceFixture.js`,
`backend/tests/thermographyReports.limits.test.js`,
`src/utils/thermographyReports.js`, new `src/utils/thermographyTusUpload.js`,
`src/components/reliance-retail/ThermographyReports.jsx`,
`tests/thermographyReports.test.js`, `tests/thermographyReports.browser.test.js`,
new `tests/thermographyTusUpload.test.js`, the prepared migration, this document,
the full-stack verifier/manifest and both CI workflows' scoped checks/pins.
The manifest is the exact full candidate file/hash inventory; add its own path and
the existing UI workflow path (explicitly checked by the verifier) to that inventory.

References: https://supabase.com/docs/guides/storage/uploads/resumable-uploads
and https://github.com/supabase/supabase/tree/master/examples/storage/resumable-upload-signed-uppy .

## Identity and verification boundary

Branch: `feat/thermography-report-management-20261115`.
Worktree: `D:\QPMS_CRM\.worktrees\thermography-report-management-20261115`.
Fetched main base: `73f50b8056c9c29cb706decd880d920df3b33d26`.
No commit, push, migration installation or deployment performed.

Existing Operations inspection identities, Store Master, JWT, MIS assignments,
state scope, ten-calendar-day approval tracking and routes are reused. The existing
Thermography page and MIS entry render the report manager; no new main navigation.
Legacy status-only records remain identifiable and are never represented as uploaded
workbooks. Existing completion/approval RPC paths cannot mutate managed reports.

**Production contracts are NOT VERIFIED.** No authorized Supabase connection was
available. Repository SQL is not proof of installed tables, functions or policies.
The prepared migration fails closed on prerequisite/function-definition drift and
an existing target bucket. Review installed definitions before authorizing installation.

## Implemented lifecycle

Authorized MEPC MIS selects an assigned store, report date/optional period and original
XLSX. A stable request reserves a version and private object key. Signed PUT never
overwrites an object. Backend finalization streams and validates the stored package,
checks SHA-256 against selected bytes and links it transactionally before submission.
Original workbook bytes, sheets, formulas and embedded images are not reconstructed.
ZIP package validation is not workbook-content analysis or a malware scanner.

Client rejection records optional remarks, then replacement creates a new immutable
version and clears approval. Failed replacement preserves the old active version.
Revision checks reject competing stale changes. Approval requires an accessible current
workbook, records MIS confirmation without attachments and is idempotent. Super Admin
reopening requires a reason. Soft deletion retains versions/events; Super Admin restore
checks the latest active file. Permanent purge is not implemented or authorized.

Session storage retains request metadata/hash, not file bytes. After reload users must
reselect the same workbook if upload was incomplete. Response-loss retries reuse the
same operation. Cleanup is explicit, Super Admin only, bounded to 20 abandoned pending
objects older than 24 hours; no automatic cron or deletion of confirmed history.

Business-date cohorts use report date for managed records, scheduled date for legacy
records. Asia/Kolkata determines the default month. Upload timestamps remain distinct.
Deleted rows do not count in active KPIs. Approval is not thermal-condition evidence.
Summary Excel has Summary, State summary, Store summary and Report details sheets,
using the same scoped filters and snapshot digest. Export aborts on changed pages,
duplicates or more than 5,000 selected rows. History and report rows are paginated.

## API and authorization

Prefix: `/api/reliance-retail/mis/thermography` behind existing JWT middleware.

| Method | Route | Purpose |
| --- | --- | --- |
| GET | `/reports` | Scoped rows, stores, counts and server capabilities |
| POST | `/uploads/prepare` | MEPC MIS scoped reservation and signed private upload |
| POST | `/uploads/finalize` | Validate stored bytes and atomically activate version |
| GET | `/reports/:id/download` | Authorized original-byte proxy download |
| GET | `/reports/:id/versions/:version/download` | Authorized historical download |
| GET | `/reports/:id/history` | Paged immutable events and version metadata |
| POST | `/reports/:action` | schedule/reject/approve/delete/restore/reopen |
| POST | `/cleanup` | Super Admin bounded abandoned-upload reconciliation |

The service-role-only RPC `rpc_retail_thermography_reports(uuid,text,jsonb)` rechecks
verified profile, active Reliance Retail capability, actual MIS module assignment,
state and canonical Store Master. MEPC MIS writes; existing authorized readers retain
read access; Super Admin restoration/reopening does not grant ordinary report uploads.
Frontend visibility follows server capabilities. No service credentials are exposed.
Download signed URLs are server internal and are not placed into Excel exports.

## Prepared database and Storage scope

Migration: `supabase/migrations/20261115140000_retail_thermography_reports.sql`.
Additive metadata on existing inspections plus versions, events and request receipts;
FKs, uniqueness, RLS, service-role RPC, immutable-history guards and scoped read updates.
No existing migration edited and no data seed/backfill or destructive replacement.

New private bucket: `retail-thermography-reports`, provisional maximum **25 MiB** XLSX.
Restrictive anon/authenticated policies deny direct reads/writes for this bucket only;
authorized upload tickets and backend download proxy provide access. Confirmed objects
cannot be overwritten/deleted. Review compatibility with installed Storage internals.
`THERMOGRAPHY_REPORT_MAX_BYTES` can lower the upload cap, never exceed bucket maximum.
Confirm realistic report sizes and infrastructure body/time limits before release.

## Local validation (2026-11-15)

All tests use synthetic profiles/workbooks, isolated environment loading, a local
Storage fixture and in-memory PostgreSQL/PLpgSQL (PGlite); no production credentials.

- 16/16 new database, service and summary/retry regression tests passed.
- 8/8 selected existing Thermography/report/authorization regressions passed.
- 3/3 browser/shape tests passed, including full actual-SQL local lifecycle.
- Thermography-only visual smoke passed at desktop/tablet/mobile sizes earlier in run.
- Scoped production-file ESLint passed. Production Vite build passed with existing
  ExcelJS import/chunk-size warnings. No APK built.
- Original and historical downloads compared byte-for-byte with an XLSX containing
  embedded PNG, formula, formatting and multiple worksheets. Generated summary reopened
  with ExcelJS; dates/counts/identifiers checked. No real client workbook was supplied.

PGlite serializes connections. The subsequent focused verification below adds native
multi-session PostgreSQL coverage; actual Supabase Storage remains unverified.
Synthetic browser results do not establish authenticated production acceptance.

Artifacts outside candidate: `D:\QPMS_CRM\artifacts\thermography-report-validation-20261115`.
Final browser screenshots at 1440/768/390 and synthetic summary are in `browser-final`.

## Required release gates and order

1. Review exact candidate diff; preserve dirty root and unrelated worktrees.
2. Run prepared `supabase/verification/*thermography*read_only.sql` with separately
   authorized read access. Review installed RLS, ACL, function definitions, Storage
   policies, existing counts and any existing target bucket. Never assume proposals
   were installed and never install old proposals blindly to satisfy prerequisites.
3. Review the provisional 25 MiB cap, actual sample workbook compatibility, native
   multi-session finalize/replace races and real private Storage upload/download.
4. Obtain a dedicated reviewed full-stack Thermography CI payload authorization.
   Existing `.github` guards/pins are unchanged: this new backend/schema scope is
   outside the old UI-only allowlist. No CI bypass or borrowed Training/DC exception.
   Required remote CI has NOT run; no commit or PR was authorized for this candidate.
5. After explicit approval and backup/recovery review, install this additive migration
   first, then release backend and frontend. Verify post-install read-only invariants,
   authorization with separate states and the full upload/rework/approve/delete/restore
   lifecycle using separately authorized disposable production acceptance data.
6. Compare filtered table/export/KPI counts; verify legacy records/history unchanged.
   Confirm no Deep Cleaning, Training, Attendance, KM or mobile changes in release.

Rollback: set Thermography-only `THERMOGRAPHY_REPORT_WRITES_ENABLED=false` through a
separately authorized configuration change to pause writes while keeping downloads.
Do not drop new schema/bucket/history or revert to a writer that bypasses report guards.
Retain a compatible read/download service until an explicit recovery plan is approved.
No permanent retention/purge policy is authorized. No deployment trigger was activated.

**Readiness: locally implemented and tested; production release BLOCKED pending these gates.**

## Exact candidate files

Modified: `package.json`, `package-lock.json` (pinned dev-only PGlite; no runtime upgrade);
`backend/routes/relianceRetailManagementRoutes.js` (Thermography router mount only);
`backend/services/retailModuleReportService.js`, `backend/shared/retailOperations.js`
(Thermography-only read/cohort/count logic);
`src/pages/reliance-retail/RetailDashboard.jsx`, `RetailMisWorkspace.jsx`,
`RetailOperations.jsx` (Thermography integration only);
`src/utils/retailExecutiveReport.js`;
`tests/browser/retailReportVisualSmoke.spec.js`, `tests/retailOperationsShapeBrowser.test.js`.

Added: `backend/routes/thermographyReportsRoutes.js`;
`backend/services/thermographyReportsService.js`, `thermographyWorkbook.js`;
`backend/tests/helpers/thermographyFixture.js`, `thermographyServiceFixture.js`;
`backend/tests/thermographyReports.database.test.js`, `thermographyReports.test.js`;
`src/components/reliance-retail/ThermographyReports.jsx`, `thermographyReports.css`;
`src/utils/thermographyReports.js`; `tests/thermographyReports.test.js`,
`tests/thermographyReports.browser.test.js`; the migration above;
`supabase/verification/retail_thermography_reports_preflight_read_only.sql`,
`retail_thermography_reports_postinstall_read_only.sql`; this release document.

## Focused release-blocker verification — continuation

Current branch/base unchanged. No commit, push, production migration or deployment.
Only Thermography files and its fixtures were extended; KM worktrees were untouched.

| Check | Result | Evidence / remaining gate |
| --- | --- | --- |
| Installed production schema and Storage | BLOCKED | No Supabase connector or read-only DSN available; Railway status again returned Unauthorized. No installed schema/policies/records inferred from repository SQL. |
| Native PostgreSQL concurrency | PASS | PostgreSQL 17.6, separate simultaneous service-role sessions, actual prepared migration and reused fixture. Lock waits are observed in pg_stat_activity before committing the first session. |
| File-size consistency | Local PASS; production BLOCKED | 25 MiB (26,214,400 bytes) ceiling; actual private bucket cap read before reservation/finalization and when advertising UI limit. Project-wide Storage cap and deployed proxy configuration unavailable. |
| CI authorization | BLOCKED | Existing guards remain unchanged; full-stack payload needs independent exact-content authorization plus explicit Thermography CI steps. |

Native test: `backend/tests/thermographyReports.concurrent.test.js`, enabled with
`RUN_THERMOGRAPHY_NATIVE_POSTGRES_TESTS=true`; six lifecycle subtests plus parent
passed (7/7, no skips). Covers same-request prepare/finalize races, distinct concurrent
replacement reservations, competing replacement finalizations, both approval/rejection
orders, same approval replay and replacement finalization versus stale approval.
Exactly one active version wins; stale operations return 40001; revised bytes remain
awaiting approval. Prior versions remain preserved. No production-code concurrency
change was necessary.

Helper `nativeThermographyPostgres.js` uses the existing isolated pg 8.16.3 driver and
PostgreSQL binaries. Explicit `THERMOGRAPHY_TEST_TOOLS_DIR` and
`THERMOGRAPHY_TEST_PG_BIN` support a provisioned CI runner without changing application
dependencies. The default Windows artifact path avoids restricted-user initdb failure
under another user's profile. Linux portability is prepared, not executed this run.
CI must explicitly enable this test, not accept its default opt-in skip as validation.

Limits tests: `backend/tests/thermographyReports.limits.test.js` (3/3 passed).
Boundary 25 MiB accepted, +1 byte rejected; lower bucket cap honored; public, absent,
oversized or incorrectly typed bucket configuration fails before version reservation.
Photo-heavy valid XLSX: **23,989,146 bytes**, valid embedded PNG, formula and multiple
worksheets. Original-byte comparison and ExcelJS reopening passed through isolated
Storage. This is a synthetic capacity test, not acceptance of a real client sample.
Six existing service tests passed after the bucket-check change; four existing SQL
tests and six frontend calculation/preservation tests passed. Browser lifecycle
rerun passed 1/1 after the new bucket check (one initial page.goto navigation timeout;
rerun passed without increasing timeouts or changing application code). Total current
focused checks: 27 passed across these runs. Scoped lint passed for changed code/tests.

File-size path:
- Browser SHA/selection uses server max_bytes, bounded above by 25 MiB.
- Prepare/finalize use min(backend configured cap, actual private bucket cap).
- DB version constraint and prepared bucket maximum are both 26,214,400 bytes.
- Express global JSON limit is 10 MB, while these endpoints accept only small JSON
  metadata. The workbook PUT goes directly to Storage; raising global JSON limits is
  unnecessary and would affect unrelated modules.
- Finalization streams to temporary disk; proxy download streams exact stored bytes.
  Original confirmed downloads retain the 25 MiB historical ceiling even if new
  uploads are configured lower.
- No custom nginx/proxy upload override was found in the tracked candidate. The
  deployed Railway settings are not available. The frontend PUT timeout is 120 seconds;
  backend Storage fetch timeout is 60 seconds and ZIP validation timeout is 30 seconds.
  Representative-network acceptance at the chosen cap remains a release gate.

Supabase's project-wide limit also applies; bucket metadata cannot prove that limit.
Read Storage Settings/authorized Management API and verify global cap >= chosen bucket
cap. Do not change the global setting automatically because other modules share it.
References: https://supabase.com/docs/guides/storage/uploads/file-limits and
https://supabase.com/docs/guides/storage/uploads/standard-uploads . Supabase recommends
resumable uploads above 6 MB for reliability; standard upload is supported beyond
that. This task preserves the existing signed PUT/retry identities and makes no TUS
rewrite. Test slow-network retry at 25 MiB before production acceptance.

Read-only preflight now includes new metadata/version/event/request objects if
installed, owner/ACL/RLS/index/constraint/trigger definitions and relevant RPC bodies.
It still cannot verify project-global Storage configuration. Do not execute against
production without the authorized read connection; no migration has been applied.

### Minimum safe CI authorization path

`reliance-retail-operational-changes.yml` already triggers on shared Retail backend
and page changes, but does not execute the new Thermography suites. The separately
triggered `retail-ui-visual-checks.yml` rejects unreviewed backend/SQL/new-component
paths and controls by design. Existing Training/DC exact-payload exceptions do not
authorize this feature. The mounted-auth workflow does not trigger automatically
for a new router when server.js is unchanged, so explicitly include existing mounted
authorization checks in the reviewed Thermography verification.

Required independent maintainer/security review:
1. Freeze the exact base and complete candidate path/blob manifest, including the
   additive SQL, bucket policies, shared-file hunks and dependency-lock change.
2. Add a dedicated one-time Thermography exact-content authorization in a separately
   reviewed CI change. Pin its guard/manifest identity; reject extra/missing/modified
   files, alternate base, protected-module edits and guard tampering. Add negative
   tests. Do not broaden generic UI-only paths or borrow another feature's exception.
3. Keep all existing required jobs/security checks active. Add explicit Thermography
   backend/DB/limits/frontend/browser/scoped-lint checks and native PostgreSQL 17
   multi-session execution with a provisioned isolated pg driver. Do not silently skip
   native tests. Preserve deployment/migration approval gates and read-only CI tokens.
4. Have that authorization reviewed through normal branch protection, then run all
   applicable required CI on the final authorized payload. No remote checks were run
   in this uncommitted worktree. Do not bypass the UI guard to obtain a green badge.

### Required order

Authorized production read-only preflight and global Storage/proxy check -> independent
CI payload authorization and green required checks -> explicit migration/release
approval -> backup/recovery review -> apply only
`20261115140000_retail_thermography_reports.sql` once (creates metadata/private bucket/
policies atomically; existing prerequisite drift must be resolved before proceeding)
-> post-install read-only checks -> backend -> frontend -> separately authorized
private upload/download/rework/approval acceptance and count reconciliation.
No prerequisite proposals installed blindly; no global upload-size increase; no
production mutation was performed during this verification.

Continuation additions: `backend/tests/helpers/nativeThermographyPostgres.js`,
`backend/tests/thermographyReports.concurrent.test.js`,
`backend/tests/thermographyReports.limits.test.js`. Minimal updates: existing fixture
injection/bucket metadata mock, Thermography service/router effective-limit enforcement,
preflight inspection coverage and this report. **Final production verdict: NO-GO.**
