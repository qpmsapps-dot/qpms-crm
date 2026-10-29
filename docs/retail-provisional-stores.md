# Provisional Reliance Retail Store Master

## Release and database boundary

Application changes may ship through GitHub main and Railway automatic deployment. The new view reports setup unavailable until the separately authorized SQL installation. Deploying the application does not install SQL or upload source data. No production database installation is authorized by this release request.

The implementation has no canonical-store, attendance, AOP, financial, GPS or KM write path. It does not replace the identity-approval function, its approval registry or any activation flag. `VERIFIED` means independently reviewed **in staging**, never an operational store. Existing canonical stores are counted separately and remain unchanged.

## Exact SQL installation procedure — authorization required

1. Record the production project, accountable database approver and authorization. Take a backup according to the existing database procedure. Read current `supabase_migrations.schema_migrations`; choose an unused migration version. Do not reuse `20261028120000`.
2. Run the read-only preflight in `supabase/verification/retail_provisional_preflight.sql`. Save the output. It fingerprints all 130 canonical rows, the existing identity functions and protected Retail attendance/AOP relations. If the canonical count differs from the expected 130, investigate before installation; never delete additional stores to meet the expected number. Confirm that none of the five proposed staging tables or eight functions already exists. If they exist, inspect the prior installation instead of replaying DDL.
3. The prepared migration version is `20261029120000`. Check that it is unused in the preflight history. After explicit authorization, execute `supabase/proposals/retail_provisional_apply_and_record.sql` once as the approved database owner. This exact package checks the unused version, the 130-store baseline and the existing identity RPC, installs `retail_provisional_stores.sql`, and records that complete source as one history statement in the same transaction. It creates five new tables, eight functions and four immutable-evidence triggers with no source-data seeds. RLS and table revokes apply to all five tables; only the five new RPC entry points are executable by service_role. Do not also execute the source proposal separately. If the version is occupied, prepare a newly numbered package and matching verification query for review.

4. Run `supabase/verification/retail_provisional_postinstall.sql`. The migration must appear exactly once with one_statement and source_exact_match true. All anon/authenticated/service_role table privileges must be false; the five RPCs allow only service_role execution. New staging tables must be empty before first upload.

5. Run `supabase/verification/retail_provisional_preflight.sql` again. Canonical/protected digests and identity function fingerprints must match the saved preflight. Retain both outputs and the migration receipt.

6. Grant MIS state access using exact, independently verified profile IDs and states. Database-owner example (replace the placeholder; do not execute literally):

   ```sql
   begin;
   insert into public.retail_provisional_access(actor_id,state)
   values ('<verified-profile-uuid>'::uuid,'TN');
   commit;
   ```

   Add one row per authorized state. Revocation deletes only the corresponding access-registry row. The backend service cannot grant itself access. The profile must also be active, have active status, Reliance Retail business and an HK MIS/Housekeeping MIS/Technical MIS/Tech MIS role. Admin/QPMSAdmin has global review/upload/decision access. The existing web Store Master route currently admits Admin and HK MIS; Technical MIS requires an independently scoped navigation/access change before using this screen. No existing navigation permission is broadened in this release.

## Admin upload

Open Reliance Retail → Store Master → **Provisional MIS Review**. Select `Reliance_Retail_Store_Master_Audit_Upload_Review.xlsx`, the existing 854-row workbook with a `STORE UPLOAD REVIEW` sheet, then **Upload to provisional staging**. All rows, including existing-code matches, conflicting codes, ambiguous codes and duplicate occurrences, are stored as `PENDING_VERIFICATION`. No business identity approval is required for staging. The existing parser validates headers, literal cells and the Excel container; it rejects formulas/errors and corrupt workbooks rather than interpreting them as approved identities.

The file SHA256, exact original bytes, complete parsed source including raw values and source references, worksheet row number and original raw-row digest are retained. The SHA256 is validated against the uploaded bytes inside PostgreSQL. Repeating the same file returns its original receipt and does not add rows. A changed file is a new numbered version; no older evidence is overwritten. Source versions are not silently merged. Withdraw outdated versions once the replacement is reviewed.

## MIS correction and independent approval

Filter by source state, source version, verification status or code/name. Source-state grouping remains stable even when a corrected geography is proposed; the corrected state appears separately in the row. Review original evidence, duplicate counts and canonical matches before proposing corrections. Blank/unknown geography remains visible to Admin for correction; it is not granted to an arbitrary MIS state.

Choose **Propose correction**. Supply the complete store name, city/geography, state, operating status, optional duplicate mapping to an existing canonical store, and a reason/evidence reference. MIS needs grants for both source and proposed states when changing geography. One proposal may be pending per source row; stale revisions are rejected. Source cells never change.

A different active Admin approves or rejects from **Change history**, recording a reason/evidence reference. Unknown operating status cannot be verified. Approval marks only the staging row `VERIFIED` and increments its revision. Rejection retains the previous review values. Proposal snapshots, actor IDs, timestamps, decisions and before/after events remain in history. Admin cannot approve their own proposal.

Duplicate detection identifies repeated normalized codes within the same file, canonical-code matches and occurrences in other non-withdrawn versions. It never chooses a winning row or consolidates physical stores. Cross-state and name conflicts must be resolved through explicit review; mapping is evidence only. A mapping to an existing canonical store never modifies that store.

To affect operational Store Master later, obtain separately approved identity evidence and use the existing identity-approval process. Staging verification does not create that evidence, write to its registry or relax its source-row/file checks. Existing canonical corrections require the separately authorized established canonical maintenance process. No automatic canonical promotion is supplied.

## Counts, export and rollback

State counts distinguish source rows, unique pending codes, pending rows, verified staging rows and canonical stores. Counts include all non-withdrawn source versions and do not imply unique physical stores. Filter to a version when reviewing a specific file. The summary uses original source state. Excel exports the selected detail scope, state counts, proposal history and authorized audit events; no spreadsheet edit grants approval. Original values are exported as literal strings/JSON, never executable formulas.

Admin can **Withdraw source version** with a reason. This hides it from default review/counts, blocks further proposals/decisions and retains all rows, original bytes and audit history. Including withdrawn versions restores visibility for audit. Re-uploading the same file does not undo withdrawal. Canonical rollback is unnecessary because this feature never changes canonical data. Do not drop staging tables as a rollback; preserve evidence. If needed, revert only this release's application commit and retain the restricted staging schema.

## Isolated validation

Run `npm run build` first to supply the production browser route, then run `backend/tests/retailProvisionalPostgres.test.js` with `RETAIL_PROVISIONAL_POSTGRES=1`, `RETAIL_STORE_REVIEW_WORKBOOK` pointing to the existing source workbook, and `RETAIL_CANONICAL_FIXTURE` pointing to the captured 130-store identity baseline. The test creates a disposable network-disabled PostgreSQL 17 container, installs prerequisite proposals only there, and uses the real workbook through HTTP/browser into PostgreSQL. It preserves canonical identity fixture digests, protected relation digests and existing identity-function definitions. Browser authentication is a local test session; this is not production authenticated acceptance. No production secrets or data writes are required.
