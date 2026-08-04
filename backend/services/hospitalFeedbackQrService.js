import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import QRCode from 'qrcode';
import sharp from 'sharp';

import { resolveCurrentUserAccess } from './accessControlService.js';
import { scopeAllows } from './hospitalTicketAuthService.js';

const TOKEN_PATTERN = /^[A-Za-z0-9_-]{22,160}$/;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const DEFAULT_SESSION_TTL_MS = 12 * 60 * 1000;
export const QR_PNG_WIDTH = 1000;
export const QR_ERROR_CORRECTION_LEVEL = 'H';
const QR_LOGO_RATIO = 0.16;
const QR_LOGO_BACKGROUND_RATIO = 0.22;
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const QPMS_LOGO_PATHS = [
  path.resolve(__dirname, '../assets/qpms-logo.png'),
  path.resolve(__dirname, '../../src/assets/qpms-logo.png'),
];
const sessionStore = new Map();

function cleanText(value, max = 240) {
  return String(value || '').replace(/\s+/g, ' ').trim().slice(0, max);
}

function normalizeText(value, max = 240) {
  if (value == null) return null;
  if (typeof value !== 'string') {
    const error = new Error('Text fields must be strings.');
    error.statusCode = 400;
    error.code = 'invalid_text';
    throw error;
  }
  const text = value.replace(/\s+/g, ' ').trim();
  if (!text) return null;
  if (text.length > max) {
    const error = new Error('Text field is too large.');
    error.statusCode = 413;
    error.code = 'text_too_large';
    throw error;
  }
  return text;
}

function normalizeRespondentName(value) {
  const text = normalizeText(value, 120);
  if (text && /[\u0000-\u001f\u007f]/.test(text)) {
    const error = new Error('Respondent name contains unsupported characters.');
    error.statusCode = 400;
    error.code = 'invalid_respondent_name';
    throw error;
  }
  return text;
}

function cleanUuid(value, fieldName = 'id') {
  const text = cleanText(value, 80);
  if (UUID_PATTERN.test(text)) {
    return text;
  }
  const error = new Error(`${fieldName} must be a valid UUID.`);
  error.statusCode = 400;
  error.code = 'invalid_uuid';
  throw error;
}

function isUuidText(value) {
  return UUID_PATTERN.test(String(value || '').trim());
}

function optionalUuid(value, fieldName = 'id') {
  const text = cleanText(value, 80);
  return text ? cleanUuid(text, fieldName) : '';
}

function integerOption(value, fallback, min, max) {
  const parsed = Number.parseInt(String(value ?? ''), 10);
  if (!Number.isInteger(parsed) || parsed < min || parsed > max) return fallback;
  return parsed;
}

export function generatePublicQrToken() {
  return crypto.randomBytes(32).toString('base64url');
}

export function isValidPublicQrToken(token) {
  return TOKEN_PATTERN.test(String(token || ''));
}

function tokenPepper(environment = process.env) {
  return String(environment.HOSPITAL_FEEDBACK_QR_TOKEN_PEPPER || '').trim();
}

export function hashPublicQrToken(token, environment = process.env) {
  return crypto
    .createHash('sha256')
    .update(`${String(token)}:${tokenPepper(environment)}`)
    .digest('hex');
}

export function tokenLookupKey(token) {
  return String(token || '').slice(0, 16);
}

function encryptionKey(environment = process.env) {
  const secret = String(
    environment.HOSPITAL_FEEDBACK_QR_ENCRYPTION_SECRET ||
      environment.HOSPITAL_FEEDBACK_QR_TOKEN_PEPPER ||
      '',
  ).trim();
  if (!secret) return null;
  return crypto.createHash('sha256').update(secret).digest();
}

