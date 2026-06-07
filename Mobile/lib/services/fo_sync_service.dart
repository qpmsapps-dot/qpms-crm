import 'dart:io';

import 'package:flutter/foundation.dart';
import 'package:supabase_flutter/supabase_flutter.dart';

import '../models/fo_models.dart';
import 'fo_storage_service.dart';
import 'supabase_service.dart';

class FoSyncService {
  FoSyncService._();

  static SupabaseClient? get _client => QpmsSupabaseService.client;
  static bool _locationLogsSyncing = false;

  static bool get isAvailable => _client != null;

  static String _usernameForFo(String foId) => foId;

  static String _displayNameForFo(String foId) => foId;

  static bool _isMissingColumnError(Object error) {
    final text = error.toString().toLowerCase();
    return text.contains('column') &&
        (text.contains('does not exist') ||
            text.contains('could not find') ||
            text.contains('schema cache'));
  }

  static Map<String, dynamic> _attendancePayload(
    FoAttendance attendance, {
    required bool includeReportingColumns,
  }) {
    final payload = <String, dynamic>{
      'fo_user_id': attendance.foId,
      'attendance_date': _dateOnly(attendance.loginTime),
      'login_time': attendance.loginTime.toIso8601String(),
      'logout_time': attendance.logoutTime?.toIso8601String(),
      'status': attendance.isActive ? 'Active' : 'Completed',
      'start_latitude': attendance.startLat,
      'start_longitude': attendance.startLong,
      'end_latitude': attendance.endLat,
      'end_longitude': attendance.endLong,
      'start_battery_percentage': attendance.batteryStart,
      'end_battery_percentage': attendance.batteryEnd,
      'total_raw_km': attendance.totalRawKm,
      'total_approved_km': attendance.totalApprovedKm,
      'eligibility_status': attendance.eligibilityStatus,
      'sync_status': 'synced',
      'local_id': attendance.id,
    };
    if (includeReportingColumns) {
      payload.addAll({
        'username': _usernameForFo(attendance.foId),
        'display_name': _displayNameForFo(attendance.foId),
        'total_route_km': attendance.totalRouteKm,
        'actual_km': attendance.totalRawKm,
        'eligible_km': attendance.totalApprovedKm,
        'rate_per_km': 4,
        'petrol_amount': attendance.totalApprovedKm * 4,
      });
    }
    return payload;
  }

  static Future<List<FoSite>> fetchSites() async {
    final supabase = _client;
    if (supabase == null) {
      return FoSite.assignedDemoSites;
    }
    try {
      final rows = List<Map<String, dynamic>>.from(
        await supabase
            .from('fo_sites')
            .select()
            .eq('status', 'Active')
            .order('site_name'),
      );
      if (rows.isEmpty) {
        return FoSite.assignedDemoSites;
      }
      return rows.map((row) {
        return FoSite(
          id: 'remote-${row['id']}',
          remoteId: row['id'] as String?,
          name: row['site_name'] as String,
          clientName: row['client_name'] as String?,
          address: row['address'] as String? ?? '',
          state: row['state'] as String?,
          region: (row['region'] as String?) ?? (row['state'] as String? ?? ''),
          latitude: (row['latitude'] as num).toDouble(),
          longitude: (row['longitude'] as num).toDouble(),
          geofenceRadiusMeters:
              (row['geofence_radius_meters'] as num?)?.toDouble() ?? 100,
          status: row['status'] as String? ?? 'Active',
        );
      }).toList();
    } catch (error, stackTrace) {
      debugPrint('[myQPMS FO Sync] Site fetch failed, using fallback: $error');
      debugPrintStack(stackTrace: stackTrace);
      return FoSite.assignedDemoSites;
    }
  }

  static Future<List<FoSite>> searchStores(String query) async {
    final supabase = _client;
    if (supabase == null) return [];
    final normalized = query.trim();
    if (normalized.length < 2) return [];
    try {
      final rows = List<Map<String, dynamic>>.from(
        await supabase
            .from('store_master')
            .select()
            .or('store_name.ilike.%$normalized%,store_code.ilike.%$normalized%')
            .order('store_name')
            .limit(20),
      );
      return rows.map(_storeFromRow).toList();
    } catch (error, stackTrace) {
      debugPrint('[myQPMS FO Sync] Store search failed: $error');
      debugPrintStack(stackTrace: stackTrace);
      return [];
    }
  }

