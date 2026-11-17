# Retail reporting and navigation repair

## Baseline and live evidence

Isolated branch starts at main `46707ec63c440d015c21339b00c423b461089ff1`
(merged PRs 98 and 97). Root checkout and other worktrees remain untouched.
Railway backend/frontend were online at that release, one running replica each,
zero crashes and no staged work. This is provider health, not report acceptance.
Supabase health advisor reported persistently high Data API errors.

Read-only production inspection confirmed SQLSTATE 57014 within
`rpc_retail_unified_snapshot`, specifically the import-row predicate repeatedly
calling `retail_unified_access` / `retail_role_states`. A 5-second-bounded
EXPLAIN ANALYZE of that count timed out. Materializing the identical predicate
once per distinct state returned all 1,708 import rows in 245.541 ms.
Completed snapshot calls in pg_stat_statements: 26 calls, mean 3,380.74 ms,
maximum 7,933.40 ms. Failed calls are not represented by those completed timings.

Exact raw source counts measured: 996 stores, 34,402 attendance rows, 18 cleaning
submissions, 72 uploads, 11 training sessions. These are database table counts,
not authorized period KPI totals. Estimates from pg_stat_user_tables were stale;
they were not used as zero evidence. Existing upload/store/date indexes exist;
no speculative indexes or timeout increases are proposed.

Caller audit: direct RPC reads in retailUnifiedRoutes and retailInitialAdminAccess;
shared wrapper in retailUnifiedService; consumers in retailModuleReportService,
retailSavedReviewService, retailZoneMappingService and retailServiceTrackerRoutes.
Only module reporting switches to the narrow RPC. Proposal-kind authorization,
Store Master stamps/imports, saved reviews, zone changes and service tracker
authorization keep the same full-snapshot contract. Installed MIS report,
operations snapshot and attendance source RPCs do not call the unified snapshot.

## Changes and protected behavior

The separately reviewed SQL proposal retains full Store Master response shape,
ownership, import receipts, proposal stamps and history, but evaluates the same
authorization predicate once per actual state. Upload membership uses UUIDs and
the existing submission index rather than casting each upload to JSON text.
It adds a service-role-only reporting RPC for dashboard, cleaning and training.
Reporting skips import payloads/proposals/history and attendance ownership reads
that its reducers never consume. Cleaning/Training use the narrow source; the
dashboard shares its one narrow source. Existing direct Attendance source stays
unchanged. No persistent authorization/result cache is introduced.

Retail South Head gets a separate Retail Operations route immediately after
Retail Dashboard. It reuses the existing nonfinancial HK FO reader and view,
after the management router verifies effective role/client/state grants. General
FO Operations and its existing financial visibility are untouched. HK MIS order
is Dashboard, Operations, Attendance, Deep Cleaning, Training. Its existing
mutation denial and evidence authorization remain active. Requested HK Operations
states must be assigned; AP-1/AP-2 helpers and DB grants are unchanged.

No KM engine, payable KM, petrol, financial posting, mobile code, OOS gates,
or attendance calculation rules change. Empty ready reports remain zero;
unavailable sources produce an explicit error, not fabricated counts. Timeout
diagnostics retain safe operation/SQLSTATE/request ID without private query data.

## Validation

Native disposable PostgreSQL test compares full snapshots before/after actual SQL,
and narrow output against baseline: 996 synthetic stores, 34,860 attendance rows,
1,708 imports, 18 cleaning reports, 72 uploads; distinct TN/AP-1/AP-2 readers;
unknown actors/modules and anon/authenticated calls denied. Synthetic fixtures
are not production acceptance. Focused permission/reporting tests and four
Playwright navigation/export checks passed. Full required CI results are recorded
in the repair PR; production acceptance remains separately gated.

The historical performance test previously compared dashboard totals with a
baseline predating independent completed-report counts and assumed an existing
artifact directory. It now preserves current-main count semantics and creates
its local output directory; latency assertions and scope/security assertions stay.

## Release and recovery order

1. Independent review of the exact repair diff and SQL; green required CI.
2. Explicit approval for the proposed SQL installation; record current function
   definitions/ACLs and recovery point. Do not rerun older proposals/migrations.
3. Run the guarded SQL once. Its installed-source hash must match the inspected
   baseline; drift aborts. No data rows, grants, AP mappings or financial gates change.
4. Post-install read-only checks: ACL restricted to service_role; repeat scoped
   plans/timings; compare same actor/date/store totals and denial cases.
5. Protected merge and compatible backend/frontend release after required approvals.
6. Verify deployed SHAs, service replicas, actual authenticated Arun/TN HK MIS
   reports and exports, and representative concurrent reporting without 57014.

Rollback is separately reviewed: revert application release to the compatible
prior SHA; retain the additive RPC and all data. If necessary, the separate
ROLLBACK_REVIEW SQL restores only the previous full-snapshot definition. That
restores the known timeout risk, so use only for a demonstrated correctness issue.
Do not drop data/history or widen permissions. Never treat a health 200 as acceptance.

## Outstanding live acceptance

No production SQL or deployment has been executed by this repair run. Migration
approval, protected PR approval and authenticated user acceptance remain required.
25 active Retail FO records match the current live-status employee-code key.
Seven have generic AP profile state and no current verified zone assignment:
do not infer AP-1/AP-2 or silently broaden their state grants. Verify their
authoritative mapping with its owner. Mixed line endings in the two touched
router files are normalized to LF so committed pins and whitespace checks agree.

TN HK MIS checklist: five links in order; only TN selector; no mutation controls;
named FOs/day/visits and last-known location; Attendance coverage vs source/AOP;
Cleaning stores/completed reports vs scoped records; Training totals/evidence;
Excel and Cleaning/Training PowerPoint; denied cross-state/business requests;
unavailable sources remain N/A with an error. Record date/scope and expected/actual
totals without credentials. Arun checklist additionally confirms all 11 Retail
entries, Operations below Dashboard, and unchanged separate financial visibility.
