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
