# Training Phase 3 review

This is the original Phase 3 baseline review at `0b028ef5`. The current mobile-management extension, proposed additive database guard, fresh validation and release prerequisites are documented in [the management mobile review](TRAINING_MOBILE_MANAGEMENT_REVIEW.md). Statements below about FO-only mobile creation and no proposed SQL describe that earlier baseline.
27 November 2026. Branch `feat/reliance-training-mepc-ui-v3`, stacked on PR #126 at `65b5d3ce2b7af23d270022c887c920e5f26cc503`. Do not merge before the dependency or infer production approval.

## Completed
- MEPC single-page mobile form: canonical store, IST date, FO/trainer, type, topics, required topic photographs, completion proof, remarks and Submit. HK interaction pattern reused; HK screen source stays unchanged. New/policy-2 MEPC uses this screen; historical policy 1 keeps its original flow.
- Explicit FO categories from the authenticated server: HK only, MEPC only, both or none. No department/designation inference. Only FOs receive mobile creation; existing Super Admin independent save/revision/audit controls from PR #126 are reused.
- MEPC-MIS upload in its existing Training workspace. Operations Manager upload has a separate `/reliance-retail/training-upload` entry, authorized MEPC register, detail/evidence and Excel download; this does not grant HK dashboard access.
- Protected Web setup resolves exact store/trainer codes and active masters through the existing date/release/store authorization contract. Existing Web creation, evidence and submit RPCs retain uploader/trainer separation, verified photos/proof, idempotency, overlap warnings and scoped access. UI dates are today-only.
- Branch Head regional HK/MEPC reporting is retained and validated for both categories, explicit TN/PY coverage, exclusion of other regions and no upload.
- The existing 15 MEPC topics are displayed without renaming or changing masters. Pending evidence cannot qualify. Submitted sessions stay read-only; active FO attendance/visit, entitlement and all backend security guards remain authoritative.

## Screenshots
Synthetic fixtures only. Mobile images are Flutter widget renders with SDK Roboto/Material Icons, not APK/physical-device acceptance.

| View | Screenshot |
|---|---|
| Mobile details/topics | [Mobile top](screenshots/training-phase3/mepc-mobile-top.png) |
| Mobile proof/remarks/Submit | [Mobile proof](screenshots/training-phase3/mepc-mobile-proof.png) |
| MEPC-MIS setup / 15 topics | [MIS setup](screenshots/training-phase3/mepc-web-mis-setup.png) |
| MEPC-MIS verified evidence | [MIS upload](screenshots/training-phase3/mepc-web-mis-desktop.png) |
| Operations Manager upload | [OM upload](screenshots/training-phase3/mepc-web-om-desktop.png) |
| Operations Manager scoped register | [OM register](screenshots/training-phase3/operations-manager-training-register.png) |
| Branch Head regional report | [Branch Head](screenshots/training-phase3/branch-head-training-regional.png) |
| Reused Phase 2 permission administration | [Desktop](screenshots/training-v2/training-categories-desktop.png), [Mobile](screenshots/training-v2/training-categories-mobile.png) |

## Focused validation
- 89 Flutter Training tests PASS, zero skips: single-page MEPC, HK, entitlement choices, routing, auth, offline cache/queues, retry and submitted immutability.
- 33 focused Node/native tests PASS, zero skips: the real disposable PostgreSQL contract plus Web setup, role/scope, Branch Head categories/regions/evidence and upload identities. No production SQL.
- Three Web scenarios PASS: separate MEPC-MIS/OM upload scenarios and Branch Head/OM regional register/export/evidence-denial scenario. Lost creation response recovery, durable keys, proof/photo requirements, all 15 topic names and 390px layout are checked.
- Scoped ESLint, Dart Training analysis/formatting and production Web build pass; existing mixed-import/large-chunk warnings remain.
- Previous Phase 2 validation and inventory are reused. No repeated production audit. Authenticated HK/device acceptance and owner backup verification remain separate.

Screenshot harness development required moving image capture into real async and normalizing the SDK font directory URI. Both were corrected; no assertions were skipped. A previously unused native selected-topic lookup now asserts existence, adding coverage.

## Exact CI integration
The shared verifier, original 85 unauthorized probes, direct Attendance/Thermography consumers and original Training/Thermography workflows stay unchanged. Shared manifests pin every reviewed Phase 3 path/byte and the exact PR #126 base; the existing UI workflow binds the new manifest hash. No broad file allowances, early returns or skipped assertions.

The new Phase 3 workflow verifies payloads before Node/Flutter tools, runs focused authorization/reporting/entitlement tests, lint/build and Web browsers. Its mobile job pins Flutter 3.44.1 and the setup action commit, resolves the lockfile, analyzes Training and runs the Training folder, without building an APK. The original Training workflow retains native DB checks and adds setup/Branch Head assertions.

The new guard tests reject omission/modification of every Phase 3 file and extra sensitive modules, while asserting unchanged HK source, migration/rollback, shared verifier, probes and prior workflows. Hosted results must be verified on the draft PR's actual head; local success is not production acceptance.

## Scope, dependency and release gates
No SQL/migration/schema/RLS, category/topic master, live permission, release policy, APK, Railway configuration or production record was changed. No MEPC grants were assigned or Web gate enabled. Attendance/GPS/KM/petrol/payroll/site-visit logic and unrelated modules are untouched.

The original dirty root retains 946 entries. PR #126 remains unchanged at 65b5d3ce. Keep this Phase 3 PR in draft; after the separately approved Phase 2 integration, retarget/reverify against main and renew exact pins for the changed base. See [remaining release checklist](TRAINING_RELEASE_CHECKLIST.md).
