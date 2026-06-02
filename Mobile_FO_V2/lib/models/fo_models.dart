class FoUser {
  const FoUser({
    required this.authUserId,
    required this.employeeCode,
    required this.fullName,
    required this.mobile,
    required this.email,
    required this.state,
    this.role = 'FO',
  });

  final String authUserId;
  final String employeeCode;
  final String fullName;
  final String mobile;
  final String email;
  final String state;
  final String role;

  Map<String, dynamic> toJson() => {
    'auth_user_id': authUserId,
    'employee_code': employeeCode,
    'full_name': fullName,
    'mobile': mobile,
    'email': email,
    'state': state,
    'role': role,
  };

  factory FoUser.fromJson(Map<String, dynamic> json) => FoUser(
    authUserId: _text(json['auth_user_id'] ?? json['id']),
    employeeCode: _text(json['employee_code'] ?? json['username']),
    fullName: _text(json['full_name'] ?? json['display_name']),
    mobile: _text(json['mobile']),
    email: _text(json['email']),
    state: _text(json['state']),
    role: _text(json['role']).isEmpty ? 'FO' : _text(json['role']),
  );
}

class Attendance {
  Attendance({
    required this.id,
    required this.employeeCode,
    required this.startTime,
    this.remoteId,
    this.endTime,
    this.startLat,
    this.startLng,
    this.endLat,
    this.endLng,
    this.batteryStart,
    this.batteryEnd,
    this.actualKm = 0,
    this.eligibleKm = 0,
  });

  final String id;
  String? remoteId;
  final String employeeCode;
  final DateTime startTime;
  DateTime? endTime;
  double? startLat;
  double? startLng;
  double? endLat;
  double? endLng;
  int? batteryStart;
  int? batteryEnd;
  double actualKm;
  double eligibleKm;

  bool get isActive => endTime == null;

  Map<String, dynamic> toJson() => {
    'id': id,
    'remote_id': remoteId,
    'employee_code': employeeCode,
    'start_time': startTime.toIso8601String(),
    'end_time': endTime?.toIso8601String(),
    'start_lat': startLat,
    'start_lng': startLng,
    'end_lat': endLat,
    'end_lng': endLng,
    'battery_start': batteryStart,
    'battery_end': batteryEnd,
    'actual_km': actualKm,
    'eligible_km': eligibleKm,
  };

  factory Attendance.fromJson(Map<String, dynamic> json) => Attendance(
    id: _text(json['id']),
    remoteId: _nullableText(json['remote_id']),
    employeeCode: _text(json['employee_code']),
    startTime: _date(json['start_time']) ?? DateTime.now(),
    endTime: _date(json['end_time']),
    startLat: _double(json['start_lat']),
    startLng: _double(json['start_lng']),
    endLat: _double(json['end_lat']),
    endLng: _double(json['end_lng']),
    batteryStart: _int(json['battery_start']),
    batteryEnd: _int(json['battery_end']),
    actualKm: _double(json['actual_km']) ?? 0,
    eligibleKm: _double(json['eligible_km']) ?? 0,
  );
}

class LocationLog {
  LocationLog({
    required this.id,
    required this.employeeCode,
    required this.attendanceId,
    required this.latitude,
    required this.longitude,
    required this.capturedAt,
    this.remoteId,
    this.accuracy,
    this.speed,
    this.battery,
    this.synced = false,
  });

  final String id;
  String? remoteId;
  final String employeeCode;
  final String attendanceId;
  final double latitude;
  final double longitude;
  final double? accuracy;
  final double? speed;
  final int? battery;
  final DateTime capturedAt;
  bool synced;

  Map<String, dynamic> toJson() => {
    'id': id,
    'remote_id': remoteId,
    'employee_code': employeeCode,
    'attendance_id': attendanceId,
    'latitude': latitude,
    'longitude': longitude,
    'accuracy': accuracy,
    'speed': speed,
    'battery': battery,
    'captured_at': capturedAt.toIso8601String(),
    'synced': synced,
  };

  factory LocationLog.fromJson(Map<String, dynamic> json) => LocationLog(
    id: _text(json['id']),
    remoteId: _nullableText(json['remote_id']),
    employeeCode: _text(json['employee_code']),
    attendanceId: _text(json['attendance_id']),
    latitude: _double(json['latitude']) ?? 0,
    longitude: _double(json['longitude']) ?? 0,
    accuracy: _double(json['accuracy']),
    speed: _double(json['speed']),
    battery: _int(json['battery']),
    capturedAt: _date(json['captured_at']) ?? DateTime.now(),
    synced: json['synced'] == true,
  );
}

class Store {
  const Store({
    required this.id,
    required this.storeName,
    required this.clientName,
    required this.storeCode,
    required this.state,
    this.latitude,
    this.longitude,
    this.gpsAccuracy,
  });

