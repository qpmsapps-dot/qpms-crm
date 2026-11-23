import 'dart:async';
import 'dart:convert';

import 'package:flutter/foundation.dart';
import 'package:shared_preferences/shared_preferences.dart';

import '../tracking/tracking_flags.dart';
import 'crash_log_dispatcher.dart';
import 'crash_log_outbox.dart';
import 'crash_log_policy.dart';
import 'crash_log_upload.dart';
import 'local_store.dart';
import 'supabase_service.dart';

export 'crash_log_policy.dart' show CrashLogLevel;

class CrashLogService {
  static const _legacyKey = 'mobile_crash_logs_queue';
  static Future<CrashLogOutbox>? _opening;
  static final _dispatcher = CrashLogDispatcher(
    openOutbox: _open,
    upload: (payload) => uploadCrashLog(SupabaseService.client, payload),
    isReady: () => SupabaseService.isReady,
    resolveEmployee: () async => (await LocalStore.getUser())?.employeeCode,
    scheduleRetry: (delay, callback) => Timer(delay, callback),
    debug: (message) {
      if (kDebugMode && TrackingFlags.enableGpsDebugLogs) {
        debugPrint('[myQPMS FO V2] $message');
      }
    },
  );

  /// Bounded, process-local diagnostic summaries. Never sent to Supabase.
  static Map<String, Map<String, Object>> get diagnosticSummaries =>
      _dispatcher.diagnosticSummaries;

  static Future<void> record({
    String? employeeCode,
    required String screen,
    required String action,
    Object? error,
    StackTrace? stackTrace,
    CrashLogLevel? level,
  }) async {
    try {
      await _dispatcher.record(
        employeeCode: employeeCode,
        screen: screen,
        action: action,
        error: error,
        stackTrace: stackTrace,
        level: level,
      );
    } catch (loggingError) {
      // A logger failure must never change attendance/GPS/End Day behavior.
      debugPrint(
        '[myQPMS FO V2] Crash logging persistence failed: $loggingError',
      );
    }
  }

  // force is retained for source compatibility. Error uploads no longer wait
  // for a diagnostic batch; durable per-record retry deadlines still apply.
  static Future<void> sync({bool force = false}) => _dispatcher.sync();

  static Future<int> pendingCount() async => (await _open()).pendingCount();

  static Future<CrashLogOutbox> _open() => _opening ??= _openAndImport();

  static Future<CrashLogOutbox> _openAndImport() async {
    try {
      final outbox = await CrashLogOutbox.open();
      try {
        final prefs = await SharedPreferences.getInstance();
        await prefs.reload();
        final raw = prefs.getString(_legacyKey);
        final legacy = raw == null
            ? <dynamic>[]
            : jsonDecode(raw) as List<dynamic>;
        final retained = <Map<String, Object?>>[];
        for (final value in legacy) {
          final log = Map<String, dynamic>.from(value as Map);
          if (log['synced'] == true) continue;
          final action = (log['action'] ?? log['stage'] ?? 'LEGACY_ERROR')
              .toString();
          final stack = log['stack_trace']?.toString() ?? '';
          final level = CrashLogPolicy.classify(
            action,
            error: log['error_message'],
            stackTrace: stack.isEmpty ? null : StackTrace.fromString(stack),
          );
          if (level == CrashLogLevel.diagnostic) continue;
          final payload = {
            'id': newCrashLogId(),
            'fo_user_id': log['fo_user_id'] ?? log['employee_code'],
            'employee_code': log['employee_code'] ?? log['fo_user_id'],
            'stage': log['stage'] ?? action,
            'screen': log['screen'],
            'action': action,
            'error_message': (log['error_message']?.toString() ?? '').isEmpty
                ? '${level.name.toUpperCase()} event: $action (no error detail supplied)'
                : log['error_message'],
            'stack_trace': log['stack_trace'],
            'created_at': log['created_at'],
          };
          retained.add({
            'id': payload['id'],
            'priority': level.index,
            'payload': jsonEncode(payload),
            'fingerprint': log['fingerprint'] ?? payload['id'],
            'created_ms':
                DateTime.tryParse(
                  log['created_at']?.toString() ?? '',
                )?.millisecondsSinceEpoch ??
                0,
          });
        }
        await outbox.importLegacy(retained);
        // Remove the old queue only after its atomic one-time import commits.
        await prefs.remove(_legacyKey);
      } catch (error) {
        // Preserve malformed/unavailable legacy data; new errors can still queue.
        debugPrint('[myQPMS FO V2] Legacy crash queue retained: $error');
      }
      return outbox;
    } catch (_) {
      _opening = null;
      rethrow;
    }
  }
}
