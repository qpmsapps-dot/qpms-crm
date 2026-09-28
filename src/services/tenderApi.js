import { authenticatedApiRequest } from './api.js';
import { supabase } from '../lib/supabase.js';

async function request(config) { const response = await authenticatedApiRequest(config); return response.data; }
const key = () => globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random()}`;
export const getTenderWorkspace = () => request({ method: 'GET', url: '/api/tender/workspace' });
export const claimTenderTask = (id) => request({ method: 'POST', url: `/api/tender/packages/${id}/claim`, headers: { 'Idempotency-Key': key() } });
export async function uploadTenderVersion(packageId, file, notes) {
  const mime = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
  if (!file?.name?.toLowerCase().endsWith('.xlsx')) throw new Error('Only .xlsx workbooks are supported.');
  const reserved = await request({ method: 'POST', url: `/api/tender/packages/${packageId}/versions/upload-url`, data: { filename: file.name, mime_type: mime, notes }, headers: { 'Idempotency-Key': key() } });
  const uploaded = await supabase.storage.from('tender-workbooks').uploadToSignedUrl(reserved.upload.path, reserved.upload.token, file, { contentType: mime });
  if (uploaded.error) throw uploaded.error;
  return reserved.version;
}
export const submitTenderVersion = (packageId, versionId) => request({ method: 'POST', url: `/api/tender/packages/${packageId}/versions/${versionId}/submit`, data: {}, headers: { 'Idempotency-Key': key() } });
export const decideTenderReview = (id, decision, remarks) => request({ method: 'POST', url: `/api/tender/reviews/${id}/decision`, data: { decision, remarks }, headers: { 'Idempotency-Key': key() } });
export const getTenderWorkbookUrl = (id) => request({ method: 'GET', url: `/api/tender/versions/${id}/url` });
