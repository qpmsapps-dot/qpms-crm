import { adminKmApprovalAuthorization } from './foKmRecalculationAuthorizationService.js';
import { reconstructOctoberTravel, recoveryPages, recoveryDayBounds, recoveryError, roundKm, octoberDate } from './foOctoberRecoveryEvidenceService.js';
import { estimateOctoberRecoveryRoute } from '../foKmRecalculationService.js';

export const RECOVERY_REASONS = ['Missing Check-Out', 'Missing Check-In', 'Missing End Day', 'Sourcing / Recruitment', 'Emergency Site Visit', 'GPS Failure', 'Offline Sync Failure', 'Other Official Travel'];
const text = x => String(x ?? '').trim();
function admin(context) {
  return adminKmApprovalAuthorization(context.profile, context.authUser, 'October official travel recovery');
}
export function validateRecoveryJourney(payload) {
  const employee = text(payload.employee_code).toUpperCase();
  if (!/^[A-Z0-9_-]{2,40}$/.test(employee)) throw recoveryError('RECOVERY_EMPLOYEE_INVALID', 'Select an employee.', 400);
  const date = octoberDate(payload.date); const [start, end] = recoveryDayBounds(date);
  const from = new Date(payload.journey_start), to = new Date(payload.journey_end);
  if (!Number.isFinite(+from) || !Number.isFinite(+to) || from < start || to > end || from >= to || to > new Date()) throw recoveryError('RECOVERY_WINDOW_INVALID', 'Document a completed journey window within the selected date. No End Day is invented.', 400);
  if (!RECOVERY_REASONS.includes(payload.reason)) throw recoveryError('RECOVERY_REASON_INVALID', 'Select an official recovery reason.', 400);
  for (const field of ['journey_type', 'start_location', 'destination', 'explanation']) if (text(payload[field]).length < 3 || text(payload[field]).length > 3000) throw recoveryError('RECOVERY_DETAILS_REQUIRED', `Provide ${field}.`, 400);
  const requested = Number(payload.requested_km), total = Number(payload.journey_total_km);
  if (!Number.isFinite(requested) || requested <= 0 || requested > 500 || requested !== roundKm(requested) || !Number.isFinite(total) || total !== roundKm(total) || total < requested || total > 1000) throw recoveryError('RECOVERY_DISTANCE_INVALID', 'Document total journey KM and requested additional KM to two decimals (maximum 500 additional).', 400);
  if (!['bike', 'own_vehicle', 'car', 'auto', 'bus', 'train', 'other'].includes(payload.travel_mode)) throw recoveryError('RECOVERY_MODE_REQUIRED', 'Record the actual transport mode; public modes are not petrol eligible.', 400);
  const stops = payload.intermediate_stops || [], refs = payload.evidence_refs || [];
  if (!Array.isArray(stops) || stops.length > 10 || stops.some(s => !text(s) || text(s).length > 300) || !Array.isArray(refs) || refs.length > 10 || refs.some(s => text(s).length > 1000)) throw recoveryError('RECOVERY_EVIDENCE_INVALID', 'Use at most ten documented stops and evidence references.', 400);
  if (!/^[a-zA-Z0-9_-]{16,100}$/.test(text(payload.idempotency_key))) throw recoveryError('RECOVERY_KEY_REQUIRED', 'A stable request key is required.', 400);
  return { employee_code: employee, date, journey_start: from.toISOString(), journey_end: to.toISOString(), reason: payload.reason,
    journey_type: text(payload.journey_type), start_location: text(payload.start_location), destination: text(payload.destination), intermediate_stops: stops.map(text),
    explanation: text(payload.explanation), evidence_refs: refs.map(text), travel_mode: payload.travel_mode,
    requested_km: roundKm(requested), journey_total_km: roundKm(total), idempotency_key: text(payload.idempotency_key) };
}

