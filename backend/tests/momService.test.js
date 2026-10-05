import assert from 'node:assert/strict';
import test from 'node:test';
import { createMomAttachmentUploadUrl } from '../services/momService.js';

const profile = { id: '11111111-1111-4111-8111-111111111111', employee_code: 'FO/001', role: 'FO', status: 'Active', is_active: true };
const momId = '22222222-2222-4222-8222-222222222222';
const attachmentId = '33333333-3333-4333-8333-333333333333';

function attachmentClient() {
  const tables = {
    visit_moms: [{ id: momId, employee_code: 'FO/001', status: 'draft' }],
    mom_attachments: [],
  };
  let insertCount = 0;
  let updateCount = 0;
  const client = {
    from(table) {
      let selected = [...tables[table]];
      let updatePayload = null;
      const builder = {
        select() { return builder; },
        eq(column, value) { selected = selected.filter((row) => row[column] === value); return builder; },
        maybeSingle: async () => ({ data: selected[0] || null, error: null }),
        insert: async (row) => { insertCount += 1; tables[table].push({ ...row }); return { error: null }; },
        update(payload) { updatePayload = payload; return builder; },
        then(resolve) {
          if (updatePayload) {
            updateCount += 1;
            for (const row of selected) Object.assign(row, updatePayload);
          }
          return Promise.resolve({ error: null }).then(resolve);
        },
      };
      return builder;
    },
    storage: {
      from(bucket) {
        assert.equal(bucket, 'dme-mom-private');
        return { createSignedUploadUrl: async (path) => ({ data: { signedUrl: `signed:${path}`, token: 'token' }, error: null }) };
      },
    },
  };
  return { client, tables, counts: () => ({ insertCount, updateCount }) };
}

test('attachment upload retry reuses one private record and sanitized path', async () => {
  const fake = attachmentClient();
  const input = { id: attachmentId, attachment_type: 'signed_mom', file_name: '../signed MoM.pdf', mime_type: 'application/pdf', file_size: 100 };
  const first = await createMomAttachmentUploadUrl(fake.client, profile, momId, input);
  const second = await createMomAttachmentUploadUrl(fake.client, profile, momId, { ...input, file_size: 120 });
  assert.equal(first.attachment_id, attachmentId);
  assert.equal(second.attachment_id, attachmentId);
  assert.equal(fake.tables.mom_attachments.length, 1);
  assert.deepEqual(fake.counts(), { insertCount: 1, updateCount: 1 });
  assert.match(first.storage_path, /^mom\/FO_001\//);
  assert.doesNotMatch(first.storage_path, /\.\./);
  assert.equal(fake.tables.mom_attachments[0].file_size, 120);
});

test('attachment upload rejects unsupported MIME and cross-owner access', async () => {
  const fake = attachmentClient();
  await assert.rejects(
    () => createMomAttachmentUploadUrl(fake.client, profile, momId, { id: attachmentId, attachment_type: 'signed_mom', file_name: 'x.exe', mime_type: 'application/octet-stream', file_size: 10 }),
    { code: 'unsupported_attachment' },
  );
  await assert.rejects(
    () => createMomAttachmentUploadUrl(fake.client, { ...profile, employee_code: 'OTHER' }, momId, { id: attachmentId, attachment_type: 'signed_mom', file_name: 'x.pdf', mime_type: 'application/pdf', file_size: 10 }),
    { code: 'mom_forbidden' },
  );
});
