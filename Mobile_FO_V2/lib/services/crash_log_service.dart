import 'dart:convert';

import 'package:flutter/foundation.dart';
import 'package:shared_preferences/shared_preferences.dart';

import 'local_store.dart';
import 'supabase_service.dart';

class CrashLogService {
  static const _key = 'mobile_crash_logs_queue';
  static bool _syncing = false;

  static Future<void> record({
    String? employeeCode,
    required String screen,
    required String action,
    Object? error,
    StackTrace? stackTrace,
  }) async {
    try {
      final user = await LocalStore.getUser();
      final row = {
        'id': '${DateTime.now().microsecondsSinceEpoch}-$screen-$action',
        'employee_code': employeeCode ?? user?.employeeCode,
        'screen': screen,
        'action': action,
        'error_message': error?.toString() ?? '',
        'stack_trace': stackTrace?.toString() ?? '',
        'created_at': DateTime.now().toUtc().toIso8601String(),
        'synced': false,
      };
      debugPrint('[myQPMS FO V2] $screen/$action ${row['error_message']}');
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
        try {
          await SupabaseService.client.from('mobile_crash_logs').insert({
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
        } catch (_) {
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
}