export function createOctoberRecoveryService({ estimate = estimateOctoberRecoveryRoute, environment = process.env } = {}) {
  async function employee(client, code) {
    if (!/^[A-Z0-9_-]{2,40}$/.test(code)) throw recoveryError('RECOVERY_EMPLOYEE_INVALID', 'Select a valid employee code.', 400);
    const { data, error } = await client.from('profiles').select('id,employee_code,full_name,is_active').eq('employee_code', code).eq('is_active', true).limit(2);
    if (error) throw error;
    if (data?.length !== 1) throw recoveryError('RECOVERY_EMPLOYEE_AMBIGUOUS', 'Employee identity is missing or ambiguous.', 422);
    return data[0];
  }
  async function list(context, query) {
    admin(context);
    const code = text(query.employee_code).toUpperCase(); await employee(context.client, code);
    const from = octoberDate(query.date_from || query.date), to = octoberDate(query.date_to || query.date);
    if (from > to) throw recoveryError('RECOVERY_DATE_INVALID', 'Invalid selected range.', 400);
    const rows = await recoveryPages(() => context.client.from('fo_october_km_recoveries').select('*').eq('employee_code', code).gte('attendance_date', from).lte('attendance_date', to).order('created_at').order('id'));
    return { rows, approval_enabled: environment.KM_OCTOBER_RECOVERY_APPROVAL_ENABLED === 'true' && environment.KM_OCTOBER_RECOVERY_REPORTING_ENABLED === 'true', submission_enabled: environment.KM_OCTOBER_RECOVERY_REQUESTS_ENABLED === 'true' };
  }
  async function evidence(context, payload) {
    admin(context); const date = octoberDate(payload.date), code = text(payload.employee_code).toUpperCase();
    const person = await employee(context.client, code), [from, to] = recoveryDayBounds(date);
    const attendances = await recoveryPages(() => context.client.from('fo_attendance').select('*').eq('employee_code', code).eq('attendance_date', date).order('id'));
    const identity = `employee_code.eq.${code},fo_user_id.eq.${person.id},fo_user_id.eq.${code}`;
    const logs = await recoveryPages(() => context.client.from('fo_location_logs').select('*').or(identity).gte('captured_at', from.toISOString()).lt('captured_at', to.toISOString()).order('captured_at').order('id'));
    logs.push(...await recoveryPages(() => context.client.from('fo_location_logs').select('*').or(identity).is('captured_at', null).gte('logged_at', from.toISOString()).lt('logged_at', to.toISOString()).order('logged_at').order('id')));
    if (logs.length > 20000) throw recoveryError('RECOVERY_EVIDENCE_LIMIT', 'Combined GPS evidence exceeds the safe read limit.', 413);
    const savedLegs = attendances.length ? await recoveryPages(() => context.client.from('fo_travel_legs').select('*').in('attendance_id', attendances.map(a => a.id)).order('started_at').order('id')) : [];
    // The migration is an activation prerequisite. Do not hide an unavailable
    // ledger as an empty approved-credit history.
    let rows, historyStatus = 'available';
    try { ({ rows } = await list(context, { employee_code: code, date })); }
    catch (error) {
      if (!['42P01','PGRST205'].includes(error.code) || environment.KM_OCTOBER_RECOVERY_APPROVAL_ENABLED === 'true' || environment.KM_OCTOBER_RECOVERY_REQUESTS_ENABLED === 'true') throw error;
      // Analysis can run before installation, but unknown recovery history is
      // explicitly disclosed and can never authorize persistence.
      rows = []; historyStatus = 'unavailable_not_assumed_empty';
    }
    const result = reconstructOctoberTravel({ date, employee: person, attendances, rows: logs, savedLegs, recoveries: rows });
    const estimates = [];
    for (const gap of result.segments.filter(s => s.status === 'gap_review_required' && new Date(s.to_time) - new Date(s.from_time) <= 600000).slice(0, 3)) {
      const route = await estimate(gap.from, gap.to, { maxGoogleDirectionsCalls: 1 });
      estimates.push({ segment_id: gap.id, km: route?.ok ? route.distanceKm : null, source: 'GOOGLE_DIRECTIONS_ESTIMATE', status: route?.ok ? 'documented_estimate_not_actual_travel' : 'unavailable' });
    }
    if (payload.journey_start && payload.journey_end && estimates.length < 3) {
      const start = new Date(payload.journey_start), end = new Date(payload.journey_end);
      if (!Number.isFinite(+start) || !Number.isFinite(+end) || start < from || end > to || start >= end || end > new Date()) throw recoveryError('RECOVERY_WINDOW_INVALID', 'Select a completed journey window within this day.', 400);
      const visits = attendances.length ? await recoveryPages(() => context.client.from('fo_site_visits').select('*').in('attendance_id', attendances.map(a => a.id)).order('check_in_time').order('id')) : [];
      const anchors = [];
      const anchor = (time, lat, lng, source, id) => {
        if (time && lat !== null && lat !== undefined && lng !== null && lng !== undefined && Number.isFinite(Number(lat)) && Number.isFinite(Number(lng)) && Math.abs(Number(lat)) <= 90 && Math.abs(Number(lng)) <= 180 && (Number(lat) || Number(lng))) anchors.push({ time: new Date(time), latitude: Number(lat), longitude: Number(lng), source, record_id: id });
      };
      for (const a of attendances) { anchor(a.login_time,a.start_latitude,a.start_longitude,'recorded_start_day',a.id);anchor(a.logout_time,a.end_latitude,a.end_longitude,'recorded_end_day',a.id); }
      for (const v of visits) { anchor(v.check_in_time,v.check_in_latitude,v.check_in_longitude,'recorded_check_in',v.id);anchor(v.check_out_time,v.check_out_latitude,v.check_out_longitude,'recorded_check_out',v.id); }
      for (const s of result.segments) { anchor(s.from_time,s.from.latitude,s.from.longitude,'quality_filtered_gps',s.source_point_ids[0]);anchor(s.to_time,s.to.latitude,s.to.longitude,'quality_filtered_gps',s.source_point_ids[1]); }
      const closest = boundary => anchors.filter(a => Math.abs(a.time-boundary)<=120000).sort((a,b)=>Math.abs(a.time-boundary)-Math.abs(b.time-boundary))[0];
      const origin=closest(start), destination=closest(end);
      if (origin && destination && origin.time < destination.time) {
        const route=await estimate(origin,destination,{maxGoogleDirectionsCalls:1});
        estimates.push({segment_id:'documented_journey_window',km:route?.ok?route.distanceKm:null,source:'GOOGLE_DIRECTIONS_ESTIMATE',status:route?.ok?'comparison_only_never_replaces_gps_detours':'unavailable',origin,destination});
      }
    }
    return { ...result, recovery_history_status: historyStatus, route_estimates: estimates, employee_name: person.full_name, attendances: attendances.map(a => ({ id: a.id, mode: a.travel_mode, payable_km: a.total_approved_km, petrol_amount: a.petrol_amount, status: a.status })), recovery_rows: rows };
  }
  async function submit(context, payload) {
    const actor = admin(context), request = validateRecoveryJourney(payload);
    if (environment.KM_OCTOBER_RECOVERY_REQUESTS_ENABLED !== 'true') throw recoveryError('RECOVERY_REQUESTS_INACTIVE', 'Recovery request storage is inactive pending migration and release approval.', 503);
    await employee(context.client, request.employee_code);
    const { data, error } = await context.client.rpc('rpc_submit_fo_october_recovery_v1', { p_actor: actor.userId, p_request: request });
    if (error) throw error;
    return data;
  }
  async function decide(context, payload) {
    const actor = admin(context);
    if (environment.KM_OCTOBER_RECOVERY_APPROVAL_ENABLED !== 'true' || environment.KM_OCTOBER_RECOVERY_REPORTING_ENABLED !== 'true') throw recoveryError('RECOVERY_APPROVAL_INACTIVE', 'Approval is inactive. Reporting, dedicated transaction, permission and scoped pause-exception activation must be approved separately.', 503);
    if (!['approve', 'reject'].includes(payload.action) || !/^[0-9a-f-]{36}$/i.test(text(payload.id)) || text(payload.remarks).length < 10 || text(payload.remarks).length > 3000) throw recoveryError('RECOVERY_DECISION_INVALID', 'Select a request, action and approval remarks.', 400);
    const approvedKm = payload.action === 'approve' ? Number(payload.approved_km) : 0;
    if (!Number.isFinite(approvedKm) || approvedKm < 0 || approvedKm > 500 || (payload.action === 'approve' && approvedKm === 0)) throw recoveryError('RECOVERY_DISTANCE_INVALID', 'Enter positive additional KM.', 400);
    if (payload.action === 'approve' && (payload.verified_included_km === null || payload.verified_included_km === '' || payload.verified_included_km === undefined || !Number.isFinite(Number(payload.verified_included_km)) || Number(payload.verified_included_km) < 0 || text(payload.inclusion_resolution).length < 20)) throw recoveryError('RECOVERY_INCLUSION_UNVERIFIED', 'Explicitly verify already-included distance and explain why the addition is unpaid. Unknown is not zero.', 422);
    const { data, error } = await context.client.rpc('rpc_decide_fo_october_recovery_v1', { p_actor: actor.userId, p_id: payload.id, p_version: payload.version,
      p_action: payload.action, p_approved_km: approvedKm, p_remarks: text(payload.remarks), p_included_km: payload.action === 'approve' ? Number(payload.verified_included_km) : null,
      p_inclusion_resolution: text(payload.inclusion_resolution), p_idempotency_key: text(payload.idempotency_key) });
    if (error) throw error;
    return data;
  }
  return { list, evidence, submit, decide };
}
