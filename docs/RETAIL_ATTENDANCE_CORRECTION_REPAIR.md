# M-Here Attendance correction repair — proposal, not production recovery

Base main: `6db290b91612663c2b66c1b7ce2d7a1fb7ce817d` (merged PR115).
Branch: `fix/retail-attendance-correction-timeout`. No production SQL, records,
configuration, deployments, approvals or financial operations were changed.

## Root-cause evidence measured on 24 November 2026

The M-Here page posts to `/api/reliance-retail/mis/attendance/commit`, whose
verified MIS middleware calls `rpc_retail_mis_attendance_commit` as the server's
service role. The shared Axios client has a 60,000ms timeout; the old commit route
did not propagate browser disconnects to its RPC request.

### Incomplete correction snapshot

The existing preview calls the set-returning `rpc_retail_attendance_conflicts`
without pagination, then persists those returned IDs as `expected_ids`.
PostgREST's result-row cap truncates this to 1,000 rows. Read-only production
counts joined distinct incoming employee/date keys to *all* current site rows:

| Preview batch | Valid rows | Rejected | Saved IDs | Actual affected rows |
| --- | ---: | ---: | ---: | ---: |
| `faf6f72b-d6d7-478c-91ea-4e4881a645da`, 1 November | 2,468 | 0 | 1,000 | 2,446 |
| `a9b019bd-97d7-4644-9f99-464219af7387`, 1–9 November | 22,384 | 0 | 1,000 | 22,014 |

Both remain `preview`, with no committed timestamp. These snapshots cannot pass
the RPC's exact optimistic-concurrency comparison. Normal new-date imports have
no conflicting IDs and avoid both this mismatch and the supersession operation.
The new code does **not** silently repair these old audit snapshots: the operator
must validate the original workbook again and explicitly review its complete scope.

### Query cost and contention

Installed MIS RPC takes the global `retail_uploaded_attendance` transaction lock,
expands the JSON payload repeatedly, calls canonical uniqueness and role/state
helpers per employee row, checks cross-scope current rows and compares conflict
IDs before updating. Its `id::text IN (...)` update cannot use a UUID primary-key
equality lookup. Long work under the global lock queues competing requests.

Production already has the partial employee/date/store unique index and current
store/date index. A read-only EXPLAIN of the conflict lookup showed the existing
employee/date index in use: this is **not** evidence that a new Store Master index
or a blanket timeout increase is required. No Store Master or index is changed.
Table statistics showed ~68,958 live attendance rows and zero estimated dead rows;
the canonical Store Master had 1,022 rows. No matching active commit/blocker existed
at the sampled instant; historical contention was reported by the operator.

Isolated PostgreSQL17 reproduction, original installed-workflow source with
equivalent attendance authorization: 2,468 rows with 1,000 saved conflicts failed
`40001` after 3,224ms and retained preview. A 22,384-row correction with a **complete**
22,014-ID snapshot hit the unchanged eight-second SQL timeout (`57014`, 8,011ms),
also retaining preview. Thus pagination and execution cost are independent defects.

The production browser's 60 seconds is not a measured SQL execution duration.
Role catalog settings showed authenticator statement/lock timeouts of eight seconds
and no service-role overrides; effective per-request settings were not independently
observed. No matching function statistics/log context was available in the targeted
sample. We do not infer a production cancellation or still-running query from that.

### Ambiguous transport outcomes

A browser deadline is not a database receipt. A transaction can remain in flight,
roll back later or commit after the HTTP reply is lost. Native multi-session and
local HTTP-disconnect tests demonstrate preview while the transaction holds its
lock, followed by committed status after commit. A `preview` row alone does not
prove a request stopped. Production requests were not replayed to demonstrate this.

## Minimal repair

`supabase/proposals/retail_attendance_correction_commit_20261124.sql` is **unapplied**:

1. Adds a service-role-only conflict-snapshot RPC returning one JSON object with
   an exact count and complete records, avoiding PostgREST row pagination. Backend
   rejects count/length mismatch, duplicate IDs or the 100,001-row overflow sentinel
   before saving a preview. Existing set-returning RPC stays unchanged.
