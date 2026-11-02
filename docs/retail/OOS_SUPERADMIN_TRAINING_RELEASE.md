# Focused OOS training candidate - not deployed

Branch: `feat/retail-superadmin-oos-training-20261102`, based on deployed merge `cd4ea39b9db7051bceefda380e27dc8aeb13786f`.

The existing MIS mechanism requires an assignment matching the employee's role. Assigning MIS-OOS through that mechanism changes the employee role. This extension instead requires an explicit OOS-only operator grant for the exact verified QPMSADMIN profile/auth pair. No grant is seeded. Generic Admin accounts do not qualify. Legacy employee fields and credentials remain unchanged.

Verified database identity: profile `d40c2b3f-87f1-4c34-8798-cf9b0d9ca784`, auth `79cd196c-c6f3-404a-b22a-d4683afefa3f`, employee `QPMSADMIN`. This is database identity verification, not verification of the user's current browser session. Before authorizing the grant, validate the current session through the existing Supabase Auth verifier and uniquely resolve its server-side profile; require both UUIDs to match. A display name, typed employee code, local storage record or decoded but unverified JWT is insufficient. Do not copy tokens, cookies or passwords into release evidence.

## Changes

- Additive migration `20261102123000_retail_oos_superadmin_operator.sql`: private RLS table, exact-account grant/revoke RPC with revision check and immutable existing audit, scoped authorization extension, read-only next-action capabilities. Only two existing MIS function bodies change; their previous fingerprints are mandatory preconditions. Protected legacy service RPCs are not replaced.
- Dedicated OOS page: verified access before data requests, workbook preview/revision review, guarded save, refresh from database, quotation/PO/store search, state/status filters, paginated list, line items, server-selected next actions, PO inputs, confirmation, history, original workbook download and complete filtered Excel export.
- Existing global freeze, deployment MIS opt-in, database MIS gate and financial/reviewer checks remain in force. This grant does not create a reviewer permission. A separately authorized independent reviewer is still required at commercial and financial stages.

## Execution after explicit approval

1. Review/commit/push this focused branch and PR through the normal GitHub release path. Do not alter dirty root work.
2. Recheck production baseline and backup. With MIS assignments still zero and gate false, run the original strengthened MIS postinstall before installing the extension. Apply only the new extension once, using the migration tool and recording its ledger entry. It is transactional and intentionally not rerunnable: existing objects or baseline drift abort. Never reinstall `20261102071258`.
3. Run `supabase/verification/retail_oos_operator_postinstall_read_only.sql`. Require PASS before any grant. The original postinstall's two authorization fingerprints intentionally become obsolete after this reviewed extension; do not interpret that expected mismatch as permission to skip other protections.
4. Deploy the reviewed merge through GitHub main only after release authorization. Verify backend and frontend SUCCESS for the actual merge SHA, backend /ready, HTTPS and new assets. Keep both MIS write gates closed throughout.
5. After separate exact-account access approval, execute only `supabase/proposals/retail_oos_qpmsadmin_operator_grant.sql`. It grants all seven explicitly listed reporting states to this one account, with an audit reason. It changes no employee fields, MIS assignments or write gates. The expected first revision is zero; retries abort rather than silently changing scope.
6. In the user's normal QPMSADMIN session, require /mis/access to show active OOS-only operator scope, /mis/report/oos and /mis/oos/capabilities to return authorized data, unrelated MIS modules to return 403, and an unassigned generic account to remain denied. Confirm profile fields unchanged, one operator grant/audit, zero MIS assignments, database gate false. Preview only at this point.
7. Separately authorize deployment opt-in first, verify replacement backend /ready and exact SHA; then separately authorize the audited database operational gate. Keep `RETAIL_OOS_MUTATIONS_FROZEN` unchanged. Neither gate is enabled by this package. If global freeze is true or unknown, stop rather than changing it.
8. User identifies the approved workbook and explicitly authorizes the first import. Preview all identities, stores, amounts and revisions; save once. Verify the saved order, canonical store links, details.items, source hash, uploader, event and revision with owner-level read-only SQL. No financial confirmations are fabricated. Live acceptance remains pending until this succeeds.

## Recovery

- Migration failure before commit: transaction rolls back; inspect the exact error. Do not bulk repair or rerun legacy migrations.
- Access problem: keep write gates closed and revoke the operator grant through the same audited grant RPC with `p_enabled=false`, its current states, a reason and current revision. No profile restoration is needed.
- Application rollback requires separate authorization: revoke operator access first, then revert the application merge. Retain the private operator table and audit records; do not drop or delete audit/history/evidence. An inactive grant cannot satisfy the authorization extension.
- If any genuine import already occurred, close operational writes under separate authorization before investigation. Preserve all quotations, events, links and attachments; never destructively roll back operational data.

No production mutation, access grant, gate change, deployment or workbook import was executed while preparing this candidate. Padma/staff activation and User Management integration are deferred.

## Exact file inventory and validation

