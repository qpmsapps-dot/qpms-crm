class FoUser {
  const FoUser({
    required this.id,
    required this.employeeId,
    required this.name,
    required this.mobileNumber,
    required this.role,
    required this.region,
    required this.reportingManager,
  });

  final String id;
  final String employeeId;
  final String name;
  final String mobileNumber;
  final String role;
  final String region;
  final String reportingManager;

  String get username => employeeId;
  String get displayName => name;

  Map<String, dynamic> toJson() => {
    'id': id,
    'employee_id': employeeId,
    'name': name,
    'mobile_number': mobileNumber,
    'role': role,
    'region': region,
    'reporting_manager': reportingManager,
  };

  factory FoUser.fromJson(Map<String, dynamic> json) {
    final id = _textField(json, 'id', fallbackKeys: const ['employee_id']);
    final employeeId = _textField(
      json,
      'employee_id',
      fallbackKeys: const ['id'],
    );
    return FoUser(
      id: id ?? '',
      employeeId: employeeId ?? id ?? '',
      name: _textField(json, 'name') ?? 'Field Officer',
      mobileNumber:
          _textField(
            json,
            'mobile_number',
            fallbackKeys: const ['employee_id'],
          ) ??
          employeeId ??
          id ??
          '',
      role: _textField(json, 'role') ?? 'FO',
      region: _textField(json, 'region') ?? 'Test Region',
      reportingManager:
          _textField(json, 'reporting_manager') ?? 'Operations Supervisor',
    );
  }

  factory FoUser.fromProfile(Map<String, dynamic> profile) {
    final mobile =
        _textField(profile, 'mobile', fallbackKeys: const ['username']) ?? '';
    final employeeCode =
        _textField(
          profile,
          'employee_code',
          fallbackKeys: const ['username', 'mobile'],
        ) ??
        mobile;
    final name =
        _textField(
          profile,
          'full_name',
          fallbackKeys: const ['display_name'],
        ) ??
        'Field Officer';
    return FoUser(
      id: employeeCode,
      employeeId: employeeCode,
      name: name,
      mobileNumber: mobile,
      role: _textField(profile, 'role') ?? 'FO',
      region: _textField(profile, 'state') ?? 'Assigned Region',
      reportingManager:
          _textField(profile, 'reporting_manager') ?? 'Operations Supervisor',
    );
  }

  static String? profileTextField(
    Map<String, dynamic> json,
    String key, {
    List<String> fallbackKeys = const [],
  }) {
    return _textField(json, key, fallbackKeys: fallbackKeys);
  }

  static String? _textField(
    Map<String, dynamic> json,
    String key, {
    List<String> fallbackKeys = const [],
  }) {
    final keys = [key, ...fallbackKeys];
    for (final field in keys) {
      final value = json[field];
      if (value == null) continue;
      final text = value.toString().trim();
      if (text.isNotEmpty) return text;
    }
    return null;
  }

  static const testUsers = <FoUser>[
    FoUser(
      id: 'FO001',
      employeeId: 'FO001',
      name: 'Test Field Officer 001',
      mobileNumber: 'FO001',
      role: 'FO',
      region: 'Test Region',
      reportingManager: 'Operations Supervisor',
    ),
    FoUser(
      id: 'FO002',
      employeeId: 'FO002',
      name: 'Test Field Officer 002',
      mobileNumber: 'FO002',
      role: 'FO',
      region: 'Test Region',
      reportingManager: 'Operations Supervisor',
    ),
    FoUser(
      id: 'FO003',
      employeeId: 'FO003',
      name: 'Test Field Officer 003',
      mobileNumber: 'FO003',
      role: 'FO',
      region: 'Test Region',
      reportingManager: 'Operations Supervisor',
    ),
    FoUser(
      id: 'FO004',
      employeeId: 'FO004',
      name: 'Test Field Officer 004',
      mobileNumber: 'FO004',
      role: 'FO',
      region: 'Test Region',
      reportingManager: 'Operations Supervisor',
    ),
    FoUser(
      id: 'FO005',
      employeeId: 'FO005',
      name: 'Test Field Officer 005',
      mobileNumber: 'FO005',
      role: 'FO',
      region: 'Test Region',
      reportingManager: 'Operations Supervisor',
    ),
  ];

  static const demo = FoUser(
    id: 'FO001',
    employeeId: 'FO001',
    name: 'Test Field Officer 001',
    mobileNumber: 'FO001',
    role: 'FO',
    region: 'Test Region',
    reportingManager: 'Operations Supervisor',
  );

  static FoUser? byUsername(String username) {
    final normalized = username.trim().toUpperCase();
    for (final user in testUsers) {
      if (user.username == normalized) return user;
    }
    return null;
  }
}

