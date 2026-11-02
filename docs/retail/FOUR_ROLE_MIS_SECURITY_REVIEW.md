# PR 51 security review and isolated staging evidence

Reviewed the original 71 paths in `c957bd117980a93b7f3eb9e685e557a8502be400` against production main `9db2529a5325cc77a022434143a805ab96351a79` on 2 November 2026. The original candidate fails this review for the defects below. The release branch contains corrections and regression tests; production acceptance remains NO-GO. This report and FOUR_ROLE_MIS_RELEASE.md supersede historical installation instructions in the predecessor documents. Do not reinstall completed Fault/Cleaning security proposals.

## Corrected findings

| Finding | Correction and evidence |
| --- | --- |
| Attendance checksum reuse could disclose another uploader's summary or replace preview ownership | Reject foreign-owned preview and committed batches before conflict lookup or persistence. Both statuses tested with zero writes and no foreign summary returned. |
| Scoped lookup could hide a duplicate Store Code in another state | Check global normalized uniqueness for attendance, operational reports/commands, images and OOS creation. Store Master remains readable for reconciliation; no store is deactivated. SQL tests insert a conflicting PY code and verify Central/HK denial. |
| Linked FO images used a weaker MIS signing path | Reuse existing FO private-bucket, exact submission path and physical object-size verifier, with 120-second MIS links. Positive signing and public bucket/tampered path/size denial tests pass. |
| SQL generator duplicated its section on CRLF checkouts | Normalize line endings and require exactly one marker pair. Independent temporary LF/CRLF copies produce identical SQL on repeated generation and reject duplicate markers. |
| Role CHECK extension silently tolerated unexpected baselines and changed validation state | Require exactly one matching installed role constraint; retain its convalidated state and all original role expressions. Local fixture uses the inspected production role list and NOT VALID state. Failed migration restores the original constraint. |
| Confirmed form data survived module/state changes | Reset action, fields, confirmation and file state; remount native form controls on scope changes. Assignment-state changes also clear confirmation. Browser navigation regression verifies reset. |
| Multi-store OOS export could label an item with every quotation Store Code | Return an authorized canonical store-ID/code map; export each item using its canonical ID, ignoring an untrusted item code snapshot. Browser workbook assertions verify separate item codes. |
| OOS idempotent replay checked only the historical state | Recheck current whole-order Store Master scope and retirement before returning a replay. Original service routines remain unchanged. |
| Padma baseline check allowed NULL designation through SQL three-valued logic | Reject NULL/unexpected baseline designation or role. Wrong employee and NULL designation fixtures fail without creating assignments; exact script is idempotent and preserves fixture credentials. |
| Postinstall returned ACL rows without failing on unsafe results | Add read-only assertions for private table/RPC grants, RLS, restrictive policies, private bucket and closed MIS OOS gate. Deliberately granting authenticated RPC execution makes the check fail. |
| Attendance layout could retain an oversized chart after viewport resize | Specify a single minmax-zero grid track below the desktop breakpoint. Browser layout checks keep strict overflow thresholds and allow a bounded asynchronous resize render. No attendance calculation changed. |

## Authorization conclusions

Central MIS has all seven geographic states and all 13 supported module routes; it is not an Admin alias. MIS-HK has only stores, HK attendance, cleaning, pest and HK training. MIS-MEPC has only stores, MEPC attendance, fault, maintenance and thermography. MIS-OOS has only OOS. AP-1/AP-2 and TN/PY grants remain distinct; KN normalization and TN/PY reporting consolidation do not broaden geographic permissions.

The existing `34cfa587` QPMSADMIN write restriction is retained on legacy APIs. Explicit MIS roles use the separately authorized namespace and cannot fall through to legacy Fault/FO/Training/import or administration routes. Actor identity comes from the verified session/profile, not request role/state or editable auth metadata. Database RPC checks repeat module/state/assignment identity checks; direct employee RPC execution is denied. Existing role behavior is retained by additive restrictive policies and private adapters rather than replacing installed workflow functions.

Store name/city changes remain proposals with independent Super Admin review and the existing apply gate. Store Code, geographic state, operating status, FO/Zone, AOP and the nine unresolved AOP records are not changed. Financial reviewer grants and independent creator/reviewer checks remain separate. OOS retirement retains order, event, source and audit history and rejects progressed/financially referenced quotations. A database trigger prevents legacy updates/deletion of retired quotations.

Only QPMSAP2519 is targeted by the prepared automatic assignment script, bound to the previously verified profile/auth UUIDs. A fresh read-only production boolean check confirms the same unique active account, original Business Development Head role and MIS designation. No production assignment was applied. Generic MIS accounts and the other Padma account are not promoted.

## Isolated staging and limits

