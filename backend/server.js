import cors from 'cors';
import { randomUUID } from 'node:crypto';
import dotenv from 'dotenv';
import express from 'express';
import nodemailer from 'nodemailer';
import { createClient } from '@supabase/supabase-js';
import {
  createHospitalFeedbackQrRouter,
  createPublicHospitalFeedbackQrRouter,
} from './routes/hospitalFeedbackQrRoutes.js';
import { createHospitalTicketRouter } from './routes/hospitalTicketRoutes.js';
import {
  runHospitalSlaWorker,
  startHospitalSlaScheduler,
} from './services/hospitalTicketSlaService.js';
import {
  auditDelayedCheckoutMissingKmForVisit,
  decideMissingKmReview,
  refreshMissingKmReviewsForAttendance,
  recalculateFullDayGpsNoSiteVisitKm,
  recalculateFoKm,
  recalculateFoKmBatch,
  recalculateFoKmForToday,
  recalculateSwitchModeKmTemporary,
} from './foKmRecalculationService.js';
import { authorizeFoKmRecalculation } from './services/foKmRecalculationAuthorizationService.js';
import {
  cleanupStaleFoSessions,
  cleanupStaleLiveStatusReferences,
} from './foStaleSessionCleanupService.js';
import {
  normalizeReportState,
  previousReportDate,
  sendDailyOperationsReports,
} from './services/dailyOperationsReportService.js';
import {
  createSiteVisitUserClient,
  executeSiteVisitWorkflowOperation,
  loadSiteVisitWorkflowData,
  siteVisitWorkflowOperations,
} from './services/siteVisitWorkflowService.js';
import { isSiteVisitWorkflowEnabled } from './services/siteVisitFeatureFlag.js';
import {
  accessResponseForClient,
  resolveCurrentUserAccess,
} from './services/accessControlService.js';
import {
  getWebHospitalTicketDetail,
  hospitalWebAccessResponse,
  listWebHospitalTickets,
  resolveHospitalWebAccess,
  summarizeWebHospitalTickets,
} from './services/hospitalTicketWebDashboardService.js';
import {
  getDemoAccessScope,
  isDemoUser,
  isReadOnlyUser,
  rejectReadOnlyDemoRequest,
  sanitizeDemoRecord,
} from './services/demoAccessService.js';
import {
  buildOperationsSummary,
  normalizeOperationsSummaryFilters,
} from './services/operationsSummaryService.js';
import {
  buildConsolidatedTravelClaimPdf,
} from './services/consolidatedTravelClaimPdfService.js';
import {
  loadAuthorizedEmployeeRange,
  recalculateEmployeeRange,
} from './services/employeeRangeReportService.js';
import {
  canAccessLeadModule,
  canAssignLead,
  canCreateLead,
  canEditLead,
  canManageLeadMom,
  canViewLead,
  cleanText,
  findDuplicateLeads,
  isActiveLeadProfile,
  leadMomContactRecipients,
  leadActor,
  leadListResponse,
  leadResponse,
  loadLeadRelations,
  normalizeLeadPayload,
  resolveAssignee,
  safeLeadAssignees,
  safeLeadMomSender,
  validateLeadPayload,
} from './services/leadManagementService.js';
import {
  createPostmanTestResetHandler,
  registerPostmanTestResetRoute,
} from './services/postmanTestResetService.js';
import {
  USER_MANAGEMENT_PROFILE_SELECT,
  assertUserManagementFoundation,
  attachOperationalCounts,
  booleanValue,
  buildEmployeeCodeRepairPreview,
  buildHardDeletePreview,
  canonicalProfileRole,
  hasOwn,
  hierarchyPayloadFromBody,
  loadHierarchy,
  loadHierarchyGraph,
  loadOperationalCounts,
  loadProfileById,
  normalizeEmail,
  normalizeEmployeeCode,
  profileMetadataForAuth,
  safeAuthError,
  sanitizeSupabaseDiagnosticError,
  sanitizeAuditData,
  saveHierarchy,
  saveHierarchyAssignments,
  serviceRoleClientNotConfiguredError,
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
  { id: 'admin', name: 'Admin', email: 'admin@qpms.co.in', password: '123456', role: 'DEMO_ADMIN', isDemoReadOnly: true, is_demo: true, read_only: true },
];

const apiSessions = new Map();
const foKmRecalculationLocks = new Set();
const foKmRecalculateAllLocks = new Set();
const foEmployeeRangeRecalculationLocks = new Set();
const FO_KM_RECALCULATION_RUNNING_MESSAGE = 'Recalculation already running. Please wait.';
const configuredFoKmRecalculationLockTtlMs = Number(process.env.FO_KM_RECALCULATION_LOCK_TTL_MS);
const FO_KM_RECALCULATION_LOCK_TTL_MS =
  Number.isFinite(configuredFoKmRecalculationLockTtlMs) && configuredFoKmRecalculationLockTtlMs > 0
    ? configuredFoKmRecalculationLockTtlMs
    : 15 * 60 * 1000;
const foKmRecalculationLockStartedAt = new Map();
const foKmRecalculateAllLockStartedAt = new Map();
const FO_STALE_CLEANUP_INTERVAL_MS = Number(process.env.FO_STALE_CLEANUP_INTERVAL_MS || 30 * 60 * 1000);
const END_DAY_KM_AUTO_RECALC_INTERVAL_MS = 5 * 60 * 1000;
const END_DAY_KM_AUTO_RECALC_LIMIT = 50;

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
  pruneStaleFoKmRecalculationLocks();
  const suffix = `|${date}`;
  for (const key of foKmRecalculationLocks) {
    if (key.endsWith(suffix)) return true;
  }
  return false;
}

function pruneStaleLockSet(lockSet, startedAtMap, label) {
  const now = Date.now();
  for (const key of lockSet) {
    const startedAt = startedAtMap.get(key);
    if (Number.isFinite(startedAt) && now - startedAt > FO_KM_RECALCULATION_LOCK_TTL_MS) {
      lockSet.delete(key);
      startedAtMap.delete(key);
      console.warn('FO_KM_RECALCULATION_STALE_LOCK_CLEARED', {
        label,
        key,
        ageMs: now - startedAt,
        ttlMs: FO_KM_RECALCULATION_LOCK_TTL_MS,
      });
    }
  }
}

function pruneStaleFoKmRecalculationLocks() {
  pruneStaleLockSet(foKmRecalculationLocks, foKmRecalculationLockStartedAt, 'single');
  pruneStaleLockSet(foKmRecalculateAllLocks, foKmRecalculateAllLockStartedAt, 'batch');
}

function addFoKmRecalculationLock(lockKey) {
  foKmRecalculationLocks.add(lockKey);
  foKmRecalculationLockStartedAt.set(lockKey, Date.now());
}

function releaseFoKmRecalculationLock(lockKey) {
  foKmRecalculationLocks.delete(lockKey);
  foKmRecalculationLockStartedAt.delete(lockKey);
}

function addFoKmRecalculateAllLock(lockKey) {
  foKmRecalculateAllLocks.add(lockKey);
  foKmRecalculateAllLockStartedAt.set(lockKey, Date.now());
}

function releaseFoKmRecalculateAllLock(lockKey) {
  foKmRecalculateAllLocks.delete(lockKey);
  foKmRecalculateAllLockStartedAt.delete(lockKey);
}

function normalizeSupabaseUrl(url) {
  return String(url || '').replace(/\/rest\/v1\/?$/, '').replace(/\/$/, '');
}

const supabaseUrl = normalizeSupabaseUrl(process.env.SUPABASE_URL);
const supabaseAnonKey = String(process.env.SUPABASE_ANON_KEY || '').trim();
const supabaseServiceRoleKey = String(process.env.SUPABASE_SERVICE_ROLE_KEY || '').trim();
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
  urlHostname: null,
  projectRef: null,
  anonKeyPresent: Boolean(supabaseAnonKey),
  anonKeyLength: String(supabaseAnonKey || '').length,
  serviceRoleKeyPresent: Boolean(supabaseServiceRoleKey),
  serviceRoleKeyLength: String(supabaseServiceRoleKey || '').length,
  serviceRoleClientConfigured: Boolean(serviceRoleSupabase),
};

app.post(
  '/api/hospital-tickets/admin/run-sla',
  requireSupabaseJwt,
  async (request, response) => {
    const role = String(request.profile?.role || '')
      .toUpperCase()
      .replace(/[^A-Z0-9]+/g, '');
    if (!['ADMIN', 'QPMSADMIN', 'DEVELOPER', 'DEV'].includes(role)) {
      response.status(403).json({
        ok: false,
        code: 'sla_admin_denied',
        message: 'Admin or Developer permission is required.',
      });
      return;
    }
    try {
      const allowTestTime = String(process.env.NODE_ENV || '').toLowerCase() !== 'production';
      const requestedTime = allowTestTime && request.body?.now
        ? new Date(request.body.now)
        : new Date();
      if (Number.isNaN(requestedTime.getTime())) {
        response.status(400).json({ ok: false, message: 'Invalid SLA test time.' });
        return;
      }
      response.json({
        ok: true,
        result: await runHospitalSlaWorker(serviceRoleSupabase, {
          now: requestedTime,
        }),
      });
    } catch {
      response.status(500).json({
        ok: false,
        code: 'hospital_sla_run_failed',
        message: 'Hospital SLA processing failed.',
      });
    }
  },
);

app.use(
  '/api/public/hospital-feedback',
  createPublicHospitalFeedbackQrRouter({
    serviceClient: serviceRoleSupabase,
    environment: process.env,
  }),
);

app.use(
  '/api/hospital-feedback',
  createHospitalFeedbackQrRouter({
    serviceClient: serviceRoleSupabase,
    requireAuth: requireSupabaseJwt,
    environment: process.env,
  }),
);

app.use(
  '/api/hospital-tickets',
  createHospitalTicketRouter({
    anonClient: supabaseAnon,
    serviceClient: serviceRoleSupabase,
    environment: process.env,
  }),
);

startHospitalSlaScheduler(serviceRoleSupabase, process.env);

try {
  const parsedSupabaseUrl = new URL(supabaseUrl);
  supabaseConfigStatus.urlHostname = parsedSupabaseUrl.hostname || null;
  supabaseConfigStatus.projectRef =
    parsedSupabaseUrl.hostname?.endsWith('.supabase.co')
      ? parsedSupabaseUrl.hostname.split('.')[0] || null
      : null;
} catch {
  // Invalid or absent URLs are represented only by the safe null fields above.
}

function safeSupabaseConfigDiagnostics() {
  return {
    supabaseUrlPresent: supabaseConfigStatus.urlPresent,
    supabaseUrlHostname: supabaseConfigStatus.urlHostname,
    supabaseProjectRef: supabaseConfigStatus.projectRef,
    supabaseAnonKeyPresent: supabaseConfigStatus.anonKeyPresent,
    supabaseAnonKeyLength: supabaseConfigStatus.anonKeyLength,
    supabaseServiceRoleKeyPresent: supabaseConfigStatus.serviceRoleKeyPresent,
    supabaseServiceRoleKeyLength: supabaseConfigStatus.serviceRoleKeyLength,
    serviceRoleClientConfigured: supabaseConfigStatus.serviceRoleClientConfigured,
  };
}

function serviceRoleConfigurationReason() {
  if (!supabaseConfigStatus.urlPresent) return 'missing_url';
  if (!supabaseConfigStatus.anonKeyPresent) return 'missing_anon_key';
  if (!supabaseConfigStatus.serviceRoleKeyPresent) return 'missing_service_role_key';
  if (!supabaseConfigStatus.serviceRoleClientConfigured) {
    return 'service_role_client_not_initialized';
  }
  return null;
}

async function testServiceRoleAuthAdmin(client = serviceRoleSupabase) {
  const configurationReason = serviceRoleConfigurationReason();
  if (configurationReason || !client) {
    return {
      success: false,
      reason: configurationReason || 'service_role_client_not_initialized',
      error: null,
    };
  }
  try {
    const { error } = await client.auth.admin.listUsers({ page: 1, perPage: 1 });
    if (error) throw error;
    return { success: true, reason: null, error: null };
  } catch (error) {
    return {
      success: false,
      reason: 'service_role_auth_admin_failed',
      error: sanitizeSupabaseDiagnosticError(error),
    };
  }
}

async function assertServiceRoleAuthAdminAccess(client) {
  const result = await testServiceRoleAuthAdmin(client);
  if (result.success) return;
  const error = new Error(
    result.error?.message || 'Supabase service-role Auth Admin access is unavailable.',
  );
  error.statusCode = 503;
  error.code = result.reason;
  error.diagnosticReason = result.reason;
  throw error;
}

async function testServiceRoleTableAccess(table) {
  if (!serviceRoleSupabase) {
    return {
      success: false,
      reason: serviceRoleConfigurationReason() || 'service_role_client_not_initialized',
      error: null,
    };
  }
  const { error } = await serviceRoleSupabase
    .from(table)
    .select('id')
    .limit(1);
  if (!error) return { success: true, reason: null, error: null };
  return {
    success: false,
    reason:
      error.code === '42501'
        ? 'service_role_database_access_failed'
        : 'service_role_table_test_failed',
    error: sanitizeSupabaseDiagnosticError(error),
  };
}

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

function createToken(user) {
  const token = `qpms-demo-${user.id}-${randomUUID()}`;
  apiSessions.set(token, user);
  return token;
}

function getBearerToken(request) {
  return String(request.headers.authorization || '').replace(/^Bearer\s+/i, '').trim();
}

function isDemoReadOnlyIdentity(identity = {}, authUser = {}) {
  return isReadOnlyUser(identity, authUser);
}

function blockDemoReadOnlyMutation(request, response, identity = {}, authUser = {}) {
  return rejectReadOnlyDemoRequest(request, response, identity, authUser);
}

function requireApiAuth(request, response, next) {
  const token = getBearerToken(request);
  const user = apiSessions.get(token);
  if (!user) {
    response.status(401).json({ ok: false, message: 'Valid Bearer token required. Login with /api/auth/login first.' });
    return;
  }
  request.apiUser = user;
  if (blockDemoReadOnlyMutation(request, response, user)) return;
  next();
}

function requireSupabaseJwtOrDemoApiRead(request, response, next) {
  const token = getBearerToken(request);
  const apiUser = apiSessions.get(token);
  if (apiUser) {
    if (!isDemoReadOnlyIdentity(apiUser)) {
      response.status(403).json({ ok: false, message: 'Supabase Bearer token required.' });
      return;
    }
    if (blockDemoReadOnlyMutation(request, response, apiUser)) return;
    request.apiUser = apiUser;
    request.profile = {
      id: apiUser.profileId || apiUser.id || 'demo-read-only-admin',
      auth_user_id: null,
      email: apiUser.email || apiUser.username || null,
      username: apiUser.username || apiUser.email || null,
      full_name: apiUser.name || 'QPMS Demo Admin',
      display_name: apiUser.name || 'QPMS Demo Admin',
      role: apiUser.rawRole || apiUser.role || 'DEMO_ADMIN',
      is_active: true,
      status: 'Active',
      web_access_enabled: true,
      is_demo: true,
      read_only: true,
      metadata: {
        ...(apiUser.metadata || {}),
        ...getDemoAccessScope(apiUser),
      },
    };
    request.employeeCode = null;
    request.userRole = request.profile.role;
    next();
    return;
  }
  requireSupabaseJwt(request, response, next);
}

async function requireSupabaseJwt(request, response, next) {
  const authorizationHeader = String(request.headers.authorization || '').trim();
  const accessToken = getBearerToken(request);
  const isFaultTrackerRequest = String(request.path || '').startsWith('/api/fault-tracker');
  if (isFaultTrackerRequest) {
    const [authorizationScheme = ''] = authorizationHeader.split(/\s+/, 1);
    console.log('[Fault Tracker] auth header diagnostic', {
      path: request.path,
      hasAuthorizationHeader: Boolean(authorizationHeader),
      authorizationScheme: authorizationScheme || 'missing',
      tokenLength: accessToken ? accessToken.length : 0,
    });
  }
  if (!accessToken) {
    response.status(401).json({ ok: false, message: 'Supabase Bearer token required.' });
    return;
  }
  if (!supabaseAnon) {
    response.status(503).json({
      ok: false,
      message: 'Supabase JWT verification is not configured on the API server.',
      diagnosticReason: serviceRoleConfigurationReason(),
    });
    return;
  }

  try {
    const { data: authData, error: authError } = await supabaseAnon.auth.getUser(accessToken);
    if (authError || !authData?.user) {
      if (isFaultTrackerRequest) {
        console.warn('[Fault Tracker] auth token verification failed', {
          path: request.path,
          code: authError?.code || null,
          message: authError?.message || null,
        });
      }
      response.status(401).json({ ok: false, message: 'Invalid or expired Supabase access token.' });
      return;
    }

    // The JWT is verified above with Supabase Auth. Resolve only that verified
    // user's profile with the backend service role so admin authorization does
    // not depend on frontend-facing profiles RLS.
    const adminClient = requireServiceRoleSupabase();
    if (!isFaultTrackerRequest) {
      await assertServiceRoleAuthAdminAccess(adminClient);
    } else {
      console.log('[Fault Tracker] auth token verified; resolving profile with service-role database access', {
        path: request.path,
        auth_user_id: authData.user.id,
      });
    }
    const { data: profile, error: profileError } = await adminClient
      .from('profiles')
      .select('*')
      .eq('auth_user_id', authData.user.id)
      .maybeSingle();
    if (profileError) {
      if (isFaultTrackerRequest) {
        console.error('[Fault Tracker] service-role profile lookup failed', {
          path: request.path,
          auth_user_id: authData.user.id,
          code: profileError.code || null,
          message: profileError.message || null,
          details: profileError.details || null,
        });
      }
      const configurationError = new Error(
        'Backend service-role profile lookup failed.',
      );
      configurationError.statusCode = 503;
      configurationError.code = 'service_role_profile_lookup_failed';
      configurationError.diagnosticReason = 'service_role_profile_lookup_failed';
      throw configurationError;
    }
    if (!profile) {
      if (isFaultTrackerRequest) {
        console.warn('[Fault Tracker] authenticated profile not found', {
          path: request.path,
          auth_user_id: authData.user.id,
        });
      }
      response.status(403).json({ ok: false, message: 'Authenticated user profile was not found.' });
      return;
    }

    request.authUser = authData.user;
    request.profile = profile;
    request.employeeCode = String(profile.employee_code || '').trim() || null;
    request.userRole = String(profile.role || '').trim();
    if (blockDemoReadOnlyMutation(request, response, profile, authData.user)) return;
    next();
  } catch (error) {
    const safeError = sanitizeSupabaseDiagnosticError(error);
    console.warn('[myQPMS Auth] Supabase JWT verification failed', {
      message: safeError.message,
      code: safeError.code,
    });
    response.status(error.statusCode || 401).json({
      ok: false,
      message: error.statusCode === 503
        ? error.message
        : 'Unable to verify Supabase access token.',
      ...(error.statusCode === 503 && error.diagnosticReason
        ? { diagnosticReason: error.diagnosticReason }
        : {}),
    });
  }
}

async function requireSupabaseJwtAllowMissingProfile(request, response, next) {
  const accessToken = getBearerToken(request);
  if (!accessToken) {
    response.status(401).json({ ok: false, message: 'Supabase Bearer token required.' });
    return;
  }
  if (!supabaseAnon) {
    response.status(503).json({
      ok: false,
      message: 'Supabase JWT verification is not configured on the API server.',
      diagnosticReason: serviceRoleConfigurationReason(),
    });
    return;
  }

  try {
    const { data: authData, error: authError } = await supabaseAnon.auth.getUser(accessToken);
    if (authError || !authData?.user) {
      response.status(401).json({ ok: false, message: 'Invalid or expired Supabase access token.' });
      return;
    }

    const adminClient = requireServiceRoleSupabase();
    await assertServiceRoleAuthAdminAccess(adminClient);
    const { data: profile, error: profileError } = await adminClient
      .from('profiles')
      .select('*')
      .eq('auth_user_id', authData.user.id)
      .maybeSingle();
    if (profileError) {
      const configurationError = new Error('Backend service-role profile lookup failed.');
      configurationError.statusCode = 503;
      configurationError.code = 'service_role_profile_lookup_failed';
      configurationError.diagnosticReason = 'service_role_profile_lookup_failed';
      throw configurationError;
    }

    request.authUser = authData.user;
    request.profile = profile || null;
    request.employeeCode = profile ? String(profile.employee_code || '').trim() || null : null;
    request.userRole = profile ? String(profile.role || '').trim() : '';
    if (profile && blockDemoReadOnlyMutation(request, response, profile, authData.user)) return;
    next();
  } catch (error) {
    const safeError = sanitizeSupabaseDiagnosticError(error);
    console.warn('[myQPMS Access] Supabase JWT verification failed', {
      message: safeError.message,
      code: safeError.code,
    });
    response.status(error.statusCode || 401).json({
      ok: false,
      message: error.statusCode === 503
        ? error.message
        : 'Unable to verify Supabase access token.',
      ...(error.statusCode === 503 && error.diagnosticReason
        ? { diagnosticReason: error.diagnosticReason }
        : {}),
    });
  }
}

