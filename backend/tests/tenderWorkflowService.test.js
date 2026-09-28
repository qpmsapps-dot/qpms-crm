import test from 'node:test';
import assert from 'node:assert/strict';
import { canAccessTender, claimTenderTask, reserveTenderUpload } from '../services/tenderWorkflowService.js';

const actor = (role, profileId = '00000000-0000-0000-0000-000000000001') => ({ role, rawRole: role, profileId, name: role, employeeCode: role });

test('Tender access includes Tender, allocated reviewers, BD tracking, COO, and Platform Admin but excludes unrelated roles', () => {
  for (const role of ['Tender', 'HR Reviewer', 'Commercial Reviewer', 'Finance Reviewer', 'CFO', 'COO', 'BD Executive', 'Business Development Executive', 'Admin']) {
    assert.equal(canAccessTender(actor(role)), true, role);
  }
  for (const role of ['Pre-Sales', 'FO', 'Operations Manager', 'GM', 'Management']) assert.equal(canAccessTender(actor(role)), false, role);
});

test('claim delegates ownership and idempotency to the secured RPC with the real actor', async () => {
  const calls = [];
  const client = { async rpc(name, payload) { calls.push([name, payload]); return { data: { id: 'package-1' }, error: null }; } };
  await claimTenderTask(client, actor('Tender'), 'package-1', 'claim-key');
  assert.equal(calls[0][0], 'rpc_claim_tender_task');
  assert.equal(calls[0][1].p_actor.role, 'Tender');
  assert.equal(calls[0][1].p_idempotency_key, 'claim-key');
});

test('workbook upload accepts only xlsx and keeps earlier versions server-owned', async () => {
  await assert.rejects(() => reserveTenderUpload({}, actor('Tender'), 'package-1', { filename: 'unsafe.xlsm', mime_type: 'application/vnd.ms-excel.sheet.macroEnabled.12' }, 'key'), /Only \.xlsx/);
  const client = {
    async rpc() { return { data: { id: 'version-1', storage_path: 'package/v1/file.xlsx' }, error: null }; },
    storage: { from() { return { async createSignedUploadUrl(path) { return { data: { path, token: 'signed-token' }, error: null }; } }; } },
  };
  const result = await reserveTenderUpload(client, actor('Tender'), 'package-1', { filename: 'Tender V1.xlsx', mime_type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', notes: 'Draft' }, 'key');
  assert.equal(result.version.id, 'version-1');
  assert.equal(result.upload.path, 'package/v1/file.xlsx');
});