  static Future<FoSite?> createStore({
    required String storeName,
    required String clientName,
    required String storeCode,
    required String state,
    required String employeeCode,
    required String fullName,
    required FoAttendance attendance,
    required double latitude,
    required double longitude,
    required double gpsAccuracy,
  }) async {
    final supabase = _client;
    if (supabase == null) return null;
    try {
      final attendanceRemoteId = await _attendanceRemoteId(attendance.id);
      final row = await supabase
          .from('store_master')
          .insert({
            'store_name': storeName,
            'client_name': clientName,
            'store_code': storeCode,
            'state': state,
            'latitude': latitude,
            'longitude': longitude,
            'gps_accuracy': gpsAccuracy,
            'created_by_employee_code': employeeCode,
            'created_by_full_name': fullName,
            'attendance_id': attendanceRemoteId,
            'captured_at': DateTime.now().toIso8601String(),
            'status': 'Active',
          })
          .select()
          .single();
      debugPrint('[myQPMS FO Sync] Store created: $storeCode');
      return _storeFromRow(Map<String, dynamic>.from(row));
    } catch (error, stackTrace) {
      debugPrint('[myQPMS FO Sync] Store create failed: $error');
      debugPrintStack(stackTrace: stackTrace);
      return null;
    }
  }

  static FoSite _storeFromRow(Map<String, dynamic> row) => FoSite(
    id: 'store-${row['id']}',
    remoteId: row['id'] as String?,
    name: row['store_name'] as String,
    clientName: row['client_name'] as String?,
    storeCode: row['store_code'] as String?,
    address: row['store_code'] as String? ?? '',
    region: (row['state'] as String?) ?? '',
    state: row['state'] as String?,
    latitude: (row['latitude'] as num?)?.toDouble() ?? 0,
    longitude: (row['longitude'] as num?)?.toDouble() ?? 0,
    geofenceRadiusMeters: 100,
    status: (row['status'] as String?) ?? 'Active',
  );

  static Future<bool> syncAttendance(FoAttendance attendance) async {
    final supabase = _client;
    if (supabase == null) {
      debugPrint(
        '[myQPMS FO Sync] Attendance sync failed: Supabase client unavailable',
      );
      return false;
    }
    try {
      Map<String, dynamic> row;
      try {
        row = await supabase
            .from('fo_attendance')
            .upsert(
              _attendancePayload(attendance, includeReportingColumns: true),
              onConflict: 'local_id',
            )
            .select('id')
            .single();
      } catch (error) {
        if (!_isMissingColumnError(error)) rethrow;
        debugPrint(
          '[myQPMS FO Sync] Attendance optional reporting columns unavailable; retrying base Start Day payload: $error',
        );
        row = await supabase
            .from('fo_attendance')
            .upsert(
              _attendancePayload(attendance, includeReportingColumns: false),
              onConflict: 'local_id',
            )
            .select('id')
            .single();
      }
      attendance
        ..remoteId = row['id'] as String?
        ..pendingSync = false
        ..syncedAt = DateTime.now();
      await FoLocalStorage.saveAttendance(attendance);
      debugPrint('[myQPMS FO Sync] Attendance synced: ${attendance.id}');
      return true;
    } catch (error, stackTrace) {
      debugPrint('[myQPMS FO Sync] Attendance sync failed: $error');
      debugPrintStack(stackTrace: stackTrace);
      return false;
    }
  }

