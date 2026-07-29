import test from 'node:test';
import assert from 'node:assert/strict';

import {
  approvedIndustries,
  approvedServiceScopes,
  canAccessLeadModule,
  canAssignLead,
  canCreateLead,
  canEditLead,
  canManageLeadMom,
  canViewLead,
  duplicateScore,
  isActiveLeadProfile,
  leadActor,
  leadListResponse,
  leadMomContactRecipients,
  normalizeContacts,
  normalizeLeadPayload,
  normalizeLeadRole,
  resolveAssignee,
  safeLeadAssignees,
  safeLeadMomSender,
  validateLeadPayload,
} from '../services/leadManagementService.js';

test('authenticated Admin receives an empty successful lead-list response', () => {
  const actor = leadActor(activeProfile('Admin'));
  assert.deepEqual(leadListResponse(actor, []), {
    ok: true,
    count: 0,
    role: 'Admin',
    scope: 'all',
    leads: [],
  });
});

const activeProfile = (role, overrides = {}) => ({
  id: `profile-${role}`,
  auth_user_id: `auth-${role}`,
  employee_code: `EMP-${role}`,
  full_name: role,
  email: `${role.replace(/\s/g, '').toLowerCase()}@qpms.test`,
  role,
  status: 'Active',
  is_active: true,
  state: 'Tamil Nadu',
  business: 'IFMS',
  ...overrides,
});

test('canonical role aliases stay distinct', () => {
  const cases = {
    'bd executive': 'BD Executive',
    BUSINESS_DEVELOPMENT_EXECUTIVE: 'BD Executive',
    'BD Head': 'BD Head',
    business_development_head: 'BD Head',
    'Business Head': 'Business Head',
    branch_head: 'Branch Head',
    Admin: 'Admin',
    qpms_admin: 'QPMS Admin',
    dev: 'Developer',
    COO: 'COO',
    GM: 'GM',
    general_manager: 'GM',
    md: 'MD',
  };
  Object.entries(cases).forEach(([input, expected]) => assert.equal(normalizeLeadRole(input), expected));
});

test('approved roles may manage MOM only for a visible lead', () => {
  const lead = {
    id: 'lead-1',
    assigned_bd_email: 'bdexecutive@qpms.test',
    created_by_user_id: 'auth-BD Executive',
  };
  for (const role of ['BD Executive', 'Admin', 'COO', 'GM', 'MD']) {
    const actor = leadActor(activeProfile(role));
    assert.equal(canManageLeadMom(actor, lead), true, role);
  }
  assert.equal(canManageLeadMom(leadActor(activeProfile('Branch Head')), lead), false);
  const otherBd = leadActor(activeProfile('BD Executive', {
    id: 'profile-other',
    auth_user_id: 'auth-other',
    email: 'other@qpms.test',
  }));
  assert.equal(canManageLeadMom(otherBd, lead), false);
});

test('MOM sender identity is derived from the authenticated actor', () => {
  const actor = leadActor(activeProfile('COO'));
  assert.deepEqual(safeLeadMomSender(actor), {
    profile_id: actor.profileId,
    auth_user_id: actor.authUserId,
    employee_code: actor.employeeCode,
    name: actor.name,
    role: 'COO',
  });
});

test('MOM contact recipients prefer primary, deduplicate, and skip missing email', () => {
  assert.deepEqual(leadMomContactRecipients([
    { email_id: 'second@example.com', is_primary: false },
    { email_id: '', is_primary: false },
    { email_id: ' PRIMARY@example.com ', is_primary: true },
    { email_id: 'second@example.com', is_primary: false },
  ]), ['primary@example.com', 'second@example.com']);
});

test('role access and creation matrix', () => {
  for (const role of ['BD Executive', 'BD Head', 'Business Head', 'Branch Head', 'Admin', 'QPMS Admin', 'Developer', 'COO', 'GM', 'MD']) {
    const actor = leadActor(activeProfile(role));
    assert.equal(canAccessLeadModule(actor), true, role);
  }
  assert.equal(canAccessLeadModule(leadActor(activeProfile('Finance Reviewer'))), false);
  assert.equal(isActiveLeadProfile(activeProfile('BD Executive', { is_active: false })), false);
  const creation = {
    'BD Executive': true,
    'BD Head': false,
    'Business Head': false,
    'Branch Head': false,
    Admin: true,
    'QPMS Admin': false,
    Developer: false,
    COO: true,
    GM: true,
    MD: true,
  };
  Object.entries(creation).forEach(([role, allowed]) => {
    assert.equal(canCreateLead(leadActor(activeProfile(role))), allowed, role);
  });
  for (const role of ['Admin', 'COO', 'GM', 'MD']) {
    assert.equal(canAssignLead(leadActor(activeProfile(role))), true, role);
  }
  for (const role of ['BD Executive', 'BD Head', 'QPMS Admin', 'Developer', 'Business Head', 'Branch Head']) {
    assert.equal(canAssignLead(leadActor(activeProfile(role))), false, role);
  }
});

