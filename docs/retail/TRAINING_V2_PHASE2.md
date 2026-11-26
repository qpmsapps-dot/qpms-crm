# Reliance Training V2 — Phase 2A/2B review

Prepared 26 November 2026. **Draft implementation; no production migration, permission change, deployment or APK build is authorized.**

## Baseline and isolation

- Feature branch: `feat/reliance-training-mepc-v2`.
- Worktree: `D:/QPMS_CRM/.worktrees/reliance-training-mepc-v2`.
- Freshly fetched main and both Railway production services: `eff30bf06e8d9c66c9fc03be8e5b7b9866b0bab4`.
- Backend deployment: `0a65c1cf-cf40-4083-a1b5-625814e059b5`; frontend: `a6427304-a07d-48c3-8adc-143f933ddf76`.
- Root remains `d1ef6d6d` with its pre-existing 946 dirty entries. No reset, stash or root source edits.
- Installed Training functions were re-read through permitted production SELECTs. Their definitions, without records or credentials, are the isolated test baseline fixture. Migration preflight pins normalized installed definitions; drift requires renewed review.
- Current eligible HK FO inventory was recomputed: **27**. No MEPC allocations were inferred or assigned.

## Entitlements and User Management

`training_category_entitlements` uses `(profile_id,category_id)` identity, active status, effective validity, revision, modifier/timestamp and reason. Missing, inactive, expired and future grants confer no FO submission access. Categories remain `hk` and `technical_mep`; no topic/master changes.

The existing employee details drawer contains an independent Training Categories operation. The normal profile form/payload does not contain these permissions. The server checks the exact existing QPMS Super Admin identity, active profile and web access; role text alone is insufficient. SQL repeats administrative and eligible-target validation. The UI displays effective state, validity and the most recent 100 audit entries.

Grant/revoke and audit writes are one transaction using `access_audit_logs`. Expected revisions prevent lost updates. Both entitlement changes and Training mutations acquire the same actor advisory transaction lock; a mutation waiting behind revocation rechecks the database grant. Historical read access is independent of the submission grant.

The prepared migration preserves HK eligibility for the currently verified 27 FOs before replacing the role-derived predicate. A changed inventory fails closed for renewed backfill review. It adds no MEPC grant and does not update Training records. QPMS Super Admin is the explicit administrative owner recorded for this compatibility backfill; confirm that ownership again at migration approval.

## Backend authorization

- Mobile creation remains FO-only with active owned attendance/visit, verified Retail eligibility, explicit category and active canonical-store authorization. Existing release and evidence-retirement triggers remain installed.
- MEPC-MIS and authorized Operations Managers submit through the separate Web creation RPC. Branch Head and KAM cannot use either submission contract. Super Admin has reporting/entitlement administration and the gated MEPC Web contract; no new HK Web workflow was added.
- Branch Head/South Head reporting uses verified business/state/store/zone assignments; KAM/Operations Manager MEPC reporting uses their verified assignment scope. Existing OM/KAM HK hierarchy reading remains bounded to authorized stores and subordinate FO records.
- MIS category restrictions are enforced in SQL. TN/PY coverage requires explicit geographic grants. AP umbrella and existing state aliases are preserved. Label normalization never creates coverage.
- Existing legacy HK-MIS readers retain their additional unified-access/module/store checks.
- List, detail, dashboard totals, exports built from those reports, and evidence authorization use the same session/store decision. Totals count distinct submitted sessions. The list RPC returns one JSON value to avoid PostgREST's row cap truncating aggregate inputs.

## Web API contract — server gate remains OFF

`POST /api/training/web/sessions`

```json
{
  "retail_store_id": "canonical-store-uuid",
  "training_date": "2026-11-26",
  "training_type_id": "active-type-uuid",
  "actual_trainer_profile_id": "verified-retail-trainer-uuid",
  "creation_key": "durable-client-generated-key",
  "remarks": "Optional, maximum 500 characters"
}
```

Category is fixed server-side to `technical_mep`. Uploader comes from the authenticated profile; trainer name and store snapshots come from trusted masters. Actor/category/source/attendance/visit fields supplied by the caller are rejected. No fake attendance or visits are created.

The additive session fields are submission source, uploader, actual trainer and completion-policy version. Existing source provenance remains unknown; only future inserts default to Mobile. Attendance/visit become nullable only for valid Web sessions under a source/context CHECK. Mobile and historical rows still require both. Existing columns/signatures and historical snapshots remain intact.

The response includes the session ID and readable possible-overlap candidates. Same actor/key and same creation identity returns the same ID; changed identity conflicts. Same store/date alone is never a uniqueness rule. Upload timestamps are recorded separately from the actual conducted date.

Existing protected session/topic/evidence/submit endpoints operate on the uploader's Web draft through a separate Web authorization branch. Every operation rechecks the DB Web release policy and store scope. MEPC-MIS receives only the necessary Training API route allowance, with no User Management/FO API access.

`training_v2_private.release_policy.web_enabled=false` is the authoritative default. There is no client flag or permission-admin endpoint that activates it. Backdate allowance defaults to **0 days**, is configurable only through a separately approved DB operation, and future dates are rejected. A draft from a previous day is therefore read-only for mutation until its date is inside an approved backdate window. No unrestricted historical upload policy is activated.

