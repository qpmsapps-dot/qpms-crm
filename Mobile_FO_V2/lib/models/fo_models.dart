import '../utils/mobile_roles.dart';

const travelModeBike = 'bike';
const travelModeOwnVehicle = 'own_vehicle';
const travelModeCar = 'car';
const travelModeAuto = 'auto';
const travelModeBus = 'bus';
const travelModeTrain = 'train';
const travelModeOther = 'other';

const defaultTravelModeRatePerKm = 4.0;
const carTravelModeRatePerKm = 8.0;
const travelModeRatesPerKm = {
  travelModeBike: defaultTravelModeRatePerKm,
  travelModeOwnVehicle: defaultTravelModeRatePerKm,
  travelModeCar: carTravelModeRatePerKm,
};

const payableTravelModes = {
  travelModeBike,
  travelModeOwnVehicle,
  travelModeCar,
};
const allTravelModes = {
  travelModeBike,
  travelModeOwnVehicle,
  travelModeCar,
  travelModeAuto,
  travelModeBus,
  travelModeTrain,
  travelModeOther,
};

String normalizeTravelMode(String? value) {
  final normalized = (value ?? '')
      .trim()
      .toLowerCase()
      .replaceAll('-', '_')
      .replaceAll(' ', '_');
  return allTravelModes.contains(normalized) ? normalized : travelModeBike;
}

bool payableKmAllowedForTravelMode(String? value) =>
    payableTravelModes.contains(normalizeTravelMode(value));

double travelModeRatePerKm(String? value) {
  final mode = normalizeTravelMode(value);
  return travelModeRatesPerKm[mode] ?? defaultTravelModeRatePerKm;
}

String travelModeLabel(String? value) {
  switch (normalizeTravelMode(value)) {
    case travelModeCar:
      return 'Car';
    case travelModeAuto:
      return 'Auto';
    case travelModeBus:
      return 'Bus';
    case travelModeTrain:
      return 'Train';
    case travelModeOther:
      return 'Others';
    case travelModeOwnVehicle:
      return 'Bike';
    case travelModeBike:
    default:
      return 'Bike';
  }
}

class FoUser {
  const FoUser({
    required this.authUserId,
    required this.employeeCode,
    required this.fullName,
    required this.mobile,
    required this.email,
    required this.state,
    required this.role,
    this.department,
    this.designation,
    this.business,
  });

  final String authUserId;
  final String employeeCode;
  final String fullName;
  final String mobile;
  final String email;
  final String state;
  final String role;
  final String? department;
  final String? designation;
  final String? business;

  Map<String, dynamic> toJson() => {
    'auth_user_id': authUserId,
    'employee_code': employeeCode,
    'full_name': fullName,
    'mobile': mobile,
    'email': email,
    'state': state,
    'role': role,
    'department': department,
    'designation': designation,
    'business': business,
  };

  factory FoUser.fromJson(Map<String, dynamic> json) => FoUser(
    authUserId: _text(json['auth_user_id'] ?? json['id']),
    employeeCode: _text(json['employee_code'] ?? json['username']),
    fullName: _text(json['full_name'] ?? json['display_name']),
    mobile: _text(json['mobile']),
    email: _text(json['email']),
    state: _text(json['state']),
    role: resolveMobileRole(
      role: _nullableText(json['role']),
      department: _nullableText(json['department']),
      designation: _nullableText(json['designation']),
    ),
    department: _nullableText(json['department']),
    designation: _nullableText(json['designation']),
    business: _nullableText(json['business']),
  );
}

class Attendance {
  Attendance({
    required this.id,
    required this.employeeCode,
    required this.startTime,
    this.attendanceDate,
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
    this.totalRouteKm = 0,
    this.endRouteKm = 0,
    this.petrolAmount,
    String travelMode = travelModeBike,
    bool? payableKmAllowed,
    this.travelModeNote,
    this.metadata = const {},
  }) : travelMode = normalizeTravelMode(travelMode),
       payableKmAllowed =
           payableKmAllowed ?? payableKmAllowedForTravelMode(travelMode);

  final String id;
  String? remoteId;
  final String employeeCode;
  final DateTime startTime;
  final String? attendanceDate;
  DateTime? endTime;
  double? startLat;
  double? startLng;
  double? endLat;
  double? endLng;
  int? batteryStart;
  int? batteryEnd;
  double actualKm;
  double eligibleKm;
  double totalRouteKm;
  double endRouteKm;
  double? petrolAmount;
  final String travelMode;
  final bool payableKmAllowed;
  String? travelModeNote;
  Map<String, dynamic> metadata;

