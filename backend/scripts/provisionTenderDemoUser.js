import 'dotenv/config';
import { createClient } from '@supabase/supabase-js';
import {
  DEMO_ALLOWED_BUSINESSES,
  DEMO_ALLOWED_STATES,
} from '../services/demoAccessService.js';

const args = new Set(process.argv.slice(2));
const apply = args.has('--apply');
const dryRun = args.has('--dry-run') || !apply;

function env(name) {
  return String(process.env[name] || '').trim();
}

function projectRefFromUrl(url) {
  const match = String(url || '').match(/^https:\/\/([^.]+)\.supabase\.co/i);
  return match?.[1] || '';
}

function maskEmail(email) {
  const [name, domain] = String(email || '').split('@');
  if (!name || !domain) return '';
  return `${name.slice(0, 2)}***@${domain}`;
}

function requireConfig() {
  const url = env('SUPABASE_URL');
  const serviceKey = env('SUPABASE_SERVICE_ROLE_KEY');
  const expectedRef = env('TENDER_DEMO_CONFIRM_PROJECT_REF');
  const email = env('TENDER_DEMO_EMAIL').toLowerCase();
  const password = env('TENDER_DEMO_PASSWORD');
  const projectRef = projectRefFromUrl(url);

  if (!url || !serviceKey) throw new Error('SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required.');
  if (!expectedRef) throw new Error('TENDER_DEMO_CONFIRM_PROJECT_REF is required.');
  if (!projectRef || projectRef !== expectedRef) {
    throw new Error('Refusing provisioning: configured project reference does not match TENDER_DEMO_CONFIRM_PROJECT_REF.');
  }
  if (!email || !email.includes('@')) throw new Error('TENDER_DEMO_EMAIL is required.');
  if (apply && password.length < 12) throw new Error('TENDER_DEMO_PASSWORD must be at least 12 characters for --apply.');

  return { url, serviceKey, projectRef, email, password };
}

async function findAuthUserByEmail(client, email) {
  for (let page = 1; page <= 20; page += 1) {
    const { data, error } = await client.auth.admin.listUsers({ page, perPage: 100 });
    if (error) throw error;
    const user = (data?.users || []).find((entry) => String(entry.email || '').toLowerCase() === email);
    if (user) return user;
    if ((data?.users || []).length < 100) break;
  }
  return null;
}

function profilePayload(authUserId, email) {
  return {
    auth_user_id: authUserId,
    employee_code: 'TENDER-DEMO-001',
    username: email,
    email,
    full_name: 'Tender Demo User',
    display_name: 'Tender Demo User',
    role: 'TENDER_DEMO',
    status: 'active',
    is_active: true,
    web_access_enabled: true,
    mobile_access_enabled: false,
    business: 'Tender Demo',
    state: 'All',
    department: 'Tender Demonstration',
    designation: 'Read-Only Demo User',
    metadata: {
      is_demo: true,
      read_only: true,
      demo_label: 'Tender Demo',
      permitted_states: DEMO_ALLOWED_STATES,
      permitted_businesses: DEMO_ALLOWED_BUSINESSES,
      permitted_modules: [
        'field_operations',
        'deep_cleaning',
        'fault_tracker',
        'store_master',
        'client_ticketing',
        'reports',
      ],
      dataset_scope: 'sanitized_tender_demo',
    },
  };
}

async function main() {
  const config = requireConfig();
  const client = createClient(config.url, config.serviceKey, { auth: { persistSession: false } });
  const existingAuthUser = await findAuthUserByEmail(client, config.email);

  const summary = {
    mode: dryRun ? 'dry-run' : 'apply',
    projectRef: `${config.projectRef.slice(0, 4)}...${config.projectRef.slice(-4)}`,
    email: maskEmail(config.email),
    authUser: existingAuthUser ? 'reuse' : 'create',
    profile: 'upsert',
  };

  if (dryRun) {
    console.log(JSON.stringify(summary, null, 2));
    return;
  }

  let authUser = existingAuthUser;
  if (!authUser) {
    const { data, error } = await client.auth.admin.createUser({
      email: config.email,
      password: config.password,
      email_confirm: true,
      user_metadata: {
        role: 'TENDER_DEMO',
        is_demo: true,
        read_only: true,
      },
    });
    if (error) throw error;
    authUser = data.user;
  } else {
    const { error } = await client.auth.admin.updateUserById(authUser.id, {
      email_confirm: true,
      user_metadata: {
        ...(authUser.user_metadata || {}),
        role: 'TENDER_DEMO',
        is_demo: true,
        read_only: true,
      },
    });
    if (error) throw error;
  }

  const payload = profilePayload(authUser.id, config.email);
  const { data: existingProfiles, error: profileLookupError } = await client
    .from('profiles')
    .select('id')
    .or(`auth_user_id.eq.${authUser.id},email.eq.${config.email},username.eq.${config.email}`)
    .limit(1);
  if (profileLookupError) throw profileLookupError;

  if (existingProfiles?.[0]?.id) {
    const { error } = await client
      .from('profiles')
      .update(payload)
      .eq('id', existingProfiles[0].id);
    if (error) throw error;
  } else {
    const { error } = await client
      .from('profiles')
      .insert(payload);
    if (error) throw error;
  }

  console.log(JSON.stringify({
    ...summary,
    authUser: existingAuthUser ? 'reused' : 'created',
    profile: existingProfiles?.[0]?.id ? 'updated' : 'inserted',
  }, null, 2));
}

main().catch((error) => {
  console.error(error.message || 'Tender demo provisioning failed.');
  process.exit(1);
});
