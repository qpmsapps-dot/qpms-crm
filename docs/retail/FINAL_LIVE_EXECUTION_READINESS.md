# Final live execution readiness

The business owner explicitly approved the existing LIVE Supabase project `ubawkjdbtickdlrgkulz` as the release target and waived provisioning managed staging. This supersedes earlier staging-provisioning instructions. No production SQL, deployment, assignments or configuration changes were executed by this preparation. Live schema execution, GitHub main merge and account/write activation remain separate subsequent authorizations. PR 51 stays draft.

## Exact reviewed migration

`supabase/migrations/20261102071258_retail_mis_four_roles.sql` is unchanged from verified SHA `107175ec34d81c3337306ae171d44cb2f7ff961d`. All seven new MIS tables have RLS enabled and all direct privileges revoked from PUBLIC, anon, authenticated and service_role before the final COMMIT. The two tables inside the generated section have their own ENABLE RLS/revokes; the other five are protected by the final security block. The migration installs 37 MIS functions; PUBLIC/employee/service execution is revoked before selective service-only RPC grants. The sole authenticated helper grant is the no-argument current-account predicate. Temporary default PUBLIC execution during the uncommitted transaction is not externally published.

New storage policies are restrictive, not permissive grants. They close direct access for the MIS namespace/roles without granting access to old private buckets. Existing legacy roles satisfy the `not retail_mis_current_account()` branch, so their earlier policies remain authoritative. Own-profile SELECT remains available; MIS direct writes are blocked. Existing private bucket settings, old permissive/restrictive policies, Training/FO security routines and protected service RPC definitions/grants are not replaced. The new order trigger protects only retired quotations; ordinary legacy orders continue through it. This is a code-review conclusion, not an assertion of completed live authenticated acceptance.

The SQL is one explicit transaction with 5-second lock and 60-second statement timeouts. Any pre-COMMIT error aborts the transaction. It is intentionally NOT idempotent: after successful COMMIT, do not rerun it. It does not automatically assign anyone, activate OOS writes, or insert its own Supabase migration-ledger row. SQL Editor execution alone must not be described as recording version 20261102071258. Retain exact script digest, release SHA, execution timestamp and postinstall result in the release record; any migration-ledger bookkeeping must follow the separately approved migration-management process. Never blindly run db push/reinstall against the installed objects.

## Verification improvements

The updated `retail_mis_postinstall_read_only.sql` remains BEGIN READ ONLY through ROLLBACK. It now asserts, rather than merely prints:

- Presence and normalized prosrc MD5 of all five approved existing Fault/Cleaning/Training workflow functions and all four original OOS/unified functions.
- Exact normalized bodies, owner, definer mode, restricted search path, execution ACLs and expected count for all 37 new MIS functions. PUBLIC and unintended explicit grantees fail verification.
- All seven new tables and three protected OOS tables retain RLS and no PUBLIC/unintended/table/column privileges, including TRUNCATE, REFERENCES and TRIGGER grants.
- Exact commands, roles, restrictive mode and PostgreSQL 17 catalog-expression fingerprints for all 17 MIS policies; all four new immutable/storage/retirement triggers remain enabled with the expected event/function bindings.
- The private 5 MiB image bucket, private legacy evidence buckets, one closed database write-control row, NOT NULL/default false, and zero MIS assignments.

This is an IMMEDIATE installation check. It deliberately fails after accounts have been assigned or OOS writes activated; do not weaken it to treat a later deployment as an untouched install.

Focused native PostgreSQL verification covers the normal zero-assignment install and negative injections for a missing approved guard, changed legacy body, PUBLIC MIS function/table grants, existing OOS RPC permission drift, disabled RLS/retirement trigger, altered storage policy, unsafe default and unexpected assignment. It does not exercise a production connection. The entire 93-test suite was not repeated because migration/application code did not change.

## Backup/recovery gate: UNVERIFIED

No connected Supabase management access or management access token is available in this session. Plugin discovery reports Supabase not installed/connected. Therefore an actual successful available backup, PITR interval and restore authority cannot be confirmed. Plan/configuration assumptions are not recovery evidence. Do not execute the live migration until the owner provides or permits inspection of:

1. Project reference `ubawkjdbtickdlrgkulz`, a completed available backup ID/type and UTC timestamp, OR actual earliest/latest recoverable PITR times covering the proposed pre-install point.
2. An authorized operator's ability to select that point and reach the restore review/confirmation screen, without submitting a restore. This verifies the available restoration action, not a completed restore drill. Record any prior successful restore evidence separately.
3. The storage-object preservation/recovery arrangement. Supabase database backups include Storage metadata, not file bytes. Retain existing blobs in place; do not delete or overwrite evidence/attachments. This migration creates a new bucket but does not rewrite existing objects. No account/write activation occurs in this release step.

