function objectOrEmpty(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
}

function valueOrFallback(value, fallback) {
  return value === undefined || value === null ? fallback : value;
}

function sectionOrSnapshot(section, snapshotValue, fallback) {
  const normalized = objectOrEmpty(section);
  if (Object.keys(normalized).length) return normalized;
  return valueOrFallback(snapshotValue, fallback);
}

function surveySnapshot(survey) {
  return Object.fromEntries(
    Object.entries(objectOrEmpty(survey)).filter(([key]) => !key.startsWith('__')),
  );
}

export function surveyToDbAssessment(survey, visit, status = 'Draft', user) {
  const normalizedSurvey = objectOrEmpty(survey);
  const monthlyBilling = Number(
    normalizedSurvey.commercial?.billingComponents?.reduce(
      (sum, item) => sum + Number(item.amount || 0),
      0,
    ) || 0,
  );

  return {
    site_visit_id: visit.id,
    lead_id: visit.leadId,
    basic_site_information: {
      site_address: normalizedSurvey.siteAddress,
      site_type: normalizedSurvey.siteType,
      operating_hours: normalizedSurvey.operatingHours,
      client_occupancy: normalizedSurvey.clientOccupancy,
      building_age: normalizedSurvey.buildingAge,
      takeover_complexity: normalizedSurvey.takeoverComplexity,
      site_survey_date: normalizedSurvey.siteSurveyDate,
      assessed_by: normalizedSurvey.assessedBy,
      site_contact_person: normalizedSurvey.siteContactPerson,
      contact_number: normalizedSurvey.contactNumber,
      contact_email: normalizedSurvey.contactEmail,
      total_site_area: normalizedSurvey.totalSiteArea,
      contract_period: normalizedSurvey.contractPeriod,
      margin_agreed: normalizedSurvey.marginAgreed,
      margin_type: normalizedSurvey.marginType,
      payment_terms: normalizedSurvey.paymentTerms,
      group_or_sister_concern_business: normalizedSurvey.groupOrSisterConcernBusiness,
      is_24_7_operation: normalizedSurvey.is247Operation,
    },
    ifm_service_scope: normalizedSurvey.ifmScope || {},
    hard_services: normalizedSurvey.hardServices || {},
    soft_services: normalizedSurvey.softServices || {},
    landscaping_pest_control: normalizedSurvey.landscaping || {},
    hse_compliance: normalizedSurvey.hseCompliance || [],
    manpower_requirement: {
      rows: normalizedSurvey.manpowerPlan || [],
      minimum_wages_type: normalizedSurvey.minimumWagesType,
      applicable_zone: normalizedSurvey.applicableZone,
      wage_computation_notes: normalizedSurvey.wageComputationNotes,
      reliever_cost_required: normalizedSurvey.relieverCostRequired,
      budgeted_take_home_feasibility: normalizedSurvey.budgetedTakeHomeFeasibility,
      local_workforce_availability: normalizedSurvey.localWorkforceAvailability,
      transportation_impact: normalizedSurvey.transportationImpact,
      bonus_payment_type: normalizedSurvey.bonusPaymentType,
      leave_with_wages_days: normalizedSurvey.leaveWithWagesDays,
      nfh_applicable: normalizedSurvey.nfhApplicable,
      travel_accommodation_provided: normalizedSurvey.travelAccommodationProvided,
      allowances: normalizedSurvey.allowances || {},
    },
    tools_equipment_consumables: {
      equipment: normalizedSurvey.equipment || [],
      chemicals: normalizedSurvey.chemicals || [],
      tools: normalizedSurvey.tools || [],
      ppe_uniforms: normalizedSurvey.ppeUniforms || [],
      machinery: normalizedSurvey.machinery || [],
      consumables: normalizedSurvey.consumables,
      rental_machinery: normalizedSurvey.rentalMachinery,
      non_billable_expenses: normalizedSurvey.nonBillableExpenses,
      uniforms_shoes_accessories: normalizedSurvey.uniformsShoesAccessories,
    },
    client_kyc: normalizedSurvey.clientKyc || {},
    risk_assessment: {
      rows: normalizedSurvey.risks || [],
      client_credit_rating: normalizedSurvey.clientCreditRating,
      market_assessment: normalizedSurvey.marketAssessment,
      good_paymaster: normalizedSurvey.goodPaymaster,
      existing_vendor_change_reason: normalizedSurvey.existingVendorChangeReason,
      mitigation_plan: normalizedSurvey.mitigationPlan,
      remarks: normalizedSurvey.riskRemarks,
    },
    penalty_clauses: normalizedSurvey.penaltyClauses || {},
    commercial_statement: {
      ...(normalizedSurvey.commercial || {}),
      estimated_monthly_billing: monthlyBilling,
      approval_rules: {
        coo_approval_required: monthlyBilling > 500000,
        cfo_approval_required: monthlyBilling > 500000,
        cmd_counter_approval_required: monthlyBilling > 2500000,
      },
    },
    approval_mechanism: {
      approvalWorkflow: normalizedSurvey.approvalWorkflow,
      operationsTeamApproval: normalizedSurvey.operationsTeamApproval,
      hrWageVetting: normalizedSurvey.hrWageVetting,
      procurementEquipmentTccCosting: normalizedSurvey.procurementEquipmentTccCosting,
      commercialVetting: normalizedSurvey.commercialVetting,
      financeViabilityReview: normalizedSurvey.financeViabilityReview,
      commercialGreenSignal: normalizedSurvey.commercialGreenSignal,
      coo_approval_required: monthlyBilling > 500000,
      cfo_approval_required: monthlyBilling > 500000,
      cmd_counter_approval_required: monthlyBilling > 2500000,
    },
    final_remarks_signoff: {
      finalRemarks: normalizedSurvey.finalRemarks,
      signOffName: normalizedSurvey.signOffName,
      project_remarks: normalizedSurvey.projectRemarks,
      site_survey_done_by: normalizedSurvey.siteSurveyDoneBy,
      signature_placeholder: normalizedSurvey.signaturePlaceholder,
    },
    assessment_status: status,
    final_remarks: normalizedSurvey.finalRemarks || '',
    created_by: user?.email || visit.assigned_bd_email || '',
    metadata: {
      ...objectOrEmpty(visit.assessmentMetadata),
      survey_schema_version: 1,
      survey_state_v1: surveySnapshot(normalizedSurvey),
    },
    updated_at: new Date().toISOString(),
  };
}

