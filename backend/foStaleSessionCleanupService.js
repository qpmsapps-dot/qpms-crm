const STALE_VISIT_STATUS = 'Stale Auto Closed';
const STALE_ATTENDANCE_STATUS = 'Stale Auto Ended';

let cleanupInFlight = false;

export function currentIndiaDateInput(date = new Date()) {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Kolkata',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(date);
}

function nextIndiaMidnightUtcIso(attendanceDate) {
  const [year, month, day] = String(attendanceDate || '').slice(0, 10).split('-').map(Number);
  if (!year || !month || !day) return null;
  const nextIndiaMidnightUtcMs = Date.UTC(year, month - 1, day + 1, 0, 0, 0, 0) - (5.5 * 60 * 60 * 1000);
  return new Date(nextIndiaMidnightUtcMs).toISOString();
}

function mergeMetadata(row, metadata) {
  const existing = row?.metadata && typeof row.metadata === 'object' && !Array.isArray(row.metadata)
    ? row.metadata
    : {};
  return { ...existing, ...metadata };
}

function logCleanup(event, detail = {}) {
  console.log('[myQPMS FO stale cleanup]', event, detail);
}

async function closeOpenVisitsForAttendance(client, attendance, executedAt) {
  const attendanceId = String(attendance.id || '').trim();
  if (!attendanceId) return 0;
  const closeAt = nextIndiaMidnightUtcIso(attendance.attendance_date);
  if (!closeAt) return 0;
  const { data: visits, error: visitsError } = await client
    .from('fo_site_visits')
    .select('id, metadata')
    .eq('attendance_id', attendanceId)
    .filter('checkout_time', 'is', null)
    .filter('check_out_time', 'is', null)
    .limit(500);
  if (visitsError) throw visitsError;

  let closed = 0;
  for (const visit of visits || []) {
    const metadata = mergeMetadata(visit, {
      stale_auto_closed: true,
      cleanup_reason: 'Previous-day open visit',
      cleanup_source: 'backend_day_rollover',
      cleanup_executed_at: executedAt,
    });
    const { error } = await client
      .from('fo_site_visits')
      .update({
        status: STALE_VISIT_STATUS,
        visit_status: STALE_VISIT_STATUS,
        checkout_time: closeAt,
        check_out_time: closeAt,
        metadata,
        updated_at: executedAt,
      })
      .eq('id', visit.id)
      .filter('checkout_time', 'is', null)
      .filter('check_out_time', 'is', null);
    if (error) throw error;
    closed += 1;
  }
  return closed;
}

async function hasTodayActiveAttendance(client, foUserId, today) {
  const foId = String(foUserId || '').trim();
  if (!foId) return false;
  const { data, error } = await client
    .from('fo_attendance')
    .select('id')
    .eq('fo_user_id', foId)
    .eq('attendance_date', today)
    .eq('status', 'Active')
    .filter('logout_time', 'is', null)
    .limit(1);
  if (error) throw error;
  return Boolean(data?.length);
}

async function resetLiveStatusIfSafe(client, attendance, today, executedAt) {
  const foId = String(attendance.fo_user_id || '').trim();
  if (!foId) return { reset: false, skippedTodayActive: false };
  if (await hasTodayActiveAttendance(client, foId, today)) {
    return { reset: false, skippedTodayActive: true };
  }
  const { error } = await client
    .from('fo_live_status')
    .update({
      is_online: false,
      is_tracking: false,
      current_status: 'Offline',
      active_site_visit_id: null,
      route_km_today: 0,
      updated_at: executedAt,
    })
    .eq('fo_user_id', foId);
  if (error) throw error;
  return { reset: true, skippedTodayActive: false };
}

async function closeStaleAttendance(client, attendance, executedAt) {
  const closeAt = nextIndiaMidnightUtcIso(attendance.attendance_date);
  if (!closeAt) return false;
  const metadata = mergeMetadata(attendance, {
    stale_auto_ended: true,
    cleanup_reason: 'Previous-day active attendance',
    cleanup_source: 'backend_day_rollover',
    cleanup_executed_at: executedAt,
  });
  const { data, error } = await client
    .from('fo_attendance')
    .update({
      status: STALE_ATTENDANCE_STATUS,
      logout_time: closeAt,
      metadata,
      updated_at: executedAt,
    })
    .eq('id', attendance.id)
    .eq('status', 'Active')
    .filter('logout_time', 'is', null)
    .select('id');
  if (error) throw error;
  return Boolean(data?.length);
}

export async function cleanupStaleFoSessions(client, options = {}) {
  if (cleanupInFlight) {
    return { ok: false, skipped: true, reason: 'cleanup_in_flight' };
  }
  cleanupInFlight = true;
  const today = options.today || currentIndiaDateInput();
  const executedAt = new Date().toISOString();
  const summary = {
    ok: true,
    indiaDate: today,
    attendanceRowsFound: 0,
    visitsClosed: 0,
    attendanceClosed: 0,
    liveStatusesReset: 0,
    skippedBecauseTodayAttendanceExists: 0,
    errors: [],
  };
  logCleanup('cleanup started', { indiaDate: today });
  try {
    const { data: attendanceRows, error } = await client
      .from('fo_attendance')
      .select('id, fo_user_id, attendance_date, metadata')
      .lt('attendance_date', today)
      .eq('status', 'Active')
      .filter('logout_time', 'is', null)
      .order('attendance_date', { ascending: true })
      .limit(options.limit || 500);
    if (error) throw error;
    summary.attendanceRowsFound = attendanceRows?.length || 0;

    for (const attendance of attendanceRows || []) {
      try {
        summary.visitsClosed += await closeOpenVisitsForAttendance(client, attendance, executedAt);
        if (await closeStaleAttendance(client, attendance, executedAt)) {
          summary.attendanceClosed += 1;
        }
        const liveResult = await resetLiveStatusIfSafe(client, attendance, today, executedAt);
        if (liveResult.reset) summary.liveStatusesReset += 1;
        if (liveResult.skippedTodayActive) summary.skippedBecauseTodayAttendanceExists += 1;
      } catch (error) {
        summary.errors.push({
          attendance_id: attendance.id,
          message: error.message,
          code: error.code,
        });
      }
    }
    logCleanup('cleanup finished', {
      indiaDate: summary.indiaDate,
      attendanceRowsFound: summary.attendanceRowsFound,
      visitsClosed: summary.visitsClosed,
      attendanceClosed: summary.attendanceClosed,
      liveStatusesReset: summary.liveStatusesReset,
      skippedBecauseTodayAttendanceExists: summary.skippedBecauseTodayAttendanceExists,
      errors: summary.errors.length,
    });
    return summary;
  } finally {
    cleanupInFlight = false;
  }
}
