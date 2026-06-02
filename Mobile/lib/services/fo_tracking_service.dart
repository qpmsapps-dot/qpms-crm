import 'dart:async';
import 'dart:io';
import 'dart:ui';

import 'package:battery_plus/battery_plus.dart';
import 'package:flutter/foundation.dart';
import 'package:flutter_background_service/flutter_background_service.dart';
import 'package:geolocator/geolocator.dart';

import '../models/fo_models.dart';
import 'fo_crash_log_service.dart';
import 'fo_permission_service.dart';
import 'fo_storage_service.dart';
import 'fo_sync_service.dart';

class FoTrackingService {
  FoTrackingService._();

  static const notificationId = 904;
  static const notificationChannelId = 'myqpms_fo_tracking';
  static const captureInterval = Duration(seconds: 5);
  static const syncInterval = Duration(seconds: 30);
  static const batteryInterval = Duration(seconds: 30);
  static bool _initialized = false;
  static bool _starting = false;
  static Future<bool>? _initializing;

  static bool get _isSupportedPlatform =>
      !kIsWeb && (Platform.isAndroid || Platform.isIOS);

  static Future<bool> initialize() async {
    if (!_isSupportedPlatform) return false;
    if (_initialized) return true;
    if (_initializing != null) return _initializing!;
    _initializing = _initialize();
    final result = await _initializing!;
    _initialized = result;
    return result;
  }

  static Future<bool> _initialize() async {
    try {
      await FlutterBackgroundService().configure(
        androidConfiguration: AndroidConfiguration(
          onStart: foTrackingBackgroundStart,
          autoStart: false,
          isForegroundMode: true,
          initialNotificationTitle: 'myQPMS - Tracking Active',
          initialNotificationContent: 'Field route recording is enabled.',
          notificationChannelId: notificationChannelId,
          foregroundServiceNotificationId: notificationId,
          foregroundServiceTypes: [AndroidForegroundType.location],
        ),
        iosConfiguration: IosConfiguration(
          autoStart: false,
          onForeground: foTrackingBackgroundStart,
          onBackground: foIosBackground,
        ),
      );
      return true;
    } catch (error, stackTrace) {
      debugPrint('[myQPMS FO] Tracking service initialization failed: $error');
      debugPrintStack(stackTrace: stackTrace);
      return false;
    }
  }

  static Future<bool> start() async {
    try {
      if (!_isSupportedPlatform) return false;
      if (_starting) {
        debugPrint(
          '[myQPMS FO] TRACKING_ALREADY_ACTIVE_SKIP_DUPLICATE_START',
        );
        return true;
      }
      if (!await _canStartLocationService()) {
        return false;
      }
      final initialized = await initialize();
      if (!initialized) {
        debugPrint(
          '[myQPMS FO] Background tracking start failed: service initialization failed',
        );
        return false;
      }
      final service = FlutterBackgroundService();
      if (await service.isRunning()) {
        debugPrint(
          '[myQPMS FO] TRACKING_ALREADY_ACTIVE_SKIP_DUPLICATE_START',
        );
        return true;
      }
      _starting = true;
      try {
        await service.startService();
      } finally {
        _starting = false;
      }
      return true;
    } catch (error, stackTrace) {
      _starting = false;
      debugPrint('[myQPMS FO] Background tracking start failed: $error');
      debugPrintStack(stackTrace: stackTrace);
      return false;
    }
  }

  static Future<bool> _canStartLocationService() async {
    final permissions = await FoPermissionService.checkRequired();
    if (!permissions.allGranted) {
      debugPrint(
        '[myQPMS FO] Background tracking start skipped: location permissions incomplete ${permissions.statuses}',
      );
      return false;
    }
    final attendance = await FoLocalStorage.getActiveAttendance();
    if (attendance == null || !attendance.isActive) {
      debugPrint(
        '[myQPMS FO] Background tracking start skipped: no active attendance',
      );
      return false;
    }
    final locationServiceEnabled = await Geolocator.isLocationServiceEnabled();
    if (!locationServiceEnabled) {
      debugPrint(
        '[myQPMS FO] Background tracking start skipped: location service disabled',
      );
      return false;
    }
    final permission = await Geolocator.checkPermission();
    if (permission == LocationPermission.denied ||
        permission == LocationPermission.deniedForever ||
        permission == LocationPermission.unableToDetermine) {
      debugPrint(
        '[myQPMS FO] Background tracking start skipped: location permission $permission',
      );
      return false;
    }
    return true;
  }

