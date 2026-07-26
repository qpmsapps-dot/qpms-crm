import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const server = await readFile(new URL('../backend/server.js', import.meta.url), 'utf8');
const page = await readFile(new URL('../src/pages/FOActivities.jsx', import.meta.url), 'utf8');
const reportUtility = await readFile(
  new URL('../src/utils/employeeRangeReport.js', import.meta.url),
  'utf8',
);

test('employee range endpoints require JWT authentication', () => {
  assert.match(server, /app\.get\('\/api\/fo\/operations\/employee-range',\s*requireSupabaseJwt/);
  assert.match(server, /app\.post\('\/api\/fo\/km\/recalculate-employee-range',\s*requireSupabaseJwt/);
});

test('selected employee screen uses normalized range endpoint', () => {
  assert.match(page, /\/api\/fo\/operations\/employee-range/);
  assert.match(page, /Recalculate Selected Period/);
});

test('exports do not use the old selected-employee global query', () => {
  assert.match(page, /exportEmployeeRangeExcel/);
  assert.doesNotMatch(page, /onExport=\{\(\) =>\s*exportFoOperationsExcel/);
});

test('today_status_and_period_status_are_separate', () => {
  assert.match(page, /Today&apos;s Status:|Today's Status:/);
  assert.match(page, /Period Attendance Status/);
  assert.match(page, /Period First Start/);
  assert.match(page, /Period Last End/);
});

test('pdf_contains_all_attendance_rows', () => {
  assert.match(
    page,
    /\(rangeDataset\?\.daily_summary \|\| \[\]\)\.map\(\(row\) =>/,
  );
});

test('exports_ignore_ui_pagination_limits', () => {
  assert.match(page, /buildEmployeeRangeExcelRows\(dataset\)/);
  assert.match(reportUtility, /dataset\?\.travel_legs \|\| \[\]/);
  assert.match(reportUtility, /dataset\?\.site_visits \|\| \[\]/);
});
