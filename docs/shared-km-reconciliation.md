# Shared incremental KM reconciliation

Source baseline: `41a1c84b41dd320bfd583458c3fff1e90e42d698`. This change is uncommitted, not deployed. Proposal 239 is not installed in production. No production KM credits were created.

## Current defects and replacement flow

The existing engine skipped missing checkout windows, lost derived auto-end coordinates between calculation and reporting, allowed payable straight-line fallback, and used a separate final-leg scheduler. Mobile End Day commits directly through Supabase, so a backend HTTP-only hook cannot reliably observe it.

The selected-date Admin route and durable attendance/GPS outbox both call `reconcileSupportedKm`. It loads bound evidence, calls the existing V2 travel-leg calculator, reconciles included leg KM and correction/supplement receipts, then calls `persistCanonicalKmV2` in incremental mode. A locked PostgreSQL transaction validates the snapshot and appends only the positive uncovered amount. Existing signatures and the existing canonical financial adapter remain available.

Missing checkout requires two corroborating actual mobile fixes away from the known site. No inferred midnight capture time is created. Auto-end uses the last valid same-attendance/day mobile capture and retains its age, original timestamp and administrative closure separately. Unresolved legs do not fabricate road distance. Directions can support trusted endpoints; Haversine is supporting plausibility evidence only. Known public transport stays non-payable. Ambiguous legacy inclusion or correction allocation prevents a speculative credit.

The mobile application is unchanged. Proposal 239 enqueues the existing manual/automatic attendance closure transactionally; the existing gated backend worker drains that outbox. Late GPS within seven days dirties its generation. Leases, generation-aware acknowledgement, snapshot checking and immutable receipts protect concurrent Admin/worker retries. Existing emergency, maintenance and ordinary database financial gate checks are mandatory; the P1 exception cannot authorize this path.

## Reports and settlement

Canonical-applied receipts appear as audit detail without being added again. Settled or P1-protected attendance receives a separate approved supplement; original attendance/settlement values remain intact. Daily/monthly/Finance projections and CSV/Excel reuse the recovery reporting overlay and expose the unsettled supplement separately. Financial posting and reporting flags are independent so disabling writes cannot hide legitimate supplements.

## Removed code

Removed the unused private direct final-leg persistence helper and the divergent final-leg worker body, replaced by the shared outbox call. Removed obsolete manual recovery dialog wiring from the dashboard recalculation flow; retained its component files and Migration 238 objects. Removed automatic payable Haversine fallback. No files or production tables were deleted. No broad cleanup of legacy public exports was attempted.

## Release prerequisites and sequence

1. Review the exact diff and SQL security design; resolve or explicitly disposition baseline regression failures. No release approval is implied by isolated checks.
2. Separately authorize proposal 239. It depends on installed 237/238 and their existing schema. It creates a ledger, outbox, restricted RPCs and additive protection triggers; it does not activate flags or backfill claims. Back up schema and history before installation and validate against the current production fingerprints.
3. Deploy the reviewed source only through GitHub main and Railway automatic deployment, after separate commit/push authorization. Keep shared writes and workers off during authenticated read-only acceptance. Verify both deployment SHAs and report assets.
4. Separately approve `KM_INCREMENTAL_REPORTING_ENABLED=true`; verify main daily/monthly/Finance/CSV/Excel paths with isolated authenticated acceptance. The present tests do not establish real production Admin browser acceptance.
5. A future financial activation requires `KM_SHARED_RECONCILIATION_ENABLED=true`, reporting enabled, the existing End Day worker flag for automatic processing, and separately authorized normal financial controls. This design deliberately cannot post while emergency pause, maintenance or the ordinary database gate prohibits writes. Do not reopen those controls under this development task or reuse temporary P1 authorization.

## Rollback

Before any real receipt: disable shared reconciliation and the existing End Day worker; retain holds, revert the scoped source through the normal approved release path. Preserve the database tables/history pending separate rollback approval.

After any real receipt: disable posting/worker flags first and retain reporting enabled. Preserve all ledgers and settlements. Do not drop proposal 239 objects, delete receipts, subtract claims or blindly deploy a baseline that cannot display approved supplements. Use a reviewed reporting-compatible rollback release. Any financial reversal requires a separately approved compensating audit entry, never destructive history editing. There is intentionally no automatic financial undo script.

## Acceptance evidence and limits

Evidence is under `artifacts/shared-km-reconciliation-20261025` in the main workspace. PostgreSQL 17.11 disposable tests cover actual JS-to-SQL posting, concurrent approvals, replay, rollback, settlement preservation, authorization, outbox leasing, late GPS and cross-ledger duplicate prevention. Source tests cover the common evidence pipeline and frontend result handling. Production application code and migrations were not changed.

For QPMSKL1410 on 16 October, the captured production snapshot contains 27.83 saved KM, no trustworthy End Day endpoint and no GPS across checked identity bindings. Replay preserves 27.83 and reports an unresolved final leg with null distance. The single authorized Directions request returned 26.696 km for Start Day to first Check-In only; it cannot establish the missing final leg.

Deployment and financial activation remain NO-GO pending the separate reviews, migration authorization, baseline regression disposition and authenticated acceptance above.
