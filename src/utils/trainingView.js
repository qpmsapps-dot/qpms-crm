import { operationalTrainingRows, summarizeTrainingByClass } from './retailStatePerformance.js';
import { reportingState } from '../../backend/shared/retailAttendance.js';
import { matchesReportQuery } from './retailReportView.js';
export function filterTrainingRows(rows, filter = {}, query = '') {
  return rows.filter(s => (!filter.state || reportingState(s.state) === reportingState(filter.state)) && (!filter.class || s.training_class === filter.class) && (!filter.zone || s.ownership.zone_id === filter.zone) && (!filter.fo || s.ownership.fo_profile_id === filter.fo) && (!filter.store || s.canonical_store_id === filter.store) && (!filter.status || s.status === filter.status) && matchesReportQuery([s.store?.store_code, s.store?.store_name, s.trainer_name, s.training_date, s.training_class], query));
}
export const recordedCount = value => typeof value === 'number' && Number.isInteger(value) && value >= 0 ? value : null;
export function trainingTopics(row = {}, detail) {
  const selected = recordedCount(detail?.counts?.topics) ?? (Array.isArray(detail?.topics) ? detail.topics.length : recordedCount(row.topic_count));
  const explicit = recordedCount(detail?.counts?.topics_covered);
  const covered = explicit != null && (selected == null || explicit <= selected) ? explicit
    : Array.isArray(detail?.topics) && detail.topics.every(t => typeof t.is_covered === 'boolean') ? detail.topics.filter(t => t.is_covered).length : null;
  return { selected, covered, unknown: selected == null, missing: selected === 0 };
}
export function trainingEvidenceState(row) {
  const count = recordedCount(row.evidence_count);
  if (count > 0) return 'Available';
  if (row.evidence_required === true && count === 0) return 'Missing required';
  return 'Unknown';
}
export function trainingOverview(rows) {
  const operational = operationalTrainingRows(rows),
    summary = summarizeTrainingByClass(operational);
  const known = operational.filter(r => recordedCount(r.attendee_count) != null);
  return {
    summary,
    total: operational.length,
    hk: operational.filter(r => r.training_class === 'HK').length,
    mepc: operational.filter(r => r.training_class === 'MEPC').length,
    attendees: known.reduce((n, r) => n + r.attendee_count, 0),
    attendeeCoverage: known.length,
    withEvidence: operational.filter(r => trainingEvidenceState(r) === 'Available').length,
    missingEvidence: operational.filter(r => trainingEvidenceState(r) === 'Missing required').length,
    unknownEvidence: operational.filter(r => trainingEvidenceState(r) === 'Unknown').length,
    unknownTopicMetadata: operational.filter(r => trainingTopics(r).unknown).length,
    missingMetadata: operational.filter(r => trainingTopics(r).missing || Object.hasOwn(r, 'trainer_name') && !String(r.trainer_name || '').trim()).length
  };
}
export function trainingExportRows(rows) {
  return rows.map(row => [row.training_date, row.training_class, row.store?.store_code, row.state, row.reporting_state, isExcel(row) ? row.match_status : row.canonical_store_id ? 'Verified' : 'Identity review required', isExcel(row) ? row.source_data?.employee_name : row.trainer_name, row.status, row.attendee_count ?? null, row.evidence_count ?? null, row.ownership?.zone_id, row.ownership?.fo_profile_id, isExcel(row) ? 'October Excel' : 'Operational', isExcel(row) ? 'No' : 'See audit']);
}
const isExcel = row => row.source_kind === 'IFMS_EXCEL';