  static Future<void> syncDailyTask(FoDailyTask task) async {
    final supabase = _client;
    if (supabase == null) return;
    try {
      final attendanceRemoteId = await _attendanceRemoteId(task.attendanceId);
      final row = await supabase
          .from('fo_daily_tasks')
          .upsert({
            'fo_user_id': task.foId,
            'attendance_id': attendanceRemoteId,
            'task_date': _dateOnly(task.taskDate),
            'site_id': task.site.remoteId,
            'site_name': task.site.name,
            'reason_for_visit': task.reasonForVisit,
            'planned_sequence': task.plannedSequence,
            'task_status': task.status,
            'navigation_started_at': task.navigationStartedAt
                ?.toIso8601String(),
            'task_started_at': task.taskStartedAt?.toIso8601String(),
            'task_completed_at': task.taskCompletedAt?.toIso8601String(),
            'task_completed_latitude': task.taskCompletedLatitude,
            'task_completed_longitude': task.taskCompletedLongitude,
            'task_type': task.taskType,
            'task_category': task.taskCategory,
            'work_status': task.workStatus,
            'created_from': 'mobile',
            'sync_status': 'synced',
            'local_id': task.id,
          }, onConflict: 'local_id')
          .select('id')
          .single();
      task
        ..remoteId = row['id'] as String?
        ..pendingSync = false
        ..syncedAt = DateTime.now();
      await FoLocalStorage.saveDailyTask(task);
      debugPrint('[myQPMS FO Sync] Daily task synced: ${task.id}');
    } catch (error, stackTrace) {
      debugPrint('[myQPMS FO Sync] Daily task sync failed: $error');
      debugPrintStack(stackTrace: stackTrace);
    }
  }

  static Future<void> syncSiteVisit(FoSiteVisit visit) async {
    final supabase = _client;
    if (supabase == null) return;
    try {
      final attendanceRemoteId = await _attendanceRemoteId(visit.attendanceId);
      final taskRemoteId = await _taskRemoteId(visit.taskId);
      final row = await supabase
          .from('fo_site_visits')
          .upsert({
            'fo_user_id': visit.foId,
            'employee_code': visit.foId,
            'full_name': visit.fullName ?? _displayNameForFo(visit.foId),
            'attendance_id': attendanceRemoteId,
            'fo_daily_task_id': taskRemoteId,
            'site_id': visit.site.remoteId,
            'store_id': visit.site.remoteId,
            'site_name': visit.site.name,
            'store_name': visit.site.name,
            'store_code': visit.site.storeCode,
            'client_name': visit.site.clientName,
            'state': visit.site.state,
            'check_in_time': visit.checkinTime?.toIso8601String(),
            'check_out_time': visit.checkoutTime?.toIso8601String(),
            'checkout_time': visit.checkoutTime?.toIso8601String(),
            'check_in_latitude': visit.arrivalLat,
            'check_in_longitude': visit.arrivalLong,
            'current_latitude': visit.arrivalLat,
            'current_longitude': visit.arrivalLong,
            'current_gps_accuracy': visit.gpsAccuracy,
            'checkin_accuracy': visit.gpsAccuracy,
            'check_out_latitude': visit.checkoutLat,
            'check_out_longitude': visit.checkoutLong,
            'checkout_accuracy': visit.checkoutAccuracy,
            'gps_accuracy': visit.gpsAccuracy,
            'geofence_status': visit.geofenceStatus,
            'distance_from_site_meters': visit.distanceFromSiteMeters,
            'straight_line_km': visit.straightLineKm,
            'route_km': visit.routeKm,
            'route_duration_minutes': visit.routeDurationMinutes,
            'google_route_polyline': visit.googleRoutePolyline,
            'distance_source': visit.distanceSource,
            'work_performed': visit.workPerformed,
            'remarks': visit.remarks,
            'visit_status': visit.status,
            'time_spent_minutes': visit.totalDurationMinutes,
            'visit_duration_minutes': visit.totalDurationMinutes,
            'status': visit.status,
            'raw_km': visit.travelledKm,
            'approved_km': visit.approvedKm,
            'sync_status': 'synced',
            'local_id': visit.id,
          }, onConflict: 'local_id')
          .select('id')
          .single();
      visit
        ..remoteId = row['id'] as String?
        ..pendingSync = false
        ..syncedAt = DateTime.now();
      await FoLocalStorage.saveSiteVisit(visit);
      debugPrint('[myQPMS FO Sync] Site visit synced: ${visit.id}');
    } catch (error, stackTrace) {
      debugPrint('[myQPMS FO Sync] Site visit sync failed: $error');
      debugPrintStack(stackTrace: stackTrace);
    }
  }

  static Future<List<FoSiteVisit>> fetchSiteVisitsForFo({
    required String employeeCode,
    required DateTime start,
    required DateTime end,
  }) async {
    final supabase = _client;
    if (supabase == null) return [];
    try {
      final rows = List<Map<String, dynamic>>.from(
        await supabase
            .from('fo_site_visits')
            .select()
            .eq('employee_code', employeeCode)
            .gte('check_in_time', start.toIso8601String())
            .lt('check_in_time', end.toIso8601String())
            .order('check_in_time', ascending: false),
      );
      return rows.map(_siteVisitFromRow).toList();
    } catch (error, stackTrace) {
      debugPrint('[myQPMS FO Sync] Visit history fetch failed: $error');
      debugPrintStack(stackTrace: stackTrace);
      return [];
    }
  }

