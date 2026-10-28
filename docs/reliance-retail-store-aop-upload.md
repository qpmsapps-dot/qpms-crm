# Reliance Retail Store Master and AOP upload

Admin roles `ADMIN` and `QPMSADMIN` can open **Upload Store Master & AOP** in the Attendance dashboard. Authorization uses the server-authenticated active profile. Existing attendance upload permissions are unchanged.

The flow validates the original review workbook, previews every row, lists conflicts, and offers independent Store Master and AOP confirmation. A workbook YES and reference alone are insufficient: a separately controlled approval registry must bind the exact original file SHA-256, row digest/number, code, reviewer, evidence hash, approval reference and approval validity. NO and missing evidence stay pending. Canonical identities are never upserted or renamed. Composite codes such as `TUG5/SLUA` must be resolved to one official identity in a new reviewed source.

PY geography remains PY and reports under TN. KA/KN becomes canonical KA and reports under KN. TG attendance-master support is included in the proposed SQL state constraint. GPS functions and GPS operational rollout are unchanged.

## Release and database readiness

Application deployment is safe with activation disabled. Before SQL setup is installed, Admin can run read-only workbook validation against the live master; the screen identifies this as validation only. No persisted import, history or activation is claimed in this mode.

`supabase/proposals/retail_store_aop_upload.sql` is an **unnumbered, uninstalled forward proposal**, not an applied migration. The production SQL owner must first verify live migration history, 211/212/215/232 schema compatibility, state-check definitions, functions, RLS, ACLs and normalized-code uniqueness. Assign an unused migration number only against that verified history. The proposal checks the expected existing state constraint and seeds no stores or AOP.

After installation, previews retain the exact original workbook as base64, all literal source rows, source row digests, validation decisions, actor and baseline stamp. File SHA-256 is unique. Retrying the same file refreshes the same pending batch; committed replay returns its original receipt. Confirmation locks the batch and canonical master, rechecks the baseline/approval registry, and writes atomically. Source and approval drift require a fresh preview.

`RETAIL_STORE_IMPORT_WRITES_ENABLED` defaults closed. Do not enable it until the preview and identity/AOP decisions are reviewed. No production activation was authorized by the application release. Approval registry writes are unavailable to `anon`, `authenticated`, and the application service role; the authorized SQL owner records actual reviewed evidence separately. Never populate synthetic approvals in production.

New identity import currently supports **genuinely approved supervisor-only identities**, with explicit Active/Inactive status and a real supervisor name. FO-managed candidates remain pending until their actual FO/zone allocation is verified through the existing management workflow. Do not invent supervisory details to bypass missing assignments. Existing identities are preserved even when workbook names or geography differ. Unresolved prior conflicts remain blocked.

AOP requires its own registry decision: canonical store ID/state, final numeric `hk_count` and `mepc_count`, effective start/end, approval reference and evidence. Components are never silently summed or treated as approved totals. An existing active identity is required; approve/import identities first, then re-preview independently approved AOP. PostgreSQL rejects overlapping current periods. Expired approved AOP cannot activate.

## Recovery and rollback

Admin history provides rollback and previously unmatched attendance recovery controls. Recovery requires an exact committed Store Master batch and original committed attendance batch. It decodes the authoritative retained attendance audit and includes only originally unknown-code rows belonging to stores added by that batch. Original batch/row provenance is retained in the recovery workbook. The existing attendance preview, snapshot, daily cap and commit rules remain authoritative. Existing employee-days cannot be replaced by recovery. Identical recovery replay returns the same attendance batch.

`RETAIL_STORE_ATTENDANCE_REPROCESS_ENABLED` defaults closed and requires separate approval of the recovery preview. No production recovery is performed as part of deployment.

Rollback requires an explicit reason and preserves all evidence. Unused, unchanged new identities become Inactive. Any downstream reference or identity change blocks automatic rollback. AOP rollback supersedes only unchanged versions created by the exact batch. Events and committed source evidence are immutable. Existing canonical stores are never rolled back by this feature.

## Validation commands

Run the isolated PostgreSQL tests with Docker Desktop's Linux engine and a local `postgres:17` image. Containers use `--network none` and temporary database storage and are removed after testing.

```powershell
$env:RETAIL_STORE_IMPORT_POSTGRES='1'
$env:RETAIL_STORE_IMPORT_BROWSER='1'
$env:RETAIL_STORE_REVIEW_WORKBOOK='D:/QPMS_CRM/import_sources/Reliance_Retail_Store_Master_Audit_Upload_Review.xlsx'
node --test backend/tests/retailStoreImportValidation.test.js backend/tests/retailStoreImportPostgres.test.js
npm run build
```

The browser test uses a synthetic local Admin session and actual HTTP handlers/isolated PostgreSQL. It does not establish authenticated production browser acceptance. The real workbook is an external review input and is not committed. The read-only audit script writes its reconciliation under `artifacts/retail-store-aop-upload-20261028` and never invokes import or recovery.

## First production import decisions

1. Preserve all 130 canonical IDs. Resolve U1KA/U2SY TN/PY source conflicts and TF4Z physical-identity duplication explicitly. Resolve composite codes, source name differences, missing information and the closed/expired records before approval.
2. Review each proposed new identity's official code, name, geography, status and actual operational ownership. Record named approval, evidence hash and exact source/row binding. All 854 rows in the supplied workbook currently remain NO with no approval references.
3. Approve final AOP totals and effective periods independently. Zero and unavailable remain distinct. Current production has no AOP versions.
4. Review/install the numbered forward migration through an authorized SQL connection, verify production constraints/RLS/ACLs, and review the application preview before enabling either write gate.
5. Review each later attendance recovery preview separately. No store, AOP or production attendance recovery occurs merely because application deployment succeeds.
