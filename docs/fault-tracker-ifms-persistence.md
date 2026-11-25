# Fault Tracker IFMS persistence review

Branch: `fix/fault-tracker-ifms-stage-persistence`.
Base: GitHub main `f3dc10a7` (refreshed this run, 25 November 2026).
Implementation is isolated under `.worktrees/fault-tracker-ifms-stage-persistence`.
The dirty root checkout and all other worktrees were preserved.

## Cause and behavior

Source-derived and confirmed by read-only installed-function inspection: uploads create
new snapshot IDs; the existing two save RPCs store history against the old snapshot ID
and update only that old ticket row. Reports previously used the latest Excel stage
without resolving history across snapshots.

The patch reuses `fault_tracker_ticket_updates`. Its identity is the exact verified
batch source `Reliance Retail IFMS`, trimmed/uppercased ticket number and Store Code,
plus the unique canonical Store Master ID. Leading zeros and punctuation are retained.
Names, Excel state labels, file names and client-supplied source metadata do not identify tickets.

Legacy history must have a matching actor profile/auth/employee identity, workflow
version 1, UUID request ID, recognized update type, one of the existing 14 stages and
a non-null remarks value. New events additionally pin the identity in server-issued
metadata. The latest qualifying event wins by `created_at DESC, id DESC`.
Empty remarks are an explicit saved value; they never fall back to Excel remarks.
A recreated store cannot inherit new pinned history. Legacy events have only their
original FK and unique Store Code as historical store evidence; ambiguous master codes
fail closed. Missing/deleted/mismatched actor evidence is excluded.

Authorization still scopes eligible active stores and allowed states before the
retention RPC runs. Retained values are applied before stage/search filters, detail
lookup and pagination. Existing frontend mapping, dashboard counts, drawer initialization,
filters and Excel export already consume that common stage/remarks/version projection.
No frontend implementation or upload/export format change is needed.

Excel rows and raw JSON remain separate from manual history. Ageing, source dates,
category and other imported information refresh from each upload. New saves append
history without rewriting imported rows. Existing historical rows and events are not
rewritten; older rows mutated by the pre-fix RPC remain as they were, with original
Excel evidence in `raw_row`. Opening a historical batch uses its source fields with
the current retained manual overlay, rather than fabricating an as-of manual snapshot.

## Database requirements — NOT APPLIED

Review `supabase/migrations/20261125120000_fault_tracker_ifms_persistence.sql`.
It replaces both existing update RPC bodies while retaining their authorization checks
and ACLs. It adds service-only retained-history and atomic-import RPCs, private helpers
and identity/history indexes. The old per-batch ticket-number uniqueness becomes
per-batch normalized ticket/store uniqueness, so same-number tickets at different stores
are not collapsed.

The migration checks the installed update-function body fingerprints measured this run:
`rpc_retail_fault_update = c1eb37f6b5cac6031791273a55ce4530`;
`retail_mis_fault_update = 7d0f7ab70f1f94eb01388ba6f526d961`.
Installed foreign keys, uniqueness, policies and absence of custom triggers were also reviewed read-only.
Drift aborts installation. Replacement preserves the private MIS helper ACL and the
existing service-only public update RPC. No RLS policies, roles, assignments or dropdown
options change. No history table, production backfill or fabricated recovery event is added.

Imports publish batch and source rows in one transaction, serialized by source.
Saves serialize by stable identity, including across different snapshot IDs. Effective
history timestamps are optimistic versions; stale commands return SQLSTATE 40001
(existing API 409 mapping). Same request/actor/payload replays without another event;
changed commands fail. Imports never copy or replace manual data, so import/save ordering
cannot erase a save. Duplicate Excel files retain the existing behavior of adding a
new source snapshot, with no extra manual events or loss of manual state.

Coordinate a separately approved database/backend cutover with Fault Tracker imports
quiesced during installation. Do not leave the new backend running without its RPCs:
it returns 503 instead of silently showing reset values. Refresh open drawers after
cutover because their old row timestamps differ from retained-history versions.
Existing-table index creation takes locks; rerun preflight and review the maintenance
window and lock timeout before approval. An old backend rollback alone is insufficient
to retain the new projection; plan rollback with manual writes paused.

## Recovery verification — read-only production preview

Measured 25 November 2026 through the connected Supabase read-only SELECT operations.
The 13 identities below are the original 23 November affected cohort (13 distinct
ticket/store identities, including a repeat save for one ticket). The exact proposed
verified-history SELECT was inlined in
`supabase/verification/fault_tracker_ifms_recovery_read_only.sql` and executed without
installing any function or changing any row.

Result: **13/13 recoverable**, all with one canonical store match and explicit empty
remarks. Ten still have `IN_PROGRESS` in the current source row. Three CAMC tickets
were subsequently manually restored on 25 November; their newer verified events win.
There are zero normalized per-snapshot identity duplicates and zero workflow-event
timestamp ties in the read-only preflight measured this run.

