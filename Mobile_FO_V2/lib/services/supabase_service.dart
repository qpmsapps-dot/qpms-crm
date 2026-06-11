import 'package:supabase_flutter/supabase_flutter.dart';

import '../models/fo_models.dart';
import '../utils/date_utils.dart';
import 'config_service.dart';
import 'crash_log_service.dart';

class DuplicateEmployeeIdException implements Exception {
  const DuplicateEmployeeIdException();

  static const message =
      'Employee ID already registered. Please contact admin.';

  @override
  String toString() => message;
}

class SupabaseService {
  static bool _initialized = false;
  static bool _runtimeConfigured = false;

  static bool get isReady =>
      _initialized && (AppConfig.hasSupabase || _runtimeConfigured);
  static SupabaseClient get client => Supabase.instance.client;

  static Future<void> initialize() async {
    if (_initialized || !AppConfig.hasSupabase) return;
    await initializeWithCredentials(
      url: AppConfig.supabaseUrl.trim(),
      anonKey: AppConfig.supabaseAnonKey.trim(),
    );
  }

  static Future<void> initializeWithCredentials({
    required String url,
    required String anonKey,
  }) async {
    final cleanUrl = url.trim();
    final cleanAnonKey = anonKey.trim();
    if (_initialized) return;
    if (cleanUrl.isEmpty || cleanAnonKey.isEmpty) return;
    try {
      await Supabase.initialize(url: cleanUrl, anonKey: cleanAnonKey);
      _initialized = true;
      _runtimeConfigured = true;
    } catch (error, stackTrace) {
      await CrashLogService.record(
        screen: 'supabase',
        action: 'SUPABASE_INITIALIZE_FAILED',
        error: error,
        stackTrace: stackTrace,
      );
      rethrow;
    }
  }

  static Future<FoUser> register({
    required String fullName,
    required String employeeId,
    required String mobile,
    required String email,
    required String birthDate,
    required String gender,
    required String state,
    required String department,
    required String designation,
    String? business,
    required String password,
  }) async {
    final cleanFullName = fullName.trim();
    final cleanEmployeeId = employeeId.trim();
    final cleanEmail = email.trim().toLowerCase();
    final cleanMobile = _digits(mobile);
    final cleanBirthDate = birthDate.trim();
    final cleanGender = gender.trim();
    final cleanState = state.trim();
    final cleanDepartment = department.trim();
    final cleanDesignation = designation.trim();
    final cleanBusiness = business?.trim();

    if (cleanEmployeeId.isEmpty) {
      throw ArgumentError('Employee ID is required.');
    }

    final existingProfile = await client
        .from('profiles')
        .select('id')
        .ilike('employee_code', cleanEmployeeId)
        .maybeSingle();
    if (existingProfile != null) {
      throw const DuplicateEmployeeIdException();
    }

    final auth = await client.auth.signUp(
      email: cleanEmail,
      password: password,
      data: {
        'employee_code': cleanEmployeeId,
        'username': cleanEmployeeId,
        'full_name': cleanFullName,
        'display_name': cleanFullName,
        'mobile': cleanMobile,
        'birth_date': cleanBirthDate,
        'gender': cleanGender,
        'state': cleanState,
        'department': cleanDepartment,
        'designation': cleanDesignation,
        'business': cleanBusiness?.isEmpty == true ? null : cleanBusiness,
        'role': 'FO',
        'status': 'Active',
        'is_active': true,
      },
    );
    final authUser = auth.user;
    if (authUser == null) {
      throw StateError('Registration did not return an auth user.');
    }
    await client.from('profiles').upsert({
      'auth_user_id': authUser.id,
      'employee_code': cleanEmployeeId,
      'username': cleanEmployeeId,
      'full_name': cleanFullName,
      'display_name': cleanFullName,
      'mobile': cleanMobile,
      'email': cleanEmail,
      'birth_date': cleanBirthDate,
      'gender': cleanGender,
      'state': cleanState,
      'department': cleanDepartment,
      'designation': cleanDesignation,
      'business': cleanBusiness?.isEmpty == true ? null : cleanBusiness,
      'role': 'FO',
      'status': 'Active',
      'is_active': true,
    }, onConflict: 'auth_user_id');
    return fetchCurrentProfile();
  }

  static Future<FoUser> login({
    required String mobile,
    required String password,
  }) async {
    final email = await _resolveEmail(_digits(mobile));
    await client.auth.signInWithPassword(email: email, password: password);
    return fetchCurrentProfile();
  }

  static Future<String> _resolveEmail(String mobile) async {
    try {
      final value = await client.rpc(
        'rpc_resolve_fo_login_email',
        params: {'p_mobile': mobile},
      );
      final email = value?.toString().trim() ?? '';
      if (email.isNotEmpty) return email;
    } catch (_) {
      // Fall back to profile lookup when the RPC is unavailable.
    }
    final row = await client
        .from('profiles')
        .select('email')
        .eq('mobile', mobile)
        .eq('role', 'FO')
        .maybeSingle();
    final email = row == null ? '' : row['email']?.toString().trim() ?? '';
    if (email.isEmpty) throw StateError('No active FO found for this mobile.');
    return email;
  }

