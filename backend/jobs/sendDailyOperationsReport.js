import dotenv from 'dotenv';
import { createClient } from '@supabase/supabase-js';
import { sendDailyOperationsReports } from '../services/dailyOperationsReportService.js';

dotenv.config({ path: './.env' });
dotenv.config({ path: './backend/.env' });

function requireEnv(name) {
  const value = process.env[name];
  if (!value || String(value).trim() === '') {
    throw new Error(`${name} is required.`);
  }
  return String(value).trim();
}

async function main() {
  const supabaseUrl = requireEnv('SUPABASE_URL');
  const serviceRoleKey = requireEnv('SUPABASE_SERVICE_ROLE_KEY');
  const client = createClient(supabaseUrl, serviceRoleKey, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
    },
  });

  console.log('[myQPMS Daily Report Job] started', {
    timezone: process.env.REPORT_EMAIL_TIMEZONE || 'Asia/Kolkata',
    mode: 'all',
  });

  const result = await sendDailyOperationsReports({
    client,
    date: process.env.REPORT_DATE || undefined,
    mode: 'all',
  });

  for (const item of result.results || []) {
    console.log('[myQPMS Daily Report Job] result', {
      type: item.type,
      state: item.state,
      ok: item.ok,
      skipped: item.skipped,
      message: item.message,
      recipients: item.recipients,
      filename: item.filename,
    });
  }

  console.log('[myQPMS Daily Report Job] complete', {
    ok: result.ok,
    date: result.date,
    sentOrSkipped: (result.results || []).filter((item) => item.ok).length,
  });
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error('[myQPMS Daily Report Job] failed', {
      message: error.message,
      code: error.code || null,
      stack: error.stack,
    });
    process.exit(1);
  });
