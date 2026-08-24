import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';

dotenv.config({ path: './.env' });
dotenv.config({ path: './backend/.env' });

const accounts = [
  {
    key: 'operations',
    email: 'test.nims.operations.executive@qpms.invalid',
    name: 'TEST NIMS OPERATIONS EXECUTIVE',
    role: 'operations_executive',
    authUserId: '35b60c7a-a3f0-4e7c-89a3-d5eac5a644d8',
  },
  {
    key: 'facility',
    email: 'test.nims.facility.manager@qpms.invalid',
    name: 'TEST NIMS FACILITY MANAGER',
    role: 'facility_manager',
    authUserId: 'fa838e7b-e130-4bf6-93fa-752e16106338',
  },
  {
    key: 'projectHead',
    email: 'test.nims.project.head@qpms.invalid',
    name: 'TEST NIMS PROJECT HEAD',
    role: 'project_head',
    authUserId: '31dd3529-776e-4ba6-8fc5-b8594e8822bf',
  },
];

function parseArgs(argv) {
  return {
    apply: argv.includes('--apply'),
    verify: argv.includes('--verify'),
  };
}

function requireEnv(name) {
  const value = String(process.env[name] || '').trim();
  if (!value) throw new Error(`${name} is required.`);
  return value;
}

async function listAllUsers(client) {
  const users = [];
  for (let page = 1; page <= 100; page += 1) {
    const result = await client.auth.admin.listUsers({ page, perPage: 1000 });
    if (result.error) throw result.error;
    users.push(...(result.data?.users || []));
    if ((result.data?.users || []).length < 1000) break;
  }
  return users;
}

async function resolveClient(client) {
  const exactCode = String(process.env.NIMS_ESCALATION_TEST_CLIENT_CODE || 'NIMS_HYDERABAD').trim();
  const exact = await client
    .from('hospital_clients')
    .select('id,client_code,client_name,is_active,created_at')
    .eq('client_code', exactCode)
    .eq('is_active', true);
  if (exact.error) throw exact.error;
  if ((exact.data || []).length === 1) return exact.data[0];
  if ((exact.data || []).length > 1) {
    throw new Error(`Ambiguous active NIMS client_code ${exactCode}: ${exact.data.length} rows.`);
  }

  const fallback = await client
    .from('hospital_clients')
    .select('id,client_code,client_name,is_active,created_at')
    .eq('is_active', true)
    .or('client_code.ilike.%NIMS%,client_name.ilike.%NIMS%');
  if (fallback.error) throw fallback.error;
  if ((fallback.data || []).length !== 1) {
    throw new Error(`Expected exactly one active NIMS hospital client, found ${(fallback.data || []).length}. Set NIMS_ESCALATION_TEST_CLIENT_CODE to disambiguate.`);
  }
  return fallback.data[0];
}

async function findHospitalUser(client, clientId, account) {
  const result = await client
    .from('hospital_ticket_users')
    .select('id,auth_user_id,client_id,profile_type,role_code,display_name,email,employee_code,is_active,metadata,created_at')
    .eq('client_id', clientId)
    .eq('email', account.email)
    .maybeSingle();
  if (result.error) throw result.error;
  return result.data || null;
}

function isExpectedTestHospitalUser(user, account) {
  return Boolean(user)
    && user.email === account.email
    && user.display_name === account.name
    && user.role_code === account.role
    && user.auth_user_id === account.authUserId
    && user.profile_type === 'internal'
    && user.client_id
    && user.is_active === true
    && String(user.display_name || '').startsWith('TEST NIMS ')
    && String(user.email || '').startsWith('test.nims.')
    && String(user.email || '').endsWith('@qpms.invalid')
    && user.metadata?.test_user === true
    && user.metadata?.hospital_escalation_manual_test === true
    && user.metadata?.do_not_use_for_real_staff === true;
}

async function getAuthUser(client, account) {
  const result = await client.auth.admin.getUserById(account.authUserId);
  if (result.error) {
    return { authUser: null, authError: result.error };
  }
  return { authUser: result.data.user, authError: null };
}

function authUserIsUsable(authUser, account) {
  return Boolean(authUser)
    && authUser.id === account.authUserId
    && String(authUser.email || '').toLowerCase() === account.email
    && Boolean(authUser.email_confirmed_at)
    && authUser.disabled !== true;
}

