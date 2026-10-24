import { createHash } from 'node:crypto';
import { normalizeGpsEvidence, planGpsSegments } from './foCanonicalKmEngineV2.js';

export const recoveryDigest = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
export const roundKm = value => Math.round(Number(value) * 100) / 100;
export function recoveryError(code, message, statusCode = 409) {
  return Object.assign(new Error(message), { code, statusCode });
}
export function octoberDate(value) {
  if (!/^2026-10-(0[1-9]|[12][0-9]|3[01])$/.test(String(value))) throw recoveryError('RECOVERY_DATE_INVALID', 'Select a date in October 2026.', 400);
  return value;
}
export function recoveryDayBounds(date) {
  octoberDate(date);
  return [new Date(`${date}T00:00:00+05:30`), new Date(new Date(`${date}T00:00:00+05:30`).getTime() + 86400000)];
}
const overlap = (a, b, c, d) => a < d && b > c;
const positive = value => value !== null && value !== undefined && Number.isFinite(Number(value)) && Number(value) > 0;

// This is a read-only analysis of movement, not a payable-distance calculator.
// Site events never delimit continuous reconstruction. Attendance sessions do.
export function reconstructOctoberTravel({ date, employee, attendances = [], rows = [], savedLegs = [], recoveries = [], now = new Date() }) {
  const [dayStart, dayEnd] = recoveryDayBounds(date);
  const identities = new Set([employee.employee_code, employee.id].filter(Boolean).map(String));
  const sessions = attendances.filter(a => a.attendance_date === date);
  const sessionById = new Map(sessions.map(a => [String(a.id), a]));
  const groups = new Map(); const excluded = []; const late = [];
  for (const row of rows) {
    const stamp = new Date(row.captured_at || row.logged_at);
    if (!Number.isFinite(stamp.getTime()) || stamp < dayStart || stamp >= dayEnd) continue;
    if (!identities.has(String(row.employee_code)) && !identities.has(String(row.fo_user_id))) { excluded.push({ id: row.id, reason: 'identity_mismatch' }); continue; }
    let session = row.attendance_id ? sessionById.get(String(row.attendance_id)) : null;
    if (row.attendance_id && !session) { excluded.push({ id: row.id, reason: 'foreign_attendance_session' }); continue; }
    if (sessions.filter(a => new Date(a.login_time) <= stamp && (!a.logout_time || stamp <= new Date(a.logout_time))).length > 1) { excluded.push({ id: row.id, reason: 'overlapping_attendance_sessions' }); continue; }
    if (!session) {
      const candidates = sessions.filter(a => new Date(a.login_time) <= stamp && (!a.logout_time || stamp <= new Date(a.logout_time)));
      if (candidates.length > 1) { excluded.push({ id: row.id, reason: 'ambiguous_attendance_session' }); continue; }
      session = candidates[0];
    }
    const group = session?.id || 'unbound_official_travel_review';
    const list = groups.get(group) || []; list.push({ row, session }); groups.set(group, list);
  }
  const segments = []; const rejected = [...excluded]; const lateIds = new Set();
  for (const [sessionId, list] of groups) {
    const points = [];
    for (const { row, session } of list) {
      // Original provider time, identity and local sync ID are required before
      // late arrival can be analysed. Do not rewrite logged_at/captured_at.
      const lateSeconds = (new Date(row.logged_at) - new Date(row.captured_at)) / 1000;
      const verifiedLate = lateSeconds > 600 && new Date(row.logged_at) <= now && row.captured_at && row.local_id && row.is_mocked === false &&
        row.source === 'mobile' && !['stale_provider_timestamp', 'future_provider_timestamp', 'missing_provider_timestamp_compat'].includes(row.metadata?.provider_timestamp_quality);
      const result = normalizeGpsEvidence({ rows: [row], attendance: session || { employee_code: employee.employee_code, fo_user_id: employee.id, login_time: dayStart.toISOString(), logout_time: dayEnd.toISOString() }, now,
        policy: verifiedLate ? { providerMaxAgeSeconds: lateSeconds + 1 } : {} });
      rejected.push(...result.rejected);
      points.push(...result.points);
      if (verifiedLate && result.points.length) { late.push(row.id); lateIds.add(row.id); }
    }
    // Re-run the unchanged engine's deduplication/oscillation logic after the
    // per-row late-sync check. Exempt only already-verified late-arrival rows.
    const normalized = normalizeGpsEvidence({ rows: points.map(p => p.sourceRow), attendance: list[0].session || { employee_code: employee.employee_code, fo_user_id: employee.id, login_time: dayStart.toISOString(), logout_time: dayEnd.toISOString() }, now,
      policy: { providerMaxAgeSeconds: Math.max(600, ...points.filter(p => lateIds.has(p.id)).map(p => (p.receivedAt - p.capturedAt) / 1000 + 1)) } });
    rejected.push(...normalized.rejected);
    for (const segment of planGpsSegments(normalized.points).segments) {
      if (segment.status === 'ignored' || segment.status === 'rejected') continue;
      const from = segment.from.capturedAt.toISOString(), to = segment.to.capturedAt.toISOString();
      const included = savedLegs.filter(l => !l.superseded_at && l.status !== 'cancelled' && l.status !== 'superseded' && positive(l.payable_km) && l.started_at && l.ended_at && overlap(new Date(from), new Date(to), new Date(l.started_at), new Date(l.ended_at)));
      const credited = recoveries.filter(r => r.status === 'approved' && overlap(new Date(from), new Date(to), new Date(r.journey_start), new Date(r.journey_end)));
      const accepted = segment.status === 'accepted_gps';
      segments.push({ id: recoveryDigest([employee.employee_code, sessionId, from, to]), attendance_id: sessionId === 'unbound_official_travel_review' ? null : sessionId,
        from_time: from, to_time: to, from: { latitude: segment.from.latitude, longitude: segment.from.longitude }, to: { latitude: segment.to.latitude, longitude: segment.to.longitude },
        gps_km: accepted ? roundKm(segment.straightLineKm) : null, status: included.length || credited.length ? 'already_included' : accepted ? 'calculated_evidence' : 'gap_review_required',
        saved_leg_ids: included.map(l => l.id), approved_recovery_ids: credited.map(r => r.id),
        source_point_ids: [segment.from.id, segment.to.id], source: 'quality_filtered_gps',
        late_sync_review: [segment.from.id, segment.to.id].some(id => lateIds.has(id)),
        timestamp_review_required: segment.from.legacyTimestampBoundary || segment.to.legacyTimestampBoundary,
        suspected_public_transport_review: segment.impliedSpeedKmph >= 70,
        unbound_attendance_review: sessionId === 'unbound_official_travel_review', reason: segment.reason });
    }
  }
  const known = sessions.every(a => a.total_approved_km !== null && a.total_approved_km !== undefined && Number.isFinite(Number(a.total_approved_km)));
  return { date, employee_code: employee.employee_code, calculated_travel_km: segments.some(s => s.gps_km !== null) ? roundKm(segments.reduce((n, s) => n + (s.gps_km || 0), 0)) : null,
    existing_payable_km: known ? roundKm(sessions.reduce((n, a) => n + Number(a.total_approved_km), 0)) : null,
    saved_legs: savedLegs, segments, rejected, late_sync_point_ids: [...new Set(late)],
    status: segments.length ? 'review_required' : 'insufficient_evidence',
    message: 'Travel evidence is not an unpaid-distance entitlement. Missing events or GPS do not deny manual recovery. Review inclusion, official purpose and recorded transport mode before approval.',
    recorded_transport_review: sessions.some(a => ['auto','bus','train','other'].includes(a.travel_mode)),
    auto_payable_km: null, writes: 0 };
}

export async function recoveryPages(query) {
  const all = [];
  for (let offset = 0; offset < 20000; offset += 1000) {
    const request = query().range(offset, offset + 999);
    const { data, error } = await (typeof request.abortSignal === 'function' ? request.abortSignal(AbortSignal.timeout(20000)) : request);
    if (error) throw error;
    all.push(...(data || []));
    if ((data || []).length < 1000) return all;
  }
  throw recoveryError('RECOVERY_EVIDENCE_LIMIT', 'Evidence exceeded the safe read limit; narrow the scope.', 413);
}
