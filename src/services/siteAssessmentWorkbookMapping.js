import { SERVICE_SCOPE_OPTIONS, createV2Survey, flattenSurveyV2 } from './siteAssessmentV2.js';

export const WORKBOOK_SHEETS = ['Survey Report', 'MPD', 'Commercial Input'];

const clean = (value) => (value === undefined || value === null ? '' : String(value).trim());
const numberOrBlank = (value) => {
  if (value === '' || value === null || value === undefined) return '';
  const number = Number(value);
  return Number.isFinite(number) ? number : '';
};

export function yesNoNa(value, { applicable = true } = {}) {
  if (!applicable) return 'N/A';
  if (value === true || String(value).toLowerCase() === 'yes') return 'Yes';
  if (value === false || String(value).toLowerCase() === 'no') return 'No';
  return clean(value);
}

export function conditionalValue(parent, value) {
  if (parent === 'No') return 'N/A';
  return clean(value);
}

export function primaryContact(contacts = []) {
  return (Array.isArray(contacts) ? contacts : []).find((contact) => contact.isPrimary || contact.is_primary) || contacts?.[0] || {};
}

export function contactSummary(contacts = []) {
  return (Array.isArray(contacts) ? contacts : []).filter(Boolean).map((contact) => [
    contact.name || contact.contact_person_name,
    contact.designation || contact.contact_person_designation,
    contact.phone || contact.mobile || contact.contact_number,
    contact.email || contact.email_id,
  ].filter(Boolean).join(' - ')).filter(Boolean).join('\n');
}

export function normalizeExportInput({ assessment = {}, normalizedSurvey = {}, lead = {}, contacts = [], profile = {}, workflow = {}, proposal = null } = {}) {
  const sourceSurvey = normalizedSurvey || assessment?.survey || {};
  const survey = sourceSurvey.client_site
    ? flattenSurveyV2(sourceSurvey)
    : createV2Survey({ existing: sourceSurvey, visit: lead, user: profile });
  const client = survey.client_site || {};
  const facility = survey.facility_requirements || {};
  const resources = survey.equipment_manpower || {};
  const commercial = survey.commercial_inputs || {};
  const mergedContacts = contacts.length ? contacts : client.contacts || lead.contacts || [];
  return {
    assessment,
    survey,
    client,
    facility,
    resources,
    commercial,
    lead,
    contacts: mergedContacts,
    profile,
    workflow,
    proposal,
  };
}

