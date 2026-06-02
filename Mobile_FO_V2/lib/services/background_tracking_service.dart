import 'dart:async';
import 'dart:math';
import 'dart:ui';

import 'package:battery_plus/battery_plus.dart';
import 'package:flutter/widgets.dart';
import 'package:flutter_background_service/flutter_background_service.dart';
import 'package:geolocator/geolocator.dart';

import '../models/fo_models.dart';
import 'config_service.dart';
import 'crash_log_service.dart';
import 'local_store.dart';
import 'supabase_service.dart';

class BackgroundTrackingService {
  static const notificationChannelId = 'myqpms_tracking';
  static const notificationId = 15702;
  static const notificationTitle = 'myQPMS tracking is active';
  static const notificationBody =
      'Field location tracking is running. Tap End Day to stop.';
  static const interval = Duration(seconds: 20);
  static bool _configured = false;

  static Future<void> configure() async {
    if (_configured) return;
    final service = FlutterBackgroundService();
    await service.configure(
      androidConfiguration: AndroidConfiguration(
        onStart: _onStart,
        autoStart: false,
        isForegroundMode: true,
        notificationChannelId: notificationChannelId,
        initialNotificationTitle: notificationTitle,
        initialNotificationContent: notificationBody,
        foregroundServiceNotificationId: notificationId,
        foregroundServiceTypes: [AndroidForegroundType.location],
      ),
      iosConfiguration: IosConfiguration(
        autoStart: false,
        onForeground: _onStart,
      ),
    );
    _configured = true;
    await CrashLogService.record(
      screen: 'tracking',
      action: 'BACKGROUND_SERVICE_CONFIGURED',
    );
  }

  static Future<void> startTracking() async {
    await configure();
    final service = FlutterBackgroundService();
    if (!await service.isRunning()) {
      await service.startService();
    }
    service.invoke('startTracking');
  }

  static Future<void> stopTracking() async {
    if (!_configured) {
      await configure();
    }
    FlutterBackgroundService().invoke('stopService');
  }
}