- backend/routes/retailMisRoutes.js
- backend/tests/retailMisAccess.test.js
- backend/tests/retailMisPostgres.test.js
- src/routes/AppRoutes.jsx
- src/pages/reliance-retail/RetailOosWorkspace.jsx
- src/pages/reliance-retail/retailOosWorkspace.css
- tests/retailMisBrowser.test.js
- tests/retailOosTrainingBrowser.test.js
- supabase/migrations/20261102123000_retail_oos_superadmin_operator.sql
- supabase/verification/retail_oos_operator_postinstall_read_only.sql
- supabase/proposals/retail_oos_qpmsadmin_operator_grant.sql
- docs/retail/OOS_SUPERADMIN_TRAINING_RELEASE.md

Local validation: 17 backend/database tests passed, one optional real-workbook test skipped; two browser tests passed; one additional full PostgreSQL four-role regression passed with the extension installed. Zero failures. Repeated double-clicks submitted one import and one status request. Production build, scoped ESLint and git diff --check passed. Build retains a large-chunk warning. These results do not constitute production mutation acceptance.

## Release preparation review, 2 November 2026

Fresh owner-level read-only SQL confirms the exact profile/auth pair above, one matching profile for an existing Auth user, active web access, role `Admin`, business `All Businesses` and designation `Developer`. There are zero MIS assignments, the database OOS gate is false, the operator table is absent, and the original migration `20261102071258` is recorded. Both authorization function fingerprints match this extension's preconditions. No passwords or credential hashes were read. The grant changes only the separate operator row and immutable audit; profile fields, Auth credentials and unrelated permissions have no update path in this extension.

Current production browser identity: **NOT VERIFIED / release blocker**. This preparation session exposes no connected live browser automation runtime. The existing backend mechanism in `requireSupabaseJwt` calls `supabaseAnon.auth.getUser(accessToken)` and resolves exactly one profile using that verified Auth UUID. The owner must complete this check in their existing authenticated production session, or make that session available through the approved secure mechanism, before release authorization. Database identity and synthetic browser tests cannot satisfy it.

### Exact execution operations (prepared only)

1. Complete the session identity check, review the final PR SHA and fresh production baseline, and obtain the existing backup/recovery evidence. Verify zero assignments and both MIS write gates closed. Run the complete `supabase/verification/retail_mis_postinstall_read_only.sql` through Supabase `execute_sql` on project `ubawkjdbtickdlrgkulz`. Require PASS. Stop on any baseline drift.
2. After final authorization only, invoke Supabase `apply_migration` with `project_id="ubawkjdbtickdlrgkulz"`, `name="retail_oos_superadmin_operator"`, and `query` equal to the complete unchanged contents of `supabase/migrations/20261102123000_retail_oos_superadmin_operator.sql`. Record the returned ledger version and source SHA-256; the tool chooses the ledger version, so do not assume it equals the local filename. Do not use bulk `db push` or replay the original MIS migration.
3. Invoke Supabase `execute_sql` with that project and the complete `supabase/verification/retail_oos_operator_postinstall_read_only.sql`. Require PASS before access activation. Retain the original security checks for policies, audit, evidence and protected service RPCs; only the two reviewed replaced authorization fingerprints are expected to differ.
4. After authorization, mark the reviewed draft PR ready and merge the exact approved head through GitHub into `main`. This is the production deployment trigger for the existing Railway integration; there is no separate `railway up` command. Record the actual merge SHA. Require backend and frontend SUCCESS for that SHA and verify all replacement instances and HTTPS assets. Readiness command: `Invoke-RestMethod https://myqpms-crm-back-end-production.up.railway.app/ready | ConvertTo-Json -Depth 8`. Keep `RETAIL_MIS_OOS_WRITES_ENABLED` closed and database gate false. Preserve `RETAIL_OOS_MUTATIONS_FROZEN`; stop if true or unknown.
5. Only with separate exact-account grant approval, use `execute_sql` with the complete `supabase/proposals/retail_oos_qpmsadmin_operator_grant.sql`. It requires expected revision zero and explicitly grants AP-1, AP-2, KA, KL, TG, TN, PY. Verify one grant/audit, unchanged profile, zero assignments and closed gates. Complete normal-session OOS read/preview and unrelated-module/other-user denial acceptance. No workbook upload/import is authorized by release preparation.
6. Any deployment opt-in, audited database write-gate activation or first workbook import remains a separate authorization and execution step described above. Do not infer permission from PR approval or application deployment. Do not assign Padma or any MIS user.

Recovery remains audited revocation with current revision before an authorized application revert. Retain the additive schema and all audit/history/evidence. This candidate does not change global freeze, independent reviewer restrictions, existing RLS policies or protected legacy service function bodies.

Fresh preparation validation: 13 focused tests passed with zero skips, including native disposable PostgreSQL operator checks and both intercepted local browser suites. Production Vite build, scoped ESLint and diff whitespace checks passed; existing bundle/mixed-import warnings remain. These local fixtures do not verify a production session or authorize production writes.
