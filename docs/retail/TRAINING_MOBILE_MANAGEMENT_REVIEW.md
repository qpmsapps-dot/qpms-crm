# MEPC management mobile extension — PR #129

27 November 2026. Isolated worktree `.worktrees/training-mepc-ui-v3-20261127`, branch `feat/reliance-training-mepc-ui-v3`. Incremental baseline `0b028ef560e610d3894f2822785380468931a306`; stacked dependency PR #126 remains `65b5d3ce2b7af23d270022c887c920e5f26cc503`. Draft PR: https://github.com/qpmsapps-dot/qpms-crm/pull/129.

## Behavior and authorization

- MEPC-MIS was excluded from the mobile login role master. Explicit `MIS_MEPC` now qualifies only with an active authenticated, mobile-enabled Reliance Retail profile. Registration choices and live permissions are unchanged. Department/designation does not grant this role or an FO category.
- Reliance Retail Operations Managers already qualified for mobile login. Both management roles now land directly in a Training shell. MEPC-MIS has no operational-workspace entry; Operations Managers retain a link to their pre-existing workspace. FO/HomeShell navigation is unchanged. MIS resume does not start/synchronize FO tracking.
- The single-page MEPC form is shared through a presentation interface. A separate management controller uses management creation, never the FO creation controller, fake attendance, site visits or an always-true FO context callback. The original FO controller's attendance/context checks remain intact; its only structural change is the shared presentation superclass and override annotations.
- Exact Store Code and actual trainer employee code resolve through the existing protected management setup. The backend and database bind the authenticated uploader independently. Date is today in IST, enforced by server and database, including later draft writes. No backdate or future-date exception is activated.
- Active MEPC topics, required verified topic photographs and completion proof reuse V2's immutable policy-2 snapshot and existing private Storage verification. Pending uploads never satisfy submission. Camera/gallery and completion-proof PDF/image selection use existing file limits and validation; common evidence queues retain retries.
- A durable user-specific local intent freezes the creation payload before its first request. Accepted session IDs are persisted before fetching details; response-loss retries reuse the exact key and payload. Multiple store/date sessions remain legitimate; overlap warnings are retained. Explicitly closing a local report does not delete or cancel server history; users are warned to check existing reports before creating a separate report.
- Permitted MEPC list/detail/evidence reads use the same existing reporting contracts. Branch Heads retain regional HK/MEPC reporting and cannot use management creation. HK-MIS, FO, KAM, Branch Head and Admin are denied this dedicated mobile-management creation contract.

## Proposed database contract — not executed in production

[Migration](../../supabase/migrations/20261127120000_training_mobile_management_provenance.sql) depends on the unchanged PR #126 migration. It checks the exact V2 editor body/security/search path before making any additive change, and fails atomically on drift or replay.

1. Add private `mobile_management_enabled`, default **false**. Existing `web_enabled` must independently authorize admission; enabling Web alone cannot enable management mobile.
2. Add service-only setup-admission and creation RPCs. Creation calls the original Web/management RPC in the same transaction and uses an actor-bound reserved key namespace. No FO context is created. Web HTTP creation rejects reserved management keys.
3. Record `management_mobile_created_v3` atomically in `training_events`, with uploader, actual trainer, date, timestamp and channel. Retry verifies provenance and records only one event.
4. Preserve the exact complete V2 draft-editor body privately and execute it before the new mobile gate/profile/date checks. Replace the public function body in place, retaining its OID and all existing caller/dependency targets; native tests verify the unchanged OID and exact preserved body. The private original/helper are not directly executable by browser or service roles; the public wrapper retains service-only admission. Existing child/evidence/submission RPC paths remain in force.

`submission_source=Web` remains the existing management authorization family, **not** a claim that the report came from the Web UI. The separate server-derived `submission_channel` is `Mobile Management`, `Web`, `FO Mobile` or `Unknown`, based on trusted transactional audit provenance. Lists, details, leadership/MIS reports, OM register/export and the MEPC drawer expose the distinction without reclassifying historical unknown records. No client-supplied channel is trusted.

No production SQL, entitlement grants, Storage/RLS changes, topic/category master changes, APK, signing change, merge or deployment occurred. Both management release gates remain disabled by default. No automatic MEPC category grants are added.

## Mobile screenshots

Synthetic Flutter widget renders with actual bundled fonts and the existing application theme; not authenticated production or physical-device acceptance.

| View | Image |
|---|---|
| MEPC-MIS direct entry | [MIS entry](screenshots/training-phase3-management/mepc-mobile-management-mis-entry.png) |
| Operations Manager entry and preserved workspace | [OM entry](screenshots/training-phase3-management/mepc-mobile-management-om-entry.png) |
| Shared MEPC form and existing master topics | [Form](screenshots/training-phase3-management/mepc-mobile-management-form.png) |
| Topic photograph camera/gallery choice | [Photo source](screenshots/training-phase3-management/mepc-mobile-management-photo-source.png) |
| Completion proof, remarks and Submit | [Completion proof](screenshots/training-phase3-management/mepc-mobile-management-completion-proof.png) |

## Validation

Completed Phase 2/3 validation is reused; the production inventory/audit was not repeated. Focused fresh results and the exact changed-file list are recorded below after final verification. The original shared verifier, 85 unauthorized probes, prior Training/Thermography workflows and HK screen stay unchanged; revised manifests pin only the reviewed exact payload.

