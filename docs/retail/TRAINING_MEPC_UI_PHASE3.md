# MEPC Training mobile and Web UI: isolated development increment

Historical first-increment record. The completed implementation and CI review supersede the pending items below: [Phase 3 review](TRAINING_PHASE3_REVIEW.md).
27 November 2026.

## Isolation
Branch feat/reliance-training-mepc-ui-v3; worktree D:/QPMS_CRM/.worktrees/training-mepc-ui-v3-20261127; based on PR #126 candidate 65b5d3ce2b7af23d270022c887c920e5f26cc503. Changes are local and uncommitted; no push/new PR. PR #126's checkout and candidate remain unchanged. The original root checkout retains its 946 pre-existing dirty entries.

## Implemented
Mobile reuses the existing Training category picker, store/context/entitlement workflow, topic masters, evidence compression/upload/retry cache and wizard. It now parses/preserves completion_policy_version and requires verified per-topic photographs/coverage plus verified completion proof before enabling new policy-2 MEPC submission. The evidence/review screens identify the completion-proof requirement. Historical policy 1 and the separate HK screen are unchanged.

Web adds a compact MEPC upload panel to the existing operational Training view and MEPC-MIS Training workspace. An exact store-code/trainer-code setup endpoint returns canonical identities and existing active masters only after the authoritative category/store/date/release contract admits the uploader. A narrow existing MEPC-MIS route exception adds only this exact setup path; no role assignment or database grants are changed.

Creation records the actual trainer separately from authenticated uploader through the existing Web RPC. Conducted date is today-only in this UI; the server still enforces its approved date policy. The form uses existing topic/evidence/content/completion/submit contracts; it creates no attendance or visit rows. Every selected topic needs verified evidence and completion proof. Pending HTTP success is not accepted as verified evidence.

A durable browser-local creation key/payload recovers a lost creation response. Persisted session/topic identities support resume and retry after failed topic saving. Content/topic upload keys recover evidence intents; incomplete intent IDs can be removed using the existing guarded deletion path. Repeated actions are serialized in the component. Overlap warnings persist; store/date alone never enforces uniqueness. Submitted records lock editing. These synthetic checks do not prove physical-device, production, cross-tab atomicity or browser storage durability outside the tested environment.

Web admission remains controlled by training_v2_assert_web and the existing false database policy. No SQL, migration, category/topic master, release policy or grant was edited/executed. No MEPC allocation was created.

## Files
- Mobile_FO_V2/lib/training/models/training_session.dart
- Mobile_FO_V2/lib/training/state/training_flow_controller.dart
- Mobile_FO_V2/lib/training/screens/training_evidence_step.dart
- Mobile_FO_V2/lib/training/screens/training_review_step.dart
- Mobile_FO_V2/test/training/training_mepc_completion_test.dart
- backend/services/trainingWebService.js
- backend/services/trainingAccessService.js (specific gate-denial message)
- backend/routes/trainingRoutes.js (authenticated setup endpoint)
- backend/shared/retailMisAccess.js (exact MEPC-MIS setup path)
- backend/tests/trainingWebSetup.test.js
- src/utils/trainingWebUpload.js
- src/components/reliance-retail/TrainingWebUpload.jsx
- src/components/reliance-retail/trainingWebUpload.css
- src/pages/reliance-retail/RetailTraining.jsx
- src/pages/reliance-retail/RetailMisWorkspace.jsx
- tests/trainingWebUpload.test.js
- tests/trainingWebUpload.browser.test.js
- This document and TRAINING_RELEASE_CHECKLIST.md.

## Focused validation
- Node: node --test backend/tests/trainingWebSetup.test.js backend/tests/trainingV2Services.test.js tests/trainingWebUpload.test.js — 13 PASS, zero skips.
- Browser: node --test tests/trainingWebUpload.browser.test.js — 1 composite PASS, zero skips. Synthetic loopback fixtures cover gate denial, lost-response idempotency/resume, required photo/proof, read-only role visibility, submitted-state lock and 390px layout. No external hosts allowed. Screenshots: .phase4-test-output/screenshots/mepc-web-desktop.png and mepc-web-mobile.png.
- Flutter: flutter test --no-pub test/training/training_mepc_completion_test.dart test/training/hk_training_screen_test.dart test/training/training_category_picker_test.dart test/training/training_cache_repository_test.dart — 22 PASS.
- Dart analysis of the four changed library files plus new test — no issues. Scoped ESLint passes; formatting applied.
- Production Web build with an empty env directory passes (existing mixed-import/large-chunk warnings). No production environment files loaded.
- Initial browser locator timeout was corrected by an explicit accessible label on Training type; the full scenario then passed. No check was skipped or disabled.
- Flutter's workspace sandbox could not obtain the SDK cache lock; offline pub resolution/tests ran with approved local SDK access. No APK build. Generated plugin files had only line-ending changes; all seven were verified content-identical and returned to their original line endings.

## Not release ready
The user requested no repeated inventory/production audits; the earlier verified inventory is reused. The owner will inspect current backups directly. No production SQL was executed in this development task. Authenticated HK smoke, recovery evidence and production old-backend/new-DB transition acceptance remain open (see checklist).

Shared content-pinned integrity manifests/workflows/assertions were not changed or bypassed. Phase 3 modifies additional protected Training payloads and is not yet packaged/approved against those existing CI pins. Hosted CI was not dispatched for this uncommitted branch; no merge readiness is claimed. The wider completed suites and production inventory were not rerun. Review the Phase 3 scope and preservation manifest requirements before any commit/push/PR integration.

Attendance/GPS/KM/payroll/site-visit logic, User Management assignments, existing HK single-page UI, schema/RLS, PR #126 migration and production configuration were not changed. Test Storage is synthetic; existing live evidence was not read, copied, replaced or deleted.
