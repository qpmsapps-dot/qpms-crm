import { normalizeGpsEvidence, planGpsSegments } from './foCanonicalKmEngineV2.js';

export const kmError = (code, message, statusCode = 409) => Object.assign(new Error(message), { code, statusCode });
export function attendanceDayBounds(date) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw kmError('km_date_invalid', 'Invalid attendance date.');
  const start = new Date(`${date}T00:00:00+05:30`);
  if (!Number.isFinite(+start)) throw kmError('km_date_invalid', 'Invalid attendance date.');
  return [start, new Date(+start + 86400000)];
}
export async function evidencePages(factory, { pageSize = 1000, maximum = 50000 } = {}) {
  const rows = [];
  for (let offset = 0; offset <= maximum; offset += pageSize) {
    const { data, error } = await factory().range(offset, offset + pageSize - 1);
    if (error) throw Object.assign(error, { code: error.code || 'km_evidence_fetch_failed' });
    rows.push(...(data || []));
    if (rows.length > maximum) throw kmError('km_evidence_limit', 'Evidence exceeds the bounded limit; no partial calculation was saved.');
    if ((data || []).length < pageSize) return rows;
  }
  throw kmError('km_evidence_limit', 'Evidence retrieval was truncated; no zero or successful calculation is inferred.');
}
export function kmHaversine(a, b) {
  const rad = n => n * Math.PI / 180;
  const h = Math.sin(rad(b.latitude - a.latitude) / 2) ** 2 + Math.cos(rad(a.latitude)) * Math.cos(rad(b.latitude)) * Math.sin(rad(b.longitude - a.longitude) / 2) ** 2;
  return 12742 * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h));
}
export function trustworthyFixes(rows, attendance) {
  const normalized = normalizeGpsEvidence({ rows, attendance });
  const rejected = new Set();
  for (const segment of planGpsSegments(normalized.points).segments) {
    if (segment.status === 'rejected') rejected.add(segment.to);
  }
  return normalized.points.filter(p => !rejected.has(p) && p.captured_at && String(p.source).toLowerCase() === 'mobile');
}
export function detectSiteDeparture(points, site, checkIn, until) {
  if (!site || !checkIn) return null;
  const candidates = points.filter(p => p.capturedAt > new Date(checkIn) && p.capturedAt < new Date(until));
  for (let i = 1; i < candidates.length; i++) {
    const a = candidates[i - 1], b = candidates[i], gap = (b.capturedAt - a.capturedAt) / 1000;
    if (gap > 0 && gap <= 600 && kmHaversine(site, a) > 0.1 && kmHaversine(site, b) > 0.1 && kmHaversine(a, b) / (gap / 3600) <= 120) {
      return a; // Actual first corroborated outside fix, never a synthetic checkout.
    }
  }
  return null;
}
export async function loadKmEvidence(client, attendanceId, {closedJourneysOnly=false}={}) {
  const { data: attendance, error } = await client.from('fo_attendance').select('*').eq('id', attendanceId).single();
  if (error) throw error;
  const code = String(attendance.employee_code || attendance.fo_user_id || '').toUpperCase();
  if (!/^[A-Z0-9_-]+$/.test(code)) throw kmError('km_identity_invalid', 'Attendance employee identity is not verifiable.');
  const profiles = await evidencePages(() => client.from('profiles').select('id,auth_user_id,employee_code').eq('employee_code', code).order('id'));
  if (profiles.length !== 1) throw kmError('km_identity_ambiguous', 'Employee identity is ambiguous.');
  const identities = new Set([code, attendance.fo_user_id, profiles[0].id, profiles[0].auth_user_id].filter(Boolean).map(String));
  const [dayStart, dayEnd] = attendanceDayBounds(attendance.attendance_date);
  const start = new Date(Math.max(+dayStart, +new Date(attendance.login_time)));
  const activeVisits=closedJourneysOnly && !attendance.logout_time
    ? await evidencePages(()=>client.from('fo_site_visits').select('*').eq('attendance_id',attendance.id).order('check_in_time').order('id')) : null;
  const arrivals=activeVisits?.map(v=>Date.parse(v.check_in_time)).filter(t=>Number.isFinite(t)&&t>=+start&&t<=Date.now())||[];
  const closedCutoff=arrivals.length?Math.max(...arrivals)+1:Date.now();
  const autoEnded = /auto ended/i.test(attendance.status || '') || attendance.metadata?.auto_ended === true;
  const end = autoEnded ? dayEnd : new Date(Math.min(+dayEnd, attendance.logout_time ? +new Date(attendance.logout_time) + 1 : activeVisits ? closedCutoff : Date.now()));
  const or = `employee_code.eq.${code},fo_user_id.in.(${[...identities].join(',')})`;
  const [allRows, visits, snapshots, sessions, recoveries, corrections] = await Promise.all([
    evidencePages(() => client.from('fo_location_logs').select('*').or(or).gte('captured_at', start.toISOString()).lt('captured_at', end.toISOString()).order('captured_at').order('id')),
    activeVisits || evidencePages(() => client.from('fo_site_visits').select('*').eq('attendance_id', attendance.id).order('check_in_time').order('id')),
    evidencePages(() => client.from('fo_travel_legs').select('*').eq('attendance_id', attendance.id).order('started_at').order('id')),
    evidencePages(() => client.from('fo_attendance').select('id,login_time,logout_time').eq('employee_code', code).eq('attendance_date', attendance.attendance_date).order('id')),
    evidencePages(() => client.from('fo_october_km_recoveries').select('*').eq('employee_code', code).eq('attendance_date', attendance.attendance_date).eq('status', 'approved').order('id')),
    evidencePages(() => client.from('fo_travel_reimbursement_corrections').select('*').eq('attendance_id', attendance.id).eq('status', 'applied').order('id')),
  ]);
  const overlap = sessions.some(s => s.id !== attendance.id && new Date(s.login_time) < end && new Date(s.logout_time || dayEnd) > start);
  const rows = [...new Map(allRows.filter(r => {
    if (r.attendance_id) return r.attendance_id === attendance.id && (!r.employee_code || String(r.employee_code).toUpperCase() === code) && (!r.fo_user_id || identities.has(String(r.fo_user_id)));
    return !overlap && (!r.employee_code || String(r.employee_code).toUpperCase() === code) && identities.has(String(r.fo_user_id || r.employee_code));
  }).map(r => [r.id, r])).values()];
  // Keep original identity/timestamps in sourceRow; normalize aliases only for the
  // existing V2 validator, after authoritative ownership has been checked.
  const normalizedRows = rows.map(r => ({ ...r, original_identity:{fo_user_id:r.fo_user_id,employee_code:r.employee_code,attendance_id:r.attendance_id}, fo_user_id: attendance.fo_user_id || code }));
  const fixes = trustworthyFixes(normalizedRows, attendance);
  const storeIds = [...new Set(visits.filter(v => v.store_id && (v.check_out_latitude == null || v.check_out_longitude == null || v.check_in_latitude == null || v.check_in_longitude == null)).map(v => v.store_id))];
  const stores = new Map();
  for (let i=0;i<storeIds.length;i+=100) {
    const batch=await evidencePages(()=>client.from('store_master').select('id,latitude,longitude').in('id',storeIds.slice(i,i+100)).order('id'));
    for(const store of batch)stores.set(store.id,store);
  }
  for (const visit of visits) {
    if (visit.metadata?.auto_closed_reason === 'midnight_cleanup' || visit.metadata?.closed_source === 'end_day_open_site_auto_close') {
      visit.km_administrative_checkout_at = visit.check_out_time || visit.checkout_time;
      visit.check_out_time = null;
      visit.checkout_time = null;
    }
    const checkout = visit.check_out_time || visit.checkout_time;
    if (checkout && (visit.check_out_latitude == null || visit.check_out_longitude == null)) {
      const fix = fixes.filter(p => Math.abs(p.capturedAt - new Date(checkout)) <= 120000).sort((a, b) => Math.abs(a.capturedAt - new Date(checkout)) - Math.abs(b.capturedAt - new Date(checkout)))[0];
      if (fix) {
        visit.km_checkout_coordinate = { latitude: fix.latitude, longitude: fix.longitude };
        visit.km_checkout_time = fix.capturedAt;
        visit.km_checkout_source = 'verified_mobile_near_checkout';
      }
    }
    if (!visit.store_id) continue;
    const hasCoordinate = (visit.check_out_latitude != null && visit.check_out_longitude != null) && (visit.check_in_latitude != null && visit.check_in_longitude != null);
    if (hasCoordinate) continue;
    const store=stores.get(visit.store_id);
    if (store) visit.km_store_coordinate = { latitude: store.latitude, longitude: store.longitude, source: 'store_master', store_id: store.id };
  }
  return { attendance, visits, snapshots, rows: normalizedRows, originalRows: rows, recoveries, corrections, overlap };
}
