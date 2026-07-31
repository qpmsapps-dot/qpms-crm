import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const source = fs.readFileSync('src/pages/FOActivities.jsx', 'utf8');

test('End Day route KM prefers a positive calculated final travel leg', () => {
  const helper = source.slice(
    source.indexOf('function finalReturnLegKmFromAttendance'),
    source.indexOf('\nfunction isStaleAutoEndedAttendance', source.indexOf('function finalReturnLegKmFromAttendance')),
  );
  assert.match(helper, /leg\?\.calculated_km/);
  assert.match(helper, /leg\?\.calculatedKm/);
  assert.match(helper, /value !== null && value > 0/);
  assert.match(helper, /metadata\.final_return_leg_km/);
  assert.doesNotMatch(helper, /finalLeg\?\.km\s*\?\?/);
});

test('End Day row uses the normalized final-leg distance field', () => {
  const timeline = source.slice(
    source.indexOf('const timelineRows = useMemo'),
    source.indexOf('\n  }, [firstAttendance, lastAttendance, totalKm, visits, workingMinutes]);', source.indexOf('const timelineRows = useMemo')),
  );
  assert.match(timeline, /const finalReturnLegKm = finalReturnLegKmFromAttendance\(lastAttendance\)/);
  assert.match(timeline, /distance: finalReturnLegDistance/);
});
