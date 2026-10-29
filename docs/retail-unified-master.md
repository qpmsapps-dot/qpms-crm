# Reliance Retail unified Store Master

This extends the existing Store Master route and existing operational, provisional, Zone, AOP, attendance and activity records. It does not create a second operational Store Master. Missing optional information never removes a source record. No mobile application or APK changes are included.

## Audit and sources

Read-only production audit on 29 October 2026 confirmed 130 canonical stores, one provisional file with 854 source rows, 9,961 historical attendance rows, two attendance uploads, four zones and four FO assignments. Approved AOP versions and identity/AOP approval registry entries were both zero. Deep Cleaning had three submissions and eight uploads. Training had nine sessions, before applying Retail store-link filtering. The Deep Cleaning schedules table was absent.

Primary source: `Reliance_Retail_Store_Master_Audit_Upload_Review (2).xlsx`, SHA256 `642c51949d159b89876476e81879ae9c9b0a7cb8ac7bbfaac69965036f9de78e`. All four sheets were read: READ ME, STORE UPLOAD REVIEW, EXCEPTIONS and STATE COUNTS. There are 854 rows, 852 unique codes, 729 codes absent from the canonical baseline, two duplicate groups/four occurrences, ambiguous combined codes, disputed geography/name evidence and expired budgets. These are source candidates, not approved additions. Geographic counts: TN 116, PY 14, KA 292, KL 125, TG 87, AP-1 77, AP-2 143. PY stays distinct geographically and consolidates into TN only through the existing reporting mapper.

The previous 35-column `Reliance_Retail_Consolidated_Store_AOP_FO_Mapping.xlsx` is available, SHA256 `6883f7cf5adb1aafda54a0bb59a6d1458f1991c6cc9bd452965b9302c49c0d64`. FO names/contacts and proposed zones are matching evidence. The seven separately named original mapping files were not available for independent verification; preserve their references without treating them as proof of QPMS identity or approved ownership.

## Source-to-target mapping and formats

| Audit / consolidated field | Unified target | Activation rule |
| --- | --- | --- |
| Site Code / Store Code | Immutable source.store_code; canonical match | Required for operational identity; blank/technical rows still retained in staging |
| Store Name / Location / Store Name (Source) | review.store_name | Independent correction review; no blank overwrite of canonical name |
| City / City / Location, Format / Store Format | review.city, review.store_format | Optional; approved canonical edits through guarded apply |
| Geographic State | source_state and review.state | Source geography immutable; staged correction needs both state scopes |
| Reporting State | Existing reportingState mapper | Source discrepancy flagged; no new competing mapping |
| Area / Locality, District, Address, Pincode | review area/district/address/pincode; canonical metadata.unified_details after review | Unknown stays blank; no invented address |
| Latitude / Longitude (Source) | review.location_evidence plus exact raw values | Evidence only; verified GPS capture path is unchanged |
| Operating Status, opening/closing dates | review operating_status/opening_date/closing_date | Explicit Active/Inactive for canonical edits; dates are optional metadata |
| Zone ID/Name/State/Status/effective dates | review.zone | Proposed evidence; operational changes need Zone/Store Zone proposals |
| FO Employee ID/Name/Contact/effective dates | review.fo_evidence | Only a selected existing active same-reporting-state QPMS FO can be assigned to a Zone |
| HK Staff / HK Supervisor | review.hk.staff / supervisor | Decimal components retained; total not automatically summed |
| MEPC Shared / Supervisor / Stationed | review.mepc shared/supervisor/stationed | Decimal components retained; total not automatically summed |
| Budget Start / End | Separate HK/MEPC proposed dates unless explicit class dates provided | Expired/invalid dates flagged |
| Class total, calculation ref, approval ref | Independent approved AOP version | Required explicit total and independently reviewed calculation/evidence |
| Source Sheet Row / Master Source Row | source_reference; actual worksheet and row separately retained | Immutable original evidence |
| Workbook YES/NO, reviewer notes, mapping evidence, exceptions | Raw cells, source sheets and review remarks | Never executable approval authority |

Recognized worksheets are STORE UPLOAD REVIEW (19 columns), CONSOLIDATED MASTER (35 source columns), and UNIFIED MASTER (expanded template). Every worksheet is archived with the exact file bytes/hash. Formula/error rows receive technical flags and are retained without automatic operational activation. A workbook with duplicate headers or unsafe/corrupt Excel packaging is rejected as a technical file; no partial save occurs. Files are limited to 10 MB and bounded worksheet dimensions.

