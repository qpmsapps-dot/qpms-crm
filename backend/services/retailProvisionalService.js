import { parseStoreReview } from './retailStoreImportValidation.js';

async function rpc(client, name, args) {
  const { data, error } = await client.rpc(name, args);
  if (error) throw error;
  return data;
}
export const provisionalReview = (client, profile) => rpc(client, 'rpc_retail_provisional_review', { p_actor: profile.id });
export async function uploadProvisional(client, profile, bytes, filename) {
  // Capability check precedes parsing; the DB checks again within the transaction.
  const access = await provisionalReview(client, profile);
  if (!access.admin) throw Object.assign(Error('Active Admin required for provisional upload.'), { statusCode: 403 });
  const parsed = parseStoreReview(bytes, filename);
  return rpc(client, 'rpc_retail_provisional_upload', {
    p_actor: profile.id, p_filename: filename, p_sha256: parsed.checksum,
    p_original: bytes.toString('base64'), p_rows: parsed.rows,
  });
}
export const proposeProvisional = (client, profile, input) => rpc(client, 'rpc_retail_provisional_propose', {
  p_actor: profile.id, p_row: input.row_id, p_revision: input.revision,
  p_changes: input.changes, p_reason: input.reason,
});
export const decideProvisional = (client, profile, input) => rpc(client, 'rpc_retail_provisional_decide', {
  p_actor: profile.id, p_proposal: input.proposal_id, p_approve: input.approve, p_reason: input.reason,
});
export const withdrawProvisional = (client, profile, input) => rpc(client, 'rpc_retail_provisional_withdraw', {
  p_actor: profile.id, p_batch: input.batch_id, p_reason: input.reason,
});