export function dbAssessmentToSurvey(row = {}) {
  const snapshot = objectOrEmpty(row.metadata?.survey_state_v1);
  const basic = objectOrEmpty(row.basic_site_information);
  const manpower = objectOrEmpty(row.manpower_requirement);
  const resources = objectOrEmpty(row.tools_equipment_consumables);
  const risk = objectOrEmpty(row.risk_assessment);
  const approval = objectOrEmpty(row.approval_mechanism);
  const signoff = objectOrEmpty(row.final_remarks_signoff);

  return {
    ...snapshot,
    siteAddress: valueOrFallback(basic.site_address, snapshot.siteAddress || ''),
    siteType: valueOrFallback(basic.site_type, snapshot.siteType || ''),
    operatingHours: valueOrFallback(basic.operating_hours, snapshot.operatingHours || ''),
    clientOccupancy: valueOrFallback(basic.client_occupancy, snapshot.clientOccupancy || ''),
    buildingAge: valueOrFallback(basic.building_age, snapshot.buildingAge || ''),
    takeoverComplexity: valueOrFallback(
      basic.takeover_complexity,
      snapshot.takeoverComplexity || 'Medium',
    ),
    siteSurveyDate: valueOrFallback(basic.site_survey_date, snapshot.siteSurveyDate || ''),
    assessedBy: valueOrFallback(basic.assessed_by, snapshot.assessedBy || ''),
    siteContactPerson: valueOrFallback(
      basic.site_contact_person,
      snapshot.siteContactPerson || '',
    ),
    contactNumber: valueOrFallback(basic.contact_number, snapshot.contactNumber || ''),
    contactEmail: valueOrFallback(basic.contact_email, snapshot.contactEmail || ''),
    totalSiteArea: valueOrFallback(basic.total_site_area, snapshot.totalSiteArea || ''),
    contractPeriod: valueOrFallback(basic.contract_period, snapshot.contractPeriod || ''),
    marginAgreed: valueOrFallback(basic.margin_agreed, snapshot.marginAgreed || ''),
    marginType: valueOrFallback(basic.margin_type, snapshot.marginType || 'Percentage'),
    paymentTerms: valueOrFallback(basic.payment_terms, snapshot.paymentTerms || ''),
    groupOrSisterConcernBusiness: valueOrFallback(
      basic.group_or_sister_concern_business,
      snapshot.groupOrSisterConcernBusiness || 'No',
    ),
    is247Operation: valueOrFallback(
      basic.is_24_7_operation,
      snapshot.is247Operation || 'No',
    ),
    ifmScope: sectionOrSnapshot(row.ifm_service_scope, snapshot.ifmScope, {}),
    hardServices: sectionOrSnapshot(row.hard_services, snapshot.hardServices, {}),
    softServices: sectionOrSnapshot(row.soft_services, snapshot.softServices, {}),
    landscaping: sectionOrSnapshot(
      row.landscaping_pest_control,
      snapshot.landscaping,
      {},
    ),
    hseCompliance: valueOrFallback(row.hse_compliance, snapshot.hseCompliance || []),
    manpowerPlan: valueOrFallback(manpower.rows, snapshot.manpowerPlan || []),
    minimumWagesType: valueOrFallback(
      manpower.minimum_wages_type,
      snapshot.minimumWagesType,
    ),
    applicableZone: valueOrFallback(manpower.applicable_zone, snapshot.applicableZone),
    wageComputationNotes: valueOrFallback(
      manpower.wage_computation_notes,
      snapshot.wageComputationNotes,
    ),
    relieverCostRequired: valueOrFallback(
      manpower.reliever_cost_required,
      snapshot.relieverCostRequired,
    ),
    budgetedTakeHomeFeasibility: valueOrFallback(
      manpower.budgeted_take_home_feasibility,
      snapshot.budgetedTakeHomeFeasibility,
    ),
    localWorkforceAvailability: valueOrFallback(
      manpower.local_workforce_availability,
      snapshot.localWorkforceAvailability,
    ),
    transportationImpact: valueOrFallback(
      manpower.transportation_impact,
      snapshot.transportationImpact,
    ),
    bonusPaymentType: valueOrFallback(
      manpower.bonus_payment_type,
      snapshot.bonusPaymentType,
    ),
    leaveWithWagesDays: valueOrFallback(
      manpower.leave_with_wages_days,
      snapshot.leaveWithWagesDays,
    ),
    nfhApplicable: valueOrFallback(manpower.nfh_applicable, snapshot.nfhApplicable),
    travelAccommodationProvided: valueOrFallback(
      manpower.travel_accommodation_provided,
      snapshot.travelAccommodationProvided,
    ),
    allowances: sectionOrSnapshot(manpower.allowances, snapshot.allowances, {}),
    equipment: valueOrFallback(resources.equipment, snapshot.equipment || []),
    chemicals: valueOrFallback(resources.chemicals, snapshot.chemicals || []),
    tools: valueOrFallback(resources.tools, snapshot.tools || []),
    ppeUniforms: valueOrFallback(resources.ppe_uniforms, snapshot.ppeUniforms || []),
    machinery: valueOrFallback(resources.machinery, snapshot.machinery || []),
    consumables: valueOrFallback(resources.consumables, snapshot.consumables),
    rentalMachinery: valueOrFallback(resources.rental_machinery, snapshot.rentalMachinery),
    nonBillableExpenses: valueOrFallback(
      resources.non_billable_expenses,
      snapshot.nonBillableExpenses,
    ),
    uniformsShoesAccessories: valueOrFallback(
      resources.uniforms_shoes_accessories,
      snapshot.uniformsShoesAccessories,
    ),
    clientKyc: sectionOrSnapshot(row.client_kyc, snapshot.clientKyc, {}),
    risks: valueOrFallback(risk.rows, snapshot.risks || []),
    clientCreditRating: valueOrFallback(
      risk.client_credit_rating,
      snapshot.clientCreditRating,
    ),
    marketAssessment: valueOrFallback(risk.market_assessment, snapshot.marketAssessment),
    goodPaymaster: valueOrFallback(risk.good_paymaster, snapshot.goodPaymaster),
    existingVendorChangeReason: valueOrFallback(
      risk.existing_vendor_change_reason,
      snapshot.existingVendorChangeReason,
    ),
    mitigationPlan: valueOrFallback(risk.mitigation_plan, snapshot.mitigationPlan),
    riskRemarks: valueOrFallback(risk.remarks, snapshot.riskRemarks),
    penaltyClauses: valueOrFallback(row.penalty_clauses, snapshot.penaltyClauses || {}),
    commercial: sectionOrSnapshot(row.commercial_statement, snapshot.commercial, {}),
    approvalWorkflow: valueOrFallback(
      approval.approvalWorkflow,
      snapshot.approvalWorkflow || '',
    ),
    operationsTeamApproval: valueOrFallback(
      approval.operationsTeamApproval,
      snapshot.operationsTeamApproval,
    ),
    hrWageVetting: valueOrFallback(approval.hrWageVetting, snapshot.hrWageVetting),
    procurementEquipmentTccCosting: valueOrFallback(
      approval.procurementEquipmentTccCosting,
      snapshot.procurementEquipmentTccCosting,
    ),
    commercialVetting: valueOrFallback(
      approval.commercialVetting,
      snapshot.commercialVetting,
    ),
    financeViabilityReview: valueOrFallback(
      approval.financeViabilityReview,
      snapshot.financeViabilityReview,
    ),
    commercialGreenSignal: valueOrFallback(
      approval.commercialGreenSignal,
      snapshot.commercialGreenSignal,
    ),
    finalRemarks: valueOrFallback(
      signoff.finalRemarks,
      valueOrFallback(row.final_remarks, snapshot.finalRemarks || ''),
    ),
    signOffName: valueOrFallback(signoff.signOffName, snapshot.signOffName || ''),
    projectRemarks: valueOrFallback(signoff.project_remarks, snapshot.projectRemarks),
    siteSurveyDoneBy: valueOrFallback(
      signoff.site_survey_done_by,
      snapshot.siteSurveyDoneBy,
    ),
    signaturePlaceholder: valueOrFallback(
      signoff.signature_placeholder,
      snapshot.signaturePlaceholder,
    ),
  };
}
