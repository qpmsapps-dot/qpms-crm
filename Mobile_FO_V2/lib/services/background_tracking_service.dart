import 'dart:async';
import 'dart:math';
import 'dart:ui';

import 'package:battery_plus/battery_plus.dart';
import 'package:connectivity_plus/connectivity_plus.dart';
import 'package:flutter_background_service/flutter_background_service.dart';
import 'package:geolocator/geolocator.dart';

import '../models/fo_models.dart';
import '../tracking/route_km_calculator.dart';
import '../tracking/phase1_tracking_policy.dart';
import '../tracking/tracking_flags.dart';
import '../tracking/tracking_health_metrics.dart';
import '../utils/date_utils.dart';
import '../utils/local_id.dart';
import 'config_service.dart';
import 'crash_log_service.dart';
import 'local_store.dart';
import 'site_away_notification_service.dart';
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
  static const siteAwayCheckInterval = Duration(minutes: 4);
  static const siteAwayThresholdMeters = 100.0;
  static const siteAwayNotificationCooldown = Duration(minutes: 15);
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
          autoStartOnBoot: true,
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

  static Future<bool> stopTracking({String reason = 'explicit_stop'}) async {
    if (!_configured) {
      await configure();
    }
    try {
      final service = FlutterBackgroundService();
      service.invoke('stopService', {'reason': reason});
      final deadline = DateTime.now().add(
        TrackingFlags.gracefulFlushTimeout + const Duration(seconds: 2),
      );
      while (await service.isRunning() && DateTime.now().isBefore(deadline)) {
        await Future<void>.delayed(const Duration(milliseconds: 200));
      }
      return !await service.isRunning();
    } catch (error, stackTrace) {
      await CrashLogService.record(
        screen: 'tracking',
        action: 'TRACKING_CRASH',
        error: error,
        stackTrace: stackTrace,
      );
      return false;
    }
  }

  /// Re-evaluates local state now when check-in or checkout changes it.
  static void refreshAfterSiteVisitChange() {
    FlutterBackgroundService().invoke('refreshTracking');
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
  StreamSubscription<List<ConnectivityResult>>? connectivitySubscription;
  var tickRunning = false;
  var stopRequested = false;
  var queueFlushRunning = false;
  Position? lastPosition;
  var nextTickInterval = BackgroundTrackingService.fallbackInterval;
  DateTime? lastSuccessfulSync;
  DateTime? lastLiveStatusWrite;
  DateTime? lastAttendanceKmWrite;
  DateTime? lastRemoteValidationAttempt;
  DateTime? lastRemoteValidationSuccess = DateTime.tryParse(
    session['remote_validation_succeeded_at']?.toString() ??
        session['saved_at']?.toString() ??
        '',
  );
  TrackingMotionState? lastMotionState;
  final batchScheduler = GpsBatchScheduler();
  String? monitoredVisitId;
  var consecutiveAwayChecks = 0;
  DateTime? lastSiteAwayNotificationAt;
  await TrackingHealthMetrics.increment('service_starts');
  await TrackingHealthMetrics.setValue(
    'wake_lock_state',
    'plugin_managed_unobservable',
  );

  Future<void> stopSelf({String reason = 'service_stop'}) async {
    stopRequested = true;
    timer?.cancel();
    timer = null;
    await connectivitySubscription?.cancel();
    connectivitySubscription = null;
    await LocalStore.clearBackgroundTrackingSession();
    await TrackingHealthMetrics.increment('service_stops');
    await TrackingHealthMetrics.setValue('last_stop_reason', reason);
    await TrackingHealthMetrics.setValue(
      'wake_lock_state',
      'service_stop_requested',
    );
    await CrashLogService.record(
      screen: 'tracking',
      action: 'BACKGROUND_SERVICE_STOPPED',
      error: 'reason=$reason',
    );
    service.stopSelf();
  }

  Future<bool> flushQueue({required String reason, bool force = false}) async {
    if (queueFlushRunning || !SupabaseService.isReady) return false;
    final queueLength = await LocalStore.countUnsyncedLocationLogs();
    await TrackingHealthMetrics.setValue('queue_size', queueLength);
    final now = DateTime.now();
    final decision = batchScheduler.decision(
      now: now,
      queuedPoints: queueLength,
      force: force,
    );
    if (!decision.shouldFlush) return queueLength == 0;
    queueFlushRunning = true;
    batchScheduler.markAttempt(now);
    await TrackingHealthMetrics.increment('batch_attempts');
    try {
      final uploaded = await _syncQueuedLogs(employeeCode: sessionEmployeeCode);
      if (uploaded == null) {
        final delay = batchScheduler.markFailure(DateTime.now());
        await TrackingHealthMetrics.increment('batch_failures');
        await TrackingHealthMetrics.setValue('retry_seconds', delay.inSeconds);
        return false;
      }
      batchScheduler.markSuccess();
      lastSuccessfulSync = DateTime.now();
      await TrackingHealthMetrics.increment('batch_successes');
      await TrackingHealthMetrics.increment('gps_uploaded', by: uploaded);
      await TrackingHealthMetrics.setValue('retry_seconds', 0);
      await TrackingHealthMetrics.setValue(
        'queue_size',
        await LocalStore.countUnsyncedLocationLogs(),
      );
      return true;
    } finally {
      queueFlushRunning = false;
    }
  }

  Future<void> shutdown({required String reason}) async {
    if (stopRequested) return;
    stopRequested = true;
    timer?.cancel();
    timer = null;
    try {
      await flushQueue(
        reason: reason,
        force: true,
      ).timeout(TrackingFlags.gracefulFlushTimeout);
    } catch (_) {
      // Unsent rows stay pending in SQLite and are retried after a valid login.
    }
    await stopSelf(reason: reason);
  }

  Future<bool> validateRemoteAttendance({
    required FoUser user,
    required Attendance attendance,
    bool force = false,
  }) async {
    if (!TrackingFlags.enableRemoteAttendanceValidation ||
        !SupabaseService.isReady) {
      return true;
    }
    final now = DateTime.now();
    if (!force &&
        lastRemoteValidationAttempt != null &&
        now.difference(lastRemoteValidationAttempt!) <
            TrackingFlags.remoteAttendanceValidationInterval) {
      return true;
    }
    lastRemoteValidationAttempt = now;
    if (SupabaseService.client.auth.currentSession == null ||
        SupabaseService.client.auth.currentUser == null) {
      await TrackingHealthMetrics.setValue(
        'remote_validation_result',
        'unauthorized',
      );
      await shutdown(reason: 'authentication_not_authorized');
      return false;
    }
    try {
      final remoteActive = await SupabaseService.isAttendanceConfirmedActive(
        user: user,
        attendance: attendance,
      );
      if (!remoteActive) {
        await TrackingHealthMetrics.increment('remote_validation_closed');
        await TrackingHealthMetrics.setValue(
          'remote_validation_result',
          'closed',
        );
        await shutdown(reason: 'backend_attendance_closed');
        return false;
      }
      lastRemoteValidationSuccess = now;
      await LocalStore.markBackgroundRemoteValidationSucceeded(now);
      await TrackingHealthMetrics.increment('remote_validation_active');
      await TrackingHealthMetrics.setValue(
        'remote_validation_result',
        'active',
      );
      return true;
    } catch (error) {
      final lower = error.toString().toLowerCase();
      final unauthorized =
          lower.contains('jwt') ||
          lower.contains('session expired') ||
          lower.contains('unauthorized') ||
          lower.contains('401');
      if (unauthorized) {
        await shutdown(reason: 'authentication_expired');
        return false;
      }
      final graceStart =
          lastRemoteValidationSuccess ??
          DateTime.tryParse(session['saved_at']?.toString() ?? '') ??
          now;
      if (now.difference(graceStart) >
          TrackingFlags.offlineAttendanceGracePeriod) {
        await shutdown(reason: 'offline_validation_grace_expired');
        return false;
      }
      await TrackingHealthMetrics.setValue(
        'remote_validation_result',
        'offline_grace',
      );
      return true;
    }
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
    if (tickRunning || stopRequested) return;
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
              role: 'FO',
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
        await shutdown(reason: 'no_active_local_attendance');
        return;
      }
      final attendanceDate =
          attendance.attendanceDate?.trim().isNotEmpty == true
          ? attendance.attendanceDate!.trim()
          : indiaDateKey(attendance.startTime);
      if (attendanceDate != indiaDateKey(DateTime.now())) {
        await shutdown(reason: 'attendance_date_mismatch');
        return;
      }
      if (!await validateRemoteAttendance(
        user: user,
        attendance: attendance,
        force: lastRemoteValidationAttempt == null,
      )) {
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
        await shutdown(reason: 'attendance_id_missing');
        return;
      }
      final activeVisit = await LocalStore.activeVisit();
      if (activeVisit != null) {
        final visitId = activeVisit.remoteId ?? activeVisit.id;
        final enteredSiteVisit = monitoredVisitId != visitId;
        if (enteredSiteVisit) {
          monitoredVisitId = visitId;
          consecutiveAwayChecks = 0;
          lastSiteAwayNotificationAt = null;
          await flushQueue(reason: 'check_in', force: true);
          if (SupabaseService.isReady) {
            try {
              await SupabaseService.updateAttendanceKm(attendance);
              lastAttendanceKmWrite = DateTime.now();
              await TrackingHealthMetrics.increment('attendance_km_writes');
            } catch (_) {
              // Local attendance and queued GPS remain authoritative offline.
            }
          }
        }
        final now = DateTime.now();
        if (SupabaseService.isReady &&
            (!TrackingFlags.enableLiveStatusCoalescing ||
                enteredSiteVisit ||
                WriteCadence.isDue(
                  now: now,
                  lastWriteAt: lastLiveStatusWrite,
                  interval: WriteCadence.liveStatus(
                    TrackingMotionState.checkedIn,
                  ),
                ))) {
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
            lastLiveStatusWrite = now;
            lastMotionState = TrackingMotionState.checkedIn;
            await TrackingHealthMetrics.increment('live_status_writes');
          } catch (error, stackTrace) {
            await _checkpointError(
              employeeCode: user.employeeCode,
              action: 'BACKGROUND_SITE_VISIT_STATUS_UPDATE_FAILED',
              error: error,
              stackTrace: stackTrace,
            );
          }
        }

        final siteLatitude =
            _isValidLatLng(
              activeVisit.destinationLatitude,
              activeVisit.destinationLongitude,
            )
            ? activeVisit.destinationLatitude
            : activeVisit.currentLatitude;
        final siteLongitude =
            _isValidLatLng(
              activeVisit.destinationLatitude,
              activeVisit.destinationLongitude,
            )
            ? activeVisit.destinationLongitude
            : activeVisit.currentLongitude;

        if (_isValidLatLng(siteLatitude, siteLongitude)) {
          try {
            final monitorPosition = await Geolocator.getCurrentPosition(
              locationSettings: const LocationSettings(
                accuracy: LocationAccuracy.medium,
                timeLimit: Duration(seconds: 15),
              ),
            );
            final distanceMeters = Geolocator.distanceBetween(
              siteLatitude!,
              siteLongitude!,
              monitorPosition.latitude,
              monitorPosition.longitude,
            );
            consecutiveAwayChecks =
                distanceMeters >
                    BackgroundTrackingService.siteAwayThresholdMeters
                ? consecutiveAwayChecks + 1
                : 0;
            await CrashLogService.record(
              employeeCode: user.employeeCode,
              screen: 'tracking',
              action: 'SITE_AWAY_CHECK_COMPLETED',
              error:
                  'site_visit_id=$visitId distance_m=${distanceMeters.toStringAsFixed(1)} consecutive_away=$consecutiveAwayChecks payable_km_unchanged=true',
            );

            final now = DateTime.now();
            final cooldownElapsed =
                lastSiteAwayNotificationAt == null ||
                now.difference(lastSiteAwayNotificationAt!) >=
                    BackgroundTrackingService.siteAwayNotificationCooldown;
            if (consecutiveAwayChecks >= 2 && cooldownElapsed) {
              // Checkout may have completed while GPS was being acquired.
              final stillActiveVisit = await LocalStore.activeVisit();
              if ((stillActiveVisit?.remoteId ?? stillActiveVisit?.id) ==
                  visitId) {
                await SiteAwayNotificationService.show();
                lastSiteAwayNotificationAt = now;
                await CrashLogService.record(
                  employeeCode: user.employeeCode,
                  screen: 'tracking',
                  action: 'SITE_AWAY_NOTIFICATION_SHOWN',
                  error:
                      'site_visit_id=$visitId distance_m=${distanceMeters.toStringAsFixed(1)}',
                );
              }
            }
          } catch (error, stackTrace) {
            consecutiveAwayChecks = 0;
            await _checkpointError(
              employeeCode: user.employeeCode,
              action: 'SITE_AWAY_CHECK_FAILED',
              error: error,
              stackTrace: stackTrace,
            );
          }
        } else {
          consecutiveAwayChecks = 0;
          await _checkpoint(
            employeeCode: user.employeeCode,
            action: 'SITE_AWAY_CHECK_SKIPPED_NO_COORDINATES',
            detail: 'site_visit_id=$visitId',
          );
        }
        service.invoke('trackingInterval', {
          'seconds': BackgroundTrackingService.siteAwayCheckInterval.inSeconds,
          'paused_for_site_visit': true,
        });
        nextTickInterval = BackgroundTrackingService.siteAwayCheckInterval;
        await _checkpoint(
          employeeCode: user.employeeCode,
          action: 'BACKGROUND_TICK_SKIPPED_ON_SITE_VISIT',
          detail: 'active_visit_id=${activeVisit.remoteId ?? activeVisit.id}',
        );
        return;
      }
      monitoredVisitId = null;
      consecutiveAwayChecks = 0;
      lastSiteAwayNotificationAt = null;

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
        existingLogs = await LocalStore.getLocationLogs(
          attendanceId: attendanceId,
        );
        if (stopRequested) return;
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
        await TrackingHealthMetrics.increment('gps_collected');
        await TrackingHealthMetrics.increment('gps_queued');
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

      final queueLength = await LocalStore.countUnsyncedLocationLogs();
      await TrackingHealthMetrics.setValue('queue_size', queueLength);
      await TrackingHealthMetrics.increment('duplicate_attempts_prevented');
      if (TrackingFlags.enableGpsBatching) {
        unawaited(flushQueue(reason: 'scheduled_tracking_tick'));
      } else {
        await flushQueue(reason: 'legacy_immediate_flush', force: true);
      }
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

      final motionState = _motionState(position, lastPosition);
      final motionChanged =
          lastMotionState != null && lastMotionState != motionState;
      final writeNow = DateTime.now();
      if (SupabaseService.isReady &&
          (!TrackingFlags.enableAttendanceKmCoalescing ||
              WriteCadence.isDue(
                now: writeNow,
                lastWriteAt: lastAttendanceKmWrite,
                interval: WriteCadence.attendanceKm(motionState),
              ))) {
        try {
          await SupabaseService.updateAttendanceKm(attendance);
          lastAttendanceKmWrite = writeNow;
          await TrackingHealthMetrics.increment('attendance_km_writes');
        } catch (error, stackTrace) {
          await _checkpointError(
            employeeCode: user.employeeCode,
            action: 'ATTENDANCE_KM_UPDATE_FAILED',
            error: error,
            stackTrace: stackTrace,
          );
        }
      }
      if (SupabaseService.isReady &&
          (!TrackingFlags.enableLiveStatusCoalescing ||
              motionChanged ||
              WriteCadence.isDue(
                now: writeNow,
                lastWriteAt: lastLiveStatusWrite,
                interval: WriteCadence.liveStatus(motionState),
              ))) {
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
            routeKm: attendance.eligibleKm,
            attendanceId: attendance.remoteId,
          );
          lastLiveStatusWrite = writeNow;
          await TrackingHealthMetrics.increment('live_status_writes');
        } catch (error, stackTrace) {
          await _checkpointError(
            employeeCode: user.employeeCode,
            action: 'LIVE_STATUS_UPDATE_FAILED',
            error: error,
            stackTrace: stackTrace,
          );
        }
      }
      lastMotionState = motionState;

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
    if (stopRequested) return;
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
      if (!stopRequested) {
        timer = Timer(nextInterval, () => unawaited(runAndSchedule()));
      }
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
  service.on('refreshTracking').listen((_) {
    unawaited(startTicks());
  });
  service.on('flushQueue').listen((event) {
    final reason = event?['reason']?.toString() ?? 'external_transition';
    unawaited(flushQueue(reason: reason, force: true));
  });
  service.on('stopService').listen((event) {
    unawaited(
      shutdown(
        reason: event?['reason']?.toString() ?? 'explicit_service_stop',
      ).then(
        (_) => CrashLogService.record(
          screen: 'tracking',
          action: 'TRACKING_STOPPED',
        ),
      ),
    );
  });

  connectivitySubscription = Connectivity().onConnectivityChanged.listen((
    results,
  ) {
    if (stopRequested || results.contains(ConnectivityResult.none)) return;
    batchScheduler.allowConnectivityRetry();
    unawaited(flushQueue(reason: 'connectivity_restored'));
  });

  final attendance = await LocalStore.getAttendance();
  if (attendance?.isActive == true) {
    await startTicks();
  } else {
    await shutdown(reason: 'service_recovery_without_active_attendance');
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

TrackingMotionState _motionState(Position position, Position? previous) {
  if (previous == null) return TrackingMotionState.moving;
  final movedMeters = Geolocator.distanceBetween(
    previous.latitude,
    previous.longitude,
    position.latitude,
    position.longitude,
  );
  return movedMeters >= 10 || position.speed >= 1.5
      ? TrackingMotionState.moving
      : TrackingMotionState.stationary;
}

bool _isValidLatLng(double? latitude, double? longitude) {
  return latitude != null &&
      longitude != null &&
      latitude.isFinite &&
      longitude.isFinite &&
      latitude >= -90 &&
      latitude <= 90 &&
      longitude >= -180 &&
      longitude <= 180;
}

Future<double> _calculateKm(String attendanceId, {String? employeeCode}) async {
  await _checkpoint(
    employeeCode: employeeCode,
    action: 'KM_LOCAL_LOGS_LOAD_START',
    detail: 'attendance_id=$attendanceId',
  );
  final allLogs = await LocalStore.getLocationLogs(attendanceId: attendanceId);
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

Future<int?> _syncQueuedLogs({String? employeeCode}) async {
  await _checkpoint(
    employeeCode: employeeCode,
    action: 'QUEUED_LOCATION_LOCAL_LOGS_LOAD_START',
  );
  final logs = await LocalStore.getUnsyncedLocationLogs(
    limit: TrackingFlags.gpsBatchSize,
  );
  await _checkpoint(
    employeeCode: employeeCode,
    action: 'QUEUED_LOCATION_LOCAL_LOGS_LOAD_SUCCESS',
    detail: 'count=${logs.length}',
  );
  if (logs.isEmpty) return 0;
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
      return null;
    }
    await LocalStore.markLocationLogsSynced(remoteIds);
    await LocalStore.cleanupOldSyncedLocationLogs(keepDays: 10);
    await _checkpoint(
      employeeCode: employeeCode,
      action: 'QUEUED_LOCATION_LOCAL_LOGS_SAVE_SUCCESS',
    );
    return remoteIds.length;
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
    return null;
  }
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
