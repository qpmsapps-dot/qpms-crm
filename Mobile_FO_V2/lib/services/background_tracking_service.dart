import 'dart:async';
import 'dart:math';
import 'dart:ui';

import 'package:battery_plus/battery_plus.dart';
import 'package:flutter_background_service/flutter_background_service.dart';
import 'package:geolocator/geolocator.dart';

import '../models/fo_models.dart';
import '../tracking/route_km_calculator.dart';
import '../utils/local_id.dart';
import 'config_service.dart';
import 'crash_log_service.dart';
import 'local_store.dart';
import 'supabase_service.dart';

class BackgroundTrackingService {
  static const notificationChannelId = 'myqpms_tracking';
  static const notificationId = 15702;
  static const notificationTitle = 'MyQPMS FO tracking active';
  static const notificationBody =
      'Location, KM and attendance are being recorded';
  static const movingInterval = Duration(seconds: 10);
  static const stationaryInterval = Duration(seconds: 75);
  static const lowBatteryInterval = Duration(seconds: 45);
  static const fallbackInterval = Duration(seconds: 10);
  static bool _configured = false;

  static Future<void> saveActiveSession({
    required FoUser user,
    required Attendance attendance,
  }) async {
    await LocalStore.saveBackgroundTrackingSession(
      user: user,
      attendance: attendance,
      supabaseUrl: AppConfig.supabaseUrl,
      supabaseAnonKey: AppConfig.supabaseAnonKey,
    );
  }

  static Future<void> clearActiveSession() =>
      LocalStore.clearBackgroundTrackingSession();

  static Future<void> configure() async {
    if (_configured) return;
    final service = FlutterBackgroundService();
    try {
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
    } catch (error, stackTrace) {
      await CrashLogService.record(
        screen: 'tracking',
        action: 'BACKGROUND_SERVICE_CONFIGURE_FAILED',
        error: error,
        stackTrace: stackTrace,
      );
    }
  }

  static Future<bool> startTracking() async {
    await configure();
    final service = FlutterBackgroundService();
    try {
      await CrashLogService.record(
        screen: 'tracking',
        action: 'BACKGROUND_SERVICE_STARTED',
      );
      if (!await service.isRunning()) {
        await service.startService();
      }
      service.invoke('startTracking');
      final running = await service.isRunning();
      if (running) {
        await CrashLogService.record(
          screen: 'tracking',
          action: 'FOREGROUND_SERVICE_STARTED',
        );
      }
      return running;
    } catch (error, stackTrace) {
      await CrashLogService.record(
        screen: 'tracking',
        action: 'FOREGROUND_SERVICE_FAILED_FALLBACK_TIMER',
        error: error,
        stackTrace: stackTrace,
      );
      return false;
    }
  }

  static Future<void> stopTracking() async {
    if (!_configured) {
      await configure();
    }
    try {
      FlutterBackgroundService().invoke('stopService');
    } catch (error, stackTrace) {
      await CrashLogService.record(
        screen: 'tracking',
        action: 'TRACKING_CRASH',
        error: error,
        stackTrace: stackTrace,
      );
    }
  }
}