2. Replaces only the MIS attendance commit body. Distinct canonical store/code/class
   tuples and distinct state/class permissions are checked set-wise. The existing
   authorization helper is reused; canonical uniqueness remains equivalent to its
   installed helper. Employee/date matching includes **all** current sites, including
   foreign-scope conflicts. Typed UUID joins select and supersede exact IDs.
3. Uses `pg_try_advisory_xact_lock` on the **same** global key and NOWAIT batch locking.
   A busy writer returns `55P03` promptly. All existing direct-writer/row-trigger
   locking remains authoritative; no mutation fence, trigger or RLS is disabled.
4. Adds an owner/current-state/class/preview-key checked, read-only status RPC. It
   exposes receipt metadata and conservatively reports whether any attendance writer
   is active. It does not claim which batch that writer owns.

Existing employee-day cap, half credits, HK/MEPC mapping, stale-preview check,
reason requirement, source audit, superseded-row immutability, idempotent committed
receipt and single-transaction rollback remain intact. General Admin/AOP commit,
attendance credit/percentage/target functions and all installed auth helpers are
unchanged. No tables, queues, workers or new attendance systems are introduced.

The backend keeps the existing commit RPC and response receipt. It propagates an
abort signal and a 45-second dependency deadline (not an increased browser limit).
Transport failures are labelled **unconfirmed**, with safe structured errors and
bounded diagnostic timing logs. A malformed/null receipt cannot be called success.

Only the M-Here upload form is extracted from the shared MIS page. It displays the
complete affected count, requires correction reason/review, prevents duplicate clicks
and submits one POST. On a lost reply it reads status once, never auto-reposts.
While a writer remains active or status is unavailable, resubmission is disabled.
Only batch ID/key are retained in actor/module-scoped session storage for reload
recovery; workbook bytes, employee data and correction reasons are not retained there.
Progress is textual transaction/status state, never a fabricated percent complete.
All non-Attendance MIS page content is still compared byte-for-byte by guard tests.

## Validation

Native PostgreSQL17 is mandatory, with the existing eight-second statement timeout.
Measured representative local runs: 2,468 rows / 2,446 supersessions ~0.56s;
22,384 rows / 22,014 supersessions ~3.03s. Fixed acceptance limits: single day <3s;
nine days <8s. Fixtures include 3,000 canonical synthetic stores and mixed HK/MEPC,
P/HD credits; no production credentials or employee fixtures are used.

Tests cover full >1,000 conflict snapshots, rejected old partial previews, idempotent
replay, independent PostgreSQL sessions, fast contention failure, failed-insert
rollback, unchanged unrelated dates, original evidence/reasons, employee-day cap,
duplicate rows, inactive/unauthorized actors, browser-role denial, exact AP-1/AP-2
boundaries, cross-scope employee/day denial and lost HTTP acknowledgment recovery.
Browser fixtures cover confirmation, double clicks, timeout/status recovery, reload,
incomplete preview rejection and mobile layout. Legacy Attendance/exception, MIS
authorization, Retail, Thermography and Deep Cleaning CI remain mandatory.

An isolated browser configuration uses strict port 4186 and refuses stale Vite
servers from other worktrees. Source and database verification are distinct from
authenticated production acceptance, which remains pending release approval.

Local verification: 315 focused/parser/permission/guard/regression tests passed;
one pre-existing opt-in test for a different historical workbook was not run.
Ten native PostgreSQL tests passed, including actual local HTTP disconnect with a
subsequent committed receipt. Chromium: 19 existing/new checks plus the added stale
preview recovery check passed (20 total); CI runs all 20 together. Scoped ESLint and
the production frontend build passed; the existing bundle-size warning remains.
The commit's full file list is pinned by the correction manifest; scope includes
only M-Here/Attendance workflow code and explicitly reviewed tests/CI/documentation.

## Read-only reconciliation — provisional, not an approved import list

Current 1–22 November credit sum independently measured: **36,041.5**.
The retained 1–22 preview `81a97a1a-5857-47db-81a2-8203e028351b` contains 54,590
validated rows. Its proposed credits total **37,159**, matching the supplied
reference. This is a stored validated-payload comparison, not a new audit of every
original workbook cell or business approval of each correction.

