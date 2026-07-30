export function employeeRangeQuery({
  employeeIdentifier,
  fromDate,
  toDate,
}) {
  const query = new URLSearchParams();
  query.set("employee", employeeIdentifier || "");
  query.set("date_from", fromDate || "");
  query.set("date_to", toDate || "");
  return query.toString();
}

export function reportReadiness({ loading, dataset, error = "" }) {
  if (loading) return "loading";
  if (error || !dataset) return "unavailable";
  return "ready";
}

export function employeeRangeMetric(dataset, field) {
  if (!dataset?.period_summary) return null;
  const value = dataset.period_summary[field];
  if (value === null || value === undefined || value === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function modesLabel(modes = []) {
  return modes.length ? modes.join(", ") : "Not selected";
}

function durationLabel(minutes) {
  const value = Number(minutes);
  if (!Number.isFinite(value) || value < 0) return "--";
  if (value === 0) return "0 min";
  if (value < 60) return `${Math.floor(value)} min`;
  const hours = Math.floor(value / 60);
  const remainder = Math.floor(value % 60);
  return remainder ? `${hours} hr ${remainder} min` : `${hours} hr`;
}

export function buildEmployeeRangeExcelRows(dataset) {
  const employee = dataset?.employee || {};
  const period = dataset?.period || {};
  const summary = dataset?.period_summary || {};
  return {
    periodSummary: [{
      "Employee": employee.full_name || "",
      "Employee ID": employee.employee_code || "",
      "State": employee.state || "",
      "Designation": employee.designation || employee.role || "",
      "From Date": period.from_date || "",
      "To Date": period.to_date || "",
      "Attendance Days": summary.attendance_day_count ?? summary.attendance_count ?? 0,
      "Attendance Records": summary.attendance_count || 0,
      "Total Man Days": summary.total_man_days ?? summary.attendance_day_count ?? 0,
      "Total Visits": summary.total_visits ?? summary.visit_count ?? 0,
      "Kilometer": summary.kilometer ?? 0,
      "Distance Reimbursement": summary.distance_amount ?? 0,
      "Other Transport Amount": summary.other_transport_amount ?? 0,
      "Eligible Ticket / Parking Amount": summary.eligible_ticket_parking_amount ?? summary.eligible_claim_amount ?? 0,
      "Parking Amount": summary.parking_amount ?? 0,
      "Total Amount": summary.total_amount ?? 0,
      "Period Attendance Status": summary.period_attendance_status || "",
    }],
    dailyAttendance: (dataset?.daily_summary || []).map((row) => ({
      "Date": row.attendance_date,
      "Attendance ID": row.attendance_id,
      "Start": row.login_time,
      "End": row.logout_time,
      "Status": row.status,
      "Mode(s)": modesLabel(row.modes),
      "Visits": row.visit_count,
      "Kilometer": row.kilometer,
      "Distance Reimbursement": row.distance_amount,
      "Ticket / Other Transport Amount": row.other_transport_amount ?? row.ticket_amount ?? 0,
      "Parking Amount": row.parking_amount ?? 0,
      "Total Amount": row.total_amount ?? row.amount ?? 0,
    })),
    siteVisits: (dataset?.site_visit_summary || []).map((row) => ({
      "Attendance Date": row.attendance_date,
      "Site / Client": [row.site_name, row.client_name].filter(Boolean).join(" / "),
      "Check-In": row.check_in_time,
      "Check-Out": row.check_out_time,
      "Duration": durationLabel(row.visit_duration_minutes),
    })),
    travelClaims: (dataset?.expense_claims || []).map((claim) => ({
      "Attendance Date": claim.attendance_date,
      "Travel Mode": claim.travel_mode,
      "Claimed Amount": claim.claimed_amount ?? claim.fare_amount ?? 0,
      "Eligible / Approved Amount": claim.eligible_amount ?? claim.fare_amount ?? 0,
      "Parking Amount": claim.parking_amount ?? 0,
      "Approval Status": claim.approval_status || claim.status || "",
      "Ticket / Proof Reference": claim.proof_reference || "",
      "Remarks": claim.remarks || "",
    })),
  };
}
