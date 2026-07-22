import 'dart:async';
import 'dart:convert';
import 'dart:io';
import 'dart:typed_data';

import 'package:flutter/foundation.dart' show visibleForTesting;
import 'package:supabase_flutter/supabase_flutter.dart';

import '../models/fo_models.dart';
import '../utils/date_utils.dart';
import '../utils/mobile_roles.dart';
import 'config_service.dart';
import 'crash_log_service.dart';
import 'local_store.dart';
import 'performance_log_service.dart';

class DuplicateEmployeeIdException implements Exception {
  const DuplicateEmployeeIdException();

  static const message =
      'Employee ID already registered. Please contact admin.';

  @override
  String toString() => message;
}

enum MobileLoginFailureType {
  profileNotFound,
  authUserMissing,
  wrongPassword,
  roleNotAllowed,
  inactiveProfile,
}

class MobileLoginException implements Exception {
  const MobileLoginException(this.type, this.message, {this.details});

  final MobileLoginFailureType type;
  final String message;
  final String? details;

  String get action => 'LOGIN_${type.name.toUpperCase()}';

  @override
  String toString() => details == null ? message : '$message ($details)';
}

class StoreCreateException implements Exception {
  const StoreCreateException(this.message, {this.code});

  final String message;
  final String? code;

  @override
  String toString() => message;
}

typedef StorePageLoader =
    Future<List<Map<String, dynamic>>> Function(int from, int to);

class EndDayAttendanceResolution {
  const EndDayAttendanceResolution({
    required this.attendance,
    required this.alreadyCompleted,
    required this.usedFallback,
  });

  final Attendance attendance;
  final bool alreadyCompleted;
  final bool usedFallback;
}

class StartDayAuthValidation {
  const StartDayAuthValidation({
    required this.isValid,
    required this.message,
    required this.action,
    required this.employeeCode,
    required this.profileAuthUserId,
    required this.supabaseAuthUserId,
    required this.sessionExists,
    required this.accessTokenExists,
    required this.sessionUserMatchesProfile,
  });

  final bool isValid;
  final String? message;
  final String action;
  final String employeeCode;
  final String profileAuthUserId;
  final String supabaseAuthUserId;
  final bool sessionExists;
  final bool accessTokenExists;
  final bool sessionUserMatchesProfile;

  String diagnostics({Object? error}) {
    final errorCode = error is PostgrestException ? error.code : null;
    final errorMessage = error is PostgrestException
        ? error.message
        : error?.toString();
    return [
      'employee_code=${employeeCode.isEmpty ? '--' : employeeCode}',
      'profile_auth_user_id=${profileAuthUserId.isEmpty ? '--' : profileAuthUserId}',
      'supabase_auth_user_id=${supabaseAuthUserId.isEmpty ? '--' : supabaseAuthUserId}',
      'session_exists=$sessionExists',
      'access_token_exists=$accessTokenExists',
      'session_user_matches_profile=$sessionUserMatchesProfile',
      'supabase_error_code=${errorCode?.trim().isNotEmpty == true ? errorCode : '--'}',
      'supabase_error_message=${errorMessage?.trim().isNotEmpty == true ? errorMessage : '--'}',
      'attendance_insert_payload_keys=${SupabaseService.startDayAttendancePayloadKeys.join(',')}',
    ].join(' ');
  }
}

class SupabaseService {
  static const travelClaimProofBucket = 'travel-claim-proofs';
  static const activityUploadBucket = 'fo-activity-uploads';

  static const startDayAttendancePayloadKeys = <String>[
    'fo_user_id',
    'employee_code',
    'username',
    'display_name',
    'attendance_date',
    'login_time',
    'start_latitude',
    'start_longitude',
    'start_battery_percentage',
    'status',
    'local_id',
  ];
  static bool _initialized = false;
  static bool _runtimeConfigured = false;

  static bool get isReady =>
      _initialized && (AppConfig.hasSupabase || _runtimeConfigured);
  static SupabaseClient get client => Supabase.instance.client;
  static String? get currentAccessToken =>
      client.auth.currentSession?.accessToken;

  static StartDayAuthValidation validateStartDayAuth(FoUser user) {
    final employeeCode = user.employeeCode.trim();
    final profileAuthUserId = user.authUserId.trim();
    final session = isReady ? client.auth.currentSession : null;
    final authUser = isReady ? client.auth.currentUser : null;
    final accessTokenExists = session?.accessToken.trim().isNotEmpty == true;
    final expiresAt = session?.expiresAt;
    final sessionExpired =
        expiresAt != null &&
        DateTime.now().millisecondsSinceEpoch >= expiresAt * 1000;
    final sessionExists = session != null;
    final supabaseAuthUserId = authUser?.id.trim() ?? '';
    final sessionUserMatchesProfile =
        profileAuthUserId.isNotEmpty &&
        supabaseAuthUserId.isNotEmpty &&
        profileAuthUserId == supabaseAuthUserId;

    StartDayAuthValidation result({
      required bool isValid,
      required String? message,
      required String action,
    }) {
      return StartDayAuthValidation(
        isValid: isValid,
        message: message,
        action: action,
        employeeCode: employeeCode,
        profileAuthUserId: profileAuthUserId,
        supabaseAuthUserId: supabaseAuthUserId,
        sessionExists: sessionExists,
        accessTokenExists: accessTokenExists,
        sessionUserMatchesProfile: sessionUserMatchesProfile,
      );
    }

    if (employeeCode.isEmpty) {
      return result(
        isValid: false,
        message: 'Employee code missing. Please logout and login again.',
        action: 'START_DAY_AUTH_BLOCKED_EMPLOYEE_CODE_MISSING',
      );
    }
    if (!sessionExists ||
        authUser == null ||
        !accessTokenExists ||
        sessionExpired) {
      return result(
        isValid: false,
        message: 'Session expired. Please logout and login again.',
        action: 'START_DAY_AUTH_BLOCKED_SESSION_EXPIRED',
      );
    }
    if (profileAuthUserId.isNotEmpty && !sessionUserMatchesProfile) {
      return result(
        isValid: false,
        message: 'Login session mismatch. Please logout and login again.',
        action: 'START_DAY_AUTH_BLOCKED_SESSION_MISMATCH',
      );
    }
    return result(isValid: true, message: null, action: 'START_DAY_AUTH_VALID');
  }

  static Future<void> requireAuthenticatedSession(
    FoUser user, {
    required String screen,
    required String action,
  }) async {
    final session = isReady ? client.auth.currentSession : null;
    final authUser = isReady ? client.auth.currentUser : null;
    final accessTokenExists = session?.accessToken.trim().isNotEmpty == true;
    final expiresAt = session?.expiresAt;
    final sessionExpired =
        expiresAt != null &&
        DateTime.now().millisecondsSinceEpoch >= expiresAt * 1000;
    final profileAuthUserId = user.authUserId.trim();
    final supabaseAuthUserId = authUser?.id.trim() ?? '';
    final sessionUserMatchesProfile =
        profileAuthUserId.isEmpty ||
        (supabaseAuthUserId.isNotEmpty &&
            profileAuthUserId == supabaseAuthUserId);

    if (session == null ||
        authUser == null ||
        !accessTokenExists ||
        sessionExpired ||
        !sessionUserMatchesProfile) {
      await CrashLogService.record(
        employeeCode: user.employeeCode,
        screen: screen,
        action: action,
        error:
            'session_exists=${session != null} access_token_exists=$accessTokenExists session_expired=$sessionExpired profile_auth_user_id=${profileAuthUserId.isEmpty ? '--' : profileAuthUserId} supabase_auth_user_id=${supabaseAuthUserId.isEmpty ? '--' : supabaseAuthUserId} session_user_matches_profile=$sessionUserMatchesProfile',
      );
      throw StateError('Session expired. Please login again.');
    }
  }

