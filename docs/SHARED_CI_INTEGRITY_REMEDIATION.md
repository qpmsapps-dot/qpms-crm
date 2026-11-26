# Shared CI integrity compatibility review

26 November 2026. Review and merge approval only; no deployment authorization.

## Baselines and scope

- Reviewed main: `eff30bf06e8d9c66c9fc03be8e5b7b9866b0bab4`.
- Unchanged draft Training PR #126: `5119816a45536d9c1c36ce862f5221051496001c`.
- Branch: `fix/shared-ci-integrity-compatibility`.
- Integration branch: `test/shared-ci-training-integration`, local validation only.
- No application, SQL, mobile, dependency, role or permission changes in this PR.

The rejected six-file patch is not used. In particular, no early-return branch
is added to Thermography tests and no successful exit is added to the UI guard.

## Authorization contract

`sharedIntegrity.mjs` validates the complete delta from the immutable main SHA.
The exact path set and Git blob IDs must match the reviewed CI manifest. The UI
workflow must equal a deterministic transformation of the original main workflow
using the manifest and verifier blob IDs. Unknown paths, missing paths, changed
bytes, changed workflow steps and wrong bases fail closed.

The optional Training delta is a second exact blob map, materialized from PR
#126. This is not a directory allowlist. Application bytes remain unchanged.
Its only integration adjustment is a two-line verifier dispatch to the shared
contract. The original Training verifier's pure tests and rejection assertions
remain. An integrated base is accepted only if its entire delta from reviewed
main is exactly the reviewed CI tree, including its manifest and workflow.

Direct Attendance and Thermography consumers use the same verified workflow
normalization. Existing historical validators retain their pure exact-payload
checks. The original Attendance correction release is independently verified at
`d082110bc1dd3d22fa3ece26c3a8356073077a6d`.

## Assertion execution

Historical release assertions now name the immutable release they describe.
Current changes are checked separately against reviewed main plus the exact
optional Training delta. Historical source comparisons do not authorize current
edits: the independent whole-checkout validation runs first and rejects them.
No imports or functions are erased to approximate application equivalence.

Thermography's eleven applicable preservation assertions execute through the
end of the callback. A terminal assertion and TAP diagnostic record all eleven
calls, including maintenance, migrations, routes and UI checks formerly bypassed
by the rejected proposal. All functional and security tests remain.

The UI guard's existing Phase 6 positive assertion and 42 negative assertions
run before authorization dispatch. Successful authorization records a result
instead of exiting. The ordinary UI-only fallback classifies unclassified
deltas; exact payload contracts classify their full pinned deltas. The OOS
action-region comparisons and subsequent job steps still execute. All 22
existing workflow steps, permissions and triggers are retained.

## Root causes and file responsibilities

| Files | Root cause and correction |
|---|---|
| `sharedIntegrity.mjs`, three shared JSON manifests | Older feature-specific contracts cannot compose; introduce one exact current-delta contract and retain all 85 original mutation cases. |
| `sharedHistoricalChecks.mjs` | Verify the frozen Attendance correction payload against its actual release rather than today's accumulated changes. |
| `retailAttendanceCorrectionGuard.mjs`, `retailAttendanceExceptionsGuard.mjs`, `thermographyV2Guard.mjs` | Direct consumers need consistent shared workflow recognition and current-delta dispatch. Legacy pure validators remain intact. |
| `retail-ui-visual-checks.yml` | A UI-only fallback rejects legitimate cross-layer Training changes; exact authorization now composes without exiting before independent validations. |
| `shared-ci-integrity.yml`, `sharedIntegrity.test.js` | Add continuous mutation, execution-order and direct-consumer verification. |
| Both Attendance guard tests | Old source snapshots reject later merged main changes and the reviewed Training access adapter. Compare current bytes to explicit reviewed main/Training blobs after complete-delta verification. |
| `thermographyFullstackGuard.test.js` | Its operational-workflow baseline predates main's mandatory Fault Tracker tests. Preserve the current main workflow exactly. |
| `thermographyReports.test.js` | Its current-source assertion mixes a historical release with current main and Training. Separate the historical comparisons from independent current-byte authorization and count executed assertions. |