async function requireSupabaseJwtWithUserScopedProfile(request, response, next) {
  const accessToken = getBearerToken(request);
  if (!accessToken) {
    response.status(401).json({ ok: false, message: 'Supabase Bearer token required.' });
    return;
  }
  if (!supabaseAnon || !supabaseUrl || !supabaseAnonKey) {
    response.status(503).json({
      ok: false,
      message: 'Supabase JWT verification is not configured on the API server.',
      diagnosticReason: serviceRoleConfigurationReason(),
    });
    return;
  }

  try {
    const { data: authData, error: authError } = await supabaseAnon.auth.getUser(accessToken);
    if (authError || !authData?.user) {
      response.status(401).json({ ok: false, message: 'Invalid or expired Supabase access token.' });
      return;
    }
    const userScopedSupabase = createClient(supabaseUrl, supabaseAnonKey, {
      global: {
        headers: {
          Authorization: `Bearer ${accessToken}`,
        },
      },
      auth: {
        persistSession: false,
        autoRefreshToken: false,
      },
    });
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
    if (blockDemoReadOnlyMutation(request, response, profile, authData.user)) return;
    next();
  } catch (error) {
    console.warn('[myQPMS diagnostics auth] User-scoped profile lookup failed', {
      message: sanitizeSupabaseDiagnosticError(error).message,
      code: error.code || null,
    });
    response.status(403).json({
      ok: false,
      message: 'Unable to verify User Management permission for diagnostics.',
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

function requirePostmanTestResetAdmin(request, response, next) {
  if (normalizePermissionRole(request.profile?.role) !== 'ADMIN') {
    response.status(403).json({
      ok: false,
      message: 'Admin permission is required.',
    });
    return;
  }
  next();
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

function hasDailyReportPermission(profile) {
  if (!profile || profile.is_active !== true) return false;
  if (String(profile.status || '').trim().toLowerCase() !== 'active') return false;
  return new Set(['ADMIN', 'MD', 'COO']).has(normalizePermissionRole(profile.role));
}

function requireDailyReportPermission(request, response, next) {
  if (!hasDailyReportPermission(request.profile)) {
    response.status(403).json({
      ok: false,
      message: `Role ${request.userRole || 'Unknown'} cannot send Daily Operations reports.`,
    });
    return;
  }
  next();
}

function hasFoKmBatchRecalculationPermission(profile) {
  if (!profile || profile.is_active !== true) return false;
  if (String(profile.status || '').trim().toLowerCase() !== 'active') return false;
  return new Set(['ADMIN', 'QPMSADMIN', 'DEVELOPER', 'MD', 'COO']).has(
    normalizePermissionRole(profile.role),
  );
}

function requireFoKmBatchRecalculationPermission(request, response, next) {
  if (!hasFoKmBatchRecalculationPermission(request.profile)) {
    response.status(403).json({
      ok: false,
      message: `Role ${request.userRole || 'Unknown'} cannot run batch KM recalculation.`,
    });
    return;
  }
  next();
}

function hasTemporarySwitchKmPermission(profile) {
  if (!profile || profile.is_active !== true) return false;
  if (String(profile.status || '').trim().toLowerCase() !== 'active') return false;
  return new Set(['ADMIN', 'QPMSADMIN', 'DEVELOPER']).has(
    normalizePermissionRole(profile.role),
  );
}

function requireTemporarySwitchKmPermission(request, response, next) {
  if (!hasTemporarySwitchKmPermission(request.profile)) {
    response.status(403).json({
      ok: false,
      message: `Role ${request.userRole || 'Unknown'} cannot run temporary switch KM recalculation.`,
    });
    return;
  }
  next();
}

function hasFullDayGpsKmPermission(profile) {
  if (!profile || profile.is_active !== true) return false;
  if (String(profile.status || '').trim().toLowerCase() !== 'active') return false;
  return new Set(['ADMIN', 'QPMSADMIN', 'DEVELOPER']).has(
    normalizePermissionRole(profile.role),
  );
}

function requireFullDayGpsKmPermission(request, response, next) {
  if (!hasFullDayGpsKmPermission(request.profile)) {
    response.status(403).json({
      ok: false,
      message: `Role ${request.userRole || 'Unknown'} cannot run full-day GPS KM recalculation.`,
    });
    return;
  }
  next();
}

function hasCheckoutMissingKmReviewPermission(profile) {
  if (!profile || profile.is_active !== true) return false;
  if (String(profile.status || '').trim().toLowerCase() !== 'active') return false;
  return new Set([
    'ADMIN',
    'QPMSADMIN',
    'DEVELOPER',
    'OPERATIONS_MANAGER',
    'OPERATIONS MANAGER',
    'BRANCH_HEAD',
    'BRANCH HEAD',
    'MANAGEMENT',
  ]).has(
    normalizePermissionRole(profile.role),
  );
}

function requireCheckoutMissingKmReviewPermission(request, response, next) {
  if (!hasCheckoutMissingKmReviewPermission(request.profile)) {
    response.status(403).json({
      ok: false,
      message: `Role ${request.userRole || 'Unknown'} cannot approve delayed checkout KM.`,
    });
    return;
  }
  next();
}

const STORE_MASTER_SELECT = [
  'id',
  'store_name',
  'client_name',
  'store_code',
  'state',
  'business',
  'latitude',
  'longitude',
  'gps_accuracy',
  'created_by_employee_code',
  'created_by_full_name',
  'attendance_id',
  'captured_at',
  'status',
  'metadata',
  'created_at',
  'updated_at',
].join(', ');

const STORE_MASTER_EDITABLE_FIELDS = [
  'store_name',
  'client_name',
  'store_code',
  'state',
  'business',
  'latitude',
  'longitude',
  'gps_accuracy',
  'status',
];

function hasStoreMasterPermission(profile) {
  if (!profile || profile.is_active !== true) return false;
  if (String(profile.status || '').trim().toLowerCase() !== 'active') return false;
  if (isDemoUser(profile)) return true;
  return new Set(['DEVELOPER', 'ADMIN', 'QPMSADMIN', 'MD', 'COO']).has(
    normalizePermissionRole(profile.role),
  );
}

function requireStoreMasterPermission(request, response, next) {
  if (!hasStoreMasterPermission(request.profile)) {
    response.status(403).json({
      ok: false,
      message: `Role ${request.userRole || 'Unknown'} cannot manage Store Master.`,
    });
    return;
  }
  next();
}

function storeMetadata(row) {
  return row?.metadata && typeof row.metadata === 'object' && !Array.isArray(row.metadata)
    ? row.metadata
    : {};
}

function storeSiteName(row) {
  const metadata = storeMetadata(row);
  return textOrNull(metadata.site_name) || textOrNull(metadata.siteName) || textOrNull(row?.store_name);
}

function serializeStoreMasterRow(row, linkedSiteVisits = 0) {
  if (!row) return null;
  return {
    ...row,
    site_name: storeSiteName(row),
    linked_site_visits: linkedSiteVisits,
  };
}

function parseStoreNumber(value, field, { required = false, min = null, max = null } = {}) {
  if (value === null || value === undefined || String(value).trim() === '') {
    if (required) throw userManagementHttpError(400, `${field} is required.`);
    return null;
  }
  const number = Number(String(value).trim());
  if (!Number.isFinite(number)) throw userManagementHttpError(400, `${field} must be numeric.`);
  if (min !== null && number < min) throw userManagementHttpError(400, `${field} must be at least ${min}.`);
  if (max !== null && number > max) throw userManagementHttpError(400, `${field} must be at most ${max}.`);
  return number;
}

function validateStoreStatus(value) {
  const status = textOrNull(value) || 'Active';
  if (/^active$/i.test(status)) return 'Active';
  if (/^inactive$/i.test(status)) return 'Inactive';
  throw userManagementHttpError(400, 'status must be Active or Inactive.');
}

function actorLabel(profile) {
  return textOrNull(profile?.display_name) ||
    textOrNull(profile?.full_name) ||
    textOrNull(profile?.employee_code) ||
    textOrNull(profile?.email) ||
    'Unknown user';
}

function buildStoreMasterPayload(body = {}, existing = null, actorProfile = null) {
  const patch = {};
  for (const field of STORE_MASTER_EDITABLE_FIELDS) {
    if (hasOwn(body, field)) {
      if (field === 'latitude') {
        patch.latitude = parseStoreNumber(body.latitude, 'latitude', { required: true, min: -90, max: 90 });
      } else if (field === 'longitude') {
        patch.longitude = parseStoreNumber(body.longitude, 'longitude', { required: true, min: -180, max: 180 });
      } else if (field === 'gps_accuracy') {
        patch.gps_accuracy = parseStoreNumber(body.gps_accuracy, 'gps_accuracy', { required: true, min: 0 });
      } else if (field === 'status') {
        patch.status = validateStoreStatus(body.status);
      } else {
        patch[field] = textOrNull(body[field]);
      }
    }
  }

  const requiredTextFields = ['store_name', 'store_code', 'client_name', 'business', 'state'];
  for (const field of requiredTextFields) {
    const value = hasOwn(patch, field) ? patch[field] : existing?.[field];
    if (!textOrNull(value)) throw userManagementHttpError(400, `${field} is required.`);
  }
  const siteName = hasOwn(body, 'site_name') ? textOrNull(body.site_name) : storeSiteName(existing);
  if (!siteName) throw userManagementHttpError(400, 'site_name is required.');

  const latitude = hasOwn(patch, 'latitude') ? patch.latitude : parseStoreNumber(existing?.latitude, 'latitude');
  const longitude = hasOwn(patch, 'longitude') ? patch.longitude : parseStoreNumber(existing?.longitude, 'longitude');
  const gpsAccuracy = hasOwn(patch, 'gps_accuracy') ? patch.gps_accuracy : parseStoreNumber(existing?.gps_accuracy, 'gps_accuracy');
  if (latitude === null) throw userManagementHttpError(400, 'latitude is required.');
  if (longitude === null) throw userManagementHttpError(400, 'longitude is required.');
  if (gpsAccuracy === null) throw userManagementHttpError(400, 'gps_accuracy is required.');

  const existingMetadata = storeMetadata(existing);
  const changedFields = {};
  for (const [field, value] of Object.entries(patch)) {
    if (existing && String(existing[field] ?? '') !== String(value ?? '')) {
      changedFields[field] = existing[field] ?? null;
    }
  }
  if (existing && storeSiteName(existing) !== siteName) {
    changedFields.site_name = storeSiteName(existing);
  }

  patch.metadata = {
    ...existingMetadata,
    site_name: siteName,
    last_edited_by: actorLabel(actorProfile),
    last_edited_by_employee_code: textOrNull(actorProfile?.employee_code),
    last_edited_at: new Date().toISOString(),
    edit_source: 'web_store_master',
    ...(Object.keys(changedFields).length ? { previous_values: changedFields } : {}),
  };
  patch.updated_at = new Date().toISOString();
  return patch;
}

function storeMasterErrorResponse(response, error) {
  const status = error.statusCode || error.status || 500;
  response.status(status).json({
    ok: false,
    message: error.message || 'Store Master operation failed.',
  });
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

function normalizeMobileLeadRole(role) {
  const normalized = String(role || '').trim().toUpperCase().replace(/[^A-Z0-9]+/g, '');
  const roleMap = {
    BDEXECUTIVE: 'BD Executive',
    BUSINESSDEVELOPMENTEXECUTIVE: 'BD Executive',
    BDHEAD: 'BD Head',
    BUSINESSDEVELOPMENTHEAD: 'BD Head',
    ADMIN: 'Admin',
    MANAGEMENT: 'Management',
    MD: 'Management',
    COO: 'Management',
    GM: 'Management',
    GENERALMANAGER: 'Management',
    GMTOPMANAGEMENT: 'Management',
    TOPMANAGEMENT: 'Management',
  };
  return roleMap[normalized] || String(role || '').trim();
}

function hasMobileLeadAccess(profile) {
  const role = normalizeMobileLeadRole(profile?.role);
  if (!['BD Executive', 'BD Head', 'Admin', 'Management'].includes(role)) return false;
  if (profile?.is_active !== true) return false;
  if (profile?.mobile_access_enabled === false) return false;
  const status = String(profile?.status || '').trim().toUpperCase();
  if (status && status !== 'ACTIVE') return false;
  return true;
}

function requireMobileLeadAccess(request, response, next) {
  if (!hasMobileLeadAccess(request.profile)) {
    response.status(403).json({
      ok: false,
      message: 'Your profile cannot access mobile lead management.',
    });
    return;
  }
  request.mobileLeadRole = normalizeMobileLeadRole(request.profile.role);
  next();
}

function mobileLeadActor(profile, authUser = {}) {
  return {
    profileId: String(profile?.id || '').trim(),
    authUserId: String(profile?.auth_user_id || authUser?.id || '').trim(),
    name: String(profile?.full_name || profile?.display_name || profile?.employee_code || profile?.email || '').trim(),
    email: String(profile?.email || authUser?.email || '').trim().toLowerCase(),
    role: normalizeMobileLeadRole(profile?.role),
  };
}

function canAccessMobileLead(lead, actor) {
  if (['BD Head', 'Admin', 'Management'].includes(actor.role)) return true;
  const assignedEmail = String(lead?.assigned_bd_email || '').trim().toLowerCase();
  const assignedName = String(lead?.assigned_bd_executive || '').trim().toLowerCase();
  const createdByUserId = String(lead?.created_by_user_id || '').trim();
  return actor.role === 'BD Executive' && (
    assignedEmail && assignedEmail === actor.email ||
    assignedName && assignedName === actor.name.toLowerCase() ||
    createdByUserId && [actor.authUserId, actor.profileId].includes(createdByUserId)
  );
}

function validateLeadPriority(value) {
  const priority = String(value || '').trim();
  return ['High', 'Medium', 'Low'].includes(priority) ? priority : '';
}

function normalizeServiceScopePayload(value) {
  if (Array.isArray(value)) return value.map((item) => String(item || '').trim()).filter(Boolean);
  if (typeof value === 'string') {
    return value.split(',').map((item) => item.trim()).filter(Boolean);
  }
  return [];
}

function groupBy(items = [], key) {
  return items.reduce((grouped, item) => {
    const value = item?.[key];
    if (!value) return grouped;
    grouped[value] = [...(grouped[value] || []), item];
    return grouped;
  }, {});
}

function compactMobileLead(lead, contactsByLeadId = {}, momByLeadId = {}, activityByLeadId = {}) {
  const contacts = contactsByLeadId[lead.id] || [];
  const primaryContact = contacts.find((contact) => contact.is_primary) || contacts[0] || null;
  const momRows = momByLeadId[lead.id] || [];
  const latestMom = [...momRows].sort((a, b) => new Date(b.created_at || 0) - new Date(a.created_at || 0))[0] || null;
  return {
    id: lead.id,
    client_name: lead.client_name,
    industry_type: lead.industry_type,
    lead_source: lead.lead_source,
    site_location: lead.site_location,
    state: lead.state,
    city: lead.city,
    lead_priority: lead.lead_priority,
    service_scope: lead.service_scope || [],
    remarks: lead.remarks,
    assigned_bd_executive: lead.assigned_bd_executive,
    assigned_bd_email: lead.assigned_bd_email,
    created_by_user_id: lead.created_by_user_id,
    created_by_name: lead.created_by_name,
    lead_stage: lead.lead_stage,
    status: lead.status,
    created_at: lead.created_at,
    updated_at: lead.updated_at,
    primary_contact: primaryContact,
    contacts,
    latest_mom: latestMom,
    next_followup_date: latestMom?.next_followup_date || null,
    activity_logs: activityByLeadId[lead.id] || [],
  };
}

async function fetchMobileLeadRelations(client, leadIds) {
  if (!leadIds.length) {
    return { contactsByLeadId: {}, momByLeadId: {}, activityByLeadId: {} };
  }
  const [contactsResponse, momResponse, activityResponse] = await Promise.all([
    client.from('lead_contacts').select('*').in('lead_id', leadIds),
    client.from('lead_mom').select('*').in('lead_id', leadIds),
    client.from('activity_logs').select('*').in('lead_id', leadIds).order('created_at', { ascending: false }),
  ]);
  if (contactsResponse.error && !isMissingTable(contactsResponse.error)) throw contactsResponse.error;
  if (momResponse.error && !isMissingTable(momResponse.error)) throw momResponse.error;
  if (activityResponse.error && !isMissingTable(activityResponse.error)) throw activityResponse.error;
  return {
    contactsByLeadId: groupBy(contactsResponse.data || [], 'lead_id'),
    momByLeadId: groupBy(momResponse.data || [], 'lead_id'),
    activityByLeadId: groupBy(activityResponse.data || [], 'lead_id'),
  };
}

function mobileLeadMatchesFilters(lead, query = {}) {
  const status = String(query.status || '').trim().toLowerCase();
  const stage = String(query.stage || '').trim().toLowerCase();
  const priority = String(query.priority || '').trim().toLowerCase();
  const search = String(query.search || '').trim().toLowerCase();
  if (status && String(lead.status || '').trim().toLowerCase() !== status) return false;
  if (stage && String(lead.lead_stage || '').trim().toLowerCase() !== stage) return false;
  if (priority && String(lead.lead_priority || '').trim().toLowerCase() !== priority) return false;
  if (search) {
    const haystack = [
      lead.client_name,
      lead.site_location,
      lead.city,
      lead.state,
      lead.assigned_bd_executive,
    ].join(' ').toLowerCase();
    if (!haystack.includes(search)) return false;
  }
  return true;
}

async function insertMobileLeadActivity(client, { leadId, type, message, createdBy }) {
  const { error } = await client.from('activity_logs').insert({
    lead_id: leadId,
    activity_type: type,
    activity_message: message,
    created_by: createdBy,
  });
  if (error && !isMissingTable(error)) {
    console.warn('[myQPMS Mobile Leads] activity log insert failed', sanitizeSupabaseDiagnosticError(error));
  }
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
    const error = serviceRoleClientNotConfiguredError();
    error.diagnosticReason =
      serviceRoleConfigurationReason() || 'service_role_client_not_initialized';
    throw error;
  }
  return serviceRoleSupabase;
}

function safeServiceRoleError(error, fallbackReason = 'service_role_auth_admin_failed') {
  const safeError = sanitizeSupabaseDiagnosticError(error);
  const databaseAccessFailed =
    error?.code === '42501' ||
    /permission denied|row-level security/i.test(String(error?.message || ''));
  return {
    message: safeError.message,
    code: safeError.code,
    statusCode: error?.statusCode || (databaseAccessFailed ? 503 : 500),
    diagnosticReason:
      error?.diagnosticReason ||
      (databaseAccessFailed ? 'service_role_database_access_failed' : fallbackReason),
  };
}

function userManagementHttpError(statusCode, message, details = null) {
  const error = new Error(message);
  error.statusCode = statusCode;
  error.details = details;
  return error;
}

function respondUserManagementError(response, error) {
  if (
    !error?.diagnosticReason &&
    (
      error?.code === '42501' ||
      /permission denied|row-level security/i.test(String(error?.message || ''))
    )
  ) {
    error.statusCode = 503;
    error.diagnosticReason = 'service_role_profile_lookup_failed';
  }
  const payload = {
    ok: false,
    message: userManagementErrorMessage(error),
  };
  if (error?.statusCode === 503 && error?.diagnosticReason) {
    payload.diagnosticReason = error.diagnosticReason;
  }
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
  const sourceMetadata =
    body.metadata && typeof body.metadata === 'object' && !Array.isArray(body.metadata)
      ? body.metadata
      : {};
  return {
    auth_user_id: authUserId,
    employee_code: employeeCode,
    username: textOrNull(body.username) || employeeCode,
    full_name: fullName,
    display_name: textOrNull(body.display_name) || fullName,
    mobile: textOrNull(body.mobile),
    email,
    state: textOrNull(body.state),
    role: canonicalProfileRole(body.role, 'FO'),
    designation: textOrNull(body.designation),
    department: textOrNull(body.department),
    business: textOrNull(body.business),
    status: 'Active',
    is_active: true,
    metadata: {
      ...sourceMetadata,
      profile_completed: Boolean(sourceMetadata.profile_completed),
    },
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

const EXECUTIVE_PROFILE_ROLE_KEYS = new Set(['ADMIN', 'MD', 'COO']);
const OPERATIONAL_PROFILE_ROLE_KEYS = new Set([
  'BUSINESSHEAD',
  'BRANCHHEAD',
  'GM',
  'GENERALMANAGER',
  'SOUTHHEAD',
  'OPERATIONSMANAGER',
  'KAM',
  'FO',
  'FIELDOFFICER',
]);

const SELF_PROFILE_METADATA_FIELDS = ['profile_image_url', 'date_of_birth', 'profile_completed'];

function profileRoleKey(role) {
  return String(role || '').trim().toUpperCase().replace(/[^A-Z0-9]+/g, '');
}

function isOperationalProfileRole(role) {
  return OPERATIONAL_PROFILE_ROLE_KEYS.has(profileRoleKey(role));
}

function calculateProfileCompletion(profile = {}) {
  const roleKey = profileRoleKey(profile.role);
  const checks = EXECUTIVE_PROFILE_ROLE_KEYS.has(roleKey)
    ? [
        profile.full_name,
        profile.employee_code,
        profile.email,
        profile.mobile,
        profile.role,
      ]
    : [
        profile.full_name,
        profile.employee_code,
        profile.email || profile.mobile,
        profile.role,
        profile.state,
        profile.business,
        profile.designation,
      ];
  const completed = checks.filter((value) => textOrNull(value)).length;
  return Math.round((completed / checks.length) * 100);
}

function selfProfilePatchPayload(body, currentProfile) {
  const patch = {};
  const editableTextFields = ['full_name', 'display_name', 'mobile'];
  if (isOperationalProfileRole(currentProfile?.role)) {
    editableTextFields.push('state', 'business');
  }
  for (const field of editableTextFields) {
    if (!hasOwn(body, field)) continue;
    patch[field] = textOrNull(body[field]);
  }

  const currentMetadata =
    currentProfile?.metadata && typeof currentProfile.metadata === 'object' && !Array.isArray(currentProfile.metadata)
      ? currentProfile.metadata
      : {};
  const suppliedMetadata =
    body.metadata && typeof body.metadata === 'object' && !Array.isArray(body.metadata)
      ? body.metadata
      : {};
  const nextMetadata = { ...currentMetadata };
  for (const field of SELF_PROFILE_METADATA_FIELDS) {
    if (!hasOwn(body, field) && !hasOwn(suppliedMetadata, field)) continue;
    const rawValue = hasOwn(body, field) ? body[field] : suppliedMetadata[field];
    if (field === 'profile_completed') continue;
    nextMetadata[field] = textOrNull(rawValue);
  }
  nextMetadata.profile_completed = calculateProfileCompletion({ ...currentProfile, ...patch });
  patch.metadata = nextMetadata;
  return patch;
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
    if (field === 'email') {
      payload[field] = normalizeEmail(body[field]) || null;
    } else if (field === 'role') {
      payload[field] = canonicalProfileRole(body[field]);
    } else {
      payload[field] = textOrNull(body[field]);
    }
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

async function ensureUniqueAuthEmail(client, email) {
  const normalizedEmail = normalizeEmail(email);
  if (!normalizedEmail) return;
  let page = 1;
  const perPage = 1000;
  while (true) {
    const { data, error } = await client.auth.admin.listUsers({ page, perPage });
    if (error) throw error;
    const exists = (data.users || []).some(
      (authUser) => normalizeEmail(authUser.email) === normalizedEmail,
    );
    if (exists) {
      throw userManagementHttpError(409, 'Email already exists in Supabase Auth.');
    }
    if (!data.nextPage || !(data.users || []).length) break;
    page = data.nextPage;
  }
}

const CREATE_USER_ROLE_OPTIONS = new Set([
  'MD',
  'COO',
  'GM',
  'SOUTHHEAD',
  'BUSINESSHEAD',
  'BRANCHHEAD',
  'OPERATIONSMANAGER',
  'KAM',
  'FO',
  'ADMIN',
]);

const CLIENT_CREATE_ROLE_KEYS = new Set([
  'HOSPITALMANAGEMENT',
  'RMO',
  'DOCTOR',
]);

const OPERATIONAL_CREATE_ROLE_KEYS = new Set([
  'FO',
  'KAM',
  'OPERATIONSMANAGER',
  'BRANCHHEAD',
  'BUSINESSHEAD',
]);

const IFMS_BUSINESS_KEYS = new Set(['IFMS', 'RELIANCERETAIL', 'RELIANCE']);

function createUserRoleKey(role) {
  return String(role || '').trim().toUpperCase().replace(/[^A-Z0-9]+/g, '');
}

function accessCode(value) {
  return String(value || '').trim().toLowerCase();
}

function normalizeUserType(value) {
  const text = accessCode(value || 'internal');
  return text === 'client' ? 'client' : 'internal';
}

function accessPayloadFromBody(body = {}) {
  const input =
    body.access_assignment && typeof body.access_assignment === 'object' && !Array.isArray(body.access_assignment)
      ? body.access_assignment
      : body.unified_access && typeof body.unified_access === 'object' && !Array.isArray(body.unified_access)
        ? body.unified_access
        : {};
  const scope = input.scope && typeof input.scope === 'object' && !Array.isArray(input.scope)
    ? input.scope
    : {};
  return {
    user_type: normalizeUserType(body.user_type || input.user_type),
    business_vertical_id: textOrNull(input.business_vertical_id),
    client_id: textOrNull(input.client_id),
    module_id: textOrNull(input.module_id),
    role_id: textOrNull(input.role_id),
    verification_status: accessCode(input.verification_status || 'verified') || 'verified',
    effective_from: textOrNull(input.effective_from),
    effective_to: textOrNull(input.effective_to),
    source: textOrNull(input.source) || 'web_invite',
    scope_type: accessCode(scope.scope_type || input.scope_type),
    scope_id: textOrNull(scope.scope_id || input.scope_id),
    scope_code: textOrNull(scope.scope_code || input.scope_code),
    scope_text: textOrNull(scope.scope_text || input.scope_text),
  };
}

function accessPayloadPresent(access) {
  return Boolean(
    access.business_vertical_id ||
    access.client_id ||
    access.module_id ||
    access.role_id ||
    access.scope_type ||
    access.scope_id ||
    access.scope_code ||
    access.scope_text,
  );
}

function scopeRequiresValue(scopeType) {
  return !['global', 'all_client', 'employee_self'].includes(accessCode(scopeType));
}

function validateAccessInvitePayload(access) {
  if (!accessPayloadPresent(access)) return;
  if (!access.business_vertical_id) throw userManagementHttpError(400, 'Business Vertical is required.');
  if (!access.module_id) throw userManagementHttpError(400, 'Module is required.');
  if (!access.role_id) throw userManagementHttpError(400, 'Unified Role is required.');
  if (!access.scope_type) throw userManagementHttpError(400, 'Scope Type is required.');
  if (scopeRequiresValue(access.scope_type) && !access.scope_id && !access.scope_code && !access.scope_text) {
    throw userManagementHttpError(400, 'Scope Value is required.');
  }
  if (!['verified', 'draft'].includes(access.verification_status)) {
    throw userManagementHttpError(400, 'Unified access verification status must be verified or draft.');
  }
}

async function loadAccessFoundationRecord(client, table, id, label) {
  const { data, error } = await client
    .from(table)
    .select('*')
    .eq('id', id)
    .maybeSingle();
  if (error) throw error;
  if (!data) throw userManagementHttpError(400, `${label} is not available.`);
  if (data.active === false) throw userManagementHttpError(400, `${label} is inactive.`);
  return data;
}

async function validateUnifiedAccessFoundation(client, access) {
  if (!accessPayloadPresent(access)) return null;
  validateAccessInvitePayload(access);
  const [vertical, module, role] = await Promise.all([
    loadAccessFoundationRecord(client, 'access_business_verticals', access.business_vertical_id, 'Business Vertical'),
    loadAccessFoundationRecord(client, 'access_modules', access.module_id, 'Module'),
    loadAccessFoundationRecord(client, 'access_roles', access.role_id, 'Unified Role'),
  ]);
  let accessClient = null;
  if (access.client_id) {
    accessClient = await loadAccessFoundationRecord(client, 'access_clients', access.client_id, 'Client');
    if (String(accessClient.business_vertical_id) !== String(vertical.id)) {
      throw userManagementHttpError(400, 'Client does not belong to the selected Business Vertical.');
    }
  }
  if (role.module_id && String(role.module_id) !== String(module.id)) {
    throw userManagementHttpError(400, 'Role is not available for the selected Module.');
  }
  if (normalizeUserType(role.user_type) !== access.user_type) {
    throw userManagementHttpError(400, 'Role is not available for the selected User Type.');
  }
  const { data: verticalModule, error: verticalModuleError } = await client
    .from('access_business_vertical_modules')
    .select('enabled')
    .eq('business_vertical_id', vertical.id)
    .eq('module_id', module.id)
    .maybeSingle();
  if (verticalModuleError) throw verticalModuleError;
  if (!verticalModule?.enabled) throw userManagementHttpError(400, 'Module is not enabled for the selected Business Vertical.');
  if (accessClient) {
    const { data: clientModule, error: clientModuleError } = await client
      .from('access_client_modules')
      .select('enabled')
      .eq('client_id', accessClient.id)
      .eq('module_id', module.id)
      .maybeSingle();
    if (clientModuleError) throw clientModuleError;
    if (!clientModule?.enabled) throw userManagementHttpError(400, 'Module is not enabled for the selected Client.');
  }
  return { vertical, accessClient, module, role };
}

async function createUnifiedAccessForProfile(client, profile, authUserId, access, request) {
  if (!accessPayloadPresent(access)) return null;
  const foundation = await validateUnifiedAccessFoundation(client, access);
  const effectiveFrom = access.effective_from || new Date().toISOString();
  let query = client
    .from('access_user_assignments')
    .select('*')
    .eq('auth_user_id', authUserId)
    .eq('business_vertical_id', access.business_vertical_id)
    .eq('module_id', access.module_id)
    .eq('role_id', access.role_id)
    .eq('active', true)
    .neq('verification_status', 'rejected')
    .is('effective_to', null)
    .limit(1);
  if (access.client_id) query = query.eq('client_id', access.client_id);
  else query = query.is('client_id', null);
  const { data: existingAssignments, error: existingError } = await query;
  if (existingError) throw existingError;
  let assignment = existingAssignments?.[0] || null;
  if (!assignment) {
    const { data, error } = await client
      .from('access_user_assignments')
      .insert({
        auth_user_id: authUserId,
        profile_id: profile.id,
        business_vertical_id: access.business_vertical_id,
        client_id: access.client_id,
        module_id: access.module_id,
        role_id: access.role_id,
        active: true,
        verification_status: access.verification_status,
        effective_from: effectiveFrom,
        effective_to: access.effective_to,
        source: access.source,
        metadata: {
          source: 'web_user_management_invite',
          user_type: access.user_type,
        },
        created_by: request.authUser.id,
      })
      .select('*')
      .single();
    if (error) throw error;
    assignment = data;
  }

  const scopeIdentity = {
    user_assignment_id: assignment.id,
    scope_type: access.scope_type,
    scope_id: access.scope_id,
    scope_code: access.scope_code,
    scope_text: access.scope_text,
  };
  let scopeQuery = client
    .from('access_user_scopes')
    .select('*')
    .eq('user_assignment_id', assignment.id)
    .eq('scope_type', access.scope_type)
    .eq('allowed', true)
    .limit(1);
  scopeQuery = access.scope_id ? scopeQuery.eq('scope_id', access.scope_id) : scopeQuery.is('scope_id', null);
  scopeQuery = access.scope_code ? scopeQuery.eq('scope_code', access.scope_code) : scopeQuery.is('scope_code', null);
  scopeQuery = access.scope_text ? scopeQuery.eq('scope_text', access.scope_text) : scopeQuery.is('scope_text', null);
  const { data: existingScopes, error: existingScopeError } = await scopeQuery;
  if (existingScopeError) throw existingScopeError;
  let scope = existingScopes?.[0] || null;
  if (!scope) {
    const { data, error } = await client
      .from('access_user_scopes')
      .insert({
        ...scopeIdentity,
        allowed: true,
        effective_from: effectiveFrom,
        effective_to: access.effective_to,
        metadata: { source: 'web_user_management_invite' },
        created_by: request.authUser.id,
      })
      .select('*')
      .single();
    if (error) throw error;
    scope = data;
  }

  const auditPayload = {
    actor_user_id: request.authUser.id,
    action: 'access_assignment_created',
    target_type: 'profile',
    target_id: profile.id,
    after_state: sanitizeAuditData({
      assignment: {
        id: assignment.id,
        auth_user_id: authUserId,
        profile_id: profile.id,
        business_vertical_id: access.business_vertical_id,
        client_id: access.client_id,
        module_id: access.module_id,
        role_id: access.role_id,
        verification_status: assignment.verification_status,
        active: assignment.active,
      },
      scope: scopeIdentity,
    }),
    metadata: {
      source: 'web_user_management_invite',
      business_vertical_code: foundation.vertical.code,
      client_code: foundation.accessClient?.code || null,
      module_code: foundation.module.code,
      role_code: foundation.role.code,
    },
  };
  const { error: auditError } = await client.from('access_audit_logs').insert(auditPayload);
  if (auditError) throw auditError;
  return {
    assignment: {
      status: assignment.verification_status,
      active: assignment.active,
      business_vertical: foundation.vertical.code,
      client: foundation.accessClient?.code || null,
      module: foundation.module.code,
      role: foundation.role.code,
    },
    scope: {
      scope_type: scope.scope_type,
      scope_id: scope.scope_id,
      scope_code: scope.scope_code,
      scope_text: scope.scope_text,
    },
  };
}

async function loadUnifiedAccessSummaryForProfile(client, profileId) {
  const { data: assignments, error } = await client
    .from('access_user_assignments')
    .select(`
      id,
      active,
      verification_status,
      effective_from,
      effective_to,
      business_vertical:access_business_verticals(code,name),
      client:access_clients(code,name),
      module:access_modules(code,name),
      role:access_roles(code,name,user_type)
    `)
    .eq('profile_id', profileId)
    .order('created_at', { ascending: false })
    .limit(20);
  if (error) {
    if (accessTableMissing(error)) return [];
    throw error;
  }
  if (!assignments?.length) return [];
  const assignmentIds = assignments.map((assignment) => assignment.id);
  const { data: scopes, error: scopesError } = await client
    .from('access_user_scopes')
    .select('user_assignment_id,scope_type,scope_id,scope_code,scope_text,allowed,effective_from,effective_to')
    .in('user_assignment_id', assignmentIds);
  if (scopesError) {
    if (accessTableMissing(scopesError)) return [];
    throw scopesError;
  }
  return assignments.map((assignment) => ({
    business_vertical: assignment.business_vertical || null,
    client: assignment.client || null,
    module: assignment.module || null,
    role: assignment.role || null,
    active: assignment.active === true,
    verification_status: assignment.verification_status || null,
    effective_from: assignment.effective_from || null,
    effective_to: assignment.effective_to || null,
    scopes: (scopes || [])
      .filter((scope) => scope.user_assignment_id === assignment.id)
      .map((scope) => ({
        scope_type: scope.scope_type,
        scope_id: scope.scope_id,
        scope_code: scope.scope_code,
        scope_text: scope.scope_text,
        allowed: scope.allowed === true,
        effective_from: scope.effective_from,
        effective_to: scope.effective_to,
      })),
  }));
}

function accessTableMissing(error) {
  const text = `${error?.code || ''} ${error?.message || ''}`.toLowerCase();
  return error?.code === '42P01' ||
    error?.code === 'PGRST205' ||
    text.includes('could not find the table') ||
    text.includes('does not exist') ||
    text.includes('schema cache');
}

function businessKey(value) {
  return String(value || '').trim().toUpperCase().replace(/[^A-Z0-9]+/g, '');
}

function isIfmsBusiness(value) {
  return IFMS_BUSINESS_KEYS.has(businessKey(value));
}

function normalizedHierarchyBusiness(value) {
  const key = businessKey(value);
  if (IFMS_BUSINESS_KEYS.has(key)) return 'IFMS';
  return key;
}

function isActiveProfileForHierarchy(profile) {
  return profile?.is_active === true &&
    String(profile.status || '').trim().toLowerCase() === 'active';
}

function profileMatchesStateBusiness(profile, state, business) {
  const requestedState = textOrNull(state);
  const requestedBusiness = textOrNull(business);
  if (requestedState && String(profile.state || '').trim() !== requestedState) return false;
  if (requestedBusiness && normalizedHierarchyBusiness(profile.business) !== normalizedHierarchyBusiness(requestedBusiness)) return false;
  return true;
}

function profileOption(profile) {
  if (!profile) return null;
  const metadata =
    profile.metadata && typeof profile.metadata === 'object' && !Array.isArray(profile.metadata)
      ? profile.metadata
      : {};
  return {
    id: profile.id,
    employee_code: profile.employee_code || '',
    full_name: profile.full_name || profile.display_name || profile.email || '',
    email: profile.email || '',
    role: profile.role || '',
    state: profile.state || '',
    business: profile.business || '',
    metadata,
    manager_employee_code: metadata.reporting_manager_employee_code || null,
    operations_manager_employee_code: metadata.operations_manager_employee_code || null,
    branch_head_employee_code: metadata.branch_head_employee_code || null,
    gm_employee_code: metadata.gm_employee_code || null,
    south_head_employee_code: metadata.south_head_employee_code || null,
    coo_employee_code: metadata.coo_employee_code || null,
    md_employee_code: metadata.md_employee_code || null,
    label: `${profile.full_name || profile.display_name || profile.email || 'Unnamed'} - ${profile.employee_code || 'No Code'}`,
  };
}

function pickPreferredLeader(profiles, role, preferredCode) {
  const roleKey = createUserRoleKey(role);
  const activeMatches = profiles.filter(
    (profile) => isActiveProfileForHierarchy(profile) && createUserRoleKey(profile.role) === roleKey,
  );
  const preferred = activeMatches.find(
    (profile) => normalizeEmployeeCode(profile.employee_code) === normalizeEmployeeCode(preferredCode),
  );
  return preferred || activeMatches[0] || null;
}

async function loadActiveHierarchyProfiles(client) {
  const rows = [];
  const pageSize = 1000;
  for (let from = 0; ; from += pageSize) {
    const { data, error } = await client
      .from('profiles')
      .select(USER_MANAGEMENT_PROFILE_SELECT)
      .eq('is_active', true)
      .eq('status', 'Active')
      .order('full_name', { ascending: true })
      .range(from, from + pageSize - 1);
    if (error) throw error;
    rows.push(...(data || []));
    if ((data || []).length < pageSize) break;
  }
  return rows;
}

function buildHierarchyOptionsFromProfiles(profiles, { state, business } = {}) {
  const filteredByMapping = profiles.filter((profile) =>
    profileMatchesStateBusiness(profile, state, business),
  );
  const byRole = (role) =>
    filteredByMapping
      .filter((profile) => createUserRoleKey(profile.role) === createUserRoleKey(role))
      .map(profileOption)
      .filter(Boolean);
  const allByRole = (role) =>
    profiles
      .filter((profile) => createUserRoleKey(profile.role) === createUserRoleKey(role))
      .map(profileOption)
      .filter(Boolean);
  return {
    operationsManagers: byRole('Operations Manager'),
    branchHeads: byRole('Branch Head'),
    businessHeads: byRole('Business Head'),
    gms: allByRole('GM'),
    southHeads: allByRole('South Head'),
    kams: byRole('KAM'),
    coo: profileOption(pickPreferredLeader(profiles, 'COO', 'QPMSTN16278')),
    md: profileOption(pickPreferredLeader(profiles, 'MD', 'QPMSTN15789')),
  };
}

function optionByCode(options = [], code) {
  const normalized = normalizeEmployeeCode(code);
  return options.find((option) => normalizeEmployeeCode(option.employee_code) === normalized) || null;
}

function requiredReportingLabel(roleKey) {
  if (roleKey === 'FO') return 'Reporting Operations Manager';
  if (roleKey === 'KAM') return 'GM / South Head';
  if (roleKey === 'OPERATIONSMANAGER') return 'Branch Head';
  if (roleKey === 'BRANCHHEAD') return 'GM / South Head';
  if (roleKey === 'BUSINESSHEAD' || roleKey === 'GM' || roleKey === 'SOUTHHEAD') return 'COO';
  if (roleKey === 'COO') return 'MD';
  return null;
}

function hierarchyWarningsForOptions(roleKey, options) {
  const warnings = [];
  if (!options.md) warnings.push('MD profile not found. Please create MD user first.');
  if (!options.coo && !['MD', 'COO', 'ADMIN'].includes(roleKey)) {
    warnings.push('COO profile not found. Please create COO user first.');
  }
  if (roleKey === 'BRANCHHEAD' || roleKey === 'KAM') {
    if (!options.gms?.length && !options.southHeads?.length) {
      warnings.push('GM/South Head profile not found. Please create GM or South Head user first.');
    }
  }
  return warnings;
}

async function buildCreateHierarchyMetadata(client, body, employeeCode) {
  const role = canonicalProfileRole(body.role, 'FO');
  const roleKey = createUserRoleKey(role);
  const state = textOrNull(body.state);
  const business = textOrNull(body.business);
  const ifmsBusiness = isIfmsBusiness(business);
  const reportingManagerCode = normalizeEmployeeCode(
    body.reporting_manager_employee_code || body.manager_employee_code,
  );
  const profiles = await loadActiveHierarchyProfiles(client);
  const options = buildHierarchyOptionsFromProfiles(profiles, { state, business });
  const warnings = hierarchyWarningsForOptions(roleKey, options);
  let reportingManager = null;
  let operationsManager = null;
  let branchHead = null;
  let coo = options.coo;
  let md = options.md;
  let gm = null;
  let southHead = null;
  const gmLevelOptions = ifmsBusiness ? options.southHeads : options.gms;
  const gmLevelLabel = ifmsBusiness ? 'South Head' : 'GM';
  const byEmployeeCode = (code) =>
    optionByCode([
      ...options.operationsManagers,
      ...options.branchHeads,
      ...options.gms,
      ...options.southHeads,
      ...options.businessHeads,
      options.coo,
      options.md,
    ].filter(Boolean), code);
  const resolveFromMetadata = (source, key) => byEmployeeCode(source?.[key] || source?.metadata?.[key]);
  const assignGmLevel = (leader) => {
    if (!leader) return;
    if (createUserRoleKey(leader.role) === 'SOUTHHEAD') southHead = leader;
    if (createUserRoleKey(leader.role) === 'GM') gm = leader;
  };
  const inheritExecutiveChain = (source) => {
    if (!source) return;
    if (!gm) gm = resolveFromMetadata(source, 'gm_employee_code');
    if (!southHead) southHead = resolveFromMetadata(source, 'south_head_employee_code');
    if (!coo) coo = resolveFromMetadata(source, 'coo_employee_code') || coo;
    if (!md) md = resolveFromMetadata(source, 'md_employee_code') || md;
  };

  if (roleKey === 'MD' || roleKey === 'ADMIN') {
    return {
      metadata: {
        reporting_manager_employee_code: null,
        reporting_manager_name: null,
        operations_manager_employee_code: null,
        branch_head_employee_code: null,
        gm_employee_code: null,
        south_head_employee_code: null,
        coo_employee_code: null,
        md_employee_code: roleKey === 'MD' ? employeeCode : md?.employee_code || null,
        hierarchy_path: roleKey === 'MD' ? [employeeCode] : [employeeCode, md?.employee_code].filter(Boolean),
        hierarchy_warnings: warnings,
      },
      hierarchyFields: {},
      warnings,
    };
  }

  if (roleKey === 'COO') {
    if (!md) throw userManagementHttpError(400, 'MD profile not found. Please create MD user first.');
    reportingManager = md;
  } else if (roleKey === 'BUSINESSHEAD' || roleKey === 'GM' || roleKey === 'SOUTHHEAD') {
    if (!coo) throw userManagementHttpError(400, 'COO profile not found. Please create COO user first.');
    reportingManager = coo;
    if (roleKey === 'GM') gm = { employee_code: employeeCode, full_name: textOrNull(body.full_name), role: 'GM' };
    if (roleKey === 'SOUTHHEAD') southHead = { employee_code: employeeCode, full_name: textOrNull(body.full_name), role: 'South Head' };
  } else if (roleKey === 'BRANCHHEAD') {
    reportingManager = optionByCode(gmLevelOptions, reportingManagerCode);
    if (!reportingManager) throw userManagementHttpError(400, `${gmLevelLabel} is required for Branch Head.`);
    assignGmLevel(reportingManager);
  } else if (roleKey === 'OPERATIONSMANAGER') {
    branchHead = optionByCode(options.branchHeads, reportingManagerCode);
    if (!branchHead) throw userManagementHttpError(400, 'Branch Head is required for Operations Manager.');
    reportingManager = branchHead;
    inheritExecutiveChain(branchHead);
  } else if (roleKey === 'FO') {
    operationsManager = optionByCode(options.operationsManagers, reportingManagerCode);
    if (!operationsManager) throw userManagementHttpError(400, 'Reporting Operations Manager is required for FO.');
    reportingManager = operationsManager;
    branchHead =
      resolveFromMetadata(operationsManager, 'branch_head_employee_code') ||
      options.branchHeads[0] ||
      null;
    inheritExecutiveChain(operationsManager);
    inheritExecutiveChain(branchHead);
    if (!branchHead) warnings.push('Branch Head profile not found for selected State and Business.');
  } else if (roleKey === 'KAM') {
    reportingManager = optionByCode(gmLevelOptions, reportingManagerCode);
    if (!reportingManager) throw userManagementHttpError(400, `${gmLevelLabel} is required for KAM.`);
    assignGmLevel(reportingManager);
  }

  if (roleKey === 'BRANCHHEAD' || roleKey === 'KAM') {
    assignGmLevel(reportingManager);
  }
  if (roleKey === 'BRANCHHEAD' && !reportingManager) {
    throw userManagementHttpError(400, `${gmLevelLabel} is required for Branch Head.`);
  }
  if (roleKey === 'KAM' && createUserRoleKey(reportingManager?.role) === 'KAM') {
    throw userManagementHttpError(400, 'KAM cannot be selected as a reporting manager.');
  }
  if (roleKey === 'OPERATIONSMANAGER') inheritExecutiveChain(branchHead);
  if (roleKey === 'FO') inheritExecutiveChain(operationsManager);
  if (!coo) coo = resolveFromMetadata(gm || southHead || branchHead || operationsManager, 'coo_employee_code') || options.coo;
  if (!md) md = resolveFromMetadata(gm || southHead || branchHead || operationsManager, 'md_employee_code') || options.md;

  if (['FO', 'KAM', 'OPERATIONSMANAGER', 'BRANCHHEAD', 'BUSINESSHEAD', 'GM', 'SOUTHHEAD'].includes(roleKey) && !coo) {
    throw userManagementHttpError(400, 'COO profile not found. Please create COO user first.');
  }
  if (roleKey !== 'MD' && !md) {
    throw userManagementHttpError(400, 'MD profile not found. Please create MD user first.');
  }

  const hierarchyPath = [
    employeeCode,
    roleKey === 'FO' ? operationsManager?.employee_code : null,
    ['FO', 'OPERATIONSMANAGER'].includes(roleKey) ? branchHead?.employee_code : null,
    ['FO', 'OPERATIONSMANAGER', 'BRANCHHEAD', 'KAM'].includes(roleKey)
      ? (southHead?.employee_code || gm?.employee_code)
      : null,
    roleKey === 'COO' ? employeeCode : coo?.employee_code,
    roleKey === 'MD' ? employeeCode : md?.employee_code,
  ].filter(Boolean);
  const metadata = {
    reporting_manager_employee_code: reportingManager?.employee_code || null,
    reporting_manager_name: reportingManager?.full_name || null,
    operations_manager_employee_code: roleKey === 'OPERATIONSMANAGER' ? employeeCode : operationsManager?.employee_code || null,
    branch_head_employee_code: roleKey === 'BRANCHHEAD' ? employeeCode : branchHead?.employee_code || null,
    gm_employee_code: roleKey === 'GM' ? employeeCode : gm?.employee_code || null,
    south_head_employee_code: roleKey === 'SOUTHHEAD' ? employeeCode : southHead?.employee_code || null,
    coo_employee_code: roleKey === 'COO' ? employeeCode : coo?.employee_code || null,
    md_employee_code: md?.employee_code || null,
    hierarchy_path: Array.from(new Set(hierarchyPath)),
    hierarchy_warnings: warnings,
  };
  return {
    metadata,
    hierarchyFields: {
      manager_employee_code: metadata.reporting_manager_employee_code,
      business_head_employee_code:
        roleKey === 'BUSINESSHEAD' ? employeeCode : normalizeEmployeeCode(body.business_head_employee_code) || null,
      gm_employee_code: metadata.gm_employee_code,
      coo_employee_code: metadata.coo_employee_code,
      hierarchy_path: metadata.hierarchy_path,
      metadata,
    },
    warnings,
  };
}

function validateCreateUserBody(body) {
  const roleKey = createUserRoleKey(body.role);
  const userType = normalizeUserType(body.user_type);
  const access = accessPayloadFromBody(body);
  if (userType === 'client') {
    if (!CLIENT_CREATE_ROLE_KEYS.has(roleKey)) {
      throw userManagementHttpError(400, 'Client User role must be Hospital Management / RMO or Doctor.');
    }
    validateAccessInvitePayload(access);
    if (!accessPayloadPresent(access)) {
      throw userManagementHttpError(400, 'Client, Module, Role and Scope are required for Client User invites.');
    }
    if (!access.client_id) throw userManagementHttpError(400, 'Client is required for Client User invites.');
    return;
  }
  if (!CREATE_USER_ROLE_OPTIONS.has(roleKey)) {
    throw userManagementHttpError(400, 'role must be one of MD, COO, GM, South Head, Business Head, Branch Head, Operations Manager, KAM, FO, or Admin.');
  }
  if (body.create_profile_only === true && roleKey === 'MD') return;
  if (!textOrNull(body.mobile)) throw userManagementHttpError(400, 'mobile is required.');
  if (OPERATIONAL_CREATE_ROLE_KEYS.has(roleKey) && !textOrNull(body.state)) {
    throw userManagementHttpError(400, 'state is required for this role.');
  }
  if (OPERATIONAL_CREATE_ROLE_KEYS.has(roleKey) && !textOrNull(body.business)) {
    throw userManagementHttpError(400, 'business is required for this role.');
  }
  const requiredLabel = requiredReportingLabel(roleKey);
  if (requiredLabel && ['FO', 'KAM', 'OPERATIONSMANAGER', 'BRANCHHEAD'].includes(roleKey) && !textOrNull(body.reporting_manager_employee_code || body.manager_employee_code)) {
    throw userManagementHttpError(400, `${requiredLabel} is required.`);
  }
}

function profileOnlyMdPayload(body) {
  const employeeCode = normalizeEmployeeCode(body.employee_code);
  const fullName = textOrNull(body.full_name);
  const email = normalizeEmail(body.email);
  const metadata = body.metadata && typeof body.metadata === 'object' && !Array.isArray(body.metadata)
    ? body.metadata
    : {};
  return {
    auth_user_id: null,
    employee_code: employeeCode,
    username: textOrNull(body.username) || employeeCode,
    full_name: fullName,
    display_name: textOrNull(body.display_name) || fullName,
    mobile: textOrNull(body.mobile),
    email: email || null,
    state: textOrNull(body.state),
    role: 'MD',
    designation: textOrNull(body.designation),
    department: textOrNull(body.department),
    business: textOrNull(body.business),
    status: 'Active',
    is_active: true,
    metadata: {
      ...metadata,
      reporting_manager_employee_code: null,
      reporting_manager_name: null,
      operations_manager_employee_code: null,
      branch_head_employee_code: null,
      coo_employee_code: null,
      md_employee_code: employeeCode,
      hierarchy_path: [employeeCode],
      profile_only: true,
    },
    requires_password_change: false,
    mobile_access_enabled: booleanValue(body.mobile_access_enabled, true),
    web_access_enabled: booleanValue(body.web_access_enabled, true),
    auth_provisioning_status: 'profile_only',
    auth_provisioning_error: null,
    auth_provisioned_at: null,
    last_profile_sync_at: new Date().toISOString(),
  };
}

function passwordSetupRedirectUrl() {
  const origin = allowedOrigins[0] || process.env.FRONTEND_ORIGIN || 'http://localhost:5173';
  return `${String(origin).replace(/\/+$/, '')}/set-password`;
}

function currentProfileMetadata(profileOrBody = {}) {
  return profileOrBody?.metadata &&
    typeof profileOrBody.metadata === 'object' &&
    !Array.isArray(profileOrBody.metadata)
    ? profileOrBody.metadata
    : {};
}

function inviteMetadataForResult(invite = {}, timestamp = new Date().toISOString()) {
  const method = invite.method === 'password_recovery_email'
    ? 'password_recovery_email'
    : 'supabase_invite_email';
  return {
    invite_status: 'sent',
    invite_sent_at: timestamp,
    invite_method: method,
    invite_redirect_to: '/set-password',
  };
}

async function createInvitedAuthUser(client, { email, authMetadata }) {
  const redirectTo = passwordSetupRedirectUrl();
  const inviteResult = {
    method: 'supabase_invite',
    email_sent: false,
    setup_link: null,
    message: 'Invite email sent. The employee can set their own password from the email link.',
    warning: null,
  };

  const { data, error } = await client.auth.admin.inviteUserByEmail(email, {
    data: authMetadata,
    redirectTo,
  });
  if (!error && data?.user) {
    return { user: data.user, invite: { ...inviteResult, email_sent: true } };
  }

  throw userManagementHttpError(
    503,
    'Supabase invite email could not be sent. Verify Auth SMTP/invite configuration and retry.',
    { invite_error: safeAuthError(error) },
  );
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
    error.statusCode = 502;
    error.code = error.code || 'smtp_delivery_failed';
    throw error;
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

function authorizedLeadMomPayload(request, { requireRecipient = true } = {}) {
  const payload = request.body || {};
  const lead = request.authorizedLead || {};
  const contactRecipients = leadMomContactRecipients(request.authorizedLeadContacts);
  if (requireRecipient && !contactRecipients.length) {
    const error = new Error('At least one lead contact with an email address is required.');
    error.statusCode = 400;
    error.code = 'lead_contact_email_required';
    throw error;
  }
  const extraCc = normalizeRecipients(payload.cc || payload.ccEmails || payload.cc_emails)
    .map((email) => String(email).trim().toLowerCase())
    .filter(Boolean);
  const to = contactRecipients.slice(0, 1);
  const cc = [...new Set([...contactRecipients.slice(1), ...extraCc])]
    .filter((email) => !to.includes(email));
  return {
    ...payload,
    leadId: lead.id,
    lead_id: lead.id,
    clientName: lead.client_name,
    company: lead.client_name,
    location: lead.site_location,
    serviceScope: normalizeServiceScope(payload.serviceScope || lead.service_scope || []),
    to,
    cc,
    additionalRecipients: contactRecipients.slice(1),
    sender: safeLeadMomSender(request.leadActor),
  };
}

function leadMomRow(payload, request, status, existingMetadata = {}) {
  const sent = status === 'Sent';
  const sender = safeLeadMomSender(request.leadActor);
  return {
    lead_id: request.authorizedLead.id,
    to_email: normalizeRecipients(payload.to).join(', '),
    cc_emails: normalizeRecipients(payload.cc).join(', '),
    subject: String(payload.subject || '').trim() || null,
    discussion_summary: String(payload.discussionSummary || payload.discussion_summary || '').trim() || null,
    service_scope_discussion: String(
      payload.serviceScopeDiscussion
      || payload.service_scope_discussion
      || normalizeServiceScope(payload.serviceScope).join(', '),
    ).trim() || null,
    action_items: String(payload.actionItems || payload.action_items || '').trim() || null,
    next_followup_date: payload.nextFollowUpDate || payload.next_followup_date || null,
    scheduled_site_visit_date: payload.scheduledVisitDate || payload.scheduled_site_visit_date || null,
    scheduled_site_visit_time: payload.scheduledVisitTime || payload.scheduled_site_visit_time || null,
    site_visit_remarks: String(payload.siteVisitRemarks || payload.site_visit_remarks || '').trim() || null,
    calendar_invite_sent: sent && Boolean(payload.calendarInviteSent),
    mom_status: status,
    sent_at: sent ? new Date().toISOString() : null,
    metadata: {
      ...(existingMetadata && typeof existingMetadata === 'object' ? existingMetadata : {}),
      [sent ? 'sent_by' : 'updated_by']: sender,
      ...(sent ? { sent_at: new Date().toISOString() } : {}),
    },
  };
}

async function persistAuthorizedLeadMom(request, payload, status) {
  const client = requireServiceRoleSupabase();
  const existing = await client
    .from('lead_mom')
    .select('metadata')
    .eq('lead_id', request.authorizedLead.id)
    .maybeSingle();
  if (existing.error) throw existing.error;
  const row = leadMomRow(payload, request, status, existing.data?.metadata);
  const result = await client
    .from('lead_mom')
    .upsert(row, { onConflict: 'lead_id' })
    .select('*')
    .single();
  if (result.error) throw result.error;
  if (status === 'Sent') {
    const leadUpdate = await client
      .from('leads')
      .update({
        lead_stage: 'Lead MOM Sent',
        status: 'MOM Sent',
        updated_at: new Date().toISOString(),
      })
      .eq('id', request.authorizedLead.id);
    if (leadUpdate.error) throw leadUpdate.error;
  }
  await insertMobileLeadActivity(client, {
    leadId: request.authorizedLead.id,
    type: status === 'Sent' ? 'Lead MOM Sent' : 'Lead MOM Drafted',
    message: status === 'Sent' ? 'Lead MOM sent' : 'Lead MOM draft saved',
    createdBy: request.leadActor.employeeCode || request.leadActor.name,
  });
  return result.data;
}

function routeSendMom(type) {
  return async (request, response) => {
    try {
      const payload = type === 'lead' ? authorizedLeadMomPayload(request) : request.body;
      if (type === 'lead') {
        console.log('[myQPMS Mail API] /send-lead-mom hit', {
          leadId: request.authorizedLead?.id || '',
        });
      }

      const result = await sendMomEmail(payload, type);
      const mom = type === 'lead'
        ? await persistAuthorizedLeadMom(request, {
            ...payload,
            calendarInviteSent: Boolean(result.calendarInviteSent),
          }, 'Sent')
        : null;
      response.json({ ok: true, ...result, ...(mom ? { mom } : {}) });
    } catch (error) {
      response.status(error.statusCode || 500).json({
        ok: false,
        code: error.code || 'email_failed',
        message: error.statusCode === 400
          ? error.message
          : 'Email delivery failed. Please try again later.',
      });
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

registerPostmanTestResetRoute({
  app,
  env: process.env,
  requireJwt: requireSupabaseJwt,
  requireAdmin: requirePostmanTestResetAdmin,
  resetHandler: createPostmanTestResetHandler({
    getClient: requireServiceRoleSupabase,
  }),
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
      isDemoReadOnly: isDemoReadOnlyIdentity(user),
    },
  });
});

function faultTrackerKey(value) {
  return String(value || '').trim().toUpperCase().replace(/[^A-Z0-9]+/g, '');
}

async function requireLeadMomAccess(request, response, next) {
  try {
    const leadId = String(
      request.params?.leadId
      || request.body?.leadId
      || request.body?.lead_id
      || '',
    ).trim();
    if (!leadId) {
      response.status(400).json({ ok: false, code: 'lead_id_required', message: 'A lead reference is required.' });
      return;
    }
    const client = requireServiceRoleSupabase();
    const [leadResult, contactsResult] = await Promise.all([
      client.from('leads').select('*').eq('id', leadId).maybeSingle(),
      client.from('lead_contacts').select('*').eq('lead_id', leadId).order('created_at', { ascending: true }),
    ]);
    if (leadResult.error) throw leadResult.error;
    if (!leadResult.data) {
      response.status(404).json({ ok: false, code: 'lead_not_found', message: 'Lead not found.' });
      return;
    }
    if (contactsResult.error) throw contactsResult.error;
    if (!canManageLeadMom(request.leadActor, leadResult.data)) {
      response.status(403).json({
        ok: false,
        code: 'lead_mom_access_denied',
        message: 'You do not have permission to send MOM for this lead.',
      });
      return;
    }
    request.authorizedLead = leadResult.data;
    request.authorizedLeadContacts = contactsResult.data || [];
    next();
  } catch (error) {
    safeLeadError(response, error);
  }
}

function faultTrackerRoleKey(profile) {
  return faultTrackerKey(profile?.role);
}

const FAULT_TRACKER_MANAGE_ROLE_KEYS = new Set([
  'ADMIN',
  'QPMSADMIN',
  'DEVELOPER',
  'DEV',
  'ITADMIN',
  'MANAGEMENTITADMIN',
]);

const FAULT_TRACKER_READ_ALL_ROLE_KEYS = new Set([
  ...FAULT_TRACKER_MANAGE_ROLE_KEYS,
  'DEMOVIEWER',
  'COO',
  'IFMSSOUTHHEAD',
  'SOUTHHEAD',
  'OPERATIONMANAGER',
  'OPERATIONSMANAGER',
  'OPSMANAGER',
  'BRANCHHEAD',
]);

const FAULT_TRACKER_STATE_RESTRICTED_ROLE_KEYS = new Set(['PROJECTCOORDINATOR', 'MIS']);

function faultTrackerCanAccess(profile) {
  if (isDemoUser(profile)) return true;
  const roleKey = faultTrackerRoleKey(profile);
  return FAULT_TRACKER_READ_ALL_ROLE_KEYS.has(roleKey) || FAULT_TRACKER_STATE_RESTRICTED_ROLE_KEYS.has(roleKey);
}

function faultTrackerCanManage(profile) {
  if (isDemoUser(profile)) return false;
  return FAULT_TRACKER_MANAGE_ROLE_KEYS.has(faultTrackerRoleKey(profile));
}

function faultTrackerCanReadAll(profile) {
  if (isDemoUser(profile)) return true;
  return FAULT_TRACKER_READ_ALL_ROLE_KEYS.has(faultTrackerRoleKey(profile));
}

function faultTrackerStateCode(value) {
  const key = faultTrackerKey(value);
  const stateMap = {
    TN: 'TN',
    TAMILNADU: 'TN',
    ROTN: 'TN',
    KL: 'KL',
    KERALA: 'KL',
    KERALA1: 'KL',
    KERALA2: 'KL',
    KA: 'KN',
    KN: 'KN',
    KARNATAKA: 'KN',
    KARNATAKA1: 'KN',
    KARNATAKA2: 'KN',
    KARNATAKA3: 'KN',
    TG: 'TG',
    TELANGANA: 'TG',
    TELANGANA1: 'TG',
    TELANGANA2: 'TG',
    AP1: 'AP1',
    ANDHRAPRADESH1: 'AP1',
    AP2: 'AP2',
    ANDHRAPRADESH2: 'AP2',
  };
  return stateMap[key] || '';
}

function faultTrackerCategoryGroup(value) {
  const key = faultTrackerKey(value);
  if (['HK', 'HOUSEKEEPING', 'HOUSEKEEP'].includes(key)) return 'HK';
  if (['PC', 'PESTCONTROL', 'PEST'].includes(key)) return 'PC';
  return key ? 'OTHER' : null;
}

function faultTrackerStageGroup(value) {
  const key = faultTrackerKey(value);
  if (!key) return null;
  if (key.includes('CLOSED') || key.includes('SETOFF')) return 'Closed';
  if (key.includes('COMPLETED') || key.includes('DOCUMENTSRECEIVED') || key.includes('JMSCREATED') || key.includes('INVOICERAISED')) return 'Completed';
  if (key.includes('VERIFY') || key.includes('VERIFICATION')) return 'Need Verification';
  if (key.includes('MATERIAL')) return 'Material Pending';
  if (key.includes('VENDOR')) return 'Vendor Pending';
  if (key.includes('CLIENT')) return 'Client Pending';
  if (key.includes('WORKINPROGRESS') || key.includes('INPROGRESS')) return 'In Progress';
  return 'Pending';
}

function faultTrackerTimestamp(value) {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function faultTrackerInteger(value) {
  const parsed = Number.parseInt(String(value ?? '').replace(/,/g, '').trim(), 10);
  return Number.isFinite(parsed) ? parsed : null;
}

function faultTrackerText(value) {
  const text = String(value ?? '').trim();
  return text || null;
}

function faultTrackerTicketPayload(ticket, importBatchId) {
  const stateCode = faultTrackerStateCode(ticket.state_code || ticket.stateCode || ticket.groupedState || ticket.state_label || ticket.state);
  const category = faultTrackerText(ticket.category);
  const stage = faultTrackerText(ticket.stage || ticket.ifmsStage || ticket.status);
  const ticketNo = faultTrackerText(ticket.ticket_no || ticket.ticketNo || ticket.ticketNumber);
  const metadata = ticket.metadata && typeof ticket.metadata === 'object' ? ticket.metadata : {};
  if (!ticketNo) return null;
  return {
    import_batch_id: importBatchId,
    ticket_no: ticketNo,
    created_at_source: faultTrackerTimestamp(ticket.created_at_source || ticket.createdAt),
    updated_at_source: faultTrackerTimestamp(ticket.updated_at_source || ticket.updatedAt),
    store_code: faultTrackerText(ticket.store_code || ticket.storeCode || ticket.storeId),
    store_name: faultTrackerText(ticket.store_name || ticket.storeName),
    city: faultTrackerText(ticket.city),
    state_code: stateCode || null,
    state_label: faultTrackerText(ticket.state_label || ticket.state || ticket.groupedState),
    category,
    category_group: faultTrackerText(ticket.category_group || ticket.categoryGroup) || faultTrackerCategoryGroup(category),
    stage,
    stage_group: faultTrackerText(ticket.stage_group || ticket.stageGroup) || faultTrackerStageGroup(stage),
    ageing_days: faultTrackerInteger(ticket.ageing_days ?? ticket.ageingDays),
    ageing_bucket: faultTrackerText(ticket.ageing_bucket || ticket.ageingBucket),
    supervisor_name: faultTrackerText(ticket.supervisor_name || ticket.supervisorName || ticket.supName),
    supervisor_employee_code: faultTrackerText(ticket.supervisor_employee_code || ticket.supervisorEmployeeCode),
    supervisor_mobile: faultTrackerText(ticket.supervisor_mobile || ticket.supervisorMobile),
    supervisor_email: faultTrackerText(ticket.supervisor_email || ticket.supervisorEmail),
    vendor_name: faultTrackerText(ticket.vendor_name || ticket.vendorName || ticket.actualVendor || ticket.serviceVendor),
    vendor_code: faultTrackerText(ticket.vendor_code || ticket.vendorCode),
    remarks: faultTrackerText(ticket.remarks),
    raw_row: ticket.raw_row || ticket.rawRow || ticket,
    metadata: {
      ...metadata,
      subCategory: faultTrackerText(ticket.subCategory) || metadata.subCategory || null,
      issueType: faultTrackerText(ticket.issueType) || metadata.issueType || null,
      issueTitle: faultTrackerText(ticket.issueTitle) || metadata.issueTitle || null,
      lastUpdatedBy: faultTrackerText(ticket.lastUpdatedBy) || metadata.lastUpdatedBy || null,
    },
    is_active: ticket.is_active !== false,
  };
}

function serializeStoreMasterRowForProfile(row, linkedSiteVisits = 0, profile = {}) {
  const serialized = serializeStoreMasterRow(row, linkedSiteVisits);
  if (!isDemoUser(profile)) return serialized;
  return sanitizeDemoRecord(serialized, ['created_by_full_name']);
}

function faultTrackerHttpError(statusCode, code, message, details = null) {
  const error = new Error(message);
  error.statusCode = statusCode;
  error.code = code;
  if (details) error.details = details;
  return error;
}

async function cleanupFaultTrackerImportBatch(client, importBatchId) {
  if (!importBatchId) return;
  const { error } = await client
    .from('fault_tracker_import_batches')
    .delete()
    .eq('id', importBatchId);
  if (error) throw error;
}

function logFaultTrackerDbError(endpoint, table, action, error, extra = {}) {
  console.error('[Fault Tracker] database query failed', {
    endpoint,
    table,
    action,
    usingServiceRoleClient: true,
    code: error?.code || null,
    message: error?.message || null,
    details: error?.details || null,
    ...extra,
  });
}

function requireFaultTrackerAccess(request, response, next) {
  if (!faultTrackerCanAccess(request.profile)) {
    response.status(403).json({ ok: false, message: 'Your profile cannot access Fault Tracker.' });
    return;
  }
  next();
}

function requireFaultTrackerManage(request, response, next) {
  if (!faultTrackerCanManage(request.profile)) {
    response.status(403).json({ ok: false, message: 'Only Admin / Developer can import Fault Tracker dumps.' });
    return;
  }
  next();
}

function respondFaultTrackerError(response, error) {
  const safeError = safeServiceRoleError(error, 'fault_tracker_database_access_failed');
  console.error('[Fault Tracker] request failed', {
    message: error?.message || safeError.message || null,
    code: error?.code || safeError.code || null,
    statusCode: error?.statusCode || safeError.statusCode || null,
    diagnosticReason: safeError.diagnosticReason || null,
    details: error?.details || null,
  });
  const payload = {
    ok: false,
    message: error?.message || safeError.message || 'Fault Tracker request failed.',
    code: error?.code || safeError.code || 'fault_tracker_request_failed',
    diagnosticReason: safeError.diagnosticReason,
  };
  if (error?.details) payload.details = error.details;
  response.status(error?.statusCode || safeError.statusCode || 500).json(payload);
}

app.get('/api/fault-tracker/imports', requireSupabaseJwtOrDemoApiRead, requireFaultTrackerAccess, async (request, response) => {
  try {
    const client = requireServiceRoleSupabase();
    console.log('[Fault Tracker] imports list route hit', {
      auth_user_id: request.authUser?.id || null,
      employee_code: request.employeeCode || null,
      role: request.profile?.role || null,
      state: request.profile?.state || null,
    });
    const { data, error } = await client
      .from('fault_tracker_import_batches')
      .select('*')
      .order('imported_at', { ascending: false })
      .limit(Math.min(50, Math.max(1, Number.parseInt(request.query.limit || '20', 10) || 20)));
    if (error) {
      logFaultTrackerDbError('GET /api/fault-tracker/imports', 'fault_tracker_import_batches', 'select_imports', error);
      throw error;
    }
    const imports = isDemoUser(request.profile)
      ? (data || []).map((row) => sanitizeDemoRecord(row, ['metadata']))
      : data || [];
    response.json({ ok: true, imports });
  } catch (error) {
    respondFaultTrackerError(response, error);
  }
});

app.get('/api/fault-tracker/tickets', requireSupabaseJwtOrDemoApiRead, requireFaultTrackerAccess, async (request, response) => {
  try {
    const client = requireServiceRoleSupabase();
    const roleCanReadAll = faultTrackerCanReadAll(request.profile);
    const mappedState = faultTrackerStateCode(request.profile?.state);
    console.log('[Fault Tracker] tickets route hit', {
      auth_user_id: request.authUser?.id || null,
      employee_code: request.employeeCode || null,
      role: request.profile?.role || null,
      state: request.profile?.state || null,
      roleCanReadAll,
      mappedState: mappedState || null,
      query: {
        latest: request.query.latest || null,
        import_batch_id: request.query.import_batch_id || null,
        state: request.query.state || null,
      },
    });
    if (!roleCanReadAll && !mappedState) {
      response.status(403).json({
        ok: false,
        code: 'state_mapping_missing',
        message: 'State mapping not configured for your profile. Please contact Admin.',
      });
      return;
    }

    let importBatchId = faultTrackerText(request.query.import_batch_id);
    if (!importBatchId || request.query.latest === 'true') {
      const { data: latestBatches, error: batchError } = await client
        .from('fault_tracker_import_batches')
        .select('*')
        .order('imported_at', { ascending: false })
        .limit(1);
      if (batchError) {
        logFaultTrackerDbError('GET /api/fault-tracker/tickets', 'fault_tracker_import_batches', 'select_latest_batch', batchError);
        throw batchError;
      }
      const latestBatch = Array.isArray(latestBatches) ? latestBatches[0] : null;
      importBatchId = latestBatch?.id || null;
      if (!importBatchId) {
        response.json({ ok: true, import_batch: null, tickets: [] });
        return;
      }
    }

    const buildTicketQuery = () => {
      let query = client
        .from('fault_tracker_tickets')
        .select('*')
        .eq('import_batch_id', importBatchId)
        .eq('is_active', true)
        .order('created_at_source', { ascending: false, nullsFirst: false });

      if (roleCanReadAll) {
        const state = faultTrackerStateCode(request.query.state);
        if (state) query = query.eq('state_code', state);
      } else {
        query = query.eq('state_code', mappedState);
      }

      const stage = faultTrackerText(request.query.stage);
      if (stage) query = query.eq('stage', stage);
      const ageingBucket = faultTrackerText(request.query.ageing_bucket);
      if (ageingBucket) query = query.eq('ageing_bucket', ageingBucket);
      const category = faultTrackerText(request.query.category);
      if (category) query = query.eq('category_group', category);
      const supervisor = faultTrackerText(request.query.supervisor);
      if (supervisor) query = query.eq('supervisor_name', supervisor);
      const month = faultTrackerText(request.query.month);
      if (month && /^\d{4}-\d{2}$/.test(month)) {
        query = query
          .gte('created_at_source', `${month}-01T00:00:00.000Z`)
          .lt('created_at_source', new Date(Date.UTC(Number(month.slice(0, 4)), Number(month.slice(5, 7)), 1)).toISOString());
      }
      const search = faultTrackerText(request.query.search);
      if (search) {
        const safeSearch = search.replace(/[%(),]/g, ' ');
        query = query.or(`ticket_no.ilike.%${safeSearch}%,store_code.ilike.%${safeSearch}%,store_name.ilike.%${safeSearch}%,supervisor_name.ilike.%${safeSearch}%,remarks.ilike.%${safeSearch}%`);
      }
      return query;
    };

    const tickets = [];
    const pageSize = 1000;
    for (let from = 0; from < 50000; from += pageSize) {
      const to = from + pageSize - 1;
      const { data: pageTickets, error: ticketsError } = await buildTicketQuery().range(from, to);
      if (ticketsError) {
        logFaultTrackerDbError('GET /api/fault-tracker/tickets', 'fault_tracker_tickets', 'select_tickets', ticketsError, {
          import_batch_id: importBatchId,
          range_from: from,
          range_to: to,
        });
        throw ticketsError;
      }
      tickets.push(...(pageTickets || []));
      if (!pageTickets || pageTickets.length < pageSize) break;
    }
    const { data: importBatches, error: importBatchError } = await client
      .from('fault_tracker_import_batches')
      .select('*')
      .eq('id', importBatchId)
      .limit(1);
    if (importBatchError) {
      logFaultTrackerDbError('GET /api/fault-tracker/tickets', 'fault_tracker_import_batches', 'select_import_batch', importBatchError, {
        import_batch_id: importBatchId,
      });
      throw importBatchError;
    }
    const importBatch = Array.isArray(importBatches) ? importBatches[0] : null;
    response.json({
      ok: true,
      import_batch: isDemoUser(request.profile) ? sanitizeDemoRecord(importBatch || null, ['metadata']) : importBatch || null,
      tickets: isDemoUser(request.profile) ? (tickets || []).map((row) => sanitizeDemoRecord(row)) : tickets || [],
    });
  } catch (error) {
    respondFaultTrackerError(response, error);
  }
});

app.post('/api/fault-tracker/import', requireSupabaseJwtOrDemoApiRead, requireFaultTrackerManage, async (request, response) => {
  let createdBatchId = null;
  try {
    const client = requireServiceRoleSupabase();
    console.log('[Fault Tracker] import route hit', {
      auth_user_id: request.authUser?.id || null,
      employee_code: request.employeeCode || null,
      role: request.profile?.role || null,
      state: request.profile?.state || null,
      submitted_rows: Array.isArray(request.body?.tickets) ? request.body.tickets.length : null,
      file_name: request.body?.file_name || null,
    });
    if (!request.body || typeof request.body !== 'object') {
      throw faultTrackerHttpError(400, 'invalid_import_payload', 'Request body is required.');
    }
    if (!Array.isArray(request.body.tickets)) {
      throw faultTrackerHttpError(400, 'invalid_import_payload', 'tickets must be an array.');
    }
    const tickets = request.body.tickets;
    if (!tickets.length) {
      throw faultTrackerHttpError(400, 'invalid_import_payload', 'tickets must contain at least one row.');
    }
    if (tickets.length > 20000) {
      throw faultTrackerHttpError(400, 'invalid_import_payload', 'A single import can contain at most 20,000 tickets.');
    }

    const validationBatchId = '00000000-0000-0000-0000-000000000000';
    const rowsByTicketNo = new Map();
    let invalidRowCount = 0;
    for (const ticket of tickets) {
      const row = faultTrackerTicketPayload(ticket, validationBatchId);
      if (!row?.ticket_no) {
        invalidRowCount += 1;
        continue;
      }
      rowsByTicketNo.set(row.ticket_no, row);
    }
    const validatedRows = Array.from(rowsByTicketNo.values());
    if (!validatedRows.length) {
      throw faultTrackerHttpError(400, 'no_valid_tickets', 'No valid ticket rows were found. ticket_no is required.');
    }

    const { data: batch, error: batchError } = await client
      .from('fault_tracker_import_batches')
      .insert({
        uploaded_by_auth_user_id: request.authUser?.id || null,
        uploaded_by_employee_code: request.employeeCode,
        uploaded_by_name: request.profile?.full_name || request.profile?.display_name || request.profile?.email || null,
        uploaded_by_role: request.profile?.role || null,
        source_name: 'Reliance Retail IFMS',
        original_file_name: faultTrackerText(request.body?.file_name),
        sheet_name: faultTrackerText(request.body?.sheet_name) || 'Pending Tickets',
        ticket_count: validatedRows.length,
        metadata: {
          ...(request.body?.metadata && typeof request.body.metadata === 'object' ? request.body.metadata : {}),
          submitted_rows: tickets.length,
          valid_rows: validatedRows.length,
          invalid_rows_skipped: invalidRowCount,
          duplicate_ticket_rows_collapsed: tickets.length - invalidRowCount - validatedRows.length,
        },
      })
      .select('*')
      .single();
    if (batchError) {
      logFaultTrackerDbError('POST /api/fault-tracker/import', 'fault_tracker_import_batches', 'insert_import_batch', batchError);
      throw batchError;
    }
    createdBatchId = batch.id;

    const rows = validatedRows.map((row) => ({
      ...row,
      import_batch_id: batch.id,
    }));

    let insertedCount = 0;
    try {
      for (let index = 0; index < rows.length; index += 500) {
        const chunk = rows.slice(index, index + 500);
        const { error } = await client
          .from('fault_tracker_tickets')
          .insert(chunk);
        if (error) {
          logFaultTrackerDbError('POST /api/fault-tracker/import', 'fault_tracker_tickets', 'insert_ticket_chunk', error, {
            chunk_start: index,
            chunk_size: chunk.length,
          });
          throw faultTrackerHttpError(500, 'ticket_insert_failed', 'Fault Tracker ticket insert failed.', {
            chunk_start: index,
            chunk_size: chunk.length,
            database_code: error.code || null,
            database_message: error.message || null,
          });
        }
        insertedCount += chunk.length;
      }

      if (insertedCount !== rows.length) {
        throw faultTrackerHttpError(500, 'ticket_insert_failed', 'Fault Tracker import inserted fewer tickets than expected.', {
          expected: rows.length,
          inserted: insertedCount,
        });
      }

      const { data: updatedBatch, error: updateError } = await client
        .from('fault_tracker_import_batches')
        .update({ ticket_count: insertedCount })
        .eq('id', batch.id)
        .select('*')
        .single();
      if (updateError) {
        logFaultTrackerDbError('POST /api/fault-tracker/import', 'fault_tracker_import_batches', 'update_ticket_count', updateError, {
          import_batch_id: batch.id,
        });
        throw faultTrackerHttpError(500, 'ticket_insert_failed', 'Fault Tracker import finalization failed.', {
          database_code: updateError.code || null,
          database_message: updateError.message || null,
        });
      }

      console.log('[Fault Tracker] import completed', {
        import_batch_id: batch.id,
        ticket_count: insertedCount,
        submitted_rows: tickets.length,
        invalid_rows_skipped: invalidRowCount,
        duplicate_ticket_rows_collapsed: tickets.length - invalidRowCount - rows.length,
        uploaded_by_employee_code: request.employeeCode,
        uploaded_by_role: request.profile?.role || null,
        file_name: request.body?.file_name || null,
      });

      response.json({
        ok: true,
        import_batch_id: batch.id,
        import_batch: updatedBatch,
        ticket_count: insertedCount,
        imported_at: updatedBatch.imported_at,
        message: `${insertedCount} Fault Tracker tickets imported successfully.`,
      });
    } catch (importError) {
      try {
        await cleanupFaultTrackerImportBatch(client, batch.id);
        createdBatchId = null;
      } catch (cleanupError) {
        logFaultTrackerDbError('POST /api/fault-tracker/import', 'fault_tracker_import_batches', 'delete_failed_import_batch', cleanupError, {
          import_batch_id: batch.id,
        });
        throw faultTrackerHttpError(500, 'import_cleanup_failed', 'Fault Tracker import failed and cleanup also failed. Please contact Admin.', {
          import_batch_id: batch.id,
          original_code: importError.code || null,
          original_message: importError.message || null,
          cleanup_code: cleanupError.code || null,
          cleanup_message: cleanupError.message || null,
        });
      }
      throw importError;
    }
  } catch (error) {
    if (createdBatchId) {
      console.error('[Fault Tracker] import failed after batch creation without cleanup', {
        import_batch_id: createdBatchId,
        message: error.message,
        code: error.code || null,
      });
    }
    respondFaultTrackerError(response, error);
  }
});

app.get('/api/access/me', requireSupabaseJwtAllowMissingProfile, async (request, response) => {
  try {
    const client = requireServiceRoleSupabase();
    const result = await resolveCurrentUserAccess({
      client,
      authUser: request.authUser,
      profile: request.profile,
      requestedModule: request.query?.module,
      requestedPermission: request.query?.permission,
      requestedClientId: request.query?.client_id,
      requestedScopes: {
        client_id: request.query?.client_id,
        state: request.query?.state,
        branch: request.query?.branch,
        site: request.query?.site,
        store: request.query?.store,
        hospital_block: request.query?.hospital_block_id || request.query?.block_id,
        floor: request.query?.floor_id,
        department: request.query?.department_id,
        location: request.query?.location_id,
      },
    });
    if (result.ok === false) {
      response.status(403).json({
        ok: false,
        code: result.code || 'access_denied',
        message: result.message || 'Access is not available for this account.',
      });
      return;
    }
    response.json(accessResponseForClient(result));
  } catch (error) {
    const safeError = sanitizeSupabaseDiagnosticError(error);
    console.warn('[Access Control] Failed to resolve current access', {
      code: safeError.code,
      message: safeError.message,
    });
    response.status(error.statusCode || 500).json({
      ok: false,
      message: 'Unable to load account access.',
    });
  }
});

async function requireHospitalWebAccess(request, response, next) {
  try {
    const client = requireServiceRoleSupabase();
    const access = await resolveHospitalWebAccess({
      client,
      authUser: request.authUser,
      profile: request.profile,
    });
    if (!access.allowed) {
      response.status(access.status || 403).json({
        ok: false,
        code: access.code || 'hospital_web_access_denied',
        message: access.message || 'Hospital ticket dashboard access denied.',
      });
      return;
    }
    request.hospitalWebAccess = access;
    next();
  } catch (error) {
    const safeError = sanitizeSupabaseDiagnosticError(error);
    console.warn('[Hospital Web Tickets] Access resolution failed', {
      code: safeError.code,
      message: safeError.message,
    });
    response.status(error.statusCode || 500).json({
      ok: false,
      code: 'hospital_web_access_failed',
      message: 'Unable to verify Hospital Ticket dashboard access.',
    });
  }
}

app.get('/api/web/hospital-tickets/summary', requireSupabaseJwtAllowMissingProfile, requireHospitalWebAccess, async (request, response) => {
  try {
    const client = requireServiceRoleSupabase();
    const counts = await summarizeWebHospitalTickets(client, request.hospitalWebAccess, request.query || {});
    response.json({
      ok: true,
      counts,
      access: hospitalWebAccessResponse(request.hospitalWebAccess),
    });
  } catch (error) {
    const safeError = sanitizeSupabaseDiagnosticError(error);
    console.warn('[Hospital Web Tickets] Summary failed', {
      code: safeError.code,
      message: safeError.message,
    });
    response.status(error.statusCode || 500).json({
      ok: false,
      code: 'hospital_web_summary_failed',
      message: 'Unable to load Hospital Ticket summary.',
    });
  }
});

app.get('/api/web/hospital-tickets', requireSupabaseJwtAllowMissingProfile, requireHospitalWebAccess, async (request, response) => {
  try {
    const client = requireServiceRoleSupabase();
    const result = await listWebHospitalTickets(client, request.hospitalWebAccess, request.query || {});
    response.json({
      ok: true,
      ...result,
      access: hospitalWebAccessResponse(request.hospitalWebAccess),
    });
  } catch (error) {
    const safeError = sanitizeSupabaseDiagnosticError(error);
    console.warn('[Hospital Web Tickets] List failed', {
      code: safeError.code,
      message: safeError.message,
    });
    response.status(error.statusCode || 500).json({
      ok: false,
      code: 'hospital_web_list_failed',
      message: 'Unable to load Hospital Tickets.',
    });
  }
});

app.get('/api/web/hospital-tickets/:ticketId', requireSupabaseJwtAllowMissingProfile, requireHospitalWebAccess, async (request, response) => {
  try {
    const client = requireServiceRoleSupabase();
    const detail = await getWebHospitalTicketDetail(client, request.hospitalWebAccess, request.params.ticketId);
    response.json({
      ok: true,
      ...detail,
      access: hospitalWebAccessResponse(request.hospitalWebAccess),
    });
  } catch (error) {
    const safeError = sanitizeSupabaseDiagnosticError(error);
    console.warn('[Hospital Web Tickets] Detail failed', {
      code: safeError.code,
      message: safeError.message,
    });
    response.status(error.statusCode || 500).json({
      ok: false,
      code: error.statusCode === 404 ? 'hospital_ticket_not_found' : 'hospital_web_detail_failed',
      message: error.statusCode === 404 ? error.message : 'Unable to load Hospital Ticket details.',
    });
  }
});

async function selectAccessFoundationTable(client, table, columns = '*') {
  let query = client
    .from(table)
    .select(columns);
  if (!['access_business_vertical_modules', 'access_client_modules'].includes(table)) {
    query = query.order('name', { ascending: true });
  }
  const { data, error } = await query;
  if (error) {
    const text = `${error.code || ''} ${error.message || ''}`.toLowerCase();
    if (
      error.code === '42P01' ||
      error.code === 'PGRST205' ||
      text.includes('could not find the table') ||
      text.includes('does not exist') ||
      text.includes('schema cache')
    ) {
      return { available: false, rows: [] };
    }
    throw error;
  }
  return { available: true, rows: data || [] };
}

app.get(
  '/api/access/foundation',
  requireSupabaseJwt,
  requireUserManagementPermission,
  async (request, response) => {
    try {
      const client = requireServiceRoleSupabase();
      const [
        businessVerticals,
        clients,
        modules,
        verticalModules,
        clientModules,
        roles,
        permissions,
      ] = await Promise.all([
        selectAccessFoundationTable(client, 'access_business_verticals', 'id,code,name,active'),
        selectAccessFoundationTable(client, 'access_clients', 'id,business_vertical_id,code,name,client_type,active'),
        selectAccessFoundationTable(client, 'access_modules', 'id,code,name,application_target,active'),
        selectAccessFoundationTable(client, 'access_business_vertical_modules', 'business_vertical_id,module_id,enabled,effective_from,effective_to'),
        selectAccessFoundationTable(client, 'access_client_modules', 'client_id,module_id,enabled,effective_from,effective_to'),
        selectAccessFoundationTable(client, 'access_roles', 'id,code,name,user_type,module_id,active'),
        selectAccessFoundationTable(client, 'access_permissions', 'id,code,name,module_id,action,resource,active'),
      ]);
      const available = [
        businessVerticals,
        clients,
        modules,
        verticalModules,
        clientModules,
        roles,
        permissions,
      ].every((result) => result.available);
      response.json({
        ok: true,
        available,
        feature_gated: !available,
        business_verticals: businessVerticals.rows,
        clients: clients.rows,
        modules: modules.rows,
        business_vertical_modules: verticalModules.rows,
        client_modules: clientModules.rows,
        roles: roles.rows,
        permissions: permissions.rows,
        scope_types: [
          'global',
          'business_vertical',
          'client',
          'all_client',
          'state',
          'branch',
          'site',
          'store',
          'hospital_block',
          'floor',
          'location',
          'department',
          'assigned_ticket',
          'employee_self',
        ],
      });
    } catch (error) {
      const safeError = sanitizeSupabaseDiagnosticError(error);
      console.warn('[Access Control] Failed to load foundation options', {
        code: safeError.code,
        message: safeError.message,
      });
      response.status(error.statusCode || 500).json({
        ok: false,
        message: 'Unable to load access foundation options.',
      });
    }
  },
);

app.get(
  '/api/access/scope-options',
  requireSupabaseJwt,
  requireUserManagementPermission,
  async (request, response) => {
    try {
      const client = requireServiceRoleSupabase();
      const scopeType = accessCode(request.query.scope_type);
      const clientId = textOrNull(request.query.client_id);
      const options = [];
      if (['global', 'business_vertical', 'client', 'all_client', 'employee_self'].includes(scopeType)) {
        response.json({ ok: true, options });
        return;
      }

      let selectedClient = null;
      if (clientId) {
        const { data, error } = await client
          .from('access_clients')
          .select('id,code,name,metadata')
          .eq('id', clientId)
          .maybeSingle();
        if (error) throw error;
        selectedClient = data || null;
      }
      const legacyHospitalClientId = selectedClient?.metadata?.legacy_hospital_client_id || null;

      if (scopeType === 'state') {
        const [profiles, stores] = await Promise.all([
          client.from('profiles').select('state').not('state', 'is', null).limit(5000),
          client.from('store_master').select('state').not('state', 'is', null).limit(5000),
        ]);
        if (profiles.error) throw profiles.error;
        if (stores.error) throw stores.error;
        const states = Array.from(new Set([...(profiles.data || []), ...(stores.data || [])]
          .map((row) => textOrNull(row.state))
          .filter(Boolean)))
          .sort();
        response.json({ ok: true, options: states.map((state) => ({ id: null, code: state, label: state })) });
        return;
      }

      if (scopeType === 'store') {
        let query = client.from('store_master').select('id,store_code,store_name,state,client_name,business').limit(1000);
        if (selectedClient?.code === 'reliance_retail') {
          query = query.or('business.ilike.%reliance%,client_name.ilike.%reliance%');
        }
        const { data, error } = await query;
        if (error) throw error;
        response.json({
          ok: true,
          options: (data || []).map((row) => ({
            id: row.id,
            code: row.store_code || null,
            label: [row.store_code, row.store_name, row.state].filter(Boolean).join(' - '),
          })),
        });
        return;
      }

      if (scopeType === 'hospital_block') {
        let query = client.from('hospital_blocks').select('id,block_code,block_name,name,is_active').eq('is_active', true).limit(1000);
        if (legacyHospitalClientId) query = query.eq('client_id', legacyHospitalClientId);
        const { data, error } = await query;
        if (error) throw error;
        response.json({
          ok: true,
          options: (data || []).map((row) => ({
            id: row.id,
            code: row.block_code || null,
            label: row.block_name || row.name || row.block_code || row.id,
          })),
        });
        return;
      }

      if (scopeType === 'location') {
        let query = client.from('hospital_locations').select('id,location_code,location_name,name,complete_location_path,is_active').eq('is_active', true).limit(1000);
        if (legacyHospitalClientId) query = query.eq('client_id', legacyHospitalClientId);
        const { data, error } = await query;
        if (error) throw error;
        response.json({
          ok: true,
          options: (data || []).map((row) => ({
            id: row.id,
            code: row.location_code || null,
            label: row.complete_location_path || row.location_name || row.name || row.location_code || row.id,
          })),
        });
        return;
      }

      if (scopeType === 'department') {
        let query = client.from('hospital_departments').select('id,department_code,department_name,name,is_active').eq('is_active', true).limit(1000);
        if (legacyHospitalClientId) query = query.eq('client_id', legacyHospitalClientId);
        const { data, error } = await query;
        if (error) throw error;
        response.json({
          ok: true,
          options: (data || []).map((row) => ({
            id: row.id,
            code: row.department_code || null,
            label: row.department_name || row.name || row.department_code || row.id,
          })),
        });
        return;
      }

      if (['branch', 'site'].includes(scopeType)) {
        response.json({ ok: true, options: [] });
        return;
      }

      response.status(400).json({ ok: false, message: 'Unsupported scope type.' });
    } catch (error) {
      const safeError = sanitizeSupabaseDiagnosticError(error);
      console.warn('[Access Control] Failed to load scope options', {
        code: safeError.code,
        message: safeError.message,
      });
      response.status(error.statusCode || 500).json({
        ok: false,
        message: 'Unable to load scope options.',
      });
    }
  },
);

app.get('/api/profile/me', requireSupabaseJwt, (request, response) => {
  response.json({
    ok: true,
    profile: request.profile,
    profile_completed: calculateProfileCompletion(request.profile),
  });
});

async function updateOwnProfile(request, response) {
  try {
    const client = requireServiceRoleSupabase();
    const patch = selfProfilePatchPayload(request.body || {}, request.profile);
    if (!Object.keys(patch).length) {
      throw userManagementHttpError(400, 'No supported profile fields were supplied.');
    }
    const { data, error } = await client
      .from('profiles')
      .update({
        ...patch,
        updated_at: new Date().toISOString(),
      })
      .eq('id', request.profile.id)
      .eq('auth_user_id', request.authUser.id)
      .select(USER_MANAGEMENT_PROFILE_SELECT)
      .single();
    if (error) throw error;

    if (data.auth_user_id) {
      try {
        await client.auth.admin.updateUserById(data.auth_user_id, {
          user_metadata: profileMetadataForAuth(data),
        });
      } catch (authSyncError) {
        console.warn('[myQPMS profile] Auth metadata sync failed', safeAuthError(authSyncError));
      }
    }

    response.json({
      ok: true,
      profile: data,
      profile_completed: data.metadata?.profile_completed || calculateProfileCompletion(data),
    });
  } catch (error) {
    respondUserManagementError(response, error);
  }
}

app.put('/api/profile/me', requireSupabaseJwt, updateOwnProfile);
app.patch('/api/profile/me', requireSupabaseJwt, updateOwnProfile);

app.post('/api/profile/password-setup-complete', requireSupabaseJwt, async (request, response) => {
  try {
    const client = requireServiceRoleSupabase();
    const completedAt = new Date().toISOString();
    const metadata = {
      ...currentProfileMetadata(request.profile),
      invite_status: 'accepted',
      invite_accepted_at: completedAt,
      password_setup_completed_at: completedAt,
    };
    const { data, error } = await client
      .from('profiles')
      .update({
        requires_password_change: false,
        metadata,
        last_profile_sync_at: completedAt,
      })
      .eq('id', request.profile.id)
      .eq('auth_user_id', request.authUser.id)
      .select('employee_code,full_name,requires_password_change,metadata')
      .single();
    if (error) throw error;
    response.json({
      ok: true,
      employee_code: data.employee_code,
      full_name: data.full_name,
      requires_password_change: data.requires_password_change,
      metadata: data.metadata,
    });
  } catch (error) {
    respondUserManagementError(response, error);
  }
});

app.post('/api/profile/avatar', requireSupabaseJwt, async (request, response) => {
  try {
    const client = requireServiceRoleSupabase();
    const allowedAvatarTypes = new Set(['image/jpeg', 'image/png', 'image/webp']);
    const maxAvatarBytes = 2 * 1024 * 1024;
    const fileName = textOrNull(request.body?.fileName) || 'avatar.png';
    const contentType = textOrNull(request.body?.contentType) || 'image/png';
    const fileSize = Number(request.body?.fileSize || 0);
    if (!allowedAvatarTypes.has(contentType)) {
      throw userManagementHttpError(400, 'Profile avatar must be a JPG, PNG, or WebP image.');
    }
    if (!Number.isFinite(fileSize) || fileSize < 1 || fileSize > maxAvatarBytes) {
      throw userManagementHttpError(400, 'Profile avatar image must be 2 MB or smaller.');
    }
    const bucket = textOrNull(process.env.SUPABASE_PROFILE_AVATAR_BUCKET) || 'profile-avatars';
    const safeFileName = fileName.replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 120) || 'avatar.png';
    const path = `avatars/${request.authUser.id}/${Date.now()}_${safeFileName}`;
    const { data, error } = await client.storage.from(bucket).createSignedUploadUrl(path, {
      upsert: true,
      contentType,
    });
    if (error) {
      response.status(503).json({
        ok: false,
        message: 'Profile avatar storage bucket is not configured.',
        todo: `Apply supabase/migrations_2_0/012_profile_avatar_storage.sql or create bucket ${bucket}.`,
      });
      return;
    }
    response.json({
      ok: true,
      bucket,
      path,
      token: data.token,
      signedUrl: data.signedUrl,
      publicUrl: client.storage.from(bucket).getPublicUrl(path).data.publicUrl,
    });
  } catch (error) {
    respondUserManagementError(response, error);
  }
});

app.get('/api/store-master', requireSupabaseJwtOrDemoApiRead, requireStoreMasterPermission, async (request, response) => {
  try {
    const client = requireServiceRoleSupabase();
    const page = Math.max(1, Number.parseInt(String(request.query.page || '1'), 10) || 1);
    const isExportRequest = /^true$/i.test(String(request.query.exportAll || ''));
    const maxLimit = isExportRequest ? 1000 : 100;
    const limit = Math.min(maxLimit, Math.max(1, Number.parseInt(String(request.query.limit || '10'), 10) || 10));
    const from = (page - 1) * limit;
    const to = from + limit - 1;
    const search = textOrNull(request.query.search);
    const state = textOrNull(request.query.state);
    const business = textOrNull(request.query.business);
    const clientName = textOrNull(request.query.client);
    const gpsStatus = textOrNull(request.query.gpsStatus);

    let query = client
      .from('store_master')
      .select(STORE_MASTER_SELECT, { count: 'exact' })
      .range(from, to);
    if (isExportRequest) {
      query = query.order('created_at', { ascending: true, nullsFirst: false }).order('id', { ascending: true });
    } else {
      query = query.order('updated_at', { ascending: false }).order('id', { ascending: true });
    }
    if (search) {
      const safeSearch = search.replace(/[,%]/g, ' ').trim();
      query = query.or(
        `store_name.ilike.%${safeSearch}%,store_code.ilike.%${safeSearch}%,client_name.ilike.%${safeSearch}%,business.ilike.%${safeSearch}%,state.ilike.%${safeSearch}%,metadata->>site_name.ilike.%${safeSearch}%`,
      );
    }
    if (state && state !== 'All States') query = query.eq('state', state);
    if (business && business !== 'All Business') query = query.eq('business', business);
    if (clientName && clientName !== 'All Clients') query = query.eq('client_name', clientName);
    if (/available/i.test(gpsStatus || '')) {
      query = query.not('latitude', 'is', null).not('longitude', 'is', null);
    } else if (/missing/i.test(gpsStatus || '')) {
      query = query.or('latitude.is.null,longitude.is.null');
    }

    const { data, error, count } = await query;
    if (error) throw error;
    const ids = (data || []).map((row) => row.id).filter(Boolean);
    const linkedCounts = new Map();
    if (ids.length) {
      const { data: visits, error: visitsError } = await client
        .from('fo_site_visits')
        .select('id,store_id')
        .in('store_id', ids)
        .limit(10000);
      if (visitsError) throw visitsError;
      for (const visit of visits || []) {
        linkedCounts.set(visit.store_id, (linkedCounts.get(visit.store_id) || 0) + 1);
      }
    }

    const { data: optionRows, error: optionError } = await client
      .from('store_master')
      .select('state,business,client_name,status,latitude,longitude')
      .limit(10000);
    if (optionError) throw optionError;
    const optionValues = (field) =>
      Array.from(new Set((optionRows || []).map((row) => textOrNull(row[field])).filter(Boolean))).sort();
    const states = optionValues('state');
    const filteredTotal = count || 0;
    const totalStores = (optionRows || []).length;
    const activeStores = (optionRows || []).filter((row) => /^active$/i.test(String(row.status || 'Active'))).length;
    const gpsAvailable = (optionRows || []).filter((row) => row.latitude !== null && row.longitude !== null).length;

    response.json({
      ok: true,
      rows: (data || []).map((row) => serializeStoreMasterRowForProfile(row, linkedCounts.get(row.id) || 0, request.profile)),
      pagination: {
        page,
        limit,
        total: filteredTotal,
        from: filteredTotal ? from + 1 : 0,
        to: Math.min(from + limit, filteredTotal),
      },
      filterOptions: {
        states,
        businesses: optionValues('business'),
        clients: optionValues('client_name'),
      },
      summary: {
        totalStores,
        activeStores,
        gpsAvailable,
        gpsMissing: Math.max(0, totalStores - gpsAvailable),
        statesCovered: states.length,
      },
    });
  } catch (error) {
    storeMasterErrorResponse(response, error);
  }
});

app.get('/api/store-master/:id', requireSupabaseJwtOrDemoApiRead, requireStoreMasterPermission, async (request, response) => {
  try {
    const client = requireServiceRoleSupabase();
    const { data, error } = await client
      .from('store_master')
      .select(STORE_MASTER_SELECT)
      .eq('id', request.params.id)
      .maybeSingle();
    if (error) throw error;
    if (!data) throw userManagementHttpError(404, 'Store not found.');
    const { count, error: countError } = await client
      .from('fo_site_visits')
      .select('id', { count: 'exact', head: true })
      .eq('store_id', data.id);
    if (countError) throw countError;
    response.json({ ok: true, row: serializeStoreMasterRowForProfile(data, count || 0, request.profile) });
  } catch (error) {
    storeMasterErrorResponse(response, error);
  }
});

app.post('/api/store-master', requireSupabaseJwtOrDemoApiRead, requireStoreMasterPermission, async (request, response) => {
  try {
    const client = requireServiceRoleSupabase();
    const payload = buildStoreMasterPayload(request.body || {}, null, request.profile);
    const storeCode = textOrNull(payload.store_code);
    const { data: duplicate, error: duplicateError } = await client
      .from('store_master')
      .select('id')
      .ilike('store_code', storeCode)
      .limit(1)
      .maybeSingle();
    if (duplicateError) throw duplicateError;
    if (duplicate) throw userManagementHttpError(409, 'Store Code already exists.');

    const { data, error } = await client
      .from('store_master')
      .insert({
        ...payload,
        created_by_employee_code: textOrNull(request.profile?.employee_code),
        created_by_full_name: actorLabel(request.profile),
      })
      .select(STORE_MASTER_SELECT)
      .single();
    if (error) throw error;
    response.status(201).json({ ok: true, row: serializeStoreMasterRow(data, 0) });
  } catch (error) {
    storeMasterErrorResponse(response, error);
  }
});

app.patch('/api/store-master/:id', requireSupabaseJwtOrDemoApiRead, requireStoreMasterPermission, async (request, response) => {
  try {
    const client = requireServiceRoleSupabase();
    const { data: existing, error: existingError } = await client
      .from('store_master')
      .select(STORE_MASTER_SELECT)
      .eq('id', request.params.id)
      .maybeSingle();
    if (existingError) throw existingError;
    if (!existing) throw userManagementHttpError(404, 'Store not found.');
    const payload = buildStoreMasterPayload(request.body || {}, existing, request.profile);
    const nextStoreCode = textOrNull(payload.store_code);
    if (nextStoreCode && nextStoreCode.toUpperCase() !== String(existing.store_code || '').trim().toUpperCase()) {
      const { data: duplicate, error: duplicateError } = await client
        .from('store_master')
        .select('id')
        .ilike('store_code', nextStoreCode)
        .neq('id', existing.id)
        .limit(1)
        .maybeSingle();
      if (duplicateError) throw duplicateError;
      if (duplicate) throw userManagementHttpError(409, 'Store Code already exists.');
    }
    const { data, error } = await client
      .from('store_master')
      .update(payload)
      .eq('id', existing.id)
      .select(STORE_MASTER_SELECT)
      .single();
    if (error) throw error;
    const { count, error: countError } = await client
      .from('fo_site_visits')
      .select('id', { count: 'exact', head: true })
      .eq('store_id', data.id);
    if (countError) throw countError;
    response.json({ ok: true, row: serializeStoreMasterRow(data, count || 0) });
  } catch (error) {
    storeMasterErrorResponse(response, error);
  }
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
  '/api/users/hierarchy-options',
  requireSupabaseJwt,
  requireUserManagementPermission,
  async (request, response) => {
    try {
      const client = requireServiceRoleSupabase();
      await assertUserManagementFoundation(client);
      const roleKey = createUserRoleKey(request.query.role);
      const profiles = await loadActiveHierarchyProfiles(client);
      const options = buildHierarchyOptionsFromProfiles(profiles, {
        state: textOrNull(request.query.state),
        business: textOrNull(request.query.business),
      });
      response.json({
        ok: true,
        ...options,
        warnings: hierarchyWarningsForOptions(roleKey, options),
      });
    } catch (error) {
      respondUserManagementError(response, error);
    }
  },
);

app.get(
  '/api/admin/diagnostics/supabase',
  requireSupabaseJwtWithUserScopedProfile,
  requireUserManagementPermission,
  async (request, response) => {
    const [serviceRoleTest, profilesTableTest, foAttendanceTableTest] =
      await Promise.all([
        testServiceRoleAuthAdmin(),
        testServiceRoleTableAccess('profiles'),
        testServiceRoleTableAccess('fo_attendance'),
      ]);
    response.json({
      ok: true,
      ...safeSupabaseConfigDiagnostics(),
      serviceRoleTest: {
        success: serviceRoleTest.success,
        reason: serviceRoleTest.reason,
        error: serviceRoleTest.error,
      },
      databaseTests: {
        profiles: profilesTableTest,
        foAttendance: foAttendanceTableTest,
      },
    });
  },
);

app.get(
  '/api/admin/users',
  requireSupabaseJwt,
  requireUserManagementPermission,
  async (request, response) => {
    const endpointStartedAt = Date.now();
    try {
      const client = requireServiceRoleSupabase();
      await assertUserManagementFoundation(client);
      const page = parsePositiveInteger(request.query.page, 1, 100000);
      const pageSize = parsePositiveInteger(request.query.pageSize, 25, 200);
      const includeOperationalCounts = booleanValue(request.query.includeOperationalCounts, false);
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

      const profileQueryStartedAt = Date.now();
      const { data, error, count } = await query;
      const profileQueryMs = Date.now() - profileQueryStartedAt;
      if (error) throw error;
      const profiles = data || [];
      let counts = null;
      let operationalCountsMs = 0;
      if (includeOperationalCounts) {
        const operationalCountsStartedAt = Date.now();
        counts = await loadOperationalCounts(
          client,
          profiles.map((profile) => profile.employee_code),
        );
        operationalCountsMs = Date.now() - operationalCountsStartedAt;
      }
      console.info('[UserManagement] list users timing', {
        page,
        pageSize,
        includeOperationalCounts,
        profileQueryMs,
        operationalCountsMs,
        totalMs: Date.now() - endpointStartedAt,
      });
      response.json({
        ok: true,
        page,
        pageSize,
        includeOperationalCounts,
        total: count || 0,
        totalPages: count ? Math.ceil(count / pageSize) : 0,
        users: includeOperationalCounts
          ? profiles.map((profile) => attachOperationalCounts(profile, counts))
          : profiles,
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
        if (error) {
          const authAdminError = new Error(
            sanitizeSupabaseDiagnosticError(error).message,
          );
          authAdminError.statusCode = 503;
          authAdminError.code = 'service_role_auth_admin_failed';
          authAdminError.diagnosticReason = 'service_role_auth_admin_failed';
          throw authAdminError;
        }
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
              role: canonicalProfileRole(metadata.role, 'BD'),
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
      if (textOrNull(body.temporary_password) || textOrNull(body.password)) {
        throw userManagementHttpError(
          400,
          'Admins cannot set user passwords. Use Invite User so the user can create their own password.',
        );
      }
      if (!employeeCode) throw userManagementHttpError(400, 'employee_code is required.');
      if (!fullName) throw userManagementHttpError(400, 'full_name is required.');
      if (!email) {
        const isProfileOnlyMd =
          body.create_profile_only === true && createUserRoleKey(body.role) === 'MD';
        if (!isProfileOnlyMd) {
          throw userManagementHttpError(
            400,
            'email is required for Supabase Auth user creation; no placeholder-email strategy is configured.',
          );
        }
      }
      validateCreateUserBody(body);
      const userType = normalizeUserType(body.user_type);
      const unifiedAccess = accessPayloadFromBody(body);
      await ensureUniqueProfileIdentity(client, { employeeCode, email });

      if (body.create_profile_only === true && createUserRoleKey(body.role) === 'MD') {
        const profilePayload = profileOnlyMdPayload(body);
        const { data: profile, error: profileError } = await client
          .from('profiles')
          .insert(profilePayload)
          .select(USER_MANAGEMENT_PROFILE_SELECT)
          .single();
        if (profileError) throw profileError;
        createdProfile = profile;
        await writeUserManagementAudit(client, {
          action: 'CREATE_PROFILE_ONLY_MD',
          targetProfile: createdProfile,
          newData: { profile: createdProfile },
          metadata: {
            auth_user_created: false,
            profile_only: true,
          },
          request,
        });
        response.status(201).json({
          ok: true,
          profile: createdProfile,
          hierarchy: null,
          invite: {
            method: 'profile_only',
            email_sent: false,
            setup_link: null,
            message: 'MD profile created without login access.',
          },
        });
        return;
      }

      await ensureUniqueAuthEmail(client, email);
      const hierarchyResolution = userType === 'client'
        ? { metadata: { user_type: 'client', unified_access_requested: accessPayloadPresent(unifiedAccess) }, hierarchyFields: {}, warnings: [] }
        : await buildCreateHierarchyMetadata(client, body, employeeCode);
      await validateUnifiedAccessFoundation(client, unifiedAccess);
      let createBody = {
        ...body,
        display_name: textOrNull(body.display_name) || fullName,
        metadata: {
          ...(body.metadata && typeof body.metadata === 'object' && !Array.isArray(body.metadata)
            ? body.metadata
            : {}),
          ...hierarchyResolution.metadata,
        },
        ...hierarchyResolution.hierarchyFields,
      };

      const authMetadata = {
        employee_code: employeeCode,
        full_name: fullName,
        display_name: textOrNull(createBody.display_name) || fullName,
        mobile: textOrNull(body.mobile),
        role: canonicalProfileRole(body.role, 'FO'),
        designation: textOrNull(body.designation),
        department: textOrNull(body.department),
        business: textOrNull(body.business),
        state: textOrNull(body.state),
        user_type: userType,
      };
      const { user: invitedAuthUser, invite: inviteResult } = await createInvitedAuthUser(client, {
        email,
        authMetadata,
      });
      createdAuthUser = invitedAuthUser;
      createBody = {
        ...createBody,
        metadata: {
          ...currentProfileMetadata(createBody),
          ...inviteMetadataForResult(inviteResult),
        },
      };

      const profilePayload = profileCreatePayload(
        createBody,
        createdAuthUser.id,
        false,
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
      if (userType !== 'client') {
        try {
          hierarchy = await saveHierarchy(
            client,
            createdProfile.employee_code,
            createBody,
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
      }

      const unifiedAccessResult = await createUnifiedAccessForProfile(
        client,
        createdProfile,
        createdAuthUser.id,
        unifiedAccess,
        request,
      );

      await writeUserManagementAudit(client, {
        action: 'CREATE_USER',
        targetProfile: createdProfile,
        newData: {
          profile: createdProfile,
          hierarchy,
          unified_access: unifiedAccessResult,
        },
        metadata: {
          auth_user_created: true,
          invite: inviteResult,
          hierarchy_warnings: hierarchyResolution.warnings,
          user_type: userType,
        },
        request,
      });
      response.status(201).json({
        ok: true,
        profile: createdProfile,
        hierarchy,
        invite: inviteResult,
        hierarchyWarnings: hierarchyResolution.warnings,
        unifiedAccess: unifiedAccessResult,
      });
    } catch (error) {
      respondUserManagementError(response, error);
    }
  },
);

app.post(
  '/api/admin/users/:employeeCode/enable-login',
  requireSupabaseJwt,
  requireUserManagementPermission,
  async (request, response) => {
    try {
      const client = requireServiceRoleSupabase();
      await assertUserManagementFoundation(client);
      const employeeCode = normalizeEmployeeCode(request.params.employeeCode);
      if (!employeeCode) throw userManagementHttpError(400, 'employeeCode is required.');

      const { data: profile, error: profileError } = await client
        .from('profiles')
        .select(USER_MANAGEMENT_PROFILE_SELECT)
        .ilike('employee_code', employeeCode)
        .maybeSingle();
      if (profileError) throw profileError;
      if (!profile) throw userManagementHttpError(404, 'User profile not found.');
      if (profile.auth_user_id) {
        response.json({
          ok: true,
          profile,
          invite: {
            method: 'already_enabled',
            email_sent: false,
            setup_link: null,
            message: 'Login access already enabled.',
          },
        });
        return;
      }

      const email = normalizeEmail(request.body?.email || profile.email);
      if (!email) throw userManagementHttpError(400, 'Email is required to enable login access.');
      await ensureUniqueProfileIdentity(client, {
        email,
        excludeProfileId: profile.id,
      });
      await ensureUniqueAuthEmail(client, email);

      const nextProfileForAuth = {
        ...profile,
        email,
        mobile: textOrNull(request.body?.mobile) || profile.mobile,
      };
      const { user: authUser, invite } = await createInvitedAuthUser(client, {
        email,
        password: null,
        authMetadata: profileMetadataForAuth(nextProfileForAuth),
      });

      const { data: updatedProfile, error: updateError } = await client
        .from('profiles')
        .update({
          auth_user_id: authUser.id,
          email,
          mobile: textOrNull(request.body?.mobile) || profile.mobile,
          metadata: {
            ...currentProfileMetadata(profile),
            ...inviteMetadataForResult(invite),
          },
          auth_provisioning_status: 'provisioned',
          auth_provisioning_error: null,
          auth_provisioned_at: new Date().toISOString(),
          last_profile_sync_at: new Date().toISOString(),
        })
        .eq('id', profile.id)
        .select(USER_MANAGEMENT_PROFILE_SELECT)
        .single();
      if (updateError) throw updateError;

      await writeUserManagementAudit(client, {
        action: 'ENABLE_LOGIN_ACCESS',
        targetProfile: updatedProfile,
        oldData: profile,
        newData: updatedProfile,
        metadata: { invite },
        request,
      });

      response.json({
        ok: true,
        profile: updatedProfile,
        invite,
      });
    } catch (error) {
      respondUserManagementError(response, error);
    }
  },
);

app.get(
  '/api/admin/users/hierarchy',
  requireSupabaseJwt,
  requireUserManagementPermission,
  async (request, response) => {
    try {
      const client = requireServiceRoleSupabase();
      await assertUserManagementFoundation(client);
      const users = await loadHierarchyGraph(client);
      response.json({
        ok: true,
        total: users.length,
        users,
      });
    } catch (error) {
      respondUserManagementError(response, error);
    }
  },
);

app.patch(
  '/api/admin/users/hierarchy',
  requireSupabaseJwt,
  requireUserManagementPermission,
  async (request, response) => {
    try {
      const client = requireServiceRoleSupabase();
      await assertUserManagementFoundation(client);
      const result = await saveHierarchyAssignments(
        client,
        request.body?.assignments,
        request.authUser.id,
      );
      await writeUserManagementAudit(client, {
        action: 'UPDATE_USER_HIERARCHY_ASSIGNMENTS',
        metadata: {
          assignment_count: result.affectedEmployeeCodes.length,
          affected_employee_codes: result.affectedEmployeeCodes,
          duplicate_cleanup_count: result.duplicateRowsDeactivated,
        },
        request,
      });
      response.json({
        ok: true,
        updated: result.updated,
        inserted: result.inserted,
        duplicateRowsDeactivated: result.duplicateRowsDeactivated,
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
      const [counts, hierarchy, unifiedAccess] = await Promise.all([
        loadOperationalCounts(client, [profile.employee_code]),
        loadHierarchy(client, profile.employee_code),
        loadUnifiedAccessSummaryForProfile(client, profile.id),
      ]);
      response.json({
        ok: true,
        profile: attachOperationalCounts(profile, counts),
        hierarchy,
        unifiedAccess,
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
      if (!reason) throw userManagementHttpError(400, 'reason is required.');
      if (textOrNull(request.body?.temporary_password) || textOrNull(request.body?.new_password)) {
        throw userManagementHttpError(
          400,
          'Admins cannot set user passwords. Use Resend Invitation so the user can create their own password.',
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
      const email = normalizeEmail(oldProfile.email);
      if (!email) throw userManagementHttpError(400, 'Profile email is required to resend an invitation.');
      if (!supabaseAnon) {
        throw userManagementHttpError(
          503,
          'Supabase Auth email flow is not configured on the API server.',
        );
      }
      const { error: recoveryError } = await supabaseAnon.auth.resetPasswordForEmail(
        email,
        { redirectTo: passwordSetupRedirectUrl() },
      );
      if (recoveryError) throw recoveryError;

      const { data: updatedProfile, error: profileError } = await client
        .from('profiles')
        .update({
          requires_password_change: true,
          metadata: {
            ...currentProfileMetadata(oldProfile),
            invite_status: 'sent',
            invite_sent_at: new Date().toISOString(),
            invite_method: 'password_recovery_email',
            invite_redirect_to: '/set-password',
          },
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
            requires_password_change: true,
          },
          reason,
          metadata: {
            invitation_email_sent: true,
            profile_sync_error: safeAuthError(profileError),
          },
          request,
        });
        throw userManagementHttpError(
          500,
          'Invitation email was sent, but the profile password-setup flag could not be synchronized.',
          { error: safeAuthError(profileError) },
        );
      }
      await writeUserManagementAudit(client, {
        action: 'RESEND_INVITATION',
        targetProfile: updatedProfile,
        oldData: {
          requires_password_change: oldProfile.requires_password_change,
        },
        newData: {
          requires_password_change: updatedProfile.requires_password_change,
        },
        reason,
        metadata: {
          invite: {
            method: 'password_recovery_email',
            email_sent: true,
            setup_link: null,
          },
        },
        request,
      });
      response.json({
        ok: true,
        profile_id: updatedProfile.id,
        auth_user_id: updatedProfile.auth_user_id,
        requires_password_change: updatedProfile.requires_password_change,
        invite: {
          method: 'password_recovery_email',
          email_sent: true,
          setup_link: null,
          message: 'Password setup invitation sent. The user can create their own password from the email link.',
        },
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

function requireLeadManagementAccess(request, response, next) {
  if (!isActiveLeadProfile(request.profile)) {
    response.status(403).json({ ok: false, code: 'inactive_profile', message: 'Your active employee profile is required.' });
    return;
  }
  const actor = leadActor(request.profile, request.authUser);
  if (!canAccessLeadModule(actor)) {
    response.status(403).json({ ok: false, code: 'lead_access_denied', message: 'You do not have permission to access Lead Management.' });
    return;
  }
  request.leadActor = actor;
  next();
}

function requireLeadAssignmentAccess(request, response, next) {
  if (!canAssignLead(request.leadActor)) {
    response.status(403).json({
      ok: false,
      code: 'lead_assignment_denied',
      message: 'You do not have permission to assign BD leads.',
    });
    return;
  }
  next();
}

function safeLeadError(response, error) {
  const status = Number(error?.statusCode || error?.status || 500);
  const clientMessage = status >= 500
    ? 'Lead Management is temporarily unavailable. Please try again.'
    : error.message || 'Lead request failed.';
  if (status >= 500) {
    console.error('[myQPMS Lead Management] request failed', sanitizeSupabaseDiagnosticError(error));
  }
  response.status(status).json({ ok: false, code: error?.code || 'lead_request_failed', message: clientMessage });
}

function leadMatchesApiFilters(lead, contacts, query) {
  const text = String(query.search || '').trim().toLowerCase();
  const equals = (value, filter) => !String(filter || '').trim()
    || String(value || '').trim().toLowerCase() === String(filter).trim().toLowerCase();
  if (!equals(lead.state, query.state)) return false;
  if (!equals(lead.assigned_bd_email, query.assigned_bd_email || query.assignee)) return false;
  if (!equals(lead.lead_priority, query.priority)) return false;
  if (!equals(lead.lead_stage, query.stage)) return false;
  if (!equals(lead.status, query.status)) return false;
  if (!text) return true;
  const haystack = [
    lead.lead_code,
    lead.client_name,
    lead.city,
    lead.state,
    lead.assigned_bd_executive,
    ...contacts.flatMap((contact) => [contact.contact_person_name, contact.contact_number]),
  ].join(' ').toLowerCase();
  return haystack.includes(text);
}

async function listLeadManagement(request, response) {
  try {
    const client = requireServiceRoleSupabase();
    const result = await client.from('leads').select('*').order('created_at', { ascending: false }).limit(1000);
    if (result.error) throw result.error;
    const visible = (result.data || []).filter((lead) => canViewLead(request.leadActor, lead));
    const relations = await loadLeadRelations(client, visible.map((lead) => lead.id));
    const filtered = visible.filter((lead) => leadMatchesApiFilters(lead, relations.contacts[lead.id] || [], request.query));
    response.json(leadListResponse(
      request.leadActor,
      filtered.map((lead) => leadResponse(lead, relations)),
    ));
  } catch (error) {
    safeLeadError(response, error);
  }
}

async function getLeadManagement(request, response) {
  try {
    const client = requireServiceRoleSupabase();
    const result = await client.from('leads').select('*').eq('id', request.params.leadId).maybeSingle();
    if (result.error) throw result.error;
    if (!result.data) {
      response.status(404).json({ ok: false, code: 'lead_not_found', message: 'Lead not found.' });
      return;
    }
    if (!canViewLead(request.leadActor, result.data)) {
      response.status(403).json({ ok: false, code: 'lead_access_denied', message: 'You cannot access this lead.' });
      return;
    }
    const relations = await loadLeadRelations(client, [result.data.id]);
    response.json({ ok: true, lead: leadResponse(result.data, relations) });
  } catch (error) {
    safeLeadError(response, error);
  }
}

async function createLeadManagement(request, response) {
  try {
    const actor = request.leadActor;
    if (!canCreateLead(actor)) {
      response.status(403).json({ ok: false, code: 'lead_create_denied', message: 'You do not have permission to create leads.' });
      return;
    }
    const idempotencyKey = String(request.headers['idempotency-key'] || request.body?.idempotency_key || request.body?.idempotencyKey || '').trim();
    if (!idempotencyKey || idempotencyKey.length > 160) {
      response.status(400).json({ ok: false, code: 'invalid_idempotency_key', message: 'A valid submission key is required.' });
      return;
    }
    const lead = normalizeLeadPayload(request.body);
    const errors = validateLeadPayload(lead);
    if (errors.length) {
      response.status(400).json({ ok: false, code: 'lead_validation_failed', message: errors.join(' '), errors });
      return;
    }
    const client = requireServiceRoleSupabase();
    const replayResult = await client
      .from('leads')
      .select('*')
      .eq('created_by_user_id', actor.authUserId)
      .eq('idempotency_key', idempotencyKey)
      .maybeSingle();
    if (replayResult.error) throw replayResult.error;
    if (replayResult.data) {
      const relations = await loadLeadRelations(client, [replayResult.data.id]);
      response.status(200).json({
        ok: true,
        idempotent_replay: true,
        leadId: replayResult.data.id,
        lead: leadResponse(replayResult.data, relations),
      });
      return;
    }
    const assignee = await resolveAssignee(
      client,
      actor,
      lead.assigned_bd_profile_id || lead.assigned_bd_email,
    );
    const duplicates = await findDuplicateLeads(client, actor, lead);
    if (duplicates.length && !lead.duplicate_override) {
      response.status(409).json({
        ok: false,
        code: 'possible_duplicate_lead',
        message: 'A matching lead already exists for this client, site, and contact.',
        duplicates,
      });
      return;
    }
    if (duplicates.length && !lead.duplicate_override_reason) {
      response.status(400).json({ ok: false, code: 'duplicate_override_reason_required', message: 'Explain why this is a separate lead before continuing.' });
      return;
    }

    const rpcLead = {
      ...lead,
      business: String(request.body?.business || assignee?.business || actor.business || '').trim(),
      branch: String(request.body?.branch || assignee?.branch || '').trim(),
      assigned_bd_executive: assignee?.name || null,
      assigned_bd_email: assignee?.email || null,
      source: String(request.body?.source_context || request.body?.sourceContext || 'authenticated_backend'),
      metadata: {
        created_via: String(request.body?.source_context || request.body?.sourceContext || 'authenticated_backend'),
        creator_role: actor.role,
        creator_employee_code: actor.employeeCode || null,
        duplicate_override: Boolean(duplicates.length && lead.duplicate_override),
        duplicate_override_reason: lead.duplicate_override_reason || null,
        duplicate_match_ids: duplicates.map((item) => item.id).filter(Boolean),
        duplicate_restricted_match: duplicates.some((item) => item.restricted === true),
      },
    };
    const rpc = await client.rpc('rpc_create_bd_lead_atomic', {
      p_lead: rpcLead,
      p_contacts: lead.contacts,
      p_actor: { auth_user_id: actor.authUserId, profile_id: actor.profileId, name: actor.name, email: actor.email, role: actor.role },
      p_idempotency_key: idempotencyKey,
    });
    if (rpc.error) throw rpc.error;
    const created = rpc.data?.lead || {};
    const createdContacts = rpc.data?.contacts || [];
    response.status(rpc.data?.idempotent_replay ? 200 : 201).json({
      ok: true,
      idempotent_replay: Boolean(rpc.data?.idempotent_replay),
      leadId: created.id,
      lead: {
        ...created,
        contacts: createdContacts,
        primary_contact: createdContacts.find((contact) => contact.is_primary) || createdContacts[0] || null,
        activity_logs: [],
      },
    });
  } catch (error) {
    if (error?.code === '23505') {
      error.statusCode = 409;
      error.code = 'duplicate_submission';
      error.message = 'This lead submission was already processed.';
    }
    safeLeadError(response, error);
  }
}

async function updateLeadManagement(request, response) {
  try {
    const client = requireServiceRoleSupabase();
    const existingResult = await client.from('leads').select('*').eq('id', request.params.leadId).maybeSingle();
    if (existingResult.error) throw existingResult.error;
    const existing = existingResult.data;
    if (!existing) {
      response.status(404).json({ ok: false, code: 'lead_not_found', message: 'Lead not found.' });
      return;
    }
    if (!canEditLead(request.leadActor, existing)) {
      response.status(403).json({ ok: false, code: 'lead_update_denied', message: 'You cannot edit this lead.' });
      return;
    }
    const existingRelations = await loadLeadRelations(client, [existing.id]);
    const existingContacts = (existingRelations.contacts[existing.id] || []).map((contact) => ({
      name: contact.contact_person_name,
      designation: contact.contact_person_designation,
      phone: contact.contact_number,
      email: contact.email_id,
      isPrimary: contact.is_primary,
    }));
    const industryKeys = ['industry_type', 'industryType', 'industry'];
    const serviceScopeKeys = ['service_scope', 'serviceScope'];
    const suppliedIndustryKey = industryKeys.find((key) => Object.prototype.hasOwnProperty.call(request.body || {}, key));
    const suppliedScopeKey = serviceScopeKeys.find((key) => Object.prototype.hasOwnProperty.call(request.body || {}, key));
    const incomingIndustry = suppliedIndustryKey ? cleanText(request.body[suppliedIndustryKey]) : existing.industry_type;
    const incomingScope = suppliedScopeKey
      ? normalizeLeadPayload({ service_scope: request.body[suppliedScopeKey] }).service_scope
      : existing.service_scope;
    const existingScope = normalizeLeadPayload({ service_scope: existing.service_scope }).service_scope;
    const industryChanged = Boolean(suppliedIndustryKey) && incomingIndustry !== cleanText(existing.industry_type);
    const scopeChanged = Boolean(suppliedScopeKey)
      && JSON.stringify(incomingScope) !== JSON.stringify(existingScope);
    const merged = normalizeLeadPayload({
      ...existing,
      ...request.body,
      contacts: Array.isArray(request.body?.contacts) ? request.body.contacts : existingContacts,
    });
    const errors = validateLeadPayload(merged, {
      creating: false,
      allowLegacyIndustry: !industryChanged,
      allowLegacyServices: !scopeChanged,
    });
    if (errors.length) {
      response.status(400).json({ ok: false, code: 'lead_validation_failed', message: errors.join(' '), errors });
      return;
    }
    const suppliedAssigneeProfileId = cleanText(
      request.body?.assigned_bd_profile_id || request.body?.assignedBdProfileId,
    );
    const suppliedAssigneeEmail = cleanText(
      request.body?.assigned_bd_email || request.body?.assignedBdEmail,
    ).toLowerCase();
    const hasAssigneeProfileKey = Object.prototype.hasOwnProperty.call(request.body || {}, 'assigned_bd_profile_id')
      || Object.prototype.hasOwnProperty.call(request.body || {}, 'assignedBdProfileId');
    const hasAssigneeEmailKey = Object.prototype.hasOwnProperty.call(request.body || {}, 'assigned_bd_email')
      || Object.prototype.hasOwnProperty.call(request.body || {}, 'assignedBdEmail');
    const requestedAssignee = hasAssigneeProfileKey
      || (hasAssigneeEmailKey && suppliedAssigneeEmail !== String(existing.assigned_bd_email || '').trim().toLowerCase());
    const assignee = requestedAssignee
      ? await resolveAssignee(
        client,
        request.leadActor,
        suppliedAssigneeProfileId || suppliedAssigneeEmail,
      )
      : null;
    const patch = {
      client_name: merged.client_name,
      company_name: merged.client_name,
      industry_type: merged.industry_type,
      lead_source: merged.lead_source,
      site_location: merged.site_location,
      state: merged.state,
      city: merged.city,
      lead_priority: merged.lead_priority,
      service_scope: merged.service_scope,
      remarks: merged.remarks || null,
      lead_stage: merged.lead_stage,
      status: merged.status,
      normalized_client_name: merged.client_name.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim(),
      normalized_site_location: merged.site_location.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim(),
      updated_at: new Date().toISOString(),
      ...(requestedAssignee ? { assigned_bd_executive: assignee?.name || null, assigned_bd_email: assignee?.email || null } : {}),
    };
    const updateResult = await client.rpc('rpc_update_bd_lead_atomic', {
      p_lead_id: existing.id,
      p_lead: patch,
      p_contacts: merged.contacts,
      p_actor: {
        auth_user_id: request.leadActor.authUserId,
        name: request.leadActor.name,
        role: request.leadActor.role,
      },
    });
    if (updateResult.error) throw updateResult.error;
    const relations = await loadLeadRelations(client, [existing.id]);
    response.json({ ok: true, lead: leadResponse(updateResult.data?.lead || existing, relations) });
  } catch (error) {
    safeLeadError(response, error);
  }
}

async function listLeadAssignees(request, response) {
  try {
    const client = requireServiceRoleSupabase();
    const result = await client.from('profiles').select('id,full_name,display_name,employee_code,role,status,is_active').eq('is_active', true);
    if (result.error) throw result.error;
    const assignees = safeLeadAssignees(result.data || []);
    response.json({ ok: true, assignees });
  } catch (error) {
    safeLeadError(response, error);
  }
}

async function saveLeadMomDraftManagement(request, response) {
  try {
    const payload = authorizedLeadMomPayload(request, { requireRecipient: false });
    const mom = await persistAuthorizedLeadMom(request, payload, 'Draft');
    response.json({ ok: true, mom });
  } catch (error) {
    safeLeadError(response, error);
  }
}

function siteVisitWorkflowClient(request) {
  return createSiteVisitUserClient({
    supabaseUrl,
    supabaseAnonKey,
    accessToken: getBearerToken(request),
  });
}

function requireSiteVisitWorkflowEnabled(request, response, next) {
  if (!isSiteVisitWorkflowEnabled()) {
    response.status(404).json({ ok: false, message: 'Not found.' });
    return;
  }
  next();
}

async function listSiteVisitWorkflow(request, response) {
  try {
    const result = await loadSiteVisitWorkflowData(siteVisitWorkflowClient(request));
    response.json({ ok: true, ...result });
  } catch (error) {
    console.error('[myQPMS Site Visit] workflow load failed', {
      code: error.code || null,
      message: error.message,
    });
    response.status(error.statusCode || 500).json({
      ok: false,
      message: error.statusCode === 403
        ? 'You do not have permission to access this Site Visit workflow.'
        : 'Site Visit workflow is temporarily unavailable.',
    });
  }
}

async function runSiteVisitWorkflowOperation(request, response) {
  try {
    const operation = String(request.params.operation || '');
    if (!siteVisitWorkflowOperations.includes(operation)) {
      response.status(404).json({ ok: false, message: 'Site Visit workflow operation not found.' });
      return;
    }
    const result = await executeSiteVisitWorkflowOperation(
      siteVisitWorkflowClient(request),
      operation,
      request.body || {},
    );
    response.json({ ok: true, result });
  } catch (error) {
    console.error('[myQPMS Site Visit] workflow operation failed', {
      operation: request.params.operation,
      code: error.code || null,
      message: error.message,
    });
    response.status(error.statusCode || 500).json({
      ok: false,
      message: error.statusCode === 403
        ? 'You do not have permission to perform this Site Visit action.'
        : error.statusCode === 400
          ? error.message
          : 'Site Visit workflow action failed.',
    });
  }
}

app.get('/api/lead-management/leads', requireSupabaseJwt, requireLeadManagementAccess, listLeadManagement);
app.get('/api/lead-management/leads/:leadId', requireSupabaseJwt, requireLeadManagementAccess, getLeadManagement);
app.post('/api/lead-management/leads', requireSupabaseJwt, requireLeadManagementAccess, createLeadManagement);
app.patch('/api/lead-management/leads/:leadId', requireSupabaseJwt, requireLeadManagementAccess, updateLeadManagement);
app.get('/api/lead-management/assignees', requireSupabaseJwt, requireLeadManagementAccess, requireLeadAssignmentAccess, listLeadAssignees);
app.post(
  '/api/lead-management/leads/:leadId/mom',
  requireSupabaseJwt,
  requireLeadManagementAccess,
  requireLeadMomAccess,
  saveLeadMomDraftManagement,
);
app.get('/api/site-visit-workflow', requireSiteVisitWorkflowEnabled, requireSupabaseJwt, listSiteVisitWorkflow);
app.post(
  '/api/site-visit-workflow/operations/:operation',
  requireSiteVisitWorkflowEnabled,
  requireSupabaseJwt,
  runSiteVisitWorkflowOperation,
);

// Backward-compatible mobile aliases use the same production authorization and
// persistence handlers. The legacy declarations below are therefore unreachable
// for these exact paths and can be removed after older app versions are retired.
app.get('/api/mobile/leads', requireSupabaseJwt, requireLeadManagementAccess, listLeadManagement);
app.get('/api/mobile/leads/:leadId', requireSupabaseJwt, requireLeadManagementAccess, getLeadManagement);
app.post('/api/mobile/leads', requireSupabaseJwt, requireLeadManagementAccess, createLeadManagement);
app.patch('/api/mobile/leads/:leadId', requireSupabaseJwt, requireLeadManagementAccess, updateLeadManagement);

app.get('/api/mobile/leads', requireSupabaseJwt, requireMobileLeadAccess, async (request, response) => {
  try {
    const client = requireServiceRoleSupabase();
    const actor = mobileLeadActor(request.profile, request.authUser);
    const { data, error } = await client
      .from('leads')
      .select('*')
      .order('created_at', { ascending: false })
      .limit(500);
    if (error) throw error;

    const visibleLeads = (data || [])
      .filter((lead) => canAccessMobileLead(lead, actor))
      .filter((lead) => mobileLeadMatchesFilters(lead, request.query));
    const leadIds = visibleLeads.map((lead) => lead.id).filter(Boolean);
    const relations = await fetchMobileLeadRelations(client, leadIds);
    response.json({
      ok: true,
      count: visibleLeads.length,
      scope: actor.role === 'BD Executive' ? 'own' : 'team',
      leads: visibleLeads.map((lead) => compactMobileLead(lead, relations.contactsByLeadId, relations.momByLeadId)),
    });
  } catch (error) {
    response.status(error.statusCode || 500).json({ ok: false, message: error.message });
  }
});

app.get('/api/mobile/leads/:leadId', requireSupabaseJwt, requireMobileLeadAccess, async (request, response) => {
  try {
    const client = requireServiceRoleSupabase();
    const actor = mobileLeadActor(request.profile, request.authUser);
    const { data: lead, error } = await client
      .from('leads')
      .select('*')
      .eq('id', request.params.leadId)
      .maybeSingle();
    if (error) throw error;
    if (!lead) {
      response.status(404).json({ ok: false, message: 'Lead not found.' });
      return;
    }
    if (!canAccessMobileLead(lead, actor)) {
      response.status(403).json({ ok: false, message: 'You cannot access this lead.' });
      return;
    }
    const relations = await fetchMobileLeadRelations(client, [lead.id]);
    response.json({
      ok: true,
      lead: compactMobileLead(lead, relations.contactsByLeadId, relations.momByLeadId, relations.activityByLeadId),
    });
  } catch (error) {
    response.status(error.statusCode || 500).json({ ok: false, message: error.message });
  }
});

app.post('/api/mobile/leads', requireSupabaseJwt, requireMobileLeadAccess, async (request, response) => {
  try {
    const client = requireServiceRoleSupabase();
    const actor = mobileLeadActor(request.profile, request.authUser);
    const clientName = String(request.body?.client_name || request.body?.clientName || '').trim();
    const siteLocation = String(request.body?.site_location || request.body?.siteLocation || request.body?.location || '').trim();
    const state = String(request.body?.state || '').trim();
    const city = String(request.body?.city || '').trim();
    const contactName = String(request.body?.contact_person_name || request.body?.contactName || '').trim();
    const contactPhone = String(request.body?.contact_number || request.body?.contactNumber || '').trim();
    const contactEmail = String(request.body?.email_id || request.body?.email || '').trim();
    const priority = validateLeadPriority(request.body?.lead_priority || request.body?.leadPriority);

    const errors = [];
    if (!clientName) errors.push('client_name is required');
    if (!state) errors.push('state is required');
    if (!city || !siteLocation) errors.push('city and site_location are required');
    if (!contactName && !contactPhone && !contactEmail) errors.push('contact name or phone/email is required');
    if (!priority) errors.push('lead_priority must be High, Medium, or Low');
    if (errors.length) {
      response.status(400).json({ ok: false, message: errors.join('; ') });
      return;
    }

    const payload = {
      client_name: clientName,
      industry_type: String(request.body?.industry_type || request.body?.industryType || '').trim(),
      lead_source: String(request.body?.lead_source || request.body?.leadSource || '').trim(),
      site_location: siteLocation,
      state,
      city,
      lead_priority: priority,
      service_scope: normalizeServiceScopePayload(request.body?.service_scope || request.body?.serviceScope),
      remarks: String(request.body?.remarks || '').trim(),
      assigned_bd_executive: actor.name,
      assigned_bd_email: actor.email,
      created_by_user_id: actor.authUserId || actor.profileId,
      created_by_name: actor.name,
      lead_stage: 'New Lead',
      status: 'Active',
      updated_at: new Date().toISOString(),
    };
    const { data: lead, error } = await client.from('leads').insert(payload).select('*').single();
    if (error) throw error;

    if (contactName || contactPhone || contactEmail) {
      const contactPayload = {
        lead_id: lead.id,
        contact_person_name: contactName || 'Primary Contact',
        contact_person_designation: String(request.body?.contact_person_designation || request.body?.contactDesignation || '').trim(),
        contact_number: contactPhone || null,
        email_id: contactEmail || null,
        is_primary: true,
      };
      const { error: contactError } = await client.from('lead_contacts').insert(contactPayload);
      if (contactError) throw contactError;
    }
    await insertMobileLeadActivity(client, {
      leadId: lead.id,
      type: 'Lead Created',
      message: 'Lead Created from Mobile',
      createdBy: actor.name || actor.email,
    });
    const relations = await fetchMobileLeadRelations(client, [lead.id]);
    response.status(201).json({
      ok: true,
      leadId: lead.id,
      lead: compactMobileLead(lead, relations.contactsByLeadId, relations.momByLeadId),
    });
  } catch (error) {
    response.status(error.statusCode || 500).json({ ok: false, message: error.message });
  }
});

app.patch('/api/mobile/leads/:leadId', requireSupabaseJwt, requireMobileLeadAccess, async (request, response) => {
  try {
    const client = requireServiceRoleSupabase();
    const actor = mobileLeadActor(request.profile, request.authUser);
    const { data: lead, error: leadError } = await client.from('leads').select('*').eq('id', request.params.leadId).maybeSingle();
    if (leadError) throw leadError;
    if (!lead) {
      response.status(404).json({ ok: false, message: 'Lead not found.' });
      return;
    }
    if (!canAccessMobileLead(lead, actor)) {
      response.status(403).json({ ok: false, message: 'You cannot update this lead.' });
      return;
    }

    const patch = {};
    if (request.body?.lead_priority || request.body?.leadPriority) {
      const priority = validateLeadPriority(request.body.lead_priority || request.body.leadPriority);
      if (!priority) {
        response.status(400).json({ ok: false, message: 'lead_priority must be High, Medium, or Low' });
        return;
      }
      patch.lead_priority = priority;
    }
    if (Object.prototype.hasOwnProperty.call(request.body || {}, 'remarks')) {
      patch.remarks = String(request.body.remarks || '').trim();
    }
    if (request.body?.status) {
      const status = String(request.body.status).trim();
      if (!['Active', 'Pending', 'Escalated', 'Completed', 'MOM Sent', 'Converted to Assessment', 'Archived', 'Lost'].includes(status)) {
        response.status(400).json({ ok: false, message: 'Unsupported lead status.' });
        return;
      }
      patch.status = status;
    }
    if (request.body?.lead_stage || request.body?.leadStage) {
      const stage = String(request.body.lead_stage || request.body.leadStage).trim();
      if (!['New Lead', 'Lead MOM Sent', 'Converted', 'Site Visit Scheduled', 'Proposal Sent', 'Lost'].includes(stage)) {
        response.status(400).json({ ok: false, message: 'Unsupported lead stage.' });
        return;
      }
      patch.lead_stage = stage;
    }
    if (Object.keys(patch).length) {
      patch.updated_at = new Date().toISOString();
      const { error } = await client.from('leads').update(patch).eq('id', lead.id);
      if (error) throw error;
    }
    if (request.body?.next_followup_date || request.body?.nextFollowUpDate) {
      const nextFollowUp = String(request.body.next_followup_date || request.body.nextFollowUpDate).trim();
      const { error } = await client.from('lead_mom').upsert({
        lead_id: lead.id,
        next_followup_date: nextFollowUp || null,
        mom_status: 'Draft',
      }, { onConflict: 'lead_id' });
      if (error) throw error;
    }
    await insertMobileLeadActivity(client, {
      leadId: lead.id,
      type: 'Lead Updated',
      message: 'Lead Updated from Mobile',
      createdBy: actor.name || actor.email,
    });
    response.json({ ok: true });
  } catch (error) {
    response.status(error.statusCode || 500).json({ ok: false, message: error.message });
  }
});

app.post('/api/mobile/leads/:leadId/follow-up', requireSupabaseJwt, requireMobileLeadAccess, async (request, response) => {
  try {
    const client = requireServiceRoleSupabase();
    const actor = mobileLeadActor(request.profile, request.authUser);
    const { data: lead, error: leadError } = await client.from('leads').select('*').eq('id', request.params.leadId).maybeSingle();
    if (leadError) throw leadError;
    if (!lead) {
      response.status(404).json({ ok: false, message: 'Lead not found.' });
      return;
    }
    if (!canAccessMobileLead(lead, actor)) {
      response.status(403).json({ ok: false, message: 'You cannot update this lead.' });
      return;
    }
    const remark = String(request.body?.remark || request.body?.remarks || '').trim();
    const nextFollowUp = String(request.body?.next_followup_date || request.body?.nextFollowUpDate || '').trim();
    if (!remark && !nextFollowUp) {
      response.status(400).json({ ok: false, message: 'Follow-up remark or date is required.' });
      return;
    }
    if (nextFollowUp) {
      const { error } = await client.from('lead_mom').upsert({
        lead_id: lead.id,
        next_followup_date: nextFollowUp,
        mom_status: 'Draft',
      }, { onConflict: 'lead_id' });
      if (error) throw error;
    }
    await insertMobileLeadActivity(client, {
      leadId: lead.id,
      type: 'Follow-up',
      message: remark || `Next follow-up set to ${nextFollowUp}`,
      createdBy: actor.name || actor.email,
    });
    response.json({ ok: true });
  } catch (error) {
    response.status(error.statusCode || 500).json({ ok: false, message: error.message });
  }
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
      industry_type: request.body?.industryType || 'Commercial',
      lead_source: request.body?.leadSource || 'Postman Automation',
      site_location: request.body?.location || request.body?.siteLocation || '',
      state: request.body?.state || 'Tamil Nadu',
      city: request.body?.city || 'Chennai',
      lead_priority: request.body?.leadPriority || 'High',
      service_scope: request.body?.serviceScope || ['Soft Services', 'Security Services'],
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

app.post('/api/leads/:leadId/send-mom', requireApiAuth, async (request, response) => {
  try {
    const client = requireServiceRoleSupabase();
    const actor = leadActor({
      ...request.apiUser,
      is_active: true,
      status: 'Active',
    }, request.apiUser);
    const [leadResult, contactsResult] = await Promise.all([
      client.from('leads').select('*').eq('id', request.params.leadId).maybeSingle(),
      client.from('lead_contacts').select('*').eq('lead_id', request.params.leadId).order('created_at', { ascending: true }),
    ]);
    const { data: lead, error: leadError } = leadResult;
    if (leadError) throw leadError;
    if (!lead) {
      response.status(404).json({ ok: false, code: 'lead_not_found', message: 'Lead not found.' });
      return;
    }
    if (contactsResult.error) throw contactsResult.error;
    if (!canManageLeadMom(actor, lead)) {
      response.status(403).json({
        ok: false,
        code: 'lead_mom_access_denied',
        message: 'You do not have permission to send MOM for this lead.',
      });
      return;
    }
    request.leadActor = actor;
    request.authorizedLead = lead;
    request.authorizedLeadContacts = contactsResult.data || [];
    const payload = authorizedLeadMomPayload(request, { requireRecipient: false });
    const mom = await persistAuthorizedLeadMom(request, payload, 'Sent');
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
      let delayedCheckoutAudit = null;
      try {
        delayedCheckoutAudit = await auditDelayedCheckoutMissingKmForVisit(client, updatedVisit);
      } catch (auditError) {
        delayedCheckoutAudit = {
          audited: false,
          updated: false,
          reason: 'delayed_checkout_audit_failed',
          message: auditError.message,
        };
        console.warn('DELAYED_CHECKOUT_REVIEW_AUDIT_FAILED', {
          visit_id: visit.id,
          employee_code: visit.employee_code || visit.fo_user_id || null,
          message: auditError.message,
        });
      }

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
      const staleLiveStatusCleanup = await cleanupStaleLiveStatusReferences(client);

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
        delayedCheckoutAudit,
        staleLiveStatusCleanup,
        recalculation,
      });
    } catch (error) {
      response.status(error.statusCode || 500).json({ ok: false, message: error.message });
    }
  },
);

function metadataObject(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
}

function metadataBoolean(value) {
  return value === true || String(value || '').trim().toLowerCase() === 'true';
}

function metadataNumber(value) {
  if (value === null || value === undefined || value === '') return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

app.post(
  '/api/fo/site-visits/:visitId/checkout-missing-km-review',
  requireSupabaseJwt,
  requireCheckoutMissingKmReviewPermission,
  async (request, response) => {
    try {
      const client = requireServiceRoleSupabase();
      await assertServiceRoleAuthAdminAccess(client);
      const visitId = String(request.params.visitId || '').trim();
      const action = String(request.body?.action || '').trim().toLowerCase();
      if (!visitId) {
        response.status(400).json({ ok: false, message: 'visitId is required.' });
        return;
      }
      if (!['approve', 'reject', 'clarification'].includes(action)) {
        response.status(400).json({ ok: false, message: 'action must be approve, reject, or clarification.' });
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

      let { data: review, error: reviewError } = await client
        .from('fo_missing_km_reviews')
        .select('*')
        .eq('site_visit_id', visitId)
        .eq('review_type', 'checkout_exception')
        .maybeSingle();
      if (reviewError) throw reviewError;
      if (!review) {
        const { data: attendance, error: attendanceError } = await client
          .from('fo_attendance')
          .select('*')
          .eq('id', visit.attendance_id)
          .single();
        if (attendanceError) throw attendanceError;
        await refreshMissingKmReviewsForAttendance(client, attendance, [visit], [], {
          audit_label: 'checkout_review_action',
        });
        const refreshed = await client
          .from('fo_missing_km_reviews')
          .select('*')
          .eq('site_visit_id', visitId)
          .eq('review_type', 'checkout_exception')
          .maybeSingle();
        if (refreshed.error) throw refreshed.error;
        review = refreshed.data;
      }
      if (!review?.id) {
        response.status(409).json({
          ok: false,
          message: 'Missing KM review could not be prepared for this checkout exception.',
        });
        return;
      }

      const result = await decideMissingKmReview(
        client,
        review.id,
        action,
        {
          approved_missing_km: request.body?.approved_missing_km ?? request.body?.approved_km,
          remarks: request.body?.remarks,
          requested_clarification: request.body?.requested_clarification || request.body?.clarification,
          elevated_override: request.body?.elevated_override === true || request.body?.admin_override === true,
        },
        {
          email: request.profile?.email || request.authUser?.email || null,
          employee_code: request.profile?.employee_code || request.employeeCode || null,
          full_name: request.profile?.full_name || request.profile?.name || null,
          role: request.profile?.role || request.userRole || null,
        },
      );

      response.json({
        ok: true,
        message: action === 'approve'
          ? 'Missing KM approved and attendance totals synchronized.'
          : action === 'reject'
            ? 'Missing KM rejected and attendance totals synchronized.'
            : 'Clarification requested for Missing KM review.',
        review: result.review,
        totals: result.totals,
        payable_application: action === 'approve'
          ? 'approved_missing_km_added_to_total_approved_km'
          : 'no_payable_km_added',
      });
    } catch (error) {
      response.status(error.statusCode || 500).json({ ok: false, message: error.message });
    }
  },
);

app.get('/api/fo/operations/summary', requireSupabaseJwtOrDemoApiRead, async (request, response) => {
  try {
    const client = requireServiceRoleSupabase();
    const summary = await buildOperationsSummary(
      client,
      request.profile,
      request.query || {},
      currentIndiaDateInput(),
    );
    response.json({ ok: true, ...summary });
  } catch (error) {
    const status = Number(error?.statusCode || 500);
    if (status >= 500) {
      console.error('[myQPMS Operations Summary] request failed', sanitizeSupabaseDiagnosticError(error));
    }
    response.status(status).json({
      ok: false,
      message: status >= 500
        ? 'Operations summary is temporarily unavailable. Please retry.'
        : error.message,
    });
  }
});

app.get('/api/fo/operations/employee-range', requireSupabaseJwt, async (request, response) => {
  try {
    const client = requireServiceRoleSupabase();
    const dataset = await loadAuthorizedEmployeeRange(
      client,
      request.profile,
      request.query || {},
    );
    response.json({ ok: true, ...dataset });
  } catch (error) {
    const status = Number(error?.statusCode || 500);
    if (status >= 500) {
      console.error(
        '[myQPMS Employee Range] request failed',
        sanitizeSupabaseDiagnosticError(error),
      );
    }
    response.status(status).json({
      ok: false,
      message:
        status >= 500
          ? 'Employee period report is temporarily unavailable. Please retry.'
          : error.message,
    });
  }
});

app.get('/api/fo/reports/consolidated-travel-claims/pdf', requireSupabaseJwt, async (request, response) => {
  try {
    const client = requireServiceRoleSupabase();
    const report = await buildConsolidatedTravelClaimPdf(
      client,
      request.profile,
      request.query || {},
      currentIndiaDateInput(),
    );
    response.setHeader('Content-Type', 'application/pdf');
    response.setHeader('Content-Disposition', `attachment; filename="${report.filename}"`);
    response.setHeader('Content-Length', String(report.buffer.length));
    response.send(report.buffer);
  } catch (error) {
    const status = Number(error?.statusCode || 500);
    console.error('[myQPMS Consolidated Travel Claim PDF] request failed', {
      message: error?.message || String(error),
      stack: error?.stack || null,
      code: error?.code || null,
      status,
      details: error?.details || null,
      hint: error?.hint || null,
      query: {
        date_from: request.query?.date_from || request.query?.from_date || null,
        date_to: request.query?.date_to || request.query?.to_date || null,
        state: request.query?.state || null,
        business: request.query?.business || null,
        status: request.query?.status || null,
      },
      actor: {
        employee_code: request.profile?.employee_code || null,
        role: request.profile?.role || null,
      },
    });
    if (status >= 500) {
      console.error(
        '[myQPMS Consolidated Travel Claim PDF] sanitized diagnostic',
        sanitizeSupabaseDiagnosticError(error),
      );
    }
    response.status(status).json({
      ok: false,
      code: error.code || 'CONSOLIDATED_TRAVEL_CLAIM_PDF_FAILED',
      message:
        status >= 500 && process.env.NODE_ENV === 'production'
          ? 'Consolidated travel claim PDF is temporarily unavailable. Please retry.'
          : error.message,
      ...(process.env.NODE_ENV !== 'production'
        ? {
            stack: error?.stack || null,
            details: error?.details || null,
            hint: error?.hint || null,
          }
        : {}),
    });
  }
});

function demoMaskedFoRows({ profiles = [], attendances = [], siteVisits = [], liveStatus = [] }) {
  const map = new Map();
  let index = 1;
  const assign = (value) => {
    const key = String(value || '').trim().toUpperCase();
    if (!key) return '';
    if (!map.has(key)) {
      map.set(key, `DEMO-FO-${String(index).padStart(3, '0')}`);
      index += 1;
    }
    return map.get(key);
  };
  const assignGroup = (values = []) => {
    const keys = values.map((value) => String(value || '').trim().toUpperCase()).filter(Boolean);
    if (!keys.length) return '';
    const existing = keys.map((key) => map.get(key)).find(Boolean);
    const masked = existing || `DEMO-FO-${String(index).padStart(3, '0')}`;
    if (!existing) index += 1;
    keys.forEach((key) => map.set(key, masked));
    return masked;
  };
  for (const profile of profiles) {
    assignGroup([profile.employee_code, profile.username, profile.id]);
  }
  const maskRow = (row = {}) => {
    const next = sanitizeDemoRecord(row);
    const masked = assign(row.employee_code || row.username || row.fo_user_id || row.id);
    if (masked) {
      next.employee_code = masked;
      next.username = masked;
      next.fo_user_id = masked;
      next.full_name = `Demo Field Officer ${masked.slice(-3)}`;
      next.display_name = `Demo Field Officer ${masked.slice(-3)}`;
    }
    return next;
  };
  return {
    profiles: profiles.map(maskRow),
    attendances: attendances.map(maskRow),
    site_visits: siteVisits.map(maskRow),
    live_status: liveStatus.map(maskRow),
  };
}

app.get('/api/fo/operations/dashboard', requireSupabaseJwtOrDemoApiRead, async (request, response) => {
  try {
    const client = requireServiceRoleSupabase();
    const filters = normalizeOperationsSummaryFilters(request.query || {}, currentIndiaDateInput());
    const [profilesRes, attendanceRes, siteVisitsRes, liveStatusRes] = await Promise.all([
      client
        .from('profiles')
        .select('id,full_name,display_name,employee_code,username,role,department,designation,business,state,status,is_active,metadata')
        .eq('is_active', true)
        .limit(5000),
      client
        .from('fo_attendance')
        .select('*')
        .gte('attendance_date', filters.date_from)
        .lte('attendance_date', filters.date_to)
        .order('login_time', { ascending: false })
        .limit(5000),
      client
        .from('fo_site_visits')
        .select('*')
        .gte('check_in_time', `${filters.date_from}T00:00:00.000Z`)
        .lte('check_in_time', `${filters.date_to}T23:59:59.999Z`)
        .order('check_in_time', { ascending: false })
        .limit(5000),
      client
        .from('fo_live_status')
        .select('*')
        .order('last_seen_at', { ascending: false })
        .limit(5000),
    ]);
    const errors = [profilesRes, attendanceRes, siteVisitsRes, liveStatusRes].map((result) => result.error).filter(Boolean);
    if (errors.length) throw errors[0];
    const rows = {
      profiles: profilesRes.data || [],
      attendances: attendanceRes.data || [],
      site_visits: siteVisitsRes.data || [],
      live_status: liveStatusRes.data || [],
    };
    response.json({
      ok: true,
      ...(isDemoUser(request.profile)
        ? demoMaskedFoRows({
          profiles: rows.profiles,
          attendances: rows.attendances,
          siteVisits: rows.site_visits,
          liveStatus: rows.live_status,
        })
        : rows),
      applied_filters: filters,
    });
  } catch (error) {
    const status = Number(error?.statusCode || 500);
    if (status >= 500) {
      console.error('[myQPMS Operations Dashboard] request failed', sanitizeSupabaseDiagnosticError(error));
    }
    response.status(status).json({
      ok: false,
      message: status >= 500
        ? 'Operations dashboard is temporarily unavailable. Please retry.'
        : error.message,
    });
  }
});

app.get('/api/fo/operations/demo-date-range', requireSupabaseJwtOrDemoApiRead, async (request, response) => {
  try {
    if (!isDemoUser(request.profile)) {
      response.status(403).json({ ok: false, message: 'Demo date range is available only for demo users.' });
      return;
    }
    const client = requireServiceRoleSupabase();
    const [{ data: latestRows, error: latestError }, { data: earliestRows, error: earliestError }] = await Promise.all([
      client
        .from('fo_attendance')
        .select('attendance_date')
        .not('attendance_date', 'is', null)
        .order('attendance_date', { ascending: false })
        .limit(1),
      client
        .from('fo_attendance')
        .select('attendance_date')
        .not('attendance_date', 'is', null)
        .order('attendance_date', { ascending: true })
        .limit(1),
    ]);
    if (latestError) throw latestError;
    if (earliestError) throw earliestError;
    const latest = String(latestRows?.[0]?.attendance_date || '').slice(0, 10) || null;
    const earliest = String(earliestRows?.[0]?.attendance_date || '').slice(0, 10) || latest;
    response.json({
      ok: true,
      latest_demo_date: latest,
      earliest_demo_date: earliest,
      label: latest ? 'Sample Demo Data' : 'No demo attendance data available',
    });
  } catch (error) {
    const status = Number(error?.statusCode || 500);
    response.status(status).json({
      ok: false,
      message: status >= 500 ? 'Demo date range is temporarily unavailable.' : error.message,
    });
  }
});

app.get('/api/deep-cleaning/records', requireSupabaseJwtOrDemoApiRead, async (request, response) => {
  try {
    const client = requireServiceRoleSupabase();
    const [submissionsRes, uploadsRes, storesRes, profilesRes, visitsRes] = await Promise.all([
      client
        .from('fo_activity_submissions')
        .select('*')
        .eq('activity_type', 'deep_cleaning')
        .order('submitted_at', { ascending: false })
        .limit(1000),
      client
        .from('fo_activity_uploads')
        .select('*')
        .or('activity_type.eq.deep_cleaning,upload_role.ilike.%deep_cleaning%')
        .order('uploaded_at', { ascending: false })
        .limit(1500),
      client
        .from('store_master')
        .select('id,store_code,store_name,client_name,state,business,latitude,longitude,gps_accuracy,status,metadata')
        .in('business', ['Reliance Retail', 'Reliance', 'IFMS'])
        .limit(5000),
      client
        .from('profiles')
        .select('employee_code,username,full_name,display_name,business,state,role,designation,department')
        .in('business', ['Reliance Retail', 'Reliance', 'IFMS'])
        .limit(5000),
      client
        .from('fo_site_visits')
        .select('id,store_code,store_name,site_name,client_name,state,employee_code,fo_user_id,check_in_time,metadata')
        .order('check_in_time', { ascending: false })
        .limit(3000),
    ]);
    const errors = [submissionsRes, uploadsRes, storesRes, profilesRes, visitsRes].map((result) => result.error).filter(Boolean);
    if (errors.length) throw errors[0];
    const demo = isDemoUser(request.profile);
    const sanitizeRows = (rows) => demo ? (rows || []).map((row) => sanitizeDemoRecord(row)) : rows || [];
    response.json({
      ok: true,
      submissions: sanitizeRows(submissionsRes.data),
      uploads: sanitizeRows(uploadsRes.data),
      stores: demo ? (storesRes.data || []).map((row) => sanitizeDemoRecord(row, ['created_by_full_name'])) : storesRes.data || [],
      profiles: sanitizeRows(profilesRes.data),
      visits: sanitizeRows(visitsRes.data),
    });
  } catch (error) {
    const status = Number(error?.statusCode || 500);
    response.status(status).json({
      ok: false,
      message: status >= 500 ? 'Deep Cleaning records are temporarily unavailable.' : error.message,
    });
  }
});

app.post('/api/fo/km/recalculate', requireSupabaseJwt, async (request, response) => {
  let payload = request.body || {};
  const client = requireServiceRoleSupabase();
  try {
    const authorization = await authorizeFoKmRecalculation({
      client,
      payload,
      profile: request.profile,
    });
    payload = authorization.payload;
  } catch (error) {
    response.status(error.statusCode || 500).json({
      ok: false,
      message: error.statusCode
        ? error.message
        : 'Unable to authorize KM recalculation.',
    });
    return;
  }
  const lockKey = foKmRecalculationLockKey(payload);
  const lockDate = normalizeFoKmRecalculationDate(payload.date);
  pruneStaleFoKmRecalculationLocks();
  if (foKmRecalculateAllLocks.has(lockDate) || foKmRecalculationLocks.has(lockKey)) {
    response.status(409).json({ ok: false, message: FO_KM_RECALCULATION_RUNNING_MESSAGE });
    return;
  }
  addFoKmRecalculationLock(lockKey);
  try {
    await assertServiceRoleAuthAdminAccess(client);
    const result = await recalculateFoKm(client, payload, {
      maxGoogleDirectionsCalls: payload.max_google_directions_calls,
    });
    response.json({ ok: true, ...result });
  } catch (error) {
    const safeError = safeServiceRoleError(error, 'service_role_auth_admin_failed');
    response.status(safeError.statusCode).json({
      ok: false,
      message: safeError.message,
      ...(safeError.diagnosticReason
        ? { diagnosticReason: safeError.diagnosticReason }
        : {}),
    });
  } finally {
    releaseFoKmRecalculationLock(lockKey);
  }
});

app.post('/api/fo/km/recalculate-batch', requireSupabaseJwt, requireFoKmBatchRecalculationPermission, async (request, response) => {
  const payload = request.body || {};
  const fromDate = normalizeFoKmRecalculationDate(payload.fromDate || payload.date);
  const toDate = normalizeFoKmRecalculationDate(payload.toDate || payload.date || fromDate);
  const lockDate = `${fromDate}_${toDate}`;
  pruneStaleFoKmRecalculationLocks();
  if (foKmRecalculateAllLocks.has(lockDate) || hasFoKmRecalculationForDate(fromDate)) {
    response.status(409).json({ ok: false, message: FO_KM_RECALCULATION_RUNNING_MESSAGE });
    return;
  }
  addFoKmRecalculateAllLock(lockDate);
  try {
    const client = requireServiceRoleSupabase();
    await assertServiceRoleAuthAdminAccess(client);
    const result = await recalculateFoKmBatch(client, payload, {
      maxGoogleDirectionsCalls: payload.max_google_directions_calls,
      skipDelayedCheckoutGoogle: true,
    });
    response.json({ ok: true, ...result });
  } catch (error) {
    const safeError = safeServiceRoleError(error, 'service_role_auth_admin_failed');
    response.status(safeError.statusCode).json({
      ok: false,
      message: safeError.message,
      ...(safeError.diagnosticReason
        ? { diagnosticReason: safeError.diagnosticReason }
        : {}),
    });
  } finally {
    releaseFoKmRecalculateAllLock(lockDate);
  }
});

app.post('/api/fo/km/recalculate-employee-range', requireSupabaseJwt, async (request, response) => {
  const payload = request.body || {};
  const lockKey = [
    String(payload.employee || payload.employee_code || payload.fo_user_id || '').trim().toUpperCase(),
    String(payload.date_from || payload.from_date || '').slice(0, 10),
    String(payload.date_to || payload.to_date || '').slice(0, 10),
  ].join('|');
  if (foEmployeeRangeRecalculationLocks.has(lockKey)) {
    response.status(409).json({
      ok: false,
      message: FO_KM_RECALCULATION_RUNNING_MESSAGE,
    });
    return;
  }
  foEmployeeRangeRecalculationLocks.add(lockKey);
  try {
    const client = requireServiceRoleSupabase();
    await assertServiceRoleAuthAdminAccess(client);
    const dataset = await loadAuthorizedEmployeeRange(
      client,
      request.profile,
      payload,
    );
    const result = await recalculateEmployeeRange({
      attendances: dataset.attendance_days,
      recalculate: (attendance) =>
        recalculateFoKm(client, {
          attendance_id: attendance.id,
          employee_code:
            attendance.employee_code || dataset.employee.employee_code,
          date: attendance.attendance_date,
        }),
    });
    response.json({ ok: true, ...result });
  } catch (error) {
    const status = Number(error?.statusCode || 500);
    const safeError =
      status >= 500
        ? safeServiceRoleError(error, 'employee_range_recalculation_failed')
        : { statusCode: status, message: error.message };
    response.status(safeError.statusCode).json({
      ok: false,
      message: safeError.message,
    });
  } finally {
    foEmployeeRangeRecalculationLocks.delete(lockKey);
  }
});

app.post('/api/fo/km/recalculate-switch-mode', requireSupabaseJwt, requireTemporarySwitchKmPermission, async (request, response) => {
  const payload = request.body || {};
  const lockKey = `switch_mode:${foKmRecalculationLockKey(payload)}`;
  const lockDate = normalizeFoKmRecalculationDate(payload.date);
  pruneStaleFoKmRecalculationLocks();
  if (foKmRecalculateAllLocks.has(lockDate) || foKmRecalculationLocks.has(lockKey)) {
    response.status(409).json({ ok: false, message: FO_KM_RECALCULATION_RUNNING_MESSAGE });
    return;
  }
  addFoKmRecalculationLock(lockKey);
  try {
    const client = requireServiceRoleSupabase();
    await assertServiceRoleAuthAdminAccess(client);
    const result = await recalculateSwitchModeKmTemporary(client, payload, {
      maxGoogleDirectionsCalls: payload.max_google_directions_calls,
    });
    response.json({ ok: true, temporary: true, ...result });
  } catch (error) {
    const safeError = safeServiceRoleError(error, 'service_role_auth_admin_failed');
    response.status(safeError.statusCode).json({
      ok: false,
      message: safeError.message,
      ...(safeError.diagnosticReason
        ? { diagnosticReason: safeError.diagnosticReason }
        : {}),
    });
  } finally {
    releaseFoKmRecalculationLock(lockKey);
  }
});

app.post('/api/fo/km/recalculate-full-day-gps', requireSupabaseJwt, requireFullDayGpsKmPermission, async (request, response) => {
  const payload = request.body || {};
  const lockKey = `full_day_gps:${foKmRecalculationLockKey(payload)}`;
  const lockDate = normalizeFoKmRecalculationDate(payload.date);
  pruneStaleFoKmRecalculationLocks();
  if (foKmRecalculateAllLocks.has(lockDate) || foKmRecalculationLocks.has(lockKey)) {
    response.status(409).json({ ok: false, message: FO_KM_RECALCULATION_RUNNING_MESSAGE });
    return;
  }
  addFoKmRecalculationLock(lockKey);
  try {
    const client = requireServiceRoleSupabase();
    await assertServiceRoleAuthAdminAccess(client);
    const actor = request.profile?.email ||
      request.authUser?.email ||
      request.profile?.employee_code ||
      request.authUser?.id ||
      null;
    const result = await recalculateFullDayGpsNoSiteVisitKm(client, payload, {
      actor,
      maxGoogleDirectionsCalls: payload.max_google_directions_calls,
    });
    response.json({ ok: true, ...result });
  } catch (error) {
    const safeError = safeServiceRoleError(error, 'service_role_auth_admin_failed');
    response.status(safeError.statusCode).json({
      ok: false,
      message: safeError.message,
      ...(safeError.diagnosticReason
        ? { diagnosticReason: safeError.diagnosticReason }
        : {}),
    });
  } finally {
    releaseFoKmRecalculationLock(lockKey);
  }
});

app.post('/api/fo/km/recalculate-all', requireSupabaseJwt, requireFoKmBatchRecalculationPermission, async (request, response) => {
  const payload = request.body || {};
  const date = payload.date || payload.fromDate || currentIndiaDateInput();
  const lockDate = normalizeFoKmRecalculationDate(date);
  pruneStaleFoKmRecalculationLocks();
  if (foKmRecalculateAllLocks.has(lockDate) || hasFoKmRecalculationForDate(lockDate)) {
    response.status(409).json({ ok: false, message: FO_KM_RECALCULATION_RUNNING_MESSAGE });
    return;
  }
  addFoKmRecalculateAllLock(lockDate);
  try {
    const client = requireServiceRoleSupabase();
    await assertServiceRoleAuthAdminAccess(client);
    const result = await recalculateFoKmForToday(client, { ...payload, date }, {
      maxGoogleDirectionsCalls: payload.max_google_directions_calls,
      skipDelayedCheckoutGoogle: true,
    });
    response.json({ ok: true, ...result });
  } catch (error) {
    const safeError = safeServiceRoleError(error, 'service_role_auth_admin_failed');
    response.status(safeError.statusCode).json({
      ok: false,
      message: safeError.message,
      ...(safeError.diagnosticReason
        ? { diagnosticReason: safeError.diagnosticReason }
        : {}),
    });
  } finally {
    releaseFoKmRecalculateAllLock(lockDate);
  }
});

app.post(
  '/api/reports/daily-operations/send',
  requireSupabaseJwt,
  requireDailyReportPermission,
  async (request, response) => {
    try {
      const client = requireServiceRoleSupabase();
      const body = request.body || {};
      const mode = String(body.mode || 'all').trim().toLowerCase();
      if (!['master', 'state', 'all'].includes(mode)) {
        response.status(400).json({ ok: false, message: 'mode must be master, state, or all.' });
        return;
      }
      if (mode === 'state' && !body.state) {
        response.status(400).json({ ok: false, message: 'state is required for state report mode.' });
        return;
      }
      const result = await sendDailyOperationsReports({
        client,
        date: body.date,
        mode,
        state: body.state ? normalizeReportState(body.state) : undefined,
        to: body.to,
        cc: body.cc,
      });
      response.json(result);
    } catch (error) {
      response.status(error.statusCode || 500).json({
        ok: false,
        message: error.message || 'Daily Operations report failed.',
        code: error.code || null,
      });
    }
  },
);

app.post('/api/cron/daily-operations-report', async (request, response) => {
  try {
    const expectedSecret = String(process.env.REPORT_CRON_SECRET || '').trim();
    const providedSecret = String(request.headers['x-cron-secret'] || '').trim();
    if (!expectedSecret || providedSecret !== expectedSecret) {
      response.status(401).json({ ok: false, message: 'Invalid cron secret.' });
      return;
    }
    const client = requireServiceRoleSupabase();
    const reportDate = request.body?.date || previousReportDate();
    const result = await sendDailyOperationsReports({
      client,
      date: reportDate,
      mode: 'master',
      preventDuplicate: true,
    });
    response.json(result);
  } catch (error) {
    response.status(error.statusCode || 500).json({
      ok: false,
      message: error.message || 'Daily Operations cron report failed.',
      code: error.code || null,
    });
  }
});

async function runFoStaleSessionCleanup(reason = 'scheduled') {
  try {
    const client = requireServiceRoleSupabase();
    await assertServiceRoleAuthAdminAccess(client);
    const result = await cleanupStaleFoSessions(client);
    console.log('[myQPMS FO stale cleanup] run complete', {
      reason,
      indiaDate: result.indiaDate,
      attendanceRowsFound: result.attendanceRowsFound,
      visitsClosed: result.visitsClosed,
      attendanceClosed: result.attendanceClosed,
      liveStatusesReset: result.liveStatusesReset,
      staleLiveStatusReferencesChecked: result.staleLiveStatusReferencesChecked,
      staleLiveStatusReferencesFound: result.staleLiveStatusReferencesFound,
      staleLiveStatusReferencesCleared: result.staleLiveStatusReferencesCleared,
      staleLiveStatusAffectedFoIds: result.staleLiveStatusAffectedFoIds,
      reviewEvidenceCaptured: result.reviewEvidenceCaptured,
      skippedStaleGps: result.skippedStaleGps,
      skippedBecauseTodayAttendanceExists: result.skippedBecauseTodayAttendanceExists,
      errors: result.errors?.length || 0,
      skipped: result.skipped,
    });
    return result;
  } catch (error) {
    const safeError = safeServiceRoleError(error, 'service_role_auth_admin_failed');
    console.warn('[myQPMS FO stale cleanup] run failed', {
      reason,
      message: safeError.message,
      code: safeError.code,
      diagnosticReason: safeError.diagnosticReason,
      serviceRoleClientAvailable: Boolean(serviceRoleSupabase),
    });
    return {
      ok: false,
      message: safeError.message,
      code: safeError.code,
      diagnosticReason: safeError.diagnosticReason,
    };
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

app.post('/send-lead-mom', requireSupabaseJwt, requireLeadManagementAccess, requireLeadMomAccess, routeSendMom('lead'));
app.post('/send-sitevisit-mom', routeSendMom('sitevisit'));

const REPORT_EMAIL_SCHEDULER_POLL_MS = 30 * 1000;
let lastDailyReportSchedulerMinuteKey = '';

function integerEnv(name, fallback, min, max) {
  const parsed = Number.parseInt(String(process.env[name] ?? ''), 10);
  if (!Number.isInteger(parsed) || parsed < min || parsed > max) return fallback;
  return parsed;
}

function reportEmailSchedulerConfig() {
  return {
    enabled: String(process.env.REPORT_EMAIL_ENABLED || 'true').trim().toLowerCase() !== 'false',
    timezone: process.env.REPORT_EMAIL_TIMEZONE || 'Asia/Kolkata',
    hour: integerEnv('REPORT_EMAIL_HOUR', 9, 0, 23),
    minute: integerEnv('REPORT_EMAIL_MINUTE', 0, 0, 59),
  };
}

function zonedClockParts(date, timezone) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  }).formatToParts(date);
  return Object.fromEntries(parts.map((part) => [part.type, part.value]));
}

async function runScheduledDailyOperationsReport(reason = 'scheduler') {
  const config = reportEmailSchedulerConfig();
  const reportDate = previousReportDate();
  try {
    console.log('[myQPMS Daily Report Scheduler] run started', {
      reason,
      scheduledHour: config.hour,
      scheduledMinute: config.minute,
      timezone: config.timezone,
      reportDate,
      mode: 'master',
    });
    const client = requireServiceRoleSupabase();
    const result = await sendDailyOperationsReports({
      client,
      date: reportDate,
      mode: 'master',
      preventDuplicate: true,
    });
    const masterResult = (result.results || []).find((item) => item.type === 'master') || result.results?.[0] || {};
    console.log('[myQPMS Daily Report Scheduler] run complete', {
      reason,
      ok: result.ok,
      duplicateSkipped: Boolean(result.duplicateSkipped),
      reportDate: result.date,
      mode: result.mode,
      recipientsCount: (masterResult.recipients || []).length + (masterResult.cc || []).length,
      messageId: masterResult.email?.messageId || null,
      skipped: Boolean(masterResult.skipped),
    });
  } catch (error) {
    console.error('[myQPMS Daily Report Scheduler] run failed', {
      reason,
      reportDate,
      mode: 'master',
      message: error.message,
      code: error.code || null,
    });
  }
}

function startDailyOperationsReportScheduler() {
  const config = reportEmailSchedulerConfig();
  console.log('[myQPMS Daily Report Scheduler] started', {
    enabled: config.enabled,
    scheduledHour: config.hour,
    scheduledMinute: config.minute,
    timezone: config.timezone,
    mode: 'master',
  });
  if (!config.enabled) return;

  const tick = () => {
    const currentConfig = reportEmailSchedulerConfig();
    if (!currentConfig.enabled) return;
    const parts = zonedClockParts(new Date(), currentConfig.timezone);
    const currentHour = Number(parts.hour);
    const currentMinute = Number(parts.minute);
    if (currentHour !== currentConfig.hour || currentMinute !== currentConfig.minute) return;

    const minuteKey = `${parts.year}-${parts.month}-${parts.day}T${parts.hour}:${parts.minute}:${currentConfig.timezone}`;
    if (minuteKey === lastDailyReportSchedulerMinuteKey) return;
    lastDailyReportSchedulerMinuteKey = minuteKey;
    runScheduledDailyOperationsReport('scheduled_time');
  };

  tick();
  setInterval(tick, REPORT_EMAIL_SCHEDULER_POLL_MS).unref?.();
}

function endDayKmAutoRecalcEnabled() {
  return String(process.env.END_DAY_KM_AUTO_RECALC_ENABLED || 'false').trim().toLowerCase() === 'true';
}

function endDayKmAutoRecalcCooldownMs() {
  const minutes = integerEnv('END_DAY_KM_AUTO_RECALC_COOLDOWN_MINUTES', 10, 1, 1440);
  return minutes * 60 * 1000;
}

function metadataTimestampMs(metadata = {}, keys = []) {
  if (!metadata || typeof metadata !== 'object' || Array.isArray(metadata)) return null;
  for (const key of keys) {
    const value = metadata[key];
    const timestamp = value ? new Date(value).getTime() : NaN;
    if (Number.isFinite(timestamp)) return timestamp;
  }
  return null;
}

function attendanceNeedsEndDayKmAutoRecalc(row, now = new Date()) {
  const metadata = row?.metadata && typeof row.metadata === 'object' && !Array.isArray(row.metadata)
    ? row.metadata
    : {};
  const recalculatedAt = metadataTimestampMs(metadata, [
    'km_recalculated_at',
    'travel_leg_recalculated_at',
    'actual_travel_updated_at',
  ]);
  if (!recalculatedAt) return true;
  return now.getTime() - recalculatedAt >= endDayKmAutoRecalcCooldownMs();
}

async function loadEndDayKmAutoRecalcCandidates(client, date) {
  const { data, error } = await client
    .from('fo_attendance')
    .select('id, fo_user_id, employee_code, attendance_date, logout_time, status, metadata')
    .eq('attendance_date', date)
    .not('logout_time', 'is', null)
    .in('status', ['Completed', 'Ended', 'Ended Day', 'Closed', 'Auto Ended', 'Stale Auto Ended'])
    .order('logout_time', { ascending: false })
    .limit(END_DAY_KM_AUTO_RECALC_LIMIT);
  if (error) throw error;
  const now = new Date();
  return (data || []).filter((row) => attendanceNeedsEndDayKmAutoRecalc(row, now));
}

async function runEndDayKmAutoRecalc(reason = 'interval') {
  if (!endDayKmAutoRecalcEnabled()) return;
  const date = currentIndiaDateInput();
  const startedAt = Date.now();
  const summary = {
    reason,
    date,
    scanned: 0,
    updated: 0,
    skippedLocked: 0,
    failed: 0,
  };
  console.log('END_DAY_KM_AUTO_RECALC_STARTED', {
    reason,
    date,
    limit: END_DAY_KM_AUTO_RECALC_LIMIT,
    cooldownMinutes: endDayKmAutoRecalcCooldownMs() / 60000,
  });
  try {
    const client = requireServiceRoleSupabase();
    const candidates = await loadEndDayKmAutoRecalcCandidates(client, date);
    summary.scanned = candidates.length;
    for (const attendance of candidates) {
      const payload = {
        attendance_id: attendance.id,
        fo_user_id: attendance.fo_user_id || attendance.employee_code,
        employee_code: attendance.employee_code,
        date: attendance.attendance_date || date,
      };
      const lockKey = foKmRecalculationLockKey(payload);
      const lockDate = normalizeFoKmRecalculationDate(payload.date);
      pruneStaleFoKmRecalculationLocks();
      if (foKmRecalculateAllLocks.has(lockDate) || foKmRecalculationLocks.has(lockKey)) {
        summary.skippedLocked += 1;
        continue;
      }
      addFoKmRecalculationLock(lockKey);
      try {
        const result = await recalculateFoKm(client, payload, {
          maxGoogleDirectionsCalls: Number(process.env.END_DAY_KM_AUTO_RECALC_MAX_GOOGLE_DIRECTIONS_CALLS || process.env.MAX_GOOGLE_DIRECTIONS_CALLS),
        });
        summary.updated += 1;
        console.log('END_DAY_KM_AUTO_RECALC_ATTENDANCE_UPDATED', {
          attendance_id: attendance.id,
          fo_user_id: attendance.fo_user_id || null,
          employee_code: attendance.employee_code || null,
          total_route_km: result.total_route_km ?? result.new_total_route_km ?? null,
          petrol_amount: result.petrol_amount ?? result.new_petrol_amount ?? null,
          route_sync_status: result.route_sync_status || null,
        });
      } catch (error) {
        summary.failed += 1;
        console.error('END_DAY_KM_AUTO_RECALC_FAILED', {
          attendance_id: attendance.id,
          fo_user_id: attendance.fo_user_id || null,
          employee_code: attendance.employee_code || null,
          message: error.message,
          code: error.code || null,
        });
      } finally {
        releaseFoKmRecalculationLock(lockKey);
      }
    }
  } catch (error) {
    summary.failed += 1;
    console.error('END_DAY_KM_AUTO_RECALC_FAILED', {
      reason,
      date,
      message: error.message,
      code: error.code || null,
    });
  } finally {
    console.log('END_DAY_KM_AUTO_RECALC_COMPLETED', {
      ...summary,
      durationMs: Date.now() - startedAt,
    });
  }
}

function startEndDayKmAutoRecalcScheduler() {
  const enabled = endDayKmAutoRecalcEnabled();
  console.log('[myQPMS End Day KM Auto Recalc] started', {
    enabled,
    intervalMs: END_DAY_KM_AUTO_RECALC_INTERVAL_MS,
    timezone: 'Asia/Kolkata',
    cooldownMinutes: endDayKmAutoRecalcCooldownMs() / 60000,
    limit: END_DAY_KM_AUTO_RECALC_LIMIT,
  });
  if (!enabled) return;
  runEndDayKmAutoRecalc('startup');
  setInterval(() => {
    runEndDayKmAutoRecalc('interval');
  }, END_DAY_KM_AUTO_RECALC_INTERVAL_MS).unref?.();
}

app.listen(port, () => {
  console.log('[myQPMS Mail API] Startup complete', {
    port,
    allowedOrigins,
    emailUserConfigured: Boolean(process.env.EMAIL_USER),
    emailPassConfigured: Boolean(process.env.EMAIL_PASS),
    supabaseConfigured: supabaseConfigStatus.configured,
    ...safeSupabaseConfigDiagnostics(),
    serviceRoleClientAvailable: Boolean(serviceRoleSupabase),
    serviceRoleSupabaseInitialized: Boolean(serviceRoleSupabase),
  });
  verifyMailTransporter();
  startDailyOperationsReportScheduler();
  startEndDayKmAutoRecalcScheduler();
  runFoStaleSessionCleanup('startup');
  if (Number.isFinite(FO_STALE_CLEANUP_INTERVAL_MS) && FO_STALE_CLEANUP_INTERVAL_MS > 0) {
    setInterval(() => {
      runFoStaleSessionCleanup('interval');
    }, FO_STALE_CLEANUP_INTERVAL_MS).unref?.();
  }
});
