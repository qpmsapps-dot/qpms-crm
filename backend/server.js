import cors from 'cors';
import { randomUUID } from 'node:crypto';
import dotenv from 'dotenv';
import express from 'express';
import nodemailer from 'nodemailer';
import { createClient } from '@supabase/supabase-js';
import { recalculateFoKm, recalculateFoKmForToday } from './foKmRecalculationService.js';

dotenv.config({ path: './.env' });
dotenv.config({ path: './backend/.env' });

const app = express();
const port = Number(process.env.PORT || 4000);
const allowedOrigins = (process.env.FRONTEND_ORIGIN || 'http://localhost:5173')
  .split(',')
  .map((origin) => origin.trim())
  .filter(Boolean);

app.use(cors({
  origin(origin, callback) {
    if (!origin || allowedOrigins.includes(origin)) {
      return callback(null, true);
    }
    return callback(new Error(`CORS blocked for origin: ${origin}`));
  },
  credentials: true,
}));

app.use(express.json({ limit: '10mb' }));

const apiDemoUsers = [
  { id: 'md', name: 'Bharath', email: 'md@qpms.co.in', password: '123456', role: 'MD' },
  { id: 'bd-1', name: 'Ananya Rao', email: 'bd1@qpms.co.in', password: '123456', role: 'BD Executive' },
  { id: 'commercial-1', name: 'Commercial Team 1', email: 'commercial1@qpms.co.in', password: '123456', role: 'Commercial Reviewer' },
  { id: 'finance-1', name: 'Finance Team 1', email: 'finance1@qpms.co.in', password: '123456', role: 'Finance Reviewer' },
  { id: 'finance-gm', name: 'Finance GM', email: 'financegm@qpms.co.in', password: '123456', role: 'Finance GM' },
  { id: 'cfo', name: 'CFO', email: 'cfo@qpms.co.in', password: '123456', role: 'CFO' },
  { id: 'hr-1', name: 'HR Reviewer 1', email: 'hr1@qpms.co.in', password: '123456', role: 'HR Reviewer' },
  { id: 'coo', name: 'COO', email: 'coo@qpms.co.in', password: '123456', role: 'COO' },
  { id: 'gm', name: 'General Manager', email: 'gm@qpms.co.in', password: '123456', role: 'GM / Top Management' },
  { id: 'existing-operations', name: 'Existing Business Operations', email: 'existingoperations@qpms.co.in', password: '123456', role: 'Existing Business Operations Team' },
  { id: 'admin', name: 'Admin', email: 'admin@qpms.co.in', password: '123456', role: 'Admin' },
];

const apiSessions = new Map();
const foKmRecalculationLocks = new Set();
const foKmRecalculateAllLocks = new Set();
const FO_KM_RECALCULATION_RUNNING_MESSAGE = 'Recalculation already running. Please wait.';

function currentIndiaDateInput() {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Kolkata',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date());
}

function normalizeFoKmRecalculationDate(value) {
  if (!value) return currentIndiaDateInput();
  return String(value).slice(0, 10);
}

function normalizeFoKmRecalculationId(value) {
  return String(value || '').trim().toLowerCase();
}

function foKmRecalculationLockKey(payload = {}) {
  const foId = normalizeFoKmRecalculationId(
    payload.fo_user_id ||
      payload.employee_code ||
      payload.username ||
      payload.attendance_id ||
      payload.id ||
      'unknown',
  );
  return `${foId}|${normalizeFoKmRecalculationDate(payload.date)}`;
}

function hasFoKmRecalculationForDate(date) {
  const suffix = `|${date}`;
  for (const key of foKmRecalculationLocks) {
    if (key.endsWith(suffix)) return true;
  }
  return false;
}

function normalizeSupabaseUrl(url) {
  return String(url || '').replace(/\/rest\/v1\/?$/, '').replace(/\/$/, '');
}

const supabaseUrl = normalizeSupabaseUrl(process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL);
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY || process.env.VITE_SUPABASE_ANON_KEY;
const supabaseServiceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const supabase = supabaseUrl && supabaseKey ? createClient(supabaseUrl, supabaseKey, {
  realtime: {
    enabled: false,
  },
  auth: {
    persistSession: false,
    autoRefreshToken: false,
  },
}) : null;
const serviceRoleSupabase = supabaseUrl && supabaseServiceRoleKey ? createClient(supabaseUrl, supabaseServiceRoleKey, {
  realtime: {
    enabled: false,
  },
  auth: {
    persistSession: false,
    autoRefreshToken: false,
  },
}) : null;
const supabaseConfigStatus = {
  configured: Boolean(supabase),
  urlPresent: Boolean(supabaseUrl),
  keyPresent: Boolean(supabaseKey),
  serviceRolePresent: Boolean(process.env.SUPABASE_SERVICE_ROLE_KEY),
};

const approvalRoleMap = {
  Commercial: 'Commercial Reviewer',
  Finance: 'Finance Reviewer',
  HR: 'HR Reviewer',
  Management: 'Admin',
};

const reviewerRoleToDepartment = {
  'Commercial Reviewer': 'Commercial',
  'Finance Reviewer': 'Finance',
  'HR Reviewer': 'HR',
  Admin: 'Management',
};

function normalizeDecision(value) {
  const decision = String(value || '').trim().toLowerCase();
  if (['approve', 'approved'].includes(decision)) return 'Approved';
  if (['reject', 'rejected'].includes(decision)) return 'Rejected';
  if (['rework', 'request rework', 'rework requested'].includes(decision)) return 'Rework Requested';
  return '';
}

function createApiId(prefix) {
  return `${prefix}-${randomUUID()}`;
}

function createToken(user) {
  const token = `qpms-demo-${user.id}-${randomUUID()}`;
  apiSessions.set(token, user);
  return token;
}

function getBearerToken(request) {
  return String(request.headers.authorization || '').replace(/^Bearer\s+/i, '').trim();
}

function requireApiAuth(request, response, next) {
  const token = getBearerToken(request);
  const user = apiSessions.get(token);
  if (!user) {
    response.status(401).json({ ok: false, message: 'Valid Bearer token required. Login with /api/auth/login first.' });
    return;
  }
  request.apiUser = user;
  next();
}

function requireRoles(roles) {
  return (request, response, next) => {
    if (!roles.includes(request.apiUser?.role)) {
      response.status(403).json({ ok: false, message: `Role ${request.apiUser?.role || 'Unknown'} cannot perform this action.` });
      return;
    }
    next();
  };
}

function requireSupabase() {
  if (!supabase) {
    const error = new Error('Supabase backend configuration is missing on the API server. Set SUPABASE_URL and SUPABASE_ANON_KEY on Render, or set SUPABASE_SERVICE_ROLE_KEY for backend-only workflow writes.');
    error.statusCode = 503;
    throw error;
  }
  return supabase;
}

function requireServiceRoleSupabase() {
  if (!serviceRoleSupabase) {
    const error = new Error('SUPABASE_SERVICE_ROLE_KEY is required for backend-only admin FO actions.');
    error.statusCode = 503;
    throw error;
  }
  return serviceRoleSupabase;
}

function stageToDepartment(stage) {
  if (stage === 'Commercial Review') return 'Commercial';
  if (stage === 'Finance Review') return 'Finance';
  if (stage === 'HR Validation' || stage === 'HR Review') return 'HR';
  if (stage === 'COO Approval' || stage === 'Management Approval') return 'Management';
  return stage;
}