  static Future<FoUser> fetchCurrentProfile() async {
    final authUser = client.auth.currentUser;
    if (authUser == null) throw StateError('No active Supabase session.');
    final row = await client
        .from('profiles')
        .select(
          'id, auth_user_id, employee_code, username, full_name, display_name, mobile, email, state, role, department, designation, business',
        )
        .eq('auth_user_id', authUser.id)
        .maybeSingle();
    if (row == null) throw StateError('FO profile not found.');
    final user = FoUser.fromJson(Map<String, dynamic>.from(row));
    if (user.employeeCode.isEmpty) {
      throw StateError('FO employee_code is missing.');
    }
    return user;
  }

  static Future<String?> createAttendance(
    Attendance attendance,
    FoUser user,
  ) async {
    try {
      final row = await client
          .from('fo_attendance')
          .insert({
            'fo_user_id': user.employeeCode,
            'username': user.employeeCode,
            'display_name': user.fullName,
            'attendance_date':
                attendance.attendanceDate ?? indiaDateKey(attendance.startTime),
            'login_time': attendance.startTime.toUtc().toIso8601String(),
            'start_latitude': attendance.startLat,
            'start_longitude': attendance.startLng,
            'start_battery_percentage': attendance.batteryStart,
            'status': 'Active',
            'local_id': attendance.id,
          })
          .select('id')
          .maybeSingle();
      await CrashLogService.record(
        employeeCode: user.employeeCode,
        screen: 'home',
        action: 'ATTENDANCE_CREATE_SUCCESS',
      );
      return row?['id']?.toString();
    } catch (error, stackTrace) {
      await CrashLogService.record(
        employeeCode: user.employeeCode,
        screen: 'home',
        action: 'ATTENDANCE_CREATE_FAILED',
        error: error,
        stackTrace: stackTrace,
      );
      rethrow;
    }
  }

  static Future<Attendance?> findActiveAttendanceForToday(FoUser user) async {
    final today = indiaDateKey(DateTime.now());
    final rows = await client
        .from('fo_attendance')
        .select('*')
        .eq('fo_user_id', user.employeeCode)
        .eq('attendance_date', today)
        .eq('status', 'Active')
        .filter('logout_time', 'is', null)
        .order('login_time', ascending: false)
        .limit(10);
    final records = List<Map<String, dynamic>>.from(rows);
    if (records.isEmpty) return null;
    final latest = _attendanceFromRow(records.first, user);
    final older = records
        .skip(1)
        .map((row) => row['id']?.toString())
        .where((id) => id != null && id.isNotEmpty);
    for (final id in older) {
      try {
        await client
            .from('fo_attendance')
            .update({
              'status': 'Duplicate',
              'updated_at': DateTime.now().toUtc().toIso8601String(),
            })
            .eq('id', id!);
      } catch (error, stackTrace) {
        await CrashLogService.record(
          employeeCode: user.employeeCode,
          screen: 'home',
          action: 'START_DAY_DUPLICATE_CLEANUP_FAILED',
          error: error,
          stackTrace: stackTrace,
        );
      }
    }
    return latest;
  }

  static Future<Attendance?> findOpenActiveAttendance(FoUser user) async {
    final rows = await client
        .from('fo_attendance')
        .select('*')
        .eq('fo_user_id', user.employeeCode)
        .eq('status', 'Active')
        .filter('logout_time', 'is', null)
        .order('login_time', ascending: false)
        .limit(1);
    final records = List<Map<String, dynamic>>.from(rows);
    if (records.isEmpty) return null;
    return _attendanceFromRow(records.first, user);
  }

  static Future<Attendance?> findCompletedAttendanceForToday(
    FoUser user,
  ) async {
    final today = indiaDateKey(DateTime.now());
    final rows = await client
        .from('fo_attendance')
        .select('*')
        .eq('fo_user_id', user.employeeCode)
        .eq('attendance_date', today)
        .eq('status', 'Completed')
        .order('login_time', ascending: false)
        .limit(1);
    final records = List<Map<String, dynamic>>.from(rows);
    if (records.isEmpty) return null;
    return _attendanceFromRow(records.first, user);
  }

  static Future<SiteVisit?> findActiveSiteVisitForAttendance({
    required FoUser user,
    required Attendance attendance,
  }) async {
    final attendanceId = attendance.remoteId?.trim();
    if (!isValidUuid(attendanceId)) return null;
    final rows = await client
        .from('fo_site_visits')
        .select('*')
        .eq('fo_user_id', user.employeeCode)
        .eq('attendance_id', attendanceId!)
        .filter('checkout_time', 'is', null)
        .order('check_in_time', ascending: false)
        .limit(1);
    final records = List<Map<String, dynamic>>.from(rows);
    if (records.isEmpty) return null;
    return SiteVisit.fromJson(records.first);
  }

  static Future<int> countOpenSiteVisitsForAttendance({
    required FoUser user,
    required Attendance attendance,
  }) async {
    final attendanceId = attendance.remoteId?.trim();
    if (!isValidUuid(attendanceId)) return 0;
    final rows = await client
        .from('fo_site_visits')
        .select('id')
        .eq('fo_user_id', user.employeeCode)
        .eq('attendance_id', attendanceId!)
        .filter('checkout_time', 'is', null)
        .limit(100);
    return List<Map<String, dynamic>>.from(rows).length;
  }

