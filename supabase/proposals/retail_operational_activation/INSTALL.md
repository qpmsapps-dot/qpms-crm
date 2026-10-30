# Reviewed activation package — production execution pending

This is a NEW package (`20261030140000`) for OOS/Fault storage and immutable
provisional Zone drafts. It does not rerun installed Store Master migrations,
activate identities, change existing mappings, grant employees access or open
identity/AOP/attendance gates. Production owner migration access is not configured
in this agent runtime. Do not substitute a service API key for database-owner access.

**One installation procedure:** An explicitly authorized database owner opens the
Supabase SQL Editor, runs **01_PREFLIGHT_READ_ONLY.sql**, saves its results, runs
**02_INSTALL_AND_RECORD.sql** once, then runs **03_POSTINSTALL_READ_ONLY.sql** and
compares the protected counts/digests and original function fingerprints with the
preflight output. Stop on any failed guard. Do not run the two bare source proposals
or repeat old Unified/provisional migrations. Reload the authenticated application
after the package commits and the PostgREST schema cache refreshes.

The installer is one transaction with a 5-second lock timeout and 90-second statement
timeout. It serializes with existing Store/attendance operations and briefly takes
shared locks while checking protected records. A timeout or failed check rolls back
both modules and the history record. Nothing is repaired by overwriting unknown
objects. If unrecorded target tables/functions already exist, reconcile them first.
An exact rerun is a no-op, including after orders/drafts exist. History, function,
column, ACL or RLS drift causes a stop rather than reinstallation. The source is
normalized from CRLF to LF before comparison. `manifest.json` gives the exact source
MD5, function bodies and expected base migration fingerprint.

Initial new order/link/event/draft counts should be zero. Existing 130 stores,
four Zones/four FO assignments, 1,708 provisional rows/two file versions and 9,961
attendance rows are the audited baseline; investigate any legitimate changes since
the audit before choosing a new baseline. The installer independently compares
current protected data before/after, as well as all existing public function
definitions/owners/ACLs and relation security. No financial calculations are run.

New tables deny direct anon/authenticated/service_role access. Only restricted
backend RPCs can read/write within existing state editor/reviewer scope. Store and
assignee foreign keys protect referenced records. Source/audit links are immutable.
Fault assignees must be active Reliance Retail FO accounts in the installed
operational/reporting scope, including TN/PY compatibility. Arbitrary fields cannot
be changed through status updates; quotation items can change only through rework.

`04_QUARANTINE.sql` is a separately authorized, non-destructive rollback: it revokes
the new RPCs while retaining all orders, drafts, sources and audit evidence. It does
not reverse business submissions or delete tables. A quarantined installation will
not silently reopen when the installer is rerun.

## Identity and activity decisions still required

The 717 ready-for-review candidates are not approvals. Nine new cases require more
evidence and three new identities are blocked. No identity approval registry entries
exist. The installed application supports source-bound, independent identity
decisions, but production `RETAIL_BULK_IDENTITY_APPROVALS_ENABLED` and
`RETAIL_STORE_IMPORT_WRITES_ENABLED` are absent and therefore default closed.
Admin must approve exact evidence/identity/status/supervisor decisions by state and
separately authorize these release flags before canonical activation. Workbook YES
cells and past activities are not approval authority. Do not enable attendance
recovery or approve AOP as part of identity activation.

Existing Training and Deep Cleaning workflows remain intact. Their verified-store
report includes only canonical matches. Legacy Deep Cleaning codes TKS7, 1244,
2843 and Training codes 43354, REILNSTST need explicit identity/link review; do not
invent replacements or activate them merely to display historical activity.
TKS7 exists in TG provisional evidence and 2843 in KL; the other codes were not
found in the consolidated source. Their historical records/images are preserved.

Rehearsal: run `RETAIL_ACTIVATION_PACKAGE=1 RETAIL_UNIFIED_POSTGRES=1 node --test
backend/tests/retailUnified.test.js` with the source workbook environment variables;
run `RETAIL_TRACKER_POSTGRES=1 RETAIL_GO_LIVE_BROWSER=1 node --test
backend/tests/retailGoLive.test.js` against disposable PostgreSQL and the built app.
The package builder is `backend/scripts/buildRetailActivationPackage.mjs`.
