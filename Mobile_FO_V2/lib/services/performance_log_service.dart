import 'package:flutter/foundation.dart';

class PerformanceLogService {
  const PerformanceLogService._();

  static void step({
    required String operation,
    required String step,
    required Stopwatch stopwatch,
    String status = 'success',
  }) {
    try {
      debugPrint(
        'FO_PERFORMANCE operation=$operation step=$step '
        'elapsed_ms=${stopwatch.elapsedMilliseconds} status=$status',
      );
    } catch (_) {
      // Performance logging must never affect the user action.
    }
  }
}
