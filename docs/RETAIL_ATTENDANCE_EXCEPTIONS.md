# Retail uploaded-attendance exceptions

Base: `80fe06d842a0efc79c18124dbe16d05ca1bdf34c`. Separate reporting enhancement;
never changes FO attendance, GPS, KM, payroll, petrol, attendance credits, AOP,
weekly-off planning, man-days or existing percentage calculations.

## Source verification

Locally inspected original `Attendance Status Report(11_23_2026, 11_39_47 AM).xlsx`:
SHA-256 `d149b087befb09e6a4cdf55d145819f510dd1d6266f2caf8e3c20318a8842c50`.
Sheet `Attend Status Temp Report`, range `A1:AR2459`, 2,458 records, all dated
2026-11-21. Independent source-row scan: HK 2,114, MEPC 343, excluded Goods
Receiving 1; no duplicate employee/site/date keys. Punches and durations are text.

| Category | Missing Checkout | Below 9 Work Hours |
| --- | ---: | ---: |
| HK | 25 | 57 |
| MEPC | 13 | 3 |
| Total | 38 | 60 |

One inconsistent MEPC record, source row 763: In 04:57:28, Out 15:51:30,
Man Hours 6:44:36. It satisfies the specified recorded-Man-Hours rule and is
included in the three MEPC below-nine records, **also flagged for review**.
Do not correct it from punch duration or infer payroll consequences. Actual
employee identity remains in the original source, not in this repository.
The checked-in fixture retains only class, three times and original status,
with synthetic employee/store identities in tests. No workbook PII is committed.

## Behaviour

Both existing parsers capture optional, uniquely named In Time, Out Time and
Man Hours fields and formula provenance. Validated rows retain this versioned
object in the existing immutable upload payload; no new attendance columns or
changed commit RPC are necessary. Existing duplicate rejection, global daily
credit cap, idempotent checksum, reasoned corrections, supersession, audit and
atomic commit remain intact. Source rows, status and raw time values survive.

Excel numeric times mean fractions of a day, not decimal hours. Zero is midnight,
not missing. Durations support [h]:mm:ss; date serials, negatives, malformed times
and formula-derived optional times are flagged, never used as verified exceptions.
Punches crossing midnight use modulo-24-hour elapsed time for consistency checks.
Recorded valid Man Hours controls Below 9; it is not replaced with elapsed time.
Missing checkout and below-nine records are mutually exclusive. Neither-punch
records count toward neither. Invalid/inconsistent records have a separate view.

The new read-only endpoint reuses canonical Retail access and effective state
grants; untrusted state/store/class claims cannot widen scope. Original states
are retained (existing reporting consolidation is unchanged). Current
employee/site/date is the record identity, preserving legitimate multi-site
half-day records. Superseded and duplicate keys never count again. Counts are
record counts, not unique employees across a month or attendance credits.

Daily and MTD use the same page cutoff/state controls. Categories are HK/MEPC
within existing permissions. Missing selected dates, legacy time data or invalid
inputs yield N/A for affected totals, with known exception subtotals and coverage
warnings. No upload is interpreted as employee absence. Empty/unavailable service
results never become zero. Drill-down paginates 50 records; XLSX export contains
all selected known affected records, original status and time-validation warnings.

## Database proposal and release gates

**Unapplied**: `supabase/proposals/retail_attendance_exceptions_20261123.sql`.
Adds only a stable, backend/service-role-only read RPC. No tables, mutation RPCs,
RLS, triggers, historical rows, grants to browsers or existing APIs are changed.
It joins current attendance rows to their own committed batch/source-row payload,
expanding each batch once. Scope is limited to one month, selected canonical
stores and permitted classes. A 100,001-row sentinel prevents silent truncation;
the backend rejects reports exceeding 100,000 rows.

Read-only production catalog inspection confirmed the existing attendance table
has batch_id/source_row/superseded_at but no time columns; the commit and report
RPCs are SECURITY DEFINER, executable only by postgres/service_role. Installed
commit definition MD5 `4fd7c98e98d611c06766e2d3ef91647d` and report definition MD5
`d20e97bba10867442f406f899a34269a` were recorded for preflight comparison.

Before release: approve the SQL separately, confirm current definitions and
function-name collision absence, preserve a backup/recovery point, install only
this additive proposal through the approved process, then approve matching backend
and frontend deployment. Never rerun migration 232. This task applies no SQL.

Read-only production metadata confirms this exact workbook was already committed:
2,458 source rows, 2,457 valid, zero rejected; the exception RPC is not installed.
For old payloads, the backend therefore recovers times **read-only** from their
existing committed source archives, after the existing gzip byte-length/SHA-256
checks. Every recovered source-row, employee, store snapshot, date, class and
original status must match the current authorized attendance row. Cross-state
archive rows never enter the response. Each relevant archive decodes once;
128-archive / 256MiB aggregate decoded budgets fail closed. Missing original time
columns remain N/A; corrupt or ambiguous source fails with an explicit error.
No historical payload or attendance record is updated and no reimport is required.
The identical workbook remains idempotent. Current supersession and authorization
may change live totals relative to the historical reference fixture.

Recovery: roll back matching application versions first; retain all source and
time evidence. The new read-only RPC may remain installed. Dropping it requires
approval; no destructive data rollback is needed. Never restore superseded rows.

## Validation and acceptance

Native PostgreSQL17 is mandatory, not skipped. Existing 232 plus the additive
proposal install in a disposable loopback database; proposal rerun is idempotent.
Native tests cover original commit fingerprint preservation, immutable payload,
replay, corrections, racing sessions, browser-role denial, unsupported class and
month-range rejection. Full-month read uses 73,710 current rows loaded as normal
daily batches; strict 8s SQL timeout and **5s measured read limit**. Local measured
read: 2,410ms initially and 4,130ms in the final run. Both pass the unchanged 5s
limit. These are synthetic workstation measurements, not production proof.

Focused tests cover original redacted rows through both parsers, overnight and
numeric times, absent/invalid/formula fields, duplicates, MTD/daily, state scope,
authorization and XLSX round-trip. Chromium covers desktop/tablet/mobile cards,
filters, employee drill-down, unavailable/error states and downloads. Existing
Attendance browser and reporting/credit/AOP regressions remain required.

Exact-file CI authorization pins the entire new delta against this main base;
existing guards delegate only for this exact reviewed delta and all prior
workflow steps/negative tests remain intact. No production acceptance is claimed.
The older Thermography preservation test expected an outdated operational workflow;
its reference is advanced only for that workflow to this exact main base, retaining
the mandatory MIS onboarding tests/lint already deployed on main. No workflow step
or security assertion is removed.

Local results: 76 focused reporting/parser/permission/AOP tests passed; one existing
opt-in test for a different historical 64,838-row workbook was not run. This task's
exact 2,458-row source fixture is mandatory and passes. All 223 guard/negative tests,
six native PostgreSQL tests and 14 Chromium tests pass. Scoped ESLint and production
build pass (existing large-bundle warning remains). Desktop/tablet/mobile screenshots
were inspected; new cards remain below the existing KPIs with stacked labels/counts.

After separately approved release, authenticated acceptance must verify admin
and state-reader access, 21-Nov source totals (subject to committed current
canonical imports), daily/MTD filters, legacy N/A, invalid-row drill-down, employee
export and unchanged credit/AOP/percentages. Do not create production test records.