@pragma('vm:entry-point')
void _onStart(ServiceInstance service) async {
  DartPluginRegistrant.ensureInitialized();
  if (service is AndroidServiceInstance) {
    service.setAsForegroundService();
    service.setForegroundNotificationInfo(
      title: BackgroundTrackingService.notificationTitle,
      content: BackgroundTrackingService.notificationBody,
    );
  }
  await CrashLogService.record(
    screen: 'tracking',
    action: 'BACKGROUND_ISOLATE_STARTED',
  );

  final session = await LocalStore.getBackgroundTrackingSession();
  if (session == null) {
    await CrashLogService.record(
      screen: 'tracking',
      action: 'BACKGROUND_SESSION_MISSING_SERVICE_STOPPED',
    );
    service.stopSelf();
    return;
  }
  final sessionEmployeeCode = session['employee_code']?.toString();
  if (sessionEmployeeCode == null || sessionEmployeeCode.trim().isEmpty) {
    await CrashLogService.record(
      screen: 'tracking',
      action: 'BACKGROUND_SESSION_MISSING_SERVICE_STOPPED',
      error: 'Missing employee_code in background tracking session.',
    );
    service.stopSelf();
    return;
  }

  if (AppConfig.hasSupabase ||
      (session['supabase_url']?.toString().trim().isNotEmpty == true &&
          session['supabase_anon_key']?.toString().trim().isNotEmpty == true)) {
    try {
      await SupabaseService.initializeWithCredentials(
        url: session['supabase_url']?.toString() ?? AppConfig.supabaseUrl,
        anonKey:
            session['supabase_anon_key']?.toString() ??
            AppConfig.supabaseAnonKey,
      );
      await CrashLogService.sync();
    } catch (error, stackTrace) {
      await CrashLogService.record(
        employeeCode: sessionEmployeeCode,
        screen: 'tracking',
        action: 'BACKGROUND_SUPABASE_INIT_FAILED',
        error: error,
        stackTrace: stackTrace,
      );
    }
  }

  Timer? timer;
  var tickRunning = false;
  Position? lastPosition;
  var nextTickInterval = BackgroundTrackingService.fallbackInterval;
  DateTime? lastSuccessfulSync;

  Future<void> stopSelf() async {
    timer?.cancel();
    timer = null;
    await CrashLogService.record(
      screen: 'tracking',
      action: 'BACKGROUND_SERVICE_STOPPED',
    );
    service.stopSelf();
  }

  Duration intervalFor({Position? position, int? battery}) {
    if (battery != null && battery < 15) {
      return BackgroundTrackingService.lowBatteryInterval;
    }
    if (position == null || lastPosition == null) {
      return BackgroundTrackingService.fallbackInterval;
    }
    final movedMeters = Geolocator.distanceBetween(
      lastPosition!.latitude,
      lastPosition!.longitude,
      position.latitude,
      position.longitude,
    );
    if (movedMeters >= 10 || position.speed >= 1.5) {
      return BackgroundTrackingService.movingInterval;
    }
    return BackgroundTrackingService.stationaryInterval;
  }

  Future<void> runTick() async {
    if (tickRunning) return;
    tickRunning = true;
    try {
      await _checkpoint(action: 'RUN_TICK_START');
      await CrashLogService.record(
        screen: 'tracking',
        action: 'BACKGROUND_LOCATION_TICK_START',
      );
      await _checkpoint(action: 'USER_LOAD_START');
      late FoUser user;
      try {
        final localUser = await LocalStore.getUser();
        user =
            localUser ??
            FoUser(
              authUserId: '',
              employeeCode: sessionEmployeeCode,
              fullName: session['full_name']?.toString() ?? '',
              mobile: '',
              email: '',
              state: '',
            );
        await _checkpoint(
          employeeCode: user.employeeCode,
          action: 'USER_LOAD_SUCCESS',
        );
      } catch (error, stackTrace) {
        await _checkpointError(
          action: 'USER_LOAD_FAILED',
          error: error,
          stackTrace: stackTrace,
        );
        rethrow;
      }
      await _checkpoint(
        employeeCode: user.employeeCode,
        action: 'LOCALSTORE_GET_USER_SUCCESS',
      );
      await _checkpoint(
        employeeCode: user.employeeCode,
        action: 'LOCALSTORE_GET_ATTENDANCE_START',
      );
      await _checkpoint(
        employeeCode: user.employeeCode,
        action: 'ATTENDANCE_LOAD_START',
      );
      Attendance? attendance;
      try {
        attendance = await LocalStore.getAttendance();
        await _checkpoint(
          employeeCode: user.employeeCode,
          action: 'ATTENDANCE_LOAD_SUCCESS',
          detail: 'remote_id=${attendance?.remoteId ?? '--'}',
        );
      } catch (error, stackTrace) {
        await _checkpointError(
          employeeCode: user.employeeCode,
          action: 'ATTENDANCE_LOAD_FAILED',
          error: error,
          stackTrace: stackTrace,
        );
        rethrow;
      }
      await _checkpoint(
        employeeCode: user.employeeCode,
        action: 'LOCALSTORE_GET_ATTENDANCE_SUCCESS',
        detail: 'remote_id=${attendance?.remoteId ?? '--'}',
      );
      if (attendance == null || !attendance.isActive) {
        await stopSelf();
        return;
      }
      final attendanceId = _attendanceId(attendance);
      if (attendanceId == null) {
        await CrashLogService.record(
          employeeCode: user.employeeCode,
          screen: 'tracking',
          action: 'TRACKING_CRASH',
          error: 'Background tracking cannot continue without attendance_id.',
        );
        await stopSelf();
        return;
      }
      final activeVisit = await LocalStore.activeVisit();
      if (activeVisit != null) {
        if (SupabaseService.isReady) {
          try {
            await SupabaseService.updateLiveStatus(
              user: user,
              isOnline: true,
              isTracking: false,
              status: 'On Site Visit',
              latitude: activeVisit.currentLatitude,
              longitude: activeVisit.currentLongitude,
              accuracy: activeVisit.currentGpsAccuracy,
              routeKm: attendance.eligibleKm,
              attendanceId: attendance.remoteId,
              activeSiteVisitId: activeVisit.remoteId,
            );
          } catch (error, stackTrace) {
            await _checkpointError(
              employeeCode: user.employeeCode,
              action: 'BACKGROUND_SITE_VISIT_STATUS_UPDATE_FAILED',
              error: error,
              stackTrace: stackTrace,
            );
          }
        }
        service.invoke('trackingInterval', {
          'seconds': BackgroundTrackingService.stationaryInterval.inSeconds,
          'paused_for_site_visit': true,
        });
        nextTickInterval = BackgroundTrackingService.stationaryInterval;
        await _checkpoint(
          employeeCode: user.employeeCode,
          action: 'BACKGROUND_TICK_SKIPPED_ON_SITE_VISIT',
          detail: 'active_visit_id=${activeVisit.remoteId ?? activeVisit.id}',
        );
        return;
      }

      Position position;
      try {
        await _checkpoint(
          employeeCode: user.employeeCode,
          action: 'GPS_FETCH_START',
        );
        if (!await Geolocator.isLocationServiceEnabled()) {
          await _checkpoint(
            employeeCode: user.employeeCode,
            action: 'BACKGROUND_PERMISSION_MISSING',
            detail: 'Location service disabled.',
          );
          return;
        }
        final permission = await Geolocator.checkPermission();
        if (permission == LocationPermission.denied ||
            permission == LocationPermission.deniedForever) {
          await _checkpoint(
            employeeCode: user.employeeCode,
            action: 'BACKGROUND_PERMISSION_MISSING',
            detail: 'Location permission missing in service isolate.',
          );
          return;
        }
        await _checkpoint(
          employeeCode: user.employeeCode,
          action: 'GEOLOCATOR_GET_CURRENT_POSITION_START',
        );
        position = await Geolocator.getCurrentPosition(
          locationSettings: const LocationSettings(
            accuracy: LocationAccuracy.high,
            timeLimit: Duration(seconds: 15),
          ),
        );
        await _checkpoint(
          employeeCode: user.employeeCode,
          action: 'GEOLOCATOR_GET_CURRENT_POSITION_SUCCESS',
          detail:
              'lat=${position.latitude} lng=${position.longitude} accuracy=${position.accuracy}',
        );
        await _checkpoint(
          employeeCode: user.employeeCode,
          action: 'GPS_FETCH_SUCCESS',
          detail:
              'lat=${position.latitude} lng=${position.longitude} accuracy=${position.accuracy}',
        );
      } catch (error, stackTrace) {
        await _checkpointError(
          employeeCode: user.employeeCode,
          action: 'GPS_FETCH_FAILED',
          error: error,
          stackTrace: stackTrace,
        );
        await CrashLogService.record(
          employeeCode: user.employeeCode,
          screen: 'tracking',
          action: 'BACKGROUND_LOCATION_TICK_FAILED',
          error: error,
          stackTrace: stackTrace,
        );
        return;
      }
      if (!_isUsablePosition(position)) {
        await CrashLogService.record(
          employeeCode: user.employeeCode,
          screen: 'tracking',
          action: 'BACKGROUND_LOCATION_TICK_FAILED',
          error: 'Background GPS point is outside valid bounds.',
        );
        return;
      }
      await CrashLogService.record(
        employeeCode: user.employeeCode,
        screen: 'tracking',
        action: 'LOCATION_UPDATE_RECEIVED',
      );

      int? battery;
      try {
        await _checkpoint(
          employeeCode: user.employeeCode,
          action: 'BATTERY_FETCH_START',
        );
        battery = await Battery().batteryLevel;
        await _checkpoint(
          employeeCode: user.employeeCode,
          action: 'BATTERY_FETCH_SUCCESS',
          detail: 'battery=$battery',
        );
      } catch (error, stackTrace) {
        await _checkpointError(
          employeeCode: user.employeeCode,
          action: 'BATTERY_FETCH_FAILED',
          error: error,
          stackTrace: stackTrace,
        );
        battery = null;
      }

      final log = LocationLog(
        id: newLocalId('gps'),
        employeeCode: user.employeeCode,
        attendanceId: attendanceId,
        latitude: position.latitude,
        longitude: position.longitude,
        accuracy: position.accuracy,
        speed: max(0, position.speed),
        battery: battery,
        capturedAt: DateTime.now(),
      );

      List<LocationLog> existingLogs;
      try {
        await _checkpoint(
          employeeCode: user.employeeCode,
          action: 'LOCALSTORE_GET_LOCATION_LOGS_START',
          detail: 'attendance_id=$attendanceId',
        );
        existingLogs = await LocalStore.getLocationLogs();
        await _checkpoint(
          employeeCode: user.employeeCode,
          action: 'LOCALSTORE_GET_LOCATION_LOGS_SUCCESS',
          detail: 'count=${existingLogs.length}',
        );
      } catch (error, stackTrace) {
        await _checkpointError(
          employeeCode: user.employeeCode,
          action: 'LOCALSTORE_GET_LOCATION_LOGS_FAILED',
          error: error,
          stackTrace: stackTrace,
        );
        rethrow;
      }
      final isFirstGpsPing = !existingLogs.any(
        (item) => item.attendanceId == attendanceId,
      );
      await _checkpoint(
        employeeCode: user.employeeCode,
        action: 'LOCAL_LOG_SAVE_START',
        detail: 'attendance_id=$attendanceId local_id=${log.id}',
      );
      try {
        await LocalStore.addLocationLog(log, eventType: 'background_tracking');
        await CrashLogService.record(
          employeeCode: user.employeeCode,
          screen: 'tracking',
          action: 'GPS_LOG_SAVED_LOCAL',
          error: 'local_id=${log.id}',
        );
      } catch (error, stackTrace) {
        await _checkpointError(
          employeeCode: user.employeeCode,
          action: 'LOCAL_LOG_SAVE_FAILED',
          error: error,
          stackTrace: stackTrace,
        );
        rethrow;
      }
      await _checkpoint(
        employeeCode: user.employeeCode,
        action: 'LOCAL_LOG_SAVE_SUCCESS',
        detail: 'attendance_id=$attendanceId local_id=${log.id}',
      );

      if (SupabaseService.isReady) {
        try {
          await _checkpoint(
            employeeCode: user.employeeCode,
            action: 'QUEUED_LOCATION_SYNC_START',
          );
          await _syncQueuedLogs(employeeCode: user.employeeCode);
          await _checkpoint(
            employeeCode: user.employeeCode,
            action: 'QUEUED_LOCATION_SYNC_SUCCESS',
          );
        } catch (error, stackTrace) {
          await _checkpointError(
            employeeCode: user.employeeCode,
            action: 'QUEUED_LOCATION_SYNC_FAILED',
            error: error,
            stackTrace: stackTrace,
          );
        }
        try {
          await _checkpoint(
            employeeCode: user.employeeCode,
            action: 'LOCATION_INSERT_START',
            detail: 'attendance_id=$attendanceId local_id=${log.id}',
          );
          await _checkpoint(
            employeeCode: user.employeeCode,
            action: 'SUPABASE_INSERT_LOCATION_START',
            detail: 'attendance_id=$attendanceId local_id=${log.id}',
          );
          log.remoteId = await SupabaseService.insertLocation(log);
          log.synced = true;
          lastSuccessfulSync = DateTime.now();
          await _checkpoint(
            employeeCode: user.employeeCode,
            action: 'SUPABASE_INSERT_LOCATION_SUCCESS',
            detail: 'remote_id=${log.remoteId ?? '--'} local_id=${log.id}',
          );
          await _checkpoint(
            employeeCode: user.employeeCode,
            action: 'LOCATION_INSERT_SUCCESS',
            detail: 'remote_id=${log.remoteId ?? '--'} local_id=${log.id}',
          );
          await CrashLogService.record(
            employeeCode: user.employeeCode,
            screen: 'tracking',
            action: 'BACKGROUND_LOCATION_LOG_SYNC_SUCCESS',
          );
        } catch (error, stackTrace) {
          await _checkpointError(
            employeeCode: user.employeeCode,
            action: 'LOCATION_INSERT_FAILED',
            error: error,
            stackTrace: stackTrace,
          );
          await CrashLogService.record(
            employeeCode: user.employeeCode,
            screen: 'tracking',
            action: 'LOCATION_SYNC_FAILED',
            error: error,
            stackTrace: stackTrace,
          );
          // Keep the local copy queued; the next tick will retry.
        }
      }

      await _checkpoint(
        employeeCode: user.employeeCode,
        action: 'LOCAL_LOG_SAVE_START',
        detail: 'attendance_id=$attendanceId local_id=${log.id}',
      );
      await _checkpoint(
        employeeCode: user.employeeCode,
        action: 'LOCALSTORE_ADD_LOCATION_LOG_START',
        detail: 'attendance_id=$attendanceId local_id=${log.id}',
      );
      try {
        await LocalStore.addLocationLog(log, eventType: 'background_tracking');
      } catch (error, stackTrace) {
        await _checkpointError(
          employeeCode: user.employeeCode,
          action: 'LOCAL_LOG_SAVE_FAILED',
          error: error,
          stackTrace: stackTrace,
        );
        rethrow;
      }
      await _checkpoint(
        employeeCode: user.employeeCode,
        action: 'LOCALSTORE_ADD_LOCATION_LOG_SUCCESS',
      );
      await _checkpoint(
        employeeCode: user.employeeCode,
        action: 'LOCAL_LOG_SAVE_SUCCESS',
        detail: 'attendance_id=$attendanceId local_id=${log.id}',
      );
      final queueLength = await LocalStore.countUnsyncedLocationLogs();
      await _checkpoint(
        employeeCode: user.employeeCode,
        action: 'LOCATION_QUEUE_LENGTH',
        detail: 'queue_length=$queueLength',
      );
      if (lastSuccessfulSync != null) {
        await _checkpoint(
          employeeCode: user.employeeCode,
          action: 'LAST_SYNC_SUCCESS_AT',
          detail: lastSuccessfulSync!.toIso8601String(),
        );
      }
      if (isFirstGpsPing) {
        await CrashLogService.record(
          employeeCode: user.employeeCode,
          screen: 'tracking',
          action: 'FIRST_GPS_PING_SAVED',
        );
      }
      await _checkpoint(
        employeeCode: user.employeeCode,
        action: 'ROUTE_KM_CALCULATE_START',
        detail: 'attendance_id=$attendanceId',
      );
      await _checkpoint(
        employeeCode: user.employeeCode,
        action: 'KM_CALC_START',
        detail: 'attendance_id=$attendanceId',
      );
      double liveKm;
      try {
        liveKm = await _calculateKm(
          attendanceId,
          employeeCode: user.employeeCode,
        );
      } catch (error, stackTrace) {
        await _checkpointError(
          employeeCode: user.employeeCode,
          action: 'KM_CALC_FAILED',
          error: error,
          stackTrace: stackTrace,
        );
        rethrow;
      }
      await _checkpoint(
        employeeCode: user.employeeCode,
        action: 'ROUTE_KM_CALCULATE_SUCCESS',
        detail: 'attendance_id=$attendanceId km=$liveKm',
      );
      await _checkpoint(
        employeeCode: user.employeeCode,
        action: 'KM_CALC_SUCCESS',
        detail: 'attendance_id=$attendanceId km=$liveKm',
      );
      attendance
        ..actualKm = liveKm < attendance.actualKm ? attendance.actualKm : liveKm
        ..totalRouteKm = attendance.totalRouteKm < attendance.eligibleKm
            ? attendance.eligibleKm
            : attendance.totalRouteKm;
      try {
        await _checkpoint(
          employeeCode: user.employeeCode,
          action: 'LOCAL_ATTENDANCE_SAVE_START',
          detail:
              'attendance_id=${attendance.remoteId} km=${attendance.actualKm}',
        );
        await LocalStore.saveAttendance(attendance);
        await _checkpoint(
          employeeCode: user.employeeCode,
          action: 'LOCAL_ATTENDANCE_SAVE_SUCCESS',
          detail:
              'attendance_id=${attendance.remoteId} km=${attendance.actualKm}',
        );
      } catch (error, stackTrace) {
        await _checkpointError(
          employeeCode: user.employeeCode,
          action: 'LOCAL_ATTENDANCE_SAVE_FAILED',
          error: error,
          stackTrace: stackTrace,
        );
        rethrow;
      }

      if (SupabaseService.isReady) {
        try {
          final remoteAttendanceId = attendance.remoteId?.trim();
          await _checkpoint(
            employeeCode: user.employeeCode,
            action: 'ATTENDANCE_UPDATE_START',
            detail:
                'remote_id=${remoteAttendanceId ?? '--'} local_id=${attendance.id} km=${attendance.actualKm}',
          );
          await _checkpoint(
            employeeCode: user.employeeCode,
            action: 'ATTENDANCE_KM_UPDATE_START',
            detail:
                'remote_id=${remoteAttendanceId ?? '--'} local_id=${attendance.id} actual_km=${attendance.actualKm} total_raw_km=${attendance.actualKm} total_route_km=${attendance.totalRouteKm} total_approved_km=${attendance.eligibleKm}',
          );
          if (remoteAttendanceId == null || remoteAttendanceId.isEmpty) {
            await _checkpoint(
              employeeCode: user.employeeCode,
              action: 'ATTENDANCE_KM_UPDATE_SKIPPED_NO_REMOTE_ID',
              detail: 'local_id=${attendance.id} km=${attendance.actualKm}',
            );
          } else {
            await _checkpoint(
              employeeCode: user.employeeCode,
              action: 'SUPABASE_UPDATE_ATTENDANCE_KM_START',
              detail:
                  'attendance_uuid=$remoteAttendanceId local_id=${attendance.id} km=${attendance.actualKm}',
            );
            await SupabaseService.updateAttendanceKm(attendance);
            await _checkpoint(
              employeeCode: user.employeeCode,
              action: 'SUPABASE_UPDATE_ATTENDANCE_KM_SUCCESS',
              detail:
                  'attendance_uuid=$remoteAttendanceId local_id=${attendance.id} km=${attendance.actualKm}',
            );
            await _checkpoint(
              employeeCode: user.employeeCode,
              action: 'ATTENDANCE_UPDATE_SUCCESS',
              detail:
                  'attendance_uuid=$remoteAttendanceId local_id=${attendance.id} km=${attendance.actualKm}',
            );
          }
          await _checkpoint(
            employeeCode: user.employeeCode,
            action: 'LIVE_STATUS_UPDATE_START',
            detail: 'fo_user_id=${user.employeeCode} km=${attendance.actualKm}',
          );
          await _checkpoint(
            employeeCode: user.employeeCode,
            action: 'SUPABASE_UPDATE_LIVE_STATUS_START',
            detail: 'fo_user_id=${user.employeeCode} km=${attendance.actualKm}',
          );
          String currentStatus;
          try {
            await _checkpoint(
              employeeCode: user.employeeCode,
              action: 'CURRENT_STATUS_LOAD_START',
              detail: 'attendance_id=$attendanceId',
            );
            currentStatus = await _currentStatusLabel(
              employeeCode: user.employeeCode,
            );
            await _checkpoint(
              employeeCode: user.employeeCode,
              action: 'CURRENT_STATUS_LOAD_SUCCESS',
              detail: 'status=$currentStatus',
            );
          } catch (error, stackTrace) {
            await _checkpointError(
              employeeCode: user.employeeCode,
              action: 'CURRENT_STATUS_LOAD_FAILED',
              error: error,
              stackTrace: stackTrace,
            );
            rethrow;
          }
          await SupabaseService.updateLiveStatus(
            user: user,
            isTracking: true,
            status: currentStatus,
            latitude: log.latitude,
            longitude: log.longitude,
            accuracy: log.accuracy,
            speed: log.speed,
            battery: battery,
            routeKm: attendance.eligibleKm,
            attendanceId: attendance.remoteId,
          );
          await _checkpoint(
            employeeCode: user.employeeCode,
            action: 'SUPABASE_UPDATE_LIVE_STATUS_SUCCESS',
            detail: 'fo_user_id=${user.employeeCode} km=${attendance.actualKm}',
          );
          await CrashLogService.record(
            employeeCode: user.employeeCode,
            screen: 'tracking',
            action: 'BACKGROUND_LIVE_STATUS_SYNC_SUCCESS',
          );
          await _checkpoint(
            employeeCode: user.employeeCode,
            action: 'LIVE_STATUS_UPDATE_SUCCESS',
            detail: 'fo_user_id=${user.employeeCode} km=${attendance.actualKm}',
          );
          await CrashLogService.record(
            employeeCode: user.employeeCode,
            screen: 'tracking',
            action: 'LOCATION_SYNC_SUCCESS',
          );
        } catch (error, stackTrace) {
          await _checkpointError(
            employeeCode: user.employeeCode,
            action: 'ATTENDANCE_OR_LIVE_STATUS_UPDATE_FAILED',
            error: error,
            stackTrace: stackTrace,
          );
          await CrashLogService.record(
            employeeCode: user.employeeCode,
            screen: 'tracking',
            action: 'LOCATION_SYNC_FAILED',
            error: error,
            stackTrace: stackTrace,
          );
          // The service stays alive and retries on the next tick.
        }
      }

      try {
        await _checkpoint(
          employeeCode: user.employeeCode,
          action: 'LOCATION_UPDATE_INVOKE_START',
        );
        service.invoke('locationUpdate', {
          'latitude': log.latitude,
          'longitude': log.longitude,
          'accuracy': log.accuracy,
          'speed': log.speed,
          'battery': battery,
          'captured_at': log.capturedAt.toIso8601String(),
          'actual_km': attendance.actualKm,
          'queue_length': queueLength,
          'last_sync_success_at': lastSuccessfulSync?.toIso8601String(),
        });
        await _checkpoint(
          employeeCode: user.employeeCode,
          action: 'LOCATION_UPDATE_INVOKE_SUCCESS',
        );
      } catch (error, stackTrace) {
        await _checkpointError(
          employeeCode: user.employeeCode,
          action: 'LOCATION_UPDATE_INVOKE_FAILED',
          error: error,
          stackTrace: stackTrace,
        );
        rethrow;
      }
      await CrashLogService.record(
        employeeCode: user.employeeCode,
        screen: 'tracking',
        action: 'BACKGROUND_LOCATION_TICK_SUCCESS',
      );
      final nextInterval = intervalFor(position: position, battery: battery);
      lastPosition = position;
      nextTickInterval = nextInterval;
      service.invoke('trackingInterval', {
        'seconds': nextInterval.inSeconds,
        'battery': battery,
      });
    } catch (error, stackTrace) {
      await CrashLogService.record(
        employeeCode: sessionEmployeeCode,
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
      action: 'LOCATION_STREAM_STARTED',
    );
    timer?.cancel();
    Future<void> runAndSchedule() async {
      var nextInterval = BackgroundTrackingService.fallbackInterval;
      try {
        await runTick();
        nextInterval = nextTickInterval;
      } catch (error, stackTrace) {
        await CrashLogService.record(
          employeeCode: sessionEmployeeCode,
          screen: 'tracking',
          action: 'STARTTICKS_RUNTICK_EXCEPTION',
          error: error,
          stackTrace: stackTrace,
        );
      }
      timer?.cancel();
      timer = Timer(nextInterval, () => unawaited(runAndSchedule()));
    }

    await runAndSchedule();
  }

  service.on('startTracking').listen((_) {
    unawaited(
      startTicks().catchError((Object error, StackTrace stackTrace) {
        return CrashLogService.record(
          screen: 'tracking',
          action: 'TRACKING_CRASH',
          error: error,
          stackTrace: stackTrace,
        );
      }),
    );
  });
  service.on('stopService').listen((_) {
    unawaited(
      stopSelf().then(
        (_) => CrashLogService.record(
          screen: 'tracking',
          action: 'TRACKING_STOPPED',
        ),
      ),
    );
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

Future<double> _calculateKm(String attendanceId, {String? employeeCode}) async {
  await _checkpoint(
    employeeCode: employeeCode,
    action: 'KM_LOCAL_LOGS_LOAD_START',
    detail: 'attendance_id=$attendanceId',
  );
  final allLogs = await LocalStore.getLocationLogs();
  await _checkpoint(
    employeeCode: employeeCode,
    action: 'KM_LOCAL_LOGS_LOAD_SUCCESS',
    detail: 'count=${allLogs.length}',
  );
  final logs = allLogs
      .where((log) => log.attendanceId == attendanceId)
      .toList();

  await _checkpoint(
    employeeCode: employeeCode,
    action: 'KM_LOCAL_VISITS_LOAD_START',
    detail: 'attendance_id=$attendanceId',
  );
  final allVisits = await LocalStore.getVisits();
  await _checkpoint(
    employeeCode: employeeCode,
    action: 'KM_LOCAL_VISITS_LOAD_SUCCESS',
    detail: 'count=${allVisits.length}',
  );
  final visits = allVisits
      .where(
        (visit) =>
            visit.attendanceId == null ||
            visit.attendanceId!.isEmpty ||
            visit.attendanceId == attendanceId,
      )
      .toList();

  await _checkpoint(
    employeeCode: employeeCode,
    action: 'ROUTE_KM_CALCULATOR_START',
    detail: 'logs=${logs.length} visits=${visits.length}',
  );
  final km = RouteKmCalculator.calculateKm(logs, visits: visits);
  await _checkpoint(
    employeeCode: employeeCode,
    action: 'ROUTE_KM_CALCULATOR_SUCCESS',
    detail: 'km=$km',
  );
  return km;
}

Future<void> _syncQueuedLogs({String? employeeCode}) async {
  await _checkpoint(
    employeeCode: employeeCode,
    action: 'QUEUED_LOCATION_LOCAL_LOGS_LOAD_START',
  );
  final logs = await LocalStore.getUnsyncedLocationLogs(limit: 50);
  await _checkpoint(
    employeeCode: employeeCode,
    action: 'QUEUED_LOCATION_LOCAL_LOGS_LOAD_SUCCESS',
    detail: 'count=${logs.length}',
  );
  if (logs.isEmpty) return;
  try {
    await CrashLogService.record(
      employeeCode: employeeCode,
      screen: 'tracking',
      action: 'GPS_LOG_BATCH_SYNC_STARTED',
      error: 'count=${logs.length}',
    );
    final remoteIds = await SupabaseService.insertLocationBatch(logs);
    if (remoteIds.isEmpty) {
      await LocalStore.markLocationLogsSyncFailed(
        logs.map((log) => log.id).toList(),
        'No rows synced.',
      );
      await CrashLogService.record(
        employeeCode: employeeCode,
        screen: 'tracking',
        action: 'GPS_LOG_RETRY_PENDING',
        error: 'count=${logs.length}',
      );
      return;
    }
    await LocalStore.markLocationLogsSynced(remoteIds);
    await LocalStore.cleanupOldSyncedLocationLogs(keepDays: 10);
    await _checkpoint(
      employeeCode: employeeCode,
      action: 'QUEUED_LOCATION_LOCAL_LOGS_SAVE_SUCCESS',
    );
  } catch (error, stackTrace) {
    await LocalStore.markLocationLogsSyncFailed(
      logs.map((log) => log.id).toList(),
      error,
    );
    await CrashLogService.record(
      employeeCode: employeeCode,
      screen: 'tracking',
      action: 'GPS_LOG_SYNC_FAILED',
      error: error,
      stackTrace: stackTrace,
    );
  }
}

Future<String> _currentStatusLabel({String? employeeCode}) async {
  await _checkpoint(
    employeeCode: employeeCode,
    action: 'LOCALSTORE_ACTIVE_VISIT_START',
  );
  final activeVisit = await LocalStore.activeVisit();
  await _checkpoint(
    employeeCode: employeeCode,
    action: 'LOCALSTORE_ACTIVE_VISIT_SUCCESS',
    detail: 'active_visit_id=${activeVisit?.id ?? '--'}',
  );
  return activeVisit == null ? 'Active' : 'On Site Visit';
}

Future<void> _checkpoint({
  String? employeeCode,
  required String action,
  String? detail,
}) {
  return CrashLogService.record(
    employeeCode: employeeCode,
    screen: 'tracking',
    action: action,
    error: detail,
  );
}

Future<void> _checkpointError({
  String? employeeCode,
  required String action,
  required Object error,
  required StackTrace stackTrace,
}) {
  return CrashLogService.record(
    employeeCode: employeeCode,
    screen: 'tracking',
    action: action,
    error: error,
    stackTrace: stackTrace,
  );
}

String? _attendanceId(Attendance attendance) {
  final remote = attendance.remoteId?.trim();
  if (remote != null && remote.isNotEmpty) return remote;
  final local = attendance.id.trim();
  return local.isEmpty ? null : local;
}