function departmentToStage(department) {
  if (department === 'Commercial') return 'Commercial Review';
  if (department === 'Finance') return 'Finance Review';
  if (department === 'HR') return 'HR Validation';
  if (department === 'Management') return 'COO Approval';
  return department;
}

function stageToPendingWith(stage) {
  if (stage === 'Commercial Review') return 'Commercial Reviewer';
  if (stage === 'Finance Review') return 'Finance Reviewer';
  if (stage === 'HR Validation') return 'HR Reviewer';
  if (stage === 'COO Approval') return 'COO';
  return 'Workflow Reviewer';
}

function reviewerRoleForStage(stage) {
  return approvalRoleMap[stageToDepartment(stage)] || 'Admin';
}

function isMissingTable(error) {
  return ['42P01', 'PGRST205'].includes(error?.code) || String(error?.message || '').toLowerCase().includes('could not find the table');
}

function isMissingColumn(error) {
  return ['42703', 'PGRST204'].includes(error?.code) || String(error?.message || '').toLowerCase().includes('could not find');
}

async function optionalSupabaseWrite(label, operation) {
  try {
    return await operation();
  } catch (error) {
    if (!isMissingTable(error) && !isMissingColumn(error)) {
      console.warn(`[myQPMS Postman API] ${label} failed`, error);
    }
    return null;
  }
}

async function logActivity({ leadId = null, siteVisitId = null, assessmentId = null, type, message, createdBy, metadata = {} }) {
  const client = requireSupabase();
  const { error } = await client.from('activity_logs').insert({
    lead_id: leadId,
    site_visit_id: siteVisitId,
    assessment_id: assessmentId,
    activity_type: type,
    activity_message: message,
    created_by: createdBy || 'postman_automation',
    metadata: { created_by: 'postman_automation', ...metadata },
  });
  if (error && !isMissingTable(error)) {
    console.warn('[myQPMS Postman API] activity log insert failed', error);
  }
}

async function getApprovalsForSiteVisit(siteVisitId) {
  const client = requireSupabase();
  const { data, error } = await client
    .from('approval_requests')
    .select('*')
    .eq('site_visit_id', siteVisitId)
    .order('created_at', { ascending: true });
  if (error) throw error;
  return data || [];
}

function calculateWorkflowStatusFromApprovals(approvals = []) {
  const rejected = approvals.find((approval) => approval.status === 'Rejected');
  if (rejected) {
    return {
      approvalStatus: 'Rejected',
      currentStage: `${rejected.approval_stage} Rejected`,
      pendingWith: 'BD Executive',
      reworkStatus: 'Closed',
    };
  }

  const rework = approvals.find((approval) => approval.status === 'Rework Requested');
  if (rework) {
    return {
      approvalStatus: 'Rework Requested',
      currentStage: `${rework.approval_stage} Rework`,
      pendingWith: 'BD Executive',
      reworkStatus: 'Open',
    };
  }

  const pending = approvals.filter((approval) => approval.status === 'Pending');
  if (pending.length) {
    return {
      approvalStatus: 'Pending',
      currentStage: 'Approval Matrix Review',
      pendingWith: pending.map((approval) => approval.pending_with || stageToPendingWith(approval.approval_stage)).join(', '),
      reworkStatus: 'None',
    };
  }

  return {
    approvalStatus: approvals.length ? 'Approved' : 'Not Submitted',
    currentStage: approvals.length ? 'Returned to BD' : 'Site Visit Started',
    pendingWith: approvals.length ? 'BD Executive' : 'BD Executive',
    reworkStatus: 'None',
  };
}

function mapApprovalResponse(approval) {
  return {
    ...approval,
    id: approval.id,
    approvalId: approval.id,
    leadId: approval.lead_id,
    siteVisitId: approval.site_visit_id,
    assessmentId: approval.assessment_id,
    department: stageToDepartment(approval.approval_stage),
    stage: approval.approval_stage,
    assignedRole: reviewerRoleForStage(approval.approval_stage),
    assignedTo: approval.pending_with,
    approvedBy: approval.approved_by,
    approvedAt: approval.approved_at,
    createdAt: approval.created_at,
    updatedAt: approval.updated_at,
  };
}

async function syncSiteVisitWorkflow(siteVisitId) {
  const client = requireSupabase();
  const approvals = await getApprovalsForSiteVisit(siteVisitId);
  const workflow = calculateWorkflowStatusFromApprovals(approvals);
  const status = workflow.approvalStatus === 'Approved' ? 'Ready for Proposal' : workflow.approvalStatus;
  const { data, error } = await client
    .from('site_visits')
    .update({
      current_stage: workflow.currentStage,
      pending_with: workflow.pendingWith,
      status,
      updated_at: new Date().toISOString(),
      metadata: { created_by: 'postman_automation', workflow_status: workflow },
    })
    .eq('id', siteVisitId)
    .select('*')
    .single();
  if (error) throw error;
  await syncOptionalWorkflowTables({
    leadId: data.lead_id,
    siteVisitId,
    assessmentId: approvals[0]?.assessment_id || null,
    approvals,
    workflow,
    actor: { email: 'postman_automation' },
  });
  return { siteVisit: data, workflow, approvals };
}

async function syncOptionalWorkflowTables({ leadId, siteVisitId, assessmentId, approvals = [], workflow, actor }) {
  const client = requireSupabase();
  const pendingApprovals = approvals.filter((approval) => approval.status === 'Pending');
  const decidedApprovals = approvals.filter((approval) => approval.status !== 'Pending');

  await optionalSupabaseWrite('workflow_status sync', async () => {
    const { error } = await client.from('workflow_status').upsert(
      {
        site_visit_id: siteVisitId,
        lead_id: leadId,
        assessment_id: assessmentId,
        current_stage: workflow.currentStage,
        pending_with: workflow.pendingWith,
        approval_status: workflow.approvalStatus,
        rework_status: workflow.reworkStatus,
        metadata: {
          created_by: 'postman_automation',
          pending_count: pendingApprovals.length,
          decided_count: decidedApprovals.length,
        },
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'site_visit_id' },
    );
    if (error) throw error;
  });

  await optionalSupabaseWrite('approval_queue sync', async () => {
    await client.from('approval_queue').delete().eq('site_visit_id', siteVisitId);
    if (!pendingApprovals.length) return;
    const rows = pendingApprovals.map((approval) => ({
      approval_request_id: approval.id,
      lead_id: approval.lead_id || leadId,
      site_visit_id: siteVisitId,
      assessment_id: approval.assessment_id || assessmentId,
      approval_stage: approval.approval_stage,
      pending_with: approval.pending_with,
      status: approval.status,
      priority: approval.metadata?.priority || 'Medium',
      metadata: { created_by: 'postman_automation', actor: actor?.email || 'postman_automation' },
    }));
    const { error } = await client.from('approval_queue').insert(rows);
    if (error) throw error;
  });
}

