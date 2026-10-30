# Saved-source state-wise activation

Open Reliance Retail → Store Master → Identity Review → Consolidated state approval console. This uses the latest saved consolidated source; do not upload Version 2 again.

1. Select the geographic state. In **Prepare proposals**, inspect source evidence, official names and operating status. A state editor or Admin submits selected review-ready identities with a genuine source-review reason. Missing Zone, verified FO and AOP do not block identity review. Evidence-required and blocked new identities remain in separate queues.
2. A different active Admin selects **Independent approve / reject**, inspects the selected scope, and supplies the actual decision reference and SHA-256 of its evidence. The backend and database reject self-approval, unauthorized states and stale revisions. Source workbook approval cells are never authority.
3. After valid decisions, the authorized release administrator may enable the existing exact-string gates `RETAIL_BULK_IDENTITY_APPROVALS_ENABLED=true` and `RETAIL_STORE_IMPORT_WRITES_ENABLED=true`. They default closed; this release does not change them. The recorded Admin reviewer selects **Apply recorded approvals → Activate approved identities only**. Review per-state receipts and fresh canonical counts. Close the gates after the controlled activation window.

The existing identity contract requires a genuine supervisor-only owner name. Imported supervisor text is editable matching evidence, not a verified FO assignment. Do not substitute an invented name for missing evidence. This requirement comes from the existing secured identity RPC; no Zone, FO account or AOP is required.

The backend binds proposals to saved file SHA-256, row digest and revision. It derives an identity-only approval manifest only after recorded independent approval, and uses the existing bulk identity registry and canonical import RPCs. This is not a provisional reimport: source files, immutable raw rows and versions are retained. Existing canonical records are skipped on retry. Activation sets neither Zone/FO mappings nor AOP. Partial state failures and registry receipts remain visible; refresh counts before retrying.

## AOP

Select **HK / MEPC AOP**. All source staffing components remain separate with decimals and null unknowns. Pending identities retain review-only staffing evidence. Once identity is canonical, propose an explicit class total, calculation reference, approval reference and effective dates. A different reviewer approves it; Admin applies through the existing write gate. Apply HK and refresh before preparing MEPC for the same store, because each apply changes the store's AOP baseline. No inferred component sums or automatic budget activation.

## Existing Zone / FO workflow

Use Zones with All States or a permitted geographic state. Create Zones without an FO if necessary. Bulk Store Code mapping creates review proposals for verified stores and version-bound drafts for provisional rows. Assign only existing verified permitted FO accounts. Cross-state assignments, overlapping primary ownership and unapproved changes remain blocked. Existing TN/PY mappings stay intact; PY reporting consolidates under TN.

## Safety and verification

No SQL migration is added or rerun by this release. Existing authentication, state-scoped RPCs, independent decisions and canonical/AOP gates remain authoritative. Store, attendance, Training, Deep Cleaning, OOS and Fault screens show all seven geographic groups without treating pending source records as operational. Missing uploads display Data Not Available; unknown AOP remains pending.

Run `node --test backend/tests/retailSavedReview.test.js`. Full PostgreSQL/browser acceptance uses `RETAIL_UNIFIED_POSTGRES=1` plus `RETAIL_UNIFIED_PRIMARY`, `RETAIL_UNIFIED_MAPPING` and `RETAIL_UNIFIED_EXPANDED` pointing to the existing 854-row workbooks. Only disposable PostgreSQL fixtures are mutated. Production authenticated maker/reviewer acceptance remains separate from these tests.