class FoSite {
  const FoSite({
    required this.id,
    required this.name,
    required this.address,
    required this.region,
    required this.latitude,
    required this.longitude,
    this.clientName,
    this.storeCode,
    this.state,
    this.status = 'Active',
    this.remoteId,
    this.geofenceRadiusMeters = 150,
  });

  final String id;
  final String? remoteId;
  final String name;
  final String? clientName;
  final String? storeCode;
  final String address;
  final String region;
  final String? state;
  final double latitude;
  final double longitude;
  final double geofenceRadiusMeters;
  final String status;

  static const assignedDemoSites = <FoSite>[
    FoSite(
      id: 'site-qpms-office-001',
      name: 'QPMS Office',
      clientName: 'QPMS',
      address: 'QPMS Office, Chennai',
      region: 'Chennai',
      state: 'Tamil Nadu',
      latitude: 13.029051,
      longitude: 80.248947,
      geofenceRadiusMeters: 100,
    ),
    FoSite(
      id: 'site-ch-001',
      name: 'Phoenix Marketcity',
      address: 'Velachery Main Road, Chennai',
      region: 'Chennai',
      state: 'Tamil Nadu',
      latitude: 12.9902,
      longitude: 80.2164,
    ),
    FoSite(
      id: 'site-ch-002',
      name: 'Express Avenue',
      address: 'Royapettah, Chennai',
      region: 'Chennai',
      state: 'Tamil Nadu',
      latitude: 13.0587,
      longitude: 80.2642,
    ),
    FoSite(
      id: 'site-ch-003',
      name: 'DLF IT Park',
      address: 'Ramapuram, Chennai',
      region: 'Chennai',
      state: 'Tamil Nadu',
      latitude: 13.0225,
      longitude: 80.1768,
    ),
  ];

  Map<String, dynamic> toJson() => {
    'id': id,
    'remote_id': remoteId,
    'name': name,
    'client_name': clientName,
    'store_code': storeCode,
    'address': address,
    'region': region,
    'state': state,
    'latitude': latitude,
    'longitude': longitude,
    'geofence_radius_meters': geofenceRadiusMeters,
    'status': status,
  };

  factory FoSite.fromJson(Map<String, dynamic> json) => FoSite(
    id: (json['id'] ?? json['local_id'] ?? json['site_id']) as String,
    remoteId: json['remote_id'] as String?,
    name: (json['name'] ?? json['site_name']) as String,
    clientName: json['client_name'] as String?,
    storeCode: json['store_code'] as String?,
    address: (json['address'] as String?) ?? '',
    region: (json['region'] as String?) ?? (json['state'] as String? ?? ''),
    state: json['state'] as String?,
    latitude: (json['latitude'] as num).toDouble(),
    longitude: (json['longitude'] as num).toDouble(),
    geofenceRadiusMeters:
        (json['geofence_radius_meters'] as num?)?.toDouble() ?? 150,
    status: (json['status'] as String?) ?? 'Active',
  );
}

class FoAttendance {
  FoAttendance({
    required this.id,
    required this.foId,
    required this.loginTime,
    required this.startLat,
    required this.startLong,
    this.batteryStart,
    this.remoteId,
    this.logoutTime,
    this.endLat,
    this.endLong,
    this.batteryEnd,
    this.totalRawKm = 0,
    this.totalRouteKm = 0,
    this.totalApprovedKm = 0,
    this.eligibilityStatus = 'Needs Review',
    this.isActive = true,
    this.pendingSync = true,
    this.syncedAt,
  });