  static Future<void> reopenAttendanceForToday(Attendance attendance) async {
    final id = attendance.remoteId;
    if (id == null || id.isEmpty) return;
    await client
        .from('fo_attendance')
        .update({
          'status': 'Active',
          'logout_time': null,
          'updated_at': DateTime.now().toUtc().toIso8601String(),
        })
        .eq('id', id);
    attendance.endTime = null;
  }

  static Future<void> endAttendance(Attendance attendance) async {
    final id = attendance.remoteId;
    if (id == null || id.isEmpty) return;
    try {
      await _syncAttendanceRouteKmFromVisits(attendance);
      await client
          .from('fo_attendance')
          .update({
            'logout_time': attendance.endTime?.toUtc().toIso8601String(),
            'end_latitude': attendance.endLat,
            'end_longitude': attendance.endLng,
            'end_battery_percentage': attendance.batteryEnd,
            'actual_km': attendance.totalRouteKm,
            'eligible_km': attendance.eligibleKm,
            'total_raw_km': attendance.actualKm,
            'total_route_km': attendance.totalRouteKm,
            'total_approved_km': attendance.eligibleKm,
            'rate_per_km': 4,
            'petrol_amount': attendance.eligibleKm * 4,
            'status': 'Completed',
          })
          .eq('id', id);
      await CrashLogService.record(
        employeeCode: attendance.employeeCode,
        screen: 'home',
        action: 'ATTENDANCE_END_UPDATE_SUCCESS',
      );
      await CrashLogService.record(
        employeeCode: attendance.employeeCode,
        screen: 'tracking',
        action: 'ATTENDANCE_KM_UPDATE_SUCCESS',
        error:
            'attendance_id=$id actual_km=${attendance.actualKm} total_raw_km=${attendance.actualKm} total_route_km=${attendance.totalRouteKm}',
      );
      await CrashLogService.record(
        employeeCode: attendance.employeeCode,
        screen: 'tracking',
        action: 'ROUTE_KM_ATTENDANCE_UPDATED',
        error:
            'attendance_uuid=$id total_route_km=${attendance.totalRouteKm} eligible_km=${attendance.eligibleKm} petrol_amount=${attendance.eligibleKm * 4}',
      );
    } catch (error, stackTrace) {
      await CrashLogService.record(
        employeeCode: attendance.employeeCode,
        screen: 'home',
        action: 'ATTENDANCE_END_UPDATE_FAILED',
        error: error,
        stackTrace: stackTrace,
      );
      await CrashLogService.record(
        employeeCode: attendance.employeeCode,
        screen: 'home',
        action: 'ATTENDANCE_UPDATE_FAILED',
        error: error,
        stackTrace: stackTrace,
      );
      rethrow;
    }
  }

  static Future<Attendance> endCurrentActiveAttendance({
    required FoUser user,
    required Attendance attendance,
  }) async {
    final remoteActive = await findOpenActiveAttendance(user);
    if (remoteActive == null || !isValidUuid(remoteActive.remoteId)) {
      throw StateError('No active attendance found in Supabase.');
    }
    attendance.remoteId = remoteActive.remoteId;
    await _syncAttendanceRouteKmFromVisits(attendance);
    final id = remoteActive.remoteId!;
    final logoutTime = attendance.endTime ?? DateTime.now();
    final rows = await client
        .from('fo_attendance')
        .update({
          'logout_time': logoutTime.toUtc().toIso8601String(),
          'end_latitude': attendance.endLat,
          'end_longitude': attendance.endLng,
          'end_battery_percentage': attendance.batteryEnd,
          'actual_km': attendance.totalRouteKm,
          'eligible_km': attendance.eligibleKm,
          'total_raw_km': attendance.actualKm,
          'total_route_km': attendance.totalRouteKm,
          'total_approved_km': attendance.eligibleKm,
          'rate_per_km': 4,
          'petrol_amount': attendance.eligibleKm * 4,
          'status': 'Completed',
          'updated_at': DateTime.now().toUtc().toIso8601String(),
        })
        .eq('id', id)
        .eq('fo_user_id', user.employeeCode)
        .eq('status', 'Active')
        .filter('logout_time', 'is', null)
        .select('*');
    final records = List<Map<String, dynamic>>.from(rows);
    if (records.length != 1) {
      throw StateError(
        'End Day attendance update affected ${records.length} rows.',
      );
    }
    return _attendanceFromRow(records.first, user);
  }

  static Future<void> updateEndDayLiveStatus({
    required FoUser user,
    double? latitude,
    double? longitude,
    double? accuracy,
    double? speed,
    double? routeKm,
    String? attendanceId,
  }) async {
    final payload = <String, dynamic>{
      'fo_user_id': user.employeeCode,
      'username': user.employeeCode,
      'display_name': user.fullName,
      'attendance_id': _uuidOrNull(attendanceId),
      'active_site_visit_id': null,
      'active_task_id': null,
      'is_online': false,
      'is_tracking': false,
      'current_status': 'Offline',
      'last_seen_at': DateTime.now().toUtc().toIso8601String(),
      'source': 'mobile',
      'sync_status': 'synced',
      'updated_at': DateTime.now().toUtc().toIso8601String(),
    };
    if (latitude != null) payload['latitude'] = latitude;
    if (longitude != null) payload['longitude'] = longitude;
    if (accuracy != null) payload['accuracy'] = accuracy;
    if (speed != null) payload['speed'] = speed;
    if (routeKm != null) payload['route_km_today'] = routeKm;
    dynamic rows;
    try {
      rows = await client
          .from('fo_live_status')
          .upsert(payload, onConflict: 'fo_user_id')
          .select('fo_user_id');
    } on PostgrestException catch (error) {
      if (error.code != '42703' || !payload.containsKey('active_task_id')) {
        rethrow;
      }
      payload.remove('active_task_id');
      rows = await client
          .from('fo_live_status')
          .upsert(payload, onConflict: 'fo_user_id')
          .select('fo_user_id');
    }
    if (List<Map<String, dynamic>>.from(rows).isEmpty) {
      throw StateError('End Day live status update returned 0 rows.');
    }
  }

