# Deep Cleaning monthly import: Super Admin repair

Base: `661eee8bf757b8cf096b52e1ddc7dcb8766ae158` (PR #103).

## Findings and resulting behavior

The dashboard discovers monthly access through `/mis/access`. The existing
QPMSADMIN response is intentionally a training-only, read-only capability, and
the page previously required CENTRAL_MIS or the separate state-writer role.
Monthly routes also required MIS/state-writer access. Installed SQL independently
required MIS/state-writer authorization, so showing a button alone cannot fix it.

The repair adds a server-verified `cleaning_schedule_admin` capability only on
access discovery and monthly list/history/preview/import routes. It uses the
existing role normalization for `SUPER_ADMIN`, `Super Admin` and `SUPERADMIN`,
and preserves the established exact QPMSADMIN identity. It does not promote other
Admin/Developer roles, create assignments or alter canonical global role helpers.
The server binds actor/auth IDs to the authenticated session. Database capability
checks reject inactive, duplicate-auth, demo and read-only identities. Unavailable
capabilities fail closed. The existing training-only response remains intact.

The plan RPC and private validator receive exact fingerprint-checked predicate
changes. Super Admin monthly access does not authorize corrections, approvals,
submissions, evidence operations or any other module. Store Master validation,
supplied-FO eligibility/ownership checks, AP-1/AP-2 separation, date/month checks,
500-row limit, whole-workbook atomicity, idempotency, locks, audits and mutation
fences remain unchanged. Automatic matching activation is not part of this repair.

## Separate SQL approval and release sequence

**Neither script has been applied to production by this task.**

1. Review this PR and the exact SQL proposal separately. Confirm backups and the
   installed final fingerprints from the three PR #103 proposals. Review the
   content-pinned CI delta and all required checks.
2. Obtain explicit production SQL approval for
   `supabase/proposals/retail_cleaning_superadmin_import_20261119.sql`. Apply only
   that approved script through the production change process. It must precede
   application deployment; otherwise affected admin discovery fails closed.
3. Obtain separate merge/deployment approval, then release the matching backend
   and frontend. This task does not merge or deploy.
4. Authenticate as the real Super Admin. Open Deep Cleaning → Schedule Deep
   Cleaning → Monthly Excel schedule import. Select November 2026 and upload the
   actual workbook. Verify all 208 rows, canonical codes, states and dates in
   preview; do not import until separately confirmed. The real workbook and
   authenticated production preview have not been verified in this task.
5. Verify HK MIS remains read-only, existing MIS/state writers still work, and
   unrelated module access remains unchanged. Check server/browser errors.

## Non-destructive recovery

Revert the application release before separately approving/executing
`supabase/proposals/retail_cleaning_superadmin_import_recovery_20261119.sql`.
Recovery restores exact pre-repair functions and removes only the new helpers.
It preserves imported schedules, evidence, audit history, existing writers and
the matching trigger state. Both install and recovery reject function drift and
are idempotent; never force them past a fingerprint failure. The earlier broad
Deep Cleaning V2 recovery must not be run while these patched functions remain
installed; use this repair's recovery first if a wider recovery is approved.

## Verification

Synthetic local tests cover mounted access discovery and preview/import with
server-bound identity, denied users and unrelated routes. Native PostgreSQL 17
exercises both scripts, repeated application/recovery, ACL preservation, 208
four-state rows, concurrent idempotent import, invalid workbook atomic rejection,
duplicates, inactive/read-only/unauthorized accounts and mutation fences. The
8-second performance limit remains unchanged. Browser checks cover November
workbook preview, existing writer import/retry, and HK read-only visibility.

Exact-file CI authorization is a separate fixed-base, content-pinned follow-up
exception. The original V2 manifests and all subsequent test/build steps remain
mandatory; protected extra files and changed blobs are rejected.

Local verification on the final application/SQL candidate:
- Focused backend/frontend/export/mounted-auth suite: 263 passed, 0 failed/skipped.
- Exact-payload/historical workflow guard suite: 177 passed (overlaps the focused suite).
- Chromium monthly workflow: passed, including Super Admin November workbook preview.
- Native PostgreSQL 17: passed, including installation/replay/recovery and drift rejection.
- Latest measured 208-row preview + concurrent idempotent import: 727 ms, strict 8-second limit.
- Existing 500-row MIS and state-writer checks also passed.
- Scoped ESLint and production frontend build: passed. Existing chunk-size/import warnings remain.
- Local Node was 24.16.0; required GitHub runners use Node 22. Remote checks are reported in the PR.