  final String id;
  String? remoteId;
  final String foId;
  final DateTime loginTime;
  final double startLat;
  final double startLong;
  final int? batteryStart;
  DateTime? logoutTime;
  double? endLat;
  double? endLong;
  int? batteryEnd;
  double totalRawKm;
  double totalRouteKm;
  double totalApprovedKm;
  String eligibilityStatus;
  bool isActive;
  bool pendingSync;
  DateTime? syncedAt;

  Map<String, dynamic> toJson() => {
    'id': id,
    'remote_id': remoteId,
    'fo_id': foId,
    'login_time': loginTime.toIso8601String(),
    'logout_time': logoutTime?.toIso8601String(),
    'start_lat': startLat,
    'start_long': startLong,
    'end_lat': endLat,
    'end_long': endLong,
    'battery_start': batteryStart,
    'battery_end': batteryEnd,
    'total_raw_km': totalRawKm,
    'total_route_km': totalRouteKm,
    'total_approved_km': totalApprovedKm,
    'actual_km': totalRawKm,
    'eligible_km': totalApprovedKm,
    'rate_per_km': 4,
    'petrol_amount': totalApprovedKm * 4,
    'eligibility_status': eligibilityStatus,
    'is_active': isActive,
    'pending_sync': pendingSync,
    'synced_at': syncedAt?.toIso8601String(),
  };

  factory FoAttendance.fromJson(Map<String, dynamic> json) => FoAttendance(
    id: json['id'] as String,
    remoteId: json['remote_id'] as String?,
    foId: json['fo_id'] as String,
    loginTime: DateTime.parse(json['login_time'] as String),
    startLat: (json['start_lat'] as num).toDouble(),
    startLong: (json['start_long'] as num).toDouble(),
    batteryStart: json['battery_start'] as int?,
    logoutTime: json['logout_time'] == null
        ? null
        : DateTime.parse(json['logout_time'] as String),
    endLat: (json['end_lat'] as num?)?.toDouble(),
    endLong: (json['end_long'] as num?)?.toDouble(),
    batteryEnd: json['battery_end'] as int?,
    totalRawKm: (json['total_raw_km'] as num?)?.toDouble() ?? 0,
    totalRouteKm: (json['total_route_km'] as num?)?.toDouble() ?? 0,
    totalApprovedKm: (json['total_approved_km'] as num?)?.toDouble() ?? 0,
    eligibilityStatus:
        (json['eligibility_status'] as String?) ?? 'Needs Review',
    isActive: json['is_active'] as bool? ?? true,
    pendingSync: json['pending_sync'] as bool? ?? true,
    syncedAt: json['synced_at'] == null
        ? null
        : DateTime.parse(json['synced_at'] as String),
  );
}

class FoDailyTask {
  FoDailyTask({
    required this.id,
    required this.foId,
    required this.taskDate,
    required this.site,
    required this.reasonForVisit,
    required this.plannedSequence,
    this.remoteId,
    this.attendanceId,
    this.status = 'planned',
    this.navigationStartedAt,
    this.taskStartedAt,
    this.taskCompletedAt,
    this.taskCompletedLatitude,
    this.taskCompletedLongitude,
    this.taskType,
    this.taskCategory,
    this.workStatus,
    this.pendingSync = true,
    this.syncedAt,
  });

  final String id;
  String? remoteId;
  final String foId;
  String? attendanceId;
  final DateTime taskDate;
  final FoSite site;
  final String reasonForVisit;
  final int plannedSequence;
  String status;
  DateTime? navigationStartedAt;
  DateTime? taskStartedAt;
  DateTime? taskCompletedAt;
  double? taskCompletedLatitude;
  double? taskCompletedLongitude;
  String? taskType;
  String? taskCategory;
  String? workStatus;
  bool pendingSync;
  DateTime? syncedAt;

  Map<String, dynamic> toJson() => {
    'id': id,
    'remote_id': remoteId,
    'fo_id': foId,
    'attendance_id': attendanceId,
    'task_date': taskDate.toIso8601String(),
    'site': site.toJson(),
    'reason_for_visit': reasonForVisit,
    'planned_sequence': plannedSequence,
    'status': status,
    'navigation_started_at': navigationStartedAt?.toIso8601String(),
    'task_started_at': taskStartedAt?.toIso8601String(),
    'task_completed_at': taskCompletedAt?.toIso8601String(),
    'task_completed_latitude': taskCompletedLatitude,
    'task_completed_longitude': taskCompletedLongitude,
    'task_type': taskType,
    'task_category': taskCategory,
    'work_status': workStatus,
    'pending_sync': pendingSync,
    'synced_at': syncedAt?.toIso8601String(),
  };

