import { createClient } from '@supabase/supabase-js';
import xlsx from 'xlsx';
import dotenv from 'dotenv';
import { existsSync } from 'node:fs';
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
const OFFICIAL_V2_WORKBOOK = 'docs/nims/NIMS_Hospital_Ticketing_Location_Map.xlsx';
const DEFAULT_CLIENT_CODE = 'NIMS_HYDERABAD';
const DEFAULT_CLIENT_NAME = 'NIMS Hyderabad';
const OFFICIAL_V2_BLOCKS = new Map([
  ['admin block', 'Admin Block'],
  ['core block', 'Core Block'],
  ['emergency block', 'Emergency Block'],
  ['millennium block', 'Millennium Block'],
  ['radiation block', 'Radiation Block'],
  ['speciality block', 'Speciality Block'],
]);
const OFFICIAL_V2_PLACE_NORMALISATIONS = new Map([
  ['artho op', 'Ortho OP'],
  ['gynic op', 'Gynaecology OP'],
  ['indocronalogy', 'Endocrinology'],
  ['hemotology', 'Hematology'],
  ['general madicine', 'General Medicine'],
  ['asistent ms office', 'Assistant MS Office'],
  ['arogya sri', 'Aarogyasri'],
  ['rehmotology op', 'Rheumatology OP'],
  ['2d echo', '2D Echo'],
  ['arogyasre office', 'Aarogyasri Office'],
  ['rehmotology ward', 'Rheumatology Ward'],
  ['rehmotology department', 'Rheumatology Department'],
  ['steam cell icu', 'Stem Cell ICU'],
  ['trama ot', 'Trauma OT'],
  ['traiage rooms', 'Triage Rooms'],
]);
const OFFICIAL_V2_APPROVED_REVIEW_PATHS = new Set([
  'core block|3rd floor|a block',
  'core block|3rd floor|b block',
  'core block|4th floor|c block',
  'core block|4th floor|d block',
  'core block|5th floor|e block',
  'core block|5th floor|f block',
]);
const OFFICIAL_V2_PENDING_CONFIRMATION_PATHS = new Set([
  'admin block|1st floor|explanation project cell',
  'admin block|2nd floor|src ethick department',
  'radiation block|1st floor|neclev medical',
]);

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
    officialV2: false,
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
    else if (value === '--official-v2' || value === '--v2-official') {
      args.officialV2 = true;
      if (args.workbook === DEFAULT_WORKBOOK) args.workbook = OFFICIAL_V2_WORKBOOK;
    }
  }
  return args;
}

