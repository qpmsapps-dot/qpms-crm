import 'dart:async';
import 'dart:io';
import 'dart:math';

import 'package:battery_plus/battery_plus.dart';
import 'package:flutter_background_service/flutter_background_service.dart';
import 'package:geolocator/geolocator.dart';

import '../models/fo_models.dart';
import '../services/background_tracking_service.dart';
import '../services/crash_log_service.dart';
import '../services/local_store.dart';
import '../services/supabase_service.dart';
import '../utils/date_utils.dart';
import '../utils/local_id.dart';
import 'route_km_calculator.dart';
import 'phase1_tracking_policy.dart';
import 'tracking_flags.dart';
import 'tracking_health_metrics.dart';

// ignore: constant_identifier_names
const bool ENABLE_BACKGROUND_SERVICE =
    TrackingFlags.enableAndroidForegroundLocationService;

class TrackingService {
  static const interval = Duration(seconds: 10);
  static const movingInterval = Duration(seconds: 10);
  static const stationaryInterval = Duration(seconds: 75);
  static const lowBatteryInterval = Duration(seconds: 45);
  static const queueSyncInterval = TrackingFlags.gpsBatchInterval;
  static const _batchSize = TrackingFlags.gpsBatchSize;
  static Timer? _timer;
  static StreamSubscription<Map<String, dynamic>?>? _updatesSub;
  static bool _starting = false;
  static bool _stableTickRunning = false;
  static bool _syncingQueuedLogs = false;
  static bool _pausedForSiteVisit = false;
  static bool _usingAndroidService = false;
  static bool _usingTimerFallback = false;
  static int _startGeneration = 0;
  static DateTime? _lastQueueSyncAttempt;
  static DateTime? _lastFallbackLiveStatusWrite;
  static DateTime? _lastFallbackAttendanceKmWrite;
  static DateTime? _lastFallbackRemoteValidationAttempt;
  static DateTime? _lastFallbackRemoteValidationSuccess;
  static DateTime? _lastGpsSync;
  static DateTime? _lastSuccessfulSync;
  static double? _lastLatitude;
  static double? _lastLongitude;
  static double? _lastAccuracy;
  static Position? _lastAcceptedPosition;
  static Duration _nextForegroundInterval = movingInterval;
  static int _gpsLogsToday = 0;
  static int _queueLength = 0;
  static String? _lastTrackingError;
  static TrackingMotionState? _lastFallbackMotionState;
  static final GpsBatchScheduler _batchScheduler = GpsBatchScheduler();

  static bool get isActive =>
      _timer?.isActive == true || _updatesSub != null || _pausedForSiteVisit;
  static bool get isPausedForSiteVisit => _pausedForSiteVisit;
  static String get trackingMode {
    if (_pausedForSiteVisit) return 'Paused for site visit';
    if (_usingAndroidService) return 'Android service';
    if (_usingTimerFallback) return 'Timer fallback';
    return 'stopped';
  }

  static DateTime? get lastGpsSync => _lastGpsSync;
  static DateTime? get lastSuccessfulSync => _lastSuccessfulSync;
  static double? get lastLatitude => _lastLatitude;
  static double? get lastLongitude => _lastLongitude;
  static double? get lastAccuracy => _lastAccuracy;
  static int get gpsLogsToday => _gpsLogsToday;
  static int get queueLength => _queueLength;
  static String? get lastTrackingError => _lastTrackingError;