  static String writeDiagnostic({
    required String operation,
    required FoUser user,
    String? attendanceId,
    String? visitId,
    Object? error,
  }) {
    final authUserId = client.auth.currentUser?.id.trim() ?? '';
    final session = client.auth.currentSession;
    final parts = <String>[
      'operation=$operation',
      'employee_code=${user.employeeCode}',
      'profile_auth_user_id=${user.authUserId.isEmpty ? '--' : user.authUserId}',
      'auth_user_id=${authUserId.isEmpty ? '--' : authUserId}',
      'session_exists=${session != null}',
      'access_token_exists=${session?.accessToken.trim().isNotEmpty == true}',
      if (attendanceId?.trim().isNotEmpty == true)
        'attendance_id=${attendanceId!.trim()}',
      if (visitId?.trim().isNotEmpty == true) 'visit_id=${visitId!.trim()}',
    ];
    if (error is PostgrestException) {
      parts.addAll([
        'postgrest_code=${error.code ?? '--'}',
        'postgrest_message=${error.message}',
        'postgrest_details=${error.details ?? '--'}',
        'postgrest_hint=${error.hint ?? '--'}',
      ]);
    } else if (error != null) {
      parts.add('error=$error');
    }
    return parts.join(' ');
  }

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
    throw UnsupportedError(
      'Accounts are created by your organisation administrator. Please contact support if you need access.',
    );
  }

  static Future<FoUser> login({
    String? loginId,
    String? mobile,
    required String password,
  }) async {
    final cleanLoginId = (loginId ?? mobile ?? '').trim();
    if (cleanLoginId.isEmpty) {
      throw const MobileLoginException(
        MobileLoginFailureType.profileNotFound,
        'Invalid login details. Please check your email/mobile and password.',
      );
    }
    final isEmail = cleanLoginId.contains('@');
    final email = isEmail
        ? cleanLoginId.toLowerCase()
        : await _resolveEmail(_digits(cleanLoginId));
    try {
      await client.auth.signInWithPassword(email: email, password: password);
    } on AuthException catch (error) {
      final isInvalidCredentials =
          error.code == 'invalid_credentials' ||
          error.message.toLowerCase().contains('invalid login credentials');
      if (!isInvalidCredentials) rethrow;
      if (isEmail && !await _emailProfileExists(email)) {
        throw MobileLoginException(
          MobileLoginFailureType.profileNotFound,
          'No active profile found for this email. Please contact admin.',
          details: 'email=$email auth_code=${error.code ?? '--'}',
        );
      }
      throw MobileLoginException(
        MobileLoginFailureType.wrongPassword,
        'Invalid login details. Please check your email/mobile and password.',
        details:
            'login_type=${isEmail ? 'email' : 'mobile'} auth_code=${error.code ?? '--'}',
      );
    }
    try {
      return await fetchCurrentProfile();
    } on MobileLoginException catch (error) {
      if (error.type == MobileLoginFailureType.profileNotFound) {
        throw MobileLoginException(
          MobileLoginFailureType.profileNotFound,
          isEmail
              ? 'No active profile found for this email. Please contact admin.'
              : 'No active profile found for this mobile number. Please contact admin.',
          details: error.details,
        );
      }
      rethrow;
    }
  }

  static Future<bool> _emailProfileExists(String email) async {
    try {
      final row = await client
          .from('profiles')
          .select('id, is_active, status, mobile_access_enabled')
          .eq('email', email)
          .maybeSingle();
      if (row == null) return false;
      if (row['is_active'] == false) return false;
      if (row['mobile_access_enabled'] == false) return false;
      final status = row['status']?.toString().trim().toLowerCase();
      if (status != null && status.isNotEmpty && status != 'active') {
        return false;
      }
      return true;
    } catch (_) {
      return true;
    }
  }

  static Future<String> _resolveEmail(String mobile) async {
    try {
      final value = await client.rpc(
        'rpc_resolve_mobile_login_profile',
        params: {'p_mobile': mobile},
      );
      final result = value is Map
          ? Map<String, dynamic>.from(value)
          : <String, dynamic>{};
      final status = result['status']?.toString() ?? '';
      final email = result['email']?.toString().trim() ?? '';
      if (status == 'ok' && email.isNotEmpty) return email;
      if (status == 'profile_not_found') {
        throw MobileLoginException(
          MobileLoginFailureType.profileNotFound,
          'No active profile found for this mobile number. Please contact admin.',
          details: 'mobile=$mobile',
        );
      }
      if (status == 'auth_user_missing') {
        throw MobileLoginException(
          MobileLoginFailureType.authUserMissing,
          'This profile is not linked to an authentication user. Please contact admin.',
          details: 'mobile=$mobile',
        );
      }
      if (status == 'inactive_profile') {
        throw MobileLoginException(
          MobileLoginFailureType.inactiveProfile,
          'Your profile is inactive. Please contact admin.',
          details: 'mobile=$mobile',
        );
      }
      if (status == 'role_not_allowed') {
        throw MobileLoginException(
          MobileLoginFailureType.roleNotAllowed,
          'Your role is not allowed to use the Operations mobile app.',
          details: 'mobile=$mobile role=${result['role'] ?? '--'}',
        );
      }
    } on MobileLoginException {
      rethrow;
    } catch (_) {
      // Fall back while deployments transition to the diagnostic RPC.
    }
    final value = await client.rpc(
      'rpc_resolve_fo_login_email',
      params: {'p_mobile': mobile},
    );
    final email = value?.toString().trim() ?? '';
    if (email.isEmpty) {
      throw MobileLoginException(
        MobileLoginFailureType.profileNotFound,
        'No active profile found for this mobile number. Please contact admin.',
        details: 'mobile=$mobile legacy_resolver=true',
      );
    }
    return email;
  }

  static Future<FoUser> fetchCurrentProfile() async {
    final authUser = client.auth.currentUser;
    if (authUser == null) throw StateError('No active Supabase session.');
    final row = await client
        .from('profiles')
        .select(
          'id, auth_user_id, employee_code, username, full_name, display_name, mobile, email, state, role, department, designation, business, status, is_active, mobile_access_enabled',
        )
        .eq('auth_user_id', authUser.id)
        .maybeSingle();
    if (row == null) {
      throw const MobileLoginException(
        MobileLoginFailureType.profileNotFound,
        'The authenticated profile was not found. Please contact admin.',
      );
    }
    final user = FoUser.fromJson(Map<String, dynamic>.from(row));
    if (!isMobileLoginRole(user.role)) {
      throw MobileLoginException(
        MobileLoginFailureType.roleNotAllowed,
        'Your role is not allowed to use the Operations mobile app.',
        details: 'role=${user.role}',
      );
    }
    if (row['is_active'] == false) {
      throw const MobileLoginException(
        MobileLoginFailureType.inactiveProfile,
        'Your profile is inactive. Please contact admin.',
      );
    }
    final status = row['status']?.toString().trim().toLowerCase();
    if (status != null && status.isNotEmpty && status != 'active') {
      throw const MobileLoginException(
        MobileLoginFailureType.inactiveProfile,
        'Your profile is inactive. Please contact admin.',
      );
    }
    if (row['mobile_access_enabled'] == false) {
      throw const MobileLoginException(
        MobileLoginFailureType.roleNotAllowed,
        'Mobile access is not enabled for your profile. Please contact admin.',
      );
    }
    if (user.employeeCode.isEmpty) {
      throw StateError('Mobile employee_code is missing.');
    }
    return user;
  }

  static Future<String?> createAttendance(
    Attendance attendance,
    FoUser user,
  ) async {
    final authValidation = validateStartDayAuth(user);
    if (!authValidation.isValid) {
      await CrashLogService.record(
        employeeCode: user.employeeCode,
        screen: 'home',
        action: authValidation.action,
        error: authValidation.diagnostics(),
      );
      throw StateError(authValidation.message!);
    }
    final employeeCode = user.employeeCode.trim();
    try {
      final row = await client
          .from('fo_attendance')
          .insert({
            'fo_user_id': employeeCode,
            'employee_code': employeeCode,
            'username': employeeCode,
            'display_name': user.fullName,
            'attendance_date':
                attendance.attendanceDate ?? indiaDateKey(attendance.startTime),
            'login_time': attendance.startTime.toUtc().toIso8601String(),
            'start_latitude': attendance.startLat,
            'start_longitude': attendance.startLng,
            'start_battery_percentage': attendance.batteryStart,
            'travel_mode': attendance.travelMode,
            'payable_km_allowed': attendance.payableKmAllowed,
            'travel_mode_note': attendance.travelModeNote,
            'status': 'Active',
            'local_id': attendance.id,
            'metadata': {
              ...attendance.metadata,
              'travel_mode': attendance.travelMode,
              'payable_km_allowed': attendance.payableKmAllowed,
              if (attendance.travelModeNote?.trim().isNotEmpty == true)
                'travel_mode_note': attendance.travelModeNote!.trim(),
            },
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
      final failureValidation = validateStartDayAuth(user);
      await CrashLogService.record(
        employeeCode: user.employeeCode,
        screen: 'home',
        action: 'ATTENDANCE_CREATE_FAILED',
        error: failureValidation.diagnostics(error: error),
        stackTrace: stackTrace,
      );
      rethrow;
    }
  }

  static Future<Attendance?> updateAttendanceTravelMode({
    required FoUser user,
    required Attendance attendance,
    required String travelMode,
    required bool payableKmAllowed,
    String? travelModeNote,
    Map<String, dynamic> metadata = const {},
  }) async {
    final id = attendance.remoteId?.trim();
    if (!isValidUuid(id)) {
      throw StateError(
        'Attendance sync missing. Please refresh and try again.',
      );
    }
    final cleanMode = normalizeTravelMode(travelMode);
    final cleanNote = travelModeNote?.trim();
    final row = await client
        .from('fo_attendance')
        .update({
          'travel_mode': cleanMode,
          'payable_km_allowed': payableKmAllowed,
          'travel_mode_note': cleanNote == null || cleanNote.isEmpty
              ? null
              : cleanNote,
          'metadata': metadata,
          'updated_at': DateTime.now().toUtc().toIso8601String(),
        })
        .eq('id', id!)
        .eq('fo_user_id', user.employeeCode)
        .select('*')
        .maybeSingle();
    await CrashLogService.record(
      employeeCode: user.employeeCode,
      screen: 'home',
      action: 'TRAVEL_MODE_UPDATED',
      error:
          'attendance_id=$id travel_mode=$cleanMode payable_km_allowed=$payableKmAllowed',
    );
    return row == null ? null : _attendanceFromRow(row, user);
  }

  static Future<String> uploadTravelClaimProof({
    required FoUser user,
    required Attendance attendance,
    required String fileName,
    required Uint8List bytes,
    required String contentType,
    required String extension,
  }) async {
    final attendanceId = attendance.remoteId?.trim();
    if (!isValidUuid(attendanceId)) {
      throw StateError(
        'Attendance must be synced before uploading bill/ticket.',
      );
    }
    if (bytes.isEmpty || bytes.length > 5 * 1024 * 1024) {
      throw StateError('Bill/Ticket must be 5 MB or less.');
    }
    final safeEmployeeCode = _storagePathPart(user.employeeCode);
    final safeAttendanceId = _storagePathPart(attendanceId!);
    final timestamp = _storageTimestamp(DateTime.now());
    final safeExtension = _storageExtension(extension);
    final path =
        '$safeEmployeeCode/$safeAttendanceId/${timestamp}_claim_proof.$safeExtension';
    await client.storage
        .from(travelClaimProofBucket)
        .uploadBinary(
          path,
          bytes,
          fileOptions: FileOptions(
            contentType: contentType,
            cacheControl: '3600',
            upsert: false,
            metadata: {'original_file_name': fileName},
          ),
        );
    await CrashLogService.record(
      employeeCode: user.employeeCode,
      screen: 'home',
      action: 'TRAVEL_CLAIM_PROOF_UPLOADED',
      error: 'attendance_id=$attendanceId path=$path',
    );
    return path;
  }

  static Future<String?> submitTravelExpenseClaim({
    required FoUser user,
    required Attendance attendance,
    required double fareAmount,
    String? travelMode,
    String? fromLocation,
    String? toLocation,
    String? remarks,
    String? proofFileUrl,
    String? storageBucket,
    String? siteVisitId,
  }) async {
    final attendanceId = attendance.remoteId?.trim();
    if (!isValidUuid(attendanceId)) {
      throw StateError(
        'Attendance must be synced before submitting fare claim.',
      );
    }
    final amount = fareAmount.isFinite && fareAmount > 0 ? fareAmount : 0.0;
    final remarksText = _travelClaimRemarks(
      fromLocation: fromLocation,
      toLocation: toLocation,
      remarks: remarks,
    );
    final claimMode = normalizeTravelMode(travelMode ?? attendance.travelMode);
    final row = await client
        .from('fo_travel_expense_claims')
        .insert({
          'attendance_id': attendanceId,
          'site_visit_id': isValidUuid(siteVisitId) ? siteVisitId : null,
          'fo_user_id': user.employeeCode,
          'employee_code': user.employeeCode,
          'travel_mode': claimMode,
          'fare_amount': double.parse(amount.toStringAsFixed(2)),
          'remarks': remarksText == null || remarksText.isEmpty
              ? null
              : remarksText,
          'proof_file_url': proofFileUrl,
          'storage_bucket': storageBucket,
          'status': 'submitted',
        })
        .select('id')
        .maybeSingle();
    await CrashLogService.record(
      employeeCode: user.employeeCode,
      screen: 'home',
      action: 'TRAVEL_EXPENSE_CLAIM_SUBMITTED',
      error: 'attendance_id=$attendanceId claim_id=${row?['id'] ?? '--'}',
    );
    return row?['id']?.toString();
  }

  static Future<String?> createActivitySubmission({
    required FoUser user,
    required Attendance attendance,
    required SiteVisit visit,
    required String activityType,
    required String remarks,
    double? latitude,
    double? longitude,
    double? accuracy,
    bool pendingImages = false,
    Map<String, dynamic> metadata = const {},
    String? localId,
    String status = 'submitted',
  }) async {
    await requireAuthenticatedSession(
      user,
      screen: 'tasks',
      action: 'ACTIVITY_SUBMISSION_AUTH_SESSION_INVALID',
    );
    final attendanceId = attendance.remoteId?.trim();
    final siteVisitId = visit.remoteId?.trim();
    if (!isValidUuid(attendanceId)) {
      throw StateError('Attendance must be synced before submitting activity.');
    }
    if (!isValidUuid(siteVisitId)) {
      throw StateError('Site visit must be synced before submitting activity.');
    }
    final cleanRemarks = remarks.trim();
    final activityDate = indiaDateKey(visit.checkInTime);
    final submissionMetadata = <String, dynamic>{
      'store_name': visit.storeName,
      'client_name': visit.clientName,
      'state': visit.state,
      'activity_date': activityDate,
      'pending_images': pendingImages,
      ...metadata,
    };
    if (visit.business != null) submissionMetadata['business'] = visit.business;
    if (latitude != null) submissionMetadata['submission_latitude'] = latitude;
    if (longitude != null) {
      submissionMetadata['submission_longitude'] = longitude;
    }
    if (accuracy != null) submissionMetadata['submission_accuracy'] = accuracy;
    final row = await client
        .from('fo_activity_submissions')
        .insert({
          'fo_user_id': user.employeeCode,
          'employee_code': user.employeeCode,
          'attendance_id': attendanceId,
          'site_visit_id': siteVisitId,
          'store_id': _uuidOrNull(visit.storeId),
          'store_code': visit.storeCode.trim().isEmpty ? null : visit.storeCode,
          'activity_type': activityType,
          'status': status.trim().isEmpty ? 'submitted' : status.trim(),
          'remarks': cleanRemarks.isEmpty ? null : cleanRemarks,
          'submitted_at': DateTime.now().toUtc().toIso8601String(),
          'local_id': localId,
          'metadata': submissionMetadata,
        })
        .select('id')
        .maybeSingle();
    await CrashLogService.record(
      employeeCode: user.employeeCode,
      screen: 'tasks',
      action: 'ACTIVITY_SUBMISSION_CREATED',
      error: 'activity_type=$activityType submission_id=${row?['id'] ?? '--'}',
    );
    return row?['id']?.toString();
  }

  static Future<Map<String, dynamic>?> findActivitySubmission({
    required FoUser user,
    required SiteVisit visit,
    required String activityType,
  }) async {
    await requireAuthenticatedSession(
      user,
      screen: 'tasks',
      action: 'ACTIVITY_SUBMISSION_LOOKUP_AUTH_SESSION_INVALID',
    );
    final siteVisitId = visit.remoteId?.trim();
    if (!isValidUuid(siteVisitId)) return null;
    final rows = await client
        .from('fo_activity_submissions')
        .select('*')
        .eq('site_visit_id', siteVisitId!)
        .eq('activity_type', activityType)
        .or(
          'fo_user_id.eq.${user.employeeCode},employee_code.eq.${user.employeeCode}',
        )
        .order('submitted_at', ascending: false)
        .limit(1);
    final list = List<Map<String, dynamic>>.from(rows);
    return list.isEmpty ? null : list.first;
  }

  static Future<void> updateActivitySubmissionMetadata({
    required String submissionId,
    required Map<String, dynamic> metadata,
    String? remarks,
    String? status,
  }) async {
    if (!isValidUuid(submissionId)) return;
    final payload = <String, dynamic>{
      'metadata': metadata,
      'updated_at': DateTime.now().toUtc().toIso8601String(),
    };
    if (remarks != null && remarks.trim().isNotEmpty) {
      payload['remarks'] = remarks.trim();
    }
    if (status != null && status.trim().isNotEmpty) {
      payload['status'] = status.trim();
    }
    await client
        .from('fo_activity_submissions')
        .update(payload)
        .eq('id', submissionId);
  }

  static Future<List<Map<String, dynamic>>> fetchActivityUploadsForSubmission(
    String submissionId,
  ) async {
    if (!isValidUuid(submissionId)) return const [];
    final rows = await client
        .from('fo_activity_uploads')
        .select('*')
        .eq('submission_id', submissionId)
        .limit(100);
    return List<Map<String, dynamic>>.from(rows);
  }

  static Future<String?> signedActivityUploadUrl(String fileUrl) async {
    final clean = fileUrl.trim();
    if (clean.isEmpty) return null;
    if (clean.startsWith('http://') || clean.startsWith('https://')) {
      return clean;
    }
    final path = clean
        .replaceFirst(RegExp('^$activityUploadBucket/'), '')
        .replaceFirst(RegExp(r'^/+'), '');
    if (path.isEmpty) return null;
    final result = await client.storage
        .from(activityUploadBucket)
        .createSignedUrl(path, 60 * 60);
    return result;
  }

  static Future<List<Map<String, dynamic>>> fetchPendingActivityImageReminders({
    required FoUser user,
    required DateTime day,
  }) async {
    await requireAuthenticatedSession(
      user,
      screen: 'home',
      action: 'ACTIVITY_IMAGE_REMINDER_AUTH_SESSION_INVALID',
    );
    final from = DateTime(day.year, day.month, day.day).toUtc();
    final to = DateTime(day.year, day.month, day.day, 23, 59, 59, 999).toUtc();
    final submissionsRows = await client
        .from('fo_activity_submissions')
        .select('*')
        .or(
          'fo_user_id.eq.${user.employeeCode},employee_code.eq.${user.employeeCode}',
        )
        .inFilter('activity_type', ['inspection', 'deep_cleaning', 'training'])
        .gte('submitted_at', from.toIso8601String())
        .lte('submitted_at', to.toIso8601String())
        .order('submitted_at', ascending: false)
        .limit(100);
    final submissions = List<Map<String, dynamic>>.from(submissionsRows);
    if (submissions.isEmpty) return const [];
    final submissionIds = submissions
        .map((row) => row['id']?.toString())
        .where((id) => isValidUuid(id))
        .cast<String>()
        .toList();
    final uploadsRows = submissionIds.isEmpty
        ? const []
        : await client
              .from('fo_activity_uploads')
              .select('submission_id')
              .inFilter('submission_id', submissionIds)
              .limit(500);
    final uploadedSubmissionIds = List<Map<String, dynamic>>.from(uploadsRows)
        .map((row) => row['submission_id']?.toString())
        .whereType<String>()
        .toSet();
    return submissions.where((submission) {
      final metadata = _jsonMap(submission['metadata']);
      final pending = metadata['pending_images'] == true;
      final hasUpload = uploadedSubmissionIds.contains(
        submission['id']?.toString(),
      );
      return pending || !hasUpload;
    }).toList();
  }

  static Future<String> uploadActivityFile({
    required FoUser user,
    required Attendance attendance,
    required String activityType,
    required String submissionId,
    required String fileName,
    required Uint8List bytes,
    required String contentType,
    required String extension,
  }) async {
    final attendanceDate = attendance.attendanceDate?.trim().isNotEmpty == true
        ? attendance.attendanceDate!.trim()
        : indiaDateKey(attendance.startTime);
    final safeEmployeeCode = _storagePathPart(user.employeeCode);
    final safeActivityType = _storagePathPart(activityType);
    final safeSubmissionId = _storagePathPart(submissionId);
    final baseFileName = fileName.trim().replaceFirst(RegExp(r'\.[^.]+$'), '');
    final safeFileName = _storagePathPart(
      baseFileName.isEmpty ? 'activity_file' : baseFileName,
    );
    final timestamp = _storageTimestamp(DateTime.now());
    final safeExtension = _storageExtension(extension);
    if (bytes.isEmpty || bytes.length > 5 * 1024 * 1024) {
      throw StateError('Inspection photo must be 5 MB or less.');
    }
    final path =
        '$safeEmployeeCode/$attendanceDate/$safeActivityType/$safeSubmissionId/${timestamp}_$safeFileName.$safeExtension';
    await client.storage
        .from(activityUploadBucket)
        .uploadBinary(
          path,
          bytes,
          fileOptions: FileOptions(
            contentType: contentType,
            cacheControl: '3600',
            upsert: false,
            metadata: {'original_file_name': fileName},
          ),
        );
    await CrashLogService.record(
      employeeCode: user.employeeCode,
      screen: 'tasks',
      action: 'ACTIVITY_FILE_UPLOADED',
      error: 'submission_id=$submissionId path=$path',
    );
    return '$activityUploadBucket/$path';
  }

  static Future<void> deleteActivityFile(String fileUrl) async {
    final path = fileUrl
        .replaceFirst(RegExp('^$activityUploadBucket/'), '')
        .replaceFirst(RegExp(r'^/+'), '');
    if (path.trim().isEmpty) return;
    await client.storage.from(activityUploadBucket).remove([path]);
  }

  static Future<String?> createActivityUpload({
    required FoUser user,
    required Attendance attendance,
    required SiteVisit visit,
    required String submissionId,
    required String activityType,
    required String uploadRole,
    required String fileUrl,
    required String fileName,
    required String fileType,
    required int fileSize,
    String? localId,
    Map<String, dynamic> metadata = const {},
  }) async {
    final attendanceId = attendance.remoteId?.trim();
    final siteVisitId = visit.remoteId?.trim();
    if (!isValidUuid(submissionId)) {
      throw StateError('Activity submission is missing.');
    }
    final row = await client
        .from('fo_activity_uploads')
        .insert({
          'submission_id': submissionId,
          'fo_user_id': user.employeeCode,
          'employee_code': user.employeeCode,
          'attendance_id': isValidUuid(attendanceId) ? attendanceId : null,
          'site_visit_id': isValidUuid(siteVisitId) ? siteVisitId : null,
          'store_code': visit.storeCode.trim().isEmpty ? null : visit.storeCode,
          'activity_type': activityType,
          'upload_role': uploadRole,
          'file_url': fileUrl,
          'file_name': fileName,
          'file_type': fileType,
          'file_size': fileSize,
          'storage_bucket': activityUploadBucket,
          'uploaded_at': DateTime.now().toUtc().toIso8601String(),
          'local_id': localId,
          'metadata': {
            'store_name': visit.storeName,
            'client_name': visit.clientName,
            'state': visit.state,
            ...metadata,
          },
        })
        .select('id')
        .maybeSingle();
    await CrashLogService.record(
      employeeCode: user.employeeCode,
      screen: 'tasks',
      action: 'ACTIVITY_UPLOAD_ROW_CREATED',
      error: 'submission_id=$submissionId upload_id=${row?['id'] ?? '--'}',
    );
    return row?['id']?.toString();
  }

  static Future<String?> createTravelLeg({
    required FoUser user,
    required TravelLeg travelLeg,
  }) async {
    final attendanceId = travelLeg.attendanceId.trim();
    if (!isValidUuid(attendanceId)) {
      throw StateError('Travel leg requires a synced attendance_id.');
    }
    final row = await client
        .from('fo_travel_legs')
        .insert(_travelLegPayload(travelLeg, user))
        .select('id')
        .maybeSingle();
    await CrashLogService.record(
      employeeCode: user.employeeCode,
      screen: 'home',
      action: 'TRAVEL_LEG_CREATED',
      error:
          'attendance_id=$attendanceId travel_leg_id=${row?['id'] ?? '--'} travel_mode=${travelLeg.travelMode}',
    );
    return row?['id']?.toString();
  }

  static Future<TravelLeg?> closeTravelLeg({
    required FoUser user,
    required String travelLegId,
    DateTime? endedAt,
    double? endLat,
    double? endLng,
    double? calculatedKm,
    double? payableKm,
    double? fareAmount,
    String? remarks,
    String status = 'completed',
  }) async {
    final id = travelLegId.trim();
    if (!isValidUuid(id)) return null;
    final payload = <String, dynamic>{
      'ended_at': (endedAt ?? DateTime.now()).toUtc().toIso8601String(),
      'status': status,
      'updated_at': DateTime.now().toUtc().toIso8601String(),
    };
    if (endLat != null) payload['end_lat'] = endLat;
    if (endLng != null) payload['end_lng'] = endLng;
    if (calculatedKm != null) {
      payload['calculated_km'] = double.parse(calculatedKm.toStringAsFixed(2));
    }
    if (payableKm != null) {
      payload['payable_km'] = double.parse(payableKm.toStringAsFixed(2));
    }
    if (fareAmount != null) {
      payload['fare_amount'] = double.parse(fareAmount.toStringAsFixed(2));
    }
    final remarksText = remarks?.trim();
    if (remarksText != null) payload['remarks'] = remarksText;
    final row = await client
        .from('fo_travel_legs')
        .update(payload)
        .eq('id', id)
        .select('*')
        .maybeSingle();
    await CrashLogService.record(
      employeeCode: user.employeeCode,
      screen: 'home',
      action: 'TRAVEL_LEG_CLOSED',
      error: 'travel_leg_id=$id status=$status',
    );
    return row == null ? null : _travelLegFromRow(row);
  }

  static Future<TravelLeg?> fetchActiveTravelLeg({
    String? attendanceId,
    String? employeeCode,
  }) async {
    final cleanAttendanceId = attendanceId?.trim();
    final cleanEmployeeCode = employeeCode?.trim();
    if (!isValidUuid(cleanAttendanceId) &&
        (cleanEmployeeCode == null || cleanEmployeeCode.isEmpty)) {
      return null;
    }
    var query = client
        .from('fo_travel_legs')
        .select('*')
        .eq('status', 'active');
    if (isValidUuid(cleanAttendanceId)) {
      query = query.eq('attendance_id', cleanAttendanceId!);
    } else {
      query = query.eq('employee_code', cleanEmployeeCode!);
    }
    final rows = await query.order('started_at', ascending: false).limit(1);
    final records = List<Map<String, dynamic>>.from(rows);
    return records.isEmpty ? null : _travelLegFromRow(records.first);
  }

  static Future<List<TravelLeg>> fetchTravelLegsForAttendance(
    String attendanceId,
  ) async {
    final id = attendanceId.trim();
    if (!isValidUuid(id)) return [];
    final rows = await client
        .from('fo_travel_legs')
        .select('*')
        .eq('attendance_id', id)
        .order('started_at', ascending: true);
    return List<Map<String, dynamic>>.from(
      rows,
    ).map(_travelLegFromRow).toList();
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

  static Future<bool> isAttendanceConfirmedActive({
    required FoUser user,
    required Attendance attendance,
  }) async {
    final attendanceId = attendance.remoteId?.trim();
    if (!isValidUuid(attendanceId)) return false;
    final row = await client
        .from('fo_attendance')
        .select('id, attendance_date, status, logout_time')
        .eq('id', attendanceId!)
        .eq('fo_user_id', user.employeeCode)
        .maybeSingle();
    if (row == null) return false;
    return row['attendance_date']?.toString() == indiaDateKey(DateTime.now()) &&
        row['status']?.toString().toLowerCase() == 'active' &&
        row['logout_time'] == null;
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

  static Future<EndDayAttendanceResolution?> resolveEndDayAttendance({
    required FoUser user,
    required Attendance attendance,
  }) async {
    final exactId = attendance.remoteId?.trim();
    if (isValidUuid(exactId)) {
      await CrashLogService.record(
        employeeCode: user.employeeCode,
        screen: 'home',
        action: 'END_DAY_EXACT_ATTENDANCE_LOOKUP_STARTED',
        error: 'attendance_id=$exactId',
      );
      final rows = await client
          .from('fo_attendance')
          .select('*')
          .eq('id', exactId!)
          .eq('fo_user_id', user.employeeCode)
          .limit(1);
      final records = List<Map<String, dynamic>>.from(rows);
      if (records.isNotEmpty) {
        final row = records.first;
        final resolved = _attendanceFromRow(row, user);
        final completed = _isCompletedAttendanceRow(row);
        await CrashLogService.record(
          employeeCode: user.employeeCode,
          screen: 'home',
          action: completed
              ? 'END_DAY_EXACT_ATTENDANCE_ALREADY_COMPLETED'
              : 'END_DAY_EXACT_ATTENDANCE_FOUND',
          error: 'attendance_id=${resolved.remoteId}',
        );
        return EndDayAttendanceResolution(
          attendance: resolved,
          alreadyCompleted: completed,
          usedFallback: false,
        );
      }
      await CrashLogService.record(
        employeeCode: user.employeeCode,
        screen: 'home',
        action: 'END_DAY_EXACT_ATTENDANCE_NOT_FOUND',
        error: 'attendance_id=$exactId',
      );
    }

    final today = indiaDateKey(DateTime.now());
    await CrashLogService.record(
      employeeCode: user.employeeCode,
      screen: 'home',
      action: 'END_DAY_TODAY_FALLBACK_LOOKUP_STARTED',
      error: 'attendance_date=$today',
    );
    final rows = await client
        .from('fo_attendance')
        .select('*')
        .eq('fo_user_id', user.employeeCode)
        .eq('attendance_date', today)
        .eq('status', 'Active')
        .filter('logout_time', 'is', null)
        .order('login_time', ascending: false)
        .limit(1);
    final records = List<Map<String, dynamic>>.from(rows);
    if (records.isEmpty) return null;
    final resolved = _attendanceFromRow(records.first, user);
    await CrashLogService.record(
      employeeCode: user.employeeCode,
      screen: 'home',
      action: 'END_DAY_TODAY_FALLBACK_ATTENDANCE_FOUND',
      error: 'attendance_id=${resolved.remoteId}',
    );
    return EndDayAttendanceResolution(
      attendance: resolved,
      alreadyCompleted: false,
      usedFallback: true,
    );
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

  static Future<Attendance?> findAttendanceById({
    required FoUser user,
    required String attendanceId,
  }) async {
    final id = attendanceId.trim();
    if (!isValidUuid(id)) return null;
    final rows = await client
        .from('fo_attendance')
        .select('*')
        .eq('id', id)
        .eq('fo_user_id', user.employeeCode)
        .limit(1);
    final records = List<Map<String, dynamic>>.from(rows);
    if (records.isEmpty) return null;
    return _attendanceFromRow(records.first, user);
  }

  static Future<Attendance?> findClosedAttendanceForToday(FoUser user) async {
    final today = indiaDateKey(DateTime.now());
    final rows = await client
        .from('fo_attendance')
        .select('*')
        .eq('fo_user_id', user.employeeCode)
        .eq('attendance_date', today)
        .order('login_time', ascending: false)
        .limit(10);
    final records = List<Map<String, dynamic>>.from(rows);
    final closed = records.where(_isCompletedAttendanceRow).toList();
    if (closed.isEmpty) return null;
    return _attendanceFromRow(closed.first, user);
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
        .or(
          'fo_user_id.eq.${user.employeeCode},employee_code.eq.${user.employeeCode}',
        )
        .eq('attendance_id', attendanceId!)
        .filter('checkout_time', 'is', null)
        .filter('check_out_time', 'is', null)
        .order('check_in_time', ascending: false)
        .limit(1);
    final records = List<Map<String, dynamic>>.from(rows);
    if (records.isEmpty) return null;
    return SiteVisit.fromJson(records.first);
  }

  static Future<SiteVisit> findOpenSiteVisitById({
    required FoUser user,
    required String siteVisitId,
  }) async {
    if (!isValidUuid(siteVisitId)) {
      throw StateError('Site visit sync missing. Please reload and try again.');
    }
    final rows = await client
        .from('fo_site_visits')
        .select('*')
        .eq('id', siteVisitId)
        .or(
          'fo_user_id.eq.${user.employeeCode},employee_code.eq.${user.employeeCode}',
        )
        .filter('checkout_time', 'is', null)
        .filter('check_out_time', 'is', null)
        .limit(1);
    final records = List<Map<String, dynamic>>.from(rows);
    if (records.isEmpty) {
      throw StateError(
        'No active site visit found. Please refresh and try again.',
      );
    }
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
        .filter('check_out_time', 'is', null)
        .limit(100);
    return List<Map<String, dynamic>>.from(rows).length;
  }

  static Future<({String? firstClosedVisitId, int closedCount})>
  autoCloseOpenSiteVisitsForEndDay({
    required FoUser user,
    required Attendance attendance,
    required DateTime closedAt,
  }) async {
    final attendanceId = attendance.remoteId?.trim();
    if (!isValidUuid(attendanceId)) {
      return (firstClosedVisitId: null, closedCount: 0);
    }
    final rows = await client
        .from('fo_site_visits')
        .select(
          'id, check_in_latitude, check_in_longitude, current_latitude, current_longitude, route_km, metadata',
        )
        .eq('fo_user_id', user.employeeCode)
        .eq('attendance_id', attendanceId!)
        .filter('checkout_time', 'is', null)
        .filter('check_out_time', 'is', null)
        .order('check_in_time', ascending: false)
        .limit(100);
    final visits = List<Map<String, dynamic>>.from(rows);
    String? firstClosedVisitId;
    var closedCount = 0;
    final closedAtIso = closedAt.toUtc().toIso8601String();
    for (final visit in visits) {
      final visitId = visit['id']?.toString();
      if (!isValidUuid(visitId)) continue;
      firstClosedVisitId ??= visitId;
      final metadata = _jsonMap(visit['metadata'])
        ..addAll({
          'closed_source': 'end_day_open_site_auto_close',
          'closed_reason': 'User ended day while site visit was still open',
          'payable_km_after_site_checkin_added': false,
          'closed_at': closedAtIso,
        });
      final checkInLatitude =
          _double(visit['check_in_latitude']) ??
          _double(visit['current_latitude']);
      final checkInLongitude =
          _double(visit['check_in_longitude']) ??
          _double(visit['current_longitude']);
      final payload = <String, dynamic>{
        'checkout_time': closedAtIso,
        'check_out_time': closedAtIso,
        'check_out_latitude': checkInLatitude,
        'check_out_longitude': checkInLongitude,
        'status': 'Closed by End Day',
        'visit_status': 'Closed by End Day',
        'route_km': _double(visit['route_km']) ?? 0,
        'metadata': metadata,
        'updated_at': closedAtIso,
      };
      final updatedRows = await client
          .from('fo_site_visits')
          .update(payload)
          .eq('id', visitId!)
          .filter('checkout_time', 'is', null)
          .filter('check_out_time', 'is', null)
          .select('id');
      if (List<Map<String, dynamic>>.from(updatedRows).isNotEmpty) {
        closedCount += 1;
      }
    }
    if (closedCount > 0) {
      await CrashLogService.record(
        employeeCode: user.employeeCode,
        screen: 'home',
        action: 'END_DAY_OPEN_SITE_AUTO_CLOSED',
        error:
            'attendance_id=$attendanceId first_site_visit_id=$firstClosedVisitId closed_count=$closedCount',
      );
    }
    return (firstClosedVisitId: firstClosedVisitId, closedCount: closedCount);
  }

  static Map<String, dynamic> buildReopenAttendanceMetadata({
    required Map<String, dynamic> existingMetadata,
    required String? previousLogoutTime,
    required DateTime reopenedAt,
  }) {
    final existingCount = _int(existingMetadata['reopen_count']) ?? 0;
    return {
      ...existingMetadata,
      'reopened_after_end_day': true,
      'reopen_count': existingCount + 1,
      'last_reopened_at': reopenedAt.toUtc().toIso8601String(),
      'previous_logout_time': previousLogoutTime,
      'reopen_reason': 'Employee restarted duty after accidental End Day',
    };
  }

  static Future<Attendance> reopenAttendanceForToday({
    required FoUser user,
    required Attendance attendance,
    String? travelMode,
    bool? payableKmAllowed,
    String? travelModeNote,
  }) async {
    final id = attendance.remoteId?.trim();
    if (!isValidUuid(id)) {
      throw StateError(
        'Attendance sync missing. Please logout and login again.',
      );
    }
    final today = indiaDateKey(DateTime.now());
    final reopenedAt = DateTime.now().toUtc();
    final previousLogoutTime = attendance.endTime?.toUtc().toIso8601String();
    final selectedTravelMode = normalizeTravelMode(
      travelMode ?? attendance.travelMode,
    );
    final selectedPayableKmAllowed =
        payableKmAllowed ?? payableKmAllowedForTravelMode(selectedTravelMode);
    final selectedTravelModeNote = travelModeNote?.trim().isNotEmpty == true
        ? travelModeNote!.trim()
        : null;
    final metadata = buildReopenAttendanceMetadata(
      existingMetadata: attendance.metadata,
      previousLogoutTime: previousLogoutTime,
      reopenedAt: reopenedAt,
    );
    metadata['travel_mode'] = selectedTravelMode;
    metadata['payable_km_allowed'] = selectedPayableKmAllowed;
    if (selectedTravelModeNote != null) {
      metadata['travel_mode_note'] = selectedTravelModeNote;
    }
    final payload = <String, dynamic>{
      'status': 'Active',
      'logout_time': null,
      'travel_mode': selectedTravelMode,
      'payable_km_allowed': selectedPayableKmAllowed,
      'travel_mode_note': selectedTravelModeNote,
      'metadata': metadata,
      'updated_at': reopenedAt.toIso8601String(),
    };
    dynamic rows;
    try {
      rows = await client
          .from('fo_attendance')
          .update(payload)
          .eq('id', id!)
          .eq('fo_user_id', user.employeeCode)
          .eq('attendance_date', today)
          .not('logout_time', 'is', null)
          .select('*');
    } on PostgrestException catch (error) {
      if (!_isMissingColumnError(error)) rethrow;
      payload.remove('metadata');
      rows = await client
          .from('fo_attendance')
          .update(payload)
          .eq('id', id!)
          .eq('fo_user_id', user.employeeCode)
          .eq('attendance_date', today)
          .not('logout_time', 'is', null)
          .select('*');
      await CrashLogService.record(
        employeeCode: user.employeeCode,
        screen: 'home',
        action: 'RESTART_DAY_METADATA_AUDIT_SKIPPED',
        error: 'fo_attendance.metadata unavailable',
      );
    }
    final records = List<Map<String, dynamic>>.from(rows);
    if (records.length != 1) {
      throw StateError('Restart Day update affected ${records.length} rows.');
    }
    await CrashLogService.record(
      employeeCode: user.employeeCode,
      screen: 'home',
      action: 'RESTART_DAY_ATTENDANCE_REOPENED',
      error: 'attendance_id=$id',
    );
    return _attendanceFromRow(records.first, user);
  }

  static Future<void> endAttendance(Attendance attendance) async {
    final id = attendance.remoteId;
    if (id == null || id.isEmpty) return;
    try {
      await _syncAttendanceRouteKmFromVisits(attendance);
      final payableKm = _payableRouteKmForAttendance(attendance);
      final approvedKm = _approvedKmForAttendance(attendance);
      await client
          .from('fo_attendance')
          .update({
            'logout_time': attendance.endTime?.toUtc().toIso8601String(),
            'end_latitude': attendance.endLat,
            'end_longitude': attendance.endLng,
            'end_battery_percentage': attendance.batteryEnd,
            'actual_km': payableKm,
            'eligible_km': approvedKm,
            'total_raw_km': attendance.actualKm,
            'total_route_km': payableKm,
            'total_approved_km': approvedKm,
            'rate_per_km': 4,
            'petrol_amount': approvedKm * 4,
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

  static Future<EndDayAttendanceResolution> endCurrentActiveAttendance({
    required FoUser user,
    required Attendance attendance,
    bool endDayWithOpenSite = false,
    bool openSiteAutoClosed = false,
    String? autoClosedSiteVisitId,
    Map<String, dynamic> endLocationMetadata = const {},
  }) async {
    final resolution = await resolveEndDayAttendance(
      user: user,
      attendance: attendance,
    );
    if (resolution == null || !isValidUuid(resolution.attendance.remoteId)) {
      throw StateError('No active attendance found in Supabase.');
    }
    if (resolution.alreadyCompleted) return resolution;
    final remoteActive = resolution.attendance;
    attendance.remoteId = remoteActive.remoteId;
    await _syncAttendanceRouteKmFromVisits(attendance);
    final id = remoteActive.remoteId!;
    final logoutTime = attendance.endTime ?? DateTime.now();
    final existingMetadata = _jsonMap(remoteActive.metadata);
    final payableKm = _payableRouteKmForAttendance(attendance);
    final approvedKm = _approvedKmForAttendance(attendance);
    final metadata = {
      ...existingMetadata,
      ...endLocationMetadata,
      'travel_mode': attendance.travelMode,
      'payable_km_allowed': attendance.payableKmAllowed,
      if (endDayWithOpenSite) 'end_day_with_open_site': true,
      if (openSiteAutoClosed) 'open_site_auto_closed': true,
      if (endDayWithOpenSite) 'payable_km_after_site_checkin_added': false,
      if (autoClosedSiteVisitId?.trim().isNotEmpty == true)
        'auto_closed_site_visit_id': autoClosedSiteVisitId!.trim(),
    };
    final rows = await client
        .from('fo_attendance')
        .update({
          'logout_time': logoutTime.toUtc().toIso8601String(),
          'end_latitude': attendance.endLat,
          'end_longitude': attendance.endLng,
          'end_battery_percentage': attendance.batteryEnd,
          'actual_km': payableKm,
          'eligible_km': approvedKm,
          'total_raw_km': attendance.actualKm,
          'total_route_km': payableKm,
          'total_approved_km': approvedKm,
          'rate_per_km': 4,
          'petrol_amount': approvedKm * 4,
          'status': 'Completed',
          'metadata': metadata,
          'updated_at': DateTime.now().toUtc().toIso8601String(),
        })
        .eq('id', id)
        .eq('fo_user_id', user.employeeCode)
        .eq('status', 'Active')
        .filter('logout_time', 'is', null)
        .select('*');
    final records = List<Map<String, dynamic>>.from(rows);
    if (records.length != 1) {
      final latestRows = await client
          .from('fo_attendance')
          .select('*')
          .eq('id', id)
          .eq('fo_user_id', user.employeeCode)
          .limit(1);
      final latestRecords = List<Map<String, dynamic>>.from(latestRows);
      if (latestRecords.isNotEmpty &&
          _isCompletedAttendanceRow(latestRecords.first)) {
        return EndDayAttendanceResolution(
          attendance: _attendanceFromRow(latestRecords.first, user),
          alreadyCompleted: true,
          usedFallback: resolution.usedFallback,
        );
      }
      throw StateError(
        'End Day attendance update affected ${records.length} rows.',
      );
    }
    await CrashLogService.record(
      employeeCode: user.employeeCode,
      screen: 'home',
      action: 'END_DAY_ATTENDANCE_COMPLETION_SUCCEEDED',
      error: 'attendance_id=$id fallback=${resolution.usedFallback}',
    );
    return EndDayAttendanceResolution(
      attendance: _attendanceFromRow(records.first, user),
      alreadyCompleted: false,
      usedFallback: resolution.usedFallback,
    );
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
      final payableKm = _payableRouteKmForAttendance(attendance);
      final approvedKm = _approvedKmForAttendance(attendance);
      final payload = {
        'actual_km': payableKm,
        'eligible_km': approvedKm,
        'total_raw_km': attendance.actualKm,
        'total_route_km': payableKm,
        'total_approved_km': approvedKm,
        'rate_per_km': 4,
        'petrol_amount': approvedKm * 4,
        'travel_mode': attendance.travelMode,
        'payable_km_allowed': attendance.payableKmAllowed,
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
    if (!attendance.payableKmAllowed) {
      final preservedKm = _preservedPayableKm(attendance);
      attendance
        ..totalRouteKm = preservedKm
        ..eligibleKm = preservedKm;
      await CrashLogService.record(
        employeeCode: attendance.employeeCode,
        screen: 'tracking',
        action: 'ROUTE_KM_NON_PAYABLE_TRAVEL_MODE',
        error:
            'attendance_uuid=$id travel_mode=${attendance.travelMode} payable_km_allowed=false',
      );
      return;
    }
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
    final metadata = _jsonMap(row['metadata']);
    final travelMode = normalizeTravelMode(
      row['travel_mode']?.toString() ?? metadata['travel_mode']?.toString(),
    );
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
      petrolAmount: _double(row['petrol_amount']),
      travelMode: travelMode,
      payableKmAllowed:
          _bool(row['payable_km_allowed']) ??
          _bool(metadata['payable_km_allowed']) ??
          payableKmAllowedForTravelMode(travelMode),
      travelModeNote:
          row['travel_mode_note']?.toString() ??
          metadata['travel_mode_note']?.toString(),
      metadata: metadata,
    );
  }

  static Map<String, dynamic> _travelLegPayload(
    TravelLeg travelLeg,
    FoUser user,
  ) {
    final employeeCode = travelLeg.employeeCode.trim().isNotEmpty
        ? travelLeg.employeeCode.trim()
        : user.employeeCode.trim();
    return {
      'attendance_id': _uuidOrNull(travelLeg.attendanceId),
      'employee_code': employeeCode,
      'fo_user_id': travelLeg.foUserId?.trim().isNotEmpty == true
          ? travelLeg.foUserId!.trim()
          : employeeCode,
      'travel_mode': travelLeg.travelMode,
      'payable_km_allowed': travelLeg.payableKmAllowed,
      'started_at': travelLeg.startedAt.toUtc().toIso8601String(),
      'ended_at': travelLeg.endedAt?.toUtc().toIso8601String(),
      'start_lat': travelLeg.startLat,
      'start_lng': travelLeg.startLng,
      'end_lat': travelLeg.endLat,
      'end_lng': travelLeg.endLng,
      'calculated_km': double.parse(travelLeg.calculatedKm.toStringAsFixed(2)),
      'payable_km': double.parse(travelLeg.payableKm.toStringAsFixed(2)),
      'fare_amount': double.parse(travelLeg.fareAmount.toStringAsFixed(2)),
      'proof_file_url': travelLeg.proofFileUrl,
      'remarks': travelLeg.remarks,
      'status': travelLeg.status,
    };
  }

  static TravelLeg _travelLegFromRow(Map<String, dynamic> row) {
    return TravelLeg(
      id: row['id']?.toString() ?? '',
      remoteId: row['id']?.toString(),
      attendanceId: row['attendance_id']?.toString() ?? '',
      employeeCode: row['employee_code']?.toString() ?? '',
      foUserId: row['fo_user_id']?.toString(),
      travelMode: row['travel_mode']?.toString() ?? travelModeBike,
      payableKmAllowed:
          _bool(row['payable_km_allowed']) ??
          payableKmAllowedForTravelMode(row['travel_mode']?.toString()),
      startedAt:
          DateTime.tryParse(row['started_at']?.toString() ?? '')?.toLocal() ??
          DateTime.now(),
      endedAt: DateTime.tryParse(row['ended_at']?.toString() ?? '')?.toLocal(),
      startLat: _double(row['start_lat']),
      startLng: _double(row['start_lng']),
      endLat: _double(row['end_lat']),
      endLng: _double(row['end_lng']),
      calculatedKm: _double(row['calculated_km']) ?? 0,
      payableKm: _double(row['payable_km']) ?? 0,
      fareAmount: _double(row['fare_amount']) ?? 0,
      proofFileUrl: row['proof_file_url']?.toString(),
      remarks: row['remarks']?.toString(),
      status: row['status']?.toString() ?? 'active',
      createdAt: DateTime.tryParse(
        row['created_at']?.toString() ?? '',
      )?.toLocal(),
      updatedAt: DateTime.tryParse(
        row['updated_at']?.toString() ?? '',
      )?.toLocal(),
    );
  }

  static double _payableRouteKmForAttendance(Attendance attendance) {
    if (attendance.payableKmAllowed) return attendance.totalRouteKm;
    return _preservedPayableKm(attendance);
  }

  static double _approvedKmForAttendance(Attendance attendance) {
    if (attendance.payableKmAllowed) return attendance.eligibleKm;
    return _preservedPayableKm(attendance);
  }

  static double _preservedPayableKm(Attendance attendance) {
    final preserved = _double(
      attendance.metadata['payable_km_preserved_before_mode_change'],
    );
    if (preserved == null || !preserved.isFinite || preserved < 0) return 0;
    return double.parse(preserved.toStringAsFixed(2));
  }

  static String? _travelClaimRemarks({
    String? fromLocation,
    String? toLocation,
    String? remarks,
  }) {
    final lines = <String>[];
    final from = fromLocation?.trim();
    final to = toLocation?.trim();
    final note = remarks?.trim();
    if (from?.isNotEmpty == true) lines.add('From: $from');
    if (to?.isNotEmpty == true) lines.add('To: $to');
    if (note?.isNotEmpty == true) lines.add('Remarks: $note');
    return lines.isEmpty ? null : lines.join('\n');
  }

  static String _storagePathPart(String value) {
    final clean = value
        .trim()
        .replaceAll(RegExp(r'[^A-Za-z0-9._-]+'), '_')
        .replaceAll(RegExp(r'_+'), '_');
    return clean.isEmpty ? 'unknown' : clean;
  }

  static String _storageExtension(String value) {
    final clean = value.trim().toLowerCase().replaceAll('.', '');
    switch (clean) {
      case 'jpeg':
        return 'jpg';
      case 'png':
      case 'pdf':
      case 'jpg':
        return clean;
      default:
        return 'jpg';
    }
  }

  static String _storageTimestamp(DateTime value) {
    final local = value.toLocal();
    String two(int number) => number.toString().padLeft(2, '0');
    return '${local.year}${two(local.month)}${two(local.day)}_'
        '${two(local.hour)}${two(local.minute)}${two(local.second)}';
  }

  static bool _isCompletedAttendanceRow(Map<String, dynamic> row) {
    final status = row['status']?.toString().trim().toLowerCase() ?? '';
    return row['logout_time'] != null ||
        status == 'completed' ||
        status == 'ended' ||
        status == 'stale auto ended' ||
        status == 'stale_auto_ended';
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

  static bool? _bool(Object? value) {
    if (value == null) return null;
    if (value is bool) return value;
    final text = value.toString().trim().toLowerCase();
    if (text == 'true' || text == '1' || text == 'yes') return true;
    if (text == 'false' || text == '0' || text == 'no') return false;
    return null;
  }

  static Map<String, dynamic> _jsonMap(Object? value) {
    if (value is Map<String, dynamic>) return Map<String, dynamic>.from(value);
    if (value is Map) return Map<String, dynamic>.from(value);
    return <String, dynamic>{};
  }

  static Future<String?> insertLocation(LocationLog log) async {
    final employeeCode = log.employeeCode.trim();
    if (employeeCode.isEmpty) {
      throw StateError('GPS log employee_code is missing.');
    }
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
      if (_isDuplicateLocationLocalIdError(error)) {
        await CrashLogService.record(
          employeeCode: log.employeeCode,
          screen: 'tracking',
          action: 'GPS_LOG_DUPLICATE_TREATED_SYNCED',
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
      if (log.employeeCode.trim().isEmpty) {
        await CrashLogService.record(
          screen: 'tracking',
          action: 'LOCATION_LOG_SKIPPED_NO_EMPLOYEE_CODE',
          error: 'local_id=${log.id}',
        );
        continue;
      }
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
          final remoteId = await insertLocation(log);
          result[log.id] = remoteId;
          if (remoteId == null) {
            await CrashLogService.record(
              employeeCode: log.employeeCode,
              screen: 'tracking',
              action: 'GPS_LOG_QUEUE_ITEM_REMOVED_AFTER_DUPLICATE',
              error: 'local_id=${log.id}',
            );
          }
        } catch (itemError) {
          if (_isDuplicateLocationLocalIdError(itemError)) {
            result[log.id] = null;
            await CrashLogService.record(
              employeeCode: log.employeeCode,
              screen: 'tracking',
              action: 'GPS_LOG_QUEUE_ITEM_REMOVED_AFTER_DUPLICATE',
              error: 'local_id=${log.id}',
            );
            continue;
          }
          break;
        }
      }
      if (result.isNotEmpty) {
        await CrashLogService.record(
          screen: 'tracking',
          action: 'GPS_LOG_BATCH_SYNC_CONTINUED',
          error:
              'synced_or_duplicate=${result.length} total=${validLogs.length}',
        );
      }
      return result;
    }
  }

  static bool _isDuplicateLocationLocalIdError(Object error) {
    if (error is! PostgrestException) return false;
    final message = error.message.toLowerCase();
    final details = (error.details ?? '').toString().toLowerCase();
    final hint = (error.hint ?? '').toString().toLowerCase();
    final code = error.code;
    return (code == '23505' || code == '409') &&
        (message.contains('ux_fo_location_logs_local_id') ||
            details.contains('ux_fo_location_logs_local_id') ||
            hint.contains('ux_fo_location_logs_local_id') ||
            message.contains('local_id'));
  }

  static Map<String, dynamic> _locationPayload(
    LocationLog log,
    String attendanceId,
  ) {
    final employeeCode = log.employeeCode.trim();
    if (employeeCode.isEmpty) {
      throw StateError('GPS log employee_code is missing.');
    }
    return {
      'fo_user_id': employeeCode,
      'employee_code': employeeCode,
      'username': employeeCode,
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

  static Future<LocationLog?> fetchLatestLocationLogForAttendance({
    required FoUser user,
    required String attendanceId,
  }) async {
    if (!isValidUuid(attendanceId)) return null;
    final rows = await client
        .from('fo_location_logs')
        .select('*')
        .eq('fo_user_id', user.employeeCode)
        .eq('attendance_id', attendanceId)
        .not('latitude', 'is', null)
        .not('longitude', 'is', null)
        .order('captured_at', ascending: false)
        .order('logged_at', ascending: false)
        .order('created_at', ascending: false)
        .limit(1);
    final records = List<Map<String, dynamic>>.from(rows);
    if (records.isEmpty) return null;
    return _locationLogFromRow(records.first);
  }

  static Future<Map<String, dynamic>> triggerFoKmRecalculation({
    required String attendanceId,
    required String foUserId,
    String? date,
  }) async {
    final baseUrl = AppConfig.backendApiUrl.trim();
    final token = currentAccessToken;
    if (baseUrl.isEmpty || token == null || token.trim().isEmpty) {
      throw StateError('Backend API is not configured for KM recalculation.');
    }
    final base = Uri.parse(baseUrl);
    final uri = base.replace(
      path: _joinPath(base.path, '/api/fo/km/recalculate'),
    );
    final client = HttpClient();
    try {
      final request = await client.postUrl(uri);
      request.headers.set(HttpHeaders.authorizationHeader, 'Bearer $token');
      request.headers.contentType = ContentType.json;
      request.write(
        jsonEncode({
          'attendance_id': attendanceId,
          'fo_user_id': foUserId,
          if (date?.trim().isNotEmpty == true) 'date': date!.trim(),
        }),
      );
      final response = await request.close();
      final text = await response.transform(utf8.decoder).join();
      if (response.statusCode < 200 || response.statusCode >= 300) {
        throw StateError(
          text.trim().isEmpty
              ? 'KM recalculation failed.'
              : 'KM recalculation failed: $text',
        );
      }
      if (text.trim().isEmpty) return const {};
      final decoded = jsonDecode(text);
      return decoded is Map<String, dynamic> ? decoded : const {};
    } finally {
      client.close(force: true);
    }
  }

  static String _joinPath(String basePath, String path) {
    final left = basePath.endsWith('/')
        ? basePath.substring(0, basePath.length - 1)
        : basePath;
    final right = path.startsWith('/') ? path : '/$path';
    return '$left$right';
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

  static Future<List<Store>> fetchStoresWithGps({
    int pageSize = 500,
    bool forceRefresh = false,
  }) async {
    final stopwatch = Stopwatch()..start();
    if (!forceRefresh) {
      final cached = await LocalStore.getStoresWithGpsCache();
      if (cached.isNotEmpty) {
        PerformanceLogService.step(
          operation: 'store_master',
          step: 'cache_load',
          stopwatch: stopwatch,
        );
        unawaited(refreshStoresWithGpsCache(pageSize: pageSize));
        return cached;
      }
    }

    try {
      final stores = await _fetchStoresWithGpsRemote(pageSize: pageSize);
      await LocalStore.saveStoresWithGpsCache(stores);
      PerformanceLogService.step(
        operation: 'store_master',
        step: 'remote_load',
        stopwatch: stopwatch,
      );
      return stores;
    } catch (error) {
      final cached = await LocalStore.getStoresWithGpsCache();
      if (cached.isNotEmpty) {
        PerformanceLogService.step(
          operation: 'store_master',
          step: 'remote_failed_cache_fallback',
          stopwatch: stopwatch,
          status: 'fallback',
        );
        return cached;
      }
      PerformanceLogService.step(
        operation: 'store_master',
        step: 'remote_load',
        stopwatch: stopwatch,
        status: 'failed',
      );
      rethrow;
    }
  }

  static Future<void> refreshStoresWithGpsCache({int pageSize = 500}) async {
    final stopwatch = Stopwatch()..start();
    try {
      final stores = await _fetchStoresWithGpsRemote(pageSize: pageSize);
      await LocalStore.saveStoresWithGpsCache(stores);
      PerformanceLogService.step(
        operation: 'store_master',
        step: 'background_refresh',
        stopwatch: stopwatch,
      );
    } catch (_) {
      PerformanceLogService.step(
        operation: 'store_master',
        step: 'background_refresh',
        stopwatch: stopwatch,
        status: 'failed',
      );
    }
  }

  static Future<DateTime?> storesWithGpsCacheSavedAt() {
    return LocalStore.getStoresWithGpsCacheSavedAt();
  }

  static Future<List<Store>> _fetchStoresWithGpsRemote({int pageSize = 500}) {
    return collectStorePages(
      pageSize: pageSize,
      loadPage: (from, to) async {
        final rows = await client
            .from('store_master')
            .select()
            .not('latitude', 'is', null)
            .not('longitude', 'is', null)
            .eq('status', 'Active')
            .order('id', ascending: true)
            .range(from, to);
        return List<Map<String, dynamic>>.from(rows);
      },
    );
  }

  @visibleForTesting
  static Future<List<Store>> collectStorePages({
    required StorePageLoader loadPage,
    int pageSize = 500,
    int maxPages = 100,
  }) async {
    if (pageSize <= 0) throw ArgumentError.value(pageSize, 'pageSize');
    if (maxPages <= 0) throw ArgumentError.value(maxPages, 'maxPages');

    final storesById = <String, Store>{};
    for (var page = 0; page < maxPages; page += 1) {
      final from = page * pageSize;
      final rows = await loadPage(from, from + pageSize - 1);
      for (final row in rows) {
        final store = Store.fromJson(row);
        storesById.putIfAbsent(store.id, () => store);
      }
      if (rows.length < pageSize) return storesById.values.toList();
    }

    throw StateError(
      'Store Master pagination exceeded the $maxPages-page safety limit.',
    );
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
    final employeeCode = user.employeeCode.trim();
    final fullName = user.fullName.trim();
    if (employeeCode.isEmpty) {
      throw const StoreCreateException(
        'Your employee code is missing. Please sign out and sign in again.',
      );
    }
    final code = storeCode?.trim().isNotEmpty == true
        ? storeCode!.trim()
        : 'FO-$employeeCode-${DateTime.now().millisecondsSinceEpoch}';
    final cleanBusiness = business?.trim();
    final metadata = {
      'approval_status': 'pending_approval',
      'verification_status': 'Pending',
      'source': 'created_by_fo',
      'created_by_employee_code': employeeCode,
      'created_by_full_name': fullName,
      'is_temporary': true,
      'first_captured_by': employeeCode,
      'first_captured_by_name': fullName,
      if (locationName?.trim().isNotEmpty == true)
        'mall_building_location_name': locationName!.trim(),
      if (addressLandmark?.trim().isNotEmpty == true)
        'address_landmark': addressLandmark!.trim(),
      if (remarks?.trim().isNotEmpty == true) 'remarks': remarks!.trim(),
    };
    final payload = <String, dynamic>{
      'store_name': storeName.trim(),
      'client_name': clientName.trim(),
      'store_code': code,
      'state': state.trim(),
      'business': cleanBusiness?.isEmpty == true ? null : cleanBusiness,
      'created_by_employee_code': employeeCode,
      'created_by_full_name': fullName,
      'captured_at': DateTime.now().toUtc().toIso8601String(),
      'status': 'Active',
      'metadata': metadata,
    };
    if (latitude != null) payload['latitude'] = latitude;
    if (longitude != null) payload['longitude'] = longitude;
    if (accuracy != null) payload['gps_accuracy'] = accuracy;
    final attendanceId = _uuidOrNull(attendance.remoteId);
    if (attendanceId != null) payload['attendance_id'] = attendanceId;
    try {
      final row = await client
          .from('store_master')
          .insert(payload)
          .select('id')
          .maybeSingle();
      await CrashLogService.record(
        employeeCode: user.employeeCode,
        screen: 'tasks',
        action: 'STORE_CREATE_SUCCESS',
      );
      return row?['id']?.toString();
    } on PostgrestException catch (error, stackTrace) {
      await CrashLogService.record(
        employeeCode: employeeCode,
        screen: 'tasks',
        action: 'STORE_CREATE_FAILED',
        error:
            'supabase_code=${error.code} supabase_message=${error.message} payload_keys=${payload.keys.join(',')}',
        stackTrace: stackTrace,
      );
      throw StoreCreateException(
        _storeCreateErrorMessage(error, storeCode: code),
        code: error.code,
      );
    } catch (error, stackTrace) {
      await CrashLogService.record(
        employeeCode: employeeCode,
        screen: 'tasks',
        action: 'STORE_CREATE_FAILED',
        error:
            'error_type=${error.runtimeType} payload_keys=${payload.keys.join(',')}',
        stackTrace: stackTrace,
      );
      throw const StoreCreateException(
        'Store could not be saved. Please check your connection and try again.',
      );
    }
  }

  static String _storeCreateErrorMessage(
    PostgrestException error, {
    String? storeCode,
  }) {
    return storeCreateErrorMessage(
      code: error.code,
      message: error.message,
      details: error.details?.toString(),
      storeCode: storeCode,
    );
  }

  @visibleForTesting
  static String storeCreateErrorMessage({
    String? code,
    String? message,
    String? details,
    String? storeCode,
  }) {
    final normalizedCode = code?.trim() ?? '';
    final duplicateEvidence = [
      normalizedCode,
      message ?? '',
      details ?? '',
    ].join(' ').toLowerCase();
    final isDuplicate =
        normalizedCode == '23505' ||
        normalizedCode == '409' ||
        duplicateEvidence.contains('duplicate key') ||
        duplicateEvidence.contains('unique constraint') ||
        duplicateEvidence.contains('already exists') ||
        duplicateEvidence.contains('23505');
    if (isDuplicate) {
      final normalizedStoreCode = storeCode?.trim().toUpperCase() ?? '';
      final storeLabel = normalizedStoreCode.isEmpty
          ? 'Store'
          : 'Store $normalizedStoreCode';
      return '$storeLabel already exists. Please close Add Site and use Check-In to Site.';
    }

    switch (normalizedCode) {
      case '42501':
        return 'Store permission was denied. Please sign out, sign in again, and retry.';
      case '23502':
        return 'A required store field is missing. Please complete all fields and retry.';
      case '42703':
      case 'PGRST204':
        return 'The app store form does not match the server schema. Please contact support.';
      default:
        return 'Store could not be saved (error $normalizedCode). Please retry or contact support.';
    }
  }

  static Future<String?> insertVisit({
    required FoUser user,
    required SiteVisit visit,
  }) async {
    try {
      await requireAuthenticatedSession(
        user,
        screen: 'tasks',
        action: 'CHECKIN_AUTH_SESSION_INVALID',
      );
      await CrashLogService.record(
        employeeCode: visit.employeeCode,
        screen: 'tasks',
        action: 'CHECKIN_AUTH_WRITE_CONTEXT',
        error: writeDiagnostic(
          operation: 'site_visit_insert',
          user: user,
          attendanceId: visit.attendanceId,
        ),
      );
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
        'check_in_latitude': visit.currentLatitude,
        'check_in_longitude': visit.currentLongitude,
        'route_km': visit.routeKm,
        'status': visit.status,
        'visit_status': visit.status,
        'sync_status': 'synced',
        'metadata': {
          ...visit.metadata,
          if (visit.currentGpsAccuracy != null)
            'checkin_accuracy': visit.currentGpsAccuracy,
          if (visit.originLatitude != null) 'origin_lat': visit.originLatitude,
          if (visit.originLongitude != null)
            'origin_lng': visit.originLongitude,
          if (visit.destinationLatitude != null)
            'destination_lat': visit.destinationLatitude,
          if (visit.destinationLongitude != null)
            'destination_lng': visit.destinationLongitude,
          'checkin_synced_at': DateTime.now().toUtc().toIso8601String(),
        },
      };
      final row = await client
          .from('fo_site_visits')
          .insert(payload)
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
        error: writeDiagnostic(
          operation: 'site_visit_insert',
          user: user,
          attendanceId: visit.attendanceId,
          error: error,
        ),
        stackTrace: stackTrace,
      );
      rethrow;
    }
  }

  static Future<void> updateVisitCheckout({
    required FoUser user,
    required SiteVisit visit,
  }) async {
    final id = visit.remoteId;
    if (!isValidUuid(id)) {
      throw StateError('Site visit sync missing. Please reload and try again.');
    }
    await requireAuthenticatedSession(
      user,
      screen: 'tasks',
      action: 'CHECKOUT_AUTH_SESSION_INVALID',
    );
    await CrashLogService.record(
      employeeCode: visit.employeeCode,
      screen: 'tasks',
      action: 'CHECKOUT_AUTH_WRITE_CONTEXT',
      error: writeDiagnostic(
        operation: 'site_visit_checkout_update',
        user: user,
        attendanceId: visit.attendanceId,
        visitId: id,
      ),
    );
    await findOpenSiteVisitById(user: user, siteVisitId: id!);
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
      'route_km': visit.routeKm,
      'status': visit.status,
      'visit_status': visit.status,
      'sync_status': 'synced',
      'metadata': {
        ...visit.metadata,
        if (visit.durationMinutes != null)
          'visit_duration_minutes': visit.durationMinutes,
        'checkout_synced_at': DateTime.now().toUtc().toIso8601String(),
      },
      'updated_at': DateTime.now().toUtc().toIso8601String(),
    };
    try {
      final rows = await client
          .from('fo_site_visits')
          .update(payload)
          .eq('id', id)
          .or(
            'fo_user_id.eq.${user.employeeCode},employee_code.eq.${user.employeeCode}',
          )
          .filter('checkout_time', 'is', null)
          .filter('check_out_time', 'is', null)
          .select('id');
      if (List<Map<String, dynamic>>.from(rows).isEmpty) {
        throw StateError('Check Out update matched 0 site visit rows.');
      }
    } catch (error, stackTrace) {
      await CrashLogService.record(
        employeeCode: visit.employeeCode,
        screen: 'tasks',
        action: 'SITE_VISIT_CHECKOUT_UPDATE_FAILED',
        error: writeDiagnostic(
          operation: 'site_visit_checkout_update',
          user: user,
          attendanceId: visit.attendanceId,
          visitId: id,
          error: error,
        ),
        stackTrace: stackTrace,
      );
      rethrow;
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
