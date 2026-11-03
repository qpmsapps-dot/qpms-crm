# October 2026 KM historical recovery: implementation acceptance contract

Status: engineering specification only. NOT a posting migration or release authorization.

## Verified production constraints (2026-11-03)
- fo_km_scope_control.emergency_pause = true.
- fo_km_financial_control.financial_writes_enabled = false.
- fo_km_attendance_authorizations count = 0.
- Read-only fo_october_km_recovery_preflight_2026 exists.
- Migration 246 fo_authorize_attendance_km_v246 requires session_user = postgres, a fully paused canonical policy, matching active employee identity, completed attendance, current reconciliation generation, valid provenance and an exact evidence digest. Authorizations expire within one hour.
- The live policy reconciliation route requires a valid unrevoked authorization and closed global gate. Never fabricate authorization rows or disable these checks.

## Required design
1. Create a read-only candidate manifest for 2026-10-01 through 2026-10-31, one row per attendance ID and generation. Capture employee identity, logout, provenance source/id, current credited baseline, evidence digest, supported additional KM/amount, exclusions and reason codes. Preserve existing credits.
2. Separate preparation and posting. An owner-controlled preparation transaction, only during full shutdown, revalidates the canonical calculation and issues narrowly scoped Migration 246 authorizations for eligible candidates. Service-role and Admin JWTs cannot invoke owner-only authorization directly. The trusted owner execution boundary must be explicitly implemented and independently reviewed, not simulated by spoofing roles.
3. Only after preparation and a fresh read-only gate check, enable the October-only Admin policy and release the scoped pause. Keep global financial_writes_enabled false and background worker off.
4. Post through the existing canonical reconciliation engine with immutable receipts. Never update attendance payable_km, petrol or credit ledger directly. Stop on any digest, generation, baseline, authorization, expiry or provenance mismatch.
5. Process <=10 candidates per request with durable cursor/progress, bounded retries and no request-timeout loss. An expired authorization must return to a closed-gate preparation phase, not be extended by a service-role caller.
6. Reconcile posted, unchanged, deferred and rejected results against credit ledger, posting receipts and baseline totals. Run the same candidates again and assert zero duplicate increments.
7. Close the scoped release, revoke any unused authorizations using the owner-controlled shutdown process, verify pause=true and release_until=null, retain all audit records. Railway maintenance and emergency settings require separate runtime verification.

## Mandatory regression gates
- Zero authorization: no financial posting.
- Unauthorized actor, wrong employee, wrong attendance/generation, stale evidence digest, missing provenance, unsupported GPS leg: denied.
- Pre-existing credit preserved; only verified incremental difference posted; duplicate invocation adds 0 KM and INR 0.
- November and non-October attendances cannot be credited by October release.
- Concurrent requests, expired authorization, network failure and batch resume are idempotent.
- Failed canary restores pause without deleting receipts or existing financial data.
- One real authorized attendance canary must show matching incremental KM, petrol and receipt before any bulk run.

Do not merge or deploy this specification as a working recovery implementation.