The expanded template is downloadable from Store Master. Its totals are blank by design; use null, not zero, for unknown AOP. The supplied populated review workbook retains the original 854 rows and adds only uniquely matched source evidence by state/code/source reference. It does not invent IDs, totals or approvals.

## Screens and normal use

Open Reliance Retail → Store Master → Unified Management. The seven views cover Dashboard, Stores, Import & Sources, Zones & FO, AOP & Approvals, Attendance, and Activities. State/Zone/FO/Store/date filters form the drill-down. Provisional counts remain separately labelled source counts; they never inflate operational attendance targets. Older tabs remain available for retained evidence and compatibility. Legacy direct writes are blocked after installation, when the approved workflow becomes available.

Import Consolidated Master → select workbook → Preview all source rows → inspect flags and complete receipt → download errors/suggested fixes if needed → Save all authorized source rows. The whole file is refused if any state is outside the editor's scope; records are never silently filtered away. Receipt fields distinguish inserted staging rows, matched records, candidate updates, unchanged replay rows, conflicts and rejected operational technical rows. `operational_writes` is zero for staging. Identical bytes replay the original version without erasing reviewed corrections. Changed bytes create a new version and preserve previous reviewed rows.

Add Store requires only Store Code and State; name, FO, Zone and AOP can be unknown. It creates a pending immutable source record, never an active canonical store. Edit Store, Assign/Change Zone, Update HK AOP and Update MEPC AOP create proposals. New identities continue through the existing source-bound identity approval/activation workflow; unified review is not a substitute for its business evidence, genuine supervisor/FO requirements or file/row checks. Canonical code/geography/GPS corrections requiring identity or location proof remain in that established maintenance workflow. An approved staging identity does not by itself participate in attendance matching.

## Permissions and approvals

Use existing authenticated accounts. Existing ADMIN/QPMSADMIN accounts provide the logical Super Admin role; the strict existing Admin operational activation function is unchanged. Explicit state grants in retail_provisional_access now carry viewer/editor/reviewer permission. No accounts, employee roles or state grants are created automatically. Existing state grants default to viewer until explicitly reviewed and upgraded. Active status and Reliance Retail business remain required for non-Admins. The navigation shell may be visible to Retail users; that grants no data access or mutation permission.

Viewer: scoped read/export only. Editor: scoped imports, pending creation and proposals. Reviewer: scoped proposal review, with self-review prohibited. A correction crossing source geography requires access to both states. Only an existing active Admin may apply approved operational changes, and the backend retains the closed-by-default RETAIL_STORE_IMPORT_WRITES_ENABLED gate. Permission checks run at the backend/database boundary. New RPCs are service-role only; browser roles receive no direct table/RPC grants. A database proposal trigger also closes the legacy HK viewer proposal path.

The migration revokes legacy direct writes to Store/Zone/FO/AOP/manpower tables and legacy User Management Zone sync execution from service_role. Approved RPCs replace those paths. Identity/location/AOP import functions retain their existing grants and checks. User Management continues to manage accounts; operational FO-to-Zone changes use reviewed master proposals. Multiple Zones per FO remain supported. Review this permission transition explicitly before installation.

## Zone and FO workflow

Create or rename a state Zone through a proposal, then a different reviewer approves and Admin applies it. Select verified QPMS FO identity from the scoped list, never an imported name/phone. One Zone has one primary FO at a time; an FO may own multiple Zones. Store Zone assignments use the existing effective event history, deriving a single Zone at each instant. FO assignments use half-open time intervals with serialized overlap checks. A new assignment may be unassigned. Future ownership changes are supported; existing earlier intervals remain effective until their end.

Use ON_ACTIVATION for an explicitly reviewed immediate change, or an ISO timestamp for a future effective date; optional end timestamps must be later than start. Historical backdating is refused. If a future Store transfer exists, review its timeline instead of overwriting it. Stale Store/Zone/FO/AOP baselines are rejected. The current operational ownership view and Deep Cleaning lookup derive current mappings from the timeline. FO replacement requires one Zone change, not per-store owner edits. The existing compatibility trigger may maintain legacy mirrored fields; those fields are not the new authoritative owner.

Ownership before the migration's observed baseline is not inferred from current assignments. Existing trainer/performer snapshots and activity records are preserved and shown separately. Historical ownership is labelled unavailable where evidence cannot prove it. Future completed activities use their recorded completion/submission timestamp; daily attendance ownership is evaluated at the reporting day's end in India time.

## HK and MEPC AOP workflow

Choose a canonical store, Update HK AOP or Update MEPC AOP. Enter the separate components, explicitly confirmed total, effective start/end, approval reference, calculation reference and reason. Components preserve decimal values up to the existing four-decimal canonical target precision; unknown is null. No staff/supervisor inclusion or MEPC sum is assumed.

