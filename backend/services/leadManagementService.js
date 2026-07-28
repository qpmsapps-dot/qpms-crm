const FULL_VISIBILITY_ROLES = new Set([
  'BD Head',
  'Admin',
  'QPMS Admin',
  'Developer',
  'COO',
  'GM',
  'MD',
]);

const LEAD_ACCESS_ROLES = new Set([
  'BD Executive',
  'BD Head',
  'Business Head',
  'Branch Head',
  ...FULL_VISIBILITY_ROLES,
]);

const CREATE_ROLES = new Set([
  'BD Executive',
  'Admin',
  'COO',
  'GM',
  'MD',
]);

const ASSIGNMENT_ROLES = new Set([
  'Admin',
  'COO',
  'GM',
  'MD',
]);

export const approvedIndustries = [
  'Manufacturing',
  'Educational',
  'Retail',
  'Commercial',
  'Electronics',
  'Hospital',
];
export const approvedServiceScopes = [
  'Soft Services',
  'Hard Services',
  'Security Services',
  'Pest Control Services',
  'Landscaping Services',
  'Waste Management',
  'Other Services',
];
const INDUSTRIES = new Set(approvedIndustries);
const SERVICE_SCOPES = new Set(approvedServiceScopes);
const SOURCES = new Set(['LinkedIn', 'Website', 'Campaign', 'Referral', 'Direct Visit', 'Email', 'Phone Enquiry']);
const PRIORITIES = new Set(['High', 'Medium', 'Low']);
const STATUSES = new Set(['Active', 'Pending', 'Escalated', 'Completed', 'MOM Sent', 'Converted to Assessment', 'Archived', 'Lost']);
const STAGES = new Set(['New Lead', 'Lead MOM Sent', 'Converted', 'Site Visit Scheduled', 'Proposal Sent', 'Lost']);

function roleKey(value) {
  return String(value || '').trim().toUpperCase().replace(/[^A-Z0-9]+/g, '');
}

export function normalizeLeadRole(value) {
  const aliases = {
    BDEXECUTIVE: 'BD Executive',
    BUSINESSDEVELOPMENTEXECUTIVE: 'BD Executive',
    BDHEAD: 'BD Head',
    BUSINESSDEVELOPMENTHEAD: 'BD Head',
    BUSINESSHEAD: 'Business Head',
    BRANCHHEAD: 'Branch Head',
    BH: 'Branch Head',
    ADMIN: 'Admin',
    QPMSADMIN: 'QPMS Admin',
    DEVELOPER: 'Developer',
    DEV: 'Developer',
    ITADMIN: 'Developer',
    MANAGEMENTITADMIN: 'Developer',
    COO: 'COO',
    GM: 'GM',
    GENERALMANAGER: 'GM',
    GMTOPMANAGEMENT: 'GM',
    MD: 'MD',
  };
  return aliases[roleKey(value)] || String(value || '').trim();
}

export function isActiveLeadProfile(profile) {
  const status = String(profile?.status || '').trim().toLowerCase();
  return Boolean(profile) && profile.is_active === true && (!status || status === 'active');
}

export function leadActor(profile, authUser = {}) {
  return {
    profileId: String(profile?.id || '').trim(),
    authUserId: String(profile?.auth_user_id || authUser?.id || '').trim(),
    employeeCode: cleanText(profile?.employee_code),
    name: cleanText(profile?.full_name || profile?.display_name || profile?.employee_code || profile?.email),
    email: normalizeEmail(profile?.email || authUser?.email),
    role: normalizeLeadRole(profile?.role),
    state: cleanText(profile?.state),
    business: cleanText(profile?.business),
    branch: cleanText(profile?.branch),
  };
}

export function canAccessLeadModule(actor) {
  return isActiveLeadProfile({ is_active: true, status: 'Active', ...actor }) && LEAD_ACCESS_ROLES.has(actor?.role);
}

export function canCreateLead(actor) {
  return CREATE_ROLES.has(actor?.role);
}

export function canAssignLead(actor) {
  return ASSIGNMENT_ROLES.has(actor?.role);
}

