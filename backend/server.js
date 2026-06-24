import cors from 'cors';
import { randomUUID } from 'node:crypto';
import dotenv from 'dotenv';
import express from 'express';
import nodemailer from 'nodemailer';
import { createClient } from '@supabase/supabase-js';
import { recalculateFoKm, recalculateFoKmForToday } from './foKmRecalculationService.js';
import { cleanupStaleFoSessions } from './foStaleSessionCleanupService.js';
import {
  USER_MANAGEMENT_PROFILE_SELECT,
  assertUserManagementFoundation,
  attachOperationalCounts,
  booleanValue,
  buildEmployeeCodeRepairPreview,
  buildHardDeletePreview,
  hasOwn,
  hierarchyPayloadFromBody,
  loadHierarchy,
  loadOperationalCounts,
  loadProfileById,
  normalizeEmail,
  normalizeEmployeeCode,
  profileMetadataForAuth,
  safeAuthError,
  sanitizeAuditData,
  saveHierarchy,
  textOrNull,
  isAuthUserNotFoundError,
  userManagementErrorMessage,
  writeUserManagementAudit,
} from './userManagementService.js';

dotenv.config({ path: './.env' });
dotenv.config({ path: './backend/.env' });

const app = express();
const port = Number(process.env.PORT || 4000);
const demoBackendAuthEnabled =
  String(process.env.ENABLE_DEMO_AUTH || '').trim().toLowerCase() === 'true';
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
const FO_STALE_CLEANUP_INTERVAL_MS = Number(process.env.FO_STALE_CLEANUP_INTERVAL_MS || 30 * 60 * 1000);

function currentIndiaDateInput(date = new Date()) {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Kolkata',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(date);
}

function isActiveAttendance(row) {
  return Boolean(row) &&
    !row.logout_time &&
    String(row.status || 'Active').toLowerCase() === 'active';
}

async function loadCurrentActiveAttendance(client, foIds, attendanceDate) {
  const uniqueFoIds = Array.from(new Set((foIds || []).map((value) => String(value || '').trim()).filter(Boolean)));
  const rowsById = new Map();
  for (const foId of uniqueFoIds) {
    for (const column of ['fo_user_id', 'username']) {
      const { data, error } = await client
        .from('fo_attendance')
        .select('*')
        .eq(column, foId)
        .eq('attendance_date', attendanceDate)
        .order('login_time', { ascending: false })
        .limit(5);
      if (error) throw error;
      for (const row of data || []) {
        rowsById.set(String(row.id || `${column}-${foId}-${row.login_time}`), row);
      }
    }
  }
  return Array.from(rowsById.values())
    .sort((a, b) => new Date(b.login_time || b.created_at || 0) - new Date(a.login_time || a.created_at || 0))
    .find(isActiveAttendance) || null;
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
const supabaseAnonKey = process.env.SUPABASE_ANON_KEY || process.env.VITE_SUPABASE_ANON_KEY;
const supabaseServiceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const supabaseAnon = supabaseUrl && supabaseAnonKey ? createClient(supabaseUrl, supabaseAnonKey, {
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
  configured: Boolean(supabaseAnon),
  urlPresent: Boolean(supabaseUrl),
  keyPresent: Boolean(supabaseAnonKey),
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

function createUserScopedSupabase(accessToken) {
  if (!supabaseUrl || !supabaseAnonKey) {
    const error = new Error('Supabase URL and anon key are required for JWT-authenticated backend routes.');
    error.statusCode = 503;
    throw error;
  }
  return createClient(supabaseUrl, supabaseAnonKey, {
    global: {
      headers: {
        Authorization: `Bearer ${accessToken}`,
      },
    },
    realtime: {
      enabled: false,
    },
    auth: {
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false,
    },
  });
}

async function requireSupabaseJwt(request, response, next) {
  const accessToken = getBearerToken(request);
  if (!accessToken) {
    response.status(401).json({ ok: false, message: 'Supabase Bearer token required.' });
    return;
  }
  if (!supabaseAnon) {
    response.status(503).json({ ok: false, message: 'Supabase JWT verification is not configured on the API server.' });
    return;
  }

  try {
    const { data: authData, error: authError } = await supabaseAnon.auth.getUser(accessToken);
    if (authError || !authData?.user) {
      response.status(401).json({ ok: false, message: 'Invalid or expired Supabase access token.' });
      return;
    }

    const userScopedSupabase = createUserScopedSupabase(accessToken);
    const { data: profile, error: profileError } = await userScopedSupabase
      .from('profiles')
      .select('*')
      .eq('auth_user_id', authData.user.id)
      .maybeSingle();
    if (profileError) throw profileError;
    if (!profile) {
      response.status(403).json({ ok: false, message: 'Authenticated user profile was not found.' });
      return;
    }

    request.authUser = authData.user;
    request.profile = profile;
    request.employeeCode = String(profile.employee_code || '').trim() || null;
    request.userRole = String(profile.role || '').trim();
    request.userSupabase = userScopedSupabase;
    next();
  } catch (error) {
    console.warn('[myQPMS Auth] Supabase JWT verification failed', {
      message: error.message,
      code: error.code || null,
    });
    response.status(error.statusCode || 401).json({
      ok: false,
      message: error.statusCode === 503
        ? error.message
        : 'Unable to verify Supabase access token.',
    });
  }
}

const USER_MANAGEMENT_ROLE_KEYS = new Set([
  'ADMIN',
  'MD',
  'COO',
  'GM',
  'GENERALMANAGER',
  'GMTOPMANAGEMENT',
  'TOPMANAGEMENT',
  'MANAGEMENT',
  'HR',
  'HUMANRESOURCES',
  'HRREVIEWER',
  'HRGM',
  'FINANCEGM',
]);

function normalizePermissionRole(role) {
  return String(role || '')
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, '');
}

function hasUserManagementPermission(profile) {
  if (!profile || profile.is_active !== true) return false;
  if (profile.web_access_enabled === false) return false;
  if (['INACTIVE', 'DISABLED', 'DEACTIVATED'].includes(normalizePermissionRole(profile.status))) {
    return false;
  }
  return USER_MANAGEMENT_ROLE_KEYS.has(normalizePermissionRole(profile.role));
}

function requireUserManagementPermission(request, response, next) {
  if (!hasUserManagementPermission(request.profile)) {
    response.status(403).json({
      ok: false,
      message: `Role ${request.userRole || 'Unknown'} cannot access User Management.`,
    });
    return;
  }
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
  if (!supabaseAnon) {
    const error = new Error('Supabase backend configuration is missing on the API server. Set SUPABASE_URL and SUPABASE_ANON_KEY.');
    error.statusCode = 503;
    throw error;
  }
  return supabaseAnon;
}

function requireServiceRoleSupabase() {
  // Service role bypasses RLS. Call this only inside explicitly authorized
  // admin handlers or trusted server jobs, never as ordinary request identity.
  if (!serviceRoleSupabase) {
    const error = new Error('SUPABASE_SERVICE_ROLE_KEY is required for backend-only admin FO actions.');
    error.statusCode = 503;
    throw error;
  }
  return serviceRoleSupabase;
}

function userManagementHttpError(statusCode, message, details = null) {
  const error = new Error(message);
  error.statusCode = statusCode;
  error.details = details;
  return error;
}

function respondUserManagementError(response, error) {
  const payload = {
    ok: false,
    message: userManagementErrorMessage(error),
  };
  if (error?.details) payload.details = sanitizeAuditData(error.details);
  response.status(error?.statusCode || 500).json(payload);
}

function parsePositiveInteger(value, fallback, maximum) {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed) || parsed < 1) return fallback;
  return Math.min(parsed, maximum);
}

