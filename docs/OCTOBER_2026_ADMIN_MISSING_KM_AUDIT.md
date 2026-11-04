# October 2026 Admin decisions and claims PDF release

## Scope and behavior

This release adds an active, authenticated Admin-only October missing-KM review screen and October claims PDF to FO Activities. It records reconciliation decisions only. It never posts approved additional KM to payable KM, petrol, travel legs, GPS logs, settlement receipts, or claims.

The Admin dialog is owned by FOActivities rather than the child officer-details component. It shows employee/date, existing payable KM, suggested KM, original review status, GPS/route/checkout evidence and any recorded decision. Blank included-distance input is rejected; successful decisions refresh the list and explicitly report that payable KM and petrol are unchanged. Duplicate decisions return a conflict.

GET `/api/fo/km/october-missing-km/reviews` reads the complete fixed October period using stable bounded pagination. POST `/api/fo/km/october-missing-km/reviews/:id/decision` uses the existing verified JWT/profile authorization. UUIDs, decimal precision, bounds, evidence and justification are validated, terminal original reviews are blocked, and the actor comes only from authenticated request context.

GET `/api/fo/km/october-2026.pdf` independently reconciles each attendance ID against the installed one-row-per-attendance reporting view. Aggregation uses exact hundredths, deterministic pages and explicit failure at the safety limit. Ambiguous profile/adjustment mappings and duplicated attendance identities fail closed. TN business groups remain separate. Rejected adjustments are excluded; provisional proposals and Admin-approved-but-unposted KM are separate from existing payable/petrol. Decision appendices show verified actor IDs, dates, evidence and justification. Header/landscape report branding is retained.

## Database release

The original ledger and reporting view are already installed. Do not rerun their installation scripts. The additive `backend/sql/20261104_october_missing_km_release_hardening.sql` grants missing report SELECT permission to service_role and installs an idempotent ledger validation trigger/index. It checks October/source consistency, current review status and evidence bounds. RLS and append-only ledger privileges remain enabled. It contains no financial DML.

Apply only after the disposable PostgreSQL gate passes. Compare the installed definitions/ACLs and before/after October financial row fingerprint during release. Never create a real production decision just for acceptance testing.

## Validation evidence and known baseline failures

- Dedicated October HTTP/data/PDF tests exercise authentication, authorization, validation, duplicate prevention, deterministic full pagination, money reconciliation, no financial posting and opening a multi-page PDF.
- Disposable PostgreSQL tests exercise actual grants/RLS, database validation, idempotent installation, concurrent duplicate decisions and preservation of source attendance values.
- Four controlled browser tests mount the actual FOActivities component: dialog/evidence rendering, blank input, successful decision/refresh, duplicate errors and non-Admin controls.
- Production frontend build and scoped new-backend lint are required. The existing FOActivities file has four inherited unused-declaration lint errors; comparison against unchanged main verifies no new lint findings.
- The earlier CI job reported 31 broad backend failures despite a green conclusion because continue-on-error was enabled. That setting is removed. Original PR and unchanged main each reproduced 19 identical failures locally; environment-dependent/fixture failures differ on Linux CI. No unrelated module was changed to conceal those failures.
- The full-suite comparison job runs complete unchanged-base and candidate suites in the same environment, publishes both TAP files, reports inherited failures explicitly, and fails on new failures. A passing comparison is not a full backend regression pass.
- The Retail MIS one-time exact-hotfix check expected a patch already installed in main. It is replaced with an unchanged-JWT-middleware and mounted-path gate check, while all mounted Retail authorization tests remain mandatory. No Retail application functionality was changed.

## Release and live verification

Merge only after mandatory targeted, PostgreSQL, build, browser, KM and authorization checks pass and the baseline comparison adds no failures. Both production Railway services must report the merged commit; backend readiness, public frontend assets, protected route denials and deployment logs must be checked. Financial row fingerprint and decision count must match preflight unless an independently explained external change occurs.

Authenticated Super Admin browser acceptance is PENDING when no approved session is available. The business approver explicitly authorized proceeding with merge/deployment in that situation. Do not bypass authentication or equate controlled browser fixtures with live authenticated acceptance.

Owner acceptance: sign in at the production URL, open Operations > FO Activities, click October KM Review, then verify Admin Missing KM Approvals and October Claims PDF. The PDF is also reachable through October Export. Open the approval list and inspect evidence without recording a real decision just for testing. Export TN / Reliance Retail and TN / Standalone separately; verify period, original payable/petrol and clearly unposted proposals. Actual production URLs, merged/deployed SHAs, CI results and financial reconciliation are reported in the final handoff after deployment.