  static FoSiteVisit _siteVisitFromRow(Map<String, dynamic> row) {
    final checkInText = row['check_in_time'] as String?;
    final selected = checkInText == null
        ? DateTime.now()
        : DateTime.parse(checkInText);
    final storeId = row['store_id'] ?? row['site_id'];
    final gpsAccuracy =
        row['checkin_accuracy'] ??
        row['current_gps_accuracy'] ??
        row['gps_accuracy'];
    return FoSiteVisit(
      id: (row['local_id'] ?? row['id']).toString(),
      remoteId: row['id'] as String?,
      foId: (row['employee_code'] ?? row['fo_user_id']) as String,
      fullName: row['full_name'] as String?,
      attendanceId: row['attendance_id'] as String?,
      site: FoSite(
        id: storeId == null ? 'store-${row['id']}' : 'store-$storeId',
        remoteId: storeId as String?,
        name: (row['store_name'] ?? row['site_name'] ?? '--') as String,
        clientName: row['client_name'] as String?,
        storeCode: row['store_code'] as String?,
        address: (row['store_code'] as String?) ?? '',
        region: (row['state'] as String?) ?? '',
        state: row['state'] as String?,
        latitude: (row['current_latitude'] as num?)?.toDouble() ?? 0,
        longitude: (row['current_longitude'] as num?)?.toDouble() ?? 0,
      ),
      selectedTime: selected,
      checkinTime: checkInText == null ? null : DateTime.parse(checkInText),
      checkoutTime: (row['checkout_time'] ?? row['check_out_time']) == null
          ? null
          : DateTime.parse(
              (row['checkout_time'] ?? row['check_out_time']) as String,
            ),
      arrivalLat: (row['check_in_latitude'] as num?)?.toDouble(),
      arrivalLong: (row['check_in_longitude'] as num?)?.toDouble(),
      checkoutLat: (row['check_out_latitude'] as num?)?.toDouble(),
      checkoutLong: (row['check_out_longitude'] as num?)?.toDouble(),
      gpsAccuracy: (gpsAccuracy as num?)?.toDouble(),
      checkoutAccuracy: (row['checkout_accuracy'] as num?)?.toDouble(),
      totalDurationMinutes:
          (row['visit_duration_minutes'] ?? row['time_spent_minutes']) as int?,
      status: (row['status'] ?? row['visit_status'] ?? 'Checked In') as String,
      geofenceStatus: (row['geofence_status'] as String?) ?? 'Checked In',
      pendingSync: false,
      syncedAt: DateTime.now(),
    );
  }

