# Bulk identity review (ADMIN / QPMSADMIN)

The decision workbook covers the 729 absent-code candidates. Existing canonical stores remain protected. Blank decisions are pending; edits in review copies do not grant approval. Use only Identity decisions for input. Exact source duplicates are repeated evidence, not proof of duplicate physical stores; name-only variants still require official-name review. Closed-source and expired-budget evidence do not establish current operating status.

## Reviewed source and decision flow

1. Review one state at a time. Select Approve Identity / Reject / Hold only for actually reviewed rows; leave all other decisions blank. Supply the authenticated reviewer's profile ID, real evidence reference and evidence SHA-256 for every explicit decision. Approval additionally needs exact official name, actual Active/Inactive status and genuine supervisor name. Current import supports only genuinely supervisor-only candidates; real FO-managed identities require their existing FO/zone verification workflow.
2. For approval candidates, finalize the original source worksheet's official name, YES and actual Approval Ref. Upload that final source through Upload Store Master & AOP → Validate and Preview. Keep source-row numbers stable. Resolve identity conflicts first; setting YES does not remove blocked evidence. AOP component gaps or budget expiry do not silently approve or reject current identity status.
3. Download its validation review. Copy the FINAL source file SHA-256 and the exact FINAL row digest/source-row/code into the corresponding decision fields. Original hashes in the 729-row workbook are provenance and will not match an edited final source. Do not paste the decision workbook's own hash as the source-file hash.
4. Under the current source preview expand Bulk identity decisions (Admin), upload the completed decision workbook, and select Validate bulk decisions. Review exact state, approved/rejected/held counts, codes, names, status and evidence references. Mixed-state decisions, duplicate codes, wrong hashes/digests, another reviewer ID, existing canonical identities and unresolved evidence are refused.
5. The new bulk confirmation gate defaults closed. An authorized SQL owner must first review/number/install `supabase/proposals/retail_bulk_identity_approval.sql`, record its history using the organization's approved migration workflow, and verify function owner/security-definer search_path, ACLs and unchanged data. This proposal creates a service-only RPC using existing approved tables/events; it seeds no rows and imports no stores. It was NOT installed by the application release. Do not reinstall migration 20261028110000.
6. After actual evidence and exact decision scope are reviewed, explicitly enable `RETAIL_BULK_IDENTITY_APPROVALS_ENABLED` through the authorized configuration process. Confirm the checkbox and Confirm identity decisions. The server rechecks active ADMIN/QPMSADMIN, source owner/key/status, current canonical/approval stamp, exact row bindings, final source YES/reference/name, conflicts and ownership/status fields. Database confirmation records an audit receipt and identity registry entries only. Reject/Hold decisions are audited without approval rows. It never writes stores, AOP or attendance.
7. Revalidate the final source AFTER receipt because registry changes make the earlier source preview stale. Check exactly the approved identity count. Existing Store Master import confirmation remains a separate explicit step behind `RETAIL_STORE_IMPORT_WRITES_ENABLED`. Select identity only; keep AOP unchecked and its approvals absent. Confirm only the exact reviewed state-wise identity scope. Close gates after the controlled operation. No gates were enabled by deployment.

The new RPC serializes registry decisions and refuses overwriting an existing approval binding. Same batch/key/payload retry returns its prior receipt. A different decision scope for a receipt-bearing batch requires a new reviewed source file. Registry changes or canonical drift require a new preview; do not bypass errors. Original source bytes remain in the existing source batch, decisions and decision-workbook SHA-256 are retained in the receipt. A rejected/held file decision never silently revokes a prior committed approval; that needs separate reviewed correction.

Existing import replay and compensating rollback safeguards remain unchanged. Used or changed identities cannot be silently rolled back; preserve receipts and source history. AOP approval and attendance recovery gates remain closed and are not enabled by bulk identity approval. Independent business approval, final HK/MEPC allocations and applicable periods are required for any later AOP flow. Attendance recovery needs its own exact source/date/employee-day reconciliation.

## Installation verification (SQL owner; read-only after approved setup)

```sql
begin transaction read only;
select p.oid::regprocedure,p.prosecdef,p.proconfig,
 has_function_privilege('anon',p.oid,'EXECUTE') as anon_execute,
 has_function_privilege('authenticated',p.oid,'EXECUTE') as authenticated_execute,
 has_function_privilege('service_role',p.oid,'EXECUTE') as service_execute
from pg_proc p join pg_namespace n on n.oid=p.pronamespace
where n.nspname='public' and p.proname='rpc_confirm_retail_bulk_identity';
select count(*) from public.retail_store_import_approvals;
select count(*) from public.reliance_retail_store_master;
select count(*) from public.retail_employee_daily_attendance;
rollback;
```

Expect one exact `(uuid,uuid,uuid)` signature, SECURITY DEFINER, public/pg_temp search_path, no anon/authenticated execution, service_role execution, no seeded approvals and unchanged existing records. Compare the full function definition with the reviewed proposal and verify the newly recorded migration history. Full existing migration/catalog acceptance remains separately required. Local PostgreSQL/browser evidence is not authenticated production acceptance.
