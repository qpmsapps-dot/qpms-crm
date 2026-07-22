import { createClient } from '@supabase/supabase-js';
import xlsx from 'xlsx';
import dotenv from 'dotenv';
import { fileURLToPath } from 'node:url';

import {
  cleanNimsValue,
  floorNumberFromName,
  isLikelyPersonName,
  nimsAliasRowsForBlock,
  nimsCode,
  normaliseNimsBlock,
  normaliseNimsKey,
  normaliseNimsText,
  normaliseNimsVerificationStatus,
} from '../services/nimsLocationNormalizer.js';

dotenv.config({ path: './.env' });
dotenv.config({ path: './backend/.env' });

const DEFAULT_WORKBOOK = 'docs/nims/NIMS_Ticketing_Consolidated_Data.xlsx';
const DEFAULT_CLIENT_CODE = 'NIMS_HYDERABAD';
const DEFAULT_CLIENT_NAME = 'NIMS Hyderabad';

export function parseArgs(argv = process.argv.slice(2)) {
  const args = {
    workbook: DEFAULT_WORKBOOK,
    clientCode: DEFAULT_CLIENT_CODE,
    clientName: DEFAULT_CLIENT_NAME,
    dryRun: true,
    apply: false,
    sheets: [],
    confirmProjectRef: '',
    confirmClient: '',
  };
  for (let index = 0; index < argv.length; index += 1) {
    const value = argv[index];
    if (value === '--dry-run') args.dryRun = true;
    else if (value === '--apply') {
      args.apply = true;
      args.dryRun = false;
    } else if (value === '--workbook') args.workbook = argv[++index];
    else if (value === '--client-code') args.clientCode = argv[++index];
    else if (value === '--client-name') args.clientName = argv[++index];
    else if (value === '--sheet') args.sheets.push(argv[++index]);
    else if (value === '--confirm-project-ref') args.confirmProjectRef = argv[++index];
    else if (value === '--confirm-client') args.confirmClient = argv[++index];
  }
  return args;
}

export function buildNimsImportPlan(workbookPath, options = {}) {
  const workbook = xlsx.readFile(workbookPath);
  const selectedSheets = new Set(options.sheets?.length ? options.sheets : [
    'Location Master',
    'Known Floors',
    'Deployment Departments',
  ]);
  const plan = emptyPlan({
    workbookPath,
    clientCode: options.clientCode || DEFAULT_CLIENT_CODE,
    clientName: options.clientName || DEFAULT_CLIENT_NAME,
    selectedSheets: [...selectedSheets],
    confirmProjectRef: options.confirmProjectRef || '',
    confirmClient: options.confirmClient || '',
  });

  if (selectedSheets.has('Location Master')) {
    parseLocationMaster(workbook, plan);
  }
  if (selectedSheets.has('Known Floors')) {
    parseKnownFloors(workbook, plan);
  }
  if (selectedSheets.has('Deployment Departments')) {
    parseDeploymentDepartments(workbook, plan);
  }
  addStandardAliases(plan);
  return finalizePlan(plan);
}

function emptyPlan(metadata) {
  return {
    metadata,
    client: {
      client_code: metadata.clientCode,
      client_name: metadata.clientName,
      business_type: 'hospital',
      is_active: true,
      metadata: { source: 'NIMS_Ticketing_Consolidated_Data.xlsx', draft_import: true },
    },
    blocks: new Map(),
    floors: new Map(),
    departments: new Map(),
    locations: new Map(),
    aliases: new Map(),
    rows: [],
    ambiguous: [],
    validationErrors: [],
    stats: {
      inserted: 0,
      updated: 0,
      skipped: 0,
      duplicate: 0,
      ambiguous: 0,
      rejected: 0,
    },
  };
}

