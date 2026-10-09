import dotenv from 'dotenv';
import { createClient } from '@supabase/supabase-js';

import {
  persistFinalLegEvidenceReconciliation,
  prepareFinalLegEvidenceReconciliation,
} from '../services/foFinalLegEvidenceReconciliationService.js';

dotenv.config({ path: 'backend/.env' });

const args = process.argv.slice(2);
const valueFor = (name) => args.find((value) => value.startsWith(`--${name}=`))?.slice(name.length + 3) || null;
const apply = args.includes('--apply');
const attendanceId = valueFor('attendance-id');
const finalLegId = valueFor('final-leg-id');
if (!attendanceId || !finalLegId) {
  throw new Error('Required: --attendance-id=<uuid> --final-leg-id=<uuid>.');
}
if (apply && (
  valueFor('confirm-attendance-id') !== attendanceId ||
  valueFor('confirm-final-leg-id') !== finalLegId
)) {
  throw new Error('Apply requires exact --confirm-attendance-id and --confirm-final-leg-id values.');
}
if (apply && [
  'expected-employee-code',
  'expected-attendance-date',
  'expected-base-km',
  'expected-site-visit-count',
  'expected-site-visit-route-km',
  'expected-petrol-amount',
].some((name) => valueFor(name) === null)) {
  throw new Error('Apply requires explicit employee, date, base KM, site count, site-route sum and petrol amount expectations.');
}

const url = String(process.env.SUPABASE_URL || '').trim();
const key = String(process.env.SUPABASE_SERVICE_ROLE_KEY || '').trim();
if (!url || !key) throw new Error('SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required.');
const client = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });

const numeric = (name) => {
  const value = valueFor(name);
  if (value === null) return undefined;
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) throw new Error(`--${name} must be numeric.`);
  return parsed;
};

const plan = await prepareFinalLegEvidenceReconciliation(client, {
  attendance_id: attendanceId,
  final_leg_id: finalLegId,
  expected_employee_code: valueFor('expected-employee-code'),
  expected_attendance_date: valueFor('expected-attendance-date'),
  expected_base_km: numeric('expected-base-km'),
  expected_site_visit_count: numeric('expected-site-visit-count'),
  expected_site_visit_route_km: numeric('expected-site-visit-route-km'),
  expected_petrol_amount: numeric('expected-petrol-amount'),
}, {
  maxGoogleDirectionsCalls: 0,
});

let persistence = null;
if (apply) {
  persistence = await persistFinalLegEvidenceReconciliation(client, plan, {
    actorSource: valueFor('actor-source') || 'final_leg_evidence_cli',
  });
}

console.log(JSON.stringify({
  dry_run: !apply,
  plan,
  persistence,
}, null, 2));