A different authorized reviewer approves. Admin applies with the existing write gate separately enabled by accountable authority. The existing retail_attendance_aop_versions relation is extended with a class discriminator, components and approval evidence. Legacy paired versions remain valid; new class-specific versions have an unknown/null opposite class. Overlap prevention remains in place per class, with legacy paired rows overlapping both classes.

To replace a class period, explicitly select the same-class existing version. The transaction retains the superseded original and preserves unchanged prefix/suffix periods, with audit references. It never rewrites attendance. Legacy paired AOP replacement remains in the established paired workflow. Approval refs and calculation refs are evidence that must correspond to real management decisions; the application cannot invent the business formula.

## Reporting and activity integration

Attendance reads existing current employee-day credits only. A/T/H/NO-SHOW remain 0; P/H-P remain 1; HD/H-HD remain 0.5. The existing database daily cap and attendance write path are unchanged. Independent effective HK/MEPC AOP is selected for each date. Unknown/pending AOP displays AOP Pending and no shortage. Missing attendance is unavailable, not an invented absence. Existing aggregate planning-day rules are reused.

Deep Cleaning and Training reporting reads existing records linked to canonical Store Codes/IDs and derives Zone/FO at activity submission/completion time. Existing actual trainer/performer identities stay separate. Before/after image availability uses uploaded evidence metadata; no storage objects are modified. Filters support state, Zone, FO, Store, range and status. Planned/draft and completed/submitted records are distinguishable. The migration supplies the missing empty Deep Cleaning planning relation, without modifying existing submissions. Plan Deep Cleaning on a canonical store creates an independently reviewed schedule. Existing submitted/completed evidence for the same store/date derives completion without rewriting the source schedule. Before installation, missing scheduled/pending/overdue counts remain unavailable; they are never fabricated as zero. The submission/evidence flows remain unchanged apart from current effective ownership lookup in Deep Cleaning.

## Production installation and acceptance — explicit authorization required

1. Save owner-level output of supabase/verification/retail_unified_preflight.sql. Verify 130 canonical stores, 854 existing source rows and 9,961 attendance rows against the current audit, or investigate and record an updated baseline. Verify prior migration 20261029120000 exact source MD5 88cdbe90a24be1fe11cd7caf445ecfe7; new proposed version 20261029140000 must be unused. Resolve overlapping legacy FO intervals or duplicate Store Zone timestamps before proceeding. Save identity-function definitions/ACLs and canonical/activity digests.
2. Review/authorize the schema, legacy direct-write revokes, current-ownership view change and migration epoch. Execute supabase/proposals/retail_unified_apply_and_record.sql once as the approved owner. Do not separately execute the source proposal. The wrapper installs the source and records it as one migration statement in one transaction; it refuses missing baseline/version reuse. There are no employee grants or store/AOP/attendance/activity seeds.
3. Run supabase/verification/retail_unified_postinstall.sql and repeat the preflight. Confirm one migration statement, exact normalized source MD5 from retail_unified_source_digest.txt, RPC ACLs, direct-write revokes and current owner view. Canonical, attendance, Deep Cleaning and Training digests must match. Staging/AOP JSON row shapes gain schema keys; compare prior columns rather than assuming a new JSON-key shape means data mutation.
4. Explicitly authorize exact actor/state grants with permission viewer, editor or reviewer. Example only: `insert into public.retail_provisional_access(actor_id,state,permission) values ('<verified-profile-uuid>'::uuid,'TN','editor') on conflict(actor_id,state) do update set permission=excluded.permission;`. Do not run placeholders or infer state grants from workbook FO names.
5. Confirm production read-only counts and current FO/Zone lookup in the authenticated browser. Preview the actual workbook and inspect every exception. Saving a new source file version, approving operational changes, enabling the existing write flag, assigning employees, activating identities and approving AOP totals are separate real production actions requiring accountable authorization. None is performed by deploying application code.
6. Verify viewer/edit/reviewer isolation with designated test accounts, self-approval refusal, pending Store creation, existing-source replay, historical credits, missing-AOP labels, current/future FO ownership and Excel export. Public asset/401 checks do not prove authenticated production acceptance.

Rollback is a write quarantine, not deletion: close the existing operational write gate through the approved configuration process, execute supabase/verification/retail_unified_quarantine.sql only with authorization, and retain all schema/data/evidence. Application code can be reverted independently; keep reads and security restrictions. Do not drop new columns, reinstate legacy direct writes or erase accepted AOP periods as an automatic rollback.
