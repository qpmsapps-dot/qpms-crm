import 'dart:io';

import 'package:device_info_plus/device_info_plus.dart';
import 'package:geolocator/geolocator.dart';
import 'package:permission_handler/permission_handler.dart' as ph;

import 'crash_log_service.dart';
import '../tracking/tracking_flags.dart';

class PermissionService {
  static const message =
      'For reliable field tracking, set Location permission to Allow all the time and Battery usage to Unrestricted.';
  static String locationStatus = 'unknown';
  static String batteryOptimizationStatus = 'unknown';
  static String notificationStatus = 'not required';
  static String backgroundLocationStatus = 'unknown';
  static String? warning;

  static Future<bool> ensureLocation() async {
    try {
      warning = null;
      if (!await Geolocator.isLocationServiceEnabled()) {
        locationStatus = 'service disabled';
        await CrashLogService.record(
          screen: 'permissions',
          action: 'LOCATION_SERVICE_DISABLED',
        );
        return false;
      }
      var permission = await Geolocator.checkPermission();
      if (permission == LocationPermission.denied) {
        permission = await Geolocator.requestPermission();
      }
      if (permission == LocationPermission.denied ||
          permission == LocationPermission.deniedForever) {
        locationStatus = 'denied';
        await CrashLogService.record(
          screen: 'permissions',
          action: 'BACKGROUND_PERMISSION_MISSING',
          error: 'Location permission denied.',
        );
        return false;
      }
      locationStatus = permission.name;
      if (Platform.isAndroid) {
        final sdkInt = await _androidSdkInt();
        final accuracy = await Geolocator.getLocationAccuracy();
        if (accuracy == LocationAccuracyStatus.reduced) {
          locationStatus = 'reduced accuracy';
          await CrashLogService.record(
            screen: 'permissions',
            action: 'BACKGROUND_PERMISSION_MISSING',
            error: 'Precise location is disabled.',
          );
          return false;
        }
        if (TrackingFlags.enableAndroidForegroundLocationService) {
          final always = await ph.Permission.locationAlways.status;
          if (!always.isGranted && !always.isLimited) {
            await ph.Permission.locationAlways.request();
          }
          final alwaysAfterRequest = await ph.Permission.locationAlways.status;
          backgroundLocationStatus = alwaysAfterRequest.isGranted
              ? 'granted'
              : 'permission pending';
          if (!alwaysAfterRequest.isGranted && !alwaysAfterRequest.isLimited) {
            warning =
                'Background location permission pending. Tracking will continue while the foreground service is allowed, but may be limited after restrictions.';
            await CrashLogService.record(
              screen: 'permissions',
              action: 'BACKGROUND_PERMISSION_MISSING',
              error: 'Background location is not allowed.',
            );
          }
        } else {
          backgroundLocationStatus = 'not required';
        }
        if (sdkInt >= 33) {
          final notification = await ph.Permission.notification.status;
          if (!notification.isGranted) {
            await ph.Permission.notification.request();
          }
          final notificationAfterRequest =
              await ph.Permission.notification.status;
          notificationStatus = notificationAfterRequest.isGranted
              ? 'granted'
              : 'permission pending';
          if (!notificationAfterRequest.isGranted) {
            await CrashLogService.record(
              screen: 'permissions',
              action: 'BACKGROUND_PERMISSION_MISSING',
              error: 'Notification permission is not granted.',
            );
            return false;
          }
        } else {
          notificationStatus = 'not required';
        }
        final battery = await ph.Permission.ignoreBatteryOptimizations.status;
        if (!battery.isGranted) {
          batteryOptimizationStatus = 'restricted';
          await CrashLogService.record(
            screen: 'permissions',
            action: 'BATTERY_OPTIMIZATION_WARNING',
          );
          try {
            await ph.Permission.ignoreBatteryOptimizations.request();
          } catch (error, stackTrace) {
            await CrashLogService.record(
              screen: 'permissions',
              action: 'BATTERY_OPTIMIZATION_REQUEST_FAILED',
              error: error,
              stackTrace: stackTrace,
            );
          }
          if (!await ph.Permission.ignoreBatteryOptimizations.isGranted) {
            warning = 'Battery restriction may affect live tracking accuracy.';
          }
        } else {
          batteryOptimizationStatus = 'unrestricted';
        }
      }
      return true;
    } catch (error, stackTrace) {
      await CrashLogService.record(
        screen: 'permissions',
        action: 'PERMISSION_CHECK_FAILED',
        error: error,
        stackTrace: stackTrace,
      );
      return false;
    }
  }

  static Future<int> _androidSdkInt() async {
    if (!Platform.isAndroid) return 0;
    final info = await DeviceInfoPlugin().androidInfo;
    return info.version.sdkInt;
  }
}