function parseLocationMaster(workbook, plan) {
  for (const row of sheetObjects(workbook, 'Location Master')) {
    const source = sourceInfo('Location Master', row.__rowNum);
    const draftLocationId = text(row['Draft Location ID']);
    const site = text(row.Site) || plan.metadata.clientName;
    const block = normaliseNimsBlock(row.Block);
    const floor = normaliseNimsText(row.Floor);
    const department = normaliseNimsText(row['Department / Area']);
    const room = normaliseNimsText(row['Room / Cabin']);
    const precision = text(row['Location Precision']);
    const status = normaliseNimsVerificationStatus(row['Verification Status']);
    const sourceType = text(row['Source Type']);
    const sourceReference = text(row['Source Reference']);
    const serviceSession = text(row['Service Session']);

    if (!block.value) {
      reject(plan, source, 'Missing block.', row);
      continue;
    }
    if (block.ambiguous) {
      ambiguous(plan, source, block.ambiguousReason, { block: block.original, draftLocationId });
      continue;
    }
    if (!floor.value && !department.value && !room.value) {
      reject(plan, source, 'Location row has no floor, department or room/area identity.', row);
      continue;
    }
    if (isLikelyPersonName(department.value) || isLikelyPersonName(room.value)) {
      reject(plan, source, 'Doctor/HOD/staff names are not imported as physical location identities.', row);
      continue;
    }

    const blockRecord = addBlock(plan, block, source, status);
    const floorRecord = floor.value
      ? addFloor(plan, blockRecord, floor, source, status, {
        isKnownServiceFloor: true,
        isConfirmedBuildingFloor: false,
      })
      : null;
    const departmentRecord = department.value
      ? addDepartment(plan, blockRecord, floorRecord, department, source, status, 'clinical_or_service')
      : null;
    const locationName = room.value || department.value || floor.value;
    const locationKey = draftLocationId || nimsCode('NIMS_LOC', block.value, floor.value, department.value, room.value || locationName);
    addLocation(plan, {
      locationCode: nimsCode('NIMS_LOC', locationKey),
      blockRecord,
      floorRecord,
      departmentRecord,
      floorName: floor.value || 'Unconfirmed Floor',
      departmentName: department.value || null,
      locationName,
      roomNumber: precision.toLowerCase() === 'room' ? room.value : null,
      areaName: precision.toLowerCase() !== 'room' ? room.value || department.value : null,
      locationType: precision || null,
      source: sourceType || 'NIMS workbook',
      sourceReference,
      verificationStatus: status,
      metadata: {
        draft_location_id: draftLocationId,
        site_source_value: site,
        service_session: serviceSession,
        exact_landmark_required: text(row['Exact Landmark Required']),
        notes: text(row.Notes),
        source_row: source.row,
        source_sheet: source.sheet,
        normalisation: normalisationMetadata([block, floor, department, room]),
      },
    }, source);
  }
}

function parseKnownFloors(workbook, plan) {
  for (const row of sheetObjects(workbook, 'Known Floors')) {
    const source = sourceInfo('Known Floors', row.__rowNum);
    const block = normaliseNimsBlock(row.Block);
    if (!block.value) {
      reject(plan, source, 'Known floor row is missing block.', row);
      continue;
    }
    if (block.ambiguous) {
      ambiguous(plan, source, block.ambiguousReason, { block: block.original });
      continue;
    }
    const blockRecord = addBlock(plan, block, source, normaliseNimsVerificationStatus(row['Verification Status']));
    const floors = text(row['Floors Mentioned']).split(';').map((item) => item.trim()).filter(Boolean);
    if (!floors.length) {
      reject(plan, source, 'Known floor row has no floors mentioned.', row);
      continue;
    }
    for (const floorValue of floors) {
      addFloor(plan, blockRecord, normaliseNimsText(floorValue), source, normaliseNimsVerificationStatus(row['Verification Status']), {
        isKnownServiceFloor: true,
        isConfirmedBuildingFloor: false,
        limitation: text(row.Limitation),
      });
    }
  }
}

