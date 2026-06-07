import { isSupabaseConfigured, supabase } from '../lib/supabase.js';

const appMode = String(import.meta.env.VITE_APP_MODE || 'demo').toLowerCase();
const isProductionMode = appMode === 'production';

function assertConfigured() {
  if (!isSupabaseConfigured || !supabase) {
    throw new Error('Supabase is not configured');
  }
}

export function isRemoteWorkflowEnabled() {
  return isProductionMode || isSupabaseConfigured;
}

export function getWorkflowAppMode() {
  return appMode;
}

export function isProductionWorkflowMode() {
  return isProductionMode;
}

export function canUseLocalWorkflowStorage() {
  return !isProductionMode;
}

function rpcMissing(error) {
  const message = String(error?.message || error?.details || '').toLowerCase();
  return error?.code === 'PGRST202' || error?.code === '42883' || message.includes('function') || message.includes('schema cache');
}

function tableMissing(error) {
  const message = String(error?.message || error?.details || '').toLowerCase();
  return ['42P01', 'PGRST205'].includes(error?.code) || message.includes('could not find the table');
}

function normalizeRpcError(error, label) {
  if (!error) return new Error(`${label} failed`);
  const nextError = new Error(error.message || `${label} failed`);
  nextError.code = error.code;
  nextError.details = error.details;
  nextError.hint = error.hint;
  nextError.isRpcMissing = rpcMissing(error);
  return nextError;
}

async function callWorkflowRpc(functionName, params, label) {
  assertConfigured();
  const { data, error } = await supabase.rpc(functionName, params);
  if (error) {
    console.error(`[myQPMS Workflow RPC] ${label} failed`, error);
    throw normalizeRpcError(error, label);
  }
  return data;
}

function createIdempotencyKey(scope, entityId) {
  const suffix = typeof crypto !== 'undefined' && crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  return `${scope}:${entityId || 'new'}:${suffix}`;
}

const stageNameToCode = {
  'Lead MOM': 'lead_mom',
  'Site Visit Started': 'site_visit_started',
  'Pre-Operational Assessment': 'site_visit_started',
  'Operations Review': 'operations_review',
  'Coordinator Costing Review': 'coordinator_costing_review',
  'HR Validation': 'hr_validation',
  'Commercial Review': 'commercial_review',
  'Finance Review': 'finance_review',
  'Returned to BD': 'returned_to_bd',
  'Proposal Sent': 'proposal_sent',
};

const decisionToRpcDecision = {
  approve: 'Approved',
  approved: 'Approved',
  Approved: 'Approved',
  rework: 'Rework Requested',
  'Rework Requested': 'Rework Requested',
  reject: 'Rejected',
  rejected: 'Rejected',
  Rejected: 'Rejected',
  reassign: 'Reassigned',
  Reassigned: 'Reassigned',
  escalate: 'Escalated',
  Escalated: 'Escalated',
};

function stageCodeFor(stage) {
  return stageNameToCode[stage] || stage || 'operations_review';
}

function compactActor(user = {}) {
  return {
    userId: user.id && /^[0-9a-f-]{36}$/i.test(String(user.id)) ? user.id : null,
    name: user.name || user.full_name || user.email || '',
    role: user.role || '',
  };
}

function primaryContactPayload(lead) {
  const contact = (lead.contacts || []).find((item) => item.isPrimary) || (lead.contacts || [])[0];
  if (!contact) return null;
  return {
    contact_person_name: contact.name || lead.contact || '',
    contact_person_designation: contact.designation || lead.designation || '',
    contact_number: contact.phone || lead.phone || '',
    email_id: contact.email || lead.email || '',
  };
}

function pick(row, keys, fallback = '') {
  const key = keys.find((item) => row[item] !== undefined && row[item] !== null);
  return key ? row[key] : fallback;
}

function normalizeJsonArray(value) {
  if (Array.isArray(value)) return value.filter(Boolean);
  if (value && typeof value === 'object') {
    return Object.entries(value)
      .filter(([, item]) => item === true || item?.selected)
      .map(([key]) => key);
  }
  return String(value || '')
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
}

function groupBy(items = [], key) {
  return items.reduce((grouped, item) => {
    const value = item?.[key];
    if (!value) return grouped;
    grouped[value] = [...(grouped[value] || []), item];
    return grouped;
  }, {});
}

export function dbLeadToAppLead(row) {
  const relationContacts = row.lead_contacts || [];
  const directContact = pick(row, ['contact_person_name', 'contact', 'primary_contact_name']);
  const directContactPhone = pick(row, ['contact_number', 'phone']);
  const directContactEmail = pick(row, ['email_id', 'email']);
  const directContactDesignation = pick(row, ['contact_person_designation', 'designation']);
  const contacts = (relationContacts.length
    ? relationContacts
    : directContact || directContactPhone || directContactEmail
      ? [
          {
            id: `direct-${row.id}`,
            contact_person_name: directContact,
            contact_person_designation: directContactDesignation,
            contact_number: directContactPhone,
            email_id: directContactEmail,
            is_primary: true,
          },
        ]
      : []
  ).map((contact) => ({
    id: contact.id,
    name: contact.contact_person_name || '',
    designation: contact.contact_person_designation || '',
    phone: contact.contact_number || '',
    email: contact.email_id || '',
    isPrimary: Boolean(contact.is_primary),
  }));
  const primary = contacts.find((contact) => contact.isPrimary) || contacts[0] || {};

  return {
    id: row.id,
    leadId: row.lead_code || `LD-${String(row.id).slice(0, 5).toUpperCase()}`,
    company: pick(row, ['client_name', 'company_name', 'company', 'client']),
    industry: pick(row, ['industry_type', 'industry']),
    source: pick(row, ['lead_source', 'source']),
    location: pick(row, ['site_location', 'location', 'site_address']),
    state: row.state,
    city: row.city,
    priority: pick(row, ['lead_priority', 'priority']),
    serviceScope: normalizeJsonArray(row.service_scope),
    remarks: row.remarks,
    assigned_bd_executive: row.assigned_bd_executive,
    assigned_bd_email: row.assigned_bd_email,
    created_by_user_id: row.created_by_user_id,
    created_by_name: row.created_by_name || row.assigned_bd_executive,
    executive: row.assigned_bd_executive,
    stage: pick(row, ['lead_stage', 'stage'], 'New Lead'),
    status: pick(row, ['status'], 'Active'),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    contacts,
    contact: primary.name || '',
    designation: primary.designation || '',
    phone: primary.phone || '',
    email: primary.email || '',
    mom: row.lead_mom?.[0] ? dbLeadMomToApp(row.lead_mom[0]) : null,
    activity: (row.activity_logs || []).map((log) => log.activity_message || log.message || log.activity_type).filter(Boolean),
  };
}

