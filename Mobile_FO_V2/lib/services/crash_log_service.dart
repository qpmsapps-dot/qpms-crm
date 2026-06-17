import 'dart:convert';

import 'package:flutter/foundation.dart';
import 'package:shared_preferences/shared_preferences.dart';

import 'local_store.dart';
import 'supabase_service.dart';

enum CrashLogLevel { debug, info, warning, error }

class CrashLogService {
  static const _key = 'mobile_crash_logs_queue';
  static bool _syncing = false;

  static Future<void> record({
    String? employeeCode,
    required String screen,
    required String action,
    Object? error,
    StackTrace? stackTrace,
    CrashLogLevel? level,
  }) async {
    try {
      final logLevel = level ?? _inferLevel(action, error, stackTrace);
      final user = await LocalStore.getUser();
      final foUserId = employeeCode ?? user?.employeeCode;
      final errorMessage = error?.toString() ?? '';
      final stack = stackTrace?.toString() ?? '';
      final row = {
        'id': '${DateTime.now().microsecondsSinceEpoch}-$screen-$action',
        'fo_user_id': foUserId,
        'stage': action,
        'employee_code': foUserId,
        'screen': screen,
        'action': action,
        'log_level': logLevel.name,
        'error_message': errorMessage,
        'stack_trace': stack,
        'created_at': DateTime.now().toUtc().toIso8601String(),
        'synced': false,
      };
      debugPrint(
        '[myQPMS FO V2] ${logLevel.name.toUpperCase()} $screen/$action'
        '${errorMessage.isEmpty ? '' : ' ERROR: $errorMessage'}',
      );
      if (stack.isNotEmpty) debugPrint(stack);
      if (logLevel != CrashLogLevel.error) return;
      final prefs = await SharedPreferences.getInstance();
      final logs = await _read();
      logs.add(row);
      final retained = logs.length > 150
          ? logs.sublist(logs.length - 150)
          : logs;
      await prefs.setString(_key, jsonEncode(retained));
      await sync();
    } catch (logError) {
      debugPrint('[myQPMS FO V2] Crash logging failed: $logError');
    }
  }

  static Future<void> sync() async {
    if (_syncing || !SupabaseService.isReady) return;
    _syncing = true;
    try {
      final logs = await _read();
      var changed = false;
      for (final log in logs.where((e) => e['synced'] != true)) {
        if (!_shouldPersist(log)) {
          log['synced'] = true;
          changed = true;
          continue;
        }
        try {
          await _insertLog(log);
          log['synced'] = true;
          changed = true;
        } catch (error, stackTrace) {
          debugPrint('[myQPMS FO V2] Crash log Supabase sync failed: $error');
          debugPrint(stackTrace.toString());
          break;
        }
      }
      if (changed) {
        final prefs = await SharedPreferences.getInstance();
        await prefs.setString(_key, jsonEncode(logs));
      }
    } finally {
      _syncing = false;
    }
  }

  static Future<List<Map<String, dynamic>>> _read() async {
    final prefs = await SharedPreferences.getInstance();
    final value = prefs.getString(_key);
    if (value == null || value.isEmpty) return [];
    return (jsonDecode(value) as List<dynamic>)
        .map((e) => Map<String, dynamic>.from(e as Map))
        .toList();
  }

  static Future<void> _insertLog(Map<String, dynamic> log) async {
    final payload = {
      'fo_user_id': log['fo_user_id'] ?? log['employee_code'],
      'stage': log['stage'] ?? log['action'],
      'employee_code': log['employee_code'] ?? log['fo_user_id'],
      'screen': log['screen'],
      'action': log['action'] ?? log['stage'],
      'log_level': log['log_level'] ?? CrashLogLevel.error.name,
      'error_message': log['error_message'],
      'stack_trace': log['stack_trace'],
      'created_at': log['created_at'],
    };
    try {
      await SupabaseService.client.from('mobile_crash_logs').insert(payload);
    } catch (_) {
      await SupabaseService.client.from('mobile_crash_logs').insert({
        'fo_user_id': log['fo_user_id'] ?? log['employee_code'],
        'stage': log['stage'] ?? log['action'],
        'employee_code': log['employee_code'] ?? log['fo_user_id'],
        'screen': log['screen'],
        'action': log['action'] ?? log['stage'],
        'error_message': log['error_message'],
        'stack_trace': log['stack_trace'],
        'created_at': log['created_at'],
      });
    }
  }

