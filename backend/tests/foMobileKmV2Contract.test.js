import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const mobileRoot = new URL('../../Mobile_FO_V2/lib/', import.meta.url);
const readMobile = (relative) => readFile(new URL(relative, mobileRoot), 'utf8');

test('foreground and background provider positions are never relabelled with DateTime.now', async () => {
  for (const relative of ['tracking/tracking_service.dart', 'services/background_tracking_service.dart']) {
    const source = await readMobile(relative);
    const providerBlock = source.slice(
      source.indexOf('ProviderTimestampPolicy.classify'),
      source.indexOf('await LocalStore.addLocationLog', source.indexOf('ProviderTimestampPolicy.classify')),
    );
    assert.match(providerBlock, /providerTimestamp: position\.timestamp/);
    assert.match(providerBlock, /capturedAt: timestampDecision\.capturedAt/);
    assert.match(providerBlock, /receivedAt: timestampDecision\.receivedAt/);
    assert.doesNotMatch(providerBlock, /capturedAt: DateTime\.now\(\)/);
  }
});

test('offline persistence and upload retain capture time, receipt time and local UUID', async () => {
  const local = await readMobile('services/local_db_service.dart');
  const remote = await readMobile('services/supabase_service.dart');
  assert.match(local, /'logged_at': log\.receivedAt\.toUtc\(\)\.toIso8601String\(\)/);
  assert.match(local, /'captured_at': log\.capturedAt\.toUtc\(\)\.toIso8601String\(\)/);
  assert.match(local, /'timestamp_quality': log\.timestampQuality/);
  assert.match(remote, /'local_id': log\.id/);
  assert.match(remote, /'provider_timestamp_quality': log\.timestampQuality/);
});

test('mobile End Day submits lifecycle evidence but not completed financial totals', async () => {
  const source = await readMobile('services/supabase_service.dart');
  const legacyEnd = source.slice(
    source.indexOf('static Future<void> endAttendance('),
    source.indexOf('static Future<EndDayAttendanceResolution> endCurrentActiveAttendance'),
  );
  const currentEnd = source.slice(
    source.indexOf('static Future<EndDayAttendanceResolution> endCurrentActiveAttendance'),
    source.indexOf('static Future<void> updateEndDayLiveStatus'),
  );
  for (const endAttendance of [legacyEnd, currentEnd]) {
    assert.match(endAttendance, /pending_canonical_end_day_recalculation/);
    assert.doesNotMatch(endAttendance, /'total_route_km'\s*:/);
    assert.doesNotMatch(endAttendance, /'total_approved_km'\s*:/);
    assert.doesNotMatch(endAttendance, /'petrol_amount'\s*:/);
  }
});
