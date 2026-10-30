# Unified import classification

The importer previously treated every nonempty `Mapping Conflict / Note` or
`Conflict / Closed Evidence` value as `SOURCE_CONFLICT`. The 854-row consolidated
review workbook contains 853 optional-completion notes and one contradictory FO
name note. Original cells, row digests and retained versions remain unchanged.

## Preview and review export

Match type is independent of review priority. Canonical and provisional matches
are counted separately. Review priority is, in descending order:

| Classification | Meaning |
| --- | --- |
| Blocking Identity Conflict | Duplicate/ambiguous code, geography conflict, unknown geography or missing required code. Independent identity resolution is required before activation. |
| Needs Review | Other conflicting evidence, exception-sheet evidence, expired budget, technical issue or an unknown source note. |
| Pending MIS Completion | Optional Zone, FO, AOP or other completion fields remain pending. |
| Ready for Staging | No currently detected issues. This is not verification or activation. |

Every row retains its complete issue list. Optional pending fields, review flags,
identity blockers and actual conflicts have separate export columns. Pending and
actual-conflict counts overlap; the four priority classifications are exclusive.
Unknown notes remain visible for review. Only explicit contradiction evidence is
classified as a source conflict. Historic source flags are interpreted for display
without changing immutable stored evidence.

For `Reliance_Retail_Unified_Master_Review.xlsx` (SHA-256
`00da9cefedf091dd24075dd35f1c0efbb8bfa3a64cce827d0335097dd103895a`),
compared with the user's `Retail-Import-Errors-Review.xlsx`:

| Receipt | Before | After |
| --- | ---: | ---: |
| Source rows / matched rows | 854 / 854 | 854 / 854 |
| Canonical / provisional matches | 125 / 729 | 125 / 729 |
| Rows with optional pending fields | 854 | 854 |
| SOURCE_CONFLICT flags | 854 | 1 |
| Rows with actual conflicts | 854 | 109 |
| Pending MIS Completion | — | 736 |
| Needs Review | — | 111 |
| Blocking Identity Conflict | — | 7 |
| Ready for Staging | — | 0 |
| Technical rejections / operational writes | 0 / 0 | 0 / 0 |

The remaining evidence includes 104 canonical-name conflicts, 14 exception-sheet
reviews, 10 expired budgets, 4 duplicate-code flags, 3 ambiguous-code flags and 2
geography conflicts. Counts overlap. None are resolved automatically. The former
`proposed_updates=125` incorrectly counted canonical matches as proposed updates;
the corrected preview reports zero because staging creates no correction proposal.

## Admin and MIS workflow

1. Open Reliance Retail → Store Master → Unified Management and select the
   consolidated workbook under Import Consolidated Master.
2. Preview all source rows. Inspect match counts, independent issue buckets and
   the downloadable errors/suggested-fixes workbook.
3. An authorized editor may save all authorized source rows, including optional
   pending fields and identity blockers. Identity blockers prevent activation,
   not immutable source retention. Existing state scope checks still apply.
4. MIS proposes corrections through the existing independent review workflow.
   Resolve duplicate, ambiguous and geography evidence individually. Existing
   identity, AOP, FO and operational approval gates remain mandatory.

## Save safety and repeat imports

No SQL migration is required. Save still calls the existing staging RPC, which
only inserts provisional files, rows and audit events. It never activates a store,
creates a Zone, verifies an FO, approves AOP or changes operational ownership.
All staged records remain `PENDING_VERIFICATION`.

An identical-byte upload uses its existing file hash and returns unchanged rows.
A different file hash creates a new immutable version. On the read-only production
snapshot checked for this fix, the expanded consolidated file was not yet saved;
saving it would add 854 pending source occurrences, retaining the existing 854
occurrences (1,708 across two versions). This is version retention, not additional
operational stores. Previously reviewed corrections are not overwritten.

Production Save and production SQL are separate authorized actions. Neither is
needed to deploy this classification-only code change. The existing 130 canonical
stores and Store → Zone → FO assignments are unaffected.

## Validation

`backend/tests/retailUnifiedClassification.test.js` covers note interpretation,
priority, historic evidence immutability, independent counters, all 854 raw values,
row digests and normalized reviews, replay preview and authorization. Its optional
browser test uses the actual built page and full workbook with a local snapshot;
production writes are prohibited by the harness.

`backend/tests/retailUnified.test.js`, with `RETAIL_UNIFIED_POSTGRES=1` and
`RETAIL_CLASSIFICATION_WORKBOOK` set, exercises real disposable PostgreSQL staging,
new-version retention, replay, correction preservation and protected operational
digests in addition to the existing approval, permission and ownership tests.