function safeSearchTerm(value) {
  return String(value || '')
    .trim()
    .replace(/[,%()]/g, ' ')
    .replace(/\s+/g, ' ')
    .slice(0, 120);
}

function profileCreatePayload(body, authUserId, usedTemporaryPassword) {
  const employeeCode = normalizeEmployeeCode(body.employee_code);
  const fullName = textOrNull(body.full_name);
  const email = normalizeEmail(body.email);
  return {
    auth_user_id: authUserId,
    employee_code: employeeCode,
    username: textOrNull(body.username) || employeeCode,
    full_name: fullName,
    display_name: textOrNull(body.display_name) || fullName,
    mobile: textOrNull(body.mobile),
    email,
    state: textOrNull(body.state),
    role: textOrNull(body.role) || 'FO',
    designation: textOrNull(body.designation),
    department: textOrNull(body.department),
    business: textOrNull(body.business),
    status: 'Active',
    is_active: true,
    requires_password_change: usedTemporaryPassword
      ? true
      : booleanValue(body.requires_password_change, false),
    mobile_access_enabled: booleanValue(body.mobile_access_enabled, true),
    web_access_enabled: booleanValue(body.web_access_enabled, true),
    auth_provisioning_status: 'provisioned',
    auth_provisioning_error: null,
    auth_provisioned_at: new Date().toISOString(),
    last_profile_sync_at: new Date().toISOString(),
  };
}

function profilePatchPayload(body) {
  const textFields = [
    'full_name',
    'display_name',
    'mobile',
    'email',
    'state',
    'role',
    'designation',
    'department',
    'business',
    'status',
  ];
  const booleanFields = [
    'is_active',
    'requires_password_change',
    'mobile_access_enabled',
    'web_access_enabled',
  ];
  const payload = {};
  for (const field of textFields) {
    if (!hasOwn(body, field)) continue;
    payload[field] = field === 'email'
      ? normalizeEmail(body[field]) || null
      : textOrNull(body[field]);
  }
  for (const field of booleanFields) {
    if (hasOwn(body, field)) payload[field] = booleanValue(body[field]);
  }
  return payload;
}

async function ensureUniqueProfileIdentity(client, { employeeCode, email, excludeProfileId = null }) {
  if (employeeCode) {
    let employeeQuery = client
      .from('profiles')
      .select('id,is_active')
      .ilike('employee_code', employeeCode)
      .limit(1);
    if (excludeProfileId) employeeQuery = employeeQuery.neq('id', excludeProfileId);
    const { data, error } = await employeeQuery;
    if (error) throw error;
    if (data?.length) {
      throw userManagementHttpError(
        409,
        data[0].is_active
          ? 'Employee code already exists in an active profile.'
          : 'Employee code already exists in an inactive profile and cannot be reused.',
      );
    }
  }
  if (email) {
    let emailQuery = client
      .from('profiles')
      .select('id')
      .ilike('email', email)
      .limit(1);
    if (excludeProfileId) emailQuery = emailQuery.neq('id', excludeProfileId);
    const { data, error } = await emailQuery;
    if (error) throw error;
    if (data?.length) {
      throw userManagementHttpError(409, 'Email is already linked to another profile.');
    }
  }
}

async function markProfileAuthSyncFailure(client, profileId, error) {
  const safeError = safeAuthError(error);
  const { data, error: updateError } = await client
    .from('profiles')
    .update({
      auth_provisioning_status: 'profile_updated_auth_sync_failed',
      auth_provisioning_error: safeError.message,
      last_profile_sync_at: new Date().toISOString(),
    })
    .eq('id', profileId)
    .select(USER_MANAGEMENT_PROFILE_SELECT)
    .single();
  if (updateError) throw updateError;
  return data;
}