function parseDeploymentDepartments(workbook, plan) {
  for (const row of sheetObjects(workbook, 'Deployment Departments')) {
    const source = sourceInfo('Deployment Departments', row.__rowNum);
    const block = normaliseNimsBlock(row.Block);
    const department = normaliseNimsText(row.Department);
    if (!block.value || !department.value) {
      reject(plan, source, 'Deployment department row requires block and department.', row);
      continue;
    }
    if (block.ambiguous) {
      ambiguous(plan, source, block.ambiguousReason, { block: block.original, department: department.original });
      continue;
    }
    if (isLikelyPersonName(department.value)) {
      reject(plan, source, 'Staff names are not imported as deployment departments.', row);
      continue;
    }
    const blockRecord = addBlock(plan, block, source, normaliseNimsVerificationStatus(row['Verification Status']));
    addDepartment(plan, blockRecord, null, department, source, normaliseNimsVerificationStatus(row['Verification Status']), 'deployment', {
      source_serial_number: text(row['Source S.No.']),
      posts: text(row['No. of Posts']),
    });
  }
}

function addBlock(plan, block, source, verificationStatus) {
  const blockCode = nimsCode('NIMS_BLOCK', block.value);
  const key = blockCode;
  const record = {
    block_code: blockCode,
    block_name: block.value,
    source: 'NIMS workbook',
    source_reference: `${source.sheet} row ${source.row}`,
    verification_status: verificationStatus,
    metadata: {
      source_value: block.original,
      normalisation: normalisationMetadata([block]),
    },
  };
  return putUnique(plan, plan.blocks, key, record, source, 'block');
}

function addFloor(plan, blockRecord, floor, source, verificationStatus, options = {}) {
  const floorCode = nimsCode('NIMS_FLOOR', blockRecord.block_code, floor.value);
  const record = {
    block_code: blockRecord.block_code,
    floor_code: floorCode,
    floor_name: floor.value,
    floor_number: floorNumberFromName(floor.value),
    sort_order: floorNumberFromName(floor.value) ?? 999,
    is_known_service_floor: options.isKnownServiceFloor !== false,
    is_confirmed_building_floor: options.isConfirmedBuildingFloor === true,
    source: 'NIMS workbook',
    source_reference: `${source.sheet} row ${source.row}`,
    verification_status: verificationStatus,
    metadata: {
      limitation: options.limitation || '',
      source_value: floor.original,
      normalisation: normalisationMetadata([floor]),
    },
  };
  return putUnique(plan, plan.floors, floorCode, record, source, 'floor');
}

function addDepartment(plan, blockRecord, floorRecord, department, source, verificationStatus, departmentType, extra = {}) {
  const departmentCode = nimsCode('NIMS_DEPT', blockRecord.block_code, floorRecord?.floor_code || 'NO_FLOOR', department.value);
  const record = {
    block_code: blockRecord.block_code,
    floor_code: floorRecord?.floor_code || null,
    department_code: departmentCode,
    department_name: department.value,
    department_type: departmentType,
    source: 'NIMS workbook',
    source_reference: `${source.sheet} row ${source.row}`,
    verification_status: verificationStatus,
    metadata: {
      ...extra,
      source_value: department.original,
      floor_unconfirmed: !floorRecord,
      normalisation: normalisationMetadata([department]),
    },
  };
  return putUnique(plan, plan.departments, departmentCode, record, source, 'department');
}

function addLocation(plan, record, source) {
  return putUnique(plan, plan.locations, record.locationCode, {
    block_code: record.blockRecord.block_code,
    floor_code: record.floorRecord?.floor_code || null,
    department_code: record.departmentRecord?.department_code || null,
    location_code: record.locationCode,
    floor_name: record.floorName,
    department_name: record.departmentName,
    location_name: record.locationName,
    room_number: record.roomNumber,
    area_name: record.areaName,
    ward_name: null,
    location_type: record.locationType,
    source: record.source,
    source_reference: record.sourceReference || `${source.sheet} row ${source.row}`,
    verification_status: record.verificationStatus,
    metadata: record.metadata,
  }, source, 'location');
}

