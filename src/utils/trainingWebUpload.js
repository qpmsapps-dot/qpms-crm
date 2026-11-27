export const TRAINING_WEB_MAX_BYTES = 5 * 1024 * 1024;

export function webTrainingUploader(profile) {
  const role = String(profile?.rawRole || profile?.role || '').replace(/[^a-z0-9]/gi, '').toUpperCase();
  return ['MISMEPC', 'OPERATIONSMANAGER', 'OPERATIONMANAGER', 'OM', 'ADMIN', 'QPMSADMIN'].includes(role);
}

export function webTrainingReady(detail) {
  const topics = detail?.topics || [];
  const evidence = (detail?.evidence || []).filter(e => e.metadata?.upload_status === 'uploaded');
  return detail?.session?.submission_source === 'Web' && detail?.category?.code === 'technical_mep' &&
    detail?.session?.status === 'draft' && detail.session.can_edit === true &&
    topics.length > 0 && topics.every(t => t.is_covered && evidence.some(e =>
      e.evidence_type === 'topic_photo' && e.training_session_topic_id === t.id)) &&
    evidence.some(e => e.evidence_type === 'additional_document');
}

// Only authenticated backend paths are accepted; never send a session to a file URL.
export async function uploadWebTrainingEvidence(request, sessionId, file, topicId, onIntent = () => {}) {
  const mime = file?.type;
  const allowed = topicId ? ['image/jpeg', 'image/png'] : ['image/jpeg', 'image/png', 'application/pdf'];
  if (!file || !allowed.includes(mime) || file.size < 1 || file.size > TRAINING_WEB_MAX_BYTES) {
    throw Error('Use a JPG/PNG photograph, or PDF completion proof, no larger than 5 MB.');
  }
  const bytes = await file.arrayBuffer();
  const hash = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)), b => b.toString(16).padStart(2, '0')).join('');
  const evidenceType = topicId ? 'topic_photo' : 'additional_document';
  const intent = (await request({method:'post', url:`/api/training/sessions/${sessionId}/evidence/upload-url`, data:{
    evidence_type:evidenceType, training_session_topic_id:topicId || null,
    file_name:file.name, mime_type:mime, file_size:file.size,
    upload_key:`web:${evidenceType}:${topicId || 'completion'}:${hash}`,
  }})).data;
  const grant = intent.upload;
  if (!grant?.evidence_id || grant.signed_upload_url !== `/api/training/sessions/${sessionId}/evidence/${grant.evidence_id}/content`) {
    throw Error('The evidence upload grant is invalid.');
  }
  onIntent(grant.evidence_id);
  await request({method:'put', url:grant.signed_upload_url, data:bytes, headers:{'Content-Type':mime}});
  const completion = await request({method:'post', url:`/api/training/sessions/${sessionId}/evidence/complete`, data:{evidence_id:grant.evidence_id}});
  if (completion.data?.evidence?.metadata?.upload_status !== 'uploaded') {
    throw Error('Evidence verification is not confirmed. Retry the same file.');
  }
  return grant.evidence_id;
}