  static Future<void> updateAttendanceKm(Attendance attendance) async {
    final id = attendance.remoteId?.trim();
    if (id == null || id.isEmpty) {
      await CrashLogService.record(
        employeeCode: attendance.employeeCode,
        screen: 'tracking',
        action: 'ATTENDANCE_KM_UPDATE_SKIPPED_NO_REMOTE_ID',
        error: 'local_id=${attendance.id} km=${attendance.actualKm}',
      );
      return;
    }
    if (!isValidUuid(id)) {
      await CrashLogService.record(
        employeeCode: attendance.employeeCode,
        screen: 'tracking',
        action: 'ATTENDANCE_KM_UPDATE_FAILED',
        error:
            'Invalid attendance UUID: remote_id=$id local_id=${attendance.id}',
      );
      return;
    }
    try {
      await _syncAttendanceRouteKmFromVisits(attendance);
      final payload = {
        'actual_km': attendance.totalRouteKm,
        'eligible_km': attendance.eligibleKm,
        'total_raw_km': attendance.actualKm,
        'total_route_km': attendance.totalRouteKm,
        'total_approved_km': attendance.eligibleKm,
        'rate_per_km': 4,
        'petrol_amount': attendance.eligibleKm * 4,
        'updated_at': DateTime.now().toUtc().toIso8601String(),
      };
      await CrashLogService.record(
        employeeCode: attendance.employeeCode,
        screen: 'tracking',
        action: 'ATTENDANCE_KM_UPDATE_QUERY_START',
        error:
            'attendance_uuid=$id local_id=${attendance.id} actual_km=${attendance.actualKm} total_raw_km=${attendance.actualKm} total_route_km=${attendance.totalRouteKm} total_approved_km=${attendance.eligibleKm}',
      );
      final response = await client
          .from('fo_attendance')
          .update(payload)
          .eq('id', id)
          .select(
            'id, actual_km, total_raw_km, total_route_km, total_approved_km, updated_at',
          );
      final rows = List<Map<String, dynamic>>.from(response);
      if (rows.isEmpty) {
        throw StateError(
          'fo_attendance KM update matched 0 rows for attendance_uuid=$id',
        );
      }
      final row = rows.first;
      await CrashLogService.record(
        employeeCode: attendance.employeeCode,
        screen: 'tracking',
        action: 'ATTENDANCE_KM_UPDATE_SUCCESS',
        error:
            'attendance_uuid=${row['id']} actual_km=${row['actual_km']} total_raw_km=${row['total_raw_km']} total_route_km=${row['total_route_km']} total_approved_km=${row['total_approved_km']} updated_at=${row['updated_at']}',
      );
      await CrashLogService.record(
        employeeCode: attendance.employeeCode,
        screen: 'tracking',
        action: 'ROUTE_KM_ATTENDANCE_UPDATED',
        error:
            'attendance_uuid=$id total_route_km=${attendance.totalRouteKm} eligible_km=${attendance.eligibleKm} petrol_amount=${attendance.eligibleKm * 4}',
      );
    } catch (error, stackTrace) {
      await CrashLogService.record(
        employeeCode: attendance.employeeCode,
        screen: 'tracking',
        action: 'ATTENDANCE_KM_UPDATE_FAILED',
        error: error,
        stackTrace: stackTrace,
      );
      rethrow;
    }
  }

  static Future<void> _syncAttendanceRouteKmFromVisits(
    Attendance attendance,
  ) async {
    final id = attendance.remoteId?.trim();
    if (!isValidUuid(id)) return;
    final rows = await client
        .from('fo_site_visits')
        .select('id, route_km')
        .eq('attendance_id', id!)
        .not('route_km', 'is', null)
        .order('check_in_time', ascending: true);
    final visits = List<Map<String, dynamic>>.from(rows);
    var totalRouteKm = 0.0;
    for (final row in visits) {
      final routeKm = _double(row['route_km']);
      if (routeKm == null || routeKm <= 0 || !routeKm.isFinite) continue;
      totalRouteKm += routeKm;
      await CrashLogService.record(
        employeeCode: attendance.employeeCode,
        screen: 'tracking',
        action: 'ROUTE_KM_SITE_VISIT_FOUND',
        error:
            'attendance_uuid=$id site_visit_id=${row['id']} route_km=$routeKm',
      );
    }
    totalRouteKm = double.parse(totalRouteKm.toStringAsFixed(2));
    attendance
      ..totalRouteKm = totalRouteKm
      ..eligibleKm = totalRouteKm;
    await CrashLogService.record(
      employeeCode: attendance.employeeCode,
      screen: 'tracking',
      action: 'ROUTE_KM_ATTENDANCE_CANONICAL_SUM',
      error:
          'attendance_uuid=$id visits=${visits.length} total_route_km=$totalRouteKm eligible_km=$totalRouteKm',
    );
  }

