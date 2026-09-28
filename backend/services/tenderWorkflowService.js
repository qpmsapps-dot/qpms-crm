import { isPlatformAdmin } from '../shared/platformAdmin.js';

const text = (value) => String(value || '').trim();
const roleKey = (value) => text(value).toUpperCase().replace(/[^A-Z0-9]+/g, '');
const REVIEW_ROLES = new Set(['HR', 'HRREVIEWER', 'HRGM', 'COMMERCIAL', 'COMMERCIALTEAM', 'COMMERCIALREVIEWER', 'FINANCE', 'FINANCETEAM', 'FINANCEREVIEWER', 'FINANCEGM', 'CFO', 'COO']);
const reviewerFamily = (role) => {
  const key = roleKey(role);
  if (['HR', 'HRREVIEWER', 'HRGM'].includes(key)) return 'HR';
  if (['COMMERCIAL', 'COMMERCIALTEAM', 'COMMERCIALREVIEWER'].includes(key)) return 'Commercial';
  if (['FINANCE', 'FINANCETEAM', 'FINANCEREVIEWER', 'FINANCEGM'].includes(key)) return 'Finance';
  if (key === 'CFO') return 'CFO';
  if (key === 'COO') return 'COO';
  return null;
};

function httpError(statusCode, code, message) {
  const error = new Error(message); error.statusCode = statusCode; error.code = code; return error;
}

export function canAccessTender(actor) {
  return isPlatformAdmin(actor) || ['TENDER', 'COO', 'CFO', 'BDEXECUTIVE', 'BDHEAD', 'BUSINESSDEVELOPMENTEXECUTIVE', 'BUSINESSDEVELOPMENTHEAD'].includes(roleKey(actor?.role)) || REVIEW_ROLES.has(roleKey(actor?.role));
}

function actorPayload(actor) {
  return { profile_id: actor.profileId, role: actor.rawRole || actor.role, name: actor.name, employee_code: actor.employeeCode, admin_override: isPlatformAdmin(actor) };
}

function throwRpc(error) {
  if (!error) return;
  const message = text(error.message);
  const status = error.code === '42501' ? 403 : error.code === '22023' ? 409 : 500;
  throw httpError(status, message || 'tender_workflow_failed', message || 'Tender workflow failed.');
}

export async function listTenderWorkspace(client, actor) {
  if (!canAccessTender(actor)) throw httpError(403, 'tender_access_denied', 'Tender access is required.');
  let query = client.from('tender_packages').select('*').order('updated_at', { ascending: false });
  const key = roleKey(actor.role);
  if (!isPlatformAdmin(actor) && key === 'TENDER') query = query.or(`assigned_tender_profile_id.is.null,assigned_tender_profile_id.eq.${actor.profileId}`);
  else if (!isPlatformAdmin(actor) && ['BDEXECUTIVE', 'BDHEAD', 'BUSINESSDEVELOPMENTEXECUTIVE', 'BUSINESSDEVELOPMENTHEAD'].includes(key)) query = query.eq('assigned_bd_profile_id', actor.profileId);
  else if (!isPlatformAdmin(actor) && key !== 'COO') {
    const assigned = await client.from('tender_reviews').select('tender_package_id').eq('assigned_reviewer_profile_id', actor.profileId);
    if (assigned.error) throw assigned.error;
    const assignedIds = [...new Set((assigned.data || []).map((row) => row.tender_package_id))];
    if (!assignedIds.length) return [];
    query = query.in('id', assignedIds);
  }
  const packages = await query;
  if (packages.error) throw packages.error;
  const rows = packages.data || [];
  const ids = rows.map((row) => row.id);
  const leadIds = rows.map((row) => row.lead_id);
  const visitIds = rows.map((row) => row.site_visit_id);
  const assessmentIds = rows.map((row) => row.assessment_id);
  const [versions, reviews, events, leads, visits, assessments, profiles] = await Promise.all([
    ids.length ? client.from('tender_versions').select('*').in('tender_package_id', ids).order('version_number', { ascending: false }) : { data: [] },
    ids.length ? client.from('tender_reviews').select('*').in('tender_package_id', ids).order('requested_at') : { data: [] },
    ids.length ? client.from('tender_events').select('*').in('tender_package_id', ids).order('created_at') : { data: [] },
    leadIds.length ? client.from('leads').select('id,client_name,state,site_location,pre_sales_owner_profile_id,assigned_bd_profile_id').in('id', leadIds) : { data: [] },
    visitIds.length ? client.from('site_visits').select('id,assigned_operations_manager_profile_id,scheduled_date,survey_notes,status').in('id', visitIds) : { data: [] },
    assessmentIds.length ? client.from('site_assessments').select('id,survey_date,survey_snapshot,status,assessment_status').in('id', assessmentIds) : { data: [] },
    client.from('profiles').select('id,full_name,employee_code'),
  ]);
  for (const result of [versions, reviews, events, leads, visits, assessments, profiles]) if (result.error) throw result.error;
  const byId = (items) => new Map((items || []).map((row) => [row.id, row]));
  const leadMap = byId(leads.data); const visitMap = byId(visits.data); const assessmentMap = byId(assessments.data); const profileMap = byId(profiles.data);
  return rows.map((row) => ({
    ...row, lead: leadMap.get(row.lead_id) || null, site_visit: visitMap.get(row.site_visit_id) || null,
    assessment: assessmentMap.get(row.assessment_id) || null,
    tender_owner_name: profileMap.get(row.assigned_tender_profile_id)?.full_name || null,
    bd_owner_name: profileMap.get(row.assigned_bd_profile_id)?.full_name || null,
    versions: (versions.data || []).filter((item) => item.tender_package_id === row.id),
    reviews: (reviews.data || []).filter((item) => item.tender_package_id === row.id),
    events: (events.data || []).filter((item) => item.tender_package_id === row.id),
  }));
}