export function appLeadToDbLead(lead) {
  return {
    client_name: lead.company,
    industry_type: lead.industry,
    lead_source: lead.source,
    site_location: lead.location,
    state: lead.state,
    city: lead.city,
    lead_priority: lead.priority,
    service_scope: normalizeJsonArray(lead.serviceScope || lead.service_scope),
    remarks: lead.remarks,
    assigned_bd_executive: lead.assigned_bd_executive || lead.executive,
    assigned_bd_email: lead.assigned_bd_email,
    created_by_user_id: lead.created_by_user_id,
    created_by_name: lead.created_by_name,
    lead_stage: lead.stage || 'New Lead',
    status: lead.status || 'Active',
    updated_at: new Date().toISOString(),
  };
}

export function dbSiteVisitToApp(row) {
  const lead = row.leads || {};
  const workflowInstance = row.workflow_instance || row.workflow_instances?.[0] || {};
  const activeAssignment = row.workflow_assignment || workflowInstance.workflow_assignments?.[0] || {};
  const contacts = (lead.lead_contacts || []).map((contact) => ({
    id: contact.id,
    name: contact.contact_person_name || '',
    designation: contact.contact_person_designation || '',
    phone: contact.contact_number || '',
    email: contact.email_id || '',
    isPrimary: Boolean(contact.is_primary),
  }));
  const primary = contacts.find((contact) => contact.isPrimary) || contacts[0] || {};
  const assessment = row.site_assessments?.[0];
  const latestProposal = [...(row.proposals || [])].sort((a, b) => new Date(b.created_at || 0) - new Date(a.created_at || 0))[0];
  const approvals = [...(row.approval_requests || [])].sort((a, b) => new Date(b.created_at || 0) - new Date(a.created_at || 0));
  const latestApproval = approvals[0] || {};
  const reviewStatus = approvals.reduce((acc, approval) => {
    if (!approval.approval_stage || acc[approval.approval_stage]) return acc;
    return { ...acc, [approval.approval_stage]: approval.status };
  }, {});

  return {
    id: row.id,
    leadId: row.lead_id,
    company: row.client_name,
    industry: lead.industry_type || '',
    contacts,
    contact: primary.name || '',
    designation: primary.designation || '',
    phone: primary.phone || '',
    email: primary.email || '',
    source: lead.lead_source || '',
    priority: lead.lead_priority || '',
    executive: row.assigned_bd_executive,
    assigned_bd_executive: row.assigned_bd_executive,
    assigned_bd_email: row.assigned_bd_email,
    created_by_user_id: lead.created_by_user_id,
    created_by_name: lead.created_by_name || row.assigned_bd_executive,
    location: lead.site_location || row.site_name,
    siteName: row.site_name || lead.site_location || row.client_name,
    state: lead.state || '',
    city: lead.city || '',
    scheduledVisitDate: row.scheduled_visit_date || '',
    scheduledVisitTime: row.scheduled_visit_time || '',
    momStatus: row.mom_status,
    status: row.status,
    assessmentStatus: assessment?.assessment_status || 'Draft',
    currentStage: row.current_stage,
    workflowInstanceId: workflowInstance.id || '',
    currentAssignmentId: activeAssignment.id || '',
    workflowStageCode: workflowInstance.current_stage_code || '',
    workflowStatus: workflowInstance.status || '',
    createdFrom: 'Supabase',
    survey: assessment ? dbAssessmentToSurvey(assessment) : undefined,
    assessmentId: assessment?.id,
    approvals,
    reviewStatus,
    pendingWith: activeAssignment.assigned_role || workflowInstance.pending_role || latestApproval.pending_with || row.pending_with || '',
    approvalStatus: workflowInstance.approval_status || latestApproval.status || '',
    approvalRemarks: latestApproval.remarks || '',
    lastApprovalBy: latestApproval.approved_by || '',
    lastApprovalAt: latestApproval.approved_at || '',
    approvalTimeline: approvals.map((approval) => ({
      label: `${approval.approval_stage} ${approval.status}`,
      at: approval.approved_at || approval.created_at,
    })),
    proposal: latestProposal ? {
      id: latestProposal.id,
      proposalNumber: latestProposal.proposal_number,
      status: latestProposal.proposal_status,
      generatedAt: latestProposal.generated_at,
      sentAt: latestProposal.sent_at,
      proposalValue: latestProposal.proposal_value,
      marginPercent: latestProposal.margin_percent,
      ...(latestProposal.metadata?.proposalPayload || {}),
    } : undefined,
    siteMom: row.site_mom?.[0] ? dbSiteMomToApp(row.site_mom[0]) : null,
    activity: (row.activity_logs || []).map((log) => log.activity_message || log.message || log.activity_type).filter(Boolean),
  };
}

export function surveyToDbAssessment(survey, visit, status = 'Draft', user) {
  const monthlyBilling = Number(survey.commercial?.billingComponents?.reduce((sum, item) => sum + Number(item.amount || 0), 0) || 0);

  return {
    site_visit_id: visit.id,
    lead_id: visit.leadId,
    basic_site_information: {
      site_address: survey.siteAddress,
      site_type: survey.siteType,
      operating_hours: survey.operatingHours,
      client_occupancy: survey.clientOccupancy,
      building_age: survey.buildingAge,
      takeover_complexity: survey.takeoverComplexity,
      site_survey_date: survey.siteSurveyDate,
      assessed_by: survey.assessedBy,
      site_contact_person: survey.siteContactPerson,
      contact_number: survey.contactNumber,
      contact_email: survey.contactEmail,
      total_site_area: survey.totalSiteArea,
      contract_period: survey.contractPeriod,
      margin_agreed: survey.marginAgreed,
      margin_type: survey.marginType,
      payment_terms: survey.paymentTerms,
      group_or_sister_concern_business: survey.groupOrSisterConcernBusiness,
      is_24_7_operation: survey.is247Operation,
    },
    ifm_service_scope: survey.ifmScope || {},
    hard_services: survey.hardServices || {},
    soft_services: survey.softServices || {},
    landscaping_pest_control: survey.landscaping || {},
    hse_compliance: survey.hseCompliance || [],
    manpower_requirement: {
      rows: survey.manpowerPlan || [],
      minimum_wages_type: survey.minimumWagesType,
      applicable_zone: survey.applicableZone,
      wage_computation_notes: survey.wageComputationNotes,
      reliever_cost_required: survey.relieverCostRequired,
      budgeted_take_home_feasibility: survey.budgetedTakeHomeFeasibility,
      local_workforce_availability: survey.localWorkforceAvailability,
      transportation_impact: survey.transportationImpact,
      bonus_payment_type: survey.bonusPaymentType,
      leave_with_wages_days: survey.leaveWithWagesDays,
      nfh_applicable: survey.nfhApplicable,
      travel_accommodation_provided: survey.travelAccommodationProvided,
      allowances: survey.allowances || {},
    },
    tools_equipment_consumables: {
      equipment: survey.equipment || [],
      chemicals: survey.chemicals || [],
      tools: survey.tools || [],
      ppe_uniforms: survey.ppeUniforms || [],
      machinery: survey.machinery || [],
      consumables: survey.consumables,
      rental_machinery: survey.rentalMachinery,
      non_billable_expenses: survey.nonBillableExpenses,
      uniforms_shoes_accessories: survey.uniformsShoesAccessories,
    },
    client_kyc: survey.clientKyc || {},
    risk_assessment: {
      rows: survey.risks || [],
      client_credit_rating: survey.clientCreditRating,
      market_assessment: survey.marketAssessment,
      good_paymaster: survey.goodPaymaster,
      existing_vendor_change_reason: survey.existingVendorChangeReason,
      mitigation_plan: survey.mitigationPlan,
      remarks: survey.riskRemarks,
    },
    penalty_clauses: survey.penaltyClauses || {},
    commercial_statement: {
      ...(survey.commercial || {}),
      estimated_monthly_billing: monthlyBilling,
      approval_rules: {
        coo_approval_required: monthlyBilling > 500000,
        cfo_approval_required: monthlyBilling > 500000,
        cmd_counter_approval_required: monthlyBilling > 2500000,
      },
    },
    approval_mechanism: {
      approvalWorkflow: survey.approvalWorkflow,
      coo_approval_required: monthlyBilling > 500000,
      cfo_approval_required: monthlyBilling > 500000,
      cmd_counter_approval_required: monthlyBilling > 2500000,
    },
    final_remarks_signoff: {
      finalRemarks: survey.finalRemarks,
      signOffName: survey.signOffName,
      project_remarks: survey.projectRemarks,
      site_survey_done_by: survey.siteSurveyDoneBy,
      signature_placeholder: survey.signaturePlaceholder,
    },
    assessment_status: status,
    final_remarks: survey.finalRemarks || '',
    created_by: user?.email || visit.assigned_bd_email || '',
    updated_at: new Date().toISOString(),
  };
}