export function encryptPublicQrToken(token, environment = process.env) {
  const key = encryptionKey(environment);
  if (!key) return null;
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const encrypted = Buffer.concat([cipher.update(String(token), 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `v1.${iv.toString('base64url')}.${tag.toString('base64url')}.${encrypted.toString('base64url')}`;
}

export function decryptPublicQrToken(payload, environment = process.env) {
  const key = encryptionKey(environment);
  const parts = String(payload || '').split('.');
  if (!key || parts.length !== 4 || parts[0] !== 'v1') return '';
  try {
    const [, iv, tag, encrypted] = parts;
    const decipher = crypto.createDecipheriv('aes-256-gcm', key, Buffer.from(iv, 'base64url'));
    decipher.setAuthTag(Buffer.from(tag, 'base64url'));
    return Buffer.concat([
      decipher.update(Buffer.from(encrypted, 'base64url')),
      decipher.final(),
    ]).toString('utf8');
  } catch {
    return '';
  }
}

export function publicFeedbackBaseUrl(environment = process.env, request = null) {
  const configured = String(
    environment.HOSPITAL_FEEDBACK_PUBLIC_BASE_URL ||
      environment.PUBLIC_APP_URL ||
      environment.APP_PUBLIC_URL ||
      String(environment.FRONTEND_ORIGIN || '').split(',')[0] ||
      '',
  ).trim();
  if (configured) return configured.replace(/\/+$/, '');
  if (request?.headers?.host) {
    const protocol = request.protocol || 'https';
    return `${protocol}://${request.headers.host}`.replace(/\/+$/, '');
  }
  return 'http://localhost:5173';
}

export function publicQrUrl(token, environment = process.env, request = null) {
  return `${publicFeedbackBaseUrl(environment, request)}/public-feedback/q/${encodeURIComponent(token)}`;
}

export async function generatePlainQrPngBuffer(url) {
  return QRCode.toBuffer(url, {
    type: 'png',
    errorCorrectionLevel: QR_ERROR_CORRECTION_LEVEL,
    margin: 4,
    width: QR_PNG_WIDTH,
    color: { dark: '#000000', light: '#ffffff' },
  });
}

function roundedLogoBackgroundSvg(size) {
  const radius = Math.round(size * 0.18);
  return Buffer.from(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}"><rect width="${size}" height="${size}" rx="${radius}" fill="#ffffff"/></svg>`,
  );
}

function resolveQpmsLogoPath(environment = process.env) {
  const configuredPath = cleanText(environment.HOSPITAL_FEEDBACK_QR_LOGO_PATH, 1000);
  const candidates = configuredPath ? [path.resolve(configuredPath), ...QPMS_LOGO_PATHS] : QPMS_LOGO_PATHS;
  return candidates.find((candidate) => fs.existsSync(candidate)) || candidates[0];
}

export async function generateBrandedQrPngBuffer(url, {
  environment = process.env,
  logoPath = resolveQpmsLogoPath(environment),
} = {}) {
  const qrBuffer = await generatePlainQrPngBuffer(url);
  const resolvedLogoPath = path.resolve(logoPath);
  try {
    const logoSize = Math.round(QR_PNG_WIDTH * QR_LOGO_RATIO);
    const backgroundSize = Math.round(QR_PNG_WIDTH * QR_LOGO_BACKGROUND_RATIO);
    const backgroundOffset = Math.round((QR_PNG_WIDTH - backgroundSize) / 2);
    const logoOffset = Math.round((QR_PNG_WIDTH - logoSize) / 2);
    const logoBuffer = await sharp(resolvedLogoPath)
      .resize({ width: logoSize, height: logoSize, fit: 'inside', withoutEnlargement: true })
      .png()
      .toBuffer();

    return sharp(qrBuffer)
      .composite([
        { input: roundedLogoBackgroundSvg(backgroundSize), left: backgroundOffset, top: backgroundOffset },
        { input: logoBuffer, left: logoOffset, top: logoOffset },
      ])
      .png()
      .toBuffer();
  } catch (error) {
    console.warn('[hospital-feedback-qr] Unable to apply QPMS logo; generated plain QR.', {
      reason: error?.code || error?.name || 'logo_composition_failed',
      logoPath: resolvedLogoPath,
      logoExists: fs.existsSync(resolvedLogoPath),
    });
    return qrBuffer;
  }
}

export async function generateQrPngDataUrl(url, options = {}) {
  const buffer = await generateBrandedQrPngBuffer(url, options);
  return `data:image/png;base64,${buffer.toString('base64')}`;
}

function genericInvalidQr() {
  return {
    valid: false,
    code: 'INVALID_OR_INACTIVE_QR',
    message: 'This QR code is invalid or no longer active.',
  };
}

function safeLocationFromRow(qrRow) {
  const location = qrRow?.location || {};
  const block = location.block || {};
  const floor = location.floor || {};
  const department = location.department || {};
  const client = location.client || {};
  const parentClient = client.parent_client || location.parent_client || null;
  const parentClientId = client.parent_client_id || location.parent_client_id || null;
  return {
    clientName: parentClient ? cleanText(parentClient.client_name || parentClient.name) : null,
    parentClientId: parentClientId ? cleanText(parentClientId, 80) : null,
    parentClientCode: parentClient ? cleanText(parentClient.client_code || parentClient.code) : null,
    parentClientName: parentClient ? cleanText(parentClient.client_name || parentClient.name) : null,
    hospitalCode: cleanText(client.client_code || client.code),
    hospitalName: cleanText(client.client_name || client.name),
    blockName: cleanText(block.block_name),
    floorName: cleanText(floor.floor_name || location.floor_name),
    departmentName: cleanText(department.department_name || location.department_name),
    locationName: cleanText(location.location_name),
    locationType: cleanText(location.location_type),
  };
}

function safeLocationListFromRow(qrRow) {
  const location = qrRow?.location || {};
  const safe = safeLocationFromRow(qrRow);
  return {
    ...safe,
    parentClientId: safe.parentClientId,
    parentClientCode: safe.parentClientCode,
    parentClientName: safe.parentClientName,
    hospitalId: cleanText(location.client_id, 80),
    hospitalCode: safe.hospitalCode,
    blockId: cleanText(location.block_id, 80),
    floorId: cleanText(location.floor_id, 80),
    departmentId: cleanText(location.department_id, 80),
    locationCode: cleanText(location.location_code),
  };
}

function generatedByName(profile = {}) {
  return cleanText(
    profile?.full_name ||
      profile?.display_name ||
      profile?.name ||
      profile?.email ||
      '',
  );
}

function qrListItem(row) {
  const location = safeLocationListFromRow(row);
  return {
    qrId: row.id,
    parentClientId: location.parentClientId,
    parentClientCode: location.parentClientCode,
    parentClientName: location.parentClientName,
    hospitalId: location.hospitalId,
    hospitalCode: location.hospitalCode,
    hospitalName: location.hospitalName,
    blockId: location.blockId,
    blockName: location.blockName,
    floorId: location.floorId,
    floorName: location.floorName,
    departmentName: location.departmentName,
    locationName: location.locationName,
    locationCode: location.locationCode,
    locationType: location.locationType,
    status: cleanText(row.status, 40),
    version: Number(row.version || 1),
    generatedAt: row.generated_at || null,
    generatedByName: generatedByName(row.generated_by_profile),
    lastPrintedAt: row.last_printed_at || null,
    printCount: Number(row.print_count || 0),
  };
}

function qrFilenamePart(value, fallback) {
  return cleanText(value || fallback, 80)
    .replace(/[^A-Za-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '') || fallback;
}

function qrSuggestedFilename(row) {
  const location = safeLocationListFromRow(row);
  return [
    qrFilenamePart(location.parentClientName, 'Client'),
    qrFilenamePart(location.hospitalName, 'Hospital'),
    qrFilenamePart(location.blockName, 'Block'),
    qrFilenamePart(location.floorName, 'Floor'),
    qrFilenamePart(location.locationName || location.locationCode, 'Location'),
    `QR_v${Number(row.version || 1)}`,
  ].join('_').replace(/_+/g, '_').concat('.png');
}

function matchesQrSearch(row, search) {
  const query = cleanText(search).toLowerCase();
  if (!query) return true;
  const location = safeLocationListFromRow(row);
  return [
    location.parentClientName,
    location.hospitalName,
    location.blockName,
    location.floorName,
    location.departmentName,
    location.locationName,
    location.locationCode,
    location.locationType,
  ].some((value) => String(value || '').toLowerCase().includes(query));
}

function dateBoundary(value, endOfDay = false) {
  const text = cleanText(value, 40);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) return null;
  return `${text}T${endOfDay ? '23:59:59.999' : '00:00:00.000'}Z`;
}

function roleKey(profile = {}) {
  return String(profile?.role || '').trim().toUpperCase().replace(/[^A-Z0-9]+/g, '');
}

function isPlatformQrAdmin(profile = {}) {
  return new Set(['ADMIN', 'QPMSADMIN', 'DEVELOPER', 'DEV', 'MD', 'COO', 'GM', 'GMTOPMANAGEMENT']).has(roleKey(profile));
}

function scopeAllowsQr(scopes, location, permission) {
  return scopeAllows(scopes, {
    clientId: location.client_id,
    blockId: location.block_id,
    locationId: location.id,
    permission: permission === 'generate' ? 'update' : 'view',
  }) || (permission === 'generate' && scopeAllows(scopes, {
    clientId: location.client_id,
    blockId: location.block_id,
    locationId: location.id,
    permission: 'create',
  }));
}

async function legacyHospitalQrAccess(client, authUserId, location, permission) {
  if (!authUserId) return false;
  const userResult = await client
    .from('hospital_ticket_users')
    .select('*')
    .eq('auth_user_id', authUserId)
    .eq('is_active', true)
    .maybeSingle();
  if (userResult.error) throw userResult.error;
  const user = userResult.data;
  if (!user || user.client_id !== location.client_id) return false;
  if (permission === 'generate' && !['operations_executive', 'facility_manager', 'housekeeping_supervisor'].includes(user.role_code)) {
    return false;
  }
  const scopesResult = await client
    .from('hospital_ticket_user_scopes')
    .select('*')
    .eq('hospital_ticket_user_id', user.id);
  if (scopesResult.error) throw scopesResult.error;
  return scopeAllowsQr(scopesResult.data || [], location, permission);
}

export async function assertHospitalFeedbackQrAccess({
  client,
  authUser,
  profile,
  location,
  permission = 'view',
}) {
  if (isPlatformQrAdmin(profile)) return { allowed: true, source: 'platform_role' };

  const access = await resolveCurrentUserAccess({
    client,
    authUser,
    profile,
    requestedModule: 'hospital_feedback',
    requestedPermission: `hospital_feedback_qr.${permission}`,
    requestedScopes: {
      location: location?.id,
      hospital_block: location?.block_id,
      client_id: location?.client_id,
    },
  });
  if (access.ok !== false && access.access_granted !== false && access.assignments?.length) {
    return { allowed: true, source: access.source || 'unified' };
  }

  if (await legacyHospitalQrAccess(client, authUser?.id || profile?.auth_user_id, location, permission)) {
    return { allowed: true, source: 'legacy_hospital_scope' };
  }

  const error = new Error('You do not have permission for this hospital feedback QR action.');
  error.statusCode = 403;
  error.code = 'hospital_feedback_qr_access_denied';
  throw error;
}

export async function loadQrLocationOptions(client, { authUser, profile }) {
  let query = client
    .from('hospital_locations')
    .select('id,client_id,block_id,floor_id,department_id,location_name,location_code,location_type,is_active,client:hospital_clients(id,client_code,client_name,parent_client_id,is_active,parent_client:hospital_parent_clients(id,client_code,client_name,is_active)),block:hospital_blocks(id,block_name,is_active),floor:hospital_floors(id,floor_name,is_active),department:hospital_departments(id,department_name,is_active)')
    .eq('is_active', true)
    .order('location_name');
  const result = await query.limit(1000);
  if (result.error) throw result.error;
  const locations = [];
  for (const row of result.data || []) {
    if (row.client?.is_active === false || row.client?.parent_client?.is_active === false || row.block?.is_active === false) continue;
    try {
      await assertHospitalFeedbackQrAccess({ client, authUser, profile, location: row, permission: 'view' });
      locations.push({
        id: row.id,
        locationId: row.id,
        parentClientId: row.client?.parent_client_id || null,
        parentClientCode: row.client?.parent_client?.client_code || null,
        parentClientName: row.client?.parent_client?.client_name || null,
        hospitalId: row.client_id,
        hospitalCode: row.client?.client_code || '',
        hospitalName: row.client?.client_name || '',
        blockId: row.block_id,
        blockName: row.block?.block_name || '',
        floorId: row.floor_id || '',
        floorName: row.floor?.floor_name || '',
        departmentId: row.department_id || '',
        departmentName: row.department?.department_name || '',
        locationCode: row.location_code || '',
        locationName: row.location_name || '',
        locationType: row.location_type || '',
      });
    } catch (error) {
      if (error.statusCode !== 403) throw error;
    }
  }
  return locations;
}

async function loadGenerationLocation(client, locationId) {
  const result = await client
    .from('hospital_locations')
    .select('id,client_id,block_id,floor_id,department_id,location_name,location_code,location_type,is_active,client:hospital_clients(id,client_code,client_name,parent_client_id,is_active,parent_client:hospital_parent_clients(id,client_code,client_name,is_active)),block:hospital_blocks(id,block_name,is_active),floor:hospital_floors(id,floor_name,is_active),department:hospital_departments(id,department_name,is_active)')
    .eq('id', cleanUuid(locationId, 'location_id'))
    .maybeSingle();
  if (result.error) throw result.error;
  if (!result.data || result.data.is_active !== true || result.data.client?.is_active === false || result.data.client?.parent_client?.is_active === false || result.data.block?.is_active === false) {
    const error = new Error('Selected hospital location is unavailable.');
    error.statusCode = 404;
    error.code = 'location_not_found';
    throw error;
  }
  return result.data;
}

function qrResponse(row, token, environment, request, message, existing = false) {
  const url = token ? publicQrUrl(token, environment, request) : '';
  return {
    id: row.id,
    status: row.status,
    active: row.status === 'active',
    version: row.version,
    generated_at: row.generated_at,
    public_url: url,
    existing,
    message,
  };
}

export async function generateHospitalFeedbackQr({
  client,
  authUser,
  profile,
  locationId,
  environment = process.env,
  request = null,
  createQrPng = generateQrPngDataUrl,
}) {
  const location = await loadGenerationLocation(client, locationId);
  await assertHospitalFeedbackQrAccess({ client, authUser, profile, location, permission: 'generate' });

  const existingResult = await client
    .from('hospital_feedback_qr_codes')
    .select('*')
    .eq('location_id', location.id)
    .eq('status', 'active')
    .maybeSingle();
  if (existingResult.error) throw existingResult.error;

  if (existingResult.data) {
    const token = decryptPublicQrToken(existingResult.data.public_token_encrypted, environment);
    const response = qrResponse(
      existingResult.data,
      token,
      environment,
      request,
      'An active QR already exists for this location.',
      true,
    );
    if (token) response.qr_png_data_url = await createQrPng(response.public_url);
    return response;
  }

  const token = generatePublicQrToken();
  const insertPayload = {
    location_id: location.id,
    public_token_hash: hashPublicQrToken(token, environment),
    public_token_encrypted: encryptPublicQrToken(token, environment),
    token_lookup_key: tokenLookupKey(token),
    status: 'active',
    version: 1,
    generated_by: profile?.id || null,
    generated_at: new Date().toISOString(),
    activated_at: new Date().toISOString(),
    metadata: { source: 'phase1_qr_generator' },
  };
  const inserted = await client
    .from('hospital_feedback_qr_codes')
    .insert(insertPayload)
    .select('*')
    .single();
  if (inserted.error) {
    if (inserted.error.code === '23505') {
      return generateHospitalFeedbackQr({
        client,
        authUser,
        profile,
        locationId,
        environment,
        request,
        createQrPng,
      });
    }
    throw inserted.error;
  }
  const response = qrResponse(inserted.data, token, environment, request, 'QR generated successfully.', false);
  response.qr_png_data_url = await createQrPng(response.public_url);
  return response;
}

const QR_REGISTRY_SELECT = [
  'id',
  'location_id',
  'status',
  'version',
  'generated_at',
  'last_printed_at',
  'print_count',
  'public_token_encrypted',
  'location:hospital_locations(id,client_id,block_id,floor_id,department_id,location_name,location_code,location_type,is_active,floor_name,department_name,client:hospital_clients(id,client_code,client_name,parent_client_id,is_active,parent_client:hospital_parent_clients(id,client_code,client_name,is_active)),block:hospital_blocks(id,block_name,is_active),floor:hospital_floors(id,floor_name,is_active),department:hospital_departments(id,department_name,is_active))',
  'generated_by_profile:profiles(id,full_name,display_name,email)',
].join(',');

function applyQrRegistryFilters(query, filters = {}) {
  const status = cleanText(filters.status, 40).toLowerCase();
  const dateFrom = dateBoundary(filters.dateFrom);
  const dateTo = dateBoundary(filters.dateTo, true);
  if (['active', 'inactive', 'replaced', 'revoked'].includes(status)) {
    query = query.eq('status', status);
  }
  if (dateFrom) query = query.gte('generated_at', dateFrom);
  if (dateTo) query = query.lte('generated_at', dateTo);
  return query;
}

async function resolveLocationIdsForHierarchyFilters(client, filters = {}) {
  const parentClientId = optionalUuid(filters.parentClientId, 'parentClientId');
  const hospitalId = optionalUuid(filters.hospitalId || filters.clientId, 'hospitalId');
  const blockId = optionalUuid(filters.blockId, 'blockId');
  const floorId = optionalUuid(filters.floorId, 'floorId');
  const locationId = optionalUuid(filters.locationId, 'locationId');
  if (!parentClientId && !hospitalId && !blockId && !floorId && !locationId) return null;
  let query = client
    .from('hospital_locations')
    .select('id,client_id,block_id,floor_id,client:hospital_clients(id,parent_client_id)');
  if (locationId) query = query.eq('id', locationId);
  if (hospitalId) query = query.eq('client_id', hospitalId);
  if (blockId) query = query.eq('block_id', blockId);
  if (floorId) query = query.eq('floor_id', floorId);
  const result = await query.limit(5000);
  if (result.error) throw result.error;
  return (result.data || [])
    .filter((row) => !parentClientId || row.client?.parent_client_id === parentClientId)
    .map((row) => row.id)
    .filter(Boolean);
}

function matchesQrRegistryFilters(row, filters = {}) {
  const location = safeLocationListFromRow(row);
  const parentClientId = optionalUuid(filters.parentClientId, 'parentClientId');
  const hospitalId = optionalUuid(filters.hospitalId || filters.clientId, 'hospitalId');
  const blockId = optionalUuid(filters.blockId, 'blockId');
  const floorId = optionalUuid(filters.floorId, 'floorId');
  const locationId = optionalUuid(filters.locationId, 'locationId');
  if (parentClientId && location.parentClientId !== parentClientId) return false;
  if (hospitalId && location.hospitalId !== hospitalId) return false;
  if (blockId && location.blockId !== blockId) return false;
  if (floorId && location.floorId !== floorId) return false;
  if (locationId && row.location_id !== locationId) return false;
  return matchesQrSearch(row, filters.search);
}

export async function listHospitalFeedbackQrs({
  client,
  authUser,
  profile,
  filters = {},
}) {
  const page = integerOption(filters.page, 1, 1, 100000);
  const pageSize = integerOption(filters.pageSize, 20, 1, 100);
  let query = client
    .from('hospital_feedback_qr_codes')
    .select(QR_REGISTRY_SELECT)
    .order('generated_at', { ascending: false });
  query = applyQrRegistryFilters(query, filters);
  const filteredLocationIds = await resolveLocationIdsForHierarchyFilters(client, filters);
  if (filteredLocationIds && !filteredLocationIds.length) {
    return {
      items: [],
      pagination: { page: 1, pageSize, total: 0, totalPages: 1 },
    };
  }
  if (filteredLocationIds) query = query.in('location_id', filteredLocationIds);
  const result = await query.limit(1000);
  if (result.error) throw result.error;

  const authorizedRows = [];
  for (const row of result.data || []) {
    if (!row?.location) continue;
    if (!matchesQrRegistryFilters(row, filters)) continue;
    try {
      await assertHospitalFeedbackQrAccess({ client, authUser, profile, location: row.location, permission: 'view' });
      authorizedRows.push(row);
    } catch (error) {
      if (error.statusCode !== 403) throw error;
    }
  }

  const total = authorizedRows.length;
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const safePage = Math.min(page, totalPages);
  const start = (safePage - 1) * pageSize;
  return {
    items: authorizedRows.slice(start, start + pageSize).map(qrListItem),
    pagination: {
      page: safePage,
      pageSize,
      total,
      totalPages,
    },
  };
}

async function loadQrForAuthenticatedAction({
  client,
  authUser,
  profile,
  qrId,
  permission = 'view',
}) {
  const result = await client
    .from('hospital_feedback_qr_codes')
    .select(QR_REGISTRY_SELECT)
    .eq('id', cleanUuid(qrId, 'qrId'))
    .maybeSingle();
  if (result.error) throw result.error;
  if (!result.data?.location) {
    const error = new Error('Hospital Feedback QR was not found.');
    error.statusCode = 404;
    error.code = 'hospital_feedback_qr_not_found';
    throw error;
  }
  await assertHospitalFeedbackQrAccess({ client, authUser, profile, location: result.data.location, permission });
  return result.data;
}

function existingQrToken(row, environment = process.env) {
  const token = decryptPublicQrToken(row.public_token_encrypted, environment);
  if (!token) {
    const error = new Error('Existing QR token is unavailable for reprint.');
    error.statusCode = 409;
    error.code = 'hospital_feedback_qr_token_unavailable';
    throw error;
  }
  return token;
}

function qrPayload(row, token, environment, request, qrPngDataUrl = '') {
  const publicUrl = publicQrUrl(token, environment, request);
  return {
    qr: {
      ...qrListItem(row),
      publicUrl,
      qrPngDataUrl,
      suggestedFilename: qrSuggestedFilename(row),
    },
  };
}

export async function previewHospitalFeedbackQr({
  client,
  authUser,
  profile,
  qrId,
  environment = process.env,
  request = null,
  createQrPng = generateQrPngDataUrl,
}) {
  const row = await loadQrForAuthenticatedAction({ client, authUser, profile, qrId, permission: 'view' });
  const token = existingQrToken(row, environment);
  const publicUrl = publicQrUrl(token, environment, request);
  return qrPayload(row, token, environment, request, await createQrPng(publicUrl));
}

export async function reprintHospitalFeedbackQr({
  client,
  authUser,
  profile,
  qrId,
  environment = process.env,
  request = null,
  now = new Date(),
  createQrPng = generateQrPngDataUrl,
}) {
  const row = await loadQrForAuthenticatedAction({ client, authUser, profile, qrId, permission: 'generate' });
  if (row.status !== 'active') {
    const error = new Error('Only active Hospital Feedback QR codes can be reprinted.');
    error.statusCode = 409;
    error.code = 'hospital_feedback_qr_not_active';
    throw error;
  }
  const token = existingQrToken(row, environment);
  const publicUrl = publicQrUrl(token, environment, request);
  const lastPrintedAt = now.toISOString();
  const printCount = Number(row.print_count || 0) + 1;
  const updateResult = await client
    .from('hospital_feedback_qr_codes')
    .update({ last_printed_at: lastPrintedAt, print_count: printCount })
    .eq('id', row.id)
    .select(QR_REGISTRY_SELECT)
    .single();
  if (updateResult.error) throw updateResult.error;
  const updatedRow = updateResult.data || { ...row, last_printed_at: lastPrintedAt, print_count: printCount };
  return qrPayload(updatedRow, token, environment, request, await createQrPng(publicUrl));
}

export async function deleteHospitalFeedbackQr({
  client,
  authUser,
  profile,
  qrId,
}) {
  const row = await loadQrForAuthenticatedAction({ client, authUser, profile, qrId, permission: 'generate' });
  const deleted = await client
    .from('hospital_feedback_qr_codes')
    .delete()
    .eq('id', row.id)
    .select('id')
    .maybeSingle();
  if (deleted.error) {
    if (deleted.error.code === '23503') {
      const error = new Error('QR deletion is blocked by linked records.');
      error.statusCode = 409;
      error.code = 'hospital_feedback_qr_delete_blocked';
      throw error;
    }
    throw deleted.error;
  }
  if (!deleted.data) {
    const error = new Error('Hospital Feedback QR was not found.');
    error.statusCode = 404;
    error.code = 'hospital_feedback_qr_not_found';
    throw error;
  }
  return {
    success: true,
    message: 'QR deleted successfully.',
    deletedQrId: row.id,
  };
}

function publicSessionTtlMs(environment = process.env) {
  const minutes = Number(environment.HOSPITAL_FEEDBACK_PUBLIC_SESSION_MINUTES || 12);
  if (!Number.isFinite(minutes) || minutes < 1 || minutes > 30) return DEFAULT_SESSION_TTL_MS;
  return Math.round(minutes * 60 * 1000);
}

export function createPublicFeedbackSession(binding, environment = process.env, now = new Date()) {
  const token = crypto.randomBytes(32).toString('base64url');
  const expiresAt = new Date(now.getTime() + publicSessionTtlMs(environment));
  sessionStore.set(token, {
    qrId: binding.qrId,
    locationId: binding.locationId,
    expiresAt: expiresAt.toISOString(),
  });
  return {
    token,
    expiresAt: expiresAt.toISOString(),
    expiresInSeconds: Math.floor((expiresAt.getTime() - now.getTime()) / 1000),
  };
}

export function verifyPublicFeedbackSession(token, now = new Date()) {
  const text = String(token || '').trim();
  const session = sessionStore.get(text);
  if (!session) return { valid: false };
  if (new Date(session.expiresAt).getTime() <= now.getTime()) {
    sessionStore.delete(text);
    return { valid: false };
  }
  return { valid: true, expiresAt: session.expiresAt };
}

function publicFeedbackSessionBinding(token, now = new Date()) {
  const text = String(token || '').trim();
  const session = sessionStore.get(text);
  if (!session) return null;
  if (new Date(session.expiresAt).getTime() <= now.getTime()) {
    sessionStore.delete(text);
    return null;
  }
  return session;
}

export function clearPublicFeedbackSessions() {
  sessionStore.clear();
}

export async function resolvePublicHospitalFeedbackQr({
  client,
  token,
  environment = process.env,
  now = new Date(),
}) {
  if (!isValidPublicQrToken(token)) return genericInvalidQr();
  const result = await client
    .from('hospital_feedback_qr_codes')
    .select('id,status,location_id,location:hospital_locations(id,client_id,block_id,floor_id,department_id,location_name,location_type,is_active,floor_name,department_name,client:hospital_clients(id,client_code,client_name,parent_client_id,is_active,metadata,parent_client:hospital_parent_clients(id,client_code,client_name,is_active)),block:hospital_blocks(id,block_name,is_active),floor:hospital_floors(id,floor_name,is_active),department:hospital_departments(id,department_name,is_active))')
    .eq('token_lookup_key', tokenLookupKey(token))
    .eq('public_token_hash', hashPublicQrToken(token, environment))
    .eq('status', 'active')
    .maybeSingle();
  if (result.error) throw result.error;
  const qr = result.data;
  const location = qr?.location;
  if (!qr || !location || location.is_active !== true || location.client?.is_active !== true || location.client?.parent_client?.is_active === false || location.block?.is_active !== true || location.floor?.is_active === false || location.department?.is_active === false) {
    return genericInvalidQr();
  }
  const session = createPublicFeedbackSession({ qrId: qr.id, locationId: qr.location_id }, environment, now);
  return {
    valid: true,
    location: safeLocationFromRow(qr),
    session: {
      token: session.token,
      expiresAt: session.expiresAt,
      expiresInSeconds: session.expiresInSeconds,
    },
  };
}

function cleanLanguage(value) {
  const language = cleanText(value, 8).toLowerCase();
  if (['en', 'ta'].includes(language)) return language;
  const error = new Error('Unsupported feedback language.');
  error.statusCode = 400;
  error.code = 'invalid_language';
  throw error;
}

function cleanRating(value) {
  if (typeof value !== 'number') {
    const error = new Error('Rating must be an integer from 1 to 5.');
    error.statusCode = 400;
    error.code = 'invalid_rating';
    throw error;
  }
  const rating = value;
  if (Number.isInteger(rating) && rating >= 1 && rating <= 5) return rating;
  const error = new Error('Rating must be between 1 and 5.');
  error.statusCode = 400;
  error.code = 'invalid_rating';
  throw error;
}

const DANGEROUS_JSON_KEYS = new Set(['__proto__', 'prototype', 'constructor']);

function assertSafeJsonKeys(value, pathPrefix = 'answers') {
  if (!value || typeof value !== 'object') return;
  if (Array.isArray(value)) {
    for (const item of value) assertSafeJsonKeys(item, pathPrefix);
    return;
  }
  for (const [key, child] of Object.entries(value)) {
    if (DANGEROUS_JSON_KEYS.has(key)) {
      const error = new Error('Feedback answers contain unsupported fields.');
      error.statusCode = 400;
      error.code = 'unsafe_answers';
      throw error;
    }
    assertSafeJsonKeys(child, `${pathPrefix}.${key}`);
  }
}

function sortJsonValue(value) {
  if (Array.isArray(value)) return value.map(sortJsonValue);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(
    Object.entries(value)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, child]) => [key, sortJsonValue(child)]),
  );
}

