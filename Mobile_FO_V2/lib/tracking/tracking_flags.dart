// ignore_for_file: constant_identifier_names

const bool ENABLE_ANDROID_FOREGROUND_LOCATION_SERVICE = true;
const bool ENABLE_FLUTTER_TIMER_FALLBACK = true;
const bool ENABLE_FLOATING_BUBBLE = false;
const bool ENABLE_GPS_DEBUG_LOGS = true;
const bool ENABLE_PHASE1_GPS_BATCHING = true;
const bool ENABLE_PHASE1_DIAGNOSTIC_BATCHING = true;
const bool ENABLE_REMOTE_ATTENDANCE_VALIDATION = true;
const bool ENABLE_LIVE_STATUS_COALESCING = true;
const bool ENABLE_ATTENDANCE_KM_COALESCING = true;

class TrackingFlags {
  static const enableAndroidForegroundLocationService =
      ENABLE_ANDROID_FOREGROUND_LOCATION_SERVICE;
  static const enableFlutterTimerFallback = ENABLE_FLUTTER_TIMER_FALLBACK;
  static const enableFloatingBubble = ENABLE_FLOATING_BUBBLE;
  static const enableGpsDebugLogs = ENABLE_GPS_DEBUG_LOGS;
  static const enableGpsBatching = ENABLE_PHASE1_GPS_BATCHING;
  static const gpsBatchInterval = Duration(seconds: 60);
  static const gpsBatchPointThreshold = 8;
  static const gpsBatchSize = 50;
  static const gracefulFlushTimeout = Duration(seconds: 10);
  static const movingLiveStatusInterval = Duration(seconds: 60);
  static const stationaryLiveStatusInterval = Duration(seconds: 180);
  static const checkedInLiveStatusInterval = Duration(seconds: 240);
  static const movingAttendanceKmInterval = Duration(seconds: 60);
  static const stationaryAttendanceKmInterval = Duration(seconds: 180);
  static const enableLiveStatusCoalescing = ENABLE_LIVE_STATUS_COALESCING;
  static const enableAttendanceKmCoalescing = ENABLE_ATTENDANCE_KM_COALESCING;
  static const enableDiagnosticBatching = ENABLE_PHASE1_DIAGNOSTIC_BATCHING;
  static const diagnosticBatchInterval = Duration(minutes: 5);
  static const diagnosticBatchSize = 20;
  static const enableRemoteAttendanceValidation =
      ENABLE_REMOTE_ATTENDANCE_VALIDATION;
  static const remoteAttendanceValidationInterval = Duration(minutes: 10);
  static const offlineAttendanceGracePeriod = Duration(hours: 12);
}
