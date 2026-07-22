import 'dart:convert';

import 'package:shared_preferences/shared_preferences.dart';

import '../utils/date_utils.dart';

class TrackingHealthMetrics {
  static const _keyPrefix = 'phase1_tracking_health_';
  static const _retainedDays = 7;

  static Future<void> increment(String metric, {int by = 1}) async {
    final prefs = await SharedPreferences.getInstance();
    final today = indiaDateKey(DateTime.now());
    final key = '$_keyPrefix$today';
    final value = prefs.getString(key);
    final summary = value == null || value.isEmpty
        ? <String, dynamic>{'date': today}
        : Map<String, dynamic>.from(jsonDecode(value) as Map);
    summary[metric] = ((summary[metric] as num?)?.toInt() ?? 0) + by;
    summary['updated_at'] = DateTime.now().toUtc().toIso8601String();
    await prefs.setString(key, jsonEncode(summary));
    await _cleanup(prefs);
  }

  static Future<void> setValue(String metric, Object? value) async {
    final prefs = await SharedPreferences.getInstance();
    final today = indiaDateKey(DateTime.now());
    final key = '$_keyPrefix$today';
    final encoded = prefs.getString(key);
    final summary = encoded == null || encoded.isEmpty
        ? <String, dynamic>{'date': today}
        : Map<String, dynamic>.from(jsonDecode(encoded) as Map);
    summary[metric] = value;
    summary['updated_at'] = DateTime.now().toUtc().toIso8601String();
    await prefs.setString(key, jsonEncode(summary));
    await _cleanup(prefs);
  }

  static Future<Map<String, dynamic>> today() async {
    final prefs = await SharedPreferences.getInstance();
    final date = indiaDateKey(DateTime.now());
    final encoded = prefs.getString('$_keyPrefix$date');
    if (encoded == null || encoded.isEmpty) return {'date': date};
    return Map<String, dynamic>.from(jsonDecode(encoded) as Map);
  }

  static Future<String> exportToday() async {
    final summary = await today();
    const ordered = <String>[
      'gps_collected',
      'gps_queued',
      'gps_uploaded',
      'duplicate_attempts_prevented',
      'batch_attempts',
      'batch_successes',
      'batch_failures',
      'live_status_writes',
      'attendance_km_writes',
      'remote_validation_active',
      'remote_validation_closed',
      'service_starts',
      'service_stops',
    ];
    final values = ordered.map((key) => '$key=${summary[key] ?? 0}').join(' ');
    return 'date=${summary['date']} $values queue=${summary['queue_size'] ?? 0} '
        'retry_seconds=${summary['retry_seconds'] ?? 0} '
        'last_stop_reason=${summary['last_stop_reason'] ?? '--'}';
  }

  static Future<void> _cleanup(SharedPreferences prefs) async {
    final cutoff = indiaNow().subtract(const Duration(days: _retainedDays));
    for (final key in prefs.getKeys().where(
      (key) => key.startsWith(_keyPrefix),
    )) {
      final date = DateTime.tryParse(key.substring(_keyPrefix.length));
      if (date != null && date.isBefore(cutoff)) await prefs.remove(key);
    }
  }
}
