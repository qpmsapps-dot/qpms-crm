# November Deep Cleaning reconciliation: AP-1, AP-2, KL and TG

Read-only production observations on 19 November 2026 (Asia/Kolkata), project
`ubawkjdbtickdlrgkulz`. Source baseline: main
`098a0c8b6278ac6f6e2e25b5c39360a47b5992e8`.
No production mutation, proposal execution, manual-link RPC, migration, permission
change or deployment was performed. No TN/PY records were changed.

## Measured current state

The month is `[2026-11-01, 2026-12-01)`. Schedule geography comes from the canonical
Store Master UUID, not a store name. Submission geography and canonical identity
were checked separately. All schedules below are Planned; zero duplicate
store/date schedule groups and zero prior verified links for the inspected sources.

| State | Monthly schedules | Scheduled through 19 Nov | Submitted, Completed outcome | Current linked completions |
|---|---:|---:|---:|---:|
| AP-1 | 41 | 27 | 11 (9 distinct stores) | 0 |
| AP-2 | 53 | 36 | 0 | 0 |
| KL | 69 | 50 | 0 | 0 |
| TG | 45 | 45 | 0 (one submitted report, outcome NULL) | 0 |

AP-1 also has one uploading report at 1994, with no submitted timestamp or evidence.
The 11 Completed AP-1 sources pass the installed verified-source predicate. This
checks actor/canonical identity, immutable submission contract, uploaded before/after
pairs, exactly one supporting document, and matching Storage object size/MIME
metadata. It does not substitute for human review of image content or approval.

## Exact candidate pairs

All listed sources have `schedule_id = NULL`. All candidate schedules are Planned,
revision 0, have no prior verified source, and have no conflicting FO assignment.
Every candidate has different actual and scheduled dates; none can auto-match.

| AP-1 Store Code / name | Actual date | Original scheduled date | Disposition on 19 Nov |
|---|---|---|---|
| 3337 / Goothi Road | 13 Nov | 15 Nov | Eligible for explicit evidence/date-exception approval |
| TX1Z / RRL Trends Kurnool Srinagar Colony | 12 Nov | 19 Nov | Eligible for explicit evidence/date-exception approval |
| TY13 / RRL Trends Man Variety Mall | 17 Nov | 12 Nov | Eligible for explicit evidence/date-exception approval |
| 6228 / Srinivasa Nagar | 12 Nov **or** 19 Nov | 5 Nov | Reviewer must choose one source; one completion maximum |
| 1941 / Budavarpet | 15 Nov | 25 Nov | Future schedule: blocked by existing RPC today |
| 6379 / Budhavarapupeta | 14 Nov | 26 Nov | Future schedule: blocked by existing RPC today |

Approval identifiers (never match by the displayed names):

| Store | Canonical Store Master UUID | Schedule UUID | Source UUID |
|---|---|---|---|
| 3337 | ee6523f7-a3d7-4242-90c2-a09db9776814 | 1cd21ac2-fb6f-483b-9a72-a78db83f3e77 | 9db93e20-3466-4760-8890-e891eed66ea4 |
| TX1Z | 5b43a841-759d-4c27-a28c-da2069f9cc9b | c01dcf1a-d7d3-49bc-8bcb-6c499071d621 | 948f6b66-f32b-4aee-a7ad-840c902ded47 |
| TY13 | 9cc113ed-3d18-452c-ae9e-9516e12288f3 | a094d517-fb6b-4fb7-ad8c-249959596ed7 | e7058f87-62b6-4f09-bdb8-a094368d0ffd |
| 6228 | 97bb5661-b487-4763-9225-c48e4bbd7edc | 262bbd5d-da06-4df0-8f70-ca130df07b87 | bfe5477c-f320-494f-b19e-96a149662399 (12 Nov) OR 8cd004c3-2fa4-4760-8fb4-54f7065cfeb0 (19 Nov) |
| 1941 | 1173f8f9-857e-463c-ade7-819d9d84a272 | 881d6892-d3d6-4598-acc8-157c269955b6 | 8cc7884a-2651-432b-b814-910c3010d05f |
| 6379 | e72c5cec-a6c2-4796-a269-cc90e698616a | 16167779-92ca-4a42-925c-91aae93b299a | 1d129bc4-b636-4900-987e-686c4354b75c |

## Other manual-review cases

- **TTJ2 / HINDUPURAM, TUA0 / RRL CDIT -Kurnool, TZNS / KFPL Kurnool:** valid
  completed independent work, but no November schedule for the canonical store.
  TUA0 has two reports (5 and 16 Nov). Keep both independent visits; invent no schedule.
- **1994 / RELIANCE TRENDS KADAPA:** uploading, NULL outcome/submitted timestamp,
  no before/after/supporting files, and no November schedule. Not completed.
