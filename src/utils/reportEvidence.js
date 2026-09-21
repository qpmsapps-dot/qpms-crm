import {
  buildActivityPhotoExportRows,
  getEmployeeActivityPhotosForRange,
} from './activityPhotoExport.js';

const IMAGE_EXTENSION = /\.(png|jpe?g|webp|gif|bmp|heic|heif)(?:$|[?#])/i;

function text(value) {
  return String(value ?? '').trim();
}

function indiaDateKey(value) {
  if (!value) return '';
  const raw = text(value);
  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) return raw;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Kolkata', year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(date);
  const part = (type) => parts.find((entry) => entry.type === type)?.value || '';
  return `${part('year')}-${part('month')}-${part('day')}`;
}

function proofDate(proof = {}) {
  return proof.date || proof.attendance_date || proof.claim_date || proof.submitted_at || proof.created_at || null;
}

function proofReference(proof = {}) {
  return proof.storage_path || proof.proof_reference || proof.proof_file_url || proof.authorized_signed_url || proof.signed_url || '';
}

export function travelClaimProofIsImage(proof = {}) {
  const mime = text(proof.mime_type || proof.content_type || proof.file_type).toLowerCase();
  if (mime.startsWith('image/')) return true;
  if (mime && !mime.startsWith('image/')) return false;
  return IMAGE_EXTENSION.test(text(proof.filename || proof.file_name || proofReference(proof)));
}

export function getEmployeeTravelClaimProofsForRange(proofs = [], options = {}) {
  const from = indiaDateKey(options.fromDate);
  const to = indiaDateKey(options.toDate);
  return (proofs || [])
    .filter((proof) => proof && proofReference(proof) && travelClaimProofIsImage(proof))
    .map((proof) => ({ ...proof, date: proofDate(proof) }))
    .filter((proof) => {
      const date = indiaDateKey(proof.date);
      if (!date) return true;
      return (!from || date >= from) && (!to || date <= to);
    });
}

export function reportEvidenceKey(domain, record = {}, index = 0) {
  return `${domain}:${record.id || record.record_id || record.storage_path || record.proof_reference || index}`;
}

export function buildReportEvidence({
  activityUploads = [],
  travelClaimProofs = [],
  fromDate,
  toDate,
  visits = [],
  attendances = [],
} = {}) {
  const range = { fromDate, toDate, visits, attendances };
  const activityPhotos = getEmployeeActivityPhotosForRange(activityUploads, range);
  const normalizedTravelClaimProofs = getEmployeeTravelClaimProofsForRange(travelClaimProofs, range);
  return {
    activityPhotos,
    travelClaimProofs: normalizedTravelClaimProofs,
    totalEvidenceCount: activityPhotos.length + normalizedTravelClaimProofs.length,
  };
}

export function buildTravelClaimProofExportRows(proofs = [], formatters = {}) {
  const formatDate = formatters.formatDate || ((value) => value || '');
  const money = formatters.money || ((value) => value ?? '');
  const mode = formatters.travelMode || ((value) => value || '-');
  return proofs.map((proof) => ({
    proof,
    'Date': formatDate(proofDate(proof)),
    'Travel Mode': mode(proof.travel_mode),
    'Claim / Expense Type': proof.claim_type || '-',
    'Amount': money(proof.amount ?? proof.eligible_amount ?? proof.claimed_amount ?? proof.fare_amount ?? 0),
    'Status': proof.status || proof.approval_status || '-',
    'Proof': 'Image pending',
    'View Original': '',
  }));
}

export function buildReportEvidenceRows(evidence = {}, formatters = {}) {
  return {
    activityPhotos: buildActivityPhotoExportRows(evidence.activityPhotos || [], formatters),
    travelClaimProofs: buildTravelClaimProofExportRows(evidence.travelClaimProofs || [], formatters),
  };
}
