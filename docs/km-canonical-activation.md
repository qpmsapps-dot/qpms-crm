# Canonical incremental KM activation

Code remains inactive with the current production settings. Installing proposal
241 and changing financial settings each require separate explicit approval.
Do not reapply 238/239/240. No financial backfill is part of installation.

## Installation and release

241 requires the installed 239 ledger/outbox and 240 private canonical executor,
scope guard functions and emergency control. Apply the reviewed 241 proposal only
through the approved migration mechanism and record its history entry once.
Installation creates a disabled policy, RLS-protected private execution/provenance
tables and service-only policy RPCs. It does not enable posting or enqueue jobs.
The application selects these RPCs only when KM_CANONICAL_POLICY_ENABLED=true;
preview does not call them. Missing schema fails closed, with no legacy fallback.

## Separately approved production policy

An owner-controlled transaction must set fo_km_canonical_policy's sole row:
enabled, admin_enabled, worker_enabled, starts_at, expires_at (at most 30 days),
date_from/date_to and maximum_attendance_km/maximum_attendance_amount. Caps apply
to cumulative incremental receipts per attendance, not each retry. Authorize the
actual date range/caps explicitly; this document supplies no financial authority.
Policy changes are audited. Browser/service roles cannot write these tables.

Release the existing fo_km_scope_control emergency pause only with an explicitly
approved release_until; expiry immediately stops policy posting/claims. The
application KM_FINANCIAL_WRITES_EMERGENCY_PAUSE must explicitly be false. Keep
KM_FINANCIAL_WRITES_MAINTENANCE=true and the canonical global financial gate false.
Do not enable unrelated workers or change P1 activation.

Set backend KM_CANONICAL_POLICY_ENABLED=true,
KM_SHARED_RECONCILIATION_ENABLED=true and KM_INCREMENTAL_REPORTING_ENABLED=true.
Enable END_DAY_KM_AUTO_RECALC_ENABLED=true only when worker policy is separately
authorized. Keep FO_GPS_EVIDENCE_REFRESH_ENABLED unchanged; genuine GPS inserts
already create bounded seven-day outbox follow-up. The existing scheduler runs
the same reconciliation service as Admin requests. No mobile code is required.
For operational one-click Admin posting, build the frontend with
VITE_KM_RECONCILIATION_POSTING_ENABLED=true through the normal approved release.
Otherwise the existing button continues Boolean dry_run:true diagnostic preview.
KM_SHARED_RECONCILIATION_PREVIEW_ENABLED=true may remain on under financial holds.

Only actual post-241 attendance closure/GPS trigger events create worker
provenance. Pre-existing queue rows do not acquire policy authority through
installation or arbitrary enqueue. An existing historical attendance can be
processed by authenticated Admin selection; do not fabricate events to authorize
a worker. Foreground and workers share the calculator, plan, 240 transaction core
and immutable credit ledger; scoped 240 Admin acceptance remains independent.

## Acceptance and shutdown

First use an explicitly selected attendance with preview evidence and known prior
inclusion. Inspect the persisted receipt, exact positive delta, petrol and monthly
report. Retry unchanged evidence: zero additional KM. Never infer success from a
timeout; inspect the receipt before retry. Settled claims remain immutable and
receive separate supplements, included once in reporting/export. Unknown baseline
inclusion fails closed, while independently supported legs may post when the
attendance baseline can be reconciled. Unresolved-only jobs finish as unchanged;
new genuine evidence requeues a generation rather than replaying a prior credit.

Immediate shutdown: set fo_km_scope_control.emergency_pause=true and the backend
emergency pause true; disable the policy/worker flags. No global gate change is
needed. Claims and posting check the DB emergency control in the transaction;
closing it waits for already-running authorized transactions to finish, then
blocks subsequent ones. Do not delete receipts or reverse settled values.

Before first policy use, the reviewed rollback proposal restores exact installed
240 functions and removes the unused 241 objects. After policy/audit use, schema
rollback deliberately refuses to erase history: disable policy and release a
forward corrective migration if needed. Code rollback is a scoped Git revert
through GitHub/Railway, keeping all financial controls closed.
