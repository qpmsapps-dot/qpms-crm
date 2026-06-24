const mobileRegistrationRoles = <String>{
  'FO',
  'KAM',
  'Operations Manager',
  'Branch Head',
  'GM',
  'BD Executive',
  'BD Head',
};

const mobileLoginRoles = <String>{
  ...mobileRegistrationRoles,
  'Manager',
  // Preserve profiles created before registration standardized on FO.
  'Field Officer',
};

String deriveMobileRole(String department, String designation) {
  final cleanDepartment = department.trim();
  final cleanDesignation = designation.trim();
  const roleByDesignation = <String, String>{
    'Field Officer': 'FO',
    'Key Account Manager': 'KAM',
    'Operations Manager': 'Operations Manager',
    'Branch Head': 'Branch Head',
    'GM': 'GM',
    'BD Executive': 'BD Executive',
    'BD Head': 'BD Head',
  };
  const departmentByDesignation = <String, String>{
    'Field Officer': 'Operations',
    'Key Account Manager': 'Operations',
    'Operations Manager': 'Operations',
    'Branch Head': 'Operations',
    'GM': 'Operations',
    'BD Executive': 'Business Development',
    'BD Head': 'Business Development',
  };

  final role = roleByDesignation[cleanDesignation];
  final expectedDepartment = departmentByDesignation[cleanDesignation];
  if (role == null || expectedDepartment != cleanDepartment) {
    throw StateError(
      'Unsupported mobile department/designation combination: '
      '$cleanDepartment / $cleanDesignation',
    );
  }
  return role;
}

String resolveMobileRole({
  String? role,
  String? department,
  String? designation,
}) {
  final cleanRole = role?.trim() ?? '';
  if (cleanRole.isNotEmpty) return cleanRole;

  final cleanDepartment = department?.trim() ?? '';
  final cleanDesignation = designation?.trim() ?? '';
  if (cleanDesignation.isNotEmpty) {
    return deriveMobileRole(cleanDepartment, cleanDesignation);
  }

  // Legacy FO profiles may predate department/designation fields entirely.
  if (cleanDepartment.isEmpty) return 'FO';
  throw StateError('Mobile profile role and designation are missing.');
}

String _normalizedMobileRole(String role) =>
    role.trim().replaceAll(RegExp(r'[\s_]+'), '').toUpperCase();

bool isMobileLoginRole(String role) {
  final normalizedRole = _normalizedMobileRole(role);
  return mobileLoginRoles.any(
    (allowedRole) => _normalizedMobileRole(allowedRole) == normalizedRole,
  );
}