async function rpc(client, name, payload) {
  const result = await client.rpc(name, payload); if (result.error) throwRpc(result.error); return result.data;
}

export const claimTenderTask = (client, actor, packageId, key) => rpc(client, 'rpc_claim_tender_task', { p_package_id: packageId, p_actor: actorPayload(actor), p_idempotency_key: key });

export async function reserveTenderUpload(client, actor, packageId, input, key) {
  const filename = text(input.filename); const mime = text(input.mime_type);
  if (!filename.toLowerCase().endsWith('.xlsx') || mime !== 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet') throw httpError(400, 'invalid_tender_workbook_type', 'Only .xlsx workbooks are supported.');
  const version = await rpc(client, 'rpc_reserve_tender_version', { p_package_id: packageId, p_actor: actorPayload(actor), p_filename: filename, p_mime: mime, p_notes: text(input.notes) || null, p_idempotency_key: key });
  const signed = await client.storage.from('tender-workbooks').createSignedUploadUrl(version.storage_path);
  if (signed.error) throw signed.error;
  return { version, upload: signed.data };
}

export async function submitTenderVersion(client, actor, packageId, versionId, fileSize, key) {
  const version = await client.from('tender_versions').select('storage_bucket,storage_path').eq('id', versionId).eq('tender_package_id', packageId).maybeSingle();
  if (version.error) throw version.error;
  if (!version.data) throw httpError(404, 'tender_version_not_found', 'Tender version not found.');
  const parts = version.data.storage_path.split('/'); const filename = parts.pop(); const folder = parts.join('/');
  const stored = await client.storage.from(version.data.storage_bucket).list(folder, { search: filename, limit: 10 });
  if (stored.error) throw stored.error;
  const object = (stored.data || []).find((entry) => entry.name === filename);
  const storedSize = Number(object?.metadata?.size || object?.metadata?.contentLength || fileSize || 0);
  if (!object || !Number.isSafeInteger(storedSize) || storedSize < 1 || storedSize > 26214400) throw httpError(409, 'tender_workbook_upload_incomplete', 'Upload the workbook before submitting it for approval.');
  return rpc(client, 'rpc_submit_tender_version', { p_package_id: packageId, p_version_id: versionId, p_actor: actorPayload(actor), p_file_size: storedSize, p_idempotency_key: key });
}

export const decideTenderReview = (client, actor, reviewId, input, key) => rpc(client, 'rpc_decide_tender_review', { p_review_id: reviewId, p_decision: input.decision, p_remarks: text(input.remarks) || null, p_actor: actorPayload(actor), p_idempotency_key: key });

export async function tenderWorkbookUrl(client, actor, versionId) {
  if (!canAccessTender(actor)) throw httpError(403, 'tender_access_denied', 'Tender access is required.');
  const version = await client.from('tender_versions').select('*,package:tender_packages(*)').eq('id', versionId).maybeSingle();
  if (version.error) throw version.error;
  if (!version.data) throw httpError(404, 'tender_version_not_found', 'Tender version not found.');
  const key = roleKey(actor.role); const pack = version.data.package;
  if (!isPlatformAdmin(actor) && key === 'TENDER' && pack.assigned_tender_profile_id !== actor.profileId) throw httpError(403, 'tender_owner_required', 'This Tender task belongs to another user.');
  if (!isPlatformAdmin(actor) && ['BDEXECUTIVE', 'BDHEAD', 'BUSINESSDEVELOPMENTEXECUTIVE', 'BUSINESSDEVELOPMENTHEAD'].includes(key) && pack.assigned_bd_profile_id !== actor.profileId) throw httpError(403, 'tender_access_denied', 'This opportunity belongs to another BD user.');
  if (!isPlatformAdmin(actor) && REVIEW_ROLES.has(key) && key !== 'COO') {
    const review = await client.from('tender_reviews').select('id,reviewer_role').eq('tender_package_id', pack.id).eq('assigned_reviewer_profile_id', actor.profileId);
    if (review.error) throw review.error;
    if (!(review.data || []).some((item) => item.reviewer_role === reviewerFamily(actor.role))) throw httpError(403, 'tender_review_assignment_required', 'This Tender review is assigned to another user.');
  }
  const signed = await client.storage.from(version.data.storage_bucket).createSignedUrl(version.data.storage_path, 300);
  if (signed.error) throw signed.error;
  return { url: signed.data.signedUrl, filename: version.data.original_filename };
}