function addStandardAliases(plan) {
  for (const block of plan.blocks.values()) {
    for (const alias of nimsAliasRowsForBlock(block.block_name)) {
      const key = `${block.block_code}:${normaliseNimsKey(alias)}`;
      putUnique(plan, plan.aliases, key, {
        entity_type: 'block',
        entity_code: block.block_code,
        alias_value: alias,
        normalised_alias: normaliseNimsKey(alias),
        source: 'NIMS normalisation rules',
      }, { sheet: 'normalisation', row: 0 }, 'alias');
    }
  }
}

function putUnique(plan, map, key, record, source, entityType) {
  if (map.has(key)) {
    plan.stats.duplicate += 1;
    plan.rows.push({ status: 'duplicate', entityType, source, key, message: `${entityType} duplicate reported; existing staged record retained.` });
    return map.get(key);
  }
  map.set(key, record);
  plan.rows.push({ status: 'inserted', entityType, source, key, message: `${entityType} staged for insert/update.` });
  return record;
}

function reject(plan, source, message, payload) {
  plan.stats.rejected += 1;
  plan.validationErrors.push({ source, message, payload });
  plan.rows.push({ status: 'rejected', entityType: null, source, key: '', message });
}

function ambiguous(plan, source, message, payload) {
  plan.stats.ambiguous += 1;
  plan.ambiguous.push({ source, message, payload });
  plan.rows.push({ status: 'ambiguous', entityType: null, source, key: '', message });
}

function finalizePlan(plan) {
  plan.stats.inserted = plan.blocks.size + plan.floors.size + plan.departments.size + plan.locations.size + plan.aliases.size + 1;
  return plan;
}

function sheetObjects(workbook, sheetName) {
  const sheet = workbook.Sheets[sheetName];
  if (!sheet) return [];
  const rows = xlsx.utils.sheet_to_json(sheet, { header: 1, defval: '' });
  const headerIndex = rows.findIndex((row) => row.some((cell) => /^block$/i.test(cleanNimsValue(cell))) || row.includes('Draft Location ID'));
  if (headerIndex < 0) return [];
  const headers = rows[headerIndex].map((header) => cleanNimsValue(header));
  return rows.slice(headerIndex + 1).map((row, index) => {
    const object = { __rowNum: headerIndex + index + 2 };
    headers.forEach((header, columnIndex) => {
      if (header) object[header] = row[columnIndex];
    });
    return object;
  }).filter((row) => Object.entries(row).some(([key, value]) => key !== '__rowNum' && cleanNimsValue(value)));
}

function sourceInfo(sheet, row) {
  return { sheet, row };
}

function text(value) {
  return cleanNimsValue(value);
}

function normalisationMetadata(items) {
  return items
    .filter(Boolean)
    .flatMap((item) => [
      ...(item.corrections || []),
      ...(item.aliasApplied ? [item.aliasApplied] : []),
    ]);
}

export function summaryForPlan(plan) {
  return {
    mode: 'dry-run',
    source: plan.metadata.workbookPath,
    client: plan.client.client_code,
    selected_sheets: plan.metadata.selectedSheets,
    inserted: plan.stats.inserted,
    updated: plan.stats.updated,
    skipped: plan.stats.skipped,
    duplicate: plan.stats.duplicate,
    ambiguous: plan.stats.ambiguous,
    rejected: plan.stats.rejected,
    validation_errors: plan.validationErrors.length,
    staged: {
      clients: 1,
      blocks: plan.blocks.size,
      floors: plan.floors.size,
      departments: plan.departments.size,
      locations: plan.locations.size,
      aliases: plan.aliases.size,
    },
    ambiguous_records: plan.ambiguous.slice(0, 50),
    validation_error_samples: plan.validationErrors.slice(0, 50),
  };
}