function cleanSubmissionAnswers(value) {
  if (value == null) return {};
  if (typeof value !== 'object' || Array.isArray(value)) {
    const error = new Error('Feedback answers must be a JSON object.');
    error.statusCode = 400;
    error.code = 'invalid_answers';
    throw error;
  }
  assertSafeJsonKeys(value);
  const normalized = sortJsonValue(value);
  const text = JSON.stringify(normalized);
  if (text.length > 16 * 1024) {
    const error = new Error('Feedback answers payload is too large.');
    error.statusCode = 413;
    error.code = 'answers_too_large';
    throw error;
  }
  return normalized;
}

function normalizedAnswersText(value) {
  return JSON.stringify(sortJsonValue(value || {}));
}

function idempotencyConflict(code, message) {
  const error = new Error(message);
  error.statusCode = 409;
  error.code = code;
  return error;
}

function sameNormalizedSubmission(existing = {}, expected = {}) {
  return (
    existing.qr_code_id === expected.qrCodeId &&
    existing.location_id === expected.locationId &&
    Number(existing.rating) === expected.rating &&
    cleanLanguage(existing.language) === expected.language &&
    (normalizeRespondentName(existing.respondent_name) || null) === expected.respondentName &&
    (normalizeText(existing.comments, 2000) || null) === expected.comments &&
    normalizedAnswersText(existing.answers || {}) === normalizedAnswersText(expected.answers)
  );
}