export function dbAssessmentToSurvey(row) {
  return {
    siteAddress: row.basic_site_information?.site_address || '',
    siteType: row.basic_site_information?.site_type || '',
    operatingHours: row.basic_site_information?.operating_hours || '',
    clientOccupancy: row.basic_site_information?.client_occupancy || '',
    buildingAge: row.basic_site_information?.building_age || '',
    takeoverComplexity: row.basic_site_information?.takeover_complexity || 'Medium',
    ifmScope: row.ifm_service_scope || {},
    hardServices: row.hard_services || {},
    softServices: row.soft_services || {},
    landscaping: row.landscaping_pest_control || {},
    hseCompliance: row.hse_compliance || [],
    manpowerPlan: row.manpower_requirement?.rows || [],
    allowances: row.manpower_requirement?.allowances || undefined,
    equipment: row.tools_equipment_consumables?.equipment || [],
    chemicals: row.tools_equipment_consumables?.chemicals || [],
    tools: row.tools_equipment_consumables?.tools || [],
    ppeUniforms: row.tools_equipment_consumables?.ppe_uniforms || [],
    machinery: row.tools_equipment_consumables?.machinery || [],
    clientKyc: row.client_kyc || {},
    risks: row.risk_assessment?.rows || [],
    penaltyClauses: row.penalty_clauses || {},
    commercial: row.commercial_statement || {},
    approvalWorkflow: row.approval_mechanism?.approvalWorkflow || '',
    finalRemarks: row.final_remarks_signoff?.finalRemarks || row.final_remarks || '',
    signOffName: row.final_remarks_signoff?.signOffName || '',
  };
}

function appLeadMomToDb(mom, leadId, status) {
  return {
    lead_id: leadId,
    to_email: mom.to,
    cc_emails: mom.cc,
    subject: mom.subject,
    discussion_summary: mom.discussionSummary,
    service_scope_discussion: mom.serviceScopeDiscussion,
    action_items: mom.actionItems || '',
    next_followup_date: mom.nextFollowUpDate || null,
    scheduled_site_visit_date: mom.scheduledVisitDate || null,
    scheduled_site_visit_time: mom.scheduledVisitTime || null,
    calendar_invite_sent: Boolean(mom.calendarInviteSent),
    site_visit_remarks: mom.siteVisitRemarks,
    mom_status: status,
    sent_at: status === 'Sent' ? new Date().toISOString() : null,
  };
}

function dbLeadMomToApp(row) {
  return {
    id: row.id,
    to: row.to_email,
    cc: row.cc_emails,
    subject: row.subject,
    discussionSummary: row.discussion_summary,
    serviceScopeDiscussion: row.service_scope_discussion,
    serviceScope: normalizeJsonArray(row.service_scope || row.service_scope_discussion),
    actionItems: row.action_items,
    nextFollowUpDate: row.next_followup_date || '',
    scheduledVisitDate: row.scheduled_site_visit_date || '',
    scheduledVisitTime: row.scheduled_site_visit_time || '',
    siteVisitRemarks: row.site_visit_remarks || '',
    calendarInviteSent: Boolean(row.calendar_invite_sent),
    sent: row.mom_status === 'Sent',
    sentAt: row.sent_at,
  };
}

function appSiteMomToDb(mom, siteVisitId, status) {
  return {
    site_visit_id: siteVisitId,
    to_email: mom.to,
    cc_emails: mom.cc,
    subject: mom.subject,
    summary: mom.summary,
    scope: mom.scope,
    requirements: mom.requirements,
    commercial_notes: mom.commercialNotes,
    next_action: mom.nextAction,
    mom_status: status,
    sent_at: status === 'Sent' ? new Date().toISOString() : null,
  };
}

function dbSiteMomToApp(row) {
  return {
    id: row.id,
    to: row.to_email,
    cc: row.cc_emails,
    subject: row.subject,
    summary: row.summary,
    scope: row.scope,
    requirements: row.requirements,
    commercialNotes: row.commercial_notes,
    nextAction: row.next_action,
    sent: row.mom_status === 'Sent',
    sentAt: row.sent_at,
  };
}

