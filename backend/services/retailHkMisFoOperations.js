import { indiaToday } from '../shared/retailAttendance.js';

// A deliberately small, read-only payload. Never return attendance financial
// columns, raw GPS tracks, personal contact details, or travel history.
const forbidden = () => Object.assign(new Error('HK-MIS access is limited to assigned Reliance Retail states.'), { statusCode: 403 });
const failed = (error) => Object.assign(new Error('Reliance Retail FO visibility is unavailable.'), { statusCode: 503, cause: error });
const numberOrNull = value => value != null && Number.isFinite(Number(value)) && Math.abs(Number(value)) <= 180 ? Number(value) : null;
const isCoordinate = (lat, lon) => lat != null && lon != null && Math.abs(lat) <= 90 && Math.abs(lon) <= 180;

export async function retailHkMisFoReport(client, access, state) {
  if (access?.active !== true || access?.role !== 'MIS_HK' || !state || !Array.isArray(access.states) || !access.states.includes(state)) {
    throw forbidden();
  }
  const { data: profiles, error: profileError } = await client.from('profiles')
    .select('employee_code,full_name,display_name,state')
    .eq('role', 'FO').eq('business', 'Reliance Retail')
    .eq('is_active', true).eq('status', 'Active').eq('state', state)
    .order('employee_code').limit(250);
  if (profileError) throw failed(profileError);
  if ((profiles || []).length >= 250) throw failed(new Error('FO scope exceeds safe bound'));
  const codes = [...new Set((profiles || []).map(p => p.employee_code).filter(Boolean))];
  const today = indiaToday();
  if (codes.length === 0) return { state, date: today, officers: [], location_note: 'Locations are last recorded, not live GPS.' };

  const dayStart = new Date(today + 'T00:00:00+05:30').toISOString();
  const dayEnd = new Date(new Date(dayStart).getTime() + 86400000).toISOString();
  const [attendance, visits] = await Promise.all([
    client.from('fo_attendance')
      .select('employee_code,login_time,logout_time,status,start_latitude,start_longitude,end_latitude,end_longitude')
      .eq('attendance_date', today).in('employee_code', codes)
      .order('login_time', { ascending: false }).limit(750),
    client.from('fo_site_visits')
      .select('employee_code,site_name,check_in_time,check_out_time,check_in_latitude,check_in_longitude,check_out_latitude,check_out_longitude,status,state,business')
      .in('employee_code', codes).eq('state', state)
      .in('business', ['Retail', 'Reliance Retail'])
      .gte('check_in_time', dayStart).lt('check_in_time', dayEnd)
      .order('check_in_time', { ascending: false }).limit(1500),
  ]);
  if (attendance.error || visits.error || (attendance.data || []).length >= 750 || (visits.data || []).length >= 1500) {
    throw failed(attendance.error || visits.error || new Error('FO report exceeds safe bound'));
  }
  const attendanceByFo = new Map();
  for (const a of attendance.data || []) if (!attendanceByFo.has(a.employee_code)) attendanceByFo.set(a.employee_code, a);
  const visitsByFo = new Map();
  for (const visit of visits.data || []) {
    const rows = visitsByFo.get(visit.employee_code) || [];
    rows.push(visit);
    visitsByFo.set(visit.employee_code, rows);
  }
  const officers = profiles.map(profile => {
    const a = attendanceByFo.get(profile.employee_code);
    const events = visitsByFo.get(profile.employee_code) || [];
    const last = events[0];
    const completed = Boolean(a?.logout_time) || a?.status === 'Completed';
    const status = !a ? 'Not started' : completed ? 'Ended day' : a.status === 'Active' ? 'Active today' : 'Attendance recorded';
    const latitude = numberOrNull(last?.check_out_time ? last.check_out_latitude : last?.check_in_latitude);
    const longitude = numberOrNull(last?.check_out_time ? last.check_out_longitude : last?.check_in_longitude);
    const initialLat = numberOrNull(completed ? a?.end_latitude : a?.start_latitude);
    const initialLon = numberOrNull(completed ? a?.end_longitude : a?.start_longitude);
    const hasVisitLocation = isCoordinate(latitude, longitude);
    const hasAttendanceLocation = isCoordinate(initialLat, initialLon);
    return {
      employee_code: profile.employee_code,
      name: profile.display_name || profile.full_name || profile.employee_code,
      state: profile.state,
      status,
      started_at: a?.login_time || null,
      ended_at: a?.logout_time || null,
      sites_visited: events.length,
      last_site: last?.site_name || null,
      last_check_in: last?.check_in_time || null,
      latitude: hasVisitLocation ? latitude : hasAttendanceLocation ? initialLat : null,
      longitude: hasVisitLocation ? longitude : hasAttendanceLocation ? initialLon : null,
      location_recorded_at: hasVisitLocation ? (last?.check_out_time || last?.check_in_time) : hasAttendanceLocation ? (completed ? a?.logout_time : a?.login_time) : null,
      visits: events.slice(0, 20).map(v => ({
        site: v.site_name || 'Site not identified',
        checked_in_at: v.check_in_time,
        checked_out_at: v.check_out_time,
        status: v.check_out_time ? 'Checked out' : 'Checked in',
      })),
    };
  });
  return { state, date: today, officers, location_note: 'Last recorded location only. No continuous live GPS or financial data is supplied.' };
}
