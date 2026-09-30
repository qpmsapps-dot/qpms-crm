import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';
import { createClient } from '@supabase/supabase-js';
import { recalculateFoKm } from '../foKmRecalculationService.js';

export const SEPTEMBER_CORRECTION_FROM = '2026-09-01';
export const SEPTEMBER_CORRECTION_TO = '2026-09-29';
export const SEPTEMBER_CORRECTION_REASON =
  'September 2026 mixed-mode per-leg reimbursement correction';

function round2(value) {
  return Number(Number(value || 0).toFixed(2));
}

export function correctionKey(row) {
  return `fo-mixed-mode-v1:${row.attendance_id}:${row.attendance_date}`;
}

export function eligibleCorrectionRows(report) {
  if (report?.project_ref !== 'ubawkjdbtickdlrgkulz') {
    throw new Error('Correction manifest project_ref does not match production.');
  }
  if (
    report?.date_range?.from !== SEPTEMBER_CORRECTION_FROM ||
    report?.date_range?.to !== SEPTEMBER_CORRECTION_TO
  ) {
    throw new Error('Correction manifest date range is not 2026-09-01 through 2026-09-29.');
  }
  return (report.rows || []).filter((row) => (
    ['HIGH', 'MEDIUM'].includes(row.correction_confidence) &&
    row.corrected_distance_reimbursement !== null &&
    Math.abs(Number(row.difference || 0)) >= 0.01
  ));
}

export function correctionImpact(rows) {
  return rows.reduce((summary, row) => {
    const before = round2(row.original_distance_reimbursement);
    const after = round2(row.corrected_distance_reimbursement);
    const difference = round2(after - before);
    summary.records += 1;
    summary.original = round2(summary.original + before);
    summary.corrected = round2(summary.corrected + after);
    summary.reduction = round2(summary.reduction + (difference < 0 ? -difference : 0));
    summary.increase = round2(summary.increase + (difference > 0 ? difference : 0));
    summary.net = round2(summary.net + difference);
    return summary;
  }, { records: 0, original: 0, corrected: 0, reduction: 0, increase: 0, net: 0 });
}

function publicAttendanceState(attendance) {
  return {
    id: attendance.id,
    employee_code: attendance.employee_code,
    attendance_date: attendance.attendance_date,
    actual_km: attendance.actual_km,
    actual_travel_km: attendance.actual_travel_km,
    total_route_km: attendance.total_route_km,
    eligible_km: attendance.eligible_km,
    total_approved_km: attendance.total_approved_km,
    petrol_amount: attendance.petrol_amount,
    travel_mode: attendance.travel_mode,
    rate_per_km: attendance.rate_per_km,
    route_sync_status: attendance.route_sync_status,
    updated_at: attendance.updated_at,
  };
}

async function loadAttendance(client, attendanceId) {
  const { data, error } = await client
    .from('fo_attendance')
    .select('id,employee_code,attendance_date,actual_km,actual_travel_km,total_route_km,eligible_km,total_approved_km,petrol_amount,travel_mode,rate_per_km,route_sync_status,updated_at')
    .eq('id', attendanceId)
    .maybeSingle();
  if (error) throw error;
  if (!data) throw new Error(`Attendance ${attendanceId} was not found.`);
  return data;
}

async function upsertPreviewAudit(client, row, beforeState, dryRunResult) {
  const key = correctionKey(row);
  const { data: existing, error: existingError } = await client
    .from('fo_travel_reimbursement_corrections')
    .select('id,status,applied_state')
    .eq('correction_key', key)
    .maybeSingle();
  if (existingError) throw existingError;
  if (existing) return existing;

  const payload = {
    correction_key: key,
    attendance_id: row.attendance_id,
    employee_code: row.employee_code,
    attendance_date: row.attendance_date,
    correction_confidence: row.correction_confidence,
    correction_reason: SEPTEMBER_CORRECTION_REASON,
    status: 'previewed',
    before_state: {
      attendance: beforeState,
      ticket_amount: row.ticket_amount,
      parking_amount: row.parking_amount,
      modes_used: row.modes_used,
      leg_breakdown: row.leg_breakdown,
    },
    proposed_state: {
      total_route_km: dryRunResult.total_route_km,
      total_approved_km: dryRunResult.total_approved_km,
      petrol_amount: dryRunResult.petrol_amount,
      ticket_amount: row.ticket_amount,
      parking_amount: row.parking_amount,
      total: round2(dryRunResult.petrol_amount + row.ticket_amount + row.parking_amount),
      review_flags: dryRunResult.review_flags,
    },
  };
  const { data, error } = await client
    .from('fo_travel_reimbursement_corrections')
    .insert(payload)
    .select('id,status,applied_state')
    .single();
  if (error) throw error;
  return data;
}