## Evidence and compatibility

New MEPC sessions use completion policy version 2: active selected topic(s), a verified private photograph per topic, and verified `additional_document` completion proof. The backend validates proof bytes/format/size and hashes; SQL verifies uploaded status, ownership, private bucket, object path, MIME/size and verification digest. Pending intents cannot qualify merely because an object exists.

Existing HK rows retain policy version 1 and the current single-page client proof behavior. No additional HK DB proof rule is activated. Submitted rows remain immutable; already-submitted owner retries append no duplicate event.

Storage and database are separate systems: a revocation during an in-flight byte transfer may leave a private pending object, but final metadata verification/submission is rejected. No pending object is promoted to a completed report. Already-issued signed read URLs retain their existing bounded TTL; revocation prevents new URLs, not access through an unexpired URL.

## Validation

All tests use synthetic data, loopback services and a newly initialized disposable PostgreSQL cluster. No production credentials, environment files or submissions are used. Local Node is 24.16.0; the prepared CI runs the backend's declared Node 22.

Validated cases include all four FO entitlement states, validity, forged admin/target/category, stale revisions, atomic audit, both revocation race orderings with a blocked concurrent connection, active context/store/business checks, MEPC web roles and gate, TN/PY separation, AP/aliases, zone intersection, future/backdated date rejection, evidence/pending validation, HK version-1 submission, immutable submitted rows, retry/idempotency, shared report/evidence scope, and non-destructive compensating rollback.

Commands:

```text
node --test backend/tests/trainingV2Database.test.js
node --test backend/tests/trainingV2Services.test.js backend/tests/trainingMobileV4.test.js backend/tests/trainingRoutes.test.js backend/tests/trainingService.test.js backend/tests/trainingReleaseCompatibility.test.js backend/tests/trainingPhase2.test.js backend/tests/trainingLegacyCompatibility.test.js backend/tests/trainingBackendRpcMigration.test.js backend/tests/trainingMigrationContract.test.js
node --test backend/tests/retailHkTrainingReadScope.test.js backend/tests/retailLeadershipTrainingScope.test.js backend/tests/retailModuleReportService.test.js backend/tests/retailDashboardTrainingCount.test.js backend/tests/retailMisAccess.test.js tests/trainingView.test.js tests/trainingExports.test.js
node --test tests/trainingCategories.browser.test.js
npm run build
```

Measured locally: the combined Training/security/reporting/export/guard run passed **227/227** tests, including **14** native PostgreSQL checks; the existing operational regression command passed **120/120** (overlapping coverage, not an additional unique-test count). The isolated browser check and scoped lint passed. The browser harness mounts only the permission panel, uses synthetic request responses and blocks non-loopback traffic. Desktop/mobile screenshots are under `docs/retail/screenshots/training-v2/`. Build passes with existing large-chunk/mixed-import warnings. Test passes establish isolated behavior, not production or device acceptance.

Two unrelated main-baseline checks were observed failing and are not repaired here: the combined Training/Deep Cleaning historical contract test references an absent `supabase/pending_review/20261106_deep_cleaning_required_document.sql`; the unified User Management source test expects `temporary_nims_profile_role: 'FO'` in unchanged server code. Keep these distinct from Training V2 regression results.

## Approval-only migration order and rollback

1. Reverify production SHAs, exact installed definitions/grants/triggers and a recoverable DB/Storage backup under a separately approved release plan.
2. Recompute and approve the exact HK FO inventory and backfill owner. The current migration expects 27; any difference stops execution for review.
3. Apply the single prepared `20261126064945_reliance_training_v2_entitlements_web_contract.sql` transaction only after explicit approval. It performs schema additions, HK preservation, function changes and service-only ACLs together. Do not replay historical Training migrations.
4. Validate grants, RLS, existing release/evidence triggers, preserved record/event/evidence counts and version-1 HK behavior. Web stays disabled.
5. Deploy compatible backend/User Management changes only with separate approval; approve actual MEPC FO allocations independently.
6. Web gate/date-policy activation requires a later, separately approved release and acceptance plan.

`supabase/proposals/training_v2_phase2_rollback.sql` is a compensating rollback: close Web admission and reset date allowance while retaining compatible backend, entitlements, audit/history and legitimate Web records. Do not drop new columns/tables, delete data, restore NOT NULL context constraints over Web rows, or restore broad role-derived MEPC grants. A binary downgrade to the old backend after real Web writes is not an approved rollback.

## Phase 3 and remaining release gates

- Implement the mobile category picker/single-page MEPC experience, durable creation keys and user-isolated recovery in its own phase. No mobile source was changed here.
- Implement the Web upload screen against this gated contract; no upload screen was added here.
- Approve backdating, actual trainer selection, duplicate-warning presentation and MEPC FO allocations.
- Verify latest distributed APK/source provenance and physical-device/client compatibility.
- Complete authenticated staging/production acceptance and independently approve migration, deployment and gate activation.
- Review the narrow content-pinned CI adapter for this Training payload; existing protected workflows/tests are retained.

This PR must remain draft/unmerged until review. Nothing in this report authorizes production execution.
