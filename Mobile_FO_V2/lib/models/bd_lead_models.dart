class BdLeadContact {
  const BdLeadContact({
    this.name = '',
    this.designation = '',
    this.phone = '',
    this.email = '',
  });

  final String name;
  final String designation;
  final String phone;
  final String email;

  factory BdLeadContact.fromJson(Map<String, dynamic> json) => BdLeadContact(
    name: _text(json['contact_person_name'] ?? json['name']),
    designation: _text(
      json['contact_person_designation'] ?? json['designation'],
    ),
    phone: _text(json['contact_number'] ?? json['phone']),
    email: _text(json['email_id'] ?? json['email']),
  );
}

class BdLead {
  const BdLead({
    required this.id,
    required this.clientName,
    this.industryType = '',
    this.leadSource = '',
    this.siteLocation = '',
    this.state = '',
    this.city = '',
    this.leadPriority = '',
    this.serviceScope = const [],
    this.remarks = '',
    this.assignedBdExecutive = '',
    this.assignedBdEmail = '',
    this.createdByUserId = '',
    this.createdByName = '',
    this.leadStage = '',
    this.status = '',
    this.createdAt,
    this.updatedAt,
    this.primaryContact,
    this.nextFollowUpDate,
    this.latestMomSummary = '',
    this.activityLogs = const [],
  });

  final String id;
  final String clientName;
  final String industryType;
  final String leadSource;
  final String siteLocation;
  final String state;
  final String city;
  final String leadPriority;
  final List<String> serviceScope;
  final String remarks;
  final String assignedBdExecutive;
  final String assignedBdEmail;
  final String createdByUserId;
  final String createdByName;
  final String leadStage;
  final String status;
  final DateTime? createdAt;
  final DateTime? updatedAt;
  final BdLeadContact? primaryContact;
  final String? nextFollowUpDate;
  final String latestMomSummary;
  final List<BdLeadActivity> activityLogs;

  factory BdLead.fromJson(Map<String, dynamic> json) => BdLead(
    id: _text(json['id']),
    clientName: _text(json['client_name']),
    industryType: _text(json['industry_type']),
    leadSource: _text(json['lead_source']),
    siteLocation: _text(json['site_location']),
    state: _text(json['state']),
    city: _text(json['city']),
    leadPriority: _text(json['lead_priority']),
    serviceScope: _stringList(json['service_scope']),
    remarks: _text(json['remarks']),
    assignedBdExecutive: _text(json['assigned_bd_executive']),
    assignedBdEmail: _text(json['assigned_bd_email']),
    createdByUserId: _text(json['created_by_user_id']),
    createdByName: _text(json['created_by_name']),
    leadStage: _text(json['lead_stage']),
    status: _text(json['status']),
    createdAt: DateTime.tryParse(_text(json['created_at'])),
    updatedAt: DateTime.tryParse(_text(json['updated_at'])),
    primaryContact: json['primary_contact'] is Map
        ? BdLeadContact.fromJson(
            Map<String, dynamic>.from(json['primary_contact'] as Map),
          )
        : null,
    nextFollowUpDate: _nullableText(json['next_followup_date']),
    latestMomSummary: _text(
      json['latest_mom'] is Map
          ? (json['latest_mom'] as Map)['discussion_summary']
          : json['latest_mom_summary'],
    ),
    activityLogs: json['activity_logs'] is List
        ? (json['activity_logs'] as List)
              .whereType<Map>()
              .map(
                (row) =>
                    BdLeadActivity.fromJson(Map<String, dynamic>.from(row)),
              )
              .toList()
        : const [],
  );
}

class BdLeadActivity {
  const BdLeadActivity({
    this.type = '',
    this.message = '',
    this.createdBy = '',
    this.createdAt,
  });

  final String type;
  final String message;
  final String createdBy;
  final DateTime? createdAt;

  factory BdLeadActivity.fromJson(Map<String, dynamic> json) => BdLeadActivity(
    type: _text(json['activity_type']),
    message: _text(json['activity_message']),
    createdBy: _text(json['created_by']),
    createdAt: DateTime.tryParse(_text(json['created_at'])),
  );
}

class CreateBdLeadRequest {
  const CreateBdLeadRequest({
    required this.clientName,
    required this.siteLocation,
    required this.state,
    required this.city,
    required this.contactPersonName,
    required this.contactNumber,
    required this.leadSource,
    required this.leadPriority,
    this.industryType = '',
    this.contactPersonDesignation = '',
    this.emailId = '',
    this.serviceScope = const [],
    this.remarks = '',
  });

  final String clientName;
  final String industryType;
  final String siteLocation;
  final String state;
  final String city;
  final String contactPersonName;
  final String contactPersonDesignation;
  final String contactNumber;
  final String emailId;
  final String leadSource;
  final String leadPriority;
  final List<String> serviceScope;
  final String remarks;

  Map<String, dynamic> toJson() => {
    'client_name': clientName,
    'industry_type': industryType,
    'site_location': siteLocation,
    'state': state,
    'city': city,
    'contact_person_name': contactPersonName,
    'contact_person_designation': contactPersonDesignation,
    'contact_number': contactNumber,
    'email_id': emailId,
    'lead_source': leadSource,
    'lead_priority': leadPriority,
    'service_scope': serviceScope,
    'remarks': remarks,
  };
}

String _text(Object? value) => value?.toString() ?? '';

String? _nullableText(Object? value) {
  final text = value?.toString().trim() ?? '';
  return text.isEmpty ? null : text;
}

List<String> _stringList(Object? value) {
  if (value is List) {
    return value
        .map((item) => item.toString())
        .where((item) => item.isNotEmpty)
        .toList();
  }
  return const [];
}
