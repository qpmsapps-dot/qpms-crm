import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const migrationUrl = new URL(
  '../../supabase/migrations_2_0/114_fo_monthly_travel_settlements.sql',
  import.meta.url,
);

test('Migration 114 creates an additive audited monthly settlement layer', async () => {
  const sql = await readFile(migrationUrl, 'utf8');
  assert.match(sql, /create table if not exists public\.fo_monthly_travel_settlements/i);
  assert.match(sql, /profile_id uuid not null references public\.profiles\(id\) on delete restrict/i);
  assert.match(sql, /unique \(profile_id, period_start, period_end\)/i);
  assert.match(sql, /unique \(employee_code, period_start, period_end\)/i);
  assert.match(sql, /approved_payable_amount numeric\(14,2\) not null/i);
  assert.match(sql, /adjustment_amount = round\(approved_payable_amount - calculated_claim_amount, 2\)/i);
  assert.match(sql, /enable row level security/i);
  assert.match(sql, /revoke all on table public\.fo_monthly_travel_settlements from public, anon, authenticated/i);
  assert.match(sql, /grant select, insert, update, delete on table public\.fo_monthly_travel_settlements to service_role/i);
});

test('Migration 114 seeds only the reviewed eleven Karnataka August settlements idempotently', async () => {
  const sql = await readFile(migrationUrl, 'utf8');
  for (const code of [
    'QPMSKA3846', 'QPMSKA0958', 'QPMSKA2487', 'QPMSKA0353', 'QPMSKAC16966',
    'QPMSKA0173', 'QPMSKA1542', '4176', 'QPMSKA4324', 'QPMSKA3715', 'QPMSKAC16986',
  ]) assert.match(sql, new RegExp(`'${code}'`));
  assert.match(sql, /on conflict \(profile_id, period_start, period_end\) do update/i);
  assert.match(sql, /approved_at = coalesce\(public\.fo_monthly_travel_settlements\.approved_at, excluded\.approved_at\)/i);
  assert.match(sql, /is distinct from/i);
  assert.match(sql, /date '2026-08-01'/i);
  assert.match(sql, /date '2026-08-31'/i);
  assert.match(sql, /43541\.22::numeric/i);
  assert.doesNotMatch(sql, /update\s+public\.fo_attendance/i);
  assert.doesNotMatch(sql, /update\s+public\.fo_travel_expense_claims/i);
  assert.doesNotMatch(sql, /delete\s+from/i);
  assert.doesNotMatch(sql, /truncate/i);
});