async function applyPlan(plan, environment = process.env) {
  const production = String(environment.NODE_ENV || '').trim().toLowerCase() === 'production';
  if (production && environment.NIMS_LOCATION_IMPORT_PRODUCTION_CONFIRM !== 'I_UNDERSTAND_THIS_IMPORTS_DRAFT_NIMS_LOCATION_DATA') {
    throw new Error('Refusing production import without NIMS_LOCATION_IMPORT_PRODUCTION_CONFIRM.');
  }
  const url = String(environment.SUPABASE_URL || '').trim();
  const serviceKey = String(environment.SUPABASE_SERVICE_ROLE_KEY || '').trim();
  if (!url || !serviceKey) throw new Error('SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required for --apply.');
  const projectRef = supabaseProjectRef(url);
  const confirmedProjectRef = String(environment.NIMS_LOCATION_IMPORT_CONFIRM_PROJECT_REF || plan.metadata.confirmProjectRef || '').trim();
  const confirmedClient = String(environment.NIMS_LOCATION_IMPORT_CONFIRM_CLIENT || plan.metadata.confirmClient || '').trim();
  if (!projectRef || confirmedProjectRef !== projectRef) {
    throw new Error('Refusing import: confirmed project reference does not match SUPABASE_URL.');
  }
  if (confirmedClient !== plan.client.client_code) {
    throw new Error('Refusing import: confirmed NIMS client code does not match import plan.');
  }
  const client = createClient(url, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });
  const applyStats = emptyApplyStats();
  const targetIds = new Map();
  const targetActions = new Map();

  const clientResult = await upsertClient(client, plan.client);
  const clientRow = clientResult.data;
  countApply(applyStats, 'clients', clientResult.action);
  targetIds.set(`client:${plan.client.client_code}`, clientRow.id);
  targetActions.set(`client:${plan.client.client_code}`, clientResult.action);
  const batch = await client.from('hospital_location_import_batches').insert({
    client_id: clientRow.id,
    source_filename: plan.metadata.workbookPath,
    source_sheet: plan.metadata.selectedSheets.join(', '),
    dry_run: false,
    metadata: { client_code: plan.client.client_code },
  }).select('*').single();
  if (batch.error) throw batch.error;

  const blockIds = new Map();
  for (const block of plan.blocks.values()) {
    const result = await upsertDraft(client, 'hospital_blocks', 'client_id,block_code', {
      client_id: clientRow.id,
      block_code: block.block_code,
      block_name: block.block_name,
      source: block.source,
      source_reference: block.source_reference,
      verification_status: block.verification_status,
      is_active: true,
      metadata: block.metadata,
    });
    blockIds.set(block.block_code, result.id);
    targetIds.set(`block:${block.block_code}`, result.id);
    targetActions.set(`block:${block.block_code}`, result.action);
    countApply(applyStats, 'blocks', result.action);
  }

  const floorIds = new Map();
  for (const floor of plan.floors.values()) {
    const result = await upsertDraft(client, 'hospital_floors', 'client_id,floor_code', {
      client_id: clientRow.id,
      block_id: blockIds.get(floor.block_code),
      floor_code: floor.floor_code,
      floor_name: floor.floor_name,
      floor_number: floor.floor_number,
      sort_order: floor.sort_order,
      is_known_service_floor: floor.is_known_service_floor,
      is_confirmed_building_floor: floor.is_confirmed_building_floor,
      source: floor.source,
      source_reference: floor.source_reference,
      verification_status: floor.verification_status,
      is_active: true,
      metadata: floor.metadata,
    });
    floorIds.set(floor.floor_code, result.id);
    targetIds.set(`floor:${floor.floor_code}`, result.id);
    targetActions.set(`floor:${floor.floor_code}`, result.action);
    countApply(applyStats, 'floors', result.action);
  }

  const departmentIds = new Map();
  for (const department of plan.departments.values()) {
    const result = await upsertDraft(client, 'hospital_departments', 'client_id,department_code', {
      client_id: clientRow.id,
      block_id: blockIds.get(department.block_code),
      floor_id: department.floor_code ? floorIds.get(department.floor_code) : null,
      department_code: department.department_code,
      department_name: department.department_name,
      department_type: department.department_type,
      source: department.source,
      source_reference: department.source_reference,
      verification_status: department.verification_status,
      is_active: true,
      metadata: department.metadata,
    });
    departmentIds.set(department.department_code, result.id);
    targetIds.set(`department:${department.department_code}`, result.id);
    targetActions.set(`department:${department.department_code}`, result.action);
    countApply(applyStats, 'departments', result.action);
  }

  const locationIds = new Map();
  for (const location of plan.locations.values()) {
    const result = await upsertDraft(client, 'hospital_locations', 'client_id,location_code', {
      client_id: clientRow.id,
      block_id: blockIds.get(location.block_code),
      floor_id: location.floor_code ? floorIds.get(location.floor_code) : null,
      department_id: location.department_code ? departmentIds.get(location.department_code) : null,
      location_code: location.location_code,
      floor_name: location.floor_name,
      department_name: location.department_name,
      location_name: location.location_name,
      room_number: location.room_number,
      area_name: location.area_name,
      ward_name: location.ward_name,
      location_type: location.location_type,
      source: location.source,
      source_reference: location.source_reference,
      verification_status: location.verification_status,
      is_active: true,
      metadata: location.metadata,
    });
    locationIds.set(location.location_code, result.id);
    targetIds.set(`location:${location.location_code}`, result.id);
    targetActions.set(`location:${location.location_code}`, result.action);
    countApply(applyStats, 'locations', result.action);
  }

  for (const alias of plan.aliases.values()) {
    const entityId = alias.entity_type === 'block'
      ? blockIds.get(alias.entity_code)
      : alias.entity_type === 'floor'
        ? floorIds.get(alias.entity_code)
        : alias.entity_type === 'department'
          ? departmentIds.get(alias.entity_code)
          : locationIds.get(alias.entity_code);
    if (!entityId) continue;
    const result = await upsertAlias(client, clientRow.id, { ...alias, entity_id: entityId });
    targetIds.set(`alias:${alias.entity_code}:${alias.normalised_alias}`, result.id);
    targetActions.set(`alias:${alias.entity_code}:${alias.normalised_alias}`, result.action);
    countApply(applyStats, 'aliases', result.action);
  }

  await writeImportRows(client, batch.data.id, plan.rows, targetIds, targetActions);

  const completed = await client.from('hospital_location_import_batches').update({
    completed_at: new Date().toISOString(),
    inserted_count: totalAction(applyStats, 'inserted'),
    updated_count: totalAction(applyStats, 'updated'),
    skipped_count: totalAction(applyStats, 'reused') + totalAction(applyStats, 'protected_verified'),
    duplicate_count: plan.stats.duplicate,
    ambiguous_count: plan.stats.ambiguous,
    rejected_count: plan.stats.rejected,
    error_summary: plan.validationErrors.slice(0, 200),
  }).eq('id', batch.data.id);
  if (completed.error) throw completed.error;
  return { ...summaryForPlan(plan), mode: 'apply', import_batch_id: batch.data.id, apply_stats: applyStats };
}