## Independent regression findings

These issues predate this remediation and are not suppressed or repaired here.

1. **Deep Cleaning historical patch comparison** (`deepCleaningMobileIntegration.test.js:151`): the original fixture is normalized to LF, while the patch fixture retains Windows CRLF. LF-only extraction markers consequently fail. In-memory diagnostics show raw mismatch and LF-normalized equality. No fixture or assertion was changed.
2. **Deep Cleaning repeated proposal application** (`deepCleaningStoreOnlyPostgres.test.js:10`): the second application correctly rejects a raw `prosrc` fingerprint differing because of CRLF. The raw body MD5 is `1691b1fbe64ed3dc695eb213ace45aba`; LF is `8e4c39582860e5eb22a0c93670d92f0d`, exactly the proposal pin. No production fingerprint or SQL was changed. Fix test portability separately and retain drift rejection.
3. **Attendance correction preservation**: untouched main first fails on `backend/server.js`, changed by already merged Fault Tracker fixes. Unpatched Training first fails on its explicit `retailMisAccess.js` delta. The old snapshot is not a valid current-main baseline. Current reviewed bytes are now checked without changing application logic.
4. **Attendance exceptions preservation**: the old operational-workflow snapshot lacks later mandatory main tests. Direct workflow compatibility is also required. Current exact workflow preservation and direct-consumer tests now pass.

## Measured isolated regression matrix

Groups overlap; counts are not unique tests. Node 24.16.0, Windows, synthetic
PGlite fixtures and disposable loopback PostgreSQL 17.6; no production env files.

| Group | Untouched main | Main + remediation | Training integration |
|---|---|---|---|
| Training | 202 pass | 202 pass | 219 pass |
| Thermography | 157 pass / 2 fail | 159 pass | 159 pass |
| Native Thermography | 9 pass | 9 pass | 9 pass |
| Deep Cleaning | 311 pass / 2 fail | 311 pass / same 2 fail | 311 pass / same 2 fail |
| Attendance | 86 pass / 2 fail / 1 existing optional skip | 88 pass / 1 existing optional skip | 88 pass / 1 existing optional skip |
| Retail operational | 135 pass | 135 pass | 135 pass |

Additional measured checks: shared/export/preservation group 226 pass; original
Training guard/export group 56 pass on integration; all 85 original unauthorized
probes rejected; UI unit group 289 pass; scoped lint and isolated production web
build pass; Training User Management browser test passes. The existing optional
Attendance real-workbook case was not activated with operational data.

Individual test-name outcomes and failure messages are retained in local TAP
and `individual-outcome-comparison.json`. Training's changed test names come
from PR #126, including its approved separation of FO and reporting roles;
they are not removed by this CI PR.

The initial broad browser run recorded a Deep Cleaning drawer timeout; the
same unchanged test then passed alone on untouched main and candidate. Initial
parallel dashboard browser failures and a Windows artifact-watch error are
retained. Final browser/hosted status must be read from the accompanying review
report; these initial failures are not represented as a green run.

## Integration and merge sequence

1. Review this separate draft CI PR, complete hosted checks and approve it independently.
2. Merge only after explicit approval. This task does not authorize merging.
3. Rebase PR #126 onto the merged CI tree, retaining application, database and
   permission implementation unchanged. Resolve overlapping CI files to this
   shared contract and apply only the exact two-line Training verifier dispatch.
4. Re-run all Training workflows on that actual rebased branch before its own
   separate approval. The local integration is evidence, not a hosted green run
   for the unchanged published PR #126.
5. Resolve the isolated Windows Deep Cleaning portability issues separately;
   do not loosen live database drift checks. Keep both PRs draft pending review.

Rollback is a reviewed revert of CI/test/documentation files only. No database
rollback, entitlement change, APK or deployment is part of this PR.