async function markAudit(client, auditId, patch) {
  const { error } = await client
    .from('fo_travel_reimbursement_corrections')
    .update(patch)
    .eq('id', auditId);
  if (error) throw error;
}

export async function applyCorrectionRows(client, rows, { apply = false } = {}) {
  const results = [];
  for (const row of rows) {
    let before;
    try {
      before = await loadAttendance(client, row.attendance_id);
    } catch (error) {
      error.message = `${row.attendance_id}: ${error.message}`;
      throw error;
    }
    if (before.attendance_date < SEPTEMBER_CORRECTION_FROM || before.attendance_date > SEPTEMBER_CORRECTION_TO) {
      throw new Error(`Attendance ${row.attendance_id} is outside the approved date range.`);
    }
    let dryRun;
    try {
      dryRun = await recalculateFoKm(
        client,
        { attendance_id: row.attendance_id, dry_run: true },
        { persist: false, refreshMissingKmReviews: false },
      );
    } catch (error) {
      if (!apply) {
        results.push({
          attendance_id: row.attendance_id,
          action: 'manual_review_required',
          code: error?.code || null,
          message: error?.message || String(error),
        });
        continue;
      }
      error.message = `${row.attendance_id}: ${error.message}`;
      throw error;
    }
    if (Math.abs(round2(dryRun.petrol_amount) - round2(row.corrected_distance_reimbursement)) > 0.01) {
      const message = `Preview drift: manifest ${row.corrected_distance_reimbursement}, live dry-run ${dryRun.petrol_amount}.`;
      if (!apply) {
        results.push({ attendance_id: row.attendance_id, action: 'manual_review_required', message });
        continue;
      }
      throw new Error(`${row.attendance_id}: ${message}`);
    }
    if (!apply) {
      results.push({ attendance_id: row.attendance_id, action: 'validated', dry_run: true });
      continue;
    }

    const audit = await upsertPreviewAudit(client, row, publicAttendanceState(before), dryRun);
    if (audit.status === 'applied') {
      results.push({ attendance_id: row.attendance_id, action: 'already_applied' });
      continue;
    }
    await markAudit(client, audit.id, { status: 'applying', error_detail: null });
    try {
      const applied = await recalculateFoKm(
        client,
        { attendance_id: row.attendance_id },
        { refreshMissingKmReviews: false },
      );
      const after = await loadAttendance(client, row.attendance_id);
      await markAudit(client, audit.id, {
        status: 'applied',
        applied_at: new Date().toISOString(),
        applied_state: {
          attendance: publicAttendanceState(after),
          result: {
            total_route_km: applied.total_route_km,
            total_approved_km: applied.total_approved_km,
            petrol_amount: applied.petrol_amount,
            review_flags: applied.review_flags,
          },
        },
      });
      results.push({ attendance_id: row.attendance_id, action: 'applied' });
    } catch (error) {
      await markAudit(client, audit.id, {
        status: 'failed',
        error_detail: { message: error?.message || String(error), code: error?.code || null },
      });
      throw error;
    }
  }
  return results;
}

async function main() {
  dotenv.config({ path: path.resolve('backend/.env') });
  const args = process.argv.slice(2);
  const apply = args.includes('--apply');
  const manifestArg = args.find((arg) => arg.startsWith('--manifest='));
  if (!manifestArg) throw new Error('Use --manifest=<september-impact-preview.json>.');
  const manifestPath = path.resolve(manifestArg.slice('--manifest='.length));
  const report = JSON.parse(await fs.readFile(manifestPath, 'utf8'));
  const rows = eligibleCorrectionRows(report);
  const client = createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY,
    { auth: { persistSession: false, autoRefreshToken: false } },
  );
  const results = await applyCorrectionRows(client, rows, { apply });
  console.log(JSON.stringify({ apply, impact: correctionImpact(rows), results }, null, 2));
}

const invokedPath = process.argv[1] ? path.resolve(process.argv[1]) : null;
if (invokedPath && invokedPath === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(error?.message || error);
    process.exitCode = 1;
  });
}