  factory FoDailyTask.fromJson(Map<String, dynamic> json) => FoDailyTask(
    id: json['id'] as String,
    remoteId: json['remote_id'] as String?,
    foId: json['fo_id'] as String,
    attendanceId: json['attendance_id'] as String?,
    taskDate: DateTime.parse(json['task_date'] as String),
    site: FoSite.fromJson(json['site'] as Map<String, dynamic>),
    reasonForVisit: json['reason_for_visit'] as String,
    plannedSequence: json['planned_sequence'] as int? ?? 1,
    status: json['status'] as String? ?? 'planned',
    navigationStartedAt: json['navigation_started_at'] == null
        ? null
        : DateTime.parse(json['navigation_started_at'] as String),
    taskStartedAt: json['task_started_at'] == null
        ? null
        : DateTime.parse(json['task_started_at'] as String),
    taskCompletedAt: json['task_completed_at'] == null
        ? null
        : DateTime.parse(json['task_completed_at'] as String),
    taskCompletedLatitude: (json['task_completed_latitude'] as num?)
        ?.toDouble(),
    taskCompletedLongitude: (json['task_completed_longitude'] as num?)
        ?.toDouble(),
    taskType: json['task_type'] as String?,
    taskCategory: json['task_category'] as String?,
    workStatus: json['work_status'] as String?,
    pendingSync: json['pending_sync'] as bool? ?? true,
    syncedAt: json['synced_at'] == null
        ? null
        : DateTime.parse(json['synced_at'] as String),
  );
}

class FoLocationLog {
  FoLocationLog({
    required this.id,
    required this.foId,
    required this.latitude,
    required this.longitude,
    required this.timestamp,
    this.batteryPercentage,
    required this.speed,
    required this.accuracy,
    this.remoteId,
    this.attendanceId,
    this.taskId,
    this.siteVisitId,
    this.isMocked,
    this.pendingSync = true,
    this.syncedAt,
  });

  final String id;
  String? remoteId;
  final String foId;
  String? attendanceId;
  String? taskId;
  String? siteVisitId;
  final double latitude;
  final double longitude;
  final DateTime timestamp;
  final int? batteryPercentage;
  final double speed;
  final double accuracy;
  final bool? isMocked;
  bool pendingSync;
  DateTime? syncedAt;

  Map<String, dynamic> toJson() => {
    'id': id,
    'remote_id': remoteId,
    'fo_id': foId,
    'attendance_id': attendanceId,
    'task_id': taskId,
    'site_visit_id': siteVisitId,
    'latitude': latitude,
    'longitude': longitude,
    'timestamp': timestamp.toIso8601String(),
    'battery_percentage': batteryPercentage,
    'speed': speed,
    'accuracy': accuracy,
    'is_mocked': isMocked,
    'pending_sync': pendingSync,
    'synced_at': syncedAt?.toIso8601String(),
  };

  factory FoLocationLog.fromJson(Map<String, dynamic> json) => FoLocationLog(
    id: json['id'] as String,
    remoteId: json['remote_id'] as String?,
    foId: json['fo_id'] as String,
    attendanceId: json['attendance_id'] as String?,
    taskId: json['task_id'] as String?,
    siteVisitId: json['site_visit_id'] as String?,
    latitude: (json['latitude'] as num).toDouble(),
    longitude: (json['longitude'] as num).toDouble(),
    timestamp: DateTime.parse(json['timestamp'] as String),
    batteryPercentage: json['battery_percentage'] as int?,
    speed: (json['speed'] as num).toDouble(),
    accuracy: (json['accuracy'] as num).toDouble(),
    isMocked: json['is_mocked'] as bool?,
    pendingSync: json['pending_sync'] as bool? ?? true,
    syncedAt: json['synced_at'] == null
        ? null
        : DateTime.parse(json['synced_at'] as String),
  );
}