  static Future<bool> syncLocationLogs() async {
    if (_locationLogsSyncing) {
      debugPrint('[myQPMS FO Sync] Location log sync skipped: already running');
      return true;
    }
    final supabase = _client;
    if (supabase == null) {
      debugPrint(
        '[myQPMS FO Sync] Location log sync failed: Supabase client unavailable',
      );
      return false;
    }
    _locationLogsSyncing = true;
    List<FoLocationLog> logs;
    try {
      logs = await FoLocalStorage.getLocationLogs();
    } catch (error, stackTrace) {
      debugPrint('[myQPMS FO Sync] TRACKING_LOG_INSERT_FAILED: $error');
      debugPrintStack(stackTrace: stackTrace);
      _locationLogsSyncing = false;
      return false;
    }
    var changed = false;
    var ok = true;
    for (final log in logs.where((entry) => entry.pendingSync).take(50)) {
      try {
        final attendanceRemoteId = await _attendanceRemoteId(log.attendanceId);
        final taskRemoteId = await _taskRemoteId(log.taskId);
        final visitRemoteId = await _visitRemoteId(log.siteVisitId);
        final basePayload = {
          'fo_user_id': log.foId,
          'attendance_id': attendanceRemoteId,
          'task_id': taskRemoteId,
          'site_visit_id': visitRemoteId,
          'logged_at': log.timestamp.toIso8601String(),
          'latitude': log.latitude,
          'longitude': log.longitude,
          'accuracy': log.accuracy,
          'speed': log.speed,
          'battery_percentage': log.batteryPercentage,
          'is_mocked': log.isMocked,
          'source': 'mobile',
          'sync_status': 'synced',
          'local_id': log.id,
        };
        Map<String, dynamic> row;
        try {
          row = await supabase
              .from('fo_location_logs')
              .upsert({
                ...basePayload,
                'username': _usernameForFo(log.foId),
                'captured_at': log.timestamp.toIso8601String(),
              }, onConflict: 'local_id')
              .select('id')
              .single();
        } catch (error) {
          if (!_isMissingColumnError(error)) rethrow;
          debugPrint(
            '[myQPMS FO Sync] Location optional columns unavailable; retrying base location payload: $error',
          );
          row = await supabase
              .from('fo_location_logs')
              .upsert(basePayload, onConflict: 'local_id')
              .select('id')
              .single();
        }
        log
          ..remoteId = row['id'] as String?
          ..pendingSync = false
          ..syncedAt = DateTime.now();
        changed = true;
      } catch (error, stackTrace) {
        debugPrint('[myQPMS FO Sync] TRACKING_LOG_INSERT_FAILED: $error');
        debugPrintStack(stackTrace: stackTrace);
        ok = false;
        continue;
      }
    }
    if (changed) {
      try {
        await FoLocalStorage.saveLocationLogs(logs);
      } catch (error, stackTrace) {
        debugPrint('[myQPMS FO Sync] TRACKING_LOG_INSERT_FAILED: $error');
        debugPrintStack(stackTrace: stackTrace);
        _locationLogsSyncing = false;
        return false;
      }
    }
    _locationLogsSyncing = false;
    return ok;
  }

  static Future<void> syncTravelSegments() async {
    final supabase = _client;
    if (supabase == null) return;
    final segments = await FoLocalStorage.getTravelSegments();
    var changed = false;
    for (final segment
        in segments.where((entry) => entry.pendingSync).take(30)) {
      try {
        final attendanceRemoteId = await _attendanceRemoteId(
          segment.attendanceId,
        );
        final taskRemoteId = await _taskRemoteId(segment.taskId);
        final visitRemoteId = await _visitRemoteId(segment.siteVisitId);
        final row = await supabase
            .from('fo_travel_segments')
            .upsert({
              'fo_user_id': segment.foId,
              'attendance_id': attendanceRemoteId,
              'task_id': taskRemoteId,
              'site_visit_id': visitRemoteId,
              'from_lat': segment.fromLat,
              'from_lng': segment.fromLng,
              'to_lat': segment.toLat,
              'to_lng': segment.toLng,
              'straight_line_km': segment.straightLineKm,
              'route_km': segment.routeKm,
              'route_duration_minutes': segment.routeDurationMinutes,
              'google_route_polyline': segment.googleRoutePolyline,
              'distance_source': segment.distanceSource,
              'segment_status': segment.segmentStatus,
              'sync_status': 'synced',
              'local_id': segment.id,
            }, onConflict: 'local_id')
            .select('id')
            .single();
        segment
          ..remoteId = row['id'] as String?
          ..pendingSync = false
          ..syncedAt = DateTime.now();
        changed = true;
      } catch (error, stackTrace) {
        debugPrint('[myQPMS FO Sync] Travel segment sync failed: $error');
        debugPrintStack(stackTrace: stackTrace);
        break;
      }
    }
    if (changed) {
      await FoLocalStorage.saveTravelSegments(segments);
    }
  }

