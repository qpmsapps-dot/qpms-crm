# PR #53 - final OOS12 and MIS release procedure

Prepared only. Production has not been migrated, merged, deployed or activated by this change. This supersedes the earlier specialist-web-account model. Use the final reviewed PR head, not 900b552d after these changes are committed.

## Final authority model

Official labels are **HK-MIS**, **MEPC-MIS**, **OOS-MIS**. Existing canonical identifiers remain `MIS_HK`, `MIS_MEPC`, `MIS_OOS`; no duplicate role definitions are created. Historical `CENTRAL_MIS` compatibility remains, but no new Central MIS selection is offered. No user or assignment is seeded.

The existing Super Admin identity can invite users through User Management, assign a role and multiple states, edit details/state scope, and deactivate/reactivate using the existing account lifecycle. The existing Supabase invitation architecture is retained. A read-only contract preflight runs before an MIS invitation; profile/state edits use one locked SQL transaction with expected assignment revision and immutable before/after audit. If invitation/profile creation succeeds but a later assignment fails, the API explicitly reports the existing account and unconfirmed assignment; it must be reviewed rather than blindly invited again. Missing/invalid assignments fail closed. No privileged key is sent to the browser.

Only the exact existing QPMSADMIN Super Admin can manage these assignments. Its Admin role, All Businesses, Developer designation, credentials and exact OOS-only operator grant are preserved. Generic Admin accounts receive no new OOS authority. Existing unrelated User Management, Hospital, Commercial/Finance, attendance, KM, payroll, Store Master and reviewer contracts remain separate.

HK-MIS retains only its existing HK module set. MEPC-MIS retains only its existing MEPC module set. OOS-MIS has only OOS workspace/API access. Changing an MIS user into a non-MIS role requires the existing audited revocation procedure first, avoiding stale assignment reuse.

## Six-state contract

The OOS reporting/authorization states are exactly **TN, KA, KL, TG, AP-1, AP-2**. `retail_oos_state` / `retailOosState` map source PY to TN without updating Store Master or historical events. TN OOS scope includes original PY stores; there is no separate PY grant or activation prerequisite. AP-1/AP-2 remain separate. The register, filters, matrix and Excel use consolidated TN. A quotation whose verified stores resolve to one normalized state counts once. TN/PY mixtures resolve to TN; genuinely different normalized states remain explicit rejected/unresolved cases rather than duplicated counts.

All three MIS role selectors use six-state selection. Normalization in shared authorization applies to the **OOS module only**; unrelated modules retain their existing geographic authorization rules. Existing operator grants and historical state snapshots are not rewritten.

## Twelve-stage workflow and offline confirmation

All transitions are recorded by authenticated, assigned OOS-MIS or the already-authorized exact QPMSADMIN OOS operator. There are no specialist web-account prerequisites for OOS12. This does not grant Commercial/Finance/Branch/Operations roles or authority in other modules.

| Stage | Exact status | Required business fields |
| --- | --- | --- |
| 1 | Quotation Shared – Waiting for PO | Reviewed original quotation workbook, canonical stores, source hash/items and reviewed revision/version |
| 2 | PO Pending Commercial Confirmation | po_number, po_date, po_received_date |
| 3 | PO Received – Fund Yet to Raise | confirmation_ref |
| 4 | Fund Raised – Yet to Receive | fund_request_ref, fund_request_date, fund_request_amount |
| 5 | Fund Delivered | payment_ref, payment_date, payment_amount |
| 6 | Fund Received – Work Yet to Start | receipt_ref, receipt_date |
| 7 | WIP – Work in Progress | handover_ref, handover_date |
| 8 | Work Done – Document Pending | work_completion_ref, completion_date |
| 9 | Document Submitted | documents_ref, submission_date |
| 10 | Document Received – JMS Yet to Be Created | acknowledgement_ref, received_date |
| 11 | JMS Created – Invoice Yet to Raise | jms_number, jms_date |
| 12 | Invoice Raised | invoice_number, invoice_date, invoice_amount |

Stages 2-12 additionally require `confirming_person_name`, `confirming_department`, `confirmation_date`, `confirmation_reference`, remarks, and at least one finalized current-stage supporting document. Department is validated against the stage: Commercial for 2/3/10/11/12; OOS-MIS for 4/9; Finance for 5; Branch Head for 6/7; Operations for 8. References are mandatory; unsupported or missing evidence never becomes verified confirmation. Dates are ISO, valid and non-future on the Asia/Kolkata calendar. Financial inputs remain exact positive decimal strings.

