import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const source = await readFile(new URL('../src/pages/FOActivities.jsx', import.meta.url), 'utf8');

test('filtered summary cancels stale requests without replacing failures with zero', () => {
  assert.match(source, /const controller = new AbortController\(\)/);
  assert.doesNotMatch(source, /setFilteredSummary\(EMPTY_OPERATIONS_SUMMARY\)/);
  assert.match(source, /return \(\) => controller\.abort\(\)/);
  assert.match(source, /shouldAcceptSummaryResponse\(requestSequence, summaryRequestSequenceRef\.current\)/);
});

test('successful KM recalculation paths refresh the currently applied summary', () => {
  const refreshes = source.match(/setSummaryRefreshToken\(\(value\) => value \+ 1\)/g) || [];
  assert.ok(refreshes.length >= 5, 'Apply, reset, manual refresh and recalculation paths must refresh totals');
});

test('activity menu and preview keep click and keyboard behavior scoped and cleaned up', () => {
  assert.match(source, /event\.stopPropagation\(\)/);
  assert.match(source, /event\.key === "ArrowRight"/);
  assert.match(source, /event\.key === "ArrowLeft"/);
  assert.match(source, /event\.key === "Escape"/);
  assert.match(source, /removeEventListener\("keydown", handleKeyDown\)/);
  assert.match(source, /removeEventListener\("pointerdown", handlePointerDown\)/);
});

test('activity preview has broken-image, PDF, lazy-thumbnail and signed-url handling', () => {
  assert.match(source, /setActivityPreviewImageFailed\(true\)/);
  assert.match(source, /activeActivityPreviewKind === "pdf"/);
  assert.match(source, /loading="lazy"/);
  assert.match(source, /signedActivityUploadUrl\(upload\)/);
  assert.doesNotMatch(source, /href=\{upload\.displayUrl \|\| upload\.file_url/);
});

test('Operations dashboard requests and displays current travel mode', () => {
  assert.match(source, /FO_LIVE_STATUS_SELECT\s*=[\s\S]*travel_mode,rate_per_km/);
  assert.match(source, /function travelModeRatePerKm/);
  assert.match(source, /case "car":\s*return "Car"/);
  assert.match(source, /Travel Mode:/);
  assert.match(source, /<DetailSummaryCard icon=\{Bike\} label="Travel Mode"/);
  assert.match(source, /sumAttendancePetrolAmount\(rangeAttendances\)/);
});

test('historical Operations Excel export paginates site visits and large source tables', () => {
  const pagedHelper = source.slice(
    source.indexOf('async function fetchPagedSupabaseRows'),
    source.indexOf('\nasync function fetchFoSiteVisitRows', source.indexOf('async function fetchPagedSupabaseRows')),
  );
  assert.match(pagedHelper, /batchSize = 1000/);
  assert.match(pagedHelper, /\.range\(from, to\)/);
  assert.match(pagedHelper, /batch\.length < batchSize/);
  assert.match(pagedHelper, /seen\.has\(key\)/);

  const siteVisitHelper = source.slice(
    source.indexOf('async function fetchFoSiteVisitRows'),
    source.indexOf('\nfunction siteVisitFoId', source.indexOf('async function fetchFoSiteVisitRows')),
  );
  assert.match(siteVisitHelper, /\.from\("fo_site_visits"\)/);
  assert.match(siteVisitHelper, /\.gte\("check_in_time", fromIso\)/);
  assert.match(siteVisitHelper, /\.lte\("check_in_time", toIso\)/);
  assert.match(siteVisitHelper, /\.order\("check_in_time", \{ ascending: false \}\)/);
  assert.match(siteVisitHelper, /\.order\("id", \{ ascending: false \}\)/);
  assert.match(siteVisitHelper, /fetchPagedSupabaseRows\(buildPrimaryQuery\)/);
  assert.doesNotMatch(siteVisitHelper, /\.limit\(/);

  const historicalExport = source.slice(
    source.indexOf('async function exportHistoricalOperationsDashboardExcel'),
    source.indexOf('\nasync function _exportFoOperationsExcel', source.indexOf('async function exportHistoricalOperationsDashboardExcel')),
  );
  assert.match(historicalExport, /fetchPagedSupabaseRows\(\(\) => supabase[\s\S]*?\.from\("profiles"\)/);
  assert.match(historicalExport, /fetchPagedSupabaseRows\(\(\) => supabase[\s\S]*?\.from\("fo_attendance"\)/);
  assert.match(historicalExport, /fetchFoSiteVisitRows\(fromIso, toIso\)/);
  assert.doesNotMatch(historicalExport, /\.limit\(/);
});

test('historical Operations Excel export falls back from zero visit duration to checkout timestamps', () => {
  const durationHelper = source.slice(
    source.indexOf('function siteVisitDurationMinutes'),
    source.indexOf('\nfunction siteVisitDuration', source.indexOf('function siteVisitDurationMinutes')),
  );
  assert.match(durationHelper, /const storedDuration = Number\(visit\?\.visit_duration_minutes\)/);
  assert.match(durationHelper, /Number\.isFinite\(storedDuration\) && storedDuration > 0/);
  assert.match(durationHelper, /parseDate\(visit\?\.check_in_time\)/);
  assert.match(durationHelper, /parseDate\(visit\?\.check_out_time \?\? visit\?\.checkout_time\)/);
  assert.match(durationHelper, /checkOut < checkIn/);
  assert.match(durationHelper, /Math\.round\(\(checkOut\.getTime\(\) - checkIn\.getTime\(\)\) \/ 60000\)/);

  const durationLabel = source.slice(
    source.indexOf('function siteVisitDuration(visit)'),
    source.indexOf('\nfunction buildSiteVisitPin', source.indexOf('function siteVisitDuration(visit)')),
  );
  assert.match(durationLabel, /`\$\{siteVisitDurationMinutes\(visit\)\} min`/);

  const historicalExport = source.slice(
    source.indexOf('function exportFilteredOperationsDashboardExcel'),
    source.indexOf('\nasync function exportHistoricalOperationsDashboardExcel', source.indexOf('function exportFilteredOperationsDashboardExcel')),
  );
  assert.match(historicalExport, /"Visit Duration": siteVisitDuration\(visit\)/);

  const legacyExport = source.slice(
    source.indexOf('async function _exportFoOperationsExcel'),
    source.indexOf('\nfunction appendSheet', source.indexOf('async function _exportFoOperationsExcel')),
  );
  assert.match(legacyExport, /"Visit Duration Minutes": siteVisitDurationMinutes\(visit\)/);
  assert.doesNotMatch(legacyExport, /visit\.visit_duration_minutes \?\?/);
});
