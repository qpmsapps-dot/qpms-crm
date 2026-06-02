import 'dart:async';

import 'package:flutter_background_service/flutter_background_service.dart';
import 'package:geolocator/geolocator.dart';

import '../models/fo_models.dart';
import '../services/background_tracking_service.dart';
import '../services/crash_log_service.dart';
import '../services/local_store.dart';
import '../services/supabase_service.dart';

class TrackingService {
  static const interval = Duration(seconds: 20);
  static Timer? _timer;
  static StreamSubscription<Map<String, dynamic>?>? _updatesSub;

  static bool get isActive => _timer?.isActive == true || _updatesSub != null;

  static Future<void> start({
    required FoUser user,
    required Attendance attendance,
    required void Function(LocationLog log, double liveKm) onLog,
  }) async {
    await _updatesSub?.cancel();
    _updatesSub = FlutterBackgroundService().on('locationUpdate').listen((
      event,
    ) {
      if (event == null) return;
      final log = LocationLog(
        id: DateTime.now().microsecondsSinceEpoch.toString(),
        employeeCode: user.employeeCode,
        attendanceId: attendance.remoteId ?? attendance.id,
        latitude: _double(event['latitude']) ?? 0,
        longitude: _double(event['longitude']) ?? 0,
        accuracy: _double(event['accuracy']),
        speed: _double(event['speed']),
        battery: _int(event['battery']),
        capturedAt:
            DateTime.tryParse(event['captured_at']?.toString() ?? '') ??
            DateTime.now(),
        synced: true,
      );
      final liveKm = _double(event['actual_km']) ?? attendance.actualKm;
      attendance
        ..actualKm = liveKm
        ..eligibleKm = liveKm;
      onLog(log, liveKm);
    });
    await BackgroundTrackingService.startTracking();
  }

  static Future<void> stop({
    FoUser? user,
    double? latitude,
    double? longitude,
    double? accuracy,
    double? speed,
    double? routeKm,
  }) async {
    _timer?.cancel();
    _timer = null;
    await _updatesSub?.cancel();
    _updatesSub = null;
    await BackgroundTrackingService.stopTracking();
    if (user != null && SupabaseService.isReady) {
      try {
        final hasLocation = latitude != null && longitude != null;
        await CrashLogService.record(
          employeeCode: user.employeeCode,
          screen: 'tracking',
          action: hasLocation
              ? 'LIVE_STATUS_STOP_WITH_LOCATION'
              : 'LIVE_STATUS_STOP_WITHOUT_LOCATION',
        );
        await SupabaseService.updateLiveStatus(
          user: user,
          isTracking: false,
          status: 'Completed',
          latitude: latitude,
          longitude: longitude,
          accuracy: accuracy,
          speed: speed,
          routeKm: routeKm,
        );
      } catch (error, stackTrace) {
        await CrashLogService.record(
          employeeCode: user.employeeCode,
          screen: 'tracking',
          action: 'STOP_LIVE_STATUS_FAILED',
          error: error,
          stackTrace: stackTrace,
        );
      }
    }
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

  static Future<void> syncQueuedLogs() async {
    if (!SupabaseService.isReady) return;
    final logs = await LocalStore.getLocationLogs();
    var changed = false;
    for (final log in logs.where((item) => !item.synced)) {
      try {
        log.remoteId = await SupabaseService.insertLocation(log);
        log.synced = true;
        changed = true;
      } catch (_) {
        break;
      }
    }
    if (changed) await LocalStore.saveLocationLogs(logs);
  }

  static Future<double> calculateKm(String attendanceId) async {
    final logs = _liveKmEligibleLogs(
      (await LocalStore.getLocationLogs())
          .where((log) => log.attendanceId == attendanceId)
          .toList(),
    );
    var meters = 0.0;
    for (var i = 1; i < logs.length; i++) {
      meters += Geolocator.distanceBetween(
        logs[i - 1].latitude,
        logs[i - 1].longitude,
        logs[i].latitude,
        logs[i].longitude,
      );
    }
    return double.parse((meters / 1000).toStringAsFixed(2));
  }

  static Future<LocationLog?> latestValidLog(String attendanceId) async {
    final logs = _liveKmEligibleLogs(
      (await LocalStore.getLocationLogs())
          .where((log) => log.attendanceId == attendanceId)
          .toList(),
    );
    return logs.isEmpty ? null : logs.last;
  }

  static List<LocationLog> _liveKmEligibleLogs(List<LocationLog> logs) {
    logs.sort((a, b) => a.capturedAt.compareTo(b.capturedAt));
    final filtered = <LocationLog>[];
    for (final log in logs) {
      if (!_hasUsableLivePoint(log)) continue;
      if (filtered.isNotEmpty && _samePoint(filtered.last, log)) continue;
      filtered.add(log);
    }
    return filtered;
  }

  static bool _hasUsableLivePoint(LocationLog log) {
    final accuracy = log.accuracy;
    return log.latitude.isFinite &&
        log.longitude.isFinite &&
        log.latitude >= -90 &&
        log.latitude <= 90 &&
        log.longitude >= -180 &&
        log.longitude <= 180 &&
        (accuracy == null || accuracy <= 50);
  }

  static bool _samePoint(LocationLog a, LocationLog b) =>
      a.latitude == b.latitude && a.longitude == b.longitude;
}