async function maybeCreateWorkflowInstance({ leadId, siteVisitId, assessmentId, stageCode, pendingRole, actor }) {
  const client = requireSupabase();
  try {
    const { data: existing, error: existingError } = await client
      .from('workflow_instances')
      .select('*')
      .eq('site_visit_id', siteVisitId)
      .maybeSingle();
    if (existingError) throw existingError;

    if (existing) {
      await client
        .from('workflow_instances')
        .update({
          assessment_id: assessmentId,
          current_stage_code: stageCode,
          status: 'Pending Review',
          pending_role: pendingRole,
          approval_status: 'Pending',
          metadata: { ...(existing.metadata || {}), created_by: 'postman_automation' },
          updated_at: new Date().toISOString(),
        })
        .eq('id', existing.id);
      return existing.id;
    }

    const { data, error } = await client
      .from('workflow_instances')
      .insert({
        lead_id: leadId,
        site_visit_id: siteVisitId,
        assessment_id: assessmentId,
        current_stage_code: stageCode,
        status: 'Pending Review',
        pending_role: pendingRole,
        approval_status: 'Pending',
        metadata: { created_by: 'postman_automation' },
      })
      .select('*')
      .single();
    if (error) throw error;
    return data.id;
  } catch (error) {
    if (!isMissingTable(error)) {
      console.warn('[myQPMS Postman API] workflow instance sync failed', error);
    }
    await logActivity({
      leadId,
      siteVisitId,
      assessmentId,
      type: 'Workflow Transition',
      message: `Workflow moved to ${stageCode}`,
      createdBy: actor?.email || 'postman_automation',
      metadata: { warning: error.message, stage_code: stageCode, pending_role: pendingRole },
    });
    return null;
  }
}

function createTransporter() {
  if (!process.env.EMAIL_USER || !process.env.EMAIL_PASS) {
    throw new Error('EMAIL_USER and EMAIL_PASS are required');
  }

  return nodemailer.createTransport({
    service: 'gmail',
    auth: {
      user: process.env.EMAIL_USER,
      pass: process.env.EMAIL_PASS,
    },
    connectionTimeout: 30000,
  });
}

async function verifyMailTransporter() {
  try {
    const transporter = createTransporter();
    await transporter.verify();
    console.log('[myQPMS Mail API] SMTP transporter verified', {
      host: 'smtp.gmail.com',
      port: 587,
      family: 4,
      emailUserConfigured: Boolean(process.env.EMAIL_USER),
    });
  } catch (error) {
    console.error('[myQPMS Mail API] SMTP transporter verification failed', {
      message: error.message,
      code: error.code,
      command: error.command,
    });
  }
}

function normalizeRecipients(value) {
  if (!value) return [];
  if (Array.isArray(value)) return value.filter(Boolean);
  return String(value)
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
}

