import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import {
  applyNimsOcrCorrections,
  floorNumberFromName,
  normaliseNimsBlock,
  normaliseNimsKey,
  nimsAliasRowsForBlock,
} from '../services/nimsLocationNormalizer.js';
import {
  buildNimsImportPlan,
  summaryForPlan,
} from '../scripts/importNimsLocationMaster.js';

const migration = readFileSync(new URL('../../supabase/migrations_2_0/024_nims_location_foundation.sql', import.meta.url), 'utf8');
const service = readFileSync(new URL('../services/hospitalTicketService.js', import.meta.url), 'utf8');
const routes = readFileSync(new URL('../routes/hospitalTicketRoutes.js', import.meta.url), 'utf8');
const importer = readFileSync(new URL('../scripts/importNimsLocationMaster.js', import.meta.url), 'utf8');
const workbookPath = fileURLToPath(new URL('../../docs/nims/NIMS_Ticketing_Consolidated_Data.xlsx', import.meta.url));

test('NIMS alias normalisation is explicit and preserves ambiguity', () => {
  assert.equal(normaliseNimsBlock('MIL').value, 'Millennium');
  assert.equal(normaliseNimsBlock('Millinum').value, 'Millennium');
  assert.equal(normaliseNimsBlock('Specialty').value, 'Speciality');
  assert.equal(normaliseNimsBlock('SPL').value, 'Speciality');
  assert.deepEqual(nimsAliasRowsForBlock('Millennium Block'), ['Millennium', 'MIL', 'Millinum']);
  assert.deepEqual(nimsAliasRowsForBlock('Speciality Block'), ['Speciality', 'Specialty', 'SPL']);
  assert.equal(normaliseNimsBlock('Emergency & Physiotherapy Block').ambiguous, true);
  assert.equal(normaliseNimsBlock('Trauma Block').ambiguous, true);
  assert.notEqual(
    normaliseNimsBlock('Emergency & Physiotherapy Block').normalisedKey,
    normaliseNimsBlock('Trauma Block').normalisedKey,
  );
});

test('NIMS OCR correction rules are isolated and auditable', () => {
  assert.equal(applyNimsOcrCorrections('End Floorocrinology').value, 'Endocrinology');
  assert.equal(applyNimsOcrCorrections('Ultra Sound Floor').value, 'Ultrasound');
  assert.equal(applyNimsOcrCorrections('Registration and Floor Billing').value, 'Registration and Billing');
  assert.equal(applyNimsOcrCorrections('Registration and Floor Verification').value, 'Registration and Verification');
  assert.equal(applyNimsOcrCorrections('Chand Floorra').value, 'Chandra');
  assert.equal(applyNimsOcrCorrections('Sand Flooreep').value, 'Sandeep');
  assert.equal(normaliseNimsKey('Millennium / MIL'), 'millennium mil');
});

test('floor parser distinguishes known service floors from total building floors', () => {
  assert.equal(floorNumberFromName('Ground Floor'), 0);
  assert.equal(floorNumberFromName('First Floor'), 1);
  assert.equal(floorNumberFromName('3rd Floor'), 3);
  assert.match(migration, /is_known_service_floor boolean not null default true/);
  assert.match(migration, /is_confirmed_building_floor boolean not null default false/);
});

test('migration adds hierarchy tables and extends locations without breaking flattened rows', () => {
  for (const table of [
    'hospital_floors',
    'hospital_departments',
    'hospital_location_aliases',
    'hospital_location_import_batches',
    'hospital_location_import_rows',
  ]) {
    assert.match(migration, new RegExp(`create table if not exists public\\.${table}`));
    assert.match(migration, new RegExp(`alter table public\\.%I enable row level security`));
  }
  assert.match(migration, /add column if not exists floor_id uuid/);
  assert.match(migration, /add column if not exists department_id uuid/);
  assert.match(migration, /add column if not exists room_number text/);
  assert.match(migration, /add column if not exists ward_name text/);
  assert.match(migration, /check \(verification_status in \('draft', 'verified', 'rejected', 'inactive'\)\)/);
});

test('ticket snapshots are insert-time only so historical tickets remain immutable', () => {
  assert.match(migration, /before insert on public\.hospital_tickets/);
  assert.match(migration, /site_name_snapshot/);
  assert.match(migration, /block_name_snapshot/);
  assert.match(migration, /location_path_snapshot/);
  assert.doesNotMatch(migration, /update public\.hospital_tickets set/i);
  assert.doesNotMatch(migration, /create or replace function public\.rpc_create_hospital_ticket/);
});

test('RLS keeps new master writes service-role controlled and scoped for reads', () => {
  assert.match(migration, /revoke insert,update,delete on public\.%I from authenticated/);
  assert.match(migration, /grant all on public\.%I to service_role/);
  assert.match(migration, /hospital_floors_scoped_select/);
  assert.match(migration, /hospital_departments_scoped_select/);
  assert.match(migration, /hospital_location_aliases_scoped_select/);
  assert.match(migration, /hospital_can_access_scope\(client_id, block_id, null, 'view'\)/);
  assert.doesNotMatch(migration, /grant (insert|update|delete).*authenticated/i);
});

test('existing master endpoints remain compatible and new hierarchy endpoints are additive', () => {
  assert.match(routes, /router\.get\('\/blocks'/);
  assert.match(routes, /router\.get\('\/locations'/);
  assert.match(routes, /router\.get\('\/floors'/);
  assert.match(routes, /router\.get\('\/departments'/);
  assert.match(routes, /router\.get\('\/hierarchy'/);
  assert.match(service, /return \{ blocks, locations, categories: categoriesResult\.data \|\| \[\] \}/);
  assert.match(service, /cleanHospitalUuid/);
});

test('dry-run import parses NIMS workbook without DB credentials or writes', () => {
  const plan = buildNimsImportPlan(workbookPath, {});
  const summary = summaryForPlan(plan);
  assert.equal(summary.mode, 'dry-run');
  assert.ok(summary.staged.blocks > 0);
  assert.ok(summary.staged.floors > 0);
  assert.ok(summary.staged.departments > 0);
  assert.ok(summary.staged.locations > 0);
  assert.equal(summary.staged.aliases, 6);
  assert.ok(summary.duplicate > 0);
  assert.ok(summary.ambiguous > 0);
  assert.equal(plan.departments.size > 0, true);
  assert.equal([...plan.departments.values()].some((row) => row.floor_code === null), true);
});

test('importer reports duplicates, ambiguous rows, and protects verified records on apply path', () => {
  assert.match(importer, /status: 'duplicate'/);
  assert.match(importer, /status: 'ambiguous'/);
  assert.match(importer, /existing\.data\?\.verification_status === 'verified'/);
  assert.match(importer, /action: 'protected_verified'/);
  assert.match(importer, /Doctor\/HOD\/staff names are not imported as physical location identities/);
  assert.match(importer, /NODE_ENV/);
  assert.match(importer, /NIMS_LOCATION_IMPORT_PRODUCTION_CONFIRM/);
  assert.match(importer, /NIMS_LOCATION_IMPORT_CONFIRM_PROJECT_REF/);
  assert.match(importer, /NIMS_LOCATION_IMPORT_CONFIRM_CLIENT/);
  assert.match(importer, /hospital_location_import_rows/);
  assert.match(importer, /apply_stats/);
});
