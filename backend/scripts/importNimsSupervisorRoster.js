import 'dotenv/config';
import dotenv from 'dotenv';
import { createClient } from '@supabase/supabase-js';

import {
  nimsActiveBlockNames,
  nimsRosterCoverageMatrix,
  nimsSupervisorRoster,
  parseShiftWindow,
  rosterImportPlan,
} from '../services/hospitalTicketRoutingService.js';

dotenv.config({ path: '../.env', override: false });
dotenv.config({ path: '.env', override: true });

const args = new Set(process.argv.slice(2));
const apply = args.has('--apply');
const dryRun = args.has('--dry-run') || !apply;
const offline = args.has('--offline');
const expectedProjectRef = valueAfter('--project-ref');
const expectedClient = valueAfter('--client-name') || 'NIMS';

function valueAfter(flag) {
  const index = process.argv.indexOf(flag);
  return index >= 0 ? process.argv[index + 1] : '';
}

function supabaseConfig() {
  const url = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY;
  if (apply) {
    if (offline) throw new Error('--apply cannot be used with --offline.');
    if (!expectedProjectRef) throw new Error('--apply requires --project-ref.');
    if (!url || !url.includes(expectedProjectRef)) throw new Error('Configured Supabase URL does not match --project-ref.');
    if (!serviceKey) throw new Error('Service-role credentials are required for apply.');
  }
  return { url, serviceKey };
}

async function loadContext(client) {
  const clients = await client.from('hospital_clients').select('id,client_name').ilike('client_name', `%${expectedClient}%`).limit(1).maybeSingle();
  if (clients.error) throw clients.error;
  if (!clients.data) throw new Error(`Hospital client matching ${expectedClient} was not found.`);
  const clientId = clients.data.id;
  const blocks = await client.from('hospital_blocks').select('id,block_name').eq('client_id', clientId).in('block_name', nimsActiveBlockNames);
  if (blocks.error) throw blocks.error;
  const users = await client.from('hospital_ticket_users').select('id,display_name,role_code,is_active').eq('client_id', clientId).eq('role_code', 'housekeeping_supervisor');
  if (users.error) throw users.error;
  return {
    client: clients.data,
    blocksByName: new Map((blocks.data || []).map((row) => [row.block_name.toLowerCase(), row])),
    usersByName: new Map((users.data || []).map((row) => [row.display_name.toLowerCase(), row])),
  };
}

async function applyDraftRows(client, context, plan) {
  const inserted = { rosterRowsInserted: 0, rosterRowsReused: 0, assignmentsInserted: 0, assignmentsReused: 0, skipped: 0 };
  for (const source of nimsSupervisorRoster) {
    const existing = await client.from('hospital_supervisor_roster_import_rows')
      .select('id')
      .eq('client_id', context.client.id)
      .eq('source_name', source.name)
      .eq('source_shift', source.shift)
      .eq('source_responsibility', source.responsibility)
      .maybeSingle();
    if (existing.error) throw existing.error;
    if (existing.data) {
      inserted.rosterRowsReused += 1;
      continue;
    }
    const row = await client.from('hospital_supervisor_roster_import_rows').insert({
        client_id: context.client.id,
        source_name: source.name,
        source_role: 'Supervisor',
        source_shift: source.shift,
        source_responsibility: source.responsibility,
        matched_user_id: context.usersByName.get(source.name.toLowerCase())?.id || null,
        import_status: context.usersByName.has(source.name.toLowerCase()) ? 'matched' : 'unmatched',
        ambiguity_reason: (source.skippedBlocks || []).length ? `Skipped ambiguous/non-selectable: ${source.skippedBlocks.join('; ')}` : null,
        metadata: { phase: '2C', draft_only: true, skipped_blocks: source.skippedBlocks || [] },
        is_active: true,
      }).select('id').maybeSingle();
    if (row.error) throw row.error;
    inserted.rosterRowsInserted += row.data ? 1 : 0;
  }

  for (const row of plan.rows) {
    if (!row.userId || !row.blockId) {
      inserted.skipped += 1;
      continue;
    }
    const shift = parseShiftWindow(row.shift.label);
    const shiftResult = await client.from('hospital_shifts').select('id').or(`client_id.is.null,client_id.eq.${context.client.id}`).eq('shift_code', shift.shiftCode).limit(1).maybeSingle();
    if (shiftResult.error) throw shiftResult.error;
    if (!shiftResult.data) {
      inserted.skipped += 1;
      continue;
    }
    const existing = await client.from('hospital_supervisor_assignments')
      .select('id')
      .eq('client_id', context.client.id)
      .eq('user_id', row.userId)
      .eq('block_id', row.blockId)
      .eq('shift_id', shiftResult.data.id)
      .eq('assignment_type', row.assignmentType)
      .eq('source', 'phase_2c_roster')
      .maybeSingle();
    if (existing.error) throw existing.error;
    if (existing.data) {
      inserted.assignmentsReused += 1;
      continue;
    }
    const created = await client.from('hospital_supervisor_assignments').insert({
      client_id: context.client.id,
      user_id: row.userId,
      block_id: row.blockId,
      shift_id: shiftResult.data.id,
      assignment_type: row.assignmentType,
      routing_priority: row.assignmentType === 'primary' ? 100 : 200,
      verification_status: 'draft',
      source: 'phase_2c_roster',
      source_reference: row.sourceReference,
      is_active: false,
      metadata: { draft_only: true, source_name: row.sourceName },
    }).select('id').maybeSingle();
    if (created.error) throw created.error;
    inserted.assignmentsInserted += created.data ? 1 : 0;
  }
  return inserted;
}

async function main() {
  const { url, serviceKey } = supabaseConfig();
  let context = {
    client: { id: 'dry-run-client', client_name: expectedClient },
    blocksByName: new Map(nimsActiveBlockNames.map((name) => [name.toLowerCase(), { id: name.toLowerCase(), block_name: name }])),
    usersByName: new Map(),
  };
  let client = null;
  if (!offline && url && serviceKey) {
    client = createClient(url, serviceKey, { auth: { persistSession: false } });
    context = await loadContext(client);
  }
  const plan = rosterImportPlan({
    roster: nimsSupervisorRoster,
    knownUsersByName: context.usersByName,
    blocksByName: context.blocksByName,
  });
  const coverage = nimsRosterCoverageMatrix();
  const result = {
    mode: dryRun ? 'dry-run' : 'apply',
    client: context.client.client_name,
    sourceRows: nimsSupervisorRoster.length,
    plannedDraftAssignments: plan.rows.length,
    unmatchedUsers: plan.unmatchedUsers,
    ambiguousBlocks: plan.ambiguousBlocks,
    coverage,
  };
  if (apply) result.apply = await applyDraftRows(client, context, plan);
  console.log(JSON.stringify(result, null, 2));
}

main().catch((error) => {
  console.error(JSON.stringify({ ok: false, message: error.message }, null, 2));
  process.exitCode = 1;
});