  static Attendance _attendanceFromRow(Map<String, dynamic> row, FoUser user) {
    return Attendance(
      id: row['local_id']?.toString() ?? row['id']?.toString() ?? '',
      remoteId: row['id']?.toString(),
      employeeCode:
          row['fo_user_id']?.toString() ??
          row['employee_code']?.toString() ??
          user.employeeCode,
      attendanceDate: row['attendance_date']?.toString(),
      startTime:
          DateTime.tryParse(row['login_time']?.toString() ?? '')?.toLocal() ??
          DateTime.now(),
      endTime: DateTime.tryParse(
        row['logout_time']?.toString() ?? '',
      )?.toLocal(),
      startLat: _double(row['start_latitude']),
      startLng: _double(row['start_longitude']),
      endLat: _double(row['end_latitude']),
      endLng: _double(row['end_longitude']),
      batteryStart:
          _int(row['battery_start']) ?? _int(row['start_battery_percentage']),
      batteryEnd:
          _int(row['battery_end']) ?? _int(row['end_battery_percentage']),
      actualKm: _double(row['actual_km']) ?? _double(row['total_raw_km']) ?? 0,
      eligibleKm:
          _double(row['eligible_km']) ?? _double(row['total_approved_km']) ?? 0,
      totalRouteKm:
          _double(row['total_route_km']) ??
          _double(row['eligible_km']) ??
          _double(row['total_approved_km']) ??
          0,
    );
  }

  static double? _double(Object? value) {
    if (value == null) return null;
    if (value is num) return value.toDouble();
    return double.tryParse(value.toString());
  }

  static int? _int(Object? value) {
    if (value == null) return null;
    if (value is num) return value.toInt();
    return int.tryParse(value.toString());
  }

  static Future<String?> insertLocation(LocationLog log) async {
    final attendanceId = _uuidOrNull(log.attendanceId);
    if (attendanceId == null) {
      await CrashLogService.record(
        employeeCode: log.employeeCode,
        screen: 'tracking',
        action: 'LOCATION_LOG_SKIPPED_NO_ATTENDANCE_ID',
        error: 'attendance_id=${log.attendanceId}',
      );
      return null;
    }
    try {
      final row = await client
          .from('fo_location_logs')
          .insert(_locationPayload(log, attendanceId))
          .select('id')
          .maybeSingle();
      await CrashLogService.record(
        employeeCode: log.employeeCode,
        screen: 'tracking',
        action: 'LOCATION_LOG_INSERT_SUCCESS',
      );
      return row?['id']?.toString();
    } catch (error, stackTrace) {
      if (error is PostgrestException && error.code == '23505') {
        await CrashLogService.record(
          employeeCode: log.employeeCode,
          screen: 'tracking',
          action: 'LOCATION_LOG_DUPLICATE_LOCAL_ID_SKIPPED',
          error: 'local_id=${log.id}',
        );
        return null;
      }
      await CrashLogService.record(
        employeeCode: log.employeeCode,
        screen: 'tracking',
        action: 'LOCATION_LOG_INSERT_FAILED',
        error: error,
        stackTrace: stackTrace,
      );
      rethrow;
    }
  }

  static Future<Map<String, String?>> insertLocationBatch(
    List<LocationLog> logs,
  ) async {
    final validLogs = <LocationLog>[];
    final payload = <Map<String, dynamic>>[];
    for (final log in logs) {
      final attendanceId = _uuidOrNull(log.attendanceId);
      if (attendanceId == null) {
        await CrashLogService.record(
          employeeCode: log.employeeCode,
          screen: 'tracking',
          action: 'LOCATION_LOG_SKIPPED_NO_ATTENDANCE_ID',
          error: 'attendance_id=${log.attendanceId}',
        );
        continue;
      }
      validLogs.add(log);
      payload.add(_locationPayload(log, attendanceId));
    }
    if (validLogs.isEmpty) return {};
    try {
      final rows = await client
          .from('fo_location_logs')
          .insert(payload)
          .select('id, local_id');
      final result = <String, String?>{};
      for (final row in List<Map<String, dynamic>>.from(rows)) {
        final localId = row['local_id']?.toString();
        if (localId == null || localId.isEmpty) continue;
        result[localId] = row['id']?.toString();
      }
      for (final log in validLogs) {
        result.putIfAbsent(log.id, () => null);
      }
      await CrashLogService.record(
        screen: 'tracking',
        action: 'GPS_LOG_BATCH_SYNCED',
        error: 'count=${result.length}',
      );
      return result;
    } catch (error, stackTrace) {
      await CrashLogService.record(
        screen: 'tracking',
        action: 'GPS_LOG_SYNC_FAILED',
        error: error,
        stackTrace: stackTrace,
      );
      final result = <String, String?>{};
      for (final log in validLogs) {
        try {
          result[log.id] = await insertLocation(log);
        } catch (_) {
          break;
        }
      }
      return result;
    }
  }

