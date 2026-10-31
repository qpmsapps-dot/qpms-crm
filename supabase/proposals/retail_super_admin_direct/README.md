# Explicit Super Admin identity approval

This is a new, narrowly scoped policy patch (`20261031090000`), not a rerun of installed migrations. The installed `20261031080000` private identity proof requires different maker and checker identities. Application changes alone cannot safely override that database requirement.

The Super Admin explicitly authorized exactly these four existing authenticated IDs. The database binds each ID to its existing profile and saved consolidated Version 2 SHA-256. It never creates users, changes profile roles or authorizes future Admin accounts merely by role.

| Username | Authenticated user ID |
| --- | --- |
| QPMSADMIN | `79cd196c-c6f3-404a-b22a-d4683afefa3f` |
| QPMSAP25191 | `7e84cddf-821a-4513-b7ce-25895d660393` |
| QPMSTN4887 | `f9238141-8f44-4073-86aa-2749b8a3dccf` |
| QPMSTNC17010 | `377ca7a2-95cc-4891-8840-338f2cb20bb9` |

Only the still-pending exception package was updated. Its reviewed source MD5 is `f2087eb8651b01334bdc6762f8892048`. If an earlier variant of `20261031090000` is recorded, stop on ledger drift; do not rerun or replace it.

## Owner installation

1. Run `01_PREFLIGHT_READ_ONLY.sql` and retain all nine protected counts/digests. Stop on errors or drift.
2. Run `02_INSTALL_AND_RECORD.sql` once. It creates an owner-only authority table, backend-only capability/approval RPCs and extends the existing private identity proof. It does not approve proposals, activate stores, seed authority accounts, open gates or modify operational data.
3. Run `04_AUTHORIZE_CONFIRMED_ACCOUNT.sql` as owner, without editing any account IDs. It resolves exactly the four authorized authenticated IDs to existing active Admin profiles, checks the reviewed ledger and records the source-bound grants atomically. Repeating this grant script preserves existing grant records. It approves no proposals and activates no stores.
4. Run `03_POSTINSTALL_READ_ONLY.sql`. Compare all nine counts/digests with preflight. Confirm new migration fingerprint, RPC bodies, private helper, RLS, backend-only EXECUTE and all four account capabilities. No additional management authorization or independent checker is required for these four accounts.

No owner/authenticated Super Admin connection is supplied by this package. Backend service credentials must never be used to impersonate the approving human.

## Authenticated application action

Store Master → Unified Management → Identity Review → Consolidated Approvals → All States → Approval review.

Enable **Use Super Admin direct approval**, select the valid submitted Active identities, inspect the state counts/exceptions, confirm scope, then click **Super Admin approve selected Active identities**. One request supports up to 1,000 IDs. The fixed reason is:

> Super Admin authorized Reliance Retail Store Master activation.

The RPC records the actual authenticated profile, timestamp, source-file SHA-256, proposal IDs and an immutable batch event receipt. It approves no Inactive, stale, duplicate, ambiguous, existing-canonical or invalid-state identity. Invalid rows are returned separately in `held`; valid rows remain actionable. Replays return existing receipts without replacing decisions. Ordinary approval still prohibits self-approval. AOP approval is unchanged.

After a genuine approval receipt exists, enable `RETAIL_BULK_IDENTITY_APPROVALS_ENABLED=true` and `RETAIL_STORE_IMPORT_WRITES_ENABLED=true` through authorized Railway environment management. In the same authenticated approving account choose the activation stage, select approved identities, confirm and **Activate approved identities only**. Retain state-wise registry/import receipts; verify canonical counts and unchanged protected records. Immediately restore both gates to closed. These environment changes require the ordinary GitHub/Railway release process; no direct application upload.

## Quarantine

Close both activation gates and, as owner, disable only the confirmed actor/source entitlement (`enabled=false`). This stops further direct approval/activation without deleting audit records, approvals or canonical stores. Do not delete or reverse committed activation receipts automatically. No destructive rollback is provided.

## Acceptance boundaries

Isolated PostgreSQL, API and browser fixtures demonstrate behavior, not production approval. A deployed button or capability check is not an activation receipt. Report production direct approvals and activations only after authenticated writes and real receipts are observed.