| Ticket | Store | Retained stage | Verified event | Latest source ageing |
| --- | --- | --- | --- | --- |
| CM1780058855626 | TA7E | Fund Released - Work in Progress | `d073b915-2fde-42ac-8e83-ad50ea20d129` | 180 |
| CM1781531434258 | TA7E | Fund Released - Work in Progress | `467d9243-f127-4b2a-881b-43957dfedcd2` | 163 |
| CM1781943031227 | U1CX | Fund Released - Work in Progress | `07dc4b1f-f0fc-466f-9317-52ad6fc03ccb` | 158 |
| CM1781954407593 | TA7E | CAMC | `bad4b4a5-9696-4e59-bf0c-b809bb98f12c` | 158 |
| CM1782283393739 | T86A | CAMC | `263892b1-3a0e-49e4-a975-693c540cb5e3` | 154 |
| CM1783753693669 | T9NZ | CAMC | `5a4dc79f-e2ea-42b7-9d6f-2aa7956ef527` | 137 |
| CM1784389900813 | TA7E | Fund Released - Work in Progress | `903e73b9-b557-4cb4-a647-48683aac0659` | 130 |
| CM1785818914364 | TW83 | Fund Released - Work in Progress | `44661a00-b30c-4f7c-8a0e-430acf74819d` | 113 |
| CM1791557165610 | TA7E | Fund Released - Work in Progress | `4f0f64bd-3b3d-4937-b441-79fd1ea881d9` | 47 |
| CM1791557933342 | TA7E | Fund Released - Work in Progress | `114b3d26-e25b-4029-9f7e-99e618f02305` | 47 |
| CM1791558095830 | TA7E | Fund Released - Work in Progress | `c6068af2-d176-4d29-8026-426b67b84f15` | 47 |
| CM1791558326013 | TA7E | Fund Released - Work in Progress | `f172222b-0e73-4bf7-8fbb-f3a4ad755091` | 47 |
| CM1791961001972 | TL34 | Fund Released - Work in Progress | `813a659e-2c35-4d12-99fb-e07dec8ecda7` | 42 |

This is recovery verification of the proposed read projection, **not an applied
production recovery**. After separately approved installation and backend release,
the resolver recovers the verified values on read without a destructive data rewrite.
Rerun the preview, compare the API's `manual_update_id`, stage and empty remarks,
and complete authenticated state-scoped browser acceptance. Those steps remain pending.

## Validation

Local dependencies were installed from cache using `npm ci --offline --ignore-scripts
--no-audit --no-fund` in the isolated root/backend; no lifecycle scripts, app builds
or environment files were loaded. Host Node is 24.16.0; CI explicitly uses Node 22,
which is the backend's configured engine.

- Disposable loopback PostgreSQL: actual migration, both original RPC definitions and
  synthetic profiles/stores/history. All 14 stages; repeated/duplicate imports; remark
  editing and clearing; 13 legacy recovery fixtures; new/reopened tickets; store/source
  collisions; idempotent retry; stale concurrent saves across snapshot IDs; overlapping
  imports/saves; transactional batch visibility/rollback; verification rejection;
  state filters/detail/export; service/private RPC privileges.
- Existing source/mocked/local-HTTP tests: Fault Tracker Store Code/state scope,
  exact editor allowlist, unauthorized requests and workflow caller actor binding.
- Existing frontend functions executed with Node VM: mapping, dashboard stage selection,
  filtering, drawer stage/remarks/version initialization and Excel export for all 14 stages.
  This is source-level verification, not an authenticated browser test.
- Scoped ESLint, server syntax and `git diff --check`.
- New dedicated GitHub workflow runs the scoped tests plus disposable local PostgreSQL.
  No production connection, credentials, migrations or deployment are configured.

Final local result: **29 passed, 0 failed, 1 skipped** across the five scoped files,
including all 10 tests/subtests in the new disposable PostgreSQL suite. PostgreSQL was
17.6 on Windows. Scoped ESLint, server syntax and diff whitespace checks passed.
Run the five files explicitly with `RUN_IFMS_PERSISTENCE_POSTGRES=1`; the native fixture
needs the existing isolated `pg`/embedded-PostgreSQL tools, or the documented helper's
`THERMOGRAPHY_TEST_TOOLS_DIR` and `THERMOGRAPHY_TEST_PG_BIN` overrides. The added CI
workflow supplies its own temporary tools and local PostgreSQL. CI is pending PR creation.
The optional older
Docker-backed workflow-gap integration is not enabled locally; the new PostgreSQL test
exercises this patch directly. Authenticated production browser acceptance is pending.

## Files and exclusions

Application changes: `backend/server.js`, `backend/services/faultTrackerStoreScope.js`,
`backend/services/faultTrackerPersistence.js`.
Database artifacts: the new migration and read-only recovery query.
Tests: new PostgreSQL/frontend tests and updated existing Store Scope/workflow mocks.
CI: dedicated Fault Tracker persistence workflow. Documentation: this review.

No Call Movement Dashboard, other module implementation, mobile/APK work, existing
role permissions, dropdown options, upload formats, merge, production mutation or deployment.
