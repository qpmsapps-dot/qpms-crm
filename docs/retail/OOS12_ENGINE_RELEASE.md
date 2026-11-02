# OOS twelve-stage engine and register release

PR #53 / branch `feat/retail-oos-ageing-dashboard-20261102`, based on deployed `dd9f15ae979e8b36cc40565b6822cda4788a35d6`. This candidate implements all twelve stages, the backend/evidence contract and the detail-screen transition panel. It is not deployed. Neither migration nor workflow activation has been executed in production.

## Authority and required fields

Every operation starts with the existing server-verified Auth user and uniquely linked, active, web-enabled profile. Actor IDs supplied by the browser are ignored. Roles come only from `profiles.role`; designation, display name, user-editable metadata and client claims are not authorization sources.

| Stage | Exact status | Authority | Required fields in addition to remarks |
| --- | --- | --- | --- |
| 1 | Quotation Shared – Waiting for PO | Existing OOS MIS/Central MIS or exact granted QPMSADMIN operator scope | Reviewed source workbook, SHA-256, canonical Store Master IDs, items and expected revision/version |
| 2 | PO Pending Commercial Confirmation | OOS MIS scope | po_number, po_date |
| 3 | PO Received – Fund Yet to Raise | Commercial + existing state reviewer grant | confirmation_ref |
| 4 | Fund Raised – Yet to Receive | OOS MIS scope | fund_request_ref, fund_request_date, fund_request_amount |
| 5 | Fund Delivered | Finance + existing state reviewer grant | payment_ref, payment_date, payment_amount |
| 6 | Fund Received – Work Yet to Start | Branch Head + existing state editor/reviewer grant | receipt_ref, receipt_date |
| 7 | WIP – Work in Progress | Branch Head + existing state editor/reviewer grant | handover_ref, handover_date |
| 8 | Work Done – Document Pending | Operations + existing state editor/reviewer grant | work_completion_ref, completion_date |
| 9 | Document Submitted | OOS MIS scope | documents_ref, submission_date |
| 10 | Document Received – JMS Yet to Be Created | Commercial + existing state reviewer grant | acknowledgement_ref, received_date |
| 11 | JMS Created – Invoice Yet to Raise | Commercial + existing state reviewer grant | jms_number, jms_date |
| 12 | Invoice Raised | Commercial + existing state reviewer grant | invoice_number, invoice_date, invoice_amount |

Stages 2–12 each require at least one finalized supporting file belonging to the same actor, quotation, next stage and current revision. Up to twenty files per transition are accepted. PDF, JPEG, PNG, XLSX and DOCX up to 15 MiB are supported. These are mandatory attached documents, not unverified typed URLs or references. More specific document classifications have not been invented.

Recognized canonical role aliases follow the current application model:

- Commercial: Commercial, Commercial Team, Commercial Reviewer.
- Finance: Finance, Finance Team, Finance Reviewer, Finance GM, CFO.
- Branch: Branch Head only.
- Operations: Operations, Operations Team, Operations Manager. Branch Head, KAM, Admin and management aliases do not silently become Operations approvers.

Specialists additionally require the existing Reliance/Reliance Retail business classification and an explicit matching `retail_provisional_access` state permission. Commercial/Finance need `reviewer`; Branch/Operations need `editor` or `reviewer`. No state is inferred from profile.state, branch names, store names or TN/PY consolidation. Existing MIS/operator grants retain their existing exact-account, role, business and state checks.

Commercial PO confirmation must be independent of the quotation creator, latest reworker **and** PO recorder. Finance release must be independent of both the quotation creator and fund requester. Changing someone's profile role later does not bypass these checks. No Commercial/Finance/Branch authority is assigned to QPMSADMIN, a generic Admin or MIS by this migration. The `MIS_OOS` value returned for a specialist workspace is an API presentation scope only; it never updates a profile or creates an MIS assignment and cannot authorize an MIS-only stage.

## Versioning and legacy compatibility

Version-2 quotations use private `retail_oos12_orders/events/order_stores` ledgers with the same reference, state, canonical store IDs, details/items, revision, rework, creator and timestamps as the existing quotation model. Supporting evidence and import receipts have private linked tables. They are separate so existing broad legacy Admin snapshot/import/command APIs cannot read or mutate a version-2 financial order. Legacy tables, statuses and function bodies are unchanged. Additive reference guards serialize the same quotation-reference namespace across both versions.

The existing register endpoint is a scoped union: authorized MIS/operator accounts can see their legacy plus version-2 records; specialists see only their scoped version-2 records. One quotation ID counts once in the dashboard/export. No historical record is copied, converted, renumbered or backfilled. While v2 is disabled, new imports continue using the existing legacy workflow. After separately audited v2 activation, **new** quotations use version 2; existing legacy references continue through the old contract. A reviewed workflow-version field prevents a preview crossing an activation boundary from silently changing versions at save time.