export async function fetchWorkflowData() {
  assertConfigured();
  console.info('[myQPMS Supabase] Fetching leads directly from leads table');

  const leadsResponse = await supabase.from('leads').select('*').order('created_at', { ascending: false });

  if (leadsResponse.error) {
    console.error('[myQPMS Supabase] Leads fetch failed', leadsResponse.error);
    throw leadsResponse.error;
  }

  const leadIds = (leadsResponse.data || []).map((lead) => lead.id);
  let contactsByLeadId = {};
  let momByLeadId = {};

  if (leadIds.length) {
    const [contactsResponse, momResponse] = await Promise.all([
      supabase.from('lead_contacts').select('*').in('lead_id', leadIds),
      supabase.from('lead_mom').select('*').in('lead_id', leadIds),
    ]);
    if (contactsResponse.error) {
      console.warn('[myQPMS Supabase] lead_contacts fetch skipped/failed', contactsResponse.error);
    } else {
      contactsByLeadId = (contactsResponse.data || []).reduce((grouped, contact) => {
        grouped[contact.lead_id] = [...(grouped[contact.lead_id] || []), contact];
        return grouped;
      }, {});
      console.info('[myQPMS Supabase] lead_contacts fetch success', {
        contacts: contactsResponse.data?.length || 0,
      });
    }

    if (momResponse.error) {
      console.warn('[myQPMS Supabase] lead_mom fetch skipped/failed', momResponse.error);
    } else {
      momByLeadId = groupBy(momResponse.data || [], 'lead_id');
      console.info('[myQPMS Supabase] lead_mom fetch success', {
        moms: momResponse.data?.length || 0,
      });
    }
  }

  const visitsResponse = await supabase
    .from('site_visits')
    .select('*')
    .order('created_at', { ascending: false });

  if (visitsResponse.error) {
    console.warn('[myQPMS Supabase] Site visits fetch skipped/failed', visitsResponse.error);
  }

  const siteVisitRows = visitsResponse.error ? [] : visitsResponse.data || [];
  const siteVisitIds = siteVisitRows.map((visit) => visit.id).filter(Boolean);
  const leadsById = (leadsResponse.data || []).reduce((mapped, lead) => {
    mapped[lead.id] = {
      ...lead,
      lead_contacts: contactsByLeadId[lead.id] || [],
      lead_mom: momByLeadId[lead.id] || [],
    };
    return mapped;
  }, {});
  let assessmentsBySiteVisitId = {};
  let siteMomBySiteVisitId = {};
  let approvalsBySiteVisitId = {};
  let activityBySiteVisitId = {};
  let workflowBySiteVisitId = {};
  let proposalsBySiteVisitId = {};

  if (siteVisitIds.length) {
    const [assessmentResponse, siteMomResponse, approvalResponse, activityResponse] = await Promise.all([
      supabase.from('site_assessments').select('*').in('site_visit_id', siteVisitIds),
      supabase.from('site_mom').select('*').in('site_visit_id', siteVisitIds),
      supabase.from('approval_requests').select('*').in('site_visit_id', siteVisitIds).order('created_at', { ascending: false }),
      supabase.from('activity_logs').select('*').in('site_visit_id', siteVisitIds).order('created_at', { ascending: false }),
    ]);

    if (assessmentResponse.error) {
      console.warn('[myQPMS Supabase] site_assessments fetch skipped/failed', assessmentResponse.error);
    } else {
      assessmentsBySiteVisitId = groupBy(assessmentResponse.data || [], 'site_visit_id');
    }

    if (siteMomResponse.error) {
      console.warn('[myQPMS Supabase] site_mom fetch skipped/failed', siteMomResponse.error);
    } else {
      siteMomBySiteVisitId = groupBy(siteMomResponse.data || [], 'site_visit_id');
    }

    if (approvalResponse.error) {
      console.warn('[myQPMS Supabase] approval_requests fetch skipped/failed', approvalResponse.error);
    } else {
      approvalsBySiteVisitId = groupBy(approvalResponse.data || [], 'site_visit_id');
    }

    if (activityResponse.error) {
      console.warn('[myQPMS Supabase] activity_logs fetch skipped/failed', activityResponse.error);
    } else {
      activityBySiteVisitId = groupBy(activityResponse.data || [], 'site_visit_id');
    }
  }

  if (siteVisitIds.length) {
    const workflowResponse = await supabase
      .from('workflow_instances')
      .select('*, workflow_assignments(*)')
      .in('site_visit_id', siteVisitIds);
    if (workflowResponse.error) {
      if (rpcMissing(workflowResponse.error)) {
        console.info('[myQPMS Supabase] Workflow foundation tables unavailable; continuing with legacy workflow fetch');
      } else {
        console.warn('[myQPMS Supabase] workflow_instances fetch skipped/failed', workflowResponse.error);
      }
    } else {
      workflowBySiteVisitId = (workflowResponse.data || []).reduce((grouped, workflow) => {
        const activeAssignments = (workflow.workflow_assignments || [])
          .filter((assignment) => assignment.status === 'Pending')
          .sort((a, b) => new Date(a.created_at || 0) - new Date(b.created_at || 0));
        grouped[workflow.site_visit_id] = {
          ...workflow,
          workflow_assignments: activeAssignments,
        };
        return grouped;
      }, {});
    }
  }

  if (siteVisitIds.length) {
    const proposalsResponse = await supabase
      .from('proposals')
      .select('*')
      .in('site_visit_id', siteVisitIds);
    if (proposalsResponse.error) {
      if (!tableMissing(proposalsResponse.error)) {
        console.warn('[myQPMS Supabase] proposals fetch skipped/failed', proposalsResponse.error);
      }
    } else {
      proposalsBySiteVisitId = (proposalsResponse.data || []).reduce((grouped, proposal) => {
        grouped[proposal.site_visit_id] = [...(grouped[proposal.site_visit_id] || []), proposal];
        return grouped;
      }, {});
    }
  }

  const leadsWithContacts = (leadsResponse.data || []).map((lead) => ({
    ...lead,
    lead_contacts: contactsByLeadId[lead.id] || [],
    lead_mom: momByLeadId[lead.id] || [],
  }));

  const visitsWithWorkflow = siteVisitRows.map((visit) => ({
    ...visit,
    leads: leadsById[visit.lead_id] || {},
    site_assessments: assessmentsBySiteVisitId[visit.id] || [],
    site_mom: siteMomBySiteVisitId[visit.id] || [],
    approval_requests: approvalsBySiteVisitId[visit.id] || [],
    activity_logs: activityBySiteVisitId[visit.id] || [],
    workflow_instance: workflowBySiteVisitId[visit.id],
    proposals: proposalsBySiteVisitId[visit.id] || [],
  }));

  console.info('[myQPMS Supabase] Workflow fetch success', {
    leads: leadsResponse.data?.length || 0,
    siteVisits: visitsResponse.error ? 0 : visitsResponse.data?.length || 0,
  });
  console.info('[myQPMS Supabase] Fetch leads response', leadsWithContacts);

  return {
    leads: leadsWithContacts.map(dbLeadToAppLead),
    siteVisits: visitsResponse.error ? [] : visitsWithWorkflow.map(dbSiteVisitToApp),
    debug: {
      apiSource: 'supabase.public.leads',
      totalLeadsFetched: leadsWithContacts.length,
      latestLeadId: leadsWithContacts[0]?.id || '',
      latestClientName: leadsWithContacts[0]?.client_name || leadsWithContacts[0]?.company_name || '',
      postmanAutomationLeads: leadsWithContacts.filter((lead) => lead.lead_source === 'Postman Automation' || lead.metadata?.created_by === 'postman_automation').length,
      approvalRequestsFetched: Object.values(approvalsBySiteVisitId).reduce((sum, rows) => sum + rows.length, 0),
    },
  };
}

