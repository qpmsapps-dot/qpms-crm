import { assertRetailMis, retailMisState } from '../shared/retailMisAccess.js';
import { indiaToday } from '../shared/retailAttendance.js';
import {isRetailSouthHead} from '../shared/retailSouthHeadAccess.js';

// Purposefully return operational fields only. Never select or serialize
// route distance, GPS history, conveyance, rates, financial or KM columns.
function requireRows(result, source) {
  if (result.error) throw Object.assign(Error(source + ' unavailable.'), { statusCode: 503 });
  return result.data || [];
}
const key = value => String(value || '').trim().toUpperCase();
const distinctSites = visits => new Set(visits.map(v => key(v.site_name || v.site_code)).filter(Boolean)).size;

export async function retailHkMisOperations(client, access, input={}) {
  if (access?.role !== 'MIS_HK') {
    throw Object.assign(Error('HK MIS access required.'), { statusCode: 403 });
  }
  assertRetailMis(access, 'attendance-hk');
  const states = [...new Set((access.states || []).map(retailMisState).filter(Boolean))];
  if (!states.length) throw Object.assign(Error('No authorized state.'), { statusCode: 403 });
  if(input.state&&!states.includes(input.state))throw Object.assign(Error('Outside authorized HK MIS state.'),{statusCode:403});
  return readRetailOfficers(client,input.state?[input.state]:states);
}

export async function retailSouthHeadOperations(client,profile){
  if(!isRetailSouthHead(profile)||!Array.isArray(profile._retailRoleStates)||!profile._retailRoleStates.length)
    throw Object.assign(Error('Verified Reliance Retail South Head state grants required.'),{statusCode:403});
  const states=[...new Set(profile._retailRoleStates)];
  if(states.some(state=>!retailMisState(state)))throw Object.assign(Error('Invalid verified Retail state grants.'),{statusCode:403});
  return readRetailOfficers(client,states);
}

async function readRetailOfficers(client,states){
  // Employee business must be explicitly Reliance Retail, never generic
  // Standalone/Hospital/IFMS or an unverified client-name match.
  const profiles = requireRows(await client.from('profiles')
    .select('employee_code,full_name,display_name,state,business,role,is_active,status')
    .eq('role', 'FO').eq('business', 'Reliance Retail')
    .eq('is_active', true).in('state', states), 'Reliance Retail officers')
    .filter(p => key(p.role) === 'FO' && key(p.business) === 'RELIANCE RETAIL' && key(p.status) === 'ACTIVE' && states.includes(retailMisState(p.state)) && key(p.employee_code));

  const date = indiaToday();
  if (!profiles.length) return { date, states, officers: [], read_only: true };
  const codes = [...new Set(profiles.map(p => key(p.employee_code)))];
  const start = new Date(date + 'T00:00:00+05:30');
  const end = new Date(start.getTime() + 86400000);
  const [attendances, statuses, visits] = await Promise.all([
    client.from('fo_attendance')
      .select('employee_code,attendance_date,login_time,logout_time,status,updated_at')
      .in('employee_code', codes).eq('attendance_date', date)
      .order('updated_at', { ascending: false }),
    client.from('fo_live_status')
      .select('fo_user_id,latitude,longitude,last_seen_at,is_online,is_tracking,current_status')
      .in('fo_user_id', codes)
      .order('last_seen_at', { ascending: false }),
    client.from('fo_site_visits')
      .select('employee_code,state,business,site_name,site_code,check_in_time,check_out_time,status,check_in_latitude,check_in_longitude,check_out_latitude,check_out_longitude')
      .in('employee_code', codes).in('state', states)
      .in('business', ['Retail', 'Reliance Retail'])
      .gte('check_in_time', start.toISOString()).lt('check_in_time', end.toISOString())
      .order('check_in_time', { ascending: false }),
  ]);
  const attendanceRows = requireRows(attendances, 'FO attendance');
  const liveRows = requireRows(statuses, 'FO status');
  const visitRows = requireRows(visits, 'FO site visits');
  const attendanceByCode = new Map();
  const liveByCode = new Map();
  const visitByCode = new Map();
  for (const row of attendanceRows) {
    const code = key(row.employee_code);
    if (!attendanceByCode.has(code)) attendanceByCode.set(code, row);
  }
  for (const row of liveRows) {
    const code = key(row.fo_user_id);
    if (!liveByCode.has(code)) liveByCode.set(code, row);
  }
  for (const row of visitRows) {
    const code = key(row.employee_code);
    if (!visitByCode.has(code)) visitByCode.set(code, []);
    visitByCode.get(code).push(row);
  }

  const officers = profiles.map(profile => {
    const code = key(profile.employee_code);
    const a = attendanceByCode.get(code);
    const live = liveByCode.get(code);
    const ownVisits = (visitByCode.get(code) || []).filter(v =>
      retailMisState(v.state) === retailMisState(profile.state));
    const ended = Boolean(a?.logout_time) || /END|CLOS|STOP/i.test(a?.status || '');
    const started = Boolean(a?.login_time);
    const active_today = started && !ended;
    const lastSeen = live?.last_seen_at || null;
    const recentlySeen = lastSeen && Date.now() - new Date(lastSeen).getTime() < 10 * 60000;
    const online = Boolean(active_today && live?.is_online && recentlySeen);
    const latitude = live?.latitude == null ? null : Number(live.latitude);
    const longitude = live?.longitude == null ? null : Number(live.longitude);
    const validCoordinates = Number.isFinite(latitude) && Number.isFinite(longitude)
      && Math.abs(latitude) <= 90 && Math.abs(longitude) <= 180;
    return {
      employee_code: code,
      name: profile.full_name || profile.display_name || code,
      state: retailMisState(profile.state),
      active_today,
      online,
      day_status: ended ? 'Ended Day' : started ? 'Active Today' : 'Not Started',
      start_time: a?.login_time || null,
      end_time: a?.logout_time || null,
      last_seen_at: lastSeen,
      latitude: validCoordinates ? latitude : null,
      longitude: validCoordinates ? longitude : null,
      visited_count: distinctSites(ownVisits),
      visits: ownVisits.map(v => ({
        site_name: v.site_name || 'Site not recorded',
        site_code: v.site_code || null,
        check_in_time: v.check_in_time,
        check_out_time: v.check_out_time,
        status: v.check_out_time ? 'Checked Out' : 'Checked In',
      })),
    };
  }).sort((a,b) => a.state.localeCompare(b.state) || a.name.localeCompare(b.name));
  return { date, states, officers, read_only: true, location_type: 'last_known' };
}
