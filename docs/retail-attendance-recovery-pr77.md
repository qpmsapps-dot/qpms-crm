# PR 77: October Retail attendance recovery

Verified read-only against Supabase project `ubawkjdbtickdlrgkulz` on 4 November 2026. No attendance, Store Master, AOP, schema, grants, or feature gates were changed. No merge or deployment was performed.

## Source and recovery totals

Original committed batch: `1400fe40-f2d1-46f1-9dad-ba559d9b95cb`.
Recorded original workbook SHA-256: `987a4d77477a0a5c39c6aee6b368d637be8014b3076b2d598d62046f4546a4d7`.
Retained source: 64,838 rows; original accepted 9,578; rejected 55,233; excluded 27. These reconcile exactly. Validation inspected the retained parsed source and its row evidence; the original workbook bytes were not independently rehashed.

| Canonical state | Unknown-code rejects | Now matched | Existing employee-day conflicts | Candidates | Candidate credits |
|---|---:|---:|---:|---:|---:|
| AP-1 | 5,428 | 5,428 | 198 | 5,230 | 3,516 |
| AP-2 | 10,396 | 10,396 | 385 | 10,011 | 6,642 |
| KA (reporting KN) | 22,032 | 22,032 | 816 | 21,216 | 14,621.5 |
| KL | 8,667 | 8,667 | 321 | 8,346 | 6,051 |
| TG | 6,677 | 6,677 | 248 | 6,429 | 5,126.5 |
| TN | 130 | 130 | 4 | 126 | 107.5 |
| Unmatched | 1,903 | 0 | 0 | 0 | 0 |
| Total | 55,233 | 53,330 | 1,972 | 51,358 | 36,064.5 |

No additional matched-source validation rejections were found. Counts describe rows, not unique employees. Unknown stores have no verified state assignment and remain in the unmatched bucket. Conflict rows receive no recovery eligibility. Candidate counts are not permission to post attendance.

The first bounded production preview returned 482 validated rows, zero rejections, `review_only:true`, and `can_commit:false`, with no batch ID or preview key. The client used for production validation prohibited writes. Complete state totals cover the entire retained source even when the returned row page contains only 500 records.

## Implementation and safeguards

- The existing authenticated, feature-gated audit and preview routes retain the established active administrator role checks.
- Store Master and conflict results are paginated. Duplicate normalized store codes and incomplete/ambiguous source references fail closed.
- Attendance validation runs across the entire source, including original accepted rows. Employee/site/day duplicates and excessive employee-day allocation cannot disappear across preview pages.
- Existing employee-days remain blocked. Recovery previews are read-only and never create ordinary import batches or commit capabilities.
- Preview reconstruction uses retained normalized mandatory values so Excel numeric identifiers and date epochs cannot alter identity. Original raw cells and evidence remain untouched.
- A single recovery review runs per backend process; failures release the slot. The preview reuses the decoded original source rather than loading the large audit twice.
- Status credits remain A/T/H/NO-SHOW = 0, P/H-P = 1, HD/H-HD = 0.5. Unknown statuses are rejected. No status or AOP policy was changed.

## Dashboard coverage

There are 851 canonical stores; 842 have approved AOP throughout the inspected October period. Nine stores lack complete AOP. Daily and MTD full-scope percentages correctly remain unavailable where attendance or approved AOP is missing.

The added coverage section compares only matching store, class, and date combinations with both uploaded attendance and approved AOP. Missing uploads contribute neither fabricated zero attendance nor unmatched targets. It is labeled separately from full-scope percentages.

| Through 27 October 2026 | Covered actual | Matching target | Coverage attendance |
|---|---:|---:|---:|
| Daily HK | 1,263.5 | 1,577.95 | 80.07% |
| Daily MEPC | 242.5 | 170.92 | 141.88% |
| Daily combined | 1,506 | 1,748.87 | 86.11% |
| MTD HK | 6,686.5 | 7,711.35 | 86.71% |
| MTD MEPC | 1,072.5 | 935.21 | 114.68% |
| MTD combined | 7,759 | 8,646.56 | 89.74% |

Rates above 100% are not capped; they reflect credits above the applicable planning target and require business review. MEPC planning cycles, effective dates, fractional AOP, and original full-scope coverage safeguards are retained. Recovery candidates have not been included in these production totals.

## Validation and release limits

Focused recovery, coverage, attendance parser/audit/reporting, AOP display, and Retail route tests are included in local and CI checks. The real PostgreSQL suite passed 13 checks, including the private October reference workbook, correction rollback, concurrency, HTTP flow, and RLS. Its readiness probe now waits for the final TCP server; the optional private workbook test explicitly skips when its untracked fixtures are unavailable. Two obsolete Retail regression assertions were aligned to unchanged main-branch routes/access without changing application permissions.

Production frontend build passed using locked dependencies. Local Node is 24; GitHub CI uses the backend's declared Node 22. Local validation: 59 focused attendance/Retail checks passed (two optional skips in the standard run); the separate PostgreSQL run passed all 13 checks with private fixtures; 71 wider Retail operational checks passed; 10 attendance browser tests passed against an isolated built demo fixture. Scoped lint passed. GitHub CI results are reported separately with the final handoff. Synthetic browser fixtures do not establish authenticated production acceptance.

Do not merge or deploy with failing required CI. Release of these audit/coverage changes does not authorize posting 51,358 candidate rows. Full recovery still needs a complete fresh preview and reconciliation of 1,972 existing employee-day conflicts and 1,903 unmatched rows. Missing AOP remains a separate data dependency; no target values or effective dates were inferred.
