import { loadKmEvidence, evidencePages } from './foKmEvidenceService.js';
import { resolveEffectiveAttendanceEnd } from '../foKmRecalculationService.js';

export async function attachEffectiveEndEvidence(client, attendances, environment = process.env) {
  if (environment.KM_INCREMENTAL_REPORTING_ENABLED !== 'true') return attendances;
  for (const attendance of attendances) {
    if (!attendance.logout_time) continue;
    try {
      const snapshot = await loadKmEvidence(client, attendance.id);
      const end = await resolveEffectiveAttendanceEnd(client, attendance, { evidenceRows: snapshot.rows });
      const credits = await evidencePages(() => client.from('fo_km_incremental_credits').select('id,created_at,evidence').eq('attendance_id',attendance.id).order('created_at').order('id'));
      const final = credits.filter(c => c.evidence?.type === 'last_checkout_to_end_day').at(-1)?.evidence;
      attendance.metadata = { ...attendance.metadata, effective_end_evidence: {
        latitude: end.coordinate?.latitude ?? null, longitude: end.coordinate?.longitude ?? null,
        captured_at: end.time?.toISOString() ?? null, administrative_end_at: attendance.logout_time,
        source: end.source, age_minutes: end.ageMinutes, status: end.evidenceStatus,
      }, ...(final ? {shared_km_final_leg:final,final_return_leg_km:final.km,final_return_leg_provider:final.source} : {}) };
    } catch (error) {
      attendance.metadata = { ...attendance.metadata, effective_end_evidence: { status: 'retrieval_failed', code: error.code || 'KM_EVIDENCE_FAILED', latitude: null, longitude: null, captured_at: null } };
    }
  }
  return attendances;
}
