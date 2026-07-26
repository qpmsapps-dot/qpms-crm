import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const source = fs.readFileSync('src/pages/FOActivities.jsx', 'utf8');

test('bike_to_car_web_uses_canonical_petrol_amount', () => {
  assert.match(
    source,
    /function petrolAmountFromAttendance[\s\S]*row\?\.petrol_amount/,
  );
  assert.match(
    source,
    /function officerPetrolDisplay[\s\S]*officer\?\.petrolAmount/,
  );
});

test('completed_attendance_does_not_reprice_using_latest_mode', () => {
  assert.match(source, /isCanonicalPetrolPending/);
  assert.match(source, /Pending canonical recalculation/);
  assert.doesNotMatch(
    source,
    /"Petrol Amount":\s*calculatePetrolAmount\(/,
  );
});