async function verifyAccount(client, clientRow, account) {
  const user = await findHospitalUser(client, clientRow.id, account);
  const scopeResult = user
    ? await client
      .from('hospital_ticket_user_scopes')
      .select('id,scope_type,client_id,block_id,location_id,can_view,can_create,can_update')
      .eq('hospital_ticket_user_id', user.id)
      .eq('client_id', clientRow.id)
      .eq('scope_type', 'client')
      .is('block_id', null)
      .is('location_id', null)
      .maybeSingle()
    : { data: null, error: null };
  if (scopeResult.error) throw scopeResult.error;
  const pickerResult = await client.rpc('hospital_pick_ticket_owner', {
    p_client_id: clientRow.id,
    p_role: account.role,
  });
  if (pickerResult.error) throw pickerResult.error;
  const picker = pickerResult.data || {};
  const { authUser, authError } = await getAuthUser(client, account);
  const scopeUsable = scopeResult.data?.can_view === true
    && scopeResult.data?.can_update === true
    && scopeResult.data?.can_create === false;
  const clearlyTest = isExpectedTestHospitalUser(user, account);
  return {
    role_code: account.role,
    expected_name: account.name,
    expected_auth_user_id: account.authUserId,
    client_id: clientRow.id,
    client_code: clientRow.client_code,
    client_name: clientRow.client_name,
    user_found: Boolean(user),
    hospital_ticket_user_id: user?.id || null,
    auth_user_id: user?.auth_user_id || null,
    email: user?.email || null,
    profile_type: user?.profile_type || null,
    clearly_marked_test: clearlyTest,
    auth_user_exists: Boolean(authUser),
    auth_email: authUser?.email || null,
    auth_email_confirmed: Boolean(authUser?.email_confirmed_at),
    auth_disabled: authUser?.disabled === true,
    auth_usable_for_email_password: authUserIsUsable(authUser, account),
    auth_error: authError ? { message: authError.message, status: authError.status || null } : null,
    active: user?.is_active === true,
    valid_scope: scopeUsable,
    scope: scopeResult.data || null,
    picker_user_id: picker.id || null,
    picker_display_name: picker.display_name || null,
    picker_matches_test_user: Boolean(user?.id && picker.id === user.id),
    safe_to_prepare_password: Boolean(
      clearlyTest
      && authUserIsUsable(authUser, account)
      && user?.is_active === true
      && scopeUsable
      && user?.role_code === account.role
      && picker.id === user?.id,
    ),
  };
}

async function resetExistingAuthPassword(client, account, password) {
  const updated = await client.auth.admin.updateUserById(account.authUserId, {
    password,
  });
  if (updated.error) throw updated.error;
  return updated.data.user;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const url = requireEnv('SUPABASE_URL');
  const serviceKey = requireEnv('SUPABASE_SERVICE_ROLE_KEY');
  const confirmed = process.env.NIMS_ESCALATION_TEST_USERS_CONFIRM === 'true';
  const dryRun = !args.apply;

  if (args.apply && !confirmed) {
    throw new Error('Password reset requires NIMS_ESCALATION_TEST_USERS_CONFIRM=true.');
  }

  const configuredPassword = String(process.env.NIMS_ESCALATION_TEST_PASSWORD || '');
  if (args.apply && !configuredPassword) {
    throw new Error('Password reset requires NIMS_ESCALATION_TEST_PASSWORD.');
  }
  if (args.apply && configuredPassword.length < 8) {
    throw new Error('NIMS_ESCALATION_TEST_PASSWORD must be at least 8 characters.');
  }

  const client = createClient(url, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const allAuthUsers = await listAllUsers(client);
  const existingByEmail = new Map(allAuthUsers.map((user) => [String(user.email || '').toLowerCase(), user]));
  const clientRow = await resolveClient(client);

  if (dryRun || args.verify) {
    const verification = [];
    for (const account of accounts) {
      let rpcVerification = null;
      try {
        rpcVerification = await verifyAccount(client, clientRow, account);
      } catch (error) {
        rpcVerification = { error: error.message, code: error.code || null };
      }
      verification.push({
        email: account.email,
        name: account.name,
        role: account.role,
        expected_auth_user_id: account.authUserId,
        auth_status: existingByEmail.get(account.email)?.id === account.authUserId ? 'expected_auth_user_present' : 'missing_or_unexpected_auth_user',
        hospital_mapping: rpcVerification,
      });
    }
    console.log(JSON.stringify({
      mode: dryRun ? 'dry-run' : 'verify',
      client: clientRow,
      accounts: verification,
      next_step: dryRun ? 'If all rows are safe_to_prepare_password=true, run --apply with NIMS_ESCALATION_TEST_USERS_CONFIRM=true and NIMS_ESCALATION_TEST_PASSWORD set.' : undefined,
      secrets_logged: false,
    }, null, 2));
    if (dryRun) return;
  }

  const preflight = [];
  for (const account of accounts) {
    preflight.push({
      account,
      verified: await verifyAccount(client, clientRow, account),
    });
  }
  const unsafe = preflight.filter((row) => row.verified.safe_to_prepare_password !== true);
  if (unsafe.length) {
    console.log(JSON.stringify({
      mode: 'apply_preflight_failed',
      client: clientRow,
      accounts: preflight.map((row) => ({
        email: row.account.email,
        name: row.account.name,
        role: row.account.role,
        expected_auth_user_id: row.account.authUserId,
        verification: row.verified,
      })),
      final_result: 'REFUSED_UNSAFE_TEST_USER_STATE',
      secrets_logged: false,
    }, null, 2));
    process.exitCode = 1;
    return;
  }

  const results = [];
  for (const { account, verified } of preflight) {
    const authUser = await resetExistingAuthPassword(client, account, configuredPassword);
    results.push({
      email: account.email,
      password_source: 'NIMS_ESCALATION_TEST_PASSWORD',
      name: account.name,
      role: account.role,
      auth_user_id: authUser.id,
      auth_status: 'password_reset_on_existing_test_auth_user',
      hospital_ticket_user_id: verified.hospital_ticket_user_id,
      scope: verified.scope,
      picker_matches_test_user: true,
      picker_user_id: verified.picker_user_id,
      picker_display_name: verified.picker_display_name,
    });
  }

  console.log(JSON.stringify({
    mode: 'password-reset',
    client: clientRow,
    accounts: results,
    final_result: 'PASS',
    secrets_logged: false,
  }, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