Before PO, v2 rework requires MIS scope. After PO it requires independently scoped Commercial authority, cannot change state/canonical stores, retains every financial/PO reference, original items and original dates, and appends a REWORK event. Source-hash replay cannot restore an older revision or change the item payload/actor. All groups in an import are transactional. Source bytes are retained privately with the immutable create/rework event and excluded from report/history responses.

## Validation, evidence and concurrency

Only stage N+1 is accepted for stage N. No previous, skipped or terminal transition is valid. Every stage has an exact field allowlist, required fields, remarks length and ISO non-future business-date checks. Monetary inputs are positive decimal **strings** with at most eighteen integer and two fractional digits, validated using PostgreSQL numeric without JavaScript arithmetic. Original source decimals also remain strings in presentation/export when necessary; invoice and payment values such as `9007199254740993.01` are not rounded through Number.

An order row lock and expected revision serialize updates. A transaction-scoped request lock and globally unique request UUID give identical-request replay with exactly one immutable event. Reusing a request with altered actor/order/action/revision/fields/evidence/remarks fails. Distinct concurrent requests against one revision produce one success and one serialization/revision error. Role/state authorization is rechecked on replay.

File upload is a prepared intent tied to the current next stage/revision. The backend signs a non-upsert upload; finalization verifies the actual stored object size/MIME. The transition rechecks finalized status and actual object metadata. Storage triggers prevent changing, moving or deleting evidence objects, even through service-role paths, and deny insertions without a live intent/authority/revision. Restrictive policies deny direct authenticated storage access. View signing requires committed event linkage and current order scope. Finalized evidence metadata, service events, Store Master links and source receipts are immutable. Unused/failed upload intents are retained; there is no destructive cleanup path.

Status ageing is read from the immutable event that entered the current status. Its event timestamp and status timestamp are identical at the transition. PO ageing/date comes from the original PO transition; original quotation date/amount comes from the CREATE event. Rework, remarks and refresh never reset those dates. The previous register, state matrix, full filtered Excel export, canonical mapping and India calendar rules are retained. Reporting remains available when v2 writes are disabled; disabled writes do not hide existing v2 counts.

## Controls

All mutations require the existing backend environment opt-in and global freeze=false. SQL additionally requires the existing MIS database gate and the separate v2 catalog opt-in. Installation leaves v2 **false, revision 0**. It does not alter either existing write gate or Railway settings. The immutable stage catalog may change only its enable/revision fields through an audit-matched activation transaction; stage definitions are never editable. `rpc_retail_oos12_activate` is service-only, requires the exact existing QPMSADMIN operator and logs before/after state into the immutable MIS audit. Enabling also checks that every state in that operator's MIS scope has effective Commercial, Finance, Branch and Operations authority; missing assignments abort activation without an audit/control change. There is no browser activation endpoint.

## Actual blockers identified read-only

On 2 November 2026, production had **zero active web Commercial/Finance-role profiles** and **zero explicit Retail provisional state-access entries**. Seven active web Branch Heads and 27 active web Operations Managers existed, but role presence alone does not give OOS state authority. These are aggregate observations and must be rechecked before release.

The owner must identify the real Commercial, Finance, Branch Head and Operations accounts/states and authorize their normal existing-role/state assignments through the established process. This candidate creates no accounts and seeds no such assignments. Generic Admin/QPMSADMIN cannot be used to manufacture an independent approval. The engine may be reviewed/installed disabled, but end-to-end activation remains NO-GO until actual assignments and managed Supabase Auth/Storage allow/deny acceptance pass. Native PostgreSQL and intercepted browser fixtures are not production acceptance.

## Exact production sequence — prepared only

1. Obtain final approval for the updated PR #53 head. Recheck current main/backend SHA, recovery evidence, approved account/state matrix, existing gate/freeze values, source function fingerprints, and delegated Storage policy/trigger installation capability. Preserve existing Storage bytes and record relevant business/audit counts. Do not assume the old zero-order snapshot is current.
2. On project `ubawkjdbtickdlrgkulz`, call Supabase `apply_migration` with name `retail_oos_register_ageing_v2_disabled` and query equal to the complete committed `supabase/migrations/20261102133951_retail_oos_register_ageing_v2_disabled.sql`. Record the actual tool-assigned ledger version. Run `supabase/verification/retail_oos_register_postinstall_read_only.sql` via owner `execute_sql`; require PASS. If this migration is already installed, verify its exact ledger/source contract instead of replaying it.
3. Call `apply_migration` with name `retail_oos12_transition_engine` and the complete committed `supabase/migrations/20261102135809_retail_oos12_transition_engine.sql`. Record its actual ledger version. Run `supabase/verification/retail_oos12_postinstall_read_only.sql`; require PASS. This checks exact new body fingerprints/ACLs, private RLS, immutable triggers, Storage policies/bucket, cross-version guards, unchanged legacy contracts, and v2=false/revision 0. After this step the first migration's old register fingerprint is intentionally obsolete; use the engine verifier, not a weakened old verifier.
4. Both migrations are transactional and intentionally not rerunnable. Stop on error, roll back an aborted transaction, retain diagnostics. Never use bulk `db push`, reinstall prior MIS/operator migrations, or delete audit/history to retry.
5. Only with release authorization, merge the exact reviewed PR head through GitHub main. Existing Railway integration deploys backend/frontend. Require both SUCCESS for the actual merge SHA, replacement/retirement evidence, HTTPS assets and live `/ready` with that SHA, draining=false and global freeze unchanged. Do not change any Railway variable as part of this release.
6. Use normal authenticated existing sessions to accept operator and specialist scoped reads, generic Admin/other-state denial, evidence view/upload/finalization allow/deny and legacy regression. Do not create sample production quotations or import an Excel source to manufacture PASS. Complete any real-record acceptance only with an approved business source and explicit operation authorization.
7. Resolve the account/state assignments above through the existing authorized process; verify the effective permissions and independent identities before activation. Do not insert placeholder assignments or use a display name as identity.
8. After separate explicit v2 activation authorization and successful checks, run the following owner SQL once. The expected revision zero is deliberate; do not silently retry a changed control. It does not alter existing MIS gates or global freeze:

```sql
begin;
set local lock_timeout='5s';
set local statement_timeout='30s';
select public.rpc_retail_oos12_activate(
 'd40c2b3f-87f1-4c34-8798-cf9b0d9ca784'::uuid,
 true,
 'Owner approved twelve-stage activation after role/state, managed evidence, regression and deployment acceptance',
 0
);
commit;
```

9. Verify `retail_oos_workflow_catalog.enabled=true,revision=1`, exactly one new `OOS12_ACTIVATION` audit, unchanged existing gates/freeze/profiles, and authenticated `/mis/oos/capabilities` with environment/database/v2 controls true. Confirm actions/required evidence independently for each real role and state. The normal `/ready` endpoint does not expose environment opt-in; do not infer it from a display name or service-role SQL.
10. Only after the owner identifies and authorizes a real quotation workbook, preview/save it once, verify immutable receipt/source hash/canonical mapping/original business dates, and progress only real business events with the appropriate independent accounts. No Excel import is authorized by implementation or deployment.

## Recovery

A precommit failure rolls back that migration. A postcommit verification failure holds deployment/activation and is investigated through review. Keep additive private objects and all evidence/history. If v2 has been activated, a separately authorized containment may call the same activation RPC with `false`, an audit reason and the current revision. Legacy controls remain independent. After v2 records exist, do not revert the application to a version that cannot report them without an explicit reviewed incident plan; retain read access to history/evidence. Never convert financial stages backwards, delete audit/files, execute a database restore or destructively clean up operational data as part of routine rollback.

## Local validation

The native PostgreSQL harness replays the reviewed baseline in a disposable cluster and tests migration rollback/postinstall/security drift, all eleven transitions, missing and forged evidence, state/role mismatch, independent Commercial and Finance checks after role changes, decimal precision, immutable storage/history, exact replay, request collision, two-session races, disabled gates, revocation and unchanged legacy function bodies. Four browser suites cover the old workflows, new required-field/evidence/confirmation UI, API errors, retry UUID reuse, duplicate-click suppression, ageing/export/matrix and desktop/mobile screenshots. Existing Admin authorization regressions are included. No TypeScript/typecheck script exists in this JavaScript repo; ESLint, Node syntax, tests and Vite build provide the applicable checks.

```powershell
$env:RETAIL_MIS_PG_TOOLS='D:\QPMS_CRM\tmp\retail-mis-test-tools'
$env:RETAIL_OOS_TRAINING_TEST='1'
$env:RETAIL_OOS_REGISTER_TEST='1'
$env:RETAIL_OOS12_TEST='1'
node --test --test-concurrency=1 backend/tests/retailMisAccess.test.js backend/tests/retailMisPostgres.test.js backend/tests/retailMisQuotationFormat.test.js backend/tests/retailOos12Routes.test.js backend/tests/retailInitialAdminAccess.test.js backend/tests/platformAdminAuthorization.test.js tests/retailOosAgeing.test.js tests/retailOosTrainingBrowser.test.js tests/retailMisBrowser.test.js tests/retailOosAgeingBrowser.test.js tests/retailOos12Browser.test.js
```

Final stable sequential run: **51 tests, 50 passed, zero failed, one optional supplied-real-workbook parser test skipped**. The test source was not supplied; synthetic fixtures do not substitute for it. Scoped ESLint and the production build pass. An earlier combined run overlapped local UI edits/screenshot output and produced browser/file-write failures; the final sequential rerun above passed. Production build retains existing bundle-size/mixed-import warnings. Screenshots under `screenshots/oos-ageing/` are visibly labelled intercepted localhost QA, including [twelve-stage details](screenshots/oos-ageing/twelve-stage-details.png) and the [required-field/evidence update panel](screenshots/oos-ageing/twelve-stage-update.png), not production acceptance.

No production data, profile/permission assignment, Railway setting, OOS write gate or deployed code was changed during this work. Mobile, backend/server.js, GPS/KM/attendance/payroll and the dirty root checkout are untouched.