  final String id;
  final String storeName;
  final String clientName;
  final String storeCode;
  final String state;
  final double? latitude;
  final double? longitude;
  final double? gpsAccuracy;

  factory Store.fromJson(Map<String, dynamic> json) => Store(
    id: _text(json['id']),
    storeName: _text(json['store_name']),
    clientName: _text(json['client_name']),
    storeCode: _text(json['store_code']),
    state: _text(json['state']),
    latitude: _double(json['latitude']),
    longitude: _double(json['longitude']),
    gpsAccuracy: _double(json['gps_accuracy']),
  );
}

class SiteVisit {
  SiteVisit({
    required this.id,
    required this.employeeCode,
    required this.storeName,
    required this.clientName,
    required this.storeCode,
    required this.state,
    required this.checkInTime,
    this.remoteId,
    this.attendanceId,
    this.storeId,
    this.fullName,
    this.currentLatitude,
    this.currentLongitude,
    this.currentGpsAccuracy,
    this.checkOutTime,
    this.checkOutLatitude,
    this.checkOutLongitude,
    this.checkInAccuracy,
    this.checkOutAccuracy,
    this.durationMinutes,
    this.status = 'Checked In',
    this.synced = false,
  });

  final String id;
  String? remoteId;
  final String employeeCode;
  final String? attendanceId;
  final String? storeId;
  final String? fullName;
  final double? currentLatitude;
  final double? currentLongitude;
  final double? currentGpsAccuracy;
  final String storeName;
  final String clientName;
  final String storeCode;
  final String state;
  final DateTime checkInTime;
  DateTime? checkOutTime;
  double? checkOutLatitude;
  double? checkOutLongitude;
  double? checkInAccuracy;
  double? checkOutAccuracy;
  int? durationMinutes;
  String status;
  bool synced;

  bool get isActive => checkOutTime == null;

  Map<String, dynamic> toJson() => {
    'id': id,
    'remote_id': remoteId,
    'employee_code': employeeCode,
    'attendance_id': attendanceId,
    'store_id': storeId,
    'full_name': fullName,
    'store_name': storeName,
    'client_name': clientName,
    'store_code': storeCode,
    'state': state,
    'check_in_time': checkInTime.toIso8601String(),
    'current_latitude': currentLatitude,
    'current_longitude': currentLongitude,
    'current_gps_accuracy': currentGpsAccuracy,
    'checkout_time': checkOutTime?.toIso8601String(),
    'check_out_latitude': checkOutLatitude,
    'check_out_longitude': checkOutLongitude,
    'checkin_accuracy': checkInAccuracy,
    'checkout_accuracy': checkOutAccuracy,
    'visit_duration_minutes': durationMinutes,
    'status': status,
    'synced': synced,
  };

  factory SiteVisit.fromJson(Map<String, dynamic> json) => SiteVisit(
    id: _text(json['id']),
    remoteId: _nullableText(json['remote_id']),
    employeeCode: _text(json['employee_code']),
    attendanceId: _nullableText(json['attendance_id']),
    storeId: _nullableText(json['store_id']),
    fullName: _nullableText(json['full_name']),
    storeName: _text(json['store_name']),
    clientName: _text(json['client_name']),
    storeCode: _text(json['store_code']),
    state: _text(json['state']),
    checkInTime: _date(json['check_in_time']) ?? DateTime.now(),
    currentLatitude: _double(json['current_latitude']),
    currentLongitude: _double(json['current_longitude']),
    currentGpsAccuracy: _double(json['current_gps_accuracy']),
    checkOutTime: _date(json['checkout_time']),
    checkOutLatitude: _double(json['check_out_latitude']),
    checkOutLongitude: _double(json['check_out_longitude']),
    checkInAccuracy: _double(json['checkin_accuracy']),
    checkOutAccuracy: _double(json['checkout_accuracy']),
    durationMinutes: _int(json['visit_duration_minutes']),
    status: _text(json['status']).isEmpty
        ? 'Checked In'
        : _text(json['status']),
    synced: json['synced'] == true,
  );
}

String _text(Object? value) => value?.toString().trim() ?? '';
String? _nullableText(Object? value) {
  final text = _text(value);
  return text.isEmpty ? null : text;
}

double? _double(Object? value) {
  if (value == null) return null;
  if (value is num) return value.toDouble();
  return double.tryParse(value.toString());
}

int? _int(Object? value) {
  if (value == null) return null;
  if (value is num) return value.toInt();
  return int.tryParse(value.toString());
}

DateTime? _date(Object? value) {
  if (value == null || value.toString().trim().isEmpty) return null;
  return DateTime.tryParse(value.toString())?.toLocal();
}
