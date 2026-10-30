# Retail readiness and service workflows

Identity readiness is a review queue, not activation authority. It lists every
retained source occurrence and separates active canonical stores, unique source
codes, identity-pending codes, conflict codes and blocking codes by geography.
PY remains separate. Source versions can repeat a code. Review queue exports leave
approval decisions blank and bind the source hash and row digest. Zone, FO and AOP
completion is independent of identity review. Existing source-bound identity
approval, explicit status and genuine supervisor evidence remain mandatory under
the installed activation contract; this release does not weaken that contract.

Training uses existing authorized session, detail and signed-evidence APIs. The
screen distinguishes HK (`hk`) and MEPC (`technical_mep`), filters by dates, state,
Store, Zone and FO, and derives historical ownership from the existing Store →
Zone → FO timeline. Unknown ownership remains unknown. A missing Unified scope
does not hide separately authorized Training records. The list API caps results
at 200; narrow dates when that cap is reached. No submission flow is changed.

## New OOS and fault development

Store Master → Unified Management → Service Trackers contains the new workflows.
They require the **new**, separately authorized combined package in
`supabase/proposals/retail_operational_activation/INSTALL.md`. The bare service
proposal is review/test source. Neither is automatically installed by deployment.
Until installed the API returns a setup-pending message and cannot persist orders.
Do not rerun any existing Unified or provisional migration for this feature.

The module reuses canonical Store IDs, existing state editor/reviewer grants and
effective-dated ownership. It creates no users, grants, mappings or AOP. Active
canonical stores with no Zone, FO or AOP can be used. Imported IFMS Fault Tracker
records stay in the existing screen and are not copied or overwritten. New manual
faults have a distinct service-order reference and immutable event history.

Quotation template sheet: `Quotation`; exact columns: `Quotation Number`,
`Store Code`, `Description`, `Quantity`, `Unit Rate`. Every row is retained in its
original file and row evidence. Decimal values are preserved. Unknown/inactive
canonical stores, formulas, error cells and invalid quantities/rates block saving
the quotation file. A quotation can contain several stores in one authorized
state. Cross-state quotation numbers must be resolved before import. Groups save
atomically, so a later failed group cannot partially commit an earlier group.
Identical-file reimport is idempotent; changed quotations require explicit rework.

OOS stages: QUOTED → PO_RECORDED → COMMERCIALLY_CONFIRMED → FUND_RECORDED →
PAYMENT_RECORDED → DELIVERED. Rework before PO uploads a new source and increments
the rework count without rewriting history. Commercial confirmation requires an
independent reviewer. Fund and payment steps record evidence references only:
they do not initiate transfers or change financial ledgers, calculations or rates.

Fault stages: REGISTERED → ASSIGNED → IN_PROGRESS → RESOLVED → CLOSED. Register
category, priority, description and Store ID; assign a verified active Reliance
Retail FO in the existing operational/reporting scope, including TN/PY compatibility.
Escalation adds an event while retaining the current stage. Resolution and closure
require evidence references. Closure requires reviewer permission. Backward and
skipped stages are rejected in the database. Revisions prevent stale updates, and
request IDs prevent retry duplication. Excel export includes details and history.

Database tables deny direct access to anon, authenticated and service_role. Only
authenticated backend calls to the restricted RPCs can operate within actor state
scope. Original workbook bytes remain private in audit storage; responses redact
them because one workbook may contain quotations for several states. State
viewers receive only their orders and events. No financial transaction is posted.

## New SQL installation and quarantine

Only after explicit owner authorization: run combined package files 01, 02, 03
in order and compare protected digests. Do not install the bare proposals separately.
The installer records version 20261030140000 and verifies an exact safe replay. Expect
zero initial orders/events, no direct table privileges, and only service_role RPC
execution. No existing migration needs to be rerun. Package 04 quarantine revokes new
RPCs while retaining service orders, source files and audit history; do not drop
tables containing submitted work.

Validation: `RETAIL_TRACKER_POSTGRES=1 RETAIL_GO_LIVE_BROWSER=1 node --test
backend/tests/retailGoLive.test.js` exercises real isolated SQL and built browser
forms, including forward stages, state isolation, retries, rework, independent
commercial approval, closure evidence, immutable events, atomic import rollback,
base64 redaction, Training filters/evidence and canonical preservation.
