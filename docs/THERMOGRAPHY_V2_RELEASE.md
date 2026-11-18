# Thermography V2 — prepared release, not production installation

Integrated base: `46707ec63c440d015c21339b00c423b461089ff1`, current main. Original PR #100 remains the approved implementation record.
See [main integration, preflight and release approval packet](THERMOGRAPHY_V2_MAIN_INTEGRATION.md) for current scope and approvals.
This document supersedes the XLSX-report/100 MiB release instructions for this candidate only.
The older implementation remains in Git history; V2 accepts XLSX schedules and PDF reports.

## Current production evidence (read-only, 18 November 2026)

Project `ubawkjdbtickdlrgkulz`: inspections and existing Thermography commands exist.
The prepared report migration is absent from the ledger; report-version tables, report RPC
and private report bucket are absent. Five historical inspections include one duplicate
store/date group. No production data, schema, Storage settings or deployments were changed.
The V2 insert trigger preserves these historical duplicates and rejects new collisions.
Reconfirm the installation ledger and schema immediately before any separately approved release.

## Implemented contracts

- Server-authorized monthly Thermography query, independent from the unified snapshot.
  State authorization uses the existing predicates, evaluated once per state. Canonical
  code uniqueness uses the identical case/trim comparison against the complete Store Master.
  No shared Operations/MIS functions, AP-1/AP-2 grants, financial or mobile code are changed.
  Future rows retain their PDF action with a disabled/date explanation; the existing database
  rule forbidding completion before the scheduled date is preserved.
- Cards and chart use **scheduled dates** within the selected month, capped by server
  `retail_operations_today()` (Asia/Kolkata). Past months use the full month; future months
  return zero. Custom KPI dates do not narrow the full-month table. State/store filters
  apply to both; status and Store Code search filter table/export, preserving KPI meaning.
- Completion means an active, uploaded PDF version with verified hash/object linkage.
  Client approval/rework remains separate. Historical status-only completion is labelled
  explicitly and excluded from PDF completion; historical approval fields are preserved.
- Schedule Excel: one sheet, exactly Store Code / Scheduled Date, 5 MB / 5,000 rows maximum.
  Text and formatted numeric leading zeros are retained; codes already damaged by Excel's
  General number formatting cannot be reconstructed and must be corrected in the workbook.
  Excel parsing uses a separate worker with an empty environment, 128 MB heap, two-parser concurrency bound and 5-second deadline.
  Formula cells, invalid/month-mismatched dates, duplicate pairs, unknown/ambiguous/inactive
  or unauthorized stores are rejected. Preview exposes no unauthorized store details.
- Confirm revalidates every row and preview digest; import is atomic and append-only.
  Retries require the same request/payload and recheck authorization. Sorted advisory locks
  and the store/date insertion trigger prevent concurrent duplicates across old/new commands.
  Early, late and corrective uploads require an audit reason. Expected date = month start − 1 day.
- PDF: exactly `application/pdf`, `.pdf`, maximum **10,000,000 bytes**; signature,
  end marker and xref structure are checked in bounded temporary files. Original bytes
  and SHA-256 are retained. This is format/integrity verification, not thermal-content analysis.
  Private immutable version keys, signed upload authorization with upsert disabled, server-side
  stored-object download/hash validation, transactional revision checks and immutable receipts
  precede completion. Failed first upload remains Scheduled; failed replacements retain the
  prior verified original. Approved originals require the existing audited correction lifecycle.
- Authenticated PDF view/download, version downloads, client review, Excel export,
  schedule preview/confirmation/history, loading/error/empty states and monthly pagination.
  All CSS classes are Thermography-specific; Training's existing `tv-*` classes are untouched.
- MEPC MIS writes remain limited to their verified assigned states. Multi-state schedules
  require an existing multi-state assignment. No new role grants: Central MIS remains read-only,
  HK remains outside Thermography, Super Admin retains existing API correction privileges.
  New monthly MIS import is deliberately not a role-escalation path.

## Required validation

Run in this isolated worktree, without production environment files:

```
node --test backend/tests/thermographyReports.database.test.js backend/tests/thermographyReports.test.js backend/tests/thermographyReports.limits.test.js backend/tests/thermographySchedule.test.js backend/tests/thermographyDashboard.test.js tests/thermographyReports.test.js tests/thermographyTusUpload.test.js backend/tests/retailMisMountedAuth.test.js
node --test --test-concurrency=1 tests/thermographyReports.browser.test.js tests/retailOperationsShapeBrowser.test.js
```