  static Future<void> stop() async {
    try {
      if (!_isSupportedPlatform) return;
      FlutterBackgroundService().invoke('stopTracking');
      debugPrint('[myQPMS FO] TRACKING_STOPPED_SAFELY');
    } catch (error, stackTrace) {
      debugPrint('[myQPMS FO] Background tracking stop failed: $error');
      debugPrintStack(stackTrace: stackTrace);
    }
  }
}

@pragma('vm:entry-point')
Future<bool> foIosBackground(ServiceInstance service) async {
  DartPluginRegistrant.ensureInitialized();
  return true;
}

@pragma('vm:entry-point')
void foTrackingBackgroundStart(ServiceInstance service) async {
  DartPluginRegistrant.ensureInitialized();
  Timer? routeTimer;
  var captureInProgress = false;
  DateTime? lastSyncAttemptAt;
  DateTime? lastBatteryReadAt;
  int? latestBattery;

  Future<void> updateNotification(String content) async {
    if (service is! AndroidServiceInstance) return;
    try {
      await service.setForegroundNotificationInfo(
        title: 'myQPMS - Tracking Active',
        content: content,
      );
    } catch (error, stackTrace) {
      debugPrint(
        '[myQPMS FO] TRACKING_CALLBACK_CAUGHT_EXCEPTION: notification update failed: $error',
      );
      debugPrintStack(stackTrace: stackTrace);
    }
  }

  Future<void> captureLocation() async {
    if (captureInProgress) {
      debugPrint(
        '[myQPMS FO] TRACKING_ALREADY_ACTIVE_SKIP_DUPLICATE_START',
      );
      unawaited(
        FoCrashLogService.breadcrumb(
          screen: 'BackgroundTracking',
          action: 'TRACKING_TICK_SKIPPED_ALREADY_RUNNING',
        ),
      );
      return;
    }
    captureInProgress = true;
    try {
      debugPrint('[myQPMS FO] TRACKING_TIMER_TICK');
      unawaited(
        FoCrashLogService.breadcrumb(
          screen: 'BackgroundTracking',
          action: 'TRACKING_TIMER_TICK_START',
        ),
      );
      final attendance = await FoLocalStorage.getActiveAttendance();
      if (attendance == null || !attendance.isActive) {
        unawaited(
          FoCrashLogService.breadcrumb(
            screen: 'BackgroundTracking',
            action: 'TRACKING_STOPPED_NO_ACTIVE_ATTENDANCE',
          ),
        );
        routeTimer?.cancel();
        service.stopSelf();
        debugPrint('[myQPMS FO] TRACKING_STOPPED_SAFELY');
        return;
      }
      debugPrint('[myQPMS FO] TRACKING_LOCATION_FETCH_START');
      Position? position;
      try {
        position = await Geolocator.getCurrentPosition(
          locationSettings: const LocationSettings(
            accuracy: LocationAccuracy.high,
            timeLimit: Duration(seconds: 30),
          ),
        );
        if (!_isUsablePosition(position)) {
          debugPrint(
            '[myQPMS FO] TRACKING_LOCATION_FETCH_FAILED: unusable position accuracy=${position.accuracy}',
          );
          unawaited(
            FoCrashLogService.record(
              employeeCode: attendance.foId,
              screen: 'BackgroundTracking',
              action: 'TRACKING_LOCATION_UNUSABLE',
              error: 'accuracy=${position.accuracy}',
            ),
          );
          return;
        }
        debugPrint('[myQPMS FO] TRACKING_LOCATION_FETCH_SUCCESS');
        unawaited(
          FoCrashLogService.breadcrumb(
            employeeCode: attendance.foId,
            screen: 'BackgroundTracking',
            action: 'TRACKING_LOCATION_FETCH_SUCCESS',
          ),
        );
      } catch (error, stackTrace) {
        debugPrint('[myQPMS FO] TRACKING_LOCATION_FETCH_FAILED: $error');
        debugPrintStack(stackTrace: stackTrace);
        unawaited(
          FoCrashLogService.record(
            employeeCode: attendance.foId,
            screen: 'BackgroundTracking',
            action: 'TRACKING_LOCATION_FETCH_FAILED',
            error: error,
            stackTrace: stackTrace,
          ),
        );
        await updateNotification('Waiting for a valid GPS location.');
        return;
      }
      final now = DateTime.now();
      if (lastBatteryReadAt == null ||
          now.difference(lastBatteryReadAt!) >=
              FoTrackingService.batteryInterval) {
        try {
          latestBattery = await Battery().batteryLevel;
          lastBatteryReadAt = now;
        } catch (error) {
          latestBattery = null;
          lastBatteryReadAt = now;
          debugPrint('[myQPMS FO] Background battery reading failed: $error');
        }
      }
      final log = FoLocationLog(
        id: now.microsecondsSinceEpoch.toString(),
        foId: attendance.foId,
        attendanceId: attendance.id,
        latitude: position.latitude,
        longitude: position.longitude,
        timestamp: now,
        batteryPercentage: latestBattery,
        speed: position.speed,
        accuracy: position.accuracy,
      );
      debugPrint('[myQPMS FO] TRACKING_LOG_INSERT_START');
      try {
        await FoLocalStorage.appendLocationLog(log);
        debugPrint('[myQPMS FO] TRACKING_LOG_INSERT_SUCCESS');
        unawaited(
          FoCrashLogService.breadcrumb(
            employeeCode: attendance.foId,
            screen: 'BackgroundTracking',
            action: 'TRACKING_LOG_INSERT_SUCCESS',
          ),
        );
      } catch (error, stackTrace) {
        debugPrint('[myQPMS FO] TRACKING_LOG_INSERT_FAILED: $error');
        debugPrintStack(stackTrace: stackTrace);
        unawaited(
          FoCrashLogService.record(
            employeeCode: attendance.foId,
            screen: 'BackgroundTracking',
            action: 'TRACKING_LOG_INSERT_FAILED',
            error: error,
            stackTrace: stackTrace,
          ),
        );
        return;
      }
      if (lastSyncAttemptAt == null ||
          now.difference(lastSyncAttemptAt!) >= FoTrackingService.syncInterval) {
        lastSyncAttemptAt = now;
        unawaited(
          FoSyncService.syncLocationLogs().catchError((Object error, StackTrace stackTrace) {
            debugPrint('[myQPMS FO] TRACKING_LOG_INSERT_FAILED: $error');
            debugPrintStack(stackTrace: stackTrace);
            return false;
          }),
        );
      }
      try {
        final visits = await FoLocalStorage.getSiteVisits();
        for (final visit in visits) {
          if (visit.status != 'TRAVELLING') {
            continue;
          }
          final metersFromSite = Geolocator.distanceBetween(
            position.latitude,
            position.longitude,
            visit.site.latitude,
            visit.site.longitude,
          );
          if (metersFromSite <= visit.site.geofenceRadiusMeters) {
            visit
              ..status = 'ARRIVED AT SITE'
              ..arrivalTime = DateTime.now()
              ..arrivalLat = position.latitude
              ..arrivalLong = position.longitude;
            await FoLocalStorage.saveSiteVisit(visit);
          }
          break;
        }
      } catch (error, stackTrace) {
        debugPrint('[myQPMS FO] TRACKING_CALLBACK_CAUGHT_EXCEPTION: $error');
        debugPrintStack(stackTrace: stackTrace);
        unawaited(
          FoCrashLogService.record(
            employeeCode: attendance.foId,
            screen: 'BackgroundTracking',
            action: 'TRACKING_VISIT_GEOFENCE_FAILED',
            error: error,
            stackTrace: stackTrace,
          ),
        );
      }
      try {
        service.invoke('locationUpdate', log.toJson());
      } catch (error, stackTrace) {
        debugPrint('[myQPMS FO] TRACKING_CALLBACK_CAUGHT_EXCEPTION: $error');
        debugPrintStack(stackTrace: stackTrace);
      }
      await updateNotification(
        latestBattery == null
            ? 'Route updated. Battery unavailable.'
            : 'Route updated. Battery $latestBattery%',
      );
      unawaited(
        FoCrashLogService.breadcrumb(
          employeeCode: attendance.foId,
          screen: 'BackgroundTracking',
          action: 'TRACKING_TIMER_TICK_SUCCESS',
        ),
      );
    } catch (error, stackTrace) {
      debugPrint('[myQPMS FO] TRACKING_CALLBACK_CAUGHT_EXCEPTION: $error');
      debugPrintStack(stackTrace: stackTrace);
      unawaited(
        FoCrashLogService.record(
          screen: 'BackgroundTracking',
          action: 'TRACKING_CALLBACK_CAUGHT_EXCEPTION',
          error: error,
          stackTrace: stackTrace,
          syncNow: true,
        ),
      );
      await updateNotification('Waiting for a valid GPS location.');
    } finally {
      captureInProgress = false;
    }
  }

  service.on('stopTracking').listen((_) {
    routeTimer?.cancel();
    service.stopSelf();
    debugPrint('[myQPMS FO] TRACKING_STOPPED_SAFELY');
    unawaited(
      FoCrashLogService.breadcrumb(
        screen: 'BackgroundTracking',
        action: 'TRACKING_STOPPED_SAFELY',
      ),
    );
  }, onError: (Object error, StackTrace stackTrace) {
    debugPrint('[myQPMS FO] TRACKING_CALLBACK_CAUGHT_EXCEPTION: $error');
    debugPrintStack(stackTrace: stackTrace);
    unawaited(
      FoCrashLogService.record(
        screen: 'BackgroundTracking',
        action: 'STOP_TRACKING_LISTENER_ERROR',
        error: error,
        stackTrace: stackTrace,
        syncNow: true,
      ),
    );
  });

  try {
    await captureLocation();
  } catch (error, stackTrace) {
    debugPrint('[myQPMS FO] TRACKING_CALLBACK_CAUGHT_EXCEPTION: $error');
    debugPrintStack(stackTrace: stackTrace);
    unawaited(
      FoCrashLogService.record(
        screen: 'BackgroundTracking',
        action: 'INITIAL_CAPTURE_EXCEPTION',
        error: error,
        stackTrace: stackTrace,
        syncNow: true,
      ),
    );
  }
  routeTimer = Timer.periodic(
    FoTrackingService.captureInterval,
    (_) async {
      try {
        await captureLocation();
      } catch (error, stackTrace) {
        debugPrint('[myQPMS FO] TRACKING_CALLBACK_CAUGHT_EXCEPTION: $error');
        debugPrintStack(stackTrace: stackTrace);
        unawaited(
          FoCrashLogService.record(
            screen: 'BackgroundTracking',
            action: 'PERIODIC_TIMER_EXCEPTION',
            error: error,
            stackTrace: stackTrace,
            syncNow: true,
          ),
        );
      }
    },
  );
}

bool _isUsablePosition(Position position) {
  final latitude = position.latitude;
  final longitude = position.longitude;
  final accuracy = position.accuracy;
  return latitude.isFinite &&
      longitude.isFinite &&
      accuracy.isFinite &&
      latitude >= -90 &&
      latitude <= 90 &&
      longitude >= -180 &&
      longitude <= 180 &&
      accuracy >= 0 &&
      accuracy <= 1000;
}
