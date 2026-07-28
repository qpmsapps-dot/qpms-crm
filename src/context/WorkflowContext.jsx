import { useEffect, useState } from 'react';
import { leadRows } from '../data/qpmsWorkflowData.js';
import { bdExecutives, getExecutiveByName } from '../data/mockUsers.js';
import {
  canUseLocalWorkflowStorage,
  convertLeadToAssessment,
  createNotification,
  createLeadRemote,
  createSiteVisitRemote,
  deleteLeadRemote,
  fetchWorkflowData,
  getWorkflowAppMode,
  generateProposalRecord,
  isRemoteWorkflowEnabled,
  isProductionWorkflowMode,
  recordApprovalDecision,
  saveLeadMomRemote,
  saveAssessmentSection,
  saveSiteAssessmentRemote,
  saveSiteMomRemote,
  submitForReview,
  submitApprovalRemote,
  recordApprovalDecisionRemote,
  markProposalSentRemote,
  updateLeadRemote,
  uploadSiteImageRemote,
} from '../services/workflowRepository.js';
import { WorkflowContext } from './workflow-context.js';

const leadsStorageKey = 'qpms-crm-workflow-leads';
const siteVisitsStorageKey = 'qpms-crm-workflow-site-visits';
const appMode = getWorkflowAppMode();

const reviewStages = ['Operations Review', 'Coordinator Costing Review', 'HR Validation', 'Commercial Review', 'Finance Review'];
const pendingOwnerByStage = {
  'Operations Review': 'Operations Team',
  'Coordinator Costing Review': 'Coordinator',
  'HR Validation': 'HR Reviewer',
  'Commercial Review': 'Commercial Reviewer',
  'Finance Review': 'Finance Reviewer',
};

const defaultLeadDetails = {
  industry: 'Facility Management',
  location: 'Client site pending confirmation',
  state: 'Tamil Nadu',
  city: 'Chennai',
  designation: 'Facility Manager',
  phone: '+91 98765 21000',
  email: 'client@example.com',
  priority: 'Medium',
  remarks: 'Initial lead captured for myQPMS business workflow.',
  activity: [],
};

function createFallbackContact(lead) {
  return {
    id: `contact-${lead.id || Date.now()}-primary`,
    name: lead.contact || '',
    designation: lead.designation || '',
    phone: lead.phone || '',
    email: lead.email || '',
    isPrimary: true,
  };
}

function normalizeContacts(contacts, lead = {}) {
  const sourceContacts = Array.isArray(contacts) && contacts.length ? contacts : [createFallbackContact(lead)];
  const dedupedContacts = sourceContacts.reduce((items, contact) => {
    const key = String(contact.id || contact.email || contact.phone || contact.contact_number || '').trim().toLowerCase();
    const fallbackKey = `${String(contact.name || '').trim().toLowerCase()}|${String(contact.designation || '').trim().toLowerCase()}`;
    const matchKey = key || fallbackKey;
    if (matchKey && items.some((item) => item.__matchKey === matchKey)) return items;
    return [...items, { ...contact, __matchKey: matchKey }];
  }, []);
  const primaryIndex = Math.max(dedupedContacts.findIndex((contact) => contact.isPrimary), 0);

  return dedupedContacts.map((contact, index) => ({
    id: contact.id || `contact-${Date.now()}-${index}`,
    name: contact.name || '',
    designation: contact.designation || '',
    phone: contact.phone || '',
    email: contact.email || '',
    isPrimary: index === primaryIndex,
  }));
}

function hasMeaningfulSurveyData(survey = {}) {
  return Object.values(survey || {}).some((value) => {
    if (Array.isArray(value)) return value.length > 0;
    if (value && typeof value === 'object') return Object.keys(value).length > 0;
    return value !== undefined && value !== null && value !== '';
  });
}

function isReviewCompleteForProposal(visit = {}) {
  if (['Returned to BD', 'Proposal Generated', 'Proposal Sent'].includes(visit.status) || visit.currentStage === 'Returned to BD') return true;
  const statuses = visit.reviewStatus || {};
  return reviewStages.every((stage) => statuses[stage] === 'Approved');
}

function nextSubmissionStageForVisit(visit = {}) {
  const statuses = visit.reviewStatus || {};
  return reviewStages.find((stage) => statuses[stage] === 'Rework Requested')
    || reviewStages.find((stage) => statuses[stage] !== 'Approved')
    || 'Operations Review';
}

function getPrimaryContact(lead) {
  return normalizeContacts(lead.contacts, lead).find((contact) => contact.isPrimary) || normalizeContacts(lead.contacts, lead)[0];
}

function ownerFieldsForExecutive(executiveName) {
  const executive = getExecutiveByName(executiveName) || bdExecutives[0];
  return {
    executive: executive?.name || executiveName || 'Unassigned',
    assigned_bd_executive: executive?.name || executiveName || 'Unassigned',
    assigned_bd_email: executive?.email || '',
    created_by_user_id: executive?.id || '',
    created_by_name: executive?.name || executiveName || 'Unassigned',
  };
}