export function surveyReportRows(input) {
  const { client, facility, commercial, contacts, profile } = input;
  const primary = primaryContact(contacts);
  const surveyor = client.surveyor || {};
  const externalWaste = yesNoNa(facility.external_waste_disposal_required);
  const waterBodies = yesNoNa(facility.water_bodies_present);
  const facade = yesNoNa(facility.facade_glass_present);
  const pest = yesNoNa(facility.pest_control_required);
  const specialized = yesNoNa(facility.specialized_cleaning_required);
  const retainStaff = yesNoNa(facility.retain_existing_staff);
  const specialPpe = yesNoNa(facility.special_ppe_required);
  const condition = (value, fallback = '') => value === undefined || value === null || value === '' ? fallback : yesNoNa(value);
  const pantryRequired = facility.pantry_service_required ?? (facility.number_of_pantries !== undefined && facility.number_of_pantries !== '' ? true : '');
  const verificationRequired = facility.medical_verification_required === true || facility.police_verification_required === true
    ? true
    : facility.medical_verification_required === false && facility.police_verification_required === false
      ? false
      : '';
  return {
    header: {
      date: client.survey_date || '',
      clientName: client.client_name || '',
      address: client.site_address || client.address || '',
      contact: [primary.name || primary.contact_person_name, primary.designation || primary.contact_person_designation].filter(Boolean).join(' / '),
      phone: [primary.phone || primary.mobile || primary.contact_number, primary.fax].filter(Boolean).join(' / '),
      surveyor: [
        surveyor.name || profile.full_name || profile.employee_code || profile.email || profile.id,
        surveyor.designation || profile.designation || profile.role,
        surveyor.phone || profile.phone,
      ].filter(Boolean).join(' / '),
      location: [client.site_location, client.managed_from].filter(Boolean).join(' / '),
      industry: client.industry || input.lead.industry || '',
      zone: client.zone || facility.zone || commercial.zone || '',
    },
    facility: [
      [14, client.client_working_timings, 'Mandatory'],
      [15, client.client_working_days, 'Mandatory'],
      [16, client.qpms_service_timings, 'Mandatory'],
      [17, numberOrBlank(client.built_up_area || client.floor_plate_area), 'Mandatory'],
      [18, [numberOrBlank(client.number_of_floors), numberOrBlank(client.per_floor_area)].filter((value) => value !== '').join(' / '), 'Mandatory'],
      [19, numberOrBlank(client.occupants_staff), 'Mandatory'],
      [20, yesNoNa(facility.waste_segregation_required), condition(facility.waste_segregation_required)],
      [21, facility.waste_disposal_type || '', condition(facility.waste_disposal_required, facility.waste_disposal_type ? 'Yes' : '')],
      [22, yesNoNa(facility.designated_disposal_area), condition(facility.designated_disposal_area)],
      [23, externalWaste === 'No' ? 'N/A' : [facility.external_disposal_frequency, numberOrBlank(facility.external_contractor_rate)].filter((value) => value !== '').join(' / ') || '', externalWaste],
      [24, [numberOrBlank(facility.number_of_pantries), numberOrBlank(facility.total_pantry_area)].filter((value) => value !== '').join(' / '), condition(pantryRequired)],
      [25, yesNoNa(facility.water_body_maintenance, { applicable: waterBodies !== 'No' }), waterBodies],
      [26, conditionalValue(waterBodies, facility.water_body_details), waterBodies],
      [27, facade === 'No' ? 'N/A' : [numberOrBlank(facility.facade_glass_area), facility.facade_cleaning_frequency].filter((value) => value !== '').join(' / ') || '', facade],
      [28, yesNoNa(facility.boom_lift_available, { applicable: facade !== 'No' }), facade],
      [29, pest === 'No' ? 'N/A' : [pest, facility.pest_control_service_type, facility.pest_control_frequency].filter(Boolean).join(' / '), pest],
      [30, specialized === 'No' ? 'N/A' : [facility.specialized_cleaning_services, facility.specialized_cleaning_frequency].filter(Boolean).join(' / '), specialized],
      [31, yesNoNa(facility.neighbouring_manpower_availability), condition(facility.neighbouring_manpower_availability)],
      [32, [yesNoNa(facility.staff_transportation_required), numberOrBlank(facility.estimated_transport_cost)].filter((value) => value !== '').join(' / '), condition(facility.staff_transportation_required)],
      [33, yesNoNa(facility.union_activity), condition(facility.union_activity)],
      [34, retainStaff === 'No' ? 'N/A' : [retainStaff, facility.existing_salary_structure].filter(Boolean).join(' / '), retainStaff],
      [35, yesNoNa(facility.national_festival_holiday_service ?? facility.nfh_service_required), condition(facility.national_festival_holiday_service ?? facility.nfh_service_required)],
      [36, yesNoNa(facility.nearby_recruitment_restrictions), condition(facility.nearby_recruitment_restrictions)],
      [37, specialPpe === 'No' ? 'N/A' : [specialPpe, facility.ppe_details].filter(Boolean).join(' / '), specialPpe],
      [38, [yesNoNa(facility.medical_verification_required), yesNoNa(facility.police_verification_required)].join(' / '), condition(verificationRequired)],
      [39, facility.wage_category || facility.minimum_wage_basis || commercial.minimum_wage_category || '', ''],
    ],
    scope: SERVICE_SCOPE_OPTIONS.filter((option) => (facility.service_scope || []).includes(option)).join(', '),
  };
}

function rowText(row) {
  return [row.description || row.name, row.brandCapacity || row.brand || row.capacity, row.ownership || row.scopeResponsibility, row.remarks].filter(Boolean).join(' - ');
}

export function equipmentRows(rows = []) {
  return (Array.isArray(rows) ? rows : []).map((row) => ({ description: rowText(row), quantity: numberOrBlank(row.quantity) }));
}

export function manpowerRows(rows = []) {
  return (Array.isArray(rows) ? rows : []).map((row) => ({
    location: clean(row.location || row.floor || row.area),
    designation: clean(row.designation || row.department),
    shift: clean(row.shiftName || row.shiftType),
    start: clean(row.startTime),
    end: clean(row.endTime),
    headCount: numberOrBlank(row.headCount ?? row.count),
    salary: numberOrBlank(row.monthlyTakeHomeSalary ?? row.salary),
    remarks: clean(row.remarks),
    reliever: clean(row.relieverRequired),
    ot: clean(row.otApplicable || row.otRequired),
  }));
}

