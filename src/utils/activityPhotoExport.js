const IMAGE_EXTENSION = /\.(png|jpe?g|webp|gif|bmp|heic|heif)(?:$|[?#])/i;
const DOCUMENT_EXTENSION = /\.(pdf|docx?|xlsx?|csv|txt)(?:$|[?#])/i;

function metadataFor(row = {}) {
  return row.metadata && typeof row.metadata === 'object' && !Array.isArray(row.metadata)
    ? row.metadata
    : {};
}

function firstValue(...values) {
  return values.find((value) => value !== null && value !== undefined && String(value).trim()) || null;
}

export function buildActivityPhotoExportRows(uploads = [], formatters = {}) {
  const formatDate = formatters.formatDate || ((value) => value || '');
  const formatTime = formatters.formatTime || ((value) => value || '');
  const activityType = formatters.activityType || ((value) => value || 'Others');
  return uploads.map((upload) => {
    const metadata = metadataFor(upload);
    const submission = upload.submission || {};
    const siteName = firstValue(
      upload.site_name,
      upload.store_name,
      submission.site_name,
      submission.store_name,
      upload.store_code,
      submission.store_code,
    );
    const clientName = firstValue(upload.client_name, submission.client_name, metadata.client_name);
    const date = upload.activityDate || activityPhotoDate(upload, formatters);
    return {
      upload,
      'Date': formatDate(date),
      'Site / Client': [siteName, clientName].filter(Boolean).join(' / ') || '--',
      'Activity Type': upload.activityGroup || activityType(upload.activity_type || upload.upload_role || submission.activity_type),
      'Activity Time': formatTime(date),
      'Photo': 'Image pending',
      'View Original': '',
      'Remarks': firstValue(upload.remarks, submission.remarks, metadata.remarks, '-'),
    };
  });
}

function linkedRow(rows, id) {
  if (!id) return null;
  return rows.find((row) => String(row?.id || '') === String(id)) || null;
}

export function activityUploadIsDocument(upload = {}) {
  const metadata = metadataFor(upload);
  const type = String(firstValue(upload.file_type, upload.mime_type, upload.content_type, metadata.file_type, metadata.mime_type, metadata.content_type) || '').toLowerCase();
  const role = String(firstValue(upload.upload_role, metadata.upload_role) || '').toLowerCase();
  const name = String(firstValue(upload.file_name, upload.file_url, upload.storage_path, upload.path) || '').toLowerCase();
  return metadata.training_document === true ||
    metadata.supporting_document === true ||
    role.includes('document') ||
    role.includes('pdf') ||
    type.includes('pdf') ||
    type.includes('document') ||
    DOCUMENT_EXTENSION.test(name);
}

export function activityUploadIsPhoto(upload = {}) {
  if (!upload || activityUploadIsDocument(upload)) return false;
  const metadata = metadataFor(upload);
  const type = String(firstValue(upload.file_type, upload.mime_type, upload.content_type, metadata.file_type, metadata.mime_type, metadata.content_type) || '').toLowerCase();
  const role = String(firstValue(upload.upload_role, metadata.upload_role, metadata.file_role) || '').toLowerCase();
  const name = String(firstValue(upload.file_name, upload.file_url, upload.storage_path, upload.path, upload.authorized_signed_url) || '').toLowerCase();
  if (type.startsWith('image/') || IMAGE_EXTENSION.test(name)) return true;
  if (/photo|image|camera|before|after/.test(role)) return true;
  // Legacy activity rows can omit MIME/name while still carrying an authorized image object.
  return Boolean(firstValue(upload.file_url, upload.storage_path, upload.path, upload.authorized_signed_url)) && !type;
}

function flattenedUploads(items = []) {
  const flattened = [];
  for (const item of items || []) {
    if (!item) continue;
    const nested = [item.uploads, item.images, item.attachments].find(Array.isArray);
    if (!nested) {
      flattened.push(item);
      continue;
    }
    nested.forEach((upload) => flattened.push({ ...item, ...upload, submission: upload.submission || item.submission || item }));
  }
  return flattened;
}

export function activityPhotoDate(upload = {}, { visits = [], attendances = [] } = {}) {
  const metadata = metadataFor(upload);
  const submission = upload.submission || {};
  const submissionMetadata = metadataFor(submission);
  const visit = linkedRow(visits, firstValue(upload.site_visit_id, submission.site_visit_id));
  const attendance = linkedRow(attendances, firstValue(upload.attendance_id, submission.attendance_id));
  return firstValue(
    upload.activity_date,
    upload.visit_date,
    upload.attendance_date,
    metadata.activity_date,
    metadata.visit_date,
    metadata.attendance_date,
    submission.activity_date,
    submission.visit_date,
    submission.attendance_date,
    submissionMetadata.activity_date,
    submissionMetadata.visit_date,
    submissionMetadata.attendance_date,
    visit?.attendance_date,
    visit?.check_in_time,
    attendance?.attendance_date,
    attendance?.login_time,
    submission.submitted_at,
    submission.created_at,
    upload.uploaded_at,
    upload.created_at,
  );
}

function indiaDateKey(value) {
  if (!value) return '';
  const text = String(value);
  if (/^\d{4}-\d{2}-\d{2}$/.test(text)) return text;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Kolkata', year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(date);
  const part = (type) => parts.find((entry) => entry.type === type)?.value || '';
  return `${part('year')}-${part('month')}-${part('day')}`;
}

export function getEmployeeActivityPhotosForRange(uploads = [], options = {}) {
  const from = indiaDateKey(options.fromDate);
  const to = indiaDateKey(options.toDate);
  return flattenedUploads(uploads)
    .filter(activityUploadIsPhoto)
    .map((upload) => ({
      ...upload,
      activityDate: activityPhotoDate(upload, options),
    }))
    .filter((upload) => activityUploadIsInRange(upload, { ...options, fromDate: from, toDate: to }));
}

export function activityUploadIsInRange(upload = {}, options = {}) {
  const from = indiaDateKey(options.fromDate);
  const to = indiaDateKey(options.toDate);
  if (!from && !to) return true;
  const date = indiaDateKey(upload.activityDate || activityPhotoDate(upload, options));
  // The authorized drilldown response is already range-scoped. Unknown legacy dates
  // remain eligible instead of being silently discarded.
  if (!date) return true;
  return (!from || date >= from) && (!to || date <= to);
}
