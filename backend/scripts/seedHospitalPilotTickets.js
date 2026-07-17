import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';

dotenv.config({ path: './.env' });
dotenv.config({ path: './backend/.env' });

if (String(process.env.HOSPITAL_ALLOW_PILOT_SEED || '').toLowerCase() !== 'true' || String(process.env.NODE_ENV || '').toLowerCase() === 'production') {
  throw new Error('Pilot sample tickets require non-production NODE_ENV and HOSPITAL_ALLOW_PILOT_SEED=true.');
}
const client = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
const users = await client.from('hospital_ticket_users').select('*').in('role_code', ['doctor', 'hospital_management']);
const blocks = await client.from('hospital_blocks').select('*');
const locations = await client.from('hospital_locations').select('*');
const categories = await client.from('hospital_ticket_categories').select('*');
for (const result of [users, blocks, locations, categories]) if (result.error) throw result.error;

const examples = [
  ['BLOCK_A', 'A_NURSE_WASHROOM', 'WASHROOM_CLEANING', 'Bathroom not cleaned near nurse station'],
  ['BLOCK_A', 'A_OPD_WAITING', 'DUSTBIN_OVERFLOW', 'Dustbin overflow in OPD waiting area'],
  ['BLOCK_A', 'A_STAFF_WASHROOM', 'CONSUMABLES_MISSING', 'Soap dispenser empty in staff washroom'],
  ['BLOCK_A', 'A_WARD_ENTRANCE', 'WET_FLOOR', 'Wet floor near patient ward entrance'],
  ['BLOCK_B', 'B_GENERAL_WASHROOM', 'BAD_ODOR', 'Bad smell in second-floor washroom'],
  ['BLOCK_B', 'B_ICU_WASHROOM', 'WASHROOM_CLEANING', 'ICU washroom cleaning delayed'],
  ['BLOCK_B', 'B_PATIENT_ROOM', 'PATIENT_ROOM_CLEANING', 'Patient room requires immediate cleaning'],
  ['BLOCK_B', 'B_CONSULT_CORRIDOR', 'CORRIDOR_CLEANING', 'Corridor floor requires mopping'],
];
for (const [blockCode, locationCode, categoryCode, description] of examples) {
  const block = blocks.data.find((row) => row.block_code === blockCode);
  const location = locations.data.find((row) => row.location_code === locationCode);
  const category = categories.data.find((row) => row.category_code === categoryCode);
  const actor = users.data.find((row) => row.client_id === block.client_id && (blockCode === 'BLOCK_A' ? row.role_code === 'doctor' : row.role_code === 'hospital_management'));
  const result = await client.rpc('rpc_create_hospital_ticket', {
    p_actor_user_id: actor.id, p_block_id: block.id, p_location_id: location.id,
    p_category_id: category.id, p_priority: category.default_priority,
    p_title: description, p_description: description,
    p_idempotency_key: `pilot-seed:${locationCode}:${categoryCode}`, p_supervisor_sla_minutes: 20,
  });
  if (result.error) throw result.error;
  console.log(`${result.data.ticket.ticket_no}: ${description}`);
}
