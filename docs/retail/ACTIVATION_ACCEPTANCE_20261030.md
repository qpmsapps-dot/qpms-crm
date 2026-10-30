# Reliance Retail activation acceptance, 2026-10-30

## Delivered application scope

- Main OOS and Fault menu routes now open the installed Service Tracker workflow. Historical imported IFMS tickets remain accessible separately.
- Quotation preview distinguishes new, unchanged, rework and advanced rework requiring V2. Revised single-quotation uploads use revision-checked rework. Replaying a prior source version does not revert current data.
- Explicit OOS MIS/Admin backend authorization supplements existing state grants and independent commercial approval. No grants are assigned to employees.
- Approved OOS stage labels, status counts, quotation line-item drill-down, history, Excel line items and audit export.
- Fault HK/MEPC classification, status/priority filters and ageing display; unknown historical categories stay unclassified. Existing registration, FO assignment, escalation, resolution/evidence and reviewer closure RPCs retained.
- Training Excel export includes source identity and effective-dated Zone/FO ownership. Existing submissions and evidence flow retained.

## Acceptance evidence

Production build passes (existing bundle-size warning). Full 854-row source/database/browser regression: 15 passed, zero failed/skipped. Service Tracker database/browser and OOS authorization/replay suite covers dedicated routes, quotation upload, Fault registration, Training evidence, Excel downloads, ACLs, atomic new imports, forward-only transitions and historical Store preservation. Disposable PostgreSQL validates new V2 delivered-stage rework retains status and PO/payment/delivery references. Additive installer replay yields exactly one ledger record, with original RPC unchanged.

Production reads at 2026-10-30 11:11 UTC: Version 2 saved, 854 rows; 1708 retained source rows; canonical130, Zones4, FO assignments4. Service Tracker and Zone Draft read RPCs return200. No production data writes or migrations executed by this release. No authenticated positive production write acceptance is claimed.

Production migration 20261030140000 remains UNVERIFIED: owner post-install result grids absent, no owner connection, ledger schema unavailable via REST. Its package source matches the expected local fingerprint; that is not proof of the installed ledger/function/ACL state. Protected production digest equality is not established.

## Operational counts and genuine identity work

| State | Active | New identity pending | Ready for review |
| --- | ---: | ---: | ---: |
| TN | 115 | 5 | 2 |
| PY | 15 | 0 | 0 |
| KA | 0 | 292 | 290 |
| KL | 0 | 125 | 125 |
| TG | 0 | 87 | 86 |
| AP-1 | 0 | 77 | 75 |
| AP-2 | 0 | 143 | 139 |

717 new identities are review-ready, nine need evidence, three are blocked. None were approved or activated. Both existing identity/master write gates remain closed (variables absent, default false). Use existing independently authorized identity review; missing Zone/FO/AOP is not evidence of an identity conflict. Four existing zones/FO assignments and all130 store mappings are preserved. Pending729 identities have no operational Zone assignment.

## Historical evidence

Refreshed production reads retain9961 attendance rows, nine Training sessions, three Deep Cleaning submissions and eight available image objects (three before/five after). One Training session matches a canonical identity. Eight unmatched sessions use codes43354 or REILNSTST; neither has an exact854-source match. No suggested canonical replacement can be justified from that evidence.

Deep Cleaning source code TKS7 has provisional TG evidence;2843 has provisional KL evidence;1244 has no exact source match. All three lack canonical links. These are review suggestions only: no historical record was rewritten or image removed.

## Remaining controlled actions

1. DB owner supplies original package03 post-install outputs for fingerprint/ACL/catalog/protected-digest verification. Do not rerun140000.
2. Review/authorize the separate retail_oos_rework_v2 package before owner installation. Only its new160000 migration enables advanced-stage rework. Ordinary pre-PO rework remains usable. Revised multi-quotation uploads currently require separate individual workbooks.
3. Authorized logged-in Admin/OOS MIS performs safe positive production acceptance. No user JWT/rollback transaction channel is available to this runtime; immutable production events cannot be silently cleaned up.
4. Independent reviewers resolve identity evidence and historical links. Admin decides separately whether to enable existing approval/write gates. No real employees were automatically granted access and no gate was changed.

Training and Deep Cleaning remain PARTIAL for historical identity coverage. Full OOS go-live is BLOCKED on the new additive capability; Fault production write acceptance remains UNVERIFIED. UI/backend deployment alone is not full production acceptance.

## Preserved boundaries

No changes to installed migrations, canonical identities, current operational mappings, attendance rules/data, AOP approvals, GPS, KM, payroll, actual financial records or mobile. Unrelated dirty checkout work is untouched; release uses an isolated checkout and explicit file manifest.