export async function convertLeadToAssessment(lead, { user, idempotencyKey, metadata } = {}) {
  const actor = compactActor(user);
  const payload = await callWorkflowRpc(
    'rpc_convert_lead_to_assessment',
    {
      p_lead_id: lead.id,
      p_actor_user_id: actor.userId,
      p_actor_name: actor.name || lead.created_by_name,
      p_actor_role: actor.role || 'BD Team',
      p_idempotency_key: idempotencyKey || createIdempotencyKey('lead-conversion', lead.id),
      p_scheduled_visit_date: lead.scheduledVisitDate || null,
      p_scheduled_visit_time: lead.scheduledVisitTime || null,
      p_site_name: lead.location || lead.company || null,
      p_primary_contact: primaryContactPayload(lead),
      p_metadata: metadata || {},
    },
    'Lead conversion',
  );
  return payload;
}

export async function saveAssessmentSection({
  visit,
  sectionCode,
  sectionName,
  sectionData,
  baseVersionNumber,
  saveMode = 'save',
  user,
  remarks,
}) {
  const actor = compactActor(user);
  return callWorkflowRpc(
    'rpc_save_assessment_section',
    {
      p_site_visit_id: visit.id,
      p_section_code: sectionCode,
      p_section_name: sectionName || sectionCode,
      p_section_data: sectionData || {},
      p_base_version_number: baseVersionNumber ?? null,
      p_save_mode: saveMode,
      p_actor_user_id: actor.userId,
      p_actor_name: actor.name,
      p_actor_role: actor.role,
      p_remarks: remarks || null,
    },
    'Assessment section save',
  );
}

export async function submitForReview({ visit, targetStage = 'operations_review', user, idempotencyKey, remarks }) {
  const actor = compactActor(user);
  return callWorkflowRpc(
    'rpc_submit_for_review',
    {
      p_workflow_instance_id: visit.workflowInstanceId || null,
      p_site_visit_id: visit.id,
      p_target_stage_code: stageCodeFor(targetStage),
      p_actor_user_id: actor.userId,
      p_actor_name: actor.name,
      p_actor_role: actor.role || 'BD Team',
      p_idempotency_key: idempotencyKey || createIdempotencyKey('submit-review', visit.id),
      p_remarks: remarks || null,
    },
    'Submit for review',
  );
}

export async function recordApprovalDecision({
  visit,
  stage,
  decision,
  remarks,
  user,
  assignmentId,
  reassignToRole,
  reassignToUserId,
  idempotencyKey,
}) {
  const actor = compactActor(user);
  return callWorkflowRpc(
    'rpc_record_approval_decision',
    {
      p_workflow_instance_id: visit.workflowInstanceId || visit.workflow_instance_id,
      p_assignment_id: assignmentId || visit.currentAssignmentId || null,
      p_stage_code: stageCodeFor(stage || visit.currentStage),
      p_decision: decisionToRpcDecision[decision] || decision || 'Approved',
      p_actor_user_id: actor.userId,
      p_actor_name: actor.name,
      p_actor_role: actor.role,
      p_remarks: remarks || null,
      p_reassign_to_role: reassignToRole || null,
      p_reassign_to_user_id: reassignToUserId || null,
      p_idempotency_key: idempotencyKey || createIdempotencyKey('approval', visit.id),
    },
    'Approval decision',
  );
}

export async function createNotification(notification) {
  try {
    return await callWorkflowRpc(
      'rpc_create_notification',
      {
        p_recipient_user_id: notification.recipientUserId || null,
        p_recipient_role: notification.recipientRole || null,
        p_workflow_instance_id: notification.workflowInstanceId || null,
        p_lead_id: notification.leadId || null,
        p_site_visit_id: notification.siteVisitId || null,
        p_notification_type: notification.type || 'Workflow Alert',
        p_title: notification.title || 'Workflow alert',
        p_message: notification.message || null,
        p_priority: notification.priority || 'Medium',
        p_action_url: notification.actionUrl || null,
        p_action_label: notification.actionLabel || null,
        p_metadata: notification.metadata || {},
      },
      'Create notification',
    );
  } catch (error) {
    if (!error?.isRpcMissing) throw error;
    assertConfigured();
    const { data, error: insertError } = await supabase
      .from('notifications')
      .insert({
        recipient_user_id: notification.recipientUserId || null,
        recipient_role: notification.recipientRole || null,
        workflow_instance_id: notification.workflowInstanceId || null,
        lead_id: notification.leadId || null,
        site_visit_id: notification.siteVisitId || null,
        notification_type: notification.type || 'Workflow Alert',
        title: notification.title || 'Workflow alert',
        message: notification.message || null,
        priority: notification.priority || 'Medium',
        action_url: notification.actionUrl || null,
        action_label: notification.actionLabel || null,
        metadata: notification.metadata || {},
      })
      .select('*')
      .single();
    if (insertError) {
      if (tableMissing(insertError)) {
        console.warn('[myQPMS Workflow] Notifications table unavailable; notification skipped', insertError.message);
        return null;
      }
      throw insertError;
    }
    return data;
  }
}

export async function markNotificationRead(notificationId, readerUserId = null) {
  return callWorkflowRpc(
    'rpc_mark_notification_read',
    {
      p_notification_id: notificationId,
      p_reader_user_id: readerUserId,
    },
    'Mark notification read',
  );
}

export async function generateProposalRecord({ visit, proposal, user, idempotencyKey }) {
  const actor = compactActor(user);
  try {
    return await callWorkflowRpc(
      'rpc_generate_proposal_record',
      {
        p_workflow_instance_id: visit.workflowInstanceId || visit.workflow_instance_id,
        p_actor_user_id: actor.userId,
        p_actor_name: actor.name,
        p_actor_role: actor.role || 'BD Team',
        p_proposal_number: proposal?.proposalNumber || null,
        p_template_name: proposal?.templateName || null,
        p_payload: proposal || {},
        p_idempotency_key: idempotencyKey || createIdempotencyKey('proposal', visit.id),
      },
      'Generate proposal record',
    );
  } catch (error) {
    if (!error?.isRpcMissing) throw error;
    console.warn('[myQPMS Workflow] Proposal RPC unavailable; attempting direct proposal table insert', error.message);
    return generateProposalRecordDirect({ visit, proposal, actor });
  }
}

