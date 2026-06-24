import 'dart:io';

import 'package:device_info_plus/device_info_plus.dart';
import 'package:geolocator/geolocator.dart';
import 'package:permission_handler/permission_handler.dart' as ph;

import 'crash_log_service.dart';
import '../tracking/tracking_flags.dart';

class LocationReadinessResult {
  const LocationReadinessResult._({required this.allowed, this.message});

  const LocationReadinessResult.allowed() : this._(allowed: true);

  const LocationReadinessResult.blocked(String message)
    : this._(allowed: false, message: message);

  final bool allowed;
  final String? message;
}

class PermissionService {
  static const message =
      'For reliable field tracking, set Location permission to Allow all the time and Battery usage to Unrestricted.';
  static String locationStatus = 'unknown';
  static String batteryOptimizationStatus = 'unknown';
  static String notificationStatus = 'not required';
  static String backgroundLocationStatus = 'unknown';
  static String? warning;

  static Future<LocationReadinessResult> ensureForegroundLocation({
    String? employeeCode,
    String action = 'LOCATION_READINESS_CHECK',
  }) async {
    try {
      if (!await Geolocator.isLocationServiceEnabled()) {
        locationStatus = 'service disabled';
        await CrashLogService.record(
          employeeCode: employeeCode,
          screen: 'permissions',
          action: '${action}_SERVICE_DISABLED',
        );
        return const LocationReadinessResult.blocked(
          'Location/GPS is turned off. Please turn it on and try again.',
        );
      }

      var permission = await Geolocator.checkPermission();
      if (permission == LocationPermission.denied) {
        permission = await Geolocator.requestPermission();
      }
      if (permission == LocationPermission.deniedForever) {
        locationStatus = 'denied forever';
        await CrashLogService.record(
          employeeCode: employeeCode,
          screen: 'permissions',
          action: '${action}_PERMISSION_DENIED_FOREVER',
        );
        return const LocationReadinessResult.blocked(
          'Location permission is disabled. Enable Precise Location in app settings and try again.',
        );
      }
      if (permission == LocationPermission.denied) {
        locationStatus = 'denied';
        await CrashLogService.record(
          employeeCode: employeeCode,
          screen: 'permissions',
          action: '${action}_PERMISSION_DENIED',
        );
        return const LocationReadinessResult.blocked(
          'Location permission is required. Please allow location access and try again.',
        );
      }

      locationStatus = permission.name;
      final accuracy = await Geolocator.getLocationAccuracy();
      if (accuracy == LocationAccuracyStatus.reduced) {
        locationStatus = 'reduced accuracy';
        await CrashLogService.record(
          employeeCode: employeeCode,
          screen: 'permissions',
          action: '${action}_PRECISE_LOCATION_MISSING',
        );
        return const LocationReadinessResult.blocked(
          'Precise Location is required. Enable precise GPS access and try again.',
        );
      }

      await CrashLogService.record(
        employeeCode: employeeCode,
        screen: 'permissions',
        action: '${action}_READY',
      );
      return const LocationReadinessResult.allowed();
    } catch (error, stackTrace) {
      await CrashLogService.record(
        employeeCode: employeeCode,
        screen: 'permissions',
        action: '${action}_FAILED',
        error: error,
        stackTrace: stackTrace,
      );
      return const LocationReadinessResult.blocked(
        'Unable to verify GPS access. Please check location settings and try again.',
      );
    }
  }

  static Future<bool> ensureLocation() async {
    try {
      warning = null;
      final foreground = await ensureForegroundLocation(
        action: 'START_DAY_LOCATION_READINESS',
      );
      if (!foreground.allowed) return false;
      if (Platform.isAndroid) {
        final sdkInt = await _androidSdkInt();
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