export function buildOfficialNimsV2Plan(workbookPath = OFFICIAL_V2_WORKBOOK, options = {}) {
  const resolvedWorkbookPath = resolveWorkbookPath(workbookPath);
  const workbook = xlsx.readFile(resolvedWorkbookPath);
  const sheetNames = workbook.SheetNames;
  const sheetName = identifyOfficialV2Sheet(workbook);
  if (!sheetName) {
    throw new Error('Official V2 workbook does not contain Block, Floor and Place/Location columns.');
  }
  const sourceRows = officialV2Rows(workbook, sheetName);
  const plan = {
    metadata: {
      mode: 'official-v2-dry-run',
      workbookPath,
      resolvedWorkbookPath,
      sheetNames,
      hierarchySheet: sheetName,
      clientCode: options.clientCode || DEFAULT_CLIENT_CODE,
      clientName: options.clientName || DEFAULT_CLIENT_NAME,
    },
    blocks: new Map(),
    floors: new Map(),
    departments: new Map(),
    locations: new Map(),
    rows: [],
    review: [],
    validationErrors: [],
  };
  for (const row of sourceRows) {
    const block = officialBlockName(row.block);
    const floor = normaliseNimsText(row.floor).value;
    const rawPlace = normaliseNimsText(row.place).value;
    const placeNormalisation = officialV2PlaceNormalisation(rawPlace);
    const place = placeNormalisation.value;
    const source = sourceInfo(sheetName, row.__rowNum);
    if (!block || !floor || !place) {
      plan.validationErrors.push({ source, message: 'Official V2 row requires block, floor and place.', row });
      continue;
    }
    const reviewRequired = officialV2ReviewRequired({
      block,
      floor,
      rawPlace,
      canonicalPlace: place,
      requiresConfirmation: row.requiresConfirmation,
      reviewNote: row.reviewNote,
    });
    if (reviewRequired) {
      plan.review.push({
        source,
        block,
        floor,
        place,
        reason: text(row.reviewNote) || 'Workbook marked requires_confirmation.',
      });
    }
    const blockCode = nimsCode('NIMS_BLOCK', block);
    const floorCode = nimsCode('NIMS_FLOOR', block, floor);
    const departmentCode = nimsCode('NIMS_DEPT', block, floor, place);
    const locationCode = nimsCode('NIMS_LOC', block, floor, place);
    plan.blocks.set(normaliseNimsKey(block), {
      block_code: blockCode,
      block_name: block,
      source: 'NIMS official V2 workbook',
      source_reference: `${source.sheet} row ${source.row}`,
      verification_status: reviewRequired ? 'draft' : 'verified',
      metadata: { official_v2: true, source_value: row.block },
    });
    plan.floors.set(`${normaliseNimsKey(block)}|${normaliseNimsKey(floor)}`, {
      block_code: blockCode,
      floor_code: floorCode,
      floor_name: floor,
      floor_number: floorNumberFromName(floor),
      sort_order: floorNumberFromName(floor) ?? Number(row.sortOrder || 999),
      is_known_service_floor: true,
      is_confirmed_building_floor: true,
      source: 'NIMS official V2 workbook',
      source_reference: `${source.sheet} row ${source.row}`,
      verification_status: reviewRequired ? 'draft' : 'verified',
      metadata: { official_v2: true, source_value: row.floor },
    });
    plan.departments.set(`${normaliseNimsKey(block)}|${normaliseNimsKey(floor)}|${normaliseNimsKey(place)}`, {
      block_code: blockCode,
      floor_code: floorCode,
      department_code: departmentCode,
      department_name: place,
      department_type: 'official_place',
      source: 'NIMS official V2 workbook',
      source_reference: `${source.sheet} row ${source.row}`,
      verification_status: reviewRequired ? 'draft' : 'verified',
      metadata: {
        official_v2: true,
        compatibility_mapping: 'place_as_department_and_location',
        source_place_raw: rawPlace,
        approved_display_normalisation: placeNormalisation.changed,
      },
    });
    plan.locations.set(`${normaliseNimsKey(block)}|${normaliseNimsKey(floor)}|${normaliseNimsKey(place)}`, {
      block_code: blockCode,
      floor_code: floorCode,
      department_code: departmentCode,
      location_code: locationCode,
      floor_name: floor,
      department_name: place,
      location_name: place,
      room_number: null,
      area_name: place,
      ward_name: null,
      location_type: text(row.locationType) || 'Official Place',
      source: 'NIMS official V2 workbook',
      source_reference: `${source.sheet} row ${source.row}`,
      verification_status: reviewRequired ? 'draft' : 'verified',
      metadata: {
        official_v2: true,
        source_page: text(row.sourcePage),
        source_location_id: text(row.locationId),
        source_place_raw: rawPlace,
        approved_display_normalisation: placeNormalisation.changed,
        compatibility_mapping: 'place_as_department_and_location',
      },
    });
    plan.rows.push({ source, block, floor, place, reviewRequired });
  }
  return plan;
}