| Date/range | Current credit | Incoming credit / provisional delta |
| --- | ---: | --- |
| 1 November | 1,600.5 | incoming 1,693; delta +92.5 |
| 2 November | 1,685 | incoming 1,767.5; delta +82.5 |
| 3 November | 1,679 | incoming 1,766; delta +88; preserve unmatched +1 |
| 4 November | 1,670.5 | incoming 1,757.5; delta +87 |
| 5 November | 1,608.5 | incoming 1,700; delta +91.5 |
| 6 November | 1,671 | incoming 1,758; delta +87 |
| 7 November | 1,688 | incoming 1,767.5; delta +79.5 |
| 8 November | 1,383.5 | incoming 1,486; delta +103.5; preserve unmatched +1 |
| 9 November | 1,608 | incoming 1,682.5; delta +75.5; preserve unmatched +1 |
| 10–16 November | see reviewed per-date source | deltas +61, +51.5, +50, +51, +47.5, +52, +46 = +359 |
| 17–20 November | equals incoming credit | zero provisional credit delta; row counts can still differ |
| 21 November | 1,704.5 | incoming 1,691.5; delta **-13** |
| 22 November | 1,601.5 | incoming 1,589; delta **-12.5** |

There are **72 unmatched current rows** (eight on each of 1–9 November), contributing
**three man-days** overall. Most have zero credit. They are outside the incoming
employee/date keys and must not be deleted, zeroed or implicitly superseded.
The provisional 1–9 increase is +787; 10–16 +359; 21–22 -25.5. Applying only
authorized incoming-key corrections while preserving those unmatched rows would
therefore yield **37,162**, not 37,159. The extra three man-days need independent
manual review. Never force the aggregate to the reference or fabricate absent rows.

## Approval and exact recovery sequence

1. Review PR scope, exact committed pins, all CI, forward SQL and preservation tests.
   Obtain separate SQL/deployment approvals; approval of this engineering task is
   not permission for migration, merge, deployment or attendance recovery.
2. Approved DBA/operator records existing MIS commit function definition/ACLs,
   original helper/trigger fingerprints, backups/recovery point and current batch
   states. Check active transactions/blockers. Stop repeated submissions and arrange
   a quiet correction window. Do not terminate sessions without explicit authority.
3. Under the approved production change process, install only the proposed SQL
   transaction once (rerun is idempotent). Do not rerun migrations 232/MIS foundation,
   alter roles/RLS, Store Master, AOP, financial settings or global timeouts.
4. After separate deployment approval, release matching backend/frontend. Read-only
   verify function ACLs, service health, status endpoint and unrelated modules.
5. Obtain scoped recovery approval for the original workbooks and per-date correction
   reasons. Existing truncated preview keys are unusable. Revalidate originals to
   obtain complete current expected IDs; never patch their production audit metadata.
6. Recover **1 November only** through the existing UI: validate -> review complete
   employee/date/site scope -> confirm correction/reason -> commit once -> verify
   committed receipt/status. Reconcile actual rows, credits, HK/MEPC/HD totals,
   source preservation and unchanged unrelated dates against the fresh preview.
7. Only after that date is independently accepted, repeat for 2, 3, ... 9 November.
   Stop at any unexpected delta, invalid source, scope denial, stale snapshot or
   timeout. On timeout read status; a live writer means wait, never blindly repost.
8. Reconcile **10–16** one date at a time with original evidence; approved corrections
   follow the same workflow. Do not assume the existing committed batch is accurate
   merely because it imported successfully. Review the negative **21–22** changes
   separately; never assume every correction must increase credit.
9. Resolve the 72 unmatched rows via evidence/business review before declaring totals
   reconciled. Missing from the new workbook is not proof of absence. Preserve all
   historical records and require separate authorization for any explicit correction.
10. Confirm all daily/MTD totals dynamically after approved operations. No target
    man-day value, employee identity, schedule link or attendance status is hardcoded.

## Non-destructive recovery/rollback

If acceptance fails, stop new corrections and inspect committed receipts first.
Do not rerun an ambiguous request or reverse historical rows manually. A known SQL
failure rolls the transaction back; a transport timeout requires status confirmation.
Preserve original workbooks, audits, reasons and superseded versions. Application
rollback may be approved independently; the additive service-only read RPCs may
remain installed. Restoring the original slow MIS function requires explicit review
and would reintroduce its known limitations. A committed but incorrect business
upload must be corrected only by a separately reviewed original-evidence workbook
through the existing workflow, never by deleting or reactivating history directly.
