export const SURVEY_SCHEMA_VERSION_V1 = 1;
export const SURVEY_SCHEMA_VERSION_V2 = 2;

export const SURVEY_SECTION_KEYS = [
  'client_site',
  'facility_requirements',
  'equipment_manpower',
  'commercial_inputs',
];

export const SURVEY_SECTION_LABELS = [
  'Client & Site',
  'Facility & Service Requirements',
  'Equipment, Manpower & MPD',
  'Commercial Inputs & Review',
];

export const SERVICE_SCOPE_OPTIONS = [
  'Soft Services',
  'Hard Services',
  'Security Services',
  'Pest Control Services',
  'Landscaping Services',
  'Waste Management',
  'Other Services',
];

const todayLocal = () => {
  const now = new Date();
  const offset = now.getTimezoneOffset() * 60000;
  return new Date(now.getTime() - offset).toISOString().slice(0, 10);
};

const asText = (value) => (value === undefined || value === null ? '' : String(value));
const asArray = (value) => (Array.isArray(value) ? value : []);

const emptyEquipment = () => ({
  id: `equipment-${Date.now()}-${Math.random().toString(16).slice(2)}`,
  description: '',
  name: '',
  quantity: 0,
  brandCapacity: '',
  brand: '',
  capacity: '',
  ownership: '',
  scopeResponsibility: '',
  remarks: '',
});

const emptyManpower = () => ({
  id: `manpower-${Date.now()}-${Math.random().toString(16).slice(2)}`,
  location: '',
  department: '',
  designation: '',
  shiftName: '',
  shiftType: '',
  startTime: '',
  endTime: '',
  headCount: 0,
  count: 0,
  monthlyTakeHomeSalary: 0,
  salary: 0,
  genderRequirement: '',
  gender: '',
  relieverRequired: 'No',
  otApplicable: 'No',
  wageCategory: '',
  remarks: '',
});

function legacyValue(existing, keys, fallback = '') {
  for (const key of keys) {
    if (existing?.[key] !== undefined && existing?.[key] !== null && existing[key] !== '') return existing[key];
  }
  return fallback;
}

function contactsFromVisit(visit) {
  return asArray(visit?.contacts).map((contact) => ({
    name: contact.name || contact.contact_person_name || '',
    designation: contact.designation || contact.contact_person_designation || '',
    phone: contact.phone || contact.contact_number || '',
    mobile: contact.mobile || contact.contact_number || contact.phone || '',
    fax: contact.fax || '',
    email: contact.email || contact.email_id || '',
    isPrimary: Boolean(contact.isPrimary ?? contact.is_primary),
  }));
}

function mapLegacyEquipment(rows = []) {
  return asArray(rows).map((row) => ({
    ...emptyEquipment(),
    ...row,
    description: row.description || row.name || '',
    name: row.name || row.description || '',
    quantity: Number(row.quantity || 0),
  }));
}

function mapLegacyManpower(rows = []) {
  return asArray(rows).map((row) => ({
    ...emptyManpower(),
    ...row,
    location: row.location || row.floor || row.area || '',
    headCount: Number(row.headCount ?? row.count ?? 0),
    count: Number(row.count ?? row.headCount ?? 0),
    monthlyTakeHomeSalary: Number(row.monthlyTakeHomeSalary ?? row.salary ?? 0),
    salary: Number(row.salary ?? row.monthlyTakeHomeSalary ?? 0),
    shiftName: row.shiftName || row.shiftType || '',
  }));
}

export function flattenSurveyV2(survey = {}) {
  const client = survey.client_site || {};
  const facility = survey.facility_requirements || {};
  const equipment = survey.equipment_manpower || {};
  const commercial = survey.commercial_inputs || {};
  const suggestedManpower = asArray(equipment.suggested_manpower);
  const suggestedEquipment = asArray(equipment.suggested_equipment);
  const serviceScope = asArray(facility.service_scope);
  const manpowerPlan = suggestedManpower.map((row) => ({
    ...row,
    department: row.department || row.location || '',
    designation: row.designation || '',
    shiftType: row.shiftName || row.shiftType || '',
    count: Number(row.headCount ?? row.count ?? 0),
    relieverRequired: row.relieverRequired || 'No',
    otRequired: row.otApplicable || 'No',
    wageCategory: row.wageCategory || '',
  }));
  const equipmentRows = suggestedEquipment.map((row) => ({
    ...row,
    name: row.name || row.description || '',
    quantity: Number(row.quantity || 0),
  }));

  return {
    ...survey,
    schema_version: survey.schema_version || SURVEY_SCHEMA_VERSION_V2,
    siteAddress: client.site_address || client.address || '',
    siteType: client.industry || '',
    operatingHours: client.client_working_timings || '',
    clientOccupancy: client.occupants_staff || '',
    siteSurveyDate: client.survey_date || '',
    assessedBy: client.surveyor?.name || '',
    siteContactPerson: client.primary_contact?.name || client.contacts?.[0]?.name || '',
    contactNumber: client.primary_contact?.phone || client.contacts?.[0]?.phone || '',
    contactEmail: client.primary_contact?.email || client.contacts?.[0]?.email || '',
    totalSiteArea: client.built_up_area || '',
    ifmScope: serviceScope,
    manpowerPlan,
    equipment: equipmentRows,
    commercial: {
      billingComponents: asArray(commercial.billing_components),
      expenseComponents: asArray(commercial.expense_components),
      ...commercial,
    },
    finalRemarks: commercial.other_commercial_remarks || survey.finalRemarks || '',
  };
}