async function generateProposalRecordDirect({ visit, proposal, actor }) {
  assertConfigured();
  const proposalPayload = {
    workflow_instance_id: visit.workflowInstanceId || visit.workflow_instance_id || null,
    lead_id: visit.leadId || visit.lead_id || null,
    site_visit_id: visit.id,
    proposal_number: proposal?.proposalNumber || null,
    client_name: proposal?.clientName || visit.company || visit.client_name || '',
    proposal_status: 'Generated',
    proposal_value: Number(proposal?.proposalValue || 0),
    management_fee_percent: Number(proposal?.costingSummary?.managementFee || proposal?.managementFee || 0),
    margin_percent: Number(proposal?.marginPercent || 0),
    generated_by: actor.userId,
    generated_by_name: actor.name || 'myQPMS',
    generated_at: new Date().toISOString(),
    metadata: {
      created_by: 'crm_ui',
      source: 'proposal_demo_export',
      proposalPayload: proposal || {},
    },
  };
  let proposalRow;
  const proposalResponse = await supabase
    .from('proposals')
    .insert(proposalPayload)
    .select('*')
    .single();
  if (proposalResponse.error) {
    if (tableMissing(proposalResponse.error)) {
      const fallback = normalizeRpcError(proposalResponse.error, 'Generate proposal direct insert');
      fallback.isRpcMissing = true;
      throw fallback;
    }
    throw proposalResponse.error;
  }
  proposalRow = proposalResponse.data;

  const versionResponse = await supabase
    .from('proposal_versions')
    .insert({
      proposal_id: proposalRow.id,
      version_number: 1,
      source_template_name: proposal?.templateName || null,
      generated_payload: proposal || {},
      generated_by: actor.userId,
      generated_by_name: actor.name || 'myQPMS',
      remarks: 'Generated from CRM proposal demo workflow.',
    })
    .select('*')
    .single();
  if (versionResponse.error && !tableMissing(versionResponse.error)) {
    throw versionResponse.error;
  }

  const lineItems = proposal?.lineItems || [];
  if (lineItems.length && versionResponse.data?.id) {
    const itemRows = lineItems.map((item, index) => ({
      proposal_id: proposalRow.id,
      proposal_version_id: versionResponse.data.id,
      line_order: index + 1,
      designation: item.designation || '',
      service_scope: Array.isArray(proposal?.scopeOfWork) ? proposal.scopeOfWork.join(', ') : proposal?.scopeOfWork || '',
      quantity: Number(item.quantity || 0),
      shift_type: item.shift || '',
      rate_per_head: Number(item.ratePerHead || 0),
      monthly_total: Number(item.monthlyTotal || 0),
      management_fee: Number(item.managementFee || 0),
      contract_value: Number(item.contractValue || 0),
      costing_snapshot: item,
    }));
    const lineItemResponse = await supabase.from('proposal_line_items').insert(itemRows);
    if (lineItemResponse.error && !tableMissing(lineItemResponse.error)) {
      throw lineItemResponse.error;
    }
  }

  return {
    proposal: proposalRow,
    version: versionResponse.data || null,
    lineItems,
    direct: true,
  };
}

export async function createLeadRemote(lead) {
  assertConfigured();
  const { contacts = [] } = lead;
  const primaryContact = contacts.find((contact) => contact.isPrimary) || contacts[0] || {};
  const basePayload = appLeadToDbLead(lead);
  const payload = {
    ...basePayload,
    contact_person_name: primaryContact.name || null,
    contact_person_designation: primaryContact.designation || null,
    contact_number: primaryContact.phone || null,
    email_id: primaryContact.email || null,
  };
  console.info('[myQPMS Supabase] Creating lead payload', {
    client_name: payload.client_name,
    assigned_bd_email: payload.assigned_bd_email,
    lead_stage: payload.lead_stage,
    contact_person_name: payload.contact_person_name,
    contactCount: contacts.length,
  });

  let { data, error } = await supabase.from('leads').insert(payload).select('*').single();
  if (error && String(error.message || '').toLowerCase().includes('schema cache')) {
    console.warn('[myQPMS Supabase] Direct contact columns not available on leads; retrying lead insert without direct contact fields', error);
    const retryPayload = { ...basePayload };
    if (String(error.message || '').includes('service_scope')) delete retryPayload.service_scope;
    const retry = await supabase.from('leads').insert(retryPayload).select('*').single();
    data = retry.data;
    error = retry.error;
  }
  if (error) {
    console.error('[myQPMS Supabase] Lead insert failed', error);
    throw error;
  }

  console.info('[myQPMS Supabase] Lead insert success', {
    id: data.id,
    client_name: data.client_name,
  });

  if (contacts.length) {
    const dedupedContacts = contacts.reduce((items, contact) => {
      const key = String(contact.id || contact.email || contact.phone || '').trim().toLowerCase();
      const fallbackKey = `${String(contact.name || '').trim().toLowerCase()}|${String(contact.designation || '').trim().toLowerCase()}`;
      const matchKey = key || fallbackKey;
      if (matchKey && items.some((item) => item.__matchKey === matchKey)) return items;
      return [...items, { ...contact, __matchKey: matchKey }];
    }, []);
    const { error: contactsError } = await supabase.from('lead_contacts').insert(
      dedupedContacts.map((contact, index) => ({
        lead_id: data.id,
        contact_person_name: contact.name,
        contact_person_designation: contact.designation,
        contact_number: contact.phone,
        email_id: contact.email,
        is_primary: index === Math.max(dedupedContacts.findIndex((item) => item.isPrimary), 0),
      })),
    );
    if (contactsError) {
      console.error('[myQPMS Supabase] Lead contacts insert failed', contactsError);
      if (!['42P01', 'PGRST205'].includes(contactsError.code)) {
        throw contactsError;
      }
      console.warn('[myQPMS Supabase] Lead was inserted, but lead_contacts appears unavailable. Primary contact must be stored directly in leads for this project.');
      return data.id;
    }
    console.info('[myQPMS Supabase] Lead contacts insert success', {
      leadId: data.id,
      contactCount: contacts.length,
    });
  }

  await logActivity({ leadId: data.id, type: 'Lead Created', message: 'Lead Created', createdBy: lead.created_by_name });
  return data.id;
}

export async function updateLeadRemote(leadId, lead) {
  assertConfigured();
  const payload = appLeadToDbLead(lead);
  let { error } = await supabase.from('leads').update(payload).eq('id', leadId);
  if (error && String(error.message || '').includes('service_scope')) {
    const retryPayload = { ...payload };
    delete retryPayload.service_scope;
    const retry = await supabase.from('leads').update(retryPayload).eq('id', leadId);
    error = retry.error;
  }
  if (error) throw error;

  if (lead.contacts) {
    const dedupedContacts = lead.contacts.reduce((items, contact) => {
      const key = String(contact.id || contact.email || contact.phone || '').trim().toLowerCase();
      const fallbackKey = `${String(contact.name || '').trim().toLowerCase()}|${String(contact.designation || '').trim().toLowerCase()}`;
      const matchKey = key || fallbackKey;
      if (matchKey && items.some((item) => item.__matchKey === matchKey)) return items;
      return [...items, { ...contact, __matchKey: matchKey }];
    }, []);
    console.info('[myQPMS Supabase] Upserting lead contacts', { leadId, contactCount: dedupedContacts.length });
    await supabase.from('lead_contacts').delete().eq('lead_id', leadId);
    const { error: contactsError } = await supabase.from('lead_contacts').insert(
      dedupedContacts.map((contact, index) => ({
        lead_id: leadId,
        contact_person_name: contact.name,
        contact_person_designation: contact.designation,
        contact_number: contact.phone,
        email_id: contact.email,
        is_primary: index === Math.max(dedupedContacts.findIndex((item) => item.isPrimary), 0),
      })),
    );
    if (contactsError) throw contactsError;
  }

  await logActivity({ leadId, type: 'Lead Updated', message: 'Lead Updated', createdBy: lead.created_by_name });
}