class FoSiteVisit {
  FoSiteVisit({
    required this.id,
    required this.foId,
    required this.site,
    required this.selectedTime,
    this.fullName,
    this.remoteId,
    this.attendanceId,
    this.taskId,
    this.reasonForVisit = '',
    this.status = 'TRAVELLING',
    this.arrivalTime,
    this.checkinTime,
    this.checkoutTime,
    this.totalDurationMinutes,
    this.travelledKm = 0,
    this.approvedKm = 0,
    this.arrivalLat,
    this.arrivalLong,
    this.checkoutLat,
    this.checkoutLong,
    this.checkoutAccuracy,
    this.gpsAccuracy,
    this.geofenceStatus = 'Pending',
    this.distanceFromSiteMeters,
    this.straightLineKm,
    this.routeKm,
    this.routeDurationMinutes,
    this.googleRoutePolyline,
    this.distanceSource,
    this.workPerformed = '',
    this.remarks = '',
    List<String>? photoPaths,
    List<String>? documentPaths,
    this.voiceNotePrepared = false,
    this.pendingSync = true,
    this.syncedAt,
  }) : photoPaths = photoPaths ?? <String>[],
       documentPaths = documentPaths ?? <String>[];

  final String id;
  String? remoteId;
  final String foId;
  String? attendanceId;
  String? taskId;
  final FoSite site;
  final DateTime selectedTime;
  String? fullName;
  String reasonForVisit;
  String status;
  DateTime? arrivalTime;
  DateTime? checkinTime;
  DateTime? checkoutTime;
  int? totalDurationMinutes;
  double travelledKm;
  double approvedKm;
  double? arrivalLat;
  double? arrivalLong;
  double? checkoutLat;
  double? checkoutLong;
  double? checkoutAccuracy;
  double? gpsAccuracy;
  String geofenceStatus;
  double? distanceFromSiteMeters;
  double? straightLineKm;
  double? routeKm;
  int? routeDurationMinutes;
  String? googleRoutePolyline;
  String? distanceSource;
  String workPerformed;
  String remarks;
  final List<String> photoPaths;
  final List<String> documentPaths;
  bool voiceNotePrepared;
  bool pendingSync;
  DateTime? syncedAt;

  Map<String, dynamic> toJson() => {
    'id': id,
    'remote_id': remoteId,
    'fo_id': foId,
    'attendance_id': attendanceId,
    'task_id': taskId,
    'site_id': site.id,
    'site': site.toJson(),
    'selected_time': selectedTime.toIso8601String(),
    'full_name': fullName,
    'reason_for_visit': reasonForVisit,
    'status': status,
    'arrival_time': arrivalTime?.toIso8601String(),
    'checkin_time': checkinTime?.toIso8601String(),
    'checkout_time': checkoutTime?.toIso8601String(),
    'total_duration_minutes': totalDurationMinutes,
    'travelled_km': travelledKm,
    'approved_km': approvedKm,
    'arrival_lat': arrivalLat,
    'arrival_long': arrivalLong,
    'checkout_lat': checkoutLat,
    'checkout_long': checkoutLong,
    'checkout_accuracy': checkoutAccuracy,
    'gps_accuracy': gpsAccuracy,
    'geofence_status': geofenceStatus,
    'distance_from_site_meters': distanceFromSiteMeters,
    'straight_line_km': straightLineKm,
    'route_km': routeKm,
    'route_duration_minutes': routeDurationMinutes,
    'google_route_polyline': googleRoutePolyline,
    'distance_source': distanceSource,
    'work_performed': workPerformed,
    'remarks': remarks,
    'photo_paths': photoPaths,
    'document_paths': documentPaths,
    'voice_note_prepared': voiceNotePrepared,
    'pending_sync': pendingSync,
    'synced_at': syncedAt?.toIso8601String(),
  };

