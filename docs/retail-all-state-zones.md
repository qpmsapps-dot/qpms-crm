# All-state Zone and primary FO management

The Store Master **Zones** and **FO Mapping** tabs now use the same state-scoped
Unified proposal workflow as **Unified Management → Zones & FO**. The old direct
Zone write controls were obsolete after Unified installation and are removed.
Existing Store and Manpower screens are otherwise unchanged.

All States is the default and means all states already authorized by the backend.
Admin sees TN, PY, KA, KL, TG, AP-1 and AP-2, including states with zero Zones.
MIS sees only explicit assigned states. No employee grants or names are inferred.

## Counts and geography

Each state shows defined Zones, assigned verified stores, unassigned verified
stores, mapped primary FOs, Zones without an FO, and provisional codes. Provisional
source versions are counted separately from unique codes; they never inflate
operational store totals. Existing shared-state mappings are explicitly identified.
PY stays geographically separate and consolidates under TN in reporting. KA keeps
the existing KN reporting key; no competing reporting-state mapper is introduced.

The four original TN Zones and their existing 130 TN/PY store mappings are not
recategorized. The 15 legacy PY stores retain their existing TN-zone ownership.
An unchanged export/reimport of these mappings is allowed without a new proposal;
new Store-to-Zone assignments must match geographic state exactly. No Zone names,
FO identities or assignments are generated from missing source information.

## Zone lifecycle and FO replacement

Choose an explicit permitted State / Business Group when creating a Zone. Supply
a Zone code, name, status and evidence reason. Rename/status changes also create
proposals. Geography and existing Zone codes cannot be changed through rename.
An independent authorized reviewer approves; Admin applies through the installed
operational write gate. No action in this screen bypasses that gate.

Primary FO selection uses the existing authenticated snapshot's active Reliance
Retail FO accounts, restricted to the Zone's reporting/operational group and
existing account visibility grants. Source-workbook names never create an account
or qualify it as verified. One FO can own multiple Zones. `Unassigned FO` is an
explicit action; a blank selection cannot accidentally remove an FO.

FO replacement uses the existing effective-dated assignment RPC. Current Store
responsibility is derived from its active Zone; previous ownership remains in the
existing timeline. Zones without FOs and stores without Zones remain supported.

## Bulk verified mapping and Excel import

Select the mapping state, identity-verified store mode and an existing same-state
Zone (or explicit UNASSIGNED), paste Store Codes and enter effective dates/reason.
Preview shows every row, target Zone/FO, effective interval, conflicts and warnings.
Editing the bulk form invalidates its previous preview. Save creates independent
review proposals only. It does not move stores, verify source identities or approve
anything. Existing pending/approved equivalent proposals are recognized on retry.
Unchanged current mappings are skipped. A stale baseline requires a new preview.

Export provides Zone Mapping, State Counts, Provisional Drafts, FO Ownership
History, Store Zone History and READ ME worksheets. Import reads **Zone Mapping**
with these exact headers:

`Record Type`, `State / Business Group`, `Store Code`, `Source Row ID`, `Zone Code`,
`FO Employee Code`, `Effective From`, `Effective To`, `Reason`.

Record types are STORE, ZONE_FO and PROVISIONAL_DRAFT. Zone Code must already exist;
new Zones require an explicit reviewed creation proposal first. Use UNASSIGNED
explicitly to clear a Zone/FO. Start is ON_ACTIVATION or an ISO timestamp with a
timezone; end is optional. Up to 1000 rows per import. Formula/error cells,
cross-state assignments, unknown/ambiguous accounts, duplicate mapping rows,
future timeline conflicts and unauthorized states block submission of the file.
Blank reasons are allowed only for unchanged rows that create no proposal.

Bulk submissions use existing row-level proposal RPCs. If a later RPC fails, the
receipt returns completed IDs, failed row and unattempted count; it never claims
an atomic bulk save. Re-preview before retrying. Operational activation remains
separate and independently guarded for each proposal.

## Provisional mapping drafts and new migration

MIS can select exact retained provisional source rows or prepare their exported
draft rows, choose a same-geography Zone and preview/export mappings immediately.
Identity conflicts remain flagged. Source Row ID, source revision and row digest
bind each draft to one immutable source occurrence, including repeated versions.
No draft activates an identity, changes review status or changes operational data.
Even after a canonical identity appears, a separate verified mapping proposal is
required; draft intent is never automatically applied.

Server storage of drafts needs the NEW, separately authorized proposal
`supabase/proposals/retail_zone_mapping_drafts.sql`. It adds one immutable draft
table, scoped read/save RPCs and a future-write state CHECK on Zones. The CHECK is
NOT VALID to avoid silently altering any legacy state values. It does not create
Zones, move stores, replace FOs, modify existing functions, or grant employee access.
Until installed, operational proposal management works and provisional drafts can
be prepared/exported, while server draft saving/history explicitly awaits setup.

After authorization only: run `retail_zone_mapping_preflight.sql`, inspect unknown
states and save protected digests, apply the new proposal once, then run
`retail_zone_mapping_postinstall.sql` and compare protected digests. Do not repeat
installed Unified/provisional migrations. The quarantine script revokes new draft
RPCs and preserves all evidence and operational records.

## Dependent modules and validation

Attendance, Training and Deep Cleaning keep the installed common effective-dated
Store → Zone → FO ownership resolver. OOS/Fault current ownership uses that same
database resolver; their event history and Excel export now derive ownership at
each event timestamp through the shared model. Unknown pre-baseline ownership
remains unknown. No attendance, AOP, submission, financial, GPS, KM or mobile rules
are changed. OOS/Fault persistence retains its separate pending tracker setup.

Tests cover all-state/zero-state counts, scoped MIS/viewer access, shared legacy
PY mappings, cross-state conflicts, valid FO selection, source versions, formulas,
Excel round-trip, idempotent proposal retries, stale baselines, partial receipts,
draft immutability, SQL ACLs, independent approval and protected-data preservation.
The isolated PostgreSQL lifecycle/browser suite also exercises the actual top-level
Zones page, Zone proposal creation, bulk mapping and Excel conflict review.