test('creator identity stays independent from an explicitly selected active BD assignee', async () => {
  const assigneeProfile = activeProfile('BD Executive', {
    full_name: 'Pilot Executive',
    email: 'pilot.bd@qpms.test',
    business: 'IFMS',
    state: 'Tamil Nadu',
  });
  const client = {
    from: () => ({
      select: () => ({
        ilike: () => ({ maybeSingle: async () => ({ data: assigneeProfile, error: null }) }),
      }),
    }),
  };
  for (const role of ['Admin', 'COO', 'GM', 'MD']) {
    const creator = leadActor(activeProfile(role, {
      full_name: `${role} Creator`,
      email: `${role.toLowerCase()}@qpms.test`,
    }));
    const assignee = await resolveAssignee(client, creator, assigneeProfile.email);
    assert.equal(creator.name, `${role} Creator`);
    assert.equal(assignee.name, 'Pilot Executive');
    assert.equal(assignee.email, 'pilot.bd@qpms.test');
    assert.notEqual(creator.authUserId, assignee.authUserId);
  }
});

test('management may create an unassigned lead', async () => {
  for (const role of ['Admin', 'COO', 'GM', 'MD']) {
    const actor = leadActor(activeProfile(role));
    assert.equal(await resolveAssignee({}, actor, ''), null, role);
  }
});

test('BD Executive assignment is forced to the authenticated actor', async () => {
  const actor = leadActor(activeProfile('BD Executive', {
    full_name: 'Authenticated BD',
    email: 'authenticated.bd@qpms.test',
  }));
  const client = {
    from: () => {
      throw new Error('BD self-assignment must not query a client-supplied assignee.');
    },
  };
  const assignee = await resolveAssignee(client, actor, 'different.bd@qpms.test');
  assert.equal(assignee.name, 'Authenticated BD');
  assert.equal(assignee.email, 'authenticated.bd@qpms.test');
});

test('management assignment rejects inactive, non-BD, and unknown profiles', async () => {
  const actor = leadActor(activeProfile('Admin'));
  for (const profile of [
    activeProfile('BD Executive', { is_active: false }),
    activeProfile('FO'),
    null,
  ]) {
    const client = {
      from: () => ({
        select: () => ({
          ilike: () => ({ maybeSingle: async () => ({ data: profile, error: null }) }),
        }),
      }),
    };
    await assert.rejects(
      resolveAssignee(client, actor, 'candidate@qpms.test'),
      /Selected assignee is not an active BD Executive/,
    );
  }
});

test('assignee lookup returns only safe fields for active BD Executives', () => {
  const rows = safeLeadAssignees([
    activeProfile('BD Executive', {
      id: 'active-bd',
      employee_code: 'QPMSBD001',
      full_name: 'Active BD',
      mobile: 'not-returned',
      email: 'not-returned@qpms.test',
    }),
    activeProfile('BD Executive', { id: 'inactive-bd', is_active: false }),
    activeProfile('FO', { id: 'active-fo' }),
  ]);
  assert.deepEqual(rows, [{
    id: 'active-bd',
    employee_code: 'QPMSBD001',
    full_name: 'Active BD',
  }]);
});

test('BD Executive sees and edits own lead only', () => {
  const actor = leadActor(activeProfile('BD Executive'));
  const own = { assigned_bd_email: actor.email, created_by_user_id: actor.authUserId };
  const other = { assigned_bd_email: 'other@qpms.test', created_by_user_id: 'other-auth' };
  assert.equal(canViewLead(actor, own), true);
  assert.equal(canEditLead(actor, own), true);
  assert.equal(canViewLead(actor, other), false);
  assert.equal(canEditLead(actor, other), false);
});

