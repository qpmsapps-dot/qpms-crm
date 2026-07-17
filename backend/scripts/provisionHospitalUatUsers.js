import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';

dotenv.config({ path: './.env' });
dotenv.config({ path: './backend/.env' });

const url = String(process.env.SUPABASE_URL || '').trim();
const serviceKey = String(process.env.SUPABASE_SERVICE_ROLE_KEY || '').trim();
const password = String(process.env.HOSPITAL_UAT_TEMP_PASSWORD || '');
const production = String(process.env.NODE_ENV || '').toLowerCase() === 'production';
const confirmed = String(process.env.HOSPITAL_UAT_PROVISION_CONFIRM || '').toLowerCase() === 'true';

if (!url || !serviceKey) throw new Error('SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required.');
if (password.length < 8) throw new Error('Set HOSPITAL_UAT_TEMP_PASSWORD to a temporary password of at least 8 characters.');
if (production || !confirmed) throw new Error('UAT provisioning requires non-production NODE_ENV and HOSPITAL_UAT_PROVISION_CONFIRM=true.');

const client = createClient(url, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });
const accounts = [
  { email: 'doctor.blocka@qpmsdemo.com', name: 'Doctor - Block A', profile: 'client', role: 'doctor', scope: 'BLOCK_A' },
  { email: 'management.blockb@qpmsdemo.com', name: 'Hospital Management - Block B', profile: 'client', role: 'hospital_management', scope: 'BLOCK_B' },
  { email: 'sup.blocka@qpmsdemo.com', name: 'Housekeeping Supervisor - Block A', profile: 'internal', role: 'housekeeping_supervisor', scope: 'BLOCK_A' },
  { email: 'sup.blockb@qpmsdemo.com', name: 'Housekeeping Supervisor - Block B', profile: 'internal', role: 'housekeeping_supervisor', scope: 'BLOCK_B' },
  { email: 'ops.exec@qpmsdemo.com', name: 'Operations Executive', profile: 'internal', role: 'operations_executive', scope: 'CLIENT' },
  { email: 'facility.manager@qpmsdemo.com', name: 'Facility Manager', profile: 'internal', role: 'facility_manager', scope: 'CLIENT' },
];

const clientRow = await client.from('hospital_clients').select('id').eq('client_code', 'QPMS_HOSPITAL_PILOT').single();
if (clientRow.error) throw clientRow.error;
const blocks = await client.from('hospital_blocks').select('id,block_code').eq('client_id', clientRow.data.id);
if (blocks.error) throw blocks.error;
const blockByCode = Object.fromEntries((blocks.data || []).map((row) => [row.block_code, row.id]));

for (const account of accounts) {
  const listed = await client.auth.admin.listUsers({ page: 1, perPage: 1000 });
  if (listed.error) throw listed.error;
  let authUser = listed.data.users.find((user) => user.email?.toLowerCase() === account.email);
  if (!authUser) {
    const created = await client.auth.admin.createUser({
      email: account.email,
      password,
      email_confirm: true,
      user_metadata: { display_name: account.name, realm: 'hospital_ticketing', uat: true, force_password_change: true },
    });
    if (created.error) throw created.error;
    authUser = created.data.user;
  }
  const mapped = await client.from('hospital_ticket_users').upsert({
    auth_user_id: authUser.id,
    client_id: clientRow.data.id,
    profile_type: account.profile,
    role_code: account.role,
    display_name: account.name,
    email: account.email,
    is_active: true,
    metadata: { uat: true, force_password_change: true },
  }, { onConflict: 'auth_user_id' }).select('id').single();
  if (mapped.error) throw mapped.error;
  await client.from('hospital_ticket_user_scopes').delete().eq('hospital_ticket_user_id', mapped.data.id);
  const scope = {
    hospital_ticket_user_id: mapped.data.id,
    client_id: clientRow.data.id,
    scope_type: account.scope === 'CLIENT' ? 'client' : 'block',
    block_id: account.scope === 'CLIENT' ? null : blockByCode[account.scope],
    can_view: true,
    can_create: account.profile === 'client',
    can_update: account.profile === 'internal',
  };
  const scopeResult = await client.from('hospital_ticket_user_scopes').insert(scope);
  if (scopeResult.error) throw scopeResult.error;
  console.log(`Provisioned ${account.email} (${account.role}, ${account.scope})`);
}

console.log('Hospital Ticketing UAT provisioning completed. Rotate the temporary password before production use.');