  static Future<void> syncTaskAttachments() async {
    final supabase = _client;
    if (supabase == null) return;
    final attachments = await FoLocalStorage.getTaskAttachments();
    var changed = false;
    for (final attachment
        in attachments.where((entry) => entry.pendingSync).take(10)) {
      try {
        final file = File(attachment.localPath);
        if (!await file.exists()) {
          attachment.pendingSync = false;
          changed = true;
          continue;
        }
        final taskRemoteId = await _taskRemoteId(attachment.taskId);
        final visitRemoteId = await _visitRemoteId(attachment.siteVisitId);
        final fileName =
            attachment.fileName ??
            attachment.localPath.split(Platform.pathSeparator).last;
        final objectPath =
            '${attachment.foId}/${attachment.siteVisitId ?? attachment.taskId ?? 'general'}/${attachment.id}-$fileName';
        await supabase.storage
            .from(attachment.storageBucket)
            .upload(
              objectPath,
              file,
              fileOptions: const FileOptions(upsert: true),
            );
        final publicUrl = supabase.storage
            .from(attachment.storageBucket)
            .getPublicUrl(objectPath);
        final row = await supabase
            .from('fo_task_attachments')
            .upsert({
              'fo_user_id': attachment.foId,
              'task_id': taskRemoteId,
              'site_visit_id': visitRemoteId,
              'site_id': attachment.siteId,
              'file_url': publicUrl,
              'file_name': fileName,
              'file_type': attachment.fileType,
              'file_size': await file.length(),
              'storage_bucket': attachment.storageBucket,
              'uploaded_at': attachment.uploadedAt.toIso8601String(),
              'sync_status': 'synced',
              'local_id': attachment.id,
            }, onConflict: 'local_id')
            .select('id')
            .single();
        attachment
          ..remoteId = row['id'] as String?
          ..fileUrl = publicUrl
          ..fileName = fileName
          ..fileSize = await file.length()
          ..pendingSync = false
          ..syncedAt = DateTime.now();
        changed = true;
      } catch (error, stackTrace) {
        debugPrint('[myQPMS FO Sync] Attachment sync failed: $error');
        debugPrintStack(stackTrace: stackTrace);
        break;
      }
    }
    if (changed) {
      await FoLocalStorage.saveTaskAttachments(attachments);
    }
  }

  static Future<void> syncConveyanceReport(FoAttendance attendance) async {
    final supabase = _client;
    if (supabase == null || attendance.remoteId == null) return;
    try {
      final tasks = await FoLocalStorage.getDailyTasks(
        date: attendance.loginTime,
      );
      final visits = await FoLocalStorage.getSiteVisits();
      final completedTasks = tasks
          .where((task) => task.status == 'completed')
          .length;
      final validVisits = visits
          .where((visit) => visit.attendanceId == attendance.id)
          .where((visit) => visit.geofenceStatus == 'Valid')
          .length;
      final routeKm = attendance.totalRouteKm;
      final eligibility = !attendance.isActive && routeKm > 0
          ? (validVisits > 0 ? 'Eligible' : 'Needs Review')
          : 'Needs Review';
      await supabase.from('fo_conveyance_reports').upsert({
        'report_date': _dateOnly(attendance.loginTime),
        'fo_user_id': attendance.foId,
        'attendance_id': attendance.remoteId,
        'login_time': attendance.loginTime.toIso8601String(),
        'logout_time': attendance.logoutTime?.toIso8601String(),
        'visits_count': validVisits,
        'completed_tasks_count': completedTasks,
        'raw_km': routeKm,
        'approved_km': eligibility == 'Eligible' ? routeKm : 0,
        'rate_per_km': 4,
        'eligibility_status': eligibility,
        'approval_status': 'Pending',
        'reason': eligibility == 'Eligible'
            ? 'GPS trace and valid geofence visit available.'
            : 'Needs manager review for missing/weak GPS or geofence data.',
      }, onConflict: 'attendance_id');
      debugPrint('[myQPMS FO Sync] Conveyance report synced');
    } catch (error, stackTrace) {
      debugPrint('[myQPMS FO Sync] Conveyance sync failed: $error');
      debugPrintStack(stackTrace: stackTrace);
    }
  }

