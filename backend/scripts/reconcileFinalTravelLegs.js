import dotenv from 'dotenv';
import { createClient } from '@supabase/supabase-js';
import {
  recalculateFoKm,
  recalculateFoKmBatch,
  reconcileFinalLegOnly,
  reconcileFinalLegOnlyBatch,
} from '../foKmRecalculationService.js';

dotenv.config({ path: 'backend/.env' });

// This command is intentionally dry-run by default. Production writes require --apply.
const args = new Set(process.argv.slice(2));
const valueFor = (name, fallback = null) => {
  const prefix = `--${name}=`;
  const argument = process.argv.slice(2).find((item) => item.startsWith(prefix));
  return argument ? argument.slice(prefix.length) : fallback;
};
const fromDate = valueFor('from', '2026-07-28');
const toDate = valueFor('to', '2026-07-30');
const attendanceIds = process.argv.slice(2)
  .filter((item) => item.startsWith('--attendance-id='))
  .map((item) => item.slice('--attendance-id='.length))
  .filter(Boolean);
const apply = args.has('--apply');
const finalLegOnly = args.has('--final-leg-only');
const summaryOnly = args.has('--summary-only');
const output = console.log.bind(console);
if (args.has('--quiet')) console.log = () => {};
const url = String(process.env.SUPABASE_URL || '').trim();
const key = String(process.env.SUPABASE_SERVICE_ROLE_KEY || '').trim();
if (!url || !key) throw new Error('SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required.');

const client = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
const results = [];

if (attendanceIds.length) {
  for (const attendanceId of attendanceIds) {
    const result = finalLegOnly
      ? await reconcileFinalLegOnly(client, {
          attendance_id: attendanceId,
          dry_run: !apply,
        }, { persist: apply })
      : await recalculateFoKm(client, {
      attendance_id: attendanceId,
      dry_run: !apply,
    }, { persist: apply });
    results.push(result);
  }
} else {
  let cursor = null;
  do {
    const page = finalLegOnly
      ? await reconcileFinalLegOnlyBatch(client, { fromDate, toDate, dryRun: !apply })
      : await recalculateFoKmBatch(client, {
        fromDate,
        toDate,
        dryRun: !apply,
        cursor,
        batchSize: 100,
      });
    results.push(...(page.results || []));
    if (finalLegOnly) break;
    cursor = page.nextCursor;
    if (!page.done && !cursor) break;
  } while (cursor);
}

const summary = results.reduce((accumulator, row) => {
  const finalLeg = row.travel_legs?.find((leg) => leg.type === 'last_checkout_to_end_day');
  const action = row.final_leg_action || (finalLeg?.status === 'calculated'
    ? finalLeg.persisted_travel_leg_id ? 'update' : 'insert'
    : 'manual_review_or_skip');
  const outcome = row.status === 'failed'
    ? 'failed'
    : action === 'already_correct'
      ? 'rows_already_correct'
      : action === 'update'
      ? 'rows_requiring_update'
      : action === 'insert'
        ? 'rows_requiring_insert'
        : 'manual_review_or_skip';
  accumulator[outcome] = (accumulator[outcome] || 0) + 1;
  return accumulator;
}, {});

output(JSON.stringify({
  dry_run: !apply,
  from_date: fromDate,
  to_date: toDate,
  attendance_ids: attendanceIds,
  rows: summaryOnly ? undefined : results.map((row) => ({
    attendance_id: row.attendance_id,
    employee_code: row.employee_code,
    status: row.status,
    old_total_route_km: row.old_total_route_km,
    new_total_route_km: row.new_total_route_km,
    final_return_leg_km: row.final_return_leg_km,
    final_leg_id: row.final_leg_id || row.travel_legs?.find((leg) => leg.type === 'last_checkout_to_end_day')?.persisted_travel_leg_id || null,
    final_leg_action: row.final_leg_action || (
      row.travel_legs?.find((leg) => leg.type === 'last_checkout_to_end_day')?.status === 'calculated'
        ? row.travel_legs.find((leg) => leg.type === 'last_checkout_to_end_day').persistence_action || (
          row.travel_legs.find((leg) => leg.type === 'last_checkout_to_end_day').persisted_travel_leg_id ? 'update' : 'insert'
        )
        : 'manual_review_or_skip'
    ),
    final_leg_status: row.final_leg_status || row.travel_legs?.find((leg) => leg.type === 'last_checkout_to_end_day')?.status || null,
    final_leg_gps_log_count: row.final_leg_gps_log_count || row.travel_legs?.find((leg) => leg.type === 'last_checkout_to_end_day')?.gps_log_count || 0,
    final_leg_valid_points: row.final_leg_valid_points || row.travel_legs?.find((leg) => leg.type === 'last_checkout_to_end_day')?.valid_points || 0,
    final_leg_review_flags: row.final_leg_review_flags || row.travel_legs?.find((leg) => leg.type === 'last_checkout_to_end_day')?.review_flags || [],
    provider: row.provider || row.final_return_leg_provider || null,
    reason: row.reason || row.final_return_leg_reason || null,
  })),
  summary,
}, null, 2));