function readStorage(key, fallback) {
  if (typeof window === 'undefined') return fallback;

  try {
    const saved = window.localStorage.getItem(key);
    return saved ? JSON.parse(saved) : fallback;
  } catch {
    return fallback;
  }
}

function normalizeLead(lead) {
  const contacts = normalizeContacts(lead.contacts, lead);
  const primaryContact = contacts.find((contact) => contact.isPrimary) || contacts[0];
  const ownerFields = ownerFieldsForExecutive(lead.executive || lead.assigned_bd_executive);
  const hasAssignedName = Object.prototype.hasOwnProperty.call(lead, 'assigned_bd_executive');
  const hasAssignedEmail = Object.prototype.hasOwnProperty.call(lead, 'assigned_bd_email');
  const hasCreatorId = Object.prototype.hasOwnProperty.call(lead, 'created_by_user_id');
  const hasCreatorName = Object.prototype.hasOwnProperty.call(lead, 'created_by_name');

  return {
    ...defaultLeadDetails,
    ...lead,
    ...ownerFields,
    ...lead,
    executive: lead.executive || ownerFields.executive,
    assigned_bd_executive: hasAssignedName ? lead.assigned_bd_executive || '' : ownerFields.assigned_bd_executive,
    assigned_bd_email: hasAssignedEmail ? lead.assigned_bd_email || '' : ownerFields.assigned_bd_email,
    created_by_user_id: hasCreatorId ? lead.created_by_user_id || '' : ownerFields.created_by_user_id,
    created_by_name: hasCreatorName ? lead.created_by_name || '' : ownerFields.created_by_name,
    contacts,
    contact: primaryContact?.name || '',
    designation: primaryContact?.designation || '',
    phone: primaryContact?.phone || '',
    email: primaryContact?.email || '',
    leadId: lead.leadId || `LD-${String(lead.id).padStart(4, '0')}`,
    stage: lead.stage || 'New Lead',
    status: lead.status || 'Active',
    activity: lead.activity || ['Lead record available in desktop workflow'],
  };
}

function buildSiteVisitFromLead(lead) {
  const primaryContact = getPrimaryContact(lead);

  return {
    id: `SV-${lead.id}`,
    leadId: lead.id,
    company: lead.company,
    industry: lead.industry,
    contacts: normalizeContacts(lead.contacts, lead),
    contact: primaryContact?.name || '',
    designation: primaryContact?.designation || '',
    phone: primaryContact?.phone || '',
    email: primaryContact?.email || '',
    source: lead.source,
    priority: lead.priority,
    executive: lead.executive,
    assigned_bd_executive: lead.assigned_bd_executive,
    assigned_bd_email: lead.assigned_bd_email,
    created_by_user_id: lead.created_by_user_id,
    created_by_name: lead.created_by_name,
    location: lead.location,
    siteName: lead.location || lead.company,
    state: lead.state,
    city: lead.city,
    scheduledVisitDate: lead.scheduledVisitDate || '',
    scheduledVisitTime: lead.scheduledVisitTime || '',
    siteVisitRemarks: lead.siteVisitRemarks || '',
    momStatus: 'Pending',
    status: 'Scheduled',
    currentStage: 'Pre-Operational Assessment',
    createdFrom: 'Lead MOM Sent',
    survey: {
      siteAddress: lead.location,
      siteType: lead.industry,
      operatingHours: '',
      ifmScope: '',
      hardServices: '',
      softServices: '',
      landscaping: '',
      pestControl: '',
      hseCompliance: '',
      manpower: '',
      tools: '',
      equipment: '',
      consumables: '',
      clientKyc: '',
      riskAssessment: '',
      commercialStatement: '',
      approvalWorkflow: '',
      finalRemarks: '',
    },
    siteMom: null,
    activity: ['Site Visit scheduled with client', 'Lead MOM sent. Site survey workflow opened.'],
  };
}

function hasCompleteSiteVisitSchedule(mom) {
  return Boolean(mom?.scheduledVisitDate && mom?.scheduledVisitTime);
}

function buildApprovalTimeline(visit, event) {
  return [
    {
      label: event,
      at: new Date().toISOString(),
    },
    ...(visit.approvalTimeline || []),
  ].slice(0, 12);
}

async function notifyPendingRole(visit, recipientRole, title, message) {
  if (!isRemoteWorkflowEnabled() || !recipientRole) return null;
  try {
    return await createNotification({
      recipientRole,
      workflowInstanceId: visit.workflowInstanceId || null,
      leadId: visit.leadId,
      siteVisitId: visit.id,
      type: 'Workflow Assignment',
      title,
      message,
      priority: 'High',
      actionUrl: '/tasks',
      actionLabel: 'Open Review',
      metadata: {
        currentStage: visit.currentStage,
        client: visit.company,
      },
    });
  } catch (error) {
    console.warn('[myQPMS Workflow] Notification skipped', error.message);
    return null;
  }
}