export function mpdMatrix(rows = []) {
  const normalized = manpowerRows(rows).filter((row) => row.location || row.designation);
  const groups = [];
  const groupMap = new Map();
  normalized.forEach((row) => {
    const designation = row.designation || 'Unspecified';
    const shift = row.shift || 'Unspecified';
    if (!groupMap.has(designation)) groupMap.set(designation, []);
    if (!groupMap.get(designation).includes(shift)) groupMap.get(designation).push(shift);
  });
  for (const [designation, shifts] of groupMap) groups.push({ designation, shifts });
  const locations = [...new Set(normalized.map((row) => row.location || 'Unspecified'))];
  const values = locations.map((location) => {
    const rowsForLocation = normalized.filter((row) => row.location === location);
    const cells = {};
    rowsForLocation.forEach((row) => {
      const key = `${row.designation || 'Unspecified'}|||${row.shift || 'Unspecified'}`;
      cells[key] = (cells[key] || 0) + Number(row.headCount || 0);
    });
    return { location, cells, remarks: rowsForLocation.map((row) => row.remarks).filter(Boolean).join('; ') };
  });
  return { groups, locations, values, rows: normalized };
}

function summaryRows(input) {
  const { client, facility, resources, commercial } = input;
  const currentManpower = manpowerRows(resources.current_manpower);
  const suggestedManpower = manpowerRows(resources.suggested_manpower);
  const names = (rows) => rows.map((row) => `${row.designation || 'Unspecified'}: ${row.headCount || 0}`).join(', ') || 'N/A';
  return [
    [1, client.client_legal_name || client.client_name || ''],
    [2, contactSummary(input.contacts) || ''],
    [3, [facility.minimum_wage_basis, facility.wage_category, commercial.minimum_wage_category, commercial.zone].filter(Boolean).join(' / ') || ''],
    [4, commercial.existing_salary_payslip || 'Pending'],
    [5, [commercial.leave_wage, commercial.bonus, commercial.food_allowance, commercial.transport_allowance, commercial.accommodation_allowance, commercial.other_deductions].filter((value) => value !== undefined && value !== '').join(' / ') || ''],
    [6, facility.manpower_sourcing_area || ''],
    [7, client.client_working_days || ''],
    [8, [commercial.reliever_method, suggestedManpower.filter((row) => row.reliever === 'Yes').length ? 'Reliever flagged on suggested manpower' : ''].filter(Boolean).join(' / ') || ''],
    [9, [facility.national_festival_holiday_service ?? facility.nfh_service_required, commercial.nfh_costing].filter(Boolean).join(' / ') || ''],
    [10, commercial.esi_wci_selection || commercial.esi_wci || ''],
    [11, commercial.sez_status || ''],
    [12, [commercial.ot_payout_rule, suggestedManpower.filter((row) => row.ot === 'Yes').length ? 'OT flagged on suggested manpower' : ''].filter(Boolean).join(' / ') || ''],
    [13, [facility.special_ppe_required, facility.ppe_details, commercial.uniform_cost, commercial.additional_ppe_cost].filter(Boolean).join(' / ') || ''],
    [14, [facility.medical_verification_required, facility.police_verification_required, commercial.medical_verification_cost, commercial.police_verification_cost].filter(Boolean).join(' / ') || ''],
    [15, numberOrBlank(client.built_up_area)],
    [16, numberOrBlank(client.occupants_staff)],
    [17, numberOrBlank(client.floating_footfall)],
    [18, [...equipmentRows(resources.current_equipment), ...equipmentRows(resources.suggested_equipment)].map((row) => row.description).filter(Boolean).join('\n') || 'N/A'],
    [19, commercial.cleaning_materials_summary || commercial.cleaning_materials_cost || 'N/A'],
    [20, commercial.consumables_summary || commercial.consumables_cost || 'N/A'],
    [21, [facility.pest_control_required, facility.specialized_cleaning_services, commercial.sst_cost].filter(Boolean).join(' / ') || 'N/A'],
    [22, commercial.existing_vendor_details || ''],
    [23, [commercial.salary_payment_terms, commercial.invoice_payment_terms].filter(Boolean).join(' / ') || ''],
    [24, `${names(currentManpower)}${currentManpower.length ? `\nTotal: ${currentManpower.reduce((sum, row) => sum + Number(row.headCount || 0), 0)}` : ''}`],
    [25, [commercial.attendance_cycle_start, commercial.attendance_cycle_end].filter(Boolean).join(' to ') || ''],
  ];
}

export function commercialRows(input) { return summaryRows(input); }

export function safeWorkbookFilename({ clientName = '', assessmentId = '', date = '' } = {}) {
  const safe = (value) => String(value || '').replace(/[<>:"/\\|?*\x00-\x1F]/g, '').replace(/\s+/g, ' ').trim().slice(0, 60);
  const client = safe(clientName) || safe(assessmentId) || 'Assessment';
  const reference = safe(assessmentId).slice(0, 18);
  return `Survey_Report_${client}${reference ? `_${reference}` : ''}_${safe(date) || new Date().toISOString().slice(0, 10)}.xlsx`;
}