Immutable events record the real authenticated system actor UUID, employee code and profile role, OOS-MIS operational capacity, system timestamp, separately submitted offline confirmer fields, and `MIS_SUBMITTED_UNVERIFIED`. They do not represent an independent Commercial/Finance system approval. Storage finalization verifies file existence/size/MIME, not offline authenticity.

Only N+1 is allowed; no backward, skipped or terminal transition. Row/revision locking, globally unique request UUID, exact-request replay, changed-payload rejection and authorization revalidation remain. Every stage requires actor/order/stage/revision-bound files. Upload, signing, mutation and evidence viewing retain private scope checks. Events, original items, receipts, canonical store links and files remain immutable. Rework is MIS-authorized and preserves original quotation/PO/status dates and the full financial/revision history.

## Legacy and reporting

Six-stage records remain on their existing workflow. OOS12 uses separate private ledgers and never converts, backfills, renumbers or copies legacy financial records. While OOS12 is disabled, new quotations continue through the legacy contract; mixed TN/PY source files that require the v2 normalized model must wait for v2 activation. Reference guards prevent cross-version duplicates. Disabled v2 writes do not hide v2 reports.

Quotation ageing uses original business date; PO ageing uses original actual PO receipt date (`po_received_date`, distinct from the PO issue date); status ageing uses the immutable event entering the current status. Rework/ordinary edits do not reset dates. Missing dates remain unavailable with visible warnings. Calendar calculations use Asia/Kolkata. Month/date filters consistently use original quotation date; All-Time includes missing dates.

The register, count/ageing matrix, drill-downs, overdue summaries and full filtered Excel export are retained. Excel includes all filtered pages, text identifiers, formula-injection protection, line items/history and a status/ageing summary. PY is exported as reporting TN; original source geography/history remains intact.

## Storage-owner prerequisite

PostgreSQL requires the owner of `storage.objects` to create its policies. A TRIGGER grant is insufficient. The inspected production executor was non-superuser `postgres`, without membership in owner `supabase_storage_admin`. No ownership/membership change is authorized or prepared.

Use a genuinely owner-capable Supabase execution path for the four restrictive policies. If the main migration connection cannot create them, the Storage owner/Supabase support operator can preinstall the exact four policies below, after script approval. The engine migration validates their exact expressions, command, anon/authenticated roles and RESTRICTIVE mode and skips creation only when identical. It rejects mismatches. The main executor still needs its existing TRIGGER privilege and normal public-schema migration authority. This is not a claim that such production owner access has already been obtained.

```sql
create policy retail_oos12_private_insert on storage.objects as restrictive
 for insert to anon,authenticated with check(bucket_id<>'retail-oos12-evidence');
create policy retail_oos12_private_read on storage.objects as restrictive
 for select to anon,authenticated using(bucket_id<>'retail-oos12-evidence');
create policy retail_oos12_private_update on storage.objects as restrictive
 for update to anon,authenticated using(bucket_id<>'retail-oos12-evidence')
 with check(bucket_id<>'retail-oos12-evidence');
create policy retail_oos12_private_delete on storage.objects as restrictive
 for delete to anon,authenticated using(bucket_id<>'retail-oos12-evidence');
```

These policies isolate only the new private namespace. Preserve existing policies, objects and bucket bytes. Do not repeat this SQL when policies already exist; inspect the exact definitions.

## Shortest safe production sequence - not executed

1. Approve the final updated PR #53 head; refresh live SHA, counts, existing gates/freeze and recovery evidence. Existing owner-provided physical backup evidence was 2026-11-02 01:25:33 UTC and 2026-11-01 01:25:13 UTC, not a current independently tested restore. Confirm an available recovery point and restore-capable operator. Database backups do not cover Storage bytes. This additive release preserves bytes; it does not claim independent Storage backup.
2. Establish the legitimate Storage policy path above. Do not modify ownership, role membership, RLS or existing policies to bypass it.
3. Project `ubawkjdbtickdlrgkulz`: apply the **complete committed** `20261102133951_retail_oos_register_ageing_v2_disabled.sql` as migration name `retail_oos_register_ageing_v2_disabled`; record the actual ledger version. Run `supabase/verification/retail_oos_register_postinstall_read_only.sql`; require PASS. This migration includes the final audited MIS user-management contracts and OOS-only state normalization.
4. Apply the **complete committed** `20261102135809_retail_oos12_transition_engine.sql` as name `retail_oos12_transition_engine`; run `supabase/verification/retail_oos12_postinstall_read_only.sql`; require PASS, v2=false/revision 0, unchanged existing gates. It verifies exact fingerprints/ACLs, RLS, immutable triggers/evidence, owner-path policies, cross-version guards and unchanged legacy mutation functions. Its register fingerprint supersedes verifier one's register fingerprint.
5. Both migrations are transactional, non-rerunnable and remain pending. Stop on any failure. Never bulk `db push` or reinstall the deployed four-role/operator baseline. If either is already installed, verify actual ledger/source instead of replaying a revised migration.
6. After release authorization, merge the exact reviewed PR head into main. Existing Railway integration deploys both services. Verify backend/frontend SUCCESS for actual merge SHA, replaced/retired instances, HTTPS assets and `/ready` healthy/draining=false/global freeze unchanged. Do not alter Railway variables or either existing OOS write gate.
7. Use real normal sessions to verify QPMSADMIN identity/grant, authorized MIS state reads, generic Admin and other-state denial, User Management labels/state scope and unchanged legacy behavior. Creating or editing real users requires their actual approved identities; do not seed sample accounts. No Commercial/Finance/Branch/Operations accounts are required for OOS12.
8. After separate activation authorization, call the audited service-only RPC below at expected revision 0. Existing MIS write gates must already be enabled; no browser activation endpoint exists. Validate enabled=true/revision 1 and one immutable activation audit; existing gates, profiles and freeze must be unchanged.

