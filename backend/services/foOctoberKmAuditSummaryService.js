// Read-only October 2026 anomaly inventory. A GPS/accounting gap is NOT a payable adjustment.
// Financial postings, rail-network matching and employee intent are deliberately outside this service.
const FROM = '2026-10-01';
const TO = '2026-10-31';
const IST_MS = 5.5 * 60 * 60 * 1000;
const finite = value => Number.isFinite(Number(value)) ? Number(value) : 0;
const round = value => Math.round(value * 100) / 100;
const mode = value => String(value || '').trim().toLowerCase();

function localDay(timestamp) {
  const time = Date.parse(timestamp);
  return Number.isFinite(time) ? new Date(time + IST_MS).toISOString().slice(0, 10) : null;
}
export function buildOctoberKmAudit(attendances = [], travelLegs = [], profiles = [], attendanceIdsWithVisits = new Set()) {
  const byEmployee = new Map(profiles.map(p => [p.employee_code, p]));
  const legsByDay = new Map();
  for (const leg of travelLegs) {
    if (leg.superseded_at) continue;
    const day = localDay(leg.started_at);
    if (!day || day < FROM || day > TO || !leg.attendance_id) continue;
    // Attendance ID is authoritative. Employee/day joins can mix independent sessions.
    const key = String(leg.attendance_id);
    const current = legsByDay.get(key) || { train: 0, bike: 0, recordedLegs: 0, bikePaidKm: 0, bikeAmount: 0 };
    current.recordedLegs += 1;
    if (mode(leg.travel_mode) === 'train') current.train += 1;
    if (mode(leg.travel_mode) === 'bike') {
      current.bike += 1;
      current.bikePaidKm += finite(leg.payable_km);
      current.bikeAmount += finite(leg.payable_amount);
    }
    legsByDay.set(key, current);
  }

  const summary = {
    attendance_records: 0,
    employees: 0,
    roles: {},
    calculated_petrol_rupees: 0,
    possible_missing_cases: 0,
    possible_missing_gps_gap_km: 0,
    possible_excess_cases: 0,
    possible_excess_gps_gap_km: 0,
    bike_train_days: 0,
    bike_train_payable_cases: 0,
    bike_train_payable_rupees_at_issue: 0,
    nonpayable_attendance_with_payable_cases: 0,
    insufficient_gps_cases: 0,
    verified_addition_rupees: null,
    verified_deduction_rupees: null,
  };
  const cases = [];
  const employees = new Set();
  const roleEmployees = new Map();
  for (const row of attendances) {
    const day = String(row.attendance_date || '');
    if (day < FROM || day > TO || !row.employee_code) continue;
    const gps = finite(row.filtered_gps_km);
    const approved = finite(row.total_approved_km);
    const petrol = finite(row.petrol_amount);
    const savedLegs = legsByDay.get(String(row.id || '')) || { train: 0, bike: 0, recordedLegs: 0, bikePaidKm: 0, bikeAmount: 0 };
    // Include ANY role with evidence of KM, actual travel, or a site visit.
    // A bare attendance row (regardless of role) is not an audit subject.
    const hasActivity = gps > 0 || approved > 0 || petrol > 0 ||
      savedLegs.recordedLegs > 0 || attendanceIdsWithVisits.has(row.id);
    if (!hasActivity) continue;
    summary.attendance_records += 1;
    employees.add(row.employee_code);
    const profile = byEmployee.get(row.employee_code) || {};
    const role = profile.role || 'Unmapped';
    if (!roleEmployees.has(role)) roleEmployees.set(role, new Set());
    roleEmployees.get(role).add(row.employee_code);
    summary.calculated_petrol_rupees += petrol;
    const motor = ['bike', 'car', 'own_vehicle'].includes(mode(row.travel_mode));
    const possibleMissing = motor && gps > approved + 10;
    const possibleExcess = approved > gps + 10 && petrol > 0;
    const noGps = gps === 0 && approved > 0;
    // Attendance mode may reflect the *last* selected mode; a mixed-mode day
    // cannot be deducted without linking credit to a specific ineligible leg.
    const nonpayableAttendanceCredit = ['train', 'bus', 'auto', 'other', 'others'].includes(mode(row.travel_mode)) && approved > 0;
    const mixed = savedLegs.train > 0 && savedLegs.bike > 0;
    const mixedPaid = mixed && savedLegs.bikePaidKm > 0;
    if (possibleMissing) { summary.possible_missing_cases += 1; summary.possible_missing_gps_gap_km += gps - approved; }
    if (possibleExcess) { summary.possible_excess_cases += 1; summary.possible_excess_gps_gap_km += approved - gps; }
    if (noGps) summary.insufficient_gps_cases += 1;
    if (nonpayableAttendanceCredit) summary.nonpayable_attendance_with_payable_cases += 1;
    if (mixed) summary.bike_train_days += 1;
    if (mixedPaid) { summary.bike_train_payable_cases += 1; summary.bike_train_payable_rupees_at_issue += savedLegs.bikeAmount; }
    const flags = [
      ...(mixedPaid ? ['BIKE_PAID_AND_TRAIN_RECORDED'] : mixed ? ['BIKE_TRAIN_MODE_SWITCH'] : []),
      ...(possibleMissing ? ['GPS_ABOVE_PAYABLE_REVIEW'] : []),
      ...(possibleExcess ? ['PAYABLE_ABOVE_GPS_REVIEW'] : []),
      ...(noGps ? ['NO_FILTERED_GPS_EVIDENCE'] : []),
      ...(nonpayableAttendanceCredit ? ['NONPAYABLE_FINAL_MODE_WITH_PAYABLE_REVIEW'] : []),
    ];
    if (!flags.length) continue;
    cases.push({
      employee_code: row.employee_code,
      employee_name: profile.full_name || row.display_name || row.employee_code,
      role,
      state: profile.state || null,
      business: profile.business || null,
      date: day,
      recorded_mode: mode(row.travel_mode),
      gps_km: round(gps),
      payable_km: round(approved),
      petrol_rupees: round(petrol),
      missing_gps_gap_km: possibleMissing ? round(gps - approved) : 0,
      excess_gps_gap_km: possibleExcess ? round(approved - gps) : 0,
      train_legs: savedLegs.train,
      bike_legs: savedLegs.bike,
      bike_leg_rupees_at_issue: round(savedLegs.bikeAmount),
      nonpayable_final_mode_with_payable: nonpayableAttendanceCredit,
      flags,
      disposition: 'EVIDENCE_REVIEW_REQUIRED',
    });
  }
  summary.employees = employees.size;
  summary.roles = Object.fromEntries([...roleEmployees.entries()].map(([role, codes]) => [role, codes.size]));
  for (const k of ['calculated_petrol_rupees', 'possible_missing_gps_gap_km', 'possible_excess_gps_gap_km', 'bike_train_payable_rupees_at_issue']) summary[k] = round(summary[k]);
  cases.sort((a,b) =>
    Number(b.flags.includes('BIKE_PAID_AND_TRAIN_RECORDED')) - Number(a.flags.includes('BIKE_PAID_AND_TRAIN_RECORDED'))
    || Math.max(b.missing_gps_gap_km, b.excess_gps_gap_km) - Math.max(a.missing_gps_gap_km, a.excess_gps_gap_km)
    || a.date.localeCompare(b.date));
  return {
    period: { from: FROM, to: TO, timezone: 'Asia/Kolkata' },
    summary,
    cases: cases.slice(0, 100),
    total_flagged_records: cases.length,
    truncated_cases: cases.length > 100,
    processing_status: 'READ_ONLY_REVIEW',
    explanation: 'GPS differences are candidate evidence, not approved deductions or credits. Bike plus Train on one day is a mode-switch flag, not proof of rail travel on the Bike leg. Track map-matching is not yet active.',
  };
}
async function loadVisitAttendanceIds(client, attendances) {
  // Query by authoritative attendance IDs, not check-in date, to include
  // site visits recorded late or with missing check-in timestamps.
  const ids = [...new Set(attendances.map(a => a.id).filter(Boolean))];
  const withVisits = new Set();
  for (let offset = 0; offset < ids.length; offset += 100) {
    const page = await loadPages(client, 'fo_site_visits', 'id,attendance_id',
      q => q.in('attendance_id', ids.slice(offset, offset + 100)).order('id'));
    for (const visit of page) if (visit.attendance_id) withVisits.add(visit.attendance_id);
  }
  return withVisits;
}
async function loadPages(client, table, fields, configure) {
  const PAGE = 500;
  const limit = 10000;
  const results = [];
  for (let offset = 0; offset < limit; offset += PAGE) {
    let query = client.from(table).select(fields);
    query = configure(query).range(offset, offset + PAGE - 1);
    const { data, error } = await query;
    if (error) throw error;
    results.push(...(data || []));
    if ((data || []).length < PAGE) return results;
  }
  throw Error('October audit exceeded the safe query limit; no partial report was returned.');
}
export async function loadOctoberKmAudit(client) {
  const [attendances, travelLegs] = await Promise.all([
    loadPages(client, 'fo_attendance', 'id,employee_code,display_name,attendance_date,travel_mode,filtered_gps_km,total_approved_km,petrol_amount',
      q => q.gte('attendance_date', FROM).lte('attendance_date', TO).order('attendance_date').order('id')),
    loadPages(client, 'fo_travel_legs', 'id,attendance_id,employee_code,started_at,travel_mode,payable_km,payable_amount,superseded_at',
      q => q.gte('started_at', '2026-09-30T18:30:00Z').lt('started_at', '2026-10-31T18:30:00Z').is('superseded_at', null).order('started_at').order('id')),
  ]);
  const attendanceIdsWithVisits = await loadVisitAttendanceIds(client, attendances);
  const employees = [...new Set(attendances.map(a => a.employee_code).filter(Boolean))];
  let profiles = [];
  if (employees.length) {
    const { data, error } = await client.from('profiles').select('employee_code,full_name,role,state,business').in('employee_code', employees);
    if (error) throw error;
    profiles = data || [];
  }
  return buildOctoberKmAudit(attendances, travelLegs, profiles, attendanceIdsWithVisits);
}
