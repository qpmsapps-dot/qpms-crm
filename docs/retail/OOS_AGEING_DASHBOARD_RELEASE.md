# OOS register, ageing and dashboard candidate

Branch `feat/retail-oos-ageing-dashboard-20261102`, based on deployed merge `dd9f15ae979e8b36cc40565b6822cda4788a35d6`. Prepared only; no production SQL, imports, Railway variable/gate changes or deployment.

## Verified contract gap and owner decision

Owner-level production catalog inspection on 2 November 2026 confirmed that `retail_service_orders` has no workflow-version column and the live MIS service command accepts only the six-stage sequence `QUOTED → PO_RECORDED → COMMERCIALLY_CONFIRMED → FUND_RECORDED → PAYMENT_RECORDED → DELIVERED`. Existing quotation writes reject cross-state store sets. No OOS orders were present at inspection. That is a point-in-time observation, not permission to assume an empty database during a later release.

The owner selected **Prepare a disabled versioned migration**, retaining legacy workflows until Commercial/Finance/Branch Head authority and evidence requirements are confirmed. Accordingly this PR is **draft / NO-GO for deployment of the full 12-stage objective**. It does not pretend six statuses satisfy twelve business events. The migration installs an immutable private version-2 catalog with all 12 exact requested names, `enabled=false`, and an immutable trigger plus CHECK that prevent activation. It deliberately installs no v2 transition/import/assignment path and does not convert any order. A later reviewed migration is required for that engine; toggling a flag cannot activate it.

Missing release requirements for v2:

| Stage/business event | Required policy decision before implementation/activation |
| --- | --- |
| Commercial PO confirmation, document receipt, JMS and invoice | Exact existing role/permission resolver and independent reviewer checks for each action; required document/PO/JMS/invoice identifiers and dates |
| Finance fund release | Explicit Finance resolver, required release evidence and creator/reviewer separation |
| Branch Head fund receipt/handover/work completion | State/branch ownership binding, verified handover evidence, mandatory work-completion evidence |
| MIS document submission and fund request | Required immutable file/evidence records, source validation and request details |
| Compatibility | Approved migration of any existing six-stage orders, if ever requested; default remains legacy without automatic remapping |

No MIS or operator grant implies any of these authorities. Existing service/import functions, financial checks, RLS, audit and retirement guards are unchanged.

## Implemented UI and reporting

- Header, four KPIs, all register data columns, searchable quotation/PO/store codes, canonical Store Master names, clickable details, filtered pagination and sortable quotation/PO/status ageing.
- Original business dates and financial amount come from the first immutable `CREATE_OOS` event, not a reworked header. PO number/date use the first `PO_RECORDED` transition. Current-status entry uses the latest immutable event whose before/after status actually differs (or original creation for QUOTED). Remarks, rework and refresh cannot reset these sources. No dates are persisted or rewritten.
- India calendar days at `Asia/Kolkata`; missing/invalid/future dates render unavailable with warnings. No upload/update timestamp fallback. Bands: 0–3 green, 4–7 amber, 8–15 orange, above 15 red. Bands are presentation configuration and do not change history. A minute timer updates ageing when the India date changes, including open details.
- New read-only `/mis/oos/register` calls a service-only scoped RPC. One bulk order/event projection supplies canonical stores, original financial source and compact status/rework history. It excludes workbook bytes and avoids one history request per exported quotation. A single explicit detail-history request still uses the existing protected route.
- Dashboard count/ageing toggle, cell average/max/over-7-day/unknown values, row and state totals, five overdue summaries and URL drilldowns. All 12 approved rows are displayed as **unavailable while disabled**. Live legacy counts and ageing are shown in a separate six-stage table; WIP/Invoice KPIs and unsupported overdue summaries remain unavailable, never fabricated zero.
- Full filtered Excel export across all pagination pages: register, line items, bulk status/rework history, status-ageing summary and export metadata. Text identifiers retain leading zeroes, formula-looking text is neutralized, unknown numbers/dates stay blank/unavailable. Single-workbook download actions are replaced; original files remain retained in protected audit storage.

## Period, scope and attribution rules

Month and inclusive date-range filters apply to the **original quotation business date**, consistently across register, matrix and export. They are not upload, PO, rework or status-change months. All-Time includes missing business dates; any dated filter excludes them. Ageing always runs through today's India business date, not the selected month-end. Matrix ageing averages/max use only known dates; unknown counts are displayed. Overdue means current-status age **greater than seven days** and is monitoring, not authorization.