export function canViewLead(actor, lead) {
  if (!actor || !lead) return false;
  if (FULL_VISIBILITY_ROLES.has(actor.role)) return true;
  if (actor.role === 'BD Executive') {
    return normalizeEmail(lead.assigned_bd_email) === actor.email
      || String(lead.created_by_user_id || '') === actor.authUserId
      || String(lead.created_by_user_id || '') === actor.profileId;
  }
  if (actor.role === 'Business Head') {
    return Boolean(actor.business) && normalizedText(lead.business) === normalizedText(actor.business);
  }
  if (actor.role === 'Branch Head') {
    const stateMatches = Boolean(actor.state) && normalizedText(lead.state) === normalizedText(actor.state);
    const leadBusiness = cleanText(lead.business);
    const leadBranch = cleanText(lead.branch);
    return stateMatches
      && (!actor.branch || !leadBranch || normalizedText(leadBranch) === normalizedText(actor.branch))
      && (!actor.business || !leadBusiness || normalizedText(leadBusiness) === normalizedText(actor.business));
  }
  return false;
}

export function canEditLead(actor, lead) {
  if (!canViewLead(actor, lead)) return false;
  if (actor.role === 'BD Executive') return true;
  return FULL_VISIBILITY_ROLES.has(actor.role) || actor.role === 'Business Head' || actor.role === 'Branch Head';
}

export function cleanText(value) {
  return String(value || '').replace(/\s+/g, ' ').trim();
}

export function normalizedText(value) {
  return cleanText(value).toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}

export function normalizeEmail(value) {
  return cleanText(value).toLowerCase();
}

export function comparablePhone(value) {
  const digits = String(value || '').replace(/\D/g, '');
  if (digits.length === 12 && digits.startsWith('91')) return digits.slice(2);
  if (digits.length === 11 && digits.startsWith('0')) return digits.slice(1);
  return digits;
}