export function buildNimsImportPlan(workbookPath, options = {}) {
  const workbook = xlsx.readFile(resolveWorkbookPath(workbookPath));
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

function identifyOfficialV2Sheet(workbook) {
  for (const sheetName of ['Import Template', 'Location Master', ...workbook.SheetNames]) {
    if (!workbook.Sheets[sheetName]) continue;
    const rows = xlsx.utils.sheet_to_json(workbook.Sheets[sheetName], { header: 1, defval: '' });
    const header = rows.find((row) => {
      const keys = row.map((cell) => normaliseNimsKey(cell));
      return keys.includes('block name') || keys.includes('proposed block')
        ? keys.includes('floor name') || keys.includes('floor')
          ? keys.includes('location name') || keys.includes('source location name')
          : false
        : false;
    });
    if (header) return sheetName;
  }
  return '';
}

function officialV2Rows(workbook, sheetName) {
  const sheet = workbook.Sheets[sheetName];
  const rows = xlsx.utils.sheet_to_json(sheet, { header: 1, defval: '' });
  const headerIndex = rows.findIndex((row) => {
    const keys = row.map((cell) => normaliseNimsKey(cell));
    return (keys.includes('block name') || keys.includes('proposed block'))
      && (keys.includes('floor name') || keys.includes('floor'))
      && (keys.includes('location name') || keys.includes('source location name'));
  });
  if (headerIndex < 0) return [];
  const headers = rows[headerIndex].map((header) => normaliseNimsKey(header));
  const pick = (object, names) => {
    for (const name of names) {
      if (Object.hasOwn(object, name)) return object[name];
    }
    return '';
  };
  return rows.slice(headerIndex + 1).map((row, index) => {
    const object = { __rowNum: headerIndex + index + 2 };
    headers.forEach((header, columnIndex) => {
      if (header) object[header] = row[columnIndex];
    });
    return {
      __rowNum: object.__rowNum,
      block: pick(object, ['block name', 'proposed block']),
      floor: pick(object, ['floor name', 'floor']),
      place: pick(object, ['location name', 'source location name', 'place', 'department location']),
      locationType: pick(object, ['location type']),
      sortOrder: pick(object, ['sort order', 'floor order']),
      requiresConfirmation: pick(object, ['requires confirmation']),
      reviewNote: pick(object, ['review note', 'notes']),
      sourcePage: pick(object, ['source page']),
      locationId: pick(object, ['location id']),
    };
  }).filter((row) => text(row.block) || text(row.floor) || text(row.place));
}

function officialBlockName(value) {
  const key = normaliseNimsKey(value);
  return OFFICIAL_V2_BLOCKS.get(key) || '';
}

function officialV2PlaceNormalisation(value) {
  const raw = normaliseNimsText(value).value;
  const canonical = OFFICIAL_V2_PLACE_NORMALISATIONS.get(normaliseNimsKey(raw));
  return {
    value: canonical || raw,
    changed: Boolean(canonical && canonical !== raw),
    raw,
  };
}

function officialV2ReviewRequired({
  block,
  floor,
  rawPlace,
  canonicalPlace,
  requiresConfirmation,
  reviewNote,
}) {
  const explicitReview = /^yes|true|1$/i.test(text(requiresConfirmation)) || text(reviewNote);
  if (!explicitReview) return false;
  const rawPath = `${normaliseNimsKey(block)}|${normaliseNimsKey(floor)}|${normaliseNimsKey(rawPlace)}`;
  const canonicalPath = `${normaliseNimsKey(block)}|${normaliseNimsKey(floor)}|${normaliseNimsKey(canonicalPlace)}`;
  return !OFFICIAL_V2_APPROVED_REVIEW_PATHS.has(rawPath)
    && !OFFICIAL_V2_PLACE_NORMALISATIONS.has(normaliseNimsKey(rawPlace))
    && !OFFICIAL_V2_APPROVED_REVIEW_PATHS.has(canonicalPath);
}

function resolveWorkbookPath(workbookPath) {
  if (existsSync(workbookPath)) return workbookPath;
  const repoRelative = new URL(`../../${workbookPath.replace(/\\/g, '/')}`, import.meta.url);
  const resolved = fileURLToPath(repoRelative);
  if (existsSync(resolved)) return resolved;
  return workbookPath;
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

export async function summaryForOfficialV2Plan(plan, environment = process.env) {
  const runtime = await loadOfficialV2RuntimeState(plan, environment);
  const classification = classifyOfficialV2Plan(plan, runtime);
  return {
    mode: 'official-v2-dry-run',
    source: plan.metadata.workbookPath,
    valid_xlsx: true,
    sheet_names: plan.metadata.sheetNames,
    hierarchy_sheet: plan.metadata.hierarchySheet,
    client: plan.metadata.clientCode,
    official_block_count: plan.blocks.size,
    official_floor_count: plan.floors.size,
    official_place_count: plan.locations.size,
    official_blocks: [...new Set([...plan.blocks.values()].map((row) => row.block_name))].sort(),
    official_floors: [...new Set([...plan.floors.values()].map((row) => `${row.block_code}:${row.floor_name}`))].length,
    official_places: plan.locations.size,
    reuse_count: classification.reuse.length,
    create_count: classification.create.length,
    review_count: classification.review.length,
    legacy_count: classification.legacy.length,
    protected_count: classification.protected.length,
    projected_apply_counts: {
      reuse: countRowsByEntity(classification.reuse),
      create: countRowsByEntity(classification.create),
    },
    projected_final_active_counts: classification.projectedFinalActiveCounts,
    reuse: classification.reuse.slice(0, 100),
    create: classification.create.slice(0, 100),
    review: classification.review.slice(0, 100),
    legacy: classification.legacy.slice(0, 100),
    protected: classification.protected.slice(0, 100),
    validation_errors: plan.validationErrors,
    database_runtime_state: runtime.available ? 'verified_read_only' : 'not_verified',
    runtime_error: runtime.error || null,
    database_writes_performed: false,
  };
}

async function loadOfficialV2RuntimeState(plan, environment) {
  const url = String(environment.SUPABASE_URL || '').trim();
  const serviceKey = String(environment.SUPABASE_SERVICE_ROLE_KEY || '').trim();
  if (!url || !serviceKey) return { available: false, error: 'SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required for runtime classification.' };
  const client = createClient(url, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });
  const clientResult = await client.from('hospital_clients').select('id,client_code,client_name').eq('client_code', plan.metadata.clientCode).maybeSingle();
  if (clientResult.error) throw clientResult.error;
  if (!clientResult.data) return { available: false, error: `NIMS client ${plan.metadata.clientCode} not found.` };
  const clientId = clientResult.data.id;
  const [blocks, floors, departments, locations, tickets, qrs, scopes, assignments] = await Promise.all([
    client.from('hospital_blocks').select('id,block_name,block_code,is_active,verification_status').eq('client_id', clientId),
    client.from('hospital_floors').select('id,block_id,floor_name,floor_code,is_active,verification_status,block:hospital_blocks(id,block_name)').eq('client_id', clientId),
    client.from('hospital_departments').select('id,block_id,floor_id,department_name,department_code,is_active,verification_status,block:hospital_blocks(id,block_name),floor:hospital_floors(id,floor_name)').eq('client_id', clientId),
    client.from('hospital_locations').select('id,block_id,floor_id,department_id,location_name,location_code,is_active,verification_status,block:hospital_blocks(id,block_name),floor:hospital_floors(id,floor_name),department:hospital_departments(id,department_name)').eq('client_id', clientId),
    client.from('hospital_tickets').select('block_id,location_id').eq('client_id', clientId),
    client.from('hospital_feedback_qr_codes').select('location_id'),
    client.from('hospital_ticket_user_scopes').select('block_id,location_id').eq('client_id', clientId),
    client.from('hospital_supervisor_assignments').select('block_id,department_id').eq('client_id', clientId),
  ]);
  for (const result of [blocks, floors, departments, locations, tickets, qrs, scopes, assignments]) {
    if (result.error) throw result.error;
  }
  return {
    available: true,
    client: clientResult.data,
    blocks: blocks.data || [],
    floors: floors.data || [],
    departments: departments.data || [],
    locations: locations.data || [],
    tickets: tickets.data || [],
    qrs: qrs.data || [],
    scopes: scopes.data || [],
    assignments: assignments.data || [],
  };
}

function classifyOfficialV2Plan(plan, runtime) {
  const applyPlan = officialV2ApprovedApplyPlan(plan);
  const reviewKeys = new Set(plan.review.map((row) => `location:${normaliseNimsKey(row.block)}|${normaliseNimsKey(row.floor)}|${normaliseNimsKey(row.place)}`));
  const officialKeys = {
    block: new Set(applyPlan.blocks.keys()),
    floor: new Set(applyPlan.floors.keys()),
    department: new Set(applyPlan.departments.keys()),
    location: new Set(applyPlan.locations.keys()),
  };
  const reuse = [];
  const create = [];
  const review = plan.review.map((row) => ({ entity: 'location', block: row.block, floor: row.floor, place: row.place, reason: row.reason }));
  const legacy = [];
  const protectedRows = [];
  if (!runtime.available) {
    for (const block of applyPlan.blocks.values()) create.push({ entity: 'block', name: block.block_name });
    for (const floor of applyPlan.floors.values()) create.push({ entity: 'floor', block_code: floor.block_code, name: floor.floor_name });
    for (const department of applyPlan.departments.values()) create.push({ entity: 'department', block_code: department.block_code, floor_code: department.floor_code, name: department.department_name });
    for (const location of applyPlan.locations.values()) create.push({ entity: 'location', block_code: location.block_code, floor_code: location.floor_code, name: location.location_name });
    return { reuse, create, review, legacy, protected: protectedRows, projectedFinalActiveCounts: null };
  }

  const blockIds = new Map();
  const floorIds = new Map();
  const departmentIds = new Map();
  const locationIds = new Map();
  for (const row of runtime.blocks) {
    const key = normaliseNimsKey(row.block_name);
    blockIds.set(row.id, key);
    classifyExisting('block', key, officialKeys.block, row.block_name, row, reuse, legacy);
  }
  for (const row of runtime.floors) {
    const key = `${normaliseNimsKey(row.block?.block_name)}|${normaliseNimsKey(row.floor_name)}`;
    floorIds.set(row.id, key);
    classifyExisting('floor', key, officialKeys.floor, row.floor_name, row, reuse, legacy);
  }
  for (const row of runtime.departments) {
    const key = `${normaliseNimsKey(row.block?.block_name)}|${normaliseNimsKey(row.floor?.floor_name)}|${normaliseNimsKey(row.department_name)}`;
    departmentIds.set(row.id, key);
    classifyExisting('department', key, officialKeys.department, row.department_name, row, reuse, legacy);
  }
  for (const row of runtime.locations) {
    const key = `${normaliseNimsKey(row.block?.block_name)}|${normaliseNimsKey(row.floor?.floor_name || row.floor_name)}|${normaliseNimsKey(row.location_name)}`;
    locationIds.set(row.id, key);
    classifyExisting('location', key, officialKeys.location, row.location_name, row, reuse, legacy);
  }
  addMissingCreates('block', applyPlan.blocks, runtime.blocks, (row) => normaliseNimsKey(row.block_name), create);
  addMissingCreates('floor', applyPlan.floors, runtime.floors, (row) => `${normaliseNimsKey(row.block?.block_name)}|${normaliseNimsKey(row.floor_name)}`, create);
  addMissingCreates('department', applyPlan.departments, runtime.departments, (row) => `${normaliseNimsKey(row.block?.block_name)}|${normaliseNimsKey(row.floor?.floor_name)}|${normaliseNimsKey(row.department_name)}`, create);
  addMissingCreates('location', applyPlan.locations, runtime.locations, (row) => `${normaliseNimsKey(row.block?.block_name)}|${normaliseNimsKey(row.floor?.floor_name || row.floor_name)}|${normaliseNimsKey(row.location_name)}`, create, reviewKeys);

  const protectedIds = {
    block: new Set([
      ...runtime.tickets.map((row) => row.block_id).filter(Boolean),
      ...runtime.scopes.map((row) => row.block_id).filter(Boolean),
      ...runtime.assignments.map((row) => row.block_id).filter(Boolean),
    ]),
    department: new Set(runtime.assignments.map((row) => row.department_id).filter(Boolean)),
    location: new Set([
      ...runtime.tickets.map((row) => row.location_id).filter(Boolean),
      ...runtime.qrs.map((row) => row.location_id).filter(Boolean),
      ...runtime.scopes.map((row) => row.location_id).filter(Boolean),
    ]),
  };
  for (const row of runtime.blocks.filter((item) => protectedIds.block.has(item.id))) {
    protectedRows.push({ entity: 'block', id: row.id, name: row.block_name, key: blockIds.get(row.id) });
  }
  for (const row of runtime.departments.filter((item) => protectedIds.department.has(item.id))) {
    protectedRows.push({ entity: 'department', id: row.id, name: row.department_name, key: departmentIds.get(row.id) });
  }
  for (const row of runtime.locations.filter((item) => protectedIds.location.has(item.id))) {
    protectedRows.push({ entity: 'location', id: row.id, name: row.location_name, key: locationIds.get(row.id) });
  }

  return {
    reuse,
    create,
    review,
    legacy,
    protected: protectedRows,
    projectedFinalActiveCounts: {
      blocks: new Set([...runtime.blocks.filter((row) => row.is_active).map((row) => normaliseNimsKey(row.block_name)), ...officialKeys.block]).size,
      floors: new Set([...runtime.floors.filter((row) => row.is_active).map((row) => `${normaliseNimsKey(row.block?.block_name)}|${normaliseNimsKey(row.floor_name)}`), ...officialKeys.floor]).size,
      departments: new Set([...runtime.departments.filter((row) => row.is_active).map((row) => `${normaliseNimsKey(row.block?.block_name)}|${normaliseNimsKey(row.floor?.floor_name)}|${normaliseNimsKey(row.department_name)}`), ...officialKeys.department]).size,
      locations: new Set([...runtime.locations.filter((row) => row.is_active).map((row) => `${normaliseNimsKey(row.block?.block_name)}|${normaliseNimsKey(row.floor?.floor_name || row.floor_name)}|${normaliseNimsKey(row.location_name)}`), ...officialKeys.location]).size,
    },
  };
}

function officialV2ApprovedApplyPlan(plan) {
  const approved = {
    blocks: new Map(),
    floors: new Map(),
    departments: new Map(),
    locations: new Map(),
    rows: [],
  };
  for (const row of plan.rows.filter((item) => !item.reviewRequired)) {
    const blockKey = normaliseNimsKey(row.block);
    const floorKey = `${blockKey}|${normaliseNimsKey(row.floor)}`;
    const placeKey = `${floorKey}|${normaliseNimsKey(row.place)}`;
    const block = plan.blocks.get(blockKey);
    const floor = plan.floors.get(floorKey);
    const department = plan.departments.get(placeKey);
    const location = plan.locations.get(placeKey);
    if (block) approved.blocks.set(blockKey, block);
    if (floor) approved.floors.set(floorKey, floor);
    if (department) approved.departments.set(placeKey, department);
    if (location) approved.locations.set(placeKey, location);
    approved.rows.push(row);
  }
  return approved;
}

function classifyExisting(entity, key, officialSet, name, row, reuse, legacy) {
  if (officialSet.has(key)) {
    reuse.push({ entity, id: row.id, name, key });
  } else if (row.is_active) {
    legacy.push({ entity, id: row.id, name, key });
  }
}

function addMissingCreates(entity, stagedMap, existingRows, keyForRow, create, reviewKeys = new Set()) {
  const existingKeys = new Set(existingRows.map(keyForRow));
  for (const [key, row] of stagedMap.entries()) {
    const fullKey = `${entity}:${key}`;
    if (!existingKeys.has(key) && !reviewKeys.has(fullKey)) {
      create.push({ entity, name: row.block_name || row.floor_name || row.department_name || row.location_name, key });
    }
  }
}

async function applyOfficialV2Plan(plan, environment = process.env) {
  const readiness = officialV2ApplyReadiness(plan);
  if (!readiness.ready) {
    throw new Error(`Official V2 apply refused: ${readiness.errors.join('; ')}`);
  }
  const url = String(environment.SUPABASE_URL || '').trim();
  const serviceKey = String(environment.SUPABASE_SERVICE_ROLE_KEY || '').trim();
  if (!url || !serviceKey) throw new Error('SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required for official V2 --apply.');
  const client = createClient(url, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });
  const clientResult = await client.from('hospital_clients').select('*').eq('client_code', plan.metadata.clientCode).maybeSingle();
  if (clientResult.error) throw clientResult.error;
  if (!clientResult.data) throw new Error(`Official V2 apply refused: existing client ${plan.metadata.clientCode} not found.`);
  const clientRow = clientResult.data;
  const runtime = await loadOfficialV2RuntimeState(plan, environment);
  if (!runtime.available) throw new Error(`Official V2 apply refused: ${runtime.error || 'runtime state unavailable'}`);
  const approved = officialV2ApprovedApplyPlan(plan);
  const maps = officialV2RuntimeNaturalMaps(runtime);
  const applyStats = emptyApplyStats();
  const blockIds = new Map();
  const floorIds = new Map();
  const departmentIds = new Map();
  const locationIds = new Map();

  for (const [key, block] of approved.blocks.entries()) {
    const result = await insertOfficialV2IfMissing(client, maps.blocks, key, 'hospital_blocks', {
      client_id: clientRow.id,
      block_code: block.block_code,
      block_name: block.block_name,
      sort_order: 0,
      is_active: true,
      source: block.source,
      source_reference: block.source_reference,
      verification_status: 'verified',
      metadata: block.metadata,
    });
    blockIds.set(block.block_code, result.id);
    countApply(applyStats, 'blocks', result.action);
  }

  for (const [key, floor] of approved.floors.entries()) {
    const blockId = blockIds.get(floor.block_code);
    if (!blockId) throw new Error(`Official V2 apply refused: block id missing for floor ${floor.floor_name}.`);
    const result = await insertOfficialV2IfMissing(client, maps.floors, key, 'hospital_floors', {
      client_id: clientRow.id,
      block_id: blockId,
      floor_code: floor.floor_code,
      floor_name: floor.floor_name,
      floor_number: floor.floor_number,
      sort_order: floor.sort_order,
      is_known_service_floor: floor.is_known_service_floor,
      is_confirmed_building_floor: floor.is_confirmed_building_floor,
      source: floor.source,
      source_reference: floor.source_reference,
      verification_status: 'verified',
      is_active: true,
      metadata: floor.metadata,
    });
    floorIds.set(floor.floor_code, result.id);
    countApply(applyStats, 'floors', result.action);
  }

  for (const [key, department] of approved.departments.entries()) {
    const blockId = blockIds.get(department.block_code);
    const floorId = floorIds.get(department.floor_code);
    if (!blockId || !floorId) throw new Error(`Official V2 apply refused: hierarchy id missing for department ${department.department_name}.`);
    const result = await insertOfficialV2IfMissing(client, maps.departments, key, 'hospital_departments', {
      client_id: clientRow.id,
      block_id: blockId,
      floor_id: floorId,
      department_code: department.department_code,
      department_name: department.department_name,
      department_type: department.department_type,
      source: department.source,
      source_reference: department.source_reference,
      verification_status: 'verified',
      is_active: true,
      metadata: department.metadata,
    });
    departmentIds.set(department.department_code, result.id);
    countApply(applyStats, 'departments', result.action);
  }

  for (const [key, location] of approved.locations.entries()) {
    const blockId = blockIds.get(location.block_code);
    const floorId = floorIds.get(location.floor_code);
    const departmentId = departmentIds.get(location.department_code);
    if (!blockId || !floorId || !departmentId) throw new Error(`Official V2 apply refused: hierarchy id missing for location ${location.location_name}.`);
    const result = await insertOfficialV2IfMissing(client, maps.locations, key, 'hospital_locations', {
      client_id: clientRow.id,
      block_id: blockId,
      floor_id: floorId,
      department_id: departmentId,
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
      verification_status: 'verified',
      is_active: true,
      metadata: location.metadata,
    });
    locationIds.set(location.location_code, result.id);
    countApply(applyStats, 'locations', result.action);
  }

  return {
    mode: 'official-v2-apply',
    source: plan.metadata.workbookPath,
    client: plan.metadata.clientCode,
    approved_place_count: approved.locations.size,
    pending_confirmation: plan.review.map((row) => ({
      block: row.block,
      floor: row.floor,
      place: row.place,
      reason: row.reason,
    })),
    apply_stats: applyStats,
    transaction_safety: 'fail-fast/idempotent natural-key inserts; not a single database transaction',
    database_writes_performed: true,
  };
}

