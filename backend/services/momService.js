import { assertMomActor, cleanMomText, loadAuthorizedMom, loadMomVisitContext, momError, normalizeMomKey, validateMomPayload } from './momAccessService.js';

const MOM_BUCKET = 'dme-mom-private';
const MOM_MAX_FILE_BYTES = 10 * 1024 * 1024;
const MOM_MIME_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp', 'application/pdf']);

async function rows(query) {
  const { data, error } = await query;
  if (error) throw error;
  return data || [];
}

export async function listMomStatuses(client, profile, input = {}) {
  assertMomActor(profile);
  const ids = cleanMomText(input.site_visit_ids).split(',').map((id) => id.trim()).filter(Boolean).slice(0, 200);
  if (!ids.length) return [];
  const employeeCode = cleanMomText(profile.employee_code || profile.username);
  const visits = await rows(client.from('fo_site_visits').select('id,store_id,site_id,employee_code,fo_user_id').in('id', ids));
  const ownedVisits = visits.filter((visit) => [visit.employee_code, visit.fo_user_id].map((value) => cleanMomText(value).toUpperCase()).includes(employeeCode.toUpperCase()));
  const storeIds = [...new Set(ownedVisits.map((visit) => visit.store_id || visit.site_id).filter(Boolean))];
  if (!storeIds.length) return [];
  const [stores, capabilities, moms] = await Promise.all([
    rows(client.from('store_master').select('id,business,client_name').in('id', storeIds)),
    rows(client.from('mom_business_capabilities').select('business_key,client_key').eq('is_enabled', true)),
    rows(client.from('visit_moms').select('id,site_visit_id,status,follow_up_required,follow_up_date,updated_at,submitted_at').eq('employee_code', employeeCode).in('site_visit_id', ownedVisits.map((visit) => visit.id))),
  ]);
  const eligibleStores = new Set(stores.filter((store) => capabilities.some((capability) => capability.business_key === normalizeMomKey(store.business) || capability.client_key === normalizeMomKey(store.client_name))).map((store) => store.id));
  const momByVisit = new Map(moms.map((mom) => [mom.site_visit_id, mom]));
  return ownedVisits.filter((visit) => eligibleStores.has(visit.store_id || visit.site_id)).map((visit) => momByVisit.get(visit.id) || { id: '', site_visit_id: visit.id, status: 'not_added' });
}

export async function getMomByVisit(client, profile, visitId) {
  const employeeCode = cleanMomText(profile.employee_code || profile.username);
  const { data, error } = await client.from('visit_moms').select('id').eq('site_visit_id', visitId).eq('employee_code', employeeCode).maybeSingle();
  if (error) throw error;
  return data?.id ? getMom(client, profile, data.id) : null;
}

export async function getMom(client, profile, momId) {
  const mom = await loadAuthorizedMom(client, profile, momId);
  const [discussionPoints, actionItems, concerns, appreciations, attachments] = await Promise.all([
    rows(client.from('mom_discussion_points').select('*').eq('mom_id', mom.id).order('sort_order')),
    rows(client.from('mom_action_items').select('*').eq('mom_id', mom.id).order('sort_order')),
    rows(client.from('mom_management_concerns').select('*').eq('mom_id', mom.id).order('sort_order')),
    rows(client.from('mom_appreciations').select('*').eq('mom_id', mom.id).order('sort_order')),
    rows(client.from('mom_attachments').select('id,mom_id,attachment_type,original_filename,mime_type,file_size,metadata,created_at').eq('mom_id', mom.id).order('created_at')),
  ]);
  return { mom, discussion_points: discussionPoints, action_items: actionItems, concerns, appreciations, attachments };
}

export async function saveMom(client, profile, input = {}, { submit = false } = {}) {
  const context = await loadMomVisitContext(client, profile, input);
  validateMomPayload(input, { submit });
  const payload = {
    ...input,
    attendance_id: context.attendance.id,
    site_visit_id: context.visit.id,
    site_id: context.store.id,
  };
  const { data, error } = await client.rpc('rpc_save_visit_mom', {
    p_actor_profile_id: profile.id,
    p_payload: payload,
    p_submit: submit,
  });
  if (error) throw error;
  return getMom(client, profile, data);
}

function safeFileName(value) {
  return cleanMomText(value).replace(/[^a-zA-Z0-9._-]+/g, '_').replace(/^\.+/, '').slice(0, 120) || 'mom_attachment';
}

function safePathSegment(value) {
  return cleanMomText(value).replace(/[^a-zA-Z0-9_-]+/g, '_').slice(0, 80) || 'unknown';
}