  static Future<bool> upsertLiveStatus({
    required String foId,
    FoAttendance? attendance,
    String? activeTaskId,
    String? activeSiteVisitId,
    required bool isOnline,
    required bool isTracking,
    required String currentStatus,
    double? latitude,
    double? longitude,
    double? accuracy,
    double? speed,
    double? heading,
    int? batteryPercentage,
    double routeKmToday = 0,
    DateTime? lastSeenAt,
  }) async {
    final supabase = _client;
    if (supabase == null) {
      debugPrint(
        '[myQPMS FO Sync] Live status sync failed: Supabase client unavailable',
      );
      return false;
    }
    try {
      if (attendance != null && attendance.remoteId == null) {
        final attendanceSynced = await syncAttendance(attendance);
        if (!attendanceSynced) {
          debugPrint(
            '[myQPMS FO Sync] Live status sync continuing without remote attendance id',
          );
        }
      }
      final attendanceRemoteId =
          attendance?.remoteId ?? await _attendanceRemoteId(attendance?.id);
      final taskRemoteId = await _taskRemoteId(activeTaskId);
      final visitRemoteId = await _visitRemoteId(activeSiteVisitId);
      final basePayload = {
        'fo_user_id': foId,
        'attendance_id': attendanceRemoteId,
        'active_task_id': taskRemoteId,
        'active_site_visit_id': visitRemoteId,
        'is_online': isOnline,
        'is_tracking': isTracking,
        'current_status': currentStatus,
        'latitude': latitude,
        'longitude': longitude,
        'accuracy': accuracy,
        'speed': speed,
        'heading': heading,
        'battery_percentage': batteryPercentage,
        'route_km_today': routeKmToday,
        'last_seen_at': (lastSeenAt ?? DateTime.now()).toIso8601String(),
        'source': 'mobile',
        'sync_status': 'synced',
      };
      try {
        await supabase.from('fo_live_status').upsert({
          ...basePayload,
          'username': _usernameForFo(foId),
          'display_name': _displayNameForFo(foId),
        }, onConflict: 'fo_user_id');
      } catch (error) {
        if (!_isMissingColumnError(error)) rethrow;
        debugPrint(
          '[myQPMS FO Sync] Live status optional profile columns unavailable; retrying base live status payload: $error',
        );
        await supabase
            .from('fo_live_status')
            .upsert(basePayload, onConflict: 'fo_user_id');
      }
      debugPrint('[myQPMS FO Sync] Live status synced: $foId / $currentStatus');
      return true;
    } catch (error, stackTrace) {
      debugPrint(
        '[myQPMS FO Sync] Live status sync failed. Check fo_live_status table/columns: $error',
      );
      debugPrintStack(stackTrace: stackTrace);
      return false;
    }
  }

  static Future<void> syncPending() async {
    for (final attendance in await FoLocalStorage.getAttendanceHistory()) {
      if (attendance.pendingSync || attendance.remoteId == null) {
        await syncAttendance(attendance);
      }
    }
    for (final task in await FoLocalStorage.getDailyTasks()) {
      if (task.pendingSync) await syncDailyTask(task);
    }
    for (final visit in await FoLocalStorage.getSiteVisits()) {
      if (visit.pendingSync) await syncSiteVisit(visit);
    }
    await syncTravelSegments();
    await syncTaskAttachments();
    await syncLocationLogs();
    for (final attendance in await FoLocalStorage.getAttendanceHistory()) {
      if (!attendance.isActive) {
        await syncConveyanceReport(attendance);
      }
    }
  }

  static Future<String?> _attendanceRemoteId(String? localId) async {
    if (localId == null) return null;
    final active = await FoLocalStorage.getActiveAttendance();
    if (active?.id == localId) {
      if (active?.remoteId == null) await syncAttendance(active!);
      return active?.remoteId;
    }
    final history = await FoLocalStorage.getAttendanceHistory();
    final attendance = history.cast<FoAttendance?>().firstWhere(
      (item) => item?.id == localId,
      orElse: () => null,
    );
    if (attendance != null && attendance.remoteId == null) {
      await syncAttendance(attendance);
    }
    return attendance?.remoteId;
  }

  static Future<String?> _taskRemoteId(String? localId) async {
    if (localId == null) return null;
    final task = (await FoLocalStorage.getDailyTasks())
        .cast<FoDailyTask?>()
        .firstWhere((item) => item?.id == localId, orElse: () => null);
    if (task != null && task.remoteId == null) {
      await syncDailyTask(task);
    }
    return task?.remoteId;
  }

  static Future<String?> _visitRemoteId(String? localId) async {
    if (localId == null) return null;
    final visit = (await FoLocalStorage.getSiteVisits())
        .cast<FoSiteVisit?>()
        .firstWhere((item) => item?.id == localId, orElse: () => null);
    if (visit != null && visit.remoteId == null) {
      await syncSiteVisit(visit);
    }
    return visit?.remoteId;
  }

  static String _dateOnly(DateTime value) =>
      '${value.year.toString().padLeft(4, '0')}-'
      '${value.month.toString().padLeft(2, '0')}-'
      '${value.day.toString().padLeft(2, '0')}';
}
