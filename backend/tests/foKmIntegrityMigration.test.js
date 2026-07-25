import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '../..');
const migrationPath = path.join(
  root,
  'supabase/migrations_2_0/033_fo_km_integrity.sql',
);
const migration = fs.readFileSync(migrationPath, 'utf8');
const recalculation = fs.readFileSync(
  path.join(root, 'backend/foKmRecalculationService.js'),
  'utf8',
);
const mobileService = fs.readFileSync(
  path.join(root, 'Mobile_FO_V2/lib/services/supabase_service.dart'),
  'utf8',
);

function functionBody(name) {
  const start = migration.indexOf(`function public.${name}`);
  assert.notEqual(start, -1, `${name} must exist`);
  const end = migration.indexOf('$$;', start);
  assert.notEqual(end, -1, `${name} must have a complete body`);
  return migration.slice(start, end);
}

function attendanceUpdateBodies() {
  return [...recalculation.matchAll(/const attendanceUpdate = \{([\s\S]*?)\n  \};/g)]
    .map((match) => match[1]);
}

test('delayed_location_log_preserves_backend_payable_totals', () => {
  const body = functionBody('refresh_fo_attendance_actual_travel_km');
  for (const field of [
    'total_route_km',
    'eligible_km',
    'total_approved_km',
    'petrol_amount',
  ]) {
    assert.doesNotMatch(body, new RegExp(`\\b${field}\\s*=`));
  }
});

test('delayed_site_visit_update_preserves_closed_attendance_canonical_totals', () => {
  const body = functionBody('refresh_fo_attendance_payable_route_km');
  assert.match(body, /logout_time\s+is\s+null/i);
  assert.match(body, /canonical_end_day_recalculation/i);
  assert.match(body, /status\s*=\s*'Active'/i);
});

test('active_attendance_may_receive_provisional_site_visit_route_total', () => {
  const body = functionBody('refresh_fo_attendance_payable_route_km');
  assert.match(body, /status\s*=\s*'Active'/i);
  assert.match(body, /route_sync_status\s*=\s*'site_visit_route_km_sum'/i);
  assert.match(body, /total_route_km\s*=\s*route_totals\.total_route_km/i);
});

test('backend_recalculation_marks_attendance_as_canonical', () => {
  assert.match(
    recalculation,
    /canonicalRouteSyncStatus\s*=\s*'canonical_end_day_recalculation'/,
  );
});

test('gps_trigger_preserves_raw_and_filtered_gps_audit_fields', () => {
  const body = functionBody('refresh_fo_attendance_actual_travel_km');
  for (const field of [
    'raw_gps_km',
    'filtered_gps_km',
    'actual_travel_km',
    'total_raw_km',
    'actual_travel_updated_at',
  ]) {
    assert.match(body, new RegExp(`\\b${field}\\s*=`));
  }
});

test('actual_km_has_one_documented_owner', () => {
  const gpsBody = functionBody('refresh_fo_attendance_actual_travel_km');
  const visitBody = functionBody('refresh_fo_attendance_payable_route_km');
  assert.match(gpsBody, /\bactual_km\s*=/);
  assert.doesNotMatch(visitBody, /\bactual_km\s*=/);
  assert.doesNotMatch(recalculation, /\bactual_km\s*:/);
  assert.doesNotMatch(mobileService, /['"]actual_km['"]\s*:/);
  for (const field of [
    'raw_gps_km',
    'filtered_gps_km',
    'actual_travel_km',
    'total_raw_km',
  ]) {
    for (const body of attendanceUpdateBodies()) {
      const topLevelFields = body.split(/\n\s*metadata\s*:/)[0];
      assert.doesNotMatch(topLevelFields, new RegExp(`\\b${field}\\s*:`));
    }
    assert.doesNotMatch(
      mobileService,
      new RegExp(`['"]${field}['"]\\s*:`),
    );
  }
});

test('service role receives only the required travel-leg read grant', () => {
  assert.match(
    migration,
    /grant\s+select\s+on\s+table\s+public\.fo_travel_legs\s+to\s+service_role/i,
  );
  assert.doesNotMatch(
    migration,
    /grant\s+(insert|update|delete)[^;]*fo_travel_legs[^;]*service_role/i,
  );
});

test('travel-leg boundary uniqueness is preflighted before index creation', () => {
  assert.match(migration, /duplicate fo_travel_legs start boundaries/i);
  assert.match(
    migration,
    /create unique index if not exists ux_fo_travel_legs_attendance_started/i,
  );
});

test('old mobile clients without travel legs remain compatible', () => {
  assert.match(
    recalculation,
    /persistedCandidateLegs\.length > 0\s*\?\s*persistedCandidateLegs\s*:\s*buildCompletedTravelLegs/,
  );
});