  static Map<String, dynamic> _locationPayload(
    LocationLog log,
    String attendanceId,
  ) {
    return {
      'fo_user_id': log.employeeCode,
      'username': log.employeeCode,
      'attendance_id': attendanceId,
      'latitude': log.latitude,
      'longitude': log.longitude,
      'accuracy': log.accuracy,
      'speed': log.speed,
      'battery_percentage': log.battery,
      'logged_at': log.capturedAt.toUtc().toIso8601String(),
      'captured_at': log.capturedAt.toUtc().toIso8601String(),
      'local_id': log.id,
      'source': 'mobile',
      'sync_status': 'synced',
    };
  }

  static Future<List<LocationLog>> fetchLocationLogsForAttendance({
    required FoUser user,
    required String attendanceId,
  }) async {
    if (!isValidUuid(attendanceId)) return [];
    final rows = await client
        .from('fo_location_logs')
        .select('*')
        .eq('fo_user_id', user.employeeCode)
        .eq('attendance_id', attendanceId)
        .order('captured_at', ascending: true)
        .limit(10000);
    return List<Map<String, dynamic>>.from(
      rows,
    ).map(_locationLogFromRow).toList();
  }

  static Future<List<LocationLog>> fetchLocationLogsForRange({
    required FoUser user,
    required DateTime from,
    required DateTime to,
  }) async {
    final rows = await client
        .from('fo_location_logs')
        .select('*')
        .eq('fo_user_id', user.employeeCode)
        .gte('captured_at', from.toUtc().toIso8601String())
        .lte('captured_at', to.toUtc().toIso8601String())
        .order('captured_at', ascending: true)
        .limit(10000);
    return List<Map<String, dynamic>>.from(
      rows,
    ).map(_locationLogFromRow).toList();
  }

  static LocationLog _locationLogFromRow(Map<String, dynamic> row) =>
      LocationLog(
        id: row['local_id']?.toString() ?? row['id']?.toString() ?? '',
        remoteId: row['id']?.toString(),
        employeeCode: row['fo_user_id']?.toString() ?? '',
        attendanceId: row['attendance_id']?.toString() ?? '',
        latitude: _double(row['latitude']) ?? 0,
        longitude: _double(row['longitude']) ?? 0,
        accuracy: _double(row['accuracy']),
        speed: _double(row['speed']),
        battery: _int(row['battery_percentage']),
        capturedAt:
            DateTime.tryParse(
              row['captured_at']?.toString() ??
                  row['logged_at']?.toString() ??
                  '',
            )?.toLocal() ??
            DateTime.now(),
        synced: true,
      );

  static Future<void> updateLiveStatus({
    required FoUser user,
    required bool isTracking,
    required String status,
    bool? isOnline,
    double? latitude,
    double? longitude,
    double? accuracy,
    double? speed,
    int? battery,
    double? routeKm,
    String? attendanceId,
    String? activeSiteVisitId,
    bool clearActiveSiteVisit = false,
  }) async {
    await CrashLogService.record(
      employeeCode: user.employeeCode,
      screen: 'tracking',
      action: 'LIVE_STATUS_UPSERT_START',
    );
    try {
      final payload = <String, dynamic>{
        'fo_user_id': user.employeeCode,
        'username': user.employeeCode,
        'display_name': user.fullName,
        'battery_percentage': battery,
        'last_seen_at': DateTime.now().toUtc().toIso8601String(),
        'is_online': isOnline ?? isTracking,
        'is_tracking': isTracking,
        'current_status': status,
        'source': 'mobile',
        'sync_status': 'synced',
        'updated_at': DateTime.now().toUtc().toIso8601String(),
      };
      if (latitude != null) payload['latitude'] = latitude;
      if (longitude != null) payload['longitude'] = longitude;
      if (accuracy != null) payload['accuracy'] = accuracy;
      if (speed != null) payload['speed'] = speed;
      if (routeKm != null) payload['route_km_today'] = routeKm;
      final validAttendanceId = _uuidOrNull(attendanceId);
      final validSiteVisitId = _uuidOrNull(activeSiteVisitId);
      if (validAttendanceId != null) {
        payload['attendance_id'] = validAttendanceId;
      }
      if (clearActiveSiteVisit) {
        payload['active_site_visit_id'] = null;
      } else if (validSiteVisitId != null) {
        payload['active_site_visit_id'] = validSiteVisitId;
      }
      if (latitude == null || longitude == null) {
        await CrashLogService.record(
          employeeCode: user.employeeCode,
          screen: 'tracking',
          action: 'LIVE_STATUS_NULL_COORDINATE_PROTECTED',
        );
      }
      await client
          .from('fo_live_status')
          .upsert(payload, onConflict: 'fo_user_id');
      await CrashLogService.record(
        employeeCode: user.employeeCode,
        screen: 'tracking',
        action: 'LIVE_STATUS_UPSERT_SUCCESS',
      );
      await CrashLogService.record(
        employeeCode: user.employeeCode,
        screen: 'tracking',
        action: 'LIVE_STATUS_UPDATED',
      );
      if (routeKm != null) {
        await CrashLogService.record(
          employeeCode: user.employeeCode,
          screen: 'tracking',
          action: 'ROUTE_KM_LIVE_STATUS_UPDATED',
          error: 'route_km_today=$routeKm',
        );
      }
    } catch (error, stackTrace) {
      await CrashLogService.record(
        employeeCode: user.employeeCode,
        screen: 'tracking',
        action: 'LIVE_STATUS_UPSERT_FAILED',
        error: error,
        stackTrace: stackTrace,
      );
      rethrow;
    }
  }