function upsertById(items, nextItem) {
  const exists = items.some((item) => item.id === nextItem.id);
  return exists ? items.map((item) => (item.id === nextItem.id ? nextItem : item)) : [nextItem, ...items];
}

function shouldUseLegacyRemoteFallback(error) {
  return !isProductionWorkflowMode() && (error?.isRpcMissing || String(error?.message || '').toLowerCase().includes('schema cache'));
}

function rpcIdempotencyKey(scope, id) {
  const suffix = typeof crypto !== 'undefined' && crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  return `ui:${scope}:${id || 'unknown'}:${suffix}`;
}

function inferSectionFromSurveyPatch(survey = {}) {
  const keys = Object.keys(survey || {}).filter((key) => !key.startsWith('__'));
  if (survey.__sectionCode) {
    return {
      code: survey.__sectionCode,
      name: survey.__sectionName || survey.__sectionCode,
      data: survey.__sectionData || survey,
      baseVersionNumber: survey.__baseVersionNumber,
    };
  }
  if (keys.length === 1) {
    const code = keys[0];
    return {
      code,
      name: code.replace(/([A-Z])/g, ' $1').replace(/^./, (letter) => letter.toUpperCase()),
      data: survey[code],
      baseVersionNumber: survey.__baseVersionNumber,
    };
  }
  return {
    code: 'legacy_full_assessment_snapshot',
    name: 'Legacy Full Assessment Snapshot',
    data: survey,
    baseVersionNumber: survey.__baseVersionNumber,
  };
}