export async function deleteLeadRemote(leadId, createdBy) {
  assertConfigured();

  await logActivity({ type: 'Lead Deleted', message: 'Lead Deleted', createdBy });
  await supabase.from('site_assessments').delete().eq('lead_id', leadId);
  await supabase.from('site_visits').delete().eq('lead_id', leadId);
  await supabase.from('lead_mom').delete().eq('lead_id', leadId);
  await supabase.from('lead_contacts').delete().eq('lead_id', leadId);

  const { error } = await supabase.from('leads').delete().eq('id', leadId);
  if (error) throw error;
}

export async function saveLeadMomRemote(leadId, mom, status = 'Draft') {
  assertConfigured();
  const payload = appLeadMomToDb(mom, leadId, status);
  let { error } = await supabase.from('lead_mom').upsert(payload, { onConflict: 'lead_id' });
  if (error && String(error.message || '').includes('calendar_invite_sent')) {
    const retryPayload = { ...payload };
    delete retryPayload.calendar_invite_sent;
    const retry = await supabase.from('lead_mom').upsert(retryPayload, { onConflict: 'lead_id' });
    error = retry.error;
  }
  if (error) throw error;
  await logActivity({ leadId, type: status === 'Sent' ? 'Lead MOM Sent' : 'Lead MOM Drafted', message: status === 'Sent' ? 'Lead MOM Sent' : 'Lead MOM Drafted' });
}

export async function createSiteVisitRemote(lead) {
  assertConfigured();
  console.info('[myQPMS Supabase] Converting lead to site visit', { leadId: lead.id, client: lead.company });
  const existing = await supabase.from('site_visits').select('id').eq('lead_id', lead.id).maybeSingle();
  if (existing.error) throw existing.error;
  if (existing.data?.id) {
    console.warn('[myQPMS Supabase] Duplicate assessment conversion prevented', { leadId: lead.id, siteVisitId: existing.data.id });
    throw new Error('Assessment already created for this lead.');
  }
  const { data, error } = await supabase
    .from('site_visits')
    .upsert(
      {
        lead_id: lead.id,
        client_name: lead.company,
        site_name: lead.location || lead.company,
        scheduled_visit_date: lead.scheduledVisitDate || null,
        scheduled_visit_time: lead.scheduledVisitTime || null,
        assigned_bd_executive: lead.assigned_bd_executive || lead.executive,
        assigned_bd_email: lead.assigned_bd_email,
        current_stage: 'Pre-Operational Assessment',
        status: 'Scheduled',
        mom_status: 'Pending',
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'lead_id' },
    )
    .select('*')
    .single();
  if (error) throw error;
  await supabase.from('leads').update({ lead_stage: 'Converted', status: 'Converted to Assessment', updated_at: new Date().toISOString() }).eq('id', lead.id);
  await logActivity({ leadId: lead.id, siteVisitId: data.id, type: 'Lead MOM Sent', message: 'Lead MOM Sent' });
  await logActivity({ leadId: lead.id, siteVisitId: data.id, type: 'Converted to Assessment', message: 'Lead moved to Site Visit & Estimation' });
  return data;
}

export async function saveSiteAssessmentRemote(visit, survey, status = 'Draft', user) {
  assertConfigured();
  if (!survey || !Object.keys(survey).length) {
    console.warn('[myQPMS Supabase] Blank assessment save skipped', { siteVisitId: visit.id });
    return null;
  }
  console.info('[myQPMS Supabase] Saving assessment', { siteVisitId: visit.id, leadId: visit.leadId, status });
  const payload = surveyToDbAssessment(survey, visit, status, user);
  const { data, error } = await supabase.from('site_assessments').upsert(payload, { onConflict: 'site_visit_id' }).select('*').single();
  if (error) throw error;
  await logActivity({ leadId: visit.leadId, siteVisitId: visit.id, type: status === 'Submitted' ? 'Submitted for Review Workflow' : 'Site Assessment Saved', message: status === 'Submitted' ? 'Submitted to Operations Review' : 'Site Assessment Saved', createdBy: user?.email });
  return data;
}

export async function saveSiteMomRemote(siteVisitId, mom, status = 'Draft') {
  assertConfigured();
  const { error } = await supabase.from('site_mom').upsert(appSiteMomToDb(mom, siteVisitId, status), { onConflict: 'site_visit_id' });
  if (error) throw error;
}

export async function submitApprovalRemote(visit, assessmentId) {
  assertConfigured();
  const existing = await supabase
    .from('approval_requests')
    .select('id, approval_stage, status')
    .eq('site_visit_id', visit.id);
  if (existing.error && !tableMissing(existing.error)) throw existing.error;
  const existingStages = new Set((existing.data || []).map((row) => row.approval_stage));
  if ((existing.data || []).some((row) => row.status === 'Pending')) {
    console.warn('[myQPMS Supabase] Duplicate review submit prevented', { siteVisitId: visit.id });
    return existing.data;
  }
  const reworkStage = (existing.data || []).find((row) => row.status === 'Rework Requested')?.approval_stage;
  if (reworkStage) {
    const { error: reworkError } = await supabase
      .from('approval_requests')
      .update({ status: 'Pending', pending_with: reworkStage === 'Operations Review' ? 'Operations Team' : reworkStage === 'Coordinator Costing Review' ? 'Coordinator' : reworkStage === 'HR Validation' ? 'HR Reviewer' : `${reworkStage.replace(' Review', '')} Reviewer`, remarks: null })
      .eq('site_visit_id', visit.id)
      .eq('approval_stage', reworkStage)
      .eq('status', 'Rework Requested');
    if (reworkError) throw reworkError;
    await supabase.from('site_visits').update({ current_stage: reworkStage, pending_with: reworkStage === 'Operations Review' ? 'Operations Team' : reworkStage === 'Coordinator Costing Review' ? 'Coordinator' : reworkStage === 'HR Validation' ? 'HR Reviewer' : `${reworkStage.replace(' Review', '')} Reviewer`, status: 'Pending Review', updated_at: new Date().toISOString() }).eq('id', visit.id);
    return existing.data;
  }

  const rows = ['Operations Review', 'Coordinator Costing Review', 'HR Validation', 'Commercial Review', 'Finance Review']
    .filter((stage) => !existingStages.has(stage))
    .map((stage) => ({
      lead_id: visit.leadId,
      site_visit_id: visit.id,
      assessment_id: assessmentId,
      approval_stage: stage,
      pending_with: stage === 'Operations Review' ? 'Operations Team' : stage === 'Coordinator Costing Review' ? 'Coordinator' : stage === 'HR Validation' ? 'HR Reviewer' : `${stage.replace(' Review', '')} Reviewer`,
      status: stage === 'Operations Review' ? 'Pending' : 'Not Started',
    }));
  if (rows.length) {
    const { error } = await supabase.from('approval_requests').insert(rows);
    if (error) throw error;
  }
  await supabase.from('site_visits').update({ current_stage: 'Operations Review', pending_with: 'Operations Team', status: 'Pending Review', updated_at: new Date().toISOString() }).eq('id', visit.id);
  return rows;
}

