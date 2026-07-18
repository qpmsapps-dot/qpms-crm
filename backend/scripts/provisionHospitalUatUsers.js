import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';

dotenv.config({ path: './.env' });
dotenv.config({ path: './backend/.env' });

const url = String(process.env.SUPABASE_URL || '').trim();
const serviceKey = String(process.env.SUPABASE_SERVICE_ROLE_KEY || '').trim();
const password = String(process.env.HOSPITAL_UAT_TEMP_PASSWORD || '');
const apply = process.argv.includes('--apply');
const dryRun = !apply;
const production = String(process.env.NODE_ENV || '').trim().toLowerCase() === 'production';
const confirmed = process.env.HOSPITAL_UAT_PROVISION_CONFIRM === 'true';
const productionConfirmed = process.env.HOSPITAL_UAT_PRODUCTION_CONFIRM === 'I_UNDERSTAND_THIS_CREATES_PRODUCTION_AUTH_USERS';
const clientCode = String(process.env.HOSPITAL_UAT_CLIENT_CODE || 'QPMS_HOSPITAL_UAT').trim();

if (!url || !serviceKey) throw new Error('SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required.');
if (apply && password.length < 12) throw new Error('Set HOSPITAL_UAT_TEMP_PASSWORD to at least 12 characters.');
if (apply && !confirmed) throw new Error('Apply requires HOSPITAL_UAT_PROVISION_CONFIRM=true.');
if (apply && production && !productionConfirmed) {
  throw new Error('Refusing production provisioning without the separate production confirmation guard.');
}

const client = createClient(url, serviceKey, {
  auth: { persistSession: false, autoRefreshToken: false },
});
const accounts = [
  { email: 'doctor.blocka@qpmsdemo.com', name: 'Doctor - Block A', profile: 'client', role: 'doctor', scope: 'BLOCK_A' },
  { email: 'management.blockb@qpmsdemo.com', name: 'Hospital Management - Block B', profile: 'client', role: 'hospital_management', scope: 'BLOCK_B' },
  { email: 'sup.blocka@qpmsdemo.com', name: 'Housekeeping Supervisor - Block A', profile: 'internal', role: 'housekeeping_supervisor', scope: 'BLOCK_A' },
  { email: 'sup.blockb@qpmsdemo.com', name: 'Housekeeping Supervisor - Block B', profile: 'internal', role: 'housekeeping_supervisor', scope: 'BLOCK_B' },
  { email: 'ops.exec@qpmsdemo.com', name: 'Operations Executive', profile: 'internal', role: 'operations_executive', scope: 'CLIENT' },
  { email: 'facility.manager@qpmsdemo.com', name: 'Facility Manager', profile: 'internal', role: 'facility_manager', scope: 'CLIENT' },
];

const listed = await client.auth.admin.listUsers({ page: 1, perPage: 1000 });
if (listed.error) throw listed.error;
const existingByEmail = new Map(listed.data.users.map((user) => [user.email?.toLowerCase(), user]));

if (dryRun) {
  console.log(JSON.stringify({
    mode: 'dry-run',
    client_code: clientCode,
    accounts: accounts.map((account) => ({
      identifier: account.email,
      role: account.role,
      scope: account.scope,
      auth_status: existingByEmail.has(account.email) ? 'existing' : 'would_create',
    })),
  }, null, 2));
  process.exit(0);
}

let clientRow = await client.from('hospital_clients').select('id').eq('client_code', clientCode).maybeSingle();
if (clientRow.error) throw clientRow.error;
if (!clientRow.data) {
  clientRow = await client.from('hospital_clients').insert({
    client_code: clientCode,
    client_name: 'QPMS Hospital UAT - Non Production',
    timezone: 'Asia/Kolkata',
    is_active: true,
    metadata: { uat: true, non_production_test_tenant: true },
  }).select('id').single();
  if (clientRow.error) throw clientRow.error;
}

