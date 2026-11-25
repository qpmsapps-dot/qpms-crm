# PR #125 — Fault Tracker Management ageing validation

Reviewed 25 November 2026 on `feat/fault-tracker-management-ageing`, based on PR
head `4db33a21` and current main `04474be6`. The existing branch and PR are reused.
Implementation changes are limited to React reporting and its calculation/export
utility. Test, CI and review documentation changes accompany them.

## Review findings and fixes

| Finding | Resulting behavior |
| --- | --- |
| Progress used exact state matching while ageing recognized aliases | Both use the same report builder, six operational regions and selection. PY joins TN; KA maps to KN. |
| Progress omitted unmapped source stages from its denominator | Both include the explicit unmapped row and reconcile to their selected total. |
| Progress truncated full stage names | Names wrap on desktop and mobile; no ellipsis. |
| Drill-down omitted store name and issue description | All eight requested detail fields are displayed and exported. |
| Drill-down stored a snapshot of ticket objects | Selection descriptors resolve against the current authorized data after each refresh, including changed/removed tickets. |
| Export sheet names differed from the request | Workbook contains `Stage-wise Ageing` and `State-wise Consolidated Ageing`. |
| Loose numeric coercion treated boolean values as zero | Zero is valid; missing/invalid/noninteger values are Unknown. |
| Management View hid source/import error messages | Failures display an alert; a failed data load leaves no ageing table/export. |

The stage report defaults to South – Cumulative. Its state selector and the
existing Stage-wise Progress selector synchronize in both directions. The
consolidated table always compares all six regions in the authorized response,
independent of the stage report selection. An additional unmapped region row is
shown when necessary so totals remain explainable.

All 17 stages come from the unchanged shared PR #124 stage definitions. No
stage, including `Work Completed - Call Yet to Close`, is hidden because of its
status or age. A call disappears only when absent from the current imported
response. Reports use all ticket creation dates in that response, consistently
with Stage-wise Progress; the separate existing performance-month control does
not narrow either report.

Known individual ticket ages form the average denominator, rounded to one
decimal place. Unknown ages count in totals and the Unknown column but not in
averages/oldest. Ageing includes zero, with inclusive whole-day boundaries
0–3, 4–7, 8–15, 16–30, 31–60, 61–90 and above 90. Consolidated 0–30 combines
the first four bands. Above-90 counts and detail ages are red.

## Local verification measured this run

- **30/30 source, calculation, frontend-function, access and disposable PostgreSQL
  tests passed**, with no skips. This includes the unchanged existing 17-stage
  persistence suite using actual proposed SQL in a disposable PostgreSQL 17.6
  instance, synthetic profiles/stores/history, repeated and duplicate imports,
  remark clearing, idempotency and concurrent-save/import regressions.
- **6/6 Chromium browser tests passed** against a fresh preview of the production
  build. All API responses were intercepted synthetic fixtures; external hosts
  were blocked and no existing server or authenticated browser profile was reused.
- Browser tests cover South plus all six selections, all 17 stage rows,
  bidirectional selector synchronization, chart/table totals, downloaded Excel
  values, bucket drill-down, all eight detail fields, retained Kerala stage/empty
  remarks after a synthetic Excel import, refreshed ageing, disappeared calls,
  authorized state subsets, denied requests, and responsive layouts.
- Real downloaded workbooks were decoded and compared cell-for-cell with the
  report model for all seven selections. Unit tests separately check bucket
  identities, weighted totals, Unknown ageing, leading-zero store codes, empty
  remarks and detail export fields.
- Desktop/tablet/mobile checks passed at 1440, 768 and 390 pixels, with no page
  overflow and full stage names. Desktop/mobile screenshots were visually reviewed.
  Wide tables scroll inside their cards. The CI workflow retains screenshots/traces.
- Scoped ESLint, `git diff --check` and the Vite production build passed.
  The build retains the existing large-chunk and mixed ExcelJS import warnings.

Commands:

```text
RUN_IFMS_PERSISTENCE_POSTGRES=1 node --test backend/tests/faultTrackerAgeing.test.js backend/tests/faultTrackerPersistencePostgres.test.js backend/tests/faultTrackerFrontendPersistence.test.js backend/tests/faultTrackerStoreScope.test.js backend/tests/faultTrackerEditAccess.test.js
npx eslint src/pages/FaultTracker.jsx src/utils/faultTrackerAgeing.js backend/tests/faultTrackerAgeing.test.js playwright.fault-tracker.config.js
node node_modules/vite/bin/vite.js build
npx playwright test --config playwright.fault-tracker.config.js
```

The Vite command is the implementation of `npm run build`. Local build/browser
processes received an explicit environment without production credentials, with
blank Supabase configuration and a loopback API URL. Dependencies were installed
from the npm cache with lifecycle scripts disabled. Local Node was 24.16.0;
the dedicated CI workflow uses the configured Node 22 and also runs `npm run build`.

Additional broader dashboard/navigation checks: **8 passed, 1 failed**. The failure
is the legacy `dashboard reuses read-only API and reporting model without polling
or write calls` source-regex assertion in `tests/ifmsDashboardNavigation.test.js`:
it expects `selectRows(source?.rows||[], global, local[id]` in the separate Retail
Dashboard, which now uses the executive report model. Both that test and
`src/pages/reliance-retail/RetailDashboard.jsx` are byte-identical to current main
(verified by Git blob hashes), so this is an unchanged baseline mismatch, not an
ageing report regression. Those files were not modified under this frontend scope.
The dedicated Fault Tracker suite and production browser suite pass independently.

## Existing Kerala updates — read-only production evidence

Measured 25 November 2026 using the connected Supabase project, after inspecting
the installed resolver and helper definitions and confirming they only read data.
No production records, functions, schema, roles or imports were modified.

Latest Reliance batch observed: `cfbb93a6-d952-4bdc-aa75-984cb86fe740`.
Only eligible active, uniquely matched canonical Kerala Store Master tickets were
queried. The installed 17-stage retained-history resolver returned:

| Check | Measured result |
| --- | ---: |
| Eligible Kerala tickets | 125 |
| Tickets with verified retained manual updates | 117 |
| Explicitly cleared retained remarks | 40 |
| Retained manual stages differing from source snapshot | 79 |
| Work Completed - Call Yet to Close still present | 21 |
| Unmapped/source stages, kept visible | 8 |
| Unknown ageing | 0 |
| Average ageing | 35.3 |
| Oldest ageing | 180 |

Observed ageing bands: **26, 8, 16, 29, 28, 3, 15, 0** in stage-column order,
including Unknown last. They sum to 125. The reporting utility was run against
the observed aggregate stage/age distribution and matched the independent SQL
ticket total, average and oldest age. No personal remarks or credentials were
copied into fixtures or committed files.

These are current database reads and local projection checks, **not authenticated
production browser acceptance**. Subsequent-import tests use synthetic browser
responses and disposable PostgreSQL; no live Excel upload or ticket update was
performed. Production values may change after this observation.

## Scope and approval

No backend application logic, SQL functions/files, schema, production ticket
records, role permissions, active Store Master rules, import workflows, mobile
files or other modules changed. No merge or deployment was performed. The root
checkout's pre-existing changes remain untouched. Generated local artifacts are
excluded from the commit.

The existing PR is updated for merge approval. Final CI status is recorded in its
description. Deployment and merge require separate approval; authenticated
production browser acceptance remains a release check.