Read-only backup listing can use Management API GET `/v1/projects/ubawkjdbtickdlrgkulz/database/backups` with the owner's existing authorization, or the project's Database > Backups dashboard. Do not execute a restore POST, enable a paid feature, provision a new project or change PITR settings. Reference: https://supabase.com/docs/guides/platform/backups . Recovery listings and restore capability must be actual current project evidence, not this documentation link.

## Exact operator sequence after separate execution authorization

1. Confirm recovery evidence above and the approved final PR SHA. Keep production `RETAIL_OOS_MUTATIONS_FROZEN` unchanged. Verify `RETAIL_MIS_OOS_WRITES_ENABLED` remains absent/false; do not turn it on. No users are assigned.
2. In Supabase SQL Editor select the LIVE project `ubawkjdbtickdlrgkulz`, database role `postgres`. Open a new query containing ONLY the complete committed migration, from BEGIN through COMMIT. Compare bytes/digest to the release artifact. Run it once.
3. The editor's RLS warning is expected from static inspection because some ENABLE ROW LEVEL SECURITY statements appear later in this SAME transaction. Continue with the button that runs the original SQL unchanged (labelled Run/Run anyway in the current UI). Do NOT choose Run and enable RLS, and do not let the editor append or rewrite RLS statements. If the UI offers no way to run the original reviewed SQL, cancel rather than guessing. Any warning about unrelated objects or changed SQL requires reconciliation.
4. On ANY SQL error: stop, retain the full error, issue ROLLBACK if the session is still aborted. Do not rerun fragments or the entire migration blindly. After successful COMMIT a later ROLLBACK cannot uninstall it.
5. In a separate new query run the COMPLETE updated `supabase/verification/retail_mis_postinstall_read_only.sql`, from BEGIN READ ONLY through ROLLBACK. Require no exception and the final PASS result. It checks zero assignments and the closed database write gate. Compare retained service/workflow fingerprints and grants. A failed verification after COMMIT means hold the release and diagnose; it does not undo the schema.
6. Only after postinstall passes and separate merge/deployment authorization: mark the reviewed PR ready as authorized and merge through GitHub main. Record the resulting main SHA, which may differ from the release head. Require both Railway backend/frontend commit-status/deployment records to identify that exact main SHA. No Railway CLI login is required.
7. Independently require backend `/ready` HTTP 200, expected main SHA/deployment and draining=false; report the actual global freeze value without changing it. Verify the Railway frontend URL serves new assets/OOS workspace, valid TLS and normal login/session/API operation. A push or historical success status does not establish deployment. Existing custom-domain TLS remains separate; use `https://myqpms.up.railway.app` for this check.
8. Complete live read-only acceptance using existing authorized users, including legacy-user authentication and unrelated private evidence allow/deny checks. Four-role live acceptance requires separately approved test/account assignment; do not borrow or impersonate Padma. Do not create test operational records under a read-only approval.
9. Padma activation, other MIS assignments/reviewer grants and controlled OOS write pilot each need their own explicit approval. Re-run the exact Padma identity preflight before any future assignment. Until then the new database opt-in stays false, environment opt-in stays disabled, and global freeze is unchanged.

## Exact rollback/containment decisions

- Failed migration before COMMIT: ROLLBACK/stop; original transactional schema/data remains. Preserve error and lock/statement-timeout evidence.
- Failed postinstall after COMMIT: hold deployment and all account/write activation. Keep the additive schema private, retain all old protections and diagnose/fix forward through review. Never drop security/audit tables or replay completed migrations.
- Failed Railway deployment before assignments: use an explicitly authorized GitHub revert/redeployment to the approved prior application version, preserving unrelated main commits. Leave unused additive schema/protections installed. Verify both service deployment SHAs and live readiness/assets; do not assume a revert commit is deployed.
- Authentication failure: before assignments, stop activation and retain diagnostics; prior application rollback follows the previous step. If a later authorized assignment exists, first revoke/restore that exact account through audited assignment RPC with current revision, verify prior profile classification and unchanged auth identity/credentials/history, THEN revert old application code. Stop on profile drift rather than overwriting it.
- A production PITR/full restore is a separate incident decision because it affects the entire live project, can lose intervening unrelated transactions and does not restore Storage bytes. Do not start it as routine cleanup. Preserve quotations, immutable events, original attachments, audit and retirement records. Never reset workflow status or delete financial history.