const blockByCode = {};
for (const blockCode of ['BLOCK_A', 'BLOCK_B']) {
  const blockName = blockCode === 'BLOCK_A' ? 'Block A' : 'Block B';
  const block = await client.from('hospital_blocks').upsert({
    client_id: clientRow.data.id,
    block_code: blockCode,
    block_name: blockName,
    is_active: true,
  }, { onConflict: 'client_id,block_code' }).select('id').single();
  if (block.error) throw block.error;
  blockByCode[blockCode] = block.data.id;
}

for (const location of [
  { block: 'BLOCK_A', code: 'A_3F_UAT_WARD', floor: '3rd Floor', department: 'Patient Ward', name: 'Block A UAT Ward' },
  { block: 'BLOCK_B', code: 'B_3F_UAT_WARD', floor: '3rd Floor', department: 'Patient Ward', name: 'Block B UAT Ward' },
]) {
  const result = await client.from('hospital_locations').upsert({
    client_id: clientRow.data.id,
    block_id: blockByCode[location.block],
    location_code: location.code,
    floor_name: location.floor,
    department_name: location.department,
    location_name: location.name,
    is_active: true,
  }, { onConflict: 'client_id,location_code' });
  if (result.error) throw result.error;
}
const categoryPayload = {
  client_id: clientRow.data.id,
  category_code: 'GENERAL_HOUSEKEEPING',
  category_name: 'General Housekeeping',
  default_priority: 'medium',
  supervisor_sla_minutes: 20,
  operations_sla_minutes: 30,
  is_active: true,
  sort_order: 1,
};
const existingCategory = await client.from('hospital_ticket_categories').select('id')
  .eq('client_id', clientRow.data.id).eq('category_code', categoryPayload.category_code).maybeSingle();
if (existingCategory.error) throw existingCategory.error;
const categoryResult = existingCategory.data
  ? await client.from('hospital_ticket_categories').update(categoryPayload).eq('id', existingCategory.data.id)
  : await client.from('hospital_ticket_categories').insert(categoryPayload);
if (categoryResult.error) throw categoryResult.error;

for (const account of accounts) {
  let authUser = existingByEmail.get(account.email);
  let authStatus = 'existing';
  if (!authUser) {
    const created = await client.auth.admin.createUser({
      email: account.email,
      password,
      email_confirm: true,
      user_metadata: { display_name: account.name, realm: 'hospital_ticketing', uat: true, force_password_change: true },
    });
    if (created.error) throw created.error;
    authUser = created.data.user;
    authStatus = 'created';
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
  const desiredScope = {
    hospital_ticket_user_id: mapped.data.id,
    client_id: clientRow.data.id,
    scope_type: account.scope === 'CLIENT' ? 'client' : 'block',
    block_id: account.scope === 'CLIENT' ? null : blockByCode[account.scope],
    can_view: true,
    can_create: account.profile === 'client',
    can_update: account.profile === 'internal',
  };
  let scopeQuery = client.from('hospital_ticket_user_scopes').select('id')
    .eq('hospital_ticket_user_id', mapped.data.id).eq('scope_type', desiredScope.scope_type);
  scopeQuery = desiredScope.block_id ? scopeQuery.eq('block_id', desiredScope.block_id) : scopeQuery.is('block_id', null);
  const existingScope = await scopeQuery.maybeSingle();
  if (existingScope.error) throw existingScope.error;
  const scopeResult = existingScope.data
    ? await client.from('hospital_ticket_user_scopes').update(desiredScope).eq('id', existingScope.data.id)
    : await client.from('hospital_ticket_user_scopes').insert(desiredScope);
  if (scopeResult.error) throw scopeResult.error;
  console.log(JSON.stringify({ identifier: account.email, role: account.role, scope: account.scope, auth_status: authStatus }));
}

console.log(JSON.stringify({ status: 'completed', client_code: clientCode, secrets_logged: false }));