export function officialV2ApplyReadiness(plan) {
  const errors = [];
  const duplicates = officialV2DuplicatePaths(plan);
  const reviewPaths = new Set(plan.review.map((row) => `${normaliseNimsKey(row.block)}|${normaliseNimsKey(row.floor)}|${normaliseNimsKey(row.place)}`));
  if (plan.blocks.size !== 6) errors.push(`expected 6 official blocks, found ${plan.blocks.size}`);
  if (plan.floors.size !== 32) errors.push(`expected 32 official floors, found ${plan.floors.size}`);
  if (plan.locations.size !== 240) errors.push(`expected 240 official places, found ${plan.locations.size}`);
  if (plan.review.length !== 3) errors.push(`expected 3 pending review rows, found ${plan.review.length}`);
  if (duplicates.length) errors.push(`duplicate official paths found: ${duplicates.map((row) => row.key).join(', ')}`);
  for (const key of OFFICIAL_V2_PENDING_CONFIRMATION_PATHS) {
    if (!reviewPaths.has(key)) errors.push(`pending confirmation path missing from review: ${key}`);
  }
  for (const key of reviewPaths) {
    if (!OFFICIAL_V2_PENDING_CONFIRMATION_PATHS.has(key)) errors.push(`unexpected pending review path: ${key}`);
  }
  if (officialV2ApprovedApplyPlan(plan).locations.size !== 237) {
    errors.push(`expected 237 approved places, found ${officialV2ApprovedApplyPlan(plan).locations.size}`);
  }
  if (plan.validationErrors.length) errors.push(`validation errors present: ${plan.validationErrors.length}`);
  return { ready: errors.length === 0, errors, duplicates };
}

