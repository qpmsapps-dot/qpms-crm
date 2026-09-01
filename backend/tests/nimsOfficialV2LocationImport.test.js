import assert from 'node:assert/strict';
import test from 'node:test';

import {
  buildOfficialNimsV2Plan,
  officialV2ApplyReadiness,
  parseArgs,
} from '../scripts/importNimsLocationMaster.js';

test('official V2 import mode uses the hospital-provided workbook and import template', () => {
  const args = parseArgs(['--official-v2', '--dry-run']);
  assert.equal(args.officialV2, true);
  assert.equal(args.apply, false);
  assert.equal(args.workbook, 'docs/nims/NIMS_Hospital_Ticketing_Location_Map.xlsx');

  const plan = buildOfficialNimsV2Plan(args.workbook, args);
  assert.deepEqual(plan.metadata.sheetNames, [
    'Location Master',
    'Block Summary',
    'Review Before Import',
    'Import Template',
    'Recommended Hierarchy',
  ]);
  assert.equal(plan.metadata.hierarchySheet, 'Import Template');
  assert.equal(plan.blocks.size, 6);
  assert.equal(plan.floors.size, 32);
  assert.equal(plan.locations.size, 240);
  assert.equal(plan.departments.size, 240);
});

test('official V2 maps every Place as matching department and location compatibility rows', () => {
  const plan = buildOfficialNimsV2Plan();
  const dialysisKey = 'core block|ground floor|dialysis';
  const department = plan.departments.get(dialysisKey);
  const location = plan.locations.get(dialysisKey);
  assert.equal(department.department_name, 'Dialysis');
  assert.equal(location.location_name, 'Dialysis');
  assert.equal(location.department_code, department.department_code);
  assert.equal(location.department_name, 'Dialysis');
  assert.equal(location.metadata.compatibility_mapping, 'place_as_department_and_location');
});

test('official V2 applies approved display normalisations and keeps only unresolved rows in review', () => {
  const plan = buildOfficialNimsV2Plan();
  const reviewRows = plan.review.map((row) => `${row.block}|${row.floor}|${row.place}`);

  assert.deepEqual(reviewRows, [
    'Admin Block|1st Floor|Explanation project cell',
    'Admin Block|2nd Floor|SRC (Ethick ) department',
    'Radiation Block|1st Floor|Neclev medical',
  ]);

  const ortho = plan.locations.get('admin block|ground floor|ortho op');
  assert.equal(ortho.location_name, 'Ortho OP');
  assert.equal(ortho.metadata.source_place_raw, 'ARTHO OP');
  assert.equal(ortho.metadata.approved_display_normalisation, true);

  assert.ok(plan.locations.has('core block|3rd floor|a block'));
  assert.ok(plan.locations.has('core block|5th floor|f block'));
  assert.equal(plan.locations.get('core block|3rd floor|a block').verification_status, 'verified');

  assert.ok(plan.locations.has('millennium block|1st floor|aarogyasri office'));
  assert.ok(plan.locations.has('millennium block|3rd floor|aarogyasri office'));
});

test('official V2 apply readiness is locked to 237 approved places and three pending rows', () => {
  const plan = buildOfficialNimsV2Plan();
  const readiness = officialV2ApplyReadiness(plan);
  assert.equal(readiness.ready, true);
  assert.deepEqual(readiness.errors, []);
  assert.deepEqual(readiness.duplicates, []);
});
