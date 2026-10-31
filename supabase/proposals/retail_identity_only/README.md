# Identity-only activation contract — 20261031080000

Prepared for the Super Admin's corrected business requirement: verified Store Code/name/state and explicit Active/Inactive status are sufficient for identity activation. Supervisor, Zone, FO and AOP are optional. No missing status is inferred.

This is a new function and ownership-constraint patch. Do not rerun old migrations or the original Excel import. It changes the two existing identity RPCs to support `IDENTITY_ONLY`, retains the legacy `SUPERVISOR_ONLY` path, adds a private saved-source approval verifier and a backend-only capability reader, and adds one identity-only branch to the existing FO-assignment consistency constraint. Existing audit, exact source hashes/digests, reviewer binding, duplicate/collision checks, locks, approval registry and ACLs are preserved. Existing canonical, attendance, Zone/FO, AOP and source rows are not modified by installation. No application write gate is enabled.

## Authorized owner installation

1. Run `01_PREFLIGHT_READ_ONLY.sql` in Supabase SQL Editor using the authorized database-owner session. Retain every result grid. Stop on any error or fingerprint drift.
2. Run `02_INSTALL_AND_RECORD.sql` once. This is transactional and records only migration `20261031080000`; an exact repeat is a checked no-op. Source MD5 is recorded in `fingerprints.json` and checked by the installer/postinstall script.
3. Run `03_POSTINSTALL_READ_ONLY.sql`. Confirm exact source match, backend-only EXECUTE, identity-only capability and unchanged protected counts/digests compared with step 1. Supply the actual results for production verification.

`source.sql`, `proof_helper.sql`, `ownership_constraint.sql`, `reviewed_bulk_baseline.sql` and `fingerprints.json` are review/test references, not additional installation steps. The baseline is the hardened installed bulk identity function with MD5 `69d7e42f38387f7d7337a33331089420`; the installer must not substitute the older proposal function. Import RPC baseline MD5 is `45efdcbd007006d4474d816d1bdb0055`. The old ownership constraint MD5 is `02d7d7cb410123aec353cf6958b5645d`. Stop on any fingerprint difference.

The old nine-KL-code/row allowlist remains in force for legacy `SUPERVISOR_ONLY`. `IDENTITY_ONLY` permits all seven states only after the database checks the actual saved proposal, different maker/checker, exact current source row revision/digest/file hash, explicit status and decision evidence. The same proof is checked again before canonical insertion. Ambiguous, duplicate, geographic-conflict and technical source flags remain blocked. The new constraint branch admits only identity-only metadata with an approval UUID and source hash; direct table write revocations are unchanged. It permits later Zone assignment without requiring a store-row FO snapshot.

After installation, refresh the PostgREST schema cache if needed through the authorized owner session: `notify pgrst, 'reload schema';`. The application probes the capability and refuses identity-only registry/canonical activation until it is available. Proposal submission and independent review can proceed while the database patch is pending.

## Business activation remains separate

An authenticated maker submits confirmed saved-source identities with an explicit operating status and audit reason. A different authorized checker approves with genuine evidence. Only then may the authorized operator open the two existing application write gates for controlled identity-only activation. Verify receipts/state counts and close both gates afterward. No authenticated session or independent approval is fabricated by this patch.

Nine source exception-sheet/expired-budget cases may enter identity review with an explicit operating-status disposition and independent checker approval; their original flags stay visible and do not become AOP approval. Three ambiguous new Store Codes remain isolated: `SLAS/TXJA`, `TXUH/SLL7`, `TUG5/SLUA`. No supervisor is required for any otherwise valid identity. HK/MEPC components, decimal precision and source dates remain separate; no component aggregation or AOP approval is inferred from identity approval.

If the write path must be quarantined, close both application write gates and have the owner run `04_QUARANTINE_WRITES.sql`. It only revokes the two service-role mutation RPC grants. It never reverses committed business records or deletes migration/audit history; restoring grants requires a separately reviewed action after resolving the incident.

No production owner credentials were available during preparation. Installation and authenticated production activation are not claimed as complete.
