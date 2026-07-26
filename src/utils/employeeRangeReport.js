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
  const persistedTravelEvidence = (dataset?.travel_legs || []).map((leg) => ({
    "Date": leg.attendance_date,
    "Attendance ID": leg.attendance_id,
    "From": leg.started_at,
    "To": leg.ended_at,
    "Mode": leg.travel_mode,
    "Rate": leg.rate_per_km,
    "Calculated KM": leg.calculated_km,
    "Payable KM": leg.payable_km,
    "Amount": leg.payable_amount,
    "Source": leg.calculation_source,
    "Evidence Type": "Persisted travel leg",
  }));
  const legacyTravelEvidence = (dataset?.daily_summary || [])
    .filter((row) => !row.travel_leg_count)
    .map((row) => ({
      "Date": row.attendance_date,
      "Attendance ID": row.attendance_id,
      "From": row.login_time,
      "To": row.logout_time,
      "Mode": modesLabel(row.modes),
      "Rate": "",
      "Calculated KM": row.actual_travel_km,
      "Payable KM": row.payable_km,
      "Amount": row.petrol_amount,
      "Source": "Attendance and site-visit evidence",
      "Evidence Type": "Legacy reconstructed evidence - not a persisted leg audit",
    }));
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
      "Canonical Payable KM": summary.canonical_payable_km || 0,
      "Approved Missing KM": summary.approved_missing_km || 0,
      "Canonical Petrol Amount": summary.canonical_petrol_amount || 0,
      "Raw GPS KM": summary.raw_gps_km || 0,
      "Filtered GPS KM": summary.filtered_gps_km || 0,
      "Actual Travel KM": summary.actual_travel_km || 0,
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
      "Raw GPS KM": row.raw_gps_km,
      "Filtered GPS KM": row.filtered_gps_km,
      "Actual Travel KM": row.actual_travel_km,
      "Payable KM": row.payable_km,
      "Approved Missing KM": row.approved_missing_km,
      "Petrol Amount": row.petrol_amount,
      "Travel Leg Count": row.travel_leg_count,
    })),
    travelEvidence: [...persistedTravelEvidence, ...legacyTravelEvidence],
    siteVisits: (dataset?.site_visits || []).map((visit) => ({
      "Date": visit.attendance_date,
      "Attendance ID": visit.attendance_id,
      "Store Code": visit.store_code,
      "Site / Store": visit.store_name || visit.site_name,
      "Client": visit.client_name,
      "Check-In": visit.check_in_time,
      "Check-Out": visit.check_out_time,
      "Status": visit.status,
      "Route KM": visit.route_km,
      "Approved Missing KM":
        visit.metadata?.checkout_review_approved_km ||
        visit.metadata?.approved_missing_km ||
        visit.metadata?.approved_missing_checkout_km ||
        0,
      "Review Status": visit.metadata?.checkout_review_status || "",
      "Remarks": visit.metadata?.checkout_review_approval_remarks || visit.checkout_note || "",
    })),
    exceptions: [
      ...(dataset?.data_quality_warnings || []).map((warning) => ({
        "Date": warning.attendance_date || "",
        "Attendance ID": warning.attendance_id || "",
        "Type": warning.code,
        "Outcome": "warning",
        "Detail": warning.message,
      })),
      ...(dataset?.missing_checkout_adjustments || []).map((adjustment) => ({
        "Date": adjustment.attendance_date || "",
        "Attendance ID": adjustment.attendance_id || "",
        "Type": "APPROVED_MISSING_CHECKOUT_KM",
        "Outcome": adjustment.status,
        "Detail": `${adjustment.approved_km} KM${adjustment.remarks ? ` - ${adjustment.remarks}` : ""}`,
      })),
      ...(dataset?.recalculation_results || [])
        .filter((result) => result.outcome !== "updated")
        .map((result) => ({
          "Date": result.attendance_date || "",
          "Attendance ID": result.attendance_id || "",
          "Type": "RECALCULATION_RESULT",
          "Outcome": result.outcome,
          "Detail": result.reason || "",
        })),
    ],
  };
}
