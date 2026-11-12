import sharp from 'sharp';
import {withCombinedReleaseOperation} from './combinedReleaseGate.js';
import { removeRetiredEvidenceObject } from './retiredEvidenceStorageService.js';
import { randomUUID, createHash } from 'node:crypto';
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
  if (!Number.isFinite(storedSize) || storedSize !== Number(row.file_size)) {
    throw trainingError(409, 'storage_object_size_mismatch', 'Uploaded Training evidence size does not match the upload intent.');
  }
  const storedMime = cleanTrainingText(object.metadata?.mimetype || object.metadata?.contentType).toLowerCase();
  if (!storedMime || storedMime !== cleanTrainingText(row.mime_type).toLowerCase()) {
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
  const uploadKey = cleanTrainingText(input.upload_key);
  if (uploadKey.length > 160) throw trainingError(400, 'invalid_upload_key', 'Upload identity is too long.');
  // Deterministic identity also recovers an intent whose response was lost.
  const digest = uploadKey ? createHash('sha256').update(`${profile.id}:${sessionId}:${uploadKey}`).digest('hex') : null;
  const evidenceId = digest ? `${digest.slice(0,8)}-${digest.slice(8,12)}-4${digest.slice(13,16)}-a${digest.slice(17,20)}-${digest.slice(20,32)}` : randomUUID();
  if (uploadKey) {
    const {data: existing, error} = await client.from('training_evidence').select('*').eq('id', evidenceId).eq('training_session_id', sessionId).maybeSingle();
    if (error) throw error;
    if (existing) return reuseIntent(existing, validated, profile);
    const candidates = await client.from('training_evidence').select('*').eq('training_session_id',sessionId).eq('evidence_type',validated.evidenceType);
    if (candidates.error) throw candidates.error;
    const keyed = (candidates.data || []).find(e => e.metadata?.upload_key === uploadKey);
    if (keyed) return reuseIntent(keyed, validated, profile);
    const legacy = (candidates.data || []).filter(e => !e.metadata?.upload_key && e.uploaded_by === profile.id && e.file_name === validated.fileName && e.mime_type === validated.mimeType && Number(e.file_size) === validated.fileSize && (e.training_session_topic_id || null) === validated.topicId);
    if (legacy.length > 1) throw trainingError(409,'ambiguous_upload_intent','Multiple historical upload intents match. Review and remove duplicate pending evidence before retrying.');
    if (legacy.length === 1) {
      const row = legacy[0];
      const adopted = await client.from('training_evidence').update({metadata:{...row.metadata,upload_key:uploadKey}}).eq('id',row.id).eq('training_session_id',sessionId);
      if (adopted.error) throw translateTrainingDatabaseError(adopted.error);
      return reuseIntent(row, validated, profile);
    }
  }
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
    metadata: { upload_status: 'pending', ...(uploadKey ? {upload_key: uploadKey} : {}) },
  };
  const { error: insertError } = await client.from('training_evidence').insert(pending);
  if (insertError?.code === '23505' && uploadKey) return reuseIntent(await evidenceRow(client, sessionId, evidenceId), validated, profile);
  if (insertError) throw translateTrainingDatabaseError(insertError);
  return {
    evidence_id: evidenceId, storage_path: storagePath,
    signed_upload_url: `/api/training/sessions/${sessionId}/evidence/${evidenceId}/content`,
    token: null, expires_at: null,
  };
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
  let row;
  try { row = await evidenceRow(client, sessionId, evidenceId); }
  catch(error) {
    if(error.code!=='evidence_not_found') throw error;
    const replay=await client.from('evidence_storage_retirements').select('*')
      .eq('bucket',TRAINING_EVIDENCE_BUCKET).eq('evidence_id',evidenceId).eq('parent_id',sessionId).eq('owner_id',profile.id).maybeSingle();
    if(replay.error) throw replay.error;
    if(!replay.data || !replay.data.path?.startsWith(expectedPrefix(sessionId,evidenceId))) throw error;
    await removeRetiredEvidenceObject(client,{bucket:TRAINING_EVIDENCE_BUCKET,path:replay.data.path,evidenceId,parentId:sessionId,ownerId:profile.id});
    return {id:evidenceId};
  }
  assertServerPath(row);
  const { error } = await client.rpc('rpc_delete_reliance_training_evidence', {
    p_session_id: sessionId,
    p_actor_profile_id: profile.id,
    p_evidence_id: evidenceId,
  });
  if (error) throw translateTrainingDatabaseError(error);
  await removeRetiredEvidenceObject(client,{bucket:TRAINING_EVIDENCE_BUCKET,path:row.storage_path,evidenceId:row.id,parentId:sessionId,ownerId:row.uploaded_by});
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
  const context = await loadAuthorizedTrainingSession(client, profile, sessionId, { editable: true });
  const {data: topics, error: topicError} = await client.from('training_session_topics').select('*').eq('training_session_id', sessionId);
  if (topicError) throw topicError;
  const {data: category, error: categoryError} = await client.from('training_categories').select('*').eq('id',context.session.category_id).maybeSingle();
  if (categoryError) throw categoryError;
  if (!category || !['hk','technical_mep'].includes(category.code)) throw trainingError(403,'category_forbidden','Training category is unavailable.');
  const { data, error } = await client.from('training_evidence').select('*').eq('training_session_id', sessionId);
  if (error) throw error;
  assertTopicPhotographs(topics || [], data || [], sessionId);
  for (const row of data || []) {
    if (row.metadata?.upload_status !== 'uploaded') {
      throw trainingError(409, 'evidence_upload_incomplete', 'All evidence uploads must complete before submission.');
    }
    await storageObject(client, row);
    if (row.evidence_type === 'topic_photo') await verifyStoredPhotograph(client, row);
  }
  return true;
}