During expanded native testing, pre-existing fixture zone grants and a verified Retail assignment initially invalidated two expected-denial preconditions. The fixtures now explicitly remove the earlier zone coverage and change the actual business assignment, instead of assuming an extra zone grant or profile label revoked existing coverage. The rejection assertions remain and pass. Screenshot font/capture fixes affect only the test harness. One final parallel local run stalled before the disposable Windows PostgreSQL server produced a log or PID file; it ended with 220 passing tests and one fixture-startup failure, before SQL assertions ran. Only that executable/start-time-verified disposable process was stopped. The unchanged complete group then passed serially: 238 tests, including all 18 native tests, zero skips. Both attempt logs are retained locally; no application assertion was suppressed.

## Final local results

| Check | Result |
|---|---|
| Full Training mobile unit/widget regression | 103 PASS, zero skips |
| Existing mobile roles, auth recovery, split-auth and checkout guards | 35 PASS, zero skips |
| Focused backend/authorization/reporting/SQL regression | 238 PASS, zero skips, including 18 native PostgreSQL tests |
| Web upload and regional reporting/export browsers | 3 PASS, zero skips |
| Shared CI, direct Attendance/Thermography and Phase 3 integrity guards | 229 PASS, zero skips |
| Original unauthorized-change probes | All 85 rejected |
| Original preservation assertions | All 11 executed |
| Exact pinned payload verifier | PASS; no missing, unexpected or mismatched paths; 67 cumulative PR paths |
| Dart analysis, scoped ESLint, production Web build | PASS; existing Vite chunk/import warnings only |

Commands used isolated fixtures and loopback PostgreSQL, with Supabase environment values empty. The final Node group ran with `node --test --test-concurrency=1 --test-reporter=tap`; local evidence is in `.phase4-test-output/management-training-serial-final.tap`. Integrity evidence is in `management-integrity-final.tap`, and the combined 138-test Flutter result in `management-mobile-combined-final.txt`. Mobile commands were Flutter 3.44.1 tests/analysis only. No APK was built. Source checks and synthetic browsers do not establish authenticated production or physical-device acceptance. Hosted CI must be checked on the pushed PR head; see the PR status/description for the head-specific result.

The mobile focus covers explicit management admission, no FO creation/context, the dedicated API routes, uploader/trainer separation, exact durable retry after restart, explicit evidence retry after the automatic batch cap, invalid/pending evidence denial, read-only submissions, and the shared form/screenshots. Native coverage includes two independent disabled gates, drift rejection before DDL, MIS/OM creation, TN/PY and unauthorized region/store/zone/business denial, concurrent same-key creation, provenance exactly once, profile revocation, mandatory evidence, unique FO/Web/management report counts, reporting-only roles, service-only ACLs, HK regression and compensating gate rollback without deleting records. Existing FO entitlement-revocation/submission concurrency assertions still execute.

## Exact incremental changed files

40 files relative to the previously reviewed Phase 3 head at 0b028ef5. The complete PR has 67 pinned paths relative to PR #126. CI metadata changes only renew exact hashes and add focused tests; shared verifier/probes and original Training/Thermography/Attendance checks are unchanged.

```text
.github/shared-integrity-pins.json
.github/shared-training-pins.json
.github/workflows/reliance-training-phase3.yml
.github/workflows/retail-ui-visual-checks.yml
Mobile_FO_V2/lib/app.dart
Mobile_FO_V2/lib/services/supabase_service.dart
Mobile_FO_V2/lib/training/data/training_api.dart
Mobile_FO_V2/lib/training/models/training_session.dart
Mobile_FO_V2/lib/training/screens/management_training_shell.dart
Mobile_FO_V2/lib/training/screens/mepc_training_screen.dart
Mobile_FO_V2/lib/training/state/management_training_controller.dart
Mobile_FO_V2/lib/training/state/mepc_form_controller.dart
Mobile_FO_V2/lib/training/state/training_flow_controller.dart
Mobile_FO_V2/lib/utils/mobile_roles.dart
Mobile_FO_V2/test/training/management_training_review_test.dart
Mobile_FO_V2/test/training/management_training_test.dart
backend/routes/trainingRoutes.js
backend/services/retailMisService.js
backend/services/retailModuleReportService.js
backend/services/trainingAccessService.js
backend/services/trainingMobileManagementService.js
backend/services/trainingService.js
backend/services/trainingSubmissionChannel.js
backend/services/trainingWebService.js
backend/shared/retailMisAccess.js
backend/tests/trainingMobileManagement.test.js
backend/tests/trainingV2Database.test.js
docs/retail/TRAINING_MOBILE_MANAGEMENT_RELEASE_PLAN.md
docs/retail/TRAINING_MOBILE_MANAGEMENT_REVIEW.md
docs/retail/TRAINING_PHASE3_REVIEW.md
docs/retail/screenshots/training-phase3-management/mepc-mobile-management-completion-proof.png
docs/retail/screenshots/training-phase3-management/mepc-mobile-management-form.png
docs/retail/screenshots/training-phase3-management/mepc-mobile-management-mis-entry.png
docs/retail/screenshots/training-phase3-management/mepc-mobile-management-om-entry.png
docs/retail/screenshots/training-phase3-management/mepc-mobile-management-photo-source.png
src/components/reliance-retail/TrainingV2Drawer.jsx
src/pages/reliance-retail/RetailTrainingUpload.jsx
supabase/migrations/20261127120000_training_mobile_management_provenance.sql
supabase/proposals/training_mobile_management_rollback.sql
tests/trainingRegional.browser.test.js
```

## Release candidate plan and remaining acceptance

See [the mobile release candidate checklist](TRAINING_MOBILE_MANAGEMENT_RELEASE_PLAN.md). Development/CI readiness does not authorize production release. Distributed APK version/signer, physical camera/gallery/device behavior and authenticated staging acceptance remain release prerequisites. The original dirty root retained 946 entries, with main at `d1ef6d6d`; it was not used for implementation.
