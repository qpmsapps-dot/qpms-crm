# Retail FO self-service read access - 20261030170000

Prepared only. Production installation requires DB-owner action; this release does not execute SQL in production. This package is independent of OOS migration160000. Do not rerun140000 or any earlier migration.

## Exact 403 trace

All four mapped Retail FO accounts are active, have existing Auth links, and have Auth UUIDs different from their profile UUIDs. Read-only production probes returned HTTP403, SQLSTATE42501, message `Assigned Retail state permission required` for each actor against `rpc_retail_unified_snapshot`.

The old profile panel used `/api/reliance-retail/unified-master`. The parent router verifies the Supabase JWT with Auth.getUser, resolves `profiles.auth_user_id`, and supplies that database row as req.profile. The Unified route sends req.profile.id to the management snapshot. Its first `retail_unified_access(actor,null,'view')` check requires Admin or an explicit state permission. These FOs have zone assignments but no state-view permission. The custom error occurs inside the RPC; it is not evidence of an invalid JWT or a missing backend EXECUTE grant. Complete live catalog ACL/RLS verification still requires the owner; source and isolated tests establish the intended grants.

## Narrow replacement

- New GET `/api/reliance-retail/fo-self`, mounted after the existing JWT middleware. Only active Retail FO accounts are eligible. The backend supplies actor exclusively from req.profile.id; only from/to dates are accepted. Profile/FO/state targeting parameters are rejected, and writes return405.
- New `rpc_retail_fo_self_snapshot(uuid,date,date)` is STABLE, SECURITY DEFINER, fixed search_path=pg_catalog,public. EXECUTE is service_role only; anon/authenticated/public cannot call it directly or choose p_actor. No table privileges, state grants, RLS policies, employees or mappings are changed.
- SQL independently rechecks active profile/role/business. It returns only the actor's own profile, current verified stores/zones/assignment dates, and aggregate HK/MEPC attendance on days where the existing ownership resolver proves that actor owns the store. Other FO identities, other employees' attendance, provisional source files, MIS proposals, GPS and financial values are not returned.
- Current assignments use now(). Historical dates use the established India end-of-day ownership convention, capped at now() for today so a future FO cannot read before taking responsibility. Unknown historical ownership is withheld, not assigned retrospectively. Dates are bounded to93 days, and future dates are rejected. Admin management ranges/routes are unchanged.
- Unknown uploads and AOP stay null. Approved per-class AOP counts use the existing dailyTarget calculation; no AOP or attendance is changed. FO mobile attendance is a different dataset and is never queried by this RPC.
- My Profile uses self-service for a Retail FO, with profile UUID identity distinct from Auth UUID. Existing Admin/management employee-profile views retain the management snapshot and existing authorization. Missing new RPC fails503 with this installation instruction, without fallback to an Admin or broader state reader.

## Owner installation - exact order

1. Run **01_PREFLIGHT_READ_ONLY.sql** in Supabase SQL Editor as DB owner. Retain results. Reviewed ownership-helper fingerprint/ACL and required-column checks must pass. Expect four current verified FO accounts; retain protected counts/digests. If version170000 already exists, do not reinstall: run03 and investigate any mismatch. An unrecorded existing function is drift, not permission to overwrite it.
2. Only if170000 is absent and preflight passes, run **02_INSTALL_AND_RECORD.sql** once. It creates one new read-only RPC, restricts EXECUTE and atomically records170000. It does not depend on160000 and does not modify any data table. Identical installer replay is a no-op; changed source/body/config/ACL aborts rather than silently repairing drift.
3. Run **03_POSTINSTALL_READ_ONLY.sql**. It checks exact ledger/source/body, STABLE/SECURITY DEFINER/search path, EXECUTE ACLs, and every currently mapped active FO. Expect source_exact_match=true and four FO rows. Each FO's store count must match authoritative current ownership; dated rows and assignments must contain only that FO. The four production store counts should collectively retain the existing130 mappings. Compare all protected counts/digests with01; investigate concurrent legitimate changes rather than overwriting records.
4. In normal FO sessions, open My Profile. The `/fo-self` request must return200 with scope=FO_SELF and actor_id equal to that session's database profile UUID. No Unified management snapshot should be requested by this self-service panel. Another profile_id parameter must be rejected400. Admin employee-profile management remains on the existing management route.

No broad state-viewer grant is required. In particular, do not insert blanket rows into retail_provisional_access. Installer success alone does not prove all verification checks passed; retain03 output.

Fingerprints are in manifest.json and enforced by the scripts. SQL source comparisons normalize CRLF/LF. No earlier migration version or original function definition is changed.

## Tests and evidence limits

`backend/tests/retailFoSelfRead.test.js` covers all four existing profile UUIDs when RETAIL_FO_IDENTITIES_FIXTURE points to the read-only403-trace.json. It verifies server-side identity binding (Auth/profile UUID distinction), all12 cross-FO query attempts, mismatched response denial, ineligible accounts, direct database EXECUTE denial, own-only fields/Excel exports, effective-dated transfer, future assignment, unknown ownership withholding, missing AOP/attendance, installer replay/drift and protected-data digest equality. PostgreSQL runs in a disposable network-isolated container. Browser tests use real app routes and the fixture backend; they are not production user-session acceptance.

PowerShell local acceptance switches: RETAIL_FO_SELF_POSTGRES=1; RETAIL_FO_SELF_BROWSER=1; RETAIL_FO_IDENTITIES_FIXTURE=<absolute path to artifacts/retail-fo-self-20261030/403-trace.json>; then node --test backend/tests/retailFoSelfRead.test.js. Existing management/profile/OOS/Fault regression uses backend/tests/retailGoLive.test.js and its existing switches.

## Rollback

With separate owner authorization, DROP FUNCTION public.rpc_retail_fo_self_snapshot(uuid,date,date); retain the migration ledger and all operational records. The app will safely report503. Do not delete history or profiles. Restoring a dropped recorded function requires a separately reviewed repair; this installer intentionally refuses recorded-definition drift. Existing Admin/management access is unaffected.