function escapeHtml(value) {
  return String(value || '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

function normalizeServiceScope(value) {
  if (Array.isArray(value)) return value.filter(Boolean);
  if (value && typeof value === 'object') {
    return Object.entries(value)
      .filter(([, item]) => item === true || item?.selected)
      .map(([key]) => key);
  }
  return String(value || '')
    .split(/,|\n/)
    .map((item) => item.trim().replace(/^-+\s*/, ''))
    .filter(Boolean);
}

function hasSiteVisitSchedule(payload) {
  return Boolean(
    (payload.scheduledVisitDate || payload.scheduled_site_visit_date) &&
      (payload.scheduledVisitTime || payload.scheduled_site_visit_time),
  );
}

function hasFollowUp(payload) {
  return Boolean(payload.nextFollowUpDate || payload.next_followup_date);
}

function formatIcsDate(date, time) {
  const source = new Date(`${date}T${time}`);
  if (Number.isNaN(source.getTime())) return '';
  return source.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z');
}

function escapeIcsText(value) {
  return String(value || '')
    .replaceAll('\\', '\\\\')
    .replaceAll(';', '\\;')
    .replaceAll(',', '\\,')
    .replace(/\r?\n/g, '\\n');
}

function foldIcsLine(line) {
  const chunks = [];
  let remaining = line;
  while (remaining.length > 74) {
    chunks.push(remaining.slice(0, 74));
    remaining = ` ${remaining.slice(74)}`;
  }
  chunks.push(remaining);
  return chunks.join('\r\n');
}

function buildLeadSiteVisitInvite(payload) {
  const date = payload.scheduledVisitDate || payload.scheduled_site_visit_date;
  const time = payload.scheduledVisitTime || payload.scheduled_site_visit_time;
  const start = formatIcsDate(date, time);
  if (!start) return null;

  const endDate = new Date(`${date}T${time}`);
  endDate.setHours(endDate.getHours() + 1);
  const end = endDate.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z');
  const clientName = payload.clientName || payload.client_name || payload.company || 'Client';
  const attendees = [
    ...(payload.primaryContactEmail ? [payload.primaryContactEmail] : []),
    ...normalizeRecipients(payload.to || payload.toEmail || payload.to_email),
    payload.assignedBdEmail || payload.assigned_bd_email,
    ...normalizeRecipients(payload.cc || payload.ccEmails || payload.cc_emails),
  ].filter(Boolean);
  const uniqueAttendees = [...new Set(attendees.map((email) => email.trim()).filter((email) => email.includes('@')))];
  const uid = `qpms-site-visit-${Date.now()}@qpms-crm`;
  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//myQPMS//Operations Workflow//EN',
    'CALSCALE:GREGORIAN',
    'METHOD:REQUEST',
    'BEGIN:VEVENT',
    `UID:${uid}`,
    `DTSTAMP:${new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z')}`,
    `DTSTART:${start}`,
    `DTEND:${end}`,
    `SUMMARY:${escapeIcsText(`myQPMS Site Visit - ${clientName}`)}`,
    'DESCRIPTION:Site visit scheduled from myQPMS.',
    `LOCATION:${escapeIcsText(payload.location || payload.siteLocation || payload.site_location || 'Lead site location')}`,
    `ORGANIZER;CN=myQPMS:MAILTO:${process.env.EMAIL_USER}`,
    ...uniqueAttendees.map((email) => `ATTENDEE;ROLE=REQ-PARTICIPANT;PARTSTAT=NEEDS-ACTION;RSVP=TRUE:MAILTO:${email}`),
    'END:VEVENT',
    'END:VCALENDAR',
  ];

  return lines.map(foldIcsLine).join('\r\n');
}

async function sendMomEmail(payload, type) {
  const transporter = createTransporter();
  const to = normalizeRecipients(payload.to || payload.toEmail || payload.to_email);
  const cc = normalizeRecipients(payload.cc || payload.ccEmails || payload.cc_emails);

  if (!to.length) {
    const error = new Error('At least one recipient is required');
    error.statusCode = 400;
    throw error;
  }

  if (type === 'lead' && !hasSiteVisitSchedule(payload) && !hasFollowUp(payload)) {
    const error = new Error('Please provide either Site Visit Schedule Date & Time or Next Follow-up Date before sending the Minutes of Meeting.');
    error.statusCode = 400;
    throw error;
  }

  const subject = payload.subject || (type === 'lead' ? `Lead Minutes of Meeting - ${payload.clientName || payload.client_name || payload.company || 'Client'} - myQPMS` : 'myQPMS Site Visit MOM');
  const html = payload.html || buildDefaultHtml(payload, type);
  const calendarInvite = type === 'lead' && hasSiteVisitSchedule(payload) ? buildLeadSiteVisitInvite(payload) : null;
  const attachments = [
    ...(payload.attachments || []),
    ...(calendarInvite
      ? [
          {
            filename: 'qpms-site-visit.ics',
            content: calendarInvite,
            contentType: 'text/calendar; method=REQUEST; charset=UTF-8',
          },
        ]
      : []),
  ];

  let info;
  try {
    info = await transporter.sendMail({
      from: `"myQPMS" <${process.env.EMAIL_USER}>`,
      to,
      cc,
      subject,
      html,
      attachments,
    });
  } catch (error) {
    console.error('[myQPMS Mail API] sendMail failed', {
      type,
      to,
      cc,
      subject,
      message: error.message,
      code: error.code,
      command: error.command,
    });
    return {
      ok: true,
      simulated: true,
      message: 'MOM email simulated successfully. SMTP failed but demo flow continued.',
      smtpError: error.message,
      calendarInviteSent: false,
    };
  }

  return { messageId: info.messageId, accepted: info.accepted, rejected: info.rejected, calendarInviteSent: Boolean(calendarInvite) };
}

function buildDefaultHtml(payload, type) {
  const title = type === 'lead' ? 'Lead Minutes of Meeting' : 'Site Visit Minutes of Meeting';
  if (type === 'lead') return buildLeadMomHtml(payload, title);
  const rows = [
    ['Client', payload.clientName || payload.client_name || payload.company || 'myQPMS Client'],
    ['Discussion Summary', payload.discussionSummary || payload.discussion_summary || payload.summary || ''],
    ['Service Scope', payload.serviceScopeDiscussion || payload.service_scope_discussion || payload.scope || ''],
    ['Action Items', payload.actionItems || payload.action_items || payload.nextAction || ''],
    ['Remarks', payload.remarks || payload.siteVisitRemarks || payload.site_visit_remarks || ''],
  ];

  return `
    <div style="font-family:Inter,Arial,sans-serif;color:#172033;line-height:1.55">
      <h2 style="color:#2444a4;margin:0 0 16px">${title}</h2>
      <table style="border-collapse:collapse;width:100%;max-width:760px">
        ${rows
          .map(
            ([label, value]) => `
              <tr>
                <td style="border:1px solid #e2e8f0;background:#f8fafc;padding:10px 12px;font-weight:700;width:190px">${label}</td>
                <td style="border:1px solid #e2e8f0;padding:10px 12px;white-space:pre-line">${value || '-'}</td>
              </tr>
            `,
          )
          .join('')}
      </table>
      <p style="margin-top:18px;color:#64748b">Sent from myQPMS workflow system.</p>
    </div>
  `;
}

function buildLeadMomHtml(payload, title) {
  const serviceScope = normalizeServiceScope(payload.serviceScope || payload.service_scope || payload.serviceScopeDiscussion || payload.service_scope_discussion);
  const scheduleRows = hasSiteVisitSchedule(payload)
    ? [
        ['Scheduled Site Visit Date', payload.scheduledVisitDate || payload.scheduled_site_visit_date],
        ['Scheduled Site Visit Time', payload.scheduledVisitTime || payload.scheduled_site_visit_time],
      ]
    : [['Next Follow-up Date', payload.nextFollowUpDate || payload.next_followup_date]];
  const rows = [
    ['Client', payload.clientName || payload.client_name || payload.company || 'myQPMS Client'],
    ['Primary Contact', payload.primaryContact || payload.primary_contact || payload.contact || payload.to || ''],
    ['Discussion Summary', payload.discussionSummary || payload.discussion_summary || payload.summary || ''],
    ['Service Scope', serviceScope.length ? `<ul style="margin:0;padding-left:18px">${serviceScope.map((item) => `<li>${escapeHtml(item)}</li>`).join('')}</ul>` : '-'],
    ['Remarks', payload.remarks || payload.siteVisitRemarks || payload.site_visit_remarks || ''],
    ...scheduleRows,
  ];

  return `
    <div style="font-family:Inter,Arial,sans-serif;color:#172033;line-height:1.55">
      <h2 style="color:#2444a4;margin:0 0 16px">${escapeHtml(title)}</h2>
      <table style="border-collapse:collapse;width:100%;max-width:760px">
        ${rows
          .map(
            ([label, value]) => `
              <tr>
                <td style="border:1px solid #e2e8f0;background:#f8fafc;padding:10px 12px;font-weight:700;width:190px">${escapeHtml(label)}</td>
                <td style="border:1px solid #e2e8f0;padding:10px 12px;white-space:pre-line">${label === 'Service Scope' ? value : escapeHtml(value || '-')}</td>
              </tr>
            `,
          )
          .join('')}
      </table>
      <p style="margin-top:18px;color:#64748b">Sent from myQPMS workflow system.</p>
    </div>
  `;
}

function routeSendMom(type) {
  return async (request, response) => {
    try {
      if (type === 'lead') {
        console.log('[myQPMS Mail API] /send-lead-mom hit', {
          to: request.body?.to || request.body?.toEmail || request.body?.to_email || '',
          subject: request.body?.subject || '',
        });
      }

      const result = await sendMomEmail(request.body, type);
      response.json({ ok: true, ...result });
    } catch (error) {
      if (!error.statusCode) {
        console.error('[myQPMS Mail API] MOM email simulated after delivery failure', {
          type,
          message: error.message,
          code: error.code,
          command: error.command,
        });
        response.json({
          ok: true,
          simulated: true,
          message: 'MOM email simulated successfully. SMTP failed but demo flow continued.',
          smtpError: error.message,
        });
        return;
      }
      response.status(error.statusCode || 500).json({ ok: false, message: error.message || 'Email failed' });
    }
  };
}

app.get('/', (request, response) => {
  response.json({ success: true, message: 'myQPMS Mail API running' });
});

app.get('/health', (request, response) => {
  response.json({
    ok: true,
    service: 'qpms-mail-api',
    supabase: supabaseConfigStatus,
  });
});

app.post('/api/test/reset', async (request, response) => {
  try {
    const client = requireSupabase();
    apiSessions.clear();

    const { data: testLeads, error: leadFetchError } = await client
      .from('leads')
      .select('id')
      .eq('created_by_name', 'postman_automation');
    if (leadFetchError) throw leadFetchError;

    const leadIds = (testLeads || []).map((lead) => lead.id);
    if (leadIds.length) {
      const { data: visits } = await client.from('site_visits').select('id').in('lead_id', leadIds);
      const siteVisitIds = (visits || []).map((visit) => visit.id);
      if (siteVisitIds.length) {
        await optionalSupabaseWrite('approval queue cleanup', async () => {
          const { error } = await client.from('approval_queue').delete().in('site_visit_id', siteVisitIds);
          if (error) throw error;
        });
        await optionalSupabaseWrite('workflow status cleanup', async () => {
          const { error } = await client.from('workflow_status').delete().in('site_visit_id', siteVisitIds);
          if (error) throw error;
        });
        await optionalSupabaseWrite('workflow events cleanup', async () => {
          const { error } = await client.from('workflow_events').delete().in('site_visit_id', siteVisitIds);
          if (error) throw error;
        });
        await optionalSupabaseWrite('workflow instances cleanup', async () => {
          const { error } = await client.from('workflow_instances').delete().in('site_visit_id', siteVisitIds);
          if (error) throw error;
        });
        await client.from('activity_logs').delete().in('site_visit_id', siteVisitIds);
        await client.from('approval_requests').delete().in('site_visit_id', siteVisitIds);
        await client.from('site_assessments').delete().in('site_visit_id', siteVisitIds);
        await client.from('site_mom').delete().in('site_visit_id', siteVisitIds);
        await client.from('site_visits').delete().in('id', siteVisitIds);
      }
      await client.from('activity_logs').delete().in('lead_id', leadIds);
      await client.from('lead_mom').delete().in('lead_id', leadIds);
      await client.from('lead_contacts').delete().in('lead_id', leadIds);
      await client.from('leads').delete().in('id', leadIds);
    }

    response.json({ ok: true, message: 'Postman automation records cleaned from Supabase.', deletedLeadCount: leadIds.length });
  } catch (error) {
    response.status(error.statusCode || 500).json({ ok: false, message: error.message });
  }
});

app.post('/api/auth/login', (request, response) => {
  const email = String(request.body?.email || '').trim().toLowerCase();
  const password = String(request.body?.password || '');
  const user = apiDemoUsers.find((item) => item.email === email && item.password === password);
  if (!user) {
    response.status(401).json({ ok: false, message: 'Invalid demo credentials.' });
    return;
  }

  const token = createToken(user);
  response.json({
    ok: true,
    token,
    user: {
      id: user.id,
      name: user.name,
      email: user.email,
      role: user.role,
    },
  });
});

app.get('/api/leads', requireApiAuth, async (request, response) => {
  try {
    const client = requireSupabase();
    const { data: leads, error } = await client
      .from('leads')
      .select('*')
      .order('created_at', { ascending: false });
    if (error) throw error;

    const leadIds = (leads || []).map((lead) => lead.id);
    let contactsByLeadId = {};
    if (leadIds.length) {
      const contactsResponse = await client.from('lead_contacts').select('*').in('lead_id', leadIds);
      if (contactsResponse.error) throw contactsResponse.error;
      contactsByLeadId = (contactsResponse.data || []).reduce((grouped, contact) => {
        grouped[contact.lead_id] = [...(grouped[contact.lead_id] || []), contact];
        return grouped;
      }, {});
    }

    response.json({
      ok: true,
      source: 'supabase.public.leads',
      count: leads?.length || 0,
      latestLeadId: leads?.[0]?.id || null,
      latestClientName: leads?.[0]?.client_name || leads?.[0]?.company_name || null,
      leads: (leads || []).map((lead) => ({
        ...lead,
        lead_contacts: contactsByLeadId[lead.id] || [],
      })),
    });
  } catch (error) {
    response.status(error.statusCode || 500).json({ ok: false, message: error.message });
  }
});

app.post('/api/leads', requireApiAuth, requireRoles(['BD Executive', 'BD Head', 'Admin']), async (request, response) => {
  try {
    const client = requireSupabase();
    const leadPayload = {
      client_name: request.body?.company || request.body?.clientName || 'Postman Demo Client',
      company_name: request.body?.company || request.body?.clientName || 'Postman Demo Client',
      industry_type: request.body?.industryType || 'Facility Management',
      lead_source: request.body?.leadSource || 'Postman Automation',
      site_location: request.body?.location || request.body?.siteLocation || '',
      state: request.body?.state || 'Tamil Nadu',
      city: request.body?.city || 'Chennai',
      lead_priority: request.body?.leadPriority || 'High',
      service_scope: request.body?.serviceScope || ['Soft Services Housekeeping', 'Security Services'],
      remarks: request.body?.remarks || 'Created from Postman approval matrix automation.',
      assigned_bd_executive: request.apiUser.name,
      assigned_bd_email: request.apiUser.email,
      created_by_user_id: request.apiUser.id,
      created_by_name: 'postman_automation',
      lead_stage: 'New Lead',
      status: 'Active',
      metadata: {
        created_by: 'postman_automation',
        created_by_user: request.apiUser.email,
        scenario: request.body?.scenario || 'approval_matrix',
      },
    };

    const { data: lead, error } = await client.from('leads').insert(leadPayload).select('*').single();
    if (error) throw error;

    const contactPayload = {
      lead_id: lead.id,
      contact_person_name: request.body?.primaryContact || 'Demo Contact',
      contact_person_designation: request.body?.primaryContactDesignation || 'Client Contact',
      contact_number: request.body?.primaryContactPhone || '+91 90000 00000',
      email_id: request.body?.primaryContactEmail || 'demo.client@example.com',
      is_primary: true,
      metadata: { created_by: 'postman_automation' },
    };
    const { error: contactError } = await client.from('lead_contacts').insert(contactPayload);
    if (contactError) throw contactError;

    await logActivity({
      leadId: lead.id,
      type: 'Lead Created',
      message: 'Lead Created via Postman Automation',
      createdBy: 'postman_automation',
    });

    response.status(201).json({ ok: true, leadId: lead.id, lead });
  } catch (error) {
    response.status(error.statusCode || 500).json({ ok: false, message: error.message });
  }
});

app.post('/api/leads/:leadId/send-mom', requireApiAuth, requireRoles(['BD Executive', 'BD Head', 'Admin']), async (request, response) => {
  try {
    const client = requireSupabase();
    const { data: lead, error: leadError } = await client.from('leads').select('*').eq('id', request.params.leadId).single();
    if (leadError) throw leadError;

    const momPayload = {
      lead_id: lead.id,
      to_email: request.body?.to || request.body?.toEmail || request.body?.primaryContactEmail || '',
      cc_emails: request.body?.cc || request.body?.ccEmails || '',
      subject: request.body?.subject || `Lead Minutes of Meeting - ${lead.client_name} - myQPMS`,
      discussion_summary: request.body?.discussionSummary || 'Lead MOM recorded from Postman approval matrix automation.',
      service_scope_discussion: request.body?.serviceScopeDiscussion || (Array.isArray(lead.service_scope) ? lead.service_scope.join(', ') : ''),
      action_items: request.body?.actionItems || '',
      next_followup_date: request.body?.nextFollowUpDate || null,
      scheduled_site_visit_date: request.body?.scheduledVisitDate || null,
      scheduled_site_visit_time: request.body?.scheduledVisitTime || null,
      site_visit_remarks: request.body?.remarks || '',
      calendar_invite_sent: false,
      mom_status: 'Sent',
      sent_at: new Date().toISOString(),
      metadata: { created_by: 'postman_automation', simulated: true },
    };
    const { data: mom, error: momError } = await client.from('lead_mom').upsert(momPayload, { onConflict: 'lead_id' }).select('*').single();
    if (momError) throw momError;

    await client.from('leads').update({ lead_stage: 'Lead MOM Sent', updated_at: new Date().toISOString() }).eq('id', lead.id);
    await logActivity({
      leadId: lead.id,
      type: 'Lead MOM Sent',
      message: 'Lead MOM Sent via Postman Automation',
      createdBy: 'postman_automation',
    });

    response.json({ ok: true, simulated: true, leadId: lead.id, mom });
  } catch (error) {
    response.status(error.statusCode || 500).json({ ok: false, message: error.message });
  }
});

app.post('/api/leads/:leadId/site-visit', requireApiAuth, requireRoles(['BD Executive', 'BD Head', 'Admin']), async (request, response) => {
  try {
    const client = requireSupabase();
    const { data: lead, error: leadError } = await client.from('leads').select('*').eq('id', request.params.leadId).single();
    if (leadError) throw leadError;

    const { data: existing, error: existingError } = await client.from('site_visits').select('*').eq('lead_id', lead.id).maybeSingle();
    if (existingError) throw existingError;
    if (existing) {
      response.json({ ok: true, siteVisitId: existing.id, siteVisit: existing, reused: true });
      return;
    }
    const { data: leadMom } = await client.from('lead_mom').select('mom_status').eq('lead_id', lead.id).maybeSingle();

    const siteVisitPayload = {
      lead_id: lead.id,
      client_name: lead.client_name,
      site_name: request.body?.location || lead.site_location || `${lead.city || ''}, ${lead.state || ''}`.trim(),
      scheduled_visit_date: request.body?.scheduledVisitDate || null,
      scheduled_visit_time: request.body?.scheduledVisitTime || null,
      assigned_bd_executive: request.apiUser.name,
      assigned_bd_email: request.apiUser.email,
      current_stage: 'Pre-Operational Assessment',
      pending_with: 'BD Executive',
      status: 'Scheduled',
      mom_status: leadMom?.mom_status || 'Pending',
      metadata: { created_by: 'postman_automation', source: 'postman_approval_matrix' },
    };
    const { data: siteVisit, error } = await client.from('site_visits').insert(siteVisitPayload).select('*').single();
    if (error) throw error;

    await client.from('leads').update({ lead_stage: 'Converted', status: 'Converted to Assessment', updated_at: new Date().toISOString() }).eq('id', lead.id);
    await logActivity({
      leadId: lead.id,
      siteVisitId: siteVisit.id,
      type: 'Site Visit Created',
      message: 'Lead converted to Site Visit & Estimation via Postman Automation',
      createdBy: 'postman_automation',
    });

    response.status(201).json({ ok: true, siteVisitId: siteVisit.id, siteVisit });
  } catch (error) {
    response.status(error.statusCode || 500).json({ ok: false, message: error.message });
  }
});

app.post('/api/site-visits/:siteVisitId/assessment', requireApiAuth, requireRoles(['BD Executive', 'BD Head', 'Admin']), async (request, response) => {
  try {
    const client = requireSupabase();
    const { data: siteVisit, error: visitError } = await client.from('site_visits').select('*').eq('id', request.params.siteVisitId).single();
    if (visitError) throw visitError;

    const proposalValue = Number(request.body?.proposalValue || request.body?.commercial?.proposalValue || 0);
    const monthlyValue = Number(request.body?.monthlyValue || request.body?.commercial?.monthlyValue || 0);
    const assessmentPayload = {
      site_visit_id: siteVisit.id,
      lead_id: siteVisit.lead_id,
      ifm_service_scope: request.body?.serviceScope || [],
      manpower_requirement: {
        rows: request.body?.manpower || [],
        hr: request.body?.hr || {},
      },
      commercial_statement: {
        ...(request.body?.commercial || {}),
        proposalValue,
        monthlyValue,
        estimated_monthly_billing: monthlyValue,
        approval_rules: {
          management_approval_required: proposalValue >= 2500000,
        },
      },
      risk_assessment: {
        riskLevel: request.body?.riskLevel || 'Medium',
      },
      approval_mechanism: {
        approvalWorkflow: 'Postman Approval Matrix',
        management_approval_required: proposalValue >= 2500000,
      },
      final_remarks_signoff: {
        finalRemarks: request.body?.finalRemarks || 'Submitted from Postman automation.',
      },
      assessment_status: 'Submitted',
      final_remarks: request.body?.finalRemarks || '',
      created_by: 'postman_automation',
      metadata: {
        created_by: 'postman_automation',
        finance: request.body?.finance || {},
        submitted_by: request.apiUser.email,
      },
    };

    const { data: assessment, error } = await client
      .from('site_assessments')
      .upsert(assessmentPayload, { onConflict: 'site_visit_id' })
      .select('*')
      .single();
    if (error) throw error;

    const { data: updatedVisit, error: updateError } = await client
      .from('site_visits')
      .update({
        current_stage: 'Assessment Saved',
        pending_with: 'BD Executive',
        status: 'Assessment Submitted',
        metadata: { ...(siteVisit.metadata || {}), created_by: 'postman_automation', proposalValue, monthlyValue },
        updated_at: new Date().toISOString(),
      })
      .eq('id', siteVisit.id)
      .select('*')
      .single();
    if (updateError) throw updateError;

    await logActivity({
      leadId: siteVisit.lead_id,
      siteVisitId: siteVisit.id,
      assessmentId: assessment.id,
      type: 'Assessment Submitted',
      message: 'Site Visit Assessment submitted via Postman Automation',
      createdBy: 'postman_automation',
    });

    response.json({ ok: true, siteVisitId: siteVisit.id, assessmentId: assessment.id, assessment, siteVisit: updatedVisit });
  } catch (error) {
    response.status(error.statusCode || 500).json({ ok: false, message: error.message });
  }
});

app.post('/api/site-visits/:siteVisitId/submit-approval-matrix', requireApiAuth, requireRoles(['BD Executive', 'BD Head', 'Admin']), async (request, response) => {
  try {
    const client = requireSupabase();
    const { data: siteVisit, error: visitError } = await client
      .from('site_visits')
      .select('*')
      .eq('id', request.params.siteVisitId)
      .single();
    if (visitError) throw visitError;

    const { data: assessment, error: assessmentError } = await client
      .from('site_assessments')
      .select('*')
      .eq('site_visit_id', siteVisit.id)
      .maybeSingle();
    if (assessmentError) throw assessmentError;
    if (!assessment) {
      response.status(400).json({ ok: false, message: 'Assessment must be submitted before approval matrix.' });
      return;
    }

    const manpowerRows = assessment.manpower_requirement?.rows || assessment.metadata?.manpower || [];
    if (!Array.isArray(manpowerRows) || !manpowerRows.length) {
      response.status(400).json({ ok: false, message: 'Missing manpower data. Add manpower rows before submitting approval matrix.' });
      return;
    }

    const { data: existingApprovals, error: existingError } = await client
      .from('approval_requests')
      .select('*')
      .eq('site_visit_id', siteVisit.id)
      .in('status', ['Pending', 'Approved', 'Rejected', 'Rework Requested']);
    if (existingError) throw existingError;
    if (existingApprovals?.length) {
      const sync = await syncSiteVisitWorkflow(siteVisit.id);
      response.json({
        ok: true,
        reused: true,
        leadId: siteVisit.lead_id,
        siteVisitId: siteVisit.id,
        approvalId: existingApprovals[0]?.id || '',
        approvals: existingApprovals.map(mapApprovalResponse),
        workflow: sync.workflow,
        siteVisit: sync.siteVisit,
      });
      return;
    }

    const proposalValue = Number(
      assessment.commercial_statement?.proposalValue
      || assessment.commercial_statement?.proposal_value
      || assessment.metadata?.proposalValue
      || 0,
    );
    const stages = [
      'Commercial Review',
      'Finance Review',
      'HR Validation',
      ...(proposalValue >= 2500000 ? ['COO Approval'] : []),
    ];
    const rows = stages.map((stage) => ({
      lead_id: siteVisit.lead_id,
      site_visit_id: siteVisit.id,
      assessment_id: assessment.id,
      approval_stage: stage,
      pending_with: stageToPendingWith(stage),
      status: 'Pending',
      remarks: null,
      metadata: {
        created_by: 'postman_automation',
        department: stageToDepartment(stage),
        reviewer_role: reviewerRoleForStage(stage),
        priority: proposalValue >= 2500000 ? 'High' : 'Medium',
      },
    }));

    const { data: approvals, error } = await client.from('approval_requests').insert(rows).select('*');
    if (error) throw error;

    const pendingWith = approvals.map((approval) => approval.pending_with).join(', ');
    await maybeCreateWorkflowInstance({
      leadId: siteVisit.lead_id,
      siteVisitId: siteVisit.id,
      assessmentId: assessment.id,
      stageCode: 'commercial_review',
      pendingRole: pendingWith,
      actor: request.apiUser,
    });
    const sync = await syncSiteVisitWorkflow(siteVisit.id);
    await logActivity({
      leadId: siteVisit.lead_id,
      siteVisitId: siteVisit.id,
      assessmentId: assessment.id,
      type: 'Approval Matrix Submitted',
      message: `Approval Matrix Submitted via Postman Automation. Pending with ${pendingWith}.`,
      createdBy: request.apiUser.email,
      metadata: { proposal_value: proposalValue, stages },
    });

    response.json({
      ok: true,
      leadId: siteVisit.lead_id,
      siteVisitId: siteVisit.id,
      approvalId: approvals[0]?.id || '',
      approvals: approvals.map(mapApprovalResponse),
      workflow: sync.workflow,
      siteVisit: sync.siteVisit,
    });
  } catch (error) {
    response.status(error.statusCode || 500).json({ ok: false, message: error.message });
  }
});

app.get('/api/approvals/queue', requireApiAuth, async (request, response) => {
  try {
    const client = requireSupabase();
    const requestedDepartment = request.query.department || reviewerRoleToDepartment[request.apiUser.role];
    if (!requestedDepartment) {
      response.status(400).json({ ok: false, message: 'department query is required for this role.' });
      return;
    }

    if (request.apiUser.role !== 'Admin' && reviewerRoleToDepartment[request.apiUser.role] !== requestedDepartment) {
      response.status(403).json({ ok: false, message: `${request.apiUser.role} cannot view ${requestedDepartment} queue.` });
      return;
    }

    const stage = departmentToStage(requestedDepartment);
    const { data, error } = await client
      .from('approval_requests')
      .select('*, site_visits(*), leads(*)')
      .eq('approval_stage', stage)
      .eq('status', 'Pending')
      .order('created_at', { ascending: true });
    if (error) throw error;

    const approvals = (data || []).map((approval) => ({
      ...mapApprovalResponse(approval),
      siteVisit: approval.site_visits || null,
      lead: approval.leads || null,
    }));

    response.json({ ok: true, department: requestedDepartment, count: approvals.length, approvals });
  } catch (error) {
    response.status(error.statusCode || 500).json({ ok: false, message: error.message });
  }
});

app.post('/api/approvals/:approvalId/decision', requireApiAuth, async (request, response) => {
  try {
    const client = requireSupabase();
    const { data: approval, error: fetchError } = await client
      .from('approval_requests')
      .select('*')
      .eq('id', request.params.approvalId)
      .single();
    if (fetchError) throw fetchError;

    const assignedRole = reviewerRoleForStage(approval.approval_stage);
    if (request.apiUser.role !== 'Admin' && request.apiUser.role !== assignedRole) {
      response.status(403).json({ ok: false, message: `${request.apiUser.role} cannot decide ${stageToDepartment(approval.approval_stage)} approval.` });
      return;
    }

    const decision = normalizeDecision(request.body?.decision);
    if (!decision) {
      response.status(400).json({ ok: false, message: 'decision must be approve, reject, or rework.' });
      return;
    }

    const { data: nextApproval, error } = await client
      .from('approval_requests')
      .update({
        status: decision,
        remarks: request.body?.remarks || '',
        approved_by: request.apiUser.email,
        approved_at: new Date().toISOString(),
        metadata: {
          ...(approval.metadata || {}),
          created_by: 'postman_automation',
          decided_by_role: request.apiUser.role,
          decided_by_email: request.apiUser.email,
        },
        updated_at: new Date().toISOString(),
      })
      .eq('id', approval.id)
      .select('*')
      .single();
    if (error) throw error;

    if (decision !== 'Approved') {
      const { error: closePendingError } = await client
        .from('approval_requests')
        .update({
          status: 'Cancelled',
          remarks: `${nextApproval.approval_stage} ${decision}; remaining pending approvals closed for this review cycle.`,
          metadata: {
            created_by: 'postman_automation',
            closed_by_decision: decision,
            closed_by_approval_id: nextApproval.id,
          },
          updated_at: new Date().toISOString(),
        })
        .eq('site_visit_id', nextApproval.site_visit_id)
        .eq('status', 'Pending')
        .neq('id', nextApproval.id);
      if (closePendingError) throw closePendingError;
    }

    const sync = await syncSiteVisitWorkflow(nextApproval.site_visit_id);
    await logActivity({
      leadId: nextApproval.lead_id,
      siteVisitId: nextApproval.site_visit_id,
      assessmentId: nextApproval.assessment_id,
      type: 'Approval Decision',
      message: `${nextApproval.approval_stage} ${decision} by ${request.apiUser.email}`,
      createdBy: request.apiUser.email,
      metadata: { approval_request_id: nextApproval.id, decision },
    });

    response.json({
      ok: true,
      approvalId: nextApproval.id,
      approval: mapApprovalResponse(nextApproval),
      workflow: sync.workflow,
      siteVisit: sync.siteVisit,
    });
  } catch (error) {
    response.status(error.statusCode || 500).json({ ok: false, message: error.message });
  }
});

app.get('/api/workflows/:siteVisitId/status', requireApiAuth, async (request, response) => {
  try {
    const client = requireSupabase();
    const { data: siteVisit, error: visitError } = await client
      .from('site_visits')
      .select('*, leads(*), site_assessments(*)')
      .eq('id', request.params.siteVisitId)
      .single();
    if (visitError) throw visitError;

    const approvals = await getApprovalsForSiteVisit(siteVisit.id);
    const workflow = calculateWorkflowStatusFromApprovals(approvals);
    const { data: events, error: eventsError } = await client
      .from('activity_logs')
      .select('*')
      .or(`site_visit_id.eq.${siteVisit.id},lead_id.eq.${siteVisit.lead_id}`)
      .order('created_at', { ascending: false })
      .limit(50);
    if (eventsError) throw eventsError;

    response.json({
      ok: true,
      lead: siteVisit.leads || null,
      siteVisit,
      assessment: siteVisit.site_assessments?.[0] || null,
      approvals: approvals.map(mapApprovalResponse),
      workflow,
      events: events || [],
    });
  } catch (error) {
    response.status(error.statusCode || 500).json({ ok: false, message: error.message });
  }
});

app.post(
  '/api/fo/site-visits/:visitId/force-checkout',
  requireApiAuth,
  requireRoles(['Admin', 'MD', 'COO', 'GM / Top Management', 'Finance GM', 'CFO', 'Existing Business Operations Team']),
  async (request, response) => {
    try {
      const client = requireServiceRoleSupabase();
      const visitId = String(request.params.visitId || '').trim();
      const remarks = String(request.body?.remarks || '').trim();
      if (!visitId) {
        response.status(400).json({ ok: false, message: 'visitId is required.' });
        return;
      }
      if (!remarks) {
        response.status(400).json({ ok: false, message: 'Admin remarks are required for Force Check Out.' });
        return;
      }

      const { data: visit, error: visitError } = await client
        .from('fo_site_visits')
        .select('*')
        .eq('id', visitId)
        .single();
      if (visitError) throw visitError;
      if (!visit) {
        response.status(404).json({ ok: false, message: 'Site visit not found.' });
        return;
      }
      if (visit.checkout_time || visit.check_out_time) {
        response.status(409).json({ ok: false, message: 'Site visit is already checked out.' });
        return;
      }

      const nowIso = new Date().toISOString();
      const checkIn = visit.check_in_time ? new Date(visit.check_in_time) : null;
      const duration = checkIn && !Number.isNaN(checkIn.getTime())
        ? Math.max(0, Math.round((Date.now() - checkIn.getTime()) / 60000))
        : null;
      const checkoutLatitudeRaw = request.body?.checkout_latitude;
      const checkoutLongitudeRaw = request.body?.checkout_longitude;
      const checkoutLatitude = Number(checkoutLatitudeRaw);
      const checkoutLongitude = Number(checkoutLongitudeRaw);
      const hasCheckoutCoordinates =
        checkoutLatitudeRaw !== null &&
        checkoutLatitudeRaw !== undefined &&
        checkoutLatitudeRaw !== '' &&
        checkoutLongitudeRaw !== null &&
        checkoutLongitudeRaw !== undefined &&
        checkoutLongitudeRaw !== '' &&
        Number.isFinite(checkoutLatitude) &&
        Number.isFinite(checkoutLongitude) &&
        checkoutLatitude >= -90 &&
        checkoutLatitude <= 90 &&
        checkoutLongitude >= -180 &&
        checkoutLongitude <= 180;
      const metadata = visit.metadata && typeof visit.metadata === 'object' && !Array.isArray(visit.metadata)
        ? visit.metadata
        : {};
      const updatePayload = {
        checkout_time: nowIso,
        check_out_time: nowIso,
        visit_duration_minutes: duration,
        status: 'Checked Out',
        visit_status: 'Admin Force Check Out',
        checkout_note: remarks,
        metadata: {
          ...metadata,
          admin_support_last_action: 'force_check_out',
          admin_support_last_remarks: remarks,
          admin_support_last_at: nowIso,
          admin_support_source: 'backend_force_checkout',
          admin_support_actor_id: request.apiUser.id,
          admin_support_actor_email: request.apiUser.email,
          admin_support_actor_role: request.apiUser.role,
          force_checkout: true,
          force_checkout_coordinate_source: hasCheckoutCoordinates ? 'web_live_status' : 'not_provided',
        },
        updated_at: nowIso,
      };
      if (hasCheckoutCoordinates) {
        updatePayload.check_out_latitude = checkoutLatitude;
        updatePayload.check_out_longitude = checkoutLongitude;
      }

      const { data: updatedVisit, error: updateError } = await client
        .from('fo_site_visits')
        .update(updatePayload)
        .eq('id', visit.id)
        .select('*')
        .single();
      if (updateError) throw updateError;

      const { data: liveStatus, error: liveStatusFetchError } = await client
        .from('fo_live_status')
        .select('metadata')
        .eq('fo_user_id', visit.fo_user_id)
        .eq('active_site_visit_id', visit.id)
        .maybeSingle();
      if (liveStatusFetchError) throw liveStatusFetchError;
      const liveMetadata = liveStatus?.metadata && typeof liveStatus.metadata === 'object' && !Array.isArray(liveStatus.metadata)
        ? liveStatus.metadata
        : {};
      const { error: liveStatusError } = await client
        .from('fo_live_status')
        .update({
          active_site_visit_id: null,
          current_status: 'Active',
          metadata: {
            ...liveMetadata,
            force_checkout_cleared_active_site_visit_id: visit.id,
            force_checkout_cleared_at: nowIso,
            force_checkout_cleared_by: request.apiUser.email,
          },
          updated_at: nowIso,
        })
        .eq('fo_user_id', visit.fo_user_id)
        .eq('active_site_visit_id', visit.id);
      if (liveStatusError) throw liveStatusError;

      const recalculationPayload = {
        attendance_id: visit.attendance_id,
        fo_user_id: visit.fo_user_id || visit.employee_code,
        date: visit.check_in_time ? new Date(visit.check_in_time).toISOString().slice(0, 10) : undefined,
      };
      const recalculation = await recalculateFoKm(client, recalculationPayload);
      response.json({
        ok: true,
        message: 'Site visit force checked out.',
        visit: updatedVisit,
        recalculation,
      });
    } catch (error) {
      response.status(error.statusCode || 500).json({ ok: false, message: error.message });
    }
  },
);

app.post('/api/fo/km/recalculate', async (request, response) => {
  const payload = request.body || {};
  const lockKey = foKmRecalculationLockKey(payload);
  const lockDate = normalizeFoKmRecalculationDate(payload.date);
  if (foKmRecalculateAllLocks.has(lockDate) || foKmRecalculationLocks.has(lockKey)) {
    response.status(409).json({ ok: false, message: FO_KM_RECALCULATION_RUNNING_MESSAGE });
    return;
  }
  foKmRecalculationLocks.add(lockKey);
  try {
    const client = requireSupabase();
    const result = await recalculateFoKm(client, payload, {
      maxGoogleDirectionsCalls: payload.max_google_directions_calls,
    });
    response.json({ ok: true, ...result });
  } catch (error) {
    response.status(error.statusCode || 500).json({ ok: false, message: error.message });
  } finally {
    foKmRecalculationLocks.delete(lockKey);
  }
});

app.post('/api/fo/km/recalculate-all', async (request, response) => {
  const payload = request.body || {};
  const lockDate = normalizeFoKmRecalculationDate(payload.date);
  if (foKmRecalculateAllLocks.has(lockDate) || hasFoKmRecalculationForDate(lockDate)) {
    response.status(409).json({ ok: false, message: FO_KM_RECALCULATION_RUNNING_MESSAGE });
    return;
  }
  foKmRecalculateAllLocks.add(lockDate);
  try {
    const client = requireSupabase();
    const result = await recalculateFoKmForToday(client, payload, {
      maxGoogleDirectionsCalls: payload.max_google_directions_calls,
    });
    response.json({ ok: true, ...result });
  } catch (error) {
    response.status(error.statusCode || 500).json({ ok: false, message: error.message });
  } finally {
    foKmRecalculateAllLocks.delete(lockDate);
  }
});

app.post('/send-lead-mom', routeSendMom('lead'));
app.post('/send-sitevisit-mom', routeSendMom('sitevisit'));

app.listen(port, () => {
  console.log('[myQPMS Mail API] Startup complete', {
    port,
    allowedOrigins,
    emailUserConfigured: Boolean(process.env.EMAIL_USER),
    emailPassConfigured: Boolean(process.env.EMAIL_PASS),
    supabaseConfigured: supabaseConfigStatus.configured,
    supabaseUrlPresent: supabaseConfigStatus.urlPresent,
    supabaseKeyPresent: supabaseConfigStatus.keyPresent,
  });
  verifyMailTransporter();
});