  static CrashLogLevel _inferLevel(
    String action,
    Object? error,
    StackTrace? stackTrace,
  ) {
    final normalized = action.toUpperCase();
    if (stackTrace != null ||
        normalized.contains('CRASH') ||
        normalized.contains('EXCEPTION') ||
        normalized.contains('ERROR') ||
        normalized.contains('FAILED') ||
        normalized.endsWith('_FAILURE') ||
        normalized == 'FLUTTER_ERROR' ||
        normalized == 'PLATFORM_ERROR' ||
        normalized == 'ZONE_ERROR' ||
        normalized == 'PLATFORM_DISPATCHER_ERROR' ||
        normalized == 'RUN_ZONED_GUARDED_ERROR' ||
        normalized == 'BACKGROUND_PERMISSION_MISSING' ||
        normalized == 'LOCATION_SERVICE_DISABLED' ||
        normalized == 'BATTERY_OPTIMIZATION_REQUEST_FAILED' ||
        normalized == 'FOREGROUND_SERVICE_FAILED_FALLBACK_TIMER') {
      return CrashLogLevel.error;
    }
    if (normalized.contains('WARNING') ||
        normalized.contains('BLOCKED') ||
        normalized.contains('MISSING') ||
        normalized.contains('SKIPPED') ||
        normalized.contains('DENIED') ||
        normalized.contains('DUPLICATE') ||
        normalized.contains('RETRY_PENDING') ||
        normalized.contains('UNUSABLE') ||
        normalized.contains('REJECTED')) {
      return CrashLogLevel.warning;
    }
    if (_isDebugAction(normalized)) return CrashLogLevel.debug;
    if (error != null) return CrashLogLevel.info;
    return CrashLogLevel.info;
  }

  static bool _shouldPersist(Map<String, dynamic> log) {
    final level = log['log_level']?.toString();
    if (level != null && level.isNotEmpty) {
      return level == CrashLogLevel.error.name;
    }
    final action = (log['action'] ?? log['stage'] ?? '').toString();
    final errorMessage = log['error_message']?.toString();
    final stack = log['stack_trace']?.toString() ?? '';
    final inferred = _inferLevel(
      action,
      errorMessage == null || errorMessage.isEmpty ? null : errorMessage,
      stack.isEmpty ? null : StackTrace.fromString(stack),
    );
    log['log_level'] = inferred.name;
    return inferred == CrashLogLevel.error;
  }

  static bool _isDebugAction(String action) {
    const exactDebugActions = {
      'GPS_ACCEPTED_FOR_KM',
      'GPS_REJECTED_TINY_NOISE',
      'GPS_REJECTED_LOW_ACCURACY',
      'GPS_REJECTED_SPEED_SPIKE',
      'LOCAL_LOG_SAVE_SUCCESS',
      'LOCAL_LOG_SAVE_START',
      'LOCATION_UPDATE_RECEIVED',
      'ROUTE_KM_CALCULATOR_SUCCESS',
      'ROUTE_KM_CALCULATOR_START',
      'GPS_LOG_SAVED_LOCAL',
      'GPS_FETCH_START',
      'ATTENDANCE_LOAD_SUCCESS',
      'ATTENDANCE_LOAD_START',
      'USER_LOAD_SUCCESS',
      'USER_LOAD_START',
    };
    if (exactDebugActions.contains(action)) return true;
    return action.endsWith('_START') ||
        action.endsWith('_SUCCESS') ||
        action.endsWith('_STARTED') ||
        action.endsWith('_STOPPED') ||
        action.endsWith('_LOADED') ||
        action.endsWith('_FOUND') ||
        action.endsWith('_COUNT') ||
        action.endsWith('_SAVED') ||
        action.endsWith('_UPDATED') ||
        action.endsWith('_CAPTURED') ||
        action.endsWith('_CLEARED') ||
        action.endsWith('_REQUEST') ||
        action.endsWith('_REQUESTED') ||
        action.endsWith('_CHECK') ||
        action.endsWith('_OPENED') ||
        action.endsWith('_SELECTED') ||
        action.endsWith('_CONFIGURED') ||
        action.contains('_SYNC_SUCCESS') ||
        action.contains('_BATCH_SYNCED') ||
        action.contains('_LOAD_SUCCESS') ||
        action.contains('_SAVE_SUCCESS') ||
        action.contains('_INSERT_SUCCESS') ||
        action.contains('_UPDATE_SUCCESS') ||
        action.contains('_CALCULATE_SUCCESS') ||
        action.contains('_CALC_SUCCESS');
  }
}