  bool get isActive => endTime == null;

  Attendance copyWithTravelMode({
    required String travelMode,
    bool? payableKmAllowed,
    String? travelModeNote,
    Map<String, dynamic>? metadata,
  }) {
    return Attendance(
      id: id,
      employeeCode: employeeCode,
      startTime: startTime,
      attendanceDate: attendanceDate,
      remoteId: remoteId,
      endTime: endTime,
      startLat: startLat,
      startLng: startLng,
      endLat: endLat,
      endLng: endLng,
      batteryStart: batteryStart,
      batteryEnd: batteryEnd,
      actualKm: actualKm,
      eligibleKm: eligibleKm,
      totalRouteKm: totalRouteKm,
      endRouteKm: endRouteKm,
      petrolAmount: petrolAmount,
      travelMode: travelMode,
      payableKmAllowed: payableKmAllowed,
      travelModeNote: travelModeNote,
      metadata: metadata ?? this.metadata,
    );
  }

  Map<String, dynamic> toJson() => {
    'id': id,
    'remote_id': remoteId,
    'employee_code': employeeCode,
    'attendance_date': attendanceDate,
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
    'total_route_km': totalRouteKm,
    'end_route_km': endRouteKm,
    if (petrolAmount != null) 'petrol_amount': petrolAmount,
    'travel_mode': travelMode,
    'payable_km_allowed': payableKmAllowed,
    'travel_mode_note': travelModeNote,
    'metadata': metadata,
  };

  factory Attendance.fromJson(Map<String, dynamic> json) {
    final metadata = _map(json['metadata']);
    final travelMode = normalizeTravelMode(
      _nullableText(json['travel_mode']) ??
          _nullableText(metadata['travel_mode']),
    );
    return Attendance(
      id: _text(json['local_id'] ?? json['id']),
      remoteId: _nullableText(json['remote_id'] ?? json['id']),
      employeeCode: _text(json['employee_code']),
      attendanceDate: _nullableText(json['attendance_date']),
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
      totalRouteKm:
          _double(json['total_route_km']) ?? _double(json['eligible_km']) ?? 0,
      endRouteKm: _double(json['end_route_km']) ?? 0,
      petrolAmount: _double(json['petrol_amount']),
      travelMode: travelMode,
      payableKmAllowed:
          _bool(json['payable_km_allowed']) ??
          _bool(metadata['payable_km_allowed']) ??
          payableKmAllowedForTravelMode(travelMode),
      travelModeNote:
          _nullableText(json['travel_mode_note']) ??
          _nullableText(metadata['travel_mode_note']),
      metadata: metadata,
    );
  }
}

class TravelLeg {
  TravelLeg({
    required this.id,
    required this.attendanceId,
    required this.employeeCode,
    required this.startedAt,
    this.remoteId,
    this.foUserId,
    String travelMode = travelModeBike,
    bool? payableKmAllowed,
    this.endedAt,
    this.startLat,
    this.startLng,
    this.endLat,
    this.endLng,
    this.calculatedKm = 0,
    this.payableKm = 0,
    double? ratePerKm,
    double? payableAmount,
    this.fareAmount = 0,
    this.proofFileUrl,
    this.remarks,
    this.status = 'active',
    this.createdAt,
    this.updatedAt,
  }) : travelMode = normalizeTravelMode(travelMode),
       ratePerKm = ratePerKm ?? travelModeRatePerKm(travelMode),
       payableAmount = payableAmount ?? fareAmount,
       payableKmAllowed =
           payableKmAllowed ?? payableKmAllowedForTravelMode(travelMode);

  final String id;
  String? remoteId;
  final String attendanceId;
  final String employeeCode;
  final String? foUserId;
  final String travelMode;
  final bool payableKmAllowed;
  final DateTime startedAt;
  DateTime? endedAt;
  double? startLat;
  double? startLng;
  double? endLat;
  double? endLng;
  double calculatedKm;
  double payableKm;
  final double ratePerKm;
  double payableAmount;
  double fareAmount;
  String? proofFileUrl;
  String? remarks;
  String status;
  DateTime? createdAt;
  DateTime? updatedAt;

