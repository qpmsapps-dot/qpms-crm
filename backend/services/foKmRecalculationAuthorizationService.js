const CROSS_ATTENDANCE_ROLE_KEYS = new Set([
  'ADMIN',
  'QPMSADMIN',
  'DEVELOPER',
  'MANAGEMENT',
  'MD',
  'COO',
  'GM',
  'GENERALMANAGER',
  'GMTOPMANAGEMENT',
  'TOPMANAGEMENT',
  'BUSINESSHEAD',
  'SOUTHHEAD',
  'BRANCHHEAD',
  'OPERATIONSMANAGER',
  'EXISTINGBUSINESSOPERATIONSTEAM',
]);

function normalized(value) {
  return String(value || '').trim().toUpperCase().replace(/[^A-Z0-9]+/g, '');
}

function authorizationError(statusCode, message) {
  const error = new Error(message);
  error.statusCode = statusCode;
  return error;
}

function activeProfile(profile) {
  if (!profile || profile.is_active !== true) return false;
  return !['INACTIVE', 'DISABLED', 'DEACTIVATED'].includes(
    normalized(profile.status),
  );
}

function canRecalculateOtherFoAttendance(profile) {
  return activeProfile(profile) &&
    profile.web_access_enabled !== false &&
    CROSS_ATTENDANCE_ROLE_KEYS.has(normalized(profile.role));
}

function ownsAttendance(profile, attendance) {
  const employeeCode = normalized(profile?.employee_code);
  if (!employeeCode) return false;
  return [attendance?.employee_code, attendance?.fo_user_id]
    .some((value) => normalized(value) === employeeCode);
}

async function loadAttendance(client, payload = {}) {
  const attendanceId = String(payload.attendance_id || payload.id || '').trim();
  let query = client
    .from('fo_attendance')
    .select('id,fo_user_id,employee_code,attendance_date,login_time');

  if (attendanceId) {
    query = query.eq('id', attendanceId);
  } else {
    const employeeCode = String(
      payload.employee_code || payload.fo_user_id || '',
    ).trim();
    if (!employeeCode) {
      throw authorizationError(400, 'attendance_id is required.');
    }
    query = query.eq(
      payload.employee_code ? 'employee_code' : 'fo_user_id',
      employeeCode,
    );
    const date = String(payload.date || payload.attendance_date || '').trim();
    if (date) query = query.eq('attendance_date', date);
    query = query.order('login_time', { ascending: false }).limit(1);
  }

  const { data, error } = await query.maybeSingle();
  if (error) throw error;
  if (!data) throw authorizationError(404, 'Attendance not found.');
  return data;
}

export async function authorizeFoKmRecalculation({
  client,
  payload,
  profile,
}) {
  if (!activeProfile(profile)) {
    throw authorizationError(403, 'Your profile cannot recalculate attendance KM.');
  }
  const attendance = await loadAttendance(client, payload);
  if (!ownsAttendance(profile, attendance) &&
      !canRecalculateOtherFoAttendance(profile)) {
    throw authorizationError(
      403,
      'You cannot recalculate another employee attendance.',
    );
  }
  return {
    attendance,
    payload: {
      ...payload,
      attendance_id: attendance.id,
      fo_user_id: attendance.fo_user_id || attendance.employee_code,
      employee_code: attendance.employee_code || attendance.fo_user_id,
      date: attendance.attendance_date || payload.date || null,
    },
  };
}

export const foKmRecalculationAuthorization = {
  activeProfile,
  canRecalculateOtherFoAttendance,
  ownsAttendance,
};