Native PostgreSQL 17.6 is installed outside project dependencies in `D:/QPMS_CRM/tmp/retail-mis-test-tools`. Tests initialize disposable loopback clusters with synthetic users, credentials, stores, files and orders. Production is PostgreSQL 17.6. The fixture replays the reviewed attendance, operations, OOS, Fault and Cleaning functions, the actual ownership resolver, the inspected profile role CHECK/role synchronization trigger and new MIS migration. Original workflow function hashes are compared before/after installation. Broad synthetic RLS policies deliberately test restrictive containment.

Tests cover role/module matrix, seven-state Central visibility, multi-state grants, cross-state/class rejection, direct SQL/profile escalation denial, private image lifecycle, immutable objects/audit, approved historical FO linkage and unchanged source digest, attendance commit and upload ownership, independent Store Master review, OOS closed gate, synthetic-only controlled retirement/financial denial/forward order and separation of duties, concurrent assignment revision races, exact Padma assignment, revocation and restoration. An intentionally failed migration rolls back all new tables/bucket/role CHECK changes. Postinstall and Padma read-only scripts execute locally; unsafe RPC-grant injection is rejected.

This is a Supabase-compatible database fixture, not a complete production clone. Auth HTTP/GoTrue, PostgREST schema reload, Storage signed-upload HTTP and Supabase delegated policy/trigger installation are not supplied by native PostgreSQL. Browser/API tests use synthetic identities and intercepted/local services; they do not impersonate production accounts. Existing security helpers outside the fixture still require managed platform acceptance. Accessible Supabase projects contain production only, with zero development branches. Docker CLI exists but the engine pipe is absent; the older Docker-specific regression is skipped, not passed. The native PostgreSQL MIS test is mandatory and does not skip.

## Read-only production and deployment evidence

Production `/ready` returns HTTP 200, `draining=false`, SHA `9db2529a5325cc77a022434143a805ab96351a79`, deployment `3b382c8e-20fb-4263-b028-62a8bcd11340`, and **oos_mutations_frozen=false**. Historical authorization explains the disabled freeze; this task does not alter it or claim protection from it. New MIS writes still require a separate environment opt-in and the private database opt-in seeded false. Neither is activated here.

GitHub PR 51 remains draft and main remains unchanged. Existing Railway integration reports backend/frontend deployments for main; GitHub deployment 7457715982 is main's production deployment. No candidate deployment exists. Frontend Railway route returns 200 with the old `index-BptWIoYy.js` asset. GitHub commit/deployment status is metadata evidence, not authenticated acceptance or proof of service root/environment variables. No Railway CLI login was attempted.

Production catalog read-only checks confirm the expected original function fingerprints, private legacy buckets and no MIS installation. Authenticated has no direct SELECT/INSERT/UPDATE/DELETE grants on Store Master, attendance, training, maintenance, thermography or OOS tables. New MIS policies/grants complement these installed boundaries; old security migrations must not be replayed.

DNS-over-HTTPS shows `myqpms.com A 198.54.114.155`, NS `dns1.namecheaphosting.com` / `dns2.namecheaphosting.com`, and `www.myqpms.com CNAME myqpms.com`. TLS with normal certificate verification fails both custom hosts with ERR_TLS_CERT_ALTNAME_INVALID: certificate CN/SAN are `*.web-hosting.com` / `web-hosting.com`. The Railway hostname validates. This points to the custom hosts serving the Namecheap hosting endpoint; Railway custom-domain configuration/ownership and the correct target still need authorized inspection. Local direct DNS record queries were refused, so public HTTPS DNS was used. No certificate checks were bypassed and no DNS/configuration changed.

## Release gates and rollback

Keep PR 51 draft. Next safe action is managed Supabase staging acceptance with synthetic accounts, using ONLY `20261102071258_retail_mis_four_roles.sql` after confirming the installed prerequisite fingerprints. Run `retail_mis_postinstall_read_only.sql` and normal authenticated allow/deny, evidence/upload and export checks, including independent approval and revocation. Resolve the custom-domain TLS issue through its authorized owner. Do not assign Padma or enable OOS writes for these checks.

After those gates and separate production go-live approval: retain read-only baseline/counts/function hashes and exact reviewed migration digest; apply the single new migration in its transaction; run its asserting postinstall and verify zero assignments/closed MIS OOS control; stop on drift/error. Merge the approved PR through main only under that approval. Track backend AND frontend GitHub Railway contexts/deployment statuses for the exact resulting main SHA. Independently require backend `/ready` SHA/deployment match, non-draining readiness, expected freeze value reported honestly, frontend new asset/features, and authenticated read-only scope/evidence/export acceptance. A push or a successful build alone proves none of these. All-replica retirement and service-root/config metadata remain UNKNOWN unless an authorized integration provides them.

