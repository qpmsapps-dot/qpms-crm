DateTime? _date(dynamic value) =>
    value == null ? null : DateTime.tryParse('$value');

class TrainingAttendee {
  const TrainingAttendee({
    required this.id,
    required this.trainingSessionId,
    this.profileId,
    required this.employeeCode,
    required this.employeeName,
    this.designationSnapshot,
    this.createdAt,
  });
  final String id;
  final String trainingSessionId;
  final String? profileId;
  final String employeeCode;
  final String employeeName;
  final String? designationSnapshot;
  final DateTime? createdAt;
  factory TrainingAttendee.fromJson(Map<String, dynamic> json) =>
      TrainingAttendee(
        id: '${json['id'] ?? ''}',
        trainingSessionId: '${json['training_session_id'] ?? ''}',
        profileId: json['profile_id'] as String?,
        employeeCode: '${json['employee_code'] ?? ''}',
        employeeName: '${json['employee_name'] ?? ''}',
        designationSnapshot: json['designation_snapshot'] as String?,
        createdAt: _date(json['created_at']),
      );
  Map<String, dynamic> toJson() => {
    'id': id,
    'training_session_id': trainingSessionId,
    'profile_id': profileId,
    'employee_code': employeeCode,
    'employee_name': employeeName,
    'designation_snapshot': designationSnapshot,
    'created_at': createdAt?.toIso8601String(),
  };
}

class TrainingStaffSuggestion {
  const TrainingStaffSuggestion({
    required this.profileId,
    required this.employeeCode,
    required this.name,
    this.designation,
    this.role,
  });
  final String profileId;
  final String employeeCode;
  final String name;
  final String? designation;
  final String? role;
  factory TrainingStaffSuggestion.fromJson(Map<String, dynamic> json) =>
      TrainingStaffSuggestion(
        profileId: '${json['profile_id'] ?? ''}',
        employeeCode: '${json['employee_code'] ?? ''}',
        name: '${json['name'] ?? ''}',
        designation: json['designation'] as String?,
        role: json['role'] as String?,
      );
}