async function prepareEmployeeCodeRepairPreview(client, profileId, body) {
  const profile = await loadProfileById(client, profileId);
  if (!profile) throw userManagementHttpError(404, 'User profile not found.');
  const oldEmployeeCode = normalizeEmployeeCode(body?.old_employee_code);
  const newEmployeeCode = normalizeEmployeeCode(body?.new_employee_code);
  const reason = textOrNull(body?.reason);
  if (!oldEmployeeCode) {
    throw userManagementHttpError(400, 'old_employee_code is required.');
  }
  if (!newEmployeeCode) {
    throw userManagementHttpError(400, 'new_employee_code is required.');
  }
  if (!reason) throw userManagementHttpError(400, 'reason is required.');
  if (normalizeEmployeeCode(profile.employee_code) !== oldEmployeeCode) {
    throw userManagementHttpError(
      409,
      'Profile employee code does not match old_employee_code.',
    );
  }
  if (oldEmployeeCode === newEmployeeCode) {
    throw userManagementHttpError(
      400,
      'old_employee_code and new_employee_code must be different.',
    );
  }
  await ensureUniqueProfileIdentity(client, {
    employeeCode: newEmployeeCode,
    excludeProfileId: profile.id,
  });
  const preview = await buildEmployeeCodeRepairPreview(
    client,
    profile,
    oldEmployeeCode,
    newEmployeeCode,
  );
  return { profile, preview, reason, oldEmployeeCode, newEmployeeCode };
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
  if (!demoBackendAuthEnabled) {
    response.status(404).json({
      ok: false,
      message: 'Demo backend authentication is disabled.',
    });
    return;
  }
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

app.get(
  '/api/admin/users/me',
  requireSupabaseJwt,
  requireUserManagementPermission,
  (request, response) => {
    response.json({
      ok: true,
      authUserId: request.authUser.id,
      profileId: request.profile.id,
      employee_code: request.employeeCode,
      full_name: request.profile.full_name || null,
      role: request.userRole,
      designation: request.profile.designation || null,
      department: request.profile.department || null,
      business: request.profile.business || null,
      hasUserManagementPermission: true,
    });
  },
);

app.get(
  '/api/admin/users',
  requireSupabaseJwt,
  requireUserManagementPermission,
  async (request, response) => {
    try {
      const client = requireServiceRoleSupabase();
      await assertUserManagementFoundation(client);
      const page = parsePositiveInteger(request.query.page, 1, 100000);
      const pageSize = parsePositiveInteger(request.query.pageSize, 25, 200);
      const from = (page - 1) * pageSize;
      const to = from + pageSize - 1;
      let query = client
        .from('profiles')
        .select(USER_MANAGEMENT_PROFILE_SELECT, { count: 'exact' })
        .order('created_at', { ascending: false })
        .range(from, to);

      const exactFilters = [
        'state',
        'role',
        'designation',
        'department',
        'business',
        'status',
        'auth_provisioning_status',
      ];
      for (const field of exactFilters) {
        const value = textOrNull(request.query[field]);
        if (value) query = query.eq(field, value);
      }
      if (request.query.is_active !== undefined) {
        const normalized = String(request.query.is_active).trim().toLowerCase();
        if (!['true', 'false', '1', '0'].includes(normalized)) {
          throw userManagementHttpError(400, 'is_active must be true or false.');
        }
        query = query.eq('is_active', booleanValue(normalized));
      }
      const search = safeSearchTerm(request.query.search);
      if (search) {
        query = query.or(
          [
            'employee_code',
            'username',
            'full_name',
            'display_name',
            'mobile',
            'email',
          ]
            .map((field) => `${field}.ilike.%${search}%`)
            .join(','),
        );
      }

      const { data, error, count } = await query;
      if (error) throw error;
      const profiles = data || [];
      const counts = await loadOperationalCounts(
        client,
        profiles.map((profile) => profile.employee_code),
      );
      response.json({
        ok: true,
        page,
        pageSize,
        total: count || 0,
        totalPages: count ? Math.ceil(count / pageSize) : 0,
        users: profiles.map((profile) => attachOperationalCounts(profile, counts)),
      });
    } catch (error) {
      respondUserManagementError(response, error);
    }
  },
);

app.post(
  '/api/admin/users/sync-auth-to-profiles',
  requireSupabaseJwt,
  requireUserManagementPermission,
  async (request, response) => {
    try {
      const client = requireServiceRoleSupabase();
      await assertUserManagementFoundation(client);
      const authUsers = [];
      let authPage = 1;
      const perPage = 1000;
      while (true) {
        const { data, error } = await client.auth.admin.listUsers({
          page: authPage,
          perPage,
        });
        if (error) throw error;
        authUsers.push(...(data.users || []));
        if (!data.nextPage || !(data.users || []).length) break;
        authPage = data.nextPage;
      }

      const existingProfiles = [];
      const profilePageSize = 1000;
      for (let from = 0; ; from += profilePageSize) {
        const { data, error } = await client
          .from('profiles')
          .select(USER_MANAGEMENT_PROFILE_SELECT)
          .not('auth_user_id', 'is', null)
          .range(from, from + profilePageSize - 1);
        if (error) throw error;
        existingProfiles.push(...(data || []));
        if ((data || []).length < profilePageSize) break;
      }
      const profilesByAuthUserId = new Map(
        existingProfiles.map((profile) => [String(profile.auth_user_id), profile]),
      );
      const summary = {
        total_auth_users_scanned: authUsers.length,
        profiles_created: 0,
        profiles_updated: 0,
        profiles_already_existing: 0,
        skipped_users: 0,
        errors: [],
      };
      const syncedAt = new Date().toISOString();

      for (const authUser of authUsers) {
        const existing = profilesByAuthUserId.get(String(authUser.id));
        try {
          if (existing) {
            summary.profiles_already_existing += 1;
            const patch = {
              last_profile_sync_at: syncedAt,
              auth_provisioning_status: 'provisioned',
              auth_provisioning_error: null,
              auth_provisioned_at:
                existing.auth_provisioned_at || authUser.created_at || syncedAt,
            };
            if (!textOrNull(existing.email) && normalizeEmail(authUser.email)) {
              patch.email = normalizeEmail(authUser.email);
            }
            const { error } = await client
              .from('profiles')
              .update(patch)
              .eq('id', existing.id);
            if (error) throw error;
            summary.profiles_updated += 1;
            continue;
          }

          const metadata = authUser.user_metadata || {};
          const email = normalizeEmail(authUser.email);
          if (!email) {
            summary.skipped_users += 1;
            summary.errors.push({
              auth_user_id: authUser.id,
              message: 'Auth user has no email; no approved placeholder-email strategy is configured.',
            });
            continue;
          }
          const employeeCode = normalizeEmployeeCode(metadata.employee_code);
          const fullName =
            textOrNull(metadata.full_name) ||
            textOrNull(metadata.name) ||
            email.split('@')[0] ||
            'Supabase User';
          const { data: createdProfile, error } = await client
            .from('profiles')
            .insert({
              auth_user_id: authUser.id,
              employee_code: employeeCode || null,
              username: employeeCode || email,
              full_name: fullName,
              display_name: textOrNull(metadata.display_name) || fullName,
              mobile: textOrNull(authUser.phone || metadata.mobile),
              email,
              state: textOrNull(metadata.state),
              role: textOrNull(metadata.role) || 'BD',
              designation: textOrNull(metadata.designation),
              department: textOrNull(metadata.department),
              business: textOrNull(metadata.business),
              status: 'Active',
              is_active: true,
              auth_provisioning_status: 'provisioned',
              auth_provisioning_error: null,
              auth_provisioned_at: authUser.created_at || syncedAt,
              last_profile_sync_at: syncedAt,
            })
            .select(USER_MANAGEMENT_PROFILE_SELECT)
            .single();
          if (error) throw error;
          profilesByAuthUserId.set(String(authUser.id), createdProfile);
          summary.profiles_created += 1;
        } catch (error) {
          summary.errors.push({
            auth_user_id: authUser.id,
            email: authUser.email || null,
            message: userManagementErrorMessage(error),
            code: error.code || null,
          });
        }
      }

      await writeUserManagementAudit(client, {
        action: 'SYNC_AUTH_TO_PROFILES',
        newData: summary,
        metadata: {
          source: 'supabase_auth_admin_list_users',
        },
        request,
      });
      response.json({ ok: true, ...summary });
    } catch (error) {
      respondUserManagementError(response, error);
    }
  },
);

app.post(
  '/api/admin/users',
  requireSupabaseJwt,
  requireUserManagementPermission,
  async (request, response) => {
    let createdAuthUser = null;
    let createdProfile = null;
    try {
      const client = requireServiceRoleSupabase();
      await assertUserManagementFoundation(client);
      const body = request.body || {};
      const employeeCode = normalizeEmployeeCode(body.employee_code);
      const fullName = textOrNull(body.full_name);
      const email = normalizeEmail(body.email);
      const temporaryPassword = textOrNull(body.temporary_password);
      const password = temporaryPassword || textOrNull(body.password);
      if (!employeeCode) throw userManagementHttpError(400, 'employee_code is required.');
      if (!fullName) throw userManagementHttpError(400, 'full_name is required.');
      if (!email) {
        throw userManagementHttpError(
          400,
          'email is required for Supabase Auth user creation; no placeholder-email strategy is configured.',
        );
      }
      if (!password) {
        throw userManagementHttpError(400, 'password or temporary_password is required.');
      }
      await ensureUniqueProfileIdentity(client, { employeeCode, email });

      const authMetadata = {
        employee_code: employeeCode,
        full_name: fullName,
        display_name: textOrNull(body.display_name) || fullName,
        mobile: textOrNull(body.mobile),
        role: textOrNull(body.role) || 'FO',
        designation: textOrNull(body.designation),
        department: textOrNull(body.department),
        business: textOrNull(body.business),
        state: textOrNull(body.state),
      };
      const { data: authData, error: authError } = await client.auth.admin.createUser({
        email,
        password,
        email_confirm: true,
        user_metadata: authMetadata,
      });
      if (authError) throw authError;
      createdAuthUser = authData.user;

      const profilePayload = profileCreatePayload(
        body,
        createdAuthUser.id,
        Boolean(temporaryPassword),
      );
      const { data: profile, error: profileError } = await client
        .from('profiles')
        .insert(profilePayload)
        .select(USER_MANAGEMENT_PROFILE_SELECT)
        .single();
      if (profileError) {
        const safeFailure = safeAuthError(profileError);
        const { error: provisioningMarkError } = await client.auth.admin.updateUserById(
          createdAuthUser.id,
          {
            app_metadata: {
              ...(createdAuthUser.app_metadata || {}),
              profile_provisioning_status: 'failed',
              profile_provisioning_error: safeFailure.message,
            },
          },
        );
        const safeProvisioningMarkError = provisioningMarkError
          ? safeAuthError(provisioningMarkError)
          : null;
        await writeUserManagementAudit(client, {
          action: 'CREATE_USER_PROFILE_FAILED',
          targetProfile: {
            auth_user_id: createdAuthUser.id,
            employee_code: employeeCode,
          },
          newData: profilePayload,
          metadata: {
            auth_user_created: true,
            profile_created: false,
            error: safeFailure,
            auth_failure_marker_error: safeProvisioningMarkError,
          },
          request,
        });
        throw userManagementHttpError(
          500,
          'Supabase Auth user was created, but profile creation failed. The Auth user was retained and marked for provisioning review.',
          {
            auth_user_id: createdAuthUser.id,
            error: safeFailure,
            auth_failure_marker_error: safeProvisioningMarkError,
          },
        );
      }
      createdProfile = profile;

      let hierarchy = null;
      try {
        hierarchy = await saveHierarchy(
          client,
          createdProfile.employee_code,
          body,
          request.authUser.id,
        );
      } catch (hierarchyError) {
        await writeUserManagementAudit(client, {
          action: 'CREATE_USER_HIERARCHY_FAILED',
          targetProfile: createdProfile,
          newData: createdProfile,
          metadata: {
            profile_created: true,
            hierarchy_saved: false,
            error: safeAuthError(hierarchyError),
          },
          request,
        });
        throw userManagementHttpError(
          500,
          'User and profile were created, but hierarchy could not be saved. No user data was deleted.',
          { profile_id: createdProfile.id, error: safeAuthError(hierarchyError) },
        );
      }

      await writeUserManagementAudit(client, {
        action: 'CREATE_USER',
        targetProfile: createdProfile,
        newData: {
          profile: createdProfile,
          hierarchy,
        },
        metadata: {
          auth_user_created: true,
          temporary_password_used: Boolean(temporaryPassword),
        },
        request,
      });
      response.status(201).json({
        ok: true,
        profile: createdProfile,
        hierarchy,
      });
    } catch (error) {
      respondUserManagementError(response, error);
    }
  },
);

app.get(
  '/api/admin/users/:profileId',
  requireSupabaseJwt,
  requireUserManagementPermission,
  async (request, response) => {
    try {
      const client = requireServiceRoleSupabase();
      await assertUserManagementFoundation(client);
      const profile = await loadProfileById(client, request.params.profileId);
      if (!profile) throw userManagementHttpError(404, 'User profile not found.');
      const [counts, hierarchy] = await Promise.all([
        loadOperationalCounts(client, [profile.employee_code]),
        loadHierarchy(client, profile.employee_code),
      ]);
      response.json({
        ok: true,
        profile: attachOperationalCounts(profile, counts),
        hierarchy,
      });
    } catch (error) {
      respondUserManagementError(response, error);
    }
  },
);

app.patch(
  '/api/admin/users/:profileId',
  requireSupabaseJwt,
  requireUserManagementPermission,
  async (request, response) => {
    try {
      const client = requireServiceRoleSupabase();
      await assertUserManagementFoundation(client);
      const body = request.body || {};
      const oldProfile = await loadProfileById(client, request.params.profileId);
      if (!oldProfile) throw userManagementHttpError(404, 'User profile not found.');
      if (
        hasOwn(body, 'employee_code') &&
        normalizeEmployeeCode(body.employee_code) !== normalizeEmployeeCode(oldProfile.employee_code)
      ) {
        throw userManagementHttpError(
          400,
          'Employee code repair must use the dedicated repair flow.',
        );
      }
      if (hasOwn(body, 'full_name') && !textOrNull(body.full_name)) {
        throw userManagementHttpError(400, 'full_name cannot be empty.');
      }
      if (hasOwn(body, 'email') && !normalizeEmail(body.email)) {
        throw userManagementHttpError(400, 'email cannot be empty.');
      }
      const profilePatch = profilePatchPayload(body);
      const hierarchySupplied = Boolean(
        hierarchyPayloadFromBody(body, oldProfile.employee_code),
      );
      if (!Object.keys(profilePatch).length && !hierarchySupplied) {
        throw userManagementHttpError(400, 'No supported profile or hierarchy fields were supplied.');
      }
      const nextEmail = hasOwn(profilePatch, 'email') ? profilePatch.email : oldProfile.email;
      if (nextEmail && normalizeEmail(nextEmail) !== normalizeEmail(oldProfile.email)) {
        await ensureUniqueProfileIdentity(client, {
          email: normalizeEmail(nextEmail),
          excludeProfileId: oldProfile.id,
        });
      }

      let updatedProfile = oldProfile;
      if (Object.keys(profilePatch).length) {
        const { data, error } = await client
          .from('profiles')
          .update(profilePatch)
          .eq('id', oldProfile.id)
          .select(USER_MANAGEMENT_PROFILE_SELECT)
          .single();
        if (error) throw error;
        updatedProfile = data;
      }

      const warnings = [];
      if (updatedProfile.auth_user_id) {
        try {
          const { data: authLookup, error: authLookupError } =
            await client.auth.admin.getUserById(updatedProfile.auth_user_id);
          if (authLookupError) throw authLookupError;
          const authPatch = {
            user_metadata: {
              ...(authLookup.user?.user_metadata || {}),
              ...profileMetadataForAuth(updatedProfile),
            },
          };
          if (
            normalizeEmail(updatedProfile.email) &&
            normalizeEmail(updatedProfile.email) !== normalizeEmail(oldProfile.email)
          ) {
            authPatch.email = normalizeEmail(updatedProfile.email);
            authPatch.email_confirm = true;
          }
          const { error: authUpdateError } = await client.auth.admin.updateUserById(
            updatedProfile.auth_user_id,
            authPatch,
          );
          if (authUpdateError) throw authUpdateError;
          const { data, error } = await client
            .from('profiles')
            .update({
              auth_provisioning_status: 'provisioned',
              auth_provisioning_error: null,
              last_profile_sync_at: new Date().toISOString(),
            })
            .eq('id', updatedProfile.id)
            .select(USER_MANAGEMENT_PROFILE_SELECT)
            .single();
          if (error) throw error;
          updatedProfile = data;
        } catch (authSyncError) {
          updatedProfile = await markProfileAuthSyncFailure(
            client,
            updatedProfile.id,
            authSyncError,
          );
          warnings.push({
            code: 'AUTH_METADATA_SYNC_FAILED',
            message: safeAuthError(authSyncError).message,
          });
        }
      }

      let hierarchy = await loadHierarchy(client, updatedProfile.employee_code);
      if (hierarchySupplied) {
        try {
          hierarchy = await saveHierarchy(
            client,
            updatedProfile.employee_code,
            body,
            request.authUser.id,
          );
        } catch (hierarchyError) {
          warnings.push({
            code: 'HIERARCHY_SYNC_FAILED',
            message: safeAuthError(hierarchyError).message,
          });
        }
      }

      await writeUserManagementAudit(client, {
        action: 'UPDATE_USER',
        targetProfile: updatedProfile,
        oldData: oldProfile,
        newData: {
          profile: updatedProfile,
          hierarchy,
        },
        metadata: { warnings },
        request,
      });
      response.json({
        ok: true,
        profile: updatedProfile,
        hierarchy,
        warnings,
      });
    } catch (error) {
      respondUserManagementError(response, error);
    }
  },
);

app.post(
  '/api/admin/users/:profileId/deactivate',
  requireSupabaseJwt,
  requireUserManagementPermission,
  async (request, response) => {
    try {
      const client = requireServiceRoleSupabase();
      await assertUserManagementFoundation(client);
      const reason = textOrNull(request.body?.reason);
      if (!reason) throw userManagementHttpError(400, 'reason is required.');
      const oldProfile = await loadProfileById(client, request.params.profileId);
      if (!oldProfile) throw userManagementHttpError(404, 'User profile not found.');
      const nowIso = new Date().toISOString();
      const { data: updatedProfile, error } = await client
        .from('profiles')
        .update({
          is_active: false,
          status: 'Inactive',
          deactivated_at: nowIso,
          deactivated_by: request.authUser.id,
          deactivation_reason: reason,
          mobile_access_enabled: false,
          web_access_enabled: false,
        })
        .eq('id', oldProfile.id)
        .select(USER_MANAGEMENT_PROFILE_SELECT)
        .single();
      if (error) throw error;

      const warnings = [];
      if (updatedProfile.auth_user_id) {
        const { error: banError } = await client.auth.admin.updateUserById(
          updatedProfile.auth_user_id,
          { ban_duration: '876000h' },
        );
        if (banError) {
          warnings.push({
            code: 'AUTH_SUSPEND_FAILED',
            message: safeAuthError(banError).message,
          });
        }
      }
      await writeUserManagementAudit(client, {
        action: 'DEACTIVATE_USER',
        targetProfile: updatedProfile,
        oldData: oldProfile,
        newData: updatedProfile,
        reason,
        metadata: {
          auth_suspended: Boolean(updatedProfile.auth_user_id) && !warnings.length,
          warnings,
        },
        request,
      });
      response.json({
        ok: true,
        profile: updatedProfile,
        warnings,
        operational_history_deleted: false,
      });
    } catch (error) {
      respondUserManagementError(response, error);
    }
  },
);

app.post(
  '/api/admin/users/:profileId/reactivate',
  requireSupabaseJwt,
  requireUserManagementPermission,
  async (request, response) => {
    try {
      const client = requireServiceRoleSupabase();
      await assertUserManagementFoundation(client);
      const reason = textOrNull(request.body?.reason);
      if (!reason) throw userManagementHttpError(400, 'reason is required.');
      const oldProfile = await loadProfileById(client, request.params.profileId);
      if (!oldProfile) throw userManagementHttpError(404, 'User profile not found.');
      const { data: updatedProfile, error } = await client
        .from('profiles')
        .update({
          is_active: true,
          status: 'Active',
          deactivated_at: null,
          deactivated_by: null,
          deactivation_reason: null,
          mobile_access_enabled: true,
          web_access_enabled: true,
        })
        .eq('id', oldProfile.id)
        .select(USER_MANAGEMENT_PROFILE_SELECT)
        .single();
      if (error) throw error;

      const warnings = [];
      if (updatedProfile.auth_user_id) {
        const { error: unbanError } = await client.auth.admin.updateUserById(
          updatedProfile.auth_user_id,
          { ban_duration: 'none' },
        );
        if (unbanError) {
          warnings.push({
            code: 'AUTH_REACTIVATE_FAILED',
            message: safeAuthError(unbanError).message,
          });
        }
      }
      await writeUserManagementAudit(client, {
        action: 'REACTIVATE_USER',
        targetProfile: updatedProfile,
        oldData: oldProfile,
        newData: updatedProfile,
        reason,
        metadata: {
          auth_reactivated: Boolean(updatedProfile.auth_user_id) && !warnings.length,
          warnings,
        },
        request,
      });
      response.json({
        ok: true,
        profile: updatedProfile,
        warnings,
      });
    } catch (error) {
      respondUserManagementError(response, error);
    }
  },
);

app.post(
  '/api/admin/users/:profileId/reset-password',
  requireSupabaseJwt,
  requireUserManagementPermission,
  async (request, response) => {
    try {
      const client = requireServiceRoleSupabase();
      await assertUserManagementFoundation(client);
      const reason = textOrNull(request.body?.reason);
      const temporaryPassword = textOrNull(request.body?.temporary_password);
      const password = temporaryPassword || textOrNull(request.body?.new_password);
      if (!reason) throw userManagementHttpError(400, 'reason is required.');
      if (!password) {
        throw userManagementHttpError(
          400,
          'new_password or temporary_password is required.',
        );
      }
      const oldProfile = await loadProfileById(client, request.params.profileId);
      if (!oldProfile) throw userManagementHttpError(404, 'User profile not found.');
      if (!oldProfile.auth_user_id) {
        throw userManagementHttpError(
          409,
          'Profile has no auth_user_id; password cannot be reset until Auth provisioning is repaired.',
        );
      }
      const requiresPasswordChange = hasOwn(request.body, 'requires_password_change')
        ? booleanValue(request.body.requires_password_change, true)
        : true;
      const { error: authError } = await client.auth.admin.updateUserById(
        oldProfile.auth_user_id,
        { password },
      );
      if (authError) throw authError;

      const { data: updatedProfile, error: profileError } = await client
        .from('profiles')
        .update({
          requires_password_change: requiresPasswordChange,
          auth_provisioning_status: 'provisioned',
          auth_provisioning_error: null,
          last_profile_sync_at: new Date().toISOString(),
        })
        .eq('id', oldProfile.id)
        .select(USER_MANAGEMENT_PROFILE_SELECT)
        .single();
      if (profileError) {
        await writeUserManagementAudit(client, {
          action: 'RESET_PASSWORD_PROFILE_SYNC_FAILED',
          targetProfile: oldProfile,
          oldData: {
            requires_password_change: oldProfile.requires_password_change,
          },
          newData: {
            requires_password_change: requiresPasswordChange,
          },
          reason,
          metadata: {
            auth_password_updated: true,
            profile_sync_error: safeAuthError(profileError),
            temporary_password_used: Boolean(temporaryPassword),
          },
          request,
        });
        throw userManagementHttpError(
          500,
          'Password was updated in Supabase Auth, but the profile password-change flag could not be synchronized.',
          { error: safeAuthError(profileError) },
        );
      }
      await writeUserManagementAudit(client, {
        action: 'RESET_PASSWORD',
        targetProfile: updatedProfile,
        oldData: {
          requires_password_change: oldProfile.requires_password_change,
        },
        newData: {
          requires_password_change: updatedProfile.requires_password_change,
        },
        reason,
        metadata: {
          temporary_password_used: Boolean(temporaryPassword),
        },
        request,
      });
      response.json({
        ok: true,
        profile_id: updatedProfile.id,
        auth_user_id: updatedProfile.auth_user_id,
        requires_password_change: updatedProfile.requires_password_change,
      });
    } catch (error) {
      respondUserManagementError(response, error);
    }
  },
);

app.get(
  '/api/admin/users/:profileId/hard-delete-preview',
  requireSupabaseJwt,
  requireUserManagementPermission,
  async (request, response) => {
    try {
      const client = requireServiceRoleSupabase();
      await assertUserManagementFoundation(client);
      const profile = await loadProfileById(client, request.params.profileId);
      if (!profile) throw userManagementHttpError(404, 'User profile not found.');
      const preview = await buildHardDeletePreview(client, profile);
      response.json({ ok: true, ...preview });
    } catch (error) {
      respondUserManagementError(response, error);
    }
  },
);

app.delete(
  '/api/admin/users/:profileId/hard-delete',
  requireSupabaseJwt,
  requireUserManagementPermission,
  async (request, response) => {
    try {
      const client = requireServiceRoleSupabase();
      await assertUserManagementFoundation(client);
      const reason = textOrNull(request.body?.reason);
      const confirmationText = String(request.body?.confirmation_text || '');
      if (!reason) throw userManagementHttpError(400, 'reason is required.');
      if (confirmationText !== 'HARD DELETE TEST USER') {
        throw userManagementHttpError(
          400,
          'confirmation_text must exactly equal HARD DELETE TEST USER.',
        );
      }
      const profile = await loadProfileById(client, request.params.profileId);
      if (!profile) throw userManagementHttpError(404, 'User profile not found.');
      if (String(profile.auth_user_id || '') === String(request.authUser.id || '')) {
        throw userManagementHttpError(
          409,
          'You cannot hard delete your own authenticated profile.',
        );
      }
      const preview = await buildHardDeletePreview(client, profile);
      if (!preview.hard_delete_allowed) {
        const hierarchyBlocked = preview.has_important_hierarchy_reference === true;
        throw userManagementHttpError(
          409,
          preview.has_meaningful_history
            ? 'User has attendance/site visit/GPS/store history. Please deactivate instead.'
            : 'User is referenced in employee hierarchy. Reassign hierarchy references before hard delete.',
          {
            blocked_reason: hierarchyBlocked
              ? 'important_hierarchy_reference_exists'
              : 'meaningful_business_history_exists',
            preview,
          },
        );
      }

      await writeUserManagementAudit(client, {
        action: 'HARD_DELETE_USER_REQUESTED',
        targetProfile: profile,
        oldData: profile,
        reason,
        metadata: {
          confirmation_text_verified: true,
          preview,
          business_history_deleted: false,
        },
        request,
      });

      let authDeleted = false;
      let authAlreadyMissing = false;
      if (profile.auth_user_id) {
        const { error: authDeleteError } = await client.auth.admin.deleteUser(
          profile.auth_user_id,
          false,
        );
        if (authDeleteError && !isAuthUserNotFoundError(authDeleteError)) {
          throw userManagementHttpError(
            502,
            'Supabase Auth user deletion failed. Profile and hierarchy were not deleted.',
            { auth_error: safeAuthError(authDeleteError) },
          );
        }
        authDeleted = !authDeleteError;
        authAlreadyMissing = Boolean(authDeleteError);
      }

      const employeeCode = normalizeEmployeeCode(profile.employee_code);
      let hierarchyDeletedCount = 0;
      if (employeeCode) {
        const { data: deletedHierarchy, error: hierarchyDeleteError } = await client
          .from('employee_hierarchy')
          .delete()
          .ilike('employee_code', employeeCode)
          .select('id');
        if (hierarchyDeleteError) {
          throw userManagementHttpError(
            500,
            'Auth user was removed or already missing, but hierarchy deletion failed. Profile was retained.',
            {
              auth_deleted: authDeleted,
              auth_already_missing: authAlreadyMissing,
              hierarchy_error: safeAuthError(hierarchyDeleteError),
            },
          );
        }
        hierarchyDeletedCount = deletedHierarchy?.length || 0;
      }

      const { data: deletedProfiles, error: profileDeleteError } = await client
        .from('profiles')
        .delete()
        .eq('id', profile.id)
        .select('id');
      if (profileDeleteError) {
        throw userManagementHttpError(
          500,
          'Profile deletion failed after Auth/hierarchy processing. No business history was deleted.',
          {
            auth_deleted: authDeleted,
            auth_already_missing: authAlreadyMissing,
            hierarchy_deleted_count: hierarchyDeletedCount,
            profile_error: safeAuthError(profileDeleteError),
          },
        );
      }
      const profileDeleted = (deletedProfiles?.length || 0) === 1;
      if (profileDeleted) {
        await writeUserManagementAudit(client, {
          action: 'HARD_DELETE_USER_COMPLETED',
          targetProfile: profile,
          oldData: profile,
          reason,
          metadata: {
            auth_deleted: authDeleted,
            auth_already_missing: authAlreadyMissing,
            hierarchy_deleted_count: hierarchyDeletedCount,
            profile_deleted: true,
            business_history_deleted: false,
          },
          request,
        });
      }
      response.json({
        ok: profileDeleted,
        auth_deleted: authDeleted,
        auth_already_missing: authAlreadyMissing,
        hierarchy_deleted_count: hierarchyDeletedCount,
        profile_deleted: profileDeleted,
        business_history_deleted: false,
      });
    } catch (error) {
      respondUserManagementError(response, error);
    }
  },
);

app.post(
  '/api/admin/users/:profileId/repair-employee-code-preview',
  requireSupabaseJwt,
  requireUserManagementPermission,
  async (request, response) => {
    try {
      const client = requireServiceRoleSupabase();
      await assertUserManagementFoundation(client);
      const { preview } = await prepareEmployeeCodeRepairPreview(
        client,
        request.params.profileId,
        request.body || {},
      );
      response.json({ ok: true, ...preview });
    } catch (error) {
      respondUserManagementError(response, error);
    }
  },
);

app.post(
  '/api/admin/users/:profileId/repair-employee-code',
  requireSupabaseJwt,
  requireUserManagementPermission,
  async (request, response) => {
    try {
      const client = requireServiceRoleSupabase();
      await assertUserManagementFoundation(client);
      const confirmationText = String(request.body?.confirmation_text || '');
      if (confirmationText !== 'REPAIR EMPLOYEE CODE') {
        throw userManagementHttpError(
          400,
          'confirmation_text must exactly equal REPAIR EMPLOYEE CODE.',
        );
      }
      const {
        profile,
        preview,
        reason,
        oldEmployeeCode,
        newEmployeeCode,
      } = await prepareEmployeeCodeRepairPreview(
        client,
        request.params.profileId,
        request.body || {},
      );
      if (!preview.repair_allowed) {
        throw userManagementHttpError(409, 'Employee-code repair is not allowed.');
      }

      const { data: repairCapabilities, error: capabilitiesError } = await client.rpc(
        'admin_employee_code_repair_capabilities',
      );
      if (
        capabilitiesError ||
        Number(repairCapabilities?.version || 0) < 2 ||
        repairCapabilities?.updates_confirmed_aliases !== true
      ) {
        throw userManagementHttpError(
          503,
          'Employee-code alias repair support is unavailable. Apply supabase/migrations_2_0/011_admin_employee_code_repair_aliases.sql and retry.',
        );
      }

      const { data: repairResult, error: repairError } = await client.rpc(
        'admin_repair_employee_code',
        {
          p_profile_id: profile.id,
          p_old_employee_code: oldEmployeeCode,
          p_new_employee_code: newEmployeeCode,
          p_reason: reason,
          p_actor_auth_user_id: request.authUser.id,
          p_actor_profile_id: request.profile.id,
          p_actor_employee_code: request.employeeCode,
          p_actor_role: request.userRole,
        },
      );
      if (repairError) {
        if (
          ['42883', 'PGRST202'].includes(repairError.code) ||
          /admin_repair_employee_code/i.test(String(repairError.message || ''))
        ) {
          throw userManagementHttpError(
            503,
            'Employee-code repair RPC is unavailable. Apply supabase/migrations_2_0/010_admin_employee_code_repair.sql and retry.',
          );
        }
        throw repairError;
      }

      let updatedProfile = await loadProfileById(client, profile.id);
      const warnings = [];
      if (updatedProfile?.auth_user_id) {
        try {
          const { data: authLookup, error: authLookupError } =
            await client.auth.admin.getUserById(updatedProfile.auth_user_id);
          if (authLookupError) throw authLookupError;
          const { error: authUpdateError } = await client.auth.admin.updateUserById(
            updatedProfile.auth_user_id,
            {
              user_metadata: {
                ...(authLookup.user?.user_metadata || {}),
                ...profileMetadataForAuth(updatedProfile),
                employee_code: newEmployeeCode,
              },
            },
          );
          if (authUpdateError) throw authUpdateError;
          const { data, error: profileSyncError } = await client
            .from('profiles')
            .update({
              auth_provisioning_status: 'provisioned',
              auth_provisioning_error: null,
              last_profile_sync_at: new Date().toISOString(),
            })
            .eq('id', updatedProfile.id)
            .select(USER_MANAGEMENT_PROFILE_SELECT)
            .single();
          if (profileSyncError) throw profileSyncError;
          updatedProfile = data;
        } catch (authSyncError) {
          updatedProfile = await markProfileAuthSyncFailure(
            client,
            profile.id,
            authSyncError,
          );
          const warning = {
            code: 'AUTH_METADATA_SYNC_FAILED',
            message: safeAuthError(authSyncError).message,
          };
          warnings.push(warning);
          await writeUserManagementAudit(client, {
            action: 'REPAIR_EMPLOYEE_CODE_AUTH_SYNC_FAILED',
            targetProfile: updatedProfile,
            oldData: { employee_code: oldEmployeeCode },
            newData: { employee_code: newEmployeeCode },
            reason,
            metadata: {
              warning,
              database_repair_completed: true,
            },
            request,
          });
        }
      }

      response.json({
        ok: true,
        profile: updatedProfile,
        old_employee_code: oldEmployeeCode,
        new_employee_code: newEmployeeCode,
        affected_counts: repairResult?.affected_counts || {},
        rpc_result: repairResult,
        warnings,
      });
    } catch (error) {
      respondUserManagementError(response, error);
    }
  },
);

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
      const today = currentIndiaDateInput();
      const currentAttendance = await loadCurrentActiveAttendance(
        client,
        [visit.fo_user_id, visit.employee_code],
        today,
      );
      if (!currentAttendance) {
        response.status(409).json({ ok: false, message: 'No current active attendance found for this FO.' });
        return;
      }
      const visitAttendanceId = String(visit.attendance_id || '');
      if (visitAttendanceId && visitAttendanceId !== String(currentAttendance.id || '')) {
        response.status(409).json({ ok: false, message: 'Site visit does not belong to the current active attendance.' });
        return;
      }
      if (!visitAttendanceId && currentIndiaDateInput(new Date(visit.check_in_time || 0)) !== today) {
        response.status(409).json({ ok: false, message: 'Site visit is not from the current attendance date.' });
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

async function runFoStaleSessionCleanup(reason = 'scheduled') {
  try {
    const client = requireServiceRoleSupabase();
    const result = await cleanupStaleFoSessions(client);
    console.log('[myQPMS FO stale cleanup] run complete', {
      reason,
      indiaDate: result.indiaDate,
      attendanceRowsFound: result.attendanceRowsFound,
      visitsClosed: result.visitsClosed,
      attendanceClosed: result.attendanceClosed,
      liveStatusesReset: result.liveStatusesReset,
      skippedBecauseTodayAttendanceExists: result.skippedBecauseTodayAttendanceExists,
      errors: result.errors?.length || 0,
      skipped: result.skipped,
    });
    return result;
  } catch (error) {
    console.warn('[myQPMS FO stale cleanup] run failed', {
      reason,
      message: error.message,
      code: error.code,
    });
    return { ok: false, message: error.message, code: error.code };
  }
}

app.post(
  '/api/fo/stale-sessions/cleanup',
  requireApiAuth,
  requireRoles(['Admin', 'MD', 'COO', 'GM / Top Management', 'Existing Business Operations Team']),
  async (request, response) => {
    const result = await runFoStaleSessionCleanup('manual_endpoint');
    response.status(result.ok === false && !result.skipped ? 500 : 200).json(result);
  },
);

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
  runFoStaleSessionCleanup('startup');
  if (Number.isFinite(FO_STALE_CLEANUP_INTERVAL_MS) && FO_STALE_CLEANUP_INTERVAL_MS > 0) {
    setInterval(() => {
      runFoStaleSessionCleanup('interval');
    }, FO_STALE_CLEANUP_INTERVAL_MS).unref?.();
  }
});
