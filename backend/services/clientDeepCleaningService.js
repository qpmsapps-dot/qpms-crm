import { randomUUID } from 'node:crypto';

export const CLIENT_DEEP_CLEANING_BUCKET = 'client-deep-cleaning-uploads';
export const CLIENT_DEEP_CLEANING_BUSINESS = 'Reliance Retail';
export const CLIENT_DEEP_CLEANING_MAX_BYTES = 5 * 1024 * 1024;
export const CLIENT_DEEP_CLEANING_VIEW_URL_TTL_SECONDS = 10 * 60;

const DRAFT_STATUSES = new Set(['draft', 'uploading']);
const UPLOAD_TYPES = new Set(['before', 'after', 'checklist', 'document']);
const IMAGE_MIME_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp']);
const DOCUMENT_MIME_TYPES = new Set(['application/pdf']);

export class ClientDeepCleaningError extends Error {
  constructor(statusCode, code, message) {
    super(message);
    this.name = 'ClientDeepCleaningError';
    this.statusCode = statusCode;
    this.code = code;
  }
}

export function clientDeepCleaningError(statusCode, code, message) {
  return new ClientDeepCleaningError(statusCode, code, message);
}

export function safeClientDeepCleaningError(response, error) {
  const status = Number(error?.statusCode || 500);
  response.status(status).json({
    ok: false,
    code: error?.code || (status >= 500 ? 'client_deep_cleaning_error' : 'invalid_request'),
    message: status >= 500 ? 'Deep Cleaning request failed.' : error.message,
  });
}

function text(value) {
  return String(value ?? '').trim();
}

function nullableText(value) {
  const clean = text(value);
  return clean || null;
}

function normalizeKey(value) {
  return text(value).toUpperCase().replace(/[^A-Z0-9]+/g, '');
}

function canonicalRole(value) {
  const key = normalizeKey(value);
  if (key === 'FO' || key === 'FIELDOFFICER') return 'FO';
  return text(value);
}

export function isRelianceRetailValue(value) {
  const key = normalizeKey(value);
  return key === 'RELIANCE' || key === 'RELIANCERETAIL';
}

export function isRelianceRetailStore(row) {
  if (!row) return false;
  return isRelianceRetailValue(row.business) || isRelianceRetailValue(row.client_name);
}

export function assertRelianceRetailFo(profile) {
  if (!profile) {
    throw clientDeepCleaningError(401, 'unauthenticated', 'Authentication is required.');
  }
  if (canonicalRole(profile.role) !== 'FO') {
    throw clientDeepCleaningError(403, 'forbidden_role', 'Only FO users can use this Deep Cleaning workflow.');
  }
  if (!isRelianceRetailValue(profile.business)) {
    throw clientDeepCleaningError(403, 'forbidden_business', 'Reliance Retail authorization is required.');
  }
  const authUserId = nullableText(profile.auth_user_id);
  const employeeCode = nullableText(profile.employee_code || profile.username);
  if (!authUserId || !employeeCode) {
    throw clientDeepCleaningError(403, 'profile_incomplete', 'Authenticated profile is missing required identity fields.');
  }
  return {
    userId: authUserId,
    employeeCode,
  };
}