  bool get isActive => status == 'active' && endedAt == null;

  Map<String, dynamic> toJson() => {
    'id': id,
    'remote_id': remoteId,
    'attendance_id': attendanceId,
    'employee_code': employeeCode,
    'fo_user_id': foUserId,
    'travel_mode': travelMode,
    'payable_km_allowed': payableKmAllowed,
    'started_at': startedAt.toIso8601String(),
    'ended_at': endedAt?.toIso8601String(),
    'start_lat': startLat,
    'start_lng': startLng,
    'end_lat': endLat,
    'end_lng': endLng,
    'calculated_km': calculatedKm,
    'payable_km': payableKm,
    'rate_per_km': ratePerKm,
    'payable_amount': payableAmount,
    'fare_amount': fareAmount,
    'proof_file_url': proofFileUrl,
    'remarks': remarks,
    'status': status,
    'created_at': createdAt?.toIso8601String(),
    'updated_at': updatedAt?.toIso8601String(),
  };

  factory TravelLeg.fromJson(Map<String, dynamic> json) {
    final travelMode = normalizeTravelMode(json['travel_mode']?.toString());
    return TravelLeg(
      id: _text(json['local_id'] ?? json['id']),
      remoteId: _nullableText(json['remote_id'] ?? json['id']),
      attendanceId: _text(json['attendance_id']),
      employeeCode: _text(json['employee_code']),
      foUserId: _nullableText(json['fo_user_id']),
      travelMode: travelMode,
      payableKmAllowed:
          _bool(json['payable_km_allowed']) ??
          payableKmAllowedForTravelMode(travelMode),
      startedAt: _date(json['started_at']) ?? DateTime.now(),
      endedAt: _date(json['ended_at']),
      startLat: _double(json['start_lat']),
      startLng: _double(json['start_lng']),
      endLat: _double(json['end_lat']),
      endLng: _double(json['end_lng']),
      calculatedKm: _double(json['calculated_km']) ?? 0,
      payableKm: _double(json['payable_km']) ?? 0,
      ratePerKm: _double(json['rate_per_km']),
      payableAmount: _double(json['payable_amount']),
      fareAmount: _double(json['fare_amount']) ?? 0,
      proofFileUrl: _nullableText(json['proof_file_url']),
      remarks: _nullableText(json['remarks']),
      status: _text(json['status']).isEmpty ? 'active' : _text(json['status']),
      createdAt: _date(json['created_at']),
      updatedAt: _date(json['updated_at']),
    );
  }
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
    'local_id': id,
    'remote_id': remoteId,
    'fo_user_id': employeeCode,
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
    id: _text(json['local_id'] ?? json['id']),
    remoteId: _nullableText(json['remote_id']),
    employeeCode: _text(json['fo_user_id'] ?? json['employee_code']),
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
    this.business,
    this.latitude,
    this.longitude,
    this.gpsAccuracy,
  });

  final String id;
  final String storeName;
  final String clientName;
  final String storeCode;
  final String state;
  final String? business;
  final double? latitude;
  final double? longitude;
  final double? gpsAccuracy;

  factory Store.fromJson(Map<String, dynamic> json) => Store(
    id: _text(json['id']),
    storeName: _text(json['store_name']),
    clientName: _text(json['client_name']),
    storeCode: _text(json['store_code']),
    state: _text(json['state']),
    business: _nullableText(json['business']),
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
    this.business,
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
    this.originLatitude,
    this.originLongitude,
    this.destinationLatitude,
    this.destinationLongitude,
    this.routeKm,
    this.metadata = const {},
    this.checkOutDistanceMeters,
    this.checkOutLocationStatus,
    this.checkOutNote,
    this.petrolEligibleAfterCheckout = true,
    this.petrolPenaltyDistanceMeters = 0,
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
  final String? business;
  final DateTime checkInTime;
  DateTime? checkOutTime;
  double? checkOutLatitude;
  double? checkOutLongitude;
  double? checkInAccuracy;
  double? checkOutAccuracy;
  double? originLatitude;
  double? originLongitude;
  double? destinationLatitude;
  double? destinationLongitude;
  double? routeKm;
  Map<String, dynamic> metadata;
  double? checkOutDistanceMeters;
  String? checkOutLocationStatus;
  String? checkOutNote;
  bool petrolEligibleAfterCheckout;
  double petrolPenaltyDistanceMeters;
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
    'business': business,
    'check_in_time': checkInTime.toIso8601String(),
    'current_latitude': currentLatitude,
    'current_longitude': currentLongitude,
    'current_gps_accuracy': currentGpsAccuracy,
    'checkout_time': checkOutTime?.toIso8601String(),
    'check_out_latitude': checkOutLatitude,
    'check_out_longitude': checkOutLongitude,
    'checkin_accuracy': checkInAccuracy,
    'checkout_accuracy': checkOutAccuracy,
    'origin_lat': originLatitude,
    'origin_lng': originLongitude,
    'destination_lat': destinationLatitude,
    'destination_lng': destinationLongitude,
    'route_km': routeKm,
    'metadata': metadata,
    'checkout_distance_meters': checkOutDistanceMeters,
    'checkout_location_status': checkOutLocationStatus,
    'checkout_note': checkOutNote,
    'petrol_eligible_after_checkout': petrolEligibleAfterCheckout,
    'petrol_penalty_distance_meters': petrolPenaltyDistanceMeters,
    'visit_duration_minutes': durationMinutes,
    'status': status,
    'synced': synced,
  };

  factory SiteVisit.fromJson(Map<String, dynamic> json) => SiteVisit(
    id: _text(json['local_id'] ?? json['id']),
    remoteId: _nullableText(json['remote_id'] ?? json['id']),
    employeeCode: _text(json['employee_code']),
    attendanceId: _nullableText(json['attendance_id']),
    storeId: _nullableText(json['store_id']),
    fullName: _nullableText(json['full_name']),
    storeName: _text(json['store_name']),
    clientName: _text(json['client_name']),
    storeCode: _text(json['store_code']),
    state: _text(json['state']),
    business: _nullableText(json['business']),
    checkInTime: _date(json['check_in_time']) ?? DateTime.now(),
    currentLatitude:
        _double(json['current_latitude']) ?? _double(json['check_in_latitude']),
    currentLongitude:
        _double(json['current_longitude']) ??
        _double(json['check_in_longitude']),
    currentGpsAccuracy: _double(json['current_gps_accuracy']),
    checkOutTime: _date(
      json['checkout_time'] ??
          json['check_out_time'] ??
          json['checkOutTime'] ??
          _map(json['metadata'])['checkout_time'] ??
          _map(json['metadata'])['check_out_time'] ??
          _map(json['metadata'])['checkOutTime'],
    ),
    checkOutLatitude: _double(json['check_out_latitude']),
    checkOutLongitude: _double(json['check_out_longitude']),
    checkInAccuracy:
        _double(json['checkin_accuracy']) ??
        _double(_map(json['metadata'])['checkin_accuracy']),
    checkOutAccuracy: _double(json['checkout_accuracy']),
    originLatitude:
        _double(json['origin_lat']) ??
        _double(_map(json['metadata'])['origin_lat']),
    originLongitude:
        _double(json['origin_lng']) ??
        _double(_map(json['metadata'])['origin_lng']),
    destinationLatitude:
        _double(json['destination_lat']) ??
        _double(_map(json['metadata'])['destination_lat']),
    destinationLongitude:
        _double(json['destination_lng']) ??
        _double(_map(json['metadata'])['destination_lng']),
    routeKm: _double(json['route_km']),
    metadata: _map(json['metadata']),
    checkOutDistanceMeters: _double(json['checkout_distance_meters']),
    checkOutLocationStatus: _nullableText(json['checkout_location_status']),
    checkOutNote: _nullableText(json['checkout_note']),
    petrolEligibleAfterCheckout:
        json['petrol_eligible_after_checkout'] != false,
    petrolPenaltyDistanceMeters:
        _double(json['petrol_penalty_distance_meters']) ?? 0,
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

bool? _bool(Object? value) {
  if (value == null) return null;
  if (value is bool) return value;
  final text = value.toString().trim().toLowerCase();
  if (text == 'true' || text == '1' || text == 'yes') return true;
  if (text == 'false' || text == '0' || text == 'no') return false;
  return null;
}

Map<String, dynamic> _map(Object? value) {
  if (value is Map<String, dynamic>) return value;
  if (value is Map) return Map<String, dynamic>.from(value);
  return <String, dynamic>{};
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