async function upsertClient(client, payload) {
  const existing = await client.from('hospital_clients').select('*').eq('client_code', payload.client_code).maybeSingle();
  if (existing.error) throw existing.error;
  if (existing.data) return { data: existing.data, action: 'reused' };
  const result = await client.from('hospital_clients').insert(payload).select('*').single();
  if (result.error) throw result.error;
  return { data: result.data, action: 'inserted' };
}

async function upsertDraft(client, table, onConflict, payload) {
  const codeColumn = onConflict.split(',').pop();
  const existing = await client.from(table).select('id,verification_status')
    .eq('client_id', payload.client_id)
    .eq(codeColumn, payload[codeColumn])
    .maybeSingle();
  if (existing.error) throw existing.error;
  if (existing.data?.verification_status === 'verified' && payload.verification_status !== 'verified') {
    return { id: existing.data.id, action: 'protected_verified' };
  }
  if (existing.data) {
    return { id: existing.data.id, action: 'reused' };
  }
  const result = await client.from(table).insert(payload).select('id').single();
  if (result.error) throw result.error;
  return { id: result.data.id, action: 'inserted' };
}

async function upsertAlias(client, clientId, alias) {
  const existing = await client.from('hospital_location_aliases').select('id')
    .eq('client_id', clientId)
    .eq('entity_type', alias.entity_type)
    .eq('normalised_alias', alias.normalised_alias)
    .eq('is_active', true)
    .maybeSingle();
  if (existing.error) throw existing.error;
  if (existing.data) return { id: existing.data.id, action: 'reused' };
  const payload = {
    client_id: clientId,
    entity_type: alias.entity_type,
    entity_id: alias.entity_id,
    alias_value: alias.alias_value,
    normalised_alias: alias.normalised_alias,
    source: alias.source,
    is_active: true,
  };
  const result = await client.from('hospital_location_aliases').insert(payload).select('id').single();
  if (result.error) throw result.error;
  return { id: result.data.id, action: 'inserted' };
}