export async function createMomAttachmentUploadUrl(client, profile, momId, input = {}) {
  const mom = await loadAuthorizedMom(client, profile, momId, { editable: true });
  const mimeType = cleanMomText(input.mime_type).toLowerCase();
  const fileSize = Number(input.file_size || 0);
  const attachmentType = cleanMomText(input.attachment_type).toLowerCase();
  if (!MOM_MIME_TYPES.has(mimeType)) throw momError(415, 'unsupported_attachment', 'Use a JPG, PNG, WebP, or PDF file.');
  if (!Number.isFinite(fileSize) || fileSize <= 0 || fileSize > MOM_MAX_FILE_BYTES) throw momError(413, 'attachment_too_large', 'Attachment must be 10 MB or less.');
  if (!['management_signature', 'signed_mom', 'supporting_document'].includes(attachmentType)) throw momError(400, 'attachment_type_invalid', 'Attachment type is invalid.');
  const id = cleanMomText(input.id);
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(id)) throw momError(400, 'attachment_id_invalid', 'Attachment ID is invalid.');
  const fileName = safeFileName(input.file_name);
  const storagePath = `mom/${safePathSegment(mom.employee_code)}/${mom.id}/${id}/${fileName}`;
  const { data: existing, error: existingError } = await client.from('mom_attachments').select('*').eq('id', id).maybeSingle();
  if (existingError) throw existingError;
  if (existing && (
    existing.mom_id !== mom.id || existing.storage_path !== storagePath ||
    existing.attachment_type !== attachmentType
  )) throw momError(409, 'attachment_conflict', 'Attachment identifier is already in use.');
  if (!existing) {
    const { error } = await client.from('mom_attachments').insert({ id, mom_id: mom.id, attachment_type: attachmentType, storage_bucket: MOM_BUCKET, storage_path: storagePath, original_filename: fileName, mime_type: mimeType, file_size: fileSize, uploaded_by: profile.id, metadata: { upload_status: 'pending' } });
    if (error) throw error;
  } else if (existing.mime_type !== mimeType || Number(existing.file_size) !== fileSize) {
    const { error } = await client.from('mom_attachments').update({ mime_type: mimeType, file_size: fileSize, metadata: { ...(existing.metadata || {}), upload_status: 'pending' } }).eq('id', id);
    if (error) throw error;
  }
  const { data, error } = await client.storage.from(MOM_BUCKET).createSignedUploadUrl(storagePath);
  if (error) throw error;
  return { attachment_id: id, storage_path: storagePath, signed_url: data?.signedUrl || data?.signedURL, token: data?.token || null };
}

export async function completeMomAttachment(client, profile, momId, input = {}) {
  await loadAuthorizedMom(client, profile, momId, { editable: true });
  const attachmentId = cleanMomText(input.attachment_id);
  const { data: attachment, error } = await client.from('mom_attachments').select('*').eq('id', attachmentId).eq('mom_id', momId).maybeSingle();
  if (error) throw error;
  if (!attachment) throw momError(404, 'attachment_not_found', 'Attachment was not found.');
  const { data: objects, error: objectError } = await client.storage.from(attachment.storage_bucket).list(attachment.storage_path.substring(0, attachment.storage_path.lastIndexOf('/')), { search: attachment.storage_path.split('/').pop(), limit: 10 });
  if (objectError) throw objectError;
  if (!(objects || []).some((item) => item.name === attachment.storage_path.split('/').pop())) throw momError(409, 'attachment_not_uploaded', 'Unable to verify the uploaded file. Retry upload.');
  const { data: updated, error: updateError } = await client.from('mom_attachments').update({ metadata: { ...(attachment.metadata || {}), upload_status: 'uploaded' } }).eq('id', attachment.id).select('id,mom_id,attachment_type,original_filename,mime_type,file_size,metadata,created_at').single();
  if (updateError) throw updateError;
  return updated;
}

export async function createMomAttachmentViewUrl(client, profile, momId, attachmentId) {
  await loadAuthorizedMom(client, profile, momId);
  const { data: attachment, error } = await client.from('mom_attachments').select('*').eq('id', attachmentId).eq('mom_id', momId).maybeSingle();
  if (error) throw error;
  if (!attachment || attachment.metadata?.upload_status !== 'uploaded') throw momError(404, 'attachment_not_found', 'Attachment was not found.');
  const { data, error: signError } = await client.storage.from(attachment.storage_bucket).createSignedUrl(attachment.storage_path, 600);
  if (signError) throw signError;
  return { url: data?.signedUrl || null, expires_in: 600 };
}