One canonical quotation ID is counted once, regardless of items or store mappings. State is derived only from its complete canonical Store Master mapping. Every mapped store must resolve to the same state and be within the existing authorization predicate. A missing, partial or multi-state attribution is an explicit exception: retained in the authorized register with a warning, excluded from the state matrix, never assigned to an arbitrary state and never duplicated. Retired quotations are excluded from active KPIs/matrix but remain filterable/exportable with history. PY remains a separate canonical state; it is not silently folded into TN.

## Migration and release order (NOT executed)

1. Recheck current approved branch/base, production schema, exact actor scope, live gate/freeze values, recovery evidence and protected function fingerprints. Do not reuse zero-order assumptions or the earlier zero-assignment/closed-gate immediate postinstall against an activated system.
2. After separate release authorization, apply **only** `supabase/migrations/20261102133951_retail_oos_register_ageing_v2_disabled.sql` using the migration tool and record its actual ledger version. It is transactional and not rerunnable. It adds one private catalog/immutable trigger and one read RPC. No existing function bodies or status constraints are replaced.
3. Require `supabase/verification/retail_oos_register_postinstall_read_only.sql` PASS. Confirm existing write-gate values and business/audit/storage counts unchanged. The new verification is compatible with an already-active production gate and does not reset it.
4. Keep the full release blocked until the twelve-stage engine and required role/evidence policy are separately reviewed/tested against the production contract. If an independent legacy-only UI release is desired, explicitly review that narrower scope first. This PR is not authorization to deploy.
5. An eventual application release must use reviewed GitHub main/Railway, actual merge SHA, successful frontend/backend replacement, HTTPS assets and authenticated allow/deny acceptance. Never enable v2, import Excel, change freeze or broaden accounts during this candidate review.

Recovery: a failed migration rolls back before commit. A postcommit problem holds deployment and is diagnosed through review; leave the additive private catalog/read function installed. An authorized application revert can return to the previous UI without removing business data. Never delete original files, audit/history, import receipts or quotations; no destructive schema rollback.

## Validation and screenshots

Use existing dependencies; backend node_modules is an ignored junction to the installed dependency directory. No dependency or lockfile changes. The first combined test attempt lacked the backend dependency junction; after linking existing dependencies, the affected HTTP tests passed and the complete suite was rerun.

```powershell
$env:RETAIL_MIS_PG_TOOLS='D:\QPMS_CRM\tmp\retail-mis-test-tools'
$env:RETAIL_OOS_TRAINING_TEST='1'
$env:RETAIL_OOS_REGISTER_TEST='1'
node --test backend/tests/retailMisAccess.test.js backend/tests/retailMisPostgres.test.js backend/tests/retailMisQuotationFormat.test.js tests/retailOosAgeing.test.js tests/retailOosTrainingBrowser.test.js tests/retailMisBrowser.test.js tests/retailOosAgeingBrowser.test.js
```

Coverage includes native PostgreSQL transactional rollback, private ACLs/RLS, disabled immutable catalog, original dates/amounts through rework, original PO date, status timestamps, byte exclusion, canonical scope, generic-account denial, unchanged mutation bodies, India midnight/leap/invalid/future dates, bands/sorting, duplicate counting, full 2,101-record Excel roundtrip, formula injection, desktop/mobile, zero records, multiple states, complete browser export, matrix drilldown, request counts, existing double-click/idempotent submit and status authorization flows. The optional supplied-real-workbook parser test is skipped without an owner-provided source; generated fixtures are never represented as production evidence.

Final focused suite: **27 tests, 26 passed, zero failed, one optional owner-workbook test skipped**. Scoped ESLint and Vite production build pass. No TypeScript/typecheck script exists in this JavaScript project; syntax is checked by lint/build and Node execution. Existing mixed-import and bundle-size warnings remain.

Screenshots are intercepted localhost synthetic QA, visibly labelled, **not production acceptance**: [desktop register](screenshots/oos-ageing/register-desktop.png), [mobile register/details](screenshots/oos-ageing/register-mobile.png), [desktop matrix](screenshots/oos-ageing/matrix-desktop.png), [mobile matrix](screenshots/oos-ageing/matrix-mobile.png).

Protected areas not touched: mobile, backend/server.js, authentication, GPS/KM/attendance/payroll, Railway settings, OOS write/freeze gates, existing mutation RPCs/RLS, profiles/account assignments, storage objects and immutable history. Dirty root and other worktrees preserved.
