import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import ExcelJS from 'exceljs';
import {
  buildReportEvidence,
  buildReportEvidenceRows,
  getEmployeeTravelClaimProofsForRange,
  reportEvidenceKey,
  travelClaimProofIsImage,
} from '../src/utils/reportEvidence.js';

function proof(index, date, overrides = {}) {
  return {
    id: `proof-${index}`,
    attendance_id: `attendance-${index}`,
    attendance_date: date,
    travel_mode: 'bus',
    claim_type: 'travel',
    amount: 100 + index,
    status: 'submitted',
    filename: `${date.replaceAll('-', '')}_claim_proof.jpg`,
    mime_type: 'image/jpeg',
    storage_bucket: 'travel-claim-proofs',
    storage_path: `QPMSAP2213/${date}/claim-${index}.jpg`,
    authorized_signed_url: `https://example.invalid/signed/${index}`,
    ...overrides,
  };
}

const historical = [
  '2026-07-27', '2026-07-29', '2026-07-31', '2026-08-03', '2026-08-04',
  '2026-08-20', '2026-08-20', '2026-08-30', '2026-08-31',
].map((date, index) => proof(index + 1, date));
const inPeriod = [
  '2026-09-01', '2026-09-01', '2026-09-02', '2026-09-03', '2026-09-06',
].map((date, index) => proof(index + 10, date));

test('QPMSAP2213-like fixture filters 14 proofs to the 5 selected-period images', () => {
  const rows = getEmployeeTravelClaimProofsForRange([...historical, ...inPeriod], {
    fromDate: '2026-09-01',
    toDate: '2026-09-21',
  });
  assert.equal(rows.length, 5);
  assert.deepEqual(rows.map((row) => row.attendance_date), inPeriod.map((row) => row.attendance_date));
});

test('travel claim proof date follows attendance date rather than upload timestamp', () => {
  const rows = getEmployeeTravelClaimProofsForRange([
    proof(1, '2026-09-10', { created_at: '2026-09-22T01:00:00Z' }),
  ], { fromDate: '2026-09-01', toDate: '2026-09-21' });
  assert.equal(rows.length, 1);
  assert.equal(rows[0].date, '2026-09-10');
});

test('non-image travel documents remain outside image evidence', () => {
  assert.equal(travelClaimProofIsImage({ filename: 'ticket.pdf', mime_type: 'application/pdf' }), false);
  assert.equal(travelClaimProofIsImage({ filename: 'ticket.jpg', mime_type: null }), true);
});

test('activity and travel evidence remain separate and total correctly', () => {
  const activity = {
    id: 'activity-photo-1',
    activity_date: '2026-09-02',
    file_name: 'inspection.jpg',
    file_type: 'image/jpeg',
    authorized_signed_url: 'https://example.invalid/activity',
  };
  const evidence = buildReportEvidence({
    activityUploads: [activity, { ...activity, id: 'activity-photo-2' }],
    travelClaimProofs: inPeriod.slice(0, 3),
    fromDate: '2026-09-01',
    toDate: '2026-09-21',
  });
  assert.equal(evidence.activityPhotos.length, 2);
  assert.equal(evidence.travelClaimProofs.length, 3);
  assert.equal(evidence.totalEvidenceCount, 5);
});

test('zero evidence produces valid empty collections', () => {
  assert.deepEqual(buildReportEvidence({}), {
    activityPhotos: [],
    travelClaimProofs: [],
    totalEvidenceCount: 0,
  });
});

test('travel proof export rows retain metadata when image loading is unavailable', () => {
  const evidence = buildReportEvidence({ travelClaimProofs: [proof(1, '2026-09-01', { authorized_signed_url: null })] });
  const rows = buildReportEvidenceRows(evidence).travelClaimProofs;
  assert.equal(rows.length, 1);
  assert.equal(rows[0].Date, '2026-09-01');
  assert.equal(rows[0].Proof, 'Image pending');
  assert.equal(rows[0].proof.authorized_signed_url, null);
});

test('five normalized travel proofs create five Excel data rows', () => {
  const rows = buildReportEvidenceRows({ travelClaimProofs: inPeriod }).travelClaimProofs;
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet('Travel Claim Proofs');
  sheet.columns = Object.keys(rows[0]).filter((key) => key !== 'proof').map((key) => ({ header: key, key }));
  rows.forEach(({ proof: _proof, ...row }) => sheet.addRow(row));
  assert.equal(sheet.rowCount - 1, 5);
  assert.equal(sheet.name, 'Travel Claim Proofs');
});

test('evidence keys keep activity and travel domains distinct', () => {
  assert.notEqual(reportEvidenceKey('activity', { id: 'same' }), reportEvidenceKey('travel', { id: 'same' }));
});

test('export implementations share the canonical report evidence collection', async () => {
  const source = await readFile(new URL('../src/pages/FOActivities.jsx', import.meta.url), 'utf8');
  assert.match(source, /buildReportEvidence\(\{/);
  assert.match(source, /"Travel Claim Proofs"/);
  assert.match(source, /SUPPORTING EVIDENCE/);
  assert.match(source, /fo-report-evidence-image/);
  assert.match(source, /Proof image unavailable/);
});