  static Future<bool> start({
    required FoUser user,
    required Attendance attendance,
    required void Function(LocationLog log, double liveKm) onLog,
  }) async {
    final authValidation = SupabaseService.validateStartDayAuth(user);
    if (!authValidation.isValid) {
      _lastTrackingError = authValidation.message;
      await CrashLogService.record(
        employeeCode: user.employeeCode,
        screen: 'tracking',
        action: 'TRACKING_START_BLOCKED_AUTH',
        error: authValidation.diagnostics(),
      );
      return false;
    }
    if (_starting) {
      await CrashLogService.record(
        employeeCode: user.employeeCode,
        screen: 'tracking',
        action: 'TRACKING_DUPLICATE_PREVENTED',
        error: 'Tracking start skipped because another start is in progress.',
      );
      return false;
    }
    if ((_timer?.isActive == true || _usingAndroidService) &&
        !_pausedForSiteVisit) {
      await CrashLogService.record(
        employeeCode: user.employeeCode,
        screen: 'tracking',
        action: 'TRACKING_DUPLICATE_PREVENTED',
      );
      return true;
    }
    _starting = true;
    final generation = ++_startGeneration;
    try {
      await CrashLogService.record(
        employeeCode: user.employeeCode,
        screen: 'tracking',
        action: 'TRACKING_START',
      );
      final attendanceId = _attendanceId(attendance);
      if (attendanceId == null) {
        throw StateError('Tracking cannot start without attendance_id.');
      }
      final activeVisit = await LocalStore.activeVisit();
      if (activeVisit != null) {
        await pauseForSiteVisit(user: user, visit: activeVisit);
        return true;
      }
      _pausedForSiteVisit = false;
      _lastTrackingError = null;
      if (TrackingFlags.enableAndroidForegroundLocationService &&
          Platform.isAndroid) {
        _timer?.cancel();
        _timer = null;
        _usingTimerFallback = false;
        await _updatesSub?.cancel();
        _updatesSub = FlutterBackgroundService()
            .on('locationUpdate')
            .listen(
              (event) async {
                try {
                  if (generation != _startGeneration) return;
                  if (event == null) return;
                  final activeVisit = await LocalStore.activeVisit();
                  if (_pausedForSiteVisit || activeVisit != null) {
                    _pausedForSiteVisit = true;
                    unawaited(
                      CrashLogService.record(
                        employeeCode: user.employeeCode,
                        screen: 'tracking',
                        action: 'LOCATION_UPDATE_SKIPPED_ON_SITE_VISIT',
                        error: 'active_visit_id=${activeVisit?.id ?? '--'}',
                      ),
                    );
                    return;
                  }
                  unawaited(
                    CrashLogService.record(
                      employeeCode: user.employeeCode,
                      screen: 'tracking',
                      action: 'LOCATION_UPDATE_RECEIVED',
                    ),
                  );
                  final log = LocationLog(
                    id: newLocalId('gps'),
                    employeeCode: user.employeeCode,
                    attendanceId: attendanceId,
                    latitude: _double(event['latitude']) ?? 0,
                    longitude: _double(event['longitude']) ?? 0,
                    accuracy: _double(event['accuracy']),
                    speed: _double(event['speed']),
                    battery: _int(event['battery']),
                    capturedAt:
                        DateTime.tryParse(
                          event['captured_at']?.toString() ?? '',
                        ) ??
                        DateTime.now(),
                    synced: true,
                  );
                  final liveKm =
                      _double(event['actual_km']) ?? attendance.actualKm;
                  attendance.actualKm = liveKm;
                  _lastGpsSync = log.capturedAt;
                  _lastLatitude = log.latitude;
                  _lastLongitude = log.longitude;
                  _lastAccuracy = log.accuracy;
                  _queueLength = _int(event['queue_length']) ?? _queueLength;
                  _lastSuccessfulSync =
                      DateTime.tryParse(
                        event['last_sync_success_at']?.toString() ?? '',
                      ) ??
                      _lastSuccessfulSync;
                  onLog(log, liveKm);
                } catch (error, stackTrace) {
                  unawaited(
                    CrashLogService.record(
                      employeeCode: user.employeeCode,
                      screen: 'tracking',
                      action: 'TRACKING_CRASH',
                      error: error,
                      stackTrace: stackTrace,
                    ),
                  );
                }
              },
              onError: (Object error, StackTrace stackTrace) {
                unawaited(
                  CrashLogService.record(
                    employeeCode: user.employeeCode,
                    screen: 'tracking',
                    action: 'TRACKING_CRASH',
                    error: error,
                    stackTrace: stackTrace,
                  ),
                );
              },
              cancelOnError: false,
            );
        await BackgroundTrackingService.saveActiveSession(
          user: user,
          attendance: attendance,
        );
        final serviceStarted = await BackgroundTrackingService.startTracking();
        if (serviceStarted) {
          _usingAndroidService = true;
          await CrashLogService.record(
            employeeCode: user.employeeCode,
            screen: 'tracking',
            action: 'TRACKING_MODE_ANDROID_SERVICE',
          );
          return true;
        }
        _usingAndroidService = false;
        await _updatesSub?.cancel();
        _updatesSub = null;
        await CrashLogService.record(
          employeeCode: user.employeeCode,
          screen: 'tracking',
          action: 'FOREGROUND_SERVICE_FAILED_FALLBACK_TIMER',
        );
      }
      if (TrackingFlags.enableFlutterTimerFallback) {
        return await _startDemoStableTracking(
          user: user,
          attendance: attendance,
          attendanceId: attendanceId,
          onLog: onLog,
        );
      }
      _lastTrackingError = 'No GPS tracking mode is available.';
      return false;
    } catch (error, stackTrace) {
      await CrashLogService.record(
        employeeCode: user.employeeCode,
        screen: 'tracking',
        action: 'TRACKING_CRASH',
        error: error,
        stackTrace: stackTrace,
      );
      return false;
    } finally {
      _starting = false;
    }
  }