test('management and scoped visibility rules', () => {
  const lead = { state: 'Tamil Nadu', business: 'IFMS' };
  assert.equal(canViewLead(leadActor(activeProfile('BD Head')), lead), true);
  assert.equal(canViewLead(leadActor(activeProfile('Admin')), lead), true);
  assert.equal(canViewLead(leadActor(activeProfile('QPMS Admin')), lead), true);
  assert.equal(canViewLead(leadActor(activeProfile('Developer')), lead), true);
  assert.equal(canViewLead(leadActor(activeProfile('COO')), lead), true);
  assert.equal(canViewLead(leadActor(activeProfile('GM')), lead), true);
  assert.equal(canViewLead(leadActor(activeProfile('MD')), lead), true);
  assert.equal(canViewLead(leadActor(activeProfile('Branch Head')), lead), true);
  assert.equal(canViewLead(leadActor(activeProfile('Branch Head', { state: 'Kerala' })), lead), false);
  assert.equal(canViewLead(leadActor(activeProfile('Branch Head', { branch: 'Chennai' })), { ...lead, branch: 'Chennai' }), true);
  assert.equal(canViewLead(leadActor(activeProfile('Branch Head', { branch: 'Chennai' })), { ...lead, branch: 'Coimbatore' }), false);
  assert.equal(canViewLead(leadActor(activeProfile('Business Head')), lead), true);
  assert.equal(canViewLead(leadActor(activeProfile('Business Head', { business: '' })), lead), false);
  assert.equal(canViewLead(leadActor(activeProfile('Business Head', { business: 'Security' })), lead), false);
});

test('lead validation accepts multiple normalized contacts and rejects invalid data', () => {
  const valid = normalizeLeadPayload({
    client_name: '  Acme   India ',
    industry_type: 'Commercial',
    lead_source: 'Referral',
    site_location: 'Guindy',
    state: 'Tamil Nadu',
    city: 'Chennai',
    lead_priority: 'High',
    contacts: [
      { name: 'Primary', phone: '+91 98765 43210', email: 'PRIMARY@EXAMPLE.COM', isPrimary: true },
      { name: 'Secondary', phone: '044-22223333', email: 'second@example.com', isPrimary: true },
    ],
  });
  assert.deepEqual(validateLeadPayload(valid), []);
  assert.equal(valid.client_name, 'Acme India');
  assert.equal(valid.contacts.filter((contact) => contact.is_primary).length, 1);
  assert.equal(valid.contacts[0].email, 'primary@example.com');

  const invalid = normalizeLeadPayload({ ...valid, contacts: [{ name: '', phone: '12', email: 'bad' }] });
  assert.ok(validateLeadPayload(invalid).length >= 3);
});

test('contact normalization produces exactly one primary contact', () => {
  const withoutPrimary = normalizeContacts([
    { name: 'First', phone: '9000000001' },
    { name: 'Second', email: 'second@example.com' },
  ]);
  assert.equal(withoutPrimary.filter((contact) => contact.is_primary).length, 1);
  assert.equal(withoutPrimary[0].is_primary, true);

  const multiplePrimary = normalizeContacts([
    { name: 'First', phone: '9000000001', isPrimary: true },
    { name: 'Second', email: 'second@example.com', isPrimary: true },
  ]);
  assert.equal(multiplePrimary.filter((contact) => contact.is_primary).length, 1);
  assert.equal(multiplePrimary[0].is_primary, true);
});

test('lead validation rejects duplicate normalized contact phone and email', () => {
  const duplicatePhone = normalizeLeadPayload({
    contacts: [
      { name: 'First', phone: '+91 90000 00001' },
      { name: 'Second', phone: '9000000001' },
    ],
  });
  assert.ok(validateLeadPayload(duplicatePhone, { creating: false })
    .includes('Contact phone numbers must be unique within a lead.'));

  const duplicateEmail = normalizeLeadPayload({
    contacts: [
      { name: 'First', email: 'CONTACT@EXAMPLE.COM' },
      { name: 'Second', email: ' contact@example.com ' },
    ],
  });
  assert.ok(validateLeadPayload(duplicateEmail, { creating: false })
    .includes('Contact email addresses must be unique within a lead.'));
});

test('legacy scalar contact payload remains canonical', () => {
  const lead = normalizeLeadPayload({
    contact_person_name: 'Legacy Contact',
    contact_number: '9000000001',
  });
  assert.equal(lead.contacts.length, 1);
  assert.equal(lead.contacts[0].name, 'Legacy Contact');
  assert.equal(lead.contacts[0].is_primary, true);
});