function assertExistingSubmissionMatches(existing, expected) {
  if (!existing) return null;
  if (existing.qr_code_id !== expected.qrCodeId || existing.location_id !== expected.locationId) {
    throw idempotencyConflict(
      'SUBMISSION_KEY_REUSED',
      'This submission reference has already been used.',
    );
  }
  if (!sameNormalizedSubmission(existing, expected)) {
    throw idempotencyConflict(
      'IDEMPOTENCY_PAYLOAD_MISMATCH',
      'This submission reference was already used with different feedback.',
    );
  }
  return publicSubmissionResponse(existing);
}

async function findSubmissionByKey(client, submissionKey) {
  const existing = await client
    .from('hospital_feedback_submissions')
    .select('qr_code_id,location_id,rating,language,respondent_name,comments,answers,needs_attention,submitted_at,created_at')
    .eq('submission_key', submissionKey)
    .maybeSingle();
  if (existing.error) throw existing.error;
  return existing.data || null;
}

function normalizeSubmissionPayload(payload = {}, qr) {
  const location = qr.location;
  const rating = cleanRating(payload.rating);
  const language = cleanLanguage(payload.language);
  const respondentName = normalizeRespondentName(payload.respondent_name);
  const comments = normalizeText(payload.comments, 2000);
  const answers = cleanSubmissionAnswers(payload.answers);
  return {
    qrCodeId: qr.id,
    locationId: location.id,
    parentClientId: location.client?.parent_client_id || null,
    hospitalId: location.client_id,
    blockId: location.block_id || null,
    floorId: location.floor_id || null,
    departmentId: location.department_id || null,
    respondentName,
    rating,
    language,
    comments,
    answers,
    needsAttention: rating < 4,
  };
}