function officialV2DuplicatePaths(plan) {
  const counts = new Map();
  for (const row of plan.rows) {
    const key = `${normaliseNimsKey(row.block)}|${normaliseNimsKey(row.floor)}|${normaliseNimsKey(row.place)}`;
    counts.set(key, (counts.get(key) || 0) + 1);
  }
  return [...counts.entries()]
    .filter(([, count]) => count > 1)
    .map(([key, count]) => ({ key, count }));
}

function officialV2RuntimeNaturalMaps(runtime) {
  const maps = {
    blocks: new Map(),
    floors: new Map(),
    departments: new Map(),
    locations: new Map(),
  };
  for (const row of runtime.blocks) {
    maps.blocks.set(normaliseNimsKey(row.block_name), row);
  }
  for (const row of runtime.floors) {
    maps.floors.set(`${normaliseNimsKey(row.block?.block_name)}|${normaliseNimsKey(row.floor_name)}`, row);
  }
  for (const row of runtime.departments) {
    maps.departments.set(`${normaliseNimsKey(row.block?.block_name)}|${normaliseNimsKey(row.floor?.floor_name)}|${normaliseNimsKey(row.department_name)}`, row);
  }
  for (const row of runtime.locations) {
    maps.locations.set(`${normaliseNimsKey(row.block?.block_name)}|${normaliseNimsKey(row.floor?.floor_name || row.floor_name)}|${normaliseNimsKey(row.location_name)}`, row);
  }
  return maps;
}

async function insertOfficialV2IfMissing(client, existingMap, key, table, payload) {
  const existing = existingMap.get(key);
  if (existing) {
    if (existing.is_active === false) {
      throw new Error(`Official V2 apply refused: exact ${table} key exists but is inactive: ${key}`);
    }
    return { id: existing.id, action: 'reused' };
  }
  const result = await client.from(table).insert(payload).select('id').single();
  if (result.error) throw result.error;
  const row = { ...payload, id: result.data.id };
  existingMap.set(key, row);
  return { id: result.data.id, action: 'inserted' };
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

function countRowsByEntity(rows) {
  return rows.reduce((counts, row) => {
    counts[row.entity] = (counts[row.entity] || 0) + 1;
    return counts;
  }, {});
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
  if (args.officialV2) {
    const plan = buildOfficialNimsV2Plan(args.workbook, args);
    const summary = args.apply
      ? await applyOfficialV2Plan(plan)
      : await summaryForOfficialV2Plan(plan);
    console.log(JSON.stringify(summary, null, 2));
    return;
  }
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