export async function recordApprovalDecisionRemote({ visit, stage, status, pendingWith, remarks, user }) {
  assertConfigured();
  const orderedStages = ['Operations Review', 'Coordinator Costing Review', 'HR Validation', 'Commercial Review', 'Finance Review'];
  const pendingOwnerByStage = {
    'Operations Review': 'Operations Team',
    'Coordinator Costing Review': 'Coordinator',
    'HR Validation': 'HR Reviewer',
    'Commercial Review': 'Commercial Reviewer',
    'Finance Review': 'Finance Reviewer',
  };
  const nextStageIndex = orderedStages.indexOf(stage) + 1;
  const nextStage = status === 'Approved' ? orderedStages[nextStageIndex] || 'Returned to BD' : stage;
  const nextPendingWith = status === 'Approved'
    ? pendingOwnerByStage[nextStage] || 'BD Executive'
    : pendingWith;
  const decisionPayload = {
    pending_with: pendingWith,
    status,
    remarks: remarks || null,
    approved_by: user?.email || user?.name || null,
    approved_at: new Date().toISOString(),
  };
  const existing = await supabase
    .from('approval_requests')
    .select('id, status')
    .eq('site_visit_id', visit.id)
    .eq('approval_stage', stage)
    .in('status', ['Pending', 'Not Started'])
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (existing.error && !tableMissing(existing.error)) throw existing.error;
  if (existing.data?.id) {
    const { error } = await supabase.from('approval_requests').update(decisionPayload).eq('id', existing.data.id);
    if (error) throw error;
  } else {
    const { error } = await supabase.from('approval_requests').insert({
      lead_id: visit.leadId,
      site_visit_id: visit.id,
      assessment_id: visit.assessmentId || null,
      approval_stage: stage,
      ...decisionPayload,
    });
    if (error) throw error;
  }
  if (status === 'Approved' && pendingOwnerByStage[nextStage]) {
    const nextExisting = await supabase
      .from('approval_requests')
      .select('id, status')
      .eq('site_visit_id', visit.id)
      .eq('approval_stage', nextStage)
      .in('status', ['Pending', 'Approved'])
      .limit(1)
      .maybeSingle();
    if (nextExisting.error && !tableMissing(nextExisting.error)) throw nextExisting.error;
    if (!nextExisting.data?.id) {
      const { error: nextError } = await supabase.from('approval_requests').insert({
        lead_id: visit.leadId,
        site_visit_id: visit.id,
        assessment_id: visit.assessmentId || null,
        approval_stage: nextStage,
        pending_with: nextPendingWith,
        status: 'Pending',
        remarks: null,
      });
      if (nextError) throw nextError;
    }
  }
  await supabase
    .from('site_visits')
    .update({
      current_stage: nextStage,
      pending_with: nextPendingWith,
      status: status === 'Approved' ? (nextStage === 'Returned to BD' ? 'Returned to BD' : 'Pending Review') : status,
      updated_at: new Date().toISOString(),
    })
    .eq('id', visit.id);
}

export async function markProposalSentRemote(visit, proposal = {}) {
  assertConfigured();
  const sentAt = new Date().toISOString();
  const siteVisitUpdate = await supabase
    .from('site_visits')
    .update({
      current_stage: 'Proposal Sent',
      pending_with: 'Existing Business Operations',
      status: 'Proposal Sent',
      updated_at: sentAt,
    })
    .eq('id', visit.id);
  if (siteVisitUpdate.error) throw siteVisitUpdate.error;

  if (visit.leadId) {
    const leadUpdate = await supabase
      .from('leads')
      .update({ lead_stage: 'Proposal Sent', status: 'Converted to Existing Business', updated_at: sentAt })
      .eq('id', visit.leadId);
    if (leadUpdate.error && !tableMissing(leadUpdate.error)) throw leadUpdate.error;
  }

  const proposalId = proposal.id || visit.proposal?.id;
  if (proposalId) {
    const proposalUpdate = await supabase
      .from('proposals')
      .update({
        proposal_status: 'Sent',
        sent_at: sentAt,
        metadata: {
          ...(visit.proposal?.metadata || {}),
          ...(proposal.metadata || {}),
          proposalPayload: proposal,
        },
      })
      .eq('id', proposalId);
    if (proposalUpdate.error && !tableMissing(proposalUpdate.error)) throw proposalUpdate.error;
  }

  await logActivity({
    leadId: visit.leadId,
    siteVisitId: visit.id,
    type: 'Proposal Sent',
    message: 'Proposal sent to client and moved to Existing Business Pipeline',
    createdBy: proposal.sentBy || proposal.generatedByName || null,
  });
}

export async function uploadSiteImageRemote({ visit, assessmentId, category, file, uploadedBy }) {
  assertConfigured();
  const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, '-');
  const path = `${visit.id}/${category}/${Date.now()}-${safeName}`;
  const upload = await supabase.storage.from('site-survey-images').upload(path, file, { upsert: false });
  if (upload.error) throw upload.error;

  const { data: publicData } = supabase.storage.from('site-survey-images').getPublicUrl(path);
  const imageUrl = publicData.publicUrl;
  const { error } = await supabase.from('site_images').insert({
    site_visit_id: visit.id,
    assessment_id: assessmentId || null,
    image_category: category,
    image_url: imageUrl,
    file_name: file.name,
    uploaded_by: uploadedBy,
  });
  if (error) throw error;
  return { id: path, name: file.name, url: imageUrl };
}

export async function logActivity({ leadId, siteVisitId, type, message, createdBy }) {
  if (!isSupabaseConfigured) return;
  await supabase.from('activity_logs').insert({
    lead_id: leadId || null,
    site_visit_id: siteVisitId || null,
    activity_type: type,
    activity_message: message,
    created_by: createdBy || null,
  });
}

export async function logAssessmentAuditRemote({ visit, sectionName, actionType, user, oldValue, newValue, remarks }) {
  if (!isSupabaseConfigured) return;
  await supabase.from('assessment_audit_logs').insert({
    site_visit_id: visit?.id || null,
    assessment_id: visit?.assessmentId || null,
    section_name: sectionName,
    action_type: actionType,
    edited_by: user?.name || user?.email || null,
    edited_by_role: user?.role || null,
    old_value: oldValue || {},
    new_value: newValue || {},
    remarks: remarks || null,
  });
}