Native PostgreSQL 17 is mandatory: set `RUN_THERMOGRAPHY_NATIVE_POSTGRES_TESTS=true`
and run `backend/tests/thermographyReports.concurrent.test.js`. Tests assert version 17,
real overlapping sessions, import/receipt races, replacement/finalization and approval races.
The 996-store monthly dashboard must finish **under 4,000 ms**; native sessions retain the
8,000 ms statement timeout. Measured locally after batching authorization: **165.9?208.2 ms**.
The earlier unbatched 4,760.5 ms failure was corrected, not accepted by raising the limit.
Native GitHub Ubuntu/PostgreSQL 17 also measured 67.8 ms. These are synthetic test timings;
representative production latency remains unverified.

The shared smoke fixture uses the V2 contract and verifies genuine zeroes, read-only schedule
actions and the same viewport/overflow protections. Search assertions wait for the requested
Store Code rather than mistaking the one-row loading placeholder for a completed result.

Required CI retains operational, UI, export, mounted authorization, build, native database,
browser and exact-file safeguards. V2's manifest pins exact Git blobs against the reviewed
integration base. Missing/extra paths, changed pins, altered base and unrelated workflow edits
fail closed. The previous authorization blocks and all subsequent workflow checks are retained.
Vite browser tests wait for the cold module graph to become ready before navigating.
The PDF-view test uses full Chromium (`channel: chromium`) and requires its PDF viewer;
the default headless shell cannot navigate PDF documents. See the [official Playwright browser guidance](https://playwright.dev/docs/browsers).

## Production approval and release sequence — DO NOT EXECUTE from this task

1. Review the draft PR and exact committed manifest. Rebase/integration with current main
   requires a fresh conflict/scope review and renewed exact-file pins; this PR targets the
   reviewed Thermography integration branch, not main. CI green does not authorize a merge.
2. Obtain explicit database/Storage approval for both prepared migrations, in order:
   `20261115140000_retail_thermography_reports.sql` then
   `20261118010000_retail_thermography_schedule_v2.sql`.
   Recheck absence first; never rerun an installed migration. Stop on drift or unexpected bucket.
3. Before approved execution, record restorable database/Storage backups, named operator,
   existing schema/ACL/RLS fingerprints and historical inspection aggregate/revision checks.
   Review the legacy duplicate group without deleting, merging or rewriting its records.
4. Apply only the reviewed migrations via the protected production process, with writes
   held closed. The first migration prepares the private PDF bucket and restrictive policies;
   no separate browser/service-role grants or broad Storage policy exceptions are allowed.
   Verify global Storage permits 10 MB, bucket is private/PDF-only and RLS/RPC ACLs are intact.
5. Obtain separate application deployment approval. Release the verified backend/frontend
   pair through normal protected deployment. No APK or mobile rollout is involved.
6. Use real authorized sessions for state MIS, approved multi-state MIS and read-only users:
   preview/import a reviewed schedule, verify exact Store Master mapping, upload original PDF,
   compare bytes on download, inspect till-date/full-month totals, client review/history/export,
   and deny cross-state/cross-business/HK requests. Check month boundaries in Asia/Kolkata.
7. Verify frontend/backend deployment commit identities, logs, representative monthly load,
   protected Retail regressions and existing record totals. Only then approve operational use.

## Separate recovery / rollback procedure

Do not drop report tables/bucket/policies, delete originals, undo imported schedules or run
destructive down-migrations. On failure, pause Thermography writes through the existing
`THERMOGRAPHY_REPORT_WRITES_ENABLED=false` operational control under separate production
approval, preserve private read/history evidence and capture failed request identities.
Keep the V2-compatible read backend available. The old 100 MiB XLSX backend is not compatible
with the new PDF bucket; do not blindly roll back to it. Prefer a reviewed forward correction.
Any database/Storage restore needs its own approved recovery plan and reconciliation of
post-backup imports, immutable PDFs and receipts before reopening writes.

## Explicit remaining acceptance limits

No production migration, deployment, authenticated production upload or live acceptance has
been performed. Historical Completed/Client Approved rows without PDFs remain unverified;
backfilling those records needs an explicit reviewed plan that preserves original approvals.
The dashboard supports at most 5,000 authorized inspections per selected month and fails
closed above that limit. History endpoints are bounded and paginated; the UI initially shows
the most recent 100 imports; version/event history is paginated in 100-row pages. No report malware scanning or thermal classification
is claimed. Infrastructure/domain health and real production performance require release checks.
