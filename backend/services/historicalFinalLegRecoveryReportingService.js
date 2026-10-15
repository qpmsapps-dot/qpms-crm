import {
  storedAttendancePayableKm,
  storedAttendancePetrolAmount,
} from './operationsSummaryService.js';

const READ_RPC = 'rpc_read_fo_hist_20261015';
const AUTHORIZED_ID_CHUNK_SIZE = 100;

function text(value) {
  return String(value ?? '').trim();
}

function round(value) {
  return Number((Number(value || 0) + Number.EPSILON).toFixed(2));
}

function financeEvidence(adjustment) {
  const evidence = adjustment?.evidence;
  return evidence && typeof evidence === 'object' && !Array.isArray(evidence)
    ? evidence.financial_projection
    : null;
}

function assertFinanceEvidence(adjustment, baselineAmount, deltaAmount) {
  const finance = financeEvidence(adjustment);
  if (finance?.version === 'FINANCE_BASELINE_V3_DERIVED_PRESERVED') {
    const approval = adjustment.recovery_authorization;
    if (!approval || !text(approval.id) || !text(approval.reviewer) || !text(approval.approved_at) ||
        approval.action !== 'APPLY' || approval.record_bound !== true ||
        approval.financial_projection_version !== finance.version ||
        approval.payload_sha256 !== '9757f1b6a35c19ec1d9c700f5d4cf06e1a1bd37e48049c414338474b376fbc2b' ||
        approval.manifest_sha256 !== '0fb181fca59aab6609980d2bb54c92fa6fab233f7dfb4365d364d2ad545058e0') {
      throw new Error('Historical V3 record is not bound to the immutable authenticated batch authorization.');
    }
    const before = round(adjustment.attendance_before?.petrol_amount);
    const after = round(adjustment.attendance_after?.petrol_amount);
    const required = ['raw_petrol_before', 'raw_petrol_after', 'existing_effective_reimbursement',
      'effective_reimbursement_after', 'final_leg_reimbursement_delta', 'baseline_materialization_amount'];
    if (required.some((key) => finance[key] === null || finance[key] === undefined || !Number.isFinite(Number(finance[key]))) ||
        round(finance.raw_petrol_before) !== before || round(finance.raw_petrol_after) !== after ||
        round(finance.existing_effective_reimbursement) !== baselineAmount ||
        round(finance.effective_reimbursement_after) !== round(baselineAmount + deltaAmount) ||
        round(finance.final_leg_reimbursement_delta) !== deltaAmount ||
        Number(finance.baseline_materialization_amount) !== 0 ||
        (before === 0 ? finance.storage_action !== 'PRESERVE_DERIVED_ZERO' || after !== 0
          : finance.storage_action !== 'ADD_FINAL_DELTA_TO_STORED' || after !== round(before + deltaAmount))) {
      throw new Error('Historical V3 financial evidence is invalid or attempts baseline materialization.');
    }
    return;
  }
  if (!finance || finance.finance_approved !== true) {
    throw new Error('Record-specific Finance authorization is required for historical recovery reporting.');
  }
  if (
    text(finance.finance_authorization_id).length < 8 ||
    text(finance.finance_reviewed_by).length < 3 ||
    !text(finance.finance_authorized_at)
  ) {
    throw new Error('Historical recovery Finance authorization evidence is incomplete.');
  }
  if (
    round(finance.baseline_amount) !== baselineAmount ||
    round(finance.final_leg_reimbursement_delta) !== deltaAmount ||
    round(finance.baseline_materialization_amount) !== 0
  ) {
    throw new Error('Historical recovery Finance baseline/delta is invalid or attempts baseline materialization.');
  }
}

export async function loadHistoricalFinalLegRecoveries(client, authorizedAttendanceIds = []) {
  const ids = [...new Set((authorizedAttendanceIds || []).map(text).filter(Boolean))];
  if (!ids.length) return [];

  const adjustments = [];
  for (let offset = 0; offset < ids.length; offset += AUTHORIZED_ID_CHUNK_SIZE) {
    const chunk = ids.slice(offset, offset + AUTHORIZED_ID_CHUNK_SIZE);
    const { data, error } = await client.rpc(READ_RPC, {
      p_authorized_attendance_ids: chunk,
    });
    if (error) throw error;
    adjustments.push(...(Array.isArray(data) ? data : []));
  }
  return adjustments;
}

