String _text(Map<String, dynamic> row, List<String> keys) {
  for (final key in keys) {
    final value = '${row[key] ?? ''}'.trim();
    if (value.isNotEmpty && value != 'null') return value;
  }
  return '';
}

bool _boolValue(dynamic value, {bool fallback = true}) {
  if (value is bool) return value;
  if (value == null) return fallback;
  return '$value'.toLowerCase() == 'true';
}

class HospitalBlock {
  const HospitalBlock({
    required this.id,
    required this.name,
    this.clientId = '',
    this.code = '',
    this.verificationStatus = '',
    this.isActive = true,
  });

  final String id;
  final String clientId;
  final String code;
  final String name;
  final String verificationStatus;
  final bool isActive;

  factory HospitalBlock.fromJson(Map<String, dynamic> row) => HospitalBlock(
    id: _text(row, const ['id']),
    clientId: _text(row, const ['client_id', 'clientId']),
    code: _text(row, const ['block_code', 'code']),
    name: _text(row, const ['block_name', 'name']),
    verificationStatus: _text(row, const ['verification_status']),
    isActive: _boolValue(row['is_active']),
  );
}

class HospitalFloor {
  const HospitalFloor({
    required this.id,
    required this.blockId,
    required this.name,
    this.clientId = '',
    this.code = '',
    this.floorNumber,
    this.verificationStatus = '',
    this.isActive = true,
  });

  final String id;
  final String clientId;
  final String blockId;
  final String code;
  final String name;
  final int? floorNumber;
  final String verificationStatus;
  final bool isActive;

  factory HospitalFloor.fromJson(Map<String, dynamic> row) => HospitalFloor(
    id: _text(row, const ['id']),
    clientId: _text(row, const ['client_id', 'clientId']),
    blockId: _text(row, const ['block_id', 'blockId']),
    code: _text(row, const ['floor_code', 'code']),
    name: _text(row, const ['floor_name', 'name']),
    floorNumber: int.tryParse('${row['floor_number'] ?? ''}'),
    verificationStatus: _text(row, const ['verification_status']),
    isActive: _boolValue(row['is_active']),
  );
}

class HospitalDepartment {
  const HospitalDepartment({
    required this.id,
    required this.blockId,
    required this.name,
    this.clientId = '',
    this.floorId = '',
    this.code = '',
    this.departmentType = '',
    this.verificationStatus = '',
    this.isActive = true,
  });

  final String id;
  final String clientId;
  final String blockId;
  final String floorId;
  final String code;
  final String name;
  final String departmentType;
  final String verificationStatus;
  final bool isActive;

  bool get hasConfirmedFloor => floorId.isNotEmpty;

  factory HospitalDepartment.fromJson(Map<String, dynamic> row) =>
      HospitalDepartment(
        id: _text(row, const ['id']),
        clientId: _text(row, const ['client_id', 'clientId']),
        blockId: _text(row, const ['block_id', 'blockId']),
        floorId: _text(row, const ['floor_id', 'floorId']),
        code: _text(row, const ['department_code', 'code']),
        name: _text(row, const ['department_name', 'name']),
        departmentType: _text(row, const ['department_type']),
        verificationStatus: _text(row, const ['verification_status']),
        isActive: _boolValue(row['is_active']),
      );
}

class HospitalLocation {
  const HospitalLocation({
    required this.id,
    required this.blockId,
    required this.name,
    this.clientId = '',
    this.floorId = '',
    this.departmentId = '',
    this.code = '',
    this.floorName = '',
    this.departmentName = '',
    this.roomNumber = '',
    this.areaName = '',
    this.wardName = '',
    this.locationType = '',
    this.completeLocationPath = '',
    this.verificationStatus = '',
    this.isActive = true,
  });

  final String id;
  final String clientId;
  final String blockId;
  final String floorId;
  final String departmentId;
  final String code;
  final String name;
  final String floorName;
  final String departmentName;
  final String roomNumber;
  final String areaName;
  final String wardName;
  final String locationType;
  final String completeLocationPath;
  final String verificationStatus;
  final bool isActive;

  String get displayName {
    final parts = [
      wardName,
      roomNumber,
      areaName,
      name,
    ].where((value) => value.trim().isNotEmpty).toSet().toList();
    return parts.isEmpty ? name : parts.join(' / ');
  }

  factory HospitalLocation.fromJson(Map<String, dynamic> row) =>
      HospitalLocation(
        id: _text(row, const ['id']),
        clientId: _text(row, const ['client_id', 'clientId']),
        blockId: _text(row, const ['block_id', 'blockId']),
        floorId: _text(row, const ['floor_id', 'floorId']),
        departmentId: _text(row, const ['department_id', 'departmentId']),
        code: _text(row, const ['location_code', 'code']),
        name: _text(row, const ['location_name', 'name']),
        floorName: _text(row, const ['floor_name']),
        departmentName: _text(row, const ['department_name']),
        roomNumber: _text(row, const ['room_number']),
        areaName: _text(row, const ['area_name']),
        wardName: _text(row, const ['ward_name']),
        locationType: _text(row, const ['location_type']),
        completeLocationPath: _text(row, const ['complete_location_path']),
        verificationStatus: _text(row, const ['verification_status']),
        isActive: _boolValue(row['is_active']),
      );
}
