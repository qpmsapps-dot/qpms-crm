import 'dart:convert';

import 'package:flutter/foundation.dart';
import 'package:shared_preferences/shared_preferences.dart';

import 'fo_storage_service.dart';
import 'supabase_service.dart';

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
    );
  }

  static Future<void> record({
    String? employeeCode,
    required String screen,
    required String action,
    Object? error,
    StackTrace? stackTrace,
    bool syncNow = false,
  }) async {
    try {
      final createdAt = DateTime.now().toUtc().toIso8601String();
      final row = <String, dynamic>{
        'id': '${DateTime.now().microsecondsSinceEpoch}-$screen-$action',
        'employee_code': employeeCode ?? await _employeeCode(),
        'screen': screen,
        'action': action,
        'error_message': error?.toString() ?? '',
        'stack_trace': stackTrace?.toString() ?? '',
        'created_at': createdAt,
        'synced': false,
      };
      debugPrint(
        '[myQPMS CrashLog] ${row['screen']} / ${row['action']} / ${row['error_message']}',
      );
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
        try {
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
        } catch (error) {
          debugPrint('[myQPMS CrashLog] Supabase sync skipped: $error');
          break;
        }
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
}
