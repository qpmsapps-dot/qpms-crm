# Explicit Super Admin identity approval

This is a new, narrowly scoped policy patch (`20261031090000`), not a rerun of installed migrations. The installed `20261031080000` private identity proof requires different maker and checker identities. Application changes alone cannot safely override that database requirement.

The production role registry currently labels four accounts `Admin` and records no separate Super Admin role. This package does not promote them. The owner must bind only the user's explicitly confirmed existing profile ID to the SHA-256 of saved consolidated Version 2. It never creates users or changes profile roles.

## Owner installation

1. Run `01_PREFLIGHT_READ_ONLY.sql` and retain all nine protected counts/digests. Stop on errors or drift.
2. Run `02_INSTALL_AND_RECORD.sql` once. It creates an owner-only authority table, backend-only capability/approval RPCs and extends the existing private identity proof. It does not approve proposals, activate stores, seed authority accounts, open gates or modify operational data.
3. Run `03_POSTINSTALL_READ_ONLY.sql`. Compare all nine counts/digests with preflight. Confirm new migration fingerprint, RPC bodies, private helper, RLS and backend-only EXECUTE.
4. Set `target_id` in `04_AUTHORIZE_CONFIRMED_ACCOUNT.sql` to the existing profile UUID explicitly confirmed by the Super Admin. Run as owner. The script refuses an unset account and scopes authorization to actual saved Version 2. Never substitute the maker ID merely because it created the proposals.

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