```sql
begin;
set local lock_timeout='5s';
set local statement_timeout='30s';
select public.rpc_retail_oos12_activate(
 'd40c2b3f-87f1-4c34-8798-cf9b0d9ca784'::uuid,
 true,
 'Owner approved six-state OOS-MIS offline-confirmation workflow after deployment and security checks',
 0
);
commit;
```

9. Managed evidence upload/finalization and end-to-end workflow acceptance require the installed/deployed engine, normal authenticated sessions, controlled activation and an explicitly approved genuine workbook/files/business events. There is no fake sample import or destructive denial test. Report controlled activation separately from completed production acceptance; local tests, service-role SQL or public health do not establish real managed Auth/Storage/workflow acceptance.
10. No workbook import is authorized by this implementation. Wait for the owner to identify and authorize the actual source. Record source hash/receipt, canonical mapping, original dates/amounts, offline evidence and actual actors during genuine operations.

## Recovery

Before commit, a failed migration rolls back. After a postcommit check fails, hold deployment/activation, preserve additive objects/files/audit and fix forward. Separately preinstalled owner policies may remain restrictive for the new namespace; do not destructively clean them up. After activation, separately authorized containment uses the same activation RPC with false, a reason and the current expected revision. Preserve report/history access. Once v2 records exist, do not revert to an application unable to report them without an incident plan. Routine recovery does not restore the database, remove Storage bytes or move stages backward.

## Validation and screenshots

Native disposable PostgreSQL covers both transactional migrations/verifiers, owner-policy permission denial and legitimate preinstallation, actual OOS-MIS all-stage transitions, exact role/state user edits, module isolation, TN/PY mapping, independent legacy financial protections, offline confirmation/evidence, immutability, replay/concurrency and legacy compatibility. Browser tests cover register/dashboard/export, next-only evidence/confirmation, exact-role invite/edit and desktop/mobile layouts. Screenshots use intercepted local QA and are not production acceptance.

- [MIS Create User](screenshots/oos-ageing/mis-user-create.png)
- [MIS mobile Edit User](screenshots/oos-ageing/mis-user-edit-mobile.png)
- [OOS12 update](screenshots/oos-ageing/twelve-stage-update.png)
- [OOS12 details](screenshots/oos-ageing/twelve-stage-details.png)

Run the focused test command in the PR description with `RETAIL_MIS_PG_TOOLS`, `RETAIL_OOS_TRAINING_TEST=1`, `RETAIL_OOS_REGISTER_TEST=1`, `RETAIL_OOS12_TEST=1`. The optional owner-supplied-workbook parser test remains skipped without that real file. Scoped lint, Node syntax and production build are required. No TypeScript/typecheck script exists in this JavaScript repository. Existing Vite bundle-size/mixed-import warnings are not hidden.

No production data, accounts/permissions, migration, Railway setting, write gate or deployment was changed during this implementation. Mobile, Operations Command Center, GPS/KM/attendance/payroll logic and the dirty root checkout remain untouched. The minimal backend/server.js changes hook MIS preflight/assignment into existing invitation/edit handlers only.

Final validation: **70 tests total; 69 passed, zero failed, one optional owner-workbook test skipped.** Scoped ESLint, Node syntax checks and the production build pass. Native PostgreSQL additionally verifies actual PO receipt date separately from PO issue date, actor UUID/profile-role/offline-person attribution, cross-state transition denial, and anonymous/authenticated Storage denial even with a broad unrelated permissive read policy. Existing build warnings remain bundle size and mixed static/dynamic imports.
