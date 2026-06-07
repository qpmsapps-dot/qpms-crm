// ignore_for_file: constant_identifier_names

const bool ENABLE_ANDROID_FOREGROUND_LOCATION_SERVICE = true;
const bool ENABLE_FLUTTER_TIMER_FALLBACK = true;
const bool ENABLE_FLOATING_BUBBLE = false;
const bool ENABLE_GPS_DEBUG_LOGS = true;

class TrackingFlags {
  static const enableAndroidForegroundLocationService =
      ENABLE_ANDROID_FOREGROUND_LOCATION_SERVICE;
  static const enableFlutterTimerFallback = ENABLE_FLUTTER_TIMER_FALLBACK;
  static const enableFloatingBubble = ENABLE_FLOATING_BUBBLE;
  static const enableGpsDebugLogs = ENABLE_GPS_DEBUG_LOGS;
}