function publicSubmissionResponse(row) {
  return {
    ok: true,
    submission: {
      submitted: true,
      rating: Number(row.rating || 0),
      needsAttention: row.needs_attention === true,
      submittedAt: row.submitted_at || row.created_at || null,
    },
  };
}

async function loadActiveQrForSession(client, qrId, locationId) {
  const result = await client
    .from('hospital_feedback_qr_codes')
    .select('id,status,location_id,location:hospital_locations(id,client_id,block_id,floor_id,department_id,location_name,location_type,is_active,floor_name,department_name,client:hospital_clients(id,client_code,client_name,parent_client_id,is_active,metadata,parent_client:hospital_parent_clients(id,client_code,client_name,is_active)),block:hospital_blocks(id,block_name,is_active),floor:hospital_floors(id,floor_name,is_active),department:hospital_departments(id,department_name,is_active))')
    .eq('id', cleanUuid(qrId, 'qr_code_id'))
    .eq('location_id', cleanUuid(locationId, 'location_id'))
    .eq('status', 'active')
    .maybeSingle();
  if (result.error) throw result.error;
  const qr = result.data;
  const location = qr?.location;
  if (!qr || !location || location.is_active !== true || location.client?.is_active !== true || location.client?.parent_client?.is_active === false || location.block?.is_active !== true || location.floor?.is_active === false || location.department?.is_active === false) {
    const error = new Error('This feedback session is no longer valid.');
    error.statusCode = 401;
    error.code = 'public_session_invalid';
    throw error;
  }
  return qr;
}

