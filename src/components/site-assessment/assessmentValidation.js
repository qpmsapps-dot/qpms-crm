export function validateAssessmentSection(section, survey = {}, { role = '', isSubmission = false } = {}) {
  const errors = [];
  const client = survey.client_site || {};
  const facility = survey.facility_requirements || {};
  const equipment = survey.equipment_manpower || {};
  const commercial = survey.commercial_inputs || {};

  if (section === 'Client & Site') {
    if (!client.survey_date) errors.push('Survey date is required.');
    if (!client.client_name) errors.push('Client name is required.');
    if (!client.site_address && !client.address) errors.push('Site address is required.');
    if (!client.industry) errors.push('Industry / nature of business is required.');
    if (!client.primary_contact?.name && !client.contacts?.[0]?.name) errors.push('Primary contact is required.');
    if (!client.client_working_days) errors.push('Client working days are required.');
    if (!client.client_working_timings) errors.push('Client working timings are required.');
    if (!client.built_up_area) errors.push('Built-up area is required.');
    if (!client.occupants_staff) errors.push('Occupants / staff is required.');
  }

  if (section === 'Facility & Service Requirements') {
    const conditional = [
      ['external_waste_disposal_required', 'external_disposal_frequency', 'External disposal frequency is required.'],
      ['external_waste_disposal_required', 'external_contractor_rate', 'External contractor rate is required.'],
      ['water_bodies_present', 'water_body_details', 'Water-body details are required.'],
      ['facade_glass_present', 'facade_glass_area', 'Façade glass area is required.'],
      ['facade_glass_present', 'facade_cleaning_frequency', 'Façade cleaning frequency is required.'],
      ['pest_control_required', 'pest_control_service_type', 'Pest-control service type is required.'],
      ['pest_control_required', 'pest_control_frequency', 'Pest-control frequency is required.'],
      ['specialized_cleaning_required', 'specialized_cleaning_frequency', 'Specialized-cleaning frequency is required.'],
      ['retain_existing_staff', 'existing_salary_structure', 'Existing salary structure details are required.'],
      ['special_ppe_required', 'ppe_details', 'PPE details are required.'],
    ];
    for (const [condition, field, message] of conditional) {
      if (facility[condition] === 'Yes' && !facility[field]) errors.push(message);
    }
  }

  if (section === 'Equipment, Manpower & MPD') {
    for (const row of [...(equipment.current_equipment || []), ...(equipment.suggested_equipment || [])]) {
      if (Number(row.quantity || 0) < 0) errors.push('Equipment quantities cannot be negative.');
    }
    for (const row of [...(equipment.current_manpower || []), ...(equipment.suggested_manpower || [])]) {
      if (row.designation && Number(row.headCount ?? row.count ?? 0) <= 0) errors.push('Manpower head count must be greater than zero.');
      if (row.startTime && row.endTime && row.startTime >= row.endTime) errors.push('Manpower shift end time must be after start time.');
      if (Number(row.monthlyTakeHomeSalary ?? row.salary ?? 0) < 0) errors.push('Manpower salary cannot be negative.');
    }
    const suggested = equipment.suggested_manpower || [];
    if (isSubmission && !suggested.length && equipment.no_manpower_required !== true) {
      errors.push('Add at least one suggested manpower row or select No manpower required.');
    }
  }

  if (section === 'Commercial Inputs & Review' && ['Commercial', 'Finance', 'Admin', 'COO', 'GM', 'MD'].includes(role)) {
    if (isSubmission && commercial.requires_review && !commercial.payment_terms) errors.push('Payment terms are required for commercial review.');
  }

  return errors;
}

export function validateAllAssessmentSections(survey, options = {}) {
  return ['Client & Site', 'Facility & Service Requirements', 'Equipment, Manpower & MPD', 'Commercial Inputs & Review']
    .flatMap((section) => validateAssessmentSection(section, survey, options).map((message) => ({ section, message })));
}
