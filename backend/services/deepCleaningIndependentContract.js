// The adapter deliberately has no direct-table mutation fallback. The reviewed
// SQL contract must be installed separately; absence/mismatch keeps writes shut.
export const CLEANING_CONTRACT = 'cleaning-independent.phase1b.v1';
export const CLEANING_RPC = 'rpc_client_cleaning_phase1b_v1';

function reject(statusCode, code, message) {
  throw Object.assign(new Error(message), {statusCode, code});
}

export function cleaningUuid(value, field) {
  const id = String(value ?? '').trim();
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)) {
    reject(400, 'request_id_required', `A stable UUID ${field} is required. Keep this draft and upgrade unsupported clients.`);
  }
  return id.toLowerCase();
}

export function actualCleaningDate(value, now = new Date()) {
  const day = String(value ?? '').trim();
  const parsed = new Date(`${day}T00:00:00Z`);
  const today = new Date(now.getTime() + 330 * 60_000).toISOString().slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day) || !Number.isFinite(parsed.getTime()) ||
      parsed.toISOString().slice(0, 10) !== day || day > today) {
    reject(400, 'invalid_deep_cleaning_date', 'Select a valid, nonfuture Actual Cleaning Date.');
  }
  return day;
}

export function rejectScheduledWrite(payload = {}, submission = null) {
  if (payload.schedule_id != null || submission?.schedule_id ||
      submission?.metadata?.source === 'retail-cleaning.v1' ||
      (submission && submission.metadata?.contract_version !== CLEANING_CONTRACT) ||
      (payload.outcome != null && payload.outcome !== 'Completed')) {
    reject(409, 'cleaning_upgrade_required', 'This record requires legacy compatibility review; scheduled or Not Done commands cannot use the independent writer. Original records are retained.');
  }
}

export async function cleaningCommand(client, profile, action, payload) {
  const {data, error} = await client.rpc(CLEANING_RPC, {
    p_actor: profile.id, p_auth: profile.auth_user_id, p_action: action, p_data: payload,
  });
  if (error) {
    const known = {
      '42501': [403, 'store_not_authorized', 'Store or evidence access is no longer authorized.'],
      '22023': [400, 'invalid_cleaning_evidence', 'Check the actual date, complete Before/After pairs and exactly one supporting document.'],
      '22007': [400, 'invalid_deep_cleaning_date', 'Select a valid Actual Cleaning Date.'],
      '22008': [400, 'invalid_deep_cleaning_date', 'Select a valid Actual Cleaning Date.'],
      '22P02': [400, 'invalid_cleaning_request', 'Check the request identifiers and evidence metadata.'],
      '23505': [409, 'cleaning_request_conflict', 'The request identity belongs to different data. Keep the existing draft.'],
      '23514': [409, 'cleaning_evidence_protected', 'This evidence reference is protected or retired. Refresh the existing draft.'],
      '40001': [409, 'cleaning_state_changed', 'The record changed. Refresh and retry the existing operation.'],
      '55000': [503, 'combined_release_frozen', 'Deep Cleaning writes are temporarily unavailable.'],
      'P0002': [409, 'storage_object_missing', 'Uploaded evidence was not found. Retry the existing upload.'],
    };
    reject(...(known[error.code] || [503, 'cleaning_contract_unavailable', 'The compatible Deep Cleaning contract is unavailable. Keep this draft.']));
  }
  if (data?.contract_version !== CLEANING_CONTRACT || !data.record || typeof data.record !== 'object') {
    reject(503, 'cleaning_contract_unavailable', 'The compatible Deep Cleaning contract has not been confirmed.');
  }
  return data.record;
}