export async function submitPublicHospitalFeedback({
  client,
  payload = {},
  now = new Date(),
}) {
  const session = publicFeedbackSessionBinding(payload.session_token, now);
  if (!session) {
    const error = new Error('This feedback session has expired. Please scan the QR code again.');
    error.statusCode = 401;
    error.code = 'PUBLIC_SESSION_EXPIRED';
    throw error;
  }
  const submissionKey = cleanUuid(payload.submission_key, 'submission_key');
  const qr = await loadActiveQrForSession(client, session.qrId, session.locationId);
  const normalized = normalizeSubmissionPayload(payload, qr);
  const existing = await findSubmissionByKey(client, submissionKey);
  const retryResponse = assertExistingSubmissionMatches(existing, normalized);
  if (retryResponse) return retryResponse;

  const insertResult = await client
    .from('hospital_feedback_submissions')
    .insert({
      qr_code_id: normalized.qrCodeId,
      location_id: normalized.locationId,
      parent_client_id: normalized.parentClientId,
      hospital_id: normalized.hospitalId,
      block_id: normalized.blockId,
      floor_id: normalized.floorId,
      department_id: normalized.departmentId,
      respondent_name: normalized.respondentName,
      rating: normalized.rating,
      language: normalized.language,
      comments: normalized.comments,
      answers: normalized.answers,
      needs_attention: normalized.needsAttention,
      submission_key: submissionKey,
      submitted_at: now.toISOString(),
      metadata: { source: 'public_feedback_qr' },
    })
    .select('rating,needs_attention,submitted_at,created_at')
    .single();
  if (insertResult.error) {
    if (insertResult.error.code === '23505') {
      const retry = await findSubmissionByKey(client, submissionKey);
      const concurrentRetryResponse = assertExistingSubmissionMatches(retry, normalized);
      if (concurrentRetryResponse) return concurrentRetryResponse;
    }
    throw insertResult.error;
  }
  return publicSubmissionResponse(insertResult.data);
}