  static Future<void> updateCheckInLiveStatus({
    required FoUser user,
    required SiteVisit visit,
    double? latitude,
    double? longitude,
    double? accuracy,
  }) async {
    await CrashLogService.record(
      employeeCode: user.employeeCode,
      screen: 'tasks',
      action: 'CHECKIN_LIVE_STATUS_UPDATE_START',
    );
    try {
      final payload = <String, dynamic>{
        'fo_user_id': user.employeeCode,
        'username': user.employeeCode,
        'display_name': user.fullName,
        'attendance_id': _uuidOrNull(visit.attendanceId),
        'active_site_visit_id': _uuidOrNull(visit.remoteId),
        'is_online': true,
        'is_tracking': false,
        'current_status': 'On Site Visit',
        'last_seen_at': DateTime.now().toUtc().toIso8601String(),
        'source': 'mobile',
        'sync_status': 'synced',
      };
      if (latitude != null) payload['latitude'] = latitude;
      if (longitude != null) payload['longitude'] = longitude;
      if (accuracy != null) payload['accuracy'] = accuracy;
      await client
          .from('fo_live_status')
          .upsert(payload, onConflict: 'fo_user_id');
      await CrashLogService.record(
        employeeCode: user.employeeCode,
        screen: 'tasks',
        action: 'CHECKIN_LIVE_STATUS_UPDATE_SUCCESS',
      );
    } catch (error, stackTrace) {
      await CrashLogService.record(
        employeeCode: user.employeeCode,
        screen: 'tasks',
        action: 'CHECKIN_FAILED',
        error: error,
        stackTrace: stackTrace,
      );
      rethrow;
    }
  }

  static Future<List<Store>> searchStores(String query) async {
    final q = query.trim();
    if (q.isEmpty) return [];
    final rows = await client
        .from('store_master')
        .select()
        .or(
          'store_name.ilike.%$q%,store_code.ilike.%$q%,client_name.ilike.%$q%',
        )
        .limit(20);
    return List<Map<String, dynamic>>.from(rows).map(Store.fromJson).toList();
  }

  static Future<List<Store>> fetchStoresWithGps({int limit = 500}) async {
    final rows = await client
        .from('store_master')
        .select()
        .not('latitude', 'is', null)
        .not('longitude', 'is', null)
        .eq('status', 'Active')
        .limit(limit);
    return List<Map<String, dynamic>>.from(rows).map(Store.fromJson).toList();
  }

  static Future<String?> createStore({
    required FoUser user,
    required Attendance attendance,
    required String storeName,
    required String clientName,
    required String state,
    String? business,
    String? storeCode,
    String? locationName,
    String? addressLandmark,
    String? remarks,
    double? latitude,
    double? longitude,
    double? accuracy,
  }) async {
    try {
      final code = storeCode?.trim().isNotEmpty == true
          ? storeCode!.trim()
          : 'FO-${user.employeeCode}-${DateTime.now().millisecondsSinceEpoch}';
      final cleanBusiness = business?.trim();
      final metadata = {
        'approval_status': 'pending_approval',
        'verification_status': 'Pending',
        'source': 'created_by_fo',
        'created_by': user.authUserId.isNotEmpty
            ? user.authUserId
            : user.employeeCode,
        'created_by_employee_code': user.employeeCode,
        'created_by_full_name': user.fullName,
        'is_temporary': true,
        'first_captured_by': user.employeeCode,
        'first_captured_by_name': user.fullName,
        if (locationName?.trim().isNotEmpty == true)
          'mall_building_location_name': locationName!.trim(),
        if (addressLandmark?.trim().isNotEmpty == true)
          'address_landmark': addressLandmark!.trim(),
        if (remarks?.trim().isNotEmpty == true) 'remarks': remarks!.trim(),
      };
      final row = await client
          .from('store_master')
          .insert({
            'store_name': storeName,
            'client_name': clientName,
            'store_code': code,
            'state': state,
            'business': cleanBusiness?.isEmpty == true ? null : cleanBusiness,
            'latitude': latitude,
            'longitude': longitude,
            'gps_accuracy': accuracy,
            'created_by_employee_code': user.employeeCode,
            'created_by_full_name': user.fullName,
            'attendance_id': _uuidOrNull(attendance.remoteId),
            'captured_at': DateTime.now().toUtc().toIso8601String(),
            'status': 'Active',
            'metadata': metadata,
          })
          .select('id')
          .maybeSingle();
      await CrashLogService.record(
        employeeCode: user.employeeCode,
        screen: 'tasks',
        action: 'STORE_CREATE_SUCCESS',
      );
      return row?['id']?.toString();
    } catch (error, stackTrace) {
      await CrashLogService.record(
        employeeCode: user.employeeCode,
        screen: 'tasks',
        action: 'STORE_CREATE_FAILED',
        error: error,
        stackTrace: stackTrace,
      );
      rethrow;
    }
  }

