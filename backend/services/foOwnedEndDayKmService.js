import { foKmRecalculationAuthorization } from './foKmRecalculationAuthorizationService.js';

const uuid = value => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(String(value || ''));
const finite = value => value != null && Number.isFinite(Number(value)) && Number(value) >= 0;
const columns = 'id,fo_user_id,employee_code,attendance_date,logout_time,status,updated_at,total_approved_km,eligible_km,petrol_amount,route_sync_status,metadata';

// Attendance closure already creates the transactional outbox job. This endpoint
// acknowledges that existing workflow; it never claims, enqueues or posts money.
export async function ownedEndDayKmStatus(client, profile, payload, environment = process.env) {
  if (!foKmRecalculationAuthorization.activeProfile(profile) || !uuid(payload.attendance_id) ||
      payload.manual_refresh === true || payload.approval_reason || payload.authorization_reference ||
      payload.dry_run === true || payload.dryRun === true) return null;
  const read = async () => {
    const {data,error} = await client.from('fo_attendance').select(columns).eq('id',payload.attendance_id).maybeSingle();
    if(error) throw error;
    return data;
  };
  const attendance = await read();
  if (!attendance || !foKmRecalculationAuthorization.ownsAttendance(profile,attendance)) return null;
  const completed = a => a?.logout_time && !['active','cancelled','canceled'].includes(String(a.status || '').toLowerCase());
  if (!completed(attendance)) throw Object.assign(new Error('Completed attendance is required; this End Day may have been reopened.'),{statusCode:409,code:'KM_COMPLETED_ATTENDANCE_REQUIRED'});
  const metadata = attendance.metadata || {};
  let receipt = null;
  const incremental = attendance.route_sync_status === 'canonical_v2_incremental_persisted' && uuid(metadata.shared_km_last_receipt);
  if (incremental) {
    const {data,error} = await client.rpc('rpc_fo_km_reconciliation_state_v1',{p_attendance_id:attendance.id});
    if(error) throw error;
    receipt = (data?.credits || []).find(c => c.id === metadata.shared_km_last_receipt && c.attendance_id === attendance.id &&
      c.applied_to_attendance === true && new Date(c.created_at) >= new Date(attendance.logout_time) &&
      /^[0-9a-f]{64}$/.test(c.input_digest || ''));
  }
  const legacy = attendance.route_sync_status === 'canonical_v2_persisted' &&
    metadata.canonical_recalculation_pending !== true && uuid(metadata.km_calculation_run_id) &&
    /^[0-9a-f]{64}$/.test(metadata.km_input_digest || '');
  // Do not confirm a receipt fetched across reopening, late GPS or another update.
  const latest = await read();
  if (!completed(latest)) throw Object.assign(new Error('Attendance was reopened; no final KM is confirmed.'),{statusCode:409,code:'KM_COMPLETED_ATTENDANCE_REQUIRED'});
  const stable = latest.updated_at === attendance.updated_at && latest.logout_time === attendance.logout_time;
  const saved = stable && (receipt || legacy) && finite(attendance.total_approved_km) && finite(attendance.petrol_amount) &&
    finite(attendance.eligible_km) && Math.abs(Number(attendance.eligible_km)-Number(attendance.total_approved_km)) < 0.011;
  const base = {attendance_id:attendance.id,date:attendance.attendance_date,logout_time:attendance.logout_time,
    attendance_updated_at:attendance.updated_at,last_reopened_at:metadata.last_reopened_at || null,dry_run:false};
  if (saved) return {...base,status:'persisted',updated:true,financial_posted:true,
    route_sync_status:attendance.route_sync_status,receipt_id:receipt?.id || null,
    calculation_run_id:metadata.km_calculation_run_id || null,input_digest:receipt?.input_digest || metadata.km_input_digest,
    total_approved_km:Number(attendance.total_approved_km),petrol_amount:Number(attendance.petrol_amount)};
  const paused = String(environment.KM_FINANCIAL_WRITES_EMERGENCY_PAUSE).toLowerCase() !== 'false' || environment.END_DAY_KM_AUTO_RECALC_ENABLED !== 'true';
  return {...base,status:'pending',updated:false,financial_posted:false,retryable:true,financial_paused:paused,
    retry_after_seconds:paused ? 120 : 30,message:'Attendance completed; canonical KM is awaiting the existing protected worker.'};
}