function sanitizePathPart(value, fallback = 'value') {
  const clean = text(value)
    .replace(/[^a-zA-Z0-9._-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 120);
  return clean || fallback;
}

function extensionForMime(mimeType) {
  if (mimeType === 'image/png') return 'png';
  if (mimeType === 'image/webp') return 'webp';
  if (mimeType === 'application/pdf') return 'pdf';
  return 'jpg';
}

function uploadMimeSet(uploadType) {
  return uploadType === 'checklist' || uploadType === 'document'
    ? new Set([...IMAGE_MIME_TYPES, ...DOCUMENT_MIME_TYPES])
    : IMAGE_MIME_TYPES;
}

export function validateUploadInput(input = {}) {
  const uploadType = text(input.upload_type).toLowerCase();
  if (!UPLOAD_TYPES.has(uploadType)) {
    throw clientDeepCleaningError(400, 'invalid_upload_type', 'Upload type must be before, after, checklist, or document.');
  }
  const mimeType = text(input.mime_type).toLowerCase();
  if (!uploadMimeSet(uploadType).has(mimeType)) {
    throw clientDeepCleaningError(400, 'invalid_mime_type', 'Unsupported Deep Cleaning file type.');
  }
  const fileSize = Number(input.file_size);
  if (!Number.isInteger(fileSize) || fileSize < 1 || fileSize > CLIENT_DEEP_CLEANING_MAX_BYTES) {
    throw clientDeepCleaningError(400, 'invalid_file_size', 'Deep Cleaning uploads must be between 1 byte and 5 MB.');
  }
  return {
    uploadType,
    mimeType,
    fileSize,
    originalFilename: nullableText(input.filename || input.original_filename) || `upload.${extensionForMime(mimeType)}`,
  };
}

function validateDate(value, { required = false } = {}) {
  const clean = text(value);
  if (!clean) {
    if (required) throw clientDeepCleaningError(400, 'deep_cleaning_date_required', 'Deep Cleaning date is required.');
    return null;
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(clean)) {
    throw clientDeepCleaningError(400, 'invalid_deep_cleaning_date', 'Deep Cleaning date must be YYYY-MM-DD.');
  }
  return clean;
}

function validateDraftPayload(payload = {}, { requireStore = false } = {}) {
  const storeCode = nullableText(payload.store_code);
  if (requireStore && !storeCode) {
    throw clientDeepCleaningError(400, 'store_code_required', 'Store code is required.');
  }
  return {
    storeCode,
    deepCleaningDate: validateDate(payload.deep_cleaning_date),
    vendorName: nullableText(payload.vendor_name),
    remarks: nullableText(payload.remarks),
  };
}

export async function loadRelianceRetailStore(client, storeCode) {
  const code = nullableText(storeCode);
  if (!code) {
    throw clientDeepCleaningError(400, 'store_code_required', 'Store code is required.');
  }
  const { data, error } = await client
    .from('store_master')
    .select('id,store_code,store_name,client_name,state,business,metadata,status')
    .ilike('store_code', code)
    .limit(1)
    .maybeSingle();
  if (error) throw error;
  if (!data || !/^active$/i.test(text(data.status || 'Active'))) {
    throw clientDeepCleaningError(400, 'invalid_store', 'Store was not found or is inactive.');
  }
  if (!isRelianceRetailStore(data)) {
    throw clientDeepCleaningError(400, 'non_reliance_store', 'Store is not a Reliance Retail store.');
  }
  return data;
}

function storeSnapshot(store) {
  const metadata = store?.metadata && typeof store.metadata === 'object' && !Array.isArray(store.metadata)
    ? store.metadata
    : {};
  return {
    store_id: store?.id || null,
    store_code: text(store?.store_code),
    store_name: nullableText(store?.store_name),
    client_name: nullableText(store?.client_name),
    state: nullableText(store?.state),
    city: nullableText(metadata.city || metadata.location || metadata.store_city),
    store_format: nullableText(metadata.store_format || metadata.format),
  };
}

function submissionSelect() {
  return 'id,business,store_id,store_code,store_name,client_name,state,city,store_format,deep_cleaning_date,performed_by_type,vendor_name,submitted_by_user_id,submitted_by_employee_code,remarks,status,submitted_at,metadata,created_at,updated_at';
}

function uploadSelect() {
  return 'id,submission_id,upload_type,storage_bucket,storage_path,original_filename,mime_type,file_size,sequence_no,uploaded_by_user_id,upload_status,metadata,created_at,uploaded_at';
}

function storeSelect() {
  return 'id,store_code,store_name,client_name,state,business,metadata,status';
}

function serializeRelianceRetailStore(store) {
  const snapshot = storeSnapshot(store);
  return {
    id: snapshot.store_id,
    store_code: snapshot.store_code,
    store_name: snapshot.store_name,
    client_name: snapshot.client_name,
    state: snapshot.state,
    business: CLIENT_DEEP_CLEANING_BUSINESS,
    city: snapshot.city,
    store_format: snapshot.store_format,
  };
}

function safeSearchTerm(value) {
  return text(value).replace(/[,%()]/g, ' ').trim();
}

export async function searchRelianceRetailStores(client, profile, filters = {}) {
  assertRelianceRetailFo(profile);
  const limit = Math.max(1, Math.min(Number(filters.limit || 20), 50));
  const page = Math.max(1, Number(filters.page || 1));
  const from = (page - 1) * limit;
  const to = from + limit - 1;
  const q = safeSearchTerm(filters.q);
  let query = client
    .from('store_master')
    .select(storeSelect(), { count: 'exact' })
    .eq('status', 'Active')
    .or('business.ilike.%Reliance%,client_name.ilike.%Reliance%')
    .order('store_code', { ascending: true })
    .range(from, to);
  if (q) {
    query = query.or(`store_code.ilike.%${q}%,store_name.ilike.%${q}%`);
  }
  const { data, error, count } = await query;
  if (error) throw error;
  const rows = (data || [])
    .filter(isRelianceRetailStore)
    .map(serializeRelianceRetailStore);
  return { rows, pagination: { page, limit, total: count || rows.length } };
}

export async function createClientDeepCleaningSubmission(client, profile, payload = {}) {
  const actor = assertRelianceRetailFo(profile);
  const draft = validateDraftPayload(payload, { requireStore: true });
  const store = await loadRelianceRetailStore(client, draft.storeCode);
  const { data, error } = await client
    .from('client_deep_cleaning_submissions')
    .insert({
      business: CLIENT_DEEP_CLEANING_BUSINESS,
      ...storeSnapshot(store),
      deep_cleaning_date: draft.deepCleaningDate,
      performed_by_type: 'vendor',
      vendor_name: draft.vendorName,
      submitted_by_user_id: actor.userId,
      submitted_by_employee_code: actor.employeeCode,
      remarks: draft.remarks,
      status: 'draft',
      metadata: { source: 'client_deep_cleaning_api_v1' },
    })
    .select(submissionSelect())
    .single();
  if (error) throw error;
  return data;
}

export async function listClientDeepCleaningSubmissions(client, profile, filters = {}) {
  const actor = assertRelianceRetailFo(profile);
  const limit = Math.max(1, Math.min(Number(filters.limit || 25), 100));
  const page = Math.max(1, Number(filters.page || 1));
  const from = (page - 1) * limit;
  const to = from + limit - 1;
  let query = client
    .from('client_deep_cleaning_submissions')
    .select(submissionSelect(), { count: 'exact' })
    .eq('submitted_by_user_id', actor.userId)
    .order('created_at', { ascending: false })
    .range(from, to);
  if (filters.status) query = query.eq('status', text(filters.status));
  if (filters.store_code) query = query.ilike('store_code', text(filters.store_code));
  if (filters.from) query = query.gte('deep_cleaning_date', validateDate(filters.from));
  if (filters.to) query = query.lte('deep_cleaning_date', validateDate(filters.to));
  const { data, error, count } = await query;
  if (error) throw error;
  return { rows: data || [], pagination: { page, limit, total: count || 0 } };
}

export async function loadOwnedSubmission(client, profile, submissionId, { includeUploads = false } = {}) {
  const actor = assertRelianceRetailFo(profile);
  const id = nullableText(submissionId);
  if (!id) throw clientDeepCleaningError(400, 'submission_id_required', 'Submission ID is required.');
  const { data, error } = await client
    .from('client_deep_cleaning_submissions')
    .select(submissionSelect())
    .eq('id', id)
    .maybeSingle();
  if (error) throw error;
  if (!data || data.submitted_by_user_id !== actor.userId) {
    throw clientDeepCleaningError(404, 'submission_not_found', 'Deep Cleaning submission was not found.');
  }
  if (!includeUploads) return data;
  const { data: uploads, error: uploadError } = await client
    .from('client_deep_cleaning_uploads')
    .select(uploadSelect())
    .eq('submission_id', data.id)
    .order('sequence_no', { ascending: true })
    .order('created_at', { ascending: true });
  if (uploadError) throw uploadError;
  return { ...data, uploads: uploads || [] };
}

export async function updateClientDeepCleaningDraft(client, profile, submissionId, payload = {}) {
  const existing = await loadOwnedSubmission(client, profile, submissionId);
  if (!DRAFT_STATUSES.has(existing.status)) {
    throw clientDeepCleaningError(409, 'submitted_record_locked', 'Submitted Deep Cleaning records cannot be edited.');
  }
  const patch = validateDraftPayload(payload);
  const update = {};
  if (Object.prototype.hasOwnProperty.call(payload, 'store_code')) {
    if (!patch.storeCode) throw clientDeepCleaningError(400, 'store_code_required', 'Store code is required.');
    const store = await loadRelianceRetailStore(client, patch.storeCode);
    Object.assign(update, storeSnapshot(store));
  }
  if (Object.prototype.hasOwnProperty.call(payload, 'deep_cleaning_date')) update.deep_cleaning_date = patch.deepCleaningDate;
  if (Object.prototype.hasOwnProperty.call(payload, 'vendor_name')) update.vendor_name = patch.vendorName;
  if (Object.prototype.hasOwnProperty.call(payload, 'remarks')) update.remarks = patch.remarks;
  if (!Object.keys(update).length) return existing;
  const { data, error } = await client
    .from('client_deep_cleaning_submissions')
    .update(update)
    .eq('id', existing.id)
    .eq('submitted_by_user_id', existing.submitted_by_user_id)
    .select(submissionSelect())
    .single();
  if (error) throw error;
  return data;
}

export function buildClientDeepCleaningStoragePath({ submission, uploadType, mimeType, id = randomUUID() }) {
  const extension = extensionForMime(mimeType);
  return [
    'deep-cleaning',
    'reliance-retail',
    sanitizePathPart(submission.store_code, 'store'),
    sanitizePathPart(submission.id, 'submission'),
    uploadType === 'checklist' || uploadType === 'document' ? 'documents' : uploadType,
    `${sanitizePathPart(id, 'upload')}.${extension}`,
  ].join('/');
}

function expectedStoragePrefix(submission) {
  return `deep-cleaning/reliance-retail/${sanitizePathPart(submission.store_code, 'store')}/${sanitizePathPart(submission.id, 'submission')}/`;
}

export async function createClientDeepCleaningUploadUrl(client, profile, submissionId, payload = {}) {
  const submission = await loadOwnedSubmission(client, profile, submissionId);
  const actor = assertRelianceRetailFo(profile);
  if (!DRAFT_STATUSES.has(submission.status)) {
    throw clientDeepCleaningError(409, 'submitted_record_locked', 'Uploads cannot be added to a submitted Deep Cleaning record.');
  }
  const upload = validateUploadInput(payload);
  const { count, error: countError } = await client
    .from('client_deep_cleaning_uploads')
    .select('id', { count: 'exact', head: true })
    .eq('submission_id', submission.id)
    .eq('upload_type', upload.uploadType);
  if (countError) throw countError;
  const storagePath = buildClientDeepCleaningStoragePath({
    submission,
    uploadType: upload.uploadType,
    mimeType: upload.mimeType,
  });
  const { data: intent, error: intentError } = await client
    .from('client_deep_cleaning_uploads')
    .insert({
      submission_id: submission.id,
      upload_type: upload.uploadType,
      storage_bucket: CLIENT_DEEP_CLEANING_BUCKET,
      storage_path: storagePath,
      original_filename: upload.originalFilename,
      mime_type: upload.mimeType,
      file_size: upload.fileSize,
      sequence_no: (count || 0) + 1,
      uploaded_by_user_id: actor.userId,
      upload_status: 'pending',
      uploaded_at: null,
      metadata: { source: 'client_deep_cleaning_api_v1', intent_created_at: new Date().toISOString() },
    })
    .select(uploadSelect())
    .single();
  if (intentError) throw intentError;
  const { data, error } = await client.storage
    .from(CLIENT_DEEP_CLEANING_BUCKET)
    .createSignedUploadUrl(storagePath, { contentType: upload.mimeType });
  if (error) {
    await client
      .from('client_deep_cleaning_uploads')
      .delete()
      .eq('id', intent.id)
      .eq('upload_status', 'pending');
    throw error;
  }
  if (submission.status === 'draft') {
    await client
      .from('client_deep_cleaning_submissions')
      .update({ status: 'uploading' })
      .eq('id', submission.id)
      .eq('status', 'draft');
  }
  return {
    upload_id: intent.id,
    storage_bucket: CLIENT_DEEP_CLEANING_BUCKET,
    storage_path: storagePath,
    signed_url: data?.signedUrl,
    token: data?.token,
    upload_type: upload.uploadType,
    mime_type: upload.mimeType,
    max_file_size: CLIENT_DEEP_CLEANING_MAX_BYTES,
  };
}

function storageDirectoryAndName(path) {
  const clean = text(path).replace(/^\/+/, '');
  const slash = clean.lastIndexOf('/');
  if (slash < 0) return { directory: '', name: clean };
  return { directory: clean.slice(0, slash), name: clean.slice(slash + 1) };
}

export async function verifyClientDeepCleaningStorageObject(client, bucket, path, expectedSize = null) {
  const cleanBucket = nullableText(bucket);
  const cleanPath = nullableText(path);
  if (cleanBucket !== CLIENT_DEEP_CLEANING_BUCKET || !cleanPath) {
    throw clientDeepCleaningError(400, 'invalid_storage_path', 'A valid Deep Cleaning storage path is required.');
  }
  const { directory, name } = storageDirectoryAndName(cleanPath);
  const { data, error } = await client.storage
    .from(cleanBucket)
    .list(directory, { limit: 100, search: name });
  if (error) throw error;
  const object = (data || []).find((item) => item?.name === name);
  if (!object) {
    throw clientDeepCleaningError(409, 'storage_object_missing', 'Uploaded evidence file was not found in storage.');
  }
  const objectSize = Number(object.size ?? object.metadata?.size ?? object.metadata?.contentLength ?? 0);
  if (expectedSize != null && Number.isFinite(objectSize) && objectSize > 0 && objectSize !== expectedSize) {
    throw clientDeepCleaningError(409, 'storage_object_size_mismatch', 'Uploaded evidence file size does not match the upload intent.');
  }
  return object;
}

export async function completeClientDeepCleaningUpload(client, profile, submissionId, payload = {}) {
  const submission = await loadOwnedSubmission(client, profile, submissionId);
  const actor = assertRelianceRetailFo(profile);
  if (!DRAFT_STATUSES.has(submission.status)) {
    throw clientDeepCleaningError(409, 'submitted_record_locked', 'Uploads cannot be completed for a submitted Deep Cleaning record.');
  }
  const upload = validateUploadInput(payload);
  const storageBucket = nullableText(payload.storage_bucket) || CLIENT_DEEP_CLEANING_BUCKET;
  const storagePath = nullableText(payload.storage_path);
  if (storageBucket !== CLIENT_DEEP_CLEANING_BUCKET || !storagePath) {
    throw clientDeepCleaningError(400, 'invalid_storage_path', 'A valid Deep Cleaning storage path is required.');
  }
  const expectedPrefix = expectedStoragePrefix(submission);
  if (!storagePath.startsWith(expectedPrefix)) {
    throw clientDeepCleaningError(403, 'storage_path_forbidden', 'Storage path is outside this submission.');
  }
  const uploadId = nullableText(payload.upload_id);
  if (!uploadId) {
    throw clientDeepCleaningError(400, 'upload_id_required', 'Upload completion requires a server-issued upload ID.');
  }
  const { data: intent, error: intentError } = await client
    .from('client_deep_cleaning_uploads')
    .select(uploadSelect())
    .eq('id', uploadId)
    .eq('submission_id', submission.id)
    .maybeSingle();
  if (intentError) throw intentError;
  if (!intent || intent.uploaded_by_user_id !== actor.userId) {
    throw clientDeepCleaningError(404, 'upload_intent_not_found', 'Upload intent was not found for this submission.');
  }
  if (intent.upload_type !== upload.uploadType || intent.storage_bucket !== storageBucket || intent.storage_path !== storagePath) {
    throw clientDeepCleaningError(409, 'upload_intent_mismatch', 'Upload completion does not match the issued upload intent.');
  }
  if (intent.mime_type !== upload.mimeType || Number(intent.file_size) !== upload.fileSize) {
    throw clientDeepCleaningError(409, 'upload_intent_file_mismatch', 'Uploaded evidence metadata does not match the upload intent.');
  }
  if (intent.upload_status === 'uploaded') return intent;
  await verifyClientDeepCleaningStorageObject(client, storageBucket, storagePath, upload.fileSize);
  const { data, error } = await client
    .from('client_deep_cleaning_uploads')
    .update({
      upload_status: 'uploaded',
      uploaded_at: new Date().toISOString(),
      metadata: {
        ...(intent.metadata && typeof intent.metadata === 'object' ? intent.metadata : {}),
        completed_at: new Date().toISOString(),
        source: 'client_deep_cleaning_api_v1',
      },
    })
    .eq('id', intent.id)
    .eq('upload_status', 'pending')
    .select(uploadSelect())
    .single();
  if (error) throw error;
  return data;
}

export async function deleteClientDeepCleaningUpload(client, profile, submissionId, uploadId) {
  const submission = await loadOwnedSubmission(client, profile, submissionId);
  if (!DRAFT_STATUSES.has(submission.status)) {
    throw clientDeepCleaningError(409, 'submitted_record_locked', 'Submitted Deep Cleaning uploads cannot be deleted.');
  }
  const { data: upload, error: loadError } = await client
    .from('client_deep_cleaning_uploads')
    .select(uploadSelect())
    .eq('id', uploadId)
    .eq('submission_id', submission.id)
    .maybeSingle();
  if (loadError) throw loadError;
  if (!upload) throw clientDeepCleaningError(404, 'upload_not_found', 'Upload was not found.');
  const remove = await client.storage.from(upload.storage_bucket).remove([upload.storage_path]);
  if (remove.error) {
    try {
      await verifyClientDeepCleaningStorageObject(client, upload.storage_bucket, upload.storage_path);
      throw clientDeepCleaningError(409, 'storage_delete_failed', 'Deep Cleaning upload could not be removed from storage.');
    } catch (error) {
      if (error?.code !== 'storage_object_missing') throw error;
    }
  }
  const deleted = await client
    .from('client_deep_cleaning_uploads')
    .delete()
    .eq('id', upload.id)
    .eq('submission_id', submission.id);
  if (deleted.error) throw deleted.error;
  return { id: upload.id, storage_path: upload.storage_path };
}

export async function createClientDeepCleaningUploadViewUrl(client, profile, submissionId, uploadId) {
  const submission = await loadOwnedSubmission(client, profile, submissionId);
  const { data: upload, error: loadError } = await client
    .from('client_deep_cleaning_uploads')
    .select(uploadSelect())
    .eq('id', uploadId)
    .eq('submission_id', submission.id)
    .maybeSingle();
  if (loadError) throw loadError;
  if (!upload) {
    throw clientDeepCleaningError(404, 'upload_not_found', 'Upload was not found.');
  }
  if (upload.upload_status !== 'uploaded') {
    throw clientDeepCleaningError(409, 'upload_not_ready', 'Upload is not ready to view.');
  }
  if (upload.storage_bucket !== CLIENT_DEEP_CLEANING_BUCKET || !upload.storage_path) {
    throw clientDeepCleaningError(409, 'invalid_storage_path', 'Upload storage path is invalid.');
  }
  if (!upload.storage_path.startsWith(expectedStoragePrefix(submission))) {
    throw clientDeepCleaningError(409, 'storage_path_forbidden', 'Upload storage path is outside this submission.');
  }
  await verifyClientDeepCleaningStorageObject(
    client,
    upload.storage_bucket,
    upload.storage_path,
    Number(upload.file_size),
  );
  const { data, error } = await client.storage
    .from(CLIENT_DEEP_CLEANING_BUCKET)
    .createSignedUrl(upload.storage_path, CLIENT_DEEP_CLEANING_VIEW_URL_TTL_SECONDS);
  if (error) throw error;
  return {
    upload_id: upload.id,
    signed_url: data?.signedUrl,
    expires_in: CLIENT_DEEP_CLEANING_VIEW_URL_TTL_SECONDS,
    expires_at: new Date(Date.now() + CLIENT_DEEP_CLEANING_VIEW_URL_TTL_SECONDS * 1000).toISOString(),
  };
}

export async function submitClientDeepCleaningSubmission(client, profile, submissionId) {
  const submission = await loadOwnedSubmission(client, profile, submissionId, { includeUploads: true });
  if (submission.status === 'submitted') return submission;
  if (!DRAFT_STATUSES.has(submission.status)) {
    throw clientDeepCleaningError(409, 'invalid_status', 'Deep Cleaning submission cannot be submitted from its current status.');
  }
  if (!submission.deep_cleaning_date) {
    throw clientDeepCleaningError(400, 'deep_cleaning_date_required', 'Deep Cleaning date is required before submit.');
  }
  const completedUploads = submission.uploads.filter((upload) => upload.upload_status === 'uploaded');
  const beforeCount = completedUploads.filter((upload) => upload.upload_type === 'before').length;
  const afterCount = completedUploads.filter((upload) => upload.upload_type === 'after').length;
  if (beforeCount < 1) {
    throw clientDeepCleaningError(400, 'before_upload_required', 'At least one before image is required.');
  }
  if (afterCount < 1) {
    throw clientDeepCleaningError(400, 'after_upload_required', 'At least one after image is required.');
  }
  await Promise.all(
    completedUploads.map((upload) => verifyClientDeepCleaningStorageObject(
      client,
      upload.storage_bucket,
      upload.storage_path,
      Number(upload.file_size),
    )),
  );
  const { data, error } = await client
    .from('client_deep_cleaning_submissions')
    .update({
      status: 'submitted',
      submitted_at: new Date().toISOString(),
    })
    .eq('id', submission.id)
    .eq('submitted_by_user_id', submission.submitted_by_user_id)
    .in('status', [...DRAFT_STATUSES])
    .select(submissionSelect())
    .single();
  if (error) throw error;
  return { ...data, uploads: submission.uploads };
}