Only after separate account activation approval rerun Padma's exact preflight, execute the prepared one-account assignment script, verify identity/history preservation and normal all-state login. No other user is assigned automatically. Do not open MIS OOS write gates as part of this release.

If installation fails before COMMIT, ROLLBACK and stop; the failure-injection test verifies atomicity. After schema COMMIT, leave unused additive schema private rather than dropping security objects. If assignments exist, first revoke/restore each exact account through `rpc_retail_mis_assign` with current revision and an audited reason; stop on profile drift. Verify restored prior role/business/designation and unchanged auth/history before reverting application code. Then use a separately approved GitHub revert preserving unrelated main changes, verify exact rollback SHA and authenticated legacy access. Retain audit, evidence, retirement records and restrictive protections; never delete history or undo financial records.

## Original 71-path review inventory

The inventory below covers the original PR scope. Follow-up fixes add focused regression/report paths; the refreshed file manifest records final release hashes. Text files were checked for live JWTs, GitHub tokens, private keys and credential-bearing database URIs: no matches. Ten PNGs were visually inspected; they are dated snapshot documentation and include no credential material. Their Fault weekly estimate is historical and superseded by current verified-event logic, not release evidence. No mobile, GPS/KM, payroll, Operations Command Center, dependency/lockfile, Railway configuration or workflow changes were introduced.