export function WorkflowProvider({ children }) {
  const [leads, setLeads] = useState(() => (isRemoteWorkflowEnabled() ? [] : readStorage(leadsStorageKey, leadRows).map(normalizeLead)));
  const [siteVisits, setSiteVisits] = useState(() => (isRemoteWorkflowEnabled() ? [] : readStorage(siteVisitsStorageKey, [])));
  const [backendStatus, setBackendStatus] = useState(isRemoteWorkflowEnabled() ? 'connecting' : 'local');
  const [workflowError, setWorkflowError] = useState('');
  const [workflowDebug, setWorkflowDebug] = useState({
    apiSource: isRemoteWorkflowEnabled() ? 'supabase.public.leads' : 'local.mock',
    totalLeadsFetched: isRemoteWorkflowEnabled() ? 0 : leadRows.length,
    latestLeadId: '',
    latestClientName: '',
    postmanAutomationLeads: 0,
    approvalRequestsFetched: 0,
  });

  useEffect(() => {
    if (!isRemoteWorkflowEnabled()) {
      console.info('[myQPMS Workflow] Supabase env missing; using local/mock workflow storage', { appMode });
      return;
    }

    let active = true;
    console.info('[myQPMS Workflow] Remote workflow mode active; loading Supabase workflow data', { appMode });
    refreshWorkflowData()
      .then(() => {
        if (!active) return;
      })
      .catch(() => {
        if (active) setBackendStatus('error');
      });

    return () => {
      active = false;
    };
  }, []);

  async function refreshWorkflowData() {
    if (!isRemoteWorkflowEnabled()) return;
    setBackendStatus('connecting');
    setWorkflowError('');
    return fetchWorkflowData()
      .then((data) => {
        setLeads(data.leads.map(normalizeLead));
        setSiteVisits(data.siteVisits);
        setWorkflowDebug(data.debug || {
          apiSource: 'supabase.public.leads',
          totalLeadsFetched: data.leads.length,
          latestLeadId: data.leads[0]?.id || '',
          latestClientName: data.leads[0]?.company || '',
          postmanAutomationLeads: data.leads.filter((lead) => lead.source === 'Postman Automation').length,
          approvalRequestsFetched: data.siteVisits.reduce((sum, visit) => sum + (visit.approvals?.length || 0), 0),
        });
        setBackendStatus('connected');
        console.info('[myQPMS Workflow] Supabase workflow connected', {
          leads: data.leads.length,
          siteVisits: data.siteVisits.length,
        });
      })
      .catch((error) => {
        console.error('[myQPMS Workflow] Supabase fetch failed; mock data disabled for remote mode', error);
        setBackendStatus('error');
        setWorkflowError(`Supabase fetch failed: ${error.message}`);
        throw error;
      });
  }

  useEffect(() => {
    if (!canUseLocalWorkflowStorage() || isRemoteWorkflowEnabled()) return;
    window.localStorage.setItem(leadsStorageKey, JSON.stringify(leads));
  }, [leads]);

  useEffect(() => {
    if (!canUseLocalWorkflowStorage() || isRemoteWorkflowEnabled()) return;
    window.localStorage.setItem(siteVisitsStorageKey, JSON.stringify(siteVisits));
  }, [siteVisits]);

  async function addLead(lead, user) {
    const selfAssigned = user?.role === 'BD Executive';
    const ownerFields = {
      executive: selfAssigned ? user.name : lead.executive || lead.assigned_bd_executive || 'Unassigned',
      assigned_bd_executive: selfAssigned ? user.name : lead.assigned_bd_executive || lead.executive || '',
      assigned_bd_email: selfAssigned ? user.email : lead.assigned_bd_email || '',
      assigned_bd_profile_id: selfAssigned ? '' : lead.assigned_bd_profile_id || '',
      created_by_user_id: user?.id || '',
      created_by_name: user?.name || user?.email || '',
    };
    const submissionId = lead.idempotencyKey
      || (isRemoteWorkflowEnabled() && typeof crypto !== 'undefined' && crypto.randomUUID ? crypto.randomUUID() : Date.now());
    const nextLead = normalizeLead({
      ...lead,
      ...ownerFields,
      id: submissionId,
      leadId: `LD-${Date.now().toString().slice(-5)}`,
      stage: 'New Lead',
      status: 'Active',
      contacts: normalizeContacts(lead.contacts, lead),
      activity: ['New lead created from desktop application'],
    });

    console.info('[myQPMS Workflow] Add lead invoked', {
      mode: isRemoteWorkflowEnabled() ? 'supabase' : 'local',
      leadId: nextLead.id,
      company: nextLead.company,
      contactCount: nextLead.contacts?.length || 0,
    });
    if (isRemoteWorkflowEnabled()) {
      setBackendStatus('saving');
      setWorkflowError('');
      try {
        const insertedId = await createLeadRemote(nextLead);
        console.info('[myQPMS Workflow] Lead insert complete; refetching Supabase leads', { insertedId });
        await refreshWorkflowData();
        return { ...nextLead, id: insertedId };
      } catch (error) {
        console.error('[myQPMS Workflow] Lead Supabase insert failed', error);
        setBackendStatus('error');
        setWorkflowError(`Lead insert failed: ${error.message}`);
        throw error;
      }
    }
    setLeads((current) => [nextLead, ...current]);
    return nextLead;
  }

  async function deleteLead(leadId, user) {
    const leadToDelete = leads.find((lead) => lead.id === leadId);
    setLeads((current) => current.filter((lead) => lead.id !== leadId));
    setSiteVisits((current) => current.filter((visit) => visit.leadId !== leadId));

    if (!isRemoteWorkflowEnabled()) return;

    setBackendStatus('saving');
    setWorkflowError('');
    try {
      await deleteLeadRemote(leadId, user?.name || user?.email || leadToDelete?.created_by_name);
      await refreshWorkflowData();
    } catch (error) {
      console.error('[myQPMS Workflow] Lead Supabase delete failed', error);
      setBackendStatus('error');
      setWorkflowError(`Lead delete failed: ${error.message}`);
      if (leadToDelete) setLeads((current) => upsertById(current, leadToDelete));
      throw error;
    }
  }

  async function updateLead(leadId, updater) {
    const previousLead = leads.find((lead) => lead.id === leadId);
    if (!previousLead) throw new Error('Lead not found.');
    const patch = typeof updater === 'function' ? updater(previousLead) : updater;
    const nextLead = normalizeLead({ ...previousLead, ...patch });
    setLeads((current) => current.map((lead) => (lead.id === leadId ? nextLead : lead)));
    if (!isRemoteWorkflowEnabled()) return nextLead;

    setBackendStatus('saving');
    setWorkflowError('');
    try {
      await updateLeadRemote(leadId, nextLead);
      await refreshWorkflowData();
      return nextLead;
    } catch (error) {
      setLeads((current) => current.map((lead) => (lead.id === leadId ? previousLead : lead)));
      setBackendStatus('error');
      setWorkflowError(`Lead update failed: ${error.message}`);
      throw error;
    }
  }

  function addLeadActivity(leadId, message) {
    void updateLead(leadId, (lead) => ({
      activity: [message, ...(lead.activity || [])].slice(0, 8),
    })).catch((error) => console.warn('Lead activity update failed:', error.message));
  }

  function saveLeadMomDraft(leadId, mom) {
    void updateLead(leadId, (lead) => ({
      mom: { ...mom, sent: Boolean(mom.sent) },
      activity: ['Lead MOM draft saved', ...(lead.activity || [])].slice(0, 8),
    })).catch((error) => console.warn('Lead MOM summary update failed:', error.message));
    if (isRemoteWorkflowEnabled()) {
      saveLeadMomRemote(leadId, mom, 'Draft').catch((error) => {
        console.warn('Lead MOM Supabase save failed:', error.message);
        setBackendStatus('fallback');
      });
    }
  }

  function sendLeadMom(leadId, mom) {
    let createdVisit = null;
    const shouldCreateSiteVisit = hasCompleteSiteVisitSchedule(mom);
    const existingVisit = siteVisits.find((visit) => String(visit.leadId) === String(leadId));
    if (shouldCreateSiteVisit && existingVisit) {
      console.warn('[myQPMS Workflow] Duplicate conversion prevented', { leadId, siteVisitId: existingVisit.id });
      throw new Error('Assessment already created for this lead.');
    }

    setLeads((currentLeads) =>
      currentLeads.map((lead) => {
        if (lead.id !== leadId) return lead;

        const nextLead = {
          ...lead,
          stage: shouldCreateSiteVisit ? 'Converted' : 'Lead MOM Sent',
          status: shouldCreateSiteVisit ? 'Converted to Assessment' : 'MOM Sent',
          scheduledVisitDate: mom.scheduledVisitDate || '',
          scheduledVisitTime: mom.scheduledVisitTime || '',
          siteVisitRemarks: mom.siteVisitRemarks || '',
          mom: { ...mom, sent: true, sentAt: new Date().toISOString() },
          activity: [
            ...(shouldCreateSiteVisit ? ['Site Visit scheduled with client'] : []),
            shouldCreateSiteVisit ? 'Lead MOM sent to client. Moved to Site Visit & Estimation.' : 'Lead MOM sent to client with follow-up date.',
            ...(lead.activity || []),
          ].slice(0, 8),
        };
        if (shouldCreateSiteVisit) createdVisit = buildSiteVisitFromLead(nextLead);
        if (isRemoteWorkflowEnabled()) {
          const remoteWorkflow = async () => {
            await saveLeadMomRemote(leadId, mom, 'Sent');
            if (shouldCreateSiteVisit) {
              try {
                await convertLeadToAssessment(nextLead, {
                  user: {
                    id: nextLead.created_by_user_id,
                    name: nextLead.created_by_name,
                    email: nextLead.assigned_bd_email,
                    role: 'BD Team',
                  },
                  idempotencyKey: rpcIdempotencyKey('lead-conversion', leadId),
                });
              } catch (error) {
                if (!shouldUseLegacyRemoteFallback(error)) throw error;
                console.warn('[myQPMS Workflow] Lead conversion RPC unavailable; using legacy demo conversion fallback', error.message);
                await updateLeadRemote(leadId, nextLead);
                await createSiteVisitRemote(nextLead);
              }
            } else if (!isProductionWorkflowMode()) {
              await updateLeadRemote(leadId, nextLead);
            }
          };

          remoteWorkflow()
            .then(() => refreshWorkflowData())
            .catch((error) => {
              console.warn('Lead MOM/Site Visit Supabase save failed:', error.message);
              setBackendStatus(isProductionWorkflowMode() ? 'error' : 'fallback');
              setWorkflowError(`Lead MOM workflow failed: ${error.message}`);
            });
        }
        return nextLead;
      }),
    );

    if (createdVisit) {
      setSiteVisits((current) => upsertById(current, createdVisit));
    }

    return createdVisit;
  }

  function updateSiteVisit(siteVisitId, updater) {
    setSiteVisits((current) =>
      current.map((visit) => {
        if (visit.id !== siteVisitId) return visit;
        const patch = typeof updater === 'function' ? updater(visit) : updater;
        return { ...visit, ...patch };
      }),
    );
  }

  function saveSiteSurvey(siteVisitId, survey, status = 'Draft', user) {
    const visit = siteVisits.find((item) => item.id === siteVisitId);
    if (!hasMeaningfulSurveyData(survey)) {
      console.warn('[myQPMS Workflow] Blank assessment save skipped', { siteVisitId, status });
      return;
    }
    const mergedSurvey = { ...(visit?.survey || {}), ...survey };
    console.info('[myQPMS Workflow] Saving site assessment', { siteVisitId, status, sectionCount: Object.keys(mergedSurvey || {}).length });
    updateSiteVisit(siteVisitId, (visit) => ({
      survey: { ...visit.survey, ...mergedSurvey },
      activity: ['Site survey draft saved', ...(visit.activity || [])].slice(0, 8),
    }));
    if (isRemoteWorkflowEnabled() && visit) {
      const section = inferSectionFromSurveyPatch(survey);
      saveAssessmentSection({
        visit,
        sectionCode: section.code,
        sectionName: section.name,
        sectionData: section.data,
        baseVersionNumber: section.baseVersionNumber,
        saveMode: status === 'Draft' ? 'draft' : 'save',
        user,
        remarks: status === 'Submitted' ? 'Assessment section submitted' : 'Assessment section saved',
      })
        .then(async () => {
          if (!isProductionWorkflowMode()) {
            await saveSiteAssessmentRemote(visit, mergedSurvey, status, user);
          }
        })
        .catch((error) => {
          if (shouldUseLegacyRemoteFallback(error)) {
            console.warn('[myQPMS Workflow] Assessment section RPC unavailable; using legacy demo assessment save fallback', error.message);
            saveSiteAssessmentRemote(visit, mergedSurvey, status, user).catch((legacyError) => {
              console.warn('Legacy site assessment Supabase save failed:', legacyError.message);
              setBackendStatus('fallback');
            });
            return;
          }
          console.warn('Site assessment section save failed:', error.message);
          setBackendStatus(isProductionWorkflowMode() ? 'error' : 'fallback');
          setWorkflowError(`Assessment save failed: ${error.message}`);
        });
    }
  }

  function saveSiteVisitMom(siteVisitId, mom) {
    updateSiteVisit(siteVisitId, (visit) => ({
      siteMom: { ...mom, sent: Boolean(mom.sent) },
      momStatus: 'Created',
      status: 'Site Visit MOM Created',
      activity: ['Site Visit MOM generated', ...(visit.activity || [])].slice(0, 8),
    }));
    if (isRemoteWorkflowEnabled()) {
      saveSiteMomRemote(siteVisitId, mom, 'Draft').catch((error) => {
        console.warn('Site MOM Supabase save failed:', error.message);
        setBackendStatus('fallback');
      });
    }
  }

  function sendSiteVisitMom(siteVisitId, mom) {
    updateSiteVisit(siteVisitId, (visit) => ({
      siteMom: { ...mom, sent: true, sentAt: new Date().toISOString() },
      momStatus: 'Sent',
      status: 'Site Visit MOM Sent',
      activity: ['Site Visit MOM sent to client and internal stakeholders', ...(visit.activity || [])].slice(0, 8),
    }));
    if (isRemoteWorkflowEnabled()) {
      saveSiteMomRemote(siteVisitId, mom, 'Sent').catch((error) => {
        console.warn('Site MOM Supabase send save failed:', error.message);
        setBackendStatus('fallback');
      });
    }
  }

  async function submitCommercialReview(siteVisitId, options = {}) {
    const visit = siteVisits.find((item) => item.id === siteVisitId);
    if (!visit) throw new Error('Site visit not found.');
    if (visit.status === 'Pending Review' || ['Returned to BD', 'Proposal Generated', 'Proposal Sent'].includes(visit.status)) {
      throw new Error('This assessment is already submitted into the approval workflow.');
    }
    const adminDemoStartStages = ['HR Validation', 'Commercial Review', 'Finance Review'];
    const adminDemoSubmission = options.adminDemo === true
      && options.actorRole === 'Admin'
      && adminDemoStartStages.includes(options.targetStage);
    const nextSubmitStage = adminDemoSubmission ? options.targetStage : nextSubmissionStageForVisit(visit);
    const nextPendingWith = pendingOwnerByStage[nextSubmitStage] || 'Operations Team';
    updateSiteVisit(siteVisitId, (visit) => ({
      status: 'Pending Review',
      currentStage: nextSubmitStage,
      pendingWith: nextPendingWith,
      approvalStatus: 'Pending',
      approvalRemarks: '',
      reviewStatus: reviewStages.reduce((statusMap, stage) => ({
        ...statusMap,
        [stage]: stage === nextSubmitStage
          ? 'Pending'
          : adminDemoSubmission && reviewStages.indexOf(stage) < reviewStages.indexOf(nextSubmitStage)
            ? 'Approved'
            : statusMap[stage] === 'Approved' ? 'Approved' : 'Not Started',
      }), { ...(visit.reviewStatus || {}) }),
      approvalTimeline: buildApprovalTimeline(visit, `Submitted to ${nextSubmitStage}`),
      activity: [`Submitted to ${nextSubmitStage}`, ...(visit.activity || [])].slice(0, 8),
    }));
    if (isRemoteWorkflowEnabled() && visit) {
      try {
        await submitForReview({
          visit,
          targetStage: nextSubmitStage,
          user: adminDemoSubmission
            ? { name: 'Admin', email: '', role: 'Admin' }
            : { name: visit.created_by_name, email: visit.assigned_bd_email, role: 'BD Team' },
          idempotencyKey: rpcIdempotencyKey('submit-review', siteVisitId),
          remarks: 'Assessment submitted for approval matrix review',
        });
        await notifyPendingRole(
          { ...visit, currentStage: nextSubmitStage },
          nextPendingWith,
          `Assessment pending ${nextSubmitStage}`,
          `${visit.company} is pending ${nextSubmitStage}.`,
        );
        await refreshWorkflowData();
      } catch (error) {
        if (shouldUseLegacyRemoteFallback(error)) {
          console.warn('[myQPMS Workflow] Submit for review RPC unavailable; using legacy demo approval fallback', error.message);
          try {
            await submitApprovalRemote(visit, visit.assessmentId);
            await notifyPendingRole(
              { ...visit, currentStage: nextSubmitStage },
              nextPendingWith,
              `Assessment pending ${nextSubmitStage}`,
              `${visit.company} is pending ${nextSubmitStage}.`,
            );
            await refreshWorkflowData();
            return;
          } catch (legacyError) {
            console.warn('Legacy approval Supabase submit failed:', legacyError.message);
            setBackendStatus('fallback');
            throw legacyError;
          }
        }
        console.warn('Approval submit failed:', error.message);
        setBackendStatus(isProductionWorkflowMode() ? 'error' : 'fallback');
        setWorkflowError(`Submit for review failed: ${error.message}`);
        throw error;
      }
    }
  }

  async function decideApproval(siteVisitId, decision, remarks, user, reviewStage) {
    const visit = siteVisits.find((item) => item.id === siteVisitId);
    if (!visit) throw new Error('Site visit not found.');

    const stage = reviewStage || visit.currentStage || 'Commercial Review';
    const expectedOwner = pendingOwnerByStage[stage];
    if (expectedOwner && user?.role && ![expectedOwner, 'Admin'].includes(user.role)) {
      throw new Error(`${user.role} cannot act on ${stage}.`);
    }
    if ((visit.reviewStatus || {})[stage] && (visit.reviewStatus || {})[stage] !== 'Pending' && visit.currentStage !== stage) {
      throw new Error(`${stage} has already been reviewed.`);
    }
    const normalizedDecision = decision === 'rework' ? 'Rework Requested' : decision === 'reject' ? 'Rejected' : decision === 'return' ? 'Approved' : 'Approved';
    const nextReviewStatus = {
      'Operations Review': 'Not Started',
      'Coordinator Costing Review': 'Not Started',
      'HR Validation': 'Not Started',
      'Commercial Review': 'Not Started',
      'Finance Review': 'Not Started',
      ...(visit.reviewStatus || {}),
      [stage]: normalizedDecision,
    };
    if (normalizedDecision === 'Approved') {
      const nextStageIndex = reviewStages.indexOf(stage) + 1;
      const nextStageName = reviewStages[nextStageIndex];
      if (nextStageName && nextReviewStatus[nextStageName] === 'Not Started') {
        nextReviewStatus[nextStageName] = 'Pending';
      }
    }
    const nextPendingStage = reviewStages.find((name) => nextReviewStatus[name] === 'Pending');
    const allApproved = reviewStages.every((name) => nextReviewStatus[name] === 'Approved') || decision === 'return';
    const nextStage = allApproved ? 'Returned to BD' : nextPendingStage;
    const pendingOwner = pendingOwnerByStage[nextPendingStage];
    const pendingWith = normalizedDecision === 'Rejected'
      ? `${stage.replace(' Review', '').replace(' Validation', '')} rejected`
      : normalizedDecision === 'Rework Requested'
        ? 'BD Executive'
        : allApproved
          ? 'BD Executive'
          : pendingOwner
            ? pendingOwner
            : visit.pendingWith || 'Workflow Review';
    const event = `${stage} ${normalizedDecision}`;

    updateSiteVisit(siteVisitId, (visit) => ({
      status: normalizedDecision === 'Rejected' || normalizedDecision === 'Rework Requested' ? normalizedDecision : allApproved ? 'Returned to BD' : 'Pending Review',
      currentStage: nextStage,
      pendingWith,
      approvalStatus: normalizedDecision === 'Approved' && !allApproved ? 'Pending' : normalizedDecision,
      approvalRemarks: remarks,
      reviewStatus: nextReviewStatus,
      lastApprovalBy: user?.name || user?.email || '',
      lastApprovalAt: new Date().toISOString(),
      approvalTimeline: buildApprovalTimeline(visit, event),
      activity: [event, ...(visit.activity || [])].slice(0, 8),
    }));

    if (isRemoteWorkflowEnabled()) {
      try {
        await recordApprovalDecision({
          visit,
          stage,
          decision: normalizedDecision,
          remarks,
          user,
        });
        if (nextPendingStage) {
          await notifyPendingRole(
            { ...visit, currentStage: nextPendingStage },
            pendingOwner,
            `${nextPendingStage} pending`,
            `${visit.company} is pending with ${pendingOwner}.`,
          );
        } else if (allApproved) {
          await notifyPendingRole(
            { ...visit, currentStage: 'Returned to BD' },
            'BD Team',
            'Assessment ready for proposal',
            `${visit.company} is ready for proposal generation.`,
          );
        }
        await refreshWorkflowData();
      } catch (error) {
        if (shouldUseLegacyRemoteFallback(error) || (!isProductionWorkflowMode() && !visit.workflowInstanceId)) {
          console.warn('[myQPMS Workflow] Approval decision RPC unavailable; using legacy demo decision fallback', error.message);
          try {
            await recordApprovalDecisionRemote({
              visit,
              stage,
              status: normalizedDecision,
              pendingWith,
              remarks,
              user,
            });
            if (nextPendingStage) {
              await notifyPendingRole(
                { ...visit, currentStage: nextPendingStage },
                pendingOwner,
                `${nextPendingStage} pending`,
                `${visit.company} is pending with ${pendingOwner}.`,
              );
            } else if (allApproved) {
              await notifyPendingRole(
                { ...visit, currentStage: 'Returned to BD' },
                'BD Team',
                'Assessment ready for proposal',
                `${visit.company} is ready for proposal generation.`,
              );
            }
            await refreshWorkflowData();
            return;
          } catch (legacyError) {
            console.warn('Legacy approval Supabase decision failed:', legacyError.message);
            setBackendStatus('fallback');
            throw legacyError;
          }
        }
        console.warn('Approval decision failed:', error.message);
        setBackendStatus(isProductionWorkflowMode() ? 'error' : 'fallback');
        setWorkflowError(`Approval decision failed: ${error.message}`);
        throw error;
      }
    }
  }

  async function generateProposal(siteVisitId, proposal, user) {
    const visit = siteVisits.find((item) => item.id === siteVisitId);
    if (!visit) throw new Error('Site visit not found.');
    if (visit.proposal || ['Proposal Generated', 'Proposal Sent'].includes(visit.status)) {
      throw new Error('Proposal is already generated for this assessment.');
    }
    if (!isReviewCompleteForProposal(visit)) {
      throw new Error('Proposal can be generated only after all reviews return to BD.');
    }
    updateSiteVisit(siteVisitId, (visit) => ({
      proposal: { ...(visit.proposal || {}), ...proposal, generatedAt: new Date().toISOString() },
      status: 'Proposal Generated',
      currentStage: 'Returned to BD',
      pendingWith: 'BD Executive',
      activity: ['Proposal generated', ...(visit.activity || [])].slice(0, 8),
    }));

    if (isRemoteWorkflowEnabled()) {
      try {
        await generateProposalRecord({
          visit,
          proposal,
          user,
          idempotencyKey: rpcIdempotencyKey('proposal', siteVisitId),
        });
        await notifyPendingRole(
          { ...visit, currentStage: 'Returned to BD' },
          'BD Team',
          'Proposal generated',
          `${visit.company} proposal is generated and ready to send.`,
        );
        await refreshWorkflowData();
      } catch (error) {
        if (shouldUseLegacyRemoteFallback(error) || (!isProductionWorkflowMode() && !visit.workflowInstanceId)) {
          console.warn('[myQPMS Workflow] Proposal RPC unavailable; retaining demo proposal locally', error.message);
          setBackendStatus('fallback');
          return;
        }
        setBackendStatus('error');
        setWorkflowError(`Proposal generation failed: ${error.message}`);
        throw error;
      }
    }
  }

  async function markProposalSent(siteVisitId, proposalPatch = {}) {
    const visit = siteVisits.find((item) => item.id === siteVisitId);
    if (!visit) throw new Error('Site visit not found.');
    if (visit.status === 'Proposal Sent' || visit.proposal?.status === 'Sent') {
      throw new Error('Proposal is already marked as sent.');
    }
    updateSiteVisit(siteVisitId, (visit) => ({
      proposal: { ...(visit.proposal || {}), ...proposalPatch, sentAt: new Date().toISOString(), status: 'Sent' },
      status: 'Proposal Sent',
      currentStage: 'Proposal Sent',
      pendingWith: 'Existing Business Operations',
      approvalStatus: 'Completed',
      activity: ['Proposal sent to client', 'Moved to Existing Business Pipeline', ...(visit.activity || [])].slice(0, 8),
    }));
    if (isRemoteWorkflowEnabled()) {
      try {
        await markProposalSentRemote(visit, proposalPatch);
        await notifyPendingRole(
          { ...visit, currentStage: 'Proposal Sent' },
          'Management',
          'Proposal sent',
          `${visit.company} moved to Existing Business Pipeline.`,
        );
        await refreshWorkflowData();
      } catch (error) {
        console.warn('[myQPMS Workflow] Proposal sent persistence failed', error.message);
        setBackendStatus(isProductionWorkflowMode() ? 'error' : 'fallback');
        setWorkflowError(`Proposal sent update failed: ${error.message}`);
        throw error;
      }
    }
  }

  async function uploadSiteImage(payload) {
    if (!isRemoteWorkflowEnabled()) return null;
    try {
      return await uploadSiteImageRemote(payload);
    } catch (error) {
      console.warn('Site image Supabase upload failed:', error.message);
      setBackendStatus('fallback');
      return null;
    }
  }

  const value = {
    leads,
    siteVisits,
    backendStatus,
    workflowError,
    workflowDebug,
    refreshWorkflowData,
    addLead,
    deleteLead,
    updateLead,
    addLeadActivity,
    saveLeadMomDraft,
    sendLeadMom,
    updateSiteVisit,
    saveSiteSurvey,
    saveSiteVisitMom,
    sendSiteVisitMom,
    submitCommercialReview,
    decideApproval,
    generateProposal,
    markProposalSent,
    uploadSiteImage,
  };

  return <WorkflowContext.Provider value={value}>{children}</WorkflowContext.Provider>;
}