export function validEmail(value) {
  const email = normalizeEmail(value);
  return !email || /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

export function validPhone(value) {
  const raw = cleanText(value);
  if (!raw) return true;
  const digits = comparablePhone(raw);
  return digits.length >= 7 && digits.length <= 15 && /^[+()\-\s0-9]+$/.test(raw);
}

export function normalizeContacts(value) {
  const rows = Array.isArray(value) ? value : [];
  const requestedPrimary = rows.findIndex((contact) => contact?.isPrimary === true || contact?.is_primary === true);
  const primaryIndex = requestedPrimary >= 0 ? requestedPrimary : 0;
  return rows.map((contact, index) => ({
    name: cleanText(contact?.name || contact?.contact_person_name),
    designation: cleanText(contact?.designation || contact?.contact_person_designation),
    phone: cleanText(contact?.phone || contact?.contact_number),
    phone_normalized: comparablePhone(contact?.phone || contact?.contact_number),
    email: normalizeEmail(contact?.email || contact?.email_id),
    is_primary: index === primaryIndex,
  }));
}

function normalizeServiceScope(value) {
  if (!Array.isArray(value)) return value;
  const unique = [...new Set(value.map(cleanText).filter(Boolean))];
  return [
    ...approvedServiceScopes.filter((service) => unique.includes(service)),
    ...unique.filter((service) => !SERVICE_SCOPES.has(service)),
  ];
}

export function normalizeLeadPayload(body = {}) {
  const hasServiceScope = Object.prototype.hasOwnProperty.call(body, 'service_scope')
    || Object.prototype.hasOwnProperty.call(body, 'serviceScope');
  const rawServiceScope = Object.prototype.hasOwnProperty.call(body, 'service_scope')
    ? body.service_scope
    : body.serviceScope;
  return {
    client_name: cleanText(body.client_name || body.clientName || body.company),
    industry_type: cleanText(body.industry_type || body.industryType || body.industry),
    lead_source: cleanText(body.lead_source || body.leadSource || body.source),
    site_location: cleanText(body.site_location || body.siteLocation || body.location),
    state: cleanText(body.state),
    city: cleanText(body.city),
    lead_priority: cleanText(body.lead_priority || body.leadPriority || body.priority),
    service_scope: hasServiceScope ? normalizeServiceScope(rawServiceScope) : [],
    remarks: cleanText(body.remarks),
    status: cleanText(body.status) || 'Active',
    lead_stage: cleanText(body.lead_stage || body.leadStage || body.stage) || 'New Lead',
    assigned_bd_email: normalizeEmail(body.assigned_bd_email || body.assignedBdEmail),
    assigned_bd_profile_id: cleanText(body.assigned_bd_profile_id || body.assignedBdProfileId),
    duplicate_override: body.duplicate_override === true || body.duplicateOverride === true,
    duplicate_override_reason: cleanText(body.duplicate_override_reason || body.duplicateOverrideReason),
    contacts: normalizeContacts(body.contacts?.length ? body.contacts : [{
      name: body.contact_person_name || body.contactName,
      designation: body.contact_person_designation || body.contactDesignation,
      phone: body.contact_number || body.contactNumber,
      email: body.email_id || body.email,
      isPrimary: true,
    }]),
  };
}

export function validateLeadPayload(
  lead,
  {
    creating = true,
    allowLegacyIndustry = false,
    allowLegacyServices = false,
  } = {},
) {
  const errors = [];
  if (!lead.client_name) errors.push('Client / company name is required.');
  if (!lead.industry_type || (!INDUSTRIES.has(lead.industry_type) && !allowLegacyIndustry)) {
    errors.push(`Industry must be one of: ${approvedIndustries.join(', ')}`);
  }
  if (!Array.isArray(lead.service_scope)) {
    errors.push('Scope of Services must be an array.');
  } else if (!allowLegacyServices && lead.service_scope.some((service) => !SERVICE_SCOPES.has(service))) {
    errors.push(`Scope of Services must contain only: ${approvedServiceScopes.join(', ')}`);
  }
  if (!lead.lead_source || !SOURCES.has(lead.lead_source)) errors.push('Select a valid lead source.');
  if (!lead.site_location) errors.push('Site location is required.');
  if (!lead.state) errors.push('State is required.');
  if (!lead.city) errors.push('City is required.');
  if (!PRIORITIES.has(lead.lead_priority)) errors.push('Lead priority must be High, Medium, or Low.');
  if (!STATUSES.has(lead.status)) errors.push('Unsupported lead status.');
  if (!STAGES.has(lead.lead_stage)) errors.push('Unsupported lead stage.');
  if (creating && !lead.contacts.length) errors.push('At least one contact is required.');
  lead.contacts.forEach((contact, index) => {
    if (!contact.name) errors.push(`Contact ${index + 1} name is required.`);
    if (!contact.phone && !contact.email) errors.push(`Contact ${index + 1} phone or email is required.`);
    if (!validPhone(contact.phone)) errors.push(`Contact ${index + 1} phone is invalid.`);
    if (!validEmail(contact.email)) errors.push(`Contact ${index + 1} email is invalid.`);
  });
  const phones = lead.contacts.map((contact) => contact.phone_normalized).filter(Boolean);
  const emails = lead.contacts.map((contact) => contact.email).filter(Boolean);
  if (new Set(phones).size !== phones.length) {
    errors.push('Contact phone numbers must be unique within a lead.');
  }
  if (new Set(emails).size !== emails.length) {
    errors.push('Contact email addresses must be unique within a lead.');
  }
  if (lead.contacts.length && !lead.contacts.some((contact) => contact.is_primary)) {
    errors.push('One primary contact is required.');
  }
  return errors;
}

export function duplicateScore(candidate, contacts, lead) {
  const clientMatch = normalizedText(candidate.client_name || candidate.company_name) === normalizedText(lead.client_name);
  const stateMatch = normalizedText(candidate.state) === normalizedText(lead.state);
  const cityMatch = normalizedText(candidate.city) === normalizedText(lead.city);
  const siteMatch = normalizedText(candidate.site_location) === normalizedText(lead.site_location);
  const candidatePhones = new Set(contacts.map((item) => comparablePhone(item.contact_number)).filter(Boolean));
  const candidateEmails = new Set(contacts.map((item) => normalizeEmail(item.email_id)).filter(Boolean));
  const contactMatch = lead.contacts.some((item) =>
    (item.phone_normalized && candidatePhones.has(item.phone_normalized))
    || (item.email && candidateEmails.has(item.email)));
  return {
    clientMatch,
    stateMatch,
    cityMatch,
    siteMatch,
    contactMatch,
    isStrongDuplicate: clientMatch && stateMatch && cityMatch && siteMatch && contactMatch,
  };
}

export async function loadLeadRelations(client, leadIds) {
  if (!leadIds.length) return { contacts: {}, activities: {} };
  const [contactResult, activityResult] = await Promise.all([
    client.from('lead_contacts').select('*').in('lead_id', leadIds).order('created_at'),
    client.from('activity_logs').select('*').in('lead_id', leadIds).order('created_at', { ascending: false }),
  ]);
  if (contactResult.error) throw contactResult.error;
  if (activityResult.error) throw activityResult.error;
  return {
    contacts: groupBy(contactResult.data || [], 'lead_id'),
    activities: groupBy(activityResult.data || [], 'lead_id'),
  };
}

export function leadResponse(lead, relations = {}) {
  const contacts = relations.contacts?.[lead.id] || lead.contacts || [];
  const primaryContact = contacts.find((contact) => contact.is_primary) || contacts[0] || null;
  return {
    ...lead,
    service_scope: normalizeServiceScope(lead.service_scope),
    contacts,
    primary_contact: primaryContact,
    activity_logs: relations.activities?.[lead.id] || lead.activity_logs || [],
  };
}

export async function findDuplicateLeads(client, actor, lead, candidates = null) {
  let rows = candidates;
  if (!rows) {
    const result = await client.from('leads').select('*').order('created_at', { ascending: false }).limit(1000);
    if (result.error) throw result.error;
    rows = result.data || [];
  }
  const relations = await loadLeadRelations(client, rows.map((row) => row.id));
  return rows.flatMap((candidate) => {
    const score = duplicateScore(candidate, relations.contacts[candidate.id] || [], lead);
    if (!score.isStrongDuplicate) return [];
    if (!canViewLead(actor, candidate)) {
      return [{ restricted: true, message: 'A matching lead exists outside your visibility scope.' }];
    }
    return [{
      id: candidate.id,
      lead_code: candidate.lead_code,
      client_name: candidate.client_name,
      site_location: candidate.site_location,
      city: candidate.city,
      state: candidate.state,
      status: candidate.status,
      ...score,
    }];
  });
}

export async function resolveAssignee(client, actor, requestedIdentifier) {
  if (actor.role === 'BD Executive') {
    return {
      id: actor.profileId,
      name: actor.name,
      email: actor.email,
      authUserId: actor.authUserId,
      employeeCode: actor.employeeCode,
    };
  }
  if (!requestedIdentifier) return null;
  if (!canAssignLead(actor)) {
    const error = new Error('You do not have permission to assign BD leads.');
    error.statusCode = 403;
    error.code = 'lead_assignment_denied';
    throw error;
  }
  const profiles = client.from('profiles').select('*');
  const identifier = cleanText(requestedIdentifier);
  const query = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(identifier)
    ? profiles.eq('id', identifier)
    : profiles.ilike('email', identifier);
  const result = await query.maybeSingle();
  if (result.error) throw result.error;
  const profile = result.data;
  if (!profile || !isActiveLeadProfile(profile) || normalizeLeadRole(profile.role) !== 'BD Executive') {
    const error = new Error('Selected assignee is not an active BD Executive.');
    error.statusCode = 400;
    throw error;
  }
  return {
    id: String(profile.id || ''),
    name: cleanText(profile.full_name || profile.display_name || profile.employee_code || profile.email),
    email: normalizeEmail(profile.email),
    authUserId: String(profile.auth_user_id || ''),
    employeeCode: cleanText(profile.employee_code),
    business: cleanText(profile.business),
    branch: cleanText(profile.branch),
    state: cleanText(profile.state),
  };
}

export function safeLeadAssignees(profiles = []) {
  return profiles
    .filter((profile) => normalizeLeadRole(profile?.role) === 'BD Executive' && isActiveLeadProfile(profile))
    .map((profile) => ({
      id: String(profile.id || ''),
      full_name: cleanText(profile.full_name || profile.display_name || profile.employee_code),
      employee_code: cleanText(profile.employee_code),
    }))
    .filter((profile) => profile.id && profile.full_name);
}

function groupBy(rows, key) {
  return rows.reduce((grouped, row) => {
    const value = row?.[key];
    if (!value) return grouped;
    grouped[value] = [...(grouped[value] || []), row];
    return grouped;
  }, {});
}

export const leadRoleSets = {
  fullVisibility: FULL_VISIBILITY_ROLES,
  access: LEAD_ACCESS_ROLES,
  create: CREATE_ROLES,
  assign: ASSIGNMENT_ROLES,
};