function supabaseProjectRef(url) {
  try {
    const host = new URL(url).host;
    return host.endsWith('.supabase.co') ? host.split('.')[0] : '';
  } catch {
    return '';
  }
}

function emptyApplyStats() {
  const bucket = () => ({ inserted: 0, updated: 0, reused: 0, protected_verified: 0 });
  return {
    clients: bucket(),
    blocks: bucket(),
    floors: bucket(),
    departments: bucket(),
    locations: bucket(),
    aliases: bucket(),
  };
}

function countApply(stats, entity, action) {
  if (stats[entity] && Object.hasOwn(stats[entity], action)) stats[entity][action] += 1;
}

function totalAction(stats, action) {
  return Object.values(stats).reduce((sum, row) => sum + (row[action] || 0), 0);
}

async function writeImportRows(client, batchId, rows, targetIds, targetActions) {
  const payload = rows.map((row) => {
    const targetKey = row.entityType ? `${row.entityType}:${row.key}` : '';
    const targetId = targetIds.get(targetKey) || null;
    const action = targetActions.get(targetKey) || '';
    const status = row.status === 'inserted' && targetId && action === 'inserted'
      ? 'inserted'
      : ['duplicate', 'ambiguous', 'rejected'].includes(row.status)
        ? row.status
        : 'skipped';
    return {
      import_batch_id: batchId,
      source_sheet: row.source.sheet,
      source_row: row.source.row,
      row_status: status,
      target_entity_type: row.entityType,
      target_entity_id: targetId,
      message: row.message,
      payload: {
        key: row.key,
        entity_type: row.entityType,
        action,
      },
    };
  });
  for (let index = 0; index < payload.length; index += 500) {
    const result = await client.from('hospital_location_import_rows').insert(payload.slice(index, index + 500));
    if (result.error) throw result.error;
  }
}

async function main() {
  const args = parseArgs();
  const plan = buildNimsImportPlan(args.workbook, args);
  const summary = args.apply ? await applyPlan(plan) : summaryForPlan(plan);
  console.log(JSON.stringify(summary, null, 2));
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main().catch((error) => {
    console.error(JSON.stringify({ ok: false, message: error.message }, null, 2));
    process.exit(1);
  });
}