  static Future<void> stop({
    FoUser? user,
    double? latitude,
    double? longitude,
    double? accuracy,
    double? speed,
    double? routeKm,
    bool updateRemoteLiveStatus = true,
    String reason = 'explicit_stop',
  }) async {
    try {
      await CrashLogService.record(
        employeeCode: user?.employeeCode,
        screen: 'tracking',
        action: 'TRACKING_SERVICE_STOP_REQUESTED',
      );
      _timer?.cancel();
      _timer = null;
      await _updatesSub?.cancel();
      _updatesSub = null;
      if (!_usingAndroidService) {
        try {
          await syncQueuedLogs(
            force: true,
          ).timeout(TrackingFlags.gracefulFlushTimeout);
        } catch (_) {
          // Pending rows remain durable and will be retried after valid login.
        }
      }
      if (_usingAndroidService ||
          TrackingFlags.enableAndroidForegroundLocationService) {
        final stopped = await BackgroundTrackingService.stopTracking(
          reason: reason,
        );
        if (!stopped) {
          _lastTrackingError = 'Foreground tracking stop was not acknowledged.';
        }
      }
      await BackgroundTrackingService.clearActiveSession();
      _usingAndroidService = false;
      _usingTimerFallback = false;
      _pausedForSiteVisit = false;
      _lastFallbackLiveStatusWrite = null;
      _lastFallbackAttendanceKmWrite = null;
      _lastFallbackMotionState = null;
      _lastFallbackRemoteValidationAttempt = null;
      _lastFallbackRemoteValidationSuccess = null;
      await TrackingHealthMetrics.setValue('last_stop_reason', reason);
      await CrashLogService.record(
        employeeCode: user?.employeeCode,
        screen: 'tracking',
        action: 'TRACKING_STOPPED',
      );
    } catch (error, stackTrace) {
      await CrashLogService.record(
        employeeCode: user?.employeeCode,
        screen: 'tracking',
        action: 'TRACKING_CRASH',
        error: error,
        stackTrace: stackTrace,
      );
    }
    if (updateRemoteLiveStatus && user != null && SupabaseService.isReady) {
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

  static Future<void> pauseForSiteVisit({
    required FoUser user,
    required SiteVisit visit,
    Position? finalPosition,
  }) async {
    try {
      _timer?.cancel();
      _timer = null;
      if (!_usingAndroidService) {
        await _updatesSub?.cancel();
        _updatesSub = null;
      }
      _pausedForSiteVisit = true;
      BackgroundTrackingService.refreshAfterSiteVisitChange();
      await flushForTransition('check_in');

      final attendance = await LocalStore.getAttendance();
      final attendanceId = attendance == null
          ? visit.attendanceId
          : _remoteAttendanceId(attendance);
      var routeKm = attendance?.eligibleKm;
      LocationLog? finalLog;
      if (attendance != null && attendanceId != null && finalPosition != null) {
        finalLog = await _saveTravelPoint(
          user: user,
          attendance: attendance,
          attendanceId: attendanceId,
          position: finalPosition,
          capturedAt: visit.checkInTime.subtract(
            const Duration(milliseconds: 1),
          ),
          anchorAction: 'ROUTE_ANCHOR_CHECKIN_SAVED',
        );
        routeKm = attendance.eligibleKm;
      }
      if (SupabaseService.isReady) {
        try {
          await SupabaseService.updateLiveStatus(
            user: user,
            isOnline: true,
            isTracking: false,
            status: 'On Site Visit',
            latitude:
                finalLog?.latitude ??
                visit.currentLatitude ??
                finalPosition?.latitude,
            longitude:
                finalLog?.longitude ??
                visit.currentLongitude ??
                finalPosition?.longitude,
            accuracy:
                finalLog?.accuracy ??
                visit.currentGpsAccuracy ??
                finalPosition?.accuracy,
            speed: finalLog?.speed,
            routeKm: routeKm,
            attendanceId: attendanceId,
            activeSiteVisitId: visit.remoteId,
          );
        } catch (error, stackTrace) {
          await CrashLogService.record(
            employeeCode: user.employeeCode,
            screen: 'tracking',
            action: 'PAUSE_LIVE_STATUS_FAILED',
            error: error,
            stackTrace: stackTrace,
          );
        }
      }
      await CrashLogService.record(
        employeeCode: user.employeeCode,
        screen: 'tracking',
        action: 'TRACKING_STATE_PAUSED_FOR_SITE_VISIT',
        error: 'site_visit_id=${visit.remoteId ?? visit.id}',
      );
      await CrashLogService.record(
        employeeCode: user.employeeCode,
        screen: 'tracking',
        action: 'GPS_PAUSED_DURING_SITE_VISIT',
        error: 'site_visit_id=${visit.remoteId ?? visit.id}',
      );
    } catch (error, stackTrace) {
      _lastTrackingError = error.toString();
      await CrashLogService.record(
        employeeCode: user.employeeCode,
        screen: 'tracking',
        action: 'GPS_PAUSE_ON_SITE_CHECKIN_FAILED',
        error: error,
        stackTrace: stackTrace,
      );
    }
  }

  static Future<void> flushForTransition(String reason) async {
    if (_usingAndroidService) {
      FlutterBackgroundService().invoke('flushQueue', {'reason': reason});
      return;
    }
    try {
      await syncQueuedLogs(
        force: true,
      ).timeout(TrackingFlags.gracefulFlushTimeout);
    } catch (_) {
      // The durable queue is intentionally retained for the next safe retry.
    }
  }

  static Future<void> resumeAfterSiteCheckout({
    required FoUser user,
    required Attendance attendance,
    Position? checkoutPosition,
    DateTime? checkoutCapturedAt,
    required void Function(LocationLog log, double liveKm) onLog,
  }) async {
    try {
      _pausedForSiteVisit = false;
      BackgroundTrackingService.refreshAfterSiteVisitChange();
      await flushForTransition('checkout');
      final attendanceId = _remoteAttendanceId(attendance);
      LocationLog? checkoutLog;
      if (attendanceId != null && checkoutPosition != null) {
        checkoutLog = await _saveTravelPoint(
          user: user,
          attendance: attendance,
          attendanceId: attendanceId,
          position: checkoutPosition,
          capturedAt: checkoutCapturedAt,
          anchorAction: 'ROUTE_ANCHOR_CHECKOUT_SAVED',
        );
        onLog(checkoutLog, attendance.actualKm);
      }
      if (SupabaseService.isReady) {
        try {
          await SupabaseService.updateLiveStatus(
            user: user,
            isOnline: true,
            isTracking: true,
            status: 'Active',
            latitude: checkoutLog?.latitude ?? checkoutPosition?.latitude,
            longitude: checkoutLog?.longitude ?? checkoutPosition?.longitude,
            accuracy: checkoutLog?.accuracy ?? checkoutPosition?.accuracy,
            speed: checkoutLog?.speed,
            routeKm: attendance.eligibleKm,
            attendanceId: attendance.remoteId,
            clearActiveSiteVisit: true,
          );
        } catch (error, stackTrace) {
          await CrashLogService.record(
            employeeCode: user.employeeCode,
            screen: 'tracking',
            action: 'RESUME_LIVE_STATUS_FAILED',
            error: error,
            stackTrace: stackTrace,
          );
        }
      }
      await CrashLogService.record(
        employeeCode: user.employeeCode,
        screen: 'tracking',
        action: 'TRACKING_STATE_TRAVEL_ACTIVE',
      );
      await CrashLogService.record(
        employeeCode: user.employeeCode,
        screen: 'tracking',
        action: 'GPS_RESUMED_AFTER_CHECKOUT',
      );
      if (_usingAndroidService) {
        return;
      }
      final attendanceDate =
          attendance.attendanceDate?.trim().isNotEmpty == true
          ? attendance.attendanceDate!.trim()
          : indiaDateKey(attendance.startTime);
      if (attendanceDate != indiaDateKey(DateTime.now())) {
        await stop(
          user: user,
          updateRemoteLiveStatus: false,
          reason: 'attendance_date_mismatch',
        );
        return;
      }
      if (!await _validateFallbackAttendance(user, attendance)) return;
      if (_timer?.isActive != true &&
          TrackingFlags.enableFlutterTimerFallback) {
        _usingTimerFallback = true;
        _scheduleNextForegroundTick(onLog, delay: movingInterval);
      }
    } catch (error, stackTrace) {
      _lastTrackingError = error.toString();
      await CrashLogService.record(
        employeeCode: user.employeeCode,
        screen: 'tracking',
        action: 'GPS_RESUME_AFTER_SITE_CHECKOUT_FAILED',
        error: error,
        stackTrace: stackTrace,
      );
    }
  }

  static Future<bool> _startDemoStableTracking({
    required FoUser user,
    required Attendance attendance,
    required String attendanceId,
    required void Function(LocationLog log, double liveKm) onLog,
  }) async {
    if (_timer?.isActive == true) {
      await CrashLogService.record(
        employeeCode: user.employeeCode,
        screen: 'tracking',
        action: 'DEMO_STABLE_TRACKING_ALREADY_RUNNING',
      );
      return true;
    }
    await _updatesSub?.cancel();
    _updatesSub = null;
    _usingAndroidService = false;
    _usingTimerFallback = true;
    _pausedForSiteVisit = false;
    _lastTrackingError = null;
    await _refreshGpsLogsToday(user.employeeCode, attendanceId);
    await CrashLogService.record(
      employeeCode: user.employeeCode,
      screen: 'tracking',
      action: 'TRACKING_MODE_TIMER_FALLBACK',
      error: 'attendance_id=$attendanceId',
    );
    await _runDemoStableTick(onLog);
    _scheduleNextForegroundTick(onLog, delay: _nextForegroundInterval);
    await CrashLogService.record(
      employeeCode: user.employeeCode,
      screen: 'tracking',
      action: 'DEMO_STABLE_TRACKING_STARTED',
    );
    return true;
  }

  static Future<void> _runDemoStableTick(
    void Function(LocationLog log, double liveKm) onLog,
  ) async {
    if (_stableTickRunning) return;
    _stableTickRunning = true;
    FoUser? user;
    Attendance? attendance;
    try {
      await CrashLogService.record(
        screen: 'tracking',
        action: 'FOREGROUND_TICK_START',
      );
      user = await LocalStore.getUser();
      attendance = await LocalStore.getAttendance();
      final attendanceId = attendance == null
          ? null
          : _remoteAttendanceId(attendance);
      if (user == null || attendance == null || !attendance.isActive) {
        await CrashLogService.record(
          employeeCode: user?.employeeCode,
          screen: 'tracking',
          action: 'FOREGROUND_TICK_SKIPPED_NO_ACTIVE_ATTENDANCE',
        );
        return;
      }
      if (attendanceId == null) {
        await CrashLogService.record(
          employeeCode: user.employeeCode,
          screen: 'tracking',
          action: 'FOREGROUND_TICK_SKIPPED_NO_REMOTE_ID',
          error: 'local_id=${attendance.id}',
        );
        return;
      }
      final attendanceDate =
          attendance.attendanceDate?.trim().isNotEmpty == true
          ? attendance.attendanceDate!.trim()
          : indiaDateKey(attendance.startTime);
      if (attendanceDate != indiaDateKey(DateTime.now())) {
        await stop(
          user: user,
          updateRemoteLiveStatus: false,
          reason: 'attendance_date_mismatch',
        );
        return;
      }
      if (!await _validateFallbackAttendance(user, attendance)) return;
      final activeVisit = await LocalStore.activeVisit();
      if (_pausedForSiteVisit || activeVisit != null) {
        _timer?.cancel();
        _timer = null;
        _pausedForSiteVisit = true;
        await CrashLogService.record(
          employeeCode: user.employeeCode,
          screen: 'tracking',
          action: 'FOREGROUND_TICK_SKIPPED_ON_SITE_VISIT',
          error: 'active_visit_id=${activeVisit?.id ?? '--'}',
        );
        return;
      }
      var tickHadError = false;

      final position = await Geolocator.getCurrentPosition(
        locationSettings: const LocationSettings(
          accuracy: LocationAccuracy.high,
          timeLimit: Duration(seconds: 15),
        ),
      );
      int? battery;
      try {
        battery = await Battery().batteryLevel;
      } catch (_) {
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
      try {
        await LocalStore.addLocationLog(log, eventType: 'tracking');
        await TrackingHealthMetrics.increment('gps_collected');
        await TrackingHealthMetrics.increment('gps_queued');
        await CrashLogService.record(
          employeeCode: user.employeeCode,
          screen: 'tracking',
          action: 'GPS_LOG_SAVED_LOCAL',
          error: 'local_id=${log.id}',
        );
        await _refreshQueueLength();
      } catch (error, stackTrace) {
        tickHadError = true;
        await _recordDemoStableError(
          employeeCode: user.employeeCode,
          action: 'FOREGROUND_LOCATION_LOCAL_SAVE_FAILED',
          error: error,
          stackTrace: stackTrace,
        );
        return;
      }
      final motionState = _updateAdaptiveInterval(
        position,
        battery,
        user.employeeCode,
      );
      await _syncQueuedLogsIfDue(force: _lastQueueSyncAttempt == null);
      await _refreshGpsLogsToday(user.employeeCode, attendanceId);

      final liveKm = await calculateKm(attendanceId);
      final acceptedLog = await latestValidLog(attendanceId);
      attendance
        ..actualKm = liveKm < attendance.actualKm ? attendance.actualKm : liveKm
        ..totalRouteKm = attendance.totalRouteKm < attendance.eligibleKm
            ? attendance.eligibleKm
            : attendance.totalRouteKm;
      await LocalStore.saveAttendance(attendance);
      final now = DateTime.now();
      if (!TrackingFlags.enableAttendanceKmCoalescing ||
          WriteCadence.isDue(
            now: now,
            lastWriteAt: _lastFallbackAttendanceKmWrite,
            interval: WriteCadence.attendanceKm(motionState),
          )) {
        try {
          await SupabaseService.updateAttendanceKm(attendance);
          _lastFallbackAttendanceKmWrite = now;
          await TrackingHealthMetrics.increment('attendance_km_writes');
        } catch (error, stackTrace) {
          tickHadError = true;
          await _recordDemoStableError(
            employeeCode: user.employeeCode,
            action: 'FOREGROUND_ATTENDANCE_KM_UPDATE_FAILED',
            error: error,
            stackTrace: stackTrace,
          );
        }
      }
      final motionChanged =
          _lastFallbackMotionState != null &&
          _lastFallbackMotionState != motionState;
      if (!TrackingFlags.enableLiveStatusCoalescing ||
          motionChanged ||
          WriteCadence.isDue(
            now: now,
            lastWriteAt: _lastFallbackLiveStatusWrite,
            interval: WriteCadence.liveStatus(motionState),
          )) {
        try {
          await SupabaseService.updateLiveStatus(
            user: user,
            isTracking: true,
            status: 'Active',
            latitude: acceptedLog?.latitude,
            longitude: acceptedLog?.longitude,
            accuracy: acceptedLog?.accuracy,
            speed: acceptedLog?.speed,
            battery: battery,
            routeKm: attendance.eligibleKm,
            attendanceId: attendanceId,
          );
          _lastFallbackLiveStatusWrite = now;
          await TrackingHealthMetrics.increment('live_status_writes');
        } catch (error, stackTrace) {
          tickHadError = true;
          await _recordDemoStableError(
            employeeCode: user.employeeCode,
            action: 'FOREGROUND_LIVE_STATUS_UPDATE_FAILED',
            error: error,
            stackTrace: stackTrace,
          );
        }
      }
      _lastFallbackMotionState = motionState;
      _lastGpsSync = log.capturedAt;
      _lastLatitude = log.latitude;
      _lastLongitude = log.longitude;
      _lastAccuracy = log.accuracy;
      if (!tickHadError) _lastTrackingError = null;
      onLog(log, attendance.actualKm);
      await CrashLogService.record(
        employeeCode: user.employeeCode,
        screen: 'tracking',
        action: 'FOREGROUND_TICK_SUCCESS',
        error: 'attendance_id=$attendanceId km=${attendance.actualKm}',
      );
    } catch (error, stackTrace) {
      await _recordDemoStableError(
        employeeCode: user?.employeeCode,
        action: 'FOREGROUND_TICK_FAILED',
        error: error,
        stackTrace: stackTrace,
      );
    } finally {
      _stableTickRunning = false;
    }
  }

  static void _scheduleNextForegroundTick(
    void Function(LocationLog log, double liveKm) onLog, {
    required Duration delay,
  }) {
    _timer?.cancel();
    if (!_usingTimerFallback || _pausedForSiteVisit) return;
    _timer = Timer(delay, () async {
      await _runDemoStableTick(onLog);
      if (_usingTimerFallback && !_pausedForSiteVisit) {
        _scheduleNextForegroundTick(onLog, delay: _nextForegroundInterval);
      }
    });
  }

  static TrackingMotionState _updateAdaptiveInterval(
    Position position,
    int? battery,
    String employeeCode,
  ) {
    final previous = _lastAcceptedPosition;
    final movedMeters = previous == null
        ? 0.0
        : Geolocator.distanceBetween(
            previous.latitude,
            previous.longitude,
            position.latitude,
            position.longitude,
          );
    final speed = max(0, position.speed);
    final kmUsable =
        _isUsablePosition(position) &&
        position.accuracy <= RouteKmCalculator.maxAccuracyMeters &&
        speed <= RouteKmCalculator.maxSpeedMetersPerSecond;
    final moving = speed >= 1.5 || movedMeters >= 10;
    if (kmUsable && (previous == null || moving)) {
      _lastAcceptedPosition = position;
    }
    if (battery != null && battery < 15) {
      _nextForegroundInterval = lowBatteryInterval;
      unawaited(
        CrashLogService.record(
          employeeCode: employeeCode,
          screen: 'tracking',
          action: 'GPS_STATIONARY_INTERVAL',
          error: 'low_battery=$battery seconds=${lowBatteryInterval.inSeconds}',
        ),
      );
      return moving
          ? TrackingMotionState.moving
          : TrackingMotionState.stationary;
    }
    _nextForegroundInterval = moving ? movingInterval : stationaryInterval;
    unawaited(
      CrashLogService.record(
        employeeCode: employeeCode,
        screen: 'tracking',
        action: moving ? 'GPS_MOVING_INTERVAL_10S' : 'GPS_STATIONARY_INTERVAL',
        error:
            'speed=$speed moved_m=$movedMeters seconds=${_nextForegroundInterval.inSeconds}',
      ),
    );
    return moving ? TrackingMotionState.moving : TrackingMotionState.stationary;
  }

  static Future<void> _refreshGpsLogsToday(
    String employeeCode,
    String attendanceId,
  ) async {
    final today = DateTime.now();
    final localLogs = await LocalStore.getLocationLogs(
      attendanceId: attendanceId,
    );
    _gpsLogsToday = localLogs
        .where(
          (log) =>
              log.employeeCode == employeeCode &&
              log.attendanceId == attendanceId &&
              log.capturedAt.year == today.year &&
              log.capturedAt.month == today.month &&
              log.capturedAt.day == today.day,
        )
        .length;
  }

  static Future<LocationLog> _saveTravelPoint({
    required FoUser user,
    required Attendance attendance,
    required String attendanceId,
    required Position position,
    DateTime? capturedAt,
    String? anchorAction,
  }) async {
    int? battery;
    try {
      battery = await Battery().batteryLevel;
    } catch (_) {
      battery = null;
    }
    final log = LocationLog(
      id: newLocalId('gps'),
      employeeCode: user.employeeCode,
      attendanceId: attendanceId,
      latitude: position.latitude,
      longitude: position.longitude,
      accuracy: anchorAction == null
          ? position.accuracy
          : min(position.accuracy, RouteKmCalculator.maxAccuracyMeters),
      speed: max(0, position.speed),
      battery: battery,
      capturedAt: capturedAt ?? DateTime.now(),
    );
    await LocalStore.addLocationLog(log, eventType: anchorAction ?? 'anchor');
    await TrackingHealthMetrics.increment('gps_collected');
    await TrackingHealthMetrics.increment('gps_queued');
    await CrashLogService.record(
      employeeCode: user.employeeCode,
      screen: 'tracking',
      action: 'GPS_LOG_SAVED_LOCAL',
      error: 'local_id=${log.id}',
    );
    await _refreshQueueLength();
    if (anchorAction != null) {
      await CrashLogService.record(
        employeeCode: user.employeeCode,
        screen: 'tracking',
        action: anchorAction,
        error: 'attendance_id=$attendanceId',
      );
    }
    await _syncQueuedLogsIfDue(
      force: anchorAction != null || _lastQueueSyncAttempt == null,
    );
    await _refreshGpsLogsToday(user.employeeCode, attendanceId);

    final liveKm = await calculateKm(attendanceId);
    attendance
      ..actualKm = liveKm < attendance.actualKm ? attendance.actualKm : liveKm
      ..totalRouteKm = attendance.totalRouteKm < attendance.eligibleKm
          ? attendance.eligibleKm
          : attendance.totalRouteKm;
    await LocalStore.saveAttendance(attendance);
    if (SupabaseService.isReady) {
      try {
        await SupabaseService.updateAttendanceKm(attendance);
        _lastFallbackAttendanceKmWrite = DateTime.now();
        await TrackingHealthMetrics.increment('attendance_km_writes');
      } catch (error, stackTrace) {
        await _recordDemoStableError(
          employeeCode: user.employeeCode,
          action: 'FOREGROUND_ATTENDANCE_KM_UPDATE_FAILED',
          error: error,
          stackTrace: stackTrace,
        );
      }
    }
    _lastGpsSync = log.capturedAt;
    _lastLatitude = log.latitude;
    _lastLongitude = log.longitude;
    _lastAccuracy = log.accuracy;
    return log;
  }

  static Future<LocationLog?> saveRouteAnchor({
    required FoUser user,
    required Attendance attendance,
    required Position position,
    required String action,
    DateTime? capturedAt,
  }) async {
    final attendanceId = _remoteAttendanceId(attendance);
    if (attendanceId == null) {
      await CrashLogService.record(
        employeeCode: user.employeeCode,
        screen: 'tracking',
        action: '${action}_SKIPPED_NO_REMOTE_ID',
        error: 'local_id=${attendance.id}',
      );
      return null;
    }
    try {
      return await _saveTravelPoint(
        user: user,
        attendance: attendance,
        attendanceId: attendanceId,
        position: position,
        capturedAt: capturedAt,
        anchorAction: action,
      );
    } catch (error, stackTrace) {
      await _recordDemoStableError(
        employeeCode: user.employeeCode,
        action: '${action}_FAILED',
        error: error,
        stackTrace: stackTrace,
      );
      return null;
    }
  }

  static Future<void> _recordDemoStableError({
    String? employeeCode,
    required String action,
    required Object error,
    StackTrace? stackTrace,
  }) async {
    _lastTrackingError = error.toString();
    await CrashLogService.record(
      employeeCode: employeeCode,
      screen: 'tracking',
      action: action,
      error: error,
      stackTrace: stackTrace,
    );
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

  static bool _isUsablePosition(Position position) {
    return position.latitude.isFinite &&
        position.longitude.isFinite &&
        position.latitude >= -90 &&
        position.latitude <= 90 &&
        position.longitude >= -180 &&
        position.longitude <= 180;
  }

  static Future<void> _syncQueuedLogsIfDue({bool force = false}) async {
    final now = DateTime.now();
    final queueLength = await LocalStore.countUnsyncedLocationLogs();
    final decision = _batchScheduler.decision(
      now: now,
      queuedPoints: queueLength,
      force: force,
    );
    if (!decision.shouldFlush) return;
    _lastQueueSyncAttempt = now;
    await syncQueuedLogs(force: force);
  }

  static Future<bool> _validateFallbackAttendance(
    FoUser user,
    Attendance attendance,
  ) async {
    if (!TrackingFlags.enableRemoteAttendanceValidation ||
        !SupabaseService.isReady) {
      return true;
    }
    final now = DateTime.now();
    if (_lastFallbackRemoteValidationAttempt != null &&
        now.difference(_lastFallbackRemoteValidationAttempt!) <
            TrackingFlags.remoteAttendanceValidationInterval) {
      return true;
    }
    _lastFallbackRemoteValidationAttempt = now;
    if (SupabaseService.client.auth.currentSession == null ||
        SupabaseService.client.auth.currentUser == null) {
      await stop(
        user: user,
        updateRemoteLiveStatus: false,
        reason: 'authentication_not_authorized',
      );
      return false;
    }
    try {
      final active = await SupabaseService.isAttendanceConfirmedActive(
        user: user,
        attendance: attendance,
      );
      if (!active) {
        await TrackingHealthMetrics.increment('remote_validation_closed');
        await stop(
          user: user,
          updateRemoteLiveStatus: false,
          reason: 'backend_attendance_closed',
        );
        return false;
      }
      _lastFallbackRemoteValidationSuccess = now;
      await TrackingHealthMetrics.increment('remote_validation_active');
      return true;
    } catch (error) {
      final lower = error.toString().toLowerCase();
      if (lower.contains('jwt') ||
          lower.contains('session expired') ||
          lower.contains('unauthorized') ||
          lower.contains('401')) {
        await stop(
          user: user,
          updateRemoteLiveStatus: false,
          reason: 'authentication_expired',
        );
        return false;
      }
      final graceStart =
          _lastFallbackRemoteValidationSuccess ?? attendance.startTime;
      if (now.difference(graceStart) >
          TrackingFlags.offlineAttendanceGracePeriod) {
        await stop(
          user: user,
          updateRemoteLiveStatus: false,
          reason: 'offline_validation_grace_expired',
        );
        return false;
      }
      return true;
    }
  }

  static Future<bool> syncQueuedLogs({bool force = false}) async {
    if (_usingAndroidService) {
      if (force) {
        FlutterBackgroundService().invoke('flushQueue', {
          'reason': 'forced_ui_flush',
        });
      }
      return false;
    }
    if (_syncingQueuedLogs || !SupabaseService.isReady) return false;
    _syncingQueuedLogs = true;
    final attemptAt = DateTime.now();
    _batchScheduler.markAttempt(attemptAt);
    await TrackingHealthMetrics.increment('batch_attempts');
    try {
      _queueLength = await LocalStore.countUnsyncedLocationLogs();
      await TrackingHealthMetrics.setValue('queue_size', _queueLength);
      await CrashLogService.record(
        screen: 'tracking',
        action: 'LOCATION_QUEUE_LENGTH',
        error: 'queue_length=$_queueLength',
      );
      if (_queueLength == 0) {
        _batchScheduler.markSuccess();
        return true;
      }
      final logs = await LocalStore.getUnsyncedLocationLogs(limit: _batchSize);
      await CrashLogService.record(
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
          screen: 'tracking',
          action: 'GPS_LOG_RETRY_PENDING',
          error: 'count=${logs.length}',
        );
        final delay = _batchScheduler.markFailure(DateTime.now());
        await TrackingHealthMetrics.increment('batch_failures');
        await TrackingHealthMetrics.setValue('retry_seconds', delay.inSeconds);
        return false;
      } else {
        await LocalStore.markLocationLogsSynced(remoteIds);
        _lastSuccessfulSync = DateTime.now();
        _batchScheduler.markSuccess();
        await LocalStore.cleanupOldSyncedLocationLogs(keepDays: 10);
        await TrackingHealthMetrics.increment('batch_successes');
        await TrackingHealthMetrics.increment(
          'gps_uploaded',
          by: remoteIds.length,
        );
        await TrackingHealthMetrics.setValue('retry_seconds', 0);
        await CrashLogService.record(
          screen: 'tracking',
          action: 'GPS_LOG_BATCH_SYNCED',
          error: 'count=${remoteIds.length}',
        );
      }
      _queueLength = await LocalStore.countUnsyncedLocationLogs();
      await TrackingHealthMetrics.setValue('queue_size', _queueLength);
      return true;
    } catch (error, stackTrace) {
      final delay = _batchScheduler.markFailure(DateTime.now());
      await TrackingHealthMetrics.increment('batch_failures');
      await TrackingHealthMetrics.setValue('retry_seconds', delay.inSeconds);
      await CrashLogService.record(
        screen: 'tracking',
        action: 'GPS_LOG_SYNC_FAILED',
        error: error,
        stackTrace: stackTrace,
      );
      return false;
    } finally {
      _syncingQueuedLogs = false;
    }
  }

  static Future<void> _refreshQueueLength() async {
    _queueLength = await LocalStore.countUnsyncedLocationLogs();
    await CrashLogService.record(
      screen: 'tracking',
      action: 'LOCATION_QUEUE_LENGTH',
      error: 'queue_length=$_queueLength',
    );
  }

  static String? _attendanceId(Attendance attendance) {
    final remote = attendance.remoteId?.trim();
    if (remote != null && remote.isNotEmpty) return remote;
    final local = attendance.id.trim();
    return local.isEmpty ? null : local;
  }

  static String? _remoteAttendanceId(Attendance attendance) {
    final remote = attendance.remoteId?.trim();
    if (remote == null || remote.isEmpty) return null;
    return SupabaseService.isValidUuid(remote) ? remote : null;
  }

  static Future<double> calculateKm(String attendanceId) async {
    final logs = await LocalStore.getLocationLogs(attendanceId: attendanceId);
    final visits = (await LocalStore.getVisits())
        .where(
          (visit) =>
              visit.attendanceId == null ||
              visit.attendanceId!.isEmpty ||
              visit.attendanceId == attendanceId,
        )
        .toList();
    return RouteKmCalculator.calculateKm(logs, visits: visits);
  }

  static Future<LocationLog?> latestValidLog(String attendanceId) async {
    return RouteKmCalculator.latestValidLog(
      await LocalStore.getLocationLogs(attendanceId: attendanceId),
    );
  }
}