// The upload authorization is checked when bytes arrive, not just when an intent is issued.
export async function uploadTrainingEvidenceContent(client, profile, sessionId, evidenceId, bytes, contentType) {
  await loadAuthorizedTrainingSession(client, profile, sessionId, { editable: true });
  const row = await evidenceRow(client, sessionId, evidenceId);
  assertServerPath(row);
  if (!Buffer.isBuffer(bytes) || bytes.length !== Number(row.file_size) || contentType?.split(';')[0] !== row.mime_type) {
    throw trainingError(400, 'upload_intent_mismatch', 'Evidence bytes do not match the upload intent.');
  }
  const photo = ['topic_photo','group_photo'].includes(row.evidence_type);
  if (photo) await validatePhotograph(bytes, row.mime_type);
  const hash = createHash('sha256').update(bytes).digest('hex');
  const { error } = await withCombinedReleaseOperation(client,profile.id,'storage:training-content',()=>client.storage.from(row.storage_bucket).upload(row.storage_path, bytes, { contentType: row.mime_type, upsert: false }));
  if (error) {
    // Object creation may have succeeded before a timeout. Never upsert unknown bytes.
    const prior = await client.storage.from(row.storage_bucket).download(row.storage_path);
    if (prior.error || !prior.data || createHash('sha256').update(Buffer.from(await prior.data.arrayBuffer())).digest('hex') !== hash) throw error;
  }
  const verified = await client.from('training_evidence').update({metadata: {...row.metadata, verified_sha256: hash}}).eq('id',row.id).eq('training_session_id',sessionId);
  if (verified.error) throw translateTrainingDatabaseError(verified.error);
  await loadAuthorizedTrainingSession(client, profile, sessionId, { editable: true });
  return { id: evidenceId };
}

function reuseIntent(row, value, profile) {
  if(row.uploaded_by!==profile.id || row.evidence_type!==value.evidenceType || (row.training_session_topic_id||null)!==value.topicId
    || row.file_name!==value.fileName || row.mime_type!==value.mimeType || Number(row.file_size)!==value.fileSize)
    throw trainingError(409,'upload_intent_mismatch','Upload identity was already used for a different file.');
  assertServerPath(row);
  return {evidence_id:row.id,storage_path:row.storage_path,signed_upload_url:`/api/training/sessions/${row.training_session_id}/evidence/${row.id}/content`,token:null,expires_at:null};
}
export function assertTopicPhotographs(topics, evidence, sessionId) {
  if(!topics.length) throw trainingError(400,'topic_required','Select at least one Training topic.');
  for(const topic of topics) {
    if(!evidence.some(e=>e.training_session_id===sessionId && e.training_session_topic_id===topic.id
      && e.evidence_type==='topic_photo' && ['image/jpeg','image/png'].includes(e.mime_type) && Number(e.file_size)>0
      && e.metadata?.upload_status==='uploaded'))
      throw trainingError(400,'topic_evidence_required','Upload at least one photograph for every selected topic.');
  }
}
export async function validatePhotograph(bytes, mime) {
  try {
    const image=sharp(bytes,{limitInputPixels:40_000_000});
    const meta=await image.metadata();
    if(!meta.width || !meta.height || !['jpeg','png'].includes(meta.format) || `image/${meta.format}`!==mime) throw Error('format');
    await image.stats();
  } catch {throw trainingError(415,'invalid_photograph','A valid JPEG or PNG photograph is required.');}
}
async function verifyStoredPhotograph(client,row) {
  const {data,error}=await client.storage.from(row.storage_bucket).download(row.storage_path);
  if(error || !data) throw trainingError(409,'storage_object_missing','The uploaded photograph could not be verified.');
  const bytes=Buffer.from(await data.arrayBuffer());
  if(bytes.length!==Number(row.file_size)) throw trainingError(409,'storage_object_size_mismatch','The uploaded photograph size changed.');
  await validatePhotograph(bytes,row.mime_type);
  const verified=await client.from('training_evidence').update({metadata:{...row.metadata,verified_sha256:createHash('sha256').update(bytes).digest('hex')}}).eq('id',row.id).eq('training_session_id',row.training_session_id);
  if(verified.error) throw translateTrainingDatabaseError(verified.error);
}