| Path | Review scope |
| --- | --- |
| `backend/routes/relianceRetailManagementRoutes.js` | Runtime identity, scope, persistence and export authorization |
| `backend/routes/retailMisRoutes.js` | Runtime identity, scope, persistence and export authorization |
| `backend/server.js` | Runtime identity, scope, persistence and export authorization |
| `backend/services/faultTrackerStoreScope.js` | Runtime identity, scope, persistence and export authorization |
| `backend/services/retailAttendanceService.js` | Runtime identity, scope, persistence and export authorization |
| `backend/services/retailCleaningFoLinkService.js` | Runtime identity, scope, persistence and export authorization |
| `backend/services/retailFaultUpdateService.js` | Runtime identity, scope, persistence and export authorization |
| `backend/services/retailInitialAdminAccess.js` | Runtime identity, scope, persistence and export authorization |
| `backend/services/retailMisService.js` | Runtime identity, scope, persistence and export authorization |
| `backend/services/retailModuleReportService.js` | Runtime identity, scope, persistence and export authorization |
| `backend/shared/retailFaultWorkflow.js` | Runtime identity, scope, persistence and export authorization |
| `backend/shared/retailMisAccess.js` | Runtime identity, scope, persistence and export authorization |
| `backend/shared/retailModuleReports.js` | Runtime identity, scope, persistence and export authorization |
| `backend/tests/fixtures/retailMisBaseline.sql` | Synthetic regression and acceptance evidence |
| `backend/tests/retailInitialAdminAccess.test.js` | Synthetic regression and acceptance evidence |
| `backend/tests/retailMisAccess.test.js` | Synthetic regression and acceptance evidence |
| `backend/tests/retailMisPostgres.test.js` | Synthetic regression and acceptance evidence |
| `backend/tests/retailModuleReportService.test.js` | Synthetic regression and acceptance evidence |
| `backend/tests/retailProductionSecurity.test.js` | Synthetic regression and acceptance evidence |
| `backend/tests/retailWorkflowGaps.test.js` | Synthetic regression and acceptance evidence |
| `docs/retail/FOUR_ROLE_MIS_FILES.json` | Historical provenance, permissions and release instructions |
| `docs/retail/FOUR_ROLE_MIS_RELEASE.md` | Historical provenance, permissions and release instructions |
| `docs/retail/MIS_OPERATING_GUIDE.md` | Historical provenance, permissions and release instructions |
| `docs/retail/PRODUCTION_SECURITY_CORRECTIONS.md` | Historical provenance, permissions and release instructions |
| `docs/retail/USER_OPERATING_MANUAL.md` | Historical provenance, permissions and release instructions |
| `docs/retail/WORKFLOW_AUDIT_MATRIX.md` | Historical provenance, permissions and release instructions |
| `docs/retail/WORKFLOW_SQL_INSTALLATION_PLAN.md` | Historical provenance, permissions and release instructions |
| `docs/retail/screenshots/20261031/attendance.png` | Historical snapshot image inspected |
| `docs/retail/screenshots/20261031/cmpm.png` | Historical snapshot image inspected |
| `docs/retail/screenshots/20261031/dashboard.png` | Historical snapshot image inspected |
| `docs/retail/screenshots/20261031/deep-cleaning.png` | Historical snapshot image inspected |
| `docs/retail/screenshots/20261031/fault-tracker.png` | Historical snapshot image inspected |
| `docs/retail/screenshots/20261031/manifest.json` | Historical provenance, permissions and release instructions |
| `docs/retail/screenshots/20261031/manpower.png` | Historical snapshot image inspected |
| `docs/retail/screenshots/20261031/oos.png` | Historical snapshot image inspected |
| `docs/retail/screenshots/20261031/store-master.png` | Historical snapshot image inspected |
| `docs/retail/screenshots/20261031/thermography.png` | Historical snapshot image inspected |
| `docs/retail/screenshots/20261031/training.png` | Historical snapshot image inspected |
| `scripts/buildRetailMisWorkflowAdapters.mjs` | Deterministic generation and validation tooling |
| `scripts/validateRetailMis.mjs` | Deterministic generation and validation tooling |
| `src/components/Sidebar.jsx` | Runtime identity, scope, persistence and export authorization |
| `src/layouts/MainLayout.jsx` | Runtime identity, scope, persistence and export authorization |
| `src/pages/FaultTracker.jsx` | Runtime identity, scope, persistence and export authorization |
| `src/pages/Settings.jsx` | Runtime identity, scope, persistence and export authorization |
| `src/pages/reliance-retail/RetailMisWorkspace.jsx` | Runtime identity, scope, persistence and export authorization |
| `src/pages/reliance-retail/RetailScopedDeepCleaning.jsx` | Runtime identity, scope, persistence and export authorization |
| `src/pages/settings/RetailMisAssignments.jsx` | Runtime identity, scope, persistence and export authorization |
| `src/routes/AppRoutes.jsx` | Runtime identity, scope, persistence and export authorization |
| `src/utils/authRoles.js` | Runtime identity, scope, persistence and export authorization |
| `src/utils/faultTrackerExport.js` | Runtime identity, scope, persistence and export authorization |
| `supabase/migrations/20261102071258_retail_mis_four_roles.sql` | Migration, ACL, immutable workflow and rollback review |
| `supabase/proposals/retail_cleaning_fo_link.sql` | Migration, ACL, immutable workflow and rollback review |
| `supabase/proposals/retail_fault_api_only_writes.sql` | Migration, ACL, immutable workflow and rollback review |
| `supabase/proposals/retail_fault_tracker_updates.sql` | Migration, ACL, immutable workflow and rollback review |
| `supabase/proposals/retail_legacy_cleaning_evidence_isolation.sql` | Migration, ACL, immutable workflow and rollback review |
| `supabase/proposals/retail_mis_commands.sql` | Migration, ACL, immutable workflow and rollback review |
| `supabase/proposals/retail_mis_padma_assignment.sql` | Migration, ACL, immutable workflow and rollback review |
| `supabase/proposals/retail_mis_workflow_adapters.sql` | Migration, ACL, immutable workflow and rollback review |
| `supabase/verification/retail_cleaning_fo_link_postinstall_read_only.sql` | Read-only prerequisite/postinstall checks |
| `supabase/verification/retail_fault_tracker_updates_postinstall_read_only.sql` | Read-only prerequisite/postinstall checks |
| `supabase/verification/retail_mis_padma_preflight_read_only.sql` | Read-only prerequisite/postinstall checks |
| `supabase/verification/retail_mis_postinstall_read_only.sql` | Read-only prerequisite/postinstall checks |
| `supabase/verification/retail_owner_security_verification_combined_read_only.sql` | Read-only prerequisite/postinstall checks |
| `supabase/verification/retail_owner_security_verification_read_only.sql` | Read-only prerequisite/postinstall checks |
| `supabase/verification/retail_partial_install_status_read_only.sql` | Read-only prerequisite/postinstall checks |
| `supabase/verification/retail_production_security_gate.sql` | Read-only prerequisite/postinstall checks |
| `supabase/verification/retail_security_corrections_postinstall_read_only.sql` | Read-only prerequisite/postinstall checks |
| `supabase/verification/retail_workflow_updates_postinstall.sql` | Read-only prerequisite/postinstall checks |
| `supabase/verification/retail_workflow_updates_preinstall.sql` | Read-only prerequisite/postinstall checks |
| `tests/retailMisBrowser.test.js` | Synthetic regression and acceptance evidence |
| `tests/retailWorkflowPersistenceBrowser.test.js` | Synthetic regression and acceptance evidence |

Final validation: 89 tests; 87 passed, zero failed, two skipped (optional supplied workbook and older Docker-specific PostgreSQL test). The mandatory native PostgreSQL MIS suite passed. Production Vite build, scoped ESLint, backend syntax and diff checks passed; existing bundle/import warnings remain.

