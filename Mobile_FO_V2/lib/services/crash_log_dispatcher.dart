import 'dart:async';
import 'dart:math';

import 'crash_log_outbox.dart';
import 'crash_log_policy.dart';

String newCrashLogId() {
  final random = Random.secure();
  final bytes = List<int>.generate(16, (_) => random.nextInt(256));
  bytes[6] = (bytes[6] & 15) | 64;
  bytes[8] = (bytes[8] & 63) | 128;
  final hex = bytes.map((b) => b.toRadixString(16).padLeft(2, '0')).join();
  return '${hex.substring(0, 8)}-${hex.substring(8, 12)}-${hex.substring(12, 16)}-${hex.substring(16, 20)}-${hex.substring(20)}';
}

class CrashLogDispatcher {
  CrashLogDispatcher({
    required this.openOutbox,
    required this.upload,
    required this.isReady,
    required this.resolveEmployee,
    this.debug,
    this.scheduleRetry,
    DateTime Function()? clock,
  }) : clock = clock ?? DateTime.now;
  final Future<CrashLogOutbox> Function() openOutbox;
  final Future<void> Function(Map<String, dynamic>) upload;
  final bool Function() isReady;
  final Future<String?> Function() resolveEmployee;
  final void Function(String)? debug;
  final DateTime Function() clock;
  final Timer Function(Duration, void Function())? scheduleRetry;
  Timer? _retryTimer;
  int _retryGeneration = 0;
  final Map<String, Map<String, Object>> _diagnostics = {};
  Future<void>? _syncFuture;
  bool _requested = false;

  Map<String, Map<String, Object>> get diagnosticSummaries => Map.unmodifiable(
    _diagnostics.map(
      (k, v) => MapEntry(k, Map<String, Object>.unmodifiable(v)),
    ),
  );

  Future<void> record({
    String? employeeCode,
    required String screen,
    required String action,
    Object? error,
    StackTrace? stackTrace,
    CrashLogLevel? level,
  }) async {
    final severity = CrashLogPolicy.classify(
      action,
      error: error,
      stackTrace: stackTrace,
      level: level,
    );
    final now = clock().toUtc();
    if (severity == CrashLogLevel.diagnostic) {
      final key = action.toUpperCase();
      if (!_diagnostics.containsKey(key) && _diagnostics.length >= 32) {
        // Reserve the three rejection counters; lifecycle noise cannot evict them.
        _diagnostics.remove(
          _diagnostics.keys.firstWhere(
            (k) => !CrashLogPolicy.rejections.contains(k),
          ),
        );
      }
      final summary = _diagnostics.putIfAbsent(
        key,
        () => {'count': 0, 'first_at': now.toIso8601String()},
      );
      final count = min(0x7fffffff, (summary['count'] as int) + 1);
      summary['count'] = count;
      summary['last_at'] = now.toIso8601String();
      final detail = error?.toString() ?? '';
      summary['last_detail'] = detail.substring(0, min(256, detail.length));
      if (count == 1 || count % 100 == 0) {
        debug?.call('$screen/$action diagnostic count=$count');
      }
      return; // No user lookup, preferences, SQLite or remote work on this path.
    }
    String? employee = employeeCode;
    if (employee == null) {
      try {
        employee = await resolveEmployee();
      } catch (_) {
        /* Keep the original error. */
      }
    }
    final suppliedMessage = error?.toString() ?? '';
    // Existing server noise filtering must not silently discard important events
    // whose caller supplied an action but no exception details.
    final message = suppliedMessage.isEmpty
        ? '${severity.name.toUpperCase()} event: $action (no error detail supplied)'
        : suppliedMessage;
    final payload = <String, dynamic>{
      'id': newCrashLogId(),
      'fo_user_id': employee,
      'employee_code': employee,
      'stage': action,
      'screen': screen,
      'action': action,
      'error_message': message,
      'stack_trace': stackTrace?.toString() ?? '',
      'created_at': now.toIso8601String(),
    };
    final fingerprint = [
      employee ?? '',
      screen,
      action,
      message.replaceAll(RegExp(r'\s+'), ' ').trim(),
    ].join('|');
    await (await openOutbox()).enqueue(
      payload,
      fingerprint,
      severity.index,
      now,
      dedupe: severity == CrashLogLevel.critical
          ? Duration.zero
          : const Duration(minutes: 10),
    );
    if (severity == CrashLogLevel.critical) {
      await sync();
    } else {
      unawaited(
        sync(),
      ); // Persistence is acknowledged before returning to caller.
    }
  }

  Future<void> sync() {
    cancelScheduledRetry();
    _requested = true;
    if (_syncFuture != null) return _syncFuture!;
    final completed = Completer<void>();
    _syncFuture = completed.future; // Set before ANY asynchronous read.
    unawaited(() async {
      try {
        do {
          _requested = false;
          if (!isReady()) break;
          final outbox = await openOutbox();
          final owner = newCrashLogId();
          if (!await outbox.acquireLease(owner, clock())) break;
          try {
            while (isReady()) {
              final row = await outbox.nextDue(clock());
              if (row == null || !await outbox.acquireLease(owner, clock())) {
                break;
              }
              try {
                await upload(row).timeout(const Duration(seconds: 10));
                await outbox.acknowledge(row['id'] as String);
              } catch (error) {
                await outbox.retryLater(row['id'] as String, clock());
                debug?.call('Crash log retained for retry: $error');
                break;
              }
            }
          } finally {
            await outbox.releaseLease(owner);
          }
        } while (_requested);
      } catch (error) {
        debug?.call('Crash log synchronization deferred: $error');
      } finally {
        _syncFuture = null;
        completed.complete();
        if (scheduleRetry != null) unawaited(_planRetry(_retryGeneration));
      }
    }());
    return completed.future;
  }

  void cancelScheduledRetry() {
    _retryGeneration++;
    _retryTimer?.cancel();
    _retryTimer = null;
  }

  Future<void> _planRetry(int generation) async {
    try {
      final next = await (await openOutbox()).nextRetryTime();
      if (generation != _retryGeneration || next == null) return;
      final delay = next.difference(clock());
      _retryTimer = scheduleRetry!(
        delay < const Duration(seconds: 30)
            ? const Duration(seconds: 30)
            : delay,
        () {
          unawaited(sync());
        },
      );
    } catch (error) {
      debug?.call('Crash log retry scheduling deferred: $error');
      if (generation == _retryGeneration) {
        _retryTimer = scheduleRetry!(const Duration(minutes: 1), () {
          unawaited(sync());
        });
      }
    }
  }
}