- **TG TB20 / kukatpally:** actual 7 Nov, scheduled 14 Nov; source
  `4ba5a667-2f9c-40ea-9c73-cdb8cfcec44e`, schedule
  `6b0a53d0-d05b-4afd-b2bb-e41d46a66e1f`, canonical store
  `9285b5e9-84bb-41c3-9dd0-bfe5ae6f85c5`. Submitted with 6 before / 17 after photos,
  but NULL final outcome, no immutable independent contract and no supporting
  document. Verified-source predicate returns false. Do not mark Completed or
  rewrite this historical report. A separate reviewed remediation would be required.
- **AP-2 and KL:** no November submissions; retain zero linked completion.

## Existing mechanism is sufficient; no code/SQL migration proposed

Installed bodies exactly match the reviewed definitions:

- `verified_client_source_v2`: MD5 `13a41c8250ba0455dc8c8e44e2e29088`.
- `match_verified_submission_v2`: MD5 `94223a1f8f49d0fe0592565b5f62c609`.
- `rpc_retail_cleaning_manual_link_v2`: MD5 `866bd1b485a2f87f4da27dfee149a9c9`.
- Trigger `z90_cleaning_verified_match_v2` is enabled (`O`), exact-date default.
- Manual RPC ACL: postgres/service_role only; internal verifier/trigger functions
  postgres only. The manual RPC additionally requires an existing active authorized
  Admin bound to the authenticated identity and `retail_unified_access(...,'edit')`.
  No extra MIS role, permission expansion or direct frontend database write is needed.

Proposed exception procedure, **not authorized for execution by this report**:

1. Reviewer confirms one exact source/schedule UUID pair, canonical state/business,
   both dates within November 2026, original photos/document, and FO assignment.
   Permit only the four specified states and approved pairs from this dossier.
2. Obtain separate production-record approval naming the pair and reason. Resolve
   6228 explicitly; never pick the newest/oldest report automatically. Future
   schedules remain blocked until their scheduled date, followed by re-review.
3. Use the existing authenticated backend verified-link workflow. Review its
   preview, current revision and dates; explicitly confirm the date exception and
   provide the existing 20–2000 character review reason. Recheck all evidence,
   authorization, mutation fences and conflicts immediately before the link.
4. The RPC locks source/schedule, rejects existing completion/reuse/stale revision,
   preserves both original dates and source identity, and writes
   `CLEANING_VERIFIED_MANUAL_LINK` with actor, before/after, dates and reason.
   Same-request retries are idempotent; the unique verified-source index and locks
   prevent concurrent reuse. Do not bulk UPDATE statuses or alter a submission.
5. Reload the existing report for the same authorized range and compare its
   schedule IDs, completion IDs, Scheduled/Completed/Pending, percentage, state
   chart and export. Independent report totals must not be substituted for linked
   schedule completions. If reporting is unavailable (the prior HTTP 500 remains
   unresolved by this task), stop; do not treat unavailable as zero.

The installed manual RPC supports other historical cases too. The narrower
same-month/four-state approval list above is an operational change scope, not a
claim that the existing general RPC has a new hard-coded month/state restriction.

## Provisional counts, not applied

- Approve the three unambiguous due AP-1 pairs: **3/41**, Pending **38**, **7.3%**
  for full November; through 19 Nov: **3/27**, Pending **24**, **11.1%**.
- Also approve exactly one 6228 source: **4/41**, Pending **37**, **9.8%**;
  through 19 Nov: **4/27**, Pending **23**, **14.8%**.
- If 1941 and 6379 are independently approved when due, maximum supported by
  current evidence is **6/41**, Pending **35**, **14.6%** for full November.
  This is not permission to complete future schedules today.
- AP-2 **0/53**, KL **0/69**, TG **0/45**, all **0%**, unchanged.

## Focused verification

`node --test backend/tests/deepCleaningStoreOnlyPostgres.test.js backend/tests/retailCleaningPhase1.test.js backend/tests/retailModuleReportService.test.js tests/deepCleaningNovemberReconciliation.test.js`

**47 passed, 0 failed/skipped**, including native disposable loopback PostgreSQL 17,
two-session completion/idempotency, reuse denial, missing evidence, explicit date
exception requirement, unauthorized actors, mutation fences, and source/date
preservation. Four added synthetic November tests cover 208 four-state schedules,
duplicate reports/retries, canonical identity versus identical display names,
AP separation, null outcomes, unverified Completed labels, unchanged exact-date
rules, and consistent chart/KPI percentages. No production environment files loaded.

Initial local run could not resolve worktree Express and hit a CRLF-sensitive
fingerprint on replay of the existing Super Admin SQL. The confirmed rerun used
existing backend dependencies and the exact committed LF SQL blobs, without
changing assertions or proposal content. Native test took about 12.25 seconds.
No frontend build is needed for this test/documentation-only change.