test('approved industries are accepted in canonical order', () => {
  assert.deepEqual(approvedIndustries, [
    'Manufacturing',
    'Educational',
    'Retail',
    'Commercial',
    'Electronics',
    'Hospital',
  ]);
  for (const industry of approvedIndustries) {
    const lead = normalizeLeadPayload({
      client_name: 'Acme India',
      industry_type: industry,
      lead_source: 'Referral',
      site_location: 'Guindy',
      state: 'Tamil Nadu',
      city: 'Chennai',
      lead_priority: 'High',
      contacts: [{ name: 'Client', phone: '9876543210' }],
    });
    assert.deepEqual(validateLeadPayload(lead), [], industry);
  }
});

test('new lead rejects missing and legacy industries with a clear allow-list error', () => {
  const base = {
    client_name: 'Acme India',
    lead_source: 'Referral',
    site_location: 'Guindy',
    state: 'Tamil Nadu',
    city: 'Chennai',
    lead_priority: 'High',
    contacts: [{ name: 'Client', phone: '9876543210' }],
  };
  for (const industry_type of ['', 'Healthcare', 'Airport', 'Education']) {
    const errors = validateLeadPayload(normalizeLeadPayload({ ...base, industry_type }));
    assert.ok(errors.includes(
      'Industry must be one of: Manufacturing, Educational, Retail, Commercial, Electronics, Hospital',
    ));
  }
});

test('scope normalization trims, deduplicates, removes blanks, and applies approved order', () => {
  assert.deepEqual(approvedServiceScopes, [
    'Soft Services',
    'Hard Services',
    'Security Services',
    'Pest Control Services',
    'Landscaping Services',
    'Waste Management',
    'Other Services',
  ]);
  const lead = normalizeLeadPayload({
    service_scope: [
      ' Hard Services ',
      ' Security Services ',
      'Soft Services',
      'Hard Services',
      ' ',
    ],
  });
  assert.deepEqual(lead.service_scope, [
    'Soft Services',
    'Hard Services',
    'Security Services',
  ]);
});

test('scope validation accepts empty arrays and rejects unknown or non-array values', () => {
  const valid = normalizeLeadPayload({ service_scope: [] });
  assert.deepEqual(valid.service_scope, []);
  assert.equal(validateLeadPayload(valid, { creating: false }).some((error) => error.includes('Scope of Services')), false);

  const unknown = normalizeLeadPayload({ service_scope: ['Soft Services', 'Legacy Service'] });
  assert.ok(validateLeadPayload(unknown, { creating: false }).some((error) => error.includes('Scope of Services')));

  const nonArray = normalizeLeadPayload({ service_scope: 'Soft Services, Hard Services' });
  assert.ok(validateLeadPayload(nonArray, { creating: false }).includes('Scope of Services must be an array.'));
});

test('legacy values can be preserved for an unrelated patch but replacements stay strict', () => {
  const legacy = normalizeLeadPayload({
    client_name: 'Legacy Client',
    industry_type: 'Airport',
    lead_source: 'Referral',
    site_location: 'Guindy',
    state: 'Tamil Nadu',
    city: 'Chennai',
    lead_priority: 'High',
    service_scope: ['Helpdesk CAFM'],
    contacts: [{ name: 'Client', phone: '9876543210' }],
  });
  assert.deepEqual(validateLeadPayload(legacy, {
    creating: false,
    allowLegacyIndustry: true,
    allowLegacyServices: true,
  }), []);
  assert.ok(validateLeadPayload(legacy, { creating: false }).length >= 2);
});

test('strong duplicate needs client, site, city, state, and matching contact', () => {
  const candidate = { client_name: 'Acme India', site_location: 'Guindy', city: 'Chennai', state: 'Tamil Nadu' };
  const candidateContacts = [{ contact_number: '+91 98765 43210', email_id: 'client@example.com' }];
  const lead = normalizeLeadPayload({
    client_name: 'ACME INDIA', industry_type: 'Commercial', lead_source: 'Referral',
    site_location: 'Guindy', city: 'Chennai', state: 'Tamil Nadu', lead_priority: 'High',
    contacts: [{ name: 'Client', phone: '9876543210' }],
  });
  assert.equal(duplicateScore(candidate, candidateContacts, lead).isStrongDuplicate, true);
  assert.equal(duplicateScore({ ...candidate, site_location: 'OMR' }, candidateContacts, lead).isStrongDuplicate, false);
});
