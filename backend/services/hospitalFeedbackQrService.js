import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import QRCode from 'qrcode';
import sharp from 'sharp';

import { resolveCurrentUserAccess } from './accessControlService.js';
import { scopeAllows } from './hospitalTicketAuthService.js';

const TOKEN_PATTERN = /^[A-Za-z0-9_-]{22,160}$/;
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

function cleanUuid(value, fieldName = 'id') {
  const text = cleanText(value, 80);
  if (/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(text)) {
    return text;
  }
  const error = new Error(`${fieldName} must be a valid UUID.`);
  error.statusCode = 400;
  error.code = 'invalid_uuid';
  throw error;
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
  return {
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
    hospitalId: cleanText(location.client_id, 80),
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
    hospitalId: location.hospitalId,
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
    .select('id,client_id,block_id,floor_id,department_id,location_name,location_code,location_type,is_active,client:hospital_clients(id,client_name,is_active),block:hospital_blocks(id,block_name,is_active),floor:hospital_floors(id,floor_name,is_active),department:hospital_departments(id,department_name,is_active)')
    .eq('is_active', true)
    .order('location_name');
  const result = await query.limit(1000);
  if (result.error) throw result.error;
  const locations = [];
  for (const row of result.data || []) {
    if (row.client?.is_active === false || row.block?.is_active === false) continue;
    try {
      await assertHospitalFeedbackQrAccess({ client, authUser, profile, location: row, permission: 'view' });
      locations.push({
        id: row.id,
        hospitalId: row.client_id,
        hospitalName: row.client?.client_name || '',
        blockId: row.block_id,
        blockName: row.block?.block_name || '',
        floorId: row.floor_id || '',
        floorName: row.floor?.floor_name || '',
        departmentId: row.department_id || '',
        departmentName: row.department?.department_name || '',
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
    .select('id,client_id,block_id,floor_id,department_id,location_name,location_code,location_type,is_active,client:hospital_clients(id,client_name,is_active),block:hospital_blocks(id,block_name,is_active),floor:hospital_floors(id,floor_name,is_active),department:hospital_departments(id,department_name,is_active)')
    .eq('id', cleanUuid(locationId, 'location_id'))
    .maybeSingle();
  if (result.error) throw result.error;
  if (!result.data || result.data.is_active !== true || result.data.client?.is_active === false || result.data.block?.is_active === false) {
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
  'location:hospital_locations(id,client_id,block_id,floor_id,department_id,location_name,location_code,location_type,is_active,floor_name,department_name,client:hospital_clients(id,client_name,is_active),block:hospital_blocks(id,block_name,is_active),floor:hospital_floors(id,floor_name,is_active),department:hospital_departments(id,department_name,is_active))',
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

function matchesQrRegistryFilters(row, filters = {}) {
  const location = safeLocationListFromRow(row);
  const hospitalId = optionalUuid(filters.hospitalId || filters.clientId, 'hospitalId');
  const blockId = optionalUuid(filters.blockId, 'blockId');
  if (hospitalId && location.hospitalId !== hospitalId) return false;
  if (blockId && location.blockId !== blockId) return false;
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
    .select('id,status,location_id,location:hospital_locations(id,client_id,block_id,floor_id,department_id,location_name,location_type,is_active,floor_name,department_name,client:hospital_clients(id,client_name,is_active,metadata),block:hospital_blocks(id,block_name,is_active),floor:hospital_floors(id,floor_name,is_active),department:hospital_departments(id,department_name,is_active))')
    .eq('token_lookup_key', tokenLookupKey(token))
    .eq('public_token_hash', hashPublicQrToken(token, environment))
    .eq('status', 'active')
    .maybeSingle();
  if (result.error) throw result.error;
  const qr = result.data;
  const location = qr?.location;
  if (!qr || !location || location.is_active !== true || location.client?.is_active !== true || location.block?.is_active !== true) {
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

export function invalidQrResponse() {
  return genericInvalidQr();
}
