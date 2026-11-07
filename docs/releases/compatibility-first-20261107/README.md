# REVIEW ONLY — DO NOT MERGE OR DEPLOY

This draft contains the compatibility bridge only, based on b47480e075cf1143e585c053bb7f61902fbceb4e. No production change, migration installation, backend deployment or APK build is authorized by this PR.

## Reviewed source identity

The accompanying release-manifest.json is the original pre-commit artifact manifest, not a claim of a deployable Git SHA. Its 362 source entries were verified against the worktree before staging with zero mismatches. Working-tree SHA-256 values may differ from normalized Git blob hashes because of line endings.

- Backend artifact SHA-256: ab138f03fa7ca65c5bcfa2de3c424e3b64f72d94c94c782b3a71d83b57f672ae
- Release tree SHA-256: b9b3636326475bccc2979f9671592abcb482a80ff379b8cce5b89f20f4ece163
- Original manifest SHA-256: 61d17bf276bddeeaa6ded0078f0269ef37e6712a2524b6f946eb1ee38bcca68b
- Only SQL prerequisite: supabase/pending_review/20261107_worker_ownership_compat.sql
- SQL working-tree SHA-256: 88892dd59f66c6fa89c028a003df2310ad10adbe2efdf817a4e096d8fd8dd99d

## Compatibility behavior

Training and Deep Cleaning mutation routes, including manager/unified proposal paths and evidence issuance/confirmation/deletion, return maintenance after existing authentication. Authorized reads remain available. The bridge cannot open evidence writes through an environment switch. It does not fence legacy processes or direct database writers.

Six background job classes use durable per-job PostgreSQL ownership claims with unique process/claim UUIDs. Updated replicas start in legacy_handoff and cannot execute alongside an uncoordinated incumbent. Claims never expire automatically; uncertain completion requires audited operator reconciliation. HTTP shutdown drains requests and workers within the existing deadline. Normal Login, Attendance, GPS and KM request registrations and job business bodies are preserved; background processing may pause during handoff.

## Recorded validation — reused, not rerun

- 41 focused backend tests passed, including compatibility admission, ownership, lifecycle and loopback-only synthetic startup.
- 18 disposable PostgreSQL 17.6 checks passed across worker ownership and later bounded migration preparation. The latter feature SQL files are deliberately excluded from this PR; these results do not authorize their deployment.
- Five core job/auth bodies and 18 critical route registrations matched baseline after line-ending normalization.
- Scoped lint passed; server.js retains the same 12 pre-existing lint findings. git diff --check passed.
- No authenticated production, physical-device or real isolated Storage object acceptance is claimed.

## Future production sequence — separate authorization required

1. Verify live source/service identity, Node 22 dependencies, Railway /ready healthcheck, overlap and shutdown grace; check database/PITR recovery separately from Storage object-byte recovery.
2. After explicit SQL authorization install only the additive worker migration. PostgreSQL 17, existing Supabase service_role/authenticated/anon roles, adequate DDL privileges and safe operator-role membership are prerequisites. No shared business-table DDL is included. Verify RPC visibility and legacy_handoff without opening ownership.
3. After separate deployment authorization warm/cut over this bridge while updated workers remain standby. Verify unaffected authenticated requests and evidence maintenance responses.
4. Prove every incumbent writer/job instance and its database/Storage/SMTP side effects retired. Only then may an approved operator open coordinated ownership against the accepted artifact digest with zero active claims.
5. Feature migrations, the combined feature successor, Storage drain/acceptance, evidence reopening and mobile release are separate later changes; none is included here.

Stop for source/hash drift, unhealthy unaffected routes, unknown old writers, unresolved side effects, missing RPCs, duplicate jobs or uncertain claims. Before feature DDL, failed warmup leaves the incumbent serving and new ownership in standby. If bridge rollback is needed, close cooperative ownership and prove zero active claims/side effects before using a separately reviewed admission-preserving fallback. Never overlap uncoordinated fallback workers with active coordinated workers. Do not drop audit/claim tables or restore the database as a shortcut. Database recovery cannot restore deleted Storage bytes and may lose unrelated newer employee writes.

Live Railway settings, release identity approval, old-writer retirement evidence, recovery verification and production acceptance remain deployment prerequisites. This PR does not claim zero downtime or production readiness.

## PR #81 CI correction — 2026-11-07

Run 42349081143, job 128333143321, step "Complete suites - fail on new failures; disclose inherited failures" exited 1. The actual base b47480e had 1398 passed / 28 failed / 26 skipped; candidate 203bfed had 1413 passed / 41 failed / 26 skipped. Fourteen new failures were stale compatibility expectations (one inherited failure disappeared). The separate October targeted tests/PostgreSQL safeguards/build/browser job passed.

Only three tests were corrected: GPS summary mocks now implement and verify claim/release identity while preserving refresh limits and single-flight/financial SQL checks; Training mutations assert authenticated maintenance with no business/Storage calls while reads retain success checks; Retail manager tests preserve identity binding and non-cleaning behavior while checking maintenance and the added server-side proposal classification reads. Runtime source, SQL, KM calculations and approval rules are unchanged. Background scheduling remains deliberately subject to ownership/legacy_handoff, so asynchronous processing can pause during handoff.

Focused command: `node --test --test-name-pattern="GPS worker is optional|real Retail router applies|Cleaning apply uses|registered and protected" backend/tests/foKmAuthorizedActions.test.js backend/tests/retailInitialAdminAccess.test.js backend/tests/trainingRoutes.test.js` — 21 passed, 0 failed. ESLint on these three files and git diff --check passed. Full suites were not rerun locally; GitHub's unchanged comparison gate will rerun after push and must continue reporting inherited failures rather than claiming a fully green backend suite.

The original release-manifest.json remains historical evidence for the pre-correction artifact, not the revised test snapshot. Runtime and SQL entries remain unchanged. Revised test working-tree SHA-256 values:

- backend/tests/foKmAuthorizedActions.test.js: cacfb0ff2bcd7d97e61858284ff7fb12a001b5f651f0936978c2137042ba37b8
- backend/tests/retailInitialAdminAccess.test.js: 6412c0ca96d8ebb22c5f5ec050bbf308c10628b8c2acefd4fae06c6c9cca97b2
- backend/tests/trainingRoutes.test.js: a26e069a3a07b889cd22bce0c65b0ee5cb7550baa51ad86c4ffb8c30ec110e82
