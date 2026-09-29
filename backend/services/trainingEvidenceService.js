import { randomUUID } from 'node:crypto';
import {
  cleanTrainingText,
  loadAuthorizedTrainingSession,
  trainingError,
  translateTrainingDatabaseError,
} from './trainingAccessService.js';

export const TRAINING_EVIDENCE_BUCKET = 'training-evidence';
export const TRAINING_EVIDENCE_MAX_BYTES = 5 * 1024 * 1024;
export const TRAINING_EVIDENCE_VIEW_TTL_SECONDS = 10 * 60;

const MIME_BY_TYPE = new Map([
  ['topic_photo', new Set(['image/jpeg', 'image/png'])],
  ['group_photo', new Set(['image/jpeg', 'image/png'])],
  ['attendance_sheet', new Set(['application/pdf', 'image/jpeg', 'image/png'])],
  ['training_document', new Set(['application/pdf'])],
  ['additional_document', new Set(['application/pdf', 'image/jpeg', 'image/png'])],
]);

function extensionForMime(mimeType) {
  if (mimeType === 'application/pdf') return 'pdf';
  if (mimeType === 'image/png') return 'png';
  return 'jpg';
}
function safeFileName(value, mimeType) {
  const original = cleanTrainingText(value) || `evidence.${extensionForMime(mimeType)}`;
  const sanitized = original
    .replace(/[^a-zA-Z0-9._-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 120);
  return sanitized || `evidence.${extensionForMime(mimeType)}`;
}

export function validateTrainingEvidenceInput(input = {}) {
  const evidenceType = cleanTrainingText(input.evidence_type).toLowerCase();
  const mimeType = cleanTrainingText(input.mime_type).toLowerCase();
  const fileSize = Number(input.file_size);
  const topicId = cleanTrainingText(input.training_session_topic_id) || null;
  if (!MIME_BY_TYPE.has(evidenceType)) {
    throw trainingError(400, 'invalid_evidence_type', 'Unsupported Training evidence type.');
  }
  if (!MIME_BY_TYPE.get(evidenceType).has(mimeType)) {
    throw trainingError(415, 'unsupported_mime_type', 'Unsupported Training evidence file type.');
  }
  if (!Number.isInteger(fileSize) || fileSize < 1) {
    throw trainingError(400, 'invalid_file_size', 'Evidence file size must be a positive integer.');
  }
  if (fileSize > TRAINING_EVIDENCE_MAX_BYTES) {
    throw trainingError(413, 'file_too_large', 'Training evidence must be 5 MB or smaller.');
  }
  if (evidenceType === 'topic_photo' && !topicId) {
    throw trainingError(400, 'topic_required', 'Topic photo evidence requires a selected session topic.');
  }
  if (evidenceType !== 'topic_photo' && topicId) {
    throw trainingError(400, 'topic_not_allowed', 'Supporting evidence cannot be assigned to a topic.');
  }
  return {
    evidenceType,
    mimeType,
    fileSize,
    topicId,
    fileName: safeFileName(input.file_name || input.filename, mimeType),
  };
}

async function evidenceRow(client, sessionId, evidenceId) {
  const { data, error } = await client.from('training_evidence')
    .select('*').eq('id', evidenceId).eq('training_session_id', sessionId).maybeSingle();
  if (error) throw error;
  if (!data) throw trainingError(404, 'evidence_not_found', 'Training evidence was not found.');
  return data;
}

function expectedPrefix(sessionId, evidenceId) {
  return `training/${sessionId}/${evidenceId}/`;
}

function assertServerPath(row) {
  const prefix = expectedPrefix(row.training_session_id, row.id);
  if (row.storage_bucket !== TRAINING_EVIDENCE_BUCKET || !cleanTrainingText(row.storage_path).startsWith(prefix)) {
    throw trainingError(409, 'invalid_storage_path', 'Training evidence storage path is invalid.');
  }
}

async function storageObject(client, row) {
  assertServerPath(row);
  const segments = row.storage_path.split('/');
  const fileName = segments.pop();
  const folder = segments.join('/');
  const { data, error } = await client.storage.from(TRAINING_EVIDENCE_BUCKET)
    .list(folder, { limit: 100, search: fileName });
  if (error) throw error;
  const object = (data || []).find((item) => item.name === fileName);
  if (!object) throw trainingError(409, 'storage_object_missing', 'Uploaded Training evidence was not found in storage.');
  const storedSize = Number(object.metadata?.size ?? object.metadata?.contentLength ?? object.metadata?.content_length);
  if (Number.isFinite(storedSize) && storedSize !== Number(row.file_size)) {
    throw trainingError(409, 'storage_object_size_mismatch', 'Uploaded Training evidence size does not match the upload intent.');
  }
  const storedMime = cleanTrainingText(object.metadata?.mimetype || object.metadata?.contentType).toLowerCase();
  if (storedMime && storedMime !== cleanTrainingText(row.mime_type).toLowerCase()) {
    throw trainingError(409, 'storage_object_mime_mismatch', 'Uploaded Training evidence type does not match the upload intent.');
  }
  return object;
}

export async function createTrainingEvidenceUploadUrl(client, profile, sessionId, input = {}) {
  await loadAuthorizedTrainingSession(client, profile, sessionId, { editable: true });
  const validated = validateTrainingEvidenceInput(input);
  if (validated.topicId) {
    const { data: topic, error } = await client.from('training_session_topics')
      .select('id').eq('id', validated.topicId).eq('training_session_id', sessionId).maybeSingle();
    if (error) throw error;
    if (!topic) throw trainingError(400, 'topic_mismatch', 'Selected topic does not belong to this Training session.');
  }
  const evidenceId = randomUUID();
  const storagePath = `${expectedPrefix(sessionId, evidenceId)}${validated.fileName}`;
  const pending = {
    id: evidenceId,
    training_session_id: sessionId,
    training_session_topic_id: validated.topicId,
    evidence_type: validated.evidenceType,
    storage_bucket: TRAINING_EVIDENCE_BUCKET,
    storage_path: storagePath,
    file_name: validated.fileName,
    mime_type: validated.mimeType,
    file_size: validated.fileSize,
    uploaded_by: profile.id,
    metadata: { upload_status: 'pending' },
  };
  const { error: insertError } = await client.from('training_evidence').insert(pending);
  if (insertError) throw translateTrainingDatabaseError(insertError);
  try {
    const { data, error } = await client.storage.from(TRAINING_EVIDENCE_BUCKET)
      .createSignedUploadUrl(storagePath, { upsert: false });
    if (error) throw error;
    return {
      evidence_id: evidenceId,
      storage_path: storagePath,
      signed_upload_url: data?.signedUrl || data?.signedURL || null,
      token: data?.token || null,
      expires_at: new Date(Date.now() + (2 * 60 * 60 * 1000)).toISOString(),
    };
  } catch (error) {
    await client.from('training_evidence').delete().eq('id', evidenceId).eq('training_session_id', sessionId);
    throw error;
  }
}

export async function completeTrainingEvidence(client, profile, sessionId, input = {}) {
  await loadAuthorizedTrainingSession(client, profile, sessionId, { editable: true });
  const evidenceId = cleanTrainingText(input.evidence_id);
  if (!evidenceId) throw trainingError(400, 'evidence_id_required', 'evidence_id is required.');
  const row = await evidenceRow(client, sessionId, evidenceId);
  if (row.metadata?.upload_status === 'uploaded') return row;
  const fields = {
    evidence_type: 'evidence_type',
    training_session_topic_id: 'training_session_topic_id',
    file_name: 'file_name',
    mime_type: 'mime_type',
    file_size: 'file_size',
  };
  for (const [inputKey, rowKey] of Object.entries(fields)) {
    if (input[inputKey] == null) continue;
    if (String(input[inputKey] ?? '') !== String(row[rowKey] ?? '')) {
      throw trainingError(409, 'upload_intent_mismatch', 'Upload completion does not match the server-issued intent.');
    }
  }
  await storageObject(client, row);
  const { data, error } = await client.rpc('rpc_complete_reliance_training_evidence', {
    p_session_id: sessionId,
    p_actor_profile_id: profile.id,
    p_evidence_id: evidenceId,
  });
  if (error) throw translateTrainingDatabaseError(error);
  return evidenceRow(client, sessionId, data || evidenceId);
}

export async function deleteTrainingEvidence(client, profile, sessionId, evidenceId) {
  await loadAuthorizedTrainingSession(client, profile, sessionId, { editable: true });
  const row = await evidenceRow(client, sessionId, evidenceId);
  assertServerPath(row);
  const { error: storageError } = await client.storage.from(TRAINING_EVIDENCE_BUCKET).remove([row.storage_path]);
  if (storageError) throw trainingError(409, 'storage_delete_failed', 'Training evidence could not be removed from storage.');
  const { error } = await client.rpc('rpc_delete_reliance_training_evidence', {
    p_session_id: sessionId,
    p_actor_profile_id: profile.id,
    p_evidence_id: evidenceId,
  });
  if (error) throw translateTrainingDatabaseError(error);
  return { id: evidenceId };
}

export async function createTrainingEvidenceViewUrl(client, profile, sessionId, evidenceId) {
  await loadAuthorizedTrainingSession(client, profile, sessionId);
  const row = await evidenceRow(client, sessionId, evidenceId);
  if (row.metadata?.upload_status !== 'uploaded') {
    throw trainingError(409, 'evidence_not_ready', 'Training evidence upload is not complete.');
  }
  await storageObject(client, row);
  const { data, error } = await client.storage.from(TRAINING_EVIDENCE_BUCKET)
    .createSignedUrl(row.storage_path, TRAINING_EVIDENCE_VIEW_TTL_SECONDS);
  if (error) throw error;
  return {
    url: data?.signedUrl || null,
    expires_at: new Date(Date.now() + (TRAINING_EVIDENCE_VIEW_TTL_SECONDS * 1000)).toISOString(),
  };
}

export async function verifyTrainingEvidenceObjects(client, profile, sessionId) {
  await loadAuthorizedTrainingSession(client, profile, sessionId, { editable: true });
  const { data, error } = await client.from('training_evidence').select('*').eq('training_session_id', sessionId);
  if (error) throw error;
  for (const row of data || []) {
    if (row.metadata?.upload_status !== 'uploaded') {
      throw trainingError(409, 'evidence_upload_incomplete', 'All evidence uploads must complete before submission.');
    }
    await storageObject(client, row);
  }
  return true;
}