export function overlayHistoricalFinalLegRecoveries(dataset, adjustments = []) {
  const output = structuredClone(dataset);
  const attendances = new Map((output.attendance_days || []).map((row) => [text(row.id), row]));
  const dailyByAttendance = new Map(
    (output.daily_summary || []).map((row) => [text(row.attendance_id), row]),
  );
  const seen = new Set();
  const summary = {
    records: 0,
    final_leg_km: 0,
    final_leg_amount: 0,
    included_in_canonical_totals: true,
    informational_only: true,
  };

  for (const adjustment of adjustments || []) {
    if (adjustment?.reversed === true) continue;
    const attendanceId = text(adjustment?.attendance_id);
    if (!attendanceId || seen.has(attendanceId)) {
      throw new Error('Duplicate or invalid historical final-leg ledger adjustment.');
    }
    seen.add(attendanceId);

    const attendance = attendances.get(attendanceId);
    const daily = dailyByAttendance.get(attendanceId);
    if (!attendance || !daily) {
      throw new Error('Historical recovery adjustment is outside the authorized report dataset.');
    }
    if (!text(adjustment.run_id)) {
      throw new Error('Applied historical recovery run evidence is required.');
    }

    const km = round(adjustment.delta_km);
    const amount = round(adjustment.delta_amount);
    const baselineAmount = round(storedAttendancePetrolAmount(adjustment.attendance_before));
    if (!(km > 0) || !(amount > 0)) {
      throw new Error('Historical recovery ledger contains a non-positive delta.');
    }
    assertFinanceEvidence(adjustment, baselineAmount, amount);

    const expectedPayableKm = round(
      storedAttendancePayableKm(adjustment.attendance_before) + km,
    );
    const expectedPetrolAmount = round(baselineAmount + amount);
    const rawPetrolBefore = round(adjustment.attendance_before?.petrol_amount);
    const rawPetrolAfter = round(adjustment.attendance_after?.petrol_amount);
    const derivedBaselineKeptSeparate = rawPetrolBefore === 0 &&
      (baselineAmount > 0 || financeEvidence(adjustment)?.storage_action === 'PRESERVE_DERIVED_ZERO');
    const expectedRawPetrolAfter = derivedBaselineKeptSeparate
      ? rawPetrolBefore
      : round(rawPetrolBefore + amount);
    if (
      round(storedAttendancePayableKm(attendance)) !== expectedPayableKm ||
      round(storedAttendancePetrolAmount(attendance)) !== expectedPetrolAmount ||
      round(storedAttendancePayableKm(adjustment.attendance_after)) !== expectedPayableKm ||
      round(storedAttendancePetrolAmount(adjustment.attendance_after)) !== expectedPetrolAmount ||
      rawPetrolAfter !== expectedRawPetrolAfter ||
      round(daily.payable_km) !== expectedPayableKm ||
      round(daily.petrol_amount) !== expectedPetrolAmount
    ) {
      throw new Error('Historical recovery ledger does not match persisted canonical report totals.');
    }

    const endRows = (output.site_visit_summary || []).filter(
      (row) => text(row.attendance_id) === attendanceId && row.row_type === 'end_day',
    );
    if (endRows.length > 1) {
      throw new Error('Historical recovery report has ambiguous End Day rows.');
    }
    let endRow = endRows[0];
    if (!endRow) {
      endRow = {
        attendance_id: attendanceId,
        attendance_date: attendance.attendance_date,
        row_type: 'end_day',
        site_name: 'End Day',
        check_out_time: attendance.logout_time,
      };
      output.site_visit_summary.push(endRow);
    }
    if (
      round(endRow.payable_km) > 0 &&
      text(endRow.historical_recovery_run_id) !== text(adjustment.run_id)
    ) {
      throw new Error('Existing End Day payable KM conflicts with the historical recovery ledger.');
    }

    Object.assign(endRow, {
      route_km: km,
      gps_calculated_km: km,
      payable_km: km,
      evidence_source: 'APPROVED_HISTORICAL_FINAL_LEG_LEDGER',
      historical_recovery_run_id: adjustment.run_id,
      historical_final_leg_amount: amount,
      derived_baseline_kept_separate: derivedBaselineKeptSeparate,
      included_in_canonical_totals: true,
      incremental_total_contribution: 0,
      remarks: 'Approved historical final-leg recovery; already included once in canonical daily totals.',
    });
    attendance.metadata = {
      ...(attendance.metadata || {}),
      final_return_leg_km: km,
      historical_recovery_run_id: adjustment.run_id,
      historical_final_leg_amount: amount,
      historical_final_leg_included_in_canonical_totals: true,
    };

    summary.records += 1;
    summary.final_leg_km = round(summary.final_leg_km + km);
    summary.final_leg_amount = round(summary.final_leg_amount + amount);
  }

  output.historical_recovery_summary = summary;
  return output;
}

export async function attachHistoricalFinalLegRecoveries(client, dataset) {
  const authorizedAttendanceIds = (dataset?.attendance_days || []).map((row) => row.id);
  const adjustments = await loadHistoricalFinalLegRecoveries(client, authorizedAttendanceIds);
  return overlayHistoricalFinalLegRecoveries(dataset, adjustments);
}