function invalidDateError(message) {
  const error = new Error(message);
  error.statusCode = 400;
  error.code = 'invalid_dashboard_date';
  return error;
}

function parseDashboardDate(value, fieldName) {
  const text = cleanText(value, 40);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) {
    throw invalidDateError(`${fieldName} must use YYYY-MM-DD format.`);
  }
  const [year, month, day] = text.split('-').map(Number);
  const utc = new Date(Date.UTC(year, month - 1, day));
  if (
    utc.getUTCFullYear() !== year ||
    utc.getUTCMonth() !== month - 1 ||
    utc.getUTCDate() !== day
  ) {
    throw invalidDateError(`${fieldName} must be a valid calendar date.`);
  }
  return { text, year, month, day };
}

function addCalendarDays(dateParts, days) {
  const utc = new Date(Date.UTC(dateParts.year, dateParts.month - 1, dateParts.day + days));
  return {
    text: [
      utc.getUTCFullYear(),
      String(utc.getUTCMonth() + 1).padStart(2, '0'),
      String(utc.getUTCDate()).padStart(2, '0'),
    ].join('-'),
    year: utc.getUTCFullYear(),
    month: utc.getUTCMonth() + 1,
    day: utc.getUTCDate(),
  };
}

function kolkataStartBoundary(dateParts) {
  return new Date(`${dateParts.text}T00:00:00.000+05:30`).toISOString();
}

export function dashboardDateRange(filters = {}, now = new Date()) {
  const defaults = monthRangeInKolkata(now);
  const fromParts = parseDashboardDate(filters.dateFrom || defaults.dateFrom, 'dateFrom');
  const toParts = parseDashboardDate(filters.dateTo || defaults.dateTo, 'dateTo');
  if (fromParts.text > toParts.text) {
    throw invalidDateError('dateFrom must be on or before dateTo.');
  }
  return {
    from: kolkataStartBoundary(fromParts),
    toExclusive: kolkataStartBoundary(addCalendarDays(toParts, 1)),
    dateFrom: fromParts.text,
    dateTo: toParts.text,
  };
}

function monthRangeInKolkata(now = new Date()) {
  const formatter = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata', year: 'numeric', month: '2-digit' });
  const parts = Object.fromEntries(formatter.formatToParts(now).map((part) => [part.type, part.value]));
  const start = `${parts.year}-${parts.month}-01`;
  const end = new Date(Number(parts.year), Number(parts.month), 0).getDate();
  return { dateFrom: start, dateTo: `${parts.year}-${parts.month}-${String(end).padStart(2, '0')}` };
}

const DASHBOARD_SELECT = [
  'id',
  'rating',
  'language',
  'respondent_name',
  'comments',
  'answers',
  'needs_attention',
  'submitted_at',
  'parent_client_id',
  'hospital_id',
  'block_id',
  'floor_id',
  'location_id',
  'parent_client:hospital_parent_clients(id,client_code,client_name)',
  'hospital:hospital_clients(id,client_code,client_name,parent_client_id)',
  'block:hospital_blocks(id,block_name)',
  'floor:hospital_floors(id,floor_name)',
  'location:hospital_locations(id,location_code,location_name,location_type)',
  'department:hospital_departments(id,department_name)',
].join(',');

function applySubmissionFilters(query, filters = {}, now = new Date()) {
  const range = dashboardDateRange(filters, now);
  query = query.gte('submitted_at', range.from);
  query = query.lt('submitted_at', range.toExclusive);
  for (const [param, column] of [
    ['parentClientId', 'parent_client_id'],
    ['hospitalId', 'hospital_id'],
    ['blockId', 'block_id'],
    ['floorId', 'floor_id'],
    ['locationId', 'location_id'],
  ]) {
    const value = optionalUuid(filters[param], param);
    if (value) query = query.eq(column, value);
  }
  const rating = Number(filters.rating);
  if (Number.isInteger(rating) && rating >= 1 && rating <= 5) query = query.eq('rating', rating);
  if (String(filters.needsAttention || '').toLowerCase() === 'true') query = query.eq('needs_attention', true);
  if (String(filters.needsAttention || '').toLowerCase() === 'false') query = query.eq('needs_attention', false);
  return query;
}

function submissionLocationForAccess(row = {}) {
  return {
    id: row.location_id,
    client_id: row.hospital_id,
    block_id: row.block_id,
  };
}

function submissionLabel(row = {}) {
  return {
    parentClientId: row.parent_client_id || '',
    parentClientName: cleanText(row.parent_client?.client_name),
    hospitalId: row.hospital_id || '',
    hospitalName: cleanText(row.hospital?.client_name),
    blockId: row.block_id || '',
    blockName: cleanText(row.block?.block_name),
    floorId: row.floor_id || '',
    floorName: cleanText(row.floor?.floor_name),
    locationId: row.location_id || '',
    locationName: cleanText(row.location?.location_name),
    locationType: cleanText(row.location?.location_type),
  };
}

const naturalCollator = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' });

function numericFromText(value) {
  const match = String(value || '').match(/\d+/);
  return match ? Number(match[0]) : Number.POSITIVE_INFINITY;
}

function naturalCompare(a, b) {
  return naturalCollator.compare(String(a || ''), String(b || ''));
}

