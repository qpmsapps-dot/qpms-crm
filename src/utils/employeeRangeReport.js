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

function modesLabel(modes = []) {
  return modes.length ? modes.join(", ") : "Not selected";
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
      "Completed Days": summary.completed_count || 0,
      "Incomplete / Stale Days": summary.incomplete_count || 0,
      "Total Visits": summary.visit_count || 0,
      "Kilometer": summary.kilometer || 0,
      "Approved Missing KM": summary.approved_missing_km || 0,
      "Distance Reimbursement": summary.distance_amount || 0,
      "Eligible Ticket / Parking Amount": summary.eligible_claim_amount || 0,
      "Total Amount": summary.total_amount || 0,
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
      "Amount": row.amount,
    })),
    siteVisits: (dataset?.site_visit_summary || []).map((row) => ({
      "Attendance Date": row.attendance_date,
      "Site / Client": [row.site_name, row.client_name].filter(Boolean).join(" / "),
      "Check-In": row.check_in_time,
      "Check-Out": row.check_out_time,
      "Duration Minutes": row.visit_duration_minutes,
      "Approved KM": row.approved_km,
      "Review Status / Remarks": [row.review_status, row.remarks].filter(Boolean).join(": "),
    })),
  };
}