@pragma('vm:entry-point')
void _onStart(ServiceInstance service) async {
  WidgetsFlutterBinding.ensureInitialized();
  DartPluginRegistrant.ensureInitialized();

  if (AppConfig.hasSupabase) {
    await SupabaseService.initialize();
    await CrashLogService.sync();
  }

  Timer? timer;
  var tickRunning = false;

  Future<void> stopSelf() async {
    timer?.cancel();
    timer = null;
    await CrashLogService.record(
      screen: 'tracking',
      action: 'BACKGROUND_SERVICE_STOPPED',
    );
    service.stopSelf();
  }

  Future<void> runTick() async {
    if (tickRunning) return;
    tickRunning = true;
    try {
      await CrashLogService.record(
        screen: 'tracking',
        action: 'BACKGROUND_LOCATION_TICK_START',
      );
      final user = await LocalStore.getUser();
      final attendance = await LocalStore.getAttendance();
      if (user == null || attendance == null || !attendance.isActive) {
        await stopSelf();
        return;
      }

      final position = await Geolocator.getCurrentPosition(
        locationSettings: const LocationSettings(
          accuracy: LocationAccuracy.high,
          timeLimit: Duration(seconds: 15),
        ),
      );
      if (!_isUsablePosition(position)) {
        throw StateError('Background GPS point is outside valid bounds.');
      }

      int? battery;
      try {
        battery = await Battery().batteryLevel;
      } catch (_) {
        battery = null;
      }

      final log = LocationLog(
        id: DateTime.now().microsecondsSinceEpoch.toString(),
        employeeCode: user.employeeCode,
        attendanceId: attendance.remoteId ?? attendance.id,
        latitude: position.latitude,
        longitude: position.longitude,
        accuracy: position.accuracy,
        speed: max(0, position.speed),
        battery: battery,
        capturedAt: DateTime.now(),
      );

      if (SupabaseService.isReady) {
        await _syncQueuedLogs();
        try {
          log.remoteId = await SupabaseService.insertLocation(log);
          log.synced = true;
          await CrashLogService.record(
            employeeCode: user.employeeCode,
            screen: 'tracking',
            action: 'BACKGROUND_LOCATION_LOG_SYNC_SUCCESS',
          );
        } catch (_) {
          // Keep the local copy queued; the next tick will retry.
        }
      }

      await LocalStore.addLocationLog(log);
      final liveKm = await _calculateKm(attendance.remoteId ?? attendance.id);
      attendance
        ..actualKm = liveKm < attendance.actualKm ? attendance.actualKm : liveKm
        ..eligibleKm = liveKm < attendance.actualKm
            ? attendance.actualKm
            : liveKm;
      await LocalStore.saveAttendance(attendance);

      if (SupabaseService.isReady) {
        try {
          await SupabaseService.updateLiveStatus(
            user: user,
            isTracking: true,
            status: 'Active',
            latitude: log.latitude,
            longitude: log.longitude,
            accuracy: log.accuracy,
            speed: log.speed,
            battery: battery,
            routeKm: attendance.actualKm,
          );
          await CrashLogService.record(
            employeeCode: user.employeeCode,
            screen: 'tracking',
            action: 'BACKGROUND_LIVE_STATUS_SYNC_SUCCESS',
          );
        } catch (_) {
          // The service stays alive and retries on the next tick.
        }
      }

      service.invoke('locationUpdate', {
        'latitude': log.latitude,
        'longitude': log.longitude,
        'accuracy': log.accuracy,
        'speed': log.speed,
        'battery': battery,
        'captured_at': log.capturedAt.toIso8601String(),
        'actual_km': attendance.actualKm,
      });
      await CrashLogService.record(
        employeeCode: user.employeeCode,
        screen: 'tracking',
        action: 'BACKGROUND_LOCATION_TICK_SUCCESS',
      );
    } catch (error, stackTrace) {
      await CrashLogService.record(
        screen: 'tracking',
        action: 'BACKGROUND_LOCATION_TICK_FAILED',
        error: error,
        stackTrace: stackTrace,
      );
    } finally {
      tickRunning = false;
    }
  }

  Future<void> startTicks() async {
    if (service is AndroidServiceInstance) {
      service.setAsForegroundService();
      service.setForegroundNotificationInfo(
        title: BackgroundTrackingService.notificationTitle,
        content: BackgroundTrackingService.notificationBody,
      );
    }
    await CrashLogService.record(
      screen: 'tracking',
      action: 'BACKGROUND_SERVICE_STARTED',
    );
    timer?.cancel();
    await runTick();
    timer = Timer.periodic(
      BackgroundTrackingService.interval,
      (_) => unawaited(runTick()),
    );
  }

  service.on('startTracking').listen((_) {
    unawaited(startTicks());
  });
  service.on('stopService').listen((_) {
    unawaited(stopSelf());
  });

  final attendance = await LocalStore.getAttendance();
  if (attendance?.isActive == true) {
    await startTicks();
  } else {
    await stopSelf();
  }
}

bool _isUsablePosition(Position position) {
  return position.latitude.isFinite &&
      position.longitude.isFinite &&
      position.latitude >= -90 &&
      position.latitude <= 90 &&
      position.longitude >= -180 &&
      position.longitude <= 180;
}

Future<double> _calculateKm(String attendanceId) async {
  final logs =
      (await LocalStore.getLocationLogs())
          .where((log) => log.attendanceId == attendanceId)
          .where(_isUsableLog)
          .toList()
        ..sort((a, b) => a.capturedAt.compareTo(b.capturedAt));
  var meters = 0.0;
  for (var index = 1; index < logs.length; index += 1) {
    meters += Geolocator.distanceBetween(
      logs[index - 1].latitude,
      logs[index - 1].longitude,
      logs[index].latitude,
      logs[index].longitude,
    );
  }
  return double.parse((meters / 1000).toStringAsFixed(2));
}

bool _isUsableLog(LocationLog log) {
  final accuracy = log.accuracy;
  return log.latitude.isFinite &&
      log.longitude.isFinite &&
      log.latitude >= -90 &&
      log.latitude <= 90 &&
      log.longitude >= -180 &&
      log.longitude <= 180 &&
      (accuracy == null || accuracy <= 50);
}

Future<void> _syncQueuedLogs() async {
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