export function createV2Survey({ visit = {}, user = {}, existing = null } = {}) {
  const legacy = existing?.schema_version === SURVEY_SCHEMA_VERSION_V1
    ? { ...existing.legacy, ...existing }
    : { ...(existing?.legacy || {}) };
  const existingClient = existing?.client_site || {};
  const existingFacility = existing?.facility_requirements || {};
  const existingEquipment = existing?.equipment_manpower || {};
  const existingCommercial = existing?.commercial_inputs || {};
  const contacts = asArray(existingClient.contacts).length
    ? existingClient.contacts
    : contactsFromVisit(visit);
  const primaryContact = contacts.find((contact) => contact.isPrimary) || contacts[0] || {};
  const existingSuggestedEquipment = asArray(existingEquipment.suggested_equipment).length
    ? mapLegacyEquipment(existingEquipment.suggested_equipment)
    : mapLegacyEquipment(existing?.equipment || []);
  const existingSuggestedManpower = asArray(existingEquipment.suggested_manpower).length
    ? mapLegacyManpower(existingEquipment.suggested_manpower)
    : mapLegacyManpower(existing?.manpowerPlan || []);
  const schemaVersion = existing?.schema_version === SURVEY_SCHEMA_VERSION_V1
    ? SURVEY_SCHEMA_VERSION_V1
    : SURVEY_SCHEMA_VERSION_V2;
  const survey = {
    schema_version: schemaVersion,
    client_site: {
      survey_date: legacyValue(existingClient, ['survey_date'], legacyValue(existing, ['siteSurveyDate'], todayLocal())),
      client_name: legacyValue(existingClient, ['client_name'], visit.company || ''),
      client_legal_name: legacyValue(existingClient, ['client_legal_name'], visit.company || ''),
      address: legacyValue(existingClient, ['address'], legacyValue(existing, ['siteAddress'], visit.location || '')),
      site_address: legacyValue(existingClient, ['site_address'], legacyValue(existing, ['siteAddress'], visit.location || '')),
      site_location: legacyValue(existingClient, ['site_location'], visit.location || ''),
      managed_from: legacyValue(existingClient, ['managed_from'], visit.location || ''),
      state: legacyValue(existingClient, ['state'], visit.state || ''),
      city: legacyValue(existingClient, ['city'], visit.city || ''),
      zone: legacyValue(existingClient, ['zone'], existing?.applicableZone || ''),
      industry: legacyValue(existingClient, ['industry'], visit.industry || existing?.siteType || ''),
      contacts,
      primary_contact: primaryContact,
      surveyor: {
        name: legacyValue(existingClient.surveyor, ['name'], user.name || user.full_name || user.email || ''),
        designation: legacyValue(existingClient.surveyor, ['designation'], user.designation || user.role || ''),
        phone: legacyValue(existingClient.surveyor, ['phone'], user.phone || ''),
        employee_code: legacyValue(existingClient.surveyor, ['employee_code'], user.employee_code || ''),
      },
      client_working_timings: legacyValue(existingClient, ['client_working_timings'], existing?.operatingHours || ''),
      client_working_days: legacyValue(existingClient, ['client_working_days'], ''),
      qpms_service_timings: legacyValue(existingClient, ['qpms_service_timings'], ''),
      built_up_area: legacyValue(existingClient, ['built_up_area'], existing?.totalSiteArea || ''),
      floor_plate_area: legacyValue(existingClient, ['floor_plate_area'], ''),
      number_of_floors: legacyValue(existingClient, ['number_of_floors'], ''),
      per_floor_area: legacyValue(existingClient, ['per_floor_area'], ''),
      occupants_staff: legacyValue(existingClient, ['occupants_staff'], existing?.clientOccupancy || ''),
      floating_footfall: legacyValue(existingClient, ['floating_footfall'], ''),
      ...existingClient,
    },
    facility_requirements: {
      service_scope: asArray(existingFacility.service_scope).length
        ? existingFacility.service_scope
        : (Array.isArray(existing?.ifmScope) ? existing.ifmScope : asArray(visit.serviceScope)),
      other_services_description: existingFacility.other_services_description || '',
      ...existingFacility,
    },
    equipment_manpower: {
      current_equipment: mapLegacyEquipment(existingEquipment.current_equipment || existing?.currentEquipment || []),
      suggested_equipment: existingSuggestedEquipment,
      current_manpower: mapLegacyManpower(existingEquipment.current_manpower || existing?.currentManpower || []),
      suggested_manpower: existingSuggestedManpower,
      ...existingEquipment,
    },
    commercial_inputs: {
      minimum_wage_category: existingCommercial.minimum_wage_category || existing?.minimumWagesType || '',
      zone: existingCommercial.zone || existing?.applicableZone || '',
      billing_components: existingCommercial.billing_components || existing?.commercial?.billingComponents || [],
      expense_components: existingCommercial.expense_components || existing?.commercial?.expenseComponents || [],
      ...existingCommercial,
    },
    legacy,
  };
  return flattenSurveyV2(survey);
}

export function updateV2Survey(survey, section, field, value) {
  const next = {
    ...survey,
    [section]: {
      ...(survey?.[section] || {}),
      [field]: value,
    },
  };
  return flattenSurveyV2(next);
}

export function surveyToV2Envelope(survey = {}) {
  return {
    schema_version: SURVEY_SCHEMA_VERSION_V2,
    client_site: survey.client_site || {},
    facility_requirements: survey.facility_requirements || {},
    equipment_manpower: survey.equipment_manpower || {},
    commercial_inputs: survey.commercial_inputs || {},
    legacy: survey.legacy || {},
  };
}

export function orderedScope(values = []) {
  const selected = new Set(asArray(values));
  return SERVICE_SCOPE_OPTIONS.filter((option) => selected.has(option));
}

export { emptyEquipment, emptyManpower };
