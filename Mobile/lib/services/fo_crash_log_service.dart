import 'dart:convert';

import 'package:flutter/foundation.dart';
import 'package:shared_preferences/shared_preferences.dart';

import 'fo_storage_service.dart';
import 'supabase_service.dart';

enum FoCrashLogLevel { debug, info, warning, error }

class FoCrashLogService {
  FoCrashLogService._();

  static const _logsKey = 'myqpms_mobile_crash_logs';
  static const _maxLogs = 120;
  static bool _syncing = false;

  static Future<void> breadcrumb({
    String? employeeCode,
    required String screen,
    required String action,
  }) {
    return record(
      employeeCode: employeeCode,
      screen: screen,
      action: action,
      error: 'breadcrumb',
      level: FoCrashLogLevel.debug,
    );
  }

  static Future<void> record({
    String? employeeCode,
    required String screen,
    required String action,
    Object? error,
    StackTrace? stackTrace,
    bool syncNow = false,
    FoCrashLogLevel? level,
  }) async {
    try {
      final logLevel = level ?? _inferLevel(action, error, stackTrace);
      final createdAt = DateTime.now().toUtc().toIso8601String();
      final row = <String, dynamic>{
        'id': '${DateTime.now().microsecondsSinceEpoch}-$screen-$action',
        'employee_code': employeeCode ?? await _employeeCode(),
        'screen': screen,
        'action': action,
        'log_level': logLevel.name,
        'error_message': error?.toString() ?? '',
        'stack_trace': stackTrace?.toString() ?? '',
        'created_at': createdAt,
        'synced': false,
      };
      debugPrint(
        '[myQPMS CrashLog] ${logLevel.name.toUpperCase()} ${row['screen']} / ${row['action']} / ${row['error_message']}',
      );
      if (logLevel != FoCrashLogLevel.error) return;
      await _append(row);
      if (syncNow) await syncPending();
    } catch (logError, logStackTrace) {
      debugPrint('[myQPMS CrashLog] Local write failed: $logError');
      debugPrintStack(stackTrace: logStackTrace);
    }
  }

  static Future<Map<String, dynamic>?> latest() async {
    try {
      final logs = await _readLogs();
      return logs.isEmpty ? null : logs.last;
    } catch (error) {
      debugPrint('[myQPMS CrashLog] Latest read failed: $error');
      return null;
    }
  }

  static Future<void> printLatest() async {
    final log = await latest();
    if (log == null) return;
    debugPrint(
      '[myQPMS CrashLog] Last persisted log: ${log['created_at']} '
      '${log['screen']} / ${log['action']} / ${log['error_message']}',
    );
  }

  static Future<void> syncPending() async {
    if (_syncing) return;
    final supabase = QpmsSupabaseService.client;
    if (supabase == null) return;
    _syncing = true;
    try {
      final logs = await _readLogs();
      var changed = false;
      for (final log in logs.where((entry) => entry['synced'] != true)) {
        if (!_shouldPersist(log)) {
          log['synced'] = true;
          changed = true;
          continue;
        }
        try {
          await supabase.from('mobile_crash_logs').insert({
            'id': log['id'],
            'employee_code': log['employee_code'],
            'screen': log['screen'],
            'action': log['action'],
            'log_level': log['log_level'] ?? FoCrashLogLevel.error.name,
            'error_message': log['error_message'],
            'stack_trace': log['stack_trace'],
            'created_at': log['created_at'],
          });
        } catch (_) {
          await supabase.from('mobile_crash_logs').insert({
            'id': log['id'],
            'employee_code': log['employee_code'],
            'screen': log['screen'],
            'action': log['action'],
            'error_message': log['error_message'],
            'stack_trace': log['stack_trace'],
            'created_at': log['created_at'],
          });
          log['synced'] = true;
          changed = true;
          continue;
        }
        log['synced'] = true;
        changed = true;
      }
      if (changed) await _saveLogs(logs);
    } catch (error, stackTrace) {
      debugPrint('[myQPMS CrashLog] Sync failed: $error');
      debugPrintStack(stackTrace: stackTrace);
    } finally {
      _syncing = false;
    }
  }

  static Future<String?> _employeeCode() async {
    try {
      final user = await FoLocalStorage.getSessionUser();
      return user.id;
    } catch (_) {
      return null;
    }
  }

  static Future<void> _append(Map<String, dynamic> row) async {
    final logs = await _readLogs();
    logs.add(row);
    final retained = logs.length > _maxLogs
        ? logs.sublist(logs.length - _maxLogs)
        : logs;
    await _saveLogs(retained);
  }

  static Future<List<Map<String, dynamic>>> _readLogs() async {
    final prefs = await SharedPreferences.getInstance();
    final value = prefs.getString(_logsKey);
    if (value == null || value.isEmpty) return [];
    return (jsonDecode(value) as List<dynamic>)
        .map((entry) => Map<String, dynamic>.from(entry as Map))
        .toList();
  }

  static Future<void> _saveLogs(List<Map<String, dynamic>> logs) async {
    final prefs = await SharedPreferences.getInstance();
    await prefs.setString(_logsKey, jsonEncode(logs));
  }

  static FoCrashLogLevel _inferLevel(
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
        normalized == 'PLATFORM_DISPATCHER_ERROR' ||
        normalized == 'RUN_ZONED_GUARDED_ERROR' ||
        normalized == 'TRACKING_LOCATION_FETCH_FAILED' ||
        normalized == 'TRACKING_LOG_INSERT_FAILED' ||
        normalized == 'TRACKING_VISIT_GEOFENCE_FAILED') {
      return FoCrashLogLevel.error;
    }
    if (normalized.contains('WARNING') ||
        normalized.contains('BLOCKED') ||
        normalized.contains('MISSING') ||
        normalized.contains('SKIPPED') ||
        normalized.contains('DENIED') ||
        normalized.contains('DUPLICATE') ||
        normalized.contains('UNUSABLE') ||
        normalized.contains('REJECTED')) {
      return FoCrashLogLevel.warning;
    }
    if (normalized.endsWith('_START') ||
        normalized.endsWith('_SUCCESS') ||
        normalized.endsWith('_STOPPED') ||
        normalized.endsWith('_SAFELY') ||
        normalized.endsWith('_RUNNING')) {
      return FoCrashLogLevel.debug;
    }
    if (error != null) return FoCrashLogLevel.info;
    return FoCrashLogLevel.info;
  }

  static bool _shouldPersist(Map<String, dynamic> log) {
    final level = log['log_level']?.toString();
    if (level != null && level.isNotEmpty) {
      return level == FoCrashLogLevel.error.name;
    }
    final action = log['action']?.toString() ?? '';
    final errorMessage = log['error_message']?.toString();
    final stack = log['stack_trace']?.toString() ?? '';
    final inferred = _inferLevel(
      action,
      errorMessage == null || errorMessage.isEmpty ? null : errorMessage,
      stack.isEmpty ? null : StackTrace.fromString(stack),
    );
    log['log_level'] = inferred.name;
    return inferred == FoCrashLogLevel.error;
  }
}
