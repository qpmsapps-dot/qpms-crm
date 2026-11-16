# KM worker ownership v2: one-time recovery and future automatic recovery

**Scope:** `end_day_km` only. Do not change GPS calculations, attendance credits,
Missing KM approvals, final-leg policy, or the general financial gate.

## Changes
- Add a 180-second lease on the KM ownership token. Renew every 30 seconds while working.
- Release RPC is idempotent after a lost response, and the backend retries transient
  release errors. A dead process leaves a token that expires automatically.
- Once expired, the next backend run can reclaim only the KM job and only within
  the same admitted worker epoch. It records an ownership audit entry.
- Each attendance is still separately leased/verified by the canonical
  reconciliation RPC, and receipts remain idempotent. This patch never inserts
  or rewrites payable kilometres directly.
- Other jobs continue using the original ownership RPCs.

## Ordered release and current stuck claim
1. Validate the active Railway deployment, one backend replica, and ensure the old
   backend process is no longer running. Record its deployment and commit hash.
2. Apply `20261116_km_worker_expiring_lease_v2.sql` to Supabase **before**
   deploying the new backend. Verify RPC EXECUTE is available only to
   `service_role`, plus direct trusted postgres operator access.
3. The **old** claim recorded before this migration has no lease. It must NOT
   receive an invented expiry. While the old backend process is verified drained,
   use the existing audited *operator* protocol:
   - Confirm the exact held `owner` and `token` in `qpms_workers.jobs`.
   - Call `rpc_worker_close_v1` with genuine incident evidence; record the new epoch.
   - Call `rpc_worker_reconcile_v1` for that precise claim using genuine proof
     the previous process can no longer perform side effects.
   - Verify the mode is `closed` and there are zero active owner/token rows.
4. Deploy this PR's matching backend after unit/PG checks. Keep the worker
   closed during the deployment. Verify exactly one running replica, health,
   and production commit plus the actual reviewed build checksum.
5. With `fo_km_automatic_control.canary` restricted to ONE valid completed,
   unleased attendance and a short expiry, use the installed
   `rpc_worker_open_km_canary_v1` operator procedure with the current
   closed epoch and actual retirement proof. Do not fabricate a test attendance
   or use an unrelated checksum.
6. Observe its actual `total_approved_km`, fuel amount, immutable receipts,
   posted queue state, claim release, and audit. If any mismatch, close the
   worker and investigate without posting further.
7. Only then clear the canary and confirm successive jobs run. Check heartbeat
   advancement in `qpms_workers.jobs.lease_until` and that pending claims
   return to unowned after each run. Test transient release failures in
   synthetic and isolated PostgreSQL tests before claiming crash recovery.
8. Verify old pending/failed records separately. A failed attendance does NOT
   become approved merely by opening the worker; preserve evidence checks
   and additive approved Missing KM.

## Rollback
- Stop new KM claims via `rpc_worker_close_v1` only after operator review.
- Roll back the backend deployment; leave v2 RPC definitions installed but unused.
- Do not toggle general financial writes open, delete financial receipts, or
  bulk-update `fo_attendance.total_approved_km`.

## Release gates
- New Node tests pass; database integration tests demonstrate expired-claim
  reclaim, live-heartbeat non-reclaim, expired token rejection, lost response
  retry, and isolation from other worker jobs.
- No new orphan claims after a simulated backend crash or temporary Supabase
  outage. Check job queue progression across multiple polling intervals.