  factory FoSiteVisit.fromJson(Map<String, dynamic> json) => FoSiteVisit(
    id: json['id'] as String,
    remoteId: json['remote_id'] as String?,
    foId: json['fo_id'] as String,
    attendanceId: json['attendance_id'] as String?,
    taskId: json['task_id'] as String?,
    site: FoSite.fromJson(json['site'] as Map<String, dynamic>),
    selectedTime: DateTime.parse(json['selected_time'] as String),
    fullName: json['full_name'] as String?,
    reasonForVisit: json['reason_for_visit'] as String? ?? '',
    status: json['status'] as String? ?? 'TRAVELLING',
    arrivalTime: json['arrival_time'] == null
        ? null
        : DateTime.parse(json['arrival_time'] as String),
    checkinTime: json['checkin_time'] == null
        ? null
        : DateTime.parse(json['checkin_time'] as String),
    checkoutTime: json['checkout_time'] == null
        ? null
        : DateTime.parse(json['checkout_time'] as String),
    totalDurationMinutes: json['total_duration_minutes'] as int?,
    travelledKm: (json['travelled_km'] as num?)?.toDouble() ?? 0,
    approvedKm: (json['approved_km'] as num?)?.toDouble() ?? 0,
    arrivalLat: (json['arrival_lat'] as num?)?.toDouble(),
    arrivalLong: (json['arrival_long'] as num?)?.toDouble(),
    checkoutLat: (json['checkout_lat'] as num?)?.toDouble(),
    checkoutLong: (json['checkout_long'] as num?)?.toDouble(),
    checkoutAccuracy: (json['checkout_accuracy'] as num?)?.toDouble(),
    gpsAccuracy: (json['gps_accuracy'] as num?)?.toDouble(),
    geofenceStatus: json['geofence_status'] as String? ?? 'Pending',
    distanceFromSiteMeters: (json['distance_from_site_meters'] as num?)
        ?.toDouble(),
    straightLineKm: (json['straight_line_km'] as num?)?.toDouble(),
    routeKm: (json['route_km'] as num?)?.toDouble(),
    routeDurationMinutes: json['route_duration_minutes'] as int?,
    googleRoutePolyline: json['google_route_polyline'] as String?,
    distanceSource: json['distance_source'] as String?,
    workPerformed: json['work_performed'] as String? ?? '',
    remarks: json['remarks'] as String? ?? '',
    photoPaths: (json['photo_paths'] as List<dynamic>? ?? []).cast<String>(),
    documentPaths: (json['document_paths'] as List<dynamic>? ?? [])
        .cast<String>(),
    voiceNotePrepared: json['voice_note_prepared'] as bool? ?? false,
    pendingSync: json['pending_sync'] as bool? ?? true,
    syncedAt: json['synced_at'] == null
        ? null
        : DateTime.parse(json['synced_at'] as String),
  );
}

class FoTravelSegment {
  FoTravelSegment({
    required this.id,
    required this.foId,
    required this.fromLat,
    required this.fromLng,
    required this.toLat,
    required this.toLng,
    required this.straightLineKm,
    this.remoteId,
    this.attendanceId,
    this.taskId,
    this.siteVisitId,
    this.routeKm,
    this.routeDurationMinutes,
    this.googleRoutePolyline,
    this.distanceSource = 'google_directions',
    this.segmentStatus = 'calculated',
    this.pendingSync = true,
    this.syncedAt,
    DateTime? createdAt,
  }) : createdAt = createdAt ?? DateTime.now();

  final String id;
  String? remoteId;
  final String foId;
  String? attendanceId;
  String? taskId;
  String? siteVisitId;
  final double fromLat;
  final double fromLng;
  final double toLat;
  final double toLng;
  final double straightLineKm;
  double? routeKm;
  int? routeDurationMinutes;
  String? googleRoutePolyline;
  String distanceSource;
  String segmentStatus;
  bool pendingSync;
  DateTime? syncedAt;
  final DateTime createdAt;

  Map<String, dynamic> toJson() => {
    'id': id,
    'remote_id': remoteId,
    'fo_id': foId,
    'attendance_id': attendanceId,
    'task_id': taskId,
    'site_visit_id': siteVisitId,
    'from_lat': fromLat,
    'from_lng': fromLng,
    'to_lat': toLat,
    'to_lng': toLng,
    'straight_line_km': straightLineKm,
    'route_km': routeKm,
    'route_duration_minutes': routeDurationMinutes,
    'google_route_polyline': googleRoutePolyline,
    'distance_source': distanceSource,
    'segment_status': segmentStatus,
    'pending_sync': pendingSync,
    'synced_at': syncedAt?.toIso8601String(),
    'created_at': createdAt.toIso8601String(),
  };