function aggregateBy(rows, keyFn, labelFn) {
  const map = new Map();
  for (const row of rows) {
    const key = keyFn(row) || 'unassigned';
    if (!map.has(key)) {
      map.set(key, { key, ...labelFn(row), totalResponses: 0, ratingSum: 0, ratings: { 5: 0, 4: 0, 3: 0, 2: 0, 1: 0 }, needsAttention: 0 });
    }
    const item = map.get(key);
    const rating = Number(row.rating || 0);
    item.totalResponses += 1;
    item.ratingSum += rating;
    item.ratings[rating] = (item.ratings[rating] || 0) + 1;
    if (row.needs_attention) item.needsAttention += 1;
  }
  return Array.from(map.values()).map((item) => {
    const averageRating = item.totalResponses ? Number((item.ratingSum / item.totalResponses).toFixed(2)) : 0;
    return {
      ...item,
      averageRating,
      fiveStar: item.ratings[5] || 0,
      fourStar: item.ratings[4] || 0,
      threeStar: item.ratings[3] || 0,
      twoStar: item.ratings[2] || 0,
      oneStar: item.ratings[1] || 0,
      performance: performanceLabel(averageRating, item.totalResponses),
      ratingSum: undefined,
      ratings: undefined,
    };
  }).sort((a, b) =>
    Number(a.sortOrder ?? numericFromText(a.blockName || a.floorName || a.locationName || a.name)) -
      Number(b.sortOrder ?? numericFromText(b.blockName || b.floorName || b.locationName || b.name)) ||
    naturalCompare(a.blockName || a.floorName || a.locationName || a.name || a.key, b.blockName || b.floorName || b.locationName || b.name || b.key) ||
    String(a.key).localeCompare(String(b.key)));
}

function performanceLabel(averageRating, count) {
  if (!count) return 'No Data';
  if (averageRating >= 4.5) return 'Excellent';
  if (averageRating >= 4) return 'Good';
  if (averageRating >= 3) return 'Needs Attention';
  return 'Critical';
}

function dailyKey(value) {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata' }).format(new Date(value));
}

function bestAndLowestBlocks(blocks) {
  const withResponses = blocks.filter((block) => block.totalResponses > 0);
  const byAverageThenName = [...withResponses].sort((a, b) =>
    b.averageRating - a.averageRating ||
    b.totalResponses - a.totalResponses ||
    Number(a.sortOrder ?? numericFromText(a.blockName)) - Number(b.sortOrder ?? numericFromText(b.blockName)) ||
    String(a.blockId || a.key).localeCompare(String(b.blockId || b.key)));
  const lowAverageThenName = [...withResponses].sort((a, b) =>
    a.averageRating - b.averageRating ||
    b.totalResponses - a.totalResponses ||
    Number(a.sortOrder ?? numericFromText(a.blockName)) - Number(b.sortOrder ?? numericFromText(b.blockName)) ||
    String(a.blockId || a.key).localeCompare(String(b.blockId || b.key)));
  return {
    bestBlock: byAverageThenName[0] || null,
    lowestBlock: lowAverageThenName[0] || null,
  };
}

export function aggregateHospitalFeedbackDashboardRows(rows = []) {
  const totalResponses = rows.length;
  const ratingSum = rows.reduce((sum, row) => sum + Number(row.rating || 0), 0);
  const fiveStarCount = rows.filter((row) => Number(row.rating) === 5).length;
  const belowFourCount = rows.filter((row) => Number(row.rating) < 4).length;
  const blockPerformance = aggregateBy(
    rows,
    (row) => row.block_id,
    (row) => ({
      blockId: row.block_id || '',
      blockName: submissionLabel(row).blockName || 'Legacy / Not Assigned',
      sortOrder: row.block?.sort_order ?? numericFromText(submissionLabel(row).blockName),
    }),
  );
  const { bestBlock, lowestBlock } = bestAndLowestBlocks(blockPerformance);
  const dailyTrend = aggregateBy(
    rows,
    (row) => dailyKey(row.submitted_at),
    (row) => ({ date: dailyKey(row.submitted_at), name: dailyKey(row.submitted_at) }),
  ).sort((a, b) => String(a.date).localeCompare(String(b.date)));
  const floorPerformance = aggregateBy(
    rows,
    (row) => row.floor_id,
    (row) => ({
      floorId: row.floor_id || '',
      floorName: submissionLabel(row).floorName || 'Legacy / Not Assigned',
      blockName: submissionLabel(row).blockName,
      sortOrder: row.floor?.floor_number ?? numericFromText(submissionLabel(row).floorName),
    }),
  );
  const locationPerformance = aggregateBy(
    rows,
    (row) => row.location_id,
    (row) => ({
      ...submissionLabel(row),
      name: submissionLabel(row).locationName || 'Location',
      sortOrder: row.location?.sort_order ?? numericFromText(submissionLabel(row).locationName),
    }),
  );
  const recentNeedsAttention = rows
    .filter((row) => row.needs_attention)
    .slice(0, 25)
    .map((row) => ({
      id: row.id,
      submittedAt: row.submitted_at,
      rating: Number(row.rating || 0),
      language: row.language,
      respondentName: cleanText(row.respondent_name, 120) || null,
      comments: cleanText(row.comments, 2000) || null,
      answers: row.answers && typeof row.answers === 'object' && !Array.isArray(row.answers) ? row.answers : {},
      ...submissionLabel(row),
    }));
  const recentFeedback = rows
    .slice(0, 100)
    .map((row) => ({
      id: row.id,
      submittedAt: row.submitted_at,
      rating: Number(row.rating || 0),
      language: row.language,
      respondentName: cleanText(row.respondent_name, 120) || null,
      comments: cleanText(row.comments, 2000) || null,
      answers: row.answers && typeof row.answers === 'object' && !Array.isArray(row.answers) ? row.answers : {},
      needsAttention: row.needs_attention === true,
      ...submissionLabel(row),
    }));
  return {
    ok: true,
    summary: {
      totalResponses,
      averageRating: totalResponses ? Number((ratingSum / totalResponses).toFixed(2)) : 0,
      fiveStarCount,
      fiveStarPercentage: totalResponses ? Number(((fiveStarCount / totalResponses) * 100).toFixed(2)) : 0,
      belowFourCount,
      bestBlock,
      lowestBlock,
    },
    blockPerformance,
    dailyTrend,
    floorPerformance,
    locationPerformance,
    recentFeedback,
    recentNeedsAttention,
  };
}

export async function getHospitalFeedbackDashboard({
  client,
  authUser,
  profile,
  filters = {},
  now = new Date(),
}) {
  let query = client
    .from('hospital_feedback_submissions')
    .select(DASHBOARD_SELECT)
    .order('submitted_at', { ascending: false });
  query = applySubmissionFilters(query, filters, now);
  const result = await query.limit(5000);
  if (result.error) throw result.error;
  const rows = [];
  for (const row of result.data || []) {
    try {
      await assertHospitalFeedbackQrAccess({ client, authUser, profile, location: submissionLocationForAccess(row), permission: 'view' });
      rows.push(row);
    } catch (error) {
      if (error.statusCode !== 403) throw error;
    }
  }
  return aggregateHospitalFeedbackDashboardRows(rows);
}

export function invalidQrResponse() {
  return genericInvalidQr();
}
