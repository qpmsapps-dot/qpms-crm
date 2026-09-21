import assert from 'node:assert/strict';
import test from 'node:test';
import ExcelJS from 'exceljs';
import {
  activityPhotoDate,
  activityUploadIsPhoto,
  buildActivityPhotoExportRows,
  getEmployeeActivityPhotosForRange,
} from '../src/utils/activityPhotoExport.js';

const range = { fromDate: '2026-09-01', toDate: '2026-09-21' };
const photo = {
  id: 'photo-1', employee_code: 'FO-1', site_visit_id: 'visit-1',
  file_url: 'FO-1/opaque-object', file_name: 'proof.jpg', file_type: 'image/jpeg',
  uploaded_at: '2026-09-22T03:00:00Z',
};
const visits = [{ id: 'visit-1', check_in_time: '2026-09-10T06:00:00Z', store_name: 'Site A' }];

test('one qualifying activity image produces one eligible export row', () => {
  assert.equal(getEmployeeActivityPhotosForRange([photo], { ...range, visits }).length, 1);
});

test('activity date is canonical when upload timestamp differs', () => {
  assert.equal(activityPhotoDate(photo, { visits }), visits[0].check_in_time);
});

test('activity inside range remains eligible when upload is outside range', () => {
  assert.equal(getEmployeeActivityPhotosForRange([photo], { ...range, visits })[0].id, 'photo-1');
});

test('missing MIME remains eligible when photo role identifies the image', () => {
  assert.equal(activityUploadIsPhoto({ file_url: 'opaque', upload_role: 'inspection_photo' }), true);
});

test('one nested image becomes one photo row', () => {
  const rows = getEmployeeActivityPhotosForRange([{ site_visit_id: 'visit-1', uploads: [photo] }], { ...range, visits });
  assert.equal(rows.length, 1);
});

test('multiple nested images become multiple photo rows', () => {
  const rows = getEmployeeActivityPhotosForRange([{ images: [photo, { ...photo, id: 'photo-2' }] }], { ...range, visits });
  assert.deepEqual(rows.map((row) => row.id), ['photo-1', 'photo-2']);
});

test('signed URL absence does not affect eligibility', () => {
  assert.equal(getEmployeeActivityPhotosForRange([{ ...photo, authorized_signed_url: null }], { ...range, visits }).length, 1);
});

test('image associated with an activity outside the range is excluded', () => {
  const outsideVisits = [{ id: 'visit-1', check_in_time: '2026-08-31T06:00:00Z' }];
  assert.equal(getEmployeeActivityPhotosForRange([photo], { ...range, visits: outsideVisits }).length, 0);
});

test('explicit documents are not treated as photos', () => {
  assert.equal(activityUploadIsPhoto({ file_url: 'report.pdf', file_type: 'application/pdf', upload_role: 'training_document' }), false);
});

test('modal count and workbook photo-row count use the same canonical collection', () => {
  const eligiblePhotos = getEmployeeActivityPhotosForRange([photo], { ...range, visits });
  const workbookRows = buildActivityPhotoExportRows(eligiblePhotos);
  const workbook = new ExcelJS.Workbook();
  const worksheet = workbook.addWorksheet('Activity Photos');
  worksheet.columns = Object.keys(workbookRows[0]).filter((key) => key !== 'upload').map((key) => ({ header: key, key }));
  worksheet.addRows(workbookRows.map(({ upload: _upload, ...row }) => row));
  assert.equal(eligiblePhotos.length, workbookRows.length);
  assert.equal(worksheet.rowCount - 1, 1);
});

test('genuine zero-photo input stays empty', () => {
  assert.deepEqual(getEmployeeActivityPhotosForRange([], range), []);
});
