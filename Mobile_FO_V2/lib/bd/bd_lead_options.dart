const bdIndustryOptions = [
  'Manufacturing',
  'Educational',
  'Retail',
  'Commercial',
  'Electronics',
  'Hospital',
];

const bdLeadSourceOptions = [
  'LinkedIn',
  'Website',
  'Campaign',
  'Referral',
  'Direct Visit',
  'Email',
  'Phone Enquiry',
];

const bdPriorityOptions = ['High', 'Medium', 'Low'];

const bdStateOptions = [
  'Tamil Nadu',
  'Kerala',
  'Karnataka',
  'Telangana',
  'Andhra Pradesh - 1',
  'Andhra Pradesh - 2',
];

const bdServiceScopeOptions = [
  'Soft Services',
  'Hard Services',
  'Security Services',
  'Pest Control Services',
  'Landscaping Services',
  'Waste Management',
  'Other Services',
];

String? validateBdIndustry(String? value) {
  if (value == null || value.trim().isEmpty) {
    return 'Please select an Industry';
  }
  return null;
}

List<String> orderedBdServiceScope(Iterable<String> selected) {
  final values = selected.toSet();
  return bdServiceScopeOptions.where(values.contains).toList();
}

const bdStatusOptions = [
  'Active',
  'Pending',
  'Escalated',
  'MOM Sent',
  'Lost',
  'Archived',
];

const bdStageOptions = [
  'New Lead',
  'Lead MOM Sent',
  'Site Visit Scheduled',
  'Pending Review',
  'Ready for Proposal',
  'Lost',
];
