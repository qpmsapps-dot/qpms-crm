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

  static bool get isReady => _initialized && AppConfig.hasSupabase;
  static SupabaseClient get client => Supabase.instance.client;

  static Future<void> initialize() async {
    if (_initialized || !AppConfig.hasSupabase) return;
    await Supabase.initialize(
      url: AppConfig.supabaseUrl.trim(),
      anonKey: AppConfig.supabaseAnonKey.trim(),
    );
    _initialized = true;
  }

  static Future<FoUser> register({
    required String fullName,
    required String employeeId,
    required String mobile,
    required String email,
    required String birthDate,
    required String gender,
    required String state,
    required String password,
  }) async {
    final cleanFullName = fullName.trim();
    final cleanEmployeeId = employeeId.trim();
    final cleanEmail = email.trim().toLowerCase();
    final cleanMobile = _digits(mobile);
    final cleanBirthDate = birthDate.trim();
    final cleanGender = gender.trim();
    final cleanState = state.trim();

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
          'id, auth_user_id, employee_code, username, full_name, display_name, mobile, email, state, role',
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
      await client
          .from('fo_attendance')
          .update({
            'logout_time': attendance.endTime?.toUtc().toIso8601String(),
            'end_latitude': attendance.endLat,
            'end_longitude': attendance.endLng,
            'end_battery_percentage': attendance.batteryEnd,
            'actual_km': attendance.actualKm,
            'eligible_km': attendance.eligibleKm,
            'total_raw_km': attendance.actualKm,
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

  static Attendance _attendanceFromRow(Map<String, dynamic> row, FoUser user) {
    return Attendance(
      id: row['local_id']?.toString() ?? row['id']?.toString() ?? '',
      remoteId: row['id']?.toString(),
      employeeCode:
          row['fo_user_id']?.toString() ??
          row['employee_code']?.toString() ??
          user.employeeCode,
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
    try {
      final row = await client
          .from('fo_location_logs')
          .insert({
            'fo_user_id': log.employeeCode,
            'username': log.employeeCode,
            'attendance_id': _uuidOrNull(log.attendanceId),
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
          })
          .select('id')
          .maybeSingle();
      await CrashLogService.record(
        employeeCode: log.employeeCode,
        screen: 'tracking',
        action: 'LOCATION_LOG_INSERT_SUCCESS',
      );
      return row?['id']?.toString();
    } catch (error, stackTrace) {
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

  static LocationLog _locationLogFromRow(
    Map<String, dynamic> row,
  ) => LocationLog(
    id: row['local_id']?.toString() ?? row['id']?.toString() ?? '',
    remoteId: row['id']?.toString(),
    employeeCode:
        row['fo_user_id']?.toString() ?? row['employee_code']?.toString() ?? '',
    attendanceId: row['attendance_id']?.toString() ?? '',
    latitude: _double(row['latitude']) ?? 0,
    longitude: _double(row['longitude']) ?? 0,
    accuracy: _double(row['accuracy']),
    speed: _double(row['speed']),
    battery: _int(row['battery_percentage']),
    capturedAt:
        DateTime.tryParse(
          row['captured_at']?.toString() ?? row['logged_at']?.toString() ?? '',
        )?.toLocal() ??
        DateTime.now(),
    synced: true,
  );

  static Future<void> updateLiveStatus({
    required FoUser user,
    required bool isTracking,
    required String status,
    double? latitude,
    double? longitude,
    double? accuracy,
    double? speed,
    int? battery,
    double? routeKm,
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
        'is_online': isTracking,
        'is_tracking': isTracking,
        'current_status': status,
        'source': 'mobile',
        'sync_status': 'synced',
      };
      if (latitude != null) payload['latitude'] = latitude;
      if (longitude != null) payload['longitude'] = longitude;
      if (accuracy != null) payload['accuracy'] = accuracy;
      if (speed != null) payload['speed'] = speed;
      if (routeKm != null) payload['route_km_today'] = routeKm;
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

  static Future<List<Store>> searchStores(String query) async {
    final q = query.trim();
    if (q.isEmpty) return [];
    final rows = await client
        .from('store_master')
        .select()
        .or('store_name.ilike.%$q%,store_code.ilike.%$q%')
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
    required String storeCode,
    required String state,
    double? latitude,
    double? longitude,
    double? accuracy,
  }) async {
    try {
      final row = await client
          .from('store_master')
          .insert({
            'store_name': storeName,
            'client_name': clientName,
            'store_code': storeCode,
            'state': state,
            'latitude': latitude,
            'longitude': longitude,
            'gps_accuracy': accuracy,
            'created_by_employee_code': user.employeeCode,
            'created_by_full_name': user.fullName,
            'attendance_id': _uuidOrNull(attendance.remoteId),
            'captured_at': DateTime.now().toUtc().toIso8601String(),
            'status': 'Active',
            'metadata': {
              'verification_status': 'Pending',
              'source': 'fo_checkin',
              'first_captured_by': user.employeeCode,
              'first_captured_by_name': user.fullName,
            },
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
      final row = await client
          .from('fo_site_visits')
          .insert({
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
            'local_id': visit.id,
            'check_in_time': visit.checkInTime.toUtc().toIso8601String(),
            'checkout_time': visit.checkOutTime?.toUtc().toIso8601String(),
            'check_out_latitude': visit.checkOutLatitude,
            'check_out_longitude': visit.checkOutLongitude,
            'current_latitude': visit.currentLatitude,
            'current_longitude': visit.currentLongitude,
            'current_gps_accuracy':
                visit.currentGpsAccuracy ?? visit.checkInAccuracy,
            'checkin_accuracy': visit.checkInAccuracy,
            'checkout_accuracy': visit.checkOutAccuracy,
            'visit_duration_minutes': visit.durationMinutes,
            'status': visit.status,
          })
          .select('id')
          .maybeSingle();
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
    if (id == null || id.isEmpty) return;
    await client
        .from('fo_site_visits')
        .update({
          'checkout_time': visit.checkOutTime?.toUtc().toIso8601String(),
          'check_out_latitude': visit.checkOutLatitude,
          'check_out_longitude': visit.checkOutLongitude,
          'checkout_accuracy': visit.checkOutAccuracy,
          'visit_duration_minutes': visit.durationMinutes,
          'status': visit.status,
        })
        .eq('id', id);
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