  factory FoTravelSegment.fromJson(Map<String, dynamic> json) =>
      FoTravelSegment(
        id: json['id'] as String,
        remoteId: json['remote_id'] as String?,
        foId: json['fo_id'] as String,
        attendanceId: json['attendance_id'] as String?,
        taskId: json['task_id'] as String?,
        siteVisitId: json['site_visit_id'] as String?,
        fromLat: (json['from_lat'] as num).toDouble(),
        fromLng: (json['from_lng'] as num).toDouble(),
        toLat: (json['to_lat'] as num).toDouble(),
        toLng: (json['to_lng'] as num).toDouble(),
        straightLineKm: (json['straight_line_km'] as num?)?.toDouble() ?? 0,
        routeKm: (json['route_km'] as num?)?.toDouble(),
        routeDurationMinutes: json['route_duration_minutes'] as int?,
        googleRoutePolyline: json['google_route_polyline'] as String?,
        distanceSource:
            json['distance_source'] as String? ?? 'google_directions',
        segmentStatus: json['segment_status'] as String? ?? 'calculated',
        pendingSync: json['pending_sync'] as bool? ?? true,
        syncedAt: json['synced_at'] == null
            ? null
            : DateTime.parse(json['synced_at'] as String),
        createdAt: json['created_at'] == null
            ? DateTime.now()
            : DateTime.parse(json['created_at'] as String),
      );
}

class FoTaskAttachment {
  FoTaskAttachment({
    required this.id,
    required this.foId,
    required this.localPath,
    this.remoteId,
    this.taskId,
    this.siteVisitId,
    this.siteId,
    this.fileUrl,
    this.fileName,
    this.fileType,
    this.fileSize,
    this.storageBucket = 'fo-task-attachments',
    this.pendingSync = true,
    this.syncedAt,
    DateTime? uploadedAt,
  }) : uploadedAt = uploadedAt ?? DateTime.now();

  final String id;
  String? remoteId;
  final String foId;
  String? taskId;
  String? siteVisitId;
  String? siteId;
  final String localPath;
  String? fileUrl;
  String? fileName;
  String? fileType;
  int? fileSize;
  String storageBucket;
  bool pendingSync;
  DateTime? syncedAt;
  DateTime uploadedAt;

  Map<String, dynamic> toJson() => {
    'id': id,
    'remote_id': remoteId,
    'fo_id': foId,
    'task_id': taskId,
    'site_visit_id': siteVisitId,
    'site_id': siteId,
    'local_path': localPath,
    'file_url': fileUrl,
    'file_name': fileName,
    'file_type': fileType,
    'file_size': fileSize,
    'storage_bucket': storageBucket,
    'pending_sync': pendingSync,
    'synced_at': syncedAt?.toIso8601String(),
    'uploaded_at': uploadedAt.toIso8601String(),
  };

  factory FoTaskAttachment.fromJson(Map<String, dynamic> json) =>
      FoTaskAttachment(
        id: json['id'] as String,
        remoteId: json['remote_id'] as String?,
        foId: json['fo_id'] as String,
        taskId: json['task_id'] as String?,
        siteVisitId: json['site_visit_id'] as String?,
        siteId: json['site_id'] as String?,
        localPath: json['local_path'] as String,
        fileUrl: json['file_url'] as String?,
        fileName: json['file_name'] as String?,
        fileType: json['file_type'] as String?,
        fileSize: (json['file_size'] as num?)?.toInt(),
        storageBucket:
            json['storage_bucket'] as String? ?? 'fo-task-attachments',
        pendingSync: json['pending_sync'] as bool? ?? true,
        syncedAt: json['synced_at'] == null
            ? null
            : DateTime.parse(json['synced_at'] as String),
        uploadedAt: json['uploaded_at'] == null
            ? DateTime.now()
            : DateTime.parse(json['uploaded_at'] as String),
      );
}