  static Future<String?> insertVisit(SiteVisit visit) async {
    try {
      final payload = {
        'fo_user_id': visit.employeeCode,
        'employee_code': visit.employeeCode,
        'full_name': visit.fullName,
        'attendance_id': _uuidOrNull(visit.attendanceId),
        'store_id': _uuidOrNull(visit.storeId),
        'site_name': visit.storeName,
        'store_name': visit.storeName,
        'store_code': visit.storeCode,
        'client_name': visit.clientName,
        'state': visit.state,
        'business': visit.business,
        'local_id': visit.id,
        'check_in_time': visit.checkInTime.toUtc().toIso8601String(),
        'checkout_time': visit.checkOutTime?.toUtc().toIso8601String(),
        'check_in_latitude': visit.currentLatitude,
        'check_in_longitude': visit.currentLongitude,
        'check_out_latitude': visit.checkOutLatitude,
        'check_out_longitude': visit.checkOutLongitude,
        'current_latitude': visit.currentLatitude,
        'current_longitude': visit.currentLongitude,
        'current_gps_accuracy':
            visit.currentGpsAccuracy ?? visit.checkInAccuracy,
        'checkin_accuracy': visit.checkInAccuracy,
        'checkout_accuracy': visit.checkOutAccuracy,
        'origin_lat': visit.originLatitude,
        'origin_lng': visit.originLongitude,
        'destination_lat': visit.destinationLatitude,
        'destination_lng': visit.destinationLongitude,
        'route_km': visit.routeKm,
        'visit_duration_minutes': visit.durationMinutes,
        'status': visit.status,
      };
      dynamic row;
      try {
        row = await client
            .from('fo_site_visits')
            .insert(payload)
            .select('id')
            .maybeSingle();
      } on PostgrestException catch (error) {
        if (!_isMissingColumnError(error)) rethrow;
        payload.remove('business');
        row = await client
            .from('fo_site_visits')
            .insert(payload)
            .select('id')
            .maybeSingle();
      }
      await CrashLogService.record(
        employeeCode: visit.employeeCode,
        screen: 'tasks',
        action: 'SITE_VISIT_INSERT_SUCCESS',
      );
      return row?['id']?.toString();
    } catch (error, stackTrace) {
      await CrashLogService.record(
        employeeCode: visit.employeeCode,
        screen: 'tasks',
        action: 'SITE_VISIT_INSERT_FAILED',
        error: error,
        stackTrace: stackTrace,
      );
      rethrow;
    }
  }

  static Future<void> updateVisitCheckout(SiteVisit visit) async {
    final id = visit.remoteId;
    if (!isValidUuid(id)) {
      throw StateError('Site visit sync missing. Please reload and try again.');
    }
    final checkoutTimestamp = visit.checkOutTime?.toUtc().toIso8601String();
    final payload = {
      'checkout_time': checkoutTimestamp,
      'check_out_time': checkoutTimestamp,
      'check_out_latitude': visit.checkOutLatitude,
      'check_out_longitude': visit.checkOutLongitude,
      'checkout_accuracy': visit.checkOutAccuracy,
      'checkout_distance_meters': visit.checkOutDistanceMeters,
      'checkout_location_status': visit.checkOutLocationStatus ?? 'valid',
      'checkout_note': visit.checkOutNote,
      'petrol_eligible_after_checkout': visit.petrolEligibleAfterCheckout,
      'petrol_penalty_distance_meters': visit.petrolPenaltyDistanceMeters,
      'visit_duration_minutes': visit.durationMinutes,
      'status': visit.status,
      'updated_at': DateTime.now().toUtc().toIso8601String(),
    };
    dynamic rows;
    try {
      rows = await client
          .from('fo_site_visits')
          .update(payload)
          .eq('id', id!)
          .select('id');
    } on PostgrestException catch (error) {
      if (!_isMissingColumnError(error)) rethrow;
      payload.remove('checkout_distance_meters');
      payload.remove('checkout_location_status');
      payload.remove('checkout_note');
      payload.remove('petrol_eligible_after_checkout');
      payload.remove('petrol_penalty_distance_meters');
      rows = await client
          .from('fo_site_visits')
          .update(payload)
          .eq('id', id!)
          .select('id');
    }
    if (List<Map<String, dynamic>>.from(rows).isEmpty) {
      throw StateError('Check Out update matched 0 site visit rows.');
    }
  }

  static bool _isMissingColumnError(PostgrestException error) {
    final code = error.code?.trim();
    final message = error.message.toLowerCase();
    return code == '42703' ||
        code == 'PGRST204' ||
        message.contains('column') && message.contains('schema cache');
  }

  static Future<List<SiteVisit>> fetchVisitsForRange({
    required FoUser user,
    required DateTime from,
    required DateTime to,
  }) async {
    final rows = await client
        .from('fo_site_visits')
        .select('*')
        .or(
          'fo_user_id.eq.${user.employeeCode},employee_code.eq.${user.employeeCode}',
        )
        .gte('check_in_time', from.toUtc().toIso8601String())
        .lte('check_in_time', to.toUtc().toIso8601String())
        .order('check_in_time', ascending: true)
        .limit(1000);
    return List<Map<String, dynamic>>.from(
      rows,
    ).map(SiteVisit.fromJson).toList();
  }

  static Future<void> signOut() => client.auth.signOut();

  static String _digits(String value) => value.replaceAll(RegExp(r'\D'), '');

  static String? _uuidOrNull(String? value) {
    if (isValidUuid(value)) return value;
    return null;
  }

  static bool isValidUuid(String? value) {
    final text = value?.trim();
    if (text == null || text.isEmpty) return false;
    return RegExp(
      r'^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-5][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}$',
    ).hasMatch(text);
  }
}
